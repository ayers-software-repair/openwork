#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const [distRootArg, expectedCountArg = "6"] = process.argv.slice(2);

if (!distRootArg || !/^\d+$/.test(expectedCountArg)) {
  console.error("Usage: node scripts/release/refresh-signed-windows-artifacts.mjs <dist-root> [expected-installer-count]");
  process.exit(2);
}

const distRoot = resolve(distRootArg);
const expectedCount = Number(expectedCountArg);
const desktopRequire = createRequire(new URL("../../apps/desktop/package.json", import.meta.url));
const electronBuilderRequire = createRequire(desktopRequire.resolve("electron-builder/package.json"));
const { buildBlockMap } = electronBuilderRequire("app-builder-lib/out/targets/blockmap/blockmap.js");
const YAML = desktopRequire("yaml");

function walk(dir) {
  const entries = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...walk(path));
    else if (stat.isFile()) entries.push(path);
  }
  return entries;
}

function sha512(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

async function regenerateBlockmap(installerPath) {
  const blockmapPath = `${installerPath}.blockmap`;
  mkdirSync(dirname(blockmapPath), { recursive: true });
  await buildBlockMap(installerPath, "gzip", blockmapPath);
  if (!existsSync(blockmapPath)) {
    throw new Error(`electron-builder did not create ${blockmapPath}`);
  }
}

function manifestName(installerName) {
  if (installerName === "Howland-Desktop-Windows-x64.exe") return "latest.yml";
  if (installerName === "Howland-Desktop-Windows-arm64.exe") return "latest-arm64.yml";
  if (installerName.startsWith("openwork-cloud-win-")) return "cloud.yml";
  if (installerName.startsWith("openwork-enterprise-win-")) return "enterprise.yml";
  if (installerName.startsWith("openwork-win-")) return "latest.yml";
  throw new Error(`Unsupported Windows installer name: ${installerName}`);
}

function manifestEntryMatches(installerName, url) {
  if (url === installerName) return true;
  if (installerName === "Howland-Desktop-Windows-x64.exe") {
    return /^howland-win-x64-.+\.exe$/i.test(url);
  }
  if (installerName === "Howland-Desktop-Windows-arm64.exe") {
    return /^howland-win-arm64-.+\.exe$/i.test(url);
  }
  return false;
}

function updateManifest(installerPath) {
  const installerName = basename(installerPath);
  const manifestPath = join(dirname(installerPath), manifestName(installerName));
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing Windows updater manifest for ${installerName}: ${manifestPath}`);
  }

  const installerSha512 = sha512(installerPath);
  const installerSize = statSync(installerPath).size;
  const manifest = YAML.parse(readFileSync(manifestPath, "utf8"));

  if (!manifest || !Array.isArray(manifest.files)) {
    throw new Error(`Invalid Windows updater manifest: ${manifestPath}`);
  }

  let matchedFiles = 0;
  manifest.files = manifest.files.map((file) => {
    if (!file || !manifestEntryMatches(installerName, file.url)) return file;
    matchedFiles += 1;
    return { ...file, url: installerName, sha512: installerSha512, size: installerSize };
  });

  if (matchedFiles !== 1) {
    throw new Error(
      `Manifest ${manifestPath} references ${matchedFiles} entries for signed installer ${installerName}; expected exactly one`,
    );
  }

  manifest.path = installerName;
  manifest.sha512 = installerSha512;
  writeFileSync(manifestPath, YAML.stringify(manifest), "utf8");
}

if (!existsSync(distRoot)) {
  console.error(`Windows artifact directory does not exist: ${distRoot}`);
  process.exit(1);
}

const installers = walk(distRoot).filter((file) =>
  /^(?:openwork(?:-(?:cloud|enterprise))?-win-(?:x64|arm64)-.+|Howland-Desktop-Windows-(?:x64|arm64))\.exe$/i.test(
    basename(file),
  ),
);

if (installers.length !== expectedCount) {
  console.error(`Expected exactly ${expectedCount} signed Windows installers, found ${installers.length}.`);
  for (const installer of installers) console.error(`- ${installer}`);
  process.exit(1);
}

for (const installer of installers.sort()) {
  await regenerateBlockmap(installer);
  updateManifest(installer);
  console.log(`Refreshed signed Windows artifact metadata: ${installer}`);
}
