// The store uploads: Play from release.yml's build-android leg and App Store Connect from
// ios-submission.yml, both through the platform kit's actions. Each private platform checkout and
// each upload runs only behind its own readiness gate, so a default run reads no platform key and
// uploads nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { workflowWithoutComments, section } from "./workflow-text.mjs";

const kit = "ayers-software-repair/platform";

test("build-android uploads the AAB to Play only when Play is configured and the leg signed", () => {
  const job = section(workflowWithoutComments("release.yml"), "  build-android:", "  release:");
  assert.match(job, /permissions:\n {6}contents: read\n {6}id-token: write\n/);
  assert.match(
    job,
    /PLAY_READY: \$\{\{ vars\.PLAY_SUBMISSION_ENABLED == 'true' && vars\.GCP_WORKLOAD_IDENTITY_PROVIDER != '' && vars\.GCP_PLAY_SERVICE_ACCOUNT != '' \}\}/,
  );
  assert.match(
    section(job, "- name: Reject incomplete Play upload configuration", "- name: Decide whether this leg can sign"),
    /if: \$\{\{ env\.PLAY_ENABLED == 'true' && env\.PLAY_READY != 'true' \}\}/,
  );
  const gate = "if: ${{ env.CAN_SHIP == 'true' && env.PLAY_READY == 'true' }}";
  const checkout = section(job, "- name: Check out the shared Play uploader", "- name: Upload to Google Play");
  assert.ok(checkout.includes(gate) && checkout.includes(`repository: ${kit}`), "the Play checkout is not gated");
  assert.match(checkout, /sparse-checkout: \|\n {12}codestyle\/ci\/actions\/play-upload\/\n/);
  const upload = section(job, "- name: Upload to Google Play (internal track)", "- name: Build Android (unsigned");
  assert.ok(upload.includes(gate), "the Play upload is not gated");
  for (const line of [
    "uses: ./_platform/codestyle/ci/actions/play-upload",
    "bundle: store-android/Howland-Client-Android.aab",
    "package-name: repair.ayers.howland",
    "track: internal",
    "enabled: ${{ env.PLAY_READY }}",
  ])
    assert.ok(upload.includes(line), line);
  assert.ok(job.indexOf("name: store-android") < job.indexOf("- name: Check out the shared Play uploader"));
  assert.doesNotMatch(job, /PLAY_SERVICE_ACCOUNT_JSON|serviceAccountJson/);
});

test("ios-submission uploads to App Store Connect only on a ready submit", () => {
  const wf = workflowWithoutComments("ios-submission.yml");
  assert.match(wf, /submit:\n {8}description: .*\n {8}type: boolean\n {8}default: false\n/);
  const ready = section(wf, "- name: Require App Store Connect submission readiness", "- name: Compute stamp version");
  assert.match(ready, /if: \$\{\{ inputs\.submit \}\}/);
  for (const piece of ["COMPILE_PROOF", "SUBMISSION_ENABLED", "ASC_KEY_PRESENT", "ASC_KEY_ID_PRESENT", "ASC_ISSUER_PRESENT"])
    assert.ok(ready.includes(`"$${piece}"`), piece);
  assert.match(ready, /echo "SUBMIT_READY=true" >> "\$GITHUB_ENV"/);
  assert.ok(wf.indexOf("Require App Store Connect submission readiness") < wf.indexOf("Build iOS archive (signed)"));
  const gate = "if: ${{ env.SUBMIT_READY == 'true' }}";
  const checkout = section(wf, "- name: Check out the shared App Store uploader", "- name: Upload to App Store Connect");
  assert.ok(checkout.includes(gate) && checkout.includes(`repository: ${kit}`), "the App Store checkout is not gated");
  const upload = section(wf, "- name: Upload to App Store Connect", "- name: Say what was produced");
  assert.ok(upload.includes(gate), "the App Store upload is not gated");
  for (const line of [
    "uses: ./_platform/codestyle/ci/actions/app-store-upload",
    "file: out/Howland-Client-iOS-arm64.ipa",
    "platform: ios",
    "key-p8: ${{ secrets.APP_STORE_CONNECT_KEY_P8 }}",
    "key-id: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}",
    "issuer-id: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}",
  ])
    assert.ok(upload.includes(line), line);
  assert.doesNotMatch(wf, /if:.*secrets\./, "secrets in an if: fails the whole run at startup");
});

test("both store uploads check the kit out at the same tag", () => {
  const tag = (name, step) =>
    section(workflowWithoutComments(name), `- name: Check out the shared ${step}`, "path: _platform").match(/ref: (v\d+\.\d+\.\d+)\n/)?.[1];
  const ios = tag("ios-submission.yml", "App Store uploader");
  assert.ok(ios, "ios-submission names no kit tag");
  assert.equal(tag("release.yml", "Play uploader"), ios);
});
