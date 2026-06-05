// Mood-driven Banter — infers user emotional state through simple heuristics.
// No ps, no port scan, no debugpy, no git watch. Just time + saves + errors.

const fs = require("fs");

// ── Timing constants ──
const THINKING_SAVE_WINDOW_MS = 60000;      // saves within 60s = "thinking"
const THINKING_SAVE_MIN = 3;                // ≥3 saves in window = thinking
const HYPERFOCUS_ACTION_WINDOW_MS = 120000; // continuous actions in 2min
const HYPERFOCUS_ACTION_MIN = 8;            // ≥8 actions = hyperfocus
const IDLE_TIMEOUT_MS = 600000;             // 10 min no activity = idle
const PROCRASTINATE_TIMEOUT_MS = 1200000;   // 20 min = procrastinating
const FRUSTRATED_COOLDOWN_MS = 120000;      // min gap between frustrated quips
const MOOD_COOLDOWN_MS = 90000;             // min gap between any mood quips

function createDevBehavior({ getActiveCwd, showBubble }) {
  // ── State ──
  let lastActivityAt = Date.now();
  let lastMoodAt = 0;
  let lastFrustratedAt = 0;
  let activityCount = 0;          // actions in current window
  let saveTimes = [];            // recent save timestamps
  let idleTimer = null;
  let procrastinateTimer = null;
  let compWatcher = null;
  let compWatchDir = null;
  let pollTimer = null;
  let lastCwd = null;

  function quip(state) {
    if (typeof showBubble !== "function") return;
    try { showBubble(state); } catch {}
  }

  function canMood() {
    const now = Date.now();
    if (now - lastMoodAt < MOOD_COOLDOWN_MS) return false;
    lastMoodAt = now;
    return true;
  }

  function noteActivity() {
    const now = Date.now();
    lastActivityAt = now;
    activityCount++;
    // Reset idle/procrastinate timers
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (procrastinateTimer) { clearTimeout(procrastinateTimer); procrastinateTimer = null; }
    // Schedule fresh timers
    idleTimer = setTimeout(checkIdle, IDLE_TIMEOUT_MS);
    procrastinateTimer = setTimeout(checkProcrastinate, PROCRASTINATE_TIMEOUT_MS);
  }

  // ── Mood checks ──

  function checkIdle() {
    const since = Date.now() - lastActivityAt;
    if (since >= PROCRASTINATE_TIMEOUT_MS) return; // let procrastinate handle it
    if (since >= IDLE_TIMEOUT_MS && canMood()) {
      quip("mood_idle");
    }
  }

  function checkProcrastinate() {
    const since = Date.now() - lastActivityAt;
    if (since >= PROCRASTINATE_TIMEOUT_MS && canMood()) {
      quip("mood_procrastinating");
    }
  }

  function checkHyperfocus() {
    const now = Date.now();
    if (activityCount >= HYPERFOCUS_ACTION_MIN && canMood()) {
      activityCount = 0;
      quip("mood_hyperfocus");
    }
    // Decay counter periodically
    setTimeout(() => {
      if (Date.now() - lastActivityAt > HYPERFOCUS_ACTION_WINDOW_MS) {
        activityCount = 0;
      }
    }, HYPERFOCUS_ACTION_WINDOW_MS);
  }

  // ── File save detection ──
  function onFileSave() {
    const now = Date.now();
    noteActivity();
    saveTimes.push(now);
    saveTimes = saveTimes.filter((t) => now - t < THINKING_SAVE_WINDOW_MS);
    if (saveTimes.length >= THINKING_SAVE_MIN && canMood()) {
      saveTimes = []; // reset to avoid re-trigger
      quip("mood_thinking");
    }
  }

  function startCompWatch(cwd) {
    stopCompWatch();
    if (!cwd) return;
    try {
      compWatchDir = cwd;
      compWatcher = fs.watch(cwd, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const ext = filename.split(".").pop() || "";
        if (/^(py|js|ts|jsx|tsx|json|html|css|vue|svelte|go|rs|rb|java|kt|swift|c|cpp|h|hpp|md|yml|yaml|toml)$/i.test(ext)) {
          onFileSave();
        }
      });
    } catch {}
  }

  function stopCompWatch() {
    if (compWatcher) { try { compWatcher.close(); } catch {} }
    compWatcher = null;
    compWatchDir = null;
    saveTimes = [];
  }

  // ── Terminal error → frustrated ──
  function onBashCommand(_command, exitCode, cwd) {
    if (cwd && cwd !== lastCwd) {
      lastCwd = cwd;
      startCompWatch(cwd);
    }
    noteActivity();

    // Only care about errors
    if (exitCode !== undefined && exitCode !== 0) {
      const now = Date.now();
      if (now - lastFrustratedAt > FRUSTRATED_COOLDOWN_MS && canMood()) {
        lastFrustratedAt = now;
        quip("mood_frustrated");
        return;
      }
    }

    // Hyperfocus check on any command
    if (activityCount > 0 && activityCount % HYPERFOCUS_ACTION_MIN === 0) {
      checkHyperfocus();
    }
  }

  // ── Lifecycle ──
  function start(cwd) {
    lastActivityAt = Date.now();
    if (cwd) {
      lastCwd = cwd;
      startCompWatch(cwd);
    }
    idleTimer = setTimeout(checkIdle, IDLE_TIMEOUT_MS);
    procrastinateTimer = setTimeout(checkProcrastinate, PROCRASTINATE_TIMEOUT_MS);
    pollTimer = setInterval(() => {
      const cwd = typeof getActiveCwd === "function" ? getActiveCwd() : null;
      if (cwd && cwd !== lastCwd) {
        lastCwd = cwd;
        startCompWatch(cwd);
      }
    }, 30000);
  }

  function stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (procrastinateTimer) { clearTimeout(procrastinateTimer); procrastinateTimer = null; }
    stopCompWatch();
    lastCwd = null;
    activityCount = 0;
  }

  return { onBashCommand, start, stop };
}

module.exports = { createDevBehavior };
