const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stockChooseDesktop", Object.freeze({
  platform: process.platform,
  version: process.versions.electron,
  storage: Object.freeze({
    load(name) {
      return ipcRenderer.sendSync("stockchoose:storage:load", name);
    },
    save(name, value) {
      return ipcRenderer.sendSync("stockchoose:storage:save", name, value);
    },
    remove(name) {
      return ipcRenderer.sendSync("stockchoose:storage:remove", name);
    }
  })
}));
