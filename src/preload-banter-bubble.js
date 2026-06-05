const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("banterBubble", {
  choose: (index) => ipcRenderer.send("banter-bubble:choose", index),
  reportSize: (w, h) => ipcRenderer.send("banter-bubble:resize", w, h),
  onShowInteraction: (cb) => ipcRenderer.on("banter-bubble:interaction", (_e, data) => cb(data)),
  onShowReply: (cb) => ipcRenderer.on("banter-bubble:reply", (_e, text) => cb(text)),
  onShowText: (cb) => ipcRenderer.on("banter-bubble:show-text", (_e, text) => cb(text)),
});
