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
import { workflowWithoutComments, section } from "./workflow-text.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const declaration = JSON.parse(readFileSync(path.join(here, "platforms.json"), "utf8"));

// THE INTERPOLATION IS EXPANDED BEFORE MATCHING, NOT MATCHED AROUND (howland's parser law, from
// two bugs it paid for): a bare prefix pattern truncates `...-${{ matrix.arch }}.dmg` at the "-",
// and widening the extension terminates on the DOT INSIDE `matrix.arch`. Expanding first makes the
// text ordinary and the pattern simple, which is the fix rather than a third escape.
function expanded(text, arch) {
  return text.replaceAll(/\$\{\{[^}]*\}\}/g, arch);
}

// The release-page set, read from the reconcile step's own EXPECTED composition. That list became
// composed rather than a static here-string when selective builds landed, so this parses the
// union: every name the workflow can expect when every head is selected. It is the workflow's
// authoritative statement of what it owes a release, and it is checked name-by-name at run time
// by the workflow itself.
//
// THE EXTENSION IS DELIBERATELY NOT AN ALLOWLIST and there is NO Howland- PREFIX ANCHOR. Six of
// these nineteen assets are installers, Windows blockmaps and electron-updater feeds --
// latest.yml, latest-arm64.yml,
// latest-mac.yml, latest-x64-mac.yml, latest-linux.yml, latest-linux-arm64.yml -- whose filenames
// ARE the protocol request. howland's server parser anchors on `Howland-Server-` because every
// server asset carries it; ported unchanged, that anchor drops a third of this train silently and
// the comparison still passes.
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
  // TWO STORES, TWO WORKFLOWS. This read ios-submission.yml only and matched only .ipa, which
  // made "store channel" a synonym for "iOS" — so a Windows Store package could be declared,
  // built and renamed and the contract would still report that no workflow names it. The channel
  // is a DESTINATION, not a platform, and the parser has to know every workflow that reaches it.
  const names = new Set();
  for (const m of workflowWithoutComments("ios-submission.yml").match(/Howland-[A-Za-z0-9.-]+\.ipa\b/g) ?? []) {
    names.add(m);
  }
  // .appx is built on the desktop leg in release.yml and collected as an Actions artifact only.
  // take() globs by extension and no glob names .appx, so it cannot reach the release directory.
  const wf = workflowWithoutComments("release.yml");
  for (const m of wf.match(/Howland-[A-Za-z0-9.-]+\.appx\b/g) ?? []) {
    names.add(m);
  }
  // The Android store packages, read from the step that stages them for submission.
  const android = section(wf, "- name: Stage Android store packages", "- name: Upload Android store packages");
  for (const m of android.match(/Howland-[A-Za-z0-9.-]+\.(apk|aab)\b/g) ?? []) {
    names.add(m);
  }
  return names;
}

// THE CANNOT-FAIL CONTROL, PER FAMILY RATHER THAN PER COUNT.
//
// howland's control is `len(built) < 5` against a nine-asset train. Ported as a number to a
// seventeen-asset train it passes on five parsed names, so a parser that found only the updater
// feeds would satisfy it and every comparison below would run against a set missing eleven
// assets. A COUNT CONTROL SATISFIABLE BY ONE FAMILY IS A CHECK THAT FINDS PROSE WEARING A NEW HAT.
// Each family is asserted present by a predicate that only its own members can satisfy.
const families = {
  "desktop installer": (n) => /^Howland-Desktop-(macOS|Windows|Linux)-/.test(n),
  "updater metadata": (n) => /^latest[a-z0-9-]*\.yml$/.test(n),
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
    built.size >= 19,
    `parsed ${built.size} names from release.yml, expected at least 19 — the reconcile step is ` +
      `no longer being read whole`,
  );
  assert.ok(
    ![...built].some((n) => n.startsWith("Howland-Client-")),
    "a mobile client is on the release page — phones install from stores only (D1625)",
  );
});

test("the declaration and the workflows agree, in both directions", () => {
  const built = new Map();
  for (const n of releaseAssets()) built.set(n, "release");
  for (const n of artifactOnlyAssets()) built.set(n, "artifact");
  for (const n of storeAssets()) built.set(n, "store");

  assert.ok(built.size >= 24, `parsed ${built.size} names across both workflows, expected at least 24`);

  const declared = new Map(declaration.assets.map((a) => [a.name, a]));
  assert.ok(declared.size >= 24, `platforms.json declares ${declared.size} assets — too few to be the train`);

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

test("Windows signs owned payloads before wrapping and refreshes metadata after final signing", () => {
  const wf = workflowWithoutComments("release.yml");
  const job = section(wf, "  package-windows:", "  build-android:");
  const orderedSteps = [
    "- name: Test final Windows updater artifact refresh",
    "- name: Sign and verify the unpacked app and sidecars",
    "- name: Package NSIS and the Store-only AppX from the signed app",
    "- name: Sign and verify the final NSIS installer",
    "- name: Refresh the final Windows updater artifacts",
    "- name: Upload signed Windows installers",
  ];
  let previous = -1;
  for (const step of orderedSteps) {
    const at = job.indexOf(step);
    assert.ok(at > previous, `${step} is missing or out of order in package-windows`);
    previous = at;
  }

  assert.match(job, /runs-on: windows-latest/, "both architectures must package and sign on the supported x64 host");
  assert.match(job, /strategy:\n\s+fail-fast: true/, "a failed Windows signing leg must stop its matrix peer");
  assert.match(
    section(job, "- name: Test final Windows updater artifact refresh", "- name: Sign and verify the unpacked app and sidecars"),
    /node scripts\/release\/refresh-signed-windows-artifacts\.test\.mjs/,
    "the dependency-ready Windows job does not run the updater-artifact regression test",
  );
  assert.equal(
    (job.match(/uses: \.\/_platform\/codestyle\/ci\/actions\/windows-sign\n/g) ?? []).length,
    2,
    "the shared signer must handle the payload and the final NSIS installer",
  );
  for (const name of [
    "AZURE_CLIENT_ID",
    "AZURE_TENANT_ID",
    "AZURE_SUBSCRIPTION_ID",
    "AZURE_SIGNING_ENDPOINT",
    "AZURE_SIGNING_ACCOUNT",
    "AZURE_SIGNING_PROFILE",
  ]) {
    assert.match(job, new RegExp(`${name}:`), `package-windows does not expose ${name} to the shared contract`);
  }
  const partialGuard = job.indexOf("- name: Reject partial Windows signing configuration before private checkout");
  const privateCheckout = job.indexOf("- name: Check out the shared Windows signer");
  assert.ok(partialGuard !== -1 && partialGuard < privateCheckout, "partial signing config is not rejected before private checkout");
  assert.match(
    section(
      job,
      "- name: Reject partial Windows signing configuration before private checkout",
      "- name: Check out the shared Windows signer",
    ),
    /if: \$\{\{ env\.ANY_SIGN == 'true' && env\.SIGN != 'true' \}\}/,
    "the pre-check does not reject only the partial Azure-signing state",
  );
  assert.match(job, /ANY_SIGN:.*\|\|/, "package-windows does not distinguish an absent signing setup from a partial one");
  assert.match(
    section(job, "- name: Check out the shared Windows signer", "- name: Reject incomplete Windows signing configuration"),
    /if: \$\{\{ env\.SIGN == 'true' \}\}[\s\S]*PLATFORM_READ_KEY/,
    "an unsigned public-repository run can still require private platform access",
  );
  assert.match(
    section(job, "- name: Reject incomplete Windows signing configuration", "- name: Download the native unpacked app"),
    /if: \$\{\{ env\.SIGN == 'true' \}\}/,
    "the shared validator can run without its signed-path checkout",
  );
  assert.doesNotMatch(job, /WINDOWS_CERT|PFX_/, "the retired PFX path remains in package-windows");
  assert.match(job, /-c\.win\.signExecutable=false/, "electron-builder could introduce a second signer");
  assert.match(job, /Howland-Desktop-Windows-x64\.exe\.blockmap/);
  assert.match(job, /Howland-Desktop-Windows-arm64\.exe\.blockmap/);

  const native = section(wf, "  build-desktop:", "  package-windows:");
  assert.match(native, /TARGETS=\(--dir\)/, "native Windows legs are still wrapping before transfer");
  assert.match(native, /name: unpacked-\$\{\{ matrix\.artifact \}\}/, "native unpacked apps are not transferred");

  const release = section(wf, "  release:", "      - name: Start the howland server release");
  assert.match(release, /needs: \[preflight, build-desktop, package-windows, build-android\]/);
  assert.doesNotMatch(
    section(release, "- name: Collect what was built", "- name: Checksum what shipped"),
    /\.appx/,
    "the Store-only AppX can reach public release collection",
  );
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
  "Howland-Client-Android.apk": "one fat apk carries every ABI, so there is no arch to name.",
  "Howland-Client-Android.aab": "Play splits per device; arch is not applicable.",
  "Howland-Client-Android-debug.apk":
    "the unsigned twin. It takes the arch slot with a BUILD TYPE deliberately: it is not a fourth " +
    "architecture and must never be mistaken for the store apk, so it reads wrong to a human " +
    "on purpose. It never reaches the page, where a name that misparses would matter.",
  "latest-mac.yml":
    "electron-updater fetches <channel>.yml BY PROTOCOL — the filename is the request, not a " +
    "label, and only the updater ever reads it.",
  "latest-x64-mac.yml": "see latest-mac.yml.",
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

// A4: ARCH COMPLETENESS. THE ONE RULE A BOTH-DIRECTIONS BIND CANNOT ENFORCE.
//
// Every check above compares the declaration to the workflows. A MISSING ARCHITECTURE IS ABSENT
// FROM BOTH, so it is invisible to all of them, and the file passes while describing a train with
// a hole in it. That is the list-versus-matrix problem one level up: the binding proves the two
// documents agree, not that either is complete.
//
// PROVEN LIVE, NOT HYPOTHETICAL. magpie/packaging/platforms.json -- the newest declaration in the
// estate, written after every lesson here -- declares Magpie-Desktop-Windows-x64.exe with no
// arm64, and Magpie-Desktop-macOS-arm64.dmg with no x64. Neither is shipping, conditional, or
// planned; they are nowhere. In that same file the SERVER component is arch-complete on all three
// platforms. One file, two components, one of them complete.
//
// The rule extends the naming grammar from names to coverage. The grammar made arch EXPLICIT IN A
// NAME so a second build could never silently rename the first. This makes arch EXPLICIT IN
// COVERAGE so a second build can never silently be missing: name one arch of a platform for a
// component, and you owe an entry for the other -- shipping, planned with a reason, or declared
// not-applicable with a reason. Silence stops being an option, which is the only thing that turns
// a list into a matrix.
const archesExpected = { macOS: ["x64", "arm64"], Windows: ["x64", "arm64"], Linux: ["x64", "arm64"] };

// THE CELL IS READ OUT OF THE NAME, NOT OUT OF A FIELD, AND THAT IS THE PORTABLE PART. The
// grammar already puts component, platform and arch in every asset name -- that is what it is
// FOR -- so the completeness rule needs no schema agreement to run. magpie's declaration is
// shaped {name: {state}} with no platform or arch fields at all and a `planned` list of bare
// product heads; a rule that read fields would report zero findings there and look like a pass.
// It was written against fields first and did exactly that.
function cell(name) {
  // A documented grammar exception is not a cell. Magpie-ffmpeg-macOS-src.tar.xz parses as
  // component=ffmpeg, platform=macOS, arch=src and would be reported as two missing arches for a
  // source tarball that has none -- a false finding sitting beside two true ones, which is how a
  // correct rule gets deleted for being noisy. The exceptions are consulted FIRST, so an asset
  // outside the grammar is outside the matrix, and every name still inside it is guaranteed by
  // the grammar test to carry a real arch.
  if (grammarExceptions[name] !== undefined) return null;
  const m = /^[A-Za-z]+-([A-Za-z]+)-([A-Za-z]+)-([A-Za-z0-9]+)\.[A-Za-z0-9.]+$/.exec(name);
  if (!m) return null;
  const [, component, platform, arch] = m;
  return archesExpected[platform] ? { component, platform, arch } : null;
}

test("a component that ships one arch of a platform declares the other", () => {
  const covered = new Map(); // "component|platform" -> Set(arch)
  const note = (name) => {
    const c = cell(name);
    if (!c) return;
    const key = `${c.component}|${c.platform}`;
    if (!covered.has(key)) covered.set(key, new Set());
    covered.get(key).add(c.arch);
  };
  for (const a of declaration.assets) note(a.name);
  for (const p of declaration.planned ?? []) note(p.name);
  for (const na of declaration.notApplicable ?? []) {
    assert.ok((na.why ?? "").trim() !== "", `${na.name} is declared not-applicable with no reason`);
    note(na.name);
  }

  assert.ok(covered.size >= 3, `only ${covered.size} component/platform pairs parsed out of the declared names — this check is reading nothing`);

  for (const [key, arches] of covered) {
    const [component, platform] = key.split("|");
    for (const arch of archesExpected[platform]) {
      assert.ok(
        arches.has(arch),
        `${component} ships ${platform} ${[...arches].join("+")} and declares nothing for ${arch} — ` +
          `an arch that is neither built, planned, nor declared not-applicable is INVISIBLE: it is ` +
          `absent from the workflow and from this file, so every both-directions check above passes`,
      );
    }
  }
});
