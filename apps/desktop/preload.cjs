const { contextBridge, ipcRenderer } = require("electron");

const allowedInvokeChannels = new Set([
  "launcher:bootstrap",
  "launcher:login",
  "launcher:logout",
  "launcher:getLiveMatch",
  "launcher:listTournaments",
  "launcher:listStages",
  "launcher:listMatches",
  "launcher:syncTeams",
  "launcher:generateBranding",
  "launcher:chooseFile",
  "launcher:copyText",
  "launcher:openExternal",
  "launcher:getTelemetryStatus",
  "launcher:listVisualSources",
  "launcher:getVisualModeStatus",
  "launcher:getVisualModeConfig",
  "launcher:setVisualModeConfig",
  "launcher:getVisualReviewQueue",
  "launcher:clearVisualReviewQueue",
  "launcher:captureVisualReviewCandidate",
  "launcher:runVisualReviewOcr",
  "launcher:ignoreVisualReviewItem",
  "launcher:markVisualReviewItemReviewed",
  "launcher:getWidgetServerStatus",
  "launcher:getAssetStatus",
  "launcher:getHealthStatus",
  "launcher:getBootstrapStatus",
  "launcher:getRecentLogs",
  "launcher:getWidgetCatalogState",
  "launcher:getWidgetHotkeyControl",
  "launcher:updateWidgetHotkeyControl",
  "launcher:triggerWidgetHotkeyControl",
  "launcher:getAiCasterAccess",
  "launcher:updateAiCasterSettings",
  "launcher:previewAiCasterVoice",
  "launcher:getObserverCommandCenterSnapshot",
  "launcher:runObserverCommandAction",
  "launcher:launchShadowTracker",
  "launcher:startTelemetryBridge",
  "launcher:stopTelemetryBridge",
  "launcher:startVisualMode",
  "launcher:stopVisualMode",
  "launcher:consumePendingSyncCommand",
  "launcher:getConfig",
  "launcher:setConfig",
  "overlay:getConfig",
  "overlay:setConfig",
  "overlay:restart",
]);

const allowedSendSyncChannels = new Set([
  "launcher:pathExists",
  "launcher:isFile",
]);

function invoke(channel, payload) {
  if (!allowedInvokeChannels.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }

  return ipcRenderer.invoke(channel, payload);
}

function sendSync(channel, payload) {
  if (!allowedSendSyncChannels.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }

  return ipcRenderer.sendSync(channel, payload);
}

function subscribe(channel, callback) {
  const listener = (_event, payload) => {
    callback(payload);
  };

  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("arenzyra", {
  launcher: {
    invoke,
    onSyncPending(callback) {
      if (typeof callback !== "function") {
        return () => {};
      }
      return subscribe("launcher:sync-pending", () => callback());
    },
  },
  config: {
    get() {
      return invoke("launcher:getConfig");
    },
    getConfig() {
      return invoke("launcher:getConfig");
    },
    set(key, value) {
      return invoke("launcher:setConfig", { key, value });
    },
    setConfig(key, value) {
      return invoke("launcher:setConfig", { key, value });
    },
    subscribe(callback) {
      if (typeof callback !== "function") {
        return () => {};
      }
      return subscribe("launcher:configUpdated", callback);
    },
    subscribeConfig(callback) {
      if (typeof callback !== "function") {
        return () => {};
      }
      return subscribe("launcher:configUpdated", callback);
    },
  },
  assets: {
    getStatus() {
      return invoke("launcher:getAssetStatus");
    },
  },
  telemetry: {
    getStatus() {
      return invoke("launcher:getTelemetryStatus");
    },
  },
  health: {
    getStatus() {
      return invoke("launcher:getHealthStatus");
    },
  },
  bootstrap: {
    getStatus() {
      return invoke("launcher:getBootstrapStatus");
    },
  },
  logs: {
    getRecent(scope, limit) {
      return invoke("launcher:getRecentLogs", { scope, limit });
    },
  },
  system: {
    pathExists(targetPath) {
      const trimmed = String(targetPath || "").trim();
      if (!trimmed) {
        return false;
      }

      try {
        return (
          sendSync("launcher:pathExists", { targetPath: trimmed }) === true
        );
      } catch {
        return false;
      }
    },
    isFile(targetPath) {
      const trimmed = String(targetPath || "").trim();
      if (!trimmed) {
        return false;
      }

      try {
        return sendSync("launcher:isFile", { targetPath: trimmed }) === true;
      } catch {
        return false;
      }
    },
  },
});
