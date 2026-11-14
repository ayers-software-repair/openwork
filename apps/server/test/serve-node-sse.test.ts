// Copyright Ayers Electronics Inc. All rights reserved.

import { expect, test } from "bun:test";
import { serve } from "../src/serve-node";

test("an idle SSE response exposes admission headers before its first event", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const host = await serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { stream = controller; },
    }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }),
  });
  try {
    const response = await fetch(`http://127.0.0.1:${host.port}/`, { signal: AbortSignal.timeout(2000) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    stream.enqueue(new TextEncoder().encode("data: fixture\n\n"));
    stream.close();
    expect(await response.text()).toBe("data: fixture\n\n");
  } finally {
    await host.stop();
  }
});
