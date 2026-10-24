// Minimal bridge between the app menu and the page (contextIsolation and sandbox stay on): the
// page receives the menu commands and tells the menu what to check or disable. Nothing else.
// CommonJS because sandboxed preloads do not load ESM modules.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bluepencil", {
  onMenu: (callback) => {
    ipcRenderer.on("menu", (_event, command) => callback(String(command)));
  },
  menuState: (state) => ipcRenderer.send("menu-state", state),
});
