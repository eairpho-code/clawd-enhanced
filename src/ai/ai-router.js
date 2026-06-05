// AI Router — generates questions + replies with cooldowns + budget awareness
const { getBudgetStats } = require("./api-client");

const QUESTION_COOLDOWN_MS = 600000; // 10 min between AI questions
const REPLY_COOLDOWN_MS = 300000;    // 5 min between AI replies

function createAiRouter({ apiClient, promptBuilder }) {
  let lastAiQuestionAt = 0;
  let lastAiReplyAt = 0;
  let budgetExhaustedQuipped = false;

  function isBudgetExhausted() {
    const stats = getBudgetStats();
    return stats.remaining <= 0;
  }

  function resetBudgetQuip() { budgetExhaustedQuipped = false; }

  async function getReply(question, userAnswer, questionId, choiceMeta = {}, isSleeping = false) {
    if (!apiClient.enabled) return null;
    const now = Date.now();
    if (now - lastAiReplyAt < REPLY_COOLDOWN_MS) return null;
    if (isBudgetExhausted()) return null;
    try {
      const messages = promptBuilder.buildMessages(question, userAnswer, questionId, choiceMeta, isSleeping);
      const text = await apiClient.chat(messages);
      if (!text) return null;
      lastAiReplyAt = now;
      return `◉ ${text}`;
    } catch { return null; }
  }

  async function generateQuestion(isSleeping = false) {
    if (!apiClient.enabled) return null;
    const now = Date.now();
    if (now - lastAiQuestionAt < QUESTION_COOLDOWN_MS) return null;
    if (isBudgetExhausted()) return null;
    try {
      const messages = promptBuilder.buildQuestionPrompt(isSleeping);
      const raw = await apiClient.chat(messages);
      if (!raw) return null;
      const jsonMatch = raw.match(/\{[\s\S]*"question"[\s\S]*"choices"[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.question || !Array.isArray(parsed.choices) || parsed.choices.length < 2) return null;
      lastAiQuestionAt = now;
      return {
        id: `ai_${Date.now()}`,
        question: `◉ ${parsed.question}`,
        choices: parsed.choices.map((label) => ({ label, reply: "嗯。", friendship: 0 })),
        isAiGenerated: true,
      };
    } catch { return null; }
  }

  function shouldQuipBudget() {
    if (budgetExhaustedQuipped) return false;
    if (isBudgetExhausted()) { budgetExhaustedQuipped = true; return true; }
    return false;
  }

  return {
    getReply,
    generateQuestion,
    shouldQuipBudget,
    resetBudgetQuip,
    getCooldownStatus() {
      const now = Date.now();
      const qRemain = Math.max(0, QUESTION_COOLDOWN_MS - (now - lastAiQuestionAt));
      const rRemain = Math.max(0, REPLY_COOLDOWN_MS - (now - lastAiReplyAt));
      if (qRemain <= 0 && rRemain <= 0) return "none";
      const parts = [];
      if (qRemain > 0) parts.push(`question ${Math.ceil(qRemain / 1000)}s`);
      if (rRemain > 0) parts.push(`reply ${Math.ceil(rRemain / 1000)}s`);
      return parts.join(", ");
    },
    isAiEnabled() {
      apiClient.refreshKey();
      return apiClient.enabled;
    },
  };
}

module.exports = { createAiRouter };
