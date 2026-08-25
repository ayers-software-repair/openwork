# CLAUDE.md — the Howland desktop/mobile fork

This is `different-ai/openwork` forked (`upstream` remote), and the branch that matters is
**`howland`** — the fork's default. It builds Howland's desktop (six OS/arch legs) and Android
heads onto the one `howland-v1.0.0` release of `ayers-software-repair/howland-releases`.

Read `WORKING.md` here for this fork's current state; the governing queue, standing rulings and
cross-repo record live in **`../howland/WORKING.md`** (the howland maintainer session and the
coordinator, ayers-electronics, run the estate — findings and completions report there).

Hard rules:
- **pnpm only**, never npm/yarn (`mobile/` is the one standalone npm project, by design).
- **MIT surface only**: never touch or redistribute `/ee` (FSL). Branding is BUILD-TIME
  overrides (electron-builder `-c` flags, env, icon swap) — **never rename upstream
  internals**, or the fork stops taking upstream merges. Fork-owned surfaces:
  `apps/desktop/electron/main.mjs`, `updater.mjs`, `prepare-sidecar.mjs`, the workflows,
  `constants.json`, `WORKING.md`, this file.
- `constants.json` pins the opencode sidecar by `opencodeVersion` AND `opencodeCommit`;
  they change together when the sidecar is re-cut, and `release.yml`'s preflight enforces
  agreement with the fork release's SOURCE-COMMIT.txt.
- Load-bearing workflows: `release.yml` (desktop+Android; preflight-gated, `heads_*`
  selective, publish-what-signs with skip records and reconciliation; chains into howland's
  server release on success), `ios-submission.yml` (store head, dispatch only, hard-fails
  unsigned; its .ipa is a CI artifact, never a release asset). No `schedule:` triggers, ever.
- Nothing publishes, tags, or dispatches without explicit owner go-ahead. Version locked at
  1.0.0, overwritten in place. No emojis; no AI attribution in commits; commit identity per
  the workspace CLAUDE.md.
- Asset names follow `<Product>-<Component>-<Platform>-<Arch>.<ext>`;
  `../howland/installer/release_assets_test.go` binds the train — update it in the same
  change as any asset rename here.
- Upstream files are upstream's: a fix that belongs upstream goes upstream, not here.
