// Dev-watch banter — monitors project src/ changes and shows coding-themed quips
const fs = require("fs");
const path = require("path");

const DEBOUNCE_MS = 600;       // batch changes within this window
const COOLDOWN_MS = 30000;     // min time between banter bubbles
const FREQUENT_THRESHOLD = 3;  // edits to same file within FREQUENT_WINDOW_MS
const FREQUENT_WINDOW_MS = 300000; // 5 min

const EXT_JS = new Set([".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const EXT_CSS = new Set([".css", ".scss", ".less", ".html", ".vue", ".svelte", ".svg"]);

function createDevBanter({ getActiveCwd, showBubble }) {
  let watcher = null;
  let watchDir = null;
  let pendingChanges = [];
  let debounceTimer = null;
  let lastBanterAt = 0;
  let fileEditCounts = new Map(); // filePath → [{at, count}]

  function classify(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (EXT_JS.has(ext)) return "js";
    if (EXT_CSS.has(ext)) return "css";
    return null;
  }

  function isFrequent(filePath) {
    const abs = path.resolve(filePath);
    const now = Date.now();
    let entries = fileEditCounts.get(abs) || [];
    entries = entries.filter((e) => now - e.at < FREQUENT_WINDOW_MS);
    const count = entries.reduce((sum, e) => sum + e.count, 0) + 1;
    entries.push({ at: now, count: 1 });
    if (entries.length > 20) entries = entries.slice(-20);
    fileEditCounts.set(abs, entries);
    return count >= FREQUENT_THRESHOLD;
  }

  function pickBanter(categories) {
    if (categories.has("frequent")) return "dev_frequent";
    if (categories.has("css")) return "dev_css";
    if (categories.has("js")) return "dev_js";
    return null;
  }

  function flush() {
    if (pendingChanges.length === 0) return;
    const now = Date.now();
    if (now - lastBanterAt < COOLDOWN_MS) {
      pendingChanges = [];
      return;
    }

    const categories = new Set();
    let hasFrequent = false;
    for (const filePath of pendingChanges) {
      const cat = classify(filePath);
      if (cat) categories.add(cat);
      if (isFrequent(filePath)) hasFrequent = true;
    }
    if (hasFrequent) categories.add("frequent");

    const state = pickBanter(categories);
    if (state) {
      lastBanterAt = now;
      // Call the showBubble callback — main.js wires this to banterBubble.show()
      if (typeof showBubble === "function") {
        showBubble(state);
      }
    }
    pendingChanges = [];
  }

  function onChange(eventType, filename) {
    if (!filename) return;
    pendingChanges.push(filename);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  }

  function startWatching(cwd) {
    if (!cwd) return;
    const target = path.join(cwd, "src");
    try {
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return;
    } catch {
      return;
    }
    if (watchDir === target) return; // already watching
    stopWatching();
    watchDir = target;
    try {
      watcher = fs.watch(target, { recursive: true }, onChange);
    } catch {
      watcher = null;
      watchDir = null;
    }
  }

  function stopWatching() {
    if (watcher) {
      try { watcher.close(); } catch {}
      watcher = null;
    }
    watchDir = null;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    pendingChanges = [];
  }

  // Poll for cwd changes every 30s, restart watcher when cwd changes
  let pollTimer = null;
  let lastCwd = null;

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      const cwd = typeof getActiveCwd === "function" ? getActiveCwd() : null;
      if (cwd && cwd !== lastCwd) {
        lastCwd = cwd;
        startWatching(cwd);
      }
    }, 30000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    stopWatching();
    lastCwd = null;
  }

  return { startPolling, stopPolling, stopWatching };
}

module.exports = { createDevBanter };
