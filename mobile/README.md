# Howland Mobile (Capacitor)

Native iOS and Android wrappers around the Howland web UI (`apps/app`), built with
[Capacitor](https://capacitorjs.com/). This directory is a **standalone npm project** that
lives at the repo root on purpose: the pnpm workspace globs `apps/*` and `packages/*`, so
placing it under `apps/` would pull Capacitor into the workspace lockfile and break
`pnpm install --frozen-lockfile` in the desktop build workflows. Install its deps with
`npm install` from inside `mobile/`, not pnpm.

## Status (honest)

This is a **correct scaffold, not a verified end-to-end build.** It has never been run in
CI, and it needs a real macOS/Xcode and Android SDK build environment plus signing keys to
produce installable apps. The native `android/` and `ios/` projects are **generated on the
runner** (they are not committed) by `npx cap add`. Runtime behavior (Electron-only APIs in
the web app, connecting to a Howland server) has not been validated on a device.

## What is here

- `capacitor.config.ts` — appId `com.howland.app`, appName `Howland`, `webDir: dist`, and a
  `server` block that lets the app reach a user-set Howland server (see below).
- `package.json` — `@capacitor/core` + `@capacitor/cli` + `@capacitor/ios` + `@capacitor/android`.
- `.gitignore` — ignores the generated `android/`/`ios/` projects, `node_modules/`, the
  staged `dist/`, and build outputs.

The native platform projects are intentionally absent. The release workflow generates them
in CI; to work locally, generate them yourself (next section).

## First-time local setup (needs a real device/build environment)

```sh
cd mobile
npm install

# Build the web bundle and stage it where capacitor.config.ts expects it (webDir: dist).
# From the repo root:
#   pnpm --filter @openwork/app run build:web
#   rm -rf mobile/dist && mkdir -p mobile/dist && cp -R apps/app/dist/. mobile/dist/

# Generate the native projects (requires Xcode for iOS, Android SDK for Android):
npx cap add ios
npx cap add android

# Copy web assets + sync native deps:
npx cap sync

# Open in the native IDEs:
npx cap open ios       # Xcode
npx cap open android   # Android Studio
```

The generated `android/` and `ios/` folders stay UNcommitted by design (see .gitignore);
the workflow stamps versioning/identity after generation and package-lock.json pins the
inputs. (The old guidance said to commit them — superseded 2026-08-24.) Ignore: (remove them from
`.gitignore`) so you control signing, versioning, icons, and native config, then update the
release workflow's "add platform" step (it only runs `cap add` when the folder is missing).

## Pointing the app at a Howland server

Howland is self-hosted, so the mobile app must reach a user-provided server. Two build-time
env vars in `capacitor.config.ts` control this:

- `HOWLAND_SERVER_URL` — if set, the webview loads that live server directly
  (Capacitor `server.url`) instead of the bundled UI. Leave unset to ship the bundled UI.
- `HOWLAND_ALLOWED_HOSTS` — comma-separated hosts the in-app webview may navigate to
  (Capacitor `allowNavigation`), so API/websocket calls to the user's server are allowed.

## Release workflow and signing

Android builds in **`.github/workflows/release.yml`** (the one desktop+mobile release; the
separate mobile workflow is folded in). The `build-android` leg publishes
`Howland-Client-Android.apk` / `.aab` + `Howland-Client-CHECKSUMS.txt` onto the shared
`howland-v1.0.0` release. Without its signing secrets the leg SKIPS and the run summary names
the missing secret — there is no unsigned compile-proof mode any more; the release publishes
what it can sign.

iOS builds in **`.github/workflows/ios-submission.yml`** — its own dispatch, out of the
release chain. It HARD FAILS without signing secrets, and its `.ipa` is a 90-day CI artifact
on the run page (never a release asset; App Store Connect is the channel). The export
`method` defaults to `app-store`; change it (with a matching provisioning profile) to
`ad-hoc` or `development` for direct device sideloading.

Secrets, named exactly as the workflows read them:

Android: `ANDROID_KEYSTORE_BASE64` (base64 of the upload keystore), `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`, `ANDROID_STORE_PASSWORD`.

iOS: `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_TEAM_ID`,
`APPLE_PROVISIONING_PROFILE_BASE64` (bundle id `com.howland.app`; the profile NAME is derived
from the file — no separate name secret).

Publishing (shared with the desktop legs): `RELEASES_PAT`, `contents:write` on
`ayers-software-repair/howland-releases`.
