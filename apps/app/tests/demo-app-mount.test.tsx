// Copyright Ayers Electronics Inc. All rights reserved.
/** @jsxImportSource react */
import { afterAll, expect, mock, spyOn, test } from "bun:test";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DemoKit } from "../src/react-app/demo/demo-chat";

const ownedDom = typeof document === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "https://demo.howland.si/", settings: { disableIframePageLoading: true } });
const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let acceptance: Promise<void> | undefined;
let host: Parameters<DemoKit["mountChat"]>[0] | undefined;
const mountConsent = mock<DemoKit["mountConsent"]>((element, options) => {
  const button = document.createElement("button"); button.textContent = options.words.accept;
  button.onclick = () => { acceptance = Promise.resolve(options.onAccept()); };
  element.append(button); return { unmount() { button.remove(); } };
});
const mountChat = mock<DemoKit["mountChat"]>((value, element) => {
  host = value;
  const input = document.createElement("textarea"); input.setAttribute("aria-label", value.words.composer);
  element.append(input); return { unmount() { input.remove(); } };
});
const mountReport = mock<DemoKit["mountReport"]>(() => ({ unmount() {} }));
mock.module("/vendor/chat/chat.js", () => ({ mountConsent, mountReport, mountChat }));
afterAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
  if (ownedDom) await GlobalRegistrator.unregister();
});

function activeHost() { if (!host) throw new Error("Shared chat did not mount"); return host; }
const initial = { mode: "work", filename: "proposal.md", source: "sample proposal", original: "sample proposal",
  revision: "original", checks: [], changes: [], preview: `/demo/preview/${"a".repeat(48)}`,
  originalPreview: `/demo/preview/${"a".repeat(48)}`, revisions: [] };

test("real demo mounts consent, leased Work and Code, shared smooth chat and selected-answer report review", async () => {
  // Happy DOM reports its deliberately disabled iframe load; real preview behavior is browser-tested.
  const browserLogs: unknown[][] = [];
  const browserConsole = spyOn(globalThis.console, "error").mockImplementation((...values: unknown[]) => { browserLogs.push(values); });
  const token = "A".repeat(64), calls: { path: string; method: string }[] = [];
  const network = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
    const method = init?.method ?? "GET"; calls.push({ path, method });
    if (path === "/demo/session") {
      expect(JSON.parse(String(init?.body))).toEqual({ consentVersion: "claude-demo-1" });
      return Response.json({ token, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    }
    expect(new Headers(init?.headers).get("X-Demo-Session")).toBe(token);
    if (path === "/demo/workspace") return Response.json(initial);
    if (path.startsWith("/demo/page/")) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    if (path === "/demo/mode") {
      expect(JSON.parse(String(init?.body))).toEqual({ mode: "code" });
      return Response.json({ ...initial, mode: "code", filename: "index.html", source: "<!doctype html>" });
    }
    if (path === "/demo/close") return Response.json({ closed: true });
    throw new Error("Unexpected request: " + path);
  });
  const container = document.createElement("div"); document.body.append(container);
  const renderErrors: unknown[] = [];
  const root = createRoot(container, { onUncaughtError: error => { renderErrors.push(error); }, onCaughtError: error => { renderErrors.push(error); } });
  try {
    const { DemoApp } = await import("../src/react-app/demo/demo-app");
    await act(async () => { root.render(<DemoApp />); });
    expect(calls).toEqual([]);
    expect(mountConsent.mock.calls[0]?.[1].words.title).toBe("Try Howland");
    expect(mountConsent.mock.calls[0]?.[1].words.body).not.toContain("Claude");
    const start = container.querySelector("button"); if (!start) throw new Error("Consent is missing");
    await act(async () => { start.click(); await acceptance; });
    expect(renderErrors).toEqual([]);
    expect(container.querySelector('[aria-label="Document workspace"]')).not.toBeNull();
    expect(activeHost().flags.markdown).toBe(true);
    expect(activeHost().flags.suggestionsFillDraft).toBe(true);
    expect(activeHost().words.report).toBe("Report this");
    expect(activeHost().store.getSnapshot().suggestions[0]?.prompt).toContain("21 June 2030");
    const code = [...container.querySelectorAll("button")].find(button => button.textContent === "Code");
    if (!code) throw new Error("Code mode is missing");
    await act(async () => { code.click(); for (let i = 0; i < 30; i++) await Promise.resolve(); });
    expect(container.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(activeHost().store.getSnapshot().suggestions[0]?.prompt).toContain("mobile menu");
    await act(async () => { activeHost().onReport({ question: "selected question", answer: "selected answer" }); });
    expect(mountReport.mock.calls[0]?.[1].draft).toEqual({ question: "selected question", answer: "selected answer", note: "" });
    expect(calls.some(call => call.path === "/demo/reports")).toBe(false);
  } finally {
    await act(async () => { root.unmount(); for (let i = 0; i < 20; i++) await Promise.resolve(); });
    container.remove(); network.mockRestore(); browserConsole.mockRestore();
  }
  expect(renderErrors).toEqual([]);
  expect(browserLogs.length).toBe(1);
  expect(browserLogs.every(values => values.map(String).join(" ").includes("Iframe page loading is disabled"))).toBe(true);
  expect(calls.at(-1)).toEqual({ path: "/demo/close", method: "POST" });
});
