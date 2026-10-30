// Copyright Ayers Electronics Inc. All rights reserved.
/** @jsxImportSource react */
import * as React from "react";
import type { DemoMessage, DemoReportDraft, DemoReportReceipt } from "./demo-client";

type Mount = { unmount(): void };
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: Date };
type ChatState = { messages: ChatMessage[]; isRunning: boolean; isDisabled: boolean;
  isSendDisabled: boolean; threadId: string; suggestions: { prompt: string }[] };
type NewMessage = { content?: readonly { type?: string; text?: string }[] };
type ChatHost = { words: Record<string, string>; store: { getSnapshot(): ChatState; subscribe(fn: () => void): () => void };
  onNew(message: NewMessage): Promise<void>; onCancel(): Promise<void>; onCopy(text: string): Promise<void>;
  onReport(draft: { question: string; answer: string }): void;
  flags: { markdown: boolean; suggestionsFillDraft: boolean; reduceMotion: boolean } };
export type DemoKit = {
  mountConsent(element: HTMLElement, options: { words: Record<string, string>; onAccept(): void | Promise<void>; onDecline(): void }): Mount;
  mountReport(element: HTMLElement, options: { words: Record<string, string>; draft: Omit<DemoReportDraft, "id">;
    onSubmit(draft: DemoReportDraft): Promise<DemoReportReceipt>; onClose(): void }): Mount;
  mountChat(host: ChatHost, element: HTMLElement): Mount;
};

function createStore() {
  let state: ChatState = { messages: [], isRunning: false, isDisabled: false, isSendDisabled: false, threadId: "", suggestions: [] };
  const listeners = new Set<() => void>();
  return { getSnapshot: () => state, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    set(next: ChatState) { state = next; for (const listener of listeners) listener(); } };
}

export function SharedConversation({ kit, messages, busy, disabled, epoch, suggestions, send, stop, report }:
  { kit: DemoKit; messages: DemoMessage[]; busy: boolean; disabled: boolean; epoch: number; suggestions: string[];
    send(text: string): Promise<void>; stop(): Promise<void>; report(draft: { question: string; answer: string }): void }) {
  const element = React.useRef<HTMLDivElement>(null);
  const [store] = React.useState(createStore);
  const actions = React.useRef({ send, stop, report });
  actions.current = { send, stop, report };
  React.useEffect(() => {
    store.set({ messages: messages.map(message => ({ id: message.info.id, role: message.info.role,
      content: message.parts.map(part => part.text).join(""), createdAt: new Date(message.info.time.created) })),
      isRunning: busy, isDisabled: disabled, isSendDisabled: busy, threadId: `sample-${epoch}`,
      suggestions: messages.length ? [] : suggestions.map(prompt => ({ prompt })) });
  }, [store, messages, busy, disabled, epoch, suggestions]);
  React.useEffect(() => {
    if (!element.current) return;
    const mount = kit.mountChat({ store, words: {
      thread: "Conversation with Howland", composer: "Message Howland", placeholder: "What would you like to change?",
      send: "Send", stop: "Stop", suggestions: "Sample tasks", jumpToLatest: "Latest answer", loading: "Loading conversation",
      toolRunning: "Working", toolComplete: "Complete", toolFailed: "Failed", toolApprovalRequired: "Approval required",
      copy: "Copy", copied: "Copied", copyFailed: "Copy failed", report: "Report this", undoSuggestion: "Undo suggestion",
      emptyTitle: "What would you like to work on?",
    }, flags: { markdown: true, suggestionsFillDraft: true,
      reduceMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false },
    async onNew(message) {
      if (!Array.isArray(message.content) || message.content.some(part => part.type !== "text" || typeof part.text !== "string"))
        throw new Error("This sample accepts text requests only.");
      await actions.current.send(message.content.map(part => part.text).join(""));
    }, onCancel: () => actions.current.stop(), onCopy: text => navigator.clipboard.writeText(text),
    onReport: draft => actions.current.report(draft) }, element.current);
    return () => mount.unmount();
  }, [kit, store]);
  return <div className="howland-demo-chat" ref={element} />;
}
