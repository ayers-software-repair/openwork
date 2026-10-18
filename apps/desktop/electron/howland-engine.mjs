// Copyright Ayers Electronics Inc.
//
// Howland ships no OpenCode v2 engine. Upstream's opt-in preview reads its binary from
// OPENWORK_OPENCODE2_BIN before it falls back to downloading @opencode-ai/cli from npm, so a
// binary name nothing provides stops that download on every path in: the env switch, the saved
// setting and the toggle in Advanced settings. Both keys are set rather than deleted, because a
// key the process already has is never overridden from a user env file.
export function disableEngineV2Preview(env = process.env) {
  env.OPENWORK_ENGINE_V2_PREVIEW = "0";
  env.OPENWORK_OPENCODE2_BIN = "howland-ships-no-opencode-v2";
}
