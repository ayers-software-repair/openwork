// Copyright Ayers Electronics Inc. All rights reserved.
/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import type { NativeContextMenuRequest } from "../src/app/lib/desktop-types";

const ownedDom = typeof window === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "http://localhost:5173/" });
const previousActEnvironment: unknown = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { MessageList } = await import("../src/components/chat/message-list");
const { MessageListProvider } = await import("../src/components/chat/message-list-provider");
const { TooltipProvider } = await import("../src/components/ui/tooltip");
const { PlatformProvider, createDefaultPlatform } = await import("../src/react-app/kernel/platform");

afterAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
  if (ownedDom) await GlobalRegistrator.unregister();
});

const messages: UIMessage[] = [
  { id: "user-fixture", role: "user", parts: [{ type: "text", text: "Original question", state: "done" }],
    metadata: { opencode: { created: 100 } } },
  { id: "assistant-fixture", role: "assistant", parts: [{ type: "text", text: "Actual answer", state: "done" }],
    metadata: { opencode: { created: 110, completed: 120, parentID: "user-fixture" } } },
];

async function mount(readOnly: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const copy = spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const menuRequests: NativeContextMenuRequest[] = [];
  const platform = { ...createDefaultPlatform(), showContextMenu: async (request: NativeContextMenuRequest) => {
    menuRequests.push(request);
    return "copy";
  } };
  const edit = mock(() => {});
  const fork = mock(() => {});
  const revert = mock(() => {});
  const noAction = () => {};
  const unavailable = async (): Promise<never> => { throw new Error("Unexpected connection action"); };
  const render = async (locked: boolean) => {
    await act(async () => {
      root.render(<PlatformProvider value={platform}><QueryClientProvider client={query}><TooltipProvider>
        <MessageListProvider readOnly={locked} workspaceId="readonly-fixture" sessionId="readonly-session" uiStateOwner={null}
          showThinking={false} developerMode={false} displaySuggestions={false} providerConnectedCount={0}
          dispatchAction={noAction} setPrompt={noAction} onRevertToUserMessage={revert} onForkAtMessage={fork}
          onEditUserMessage={edit} onMcpReconnect={unavailable} onMcpReopenAuthorization={unavailable}>
          <MessageList messages={messages} status="ready" activityStatus="idle" />
        </MessageListProvider>
      </TooltipProvider></QueryClientProvider></PlatformProvider>);
    });
  };
  await render(readOnly);
  return {
    container, copy, menuRequests, edit, fork, revert, render,
    controls(label: string) { return container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`); },
    async menu() {
      const trigger = container.querySelector<HTMLElement>('[data-message-role="user"] [data-slot="context-menu-trigger"]');
      if (!trigger) throw new Error("User message context-menu trigger missing");
      window.getSelection()?.removeAllRanges();
      await act(async () => { trigger.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); });
      const request = menuRequests.at(-1);
      if (!request) throw new Error("Real context menu did not reach the platform adapter");
      return request.items;
    },
    async dispose() {
      await act(async () => root.unmount());
      query.clear();
      copy.mockRestore();
      container.remove();
    },
  };
}

test("read-only real MessageList hides mutation buttons and menu entries while preserving both copies", async () => {
  const view = await mount(true);
  try {
    expect(view.container.textContent).toContain("Original question");
    expect(view.container.textContent).toContain("Actual answer");
    for (const label of ["Edit message", "Branch in new chat", "Revert"]) expect(view.controls(label).length).toBe(0);
    expect(view.controls("Copy message").length).toBe(2);
    await act(async () => { for (const button of view.controls("Copy message")) button.click(); });
    expect(view.copy).toHaveBeenCalledWith("Original question");
    expect(view.copy).toHaveBeenCalledWith("Actual answer");
    expect(await view.menu()).toEqual([{ type: "item", id: "copy", label: "Copy", enabled: true }]);
    expect(view.edit).not.toHaveBeenCalled();
    expect(view.fork).not.toHaveBeenCalled();
    expect(view.revert).not.toHaveBeenCalled();
  } finally { await view.dispose(); }
});

test("changing readOnly restores existing mutation behavior, then removes it from buttons and context menu", async () => {
  const view = await mount(true);
  try {
    await view.render(false);
    expect(view.controls("Edit message").length).toBe(1);
    expect(view.controls("Branch in new chat").length).toBe(2);
    expect(view.controls("Revert").length).toBe(2);
    await act(async () => {
      view.controls("Edit message")[0].click();
      for (const button of view.controls("Branch in new chat")) button.click();
      for (const button of view.controls("Revert")) button.click();
    });
    expect(view.edit).toHaveBeenCalledWith("user-fixture", "Original question");
    expect(view.fork).toHaveBeenCalledTimes(2);
    expect(view.revert).toHaveBeenCalledTimes(2);
    const items = await view.menu();
    expect(items.map((item) => item.type === "item" ? item.id : "separator")).toEqual(["edit", "copy", "branch", "revert"]);
    await view.render(true);
    for (const label of ["Edit message", "Branch in new chat", "Revert"]) expect(view.controls(label).length).toBe(0);
    expect((await view.menu()).map((item) => item.type === "item" ? item.id : "separator")).toEqual(["copy"]);
  } finally { await view.dispose(); }
});
