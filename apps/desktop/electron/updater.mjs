import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ELECTRON_UPDATER_CHANNEL_FILENAME = "electron-updater-channel.v1.json";

// In dev mode, app.getVersion() returns the Electron framework version
// (e.g. "35.7.5") instead of the OpenWork app version. Read from
// package.json so the UI always shows the correct version.
const __updater_dirname = path.dirname(fileURLToPath(import.meta.url));
let _cachedAppVersion = null;
function resolveAppVersion(app) {
  if (_cachedAppVersion) return _cachedAppVersion;
  const electronVersion = app.getVersion();
  // If packaged, app.getVersion() is correct (set by electron-builder).
  if (app.isPackaged) {
    _cachedAppVersion = electronVersion;
    return electronVersion;
  }
  // In dev, read from package.json.
  try {
    const pkgPath = path.resolve(__updater_dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    _cachedAppVersion = pkg.version || electronVersion;
  } catch {
    _cachedAppVersion = electronVersion;
  }
  return _cachedAppVersion;
}
// Howland: the update feed points at HOWLAND's releases, never upstream OpenWork — the upstream
// feed would offer stock OpenWork as an "update" and overwrite this build. Howland releases carry
// no electron-updater metadata (stable asset names, one release train, no latest*.yml uploaded),
// so checkForUpdates would GET latest-mac.yml, receive a 404, and surface the RAW HTTP ERROR in
// Settings -> Updates on every packaged launch. OWNER RULING 2026-08-24: auto-update SHIPS in
// 1.0 — release.yml publishes stable-named metadata per platform+arch (see
// howlandUpdaterChannel below), the update payloads are the same stable-named assets the
// site serves, and the server preflight sweeps the metadata URLs so a 404 here is caught
// before a release, not on every user's machine forever. It can never pull upstream.
const ELECTRON_UPDATER_FEEDS = Object.freeze({
  stable: "https://github.com/ayers-software-repair/howland-releases/releases/latest/download",
  alpha: "https://github.com/ayers-software-repair/howland-releases/releases/latest/download",
});

function normalizeElectronUpdaterChannel(value) {
  if (value === "alpha" && process.platform === "darwin") return "alpha";
  return "stable";
}

function electronUpdaterChannelPath(app) {
  return path.join(app.getPath("userData"), ELECTRON_UPDATER_CHANNEL_FILENAME);
}

// Auto-update preference (owner ruling 2026-08-24): default ON, the user may opt out, and
// opting out must leave a WORKING manual path — the explicit check below never consults it.
// Same shape as platform/settings on the Go side: an ABSENT field reads as ON, so an install
// that predates the toggle keeps the behaviour it shipped with instead of silently going
// quiet. Store-distributed heads are out of scope; the store owns their lifecycle.
const AUTO_UPDATE_FILENAME = "auto-update.v1.json";

function autoUpdatePath(app) {
  return path.join(app.getPath("userData"), AUTO_UPDATE_FILENAME);
}

async function readAutoUpdate(app) {
  try {
    const parsed = JSON.parse(await readFile(autoUpdatePath(app), "utf8"));
    return typeof parsed?.autoUpdate === "boolean" ? parsed.autoUpdate : true;
  } catch {
    return true;
  }
}

async function writeAutoUpdate(app, enabled) {
  const outputPath = autoUpdatePath(app);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ autoUpdate: Boolean(enabled), writtenAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return Boolean(enabled);
}

async function readElectronUpdaterChannel(app) {
  try {
    const raw = await readFile(electronUpdaterChannelPath(app), "utf8");
    const parsed = JSON.parse(raw);
    return normalizeElectronUpdaterChannel(parsed?.channel);
  } catch {
    return "stable";
  }
}

async function writeElectronUpdaterChannel(app, channel) {
  const normalized = normalizeElectronUpdaterChannel(channel);
  const outputPath = electronUpdaterChannelPath(app);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ channel: normalized, writtenAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return normalized;
}

function electronUpdaterFeedUrl(channel) {
  return ELECTRON_UPDATER_FEEDS[normalizeElectronUpdaterChannel(channel)];
}

function parseComparableVersion(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^v/i, "");
  if (!normalized) return null;

  const [versionCore] = normalized.split("+", 1);
  if (!versionCore) return null;

  const [releasePart, prereleasePart = ""] = versionCore.split("-", 2);
  const release = releasePart.split(".").map((segment) => Number(segment));
  if (!release.length || release.some((segment) => !Number.isInteger(segment) || segment < 0)) {
    return null;
  }

  const prerelease = prereleasePart
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return { release, prerelease };
}

function comparePrereleaseIdentifiers(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;

  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftNumeric = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumeric = /^\d+$/.test(rightPart) ? Number(rightPart) : null;

    if (leftNumeric !== null && rightNumeric !== null) {
      if (leftNumeric !== rightNumeric) return leftNumeric < rightNumeric ? -1 : 1;
      continue;
    }

    if (leftNumeric !== null) return -1;
    if (rightNumeric !== null) return 1;

    const comparison = leftPart.localeCompare(rightPart);
    if (comparison !== 0) return comparison < 0 ? -1 : 1;
  }

  return 0;
}

function compareVersions(left, right) {
  const parsedLeft = parseComparableVersion(left);
  const parsedRight = parseComparableVersion(right);
  if (!parsedLeft || !parsedRight) return null;

  const count = Math.max(parsedLeft.release.length, parsedRight.release.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = parsedLeft.release[index] ?? 0;
    const rightPart = parsedRight.release[index] ?? 0;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }

  return comparePrereleaseIdentifiers(parsedLeft.prerelease, parsedRight.prerelease);
}

function isVersionNewer(candidate, current) {
  const comparison = compareVersions(candidate, current);
  return comparison === null ? candidate !== current : comparison > 0;
}

function updaterChannelState(app, channel) {
  const normalized = normalizeElectronUpdaterChannel(channel);
  return {
    channel: normalized,
    feedUrl: electronUpdaterFeedUrl(normalized),
    currentVersion: resolveAppVersion(app),
  };
}

// One metadata file per platform+arch, EXPLICITLY — electron-updater's filename heuristics
// would happily hand an arm64 Mac the Intel zip because Howland's stable names carry no
// upstream-style arch tokens. The names here must match release.yml's metadata rename step.
function howlandUpdaterChannel() {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "darwin") return arch === "arm64" ? "latest-mac" : "latest-mac-x64";
  if (process.platform === "win32") return arch === "arm64" ? "latest-arm64" : "latest";
  return arch === "arm64" ? "latest-linux-arm64" : "latest-linux";
}

async function applyElectronUpdaterFeed(app, updater) {
  const channel = await readElectronUpdaterChannel(app);
  const state = updaterChannelState(app, channel);
  updater.allowPrerelease = state.channel === "alpha";
  // Moving from alpha back to stable can be a semver downgrade; still show
  // the latest stable so users can return to the stable channel deliberately.
  updater.allowDowngrade = state.channel === "stable";
  if (updater?.setFeedURL) {
    updater.setFeedURL({ provider: "generic", url: state.feedUrl, channel: howlandUpdaterChannel() });
  }
  return state;
}

function runDefaults(args) {
  return new Promise((resolve) => {
    execFile("/usr/bin/defaults", args, (error) => {
      // Best-effort: a failure here just means we fall back to Squirrel's
      // default move-based install. Never block the update on it.
      if (error) console.warn("[updater] defaults write failed", error?.message ?? error);
      resolve(undefined);
    });
  });
}

// Squirrel.Mac's `ShipIt` helper (which swaps the .app on macOS) reads its
// options from this NSUserDefaults domain.
// Squirrel.Mac derives this domain from the BUNDLE id, and Howland packs
// -c.appId=com.howland.app (release.yml) - the old upstream literal wrote and cleaned a
// domain no shipped bundle ever used.
const SHIP_IT_DEFAULTS_DOMAIN = "com.howland.app.ShipIt";

// Squirrel.Mac defaults to moving the *entire* app bundle through a temp
// directory. On repeat installs that move can leave the staged bundle missing,
// producing:
//   "Failed to copy bundle … no such file or directory"
//   "Too many attempts to install, aborting update"
// and silently relaunching the OLD app (so the in-app version looks updated
// while the on-disk renderer stays stale). Enabling DirectContentsWrite makes
// ShipIt write file contents in place instead of moving whole bundles, which
// avoids the ENOENT abort.
async function enableSquirrelDirectContentsWrite() {
  if (process.platform !== "darwin") return;
  await runDefaults(["write", SHIP_IT_DEFAULTS_DOMAIN, "SquirrelMacEnableDirectContentsWrite", "-bool", "YES"]);
}

// Path of the ShipIt cache that, when stuck, keeps aborting future installs.
// Exported for tests.
export function staleUpdaterStatePaths(app) {
  if (process.platform !== "darwin") return [];
  const home = app.getPath("home");
  return [path.join(home, "Library", "Caches", SHIP_IT_DEFAULTS_DOMAIN)];
}

// Remove a previously-failed, half-applied update so the next attempt starts
// from a clean slate. A stuck `ShipIt` state (after "Too many attempts to
// install, aborting update") can otherwise keep aborting future installs.
async function cleanStaleUpdaterState(app) {
  for (const target of staleUpdaterStatePaths(app)) {
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      console.warn("[updater] failed to clean stale state", target, error?.message ?? error);
    }
  }
}

// electron-updater wiring. Packaged-only; dev builds skip this so the
// updater doesn't try to probe a non-existent release channel.
export function registerUpdaterIpc({ app, ipcMain, getMainWindow }) {
  let autoUpdaterInstance = null;
  let autoUpdaterLoaded = false;
  let checkedUpdateVersion = null;

  function sendToRenderer(channel, data) {
    try {
      const win = typeof getMainWindow === "function" ? getMainWindow() : null;
      if (win?.webContents && !win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    } catch {
      // Window may be closed; swallow send failures.
    }
  }

  async function ensureAutoUpdater() {
    if (!app.isPackaged) return null;
    if (autoUpdaterLoaded) return autoUpdaterInstance;
    autoUpdaterLoaded = true;
    try {
      const mod = await import("electron-updater");
      autoUpdaterInstance = mod.autoUpdater ?? mod.default?.autoUpdater ?? null;
      if (autoUpdaterInstance) {
        // Gated on the preference: with auto-update off nothing downloads and nothing is
        // staged for install on quit. Re-applied on every check (applyAutoUpdatePreference)
        // so flipping the toggle takes effect without a restart. autoDownload stays false
        // even when ON — a download is the user's click; the preference governs the CHECK
        // and the install-on-quit staging.
        autoUpdaterInstance.autoDownload = false;
        autoUpdaterInstance.autoInstallOnAppQuit = await readAutoUpdate(app);
        // Differential (blockmap) downloads reconstruct the update zip from the
        // installed app + a diff. On macOS that reconstructed bundle is what
        // feeds Squirrel's fragile move-based install, and is a common trigger
        // for the "Failed to copy bundle … no such file" abort. Download the
        // full zip instead — alpha builds are swapped wholesale anyway.
        autoUpdaterInstance.disableDifferentialDownload = true;
        // Make Squirrel.Mac write contents in place rather than moving whole
        // bundles (see enableSquirrelDirectContentsWrite for why).
        await enableSquirrelDirectContentsWrite();
        autoUpdaterInstance.on("error", (err) => {
          console.warn("[updater] error", err);
        });
        // Forward download progress to the renderer so the UI can show
        // incremental bytes instead of staying stuck at 0.
        autoUpdaterInstance.on("download-progress", (info) => {
          sendToRenderer("openwork:updater:download-progress", {
            bytesPerSecond: info.bytesPerSecond ?? 0,
            percent: info.percent ?? 0,
            transferred: info.transferred ?? 0,
            total: info.total ?? 0,
            delta: info.delta ?? 0,
          });
        });
        await applyElectronUpdaterFeed(app, autoUpdaterInstance);
      }
    } catch (error) {
      console.warn("[updater] electron-updater not available", error);
      autoUpdaterInstance = null;
    }
    return autoUpdaterInstance;
  }

  ipcMain.handle("openwork:updater:getChannel", async () => {
    const channel = await readElectronUpdaterChannel(app);
    return updaterChannelState(app, channel);
  });

  ipcMain.handle("openwork:updater:setChannel", async (_event, rawChannel) => {
    const channel = await writeElectronUpdaterChannel(app, rawChannel);
    checkedUpdateVersion = null;
    const updater = await ensureAutoUpdater();
    if (updater) {
      return applyElectronUpdaterFeed(app, updater);
    }
    return updaterChannelState(app, channel);
  });

  ipcMain.handle("openwork:updater:getAutoUpdate", async () => ({ autoUpdate: await readAutoUpdate(app) }));

  ipcMain.handle("openwork:updater:setAutoUpdate", async (_event, enabled) => {
    const value = await writeAutoUpdate(app, enabled);
    // Apply to the live instance so the choice takes effect without a restart. With it off
    // nothing is staged for install on quit; the explicit check below still works, which is
    // what keeps opting out from being a dead end (owner ruling 2026-08-24).
    const updater = await ensureAutoUpdater();
    if (updater) updater.autoInstallOnAppQuit = value;
    return { autoUpdate: value };
  });

  // manual defaults TRUE: every existing call site is a user action (the Settings button,
  // the native Check for Updates menu item, a channel change). Only the renderer's
  // check-on-launch effect passes false, and that is the one the preference may suppress.
  ipcMain.handle("openwork:updater:check", async (_event, rawChannel, manual = true) => {
    if (rawChannel !== undefined) {
      await writeElectronUpdaterChannel(app, rawChannel);
    }
    const autoUpdate = await readAutoUpdate(app);
    // The gate lives HERE, in the process that makes the outbound request — the renderer
    // gates its own effect too, but the published disclosure ("turning it off stops the
    // checks") is a claim about network behaviour, so it is enforced where the network is.
    // A user-initiated check is never suppressed; that is what keeps opt-out from being a
    // dead end (owner ruling 2026-08-24).
    if (!manual && !autoUpdate) {
      return {
        available: false,
        reason: "auto-update-off",
        currentVersion: resolveAppVersion(app),
        ...updaterChannelState(app, await readElectronUpdaterChannel(app)),
      };
    }
    const updater = await ensureAutoUpdater();
    const channelState = updater
      ? await applyElectronUpdaterFeed(app, updater)
      : updaterChannelState(app, await readElectronUpdaterChannel(app));
    if (!updater) return { available: false, reason: "unavailable", ...channelState };
    updater.autoInstallOnAppQuit = autoUpdate;
    try {
      const result = await updater.checkForUpdates();
      const info = result?.updateInfo ?? null;
      const currentVersion = resolveAppVersion(app);
      const available = Boolean(info?.version && isVersionNewer(info.version, currentVersion));
      checkedUpdateVersion = available ? info.version : null;
      return {
        available,
        currentVersion,
        latestVersion: info?.version ?? null,
        releaseDate: info?.releaseDate ?? null,
        releaseNotes: info?.releaseNotes ?? null,
        ...channelState,
      };
    } catch (error) {
      checkedUpdateVersion = null;
      return { available: false, reason: String(error?.message ?? error), ...channelState };
    }
  });

  ipcMain.handle("openwork:updater:download", async () => {
    const updater = await ensureAutoUpdater();
    if (!updater) return { ok: false, reason: "unavailable" };
    try {
      await applyElectronUpdaterFeed(app, updater);
      const currentVersion = resolveAppVersion(app);
      if (!checkedUpdateVersion || !isVersionNewer(checkedUpdateVersion, currentVersion)) {
        const result = await updater.checkForUpdates();
        const info = result?.updateInfo ?? null;
        checkedUpdateVersion = info?.version && isVersionNewer(info.version, currentVersion)
          ? info.version
          : null;
      }
      if (!checkedUpdateVersion) {
        return { ok: false, reason: "No update available." };
      }
      // Clear any stuck ShipIt state from a prior aborted install so this
      // download applies cleanly on quit.
      await cleanStaleUpdaterState(app);
      await updater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) };
    }
  });

  ipcMain.handle("openwork:updater:installAndRestart", async () => {
    const updater = await ensureAutoUpdater();
    if (!updater) return { ok: false, reason: "unavailable" };
    try {
      // Re-assert the in-place-write default right before the swap; the ShipIt
      // defaults domain may have been wiped when stale state was cleaned.
      await enableSquirrelDirectContentsWrite();
      updater.quitAndInstall(false, true);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) };
    }
  });

  return { ensureAutoUpdater };
}
