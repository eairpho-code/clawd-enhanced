// Chat Window — user-controlled toggle, smart edge-aware positioning
const { BrowserWindow, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const WIN_W = 320;
const WIN_H = 380;
const FOLLOW_MS = 50;
const FOLLOW_EASE = 0.3;
const GAP = 8; // px between pet and chat window

const MEMORY_PATH = path.join(__dirname, "..", "data", "chat-memory.json");
function loadMemory() { try { return JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8")); } catch { return []; } }
function saveMemory(msgs) { try { fs.writeFileSync(MEMORY_PATH, JSON.stringify(msgs.slice(-4), null, 2)); } catch {} }

const CHAT_RULES = `规则：回复10-40字，不要解释，不要AI助手口吻，不要分点，不要长篇。` +
  `更像："现在才想起找我？""行吧，我勉强听着。""你这个决定听起来就很危险。"` +
  `不要攻击用户，不要过度毒舌。像一个被强行拉来聊天的桌宠。`;

function createChatWindow({ apiClient, aiRouter, getPetBounds, getPersonality }) {
  function buildChatSystem() {
    const persona = typeof getPersonality === "function" ? getPersonality() : "";
    return persona ? `${persona}\n\n${CHAT_RULES}` : `你是桌宠小螃蟹 Clawd。\n性格：略阴阳怪气 + 嘴硬 + 偶尔吐槽 + 不太情愿聊天。\n${CHAT_RULES}`;
  }
  const { ipcMain } = require("electron");
  let win = null;
  let followTimer = null;
  let currentSide = "right"; // "right" | "left"

  // Decide which side of pet has room
  function pickSide(petBounds) {
    if (!petBounds || !petBounds.width) return "right";
    const display = screen.getDisplayMatching(petBounds);
    const wa = display.workArea;
    // Prefer right unless there's no room
    const roomRight = wa.x + wa.width - (petBounds.x + petBounds.width + GAP + WIN_W);
    if (roomRight >= 0) return "right";
    const roomLeft = petBounds.x - wa.x - GAP - WIN_W;
    if (roomLeft >= 0) return "left";
    return "right"; // fallback: squeeze on right
  }

  function calcPos(petBounds) {
    if (!petBounds || !petBounds.width) return { x: 200, y: 200 };
    const side = pickSide(petBounds);
    currentSide = side;
    if (side === "right") {
      return { x: Math.round(petBounds.x + petBounds.width + GAP), y: Math.round(petBounds.y) };
    }
    return { x: Math.round(petBounds.x - WIN_W - GAP), y: Math.round(petBounds.y) };
  }

  // Smooth eased follow — only position, never state
  function smoothFollow() {
    if (!win || win.isDestroyed()) return;
    if (typeof getPetBounds !== "function") return;
    const target = calcPos(getPetBounds());
    const cur = win.getBounds();
    const nx = cur.x + (target.x - cur.x) * FOLLOW_EASE;
    const ny = cur.y + (target.y - cur.y) * FOLLOW_EASE;
    if (Math.abs(nx - cur.x) > 0.5 || Math.abs(ny - cur.y) > 0.5) {
      win.setBounds({ x: Math.round(nx), y: Math.round(ny), width: cur.width, height: cur.height });
    }
  }

  function startFollow() {
    if (followTimer) return;
    followTimer = setInterval(smoothFollow, FOLLOW_MS);
  }
  function stopFollow() {
    if (followTimer) { clearInterval(followTimer); followTimer = null; }
  }

  // ── Pure user-controlled toggle ──
  function toggle() {
    if (win && !win.isDestroyed()) {
      stopFollow();
      win.close();
      win = null;
      return;
    }
    // Open
    const pos = typeof getPetBounds === "function" ? calcPos(getPetBounds()) : { x: 300, y: 200 };
    win = new BrowserWindow({
      width: WIN_W, height: WIN_H, x: pos.x, y: pos.y,
      frame: false, transparent: true,
      resizable: true, minimizable: false, maximizable: false,
      skipTaskbar: true, hasShadow: true,
      title: "Clawd Chat",
      ...(isMac ? { type: "panel" } : {}),
      ...(isLinux ? { type: "toolbar" } : {}),
      webPreferences: {
        preload: path.join(__dirname, "preload-chat.js"),
        nodeIntegration: false, contextIsolation: true,
      },
    });
    win.loadFile(path.join(__dirname, "chat.html"));
    win.on("closed", () => { stopFollow(); win = null; });
    startFollow();
  }

  function open() { toggle(); }

  // ── IPC ──
  ipcMain.handle("chat:load", () => ({
    memory: loadMemory(),
    aiEnabled: aiRouter.isAiEnabled(),
  }));

  ipcMain.handle("chat:send", async (_event, userMessage) => {
    if (!aiRouter.isAiEnabled()) return { reply: "信号断了。你等我重新连上。" };
    if (!apiClient.enabled) return { reply: "今天不聊了。脑细胞下班了。" };
    const budget = require("./ai/api-client").getBudgetStats();
    if (budget.remaining <= 0) return { reply: "今天不聊了。脑细胞下班了。" };

    const memory = loadMemory();
    const messages = [{ role: "system", content: buildChatSystem() }];
    for (const m of memory) messages.push(m);
    messages.push({ role: "user", content: userMessage });

    const reply = await apiClient.chat(messages);
    if (!reply) return { reply: "信号断了。你等我重新连上。" };

    memory.push({ role: "user", content: userMessage });
    memory.push({ role: "assistant", content: reply });
    saveMemory(memory);
    return { reply };
  });

  return { open, toggle, isVisible: () => !!(win && !win.isDestroyed()) };
}

module.exports = { createChatWindow };
