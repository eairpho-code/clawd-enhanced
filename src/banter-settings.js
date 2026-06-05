// Banter settings panel — display + preview via standard settings IPC
const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWin = process.platform === "win32";
const PANEL_WIDTH = 360;
const PANEL_HEIGHT = 370;

function createBanterSettingsWindow({ settingsController, banterBubble, getPetBounds, parentWin }) {
  let win = null;

  function getPrefs() {
    const snap = settingsController.getSnapshot();
    return {
      banterEnabled: snap.banterEnabled !== false,
      banterColor: snap.banterColor || "#1e1e1e",
      banterOpacity: snap.banterOpacity ?? 88,
      banterScale: snap.banterScale ?? 100,
    };
  }

  function open() {
    if (win && !win.isDestroyed()) { win.focus(); return; }

    win = new BrowserWindow({
      width: PANEL_WIDTH, height: PANEL_HEIGHT,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      title: "Banter Settings",
      ...(isMac ? {} : { autoHideMenuBar: true }),
      ...(isLinux ? { type: "dialog" } : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload-banter-settings.js"),
        nodeIntegration: false, contextIsolation: true,
      },
    });

    if (parentWin && !parentWin.isDestroyed()) {
      const pb = parentWin.getBounds();
      win.setBounds({
        x: Math.round(pb.x + (pb.width - PANEL_WIDTH) / 2),
        y: Math.round(pb.y + (pb.height - PANEL_HEIGHT) / 2),
        width: PANEL_WIDTH, height: PANEL_HEIGHT,
      });
    }

    win.loadFile(path.join(__dirname, "banter-settings.html"));
    win.on("closed", () => { win = null; });
  }

  // Read-only load — all writes go through settings:update IPC
  ipcMain.handle("banter-settings:load", () => getPrefs());

  // Preview — show sample bubble with current UI values (no save)
  ipcMain.handle("banter-settings:preview", (_event, prefs) => {
    const bounds = typeof getPetBounds === "function" ? getPetBounds() : null;
    if (!bounds || !bounds.width) return { status: "error", message: "Pet not visible" };
    banterBubble.updateConfig({
      color: prefs.banterColor,
      opacity: prefs.banterOpacity,
      scale: prefs.banterScale,
    });
    banterBubble.show("Preview 👋", bounds);
    return { status: "ok" };
  });

  ipcMain.on("banter-settings:close", () => {
    if (win && !win.isDestroyed()) win.close();
  });

  return { open, getPrefs };
}

module.exports = { createBanterSettingsWindow };
