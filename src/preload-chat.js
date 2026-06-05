const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chatAPI", {
  load: () => ipcRenderer.invoke("chat:load"),
  send: (msg) => ipcRenderer.invoke("chat:send", msg),
});
