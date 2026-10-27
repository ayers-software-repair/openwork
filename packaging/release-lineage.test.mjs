// The desktop publisher shares a public release with the separately prepared server. Its
// chained path must reject a bad server receipt before changing any desktop assets.
import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowWithoutComments, section } from "./workflow-text.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("chained desktop publication verifies the exact server before writing the shared release", () => {
  const job = section(workflowWithoutComments("release.yml"), "  publish-release:", "  stop-after-");
  const source = job.indexOf("name: Require server preparation before a chained publication");
  const desktop = job.indexOf("name: Publish the retained desktop assets");
  const dispatch = job.indexOf("name: Start exact prepared server publication after client success");
  assert.ok(source >= 0 && source < desktop && desktop < dispatch);
  const guard = job.slice(source, desktop);
  assert.match(guard, /if: \$\{\{ inputs\.chain \}\}/);
  assert.match(guard, /SERVER_RUN_ID: \$\{\{ inputs\.server_prepared_run_id \}\}/);
  assert.match(guard, /SERVER_ATTEMPT: \$\{\{ inputs\.server_prepared_run_attempt \}\}/);
  assert.match(guard, /\.head_sha.*server-run\.json/);
  assert.match(guard, /requiredArtifacts:\["validated-release-payload","prepared-docker-image"\]/);
  assert.match(guard, /prepared-release\.mjs verify/);
  assert.match(guard, /select\(startswith\("Howland-Server-"\)\)/);
  assert.match(guard, /server assets already published for this version.*exit 1/);
  assert.match(job.slice(dispatch), /prepared_run_id="\$SERVER_RUN_ID" -f prepared_run_attempt="\$SERVER_ATTEMPT"/);
});

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/release/verify-contract-ci.sh");
const sha = "a".repeat(40);
const repo = "ayers-software-repair/openwork";
const goodRun = {
  id: 41, head_sha: sha, event: "push", head_branch: "howland",
  path: ".github/workflows/contract.yml", head_repository: { full_name: repo },
  status: "completed", conclusion: "success",
};
const goodJobs = { total_count: 1, jobs: [{ name: "contract", status: "completed", conclusion: "success" }] };

function check(runs, jobs = goodJobs, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "howland-contract-ci-"));
  try {
    writeFileSync(join(dir, "runs.json"), JSON.stringify({ workflow_runs: runs }));
    writeFileSync(join(dir, "jobs.json"), JSON.stringify(jobs));
    writeFileSync(join(dir, "git"), `#!/bin/sh
case "$1 $2" in
  "rev-parse HEAD") printf '%s\\n' "$FAKE_HEAD" ;;
  "ls-remote --exit-code"*)
    if [ "$FAKE_TAG_ERROR" = true ]; then exit 128; fi
    if [ "$FAKE_TAG_EXISTS" = true ]; then
      printf '%s\\trefs/tags/%s\\n' "$FAKE_TAG_OBJECT" "$SELECTED_TAG"
      if [ "$FAKE_TAG_ANNOTATED" = true ]; then printf '%s\\trefs/tags/%s^{}\\n' "$FAKE_TAG_SHA" "$SELECTED_TAG"; fi
    else exit 2; fi ;;
  "rev-parse refs/tags/"*) printf '%s\\n' "$FAKE_TAG_SHA" ;;
  *) exit 3 ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(dir, "gh"), `#!/bin/sh\ncase "$2" in\n  */workflows/contract.yml/runs?*) cat "$FAKE_RUNS" ;;\n  */runs/*/jobs?*) cat "$FAKE_JOBS" ;;\n  *) exit 3 ;;\nesac\n`, { mode: 0o755 });
    return spawnSync("bash", [script], {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_TOKEN: "fake",
        GITHUB_REPOSITORY: repo, GITHUB_SHA: sha,
        SELECTED_TAG: options.tag ?? "howland-v1.0.1-rc.1",
        GITHUB_REF_TYPE: options.refType ?? "branch", GITHUB_REF_NAME: options.refName ?? "main",
        FAKE_HEAD: options.head ?? sha, FAKE_TAG_EXISTS: String(options.tagExists ?? false),
        FAKE_TAG_SHA: options.tagSha ?? sha, FAKE_TAG_OBJECT: options.tagObject ?? options.tagSha ?? sha,
        FAKE_TAG_ANNOTATED: String(options.annotated ?? false),
        FAKE_TAG_ERROR: String(options.tagError ?? false),
        FAKE_RUNS: join(dir, "runs.json"), FAKE_JOBS: join(dir, "jobs.json") },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the exact successful howland push and every completed contract job admit preparation", () => {
  const result = check([goodRun]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /run 41/);
});

test("missing, foreign, unfinished, and failed source runs refuse", () => {
  for (const runs of [[], [{ ...goodRun, head_sha: "b".repeat(40) }],
    [{ ...goodRun, head_branch: "main" }], [{ ...goodRun, event: "pull_request" }],
    [{ ...goodRun, status: "in_progress", conclusion: null }],
    [{ ...goodRun, conclusion: "failure" }],
    [goodRun, { ...goodRun, id: 42, conclusion: "failure" }]]) {
    assert.notEqual(check(runs).status, 0, JSON.stringify(runs));
  }
});

test("missing, incomplete, or failed contract jobs refuse", () => {
  for (const jobs of [{ total_count: 0, jobs: [] },
    { total_count: 2, jobs: goodJobs.jobs },
    { total_count: 1, jobs: [{ ...goodJobs.jobs[0], conclusion: "failure" }] },
    { total_count: 1, jobs: [{ ...goodJobs.jobs[0], status: "in_progress" }] }]) {
    assert.notEqual(check([goodRun], jobs).status, 0, JSON.stringify(jobs));
  }
});

test("every source preparation and publication checks exact-source contract proof", () => {
  const desktop = workflowWithoutComments("release.yml");
  const bundle = workflowWithoutComments("store-bundle.yml");
  const jobs = [
    section(desktop, "  preflight:", "  build-"),
    section(desktop, "  prepared-source:", "  publish-release:"),
    section(workflowWithoutComments("ios-submission.yml"), "  build-ios:", "  prepared-ios:"),
    section(bundle, "  prepare:", "  verified-bundle:"),
    section(bundle, "  verified-bundle:", "  store-release:"),
  ];
  for (const body of jobs) {
    const gate = body.indexOf("bash scripts/release/verify-contract-ci.sh");
    assert.ok(gate > 0);
    assert.match(body.slice(0, gate), /GH_TOKEN: \$\{\{ github\.token \}\}/);
  }
  assert.ok(jobs[0].indexOf("verify-contract-ci.sh") < jobs[0].indexOf("name: The declaration agrees"));
  assert.ok(jobs[2].indexOf("verify-contract-ci.sh") < jobs[2].indexOf("name: Require the iOS signing secrets"));
});


test("contract proof binds checked-out source and selected tag before accepting old green CI", () => {
  assert.notEqual(check([goodRun], goodJobs, { head: "b".repeat(40) }).status, 0);
  assert.notEqual(check([goodRun], goodJobs, { tagExists: true, tagSha: "b".repeat(40) }).status, 0);
  assert.notEqual(check([goodRun], goodJobs, { refType: "tag", refName: "howland-v1.0.0" }).status, 0);
});

test("an old successful contract run cannot mask the latest failed run", () => {
  const oldGreen = { ...goodRun, id: 40 };
  const latestFailed = { ...goodRun, id: 41, conclusion: "failure" };
  assert.notEqual(check([oldGreen, latestFailed]).status, 0);
});


test("a matching existing lightweight or annotated selected tag binds this checkout", () => {
  assert.equal(check([goodRun], goodJobs, { tagExists: true }).status, 0);
  assert.equal(check([goodRun], goodJobs, {
    tagExists: true, annotated: true, tagObject: "b".repeat(40), tagSha: sha,
  }).status, 0);
});

test("selected tag lookup failure cannot be mistaken for a fresh tag", () => {
  assert.notEqual(check([goodRun], goodJobs, { tagError: true }).status, 0);
});
