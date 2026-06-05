// Ambient Banter — low-frequency easter-egg quips, fully independent
const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "content", "ambient-banter.json");
const TICK_MS = 45000;         // check every 45s
const CATEGORY_COOLDOWN_MS = 900000; // 15 min per category
const MAX_PER_HOUR = 3;

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, "utf8")); }
  catch { return {}; }
}

function pick(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function createAmbientBanter({ getPetState, getPetBounds, getWorkingDuration, getLastErrorTime, showBubble, isBusy }) {
  const data = loadData();
  const lastCategoryTime = {};        // category → timestamp
  let hourlyCount = 0;
  let hourlyReset = Date.now();
  let lastWorkingMilestone = 0;      // last working minute milestone triggered
  let lastErrorAftermathFired = false;
  let tickTimer = null;

  function canFire(category) {
    const now = Date.now();
    if (now - hourlyReset > 3600000) { hourlyCount = 0; hourlyReset = now; }
    if (hourlyCount >= MAX_PER_HOUR) return false;
    if (lastCategoryTime[category] && now - lastCategoryTime[category] < CATEGORY_COOLDOWN_MS) return false;
    return true;
  }

  function fire(category) {
    const text = pick(data[category]);
    if (!text) return;
    if (typeof isBusy === "function" && isBusy()) return;
    const bounds = typeof getPetBounds === "function" ? getPetBounds() : null;
    if (!bounds || !bounds.width) return;
    if (typeof showBubble !== "function") return;

    lastCategoryTime[category] = Date.now();
    hourlyCount++;
    showBubble(text, bounds);
    console.log("Clawd Ambient:", category, "→", text);
  }

  function tick() {
    const now = Date.now();
    const state = typeof getPetState === "function" ? getPetState() : "idle";

    // 1. Long working
    if (state === "working" || state === "thinking") {
      if (typeof getWorkingDuration === "function") {
        const minutes = Math.floor(getWorkingDuration() / 60000);
        const milestones = [20, 40, 60];
        for (const m of milestones) {
          if (minutes >= m && lastWorkingMilestone < m) {
            lastWorkingMilestone = m;
            if (canFire("long_working")) fire("long_working");
            break;
          }
        }
      }
    } else {
      lastWorkingMilestone = 0; // reset when not working
    }

    // 2. Error aftermath
    if (state !== "error" && lastErrorAftermathFired === false &&
        typeof getLastErrorTime === "function") {
      const lastErr = getLastErrorTime();
      if (lastErr > 0 && now - lastErr > 60000 && now - lastErr < 360000) {
        if (Math.random() < 0.1) {
          lastErrorAftermathFired = true;
          if (canFire("error_aftermath")) fire("error_aftermath");
        }
      }
    }
    if (state === "error") lastErrorAftermathFired = false;

    // 3. Drag protest — checked via onDrag() for immediate response

    // 4. Existential (very low probability)
    if (Math.random() < 0.03 && canFire("existential")) {
      fire("existential");
    }

    // 5. Late night
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5 && (state === "working" || state === "thinking")) {
      if (Math.random() < 0.08 && canFire("late_night")) {
        fire("late_night");
      }
    }
  }

  function onDrag() {
    console.log("AMBIENT DRAG FIRED");
    fire("drag_protest");
  }

  function start() {
    if (tickTimer) return;
    tickTimer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  return { start, stop, onDrag };
}

module.exports = { createAmbientBanter };
