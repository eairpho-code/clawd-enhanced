// API Client — multi-provider (DeepSeek/OpenAI/Anthropic) via config
const https = require("https");
const net = require("net");
const fs = require("fs");
const path = require("path");

const TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 3000;
const MAX_TOKENS = 80;
const DAILY_BUDGET = 50;

const DEFAULT_PROVIDERS = {
  deepseek:  { host: "api.deepseek.com",       path: "/v1/chat/completions", model: "deepseek-chat",       keyPrefix: "sk-" },
  openai:    { host: "api.openai.com",         path: "/v1/chat/completions", model: "gpt-4o-mini",          keyPrefix: "sk-" },
  anthropic: { host: "api.anthropic.com",      path: "/v1/messages",         model: "claude-haiku-3-5",    keyPrefix: "sk-ant-" },
};

function getProviderConfig() {
  if (!_keyFile) return DEFAULT_PROVIDERS.deepseek;
  try {
    const cfg = JSON.parse(fs.readFileSync(_keyFile, "utf8"));
    const provider = cfg.provider || "deepseek";
    return DEFAULT_PROVIDERS[provider] || DEFAULT_PROVIDERS.deepseek;
  } catch { return DEFAULT_PROVIDERS.deepseek; }
}

// Budget stored in userData (not project dir)
let _budgetFile = null;
let _keyFile = null;

function setStoragePaths(userDataPath) {
  _budgetFile = path.join(userDataPath, "ai-budget.json");
  _keyFile = path.join(userDataPath, "config.json");
}

// Key storage — userData/config.json, NOT project dir
function loadStoredKey() {
  if (!_keyFile) return "";
  try {
    const cfg = JSON.parse(fs.readFileSync(_keyFile, "utf8"));
    return (cfg && cfg.apiKey) ? cfg.apiKey : "";
  } catch { return ""; }
}

function saveStoredKey(apiKey) {
  if (!_keyFile) return;
  const prov = getProviderConfig();
  const valid = apiKey && apiKey.startsWith(prov.keyPrefix);
  try {
    const dir = path.dirname(_keyFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = JSON.parse(fs.readFileSync(_keyFile, "utf8") || "{}");
    if (existing.apiKey !== apiKey) delete existing.lastTest;
    const cfg = { ...existing, apiKey: valid ? apiKey : "", provider: prov.model.includes("deepseek") ? "deepseek" : existing.provider || "deepseek" };
    fs.writeFileSync(_keyFile, JSON.stringify(cfg, null, 2), "utf8");
    commitPendingTestResult();
    if (typeof _onKeyChanged === "function") _onKeyChanged(apiKey || "");
  } catch {
    const cfg = { apiKey: valid ? apiKey : "" };
    try { fs.writeFileSync(_keyFile, JSON.stringify(cfg, null, 2), "utf8"); } catch {}
    commitPendingTestResult();
    if (typeof _onKeyChanged === "function") _onKeyChanged(apiKey || "");
  }
}

// Test result persistence in userData/config.json
function getLastTestResult() {
  if (!_keyFile) return { status: "DISABLED" };
  try {
    const cfg = JSON.parse(fs.readFileSync(_keyFile, "utf8"));
    return cfg.lastTest || { status: "DISABLED" };
  } catch { return { status: "DISABLED" }; }
}

// Pending test — stored in memory until Save commits it
let _pendingTestResult = null;

function saveTestResult(result) {
  if (!_keyFile) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(_keyFile, "utf8") || "{}");
    cfg.lastTest = { ...result, at: Date.now() };
    fs.writeFileSync(_keyFile, JSON.stringify(cfg, null, 2), "utf8");
  } catch {}
}

// For Test IPC: store in memory only, not yet committed
function savePendingTestResult(result) {
  _pendingTestResult = result;
}

// Called by saveStoredKey: commit pending test alongside the key
function commitPendingTestResult() {
  if (!_keyFile || !_pendingTestResult) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(_keyFile, "utf8") || "{}");
    cfg.lastTest = { ..._pendingTestResult, at: Date.now() };
    fs.writeFileSync(_keyFile, JSON.stringify(cfg, null, 2), "utf8");
    _pendingTestResult = null;
  } catch {}
}

// Lightweight API test — sends one message, checks 200 response
async function testApiKey(key) {
  const prov = getProviderConfig();
  if (!key || !key.startsWith(prov.keyPrefix)) return { ok: false, error: "Invalid key format" };
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: prov.model,
      messages: [{ role: "user", content: "say ok" }],
      max_tokens: 5, temperature: 0, stream: false,
    });
    const req = https.request({
      hostname: prov.host, path: prov.path, method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      timeout: 10000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => { if (data.length < 1024) data += c; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve({ ok: true });
        } else {
          let msg = `HTTP ${res.statusCode}`;
          try { const j = JSON.parse(data); msg = j.error?.message || msg; } catch {}
          resolve({ ok: false, error: msg });
        }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "Request timed out" }); });
    req.end(body);
  });
}

// Module-level state
let lastNetworkOnline = null;

function resolveApiKey(explicitKey) {
  const prefix = getProviderConfig().keyPrefix;
  // 1. Explicit parameter
  if (explicitKey && explicitKey.startsWith(prefix)) return explicitKey;
  // 2. Environment variable
  if (process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.startsWith(prefix)) return process.env.DEEPSEEK_API_KEY;
  // 3. User data config (set via Settings)
  const stored = loadStoredKey();
  if (stored) return stored;
  return "";
}

function checkBudget() {
  if (!_budgetFile) return { allowed: true, remaining: DAILY_BUDGET, used: 0 };
  try {
    const data = JSON.parse(fs.readFileSync(_budgetFile, "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    if (data.date !== today) {
      const fresh = { date: today, count: 0 };
      fs.writeFileSync(_budgetFile, JSON.stringify(fresh));
      return { allowed: true, remaining: DAILY_BUDGET, used: 0 };
    }
    const remaining = DAILY_BUDGET - data.count;
    return { allowed: data.count < DAILY_BUDGET, remaining: Math.max(0, remaining), used: data.count };
  } catch {
    return { allowed: true, remaining: DAILY_BUDGET, used: 0 };
  }
}

function spendBudget() {
  if (!_budgetFile) return;
  try {
    if (!fs.existsSync(_budgetFile)) {
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(_budgetFile, JSON.stringify({ date: today, count: 1 }));
      return;
    }
    const data = JSON.parse(fs.readFileSync(_budgetFile, "utf8"));
    data.count = (data.count || 0) + 1;
    fs.writeFileSync(_budgetFile, JSON.stringify(data));
  } catch {}
}

function getBudgetStats() {
  const { used, remaining } = checkBudget();
  return { used, remaining, total: DAILY_BUDGET };
}

// ── Network probe ──

function probeNetwork() {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(PROBE_TIMEOUT_MS);
    sock.on("connect", () => { sock.destroy(); lastNetworkOnline = true; resolve(true); });
    sock.on("error", () => { sock.destroy(); lastNetworkOnline = false; resolve(false); });
    sock.on("timeout", () => { sock.destroy(); lastNetworkOnline = false; resolve(false); });
    sock.connect(443, getProviderConfig().host);
  });
}

function getNetworkStatus() { return lastNetworkOnline; }

// ── API Client ──

function createApiClient({ apiKey } = {}) {
  let key = resolveApiKey(apiKey);
  if (key) console.log("Clawd AI: API key loaded");
  else console.log("Clawd AI: no API key — local mode");

  function refreshKey() { key = resolveApiKey(apiKey); return !!key; }
  function isEnabled() { return !!key; }

  async function chat(messages) {
    if (!key) return null;
    const budget = checkBudget();
    if (!budget.allowed) { console.log(`Clawd AI: budget exhausted (${budget.used}/${DAILY_BUDGET})`); return null; }

    const prov = getProviderConfig();
    const body = JSON.stringify({ model: prov.model, messages, max_tokens: MAX_TOKENS, temperature: 0.9, stream: false });

    return new Promise((resolve) => {
      const req = https.request({
        hostname: prov.host, path: prov.path, method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        timeout: TIMEOUT_MS,
      }, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { if (data.length < 8192) data += c; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            lastNetworkOnline = true;
            _lastRuntimeResult = "SUCCESS";
            spendBudget();
            try {
              const json = JSON.parse(data);
              const text = json.choices?.[0]?.message?.content;
              if (text) console.log(`Clawd AI: reply (${text.length} chars, budget ${getBudgetStats().used}/${DAILY_BUDGET})`);
              resolve(text ? text.trim() : null);
            } catch (e) { console.error("Clawd AI: JSON parse error:", e.message); resolve(null); }
          } else {
            console.error(`Clawd AI: HTTP ${res.statusCode}: ${data.slice(0, 200)}`);
            _lastRuntimeResult = "FAIL";
            if (res.statusCode === 401 || res.statusCode === 403) saveTestResult({ ok: false, error: `HTTP ${res.statusCode}` });
            resolve(null);
          }
        });
      });
      req.on("error", (e) => { _lastRuntimeResult = "FAIL"; console.error("Clawd AI: request failed:", e.message); resolve(null); });
      req.on("timeout", () => { _lastRuntimeResult = "FAIL"; console.error("Clawd AI: request timed out"); req.destroy(); resolve(null); });
      req.end(body);
    });
  }

  return { chat, get enabled() { return isEnabled(); }, refreshKey };
}

let _lastRuntimeResult = null;
function getAiStatus() {
  const network = lastNetworkOnline === false ? "OFFLINE" : "ONLINE";
  const t = getLastTestResult();
  let key = "UNKNOWN";
  if (t && t.at) key = t.ok ? "VALID" : "INVALID";
  const runtime = _lastRuntimeResult || "UNKNOWN";
  return { network, key, runtime };
}

module.exports = { createApiClient, probeNetwork, getNetworkStatus, getBudgetStats, testApiKey, getLastTestResult, saveTestResult, savePendingTestResult, commitPendingTestResult, saveStoredKey, loadStoredKey, resolveApiKey, setStoragePaths, getAiStatus };
