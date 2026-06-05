const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("apiKey", {
  load: () => ipcRenderer.invoke("apikey:load"),
  test: (key) => ipcRenderer.invoke("apikey:test", key),
  save: (key) => ipcRenderer.invoke("apikey:save", key),
  setProvider: (prov) => ipcRenderer.invoke("apikey:set-provider", prov),
  close: () => ipcRenderer.send("apikey:close"),
});
