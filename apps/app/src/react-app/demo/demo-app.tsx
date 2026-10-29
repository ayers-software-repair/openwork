// Copyright Ayers Electronics Inc. All rights reserved.
/** @jsxImportSource react */
import * as React from "react";
import type { UIMessage } from "ai";
import { MessageList } from "@/components/chat/message-list";
import { MessageListProvider } from "@/components/chat/message-list-provider";
import { textPartToUIPart } from "@/react-app/domains/session/sync/usechat-adapter";
import { ReactSessionComposer } from "@/react-app/domains/session/surface/composer/composer";
import { useSessionActivityStore } from "@/react-app/domains/session/status/session-activity-store";
import { Button } from "@/components/ui/button";
import { createDemoClient, type DemoMessage, type DemoReportDraft, type DemoReportReceipt } from "./demo-client";
import "./demo.css";

type Mount = { unmount(): void };
type DemoKit = {
  mountConsent(element: HTMLElement, options: { words: Record<string, string>; onAccept(): void | Promise<void>; onDecline(): void }): Mount;
  mountReport(element: HTMLElement, options: { words: Record<string, string>; draft: Omit<DemoReportDraft, "id">; onSubmit(draft: DemoReportDraft): Promise<DemoReportReceipt>; onClose(): void }): Mount;
};
const noAction = () => {};
const noItems = async () => [];
const unavailable = async (): Promise<never> => { throw new Error("Connections are not part of this public demo."); };
const REPORT_WORDS = {
  title: "Report this answer", body: "Review the selected question and answer. Remove any personal information before sending.",
  question: "Question", answer: "Answer", note: "What went wrong?", review: "Review report",
  privatePreview: "Private report details", publicSummaryLabel: "Public summary",
  publicSummary: "A visitor reported a demo assistant answer. The selected question, answer and note are in the private report bundle.",
  send: "Send report", edit: "Edit", cancel: "Cancel", sending: "Sending report…",
  error: "The report could not be confirmed. You can retry the same report.", invalid: "Include a question and answer within the field limits.",
  sent: "Report sent.", queued: "Report saved for delivery.", close: "Close", reportLink: "View report",
};
const examples = ["Help me plan a small business website.", "Explain this code: const total = prices.reduce((sum, price) => sum + price, 0);", "Draft a checklist for moving a project to a new computer."];
function project(messages: DemoMessage[]): UIMessage[] {
  return messages.map(({ info, parts }) => ({
    id: info.id, role: info.role,
    metadata: { opencode: { created: info.time.created, ...("completed" in info.time ? { completed: info.time.completed } : {}), ...("parentID" in info ? { parentID: info.parentID } : {}) } },
    parts: parts.flatMap(part => { const value = textPartToUIPart(part); return value ? [value] : []; }),
  }));
}

export function DemoApp() {
  const [client] = React.useState(() => createDemoClient());
  const [kit, setKit] = React.useState<DemoKit | null>(null);
  const [active, setActive] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [messages, setMessages] = React.useState<DemoMessage[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const stopPending = React.useRef(false);
  const [error, setError] = React.useState("");
  const [epoch, setEpoch] = React.useState(0);
  const consent = React.useRef<HTMLDivElement>(null);
  const request = React.useRef<AbortController | null>(null);
  const report = React.useRef<Mount | null>(null);
  const transcript = React.useRef<HTMLDivElement>(null);
  const version = React.useRef(0);
  const draftEdits = React.useRef(0);
  function editDraft(value: string) { draftEdits.current++; setDraft(value); }
  React.useEffect(() => {
    let live = true;
    const url = "/vendor/chat/chat.js";
    import(/* @vite-ignore */ url).then((value: DemoKit) => { if (live) setKit(value); })
      .catch(() => { if (live) setError("The demo could not load. Reload this page to try again."); });
    let released = false;
    const release = () => {
      if (released) return;
      released = true; live = false; version.current++; request.current?.abort();
      void client.close().catch(() => client.reset());
      report.current?.unmount();
    };
    const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) release(); };
    window.addEventListener("pagehide", pagehide);
    return () => { window.removeEventListener("pagehide", pagehide); release(); };
  }, [client]);
  React.useEffect(() => {
    if (active || !kit || !consent.current) return;
    let live = true;
    let starting = false;
    const mounted = kit.mountConsent(consent.current, {
      words: { title: "Try Howland with Claude",
        body: "Use Howland's OpenWork conversation interface to plan, draft, or ask about code. This public demo sends your messages to Anthropic's Claude. Do not enter personal information. It cannot access your files, run commands, or connect accounts. Your conversation is temporary. Howland, FERMI and Magpie share the demo question limit.",
        accept: "Start conversation", decline: "Read the Howland guide" },
      async onAccept() {
        if (starting) return;
        starting = true; setError("");
        try { await client.accept(); if (live) setActive(true); }
        catch { if (live) setError("The demo could not start. Please try again."); }
        finally { starting = false; }
      },
      onDecline() { window.location.assign("https://howland.si/docs/"); },
    });
    return () => { live = false; mounted.unmount(); };
  }, [active, kit, epoch, client]);
  React.useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted && active && !client.ready)
        setError("This conversation expired. Start a new one to continue.");
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, [active, client]);
  React.useEffect(() => {
    const area = transcript.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [messages]);
  async function send() {
    if (request.current || stopPending.current || !active || !draft.trim()) return;
    if (!client.ready) { setError("This conversation expired. Start a new one to continue."); return; }
    if ([...draft].length > 2000) { setError("Keep your message within 2,000 characters."); return; }
    const current = version.current;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    const asked = draft, edit = draftEdits.current;
    let acknowledged = false;
    try { await client.send(asked, snapshot => {
      if (current !== version.current) return;
      setMessages(snapshot);
      if (!acknowledged && snapshot.some(message => message.info.role === "user"
        && message.parts.map(part => part.text).join("") === asked)) {
        acknowledged = true;
        if (draftEdits.current === edit) setDraft("");
      }
    }, controller.signal); }
    catch (cause) {
      if (current === version.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "The answer could not be completed. Try a new conversation.");
      }
    } finally { if (current === version.current) { request.current = null; setBusy(false); } }
  }
  async function stop() {
    if (stopPending.current) return;
    const current = version.current;
    stopPending.current = true; setStopping(true);
    request.current?.abort();
    try { await client.abort(); }
    catch { if (current === version.current) setError("The stop could not be confirmed. Start a new conversation before continuing."); }
    finally { if (current === version.current) { stopPending.current = false; setStopping(false); } }
  }
  async function restart() {
    if (!active || stopPending.current || request.current) return;
    const preserveDraft = !client.ready;
    const current = version.current;
    stopPending.current = true; setStopping(true); setError("");
    try { await client.close(); }
    catch { if (current === version.current) setError("The conversation could not be closed. Please try again."); return; }
    finally { if (current === version.current) { stopPending.current = false; setStopping(false); } }
    if (current !== version.current) return;
    version.current++; request.current = null;
    client.reset(); report.current?.unmount(); report.current = null;
    stopPending.current = false; setStopping(false);
    setMessages([]); if (!preserveDraft) setDraft(""); setError(""); setBusy(false); setActive(false); setEpoch(value => value + 1);
  }
  function reportAnswer() {
    if (!kit || busy) return;
    const answer = [...messages].reverse().find(message => message.info.role === "assistant");
    const question = answer && messages.find(message => message.info.id === answer.info.parentID);
    if (!answer || !question) return;
    report.current?.unmount();
    report.current = kit.mountReport(document.body, { words: REPORT_WORDS,
      draft: { question: question.parts.map(part => part.text).join("\n"), answer: answer.parts.map(part => part.text).join("\n"), note: "" },
      onSubmit: selected => client.report(selected), onClose() { report.current = null; } });
  }
  const uiMessages = React.useMemo(() => project(messages), [messages]);
  React.useEffect(() => {
    useSessionActivityStore.getState().setRunStatus("public-demo", `conversation-${epoch}`, { type: busy ? "busy" : "idle" });
  }, [busy, epoch]);
  React.useEffect(() => {
    useSessionActivityStore.getState().observeTranscript("public-demo", `conversation-${epoch}`, uiMessages, true);
  }, [uiMessages, epoch]);
  React.useEffect(() => () => {
    useSessionActivityStore.getState().removeSession("public-demo", `conversation-${epoch}`);
  }, [epoch]);
  return <main className="howland-demo">
    <header className="howland-demo-head">
      <a className="howland-demo-brand" href="https://howland.si/" aria-label="Howland home"><img src="/howland-mark.webp" alt="" width="40" height="40" />Howland</a>
      <div className="howland-demo-actions"><Button variant="outline" onClick={restart} disabled={!active || busy || stopping}>New conversation</Button><Button render={<a href="https://howland.si/downloads.html" />}>Get Howland</Button></div>
    </header>
    <section className="howland-demo-conversation" aria-label="Conversation with Howland">
      {!active ? <div className="howland-demo-consent" ref={consent} /> : <>
        <div className="howland-demo-transcript" ref={transcript}>
          {!messages.length && <div className="howland-demo-empty"><h1>What would you like to work on?</h1><div>{examples.map(text => <Button key={text} variant="outline" onClick={() => editDraft(text)}>{text}</Button>)}</div></div>}
          <MessageListProvider readOnly workspaceId="public-demo" sessionId={`conversation-${epoch}`} uiStateOwner={null}
            showThinking={false} developerMode={false} displaySuggestions={false} providerConnectedCount={0}
            dispatchAction={noAction} setPrompt={editDraft} onRevertToUserMessage={noAction} onForkAtMessage={noAction}
            onEditUserMessage={noAction} onMcpReconnect={unavailable} onMcpReopenAuthorization={unavailable}>
            <MessageList messages={uiMessages} status={busy ? "streaming" : "ready"} activityStatus={busy ? "responding" : "idle"} />
          </MessageListProvider>
        </div>
        <div className="howland-demo-compose">
          <ReactSessionComposer textOnly flush draft={draft} mentions={{}} onDraftChange={editDraft} onSend={send} onSteer={noAction} onQueue={noAction} onStop={stop}
            busy={busy || stopping} stopping={stopping} steering={false} submissionPreparing={false} queuedCount={0} disabled={!client.ready || stopping} statusLabel={busy ? "Working" : "Ready"}
            modelPickerOpen={false} selectedModel={{ providerID: "anthropic", modelID: "claude-haiku-5-5" }} onModelPickerOpenChange={noAction} onModelChange={noAction}
            attachments={[]} attachmentsEnabled={false} attachmentsDisabledReason={null} onAttachFiles={noAction} onRemoveAttachment={noAction}
            modelVariantLabel="" modelVariant={null} onModelVariantChange={noAction} agentLabel="Howland" selectedAgent={null} onSelectAgent={noAction}
            listAgents={noItems} listCommands={noItems} searchFiles={noItems} recentFiles={[]} onInsertMention={noAction}
            onPasteText={text => { draftEdits.current++; setDraft(value => value + text); }} onUnsupportedFileLinks={noAction} pastedText={[]} onExpandPastedText={noAction} onRemovePastedText={noAction} draftScopeKey={`demo-${epoch}`} />
          {messages.some(message => message.info.role === "assistant") && <Button variant="ghost" disabled={busy || stopping} onClick={reportAnswer}>Report this answer</Button>}
        </div>
      </>}
      <p className="howland-demo-status" role="status">{error}</p>
    </section>
  </main>;
}
