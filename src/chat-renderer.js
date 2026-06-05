const msgsEl = document.getElementById("messages");
const inputEl = document.getElementById("msgInput");
const btnSend = document.getElementById("btnSend");
const statusEl = document.getElementById("status");

let aiEnabled = false;

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = role === "ai" ? "clawd" : "you";
  div.appendChild(who);
  const p = document.createElement("div"); p.textContent = text;
  div.appendChild(p);
  msgsEl.appendChild(div);
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  if (!aiEnabled) { addMessage("ai", "信号断了。"); return; }
  inputEl.value = ""; btnSend.disabled = true;
  addMessage("user", text);
  statusEl.textContent = "…";
  try {
    const result = await window.chatAPI.send(text);
    addMessage("ai", result.reply || "嗯。");
  } catch { addMessage("ai", "断了。"); }
  statusEl.textContent = "";
  btnSend.disabled = false; inputEl.focus();
}

btnSend.addEventListener("click", send);
inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

(async () => {
  const data = await window.chatAPI.load();
  aiEnabled = data.aiEnabled;
  statusEl.textContent = aiEnabled ? "" : "offline";
  for (const m of data.memory || []) {
    addMessage(m.role === "user" ? "user" : "ai", m.content);
  }
})();
