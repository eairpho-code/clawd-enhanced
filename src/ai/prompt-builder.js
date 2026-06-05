// Prompt Builder — constructs character-aware prompts for AI
const fs = require("fs");
const path = require("path");

const PERSONALITY_PATH = path.join(__dirname, "..", "..", "data", "content", "personality.txt");
const DEFAULT_PERSONALITY = "性格：阴阳怪气 + 懒散 + 轻微记仇。说话风格：短句、口语化。";

const REPLY_RULES = `【规则】
- 输出必须短句（20字以内）
- 不要解释，不要像 AI 助手
- 要像角色在说话
- 能体现"记住用户行为"
- 偶尔调侃，偶尔鼓励`;

const QUESTION_RULES = `你必须输出严格 JSON，不要任何额外文字：
{"question":"你的问题","choices":["选项A","选项B","选项C"]}

【规则】
- question 必须 15 字以内，像聊天不是问卷
- choices 2-3 个，每个 2-5 字
- 问题要贴近用户最近操作、代码、状态
- 可以吐槽、关心、调侃
- 每次生成不同的问题，不要重复
- 根据好感度调整语气`;

function createPromptBuilder({ memoryStore }) {
  let personality = DEFAULT_PERSONALITY;

  const MAX_PERSONALITY_CHARS = 2000;

  // Load personality from file (capped at MAX_PERSONALITY_CHARS)
  function loadPersonality() {
    try {
      const raw = fs.readFileSync(PERSONALITY_PATH, "utf8").trim();
      if (raw) personality = raw.length > MAX_PERSONALITY_CHARS ? raw.slice(0, MAX_PERSONALITY_CHARS) : raw;
    } catch { personality = DEFAULT_PERSONALITY; }
  }

  // Hot-reload: watch for changes
  function watchPersonality() {
    try {
      fs.watchFile(PERSONALITY_PATH, { interval: 2000 }, () => {
        loadPersonality();
        console.log("Clawd AI: personality reloaded");
      });
    } catch {}
  }

  // Initial load
  loadPersonality();
  watchPersonality();

  function buildSystemPrompt() {
    return `你是 Clawd 桌宠。

【人格设定】
${personality}

${REPLY_RULES}`;
  }

  function buildQuestionSystem() {
    return `你是 Clawd 桌宠。

【人格设定】
${personality}

你会主动找用户聊天。

${QUESTION_RULES}`;
  }

  function buildMessages(question, userAnswer, questionId, choiceMeta = {}, isSleeping = false) {
    const ctx = memoryStore.getRecentContext(2);
    const history = memoryStore.getQuestionHistory(questionId);
    const level = ctx.level;
    const { intent, valence, power } = choiceMeta;

    // Sleeping state: inject sleepy personality
    let sleepyInject = "";
    if (isSleeping) {
      sleepyInject = `【重要】你正在半睡状态，被打扰了。语气必须：缓慢、懒散、带省略号…、有点不耐烦。句子要短。多用"唔…""呼…""嗯…"开头。不要表现出清醒或热情。`;
    }

    let toneHint = "用正常的调侃语气。";
    if (level === "high") toneHint = "好感度高，语气可以温和一点，像老朋友。";
    else if (level === "low") toneHint = "好感度低，语气可以阴阳怪气一点，但别太过分。";

    // Semantic guard: negative intent must NOT produce positive tone
    let semanticGuard = "";
    if (intent === "reject") {
      semanticGuard = "用户表达了拒绝。你的回复要体现被拒绝的感觉，不要表现得很高兴。";
      if (history && history.lastAnswer !== userAnswer) {
        semanticGuard += " 用户从之前的选项改成了拒绝——这是态度变差了，不要说「态度变好」之类的话。";
      }
    } else if (intent === "insult") {
      semanticGuard = "用户在轻视/否定你。回复要体现被冒犯的感觉，带一点受伤的阴阳怪气。千万不要表现得很开心或说「态度变好」。";
    } else if (valence < 0) {
      semanticGuard = "用户情绪偏负面。回复不要过于积极乐观，要体现共情或低调。";
    } else if (valence > 0 && !history) {
      semanticGuard = "用户态度积极。可以温和回应。";
    }

    if (power === "ai") {
      semanticGuard += " 用户试图把责任推给你（AI），你可以轻微辩解或幽默回应。";
    }

    let memoryHint = "";
    if (history) {
      if (history.lastAnswer === userAnswer) {
        memoryHint = `用户上次也是选「${userAnswer}」，重复选择。`;
      } else {
        const prevValence = history.lastValence;
        const currValence = valence;
        memoryHint = `用户上次选的是「${history.lastAnswer}」，这次改成了「${userAnswer}」。`;
        if (prevValence !== undefined && currValence < prevValence) {
          memoryHint += ` 情绪值从${prevValence}降到${currValence}——态度变差了。`;
        } else if (prevValence !== undefined && currValence > prevValence) {
          memoryHint += ` 情绪值从${prevValence}升到${currValence}——态度变好了。`;
        } else {
          memoryHint += " 情绪方向不变。";
        }
      }
    } else {
      memoryHint = "第一次回答这个问题。";
    }

    const userPrompt = [
      sleepyInject,
      `桌宠问用户："${question}"`,
      `用户选择："${userAnswer}"（意图:${intent || "无"}, 情绪:${valence ?? 0}, 态度:${power || "equal"}）`,
      memoryHint,
      semanticGuard,
      `互动总次数：${ctx.totalInteractions}，好感度：${ctx.friendship}（-10到10）`,
      toneHint,
      "请用一句简短的话回复。（纯文本，不要带引号）",
    ].filter(Boolean).join("\n");

    return [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: userPrompt },
    ];
  }

  function buildQuestionPrompt(isSleeping = false) {
    const ctx = memoryStore.getRecentContext(2);
    const level = ctx.level;

    const sleepInject = isSleeping
      ? "【sleep模式】你正在半睡状态被打扰。语气：懒散、短句、带省略号…、开头用唔…/呼…/嗯…、不耐烦但不真生气。禁止正常活跃语气。"
      : "";

    let toneHint = "语气：正常调侃。";
    if (level === "high") toneHint = "语气：温和，像老朋友聊天。";
    else if (level === "low") toneHint = "语气：阴阳怪气一点。";

    const histSummary = ctx.recentQuestions.length > 0
      ? `用户最近回答过：${ctx.recentQuestions.map(q => `${q.questionId}=${q.lastAnswer}`).join(", ")}`
      : "用户还没有互动过。";

    const userPrompt = [
      sleepInject,
      `互动总次数：${ctx.totalInteractions}，好感度：${ctx.friendship}（-10到10）`,
      histSummary,
      toneHint,
      "生成一个你（桌宠Clawd）想问用户的问题和选项。输出严格JSON。",
    ].filter(Boolean).join("\n");

    return [
      { role: "system", content: buildQuestionSystem() },
      { role: "user", content: userPrompt },
    ];
  }

  function getPersonality() { return personality; }
  return { buildMessages, buildQuestionPrompt, getPersonality };
}

module.exports = { createPromptBuilder };
