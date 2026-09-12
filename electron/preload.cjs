const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("emberDesktop", {
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  platform: process.platform,
});
