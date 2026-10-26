// Store packages are retained by their build runs. A later bundle verifies each exact source
// receipt and passes those bytes to the shared uploader only on explicit store dispatch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { workflowWithoutComments, section } from "./workflow-text.mjs";

test("Android retains signed AAB and APK, while unsigned builds stay private", () => {
  const job = section(workflowWithoutComments("release.yml"), "  build-android:", "  release:");
  assert.match(job, /name: Build Android \(signed APK \+ AAB\)\n {8}if: \$\{\{ env\.CAN_SHIP == 'true' \}\}/);
  assert.match(job, /name: Upload Android store packages\n {8}if: \$\{\{ env\.CAN_SHIP == 'true' \}\}/);
  assert.match(job, /name: store-android\n/);
  assert.match(job, /store-android\/Howland-Client-Android\.aab/);
  assert.match(job, /store-android\/Howland-Client-Android\.apk/);
  assert.match(job, /name: Build Android \(unsigned, debug-signed APK\)\n {8}if: \$\{\{ env\.CAN_SHIP != 'true' \}\}/);
  assert.match(job, /name: unsigned-android/);
  assert.doesNotMatch(job, /actions\/play-upload|Upload to Google Play/);
  assert.doesNotMatch(job, /PLAY_SERVICE_ACCOUNT_JSON|serviceAccountJson/);
});

test("iOS signing produces a private exact IPA receipt; compile proof submits nothing", () => {
  const wf = workflowWithoutComments("ios-submission.yml");
  assert.match(wf, /name: Require the iOS signing secrets\n {8}if: \$\{\{ !inputs\.compile_proof \}\}/);
  assert.match(wf, /name: Compile proof \(signing disabled\)\n {8}if: \$\{\{ inputs\.compile_proof \}\}/);
  const artifact = wf.indexOf("name: Upload the submission binary");
  const receipt = wf.indexOf("  prepared-ios:");
  assert.ok(artifact >= 0 && artifact < receipt);
  assert.match(wf.slice(artifact, receipt), /name: Howland-Client-iOS-arm64\.ipa/);
  assert.match(wf.slice(receipt), /inputs\.compile_proof != true/);
  assert.match(wf.slice(receipt), /requiredFiles:\["Howland-Client-iOS-arm64\.ipa","build\.json"\]/);
  assert.match(wf.slice(receipt), /prepared-release\.mjs write/);
  assert.match(wf.slice(receipt), /sparse-checkout: codestyle\/ci\/release\//);
  assert.doesNotMatch(wf, /actions\/app-store-upload|Upload to App Store Connect/);
});

test("store bundle verifies both exact source receipts before shared store submission", () => {
  const wf = workflowWithoutComments("store-bundle.yml");
  const prepare = section(wf, "  prepare:", "  verified-bundle:");
  const verified = section(wf, "  verified-bundle:", "  store-release:");
  const shared = section(wf, "  store-release:", "  stop-after-");
  assert.match(prepare, /desktop_android_run_id/);
  assert.match(prepare, /ios_run_id/);
  assert.match(prepare, /--arg sha "\$GITHUB_SHA" --arg version "\$RC_VERSION"/);
  assert.equal((prepare.match(/prepared-release\.mjs verify/g) ?? []).length, 2);
  assert.match(prepare, /git\/ref\/tags\/howland-v\$RC_VERSION/);
  assert.match(prepare, /if \$run.event == "push" then \{tagPrefix:"howland-v"\} else \{\} end/);
  assert.match(prepare, /--arg refSha "\$ref_sha"/);
  assert.match(prepare, /sparse-checkout: codestyle\/ci\/release\//);
  assert.match(prepare, /source-desktop\/android\/Howland-Client-Android\.aab/);
  assert.match(prepare, /source-ios\/Howland-Client-iOS-arm64\.ipa/);
  assert.match(prepare, /androidBuild:\$android\[0\]\.androidBuild/);
  assert.match(prepare, /iosBuild:\$apple\[0\]\.iosBuild/);
  assert.match(verified, /name: Verify completed RC bundle, exact source and member bytes/);
  assert.match(verified, /prepared-release\.mjs verify/);
  assert.match(verified, /PLAY_ENABLED: \$\{\{ vars\.PLAY_SUBMISSION_ENABLED \}\}/);
  assert.match(verified, /APPLE_ENABLED: \$\{\{ vars\.APPLE_SUBMISSION_ENABLED \}\}/);
  assert.match(verified, /AMAZON_ENABLED: \$\{\{ vars\.AMAZON_SUBMISSION_ENABLED \}\}/);
  assert.match(verified, /with_entries\(select\(\.value \| length > 0\)\)/);
  assert.match(verified, /\} >> "\$GITHUB_OUTPUT"/);
  assert.match(verified, /sparse-checkout: codestyle\/ci\/release\//);
  assert.match(shared, /needs\.verified-bundle\.outputs\.enabled == 'true'/);
  assert.match(shared, /uses: ayers-software-repair\/platform\/\.github\/workflows\/store-release\.yml@v0\.73\.0/);
  assert.match(shared, /artifact-run-id: \$\{\{ inputs\.bundle_run_id \}\}/);
  assert.match(shared, /source-run-id: \$\{\{ inputs\.bundle_run_id \}\}/);
});

// Use the workflow's jq program, not a second hand-written stores object. Every vendor
// combination must survive the shared planner's nonempty-list contract.
test("store targets contain exactly the enabled vendors across all eight combinations", () => {
  const verified = section(workflowWithoutComments("store-bundle.yml"), "  verified-bundle:", "  store-release:");
  const line = verified.split("\n").find((item) => item.trim().startsWith("'{play:"));
  assert.ok(line, "the workflow's jq store-target expression moved");
  const expression = line.trim().match(/^'(.*)' \\$/)?.[1];
  assert.ok(expression, "the jq expression must be passed whole to jq");
  const ids = {
    provider: "projects/42/locations/global/workloadIdentityPools/ci/providers/github",
    service: "play@example.invalid",
    apple: "123456789",
    amazon: "amzn1.example.howland",
    apk: "amzn1.example.apk",
  };
  for (let mask = 0; mask < 8; mask++) {
    const on = (bit) => (mask & bit ? "true" : "false");
    const actual = JSON.parse(execFileSync("jq", [
      "-cn", "--arg", "play", on(1), "--arg", "apple", on(2), "--arg", "amazon", on(4),
      "--arg", "provider", ids.provider, "--arg", "service", ids.service,
      "--arg", "appid", ids.apple, "--arg", "amazonApp", ids.amazon,
      "--arg", "amazonApk", ids.apk, expression,
    ], { encoding: "utf8" }));
    const expected = [mask & 1 && "play", mask & 2 && "apple", mask & 4 && "amazon"].filter(Boolean);
    assert.deepEqual(Object.keys(actual).sort(), expected.sort(), `enabled mask ${mask}`);
    for (const targets of Object.values(actual)) assert.equal(targets.length, 1, `mask ${mask} emitted an empty list`);
    if (actual.play) {
      assert.equal(actual.play[0].package, "repair.ayers.howland");
      assert.equal(actual.play[0]["workload-identity-provider"], ids.provider);
      assert.equal(actual.play[0]["service-account"], ids.service);
      assert.deepEqual(actual.play[0].tracks, ["production"]);
    }
    if (actual.apple) {
      assert.equal(actual.apple[0].platform, "IOS");
      assert.equal(actual.apple[0]["app-id"], ids.apple);
    }
    if (actual.amazon) {
      assert.equal(actual.amazon[0]["app-id"], ids.amazon);
      assert.equal(actual.amazon[0]["apk-id"], ids.apk);
    }
  }
});
