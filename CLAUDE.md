# CLAUDE.md — the Howland desktop/mobile fork

This is `ayers-software-repair/openwork`, forked from `different-ai/openwork` (`upstream` remote).
The branch that matters is **`howland`** — this fork's default. It prepares Howland desktop
installers and Android store packages as retained Actions artifacts. Explicit publication reuses
the verified desktop bytes on `ayers-software-repair/howland-releases`; phones install from stores
only (D1625).

Read `WORKING.md` here for this fork's current state; the governing queue, standing rulings and
cross-repo record live in **`../howland/WORKING.md`** (the howland maintainer session and the
coordinator, ayers-electronics, run the estate — findings and completions report there).

Hard rules:
- **pnpm only**, never npm/yarn (`mobile/` is the one standalone npm project, by design).
- **MIT surface only**: never touch or redistribute `/ee` (FSL). Branding is BUILD-TIME
  overrides (electron-builder `-c` flags, env, icon swap) — **never rename upstream
  internals**, or the fork stops taking upstream merges. The fork follows upstream by rebasing
  its own commits onto upstream's current release and keeping the branding on top (D1598). The
  only source files it may edit are listed once, in the workspace `../CLAUDE.md` (D1597,
  D1604); this file carries no list of its own.
- `constants.json` pins the opencode sidecar by `opencodeVersion` AND `opencodeCommit`;
  they change together when the sidecar is re-cut, and `release.yml`'s preflight enforces
  agreement with the fork release's SOURCE-COMMIT.txt.
- Load-bearing workflows: `release.yml` (desktop+Android preparation with `heads_*` selection,
  skip records and a source-bound receipt; explicit publication reuses that run's artifacts and
  can chain the separately prepared server), `ios-submission.yml` (independent signed IPA and
  receipt), `store-bundle.yml` (verifies independent Android/iOS runs before any enabled store
  submission), and `contract.yml` (push/PR release contract; no publish path, `contents: read`).
  No `schedule:` triggers, ever.
- **`packaging/platforms.json` declares what this fork builds**, on three channels (release
  page / Actions artifact / store), and `packaging/platforms.test.mjs` holds both workflows to
  it in both directions — `node --test packaging/platforms.test.mjs`, no pnpm install. Any
  asset rename or new leg lands in the same change as its row, and reddens
  `../howland/installer/release_assets_test.go`'s 28-asset count, which is the only cross-repo
  tripwire there is.
- Nothing publishes, tags, or dispatches without explicit owner go-ahead. Prepare an RC first;
  public promotion requires its verified receipt, the same source commit and retained bytes.
  Published `1.0.0` is immutable. No emojis; no AI attribution in commits; commit identity per
  the workspace CLAUDE.md.
- Asset names follow `<Product>-<Component>-<Platform>-<Arch>.<ext>`;
  `../howland/installer/release_assets_test.go` binds the train — update it in the same
  change as any asset rename here.
- Upstream files are upstream's: a fix that belongs upstream goes upstream, not here.

## Tooling — the global rules apply here (see ~/.claude/CLAUDE.md)

Two laws from the root file bind every session in this repo. They are not repeated in full here on
purpose: a long CLAUDE.md gets ignored in the middle, so this is a pointer, not a copy.

1. **CONSULT THE DOCS, NEVER GUESS.** Any claim about a library, framework, SDK or platform gets
   read from the real documentation first — `context7` for libraries, `microsoft-docs` for
   .NET/Windows/Azure. Cite the source. Never from memory.
2. **Reach for the tool before the generic one.** Symbols: the LSP for TypeScript, JavaScript,
   Python, Go and C/C++, in a seat; grep + Read for C# (no C# server is installed: csharp-lsp died
   on every call and serena was removed, both 2026-09-10). A real browser is the cached chromium
   from Bash: `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome --headless=new
   --no-sandbox --mute-audio`; the playwright plugin is removed.

This repo is **TypeScript/Electron** — `typescript-language-server` applies.
