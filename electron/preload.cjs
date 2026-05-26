const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("stockChooseDesktop", {
  platform: process.platform,
  version: process.versions.electron
});
