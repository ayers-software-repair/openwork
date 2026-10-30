// Copyright Ayers Electronics Inc. All rights reserved.
/** @jsxImportSource react */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { createDemoClient, type DemoMessage, type DemoWorkspace } from "./demo-client";
import { SharedConversation, type DemoKit } from "./demo-chat";
import { DemoWorkspacePanel } from "./demo-workspace";
import "./demo.css";

const REPORT_WORDS = {
  title: "Report this answer", body: "Review the selected question and answer. Remove any personal information before sending.",
  question: "Question", answer: "Answer", note: "What went wrong?", review: "Review report",
  privatePreview: "Private report details", publicSummaryLabel: "Public summary",
  publicSummary: "A visitor reported a demo assistant answer. The selected question, answer and note are in the private report bundle.",
  send: "Send report", edit: "Edit", cancel: "Cancel", sending: "Sending report…",
  error: "The report could not be confirmed. You can retry the same report.", invalid: "Include a question and answer within the field limits.",
  sent: "Report sent.", queued: "Report saved for delivery.", close: "Close", reportLink: "View report",
};
const TASKS = {
  work: ["Move the deadline to 21 June 2030, clarify what is included in the scope, and add a checklist of the materials the client needs to supply. Produce the revised PDF."],
  code: ["Fix the mobile menu so it opens and closes accessibly. Add a service category filter. Check the code and redeploy the sample website."],
};

export function DemoApp() {
  const [client] = React.useState(() => createDemoClient());
  const [kit, setKit] = React.useState<DemoKit | null>(null);
  const [workspace, setWorkspace] = React.useState<DemoWorkspace | null>(null);
  const [messages, setMessages] = React.useState<DemoMessage[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [switching, setSwitching] = React.useState(false);
  const [error, setError] = React.useState("");
  const [epoch, setEpoch] = React.useState(0);
  const consent = React.useRef<HTMLDivElement>(null);
  const request = React.useRef<AbortController | null>(null);
  const report = React.useRef<{ unmount(): void } | null>(null);
  const version = React.useRef(0);
  const stopPending = React.useRef(false);
  const modePending = React.useRef(false);
  React.useEffect(() => {
    let live = true, released = false;
    const url = "/vendor/chat/chat.js";
    import(/* @vite-ignore */ url).then((value: DemoKit) => { if (live) setKit(value); })
      .catch(() => { if (live) setError("The demo could not load. Reload this page to try again."); });
    const release = () => {
      if (released) return;
      released = true; live = false; version.current++; request.current?.abort();
      void client.close().catch(() => client.reset()); report.current?.unmount();
    };
    const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) release(); };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted && !client.ready) setError("This workspace expired. Start a new conversation to continue.");
    };
    window.addEventListener("pagehide", pagehide); window.addEventListener("pageshow", pageshow);
    return () => { window.removeEventListener("pagehide", pagehide); window.removeEventListener("pageshow", pageshow); release(); };
  }, [client]);
  React.useEffect(() => {
    if (workspace || !kit || !consent.current) return;
    let live = true, starting = false;
    const mounted = kit.mountConsent(consent.current, {
      words: { title: "Try Howland",
        body: "Revise a sample proposal or repair a sample website. This hosted demo sends your requests and sample content to an AI provider. Do not enter personal information. It cannot access your files or accounts. Your sample workspace is temporary and question limits apply.",
        accept: "Start working", decline: "Read the Howland guide" },
      async onAccept() {
        if (starting) return;
        starting = true; setError("");
        try { await client.accept(); const sample = await client.workspace(); if (live) setWorkspace(sample); }
        catch { if (live) setError("The demo could not start. Please try again."); }
        finally { starting = false; }
      },
      onDecline() { window.location.assign("https://howland.si/docs/"); },
    });
    return () => { live = false; mounted.unmount(); };
  }, [workspace, kit, epoch, client]);

  async function send(text: string) {
    if (request.current || stopPending.current || modePending.current || !workspace || !text.trim()) return;
    if (!client.ready) throw new Error("Start a new conversation to continue.");
    if ([...text].length > 2000) throw new Error("Keep your message within 2,000 characters.");
    const current = version.current, controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try { await client.send(text, snapshot => { if (current === version.current) setMessages(snapshot); }, controller.signal, {
      expected: { mode: workspace.mode, revision: workspace.revision },
      workspace: sample => { if (current === version.current) setWorkspace(sample); },
      error: message => { if (current === version.current) setError(message); },
    }); }
    catch (cause) {
      if (current === version.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "The request could not be completed.");
      }
      throw cause;
    } finally { if (current === version.current) { request.current = null; setBusy(false); } }
  }
  async function stop() {
    if (stopPending.current) return;
    const current = version.current; stopPending.current = true; setStopping(true); request.current?.abort();
    try { await client.abort(); }
    catch { if (current === version.current) setError("The stop could not be confirmed. Start a new conversation before continuing."); }
    finally { if (current === version.current) { stopPending.current = false; setStopping(false); } }
  }
  async function restart() {
    if (!workspace || stopPending.current || request.current || modePending.current) return;
    const current = version.current; stopPending.current = true; setStopping(true); setError("");
    try { await client.close(); }
    catch { if (current === version.current) setError("The workspace could not be closed. Please try again."); return; }
    finally { if (current === version.current) { stopPending.current = false; setStopping(false); } }
    if (current !== version.current) return;
    version.current++; client.reset(); report.current?.unmount(); report.current = null;
    setWorkspace(null); setMessages([]); setEpoch(value => value + 1);
  }
  async function selectMode(mode: "work" | "code") {
    if (!workspace || mode === workspace.mode || request.current || stopPending.current || modePending.current) return;
    const current = version.current; modePending.current = true; setSwitching(true); setError("");
    try { const sample = await client.workspace(mode); if (current === version.current) setWorkspace(sample); }
    catch { if (current === version.current) {
      try { const actual = await client.workspace(); if (current === version.current) setWorkspace(actual); } catch {}
      setError("The switch could not be confirmed. Check the selected mode before continuing.");
    } }
    finally { if (current === version.current) { modePending.current = false; setSwitching(false); } }
  }
  function reportAnswer(draft: { question: string; answer: string }) {
    if (!kit || busy || stopping || !client.ready) return;
    report.current?.unmount();
    report.current = kit.mountReport(document.body, { words: REPORT_WORDS, draft: { ...draft, note: "" },
      onSubmit: value => client.report(value), onClose() { report.current?.unmount(); report.current = null; } });
  }
  return <div className="howland-demo">
    {workspace && kit ? <>
      <div className="howland-demo-toolbar"><div role="group" aria-label="Workspace mode">{(["work", "code"] as const).map(mode =>
        <Button key={mode} variant="ghost" aria-pressed={workspace.mode === mode} disabled={busy || stopping || switching}
          onClick={() => void selectMode(mode)}>{mode === "work" ? "Work" : "Code"}</Button>)}</div>
        <Button variant="ghost" onClick={() => void restart()} disabled={busy || stopping || switching}>New conversation</Button></div>
      <div className="howland-demo-layout"><SharedConversation kit={kit} messages={messages} busy={busy || stopping}
        disabled={!client.ready || stopping || switching} epoch={epoch} suggestions={TASKS[workspace.mode]} send={send} stop={stop} report={reportAnswer} />
        <DemoWorkspacePanel client={client} workspace={workspace} onError={setError} /></div>
    </> : <div className="howland-demo-consent" ref={consent} />}
    <p className="howland-demo-status" role="status">{error}</p>
    <a className="howland-demo-privacy" href="https://ayers.repair/legal/howland/privacy.html">Privacy</a>
  </div>;
}
