// Copyright Ayers Electronics Inc. All rights reserved.

export type DemoMessage = {
  info: { id: string; sessionID: string; role: "user" | "assistant";
    time: { created: number; completed?: number }; parentID?: string; finish?: string };
  parts: { id: string; sessionID: string; messageID: string; type: "text"; text: string;
    time?: { start: number; end?: number } }[];
};
export type DemoReportDraft = { id: string; question: string; answer: string; note: string };
export type DemoReportReceipt = { id: string; state: "sent" | "queued"; url?: string };
export type DemoWorkspace = { mode: "work" | "code"; filename: string; original: string; source: string;
  revision: string; checks: string[]; changes: { before: string; after: string }[];
  preview: string; originalPreview: string; revisions: { id: string; mode: "work" | "code" }[] };
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Session = { token: string; expiry: number };
const MAX_BODY = 1024 * 1024;
const MAX_STREAM = 80 * 1024 * 1024;
const MAX_LINE = 256 * 1024;
const FINISH = new Set(["stop", "length", "content-filter", "tool-calls", "error", "other", "unknown"]);
const failure = () => new Error("The demo request could not be completed. Please try again.");
const cancelled = () => new DOMException("The demo request was cancelled.", "AbortError");
function requireValue(value: unknown): asserts value { if (!value) throw failure(); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function id(value: unknown, prefix: string): string {
  requireValue(typeof value === "string" && new RegExp(`^${prefix}_[0-9a-f]{12}[0-9A-Za-z]{14}$`).test(value));
  return value;
}
function timestamp(value: unknown): number {
  requireValue(typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
  return value;
}
function workspace(value: unknown): DemoWorkspace {
  requireValue(record(value) && (value.mode === "work" || value.mode === "code")
    && typeof value.filename === "string" && value.filename === (value.mode === "work" ? "proposal.md" : "index.html")
    && typeof value.original === "string" && value.original.length <= 20_000
    && typeof value.source === "string" && value.source.length <= 20_000
    && typeof value.revision === "string" && /^(original|[a-f0-9]{12})$/.test(value.revision)
    && typeof value.preview === "string" && /^\/demo\/preview\/[a-f0-9]{48}$/.test(value.preview)
    && typeof value.originalPreview === "string" && /^\/demo\/preview\/[a-f0-9]{48}$/.test(value.originalPreview)
    && Array.isArray(value.checks) && value.checks.length <= 8
    && Array.isArray(value.changes) && value.changes.length <= 8
    && Array.isArray(value.revisions) && value.revisions.length <= 8);
  const checks = value.checks.map(item => { requireValue(typeof item === "string" && item.length <= 180); return item; });
  const changes = value.changes.map(item => {
    requireValue(record(item) && typeof item.before === "string" && item.before.length <= 4000 && typeof item.after === "string" && item.after.length <= 8000);
    return { before: item.before, after: item.after };
  });
  const revisions = value.revisions.map((item): DemoWorkspace["revisions"][number] => {
    requireValue(record(item) && typeof item.id === "string" && /^[a-f0-9]{12}$/.test(item.id) && (item.mode === "work" || item.mode === "code"));
    return { id: item.id, mode: item.mode };
  });
  return { mode: value.mode, filename: value.filename, original: value.original, source: value.source,
    revision: value.revision, checks, changes, preview: value.preview, originalPreview: value.originalPreview, revisions };
}
function messages(value: unknown): DemoMessage[] {
  requireValue(Array.isArray(value));
  const seen = new Set<string>();
  let session: string | undefined;
  return value.map((entry: unknown): DemoMessage => {
    requireValue(record(entry) && record(entry.info) && Array.isArray(entry.parts));
    const source = entry.info;
    const messageID = id(source.id, "msg");
    const sessionID = id(source.sessionID, "ses");
    requireValue(!seen.has(messageID) && (!session || session === sessionID));
    seen.add(messageID);
    session = sessionID;
    requireValue((source.role === "user" || source.role === "assistant") && record(source.time) && source.error === undefined);
    const info: DemoMessage["info"] = { id: messageID, sessionID, role: source.role,
      time: { created: timestamp(source.time.created) } };
    if (source.time.completed !== undefined) info.time.completed = timestamp(source.time.completed);
    if (source.parentID !== undefined) info.parentID = id(source.parentID, "msg");
    if (source.finish !== undefined) {
      requireValue(typeof source.finish === "string" && FINISH.has(source.finish));
      info.finish = source.finish;
    }
    const partIDs = new Set<string>();
    const parts: DemoMessage["parts"] = [];
    const candidates: unknown[] = entry.parts;
    for (const part of candidates) {
      requireValue(record(part) && part.sessionID === sessionID && part.messageID === messageID);
      if (part.type !== "text" || part.synthetic === true || part.ignored === true) continue;
      requireValue(typeof part.text === "string");
      const partID = id(part.id, "prt");
      requireValue(!partIDs.has(partID));
      partIDs.add(partID);
      const clean: DemoMessage["parts"][number] = { id: partID, sessionID, messageID, type: "text", text: part.text };
      if (part.time !== undefined) {
        requireValue(record(part.time));
        clean.time = { start: timestamp(part.time.start) };
        if (part.time.end !== undefined) clean.time.end = timestamp(part.time.end);
      }
      parts.push(clean);
    }
    return { info, parts };
  });
}

function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

/** Consent and a visitor lease live only in this client instance; requests are never retried. */
export function createDemoClient({ fetch: transport = globalThis.fetch, now = Date.now }:
  { fetch?: Transport; now?: () => number } = {}) {
  let session: Session | undefined;
  let generation = 0;
  let accepting: Promise<void> | undefined;
  let turn: AbortController | undefined;
  const active = new Set<AbortController>();

  async function run<T>(milliseconds: number, action: (controller: AbortController, check: () => void) => Promise<T>, external?: AbortSignal): Promise<T> {
    const current = generation;
    const controller = new AbortController();
    const abort = () => controller.abort();
    active.add(controller);
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) abort();
    const timeout = setTimeout(abort, milliseconds);
    const check = () => { if (current !== generation || controller.signal.aborted) throw cancelled(); };
    try { check(); const result = await cancellable(action(controller, check), controller.signal); check(); return result; }
    catch { if (controller.signal.aborted || current !== generation) throw cancelled(); throw failure(); }
    finally { clearTimeout(timeout); controller.abort(); active.delete(controller); external?.removeEventListener("abort", abort); }
  }

  function lease(): Session {
    if (!session || session.expiry <= now()) { session = undefined; throw new Error("Start a new demo conversation."); }
    return session;
  }

  async function request(path: string, method: string, body: unknown, controller: AbortController, used?: Session): Promise<Response> {
    const headers = new Headers({ Accept: path === "/demo/prompt" ? "application/x-ndjson" : "application/json" });
    if (used) headers.set("X-Demo-Session", used.token);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await cancellable(transport(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal, credentials: "omit", redirect: "error", ...(path === "/demo/close" ? { keepalive: true } : {}) }), controller.signal);
    if (response.status === 401 && session === used) session = undefined;
    if (response.status === 401 && path === "/demo/close") return response;
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw failure(); }
    return response;
  }

  async function read(response: Response, signal: AbortSignal, line?: (text: string) => boolean): Promise<string> {
    const limit = line ? MAX_STREAM : MAX_BODY;
    const declared = response.headers.get("content-length");
    requireValue(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const encoder = new TextEncoder();
    let bytes = 0;
    let pending = "";
    try {
      requireValue(declared === null || (/^\d+$/.test(declared) && Number(declared) <= limit));
      while (true) {
        const chunk = await cancellable(reader.read(), signal);
        if (signal.aborted) throw cancelled();
        bytes += chunk.value?.byteLength ?? 0;
        requireValue(bytes <= limit);
        pending += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        if (line) {
          let newline;
          while ((newline = pending.indexOf("\n")) >= 0) {
            const text = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            requireValue(encoder.encode(text).byteLength <= MAX_LINE);
            if (text.trim() && line(text)) return "";
          }
          requireValue(encoder.encode(pending).byteLength <= MAX_LINE);
          if (chunk.done) {
            if (pending.trim() && line(pending)) return "";
            throw failure(); // A turn is complete only after its explicit done event.
          }
        } else if (chunk.done) return pending;
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  return {
    get ready() { return !!session && session.expiry > now(); },
    accept(): Promise<void> {
      if (accepting) return accepting;
      if (session && session.expiry > now()) return Promise.resolve();
      const pending = run(5000, async (controller, check) => {
        const response = await request("/demo/session", "POST", { consentVersion: "claude-demo-1" }, controller);
        const value: unknown = JSON.parse(await read(response, controller.signal));
        check();
        requireValue(record(value) && typeof value.token === "string" && /^[A-F0-9]{64}$/.test(value.token)
          && typeof value.expiresAt === "string");
        const expiry = Date.parse(value.expiresAt);
        requireValue(Number.isFinite(expiry) && expiry > now() && expiry <= now() + 31 * 60_000);
        session = { token: value.token, expiry };
      });
      accepting = pending;
      void pending.then(() => { if (accepting === pending) accepting = undefined; }, () => { if (accepting === pending) accepting = undefined; });
      return pending;
    },
    reset() {
      generation++;
      session = undefined;
      accepting = undefined;
      for (const controller of active) controller.abort();
      turn = undefined;
    },
    async close(): Promise<void> {
      turn?.abort();
      if (!session || session.expiry <= now()) { this.reset(); return; }
      const used = session;
      await run(30_000, async (controller, check) => {
        const response = await request("/demo/close", "POST", {}, controller, used);
        if (response.status === 401) { void response.body?.cancel().catch(() => {}); return; }
        const value: unknown = JSON.parse(await read(response, controller.signal));
        check();
        requireValue(record(value) && value.closed === true);
      });
      if (session === used) this.reset();
    },
    async workspace(mode?: "work" | "code"): Promise<DemoWorkspace> {
      const used = lease();
      return run(5000, async (controller, check) => {
        const response = await request(mode ? "/demo/mode" : "/demo/workspace", mode ? "POST" : "GET", mode ? { mode } : undefined, controller, used);
        const result = workspace(JSON.parse(await read(response, controller.signal)));
        check(); return result;
      });
    },
    async document(version: "original" | "current", page?: 1 | 2, signal?: AbortSignal): Promise<Blob> {
      requireValue(version === "original" || version === "current");
      requireValue(page === undefined || page === 1 || page === 2);
      const used = lease();
      return run(10_000, async (controller, check) => {
        const path = page ? `/demo/page/${version}/${page}` : `/demo/document/${version}`;
        const response = await request(path, "GET", undefined, controller, used);
        requireValue(response.body && response.headers.get("content-type") === (page ? "image/png" : "application/pdf"));
        const reader = response.body.getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let bytes = 0;
        try {
          while (true) {
            const chunk = await cancellable(reader.read(), controller.signal);
            check();
            if (chunk.done) break;
            bytes += chunk.value.length;
            requireValue(bytes <= MAX_BODY);
            chunks.push(new Uint8Array(chunk.value));
          }
          return new Blob(chunks, { type: page ? "image/png" : "application/pdf" });
        } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      }, signal);
    },
    async send(text: string, onSnapshot: (value: DemoMessage[]) => void, signal?: AbortSignal,
      events?: { workspace(value: DemoWorkspace): void; error(message: string): void }): Promise<void> {
      requireValue(typeof text === "string" && text.trim().length > 0 && text.length <= 4000 && [...text].length <= 2000 && !turn);
      const used = lease();
      await run(95_000, async (controller, check) => {
        turn = controller;
        let sessionID: string | undefined;
        try {
          const response = await request("/demo/prompt", "POST", { text }, controller, used);
          await read(response, controller.signal, (line) => {
            check();
            const value: unknown = JSON.parse(line);
            requireValue(record(value));
            if (value.type === "done") return true;
            if (value.type === "workspace") { events?.workspace(workspace(value.workspace)); return false; }
            if (value.type === "workspace-error") {
              requireValue(typeof value.error === "string" && value.error.length <= 200);
              events?.error(value.error); return false;
            }
            requireValue(value.type === "snapshot");
            const clean = messages(value.messages);
            const nextSession = clean[0]?.info.sessionID;
            requireValue(!sessionID || !nextSession || sessionID === nextSession);
            sessionID ??= nextSession;
            check();
            onSnapshot(clean);
            return false;
          });
        } finally { if (turn === controller) turn = undefined; }
      }, signal);
    },
    async abort(): Promise<void> {
      turn?.abort();
      if (!session || session.expiry <= now()) return;
      const used = session;
      await run(10_000, async (controller) => {
        const response = await request("/demo/abort", "POST", {}, controller, used);
        void response.body?.cancel().catch(() => {});
      });
    },
    async report(draft: DemoReportDraft): Promise<DemoReportReceipt> {
      const used = lease();
      requireValue(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(draft.id)
        && typeof draft.question === "string" && draft.question.trim().length > 0 && draft.question.length <= 2000
        && typeof draft.answer === "string" && draft.answer.trim().length > 0 && draft.answer.length <= 8000
        && typeof draft.note === "string" && draft.note.length <= 2000);
      return run(10_000, async (controller, check) => {
        const response = await request("/demo/reports", "POST",
          { id: draft.id, question: draft.question, answer: draft.answer, note: draft.note }, controller, used);
        const value: unknown = JSON.parse(await read(response, controller.signal));
        check();
        requireValue(record(value) && value.id === draft.id && (value.state === "sent" || value.state === "queued"));
        const receipt: DemoReportReceipt = { id: draft.id, state: value.state };
        if (typeof value.url === "string") {
          const url = new URL(value.url);
          requireValue(url.protocol === "https:" && !url.username && !url.password);
          receipt.url = url.href;
        }
        return receipt;
      });
    },
  };
}
