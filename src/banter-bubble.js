// Banter bubble — adaptive size, text + interaction modes
const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWin = process.platform === "win32";

const SHOW_DURATION_MS = 3000;
const REPLY_DURATION_MS = 3500;
const BASE_GAP_RATIO = 0.010;
const MAX_WIDTH = 420;
const MIN_WIDTH = 120;

let activeChoiceCallback = null;
let activeBubbleWin = null; // module-level ref for IPC resize

function createBanterBubble(options = {}) {
  let bubbleWin = null;
  let hideTimer = null;
  let fadeTimer = null;
  let currentScale = options.scale || 100;

  // Sync module-level ref
  function setWin(w) { bubbleWin = w; activeBubbleWin = w; }

  function calcGap(petHeight) {
    return Math.max(2, Math.round(petHeight * BASE_GAP_RATIO * (currentScale / 100)));
  }

  function calcY(petBounds) {
    return Math.round(petBounds.y + petBounds.height + calcGap(petBounds.height));
  }

  function destroyWindow() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.destroy();
    setWin(null);
    activeChoiceCallback = null;
  }

  function createWin(petBounds) {
    const w = new BrowserWindow({
      width: 140, height: 44,
      x: Math.round(petBounds.x + (petBounds.width - 140) / 2),
      y: calcY(petBounds),
      frame: false, transparent: true, alwaysOnTop: !isMac,
      resizable: false, skipTaskbar: true, hasShadow: false, focusable: false,
      ...(isLinux ? { type: "toolbar" } : {}),
      ...(isMac ? { type: "panel" } : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload-banter-bubble.js"),
        nodeIntegration: false, contextIsolation: true,
      },
    });
    if (isWin) w.setAlwaysOnTop(true, "pop-up-menu");
    w.loadFile(path.join(__dirname, "banter-bubble.html"));
    return w;
  }

  function ensureWindow(petBounds) {
    if (bubbleWin && !bubbleWin.isDestroyed()) {
      const b = bubbleWin.getBounds();
      bubbleWin.setBounds({
        x: Math.round(petBounds.x + (petBounds.width - b.width) / 2),
        y: calcY(petBounds), width: b.width, height: b.height,
      });
      return bubbleWin;
    }
    setWin(createWin(petBounds));
    return bubbleWin;
  }

  function startAutoDismiss(ms) {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (!bubbleWin || bubbleWin.isDestroyed()) { setWin(null); return; }
      bubbleWin.webContents.executeJavaScript(
        `document.getElementById('bubble').classList.add('out')`
      ).catch(() => {});
      fadeTimer = setTimeout(() => {
        fadeTimer = null;
        if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.destroy();
        setWin(null);
      }, 150);
    }, ms);
  }

  return {
    show(text, petBounds) {
      destroyWindow();
      const win = ensureWindow(petBounds);
      const send = () => {
        if (!bubbleWin || bubbleWin.isDestroyed()) return;
        bubbleWin.webContents.send("banter-bubble:show-text", text);
        startAutoDismiss(SHOW_DURATION_MS);
      };
      if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
      else send();
    },

    showInteraction(question, choices, petBounds, onChoice) {
      destroyWindow();
      activeChoiceCallback = onChoice;
      const win = ensureWindow(petBounds);
      const send = () => {
        if (!bubbleWin || bubbleWin.isDestroyed()) return;
        bubbleWin.webContents.send("banter-bubble:interaction", { question, choices });
      };
      if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
      else send();
    },

    showReply(text) {
      if (!bubbleWin || bubbleWin.isDestroyed()) return;
      bubbleWin.webContents.send("banter-bubble:reply", text);
      startAutoDismiss(REPLY_DURATION_MS);
    },

    updatePosition(petBounds) {
      if (!bubbleWin || bubbleWin.isDestroyed()) return;
      const b = bubbleWin.getBounds();
      bubbleWin.setBounds({
        x: Math.round(petBounds.x + (petBounds.width - b.width) / 2),
        y: calcY(petBounds), width: b.width, height: b.height,
      });
    },

    updateConfig({ scale } = {}) {
      if (scale !== undefined) currentScale = scale;
    },

    isVisible() { return !!(bubbleWin && !bubbleWin.isDestroyed()); },
    destroy() { destroyWindow(); },
  };
}

// ── IPC handlers ──

ipcMain.on("banter-bubble:choose", (_event, index) => {
  if (typeof activeChoiceCallback === "function") {
    const cb = activeChoiceCallback;
    activeChoiceCallback = null;
    cb(Number(index));
  }
});

ipcMain.on("banter-bubble:resize", (_event, w, h) => {
  if (!activeBubbleWin || activeBubbleWin.isDestroyed()) return;
  const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(w) + 4));
  const newH = Math.ceil(h) + 4;
  const b = activeBubbleWin.getBounds();
  if (Math.abs(b.width - newW) > 2 || Math.abs(b.height - newH) > 2) {
    activeBubbleWin.setBounds({
      x: Math.round(b.x + (b.width - newW) / 2),
      y: b.y, width: newW, height: newH,
    });
  }
});

module.exports = { createBanterBubble };
