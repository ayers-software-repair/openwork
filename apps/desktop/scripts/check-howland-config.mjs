// Copyright Ayers Electronics Inc. All rights reserved.
//
// Does the config the release actually packages with register BOTH url schemes?
//
// This exists because the answer was no, silently, in a shipped build. The desktop main process asks
// Electron to register howland:// alongside openwork:// so that links already in the wild keep
// working, but an override that REPLACED upstream's protocols block left only howland:// in the
// packaged config. Neither platform that reads the field can repair it at runtime: macOS fixes its
// Info.plist at build time, and Linux writes the MimeType from this config. Windows never reads the
// field at all, so its runtime registration masked the defect on the one platform that still worked.
//
// It asserts the MERGED config, which is the only thing that answers the question. Reading the
// override file alone cannot: the Howland scheme is added by list concatenation during the merge, so
// the file on disk names one scheme while the packaged config must carry two.
//
// Run from apps/desktop. Exits non-zero with the reason on any failure, so a workflow can gate on it
// without reading the output.

import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// app-builder-lib holds the config loader but is a TRANSITIVE dependency, and pnpm does not hoist
// those, so importing it by bare name fails here. Resolving it through electron-builder - a declared
// dependency of this package - reaches the exact copy the build itself loads, which is the copy whose
// merge behaviour this script is asserting. A hoisted or separately installed one could differ.
const fromHere = createRequire(import.meta.url);
const fromElectronBuilder = createRequire(fromHere.resolve("electron-builder"));
const { getConfig } = fromElectronBuilder("app-builder-lib/out/util/config/config.js");

const CONFIG = "electron-builder.howland.yml";
const REQUIRED = ["openwork", "howland"];

const cfg = await getConfig(process.cwd(), CONFIG, null);
const protocols = cfg.protocols ?? [];
const schemes = protocols.flatMap((p) => p.schemes ?? []);

console.log(`${CONFIG} merged with its parent:`);
console.log(JSON.stringify(protocols, null, 2));
console.log(`schemes: ${schemes.join(", ") || "(none)"}`);

const missing = REQUIRED.filter((s) => !schemes.includes(s));
if (missing.length > 0) {
  console.error(
    `the packaged config does not register ${missing.join(" or ")}. ` +
      `Every scheme in ${REQUIRED.join(" and ")} must survive the merge: a dropped one breaks every ` +
      `link of that form already in circulation, on macOS and Linux, with no runtime fallback.`,
  );
  process.exit(1);
}

// The parent must still be reaching us. Without this, an override that silently stopped extending
// anything would pass as long as it named both schemes itself, and every other upstream setting
// would have quietly vanished from the build.
for (const [key, value] of Object.entries({ appId: cfg.appId, afterPack: cfg.afterPack })) {
  if (value == null) {
    console.error(`${key} is absent from the merged config, so the parent config is not being read.`);
    process.exit(1);
  }
}

// The embedded server loads better-sqlite3 in Electron's main process, so the packaged copy must be
// rebuilt for Electron's ABI. With npmRebuild off it keeps the host Node build and fails to load.
if (cfg.npmRebuild !== true) {
  console.error("npmRebuild is not true, so native modules ship built for Node rather than Electron.");
  process.exit(1);
}

// The licence notices must ship on every target. electron-builder only warns when an extraResources
// source is missing and builds without it, so each source is checked here as well.
const LICENCES = ["licenses/NOTICE.txt", "licenses/LICENSE.openwork.txt", "licenses/LICENSE.opencode.txt"];
for (const to of LICENCES) {
  const entry = (cfg.extraResources ?? []).find((e) => typeof e === "object" && e.to === to);
  if (entry == null) {
    console.error(`no root extraResources entry ships ${to}.`);
    process.exit(1);
  }
  if (!statSync(resolve(entry.from), { throwIfNoEntry: false })?.isFile()) {
    console.error(`${to} comes from ${entry.from}, which is not a file.`);
    process.exit(1);
  }
}

console.log("both schemes present; parent config still merging; native rebuild on; licence notices packed.");
