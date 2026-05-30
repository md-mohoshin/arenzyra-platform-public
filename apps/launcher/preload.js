const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcherAPI", {
  getState: () => ipcRenderer.invoke("launcher:get-state"),
  runHealthCheck: () => ipcRenderer.invoke("launcher:run-health-check"),
  startAll: () => ipcRenderer.invoke("launcher:start-all"),
  stopAll: () => ipcRenderer.invoke("launcher:stop-all"),
  restartAll: () => ipcRenderer.invoke("launcher:restart-all"),
  serviceAction: (id, action) => ipcRenderer.invoke("launcher:service-action", { id, action }),
  onState: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("launcher:state", listener);
    return () => ipcRenderer.removeListener("launcher:state", listener);
  },
});
