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
    // Howland servers are self-hosted on the user's LAN, tailnet, or reachable via mDNS
    // (http://10.x.x.x:31052, http://100.x.y.z:31052, http://myhowland.local:31052 style), so
    // the Android WebView needs cleartext enabled to even attempt an http:// load. This stays
    // true unconditionally -- not only for a build-time server.url: the shipped app must be
    // able to connect to whatever box the user owns. (Per Capacitor's docs this flag's effect
    // is Android-specific, working around Android 9+'s default cleartext block; it does
    // nothing on iOS, whose http gate is ATS, handled entirely via Info.plist -- see below.)
    //
    // This flag is NOT the security boundary and does not by itself decide which hosts
    // cleartext is actually permitted to reach -- that scoping happens at the OS level,
    // patched into the generated native projects by the release workflow AFTER `cap add`/
    // `cap sync` (capacitor.config.ts runs before those native projects exist, so it cannot
    // set OS-level network policy itself):
    //   - Android: android/app/src/main/res/xml/network_security_config.xml, referenced via
    //     android:networkSecurityConfig -- see mobile-release.yml step "Allow self-hosted
    //     http servers (Android)".
    //   - iOS: Info.plist NSAppTransportSecurity -> NSAllowsLocalNetworking (deliberately NOT
    //     NSAllowsArbitraryLoads, the app-wide ATS kill switch App Store review flags) plus
    //     NSLocalNetworkUsageDescription -- see mobile-release.yml steps "Allow self-hosted
    //     http servers (iOS ATS)" and "Declare local network usage (iOS)".
    // Leaving this `cleartext: true` does not widen those exceptions; it only lets the
    // Android WebView issue the request in the first place, which the config above then
    // allows or blocks. Do not "simplify" this back to a blanket everywhere-allowed comment --
    // the actual scope is intentionally narrower and lives in the files listed above.
    cleartext: true,
    ...(serverUrl ? { url: serverUrl } : {}),
    ...(allowNavigation.length > 0 ? { allowNavigation } : {}),
  },
};

export default config;
