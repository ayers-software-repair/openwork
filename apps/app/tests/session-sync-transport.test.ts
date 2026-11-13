// Copyright Ayers Electronics Inc. All rights reserved.

import { expect, test } from "bun:test";
import { defaultSyncSubscriptionFactory } from "../src/react-app/domains/session/sync/session-sync";
import { startSyncStreamLifecycle } from "../src/react-app/domains/session/sync/sync-stream-lifecycle";

test("normal SDK subscription propagates authentication failure without retry", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(null, { status: 401 });
  };
  try {
    const error = await defaultSyncSubscriptionFactory("http://127.0.0.1:3210", "fixture", AbortSignal.timeout(1000))
      .catch((failure: unknown) => failure);
    expect(error).toHaveProperty("status", 401);
    expect(requests).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});

test("normal SDK subscription preserves its first event and exposes clean EOF", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('data: {"type":"server.heartbeat"}\n\n', {
    headers: { "Content-Type": "text/event-stream" },
  });
  try {
    const stream = await defaultSyncSubscriptionFactory("http://127.0.0.1:3210", "fixture", AbortSignal.timeout(1000));
    const iterator = stream[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: { type: "server.heartbeat" }, done: false });
    expect((await iterator.next()).done).toBe(true);
  } finally {
    globalThis.fetch = original;
  }
});

test("clean EOF cannot mark a failed normal SDK reconnect live", async () => {
  const original = globalThis.fetch;
  let upstream!: ReadableStreamDefaultController<Uint8Array>;
  const connected = new Promise<void>((resolve) => {
    globalThis.fetch = async () => {
      resolve();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { upstream = controller; },
      }), { headers: { "Content-Type": "text/event-stream" } });
    };
  });
  let phaseAfterFailure = "";
  const phases: string[] = [];
  const lifecycle = startSyncStreamLifecycle({
    subscribe: (signal) => defaultSyncSubscriptionFactory("http://127.0.0.1:3210", "fixture", signal),
    onEvent: () => {},
    onPhaseChange: (phase) => { phases.push(phase); phaseAfterFailure = phase; },
    retryInitialDelayMs: 5,
  });
  const until = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(condition()).toBe(true);
  };
  try {
    await connected;
    expect(lifecycle.getPhase()).toBe("connecting");
    upstream.enqueue(new TextEncoder().encode('data: {"type":"server.heartbeat"}\n\n'));
    await until(() => lifecycle.getPhase() === "live");
    let failedRequests = 0;
    globalThis.fetch = async () => {
      failedRequests++;
      throw new TypeError("host unavailable");
    };
    upstream.close();
    await until(() => failedRequests > 0 && phaseAfterFailure === "reconnecting");
    expect(phases.filter((phase) => phase === "live")).toHaveLength(1);
  } finally {
    lifecycle.dispose();
    globalThis.fetch = original;
  }
});
