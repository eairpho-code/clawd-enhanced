// Memory Store — unified local persistence for pet memory
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const PET_MEMORY = path.join(DATA_DIR, "pet-memory.json");
const QUESTION_MEMORY = path.join(DATA_DIR, "question-memory.json");

function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function save(file, data) {
  try {
    if (!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch {}
}

function createMemoryStore() {
  let pet = load(PET_MEMORY, { friendship: 0, interactions: 0, lastInteractionTime: 0 });
  let questions = load(QUESTION_MEMORY, {});

  return {
    // ── Friendship ──
    getFriendship() { return pet.friendship; },
    adjustFriendship(delta) {
      pet.friendship = Math.max(-10, Math.min(10, pet.friendship + delta));
      pet.interactions = (pet.interactions || 0) + 1;
      pet.lastInteractionTime = Date.now();
      save(PET_MEMORY, pet);
    },
    getFriendshipLevel() {
      const f = pet.friendship;
      if (f >= 6) return "high";
      if (f <= -3) return "low";
      return "neutral";
    },

    // ── Question history ──
    getQuestionHistory(qid) {
      return questions[qid] || null;
    },
    recordAnswer(qid, answer) {
      const prev = questions[qid];
      questions[qid] = { lastAnswer: answer, count: (prev ? prev.count : 0) + 1 };
      save(QUESTION_MEMORY, questions);
    },

    // ── Recent context (for AI prompt) ──
    getRecentContext(limit = 3) {
      const entries = Object.entries(questions)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, limit)
        .map(([id, q]) => ({ questionId: id, lastAnswer: q.lastAnswer, count: q.count }));
      return {
        friendship: pet.friendship,
        level: this.getFriendshipLevel(),
        totalInteractions: pet.interactions || 0,
        recentQuestions: entries,
      };
    },

    getInteractionCount() { return pet.interactions || 0; },
    getLastInteractionTime() { return pet.lastInteractionTime || 0; },
  };
}

module.exports = { createMemoryStore };
