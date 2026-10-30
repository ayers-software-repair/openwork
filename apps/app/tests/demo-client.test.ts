// Copyright Ayers Electronics Inc. All rights reserved.

import { afterEach, expect, jest, test } from "bun:test";
import { createDemoClient, type DemoMessage, type DemoReportDraft } from "../src/react-app/demo/demo-client";

afterEach(() => jest.useRealTimers());
const stamp = Date.parse("2026-10-28T12:00:00Z");
const token = "A".repeat(64);
const identifier = (prefix: string, suffix = "A") => `${prefix}_${"0".repeat(12)}${suffix.repeat(14)}`;
const sessionID = identifier("ses");
const messageID = identifier("msg");
const partID = identifier("prt");
const report: DemoReportDraft = { id: "12345678-1234-1234-1234-123456789abc", question: "Question", answer: "Answer", note: "" };
const grant = () => Response.json({ token, expiresAt: new Date(stamp + 30 * 60_000).toISOString() });
function message(text = "Answer") {
  return { info: { id: messageID, sessionID, role: "assistant", parentID: identifier("msg", "B"),
    time: { created: 1, completed: 2 }, finish: "stop", directory: "/private/host" },
    parts: [{ id: partID, sessionID, messageID, type: "text", text, privateData: "discard" },
      { id: identifier("prt", "B"), sessionID, messageID, type: "tool", secret: "discard" }] };
}
const snapshot = (text = "Answer") => JSON.stringify({ type: "snapshot", messages: [message(text)] }) + "\n";
const done = JSON.stringify({ type: "done" }) + "\n";
const workspace = { mode: "work", filename: "proposal.md", original: "Original", source: "Revised",
  revision: "a".repeat(12), checks: ["Two-page PDF generated"], changes: [{ before: "Original", after: "Revised" }],
  preview: `/demo/preview/${"b".repeat(48)}`, originalPreview: `/demo/preview/${"c".repeat(48)}`,
  revisions: [{ id: "a".repeat(12), mode: "work" }] };
function response(...chunks: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const text of chunks) controller.enqueue(new TextEncoder().encode(text));
    controller.close();
  } }), { headers: { "content-type": "application/x-ndjson" } });
}
function deferred<T>() {
  let complete: (value: T) => void = () => { throw new Error("uninitialized"); };
  const promise = new Promise<T>((resolve) => { complete = resolve; });
  return { promise, complete };
}
// Attach a normal rejection handler before triggering cancellation. Bun's rejects matcher can
// synchronously pump the event loop, preventing the next line from issuing the cancellation.
const rejection = (promise: Promise<unknown>) => promise.then(
  () => { throw new Error("Expected rejection"); }, (error: unknown) => error);
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture() {
  const calls: { url: string; init: RequestInit }[] = [];
  let clock = stamp;
  let handler = async (url: string): Promise<Response> => url === "/demo/session" ? grant() : response(snapshot(), done);
  const client = createDemoClient({ now: () => clock, fetch: (url, init) => { calls.push({ url, init }); return handler(url); } });
  return { client, calls, setHandler(value: typeof handler) { handler = value; }, advance(value: number) { clock += value; } };
}

test("no load-time request; consent is explicit, deduplicated and memory-only", async () => {
  const f = fixture();
  expect(f.calls).toHaveLength(0);
  await expect(f.client.send("Hello", () => {})).rejects.toThrow();
  const first = f.client.accept();
  expect(f.client.accept()).toBe(first);
  await first;
  expect(f.calls).toHaveLength(1);
  expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ consentVersion: "claude-demo-1" });
  expect(f.calls[0].init.credentials).toBe("omit");
  expect(f.calls[0].init.redirect).toBe("error");
  expect(f.client.ready).toBe(true);
  f.client.reset();
  expect(f.client.ready).toBe(false);
});

test("split NDJSON retains only typed text messages and requires done", async () => {
  const f = fixture();
  await f.client.accept();
  const frame = snapshot("Café");
  f.setHandler(async () => response(frame.slice(0, 22), frame.slice(22), done));
  const seen: DemoMessage[][] = [];
  await f.client.send("Question", (messages) => seen.push(messages));
  expect(seen).toHaveLength(1);
  expect(seen[0][0]).toEqual({ info: { id: messageID, sessionID, role: "assistant",
    parentID: identifier("msg", "B"), time: { created: 1, completed: 2 }, finish: "stop" },
    parts: [{ id: partID, sessionID, messageID, type: "text", text: "Café" }] });
  expect(new Headers(f.calls[1].init.headers).get("X-Demo-Session")).toBe(token);
  expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ text: "Question" });
  f.client.reset();
});

test("workspace results preserve lease binding and reject foreign preview URLs and oversized document bodies", async () => {
  const f = fixture();
  await expect(f.client.workspace()).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
  await f.client.accept();
  f.setHandler(async () => Response.json(workspace));
  expect((await f.client.workspace("work")).revision).toBe(workspace.revision);
  expect(JSON.parse(String(f.calls.at(-1)?.init.body))).toEqual({ mode: "work" });
  expect(new Headers(f.calls.at(-1)?.init.headers).get("X-Demo-Session")).toBe(token);
  f.setHandler(async () => Response.json({ ...workspace, preview: "https://foreign.test/preview" }));
  await expect(f.client.workspace()).rejects.toThrow();
  f.setHandler(async () => new Response(new Uint8Array(1024 * 1024 + 1), { headers: { "content-type": "application/pdf" } }));
  await expect(f.client.document("current")).rejects.toThrow();
  f.client.reset();
});

test("streamed workspace and check failure events are validated separately from the answer", async () => {
  const f = fixture(); await f.client.accept();
  const accepted: string[] = [], errors: string[] = [];
  f.setHandler(async () => response(snapshot(), JSON.stringify({ type: "workspace", workspace }) + "\n", done));
  await f.client.send("Question", () => {}, undefined, { workspace: value => accepted.push(value.revision), error: value => errors.push(value) });
  expect(accepted).toEqual([workspace.revision]); expect(errors).toEqual([]);
  f.setHandler(async () => response(snapshot(), JSON.stringify({ type: "workspace-error", error: "The prior revision is preserved." }) + "\n", done));
  await f.client.send("Question", () => {}, undefined, { workspace: value => accepted.push(value.revision), error: value => errors.push(value) });
  expect(accepted).toHaveLength(1); expect(errors).toEqual(["The prior revision is preserved."]);
  f.client.reset();
});

test.each([snapshot(), '{"type":"error","error":"private diagnostics"}\n', "not JSON\n"])(
  "incomplete or invalid streams fail once with a generic error", async (wire) => {
    const f = fixture(); await f.client.accept();
    f.setHandler(async () => response(wire));
    await expect(f.client.send("Question", () => {})).rejects.toThrow("The demo request could not be completed.");
    expect(f.calls).toHaveLength(2);
    f.client.reset();
  });

test("reset prevents a delayed consent response replacing a newer token", async () => {
  const f = fixture();
  const pending = deferred<Response>();
  f.setHandler(() => pending.promise);
  const rejected = rejection(f.client.accept());
  f.client.reset();
  expect(await rejected).toHaveProperty("name", "AbortError");
  f.setHandler(async () => Response.json({ token: "B".repeat(64), expiresAt: new Date(stamp + 60_000).toISOString() }));
  await f.client.accept();
  pending.complete(grant());
  await flush();
  f.setHandler(async () => response(done));
  await f.client.send("Question", () => {});
  expect(new Headers(f.calls.at(-1)?.init.headers).get("X-Demo-Session")).toBe("B".repeat(64));
  f.client.reset();
});

test("reset cancels a live reader and cannot publish a late snapshot", async () => {
  const f = fixture(); await f.client.accept();
  let streamCancelled = false;
  f.setHandler(async () => new Response(new ReadableStream({ cancel() { streamCancelled = true; } })));
  const seen: DemoMessage[][] = [];
  const rejected = rejection(f.client.send("Question", (items) => seen.push(items)));
  await flush();
  f.client.reset();
  expect(await rejected).toHaveProperty("name", "AbortError");
  await flush();
  expect(streamCancelled).toBe(true);
  expect(seen).toEqual([]);
});

test("abort cancels the active turn and sends one authenticated empty object", async () => {
  const f = fixture(); await f.client.accept();
  f.setHandler(async (url) => url === "/demo/abort" ? Response.json({ aborted: true }) : new Response(new ReadableStream()));
  const rejected = rejection(f.client.send("Question", () => {}));
  await flush();
  await f.client.abort();
  expect(await rejected).toHaveProperty("name", "AbortError");
  expect(f.calls.map((call) => call.url)).toEqual(["/demo/session", "/demo/prompt", "/demo/abort"]);
  expect(JSON.parse(String(f.calls[2].init.body))).toEqual({});
  expect(new Headers(f.calls[2].init.headers).get("X-Demo-Session")).toBe(token);
  f.client.reset();
});

test("caller cancellation never retries the prompt", async () => {
  const f = fixture(); await f.client.accept();
  f.setHandler(() => new Promise(() => {}));
  const controller = new AbortController();
  const rejected = rejection(f.client.send("Question", () => {}, controller.signal));
  controller.abort();
  expect(await rejected).toHaveProperty("name", "AbortError");
  expect(f.calls).toHaveLength(2);
  f.client.reset();
});

test("accepts legitimate multi-snapshot streams larger than one MiB", async () => {
  const f = fixture(); await f.client.accept();
  const frames = Array.from({ length: 12 }, (_, index) => snapshot(`${index}:` + "x".repeat(100_000)));
  const size = new TextEncoder().encode(frames.join("") + done).byteLength;
  expect(size).toBeGreaterThan(1024 * 1024);
  f.setHandler(async () => {
    const wire = response(...frames, done);
    wire.headers.set("content-length", String(size));
    return wire;
  });
  let received = 0;
  await f.client.send("Question", (items) => {
    expect(items[0].parts[0].text.startsWith(`${received}:`)).toBe(true);
    received++;
  });
  expect(received).toBe(12);
  expect(f.calls).toHaveLength(2);
  f.client.reset();
});

test("enforces the 256 KiB line byte bound", async () => {
  const f = fixture(); await f.client.accept();
  f.setHandler(async () => response(snapshot("é".repeat(140_000)), done));
  await expect(f.client.send("Question", () => {})).rejects.toThrow();
  expect(f.calls).toHaveLength(2);
  f.client.reset();
});

test("enforces the 80 MiB streamed total without an advertised length", async () => {
  const f = fixture(); await f.client.accept();
  const frame = new TextEncoder().encode(snapshot("x".repeat(200_000)));
  const allowed = Math.floor(80 * 1024 * 1024 / frame.byteLength);
  let emitted = 0;
  f.setHandler(async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted++ <= allowed) controller.enqueue(frame);
      else { controller.enqueue(new TextEncoder().encode(done)); controller.close(); }
    },
  })));
  let received = 0;
  await expect(f.client.send("Question", () => { received++; })).rejects.toThrow();
  expect(received).toBe(allowed);
  expect(f.calls).toHaveLength(2);
  f.client.reset();
});

test("nonstream report responses retain the one MiB bound", async () => {
  const f = fixture(); await f.client.accept();
  f.setHandler(async () => response(JSON.stringify({ id: report.id, state: "sent" }), " ".repeat(1024 * 1024)));
  await expect(f.client.report(report)).rejects.toThrow();
  expect(f.calls).toHaveLength(2);
  f.client.reset();
});

test("foreign part identity is rejected before a snapshot reaches the UI", async () => {
  const f = fixture(); await f.client.accept();
  const foreign = message();
  foreign.parts[0].sessionID = identifier("ses", "B");
  f.setHandler(async () => response(JSON.stringify({ type: "snapshot", messages: [foreign] }) + "\n", done));
  const seen: DemoMessage[][] = [];
  await expect(f.client.send("Question", (items) => seen.push(items))).rejects.toThrow();
  expect(seen).toEqual([]);
  f.client.reset();
});

test("a second active send is refused locally; 401 invalidates the lease without retry", async () => {
  const f = fixture(); await f.client.accept();
  f.setHandler(() => new Promise(() => {}));
  const first = rejection(f.client.send("First", () => {}));
  await expect(f.client.send("Second", () => {})).rejects.toThrow();
  expect(f.calls).toHaveLength(2);
  f.client.reset();
  expect(await first).toHaveProperty("name", "AbortError");
  f.setHandler(async () => grant());
  await f.client.accept();
  f.setHandler(async () => new Response(null, { status: 401 }));
  await expect(f.client.send("Third", () => {})).rejects.toThrow();
  expect(f.client.ready).toBe(false);
  expect(f.calls).toHaveLength(4);
  f.client.reset();
});

test.each(["accept", "send", "report"])("%s deadline covers an unfinished body", async (operation) => {
  jest.useFakeTimers();
  const f = fixture();
  if (operation !== "accept") await f.client.accept();
  f.setHandler(async () => new Response(new ReadableStream()));
  const promise = operation === "accept" ? f.client.accept() : operation === "send" ? f.client.send("Question", () => {}) : f.client.report(report);
  const rejected = rejection(promise);
  await flush();
  jest.advanceTimersByTime(operation === "accept" ? 5000 : operation === "send" ? 95_000 : 10_000);
  expect(await rejected).toHaveProperty("name", "AbortError");
  expect(f.calls.at(-1)?.init.signal?.aborted).toBe(true);
  f.client.reset();
});

test("only the selected draft leaves; receipts must match its ID and success state", async () => {
  const f = fixture(); await f.client.accept();
  f.setHandler(async () => Response.json({ id: report.id, state: "queued", url: null, diagnostics: "discard" }));
  expect(await f.client.report({ ...report, question: "Edited question" })).toEqual({ id: report.id, state: "queued" });
  expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ ...report, question: "Edited question" });
  f.setHandler(async () => Response.json({ id: "wrong", state: "sent" }));
  await expect(f.client.report(report)).rejects.toThrow();
  expect(f.calls).toHaveLength(3);
  f.client.reset();
});

test("expired or invalid leases never cause another prompt or automatic acceptance", async () => {
  const f = fixture(); await f.client.accept();
  f.advance(31 * 60_000);
  await expect(f.client.send("Question", () => {})).rejects.toThrow();
  expect(f.calls).toHaveLength(1);
  f.setHandler(async () => Response.json({ token: "bad", expiresAt: new Date(stamp + 60_000).toISOString() }));
  await expect(f.client.accept()).rejects.toThrow();
  expect(f.client.ready).toBe(false);
  f.client.reset();
});


test("explicit close releases the authenticated lease before another conversation", async () => {
  const f = fixture(); await f.client.accept();
  f.setHandler(async () => Response.json({ closed: true }));
  await f.client.close();
  expect(f.client.ready).toBe(false);
  expect(f.calls[1].url).toBe("/demo/close");
  expect(f.calls[1].init.keepalive).toBe(true);
  expect(new Headers(f.calls[1].init.headers).get("X-Demo-Session")).toBe(token);
  expect(JSON.parse(String(f.calls[1].init.body))).toEqual({});
  expect(f.calls).toHaveLength(2);
});

test("failed close keeps the lease for an explicit retry and never opens a replacement", async () => {
  const f = fixture(); await f.client.accept();
  f.setHandler(async () => new Response(null, { status: 503 }));
  await expect(f.client.close()).rejects.toThrow();
  expect(f.client.ready).toBe(true);
  expect(f.calls).toHaveLength(2);
  f.setHandler(async () => Response.json({ closed: true }));
  await f.client.close();
  expect(f.client.ready).toBe(false);
});
