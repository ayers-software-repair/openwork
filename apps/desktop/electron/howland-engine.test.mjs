// Copyright Ayers Electronics Inc.
import { it } from "node:test";
import assert from "node:assert/strict";

import { disableEngineV2Preview } from "./howland-engine.mjs";

// The values apps/server/src/engine-v2-preview.ts resolveInitialEngineV2PreviewState treats as on.
const ENABLING = ["1", "chat", "sidecar"];

it("leaves the engine v2 preview switch without effect and its binary unresolvable", () => {
  const env = { OPENWORK_ENGINE_V2_PREVIEW: "1" };
  disableEngineV2Preview(env);
  // Both keys stay set: reconcileInjectedUserEnv (runtime.mjs) never lets a user env file
  // override a key the process already had, so a deleted key could come back from one.
  assert.equal(Object.hasOwn(env, "OPENWORK_ENGINE_V2_PREVIEW"), true);
  assert.equal(ENABLING.includes(env.OPENWORK_ENGINE_V2_PREVIEW), false);
  // A set binary is resolved before the npm download, so the preview can never fetch one.
  assert.equal(env.OPENWORK_OPENCODE2_BIN, "howland-ships-no-opencode-v2");
});
