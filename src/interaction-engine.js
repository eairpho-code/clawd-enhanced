// Interaction Engine — three-tier probability + AI/local fallback
const fs = require("fs");
const path = require("path");

const MEMORY_PATH = path.join(__dirname, "..", "data", "pet-memory.json");
const QUESTION_MEMORY_PATH = path.join(__dirname, "..", "data", "question-memory.json");

const FRIENDSHIP_MIN = -10;
const FRIENDSHIP_MAX = 10;
const EVENT_CHANCE = 0.30;
const AI_QUESTION_CHANCE = 0.20;
const AI_REPLY_CHANCE = 0.50;

function loadJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }
function saveJson(f, d) { try { const dir = path.dirname(f); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2), "utf8"); } catch {} }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function createInteractionEngine({ interactionsPath, aiRouter, getPetState }) {
  let fallbackPool = [];
  let memory = loadJson(MEMORY_PATH, { friendship: 0, interactions: 0, lastInteractionTime: 0, consecutiveClicks: 0 });
  let questionMemory = loadJson(QUESTION_MEMORY_PATH, {});
  let lastLocalId = null;
  let recentAiQuestions = [];

  function load() { fallbackPool = loadJson(interactionsPath, []); }

  function isAiAvailable() { return !!(aiRouter && aiRouter.isAiEnabled()); }

  const SLEEP_STATES = new Set(["sleeping", "dozing", "yawning", "collapsing"]);
  function isSleeping() {
    return typeof getPetState === "function" && SLEEP_STATES.has(getPetState());
  }

  function pickFromLocalPool() {
    if (fallbackPool.length === 0) return null;
    const pool = fallbackPool.length > 1 ? fallbackPool.filter((q) => q.id !== lastLocalId) : fallbackPool;
    if (pool.length === 0) return null;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    lastLocalId = picked.id;
    return picked;
  }

  async function generateQuestion() {
    if (isAiAvailable() && Math.random() < AI_QUESTION_CHANCE) {
      try {
        const q = await aiRouter.generateQuestion(isSleeping());
        if (q && !recentAiQuestions.includes(q.question)) {
          recentAiQuestions.push(q.question);
          if (recentAiQuestions.length > 10) recentAiQuestions = recentAiQuestions.slice(-10);
          return q;
        }
      } catch {}
    }
    // Sleeping: override with sleepy question
    if (isSleeping()) return buildSleepyQuestion();
    return pickFromLocalPool();
  }

  // Build a simple sleepy question (isolated from normal question pool)
  function buildSleepyQuestion() {
    const questions = [
      "唔…干嘛…",
      "呼…有事吗…",
      "嗯…我在睡觉…",
      "啊…别吵…",
    ];
    return {
      id: `sleepy_${Date.now()}`,
      question: questions[Math.floor(Math.random() * questions.length)],
      choices: [
        { label: "没事", intent: "neutral", valence: 0, power: "equal", reply: "", friendship: 0 },
        { label: "起来干活", intent: "reject", valence: -1, power: "user", reply: "", friendship: -1 },
      ],
      isSleepyQuestion: true,
    };
  }

  function localRespond(interaction, choiceIndex) {
    const choice = interaction.choices[choiceIndex];
    if (!choice) return "（你点了个不存在的东西…）";
    if (isSleeping() || interaction.isSleepyQuestion) {
      const { pick } = require("./banter");
      return pick("sleeping_reply") || "唔…别吵…";
    }
    if (interaction.isAiGenerated) return "嗯，了解了。";
    const prev = questionMemory[interaction.id];
    if (!prev) return choice.reply;
    if (prev.lastAnswer === choice.label) return choice.repeatReply || choice.reply;
    const pool = (choice.changedReplies && choice.changedReplies.length > 0)
      ? choice.changedReplies
      : ["你改主意了？", "态度变了？", "已记录…"];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  async function respond(interaction, choiceIndex) {
    const choice = interaction.choices[choiceIndex];
    if (!choice) return { reply: "（你点了个不存在的东西…）", friendshipDelta: 0 };

    const delta = choice.friendship || 0;
    memory.friendship = clamp(memory.friendship + delta, FRIENDSHIP_MIN, FRIENDSHIP_MAX);
    memory.interactions += 1;
    memory.consecutiveClicks = 0;

    const choiceMeta = {
      intent: choice.intent || "neutral",
      valence: choice.valence ?? 0,
      power: choice.power || "equal",
    };

    let reply = null;

    if (isSleeping()) {
      reply = localRespond(interaction, choiceIndex);
    } else if (isAiAvailable() && Math.random() < AI_REPLY_CHANCE) {
      try {
        reply = await aiRouter.getReply(interaction.question, choice.label, interaction.id, choiceMeta, false);
      } catch {}
    }

    if (!reply) reply = localRespond(interaction, choiceIndex);

    saveJson(MEMORY_PATH, memory);

    const prev = questionMemory[interaction.id];
    questionMemory[interaction.id] = {
      lastAnswer: choice.label,
      lastValence: choice.valence ?? 0,
      count: (prev ? prev.count : 0) + 1,
    };
    saveJson(QUESTION_MEMORY_PATH, questionMemory);

    return { reply, friendshipDelta: delta, friendship: memory.friendship };
  }

  function noteClick() { memory.consecutiveClicks += 1; saveJson(MEMORY_PATH, memory); }
  function getFriendship() { return memory.friendship; }
  function getFriendshipLevel() { const f = memory.friendship; if (f >= 6) return "high"; if (f <= -3) return "low"; return "neutral"; }

  load();
  return {
    shouldInteract: () => Math.random() < EVENT_CHANCE,
    generateQuestion, respond, noteClick, localRespond,
    getFriendship, getFriendshipLevel, isAiAvailable,
    reload: load,
  };
}

module.exports = { createInteractionEngine };
