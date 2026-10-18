// Native application menu: template installation, the macOS/system menu
// actions that forward into the renderer (settings, updates, sidebar, zoom),
// and Windows/Linux menu-bar visibility. Extracted from main.mjs as a
// factory (createRuntimeManager pattern); the NATIVE_MENU_* channels are
// consumed by the preload bridge.
import { BrowserWindow, Menu, shell } from "electron";
import { runDetachedTask } from "./process-resilience.mjs";

const NATIVE_MENU_OPEN_SETTINGS_EVENT = "openwork:native-menu:open-settings";
const NATIVE_MENU_TOGGLE_SIDEBAR_EVENT = "openwork:native-menu:toggle-sidebar";
const NATIVE_MENU_CHECK_UPDATES_EVENT = "openwork:native-menu:check-updates";
const NATIVE_MENU_ZOOM_EVENT = "openwork:native-menu:zoom";

export function createApplicationMenu({ appName, docsUrl, reportIssueUrl, howlandUrls, getWindow, closeBrowserTab }) {
  let applicationMenuVisible = process.platform === "darwin";
  let currentAppName = appName;

  async function openSettingsFromNativeMenu() {
    const win = await getWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send(NATIVE_MENU_OPEN_SETTINGS_EVENT);
  }

  async function checkForUpdatesFromNativeMenu() {
    const win = await getWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send(NATIVE_MENU_CHECK_UPDATES_EVENT);
  }

  async function toggleSidebarFromNativeMenu() {
    const win = await getWindow();
    win.webContents.send(NATIVE_MENU_TOGGLE_SIDEBAR_EVENT);
  }

  // Zoom must flow through the renderer's font-zoom pathway so the persisted
  // preference and the applied webContents zoom factor never drift apart. The
  // built-in resetZoom/zoomIn/zoomOut roles bypass that pathway (and zoom
  // whichever webContents is focused, including the embedded browser view).
  async function zoomFromNativeMenu(action) {
    const win = await getWindow();
    win.webContents.send(NATIVE_MENU_ZOOM_EVENT, action);
  }

  // The Howland menu opens each of the server's dashboards. The address is resolved per click
  // (it reads the configured server and asks it which ports its services are on).
  async function openHowland(part) {
    const target = (await howlandUrls())?.[part];
    if (target) await shell.openExternal(target);
  }

  function install() {
    const isMac = process.platform === "darwin";
    const closeItem = {
      label: "Close",
      accelerator: "CommandOrControl+W",
      click: (_item, focusedWindow) => {
        const host = focusedWindow ?? BrowserWindow.getFocusedWindow();
        if (host && !closeBrowserTab?.(host)) host.close();
      },
    };
    const template = /** @type {import("electron").MenuItemConstructorOptions[]} */ ([
      ...(isMac
        ? [
            {
              label: currentAppName,
              submenu: [
                { role: "about" },
                {
                  label: "Check for Updates...",
                  click: () => {
                    runDetachedTask("check for updates from menu", checkForUpdatesFromNativeMenu);
                  },
                },
                { type: "separator" },
                {
                  label: "Settings...",
                  accelerator: "Command+,",
                  click: () => {
                    runDetachedTask("open settings from menu", openSettingsFromNativeMenu);
                  },
                },
                { type: "separator" },
                { role: "services" },
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ]
        : []),
      {
        label: "File",
        submenu: [
          ...(isMac
            ? []
            : [
                {
                  label: "Settings",
                  accelerator: "Control+,",
                  click: () => {
                    runDetachedTask("open settings from menu", openSettingsFromNativeMenu);
                  },
                },
                { type: "separator" },
              ]),
          closeItem,
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          ...(isMac
            ? [
                { role: "pasteAndMatchStyle" },
                { role: "delete" },
                { role: "selectAll" },
                { type: "separator" },
                {
                  label: "Speech",
                  submenu: [
                    { role: "startSpeaking" },
                    { role: "stopSpeaking" },
                  ],
                },
                { type: "separator" },
                {
                  label: "Settings...",
                  click: () => {
                    runDetachedTask("open settings from menu", openSettingsFromNativeMenu);
                  },
                },
              ]
            : [
                { role: "delete" },
                { type: "separator" },
                { role: "selectAll" },
              ]),
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Toggle Sidebar",
            accelerator: "CommandOrControl+B",
            click: () => {
              runDetachedTask("toggle sidebar from menu", toggleSidebarFromNativeMenu);
            },
          },
          { type: "separator" },
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          {
            label: "Actual Size",
            accelerator: "CommandOrControl+0",
            click: () => {
              runDetachedTask("reset zoom from menu", () => zoomFromNativeMenu("reset"));
            },
          },
          {
            label: "Zoom In",
            accelerator: "CommandOrControl+Plus",
            click: () => {
              runDetachedTask("zoom in from menu", () => zoomFromNativeMenu("in"));
            },
          },
          {
            label: "Zoom Out",
            accelerator: "CommandOrControl+-",
            click: () => {
              runDetachedTask("zoom out from menu", () => zoomFromNativeMenu("out"));
            },
          },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          ...(isMac
            ? [
                { type: "separator" },
                { role: "front" },
                { type: "separator" },
                { role: "window" },
              ]
            : [
                closeItem,
              ]),
        ],
      },
      // Rendered only when the embedder supplies a resolver, so builds without a server see no change.
      ...(howlandUrls
        ? [
            {
              label: "Howland",
              submenu: [
                { label: "Hub", click: () => runDetachedTask("open Howland hub", () => openHowland("hub")) },
                { type: "separator" },
                { label: "Library", click: () => runDetachedTask("open Howland library", () => openHowland("library")) },
                { label: "Navigator", click: () => runDetachedTask("open Howland navigator", () => openHowland("navigator")) },
                { label: "Search", click: () => runDetachedTask("open Howland search", () => openHowland("search")) },
                { type: "separator" },
                { label: "Monitor", click: () => runDetachedTask("open Howland monitor", () => openHowland("monitor")) },
                { label: "Set Up Another Computer", click: () => runDetachedTask("open Howland connect", () => openHowland("connect")) },
                { label: "Server Settings", click: () => runDetachedTask("open Howland settings", () => openHowland("settings")) },
              ],
            },
          ]
        : []),
      {
        role: "help",
        submenu: [
          ...(isMac
            ? []
            : [
                {
                  label: "Check for Updates...",
                  click: () => {
                    runDetachedTask("check for updates from menu", checkForUpdatesFromNativeMenu);
                  },
                },
                { type: "separator" },
              ]),
          {
            label: "Docs",
            click: () => {
              runDetachedTask("open documentation from menu", () => shell.openExternal(docsUrl));
            },
          },
          // Rendered only when the embedder passes reportIssueUrl.
          ...(reportIssueUrl
            ? [
                {
                  label: "Report a Problem",
                  click: () => {
                    runDetachedTask("open issue tracker from menu", () => shell.openExternal(reportIssueUrl));
                  },
                },
              ]
            : []),
        ],
      },
    ]);

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function applyVisibility(window) {
    if (process.platform === "darwin") return;
    window.setAutoHideMenuBar(false);
    window.setMenuBarVisibility(applicationMenuVisible);
  }

  function setVisible(visible) {
    applicationMenuVisible = visible === true;
    for (const window of BrowserWindow.getAllWindows()) {
      applyVisibility(window);
    }
    return applicationMenuVisible;
  }

  function setAppName(nextAppName) {
    currentAppName = typeof nextAppName === "string" && nextAppName.trim() ? nextAppName.trim() : appName;
    install();
    return currentAppName;
  }

  return { install, applyVisibility, setVisible, setAppName };
}
