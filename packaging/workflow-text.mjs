// Workflow text for the packaging contract tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Full-line `#` comments removed before any matching.
//
// COPIED FROM howland's workflowWithoutComments FOR THE REASON IT WAS WRITTEN: its first version
// failed on its own epitaph -- the comment explaining what a key USED to be matched the assertion
// forbidding it. Reference versus mention, inside the guard. Here the same trap is live and
// larger: release.yml's header quotes the retired sentence "There is no unsigned proof mode" in
// full, and both workflows name every asset in prose while explaining the decisions about them.
//
// Full-line only: a `#` inside a quoted value stays. That is the right side to err on -- missing a
// comment leaves a false positive that announces itself, where stripping a value hides a real key.
export function workflowWithoutComments(name) {
  const raw = readFileSync(path.join(repo, ".github", "workflows", name), "utf8");
  return raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

export function section(text, startsWith, endsWith) {
  const from = text.indexOf(startsWith);
  assert.notEqual(from, -1, `no ${JSON.stringify(startsWith)} in the workflow — this parser is not reading the step it names`);
  const rest = text.slice(from + startsWith.length);
  const to = rest.indexOf(endsWith);
  return to === -1 ? rest : rest.slice(0, to);
}
