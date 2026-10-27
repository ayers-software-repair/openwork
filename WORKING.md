# WORKING — Howland desktop/mobile fork (branch `howland`)

FOR CLAUDE SESSIONS (owner ruling 2026-08-25: .md files are working memory for us, not the
owner). Current state only; the audits, responses and superseded rulings that used to stack
here are in this file's git history. The cross-repo picture lives in howland's `WORKING.md`;
this file carries only what is specific to this fork.

## What this fork is

`ayers-software-repair/openwork` fork of `different-ai/openwork` (`upstream` remote), default
branch `howland`, MIT surface only —
never touch or redistribute `/ee` (FSL). Branding is build-time overrides only
(electron-builder `-c` flags, env, icon swap); no internal renames, so upstream still merges.
pnpm only. It prepares Howland DESKTOP installers (six OS/arch legs) and Android store packages
(Play `.aab`, Amazon `.apk`) as retained Actions artifacts. Explicit publication verifies the
prepared receipt and reuses the same desktop bytes on `ayers-software-repair/howland-releases`.
Phones install from stores only and nothing side-loads (owner, D1625); vendor submissions use
the separately verified store bundle and enabled targets.

## Shared release verification, 27 October 2026

Workflow references use platform v0.76.0. Preparation and publication require current
contract CI for the exact source commit; retained receipts cannot bypass a later failure.
Product CI and native package acceptance remain required before publication.

## The release workflows

- **`release.yml`** — desktop+Android preparation. Preflight verifies the pinned sidecar,
  release permissions, selected `heads_*` and version. Build legs retain signed output; missing
  signing credentials leave skip records, while unexplained missing files fail. The
  `prepared-release` receipt binds the completed run, attempt, source and artifact bytes.
  An explicit `publish=true` dispatch verifies that receipt and reuses those files without
  rebuilding. Public preparation requires an accepted RC at the same source commit; publication
  checks existing assets before writing and may then dispatch the separately prepared server.
- **`ios-submission.yml`** — the independent signed IPA build, dispatch only. The IPA remains a
  retained CI artifact, never a public release asset; `prepared-ios` records its exact build and
  source. A compile-proof run produces no IPA or receipt. Store upload is separate.
- **`store-bundle.yml`** — verifies the independent desktop/Android and iOS receipts, source and
  build identities, retains their exact bytes in one bundle, then submits only enabled vendor
  targets on a separate RC or public dispatch.
- **`build-electron-desktop.yml`** — CI proof build, dispatch only.

## Facts a session will need

- `constants.json`: `opencodeVersion` (fork release tag the sidecar comes from) +
  `opencodeCommit` (the SHA it must have been built from). Both change together when the
  sidecar is re-cut; preflight enforces agreement.
- The sidecar fetch (`apps/desktop/scripts/prepare-sidecar.mjs`) exits 1 on a missing asset —
  why the sidecar release must exist before client preparation.
- Version is resolved from the exact tag by the shared release-version action; invalid tags
  fail instead of silently falling back to 1.0.0. RC display, numeric package and store build
  values stay distinct. Each non-Windows leg rewrites updater metadata to stable asset names. Windows
  signs the stable NSIS installer, then regenerates its matching `.exe.blockmap` and feed SHA-512
  and size from those final bytes;
  `howlandUpdaterChannel()` in updater.mjs pins the channel explicitly because
  electron-updater's filename heuristics would hand an arm64 Mac the Intel zip. Update
  payloads are the same stable assets; Windows publishes architecture-specific blockmaps.
- Android: network_security_config.xml scopes cleartext for self-hosted LAN servers (Android
  has no CIDR syntax — confirmed platform limitation); the shared action supplies the
  increasing store build code, recorded in the preparation receipt.
- Upstream analytics are killed at build time (empty VITE_OPENWORK_POSTHOG_KEY).
- PRs target `dev` upstream-style; prove UI flows with `pnpm fraimz --flow <id>`.

## Rulings this fork runs on (not derivable from the code)

- **Windows Store is a target for BOTH products** (owner, 2026-08-31). This OVERRULES the earlier
  "stores = Apple + Play only" scope line, which a seat may still have in its notes. The target is
  **`appx`, not `msix`** — electron-builder 25.1.8 has exactly one Windows Store target
  (`app-builder-lib/out/targets/AppxTarget.js:46` `super("appx")`); there is no msix target and the
  Store accepts `.appx`.
- **There is no Amazon flavor.** Amazon accepts a standard APK, so a second Amazon-named asset
  would be a different name for identical bytes. The one APK is Amazon's package.
- **Building is never gated on signing** (owner, 2026-08-31). A leg builds regardless of
  certificates; only PUBLICATION is gated. Windows treats all six Azure identity/configuration
  values absent as unsigned and rejects a partial set before packaging. A fully configured signing
  run also needs OpenWork's `PLATFORM_READ_KEY`, the private half of a read-only deploy key for the
  private platform repository; the unsigned path does not check out platform or require that key.
  Unsigned output uploads under an `unsigned-` artifact name that the release job's `take()`
  excludes by path. Android's unsigned form is a DEBUG-SIGNED APK, because an unsigned release APK
  is a file no device installs — an artifact in name only.

## Open here

- The earlier `ls *.appx | head -1` signing-package risk was recorded on cto's word; the
  current Windows packaging path selects architecture-specific output and rejects ambiguity.
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
