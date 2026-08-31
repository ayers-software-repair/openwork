// The release train's artifact contract, for the fork's two workflows.
//
// ONE RELEASE TRAIN: this fork and ../howland publish onto the same howland-v<version> release
// on howland-releases, and the site's latest/download links, the tray updater and the bundle
// command all resolve against that single asset set. A name that drifts anywhere ships a dead
// link.
//
// packaging/platforms.json says what this fork builds; this file holds the workflows to it IN
// BOTH DIRECTIONS. The direction that matters is workflow -> declaration: a repo that builds
// something its own declaration does not know about is the failure a list cannot detect and a
// matrix can.
//
// node --test, no dependencies and no pnpm install: the contract must be checkable without
// standing the workspace up, because the cheapest check is the one that actually gets run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");

const declaration = JSON.parse(readFileSync(path.join(here, "platforms.json"), "utf8"));

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
function workflowWithoutComments(name) {
  const raw = readFileSync(path.join(repo, ".github", "workflows", name), "utf8");
  return raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

// THE INTERPOLATION IS EXPANDED BEFORE MATCHING, NOT MATCHED AROUND (howland's parser law, from
// two bugs it paid for): a bare prefix pattern truncates `...-${{ matrix.arch }}.dmg` at the "-",
// and widening the extension terminates on the DOT INSIDE `matrix.arch`. Expanding first makes the
// text ordinary and the pattern simple, which is the fix rather than a third escape.
function expanded(text, arch) {
  return text.replaceAll(/\$\{\{[^}]*\}\}/g, arch);
}

function section(text, startsWith, endsWith) {
  const from = text.indexOf(startsWith);
  assert.notEqual(from, -1, `no ${JSON.stringify(startsWith)} in the workflow — this parser is not reading the step it names`);
  const rest = text.slice(from + startsWith.length);
  const to = rest.indexOf(endsWith);
  return to === -1 ? rest : rest.slice(0, to);
}

// The release-page set, read from the reconcile step's own EXPECTED composition. That list became
// composed rather than a static here-string when selective builds landed, so this parses the
// union: every name the workflow can expect when every head is selected. It is the workflow's
// authoritative statement of what it owes a release, and it is checked name-by-name at run time
// by the workflow itself.
//
// THE EXTENSION IS DELIBERATELY NOT AN ALLOWLIST and there is NO Howland- PREFIX ANCHOR. Six of
// these twenty assets are electron-updater feeds -- latest.yml, latest-arm64.yml, latest-mac.yml,
// latest-mac-x64.yml, latest-linux.yml, latest-linux-arm64.yml -- whose filenames ARE the
// protocol request. howland's server parser anchors on `Howland-Server-` because every server
// asset carries it; ported unchanged, that anchor drops 30% of this train silently and the
// comparison still passes.
function releaseAssets() {
  const wf = workflowWithoutComments("release.yml");
  const step = section(wf, "- name: Reconcile against the expected assets", "GITHUB_STEP_SUMMARY");
  const names = new Set();
  for (const arch of ["x64", "arm64"]) {
    for (const line of expanded(step, arch).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('EXPECTED="$EXPECTED ')) continue;
      const rest = trimmed.slice('EXPECTED="$EXPECTED '.length).replace(/"$/, "");
      for (const n of rest.split(/\s+/)) if (n) names.add(n);
    }
  }
  return names;
}

// The unsigned Android twin has its own NAME, unlike the desktop twins which are separated from
// their signed selves by artifact path. Read from the staging step that creates it.
function artifactOnlyAssets() {
  const wf = workflowWithoutComments("release.yml");
  const step = section(wf, "- name: Stage unsigned Android artifact", "- name: Upload unsigned Android artifact");
  const names = new Set(step.match(/Howland-[A-Za-z0-9.-]+\.[A-Za-z][A-Za-z0-9]{1,9}\b/g) ?? []);
  return names;
}

// The store head, in its own workflow on its own dispatch. Its .ipa is never a release asset.
function storeAssets() {
  const wf = workflowWithoutComments("ios-submission.yml");
  const names = new Set(wf.match(/Howland-[A-Za-z0-9.-]+\.ipa\b/g) ?? []);
  return names;
}

// THE CANNOT-FAIL CONTROL, PER FAMILY RATHER THAN PER COUNT.
//
// howland's control is `len(built) < 5` against a nine-asset train. Ported as a number to a
// twenty-asset train it passes on three parsed names, so a parser that found only the mobile
// family would satisfy it and every comparison below would run against a set missing seventeen
// assets. A COUNT CONTROL SATISFIABLE BY ONE FAMILY IS A CHECK THAT FINDS PROSE WEARING A NEW HAT.
// Each family is asserted present by a predicate that only its own members can satisfy.
const families = {
  "desktop installer": (n) => /^Howland-Desktop-(macOS|Windows|Linux)-/.test(n),
  "updater metadata": (n) => /^latest[a-z0-9-]*\.yml$/.test(n),
  "mobile client": (n) => /^Howland-Client-Android/.test(n),
  "checksum manifest": (n) => /-CHECKSUMS\.txt$/.test(n),
};

test("the parser reads every family out of release.yml, not just one", () => {
  const built = releaseAssets();
  for (const [family, matches] of Object.entries(families)) {
    assert.ok(
      [...built].some(matches),
      `no ${family} parsed out of release.yml's EXPECTED composition — the workflow moved and ` +
        `this parser did not, so every comparison against it is against a set missing that family`,
    );
  }
  assert.ok(
    built.size >= 20,
    `parsed ${built.size} names from release.yml, expected at least 20 — the reconcile step is ` +
      `no longer being read whole`,
  );
});

test("the declaration and the workflows agree, in both directions", () => {
  const built = new Map();
  for (const n of releaseAssets()) built.set(n, "release");
  for (const n of artifactOnlyAssets()) built.set(n, "artifact");
  for (const n of storeAssets()) built.set(n, "store");

  assert.ok(built.size >= 22, `parsed ${built.size} names across both workflows, expected at least 22`);

  const declared = new Map(declaration.assets.map((a) => [a.name, a]));
  assert.ok(declared.size >= 22, `platforms.json declares ${declared.size} assets — too few to be the train`);

  for (const [name, asset] of declared) {
    assert.ok(
      built.has(name),
      `platforms.json declares ${name} and no workflow ever names it — the declaration claims an ` +
        `asset nothing builds`,
    );
    assert.equal(
      asset.channel,
      built.get(name),
      `platforms.json puts ${name} on the ${asset.channel} channel; the workflows put it on ` +
        `${built.get(name)}`,
    );
    // An unpublished asset must say why. "Not on the release page" with no reason is the state
    // that reads as an oversight and gets silently 'fixed' by someone re-adding it -- which for
    // the .ipa means publishing a signed store binary to a public download page.
    if (!asset.published) {
      assert.ok(
        (asset.why ?? "").trim() !== "",
        `${name} is declared unpublished with no reason — an absence with no cause is ` +
          `indistinguishable from a mistake`,
      );
    }
  }

  // THE DIRECTION THAT MATTERS.
  for (const name of built.keys()) {
    assert.ok(
      declared.has(name),
      `the workflows name ${name} and platforms.json does not declare it — the fork builds ` +
        `something its own declaration does not know about`,
    );
  }
});

test("a store-channel asset is never declared published", () => {
  for (const a of declaration.assets) {
    if (a.channel === "store" || a.channel === "artifact") {
      assert.equal(
        a.published,
        false,
        `${a.name} is on the ${a.channel} channel and declared published — that channel never ` +
          `reaches the release page`,
      );
    }
  }
});

test("every planned row names a reason and is not already built", () => {
  const built = new Set([...releaseAssets(), ...artifactOnlyAssets(), ...storeAssets()]);
  for (const p of declaration.planned ?? []) {
    assert.ok((p.why ?? "").trim() !== "", `planned ${p.name} records no reason it does not exist`);
    assert.ok(!built.has(p.name), `${p.name} is declared planned and the workflows build it`);
  }
});

// The grammar, and the exceptions to it. Owner ruling 2026-08-24 ("everything should work the
// same"), agreed asset-by-asset with magpie before any rename:
//
//	<Product>-<Component>-<Platform>-<Arch>.<ext>
//
// Arch is EXPLICIT even where only one build exists today — a name whose shape depends on how many
// builds exist that day silently renames itself the moment a second arch lands, breaking every
// link that ever pointed at it. Kept identical to howland's known-word sets: the component,
// platform and arch must be KNOWN WORDS, not merely three hyphen-separated tokens, so
// Howland-Sever-Linux-x64.deb fails.
const grammarComponents = new Set(["Server", "Desktop", "Client"]);
const grammarPlatforms = new Set(["macOS", "Windows", "Linux", "Android", "iOS"]);
const grammarArches = new Set(["x64", "arm64"]);

// Each exception carries the reason it is one; an undocumented exception is drift.
const grammarExceptions = {
  "Howland-Desktop-CHECKSUMS.txt": "release metadata: names its component, has no platform or arch.",
  "Howland-Client-CHECKSUMS.txt": "release metadata: names its component, has no platform or arch.",
  "Howland-Client-Android.apk": "one fat apk carries every ABI, so there is no arch to name.",
  "Howland-Client-Android.aab": "Play splits per device; arch is not applicable.",
  "Howland-Client-Android-debug.apk":
    "the unsigned twin. It takes the arch slot with a BUILD TYPE deliberately: it is not a fourth " +
    "architecture and must never be mistaken for the sideload asset, so it reads wrong to a human " +
    "on purpose. It never reaches the page, where a name that misparses would matter.",
  "latest-mac.yml":
    "electron-updater fetches <channel>.yml BY PROTOCOL — the filename is the request, not a " +
    "label, and only the updater ever reads it.",
  "latest-mac-x64.yml": "see latest-mac.yml.",
  "latest.yml": "see latest-mac.yml.",
  "latest-arm64.yml": "see latest-mac.yml.",
  "latest-linux.yml": "see latest-mac.yml.",
  "latest-linux-arm64.yml": "see latest-mac.yml.",
};

test("every declared name parses as the grammar or is a documented exception", () => {
  const re = /^Howland-([A-Za-z]+)-([A-Za-z]+)-([A-Za-z0-9]+)\.[A-Za-z0-9.]+$/;
  for (const a of declaration.assets) {
    const reason = grammarExceptions[a.name];
    if (reason !== undefined) {
      assert.notEqual(reason.trim(), "", `${a.name} is an exception with no reason recorded`);
      continue;
    }
    const m = re.exec(a.name);
    assert.ok(
      m,
      `${a.name} does not parse as <Product>-<Component>-<Platform>-<Arch>.<ext> and is not a ` +
        `documented exception`,
    );
    assert.ok(grammarComponents.has(m[1]), `${a.name} names an unknown component ${m[1]}`);
    assert.ok(grammarPlatforms.has(m[2]), `${a.name} names an unknown platform ${m[2]}`);
    assert.ok(grammarArches.has(m[3]), `${a.name} names an unknown arch ${m[3]}`);
  }
});
