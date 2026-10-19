import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
const YAML = require("yaml");
const script = fileURLToPath(new URL("./refresh-signed-windows-artifacts.mjs", import.meta.url));

function sha512(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

function writeManifest(root, name, urls) {
  writeFileSync(
    join(root, name),
    YAML.stringify({
      version: "1.0.0",
      files: urls.map((url) => ({ url, sha512: "stale", size: 1 })),
      path: urls[0],
      sha512: "stale",
    }),
  );
}

function run(root, count) {
  const result = spawnSync(process.execPath, [script, root, String(count)], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
}

function assertRefreshed(root, installerName, manifestName) {
  const installer = join(root, installerName);
  const manifest = YAML.parse(readFileSync(join(root, manifestName), "utf8"));
  const file = manifest.files.find((entry) => entry.url === installerName);
  assert.ok(file, `${manifestName} does not name ${installerName}`);
  assert.equal(file.sha512, sha512(installer));
  assert.equal(file.size, statSync(installer).size);
  assert.equal(manifest.path, installerName);
  assert.equal(manifest.sha512, file.sha512);
  assert.ok(statSync(`${installer}.blockmap`).size > 0);
}

test("refreshes stable Howland installers after their final signed bytes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "howland-signed-windows-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "Howland-Desktop-Windows-x64.exe"), "signed-x64");
  writeFileSync(join(root, "Howland-Desktop-Windows-arm64.exe"), "signed-arm64");
  writeManifest(root, "latest.yml", ["howland-win-x64-1.0.0.exe"]);
  writeManifest(root, "latest-arm64.yml", ["howland-win-arm64-1.0.0.exe"]);

  run(root, 2);

  assertRefreshed(root, "Howland-Desktop-Windows-x64.exe", "latest.yml");
  assertRefreshed(root, "Howland-Desktop-Windows-arm64.exe", "latest-arm64.yml");
});

test("keeps the upstream OpenWork installer contracts", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openwork-signed-windows-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixtures = [
    ["openwork-win-x64-0.18.57.exe", "latest.yml"],
    ["openwork-cloud-win-x64-0.18.57.exe", "cloud.yml"],
    ["openwork-enterprise-win-arm64-0.18.57.exe", "enterprise.yml"],
  ];
  for (const [installerName, manifestName] of fixtures) {
    writeFileSync(join(root, installerName), installerName);
    writeManifest(root, manifestName, [installerName]);
  }

  run(root, fixtures.length);

  for (const [installerName, manifestName] of fixtures) {
    assertRefreshed(root, installerName, manifestName);
  }
});
