const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("banterSettings", {
  load: () => ipcRenderer.invoke("banter-settings:load"),
  // Use the standard settings update path (single source of truth)
  update: (key, value) => ipcRenderer.invoke("settings:update", { key, value }),
  preview: (prefs) => ipcRenderer.invoke("banter-settings:preview", prefs),
  close: () => ipcRenderer.send("banter-settings:close"),
});
