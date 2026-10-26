// The desktop publisher shares a public release with the separately prepared server. Its
// chained path must reject a bad server receipt before changing any desktop assets.
import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowWithoutComments, section } from "./workflow-text.mjs";

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
