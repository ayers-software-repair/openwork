# WORKING — Howland desktop/mobile fork (branch `howland`)

This fork builds Howland's 13 desktop assets and 4 mobile assets onto
`ayers-software-repair/howland-releases`. Upstream code inherited unchanged is out of scope except
where Howland's train depends on it.

---

# AUDIT 2026-08-24 — release audit (coordinator)

Verified against the code, the real electron-builder 25.1.8 macro expansion, the app-builder Go
source, and live GitHub state — not against docs.

**Verdict: a desktop dispatch today produces ZERO assets, not 13.** Two independent hard failures
stop the matrix before the `release` job runs. The naming logic itself is correct.

Not findings (known and gated): unsigned artifacts pending dev accounts, unfunded Actions,
mobile-never-run, upstream code smells in unchanged files.

## LAUNCH-BLOCKERS

1. **The sidecar release the whole train depends on does not exist.** `constants.json:2` pins
   `v1.17.11-howland` and `.github/workflows/release.yml:139` sets
   `OPENCODE_GITHUB_REPO: ayers-software-repair/opencode`. Env consumption traced end to end and is
   wired correctly: step env → `pnpm run build:electron` →
   `apps/desktop/scripts/electron-build.mjs:33` → `prepare-sidecar.mjs:39` → URL at `:312`. But
   `ayers-software-repair/opencode` has **zero releases** and no `v1.17.11-howland` tag, so
   `curl -fsSL` 404s and `prepare-sidecar.mjs:361-363` exits 22 — **all six legs die** and
   `release: needs: build` never runs. Fix: dispatch `Howland Sidecar` on the fork (branch
   `howland-sidecar`, which exists) and confirm 6 assets + `SHA256SUMS-sidecar.txt` land **before**
   any desktop dispatch. The six asset names match exactly, zero drift — the contract is right, the
   release is simply absent.

2. **The `ubuntu-24.04-arm` leg cannot build `.deb` — app-builder fetches a 32-bit x86 fpm on
   aarch64.** `release.yml:42-43` (new leg) + `apps/desktop/electron-builder.yml:100-103` (`deb` in
   `linux.target`). From `develar/app-builder` `pkg/download/tool.go:12-33`:
   `if runtime.GOARCH == "amd64" { archSuffix = "-x86_64" } else { archSuffix = "-x86" }`, then
   `fpm.go:38-46` execs it. Confirmed in the shipped binaries: `app-builder-bin/linux/x64/app-builder`
   contains `x86_64`; `linux/arm64/app-builder` contains no `x86_64`, `aarch64` or `arm64v8`. And
   `electron-builder-binaries` publishes no `fpm-…-linux-arm64` asset — only `-x86_64` and `-x86`.
   Leg fails → `needs: build` fails → nothing publishes; `pick '*linux-arm64*.deb'` at `:266` would
   also hard-fail "matched 0 files". Fix, on that leg only (`fpm.go:38` honours the escape hatch):
   install `ruby ruby-dev build-essential` + `gem install fpm -v 1.15.1`, and set
   `USE_SYSTEM_FPM: true` in the package step env. AppImage and tar.gz on arm64 are fine — the
   `appimage-12` bundle carries the aarch64 runtime.

## HIGH

3. **Every packaged launch shows a raw HTTP 404 in Settings → Updates.**
   `apps/desktop/electron/updater.mjs:32-39` claims update checks "resolve to no-update"; they do
   not. `:164-166` sets `{provider:"generic", url}`; electron-updater then GETs
   `<url>/latest-mac.yml` (or `latest.yml` / `latest-linux.yml`). Those files *are* generated — the
   `publish:` block at `electron-builder.yml:40-44` makes electron-builder emit them even under
   `--publish never` — but `release.yml:201-207` does not glob `*.yml`, so they are never uploaded →
   404 → `updater.mjs:318-320` returns `{available:false, reason:"<HttpError 404 …>"}` →
   `electron-updater-state.ts:205-208` sets `{state:"error", message: result.reason}`.
   `updateEnv.supported` is only false when the bridge is absent (`:110,130`), so the auto-check at
   `:242-247` fires on every packaged launch. Fix: publish the versioned artifacts + `latest*.yml`,
   or short-circuit `checkForUpdates` to a clean "no updates available" until updater metadata
   ships. Correct the comment either way.

4. **`build-electron-desktop.yml` still carries the exact bug this fork already diagnosed and fixed
   elsewhere.** `:76` passes
   `-c.publish.0.owner=ayers-software-repair -c.publish.0.repo=howland-releases`. Commit `8a0584181`
   established that a publish entry without `provider` fails schema validation *even under
   `--publish never`*, and `7da11be11` removed the override from `release.yml` entirely. It survived
   here — and is redundant anyway since `electron-builder.yml:40-44` already targets
   howland-releases. The same file also lacks `OPENCODE_GITHUB_REPO`, so its sidecar fetch 404s
   against `anomalyco/opencode`. Fix: delete `:76`; add the env at `:69-70`.

5. **Unguarded tag-triggered upstream workflows on the default branch.**
   `release-macos-aarch64.yml` (`push: tags: v*`) and `publish-ee-images.yml` (`push: tags: v*` +
   `pull_request: paths`) have no `github.repository ==` guard and are `active`; repo Actions are
   enabled. `howland-v*` does not match `v*`, so today's train is safe — but any `v*` tag fires a
   38 KB release pipeline that npm-publishes, pushes AUR and cuts releases *on this fork*, and
   pushes container images to `ghcr.io/ayers-software-repair/*`. Fix: add
   `if: github.repository == 'different-ai/openwork'` to their top jobs (the pattern upstream
   already uses in `download-stats.yml:12`, `den-db-migrate.yml:54`, `update-models.yml:28`), or
   disable them in the Actions UI.

## MED

6. `apps/desktop/electron/main.mjs:51,59-61,123` — `APP_IDENTIFIER` is hardcoded
   `com.differentai.openwork` while `release.yml:156` packs `appId=com.howland.app`. NSIS stamps the
   shortcut AppUserModelID from `appId`, so `app.setAppUserModelId()` disagrees with the shortcut and
   Windows taskbar pinning/grouping and toasts break.
7. `apps/desktop/electron/updater.mjs:183` — `SHIP_IT_DEFAULTS_DOMAIN =
   "com.differentai.openwork.ShipIt"`. Squirrel.Mac derives the domain from the bundle id, now
   `com.howland.app`, so `enableSquirrelDirectContentsWrite()` and `cleanStaleUpdaterState()` write
   and clean the wrong domain. Derive it, don't hardcode.
8. **The ≥1024 icon answer: one exists and `release.yml:159` throws it away.**
   `apps/desktop/resources/icons/icon.icns` (fork-replaced, 1,058,537 B) carries a full ladder
   including `ic10 = 1024×1024` (verified by parsing the icns TOC: ic04/05/07/08/09/10/11/12/13/14).
   `-c.mac.icon=resources/icons/howland-icon.png` forces regeneration from a **512×512** PNG,
   discarding the Retina renditions. Both `icon.png` and `howland-icon.png` are 512×512. Fix: drop
   the `-c.mac.icon` (and `win`/`linux`) overrides — `electron-builder.yml:46,76,105` already points
   at the branded assets.
9. `apps/desktop/package.json:7-9` — `author: {name:"OpenWork", email:support@openworklabs.com}`
   becomes electron-builder's default `copyright` ("Copyright © 2026 OpenWork") in
   `NSHumanReadableCopyright` and Windows file properties, and `Maintainer: OpenWork <…>` in the
   `.deb`. Add `-c.copyright=` and `-c.deb.maintainer=` overrides, or change `author`.
10. `main.mjs:64` vs `apps/app/src/react-app/domains/session/chat/status-bar.tsx:27` — two different
    "Docs" targets: native Help menu → `openworklabs.com/docs`; status bar → `howland-releases#readme`.
11. `apps/desktop/electron/runtime.mjs:1007-1015` (called `:1641`) — the guided OpenCode install
    emits `curl -fsSL https://opencode.ai/install | bash -s -- --version 1.17.11-howland`; that
    version does not exist upstream, so the repair action always fails.
12. `apps/desktop/electron-builder.yml:37-44` — the comment still describes upstream's Tauri/Electron
    migration window; the block now only emits `latest*.yml` that are deliberately discarded. The
    contradiction is documented in `updater.mjs`, not here.
13. `mobile-release.yml` — no app-version stamping anywhere. Desktop stamps via
    `extraMetadata.version`; mobile injects no `versionName`/`versionCode`/`MARKETING_VERSION`, so
    every APK/AAB/IPA ships Capacitor's default `1.0` / `versionCode 1` regardless of tag. Play and
    the App Store reject re-uploads. Inject from `steps.v.outputs.version`.
14. `mobile/package.json:12-19` — Capacitor **6**, so `cap add android` generates `targetSdk 34`;
    Play requires 35+. Bump to `@capacitor/*@7`.
15. `nightly-evals.yml:8-9,17` — daily cron, **no** repository guard (unlike its siblings),
    `runs-on: blacksmith-4vcpu-ubuntu-2204` which does not exist on this fork, so it queues and
    expires daily. Its OpenCode install (`:44-49`) would also fail on `1.17.11-howland` from
    `anomalyco/opencode`.
16. `alpha-macos-aarch64.yml:3-5,37` — `push: branches: [dev]` on `macos-14` (10× multiplier),
    unguarded, and `origin/dev` exists on this fork.

## LOW

17. Script injection shape: `${{ github.event.inputs.tag }}` interpolated straight into `run:` at
    `release.yml:148`, `:278`, `mobile-release.yml:541`. Route via `env:` and `"$TAG"`.
18. `mobile-release.yml:528` uses `head -1` where the desktop path deliberately uses the strict
    `pick()` (`release.yml:237-244`) — the same class of bug the desktop comment warns about.
19. `mobile-release.yml:399` — `security import` lacks `-T /usr/bin/codesign` and there is no
    `security set-key-partition-list`; `xcodebuild` will hit a keychain ACL prompt in CI.
20. `release.yml:187-189` — signtool discovery filters on `$archDir='arm64'` under
    `Windows Kits/10/bin`; if that layout is absent on `windows-11-arm`, `$signtool` is `$null` and
    `& $null sign` fails confusingly. Add a null check.
21. No `timeout-minutes` on any desktop build leg or the two mobile build jobs (only `gate:47-48`
    has one). A hung leg burns 6 h.
22. `den-db-check.yml`, `daytona-eval-image.yml`, `ci-i18n.yml`, `ci-tests.yml` — unguarded
    PR/branch triggers on blacksmith runners; queue-and-expire noise on any fork PR.
    `ci-tests.yml:41-51` also breaks on `1.17.11-howland`.
23. `case` glob `[0-9]*.[0-9]*.[0-9]*` (`release.yml:150`, `:280`, `mobile-release.yml:543`) accepts
    `1abc.2.3`.

## BAGGAGE — delete unless noted

24. **Dead chain in `main.mjs:192-247`** — `platformDownloadSlug`, `downloadAssetArch`,
    `downloadAssetExtension`, `updaterManifestName`, `parseUpdaterManifestFiles`, `selectDownloadFile`.
    All six are unreferenced after the wrong-arch rewrite (only `selectDownloadFile` still calls two
    of them, and nothing calls it).
25. `apps/desktop/resources/icons/howland-icon.png` — 512×512, same size and subject as the fork's
    `icon.png`; only needed because of the `-c.*.icon` overrides that should go away (#8).
26. `main.mjs:941` — `HOWLAND_DEFAULT_PORTS.brain: 31050` is never read.
27. `release.yml:172` cites `build-farm/signing/READINESS.md` — no such path in this repo. Dangling
    cross-repo reference in the Azure swap-point note.
28. `mobile/.gitignore:1-7` and `mobile/README.md:56-59` both say the generated `android/`/`ios/`
    projects should be committed for production; they are not, so mobile builds are non-reproducible
    (`npm install`, not `npm ci` — `mobile-release.yml:118-122` says so explicitly).
29. `electron-builder.yml:1-4` — "appId intentionally matches the Tauri shell" is now false at pack
    time (`com.howland.app`), which is exactly what causes #6 and #7.

## Verified clean (do not re-litigate)

`release.yml`: `v*` trigger gone (only `howland-v*` + dispatch, confirmed against `377881be7`);
`permissions: contents: read`; job-level `env` booleans with steps gating on `env.*`; **zero
`secrets.` in any `if:` across all 22 workflows**; CSC_LINK written to `$GITHUB_ENV` *inside* the
`MAC_SIGN`-gated step (the heredoc reasoning is right — `chooseNotNull` keeps `""`); notary env
names match `electron-after-sign.cjs:49,60-62` exactly and reuse the server's `APPLE_NOTARY_*`
secrets; signtool step present with a marked Azure swap point; shared `howland-releases-publish`
concurrency group mirrored at `mobile-release.yml:510-512`; tag normalization at `:275-283` is
byte-identical to the build stamp at `:148-152`, so `tag_name` can never mint a stray tag. Repo
secret inventory is `RELEASES_PAT` only → all three signing gates `false`, every signing step skips
cleanly.

Asset naming verified against the real electron-builder, not the docs: `artifactPatternConfig`
(`platformPackager.js:471-477`) sets `isUserForced=true` for a `-c.artifactName` override so `:469`
never nulls the arch; `expandMacro` (`:488-490`) supplies `os`; `getArtifactArchName`
(`builder-util/out/arch.js:58-91`) gives exactly the AppImage=`x86_64` / tar.gz=`x64` / deb=`amd64`
split the `:257-262` comment claims. All 12 globs at `:247-266` resolve 1:1 → **12 installers +
`SHA256SUMS-desktop.txt` = 13**.

`mobile-release.yml`: gate job `:46-68` (cheap ubuntu, `timeout-minutes: 5`), both build jobs gated
at `:72`/`:262`, `force_build` string-compare `:52` correct for a dispatch boolean, version fallback
`:541-546` handles both tag shapes. With zero mobile secrets both legs skip and the release job's
`always() && signed` guard at `:507` skips too — no race with desktop on the shared tag.

Wrong-arch fallback: `main.mjs:252-257` maps to the real published names — `Howland-macOS.dmg`,
`Howland-macOS-Intel.dmg`, `Howland-Windows.exe`, `Howland-Windows-arm64.exe`,
`Howland-Linux.AppImage`, `Howland-Linux-arm64.AppImage` — all present in the live `howland-v1.0.0`
release, and the HEAD probe at `:266-269` correctly suppresses the mismatch banner on a dead link.

## OWNER RULINGS 2026-08-24 (post-audit) — these override any finding text above

1. **Real, uniform installers everywhere.** Every installable artifact on BOTH products gets a real
   platform-native installer, and the two products' install experiences stay uniform with each other.
   The tray-as-setup-exe pattern is retired. This supersedes the "writable app-data root" minimum
   fix for Neptune's install-location blocker: fix the install root AND ship a real installer.
   Cross-product parity is a hard requirement — design the installer story once, apply it to both.
2. **Windows code signing: unresolved, defer.** File-based .pfx is no longer issuable. Azure Trusted
   Signing may now have a path that does not require a 3-year-old org — determine this when setting
   up dev accounts, not before. Do not rewire secrets or buy anything until then. Keep the soft-fail
   staging exactly as it is.
3. **AppImage: switch to the maintained `AppImage/appimagetool`** (static fuse3 runtime, no system
   FUSE dependency) on both products. This also removes the unpinned moving-tag dependency.
4. **Mobile ships in v1.** Capacitor 6→7 (Play needs targetSdk 35+), real version stamping, keychain
   fixes, and the store listing rewritten to claim only what the app contains.
5. **Dependency bumps go in BEFORE the first funded run, carefully** — read each major's changelog,
   especially `softprops/action-gh-release` 2→3, whose same-tag asset-replacement semantics are
   load-bearing for the rebuild loop. Do not bump blind.

6. **Mobile is in v1 scope** — see ruling 4. The mobile-release workflow, Capacitor bump and version
   stamping are required work, not deferred.

---

# RESPONSE 2026-08-24 — maintainer (blockers pass)

## LAUNCH-BLOCKERS

1. STAGED — not closable without a workflow run (forbidden until Actions is funded). The
   sidecar dispatch is now locked on the opencode fork (hardcoded ref, post-build version
   assertion, concurrency group — see that repo's WORKING.md) and stays first in
   howland/docs/BUDGET-DAY.md's order: sidecar → verify 7 assets → desktop.
2. CLOSED (commit on this branch): the ubuntu-24.04-arm leg installs
   ruby/ruby-dev/build-essential + `gem install fpm -v 1.15.1` and exports
   `USE_SYSTEM_FPM=true` via a leg-gated step, with a comment carrying your app-builder
   tool.go finding. Other legs untouched (env only set on arm64).

## Still open here, queued top-down

HIGH 3 (updater 404 in Settings), 4 (build-electron-desktop.yml publish override + missing
OPENCODE_GITHUB_REPO), 5 (unguarded v* workflows — will disable in the Actions UI rather than
patch upstream files); MED 6-16 including the mobile v1 ruling work (Capacitor 6→7, version
stamping, keychain `-T`/partition-list, listing rewrite lives in howland docs); LOW 17-23;
BAGGAGE 24-29. Ruling 1 (real installers) awaits the owner design conversation before any of
the packaging surface here changes shape.

---

# VERIFICATION 2026-08-24 (coordinator)

**Closed: 1 of 29.** #2 (arm64 fpm) is done and correctly leg-gated — `release.yml:106-114` installs
ruby/fpm and exports `USE_SYSTEM_FPM=true` only on `ubuntu-24.04-arm`.

**#1 remains the blocker and cannot be closed from here:** `ayers-software-repair/opencode` has zero
releases, zero tags, zero workflow runs. It needs a funded dispatch of the sidecar workflow. All the
work that makes that dispatch safe is done on the fork side and verified.

**Everything else is untouched (28).** Highest value first: #3 (every packaged launch shows a raw
HTTP 404 in Settings → Updates), #4 (`build-electron-desktop.yml:76` still carries the publish
override this fork already diagnosed and removed elsewhere, and lacks `OPENCODE_GITHUB_REPO`), #5
(two unguarded `v*`-tag workflows that would npm-publish and cut releases on this fork), then #6-#9
(the `com.differentai.openwork` / `com.howland.app` identity split, the 1024px icns thrown away by a
512px override, and "Copyright OpenWork" in every artifact), then mobile #13/#14 per the v1 ruling.

---

# WORK ORDER 2026-08-24 (coordinator → maintainer)

Full cross-repo order lives in `howland/WORKING.md`. This repo's part:

1. **#3** — every packaged launch shows a raw HTTP 404 in Settings → Updates. Fix the endpoint.
2. **#4** — `build-electron-desktop.yml:76` still carries the publish override this fork diagnosed
   and removed elsewhere, and lacks `OPENCODE_GITHUB_REPO`. Remove the override; add the env.
3. **#5** — guard the two unguarded `v*`-tag workflows. On this fork they would npm-publish and cut
   releases.
4. **#6–#9** — resolve the `com.differentai.openwork` / `com.howland.app` identity split; stop the
   512px override throwing away the 1024px icns; replace "Copyright OpenWork" in every artifact.
5. Then mobile **#13/#14** per the v1 ruling.

**#2 is done and correctly leg-gated** — `release.yml:106-114` installs ruby/fpm and exports
`USE_SYSTEM_FPM=true` only on `ubuntu-24.04-arm`.

**#1 cannot be closed from either side.** `ayers-software-repair/opencode` has zero releases, zero
tags, zero workflow runs, so the sidecar release Howland's installer downloads does not exist. One
funded dispatch closes it; do not attempt it.

Standing rules: version stays 1.0.0, rebuilt in place. No workflow runs until Actions is funded.
Nothing published or tagged without owner go-ahead.

## Scope of this work order

The numbered sections above are **priority order, not the whole job**. The job is every finding in
this file that is still open — every numbered finding, every owner ruling, every program — worked to
closed or to an explicit, recorded disposition. A finding you decide not to fix is closed by writing
down the reason, not by leaving it unmentioned. Do not stop at the newest section.

Work top-down through the priority order, then sweep the file from the top for anything still open
and finish it. Append what you did, and what you deliberately deferred and why, to this file.

---

# NEW FINDING 2026-08-24 — the workflow surface was never swept

My earlier audit reported "#5 — two unguarded `v*`-tag workflows". **That was an under-count.** This
fork carries **22 workflows and only 4 carry any repository guard** (`den-api-env`, `den-db-migrate`,
`download-stats`, `update-models`). Eighteen are unguarded and would run on this fork the moment
Actions is funded.

## 30. HIGH — 18 unguarded workflows, several of which publish or run on a schedule

**Scheduled — burns minutes forever once funded, for nothing this product needs:**
- `nightly-evals.yml` — runs upstream's eval suite every night.

**Publishing paths — would publish under Ayers' account:**
- `publish-ee-images.yml` (enterprise container images), `release.yml`,
  `release-macos-aarch64.yml`, `alpha-macos-aarch64.yml`, `release-generic-installer.yml`,
  `eval-generic-installer-release.yml`, `release-daytona-snapshot.yml`, `mobile-release.yml`.

**Upstream infrastructure this fork has no use for:** `aur-validate.yml` (Arch User Repository),
`daytona-eval-image.yml`, `den-db-check.yml`, `ci-openwork-ui-mcp.yml`.

**The fix is one decision, applied uniformly:** every workflow this fork does not need is deleted,
and every one it keeps gets the same
`if: github.repository == 'ayers-software-repair/openwork'` guard at job level. Deleting is
preferred — a fork carrying 18 workflows it never runs is the "no baggage" rule the owner set for
v1, and each one is a live publish path nobody is watching.

Do this **before** Actions is funded, not after. Once funded, an unguarded scheduled workflow does
not wait for anyone's approval.

## Correction to the finding above — the answer is delete, and the number is 20 of 22

Traced the actual dependency chain rather than assuming every workflow had a reason to exist:

```
opencode/howland-sidecar.yml  →  release v1.17.11-howland
        ↓  (this repo: constants.json "opencodeVersion", release.yml OPENCODE_GITHUB_REPO)
openwork/release.yml          →  13 desktop assets on howland-releases
        ↓  (howland/installer/release_assets_test.go binds the exact names)
howland                       →  site links, tray updater, bundle command
```

**Two workflows here are load-bearing:** `release.yml` (the 13 desktop assets the Howland install
path and `release_assets_test.go` are bound to) and `mobile-release.yml` (gated on signing keys;
`howland/installer/release_assets_test.go` already lists `Howland-iOS.ipa`,
`Howland-Android.apk`, `Howland-Android.aab` as *planned* — the site links them today and they do
not exist).

The other 20 are upstream's CI for upstream's project — enterprise container images, Daytona,
Den, AUR validation, nightly evals, and the generic-installer release train. They are not
"unguarded", they are **not ours**.

**Delete 20, keep `release.yml` and `mobile-release.yml`, and guard both** with
`if: github.repository == 'ayers-software-repair/openwork'`.

Note `build-electron-desktop.yml` is on that delete list — finding `#4` asked for the publish
override to be removed from it and `OPENCODE_GITHUB_REPO` added. **If that workflow is dead, `#4`
closes by deleting the file instead.** Confirm which of the two produces the shipped desktop
artifacts before deleting either.

**The one honest cost:** this fork rebases onto upstream. When upstream edits a workflow file we
deleted, git raises a modify/delete conflict on that upgrade — one "stays deleted" decision per
file, far cheaper than 20 live publish paths nobody is watching.
