/// <reference types="@capacitor/cli" />
import type { CapacitorConfig } from "@capacitor/cli";

// Howland mobile (Capacitor) wrapper around the apps/app web build.
//
// This project lives at the repo root (NOT under apps/*) on purpose: the pnpm workspace
// globs `apps/*` and `packages/*`, so putting it there would pull its Capacitor deps into
// the workspace and break `pnpm install --frozen-lockfile` in every desktop workflow.
// It is a standalone npm project instead (install with `npm install` inside mobile/).
//
// webDir is `dist`: the CI workflow builds the web bundle
// (`pnpm --filter @openwork/app run build:web` -> apps/app/dist) and copies it to
// mobile/dist before `cap sync`. Keeping webDir inside this project (rather than
// `../apps/app/dist`) avoids Capacitor's out-of-root webDir edge cases.
//
// Server config: Howland is self-hosted, so the app must be able to reach a
// user-provided Howland/OpenWork server.
//   - HOWLAND_SERVER_URL: if set at build time, the webview loads that live server
//     (Capacitor server.url) instead of the bundled assets. Leave it unset to ship the
//     bundled UI and have the app talk to the server over the network at runtime.
//   - HOWLAND_ALLOWED_HOSTS: comma-separated hosts the in-app webview may navigate to
//     (Capacitor allowNavigation) so calls to the user's server are permitted.

const serverUrl = process.env.HOWLAND_SERVER_URL?.trim();
const allowNavigation = (process.env.HOWLAND_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const config: CapacitorConfig = {
  appId: "com.howland.app",
  appName: "Howland",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Howland servers are self hosted on the user's LAN or tailnet and speak plain http
    // (http://10.x.x.x:8095 style). cleartext is therefore ALWAYS on, not only for a
    // build-time server.url: the shipped app must be able to connect to whatever box the
    // user owns. iOS gets the matching ATS exception in the release workflow.
    cleartext: true,
    ...(serverUrl ? { url: serverUrl } : {}),
    ...(allowNavigation.length > 0 ? { allowNavigation } : {}),
  },
};

export default config;
