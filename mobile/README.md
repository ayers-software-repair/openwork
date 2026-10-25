# Howland Mobile (Capacitor)

Native iOS and Android wrappers around the Howland web UI (`apps/app`), built with
[Capacitor](https://capacitorjs.com/). This directory is a **standalone npm project** that
lives at the repo root on purpose: the pnpm workspace globs `apps/*` and `packages/*`, so
placing it under `apps/` would pull Capacitor into the workspace lockfile and break
`pnpm install --frozen-lockfile` in the desktop build workflows. Install its deps with
`npm install` from inside `mobile/`, not pnpm.

## Status (honest)

**The Android path is build-verified**: on 2026-08-31 the full chain (web bundle ->
`cap add android` -> `cap sync` -> `gradle assembleDebug`) produced a debug-signed APK
locally, first try after one environment fix (a JDK with a compiler). Runtime behavior on
a real device is still unvalidated, and iOS still needs a real macOS/Xcode environment
plus signing keys to produce anything installable. The native `android/` and `ios/` projects are **generated on the
runner** (they are not committed) by `npx cap add`. Runtime behavior (Electron-only APIs in
the web app, connecting to a Howland server) has not been validated on a device.

## What is here

- `capacitor.config.ts` — appId `repair.ayers.howland`, appName `Howland`, `webDir: dist`, and a
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
separate mobile workflow is folded in). The `build-android` leg uploads the signed
`Howland-Client-Android.aab` (Google Play) and `.apk` (Amazon Appstore) as the `store-android`
Actions artifact; neither ever reaches the release page, because phones install from stores only
(owner, D1625). When `vars.PLAY_SUBMISSION_ENABLED` is `true` the leg also uploads the AAB to
Play's internal track through the platform kit's `play-upload` action; the APK stays a hand upload
to Amazon. Without its signing secrets the leg builds only the
debug-signed `unsigned-android` twin for testing.

iOS builds in **`.github/workflows/ios-submission.yml`** — its own dispatch, out of the
release chain. It HARD FAILS without signing secrets, and its `.ipa` is a 90-day CI artifact
on the run page (never a release asset; App Store Connect is the channel). Dispatched with
`submit`, it also validates and uploads the `.ipa` through the platform kit's `app-store-upload`
action; that refuses to start unless `vars.APPLE_SUBMISSION_ENABLED` is `true`. The export
`method` defaults to `app-store`; change it (with a matching provisioning profile) to
`ad-hoc` or `development` for direct device sideloading.

Secrets, named exactly as the workflows read them:

Android: `ANDROID_KEYSTORE_BASE64` (base64 of the upload keystore), `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`, `ANDROID_STORE_PASSWORD`.

iOS: `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_TEAM_ID`,
`APPLE_PROVISIONING_PROFILE_BASE64` (bundle id `repair.ayers.howland`; the profile NAME is derived
from the file — no separate name secret). Submission adds `APP_STORE_CONNECT_KEY_P8` (the `.p8`
text), `APP_STORE_CONNECT_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`.

Play upload: variables `PLAY_SUBMISSION_ENABLED`, `GCP_WORKLOAD_IDENTITY_PROVIDER` and
`GCP_PLAY_SERVICE_ACCOUNT` (keyless, over OIDC). Both uploads also need `PLATFORM_READ_KEY` to
check the kit out.

Publishing (shared with the desktop legs): `RELEASES_PAT`, `contents:write` on
`ayers-software-repair/howland-releases`.
