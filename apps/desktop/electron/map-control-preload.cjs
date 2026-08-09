"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("arenzyraMapControl", {
  getStatus() {
    return ipcRenderer.invoke("map-control:get-status");
  },
  selectPlayer(payload) {
    return ipcRenderer.invoke("map-control:select-player", payload);
  },
});
