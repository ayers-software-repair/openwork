/** @jsxImportSource react */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, expect, spyOn, test } from "bun:test";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import * as den from "../src/app/lib/den";
import { denSettingsChangedEvent } from "../src/app/lib/den-session-events";
import { clearCloudInventoryCache } from "../src/react-app/domains/connections/cloud-inventory-cache";
import { useOrgMcpConnections } from "../src/react-app/domains/connections/use-org-mcp-connections";

const ownedDom = typeof window === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "http://localhost:5173/" });
const previousActEnvironment: unknown = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterAll(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
  if (ownedDom) await GlobalRegistrator.unregister();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mount() {
  clearCloudInventoryCache();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let current: ReturnType<typeof useOrgMcpConnections> | undefined;
  function Probe({ enabled }: { enabled: boolean }) {
    const value = useOrgMcpConnections(enabled);
    useEffect(() => { current = value; });
    return <output>{value.connections.map((connection) => connection.name).join(",")}</output>;
  }
  return {
    container,
    async render(enabled: boolean) { await act(async () => root.render(<Probe enabled={enabled} />)); },
    state() {
      if (!current) throw new Error("The real hook did not mount");
      return current;
    },
    async dispose() {
      await act(async () => root.unmount());
      container.remove();
      clearCloudInventoryCache();
    },
  };
}

test("disabled organization connections never read settings or call the network, including explicit actions", async () => {
  const network = spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected disabled hook request"); });
  const settings = spyOn(den, "readDenSettings");
  const view = mount();
  try {
    await view.render(false);
    await act(async () => {
      await view.state().refresh();
      await view.state().connect("connection-id");
      await view.state().disconnect("connection-id");
      window.dispatchEvent(new CustomEvent(denSettingsChangedEvent));
    });
    expect(view.state().connections).toEqual([]);
    expect(view.state().loaded).toBe(true);
    expect(view.state().loading).toBe(false);
    expect(view.state().error).toBeNull();
    expect(settings).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    await view.dispose();
    settings.mockRestore();
    network.mockRestore();
  }
});

test("disabling during a real refresh discards the late result even when enabled again", async () => {
  const old = deferred<Response>();
  const fresh = deferred<Response>();
  const requests: string[] = [];
  const network = spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (!url.endsWith("/v1/mcp-connections?scope=usable")) throw new Error("Unexpected inventory route");
    return requests.length === 1 ? old.promise : fresh.promise;
  });
  const previousSettings = den.readDenSettings();
  den.writeDenSettings({ baseUrl: previousSettings.baseUrl, authToken: "test-token", activeOrgId: "test-org" }, { persistBootstrap: false });
  const settings = spyOn(den, "readDenSettings");
  const view = mount();
  const connection: den.DenExternalMcpConnection = {
    id: "old-connection", name: "Old connection", url: "https://connector.example.test/mcp",
    authType: "none", credentialMode: "shared", exposeDirectly: false,
    connected: true, connectedAt: null, connectedForMe: true,
  };
  try {
    await view.render(true);
    expect(requests.length).toBe(1);
    expect(view.state().loading).toBe(true);
    await view.render(false);
    const readsAfterDisable = settings.mock.calls.length;
    await act(async () => {
      old.resolve(Response.json({ connections: [connection] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.state().connections).toEqual([]);
    expect(view.state().error).toBeNull();
    expect(view.state().loading).toBe(false);
    expect(view.state().loaded).toBe(true);
    expect(settings.mock.calls.length).toBe(readsAfterDisable);
    expect(requests.length).toBe(1);
    await view.render(true);
    expect(requests.length).toBe(2);
    expect(view.state().connections).toEqual([]);
    expect(view.container.textContent).not.toContain("Old connection");
    await act(async () => {
      fresh.resolve(Response.json({ connections: [{ ...connection, id: "fresh-connection", name: "Fresh connection" }] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.container.textContent).toBe("Fresh connection");
    expect(view.state().loading).toBe(false);
    expect(view.state().loaded).toBe(true);
  } finally {
    await view.dispose();
    old.resolve(Response.json({ connections: [] }));
    fresh.resolve(Response.json({ connections: [] }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    settings.mockRestore();
    den.writeDenSettings(previousSettings, { persistBootstrap: false, intentionalActiveOrgClear: true });
    network.mockRestore();
  }
});
