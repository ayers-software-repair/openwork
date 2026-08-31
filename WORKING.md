# WORKING — Howland desktop/mobile fork (branch `howland`)

FOR CLAUDE SESSIONS (owner ruling 2026-08-25: .md files are working memory for us, not the
owner). Current state only; the audits, responses and superseded rulings that used to stack
here are in this file's git history. The cross-repo picture lives in howland's `WORKING.md`;
this file carries only what is specific to this fork.

## What this fork is

`different-ai/openwork` fork (`upstream` remote), default branch `howland`, MIT surface only —
never touch or redistribute `/ee` (FSL). Branding is build-time overrides only
(electron-builder `-c` flags, env, icon swap); no internal renames, so upstream still merges.
pnpm only. It builds Howland's DESKTOP (six OS/arch legs) and ANDROID heads and publishes them
onto the one `howland-v1.0.0` release of `ayers-software-repair/howland-releases`.

## The workflows (all of them — 20 of 22 upstream workflows are deleted)

- **`release.yml`** — the desktop+Android release. Preflight (sidecar release exists with all
  six asset names AND was built from the commit `constants.json` pins as `opencodeCommit`;
  RELEASES_PAT has WRITE on howland-releases) -> build-desktop (matrix COMPUTED from the
  `heads_*` selection) + build-android -> release (collect, checksum-what-shipped, updater
  metadata must name shipping files, reconcile, publish, then chain-dispatch howland's server
  release forwarding the selection). Publish-what-signs: a leg without its secrets skips with
  a skip record; reconcile turns records into named "Not built" summary lines and hard-fails
  on any unexplained absence. Subset runs do not regenerate Howland-Desktop-CHECKSUMS.txt
  (it spans three platforms); the Android manifest regenerates whenever Android is selected.
- **`ios-submission.yml`** — the store head, dispatch only, out of the chain. HARD FAILS
  without signing secrets (a store submission has no release to be partial about — uniformity
  is the same rule, not the same behaviour). Produces `Howland-Client-iOS-arm64.ipa` as a
  90-day CI artifact, never a release asset (howland-releases is public; the authenticated
  run page is the channel); the run summary is the operator interface.
- **`build-electron-desktop.yml`** — CI proof build, dispatch only.

## Facts a session will need

- `constants.json`: `opencodeVersion` (fork release tag the sidecar comes from) +
  `opencodeCommit` (the SHA it must have been built from). Both change together when the
  sidecar is re-cut; preflight enforces agreement.
- The sidecar fetch (`apps/desktop/scripts/prepare-sidecar.mjs`) exits 1 on a missing asset —
  why the sidecar release must exist first, and why the chain's first link cuts it.
- Version is stamped from the tag via extraMetadata (locked 1.0.0 fallback on any
  non-semver). Each leg rewrites its updater metadata to the stable asset names (bytes
  identical, so sha512/size hold) and renames it to its per-platform+arch channel file;
  `howlandUpdaterChannel()` in updater.mjs pins the channel explicitly because
  electron-updater's filename heuristics would hand an arm64 Mac the Intel zip. Update
  payloads are the same stable assets; differential downloads stay disabled (no blockmaps).
- Android: network_security_config.xml scopes cleartext for self-hosted LAN servers (Android
  has no CIDR syntax — confirmed platform limitation); versionCode = run number because
  store build codes must increase across the 1.0.0-in-place loop.
- Upstream analytics are killed at build time (empty VITE_OPENWORK_POSTHOG_KEY).
- PRs target `dev` upstream-style; prove UI flows with `pnpm fraimz --flow <id>`.

## Rulings this fork runs on (not derivable from the code)

- **Windows Store is a target for BOTH products** (owner, 2026-08-31). This OVERRULES the earlier
  "stores = Apple + Play only" scope line, which a seat may still have in its notes. The target is
  **`appx`, not `msix`** — electron-builder 25.1.8 has exactly one Windows Store target
  (`app-builder-lib/out/targets/AppxTarget.js:46` `super("appx")`); there is no msix target and the
  Store accepts `.appx`.
- **There is no Amazon flavor.** Amazon accepts a standard APK, so a second Amazon-named asset
  would be a different name for identical bytes. One APK serves Amazon and sideload.
- **Building is never gated on signing** (owner, 2026-08-31). A leg builds regardless of
  certificates; only PUBLICATION is gated. Unsigned output uploads under an `unsigned-` artifact
  name that the release job's `take()` excludes by path. Android's unsigned form is a DEBUG-SIGNED
  APK, because an unsigned release APK is a file no device installs — an artifact in name only.

## Open here

- **`release.yml:749` uses `ls *.appx 2>/dev/null | head -1`** — the SIGPIPE-abortable pipe this
  repo already paid for at `:657`. Safe TODAY because the appx target emits exactly one file per
  leg, so `head -1` never closes the pipe early. It stops being safe the moment a second .appx
  appears (a per-arch split, a second target). Replace with a glob-into-array read rather than a
  pipe when that happens. Recorded on cto's word: not a blocker, not to be fixed mid-lane.
- **actionlint is not installed on this box and sessions never install** (`~/source/CLAUDE.md`).
  Every workflow edit in this fork this session was verified by `yaml.safe_load` plus a structural
  read of the parsed job graph — NOT by actionlint. Two cards asked for actionlint-clean as
  evidence and it is OWED, not produced. It belongs in `dotfiles/bootstrap.sh`, which is where
  missing tooling routes.

- PAT scope for the chain: dispatching howland's server-release needs `actions:write` on the
  howland repo (fails loudly at the chain step if absent).
- The mobile scaffold has never run end-to-end in CI (native projects are generated at build
  time); the first funded run verifies it.
- The mac sidecar binaries must be listed for signing in electron-builder.yml before
  notarization is enabled — inert and untestable while unsigned (also in READINESS).
