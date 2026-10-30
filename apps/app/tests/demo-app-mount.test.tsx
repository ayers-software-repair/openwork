// Copyright Ayers Electronics Inc. All rights reserved.
/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ownedDom = typeof window === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "http://localhost:5173/" });
const previousActEnvironment: unknown = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

type ConsentOptions = { words: Record<string, string>; onAccept(): void | Promise<void> };
let acceptance: Promise<void> | undefined;
const mountConsent = mock((element: HTMLElement, options: ConsentOptions) => {
  const button = document.createElement("button");
  button.textContent = options.words.accept;
  button.addEventListener("click", () => { acceptance = Promise.resolve(options.onAccept()); });
  element.replaceChildren(button);
  return { unmount() { button.remove(); } };
});
const mountReport = mock(() => { throw new Error("Unexpected report dialog"); });
mock.module("/vendor/chat/chat.js", () => ({ mountConsent, mountReport }));

afterAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
  if (ownedDom) await GlobalRegistrator.unregister();
});

test("consent mounts the real empty demo composer with only public browser providers", async () => {
  const token = "A".repeat(64);
  const calls: { path: string; method: string }[] = [];
  const network = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
    const method = init?.method ?? "GET";
    calls.push({ path, method });
    if (path === "/demo/session" && method === "POST") {
      expect(JSON.parse(String(init?.body))).toEqual({ consentVersion: "claude-demo-1" });
      return Response.json({ token, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    }
    if (path === "/demo/close" && method === "POST") {
      expect(JSON.parse(String(init?.body))).toEqual({});
      expect(new Headers(init?.headers).get("X-Demo-Session")).toBe(token);
      return Response.json({ closed: true });
    }
    throw new Error("Unexpected demo network request: " + path);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const renderErrors: unknown[] = [];
  const root = createRoot(container, {
    onUncaughtError: (error) => { renderErrors.push(error); },
    onCaughtError: (error) => { renderErrors.push(error); },
  });
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  try {
    // Lexical must see a registered DOM at initialization; no app component is mocked.
    const { DemoApp } = await import("../src/react-app/demo/demo-app");
    const { TooltipProvider } = await import("../src/components/ui/tooltip");
    const { PlatformProvider, createDefaultPlatform } = await import("../src/react-app/kernel/platform");
    const { initLocale } = await import("../src/i18n");
    const { getNearestEditorFromDOMNode } = await import("lexical");
    initLocale();
    await act(async () => {
      // Mirror demo-main.tsx; a DesktopConfigProvider is deliberately absent.
      root.render(<QueryClientProvider client={query}><TooltipProvider>
        <PlatformProvider value={createDefaultPlatform()}><DemoApp /></PlatformProvider>
      </TooltipProvider></QueryClientProvider>);
    });
    expect(renderErrors).toEqual([]);
    expect(mountConsent).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    const start = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Start conversation");
    if (!start) throw new Error("Public consent did not mount");
    await act(async () => {
      start.click();
      if (!acceptance) throw new Error("Start did not invoke the actual consent callback");
      await acceptance;
    });
    expect(renderErrors).toEqual([]);
    const editor = container.querySelector<HTMLElement>('.howland-demo-compose [contenteditable="true"]');
    if (!editor) throw new Error("The actual demo Lexical composer did not mount after consent");
    expect(getNearestEditorFromDOMNode(editor)).not.toBeNull();
    expect(container.querySelector(".howland-demo-empty h1")?.textContent).toBe("What would you like to work on?");
    expect(Array.from(container.querySelectorAll(".howland-demo-empty button"), (button) => button.textContent)).toEqual([
      "Help me plan a small business website.",
      "Explain this code: const total = prices.reduce((sum, price) => sum + price, 0);",
      "Draft a checklist for moving a project to a new computer.",
    ]);
    expect(container.querySelector(".howland-demo-status")?.textContent).toBe("");
    expect(calls).toEqual([{ path: "/demo/session", method: "POST" }]);
    expect(mountReport).not.toHaveBeenCalled();
  } finally {
    try {
      await act(async () => {
        root.unmount();
        // Settle the real client's asynchronous close before restoring fetch.
        for (let turn = 0; turn < 20; turn++) await Promise.resolve();
      });
    } finally {
      query.clear();
      container.remove();
      network.mockRestore();
    }
  }
  expect(renderErrors).toEqual([]);
  expect(calls).toEqual([{ path: "/demo/session", method: "POST" }, { path: "/demo/close", method: "POST" }]);
  expect(mountReport).not.toHaveBeenCalled();
});
