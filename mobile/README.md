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

`.github/workflows/mobile-release.yml` builds Android (APK + AAB) and iOS (IPA) on tag
`howland-v*` or `howland-mobile-v*`, renames outputs to stable names
(`Howland-Client-Android.apk`, `Howland-Client-Android.aab`, `Howland-Client-iOS-arm64.ipa`), and publishes them to
`ayers-software-repair/howland-releases`.

**Signing is gated on repository secrets.** When a platform's signing secrets are absent, the
build still **compiles** (proving it builds) but produces **no store-signed artifact**. Add
these secrets to complete signing:

Android:
- `ANDROID_KEYSTORE_BASE64` — base64 of your upload keystore (`base64 -i upload.keystore`).
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_STORE_PASSWORD`

iOS (Apple Developer account required):
- `APPLE_CERT_P12_BASE64` — base64 of your Distribution certificate `.p12`.
- `APPLE_CERT_PASSWORD` — password for that `.p12`.
- `APPLE_TEAM_ID` — your 10-character Apple Team ID.
- `APPLE_PROVISIONING_PROFILE_BASE64` — base64 of a provisioning profile whose bundle id is
  `com.howland.app`. The workflow derives the profile name from this file (no separate
  `APPLE_PROVISIONING_PROFILE_NAME` secret needed).

Also required to publish (already used by the desktop release workflow):
- `RELEASES_PAT` — a token with `contents:write` on `ayers-software-repair/howland-releases`.

The iOS export `method` in the workflow defaults to `app-store`; change it (and use a matching
provisioning profile) to `ad-hoc` or `development` for direct device sideloading.
