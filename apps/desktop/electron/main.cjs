const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const { fileURLToPath } = require("node:url");
const { createHash, randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const {
  createSingleFlight,
  discoverExecutablePaths,
  discoverRunningShadowTrackerProcesses,
  resolveProductionExecutableCandidates,
} = require("./shadowTrackerProcessDiscovery.cjs");
const axios = require("axios");
const {
  createLauncherApiClient,
  OBSERVER_LIMIT_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
} = require("./apiClient.cjs");
const { createBootstrapService } = require("./bootstrapService.cjs");
const { createConfigManager } = require("./configManager.cjs");
const { createHealthService } = require("./healthService.cjs");
const { createLogger, normalizeScope } = require("./logger.cjs");
const {
  createProductionModeService,
  isProductionReadyStatus,
} = require("./productionModeService.cjs");
const {
  resolveDesiredObserverFallbackMapKey,
  resolveLiveMatchMapSyncPlan,
} = require("./liveMatchMapSync.cjs");
const { generateShadowBranding } = require("./shadowBranding.cjs");
const { ensureDefaultTeamLogo } = require("./defaultTeamLogo.cjs");
const {
  REQUIRED_PUBG_MAP_KEYS,
} = require("./map-engine/map-asset-resolver.cjs");
const {
  resolveObserverBindHost,
  resolveWidgetServerHost,
  shouldAllowDirectObserverWidgetPolling,
  shouldPollDirectObserverWidgetRuntime,
  shouldEnableWidgetMutationRoutes,
} = require("./launcher-runtime-policy.cjs");
const {
  normalizePreviousMatchNumber,
  shouldApplyPreviousMatchSlotRecovery,
} = require("./slotRecoveryPolicy.cjs");
const { createSessionManager } = require("./sessionManager.cjs");
const { createWidgetCapabilityStore } = require("./widgetCapabilityStore.cjs");
const {
  downloadAndSanitizeRemoteImage,
  remoteImageReference,
  resolveAllowedRemoteImageUrl,
} = require("./remote-image-policy.cjs");
const { assertTrustedLauncherIpcSender } = require("./ipc-sender-policy.cjs");
const { createTelemetryBridge } = require("./telemetryBridge.cjs");
const { createVisualModeService } = require("./visualModeService.cjs");
const {
  HOTKEY_CONTROL_APPROVAL_KEY,
  createWidgetHotkeyControl,
} = require("./widgetHotkeyControl.cjs");
const {
  assertPcobMapSelectionMatchesActiveMap,
  normalizePcobMapSelection,
  observerMatchesSelection,
  preparePcobHotkeyInput,
  runPcobHotkeyInput,
  stopPcobHotkeyInput,
} = require("./pcobObserverControl.cjs");
const {
  resolvePcobMapControlLifecycle,
} = require("./pcobMapControlPolicy.cjs");
const {
  createObserverFeedStartGate,
  createObserverFeedSupervisor,
  isObserverFeedStartCancelledError,
  sameObserverFeedConfig,
  stopObserverProcessWithConfirmation,
} = require("./observerFeedSupervisor.cjs");
const {
  getExpectedObserverRuntime,
  matchesExpectedObserverRuntime,
} = require("./observer-runtime-health.cjs");
const {
  assertConnectorInstallPlan,
  assertVerifiedRuntimeInputs,
  atomicReplaceVerifiedFiles,
  createSanitizedConnectorEnv,
  inspectWindowsProcessIntegrity,
  isPathInside: isConnectorPathInside,
  readVerifiedRegularFile,
  resolveTrustedWindowsCommand,
} = require("./connector-runtime-security.cjs");
const {
  isLoopbackHostname: isConnectorLoopbackHostname,
} = require("./connector-http-access-policy.cjs");
const {
  createObserverRuntimeWatchdog,
} = require("./observerRuntimeWatchdog.cjs");
const { startWidgetsServer } = require("./widget-server/server.cjs");
let electronModule = require("electron");
const preloadPath = path.join(__dirname, "preload.cjs");
const mapControlPreloadPath = path.join(__dirname, "map-control-preload.cjs");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEAM_ASSETS_DIR = "C:\\ArenzyraObserver\\assets\\teams";
const PLAYER_ASSETS_DIR = "C:\\ArenzyraObserver\\assets\\players";
const CURRENT_PCOB_ROOT =
  "C:\\PCOB\\Win64_Release4.3.0_No14_4.3.0.20920_Shipping_OB_Shelled";
const OLDER_SHADOWTRACKER_EXECUTABLE =
  "C:\\PCOB 401\\WindowsNoEditor\\ShadowTrackerExtra\\Binaries\\Win64\\ShadowTrackerExtra.exe";
const LEGACY_SHADOWTRACKER_EXECUTABLE =
  "C:\\PCOB 402\\WindowsNoEditor\\ShadowTrackerExtra\\Binaries\\Win64\\ShadowTrackerExtra.exe";
const DEFAULT_SHADOWTRACKER_EXECUTABLE = path.join(
  CURRENT_PCOB_ROOT,
  "WindowsNoEditor",
  "ShadowTrackerExtra",
  "Binaries",
  "Win64",
  "ShadowTrackerExtra.exe",
);
const DEFAULT_TELEMETRY_BRIDGE_SCRIPT = path.join(
  CURRENT_PCOB_ROOT,
  "ObToolsNew",
  "ob.js",
);
const REPO_TELEMETRY_BRIDGE_SCRIPT = path.join(REPO_ROOT, "ob.js");
const CONNECTOR_RESOURCE_DIR_NAME = "connectors";
const CONNECTOR_SCRIPT_NAME = "ob.js";
const CONNECTOR_SUPPORT_FILE_NAMES = Object.freeze([
  "connector-http-access-policy.cjs",
  "direct-observer-transport-payload.cjs",
  "observer-runtime-health.cjs",
  "observer-telemetry-contract.cjs",
]);
const CONNECTOR_MANIFEST_NAME = "arenzyra-ob.version.json";
const CONNECTOR_BACKUP_PREFIX = "ob.arenzyra-backup";
const OLDER_SHADOWTRACKER_PREFIX = "C:\\PCOB 401\\";
const LEGACY_SHADOWTRACKER_PREFIX = "C:\\PCOB 402\\";
const DEFAULT_SHADOWTRACKER_PREFIX = `${CURRENT_PCOB_ROOT}\\`;
const PLACEHOLDER_LOGO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axzwoAAAAASUVORK5CYII=";
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const SESSION_INACTIVITY_WINDOW_DAYS = 15;
const SESSION_INACTIVITY_WINDOW_MS =
  SESSION_INACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const ACCESS_DENIED_ERROR_CODE = "ARENZYRA_LAUNCHER_ACCESS_DENIED";
const SHADOWTRACKER_PROCESS_NAME = "ShadowTrackerExtra.exe";
const DEFAULT_SHADOW_TELEMETRY_BASE_URL = "http://127.0.0.1:10086";
const DEFAULT_SHADOW_TELEMETRY_PORT = 10086;
const SHADOW_TELEMETRY_DISCOVERY_PORTS = Object.freeze([
  10086, 10085, 10087, 10088, 10089, 10090, 10091, 10092, 10093, 10094, 10095,
  11086,
]);
const SHADOW_TELEMETRY_PROBE_PATHS = [
  "/health",
  "/getallinfo",
  "/gettotalplayerlist",
  "/getteaminfolist",
  "/getteaminfo",
];
const SHADOW_TELEMETRY_PROBE_TIMEOUT_MS = 800;
const SHADOW_TELEMETRY_READY_TIMEOUT_MS = 8_000;
const SHADOW_TELEMETRY_READY_POLL_MS = 250;
const SHADOW_TELEMETRY_RECOVERY_COOLDOWN_MS = 10_000;
const SHADOW_TELEMETRY_DISCOVERY_CACHE_MS = 2_000;
const SHADOWTRACKER_PROCESS_DISCOVERY_CACHE_MS = 3_000;
const PCOB_OBSERVER_CONFIRM_TIMEOUT_MS = 2_500;
const PCOB_OBSERVER_CONFIRM_POLL_MS = 400;
const LOCAL_RUNTIME_LIFECYCLE_POLL_INTERVAL_MS = 2_000;
const LIVE_MATCH_MAP_REFRESH_INTERVAL_MS = 5_000;
const OBSERVER_FEED_RESTART_DELAYS_MS = Object.freeze([
  1_000, 2_000, 5_000, 10_000, 30_000,
]);
const OBSERVER_FEED_RESTART_WINDOW_MS = 2 * 60 * 1_000;
const OBSERVER_FEED_STABLE_RUN_MS = 60 * 1_000;
const OBSERVER_FEED_HEALTH_POLL_INTERVAL_MS = 2_000;
const OBSERVER_FEED_HEALTH_FAILURE_THRESHOLD = 3;
const OBSERVER_FEED_GRACEFUL_REQUEST_TIMEOUT_MS = 500;
const OBSERVER_MAP_FALLBACK_RETRY_DELAYS_MS = Object.freeze([
  250, 1_000, 5_000, 15_000,
]);
const OBSERVER_FEED_STOP_GRACE_TIMEOUT_MS = 1_250;
const OBSERVER_FEED_STOP_FORCE_TIMEOUT_MS = 1_750;
const OBSERVER_FEED_STOP_IDENTITY_TIMEOUT_MS = 1_000;
const OBSERVER_FEED_STOP_IDENTITY_POLL_MS = 100;
const PLAYER_PHOTO_CACHE_REFRESH_INTERVAL_MS = 15_000;
const OBSERVER_COMMAND_PATH_PREFIXES = Object.freeze([
  "/debug/operator/",
  "/debug/observer/",
  "/debug/camera-assist/",
]);
const MATCH_FLOW_STATES = new Set([
  "NO_MATCH",
  "MATCH_READY",
  "MATCH_LIVE",
  "PRODUCTION_CHECKING",
  "PRODUCTION_READY",
  "PRODUCTION_BLOCKED",
  "PRODUCTION_LIVE",
  "MATCH_FINISHED",
  "NEXT_MATCH_AVAILABLE",
  "NEXT_MATCH_PREPARED",
]);

function createDefaultMatchFlowState() {
  return {
    currentMatchId: null,
    currentStatus: null,
    nextMatchSuggestedId: null,
    nextMatchAvailable: false,
    workflowState: "NO_MATCH",
  };
}

function createDefaultProductionModeState() {
  return {
    status: null,
    matchId: null,
    selectedMapKey: null,
    blockingIssueCount: 0,
    warningCount: 0,
    lastCheckedAt: null,
  };
}

function createDefaultObserverFeedState() {
  return {
    enabled: false,
    running: false,
    mode: "off",
    managed: false,
    matchId: null,
    sessionId: null,
    pid: null,
    scriptPath: null,
    ready: false,
    lastError: null,
    lastStartedAt: null,
    lastStoppedAt: null,
  };
}

function summarizeProductionModeResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return createDefaultProductionModeState();
  }

  const selectedMapKey = Array.isArray(result.checks)
    ? result.checks.find((check) => check?.key === "assets")?.meta
        ?.selectedMapKey
    : null;

  return {
    status:
      typeof result.status === "string" && result.status.trim()
        ? result.status.trim()
        : null,
    matchId:
      typeof result.matchId === "string" && result.matchId.trim()
        ? result.matchId.trim()
        : null,
    selectedMapKey:
      typeof selectedMapKey === "string" && selectedMapKey.trim()
        ? selectedMapKey.trim().toLowerCase()
        : null,
    blockingIssueCount: Array.isArray(result.blockingIssues)
      ? result.blockingIssues.length
      : 0,
    warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
    lastCheckedAt:
      typeof result.checkedAt === "string" && result.checkedAt.trim()
        ? result.checkedAt.trim()
        : null,
  };
}

function shouldInvalidateProductionModeState(nextMatchFlow) {
  if (!productionModeState.matchId) {
    return false;
  }

  const currentMatchId =
    typeof nextMatchFlow?.currentMatchId === "string" &&
    nextMatchFlow.currentMatchId.trim()
      ? nextMatchFlow.currentMatchId.trim()
      : null;
  const currentStatus = normalizeMatchLifecycleStatus(
    nextMatchFlow?.currentStatus,
  );

  return (
    !currentMatchId ||
    currentMatchId !== productionModeState.matchId ||
    currentStatus === "ENDED" ||
    currentStatus === "FINISH_PENDING" ||
    currentStatus === "FINISHED"
  );
}

function normalizeMatchFlowState(payload) {
  const next = createDefaultMatchFlowState();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return next;
  }

  next.currentMatchId =
    typeof payload.currentMatchId === "string" && payload.currentMatchId.trim()
      ? payload.currentMatchId.trim()
      : null;
  next.currentStatus =
    typeof payload.currentStatus === "string" && payload.currentStatus.trim()
      ? payload.currentStatus.trim()
      : null;
  next.nextMatchSuggestedId =
    typeof payload.nextMatchSuggestedId === "string" &&
    payload.nextMatchSuggestedId.trim()
      ? payload.nextMatchSuggestedId.trim()
      : null;
  next.nextMatchAvailable =
    payload.nextMatchAvailable === true && Boolean(next.nextMatchSuggestedId);
  next.workflowState = MATCH_FLOW_STATES.has(payload.workflowState)
    ? payload.workflowState
    : "NO_MATCH";
  return next;
}

function migrateLegacyPrefix(inputPath, legacyPrefixes, nextPrefix) {
  let normalized = String(inputPath || "").trim();
  for (const prefix of legacyPrefixes) {
    if (normalized.startsWith(prefix)) {
      normalized = path.join(nextPrefix, normalized.slice(prefix.length));
      break;
    }
  }
  return normalized;
}

const logger = createLogger({
  getUserDataPath: () => {
    try {
      if (
        electronModule &&
        typeof electronModule !== "string" &&
        electronModule.app &&
        typeof electronModule.app.getPath === "function"
      ) {
        return electronModule.app.getPath("userData");
      }
    } catch {
      // ignore app path failures and fall back to local logs
    }

    return null;
  },
  fallbackLogsDir: path.join(__dirname, "..", "logs"),
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxLogFiles: 3,
  recentLimit: 1000,
  defaultRecentLimit: 100,
  mirrorToConsole: true,
});

function parseLegacyLogParts(args) {
  const parts = Array.isArray(args) ? [...args] : [args];
  if (parts.length === 0) {
    return {
      scope: "launcher",
      message: "Log entry",
      meta: undefined,
    };
  }

  const [first, ...rest] = parts;
  if (typeof first === "string") {
    const match = first.match(/^\[([^\]]+)\]\s*(.*)$/);
    const scope = normalizeScope(match ? match[1] : "launcher");
    const message = match ? match[2] || match[1] : first;
    const trimmedMessage = String(message || "").trim() || "Log entry";
    if (rest.length === 0) {
      return {
        scope,
        message: trimmedMessage,
        meta: undefined,
      };
    }
    return {
      scope,
      message: trimmedMessage,
      meta: rest.length === 1 ? rest[0] : rest,
    };
  }

  if (rest.length === 0) {
    return {
      scope: "launcher",
      message: "Log entry",
      meta: first,
    };
  }

  return {
    scope: "launcher",
    message: "Log entry",
    meta: [first, ...rest],
  };
}

function writeLegacyLog(level, args) {
  const entry = parseLegacyLogParts(args);
  logger[level](entry.scope, entry.message, entry.meta);
}

const log = (...args) => {
  writeLegacyLog("info", args);
};

const logWarn = (...args) => {
  writeLegacyLog("warn", args);
};

const logError = (...args) => {
  writeLegacyLog("error", args);
};

process.on("exit", (code) => log("[electron] process exit", code));
process.on("uncaughtException", (err) => {
  logError("[electron] uncaughtException", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (reason) => {
  logError("[electron] unhandledRejection", reason);
});

if (
  typeof electronModule === "string" ||
  !electronModule ||
  typeof electronModule.app === "undefined"
) {
  if (process.env.ARENZYRA_ELECTRON_RESPAWNED === "1") {
    logError(
      "[electron] respawn failed; still not getting electron module. Aborting.",
    );
    process.exit(1);
  }
  const electronPath =
    typeof electronModule === "string" ? electronModule : require("electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ARENZYRA_ELECTRON_RESPAWNED = "1";
  log("[electron] respawning real electron binary", electronPath);
  const child = spawn(electronPath, process.argv.slice(1), {
    stdio: "inherit",
    env,
  });
  child.on("exit", (code) => {
    log("[electron] respawned electron exited", code);
    process.exit(code ?? 0);
  });
  return;
}

const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} = electronModule;
const isDev = !app.isPackaged;
const devPort = process.env.DEV_SERVER_PORT || "5400";
const LAUNCHER_PROTOCOL = "arenzyra-launcher";
const APP_USER_MODEL_ID = "com.arenzyra.observerlauncher";

let telemetryBridgeProcess = null;
let telemetryBridgeScriptPath = "";
let telemetrySourceProcessConfig = null;
let telemetrySourceProcessGeneration = 0;
const telemetrySourceStopOperations = new WeakMap();
let lastConnectorSetupStatus = null;
let lastShadowTelemetryRecoveryAttemptAt = 0;
let shadowTelemetryBaseUrl = DEFAULT_SHADOW_TELEMETRY_BASE_URL;
let shadowTelemetryDiscoveryCache = {
  checkedAt: 0,
  health: null,
};
let shadowTrackerProcessDiscoveryCache = {
  checkedAt: 0,
  entries: [],
};
const shadowTrackerProcessDiscoverySingleFlight = createSingleFlight();
const telemetrySourceStoppingProcesses = new WeakSet();
let observerFeedState = createDefaultObserverFeedState();
const observerFeedStartGate = createObserverFeedStartGate();
const observerFeedSupervisor = createObserverFeedSupervisor({
  restartDelaysMs: OBSERVER_FEED_RESTART_DELAYS_MS,
  maxRestartAttempts: OBSERVER_FEED_RESTART_DELAYS_MS.length,
  restartWindowMs: OBSERVER_FEED_RESTART_WINDOW_MS,
  stableRunMs: OBSERVER_FEED_STABLE_RUN_MS,
  canRestart: validateObserverFeedRecoveryAuthority,
  restart: restartObserverFeedFromSupervisor,
  onStatusChange: synchronizeObserverFeedRecoveryState,
});
const observerFeedHealthWatchdog = createObserverRuntimeWatchdog({
  intervalMs: OBSERVER_FEED_HEALTH_POLL_INTERVAL_MS,
  failureThreshold: OBSERVER_FEED_HEALTH_FAILURE_THRESHOLD,
  probe: probeOwnedObserverRuntimeHealth,
  onUnhealthy: recycleUnhealthyObserverRuntime,
  onStatusChange: synchronizeObserverFeedHealthState,
});
let widgetDirectObserverPollingAllowed = false;
let localRuntimeLifecyclePollTimer = null;
let localRuntimeLifecyclePollInFlight = false;
let launcherAccessState = null;
let launcherHeartbeatTimer = null;
let quittingAfterCleanup = false;
let mainWindow = null;
let pendingSyncCommand = null;
let windowLoaded = false;
let commentatorDeskWindow = null;
let commentatorDeskWindowClickThrough = false;
let commentatorDeskWindowUrl = null;

function getMainWindowWebContents() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow.webContents;
}

function assertLauncherIpcSender(event) {
  assertTrustedLauncherIpcSender(event, {
    getMainWebContents: getMainWindowWebContents,
    rendererFilePath: path.join(__dirname, "../dist/index.html"),
    isDev,
    allowedDevOrigins: [`http://localhost:${devPort}`],
  });
}

function registerTrustedLauncherHandle(channel, handler) {
  if (!String(channel || "").startsWith("launcher:")) {
    throw new Error(
      "Trusted launcher IPC registrations require launcher:* channels.",
    );
  }
  ipcMain.handle(channel, (event, ...args) => {
    assertLauncherIpcSender(event);
    return handler(event, ...args);
  });
}

function registerTrustedLauncherOn(channel, handler) {
  if (!String(channel || "").startsWith("launcher:")) {
    throw new Error(
      "Trusted launcher IPC registrations require launcher:* channels.",
    );
  }
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertLauncherIpcSender(event);
    } catch (error) {
      logWarn("[ipc] rejected untrusted synchronous sender", {
        channel,
        code: error?.code || "ARENZYRA_IPC_SENDER_REJECTED",
      });
      event.returnValue = false;
      return;
    }
    handler(event, ...args);
  });
}
let mapControlWindow = null;
let mapControlWindowUrl = null;
let pcobMapControlBusy = false;
let pcobMapControlLastSelection = null;
let pcobMapControlConfirmationController = null;
let widgetServer = null;
const widgetAccessToken = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
const connectorAccessToken = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
if (connectorAccessToken === widgetAccessToken) {
  throw new Error("Connector and widget capabilities must be distinct.");
}
let pendingWidgetTeamBranding = null;
let cachedAiCasterAccess = null;
let cachedCommentatorDeskAccess = null;
let cachedOrganizationWidgetBranding = null;
const playerPhotoCacheRefreshState = {
  matchId: null,
  lastStartedAt: 0,
  inFlight: false,
};
let didConsumeStartupBootstrapResult = false;
let startupLicenseStatus = null;
let lastSessionActivityPersistAt = 0;
let matchFlowState = createDefaultMatchFlowState();
let productionModeState = createDefaultProductionModeState();
let liveMatchMapState = {
  matchId: null,
  mapKey: null,
  updatedAt: null,
};
let liveMatchMapRefreshPromise = null;
let lastLiveMatchMapRefreshAt = 0;
let observerMapFallbackSyncDesired = null;
let observerMapFallbackSyncPromise = null;
let observerMapFallbackInFlightIdentity = null;
let observerMapFallbackSyncEpoch = 0;
let observerMapFallbackLastAppliedIdentity = null;
let observerMapFallbackLastWarningAt = 0;
let observerMapFallbackRetryTimer = null;
let observerMapFallbackRetryAttempt = 0;
let observerMapFallbackRetryTarget = null;
const telemetryBridge = createTelemetryBridge({
  logger: logger.child("telemetry"),
  log,
  getShadowAccessToken: () =>
    String(
      telemetrySourceProcessConfig?.localControlToken || connectorAccessToken,
    ).trim(),
  refreshAuth: refreshTelemetryAuth,
  onUnauthorized: handleTelemetryUnauthorized,
  onStopped: (details = {}) => {
    void stopObserverFeedSilently(details.reason || "stopped");
  },
  onSnapshot: (snapshot) => {
    try {
      widgetServer?.ingestTelemetrySnapshot(snapshot);
    } catch (error) {
      logError(
        "[widget-server] snapshot ingest failed",
        error && error.stack ? error.stack : error,
      );
    }
  },
});
const sessionManager = createSessionManager({
  getUserDataPath: () => app.getPath("userData"),
  safeStorage,
});
const widgetCapabilityStore = createWidgetCapabilityStore({
  getUserDataPath: () => app.getPath("userData"),
  safeStorage,
});
const configManager = createConfigManager({
  getUserDataPath: () => app.getPath("userData"),
  isPackaged: app.isPackaged,
  env: process.env,
  log: logger.child("config").log,
});
const widgetHotkeyControl = createWidgetHotkeyControl({
  getConfig: () => configManager.getSettings()?.widgetHotkeyControl,
  setConfig: (config) => {
    configManager.setSettings({
      ...(configManager.getSettings() || {}),
      widgetHotkeyControl: config,
    });
    broadcastConfigUpdate("widget-hotkey-control");
  },
  getWidgetServer: () => widgetServer,
  log,
  logWarn,
  logError,
});
const visualModeService = createVisualModeService({
  desktopCapturer,
  logger: logger.child("visual"),
  getCaptureDir: () => path.join(app.getPath("userData"), "visual-captures"),
  orphanRetentionMs:
    Number(process.env.ARENZYRA_VISUAL_CAPTURE_RETENTION_HOURS) *
    60 *
    60 *
    1000,
  getSettings: () => configManager.getSettings(),
  setSettings: (settings) => {
    configManager.setSettings(settings);
    broadcastConfigUpdate("visual-mode");
  },
  onAutoReviewCandidate: (item) => queueAutomatedVisualOcrPreview(item),
});
const visualOcrInFlightItemIds = new Set();
let automatedVisualOcrRunning = false;
let queuedAutomatedVisualOcrId = null;
const healthService = createHealthService({
  logger: logger.child("health"),
  getConfig: () => getLauncherConfigView(),
  getSession: () => sessionManager.readSession(),
  getAccessState: () => launcherAccessState,
  getTelemetryStatus: () => telemetryBridge.getStatus(),
  getMatchFlow: () => ({ ...matchFlowState }),
  getProductionMode: () => ({
    ...productionModeState,
    workflowState: matchFlowState.workflowState,
  }),
  getWidgetStatus: () => getWidgetServerStatusView(),
  getAssetStatus: () => getAssetStatusView(),
  probeShadow: () => probeShadowTelemetryHealthWithRecovery(),
});
const productionModeService = createProductionModeService({
  logger: logger.child("production"),
  getHealthStatus: () => healthService.getStatus(),
  getMatchLifecycle: async (matchId) => {
    const session = getStoredSession();
    const control = await apiClient.getMatchControl({
      apiBase: session.apiBase,
      token: session.token,
      refreshToken: session.refreshToken,
      matchId,
    });
    return {
      ...control,
      status: normalizeMatchLifecycleStatus(
        control?.matchStatus || control?.status,
      ),
    };
  },
  resolveShadowExecutable: async (shadowTrackerPath) => {
    const resolvedShadowTrackerPath =
      await resolveShadowTrackerExecutableForProduction(shadowTrackerPath, {
        preferRunning: true,
        forceProcessScan: true,
      });
    if (resolvedShadowTrackerPath) {
      persistDetectedShadowTrackerPath(
        resolvedShadowTrackerPath,
        "production-mode",
      );
    }
    return resolvedShadowTrackerPath;
  },
  ensureConnectorInstalled: (shadowTrackerPath) =>
    ensureManagedTelemetryBridgeInstalled({ shadowTrackerPath }),
  getTelemetryStatus: () => telemetryBridge.getStatus(),
  resetTelemetryForMatch: () => telemetryBridge.resetForMatchSwitch(),
  getAssetStatus: () => getAssetStatusView(),
  getSession: () => getStoredSession(),
  syncTeams: (session, matchId) =>
    syncTeams(session, matchId, {
      repairSlots: true,
      syncPlayerPhotos: false,
    }),
  generateBranding: (session, matchId, context) =>
    generateBranding(session, matchId, context),
});
const bootstrapService = createBootstrapService({
  logger: logger.child("bootstrap"),
  stages: [
    {
      name: "APP_INIT",
      run: async () => {
        registerLauncherProtocol();
        return {
          meta: {
            appName: app.getName(),
            packaged: app.isPackaged,
            platform: process.platform,
            userDataPath: app.getPath("userData"),
          },
        };
      },
    },
    {
      name: "CONFIG_LOAD",
      run: async () => {
        ensureLegacyConfigMigration();
        const configView = syncRuntimeConfig("bootstrap");
        const connectorStatus = ensureManagedTelemetryBridgeInstalled({
          shadowTrackerPath: configView.shadowTrackerPath,
        });
        return {
          meta: {
            apiBase: configView.apiBase,
            apiBaseSource: configView.apiBaseSource,
            apiEnvironment: configView.apiEnvironment,
            shadowTrackerPath: configView.shadowTrackerPath || null,
            connector: {
              ok: connectorStatus.ok === true,
              status: connectorStatus.status || null,
              targetPath: connectorStatus.targetPath || null,
              targetStrategy: connectorStatus.targetStrategy || null,
              targetExisting: connectorStatus.targetExisting === true,
              shadowTrackerPath: connectorStatus.shadowTrackerPath || null,
              requiresAdmin: connectorStatus.requiresAdmin === true,
              error: connectorStatus.error || null,
            },
          },
        };
      },
    },
    {
      name: "SESSION_RESTORE",
      run: async () => {
        if (
          !shouldKeepSignedIn() &&
          hasStoredLauncherSession(sessionManager.readSession())
        ) {
          await endLauncherSession({ clearAuth: true });
        }

        const storedSession = sessionManager.readSession();
        const expiryInfo = getStoredSessionExpiryInfo();
        const hasStoredSession = hasStoredLauncherSession(storedSession);
        const expired = expiryInfo?.expired === true;
        if (!hasStoredSession || expired) {
          startupLicenseStatus = null;
          stopLauncherHeartbeat();
          launcherAccessState = null;
          telemetryBridge.stop("stopped");
          await stopObserverFeedSilently("stopped");
          visualModeService.stop("stopped");
        }

        return {
          meta: {
            sessionPresent: hasStoredSession && !expired,
            sessionExpired: expired,
            hasAccessToken: Boolean(String(storedSession?.token || "").trim()),
            hasRefreshToken: Boolean(
              String(storedSession?.refreshToken || "").trim(),
            ),
            keepSignedIn: shouldKeepSignedIn(),
            expiresAt: expiryInfo?.expiresAt || null,
            userId: storedSession?.user?.id
              ? String(storedSession.user.id)
              : null,
          },
        };
      },
    },
    {
      name: "AUTH_VALIDATION",
      run: async () => {
        const storedSession = sessionManager.readSession();
        const expiryInfo = getStoredSessionExpiryInfo();
        if (
          !hasStoredLauncherSession(storedSession) ||
          expiryInfo?.expired === true
        ) {
          startupLicenseStatus = null;
          return {
            meta: {
              authenticated: false,
              skipped: true,
              reason:
                expiryInfo?.expired === true
                  ? "INACTIVITY_EXPIRED"
                  : "NO_STORED_SESSION",
            },
          };
        }

        const resolvedSession =
          await validateStoredLauncherSession(normalizeBaseUrl());
        startupLicenseStatus = null;
        return {
          meta: {
            authenticated: resolvedSession.authenticated === true,
            source: resolvedSession.source,
            reason: resolvedSession.reason || null,
            userId: resolvedSession.session?.user?.id || null,
            organizationId:
              resolvedSession.session?.organization?.id ||
              resolvedSession.session?.user?.organizationId ||
              null,
          },
        };
      },
    },
    {
      name: "LICENSE_CHECK",
      run: async () => {
        const session = getStoredBootstrapSession();
        if (!session) {
          launcherAccessState = null;
          return {
            meta: {
              licenseValid: false,
              skipped: true,
              reason: "UNAUTHENTICATED",
            },
          };
        }

        const licenseStatus = await checkLauncherLicense(session);
        startupLicenseStatus = licenseStatus;
        launcherAccessState = licenseStatus.access;
        if (licenseStatus.valid !== true) {
          stopLauncherHeartbeat();
        }

        return {
          meta: {
            licenseValid: licenseStatus.valid === true,
            reason: licenseStatus.access?.reason || null,
            maxObservers: licenseStatus.access?.maxObservers ?? null,
            machineId: licenseStatus.access?.machineId || null,
          },
        };
      },
    },
    {
      name: "SEAT_ACQUIRE",
      run: async () => {
        const session = getStoredBootstrapSession();
        if (!session) {
          launcherAccessState = null;
          return {
            meta: {
              seatActive: false,
              skipped: true,
              reason: "UNAUTHENTICATED",
            },
          };
        }

        const licenseStatus =
          startupLicenseStatus || (await checkLauncherLicense(session));
        if (licenseStatus.valid !== true) {
          launcherAccessState = licenseStatus.access;
          stopLauncherHeartbeat();
          return {
            meta: {
              seatActive: false,
              skipped: true,
              reason: licenseStatus.access?.reason || "LICENSE_INVALID",
            },
          };
        }

        const access = await acquireLauncherSeat(session, licenseStatus, {
          startHeartbeat: true,
        });
        return {
          meta: {
            seatActive: access?.allowed === true,
            reason: access?.reason || null,
            activeSessions: access?.activeSessions ?? null,
            maxObservers: access?.maxObservers ?? null,
          },
        };
      },
    },
    {
      name: "START_WIDGET_SERVER",
      run: async () => {
        const widgetStatus = await ensureWidgetServerReady({
          refreshAccess: true,
        });
        return {
          meta: {
            running: widgetStatus.running,
            port: widgetStatus.port,
            baseUrl: widgetStatus.baseUrl,
          },
        };
      },
    },
    {
      name: "ASSET_VALIDATION",
      run: async () => {
        const assetStatus = getAssetStatusView();
        log(
          `[Assets] Maps available: ${assetStatus.requiredAvailable}/${assetStatus.requiredTotal}`,
        );
        log(
          `[Assets] Missing maps: ${
            assetStatus.requiredMissingKeys.length > 0
              ? assetStatus.requiredMissingKeys.join(", ")
              : "none"
          }`,
        );
        return {
          meta: {
            requiredTotal: assetStatus.requiredTotal,
            requiredAvailable: assetStatus.requiredAvailable,
            requiredMissingKeys: assetStatus.requiredMissingKeys,
          },
        };
      },
    },
    {
      name: "INITIAL_HEALTH_SNAPSHOT",
      run: async () => {
        const healthStatus = await healthService.getStatus();
        log("[launcher] initial health snapshot", {
          overallStatus: healthStatus.overallStatus,
          issues: healthStatus.issues,
        });
        return {
          meta: {
            overallStatus: healthStatus.overallStatus,
            issues: healthStatus.issues,
          },
        };
      },
    },
    {
      name: "READY_STATE",
      run: async () => ({
        meta: {
          ready: true,
        },
      }),
    },
  ],
});
let didRunLegacyConfigMigration = false;

function ensureLegacyConfigMigration() {
  if (didRunLegacyConfigMigration) {
    return;
  }

  didRunLegacyConfigMigration = true;
  const storedSession = sessionManager.readSession();
  if (storedSession?.apiBase) {
    configManager.migrateLegacyConfig(
      {
        apiBase: storedSession.apiBase,
      },
      {
        source: "session.json",
      },
    );
    sessionManager.writeSession(storedSession);
    log("[launcher] removed legacy apiBase from session.json");
  }

  const apiBaseDetails = configManager.getResolvedApiBaseDetails();
  log("[launcher] API base resolver ready", {
    apiBase: apiBaseDetails.apiBase,
    source: apiBaseDetails.source,
    apiEnvironment: apiBaseDetails.apiEnvironment,
    configPath: configManager.getConfigPath(),
  });
}

function getLauncherConfigView() {
  return configManager.getPublicConfig();
}

function shouldKeepSignedIn() {
  return configManager.getSettings()?.keepSignedIn !== false;
}

function isWidgetLanEnabled() {
  return configManager.getSettings()?.widgetLanEnabled === true;
}

function broadcastConfigUpdate(source = "system") {
  const configView = getLauncherConfigView();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win && !win.isDestroyed()) {
      win.webContents.send("launcher:configUpdated", {
        ...configView,
        source,
      });
    }
  }
  return configView;
}

function syncRuntimeConfig(source = "system") {
  const configView = getLauncherConfigView();
  const configuredShadowTelemetryBaseUrl =
    getShadowTelemetryBaseUrlFromSettings();
  if (configuredShadowTelemetryBaseUrl) {
    applyShadowTelemetryBaseUrl(configuredShadowTelemetryBaseUrl, source);
  } else {
    applyShadowTelemetryBaseUrl(shadowTelemetryBaseUrl, source);
  }
  const storedSession = sessionManager.readSession();
  if (storedSession?.token || storedSession?.refreshToken) {
    telemetryBridge.updateAuth({
      apiBase: configView.apiBase,
      token: storedSession?.token || "",
      refreshToken: storedSession?.refreshToken || "",
    });
  }
  widgetHotkeyControl.sync(source);
  return broadcastConfigUpdate(source);
}

function persistStoredSession(session) {
  const accessToken = String(
    session?.accessToken || session?.token || "",
  ).trim();
  const refreshToken = String(session?.refreshToken || "").trim();
  const resolvedApiBase = normalizeBaseUrl(session?.apiBase);

  if (!accessToken && !refreshToken) {
    sessionManager.clearSession();
    return null;
  }

  const nextSession = {
    token: accessToken,
    accessToken,
    refreshToken,
    user: session?.user ?? null,
    organization: session?.organization ?? null,
  };

  sessionManager.writeSession(nextSession);
  lastSessionActivityPersistAt = Date.now();
  telemetryBridge.updateAuth({
    apiBase: resolvedApiBase,
    token: nextSession.token,
    refreshToken: nextSession.refreshToken,
  });
  return {
    ...nextSession,
    apiBase: resolvedApiBase,
  };
}

function touchStoredSessionActivity(reason = "api-request") {
  const session = sessionManager.readSession();
  if (!session?.token && !session?.refreshToken) {
    return null;
  }

  const activityMs = Date.now();
  const persistedActivityMs = toNullableTimestamp(
    session.lastActiveAt || session.lastAuthenticatedAt || session.updatedAt,
  );
  const lastKnownActivityMs = Number.isFinite(persistedActivityMs)
    ? persistedActivityMs
    : lastSessionActivityPersistAt;

  if (
    Number.isFinite(lastKnownActivityMs) &&
    activityMs - lastKnownActivityMs < SESSION_ACTIVITY_TOUCH_INTERVAL_MS
  ) {
    lastSessionActivityPersistAt = lastKnownActivityMs;
    return session;
  }

  const nextSession = sessionManager.touchSessionActivity(
    new Date(activityMs).toISOString(),
  );
  if (nextSession) {
    lastSessionActivityPersistAt = activityMs;
    log("[auth] session activity refreshed", { reason });
  }
  return nextSession;
}

function shouldPreserveSessionAfterUnauthorized(details = {}) {
  const currentSession = sessionManager.readSession();
  const currentAccessToken = String(
    currentSession?.token || currentSession?.accessToken || "",
  ).trim();
  const currentRefreshToken = String(currentSession?.refreshToken || "").trim();
  const failedAccessToken = String(details?.accessToken || "").trim();
  const failedRefreshToken = String(details?.refreshToken || "").trim();

  if (!currentAccessToken && !currentRefreshToken) {
    return false;
  }

  return (
    Boolean(failedRefreshToken && currentRefreshToken !== failedRefreshToken) ||
    Boolean(failedAccessToken && currentAccessToken !== failedAccessToken)
  );
}

const apiClient = createLauncherApiClient({
  resolveApiBase: normalizeBaseUrl,
  getSession: () => sessionManager.readSession(),
  onSessionUpdate: async (session) => {
    const currentSession = sessionManager.readSession() ?? {};
    persistStoredSession({
      ...currentSession,
      ...session,
      user: session?.user ?? currentSession.user ?? null,
      organization:
        session?.organization ?? currentSession.organization ?? null,
    });
  },
  onActivity: async (activity) => {
    touchStoredSessionActivity(
      `api:${String(activity?.method || "GET").toUpperCase()} ${String(
        activity?.path || "",
      )}`,
    );
  },
  onUnauthorized: async (details = {}) => {
    if (shouldPreserveSessionAfterUnauthorized(details)) {
      logWarn("[auth] ignoring stale unauthorized after session refresh", {
        path: details?.path || null,
        method: details?.method || null,
      });
      return;
    }

    stopLauncherHeartbeat();
    launcherAccessState = null;
    startupLicenseStatus = null;
    telemetryBridge.stop("stopped");
    await stopObserverFeedSilently("stopped");
    visualModeService.stop("stopped");
    lastSessionActivityPersistAt = 0;
    sessionManager.clearSession();
  },
});

async function refreshTelemetryAuth(params = {}) {
  const storedSession = sessionManager.readSession() ?? {};
  const resolvedApiBase = normalizeBaseUrl(
    params?.apiBase || storedSession?.apiBase,
  );
  const refreshToken = String(
    params?.refreshToken || storedSession?.refreshToken || "",
  ).trim();

  if (!refreshToken) {
    const error = new Error("Telemetry refresh token is unavailable.");
    error.status = 401;
    throw error;
  }

  const restored = await apiClient.restoreSession({
    apiBase: resolvedApiBase,
    refreshToken,
  });
  const nextSession = persistStoredSession({
    ...storedSession,
    apiBase: restored.apiBase,
    token: restored.accessToken,
    accessToken: restored.accessToken,
    refreshToken: restored.refreshToken || refreshToken,
    user: restored.user ?? storedSession.user ?? null,
    organization: restored.organization ?? storedSession.organization ?? null,
  });

  return {
    apiBase: nextSession?.apiBase || restored.apiBase || resolvedApiBase,
    accessToken: nextSession?.token || restored.accessToken,
    token: nextSession?.token || restored.accessToken,
    refreshToken:
      nextSession?.refreshToken || restored.refreshToken || refreshToken,
    user: nextSession?.user ?? restored.user ?? null,
    organization: nextSession?.organization ?? restored.organization ?? null,
  };
}

async function handleTelemetryUnauthorized(details = {}) {
  logWarn("[telemetry] authorization failed; preserving launcher session", {
    matchId: details?.matchId ?? null,
    sessionId: details?.sessionId ?? null,
    error:
      details?.error instanceof Error
        ? details.error.message
        : details?.error
          ? String(details.error)
          : null,
  });
}

function toNullableTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getAlivePlayersFromUpdate(update) {
  const players = Array.isArray(update?.players) ? update.players : [];
  if (players.length === 0) {
    return null;
  }

  return players.filter((player) => player?.alive !== false).length;
}

function getAliveTeamsFromUpdate(update) {
  const players = Array.isArray(update?.players) ? update.players : [];
  if (players.length === 0) {
    return null;
  }

  const aliveTeamIds = new Set();
  for (const player of players) {
    if (player?.alive === false) {
      continue;
    }
    const teamId = String(player?.teamId || player?.teamSlot || "").trim();
    if (teamId) {
      aliveTeamIds.add(teamId);
    }
  }

  return aliveTeamIds.size > 0 ? aliveTeamIds.size : null;
}

function getRuntimeTelemetryStatusLabel(telemetryStatus = {}) {
  if (telemetryStatus?.resultFinalized === true) {
    return "finalized";
  }
  if (telemetryStatus?.isFinalizing === true) {
    return "finalizing";
  }
  if (telemetryStatus?.telemetryActive === true) {
    return "active";
  }
  if (telemetryStatus?.telemetryAccepted === true) {
    return "accepted";
  }
  if (telemetryStatus?.packetsReceiving === true) {
    return "receiving";
  }
  if (telemetryStatus?.transportConnected === true) {
    return "connected";
  }
  return telemetryStatus?.connectionStatus ?? "stopped";
}

function hasAcceptedRuntimeTelemetry(telemetryStatus = {}) {
  return (
    telemetryStatus?.telemetryActive === true ||
    telemetryStatus?.telemetryAccepted === true
  );
}

function buildEmptyObserverCommandCenterSnapshot() {
  const telemetryStatus = telemetryBridge.getStatus();
  return {
    telemetry: {
      connected: hasAcceptedRuntimeTelemetry(telemetryStatus),
      lastUpdateAt: toNullableTimestamp(telemetryStatus.lastPacketTime),
      mapKey: null,
      playerCount: null,
      phase: telemetryStatus.phase ?? null,
      connectionStatus: getRuntimeTelemetryStatusLabel(telemetryStatus),
      matchId: telemetryStatus.matchId ?? null,
      packetsPerSecond: telemetryStatus.packetsPerSecond ?? 0,
      aliveTeams: telemetryStatus.aliveTeams ?? null,
      alivePlayers: telemetryStatus.alivePlayers ?? null,
      gameTime: telemetryStatus.gameTime ?? null,
      circleIndex: telemetryStatus.circleIndex ?? null,
      circleStatus: telemetryStatus.circleStatus ?? null,
      lastError: telemetryStatus.lastError ?? null,
      totalPackets: telemetryStatus.totalPackets ?? 0,
    },
    widgetServer: {
      running: false,
      port: null,
      host: null,
      path: null,
      clientCount: 0,
      lastBroadcastAt: null,
    },
    mapContext: null,
    mapKey: null,
    recommendation: null,
    cameraAssistPayload: null,
    observerControlSuggestion: null,
    observerOperatorSuggestion: null,
    watchTargets: [],
    alerts: [],
    replayCandidates: [],
    operatorState: null,
    operatorDetails: null,
    operatorWorkflowState: null,
    operatorWorkflowConfig: null,
    pinState: null,
    updatedAt: Date.now(),
  };
}

function buildObserverCommandCenterSnapshot(preferredMapKey = null) {
  if (!widgetServer?.engine) {
    return buildEmptyObserverCommandCenterSnapshot();
  }

  const telemetryStatus = telemetryBridge.getStatus();
  const engineStatus =
    typeof widgetServer.engine.getStatus === "function"
      ? widgetServer.engine.getStatus()
      : null;
  const requestedMapKey =
    String(preferredMapKey || engineStatus?.currentMapKey || "").trim() || null;
  const engineSnapshot =
    typeof widgetServer.engine.getSnapshot === "function"
      ? widgetServer.engine.getSnapshot(requestedMapKey)
      : null;
  const productionSupport =
    engineSnapshot?.productionSupport ??
    engineStatus?.latestProductionSupport ??
    null;
  const latestPlayers =
    engineSnapshot?.players ?? engineStatus?.latestPlayerUpdate ?? null;
  const latestPlayerTimestamp =
    toNullableTimestamp(latestPlayers?.receivedAt) ??
    toNullableTimestamp(latestPlayers?.timestamp);
  const latestAlivePlayers = getAlivePlayersFromUpdate(latestPlayers);
  const latestAliveTeams = getAliveTeamsFromUpdate(latestPlayers);
  const widgetStatus =
    typeof widgetServer.getStatus === "function"
      ? widgetServer.getStatus()
      : {
          running: true,
          port: widgetServer.port ?? null,
          host: widgetServer.host ?? null,
          path: null,
          clientCount: 0,
          lastBroadcastAt: null,
        };
  const resolvedMapKey =
    productionSupport?.mapKey ??
    engineSnapshot?.mapContext?.mapKey ??
    engineStatus?.currentMapKey ??
    requestedMapKey ??
    null;

  return {
    telemetry: {
      connected: hasAcceptedRuntimeTelemetry(telemetryStatus),
      lastUpdateAt:
        toNullableTimestamp(telemetryStatus.lastPacketTime) ??
        latestPlayerTimestamp,
      mapKey: resolvedMapKey,
      playerCount: Array.isArray(latestPlayers?.players)
        ? latestPlayers.players.length
        : null,
      phase: telemetryStatus.phase ?? null,
      connectionStatus: getRuntimeTelemetryStatusLabel(telemetryStatus),
      matchId: telemetryStatus.matchId ?? null,
      packetsPerSecond: telemetryStatus.packetsPerSecond ?? 0,
      aliveTeams: telemetryStatus.aliveTeams ?? latestAliveTeams,
      alivePlayers: telemetryStatus.alivePlayers ?? latestAlivePlayers,
      gameTime: telemetryStatus.gameTime ?? null,
      circleIndex: telemetryStatus.circleIndex ?? null,
      circleStatus: telemetryStatus.circleStatus ?? null,
      lastError: telemetryStatus.lastError ?? null,
      totalPackets: telemetryStatus.totalPackets ?? 0,
    },
    widgetServer: {
      running: widgetStatus.running !== false,
      port: widgetStatus.port ?? null,
      host: widgetStatus.host ?? null,
      path: widgetStatus.path ?? null,
      clientCount: widgetStatus.clientCount ?? 0,
      lastBroadcastAt: widgetStatus.lastBroadcastAt ?? null,
    },
    mapContext: engineSnapshot?.mapContext ?? null,
    mapKey: resolvedMapKey,
    recommendation:
      productionSupport?.cameraAssistPayload?.recommendation ?? null,
    cameraAssistPayload: productionSupport?.cameraAssistPayload ?? null,
    observerControlSuggestion:
      productionSupport?.observerControlSuggestion ?? null,
    observerOperatorSuggestion:
      productionSupport?.observerOperatorSuggestion ?? null,
    watchTargets: Array.isArray(productionSupport?.watchTargets)
      ? productionSupport.watchTargets
      : [],
    alerts: Array.isArray(productionSupport?.activeAlerts)
      ? productionSupport.activeAlerts
      : [],
    replayCandidates: Array.isArray(productionSupport?.replayCandidates)
      ? productionSupport.replayCandidates
      : [],
    operatorState: productionSupport?.operatorState ?? null,
    operatorDetails: productionSupport?.operatorDetails ?? null,
    operatorWorkflowState: productionSupport?.operatorWorkflowState ?? null,
    operatorWorkflowConfig: productionSupport?.operatorWorkflowConfig ?? null,
    pinState: productionSupport?.pinState ?? engineStatus?.pinState ?? null,
    updatedAt:
      productionSupport?.updatedAt ??
      engineSnapshot?.mapContext?.timestamp ??
      Date.now(),
  };
}

function normalizeObserverCommandPath(inputPath, mapKey = null) {
  const candidate = String(inputPath || "").trim();
  if (!candidate.startsWith("/")) {
    throw new Error("Observer command path must start with '/'.");
  }

  const parsed = new URL(candidate, "http://127.0.0.1");
  if (
    !OBSERVER_COMMAND_PATH_PREFIXES.some((prefix) =>
      parsed.pathname.startsWith(prefix),
    )
  ) {
    throw new Error(`Unsupported observer command path: ${parsed.pathname}`);
  }

  const normalizedMapKey = String(mapKey || "").trim();
  if (normalizedMapKey && !parsed.searchParams.has("map")) {
    parsed.searchParams.set("map", normalizedMapKey);
  }

  const query = parsed.searchParams.toString();
  return `${parsed.pathname}${query ? `?${query}` : ""}`;
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function isPathInside(parentPath, targetPath) {
  const parent = path.resolve(parentPath);
  const target = path.resolve(targetPath);
  return target === parent || target.startsWith(`${parent}${path.sep}`);
}

function isAllowedRendererNavigation(urlValue) {
  const raw = String(urlValue || "").trim();
  if (!raw) {
    return false;
  }

  try {
    const parsed = new URL(raw);
    if (isDev) {
      return (
        parsed.protocol === "http:" &&
        isLoopbackHostname(parsed.hostname) &&
        String(parsed.port || "80") === String(devPort)
      );
    }

    if (parsed.protocol !== "file:") {
      return false;
    }

    const distRoot = path.resolve(__dirname, "../dist");
    return isPathInside(distRoot, fileURLToPath(parsed));
  } catch {
    return false;
  }
}

function openValidatedExternalUrl(urlValue, source = "renderer") {
  let externalUrl;
  try {
    externalUrl = normalizeHttpUrl(urlValue);
  } catch (error) {
    logWarn("[electron] blocked external URL", {
      source,
      url: String(urlValue || ""),
      reason:
        error instanceof Error
          ? error.message
          : String(error || "Invalid URL."),
    });
    return;
  }

  shell.openExternal(externalUrl).catch((error) => {
    logWarn("[electron] failed to open external URL", {
      source,
      url: externalUrl,
      error:
        error instanceof Error
          ? error.message
          : String(error || "openExternal failed."),
    });
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

function createWindow() {
  const iconPath = resolveWindowIconPath();
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#08141c",
    show: true,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
    },
  });
  mainWindow = win;
  windowLoaded = false;

  win.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      logWarn("[electron] blocked renderer permission request", { permission });
      callback(false);
    },
  );

  win.webContents.setWindowOpenHandler((details) => {
    openValidatedExternalUrl(details?.url, "window-open");
    return { action: "deny" };
  });

  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
    logWarn("[electron] blocked webview attachment");
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isAllowedRendererNavigation(url)) {
      return;
    }

    event.preventDefault();
    logWarn("[electron] blocked renderer navigation", { url });
    openValidatedExternalUrl(url, "navigation");
  });

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
      windowLoaded = false;
    }
  });

  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    logError("[electron] Renderer load failed", { code, desc, url });
    if (!isDev) return;
    win
      .loadURL(`http://localhost:${devPort}`)
      .then(() => log("[electron] Reloaded dev server after fail"))
      .catch((err) => {
        logWarn(
          "[electron] Retry loadURL failed, falling back to dist",
          err && err.stack ? err.stack : err,
        );
        const indexPath = path.join(__dirname, "../dist/index.html");
        win
          .loadFile(indexPath)
          .catch((loadErr) =>
            logError(
              "[electron] loadFile failed",
              loadErr && loadErr.stack ? loadErr.stack : loadErr,
            ),
          );
      });
  });

  win.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      const meta = { level, line, sourceId };
      if (level >= 3) {
        logError("[renderer] console", { ...meta, message });
        return;
      }
      if (level === 2) {
        logWarn("[renderer] console", { ...meta, message });
        return;
      }
      log("[renderer] console", { ...meta, message });
    },
  );

  win.webContents.on("render-process-gone", (_event, details) => {
    logError("[electron] render process gone", details);
  });

  win.webContents.on("preload-error", (_event, preloadPathValue, error) => {
    logError("[electron] preload error", {
      preloadPath: preloadPathValue,
      error: error && error.stack ? error.stack : error,
    });
  });

  win.webContents.on("did-finish-load", () => {
    windowLoaded = true;
    if (pendingSyncCommand) {
      win.webContents.send("launcher:sync-pending");
    }
  });

  if (isDev) {
    win
      .loadURL(`http://localhost:${devPort}`)
      .then(() => log("[electron] Loaded dev server", devPort))
      .catch((err) => {
        log(
          "[electron] Failed to load dev server",
          err && err.stack ? err.stack : err,
        );
      });
    return;
  }

  const indexPath = path.join(__dirname, "../dist/index.html");
  win
    .loadFile(indexPath)
    .then(() => {
      log("[electron] Loaded dist HTML");
    })
    .catch((err) => {
      log(
        "[electron] Failed to load dist HTML",
        err && err.stack ? err.stack : err,
      );
    });
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function normalizeOptionalString(value) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function pathExistsOnDisk(targetPath) {
  const trimmed = String(targetPath || "").trim();
  return Boolean(trimmed) && fs.existsSync(trimmed);
}

function isFileOnDisk(targetPath) {
  const trimmed = String(targetPath || "").trim();
  if (!trimmed) {
    return false;
  }

  try {
    return fs.statSync(trimmed).isFile();
  } catch {
    return false;
  }
}

function resolveWindowIconPath() {
  const candidates = [
    path.join(process.resourcesPath, "icon.ico"),
    path.join(__dirname, "../build/icon.ico"),
    path.join(app.getAppPath(), "build", "icon.ico"),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function resolveBundledDefaultTeamPath() {
  const candidates = [
    path.join(process.resourcesPath, "default-team.png"),
    path.join(__dirname, "../build/default-team.png"),
    path.join(app.getAppPath(), "build", "default-team.png"),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function resolveBundledShadowLogoTemplatePath() {
  const candidates = [
    path.join(process.resourcesPath, "shadow-logo-template.svg"),
    path.join(__dirname, "../build/shadow-logo-template.svg"),
    path.join(app.getAppPath(), "build", "shadow-logo-template.svg"),
    path.join(
      REPO_ROOT,
      "apps",
      "api",
      "public",
      "assets",
      "defaults",
      "shadow-logo-template.svg",
    ),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

function parseSyncCommand(rawUrl) {
  const normalizedUrl = String(rawUrl || "").trim();
  if (!normalizedUrl) return null;

  let parsed;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${LAUNCHER_PROTOCOL}:`) {
    return null;
  }

  const action = (
    parsed.hostname || parsed.pathname.replace(/^\/+/, "")
  ).toLowerCase();
  if (action !== "sync") {
    return null;
  }

  const matchId = normalizeOptionalString(parsed.searchParams.get("matchId"));
  if (!matchId) {
    return null;
  }

  return {
    apiBase: normalizeOptionalString(parsed.searchParams.get("apiBase")),
    tournamentId: normalizeOptionalString(
      parsed.searchParams.get("tournamentId"),
    ),
    matchId,
  };
}

function queueSyncCommand(command) {
  if (!command?.matchId) {
    return;
  }
  pendingSyncCommand = command;
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (bootstrapService.getStatus().ready === true) {
      createWindow();
    }
    return;
  }
  focusMainWindow();
  if (windowLoaded) {
    mainWindow.webContents.send("launcher:sync-pending");
  }
}

function consumeProtocolArguments(argv) {
  for (const entry of argv || []) {
    const command = parseSyncCommand(entry);
    if (command) {
      log("[launcher] received sync deep link", command);
      queueSyncCommand(command);
      return true;
    }
  }
  return false;
}

function registerLauncherProtocol() {
  try {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient(LAUNCHER_PROTOCOL);
      return;
    }

    const entryScript = process.argv[1] ? path.resolve(process.argv[1]) : "";
    if (entryScript) {
      app.setAsDefaultProtocolClient(LAUNCHER_PROTOCOL, process.execPath, [
        entryScript,
      ]);
    } else {
      app.setAsDefaultProtocolClient(LAUNCHER_PROTOCOL);
    }
  } catch (error) {
    logError(
      "[launcher] failed to register protocol",
      error && error.stack ? error.stack : error,
    );
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeBaseUrl(value) {
  return configManager.resolveApiBase(value);
}

function adoptBootstrapApiBaseHint(apiBaseHint) {
  const currentApiBase = configManager.getResolvedApiBaseDetails();
  if (currentApiBase.source !== "fallback") {
    return currentApiBase.apiBase;
  }

  const normalizedHint = configManager.tryNormalizeApiBase(apiBaseHint);
  if (!normalizedHint || normalizedHint === currentApiBase.apiBase) {
    return currentApiBase.apiBase;
  }

  const result = configManager.setApiBase(normalizedHint, {
    source: "bootstrap-hint",
  });
  if (result.changed) {
    log("[launcher] adopted legacy API base hint", {
      apiBase: result.apiBase,
      source: "bootstrap-hint",
    });
    syncRuntimeConfig("bootstrap-hint");
  }

  return normalizeBaseUrl();
}

function persistUserConfiguredApiBase(apiBaseHint, source) {
  const normalizedHint = configManager.tryNormalizeApiBase(apiBaseHint);
  if (!normalizedHint) {
    return normalizeBaseUrl();
  }

  const currentApiBase = configManager.getResolvedApiBaseDetails();
  if (normalizedHint === currentApiBase.apiBase) {
    return currentApiBase.apiBase;
  }

  const result = configManager.setApiBase(normalizedHint, { source });
  if (result.changed) {
    log("[launcher] stored user-selected API base", {
      apiBase: result.apiBase,
      source,
    });
    syncRuntimeConfig(source);
  }

  return normalizeBaseUrl();
}

async function setLauncherConfigValue(key, value, source = "renderer") {
  const previousWidgetLanEnabled = isWidgetLanEnabled();
  const result = configManager.setConfigValue(key, value, { source });
  let configView = getLauncherConfigView();
  if (result.changed) {
    log("[config] renderer config updated", {
      key,
      source,
    });
    configView = syncRuntimeConfig(source);
  }

  const nextWidgetLanEnabled = isWidgetLanEnabled();
  if (result.changed && previousWidgetLanEnabled !== nextWidgetLanEnabled) {
    try {
      await restartWidgetServerForRuntimePolicyChange("widget-lan-config");
    } catch (error) {
      logWarn(
        "[widget-server] LAN setting restart failed; restoring previous setting",
        {
          error: error instanceof Error ? error.message : String(error),
          previousWidgetLanEnabled,
          nextWidgetLanEnabled,
        },
      );
      try {
        configManager.setConfigValue(
          "settings",
          { widgetLanEnabled: previousWidgetLanEnabled },
          { source: `${source}:rollback` },
        );
        configView = syncRuntimeConfig(`${source}:rollback`);
        await restartWidgetServerForRuntimePolicyChange("widget-lan-rollback");
      } catch (rollbackError) {
        logWarn("[widget-server] LAN setting rollback failed", {
          error:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
        });
      }
      throw error;
    }
  }
  return configView;
}

function normalizeHttpUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    throw new Error("URL is required.");
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL: ${trimmed}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  return parsed.toString();
}

function asOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function getWidgetCatalogErrorMessage(error, fallback) {
  const responseData = error?.response?.data;
  if (Array.isArray(responseData?.message) && responseData.message.length > 0) {
    return responseData.message.map((item) => String(item)).join(", ");
  }
  if (
    typeof responseData?.message === "string" &&
    responseData.message.trim()
  ) {
    return responseData.message.trim();
  }
  if (typeof responseData?.error === "string" && responseData.error.trim()) {
    return responseData.error.trim();
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

const COMMENTATOR_DESK_WIDGET_KEY = "commentator-desk";
const EXPLICIT_WIDGET_APPROVAL_KEYS = new Set([
  "ai-caster",
  COMMENTATOR_DESK_WIDGET_KEY,
  HOTKEY_CONTROL_APPROVAL_KEY,
  "map",
]);

const INCLUDED_WIDGET_KEYS = new Set([
  "next-zone-update",
  "next-zone-update-pro-sidebar",
  "next-zone-update-kinetic-hud",
  "next-zone-update-blade",
  "next-zone-update-radar-sweep",
  "next-zone-update-fold-down",
]);

function isWidgetApprovedForCatalog(approval, enforced, widgetKey) {
  return (
    INCLUDED_WIDGET_KEYS.has(widgetKey) ||
    approval?.isApproved === true ||
    (!approval &&
      enforced === false &&
      !EXPLICIT_WIDGET_APPROVAL_KEYS.has(widgetKey))
  );
}

function getApprovalRecordFromAccessList(accessList, widgetKey) {
  const normalizedWidgetKey = String(widgetKey || "").trim();
  if (!normalizedWidgetKey) {
    return null;
  }
  return (
    (Array.isArray(accessList?.approvals) ? accessList.approvals : []).find(
      (approval) =>
        String(approval?.widgetKey || "").trim() === normalizedWidgetKey,
    ) || null
  );
}

function buildRouteAccessFromCatalogItem({
  accessList,
  catalogItem,
  organizationId,
  widgetKey,
}) {
  const approved = catalogItem?.approved === true;
  const organizationSlug =
    asOptionalString(catalogItem?.organizationSlug) ||
    asOptionalString(accessList?.organizationSlug) ||
    asOptionalString(accessList?.organization?.slug);
  const approval = getApprovalRecordFromAccessList(accessList, widgetKey);
  return {
    featureKey: widgetKey,
    widgetKey,
    organization:
      organizationId || organizationSlug
        ? {
            id: organizationId || null,
            slug: organizationSlug || null,
            name: asOptionalString(accessList?.organization?.name),
          }
        : null,
    approved,
    approval: approval
      ? {
          widgetKey,
          isApproved: approval.isApproved === true,
          approvedAt: asOptionalString(approval.approvedAt),
          approvedBy: asOptionalString(approval.approvedBy),
        }
      : null,
    canUse: approved,
    reason: approved ? null : "SUPER_ADMIN_APPROVAL_REQUIRED",
  };
}

function publishCommentatorDeskAccessToWidgetServer(access) {
  cachedCommentatorDeskAccess = access ?? null;
  if (
    widgetServer &&
    typeof widgetServer.setCommentatorDeskAccess === "function"
  ) {
    widgetServer.setCommentatorDeskAccess(cachedCommentatorDeskAccess);
  }
}

function publishWidgetHotkeyControlApproval(catalogItem) {
  const approved = catalogItem?.approved === true;
  return widgetHotkeyControl.setApproval({
    isApproved: approved,
    reason: approved
      ? null
      : catalogItem?.message || "SUPER_ADMIN_APPROVAL_REQUIRED",
  });
}

async function getWidgetCatalogState(payload) {
  assertLauncherAccess();
  const session = getStoredSession();
  const organizationId =
    asOptionalString(payload?.organizationId) ||
    asOptionalString(session?.organization?.id) ||
    asOptionalString(session?.user?.organizationId);
  const requestedWidgetKeys = Array.from(
    new Set(
      (Array.isArray(payload?.widgetKeys) ? payload.widgetKeys : [])
        .map((widgetKey) => String(widgetKey || "").trim())
        .filter(Boolean),
    ),
  );
  const accessOnlyWidgetKeys = new Set(
    (Array.isArray(payload?.accessOnlyWidgetKeys)
      ? payload.accessOnlyWidgetKeys
      : []
    )
      .map((widgetKey) => String(widgetKey || "").trim())
      .filter(Boolean),
  );
  const widgetKeys = Array.from(
    new Set([...requestedWidgetKeys, ...accessOnlyWidgetKeys]),
  );

  if (!organizationId || widgetKeys.length === 0) {
    return {
      organizationId: organizationId ?? null,
      organizationSlug: null,
      enforced: false,
      items: {},
    };
  }

  let accessList = null;
  try {
    accessList = await apiClient.getWidgetAccessList({
      apiBase: session.apiBase,
      token: session.token || session.accessToken,
      refreshToken: session.refreshToken,
      organizationId,
    });
  } catch (error) {
    const message = getWidgetCatalogErrorMessage(
      error,
      "Failed to load widget access list.",
    );
    logWarn("[widget-catalog] access-list failed", message);
    throw new Error(message);
  }

  const organizationSlug =
    asOptionalString(accessList?.organizationSlug) ||
    asOptionalString(accessList?.organization?.slug);
  // The launcher can switch organization context while the local widget
  // server stays alive. Refresh before publishing the new route metadata so
  // raw OBS pages never keep the previous organization's palette.
  await refreshOrganizationWidgetBranding(session, {
    throwOnError: false,
    organizationId,
  });
  const accessListBranding =
    accessList?.organization?.branding &&
    typeof accessList.organization.branding === "object"
      ? accessList.organization.branding
      : (cachedOrganizationWidgetBranding?.branding ?? null);
  publishOrganizationWidgetBranding({
    organizationId,
    organizationSlug,
    organization: {
      id: organizationId,
      slug: organizationSlug,
      name: asOptionalString(accessList?.organization?.name),
      branding: accessListBranding,
    },
    branding: accessListBranding,
  });
  const enforced = accessList?.enforced === true;
  const approvals = new Map(
    (Array.isArray(accessList?.approvals) ? accessList.approvals : [])
      .map((approval) => {
        const widgetKey = String(approval?.widgetKey || "").trim();
        if (!widgetKey) {
          return null;
        }
        return [
          widgetKey,
          {
            isApproved: approval?.isApproved === true,
          },
        ];
      })
      .filter(Boolean),
  );

  const unresolvedMessage = organizationSlug
    ? "Widget instance key not resolved yet"
    : "Organization slug unavailable for widget resolution.";

  if (!organizationSlug) {
    const items = Object.fromEntries(
      widgetKeys.map((widgetKey) => [
        widgetKey,
        {
          widgetKey,
          widgetInstanceId: null,
          widgetInstanceKey: null,
          capabilityPrefix: null,
          capabilityStatus: "MISSING",
          capabilityGeneration: null,
          capabilityIssuedAt: null,
          capabilityExpiresAt: null,
          capabilityRevokedAt: null,
          canRotate: false,
          organizationSlug: null,
          matchId: null,
          tournamentId: null,
          approved: null,
          message: unresolvedMessage,
        },
      ]),
    );
    if (widgetKeys.includes(COMMENTATOR_DESK_WIDGET_KEY)) {
      publishCommentatorDeskAccessToWidgetServer(
        buildRouteAccessFromCatalogItem({
          accessList,
          catalogItem: items[COMMENTATOR_DESK_WIDGET_KEY],
          organizationId,
          widgetKey: COMMENTATOR_DESK_WIDGET_KEY,
        }),
      );
    }
    if (widgetKeys.includes(HOTKEY_CONTROL_APPROVAL_KEY)) {
      publishWidgetHotkeyControlApproval(items[HOTKEY_CONTROL_APPROVAL_KEY]);
    }
    return {
      organizationId,
      organizationSlug: null,
      enforced,
      items,
    };
  }

  const items = await Promise.all(
    widgetKeys.map(async (widgetKey) => {
      const approval = approvals.get(widgetKey);
      const approved = isWidgetApprovedForCatalog(
        approval,
        enforced,
        widgetKey,
      );
      const fallbackMessage = approved
        ? "Widget instance key not resolved yet"
        : "Widget not approved for this organization.";

      if (accessOnlyWidgetKeys.has(widgetKey)) {
        return [
          widgetKey,
          {
            widgetKey,
            widgetInstanceId: null,
            widgetInstanceKey: null,
            capabilityPrefix: null,
            capabilityStatus: "MISSING",
            capabilityGeneration: null,
            capabilityIssuedAt: null,
            capabilityExpiresAt: null,
            capabilityRevokedAt: null,
            canRotate: false,
            organizationSlug,
            matchId: null,
            tournamentId: null,
            approved,
            message: approved ? null : fallbackMessage,
          },
        ];
      }

      try {
        const resolveWidgetInstance = async () => {
          return apiClient.getWidgetInstance({
            apiBase: session.apiBase,
            token: session.token || session.accessToken,
            refreshToken: session.refreshToken,
            organizationSlug,
            widgetKey,
          });
        };

        let resolved = await resolveWidgetInstance();
        let widgetInstanceId = asOptionalString(resolved?.id);
        let capabilityStatus =
          asOptionalString(resolved?.capabilityStatus) ||
          (widgetInstanceId ? "INACTIVE" : "MISSING");
        let capabilityGeneration =
          Number.isSafeInteger(Number(resolved?.capabilityGeneration)) &&
          Number(resolved?.capabilityGeneration) >= 1
            ? Number(resolved.capabilityGeneration)
            : null;
        let widgetInstanceKey = null;
        let unresolvedReason = null;
        if (
          capabilityStatus === "ACTIVE" &&
          widgetInstanceId &&
          capabilityGeneration
        ) {
          widgetInstanceKey = widgetCapabilityStore.get({
            organizationId,
            widgetKey,
            instanceId: widgetInstanceId,
            generation: capabilityGeneration,
          });
        } else if (capabilityStatus !== "MISSING") {
          widgetCapabilityStore.remove({ organizationId, widgetKey });
        }

        if (approved && capabilityStatus === "MISSING") {
          try {
            const ensured = await apiClient.ensureWidgetInstance({
              apiBase: session.apiBase,
              token: session.token || session.accessToken,
              refreshToken: session.refreshToken,
              organizationId,
              widgetKey,
            });

            widgetInstanceId =
              asOptionalString(ensured?.id) ?? widgetInstanceId;
            capabilityStatus =
              asOptionalString(ensured?.capabilityStatus) || capabilityStatus;
            capabilityGeneration =
              Number.isSafeInteger(Number(ensured?.capabilityGeneration)) &&
              Number(ensured?.capabilityGeneration) >= 1
                ? Number(ensured.capabilityGeneration)
                : capabilityGeneration;
            const issuedCredential = asOptionalString(ensured?.credential);
            resolved = { ...resolved, ...ensured };

            if (issuedCredential && widgetInstanceId && capabilityGeneration) {
              const storage = widgetCapabilityStore.put({
                organizationId,
                widgetKey,
                instanceId: widgetInstanceId,
                generation: capabilityGeneration,
                credential: issuedCredential,
              });
              widgetInstanceKey = issuedCredential;
              if (!storage.persisted) {
                unresolvedReason =
                  "Credential is available for this session only because OS encryption is unavailable.";
              }
            } else if (widgetInstanceId && capabilityGeneration) {
              widgetInstanceKey = widgetCapabilityStore.get({
                organizationId,
                widgetKey,
                instanceId: widgetInstanceId,
                generation: capabilityGeneration,
              });
            }
          } catch (ensureError) {
            unresolvedReason = getWidgetCatalogErrorMessage(
              ensureError,
              "Failed to create widget instance.",
            );
            logWarn("[widget-catalog] ensure failed", {
              widgetKey,
              message: unresolvedReason,
            });
          }
        }

        return [
          widgetKey,
          {
            widgetKey,
            widgetInstanceId,
            widgetInstanceKey,
            capabilityPrefix: asOptionalString(resolved?.capabilityPrefix),
            capabilityStatus,
            capabilityGeneration,
            capabilityIssuedAt: asOptionalString(resolved?.capabilityIssuedAt),
            capabilityExpiresAt: asOptionalString(
              resolved?.capabilityExpiresAt,
            ),
            capabilityRevokedAt: asOptionalString(
              resolved?.capabilityRevokedAt,
            ),
            canRotate: Boolean(
              approved && widgetInstanceId && capabilityGeneration,
            ),
            organizationSlug:
              asOptionalString(resolved?.organization?.slug) ||
              organizationSlug,
            matchId: asOptionalString(resolved?.match?.id),
            tournamentId: asOptionalString(resolved?.tournament?.id),
            approved,
            message: widgetInstanceKey
              ? unresolvedReason
              : unresolvedReason ||
                (capabilityStatus === "ACTIVE"
                  ? "This credential was issued elsewhere. Existing OBS URLs still work; rotate explicitly to connect this launcher."
                  : capabilityStatus === "MISSING"
                    ? fallbackMessage
                    : `Widget capability is ${capabilityStatus.toLowerCase()}. Rotate explicitly to issue a replacement.`),
          },
        ];
      } catch (error) {
        const message = approved
          ? getWidgetCatalogErrorMessage(
              error,
              "Failed to resolve widget instance.",
            )
          : fallbackMessage;
        logWarn("[widget-catalog] resolve failed", {
          widgetKey,
          message,
        });
        return [
          widgetKey,
          {
            widgetKey,
            widgetInstanceId: null,
            widgetInstanceKey: null,
            capabilityPrefix: null,
            capabilityStatus: "MISSING",
            capabilityGeneration: null,
            capabilityIssuedAt: null,
            capabilityExpiresAt: null,
            capabilityRevokedAt: null,
            canRotate: false,
            organizationSlug,
            matchId: null,
            tournamentId: null,
            approved,
            message,
          },
        ];
      }
    }),
  );

  const itemsByWidgetKey = Object.fromEntries(items);
  if (widgetKeys.includes(COMMENTATOR_DESK_WIDGET_KEY)) {
    publishCommentatorDeskAccessToWidgetServer(
      buildRouteAccessFromCatalogItem({
        accessList,
        catalogItem: itemsByWidgetKey[COMMENTATOR_DESK_WIDGET_KEY],
        organizationId,
        widgetKey: COMMENTATOR_DESK_WIDGET_KEY,
      }),
    );
  }
  if (widgetKeys.includes(HOTKEY_CONTROL_APPROVAL_KEY)) {
    publishWidgetHotkeyControlApproval(
      itemsByWidgetKey[HOTKEY_CONTROL_APPROVAL_KEY],
    );
  }

  return {
    organizationId,
    organizationSlug,
    enforced,
    items: itemsByWidgetKey,
  };
}

async function rotateWidgetCapability(payload) {
  assertLauncherAccess();
  const session = getStoredSession();
  const organizationId =
    asOptionalString(payload?.organizationId) ||
    asOptionalString(session?.organization?.id) ||
    asOptionalString(session?.user?.organizationId);
  const widgetKey = asOptionalString(payload?.widgetKey);
  const requestedInstanceId = asOptionalString(payload?.instanceId);
  const requestedGeneration = Number(payload?.expectedGeneration);
  if (
    !organizationId ||
    !widgetKey ||
    !requestedInstanceId ||
    !Number.isSafeInteger(requestedGeneration) ||
    requestedGeneration < 1
  ) {
    throw new Error(
      "Widget capability metadata is incomplete. Refresh and try again.",
    );
  }

  const currentCatalog = await getWidgetCatalogState({
    organizationId,
    widgetKeys: [widgetKey],
  });
  const current = currentCatalog?.items?.[widgetKey];
  if (
    current?.widgetInstanceId !== requestedInstanceId ||
    current?.capabilityGeneration !== requestedGeneration
  ) {
    throw new Error("Widget capability changed. Refresh before rotating.");
  }

  const rotated = await apiClient.rotateWidgetCapability({
    apiBase: session.apiBase,
    token: session.token || session.accessToken,
    refreshToken: session.refreshToken,
    instanceId: requestedInstanceId,
    expectedGeneration: requestedGeneration,
    reason: "Desktop operator explicitly rotated widget capability",
  });
  const credential = asOptionalString(rotated?.credential);
  const instanceId = asOptionalString(rotated?.id);
  const generation = Number(rotated?.capabilityGeneration);
  if (
    !credential ||
    !instanceId ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  ) {
    throw new Error("The API did not return the newly issued credential.");
  }

  let storageWarning = null;
  try {
    const storage = widgetCapabilityStore.put({
      organizationId,
      widgetKey,
      instanceId,
      generation,
      credential,
    });
    if (!storage.persisted) {
      storageWarning =
        "Credential is available for this session only because OS encryption is unavailable.";
    }
  } catch {
    storageWarning =
      "Credential is available for this session only; secure persistence was refused.";
  }

  const catalog = await getWidgetCatalogState({
    organizationId,
    widgetKeys: Array.isArray(payload?.widgetKeys)
      ? payload.widgetKeys
      : [widgetKey],
    accessOnlyWidgetKeys: Array.isArray(payload?.accessOnlyWidgetKeys)
      ? payload.accessOnlyWidgetKeys
      : [],
  });
  if (storageWarning && catalog?.items?.[widgetKey]) {
    catalog.items[widgetKey].message = storageWarning;
  }
  return catalog;
}

function getWidgetServerStatusView() {
  const fallbackPort = Number(process.env.ARENZYRA_WIDGET_PORT || 5510);
  const resolvedFallbackPort = Number.isInteger(fallbackPort)
    ? fallbackPort
    : 5510;
  const status =
    typeof widgetServer?.getStatus === "function"
      ? widgetServer.getStatus()
      : {
          running: false,
          host: "127.0.0.1",
          port: resolvedFallbackPort,
          path: null,
          clientCount: 0,
          lastBroadcastAt: null,
          startedAt: null,
          localBaseUrl: `http://localhost:${resolvedFallbackPort}`,
          networkBaseUrl: null,
        };
  const port = Number.isInteger(status?.port) ? status.port : null;
  const localBaseUrl =
    status?.localBaseUrl && String(status.localBaseUrl).trim()
      ? String(status.localBaseUrl)
      : port
        ? `http://localhost:${port}`
        : null;
  const networkBaseUrl =
    status?.networkBaseUrl && String(status.networkBaseUrl).trim()
      ? String(status.networkBaseUrl)
      : null;
  const authorizeBaseUrl = (baseUrl) => {
    if (!baseUrl) {
      return null;
    }
    const url = new URL(baseUrl);
    url.searchParams.set("access_token", widgetAccessToken);
    return url.toString();
  };
  const authorizedLocalBaseUrl =
    status?.authorizedLocalBaseUrl || authorizeBaseUrl(localBaseUrl);
  const authorizedNetworkBaseUrl =
    status?.authorizedNetworkBaseUrl || authorizeBaseUrl(networkBaseUrl);

  return {
    running: status?.running === true,
    host: status?.host ? String(status.host) : null,
    port,
    path: status?.path ? String(status.path) : null,
    clientCount: Number(status?.clientCount ?? 0) || 0,
    lastBroadcastAt:
      typeof status?.lastBroadcastAt === "number"
        ? status.lastBroadcastAt
        : null,
    startedAt: typeof status?.startedAt === "number" ? status.startedAt : null,
    baseUrl: localBaseUrl,
    localBaseUrl,
    networkBaseUrl,
    authorizedBaseUrl: authorizedLocalBaseUrl,
    authorizedLocalBaseUrl,
    authorizedNetworkBaseUrl,
    accessControlled: true,
  };
}

async function ensureWidgetServerReady(options = {}) {
  const isFirstStart = !widgetServer;
  if (!widgetServer) {
    try {
      widgetServer = startWidgetsServer({
        port: Number(process.env.ARENZYRA_WIDGET_PORT || 5510),
        host: resolveWidgetServerHost({
          isPackaged: app.isPackaged,
          env: process.env,
          allowNetwork: isWidgetLanEnabled(),
        }),
        capabilityToken: widgetAccessToken,
        enableDebugRoutes: isDev,
        enableOperatorRoutes: shouldEnableWidgetMutationRoutes({
          isPackaged: app.isPackaged,
          env: process.env,
        }),
        teamAssetsRoot: TEAM_ASSETS_DIR,
        playerAssetsRoot: PLAYER_ASSETS_DIR,
        resolveApiBase: () => normalizeBaseUrl(),
        resolveWidgetContext: ({ instanceKey }) => {
          const session = getStoredSession();
          return apiClient.resolveWidgetContext({
            apiBase: session.apiBase,
            token: session.token || session.accessToken,
            refreshToken: session.refreshToken,
            instanceKey,
          });
        },
        getObserverBaseUrl: () => getShadowTelemetryBaseUrl(),
        getObserverAccessToken: () =>
          String(
            telemetrySourceProcessConfig?.localControlToken ||
              connectorAccessToken,
          ).trim(),
        shouldPollDirectObserver: () => shouldPollDirectObserverForWidgets(),
        shouldPollDirectObserverCircle: () =>
          shouldPollDirectObserverCircleForWidgets(),
        getForcedMapKey: () => getDesiredObserverFallbackMapKey(),
        getCurrentMatchContext: () => getCurrentWidgetMatchContext(),
        requestPlayerPhotoRefresh: (matchId) =>
          requestPlayerPhotoCacheRefresh(matchId),
        organizationBranding: cachedOrganizationWidgetBranding,
        logger: logger.child("widgets"),
      });
    } catch (error) {
      widgetServer = null;
      throw error;
    }
  }

  if (typeof widgetServer?.whenReady === "function") {
    try {
      await widgetServer.whenReady();
    } catch (error) {
      widgetServer = null;
      throw error;
    }
  }
  if (pendingWidgetTeamBranding) {
    publishTeamBrandingToWidgetServer(pendingWidgetTeamBranding);
  }
  if (isFirstStart || options.refreshAccess === true) {
    let accessSession = null;
    try {
      accessSession = getStoredSession();
    } catch (_) {
      accessSession = null;
    }
    if (accessSession) {
      await refreshOrganizationWidgetBranding(accessSession, {
        throwOnError: false,
      });
      await refreshAiCasterAccess(accessSession, {
        throwOnError: false,
      });
      await refreshCommentatorDeskAccess(accessSession, {
        throwOnError: false,
      });
      await refreshWidgetHotkeyControlApproval(accessSession, {
        throwOnError: false,
      });
    }
    widgetHotkeyControl.sync("widget-server-ready");
  }

  return getWidgetServerStatusView();
}

async function restartWidgetServerForRuntimePolicyChange(reason = "config") {
  const previousServer = widgetServer;
  if (previousServer) {
    log("[widget-server] restarting for runtime policy change", {
      reason,
      lanEnabled: isWidgetLanEnabled(),
    });
    try {
      await previousServer.stop();
    } finally {
      if (widgetServer === previousServer) {
        widgetServer = null;
      }
    }
  }

  return ensureWidgetServerReady({ refreshAccess: true });
}

async function startWidgetServerForObsRecovery(reason = "startup") {
  try {
    const widgetStatus = await ensureWidgetServerReady({
      refreshAccess: false,
    });
    log("[widget-server] early startup ready", {
      reason,
      running: widgetStatus.running,
      port: widgetStatus.port,
      baseUrl: widgetStatus.baseUrl,
    });
    return widgetStatus;
  } catch (error) {
    logWarn("[widget-server] early startup failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return getWidgetServerStatusView();
  }
}

function buildAuthorizedWidgetUrl(widgetStatus, pathname) {
  const baseUrl =
    widgetStatus?.authorizedLocalBaseUrl ||
    widgetStatus?.authorizedBaseUrl ||
    widgetStatus?.localBaseUrl ||
    widgetStatus?.baseUrl ||
    "http://localhost:5510";
  const source = new URL(baseUrl);
  const url = new URL(pathname, source.origin);
  source.searchParams.forEach((value, key) => url.searchParams.set(key, value));
  return url;
}

function buildPinnedCommentatorDeskUrl(widgetStatus, payload = {}) {
  const url = buildAuthorizedWidgetUrl(widgetStatus, "/obs/commentator-desk");
  url.searchParams.set("transparent", "1");
  url.searchParams.set("pinned", "1");

  const mapKey = String(payload?.mapKey || "").trim();
  if (mapKey) {
    url.searchParams.set("map", mapKey);
  }

  return url.toString();
}

function isAllowedPinnedCommentatorDeskUrl(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    const status = getWidgetServerStatusView();
    return (
      parsed.protocol === "http:" &&
      isLoopbackHostname(parsed.hostname) &&
      Number(parsed.port || "80") === Number(status.port || 5510) &&
      parsed.pathname === "/obs/commentator-desk"
    );
  } catch {
    return false;
  }
}

function getPinnedCommentatorDeskWindowStatus() {
  const win =
    commentatorDeskWindow && !commentatorDeskWindow.isDestroyed()
      ? commentatorDeskWindow
      : null;
  if (!win) {
    return {
      open: false,
      visible: false,
      clickThrough: commentatorDeskWindowClickThrough,
      alwaysOnTop: false,
      transparent: true,
      url: null,
    };
  }

  return {
    open: true,
    visible: win.isVisible(),
    clickThrough: commentatorDeskWindowClickThrough,
    alwaysOnTop: win.isAlwaysOnTop(),
    transparent: true,
    url: commentatorDeskWindowUrl,
  };
}

function applyPinnedCommentatorDeskClickThrough(clickThrough) {
  assertLauncherAccess();
  commentatorDeskWindowClickThrough = clickThrough === true;
  const win =
    commentatorDeskWindow && !commentatorDeskWindow.isDestroyed()
      ? commentatorDeskWindow
      : null;
  if (!win) {
    return getPinnedCommentatorDeskWindowStatus();
  }

  win.setIgnoreMouseEvents(commentatorDeskWindowClickThrough, {
    forward: true,
  });
  if (typeof win.setFocusable === "function") {
    win.setFocusable(!commentatorDeskWindowClickThrough);
  }
  if (commentatorDeskWindowClickThrough) {
    win.showInactive();
  } else {
    win.focus();
  }
  return getPinnedCommentatorDeskWindowStatus();
}

async function openPinnedCommentatorDeskWindow(payload = {}) {
  assertLauncherAccess();
  const widgetStatus = await ensureWidgetServerReady();
  if (widgetStatus.running !== true || !widgetStatus.port) {
    throw new Error("Local widget server is unavailable.");
  }

  const nextUrl = buildPinnedCommentatorDeskUrl(widgetStatus, payload);
  let win =
    commentatorDeskWindow && !commentatorDeskWindow.isDestroyed()
      ? commentatorDeskWindow
      : null;

  if (!win) {
    win = new BrowserWindow({
      width: 520,
      height: 650,
      minWidth: 380,
      minHeight: 420,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: true,
      movable: true,
      show: false,
      skipTaskbar: false,
      alwaysOnTop: true,
      title: "Arenzyra Commentator Desk",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: isDev,
      },
    });
    commentatorDeskWindow = win;

    win.setAlwaysOnTop(true, "screen-saver");
    if (typeof win.setVisibleOnAllWorkspaces === "function") {
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
    }

    win.webContents.session.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        logWarn("[commentator-desk-window] blocked permission request", {
          permission,
        });
        callback(false);
      },
    );

    win.webContents.setWindowOpenHandler((details) => {
      openValidatedExternalUrl(details?.url, "commentator-desk-window-open");
      return { action: "deny" };
    });

    win.webContents.on("will-navigate", (event, url) => {
      if (isAllowedPinnedCommentatorDeskUrl(url)) {
        return;
      }
      event.preventDefault();
      logWarn("[commentator-desk-window] blocked navigation", { url });
    });

    win.webContents.on("before-input-event", (_event, input) => {
      if (input?.key === "Escape" && input.type === "keyDown") {
        win.close();
      }
    });

    win.on("closed", () => {
      if (commentatorDeskWindow === win) {
        commentatorDeskWindow = null;
        commentatorDeskWindowUrl = null;
      }
    });
  }

  commentatorDeskWindowUrl = nextUrl;
  await win.loadURL(nextUrl);
  win.setAlwaysOnTop(true, "screen-saver");
  applyPinnedCommentatorDeskClickThrough(payload?.clickThrough === true);
  if (commentatorDeskWindowClickThrough) {
    win.showInactive();
  } else {
    win.show();
    win.focus();
  }
  if (typeof win.moveTop === "function") {
    win.moveTop();
  }

  return getPinnedCommentatorDeskWindowStatus();
}

function closePinnedCommentatorDeskWindow() {
  assertLauncherAccess();
  const win =
    commentatorDeskWindow && !commentatorDeskWindow.isDestroyed()
      ? commentatorDeskWindow
      : null;
  if (win) {
    win.close();
  }
  commentatorDeskWindow = null;
  commentatorDeskWindowUrl = null;
  return getPinnedCommentatorDeskWindowStatus();
}

function buildPinnedMapControlUrl(widgetStatus, payload = {}) {
  const url = buildAuthorizedWidgetUrl(widgetStatus, "/obs/map");
  url.searchParams.set("control", "1");
  url.searchParams.set("pinned", "1");
  url.searchParams.set("maplabels", "1");

  const mapKey = String(payload?.mapKey || "").trim();
  if (mapKey) {
    url.searchParams.set("map", mapKey);
  }

  return url.toString();
}

function isAllowedPinnedMapControlUrl(urlValue) {
  try {
    const parsed = new URL(String(urlValue || ""));
    const status = getWidgetServerStatusView();
    return (
      parsed.protocol === "http:" &&
      isLoopbackHostname(parsed.hostname) &&
      Number(parsed.port || "80") === Number(status.port || 5510) &&
      parsed.pathname === "/obs/map" &&
      parsed.searchParams.get("control") === "1"
    );
  } catch {
    return false;
  }
}

function getPinnedMapControlWindowStatus() {
  const win =
    mapControlWindow && !mapControlWindow.isDestroyed()
      ? mapControlWindow
      : null;
  if (!win) {
    return {
      open: false,
      visible: false,
      alwaysOnTop:
        configManager.getSettings()?.pinnedMapControlAlwaysOnTop === true,
      url: null,
    };
  }

  return {
    open: true,
    visible: win.isVisible(),
    alwaysOnTop: win.isAlwaysOnTop(),
    url: mapControlWindowUrl,
  };
}

function setPinnedMapControlWindowAlwaysOnTop(win, alwaysOnTop) {
  if (!win || win.isDestroyed()) {
    return;
  }

  const enabled = alwaysOnTop === true;
  if (enabled) {
    win.setAlwaysOnTop(true, "screen-saver");
  } else {
    win.setAlwaysOnTop(false);
  }
  if (typeof win.setVisibleOnAllWorkspaces === "function") {
    win.setVisibleOnAllWorkspaces(
      enabled,
      enabled ? { visibleOnFullScreen: true } : undefined,
    );
  }
  if (enabled && typeof win.moveTop === "function") {
    win.moveTop();
  }
}

function applyPinnedMapControlAlwaysOnTop(alwaysOnTop) {
  assertLauncherAccess();
  const enabled = alwaysOnTop === true;
  const settings = configManager.getSettings() || {};
  if (settings.pinnedMapControlAlwaysOnTop !== enabled) {
    configManager.setSettings({
      ...settings,
      pinnedMapControlAlwaysOnTop: enabled,
    });
    broadcastConfigUpdate("pinned-map-always-on-top");
  }

  const win =
    mapControlWindow && !mapControlWindow.isDestroyed()
      ? mapControlWindow
      : null;
  setPinnedMapControlWindowAlwaysOnTop(win, enabled);
  log("[map-control-window] always-on-top updated", { enabled });
  return getPinnedMapControlWindowStatus();
}

function assertMapControlSender(event) {
  const win =
    mapControlWindow && !mapControlWindow.isDestroyed()
      ? mapControlWindow
      : null;
  const senderUrl = String(event?.sender?.getURL?.() || "");
  if (
    !win ||
    event?.sender !== win.webContents ||
    !isAllowedPinnedMapControlUrl(senderUrl)
  ) {
    const error = new Error("Map control request was rejected.");
    error.code = "ARENZYRA_MAP_CONTROL_SENDER_REJECTED";
    throw error;
  }
}

function normalizePcobControlError(error) {
  const message =
    error instanceof Error && error.message
      ? error.message
      : String(error || "PCOB map control failed.");
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function readPcobObservingPlayer(options = {}) {
  const baseUrl = getShadowTelemetryBaseUrl();
  const endpoint = new URL("/getobservingplayer", `${baseUrl}/`).toString();
  const response = await axios.get(endpoint, {
    timeout: 700,
    signal: options.signal,
    headers: {
      "X-Arenzyra-Connector-Token": String(
        telemetrySourceProcessConfig?.localControlToken || connectorAccessToken,
      ).trim(),
    },
    validateStatus: (status) => status >= 200 && status < 300,
  });
  return response?.data && typeof response.data === "object"
    ? response.data
    : {};
}

function getPcobMapControlLifecycleStatus() {
  return resolvePcobMapControlLifecycle({
    matchFlow: matchFlowState,
    telemetry: telemetryBridge.getStatus(),
    observerFeed: getObserverFeedStatusView(),
  });
}

async function getPcobMapControlStatus() {
  const lifecycle = getPcobMapControlLifecycleStatus();
  const processEntries =
    process.platform === "win32" ? getRunningShadowTrackerProcesses() : [];
  const processEntry = processEntries.length === 1 ? processEntries[0] : null;
  let telemetryReady = false;
  let telemetryError = null;
  let inputReady = false;
  let inputError = null;

  if (processEntry && lifecycle.eligible) {
    const [telemetryResult, inputResult] = await Promise.allSettled([
      readPcobObservingPlayer(),
      preparePcobHotkeyInput(),
    ]);
    if (telemetryResult.status === "fulfilled") {
      telemetryReady = true;
    } else {
      telemetryError = normalizePcobControlError(telemetryResult.reason);
    }
    if (inputResult.status === "fulfilled") {
      inputReady = true;
    } else {
      inputError = normalizePcobControlError(inputResult.reason);
    }
  }

  const available =
    process.platform === "win32" &&
    Boolean(processEntry) &&
    telemetryReady &&
    inputReady;
  const enabled = lifecycle.eligible && available;
  const lastSelection = pcobMapControlLastSelection
    ? { ...pcobMapControlLastSelection }
    : null;
  const sourceStatus = telemetryBridge.getStatus();
  const observerFeedStatus = getObserverFeedStatusView();
  const sourceError =
    (typeof sourceStatus?.lastError === "string" &&
      sourceStatus.lastError.trim()) ||
    (typeof observerFeedStatus?.lastError === "string" &&
      observerFeedStatus.lastError.trim()) ||
    null;

  let message = "Automatic player switching is enabled for the live match.";
  if (lifecycle.matchFinished) {
    message =
      "Automatic player switching is disabled because the match is finished.";
  } else if (!lifecycle.matchLive) {
    message =
      "Automatic player switching will enable when the web-app match is LIVE.";
  } else if (!lifecycle.telemetrySourceReady) {
    message =
      sourceError ||
      "Start an accepted telemetry source for this live match to enable switching.";
  } else if (process.platform !== "win32") {
    message = "PCOB map control is only available on Windows.";
  } else if (processEntries.length > 1) {
    message =
      "Close the extra PCOB instance to enable automatic player switching.";
  } else if (!processEntry) {
    message = "Start PCOB to enable automatic player switching.";
  } else if (!telemetryReady) {
    message =
      "Start the PCOB telemetry connector to enable automatic player switching.";
  } else if (!inputReady) {
    message = "PCOB keyboard control could not be prepared.";
  } else if (pcobMapControlBusy) {
    message = "Sending the PCOB player switch.";
  } else if (lastSelection?.status === "failed") {
    message = lastSelection.error || "The previous PCOB player switch failed.";
  } else if (lastSelection?.status === "unconfirmed") {
    message =
      lastSelection.error ||
      "The previous PCOB player switch was sent but not confirmed.";
  } else if (lastSelection?.status === "confirmed") {
    const label =
      String(lastSelection.playerName || lastSelection.playerId || "").trim() ||
      "player";
    message = `Automatic switching is enabled. PCOB confirmed ${label}.`;
  }

  return {
    enabled,
    available,
    busy: pcobMapControlBusy,
    message,
    ...lifecycle,
    pcobRunning: Boolean(processEntry),
    telemetryReady,
    telemetryError,
    inputReady,
    inputError,
    sourceError,
    lastSelection,
  };
}

function cancelPcobObserverConfirmation() {
  const controller = pcobMapControlConfirmationController;
  pcobMapControlConfirmationController = null;
  controller?.abort();
}

async function confirmPcobObserverSelection(selection, requestId) {
  cancelPcobObserverConfirmation();
  const controller = new AbortController();
  pcobMapControlConfirmationController = controller;
  const deadline = Date.now() + PCOB_OBSERVER_CONFIRM_TIMEOUT_MS;
  let lastTelemetryError = null;

  try {
    while (Date.now() <= deadline) {
      if (
        controller.signal.aborted ||
        pcobMapControlLastSelection?.requestId !== requestId
      ) {
        return;
      }

      try {
        const observingPlayer = await readPcobObservingPlayer({
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          pcobMapControlLastSelection?.requestId !== requestId
        ) {
          return;
        }
        if (observerMatchesSelection(observingPlayer, selection)) {
          pcobMapControlLastSelection = {
            ...pcobMapControlLastSelection,
            status: "confirmed",
            confirmedAt: Date.now(),
            error: null,
          };
          log("[map-control] PCOB observer switch confirmed", {
            playerId: selection.playerId,
            playerName: selection.playerName,
            requestId,
          });
          return;
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        lastTelemetryError = normalizePcobControlError(error);
      }
      await sleep(PCOB_OBSERVER_CONFIRM_POLL_MS);
    }

    if (pcobMapControlLastSelection?.requestId === requestId) {
      pcobMapControlLastSelection = {
        ...pcobMapControlLastSelection,
        status: "unconfirmed",
        confirmedAt: null,
        error: lastTelemetryError,
      };
      logWarn("[map-control] PCOB observer switch was not confirmed", {
        playerId: selection.playerId,
        playerName: selection.playerName,
        requestId,
        error: lastTelemetryError,
      });
    }
  } finally {
    if (pcobMapControlConfirmationController === controller) {
      pcobMapControlConfirmationController = null;
    }
  }
}

async function selectPcobObserverFromMap(payload) {
  const selection = normalizePcobMapSelection(payload);
  const activeMapKey =
    typeof widgetServer?.engine?.getStatus === "function"
      ? (widgetServer.engine.getStatus()?.currentMapKey ?? null)
      : null;
  assertPcobMapSelectionMatchesActiveMap({
    selectionMapKey: selection.mapKey,
    activeMapKey,
  });
  const automaticStatus = await getPcobMapControlStatus();
  if (!automaticStatus.enabled) {
    const error = new Error(automaticStatus.message);
    error.code = "ARENZYRA_MAP_CONTROL_AUTOMATICALLY_DISABLED";
    throw error;
  }
  if (pcobMapControlBusy) {
    throw new Error("Another PCOB player switch is still in progress.");
  }

  const processEntries = getRunningShadowTrackerProcesses({
    preferCache: true,
  });
  if (processEntries.length > 1) {
    throw new Error("Multiple PCOB instances are running. No input was sent.");
  }
  const targetProcess = processEntries[0] || null;
  if (!targetProcess?.pid) {
    throw new Error("PCOB is not running. No input was sent.");
  }

  cancelPcobObserverConfirmation();
  const requestId = `map-${Date.now()}-${selection.teamSlot}-${selection.playerNumber}`;
  pcobMapControlBusy = true;
  pcobMapControlLastSelection = {
    status: "pending",
    requestId,
    playerId: selection.playerId,
    playerName: selection.playerName,
    confirmedAt: null,
    sentAt: null,
    error: null,
  };
  log("[map-control] switching PCOB observer", {
    mapKey: selection.mapKey,
    playerId: selection.playerId,
    playerName: selection.playerName,
    teamId: selection.teamId,
    teamSlot: selection.teamSlot,
    playerNumber: selection.playerNumber,
  });

  try {
    if (!getPcobMapControlLifecycleStatus().eligible) {
      throw new Error(
        "Automatic player switching was disabled before input could be sent.",
      );
    }
    const inputResult = await runPcobHotkeyInput({
      pid: targetProcess.pid,
      teamSlot: selection.teamSlot,
      playerNumber: selection.playerNumber,
    });
    const sentAt = Date.now();
    pcobMapControlLastSelection = {
      status: "sent",
      requestId,
      playerId: selection.playerId,
      playerName: selection.playerName,
      confirmedAt: null,
      sentAt,
      digitMode: inputResult?.digitMode || null,
      inputElapsedMs: Number(inputResult?.inputElapsedMs) || null,
      error: null,
    };
    log("[map-control] PCOB observer input sent", {
      playerId: selection.playerId,
      playerName: selection.playerName,
      requestId,
      digitMode: inputResult?.digitMode || null,
      inputElapsedMs: Number(inputResult?.inputElapsedMs) || null,
    });
    void confirmPcobObserverSelection(selection, requestId);
    return {
      ok: true,
      inputSent: true,
      confirmed: false,
      requestId,
      digitMode: inputResult?.digitMode || null,
      inputElapsedMs: Number(inputResult?.inputElapsedMs) || null,
      selection,
    };
  } catch (error) {
    const message = normalizePcobControlError(error);
    pcobMapControlLastSelection = {
      status: "failed",
      requestId,
      playerId: selection.playerId,
      playerName: selection.playerName,
      confirmedAt: null,
      sentAt: null,
      error: message,
    };
    logWarn("[map-control] PCOB observer switch failed", {
      playerId: selection.playerId,
      playerName: selection.playerName,
      error: message,
    });
    throw new Error(message);
  } finally {
    pcobMapControlBusy = false;
  }
}

async function openPinnedMapControlWindow(payload = {}) {
  assertLauncherAccess();
  const widgetStatus = await ensureWidgetServerReady();
  if (widgetStatus.running !== true || !widgetStatus.port) {
    throw new Error("Local widget server is unavailable.");
  }

  const nextUrl = buildPinnedMapControlUrl(widgetStatus, payload);
  const alwaysOnTop =
    configManager.getSettings()?.pinnedMapControlAlwaysOnTop === true;
  let win =
    mapControlWindow && !mapControlWindow.isDestroyed()
      ? mapControlWindow
      : null;

  if (!win) {
    win = new BrowserWindow({
      width: 980,
      height: 780,
      minWidth: 680,
      minHeight: 560,
      frame: true,
      transparent: false,
      backgroundColor: "#05090e",
      resizable: true,
      movable: true,
      show: false,
      skipTaskbar: false,
      alwaysOnTop,
      autoHideMenuBar: true,
      title: "Arenzyra PCOB Map Control",
      webPreferences: {
        preload: mapControlPreloadPath,
        partition: "arenzyra-map-control",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: isDev,
      },
    });
    mapControlWindow = win;

    setPinnedMapControlWindowAlwaysOnTop(win, alwaysOnTop);

    win.webContents.session.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        logWarn("[map-control-window] blocked permission request", {
          permission,
        });
        callback(false);
      },
    );

    win.webContents.setWindowOpenHandler((details) => {
      logWarn("[map-control-window] blocked new window", {
        url: details?.url || null,
      });
      return { action: "deny" };
    });

    win.webContents.on("will-navigate", (event, url) => {
      if (isAllowedPinnedMapControlUrl(url)) {
        return;
      }
      event.preventDefault();
      logWarn("[map-control-window] blocked navigation", { url });
    });

    win.webContents.on("will-redirect", (event, url) => {
      if (isAllowedPinnedMapControlUrl(url)) {
        return;
      }
      event.preventDefault();
      logWarn("[map-control-window] blocked redirect", { url });
    });

    win.webContents.on("before-input-event", (_event, input) => {
      if (input?.key === "Escape" && input.type === "keyDown") {
        win.close();
      }
    });

    win.on("closed", () => {
      if (mapControlWindow === win) {
        cancelPcobObserverConfirmation();
        mapControlWindow = null;
        mapControlWindowUrl = null;
        pcobMapControlBusy = false;
      }
    });
  }

  mapControlWindowUrl = nextUrl;
  await win.loadURL(nextUrl);
  setPinnedMapControlWindowAlwaysOnTop(win, alwaysOnTop);
  win.show();
  win.focus();
  if (typeof win.moveTop === "function") {
    win.moveTop();
  }

  return getPinnedMapControlWindowStatus();
}

function closePinnedMapControlWindow() {
  assertLauncherAccess();
  cancelPcobObserverConfirmation();
  const win =
    mapControlWindow && !mapControlWindow.isDestroyed()
      ? mapControlWindow
      : null;
  if (win) {
    win.close();
  }
  mapControlWindow = null;
  mapControlWindowUrl = null;
  pcobMapControlBusy = false;
  return getPinnedMapControlWindowStatus();
}

function buildFallbackAssetStatusView() {
  const missingKeys = [...REQUIRED_PUBG_MAP_KEYS];
  return {
    checkedAt: null,
    assetsRoot: null,
    routePrefix: "/assets/maps",
    fallbackAssetUrl: "/assets/maps/map-not-available.svg",
    fallbackAssetPath: null,
    total: 0,
    available: 0,
    missing: 0,
    availableKeys: [],
    missingKeys: [],
    requiredTotal: missingKeys.length,
    requiredAvailable: 0,
    requiredMissing: missingKeys.length,
    requiredAvailableKeys: [],
    requiredMissingKeys: missingKeys,
    maps: {},
  };
}

function getAssetStatusView() {
  const status =
    typeof widgetServer?.getAssetStatus === "function"
      ? widgetServer.getAssetStatus()
      : null;
  if (!status || typeof status !== "object") {
    return buildFallbackAssetStatusView();
  }

  return {
    checkedAt: typeof status.checkedAt === "number" ? status.checkedAt : null,
    assetsRoot: status.assetsRoot ? String(status.assetsRoot) : null,
    routePrefix: status.routePrefix
      ? String(status.routePrefix)
      : "/assets/maps",
    fallbackAssetUrl: status.fallbackAssetUrl
      ? String(status.fallbackAssetUrl)
      : "/assets/maps/map-not-available.svg",
    fallbackAssetPath: status.fallbackAssetPath
      ? String(status.fallbackAssetPath)
      : null,
    total: Number(status.total ?? 0) || 0,
    available: Number(status.available ?? 0) || 0,
    missing: Number(status.missing ?? 0) || 0,
    availableKeys: Array.isArray(status.availableKeys)
      ? [...status.availableKeys]
      : [],
    missingKeys: Array.isArray(status.missingKeys)
      ? [...status.missingKeys]
      : [],
    requiredTotal: Number(status.requiredTotal ?? 0) || 0,
    requiredAvailable: Number(status.requiredAvailable ?? 0) || 0,
    requiredMissing: Number(status.requiredMissing ?? 0) || 0,
    requiredAvailableKeys: Array.isArray(status.requiredAvailableKeys)
      ? [...status.requiredAvailableKeys]
      : [],
    requiredMissingKeys: Array.isArray(status.requiredMissingKeys)
      ? [...status.requiredMissingKeys]
      : [],
    maps:
      status.maps && typeof status.maps === "object"
        ? Object.fromEntries(
            Object.entries(status.maps).map(([key, entry]) => [
              key,
              {
                key: entry?.key ? String(entry.key) : key,
                label: entry?.label ? String(entry.label) : key,
                required: entry?.required === true,
                preferredImagePath: entry?.preferredImagePath
                  ? String(entry.preferredImagePath)
                  : "",
                resolvedImagePath: entry?.resolvedImagePath
                  ? String(entry.resolvedImagePath)
                  : null,
                imageUrl: entry?.imageUrl ? String(entry.imageUrl) : "",
                fallbackImageUrl: entry?.fallbackImageUrl
                  ? String(entry.fallbackImageUrl)
                  : "/assets/maps/map-not-available.svg",
                assetAbsolutePath: entry?.assetAbsolutePath
                  ? String(entry.assetAbsolutePath)
                  : null,
                fallbackAssetPath: entry?.fallbackAssetPath
                  ? String(entry.fallbackAssetPath)
                  : null,
                assetAvailable: entry?.assetAvailable === true,
              },
            ]),
          )
        : {},
  };
}

function createUnauthorizedError(message) {
  const error = new Error(message || UNAUTHORIZED_ERROR_CODE);
  error.code = UNAUTHORIZED_ERROR_CODE;
  return error;
}

function isUnauthorizedError(error) {
  return (
    error?.code === UNAUTHORIZED_ERROR_CODE ||
    (error instanceof Error && error.message.includes(UNAUTHORIZED_ERROR_CODE))
  );
}

function isRecoverableBootstrapAuthError(error) {
  if (isUnauthorizedError(error)) {
    return true;
  }

  const status = Number(error?.status);
  if (status === 400 || status === 401 || status === 403) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("request failed for /auth/me") ||
    message.includes("/auth/me") ||
    message.includes("invalid or expired token") ||
    message.includes("invalid session") ||
    message.includes("missing token") ||
    message.includes("token scope mismatch") ||
    message.includes("account not active")
  );
}

function getStoredSessionExpiryInfo() {
  return sessionManager.getSessionExpiry(SESSION_INACTIVITY_WINDOW_MS);
}

function expireStoredSessionIfNeeded(source = "runtime") {
  const expiryInfo = getStoredSessionExpiryInfo();
  if (!expiryInfo?.session || expiryInfo.expired !== true) {
    return {
      expired: false,
      expiryInfo,
    };
  }

  logWarn("[auth] stored session expired due to inactivity", {
    source,
    inactivityDays: SESSION_INACTIVITY_WINDOW_DAYS,
    referenceAt: expiryInfo.referenceAt,
    expiresAt: expiryInfo.expiresAt,
  });
  clearLauncherRuntimeState({
    clearSession: true,
    reason: "expired",
  });
  return {
    expired: true,
    expiryInfo,
  };
}

function requireMatchId(matchId) {
  const trimmedMatchId = String(matchId || "").trim();
  if (!trimmedMatchId) {
    throw new Error("Select a match before running this action.");
  }
  return trimmedMatchId;
}

function getStoredSession() {
  const session = sessionManager.readSession();
  if (!session?.token && !session?.refreshToken) {
    throw createUnauthorizedError();
  }

  if (expireStoredSessionIfNeeded("runtime").expired) {
    throw createUnauthorizedError(
      `Session expired after ${SESSION_INACTIVITY_WINDOW_DAYS} days of inactivity.`,
    );
  }

  return {
    ...session,
    apiBase: normalizeBaseUrl(session?.apiBase),
  };
}

function hasStoredLauncherSession(session) {
  return Boolean(
    String(session?.token || session?.accessToken || "").trim() ||
    String(session?.refreshToken || "").trim(),
  );
}

function getStoredBootstrapSession() {
  const session = sessionManager.readSession();
  if (!hasStoredLauncherSession(session)) {
    return null;
  }

  if (expireStoredSessionIfNeeded("bootstrap").expired) {
    return null;
  }

  return {
    ...session,
    apiBase: normalizeBaseUrl(session?.apiBase),
  };
}

function clearLauncherRuntimeState(options = {}) {
  stopLauncherHeartbeat();
  cancelPcobObserverConfirmation();
  launcherAccessState = null;
  startupLicenseStatus = null;
  matchFlowState = createDefaultMatchFlowState();
  productionModeState = createDefaultProductionModeState();
  resetLiveMatchMapSynchronization();
  telemetryBridge.stop(options?.reason || "stopped");
  void stopObserverFeedSilently(options?.reason || "stopped");
  visualModeService.stop(options?.reason || "stopped");
  if (options?.clearSession === true) {
    sessionManager.clearSession();
  }
}

async function validateStoredLauncherSession(apiBase) {
  const expiration = expireStoredSessionIfNeeded("bootstrap");
  const storedSession = expiration.expired
    ? null
    : sessionManager.readSession();
  const resolvedApiBase = normalizeBaseUrl(apiBase);
  const accessToken = String(
    storedSession?.token || storedSession?.accessToken || "",
  ).trim();
  const refreshToken = String(storedSession?.refreshToken || "").trim();

  if (!accessToken && !refreshToken) {
    clearLauncherRuntimeState({
      clearSession: false,
      reason: "stopped",
    });
    return {
      authenticated: false,
      session: null,
      source: "none",
      reason: expiration.expired ? "INACTIVITY_EXPIRED" : "NO_STORED_SESSION",
    };
  }

  if (accessToken) {
    try {
      const response = await axios.get(`${resolvedApiBase}/auth/me`, {
        timeout: 10000,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const nextSession = persistStoredSession({
        ...storedSession,
        apiBase: resolvedApiBase,
        token: accessToken,
        accessToken,
        refreshToken,
        user: response?.data?.user ?? storedSession?.user ?? null,
        organization:
          response?.data?.organization ?? storedSession?.organization ?? null,
      });

      return {
        authenticated: true,
        session: nextSession,
        source: "auth/me",
        reason: null,
      };
    } catch (error) {
      const status = Number(error?.response?.status);
      if (status !== 401 && status !== 403) {
        throw error;
      }
    }
  }

  if (refreshToken) {
    try {
      const restored = await apiClient.restoreSession({
        apiBase: resolvedApiBase,
        refreshToken,
      });
      const nextSession = persistStoredSession({
        ...storedSession,
        apiBase: restored.apiBase || resolvedApiBase,
        token: restored.accessToken,
        accessToken: restored.accessToken,
        refreshToken: restored.refreshToken || refreshToken,
        user: restored.user ?? storedSession?.user ?? null,
        organization:
          restored.organization ?? storedSession?.organization ?? null,
      });

      return {
        authenticated: true,
        session: nextSession,
        source: "refresh",
        reason: null,
      };
    } catch (error) {
      if (isRecoverableBootstrapAuthError(error)) {
        clearLauncherRuntimeState({
          clearSession: true,
          reason: "stopped",
        });
        return {
          authenticated: false,
          session: null,
          source: "refresh",
          reason:
            error instanceof Error && error.message
              ? error.message
              : "SESSION_INVALID",
        };
      }

      throw error;
    }
  }

  clearLauncherRuntimeState({
    clearSession: true,
    reason: "stopped",
  });
  return {
    authenticated: false,
    session: null,
    source: "auth/me",
    reason: "SESSION_INVALID",
  };
}

function toSessionView(session) {
  return session
    ? {
        user: session.user ?? null,
        organization: session.organization ?? null,
        credentialStorage: sessionManager.getCredentialStorageState(),
      }
    : null;
}

function toAccessView(access) {
  return access
    ? {
        allowed: access.allowed === true,
        reason: access.reason ? String(access.reason) : null,
        license: access.license ?? null,
        machineId: access.machineId ? String(access.machineId) : "",
        activeSessions: Number.isFinite(access.activeSessions)
          ? access.activeSessions
          : null,
        maxObservers: Number.isFinite(access.maxObservers)
          ? access.maxObservers
          : null,
      }
    : null;
}

function stopLauncherHeartbeat() {
  if (launcherHeartbeatTimer) {
    clearInterval(launcherHeartbeatTimer);
    launcherHeartbeatTimer = null;
  }
}

function createAccessDeniedError(reason) {
  const nextReason = String(reason || "LICENSE_INVALID");
  const error = new Error(`${ACCESS_DENIED_ERROR_CODE}::${nextReason}`);
  error.code = ACCESS_DENIED_ERROR_CODE;
  error.reason = nextReason;
  return error;
}

function assertLauncherAccess() {
  if (launcherAccessState?.allowed === true) {
    return;
  }

  throw createAccessDeniedError(launcherAccessState?.reason);
}

async function runVisualReviewOcrPreview(itemId, options = {}) {
  const normalizedItemId = String(itemId || "").trim();
  if (!normalizedItemId) {
    throw new Error("Review item id is required.");
  }

  const automated = options.automated === true;
  if (visualOcrInFlightItemIds.has(normalizedItemId)) {
    return visualModeService.getReviewQueue();
  }

  let item;
  try {
    item = visualModeService.getReviewItem(normalizedItemId);
  } catch (error) {
    if (automated) {
      return visualModeService.getReviewQueue();
    }
    throw error;
  }

  if (item.status !== "pending" || item.ocrStatus === "processing") {
    return visualModeService.getReviewQueue();
  }
  if (!item.imagePath) {
    throw new Error("Capture an image before running OCR preview.");
  }

  if (automated) {
    const visualStatus = visualModeService.getStatus();
    if (!visualStatus.running || visualStatus.autoOcrEnabled !== true) {
      return visualModeService.getReviewQueue();
    }
  }

  assertLauncherAccess();
  const session = getStoredSession();
  visualOcrInFlightItemIds.add(item.id);
  visualModeService.markReviewItemOcrProcessing(item.id);

  try {
    const capturePath = visualModeService.assertReviewItemCaptureReady(item.id);
    const matchId = requireMatchId(item.matchId);
    const upload = await apiClient.uploadScreenshot({
      apiBase: session.apiBase,
      token: session.token || session.accessToken,
      refreshToken: session.refreshToken,
      filePath: capturePath,
      matchId,
    });
    const assetId = String(
      upload?.assetId || upload?.assets?.[0]?.assetId || "",
    ).trim();
    if (!assetId) {
      throw new Error("Screenshot upload did not return a private asset id.");
    }
    const preview = await apiClient.previewScreenshotResults({
      apiBase: session.apiBase,
      token: session.token || session.accessToken,
      refreshToken: session.refreshToken,
      matchId,
      assetId,
    });
    const queue = visualModeService.attachReviewItemOcrPreview(item.id, {
      assetId,
      preview,
    });
    log("[visual] OCR preview ready", {
      matchId: item.matchId,
      itemId: item.id,
      automated,
    });
    return queue;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error || "OCR preview failed.");
    logWarn("[visual] OCR preview failed", {
      matchId: item.matchId,
      itemId: item.id,
      automated,
      error: message,
    });
    try {
      return visualModeService.markReviewItemOcrFailed(item.id, message);
    } catch (updateError) {
      if (automated) {
        return visualModeService.getReviewQueue();
      }
      throw updateError;
    }
  } finally {
    visualOcrInFlightItemIds.delete(item.id);
  }
}

async function runVisualSlotMap(itemId) {
  const normalizedItemId = String(itemId || "").trim();
  if (!normalizedItemId) {
    throw new Error("Review item id is required.");
  }

  const item = visualModeService.getReviewItem(normalizedItemId);
  if (item.reviewKind !== "slot-map" && item.regionKey !== "roster") {
    throw new Error(
      "Capture the Roster screen before mapping slot/player names.",
    );
  }
  if (item.status !== "pending" || item.ocrStatus === "processing") {
    return visualModeService.getReviewQueue();
  }
  if (!item.imagePath) {
    throw new Error("Capture a roster image before mapping slots.");
  }

  assertLauncherAccess();
  const session = getStoredSession();
  const matchId = requireMatchId(item.matchId);
  await assertVisualRosterMappingAllowed(session, matchId);
  visualModeService.markReviewItemSlotMapProcessing(item.id);

  try {
    const capturePath = visualModeService.assertReviewItemCaptureReady(item.id);
    const upload = await apiClient.uploadScreenshot({
      apiBase: session.apiBase,
      token: session.token || session.accessToken,
      refreshToken: session.refreshToken,
      filePath: capturePath,
      matchId,
    });
    const assetId = String(
      upload?.assetId || upload?.assets?.[0]?.assetId || "",
    ).trim();
    if (!assetId) {
      throw new Error(
        "Roster screenshot upload did not return a private asset id.",
      );
    }

    // This existing endpoint maps by displayed slot number and saves only its
    // resolved slot/player mappings. It never applies match results.
    const preview = await apiClient.mapScreenshotSlots({
      apiBase: session.apiBase,
      token: session.token || session.accessToken,
      refreshToken: session.refreshToken,
      matchId,
      assetId,
    });
    const queue = visualModeService.attachReviewItemSlotMapPreview(item.id, {
      assetId,
      preview,
    });
    log("[visual] slot/player mapping saved", {
      matchId,
      itemId: item.id,
      mappedCount: Array.isArray(preview?.mapped) ? preview.mapped.length : 0,
      unresolvedCount: Array.isArray(preview?.unresolved)
        ? preview.unresolved.length
        : 0,
      ambiguousCount: Array.isArray(preview?.ambiguous)
        ? preview.ambiguous.length
        : 0,
    });
    return queue;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error || "Slot/player mapping failed.");
    logWarn("[visual] slot/player mapping failed", {
      matchId,
      itemId: item.id,
      error: message,
    });
    return visualModeService.markReviewItemOcrFailed(item.id, message);
  }
}

function queueAutomatedVisualOcrPreview(item) {
  const itemId = String(item?.id || "").trim();
  if (!itemId || visualModeService.getStatus().autoOcrEnabled !== true) {
    return;
  }

  // Keep only the newest stable candidate while a preview is in flight. This
  // bounds API work during animated screens without dropping the local evidence.
  queuedAutomatedVisualOcrId = itemId;
  if (automatedVisualOcrRunning) {
    return;
  }

  automatedVisualOcrRunning = true;
  void (async () => {
    try {
      while (queuedAutomatedVisualOcrId) {
        const nextItemId = queuedAutomatedVisualOcrId;
        queuedAutomatedVisualOcrId = null;
        try {
          await runVisualReviewOcrPreview(nextItemId, { automated: true });
        } catch (error) {
          logWarn("[visual] automated OCR preview skipped", {
            itemId: nextItemId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      automatedVisualOcrRunning = false;
      if (queuedAutomatedVisualOcrId) {
        queueAutomatedVisualOcrPreview({ id: queuedAutomatedVisualOcrId });
      }
    }
  })();
}

async function checkLauncherLicense(session) {
  const machineId = sessionManager.getMachineId();
  const licenseCheck = await apiClient.getLauncherLicense({
    apiBase: session.apiBase,
    token: session.token,
    refreshToken: session.refreshToken,
  });

  if (licenseCheck?.valid !== true) {
    return {
      valid: false,
      access: {
        allowed: false,
        reason: licenseCheck?.reason || "LICENSE_INVALID",
        license: licenseCheck?.license ?? null,
        machineId,
        activeSessions: null,
        maxObservers: Number.isFinite(licenseCheck?.license?.maxObservers)
          ? Number(licenseCheck.license.maxObservers)
          : null,
      },
      licenseCheck,
    };
  }

  return {
    valid: true,
    access: {
      allowed: false,
      reason: null,
      license: licenseCheck?.license ?? null,
      machineId,
      activeSessions: null,
      maxObservers: Number.isFinite(licenseCheck?.license?.maxObservers)
        ? Number(licenseCheck.license.maxObservers)
        : null,
    },
    licenseCheck,
  };
}

async function acquireLauncherSeat(session, licenseStatus, options = {}) {
  const machineId =
    licenseStatus?.access?.machineId || sessionManager.getMachineId();
  try {
    const sessionStart = await apiClient.startLauncherSession({
      apiBase: session.apiBase,
      token: session.token,
      refreshToken: session.refreshToken,
      machineId,
    });

    launcherAccessState = {
      allowed: true,
      reason: null,
      license:
        sessionStart?.license ??
        licenseStatus?.licenseCheck?.license ??
        licenseStatus?.access?.license ??
        null,
      machineId,
      activeSessions: Number.isFinite(sessionStart?.activeSessions)
        ? Number(sessionStart.activeSessions)
        : null,
      maxObservers: Number.isFinite(sessionStart?.maxObservers)
        ? Number(sessionStart.maxObservers)
        : Number.isFinite(licenseStatus?.licenseCheck?.license?.maxObservers)
          ? Number(licenseStatus.licenseCheck.license.maxObservers)
          : null,
    };

    if (options.startHeartbeat !== false) {
      startLauncherHeartbeat();
    }

    return launcherAccessState;
  } catch (error) {
    if (error?.code === OBSERVER_LIMIT_ERROR_CODE) {
      stopLauncherHeartbeat();
      launcherAccessState = {
        allowed: false,
        reason: OBSERVER_LIMIT_ERROR_CODE,
        license:
          error?.license ??
          licenseStatus?.licenseCheck?.license ??
          licenseStatus?.access?.license ??
          null,
        machineId:
          typeof error?.machineId === "string" && error.machineId.trim()
            ? error.machineId.trim()
            : machineId,
        activeSessions: Number.isFinite(error?.activeSessions)
          ? Number(error.activeSessions)
          : null,
        maxObservers: Number.isFinite(error?.maxObservers)
          ? Number(error.maxObservers)
          : Number.isFinite(licenseStatus?.licenseCheck?.license?.maxObservers)
            ? Number(licenseStatus.licenseCheck.license.maxObservers)
            : null,
      };
      return launcherAccessState;
    }

    throw error;
  }
}

async function evaluateLauncherAccess(session, options = {}) {
  const licenseStatus = await checkLauncherLicense(session);

  if (licenseStatus.valid !== true) {
    stopLauncherHeartbeat();
    launcherAccessState = licenseStatus.access;
    return launcherAccessState;
  }

  return acquireLauncherSeat(session, licenseStatus, options);
}

function refreshHeartbeatAccessState(licenseStatus) {
  const currentAccess = launcherAccessState;
  launcherAccessState = {
    allowed: currentAccess?.allowed === true,
    reason:
      currentAccess?.allowed === true ? null : (currentAccess?.reason ?? null),
    license:
      licenseStatus?.licenseCheck?.license ?? currentAccess?.license ?? null,
    machineId:
      currentAccess?.machineId ||
      licenseStatus?.access?.machineId ||
      sessionManager.getMachineId(),
    activeSessions:
      typeof currentAccess?.activeSessions === "number"
        ? currentAccess.activeSessions
        : null,
    maxObservers:
      typeof licenseStatus?.access?.maxObservers === "number"
        ? licenseStatus.access.maxObservers
        : typeof currentAccess?.maxObservers === "number"
          ? currentAccess.maxObservers
          : null,
  };
  return launcherAccessState;
}

function startLauncherHeartbeat() {
  stopLauncherHeartbeat();
  launcherHeartbeatTimer = setInterval(() => {
    void maintainLauncherSession();
  }, HEARTBEAT_INTERVAL_MS);
}

async function maintainLauncherSession() {
  try {
    const session = getStoredSession();
    const licenseStatus = await checkLauncherLicense(session);
    if (licenseStatus.valid !== true) {
      launcherAccessState = licenseStatus.access;
      logWarn("[launcher] access heartbeat blocked", licenseStatus.access);
      return;
    }

    if (launcherAccessState?.allowed === true) {
      refreshHeartbeatAccessState(licenseStatus);
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      stopLauncherHeartbeat();
      launcherAccessState = null;
      startupLicenseStatus = null;
      telemetryBridge.stop("stopped");
      await stopObserverFeedSilently("stopped");
      visualModeService.stop("stopped");
      sessionManager.clearSession();
      return;
    }

    logWarn(
      "[launcher] heartbeat failed",
      error && error.stack ? error.stack : error,
    );
  }
}

async function endLauncherSession(options = {}) {
  stopLauncherHeartbeat();
  launcherAccessState = null;
  startupLicenseStatus = null;
  telemetryBridge.stop("stopped");
  const observerFeedStop = await stopObserverFeedSilently("stopped");
  visualModeService.stop("stopped");
  resetLiveMatchMapSynchronization();

  const storedSession = sessionManager.readSession();
  if (!storedSession?.token && !storedSession?.refreshToken) {
    publishAiCasterAccessToWidgetServer(null);
    publishCommentatorDeskAccessToWidgetServer(null);
    if (options.clearAuth === true) {
      sessionManager.clearSession();
    }
    return {
      ok: observerFeedStop.ok === true,
      observerFeedStop,
    };
  }

  try {
    await apiClient.endLauncherSession({
      apiBase: normalizeBaseUrl(storedSession?.apiBase),
      token: storedSession.token,
      refreshToken: storedSession.refreshToken,
      machineId: sessionManager.getMachineId(),
    });
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      logWarn(
        "[launcher] failed to end launcher session",
        error && error.stack ? error.stack : error,
      );
    }
  } finally {
    if (options.clearAuth === true) {
      const latestSession = sessionManager.readSession();
      try {
        await apiClient.logout({
          apiBase: normalizeBaseUrl(latestSession?.apiBase),
          refreshToken:
            latestSession?.refreshToken || storedSession.refreshToken || "",
        });
      } catch (error) {
        logWarn(
          "[launcher] failed to revoke auth session",
          error && error.stack ? error.stack : error,
        );
      }
    }
    publishAiCasterAccessToWidgetServer(null);
    publishCommentatorDeskAccessToWidgetServer(null);
    if (options.clearAuth === true) {
      sessionManager.clearSession();
    }
  }

  return {
    ok: observerFeedStop.ok === true,
    observerFeedStop,
  };
}

async function tryFetchLiveMatch(url) {
  try {
    const response = await axios.get(url, { timeout: 8000 });
    return response?.data ?? null;
  } catch (error) {
    if (error?.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

function buildLiveMatchResult(
  apiBase,
  matchId,
  status,
  source,
  tournamentId = null,
  stageId = null,
  extra = {},
) {
  return {
    apiBase,
    matchId: matchId ? String(matchId) : null,
    status: status ? String(status) : null,
    source,
    tournamentId: tournamentId ? String(tournamentId) : null,
    stageId: stageId ? String(stageId) : null,
    sessionId: extra?.sessionId ? String(extra.sessionId) : null,
    sessionName: extra?.sessionName ? String(extra.sessionName) : null,
    matchName: extra?.matchName ? String(extra.matchName) : null,
    matchNumber: Number.isFinite(Number(extra?.matchNumber))
      ? Number(extra.matchNumber)
      : null,
    map: extra?.map ? String(extra.map) : null,
  };
}

function readLiveMatchId(payload) {
  return (
    payload?.matchId ||
    payload?.id ||
    payload?.match?.id ||
    payload?.activeMatch?.id ||
    null
  );
}

function readLiveMatchStatus(payload) {
  return (
    payload?.status ||
    payload?.lifecycleStatus ||
    payload?.matchStatus ||
    payload?.match?.status ||
    null
  );
}

function readLiveMatchTournamentId(payload) {
  return (
    payload?.tournamentId ||
    payload?.match?.tournamentId ||
    payload?.activeMatch?.tournamentId ||
    null
  );
}

function readLiveMatchStageId(payload) {
  return (
    payload?.stageId ||
    payload?.match?.stageId ||
    payload?.activeMatch?.stageId ||
    null
  );
}

function readLiveMatchSessionId(payload) {
  return (
    payload?.sessionId ||
    payload?.match?.sessionId ||
    payload?.activeMatch?.sessionId ||
    null
  );
}

function readLiveMatchSessionName(payload) {
  return (
    payload?.sessionName ||
    payload?.match?.sessionName ||
    payload?.match?.session?.name ||
    payload?.activeMatch?.sessionName ||
    payload?.activeMatch?.session?.name ||
    null
  );
}

function readLiveMatchName(payload) {
  return (
    payload?.matchName ||
    payload?.name ||
    payload?.match?.matchName ||
    payload?.match?.name ||
    payload?.activeMatch?.matchName ||
    payload?.activeMatch?.name ||
    null
  );
}

function readLiveMatchNumber(payload) {
  return (
    payload?.matchNumber ??
    payload?.match?.matchNumber ??
    payload?.activeMatch?.matchNumber ??
    null
  );
}

function readLiveMatchMap(payload) {
  return (
    payload?.map || payload?.match?.map || payload?.activeMatch?.map || null
  );
}

function readLiveMatchExtra(payload) {
  return {
    sessionId: readLiveMatchSessionId(payload),
    sessionName: readLiveMatchSessionName(payload),
    matchName: readLiveMatchName(payload),
    matchNumber: readLiveMatchNumber(payload),
    map: readLiveMatchMap(payload),
  };
}

async function fetchAuthenticatedLiveMatch(apiBase, session, options = {}) {
  const token = String(session?.token || session?.accessToken || "").trim();
  const refreshToken = String(session?.refreshToken || "").trim();
  if (!token && !refreshToken) {
    return null;
  }

  const requestParams = {
    apiBase,
    token,
    refreshToken,
    signal: options?.signal,
  };

  const attempts = [
    {
      source: "me/active-match",
      fetch: () => apiClient.getActiveMatch(requestParams),
      readMatchId: readLiveMatchId,
      readStatus: readLiveMatchStatus,
    },
  ];

  for (const attempt of attempts) {
    try {
      const payload = await attempt.fetch();
      const matchId = attempt.readMatchId(payload);
      if (matchId) {
        return buildLiveMatchResult(
          apiBase,
          matchId,
          attempt.readStatus(payload),
          attempt.source,
          readLiveMatchTournamentId(payload),
          readLiveMatchStageId(payload),
          readLiveMatchExtra(payload),
        );
      }
    } catch (error) {
      if (options?.signal?.aborted === true) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : error;
      }
      if (error?.status === 404) {
        continue;
      }
      logWarn(
        "[launcher] scoped live match lookup failed",
        attempt.source,
        error && error.message ? error.message : error,
      );
    }
  }

  return buildLiveMatchResult(apiBase, null, null, "scoped-active-match");
}

function sanitizeFileName(value) {
  const cleaned = String(value || "team")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "_")
    .replace(/\.+$/g, "");
  return cleaned.slice(0, 80) || "team";
}

function normalizeHexColor(value) {
  const raw = String(value || "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
    return raw.toUpperCase();
  }
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return "#FFFFFF";
}

function getBrandingConfigPath() {
  const localAppData =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(
    localAppData,
    "ShadowTrackerExtra",
    "Saved",
    "TeamLogoAndColor.ini",
  );
}

function ensurePlaceholderLogo() {
  const result = ensureDefaultTeamLogo({
    teamAssetsDir: TEAM_ASSETS_DIR,
    bundledDefaultTeamPath: resolveBundledDefaultTeamPath(),
    fallbackPngBuffer: Buffer.from(PLACEHOLDER_LOGO_BASE64, "base64"),
  });
  return result.path;
}

function resolveLogoUrl(baseUrl, logoUrl) {
  return resolveAllowedRemoteImageUrl(baseUrl, logoUrl);
}

function writeAssetFileAtomic(filePath, buffer) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, buffer, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup for an interrupted cache update.
    }
  }
}

function normalizePlayerAssetKey(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || null;
}

function collectPlayerAssetKeys(player) {
  const keys = [
    player?.id,
    player?.playerId,
    player?.playerKey,
    player?.pubgPlayerId,
    player?.inGameId,
    player?.externalId,
  ]
    .map(normalizePlayerAssetKey)
    .filter(Boolean);
  return Array.from(new Set(keys));
}

function isDefaultPlayerPhotoUrl(urlValue) {
  const raw = String(urlValue || "")
    .trim()
    .toLowerCase();
  return (
    !raw ||
    raw.includes("default-player") ||
    raw.includes("defaults/default") ||
    raw.includes("placeholder")
  );
}

function resolvePlayerPhotoUrl(baseUrl, player) {
  const candidates = [
    player?.photoUrl,
    player?.avatarUrl,
    player?.playerPhoto,
    player?.imageUrl,
    player?.image,
    player?.avatar,
  ];

  for (const candidate of candidates) {
    const resolved = resolveLogoUrl(baseUrl, candidate);
    if (resolved && !isDefaultPlayerPhotoUrl(resolved)) {
      return resolved;
    }
  }

  return null;
}

function normalizePlayerRecord(record, context = {}) {
  const source =
    record && typeof record.player === "object" && record.player
      ? record.player
      : record;
  if (!source || typeof source !== "object") {
    return null;
  }

  const id =
    asOptionalString(source.id) ||
    asOptionalString(source.playerId) ||
    asOptionalString(source.playerKey) ||
    asOptionalString(source.pubgPlayerId) ||
    asOptionalString(source.inGameId) ||
    asOptionalString(source.externalId);
  const keys = collectPlayerAssetKeys({
    id,
    playerId: source.playerId,
    playerKey: source.playerKey,
    pubgPlayerId: source.pubgPlayerId,
    inGameId: source.inGameId,
    externalId: source.externalId,
  });

  if (!id && keys.length === 0) {
    return null;
  }

  return {
    id,
    playerId: asOptionalString(source.playerId) || id,
    playerKey: asOptionalString(source.playerKey),
    pubgPlayerId: asOptionalString(source.pubgPlayerId),
    inGameId: asOptionalString(source.inGameId),
    externalId: asOptionalString(source.externalId),
    ign:
      asOptionalString(source.ign) ||
      asOptionalString(source.name) ||
      asOptionalString(source.playerName) ||
      asOptionalString(source.realName),
    photoUrl:
      asOptionalString(source.photoUrl) ||
      asOptionalString(source.avatarUrl) ||
      asOptionalString(source.playerPhoto) ||
      asOptionalString(source.imageUrl) ||
      null,
    avatarUrl: asOptionalString(source.avatarUrl),
    teamId: asOptionalString(context.teamId) || asOptionalString(source.teamId),
    slotNumber: Number.isFinite(Number(context.slotNumber))
      ? Math.trunc(Number(context.slotNumber))
      : null,
    assetKeys: keys,
  };
}

function normalizePlayersPayload(payload, context = {}) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.players)
      ? payload.players
      : Array.isArray(payload?.roster)
        ? payload.roster
        : Array.isArray(payload?.items)
          ? payload.items
          : [];

  return source
    .map((entry) => normalizePlayerRecord(entry, context))
    .filter(Boolean);
}

function purgePlayerAssetFiles(assetKey) {
  const normalizedKey = normalizePlayerAssetKey(assetKey);
  if (!normalizedKey || !fs.existsSync(PLAYER_ASSETS_DIR)) {
    return;
  }

  for (const fileName of fs.readdirSync(PLAYER_ASSETS_DIR)) {
    const parsed = path.parse(fileName);
    if (parsed.name !== normalizedKey) {
      continue;
    }
    try {
      fs.unlinkSync(path.join(PLAYER_ASSETS_DIR, fileName));
    } catch {
      // Ignore stale cache cleanup failures.
    }
  }
}

async function downloadPlayerPhoto(baseUrl, player) {
  const assetKeys = Array.isArray(player?.assetKeys)
    ? player.assetKeys.map(normalizePlayerAssetKey).filter(Boolean)
    : collectPlayerAssetKeys(player);
  const primaryKey = assetKeys[0] || null;

  if (!primaryKey) {
    return {
      ok: false,
      skipped: true,
      reason: "missing player id",
      player,
    };
  }

  const photoUrl = resolvePlayerPhotoUrl(baseUrl, player);
  if (!photoUrl) {
    return {
      ok: false,
      skipped: true,
      reason: "missing photo url",
      player,
    };
  }

  const { buffer } = await downloadAndSanitizeRemoteImage({
    baseUrl,
    url: photoUrl,
  });
  let primaryPath = null;

  for (const assetKey of assetKeys) {
    purgePlayerAssetFiles(assetKey);
    const filePath = path.join(PLAYER_ASSETS_DIR, `${assetKey}.png`);
    writeAssetFileAtomic(filePath, buffer);
    if (!primaryPath) {
      primaryPath = filePath;
    }
  }

  return {
    ok: true,
    skipped: false,
    playerId: player?.id || player?.playerId || primaryKey,
    playerName: player?.ign || null,
    photoUrl,
    localPhotoPath: primaryPath,
    aliases: assetKeys,
  };
}

function normalizeSlot(slot) {
  const teamRecord =
    slot && typeof slot.team === "object" && slot.team ? slot.team : null;
  const derivedLogoUrl =
    teamRecord?.logoUrl ??
    slot?.teamLogoUrl ??
    slot?.logoUrl ??
    slot?.team_logo_url ??
    null;

  return {
    id: String(slot?.id ?? `slot-${slot?.slotNumber ?? "0"}`),
    matchId: String(slot?.matchId ?? ""),
    slotNumber: Number(slot?.slotNumber ?? slot?.teamNo ?? 0),
    teamId: slot?.teamId
      ? String(slot.teamId)
      : teamRecord?.id
        ? String(teamRecord.id)
        : null,
    lobbyStatus: slot?.lobbyStatus ? String(slot.lobbyStatus) : null,
    playersInLobby:
      slot?.playersInLobby === null || slot?.playersInLobby === undefined
        ? null
        : Number(slot.playersInLobby),
    team: teamRecord
      ? {
          id: String(teamRecord.id ?? ""),
          name: teamRecord.name ? String(teamRecord.name) : null,
          tag: teamRecord.tag ? String(teamRecord.tag) : null,
          logoUrl: derivedLogoUrl ? String(derivedLogoUrl) : null,
          accentLight: teamRecord.accentLight
            ? String(teamRecord.accentLight)
            : null,
          accentDark: teamRecord.accentDark
            ? String(teamRecord.accentDark)
            : null,
        }
      : derivedLogoUrl
        ? {
            id: String(slot?.teamId ?? ""),
            name: slot?.teamName ? String(slot.teamName) : null,
            tag: slot?.teamTag ? String(slot.teamTag) : null,
            logoUrl: String(derivedLogoUrl),
            accentLight: slot?.teamColor ? String(slot.teamColor) : null,
            accentDark: null,
          }
        : null,
  };
}

async function fetchObserverSlots(session, matchId) {
  const trimmedMatchId = requireMatchId(matchId);
  const payload = await apiClient.fetchObserverSlots({
    apiBase: session.apiBase,
    token: session.token,
    refreshToken: session.refreshToken,
    matchId: trimmedMatchId,
  });
  const slotList = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.slots)
      ? payload.slots
      : [];

  const slots = slotList
    .map(normalizeSlot)
    .filter((slot) => Number.isFinite(slot.slotNumber) && slot.slotNumber > 0)
    .sort((left, right) => left.slotNumber - right.slotNumber);

  return { baseUrl: session.apiBase, matchId: trimmedMatchId, slots };
}

function countAssignedObserverSlots(slots) {
  return Array.isArray(slots)
    ? slots.filter((slot) => slot?.teamId || slot?.team).length
    : 0;
}

async function syncSlotsFromPreviousMatch(session, matchId, options = {}) {
  const trimmedMatchId = requireMatchId(matchId);
  return (
    (await apiClient.syncSlotsFromPreviousMatch({
      apiBase: session.apiBase,
      token: session.token,
      refreshToken: session.refreshToken,
      matchId: trimmedMatchId,
      overwrite: options?.overwrite === true,
      dryRun: options?.dryRun === true,
    })) ?? {}
  );
}

async function recoverObserverSlotsFromPreviousMatch(session, observerSlots) {
  const currentAssignedCount = countAssignedObserverSlots(observerSlots?.slots);
  let recoveryPlan = null;

  try {
    recoveryPlan = await syncSlotsFromPreviousMatch(
      session,
      observerSlots.matchId,
      {
        dryRun: true,
      },
    );
  } catch (error) {
    const status = Number(error?.status);
    if (status === 400 || status === 404) {
      return {
        observerSlots,
        recovery: null,
      };
    }
    throw error;
  }

  const sourceAssignedCount = Number(recoveryPlan?.syncedSlots ?? 0);
  const needsSync = recoveryPlan?.needsSync === true;
  const previousMatchNumber = normalizePreviousMatchNumber(
    recoveryPlan?.previousMatchNumber,
  );
  if (!needsSync) {
    return {
      observerSlots,
      recovery: recoveryPlan
        ? {
            applied: false,
            attempted: false,
            currentAssignedCount,
            sourceAssignedCount,
            previousMatchId: recoveryPlan?.previousMatchId ?? null,
            previousMatchNumber,
            needsSync: false,
            message:
              recoveryPlan?.message ||
              "Current match already matches the nearest populated previous match.",
          }
        : null,
    };
  }

  if (
    !shouldApplyPreviousMatchSlotRecovery({
      currentAssignedCount,
      needsSync,
    })
  ) {
    return {
      observerSlots,
      recovery: {
        applied: false,
        attempted: false,
        currentAssignedCount,
        sourceAssignedCount,
        previousMatchId: recoveryPlan?.previousMatchId ?? null,
        previousMatchNumber,
        needsSync: true,
        skippedReason: "current-slots-present",
        message:
          "Current match slots differ from the previous match; kept current slot assignments to preserve manual edits.",
      },
    };
  }

  const syncResult = await syncSlotsFromPreviousMatch(
    session,
    observerSlots.matchId,
    {
      overwrite: false,
    },
  );
  const refreshedObserverSlots = await fetchObserverSlots(
    session,
    observerSlots.matchId,
  );

  return {
    observerSlots: refreshedObserverSlots,
    recovery: {
      applied: true,
      attempted: true,
      currentAssignedCount,
      sourceAssignedCount,
      previousMatchId:
        syncResult?.previousMatchId ?? recoveryPlan?.previousMatchId ?? null,
      previousMatchNumber: normalizePreviousMatchNumber(
        syncResult?.previousMatchNumber ?? recoveryPlan?.previousMatchNumber,
      ),
      needsSync: false,
      message:
        syncResult?.message ||
        recoveryPlan?.message ||
        "Recovered slot assignments from the nearest populated previous match.",
    },
  };
}

async function fetchLiveMatch(apiBase, session = null) {
  const normalizedBase = normalizeBaseUrl(apiBase);
  const scopedLiveMatch = await fetchAuthenticatedLiveMatch(
    normalizedBase,
    session,
  );
  if (scopedLiveMatch) {
    return scopedLiveMatch;
  }

  const publicPayload = await tryFetchLiveMatch(
    `${normalizedBase}/public/live-match`,
  );
  if (publicPayload?.matchId) {
    return buildLiveMatchResult(
      normalizedBase,
      publicPayload.matchId,
      publicPayload.status,
      "public/live-match",
      readLiveMatchTournamentId(publicPayload),
      readLiveMatchStageId(publicPayload),
      readLiveMatchExtra(publicPayload),
    );
  }

  const feedPayload = await tryFetchLiveMatch(`${normalizedBase}/match/live`);
  if (feedPayload?.match?.id || feedPayload?.matchId || feedPayload?.id) {
    return buildLiveMatchResult(
      normalizedBase,
      feedPayload?.match?.id || feedPayload?.matchId || feedPayload?.id,
      feedPayload?.match?.status || feedPayload?.status,
      "match/live",
      readLiveMatchTournamentId(feedPayload),
      readLiveMatchStageId(feedPayload),
      readLiveMatchExtra(feedPayload),
    );
  }

  return buildLiveMatchResult(
    normalizedBase,
    publicPayload?.matchId,
    publicPayload?.status || feedPayload?.match?.status || feedPayload?.status,
    publicPayload ? "public/live-match" : feedPayload ? "match/live" : null,
    readLiveMatchTournamentId(publicPayload) ||
      readLiveMatchTournamentId(feedPayload),
    readLiveMatchStageId(publicPayload) || readLiveMatchStageId(feedPayload),
    {
      ...readLiveMatchExtra(feedPayload),
      ...readLiveMatchExtra(publicPayload),
    },
  );
}

function getDesiredObserverFallbackMapKey(
  matchId = null,
  bootstrapMapKey = null,
) {
  const targetMatchId =
    normalizeOptionalString(matchId) ||
    normalizeOptionalString(observerFeedState.matchId) ||
    normalizeOptionalString(productionModeState.matchId);
  return resolveDesiredObserverFallbackMapKey({
    matchId: targetMatchId,
    liveMapState: liveMatchMapState,
    productionModeState,
    bootstrapMapKey,
  });
}

function resetLiveMatchMapSynchronization() {
  liveMatchMapState = {
    matchId: null,
    mapKey: null,
    updatedAt: null,
  };
  liveMatchMapRefreshPromise = null;
  lastLiveMatchMapRefreshAt = 0;
  observerMapFallbackSyncDesired = null;
  observerMapFallbackSyncEpoch += 1;
  observerMapFallbackLastAppliedIdentity = null;
  observerMapFallbackLastWarningAt = 0;
  clearObserverMapFallbackRetry();
}

function applyAuthoritativeLiveMatchMap(liveMatch) {
  const plan = resolveLiveMatchMapSyncPlan({
    liveMatch,
    productionModeState,
    observerFeedState: getObserverFeedStatusView(),
  });
  if (!plan) {
    return null;
  }

  const previousDesiredMapKey =
    liveMatchMapState.matchId === plan.matchId
      ? liveMatchMapState.mapKey
      : plan.previousMapKey;
  const desiredMapChanged = previousDesiredMapKey !== plan.mapKey;
  liveMatchMapState = {
    matchId: plan.matchId,
    mapKey: plan.mapKey,
    updatedAt: new Date().toISOString(),
  };

  if (plan.productionMatch) {
    productionModeState = {
      ...productionModeState,
      selectedMapKey: plan.mapKey,
    };
  }

  if (desiredMapChanged) {
    log("[Observer Feed] Live match map fallback updated", {
      matchId: plan.matchId,
      previousMapKey: previousDesiredMapKey || null,
      mapKey: plan.mapKey,
      source: liveMatch.source,
    });
    if (typeof widgetServer?.refreshDirectObserverSnapshot === "function") {
      widgetServer.refreshDirectObserverSnapshot();
    }
  }

  if (plan.observerMatch) {
    void scheduleObserverMapFallbackSync(plan.matchId, plan.mapKey);
  }

  return {
    ...plan,
    desiredMapChanged,
  };
}

async function refreshAuthoritativeLiveMatchMap(sessionOverride = null) {
  if (liveMatchMapRefreshPromise) {
    return liveMatchMapRefreshPromise;
  }

  const refreshEpoch = observerMapFallbackSyncEpoch;
  const refreshPromise = (async () => {
    const session = sessionOverride || getStoredSession();
    lastLiveMatchMapRefreshAt = Date.now();
    const liveMatch = await fetchAuthenticatedLiveMatch(
      normalizeBaseUrl(session.apiBase),
      session,
    );
    if (refreshEpoch === observerMapFallbackSyncEpoch) {
      applyAuthoritativeLiveMatchMap(liveMatch);
    }
    return liveMatch;
  })();
  liveMatchMapRefreshPromise = refreshPromise;

  try {
    return await refreshPromise;
  } finally {
    if (liveMatchMapRefreshPromise === refreshPromise) {
      liveMatchMapRefreshPromise = null;
    }
  }
}

function shouldRefreshAuthoritativeLiveMatchMap(now = Date.now()) {
  return now - lastLiveMatchMapRefreshAt >= LIVE_MATCH_MAP_REFRESH_INTERVAL_MS;
}

async function downloadLogoForSlot(baseUrl, slot, placeholderPath) {
  const colorHex = normalizeHexColor(
    slot?.team?.accentLight || slot?.team?.accentDark || "#FFFFFF",
  );
  const logoUrl = resolveLogoUrl(baseUrl, slot?.team?.logoUrl);
  const teamSlug = sanitizeFileName(
    slot?.team?.tag || slot?.team?.name || `team_${slot.slotNumber}`,
  );

  if (!logoUrl) {
    return {
      ...slot,
      localLogoPath: placeholderPath,
      resolvedColor: colorHex,
      usedPlaceholder: true,
      logoDownloaded: false,
    };
  }

  try {
    const { buffer: nextBuffer } = await downloadAndSanitizeRemoteImage({
      baseUrl,
      url: logoUrl,
    });
    const filePath = path.join(
      TEAM_ASSETS_DIR,
      `${String(slot.slotNumber).padStart(2, "0")}_${teamSlug}.png`,
    );
    if (fs.existsSync(filePath)) {
      try {
        const existingBuffer = fs.readFileSync(filePath);
        if (
          existingBuffer.length === nextBuffer.length &&
          existingBuffer.equals(nextBuffer)
        ) {
          return {
            ...slot,
            localLogoPath: filePath,
            resolvedColor: colorHex,
            usedPlaceholder: false,
            logoDownloaded: true,
            logoCacheHit: true,
          };
        }
      } catch {
        // Fall through and rewrite the asset if the comparison fails.
      }
    }
    writeAssetFileAtomic(filePath, nextBuffer);
    return {
      ...slot,
      localLogoPath: filePath,
      resolvedColor: colorHex,
      usedPlaceholder: false,
      logoDownloaded: true,
      logoCacheHit: false,
    };
  } catch (err) {
    logWarn(
      "[launcher] logo download failed",
      slot?.slotNumber,
      remoteImageReference(logoUrl),
      err && err.message ? err.message : err,
    );
    return {
      ...slot,
      localLogoPath: placeholderPath,
      resolvedColor: colorHex,
      usedPlaceholder: true,
      logoDownloaded: false,
    };
  }
}

async function syncAssignedObserverSlots(baseUrl, slots, placeholderPath) {
  const assignedSlots = Array.isArray(slots)
    ? slots.filter((slot) => slot?.teamId || slot?.team)
    : [];
  const syncedSlots = [];

  for (const slot of assignedSlots) {
    syncedSlots.push(await downloadLogoForSlot(baseUrl, slot, placeholderPath));
  }

  return syncedSlots;
}

function getSessionOrganizationId(session) {
  return (
    asOptionalString(session?.organization?.id) ||
    asOptionalString(session?.user?.organizationId) ||
    asOptionalString(session?.user?.actingOrgId) ||
    null
  );
}

function publishOrganizationWidgetBranding(context) {
  const source = context && typeof context === "object" ? context : {};
  const organization =
    source.organization && typeof source.organization === "object"
      ? source.organization
      : {};
  const branding =
    source.branding && typeof source.branding === "object"
      ? source.branding
      : organization.branding && typeof organization.branding === "object"
        ? organization.branding
        : null;
  const organizationId =
    asOptionalString(source.organizationId) ||
    asOptionalString(organization.id);
  const organizationSlug =
    asOptionalString(source.organizationSlug) ||
    asOptionalString(organization.slug);
  const organizationName =
    asOptionalString(source.organizationName) ||
    asOptionalString(organization.name);
  const previousOrganizationId = asOptionalString(
    cachedOrganizationWidgetBranding?.organizationId,
  );
  const brandingApiUrl =
    asOptionalString(source.brandingApiUrl) ||
    (organizationId && organizationId === previousOrganizationId
      ? asOptionalString(cachedOrganizationWidgetBranding?.brandingApiUrl)
      : null);

  cachedOrganizationWidgetBranding = {
    organizationId: organizationId || null,
    organizationSlug: organizationSlug || null,
    brandingApiUrl: brandingApiUrl || null,
    organization:
      organizationId || organizationSlug || organizationName || branding
        ? {
            id: organizationId || null,
            slug: organizationSlug || null,
            name: organizationName || null,
            branding,
          }
        : null,
    branding,
  };

  if (
    widgetServer &&
    typeof widgetServer.setOrganizationBranding === "function"
  ) {
    widgetServer.setOrganizationBranding(cachedOrganizationWidgetBranding);
  }

  return cachedOrganizationWidgetBranding;
}

async function refreshOrganizationWidgetBranding(
  session,
  { throwOnError = false, organizationId = null } = {},
) {
  const resolvedSession = session || getStoredSession();
  const resolvedOrganizationId =
    asOptionalString(organizationId) ||
    getSessionOrganizationId(resolvedSession);

  if (!resolvedOrganizationId) {
    return cachedOrganizationWidgetBranding;
  }

  try {
    const response = await axios.get(
      `${normalizeBaseUrl(resolvedSession?.apiBase)}/branding/${encodeURIComponent(
        resolvedOrganizationId,
      )}`,
      {
        timeout: 10000,
        headers: {
          Accept: "application/json",
        },
      },
    );
    const payload = response?.data ?? null;
    const branding =
      payload?.branding && typeof payload.branding === "object"
        ? payload.branding
        : payload?.data && typeof payload.data === "object"
          ? payload.data
          : payload && typeof payload === "object"
            ? payload
            : null;
    const knownOrganization =
      resolvedSession?.organization &&
      typeof resolvedSession.organization === "object"
        ? resolvedSession.organization
        : {};

    return publishOrganizationWidgetBranding({
      organizationId: resolvedOrganizationId,
      brandingApiUrl: `${normalizeBaseUrl(
        resolvedSession?.apiBase,
      )}/branding/${encodeURIComponent(resolvedOrganizationId)}`,
      organization: {
        id: resolvedOrganizationId,
        slug: asOptionalString(knownOrganization.slug),
        name: asOptionalString(knownOrganization.name),
        branding,
      },
      branding,
    });
  } catch (error) {
    const message = getWidgetCatalogErrorMessage(
      error,
      "Failed to load organization widget branding.",
    );
    logWarn("[widget-branding] refresh failed", message);
    if (throwOnError) {
      throw new Error(message);
    }
    return cachedOrganizationWidgetBranding;
  }
}

function publishAiCasterAccessToWidgetServer(access) {
  cachedAiCasterAccess = access ?? null;
  if (widgetServer && typeof widgetServer.setAiCasterAccess === "function") {
    widgetServer.setAiCasterAccess(cachedAiCasterAccess);
  }
}

async function refreshAiCasterAccess(
  session,
  { throwOnError = false, organizationId = null } = {},
) {
  const resolvedSession = session || getStoredSession();
  const resolvedOrganizationId =
    asOptionalString(organizationId) ||
    getSessionOrganizationId(resolvedSession);

  try {
    const access = await apiClient.getAiCasterAccess({
      apiBase: resolvedSession.apiBase,
      token: resolvedSession.token,
      refreshToken: resolvedSession.refreshToken,
      organizationId: resolvedOrganizationId,
    });
    publishAiCasterAccessToWidgetServer(access);
    return access;
  } catch (error) {
    const message = getWidgetCatalogErrorMessage(
      error,
      "Failed to load AI caster access.",
    );
    logWarn("[ai-caster] access refresh failed", message);
    if (throwOnError) {
      throw new Error(message);
    }
    return cachedAiCasterAccess;
  }
}

async function refreshCommentatorDeskAccess(
  session,
  { throwOnError = false, organizationId = null } = {},
) {
  const resolvedSession = session || getStoredSession();
  const resolvedOrganizationId =
    asOptionalString(organizationId) ||
    getSessionOrganizationId(resolvedSession);

  try {
    await getWidgetCatalogState({
      organizationId: resolvedOrganizationId,
      widgetKeys: [],
      accessOnlyWidgetKeys: [COMMENTATOR_DESK_WIDGET_KEY],
    });
    return cachedCommentatorDeskAccess;
  } catch (error) {
    const message = getWidgetCatalogErrorMessage(
      error,
      "Failed to load commentator desk access.",
    );
    logWarn("[commentator-desk] access refresh failed", message);
    if (throwOnError) {
      throw new Error(message);
    }
    return cachedCommentatorDeskAccess;
  }
}

async function refreshWidgetHotkeyControlApproval(
  session,
  { throwOnError = false, organizationId = null } = {},
) {
  const resolvedSession = session || getStoredSession();
  const resolvedOrganizationId =
    asOptionalString(organizationId) ||
    getSessionOrganizationId(resolvedSession);

  try {
    await getWidgetCatalogState({
      organizationId: resolvedOrganizationId,
      widgetKeys: [],
      accessOnlyWidgetKeys: [HOTKEY_CONTROL_APPROVAL_KEY],
    });
    return widgetHotkeyControl.getStatus();
  } catch (error) {
    const message = getWidgetCatalogErrorMessage(
      error,
      "Failed to load widget hotkey control approval.",
    );
    logWarn("[widget-hotkey] approval refresh failed", message);
    if (throwOnError) {
      throw new Error(message);
    }
    widgetHotkeyControl.setApproval({
      isApproved: false,
      reason: message || "SUPER_ADMIN_APPROVAL_REQUIRED",
    });
    return widgetHotkeyControl.getStatus();
  }
}

async function getWidgetHotkeyControlStatus(payload = {}) {
  assertLauncherAccess();
  const session = getStoredSession();
  await refreshWidgetHotkeyControlApproval(session, {
    throwOnError: false,
    organizationId: payload?.organizationId ?? null,
  });
  return widgetHotkeyControl.getStatus();
}

async function updateWidgetHotkeyControl(payload = {}) {
  assertLauncherAccess();
  const session = getStoredSession();
  await refreshWidgetHotkeyControlApproval(session, {
    throwOnError: true,
    organizationId: payload?.organizationId ?? null,
  });
  if (widgetHotkeyControl.getStatus().approved !== true) {
    throw new Error("Widget hotkey control requires Super Admin approval.");
  }
  return widgetHotkeyControl.updateConfig(payload?.config || {});
}

async function triggerWidgetHotkeyControl(payload = {}) {
  assertLauncherAccess();
  const session = getStoredSession();
  await refreshWidgetHotkeyControlApproval(session, {
    throwOnError: true,
    organizationId: payload?.organizationId ?? null,
  });
  return widgetHotkeyControl.trigger(payload?.active === true);
}

async function updateAiCasterSettings(payload) {
  assertLauncherAccess();
  const session = getStoredSession();
  const organizationId =
    asOptionalString(payload?.organizationId) ||
    getSessionOrganizationId(session);
  const access = await apiClient.updateAiCasterSettings({
    apiBase: session.apiBase,
    token: session.token,
    refreshToken: session.refreshToken,
    organizationId,
    settings: payload?.settings || {},
  });
  publishAiCasterAccessToWidgetServer(access);
  return access;
}

async function previewAiCasterVoice(payload) {
  assertLauncherAccess();
  const session = getStoredSession();
  const organizationId =
    asOptionalString(payload?.organizationId) ||
    getSessionOrganizationId(session);
  return apiClient.previewAiCasterVoice({
    apiBase: session.apiBase,
    token: session.token,
    refreshToken: session.refreshToken,
    organizationId,
    preview: {
      voice: payload?.voice,
      role: payload?.role,
      text: payload?.text,
      mode: payload?.mode,
      speakingSpeed: payload?.speakingSpeed,
      expression: payload?.expression,
    },
  });
}

async function fetchAssignedPlayerPhotos(session, slots) {
  const assignedSlots = Array.isArray(slots)
    ? slots.filter((slot) => slot?.teamId || slot?.team?.id)
    : [];
  const organizationId = getSessionOrganizationId(session);
  const players = [];
  const failures = [];
  const seenTeams = new Set();
  const seenPlayers = new Set();

  for (const slot of assignedSlots) {
    const teamId =
      asOptionalString(slot?.teamId) || asOptionalString(slot?.team?.id);
    if (!teamId || seenTeams.has(teamId)) {
      continue;
    }
    seenTeams.add(teamId);

    try {
      const payload = await apiClient.fetchTeamPlayers({
        apiBase: session.apiBase,
        token: session.token,
        refreshToken: session.refreshToken,
        organizationId,
        teamId,
      });
      const normalizedPlayers = normalizePlayersPayload(payload, {
        teamId,
        slotNumber: slot?.slotNumber,
      });

      for (const player of normalizedPlayers) {
        const dedupeKey =
          player.id ||
          player.playerId ||
          player.playerKey ||
          player.pubgPlayerId ||
          `${teamId}:${player.ign || players.length}`;
        if (seenPlayers.has(dedupeKey)) {
          continue;
        }
        seenPlayers.add(dedupeKey);
        players.push(player);
      }
    } catch (error) {
      failures.push({
        teamId,
        slotNumber: slot?.slotNumber ?? null,
        reason: error && error.message ? error.message : String(error || ""),
      });
    }
  }

  return {
    players,
    teamFetchFailures: failures,
  };
}

async function syncAssignedPlayerPhotos(session, baseUrl, slots) {
  ensureDir(PLAYER_ASSETS_DIR);
  const { players, teamFetchFailures } = await fetchAssignedPlayerPhotos(
    session,
    slots,
  );
  const photos = [];
  const failures = [];
  let syncedCount = 0;
  let missingPhotoCount = 0;

  for (const player of players) {
    try {
      const photoResult = await downloadPlayerPhoto(baseUrl, player);
      photos.push(photoResult);
      if (photoResult.ok) {
        syncedCount += 1;
      } else if (photoResult.reason === "missing photo url") {
        missingPhotoCount += 1;
      }
    } catch (error) {
      failures.push({
        playerId: player?.id || player?.playerId || null,
        playerName: player?.ign || null,
        reason: error && error.message ? error.message : String(error || ""),
      });
    }
  }

  return {
    ok: failures.length === 0 && teamFetchFailures.length === 0,
    playerAssetsDir: PLAYER_ASSETS_DIR,
    totalPlayers: players.length,
    syncedCount,
    missingPhotoCount,
    skippedCount: photos.filter((photo) => photo?.skipped === true).length,
    failedCount: failures.length + teamFetchFailures.length,
    teamFetchFailures,
    failures,
    photos: photos.filter((photo) => photo?.ok === true),
  };
}

async function refreshAssignedPlayerPhotoCache(session, matchId) {
  const observerSlots = await fetchObserverSlots(session, matchId);
  return syncAssignedPlayerPhotos(
    session,
    observerSlots.baseUrl,
    observerSlots.slots,
  );
}

function requestPlayerPhotoCacheRefresh(matchId) {
  const requestedMatchId = normalizeOptionalString(matchId);
  if (!requestedMatchId) {
    return;
  }

  const now = Date.now();
  if (playerPhotoCacheRefreshState.inFlight) {
    return;
  }
  if (
    playerPhotoCacheRefreshState.matchId === requestedMatchId &&
    now - playerPhotoCacheRefreshState.lastStartedAt <
      PLAYER_PHOTO_CACHE_REFRESH_INTERVAL_MS
  ) {
    return;
  }

  let session;
  try {
    session = getStoredSession();
  } catch {
    return;
  }

  playerPhotoCacheRefreshState.matchId = requestedMatchId;
  playerPhotoCacheRefreshState.lastStartedAt = now;
  playerPhotoCacheRefreshState.inFlight = true;

  refreshAssignedPlayerPhotoCache(session, requestedMatchId)
    .catch((error) => {
      logWarn("[launcher] player photo cache refresh failed", {
        matchId: requestedMatchId,
        error: error instanceof Error ? error.message : String(error || ""),
      });
    })
    .finally(() => {
      playerPhotoCacheRefreshState.inFlight = false;
    });
}

function schedulePlayerPhotoCacheRefresh(matchId, delayMs = 0) {
  const requestedMatchId = normalizeOptionalString(matchId);
  if (!requestedMatchId) {
    return;
  }

  const timer = setTimeout(
    () => requestPlayerPhotoCacheRefresh(requestedMatchId),
    Math.max(0, Number(delayMs) || 0),
  );
  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

function mergeObserverSlotsWithLocalLogos(slots, syncedSlots) {
  const syncedBySlotNumber = new Map(
    (Array.isArray(syncedSlots) ? syncedSlots : [])
      .filter((slot) => Number.isFinite(slot?.slotNumber))
      .map((slot) => [slot.slotNumber, slot]),
  );

  return (Array.isArray(slots) ? slots : []).map(
    (slot) => syncedBySlotNumber.get(slot.slotNumber) || slot,
  );
}

function buildWidgetTeamLogoAssetUrl(localLogoPath) {
  const normalizedPath =
    typeof localLogoPath === "string" && localLogoPath.trim()
      ? localLogoPath.trim()
      : "";
  if (!normalizedPath) {
    return null;
  }

  const fileName = path.basename(normalizedPath);
  return fileName ? `/assets/teams/${encodeURIComponent(fileName)}` : null;
}

function buildWidgetTeamBrandingPayload(baseUrl, matchId, slots) {
  const teams = (Array.isArray(slots) ? slots : [])
    .map((slot) => {
      const team =
        slot?.team && typeof slot.team === "object" ? slot.team : null;
      const slotNumber = Number(
        slot?.slotNumber ?? slot?.teamNo ?? slot?.slot ?? 0,
      );
      const normalizedSlot =
        Number.isFinite(slotNumber) && slotNumber > 0
          ? Math.trunc(slotNumber)
          : null;
      const localLogoUrl = buildWidgetTeamLogoAssetUrl(slot?.localLogoPath);
      const remoteLogoUrl = resolveLogoUrl(
        baseUrl,
        team?.logoUrl ?? slot?.teamLogoUrl ?? slot?.logoUrl,
      );
      const logoUrl =
        slot?.usedPlaceholder === true
          ? remoteLogoUrl || localLogoUrl || "/assets/default-team.png"
          : localLogoUrl || remoteLogoUrl || "/assets/default-team.png";

      return {
        teamId: slot?.teamId
          ? String(slot.teamId)
          : team?.id
            ? String(team.id)
            : null,
        slot: normalizedSlot,
        teamName: team?.name
          ? String(team.name)
          : slot?.teamName
            ? String(slot.teamName)
            : null,
        teamTag: team?.tag
          ? String(team.tag)
          : slot?.teamTag
            ? String(slot.teamTag)
            : null,
        logoUrl,
        color:
          slot?.resolvedColor ||
          team?.accentLight ||
          team?.accentDark ||
          slot?.teamColor ||
          null,
      };
    })
    .filter(
      (team) =>
        team.teamId || team.slot !== null || team.teamName || team.teamTag,
    );

  return {
    matchId: matchId ? String(matchId) : null,
    teams,
    timestamp: Date.now(),
  };
}

function publishTeamBrandingToWidgetServer(payload) {
  if (!payload) {
    return null;
  }

  pendingWidgetTeamBranding = payload;
  if (!widgetServer || typeof widgetServer.setTeamBranding !== "function") {
    return null;
  }

  try {
    const normalized = widgetServer.setTeamBranding(payload);
    pendingWidgetTeamBranding = null;
    return normalized;
  } catch (error) {
    logWarn(
      "[widget-server] team branding publish failed",
      error && error.message ? error.message : error,
    );
    return null;
  }
}

async function syncTeams(session, matchId, options = {}) {
  ensureDir(TEAM_ASSETS_DIR);
  const placeholderPath = ensurePlaceholderLogo();
  const shouldSyncPlayerPhotos = options?.syncPlayerPhotos !== false;
  const baseObserverSlots = await fetchObserverSlots(session, matchId);
  const recoveredObserverSlots =
    options?.repairSlots === true
      ? await recoverObserverSlotsFromPreviousMatch(session, baseObserverSlots)
      : {
          observerSlots: baseObserverSlots,
          recovery: null,
        };
  const {
    baseUrl,
    matchId: normalizedMatchId,
    slots,
  } = recoveredObserverSlots.observerSlots;

  const syncedSlots = await syncAssignedObserverSlots(
    baseUrl,
    slots,
    placeholderPath,
  );
  const playerPhotoSync = shouldSyncPlayerPhotos
    ? await syncAssignedPlayerPhotos(session, baseUrl, syncedSlots)
    : null;

  const result = {
    ok: true,
    matchId: normalizedMatchId,
    baseUrl,
    matchSource: "selected",
    slotCount: slots.length,
    syncedCount: syncedSlots.length,
    teamAssetsDir: TEAM_ASSETS_DIR,
    playerAssetsDir: PLAYER_ASSETS_DIR,
    slots: syncedSlots,
    playerPhotoSync,
    playerPhotoSyncSkipped: !shouldSyncPlayerPhotos,
    slotRecovery: recoveredObserverSlots.recovery,
  };
  publishTeamBrandingToWidgetServer(
    buildWidgetTeamBrandingPayload(baseUrl, normalizedMatchId, syncedSlots),
  );
  return result;
}

async function generateBranding(session, matchId, options = {}) {
  const requestedMatchId = requireMatchId(matchId);
  ensureDir(TEAM_ASSETS_DIR);
  const placeholderPath = ensurePlaceholderLogo();
  const providedSlots = Array.isArray(options?.slots) ? options.slots : null;
  const observerSlots = providedSlots
    ? {
        baseUrl: normalizeBaseUrl(options?.baseUrl || session.apiBase),
        matchId: options?.matchId ? String(options.matchId) : requestedMatchId,
        slots: providedSlots,
      }
    : await fetchObserverSlots(session, requestedMatchId);
  const syncedAssignedSlots = providedSlots
    ? providedSlots
    : await syncAssignedObserverSlots(
        observerSlots.baseUrl,
        observerSlots.slots,
        placeholderPath,
      );
  const brandingSlots = providedSlots
    ? syncedAssignedSlots
    : mergeObserverSlotsWithLocalLogos(
        observerSlots.slots,
        syncedAssignedSlots,
      );
  const payload = await generateShadowBranding({
    matchId: observerSlots.matchId,
    slots: brandingSlots,
    teamAssetsDir: TEAM_ASSETS_DIR,
    brandingConfigPath: getBrandingConfigPath(),
    defaultLogoPath: placeholderPath,
    shadowLogoTemplatePath: resolveBundledShadowLogoTemplatePath(),
    logInfo: (message) => log(message),
    logWarn: (message) => logWarn(message),
  });
  const result = {
    ok: payload?.ok !== false,
    matchId: payload?.matchId ? String(payload.matchId) : requestedMatchId,
    matchSource: "selected",
    brandingConfigPath: payload?.brandingConfigPath
      ? String(payload.brandingConfigPath)
      : getBrandingConfigPath(),
    teamAssetsDir: payload?.teamAssetsDir
      ? String(payload.teamAssetsDir)
      : TEAM_ASSETS_DIR,
    teamCount: Number(payload?.teamCount ?? 0),
    slots: Array.isArray(payload?.slots) ? payload.slots : [],
    cacheHitCount: Number(payload?.cacheHitCount ?? 0),
    renderedCount: Number(payload?.renderedCount ?? 0),
    cachePath: payload?.cachePath ? String(payload.cachePath) : null,
    reusedSyncedSlots: Boolean(providedSlots),
  };
  publishTeamBrandingToWidgetServer(
    buildWidgetTeamBrandingPayload(
      observerSlots.baseUrl,
      result.matchId,
      result.slots,
    ),
  );
  return result;
}

async function pinSelectedMatchLive(session, matchId, sessionId, options = {}) {
  const requestedMatchId = requireMatchId(matchId);
  const lifecycle = await assertMatchLifecycleStartable(
    session,
    requestedMatchId,
    options,
  );
  await assertNoDifferentLiveMatch(session, requestedMatchId, options);
  const boundSessionId = String(
    lifecycle?.control?.binding?.sessionId ||
      lifecycle?.control?.pcobSessionId ||
      "",
  ).trim();
  if (
    lifecycle?.lifecycleStatus === "LIVE" &&
    boundSessionId &&
    boundSessionId === String(sessionId || "").trim()
  ) {
    return requestedMatchId;
  }
  await apiClient.startMatchControl({
    apiBase: session.apiBase,
    token: session.token,
    refreshToken: session.refreshToken,
    matchId: requestedMatchId,
    sessionId,
    source: "desktop-launcher",
    clientId: getLauncherClientId(),
    requestedMatchId,
    signal: options?.signal,
  });
  return requestedMatchId;
}

async function createObserverFeedToken(session, options = {}) {
  const payload =
    (await apiClient.createObserverFeedToken({
      apiBase: session.apiBase,
      token: session.token,
      refreshToken: session.refreshToken,
      signal: options?.signal,
    })) ?? {};
  const accessToken =
    typeof payload?.accessToken === "string" && payload.accessToken.trim()
      ? payload.accessToken.trim()
      : "";

  if (!accessToken) {
    throw new Error("Backend did not return an observer feed token.");
  }

  return {
    accessToken,
    expiresIn:
      typeof payload?.expiresIn === "string" && payload.expiresIn.trim()
        ? payload.expiresIn.trim()
        : null,
  };
}

function readWherePaths(binaryName) {
  try {
    const where = resolveTrustedWindowsCommand("where");
    const result = spawnSync(where.executablePath, [binaryName], {
      encoding: "utf8",
      env: where.env,
      windowsHide: true,
      timeout: 3_000,
    });
    if (result.status !== 0) return [];
    return String(result.stdout || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function uniquePaths(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeMatchLifecycleStatus(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "DRAFT") {
    return "READY";
  }
  return normalized;
}

async function fetchMatchControlState(session, matchId, options = {}) {
  const control = await apiClient.getMatchControl({
    apiBase: session.apiBase,
    token: session.token,
    refreshToken: session.refreshToken,
    matchId,
    signal: options?.signal,
  });

  return {
    control,
    lifecycleStatus: normalizeMatchLifecycleStatus(
      control?.matchStatus || control?.status,
    ),
  };
}

function getLauncherClientId() {
  return `${os.hostname() || "unknown-host"}:${process.pid}`;
}

async function assertNoDifferentLiveMatch(session, matchId, options = {}) {
  const requestedMatchId = requireMatchId(matchId);
  const liveMatch = await fetchAuthenticatedLiveMatch(
    normalizeBaseUrl(session.apiBase),
    session,
    options,
  );
  const liveMatchId = String(liveMatch?.matchId || "").trim();
  if (!liveMatchId || liveMatchId === requestedMatchId) {
    return;
  }

  const liveStatus = normalizeMatchLifecycleStatus(liveMatch?.status);
  if (liveStatus && liveStatus !== "LIVE" && liveStatus !== "PAUSED") {
    return;
  }

  throw new Error(
    `Cannot start telemetry for match ${requestedMatchId}: match ${liveMatchId} is already LIVE. End or reset the existing live match first.`,
  );
}

async function assertMatchLifecycleStartable(session, matchId, options = {}) {
  const { control, lifecycleStatus } = await fetchMatchControlState(
    session,
    matchId,
    options,
  );

  if (lifecycleStatus === "FINISHED") {
    logWarn("[Telemetry] Cannot start, match is FINISHED", {
      matchId,
    });
    throw new Error("Cannot start telemetry: match is FINISHED.");
  }
  if (
    control?.isFinalizing === true ||
    lifecycleStatus === "FINISH_PENDING" ||
    lifecycleStatus === "ENDED"
  ) {
    throw new Error("Cannot start telemetry while the match is finalizing.");
  }
  return { control, lifecycleStatus };
}

async function assertVisualRosterMappingAllowed(session, matchId) {
  const { control, lifecycleStatus } = await fetchMatchControlState(
    session,
    matchId,
  );
  if (control?.isFinalizing === true || lifecycleStatus === "FINISHED") {
    throw new Error(
      "Roster mapping is unavailable after result finalization starts.",
    );
  }
  if (lifecycleStatus !== "READY" && lifecycleStatus !== "COUNTDOWN") {
    throw new Error(
      "Map slot/player names during READY or COUNTDOWN, before the match is LIVE.",
    );
  }
  return { control, lifecycleStatus };
}

function assertProductionModeReadyForMatch(matchId) {
  const requestedMatchId = requireMatchId(matchId);
  if (
    productionModeState.matchId === requestedMatchId &&
    isProductionReadyStatus(productionModeState.status)
  ) {
    return;
  }

  logWarn("[Production] Telemetry start refused: production mode not ready", {
    matchId: requestedMatchId,
    status: productionModeState.status,
    workflowState: matchFlowState.workflowState,
  });
  throw new Error(
    "Telemetry start is blocked until Production Mode completes with READY or READY_WITH_WARNINGS for the selected match.",
  );
}

function isExistingFile(filePath) {
  if (!filePath) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function parseJsonValue(value) {
  try {
    return JSON.parse(String(value || "").trim());
  } catch {
    return null;
  }
}

function normalizeProcessEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const executablePath = String(
    entry.ExecutablePath || entry.executablePath || entry.Path || "",
  ).trim();
  if (!isExistingFile(executablePath)) {
    return null;
  }

  const pid = Number(
    entry.ProcessId ?? entry.processId ?? entry.PID ?? entry.pid,
  );
  return {
    pid: Number.isFinite(pid) && pid > 0 ? Math.trunc(pid) : null,
    executablePath,
  };
}

function readRunningShadowTrackerProcessesFromPowerShell() {
  if (process.platform !== "win32") {
    return [];
  }

  const script = [
    "$items = Get-CimInstance Win32_Process -Filter \"Name='ShadowTrackerExtra.exe'\" |",
    "Select-Object ProcessId,ExecutablePath,CommandLine;",
    "if ($null -eq $items) { '[]' } else { $items | ConvertTo-Json -Compress }",
  ].join(" ");
  let powerShell;
  try {
    powerShell = resolveTrustedWindowsCommand("powershell");
  } catch {
    return [];
  }
  const result = spawnSync(
    powerShell.executablePath,
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: powerShell.env,
      windowsHide: true,
      timeout: 3_000,
    },
  );

  if (result.status !== 0 || !String(result.stdout || "").trim()) {
    return [];
  }

  const parsed = parseJsonValue(result.stdout);
  const entries = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return entries.map(normalizeProcessEntry).filter(Boolean);
}

function readRunningShadowTrackerProcessesFromWmic() {
  if (process.platform !== "win32") {
    return [];
  }

  let wmic;
  try {
    wmic = resolveTrustedWindowsCommand("wmic");
  } catch {
    return [];
  }
  const result = spawnSync(
    wmic.executablePath,
    [
      "process",
      "where",
      `name='${SHADOWTRACKER_PROCESS_NAME}'`,
      "get",
      "ExecutablePath,ProcessId",
      "/format:csv",
    ],
    {
      encoding: "utf8",
      env: wmic.env,
      windowsHide: true,
      timeout: 3_000,
    },
  );

  if (result.status !== 0 || !String(result.stdout || "").trim()) {
    return [];
  }

  const entries = [];
  for (const rawLine of String(result.stdout || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^node,/i.test(line)) {
      continue;
    }

    const parts = line.split(",");
    if (parts.length < 3) {
      continue;
    }

    const processId = parts[parts.length - 1];
    const executablePath = parts.slice(1, -1).join(",").trim();
    const entry = normalizeProcessEntry({
      ExecutablePath: executablePath,
      ProcessId: processId,
    });
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function getRunningShadowTrackerProcesses(options = {}) {
  const now = Date.now();
  if (
    options.preferCache === true &&
    shadowTrackerProcessDiscoveryCache.entries.length > 0 &&
    shadowTrackerProcessDiscoveryCache.entries.every((entry) => {
      if (!Number.isInteger(entry?.pid) || entry.pid <= 0) {
        return false;
      }
      try {
        process.kill(entry.pid, 0);
        return true;
      } catch {
        return false;
      }
    })
  ) {
    return [...shadowTrackerProcessDiscoveryCache.entries];
  }
  if (shadowTrackerProcessDiscoverySingleFlight.isRunning()) {
    return [...shadowTrackerProcessDiscoveryCache.entries];
  }
  if (
    options.force !== true &&
    now - shadowTrackerProcessDiscoveryCache.checkedAt <
      SHADOWTRACKER_PROCESS_DISCOVERY_CACHE_MS
  ) {
    return [...shadowTrackerProcessDiscoveryCache.entries];
  }

  const powerShellEntries = readRunningShadowTrackerProcessesFromPowerShell();
  const entries = [
    ...powerShellEntries,
    ...(powerShellEntries.length > 0
      ? []
      : readRunningShadowTrackerProcessesFromWmic()),
  ];
  const seen = new Set();
  const uniqueEntries = [];
  for (const entry of entries) {
    const key = normalizeComparablePath(entry.executablePath);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueEntries.push(entry);
  }

  shadowTrackerProcessDiscoveryCache = {
    checkedAt: now,
    entries: uniqueEntries,
  };
  return [...uniqueEntries];
}

async function getRunningShadowTrackerProcessesAsync(options = {}) {
  const now = Date.now();
  if (
    options.force !== true &&
    now - shadowTrackerProcessDiscoveryCache.checkedAt <
      SHADOWTRACKER_PROCESS_DISCOVERY_CACHE_MS
  ) {
    return [...shadowTrackerProcessDiscoveryCache.entries];
  }

  return shadowTrackerProcessDiscoverySingleFlight.run(async () => {
    const refreshedAt = Date.now();
    if (
      options.force !== true &&
      refreshedAt - shadowTrackerProcessDiscoveryCache.checkedAt <
        SHADOWTRACKER_PROCESS_DISCOVERY_CACHE_MS
    ) {
      return [...shadowTrackerProcessDiscoveryCache.entries];
    }

    let entries = [];
    try {
      entries = await discoverRunningShadowTrackerProcesses({
        platform: process.platform,
        processName: SHADOWTRACKER_PROCESS_NAME,
        isExecutableFile: isExistingFile,
      });
    } catch {
      entries = [];
    }
    shadowTrackerProcessDiscoveryCache = {
      checkedAt: Date.now(),
      entries,
    };
    return [...entries];
  });
}

function getRunningShadowTrackerExecutableCandidates(options = {}) {
  return getRunningShadowTrackerProcesses(options).map(
    (entry) => entry.executablePath,
  );
}

function fileHash(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function getOptionalFileHash(filePath) {
  if (!isExistingFile(filePath)) {
    return "";
  }

  try {
    return fileHash(filePath);
  } catch {
    return "";
  }
}

function sanitizeTimestampForFilename(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, "-");
}

function createConnectorSetupStatus(patch = {}) {
  return {
    ok: patch.ok === true,
    status:
      typeof patch.status === "string" && patch.status.trim()
        ? patch.status.trim()
        : patch.ok === true
          ? "ready"
          : "unknown",
    sourcePath: patch.sourcePath || null,
    targetPath: patch.targetPath || null,
    targetStrategy: patch.targetStrategy || null,
    targetExisting: patch.targetExisting === true,
    shadowTrackerPath: patch.shadowTrackerPath || null,
    manifestPath: patch.manifestPath || null,
    backupPath: patch.backupPath || null,
    sourceHash: patch.sourceHash || null,
    targetHash: patch.targetHash || null,
    supportFiles: Array.isArray(patch.supportFiles)
      ? patch.supportFiles.map((supportFile) => ({
          fileName: supportFile.fileName || null,
          sourcePath: supportFile.sourcePath || null,
          sourceHash: supportFile.sourceHash || null,
          targetPath: supportFile.targetPath || null,
        }))
      : [],
    installed: patch.installed === true,
    repaired: patch.repaired === true,
    upToDate: patch.upToDate === true,
    requiresAdmin: patch.requiresAdmin === true,
    error:
      typeof patch.error === "string" && patch.error.trim()
        ? patch.error.trim()
        : null,
    checkedAt:
      typeof patch.checkedAt === "string" && patch.checkedAt.trim()
        ? patch.checkedAt.trim()
        : new Date().toISOString(),
  };
}

function setConnectorSetupStatus(patch = {}) {
  lastConnectorSetupStatus = createConnectorSetupStatus(patch);
  return lastConnectorSetupStatus;
}

function getConnectorSetupStatusView() {
  return (
    lastConnectorSetupStatus ||
    createConnectorSetupStatus({
      ok: false,
      status: "unknown",
      error: "Arenzyra OB connector has not been checked yet.",
    })
  );
}

function getManagedTelemetryBridgeSourcePath() {
  const packagedSourcePath = app.isPackaged
    ? path.join(
        process.resourcesPath,
        CONNECTOR_RESOURCE_DIR_NAME,
        CONNECTOR_SCRIPT_NAME,
      )
    : "";

  return app.isPackaged
    ? findExistingFile([packagedSourcePath])
    : findExistingFile([REPO_TELEMETRY_BRIDGE_SCRIPT]);
}

function getManagedTelemetryBridgeSupportResources() {
  const packagedSourceDir = app.isPackaged
    ? path.join(process.resourcesPath, CONNECTOR_RESOURCE_DIR_NAME)
    : "";
  const repoSourceDir = path.join(REPO_ROOT, "apps", "desktop", "electron");

  return CONNECTOR_SUPPORT_FILE_NAMES.map((fileName) => ({
    fileName,
    sourcePath: app.isPackaged
      ? findExistingFile([
          packagedSourceDir ? path.join(packagedSourceDir, fileName) : "",
        ])
      : findExistingFile([path.join(repoSourceDir, fileName)]),
  }));
}

function getManagedTelemetryBridgeSupportTargetPath(targetPath, fileName) {
  return path.join(path.dirname(targetPath), fileName);
}

function createConnectorManifestPayload({
  sourceHash,
  sourcePath,
  targetPath,
  shadowTrackerPath,
  supportFiles = [],
}) {
  return `${JSON.stringify(
    {
      name: "arenzyra-ob-connector",
      script: CONNECTOR_SCRIPT_NAME,
      sourceHash,
      sourcePath,
      targetPath,
      shadowTrackerPath,
      supportFiles: supportFiles.map((supportFile) => ({
        fileName: supportFile.fileName,
        sourceHash: supportFile.sourceHash || null,
        targetPath: supportFile.targetPath || null,
      })),
      installedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`;
}

function isConnectorPermissionError(error) {
  const code =
    error && typeof error === "object" ? String(error.code || "") : "";
  return process.platform === "win32" && ["EACCES", "EPERM"].includes(code);
}

let cachedConnectorProcessIntegrity = null;

function getConnectorProcessIntegrity() {
  if (!cachedConnectorProcessIntegrity) {
    cachedConnectorProcessIntegrity = inspectWindowsProcessIntegrity();
  }
  return cachedConnectorProcessIntegrity;
}

function assertManagedConnectorInstallPlan({
  sourcePath,
  targetPath,
  shadowTrackerPath,
  supportFiles = [],
  backupPath = "",
}) {
  const manifestPath = path.join(
    path.dirname(targetPath),
    CONNECTOR_MANIFEST_NAME,
  );
  assertConnectorInstallPlan({
    sourceFiles: [
      sourcePath,
      ...supportFiles.map((supportFile) => supportFile.sourcePath),
    ],
    targetFiles: [
      targetPath,
      manifestPath,
      ...(backupPath ? [backupPath] : []),
      ...supportFiles.map((supportFile) =>
        getManagedTelemetryBridgeSupportTargetPath(
          targetPath,
          supportFile.fileName,
        ),
      ),
    ],
    allowedTargetRoots:
      getShadowTrackerInstallRootCandidates(shadowTrackerPath),
    shadowTrackerPath,
  });
}

function assertManagedConnectorInstalledHashes({
  targetPath,
  sourceHash,
  supportFiles = [],
}) {
  readVerifiedRegularFile(targetPath, {
    expectedSha256: sourceHash,
    label: "Installed connector script",
  });
  for (const supportFile of supportFiles) {
    readVerifiedRegularFile(supportFile.targetPath, {
      expectedSha256: supportFile.sourceHash,
      label: `Installed connector support: ${supportFile.fileName}`,
    });
  }
}

function copyManagedTelemetryBridge({
  sourcePath,
  targetPath,
  shadowTrackerPath,
  sourceHash,
  existingTargetHash,
  supportFiles = [],
}) {
  const manifestPath = path.join(
    path.dirname(targetPath),
    CONNECTOR_MANIFEST_NAME,
  );
  const manifestPayload = createConnectorManifestPayload({
    sourceHash,
    sourcePath,
    targetPath,
    shadowTrackerPath,
    supportFiles,
  });
  const backupPath = existingTargetHash
    ? path.join(
        path.dirname(targetPath),
        `${CONNECTOR_BACKUP_PREFIX}-${sanitizeTimestampForFilename()}.js`,
      )
    : "";

  assertManagedConnectorInstallPlan({
    sourcePath,
    targetPath,
    shadowTrackerPath,
    supportFiles,
    backupPath,
  });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  // Validate again after directory creation so a pre-existing junction or a
  // concurrently substituted target fails before any connector bytes move.
  // Permission failures remain visible; this path never crosses a UAC boundary.
  assertManagedConnectorInstallPlan({
    sourcePath,
    targetPath,
    shadowTrackerPath,
    supportFiles,
    backupPath,
  });
  const sourceData = readVerifiedRegularFile(sourcePath, {
    expectedSha256: sourceHash,
    label: "Bundled connector source",
  }).data;
  const replacements = [];
  if (backupPath) {
    const backupData = readVerifiedRegularFile(targetPath, {
      expectedSha256: existingTargetHash,
      label: "Existing connector backup source",
    }).data;
    replacements.push({
      targetPath: backupPath,
      data: backupData,
      sha256: existingTargetHash,
    });
  }
  replacements.push({ targetPath, data: sourceData, sha256: sourceHash });
  for (const supportFile of supportFiles) {
    const supportData = readVerifiedRegularFile(supportFile.sourcePath, {
      expectedSha256: supportFile.sourceHash,
      label: `Bundled connector support: ${supportFile.fileName}`,
    }).data;
    replacements.push({
      targetPath: supportFile.targetPath,
      data: supportData,
      sha256: supportFile.sourceHash,
    });
  }
  replacements.push({
    targetPath: manifestPath,
    data: Buffer.from(manifestPayload, "utf8"),
  });
  atomicReplaceVerifiedFiles({
    directoryPath: path.dirname(targetPath),
    replacements,
    validateDirectory: (context) => {
      assertManagedConnectorInstallPlan({
        sourcePath,
        targetPath,
        shadowTrackerPath,
        supportFiles,
        backupPath,
      });
      if (
        context?.targetPath === manifestPath &&
        ["before-replace", "after-replace"].includes(context?.phase)
      ) {
        assertManagedConnectorInstalledHashes({
          targetPath,
          sourceHash,
          supportFiles,
        });
      }
    },
  });
  return {
    targetHash: readVerifiedRegularFile(targetPath, {
      expectedSha256: sourceHash,
      label: "Installed connector script",
    }).sha256,
    backupPath: backupPath || null,
    manifestPath,
  };
}

function ensureManagedTelemetryBridgeInstalled(options = {}) {
  const checkedAt = new Date().toISOString();
  const processIntegrity = getConnectorProcessIntegrity();
  if (processIntegrity !== "standard") {
    return setConnectorSetupStatus({
      ok: false,
      status:
        processIntegrity === "elevated"
          ? "elevated-launcher-refused"
          : "integrity-check-failed",
      requiresAdmin: false,
      error:
        processIntegrity === "elevated"
          ? "Connector repair is disabled while the launcher is elevated. Restart Arenzyra normally so mutable PCOB files are never copied or executed at high integrity."
          : "Connector repair was blocked because the launcher integrity level could not be verified.",
      checkedAt,
    });
  }
  const sourcePath = getManagedTelemetryBridgeSourcePath();
  const supportResources = getManagedTelemetryBridgeSupportResources();
  const requestedShadowTrackerPath =
    options?.shadowTrackerPath || configManager.getShadowTrackerPath();
  const shadowTrackerPath = resolveShadowTrackerExecutable(
    requestedShadowTrackerPath,
    { preferRunning: true },
  );
  if (shadowTrackerPath) {
    persistDetectedShadowTrackerPath(shadowTrackerPath, "connector");
  }

  if (!sourcePath) {
    return setConnectorSetupStatus({
      ok: false,
      status: "missing-source",
      shadowTrackerPath:
        shadowTrackerPath || requestedShadowTrackerPath || null,
      error:
        "Bundled Arenzyra ob.js connector was not found in the launcher resources.",
      checkedAt,
    });
  }

  const missingSupportResource = supportResources.find(
    (supportResource) => !supportResource.sourcePath,
  );
  if (missingSupportResource) {
    return setConnectorSetupStatus({
      ok: false,
      status: "missing-support-source",
      sourcePath,
      shadowTrackerPath:
        shadowTrackerPath || requestedShadowTrackerPath || null,
      error: `Bundled connector support file was not found: ${missingSupportResource.fileName}.`,
      checkedAt,
    });
  }

  let sourceHash = "";
  try {
    sourceHash = fileHash(sourcePath);
  } catch (error) {
    return setConnectorSetupStatus({
      ok: false,
      status: "source-unreadable",
      sourcePath,
      shadowTrackerPath:
        shadowTrackerPath || requestedShadowTrackerPath || null,
      error:
        error instanceof Error
          ? error.message
          : "Bundled Arenzyra ob.js connector could not be read.",
      checkedAt,
    });
  }

  const supportFiles = [];
  try {
    for (const supportResource of supportResources) {
      supportFiles.push({
        fileName: supportResource.fileName,
        sourcePath: supportResource.sourcePath,
        sourceHash: fileHash(supportResource.sourcePath),
      });
    }
  } catch (error) {
    return setConnectorSetupStatus({
      ok: false,
      status: "support-source-unreadable",
      sourcePath,
      sourceHash,
      shadowTrackerPath:
        shadowTrackerPath || requestedShadowTrackerPath || null,
      error:
        error instanceof Error
          ? error.message
          : "Bundled connector support files could not be read.",
      checkedAt,
    });
  }

  if (!shadowTrackerPath) {
    return setConnectorSetupStatus({
      ok: false,
      status: "missing-shadowtracker",
      sourcePath,
      sourceHash,
      shadowTrackerPath: requestedShadowTrackerPath || null,
      error:
        "ShadowTrackerExtra.exe was not found. Select the Win64 executable so Arenzyra can install the connector.",
      checkedAt,
    });
  }

  const targetResolution =
    resolveTelemetryBridgeTargetFromShadowTrackerPath(shadowTrackerPath);
  const targetPath = targetResolution?.targetPath || "";
  if (!targetPath) {
    return setConnectorSetupStatus({
      ok: false,
      status: "invalid-shadowtracker",
      sourcePath,
      sourceHash,
      shadowTrackerPath,
      error:
        "ShadowTrackerExtra.exe path is invalid. Select the Win64 executable.",
      checkedAt,
    });
  }

  for (const supportFile of supportFiles) {
    supportFile.targetPath = getManagedTelemetryBridgeSupportTargetPath(
      targetPath,
      supportFile.fileName,
    );
  }
  try {
    assertManagedConnectorInstallPlan({
      sourcePath,
      targetPath,
      shadowTrackerPath,
      supportFiles,
    });
  } catch (error) {
    return setConnectorSetupStatus({
      ok: false,
      status: "unsafe-install-path",
      sourcePath,
      targetPath,
      targetStrategy: targetResolution?.strategy || null,
      targetExisting: targetResolution?.targetExisting === true,
      shadowTrackerPath,
      sourceHash,
      error:
        error instanceof Error
          ? error.message
          : "Connector install path failed security validation.",
      checkedAt,
    });
  }

  const existingTargetHash = getOptionalFileHash(targetPath);
  const manifestPath = path.join(
    path.dirname(targetPath),
    CONNECTOR_MANIFEST_NAME,
  );
  const supportFilesReady = supportFiles.every((supportFile) => {
    return (
      getOptionalFileHash(supportFile.targetPath) === supportFile.sourceHash
    );
  });

  if (existingTargetHash === sourceHash && supportFilesReady) {
    try {
      const manifestPayload = createConnectorManifestPayload({
        sourceHash,
        sourcePath,
        targetPath,
        shadowTrackerPath,
        supportFiles,
      });
      atomicReplaceVerifiedFiles({
        directoryPath: path.dirname(targetPath),
        replacements: [
          {
            targetPath: manifestPath,
            data: Buffer.from(manifestPayload, "utf8"),
          },
        ],
        validateDirectory: () => {
          assertManagedConnectorInstallPlan({
            sourcePath,
            targetPath,
            shadowTrackerPath,
            supportFiles,
          });
          assertManagedConnectorInstalledHashes({
            targetPath,
            sourceHash,
            supportFiles,
          });
        },
      });
    } catch (error) {
      return setConnectorSetupStatus({
        ok: false,
        status: "manifest-write-failed",
        sourcePath,
        targetPath,
        targetStrategy: targetResolution?.strategy || null,
        targetExisting: targetResolution?.targetExisting === true,
        shadowTrackerPath,
        manifestPath,
        sourceHash,
        targetHash: existingTargetHash,
        supportFiles,
        error:
          error instanceof Error
            ? error.message
            : "Connector manifest could not be written.",
        checkedAt,
      });
    }
    telemetryBridgeScriptPath = sourcePath;
    return setConnectorSetupStatus({
      ok: true,
      status: "ready",
      sourcePath,
      targetPath,
      targetStrategy: targetResolution?.strategy || null,
      targetExisting: targetResolution?.targetExisting === true,
      shadowTrackerPath,
      manifestPath,
      sourceHash,
      targetHash: existingTargetHash,
      supportFiles,
      upToDate: true,
      checkedAt,
    });
  }

  try {
    const copyResult = copyManagedTelemetryBridge({
      sourcePath,
      targetPath,
      shadowTrackerPath,
      sourceHash,
      existingTargetHash,
      supportFiles,
    });

    if (copyResult.targetHash !== sourceHash) {
      throw new Error("Connector hash verification failed after install.");
    }

    telemetryBridgeScriptPath = sourcePath;
    return setConnectorSetupStatus({
      ok: true,
      status: "installed",
      sourcePath,
      targetPath,
      targetStrategy: targetResolution?.strategy || null,
      targetExisting: targetResolution?.targetExisting === true,
      shadowTrackerPath,
      manifestPath: copyResult.manifestPath,
      backupPath: copyResult.backupPath,
      sourceHash,
      targetHash: copyResult.targetHash,
      supportFiles,
      installed: true,
      repaired: Boolean(existingTargetHash),
      checkedAt,
    });
  } catch (error) {
    const permissionDenied = isConnectorPermissionError(error);
    return setConnectorSetupStatus({
      ok: false,
      status: permissionDenied ? "permission-denied" : "install-failed",
      sourcePath,
      targetPath,
      targetStrategy: targetResolution?.strategy || null,
      targetExisting: targetResolution?.targetExisting === true,
      shadowTrackerPath,
      manifestPath,
      sourceHash,
      targetHash: existingTargetHash || null,
      requiresAdmin: false,
      error: permissionDenied
        ? "Connector repair cannot write the selected PCOB folder. Arenzyra will not elevate mutable connector files; use an operator-writable PCOB install or have an administrator deploy the verified files separately."
        : error instanceof Error
          ? error.message
          : "Arenzyra connector install failed.",
      checkedAt,
    });
  }
}

function normalizeComparablePath(targetPath) {
  const normalized = String(targetPath || "").trim();
  if (!normalized) {
    return "";
  }

  const resolved = path.resolve(normalized);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function getBundledTelemetryBridgeScriptPath() {
  if (!app.isPackaged) {
    return "";
  }

  return path.join(path.dirname(process.execPath), "ob.js");
}

function isBundledTelemetryBridgeScriptPath(targetPath) {
  const normalizedTargetPath = normalizeComparablePath(targetPath);
  const bundledScriptPath = normalizeComparablePath(
    getBundledTelemetryBridgeScriptPath(),
  );
  return (
    Boolean(normalizedTargetPath && bundledScriptPath) &&
    normalizedTargetPath === bundledScriptPath
  );
}

function isShadowTrackerExecutablePath(executablePath) {
  const normalizedExecutablePath = String(executablePath || "").trim();
  if (!normalizedExecutablePath) {
    return false;
  }

  const executableName = path.basename(normalizedExecutablePath).toLowerCase();
  return executableName === "shadowtrackerextra.exe";
}

function isFilesystemRoot(dirPath) {
  const resolved = path.resolve(String(dirPath || ""));
  return resolved === path.parse(resolved).root;
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function isExistingDirectory(targetPath) {
  const stat = safeStat(targetPath);
  return Boolean(stat && stat.isDirectory());
}

function safeReadDirectory(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function getAncestorDirectories(startDir, maxDepth = 8) {
  const directories = [];
  let current = path.resolve(String(startDir || ""));

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (!current || isFilesystemRoot(current)) {
      break;
    }
    directories.push(current);
    const parent = path.dirname(current);
    if (!parent || parent === current) {
      break;
    }
    current = parent;
  }

  return uniquePaths(directories);
}

function hasChildEntryNamed(dirPath, names) {
  const expected = new Set(
    names
      .map((name) =>
        String(name || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  if (expected.size === 0) {
    return false;
  }

  for (const entry of safeReadDirectory(dirPath)) {
    if (expected.has(String(entry.name || "").toLowerCase())) {
      return true;
    }
  }

  return false;
}

function looksLikeShadowTrackerInstallRoot(dirPath) {
  if (!isExistingDirectory(dirPath)) {
    return false;
  }

  return hasChildEntryNamed(dirPath, [
    "ShadowTrackerExtra.exe",
    "ShadowTrackerExtra",
    "shadowTrackerExtra",
    "WindowsNoEditor",
    "ObToolsNew",
    "Engine",
    "rail_files",
    "TCLS",
    "WeGameLauncher",
  ]);
}

function resolveLegacyTelemetryRootFromShadowTrackerPath(executablePath) {
  if (!isShadowTrackerExecutablePath(executablePath)) {
    return "";
  }

  const executableDir = path.dirname(path.resolve(executablePath));
  const segments = executableDir
    .split(/[\\/]+/)
    .map((segment) => segment.toLowerCase());
  const hasGlobalLayout =
    segments.includes("windowsnoeditor") &&
    segments.includes("shadowtrackerextra") &&
    segments.includes("binaries") &&
    segments.includes("win64");
  if (!hasGlobalLayout) {
    return "";
  }

  const root = path.resolve(executableDir, "..", "..", "..", "..");
  return isFilesystemRoot(root) ? "" : root;
}

function getShadowTrackerInstallRootCandidates(executablePath) {
  if (!isShadowTrackerExecutablePath(executablePath)) {
    return [];
  }

  const executableDir = path.dirname(path.resolve(executablePath));
  const legacyRoot =
    resolveLegacyTelemetryRootFromShadowTrackerPath(executablePath);
  const ancestors = getAncestorDirectories(executableDir, 8);
  const candidates = [
    legacyRoot,
    executableDir,
    ...ancestors.filter(looksLikeShadowTrackerInstallRoot),
  ];

  return uniquePaths(
    candidates.filter((candidate) => {
      return (
        candidate &&
        !isFilesystemRoot(candidate) &&
        isExistingDirectory(candidate)
      );
    }),
  );
}

function pushTelemetryBridgeTarget(
  targets,
  seen,
  targetPath,
  strategy,
  options = {},
) {
  const normalizedTargetPath = String(targetPath || "").trim();
  if (!normalizedTargetPath) {
    return;
  }

  const key = normalizeComparablePath(normalizedTargetPath);
  if (!key || seen.has(key)) {
    return;
  }

  seen.add(key);
  targets.push({
    targetPath: normalizedTargetPath,
    strategy,
    createAllowed: options.createAllowed !== false,
  });
}

function addTelemetryBridgeTargetsForRoot(
  targets,
  seen,
  rootDir,
  strategyPrefix,
) {
  if (!rootDir || !isExistingDirectory(rootDir) || isFilesystemRoot(rootDir)) {
    return;
  }

  pushTelemetryBridgeTarget(
    targets,
    seen,
    path.join(rootDir, "ObToolsNew", "ob.js"),
    `${strategyPrefix}:obtoolsnew`,
  );
  pushTelemetryBridgeTarget(
    targets,
    seen,
    path.join(rootDir, "ObTools", "ob.js"),
    `${strategyPrefix}:obtools`,
  );
  pushTelemetryBridgeTarget(
    targets,
    seen,
    path.join(rootDir, "ob.js"),
    `${strategyPrefix}:root-ob`,
    { createAllowed: false },
  );

  for (const entry of safeReadDirectory(rootDir)) {
    if (!entry.isDirectory()) {
      continue;
    }

    const lowerName = String(entry.name || "").toLowerCase();
    const childDir = path.join(rootDir, entry.name);
    if (
      lowerName === "shadowtrackerextra" ||
      lowerName.includes("obtools") ||
      lowerName === "obtools" ||
      lowerName === "obtoolsnew"
    ) {
      pushTelemetryBridgeTarget(
        targets,
        seen,
        path.join(childDir, "ob.js"),
        `${strategyPrefix}:child:${entry.name}`,
        { createAllowed: lowerName.includes("obtools") },
      );
      pushTelemetryBridgeTarget(
        targets,
        seen,
        path.join(childDir, "ObToolsNew", "ob.js"),
        `${strategyPrefix}:child-obtoolsnew:${entry.name}`,
      );
    }
  }
}

function getTelemetryBridgeTargetCandidatesFromShadowTrackerPath(
  executablePath,
) {
  if (!isShadowTrackerExecutablePath(executablePath)) {
    return [];
  }

  const targets = [];
  const seen = new Set();
  const legacyRoot =
    resolveLegacyTelemetryRootFromShadowTrackerPath(executablePath);
  if (legacyRoot) {
    addTelemetryBridgeTargetsForRoot(
      targets,
      seen,
      legacyRoot,
      "legacy-global",
    );
  }

  for (const rootDir of getShadowTrackerInstallRootCandidates(executablePath)) {
    addTelemetryBridgeTargetsForRoot(targets, seen, rootDir, "detected-root");
  }

  return targets;
}

function resolveTelemetryBridgeTargetFromShadowTrackerPath(executablePath) {
  const targets =
    getTelemetryBridgeTargetCandidatesFromShadowTrackerPath(executablePath);
  if (targets.length === 0) {
    return null;
  }

  const existingTarget = targets.find((target) => {
    return (
      isSupportedTelemetryBridgeScriptPath(target.targetPath) ||
      (isExistingFile(target.targetPath) &&
        !isBundledTelemetryBridgeScriptPath(target.targetPath))
    );
  });
  if (existingTarget) {
    return {
      ...existingTarget,
      targetExisting: true,
    };
  }

  const existingDirectoryTarget = targets.find((target) => {
    return (
      target.createAllowed !== false &&
      isExistingDirectory(path.dirname(target.targetPath))
    );
  });
  if (existingDirectoryTarget) {
    return {
      ...existingDirectoryTarget,
      targetExisting: false,
    };
  }

  const createTarget =
    targets.find((target) => target.createAllowed !== false) || targets[0];
  return {
    ...createTarget,
    targetExisting: false,
  };
}

function resolveTelemetryBridgeScriptFromShadowTrackerPath(executablePath) {
  const target =
    resolveTelemetryBridgeTargetFromShadowTrackerPath(executablePath);
  return target?.targetPath || "";
}

function isSupportedTelemetryBridgeScriptPath(scriptPath) {
  const normalizedScriptPath = String(scriptPath || "").trim();
  if (!normalizedScriptPath || !fs.existsSync(normalizedScriptPath)) {
    return false;
  }

  if (isBundledTelemetryBridgeScriptPath(normalizedScriptPath)) {
    return false;
  }

  return true;
}

function findExistingFile(candidates) {
  for (const candidate of candidates) {
    if (isExistingFile(candidate)) {
      return candidate;
    }
  }
  return "";
}

function getShadowTrackerInputCandidates(inputPath) {
  const normalized = String(inputPath || "").trim();
  if (!normalized) {
    return [];
  }

  return uniquePaths([
    normalized,
    `${normalized}.exe`,
    path.join(normalized, "ShadowTrackerExtra.exe"),
    path.join(normalized, "Binaries", "Win64", "ShadowTrackerExtra.exe"),
    path.join(
      normalized,
      "ShadowTrackerExtra",
      "Binaries",
      "Win64",
      "ShadowTrackerExtra.exe",
    ),
    path.join(
      normalized,
      "WindowsNoEditor",
      "ShadowTrackerExtra",
      "Binaries",
      "Win64",
      "ShadowTrackerExtra.exe",
    ),
  ]);
}

function getShadowTrackerStaticCandidates() {
  return uniquePaths([
    DEFAULT_SHADOWTRACKER_EXECUTABLE,
    LEGACY_SHADOWTRACKER_EXECUTABLE,
    OLDER_SHADOWTRACKER_EXECUTABLE,
    path.join(
      DEFAULT_SHADOWTRACKER_PREFIX,
      "WindowsNoEditor",
      "ShadowTrackerExtra.exe",
    ),
    path.join(
      LEGACY_SHADOWTRACKER_PREFIX,
      "WindowsNoEditor",
      "ShadowTrackerExtra.exe",
    ),
    path.join(
      OLDER_SHADOWTRACKER_PREFIX,
      "WindowsNoEditor",
      "ShadowTrackerExtra.exe",
    ),
    process.env.ProgramFiles
      ? path.join(
          process.env.ProgramFiles,
          "ShadowTrackerExtra",
          "ShadowTrackerExtra.exe",
        )
      : "",
    process.env["ProgramFiles(x86)"]
      ? path.join(
          process.env["ProgramFiles(x86)"],
          "ShadowTrackerExtra",
          "ShadowTrackerExtra.exe",
        )
      : "",
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "ShadowTrackerExtra",
          "ShadowTrackerExtra.exe",
        )
      : "",
  ]);
}

function persistDetectedShadowTrackerPath(
  executablePath,
  source = "discovery",
) {
  const normalizedPath = String(executablePath || "").trim();
  if (!isExistingFile(normalizedPath)) {
    return "";
  }

  const currentPath = String(configManager.getShadowTrackerPath() || "").trim();
  if (
    normalizeComparablePath(currentPath) ===
    normalizeComparablePath(normalizedPath)
  ) {
    return normalizedPath;
  }

  configManager.setShadowTrackerPath(normalizedPath);
  log("[launcher] ShadowTracker executable detected", {
    source,
    executablePath: normalizedPath,
  });
  broadcastConfigUpdate(source);
  return normalizedPath;
}

function resolveShadowTrackerExecutable(inputPath, options = {}) {
  const providedPath = migrateLegacyPrefix(
    inputPath,
    [OLDER_SHADOWTRACKER_PREFIX, LEGACY_SHADOWTRACKER_PREFIX],
    DEFAULT_SHADOWTRACKER_PREFIX,
  );
  const inputCandidates = getShadowTrackerInputCandidates(providedPath);
  const runningCandidates = getRunningShadowTrackerExecutableCandidates({
    force: options.forceProcessScan === true,
  });
  const preferRunning = options.preferRunning === true;

  const primaryCandidates = preferRunning
    ? [...runningCandidates, ...inputCandidates]
    : [...inputCandidates, ...runningCandidates];
  const primaryMatch = findExistingFile(primaryCandidates);
  if (primaryMatch) {
    return primaryMatch;
  }

  const staticMatch = findExistingFile(getShadowTrackerStaticCandidates());
  if (staticMatch) {
    return staticMatch;
  }
  return findExistingFile(readWherePaths("ShadowTrackerExtra.exe"));
}

async function resolveShadowTrackerExecutableForProduction(
  inputPath,
  options = {},
) {
  const providedPath = migrateLegacyPrefix(
    inputPath,
    [OLDER_SHADOWTRACKER_PREFIX, LEGACY_SHADOWTRACKER_PREFIX],
    DEFAULT_SHADOWTRACKER_PREFIX,
  );
  const inputCandidates = getShadowTrackerInputCandidates(providedPath);
  let runningEntries = [];
  try {
    runningEntries = await getRunningShadowTrackerProcessesAsync({
      force: options.forceProcessScan !== false,
    });
  } catch {
    runningEntries = [];
  }

  return resolveProductionExecutableCandidates({
    preferRunning: options.preferRunning !== false,
    runningCandidates: runningEntries.map((entry) => entry.executablePath),
    configuredCandidates: inputCandidates,
    staticCandidates: getShadowTrackerStaticCandidates(),
    isExecutableFile: isExistingFile,
    discoverPathCandidates: () =>
      discoverExecutablePaths("ShadowTrackerExtra.exe", {
        platform: process.platform,
      }),
  });
}

function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    ...options,
  });
  child.unref();
  return child;
}

function getTrustedConnectorDependencyRoots() {
  const roots = {};
  const allowedRoots = app.isPackaged
    ? [
        path.join(process.resourcesPath, "app"),
        path.join(process.resourcesPath, "app.asar"),
      ]
    : [REPO_ROOT];
  for (const packageName of ["axios", "express"]) {
    const packageRoot = path.dirname(
      require.resolve(`${packageName}/package.json`),
    );
    if (
      path.basename(packageRoot).toLowerCase() !== packageName ||
      !allowedRoots.some((allowedRoot) =>
        isConnectorPathInside(allowedRoot, packageRoot),
      )
    ) {
      throw new Error(
        `Managed connector dependency escaped the trusted app resources: ${packageName}`,
      );
    }
    roots[packageName] = packageRoot;
  }
  return roots;
}

function prepareManagedConnectorRuntimeInputs(connector) {
  const sourcePath = getManagedTelemetryBridgeSourcePath();
  const supportResources = getManagedTelemetryBridgeSupportResources();
  if (
    !connector?.ok ||
    !sourcePath ||
    normalizeComparablePath(sourcePath) !==
      normalizeComparablePath(connector.sourcePath) ||
    !connector.sourceHash
  ) {
    throw new Error("Managed connector source identity is unavailable.");
  }

  const expectedSupportHashes = new Map(
    (connector.supportFiles || []).map((supportFile) => [
      supportFile.fileName,
      supportFile.sourceHash,
    ]),
  );
  const supportFiles = supportResources.map((supportFile) => ({
    path: supportFile.sourcePath,
    sha256: expectedSupportHashes.get(supportFile.fileName),
  }));
  const trustedRoot = app.isPackaged
    ? path.join(process.resourcesPath, CONNECTOR_RESOURCE_DIR_NAME)
    : REPO_ROOT;
  assertVerifiedRuntimeInputs({
    trustedRoot,
    files: [
      { path: sourcePath, sha256: connector.sourceHash },
      ...supportFiles,
    ],
  });

  return {
    dependencyRoots: getTrustedConnectorDependencyRoots(),
    scriptPath: sourcePath,
  };
}

function spawnNodeScript(scriptPath, envOverrides = null, options = {}) {
  const env = createSanitizedConnectorEnv({
    parentEnv: process.env,
    overrides:
      envOverrides && typeof envOverrides === "object" ? envOverrides : {},
    dependencyRoots: options.dependencyRoots,
    // Electron honors this flag; a regular Node executable safely ignores it.
    electronRunAsNode: true,
  });
  return spawnDetached(process.execPath, [scriptPath], {
    cwd: path.dirname(scriptPath),
    env,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isChildProcessRunning(child) {
  return Boolean(child && child.exitCode === null && !child.killed);
}

function getObserverFeedStatusView() {
  const recovery = observerFeedSupervisor.getStatus();
  const health = observerFeedHealthWatchdog.getStatus();
  return {
    enabled: observerFeedState.enabled === true,
    running: observerFeedState.running === true,
    mode:
      typeof observerFeedState.mode === "string" &&
      observerFeedState.mode.trim()
        ? observerFeedState.mode
        : "off",
    managed: observerFeedState.managed === true,
    matchId: observerFeedState.matchId ?? null,
    sessionId: observerFeedState.sessionId ?? null,
    pid:
      Number.isFinite(Number(observerFeedState.pid)) &&
      Number(observerFeedState.pid) > 0
        ? Number(observerFeedState.pid)
        : null,
    scriptPath: observerFeedState.scriptPath ?? null,
    ready: observerFeedState.ready === true,
    lastError:
      typeof observerFeedState.lastError === "string" &&
      observerFeedState.lastError.trim()
        ? observerFeedState.lastError.trim()
        : null,
    lastStartedAt: observerFeedState.lastStartedAt ?? null,
    lastStoppedAt: observerFeedState.lastStoppedAt ?? null,
    recoveryState: recovery.state,
    restartAttempts: recovery.restartAttempts,
    maxRestartAttempts: recovery.maxRestartAttempts,
    nextRestartAt: recovery.nextRestartAt,
    lastUnexpectedExitAt: recovery.lastUnexpectedExitAt,
    lastRestartAt: recovery.lastRestartAt,
    restartBlockedReason: recovery.blockedReason,
    healthState: health.state,
    consecutiveHealthFailures: health.consecutiveFailures,
    healthFailureThreshold: health.failureThreshold,
    lastHealthCheckAt: health.lastCheckedAt,
    lastHealthyAt: health.lastHealthyAt,
  };
}

function setObserverFeedState(patch = {}) {
  observerFeedState = {
    ...observerFeedState,
    ...patch,
  };
  return getObserverFeedStatusView();
}

function resetObserverFeedState(patch = {}) {
  observerFeedState = {
    ...createDefaultObserverFeedState(),
    ...patch,
  };
  return getObserverFeedStatusView();
}

function synchronizeObserverFeedRecoveryState(recovery = {}) {
  if (recovery.state === "waiting" || recovery.state === "restarting") {
    setObserverFeedState({
      enabled: true,
      running: false,
      mode: "direct",
      ready: false,
      managed: true,
      pid: null,
      lastError: recovery.lastError || "Observer feed recovery is in progress.",
    });
    refreshLocalRuntimeLifecyclePoller();
    return;
  }

  if (recovery.state === "blocked" || recovery.state === "circuit-open") {
    observerFeedHealthWatchdog.stop();
    setObserverFeedState({
      enabled: false,
      running: false,
      mode: "off",
      ready: false,
      managed: false,
      pid: null,
      lastError:
        recovery.blockedReason ||
        recovery.lastError ||
        "Observer feed recovery stopped.",
      lastStoppedAt: new Date().toISOString(),
    });
    setWidgetDirectObserverPollingAllowed(false);
    refreshLocalRuntimeLifecyclePoller();
  }
}

function synchronizeObserverFeedHealthState(health = {}) {
  if (
    health.state === "healthy" &&
    isChildProcessRunning(telemetryBridgeProcess) &&
    isDirectTelemetrySourceConfig(telemetrySourceProcessConfig)
  ) {
    setObserverFeedState({
      running: true,
      ready: true,
      lastError: null,
    });
    return;
  }

  if (health.state === "degraded" || health.state === "recycling") {
    setObserverFeedState({
      ready: false,
      lastError:
        health.lastError || "Owned observer connector health check failed.",
    });
  }
}

function isObserverFeedRecoveryActive(status = getObserverFeedStatusView()) {
  return (
    status.recoveryState === "waiting" || status.recoveryState === "restarting"
  );
}

function isObserverFeedSessionActive(status = getObserverFeedStatusView()) {
  return (
    status.enabled === true ||
    status.running === true ||
    isObserverFeedRecoveryActive(status)
  );
}

function isDirectObserverWidgetPollingPermittedByPolicy() {
  return shouldAllowDirectObserverWidgetPolling({
    isPackaged: app.isPackaged,
    env: process.env,
  });
}

function isShadowTelemetryReachableFromCache() {
  return shadowTelemetryDiscoveryCache?.health?.reachable === true;
}

function setWidgetDirectObserverPollingAllowed(enabled) {
  widgetDirectObserverPollingAllowed =
    enabled === true && isDirectObserverWidgetPollingPermittedByPolicy();
  return widgetDirectObserverPollingAllowed;
}

function shouldPollDirectObserverForWidgets() {
  return shouldPollDirectObserverWidgetRuntime({
    isPackaged: app.isPackaged,
    env: process.env,
    widgetPollingEnabled: widgetDirectObserverPollingAllowed === true,
    observerFeedRunning: getObserverFeedStatusView().running === true,
    shadowReachable: isShadowTelemetryReachableFromCache(),
    telemetryRunning: telemetryBridge.getStatus().running === true,
  });
}

function shouldPollDirectObserverCircleForWidgets() {
  return (
    isDirectObserverWidgetPollingPermittedByPolicy() &&
    (shouldPollDirectObserverForWidgets() ||
      telemetryBridge.getStatus().running === true)
  );
}

function clearWidgetRuntimeState(reason = "stopped") {
  if (typeof widgetServer?.clearRuntimeState === "function") {
    widgetServer.clearRuntimeState({ reason });
  }
}

function shouldMonitorLocalRuntimeLifecycle() {
  return isObserverFeedSessionActive();
}

function clearLocalRuntimeLifecyclePollTimer() {
  if (!localRuntimeLifecyclePollTimer) {
    return;
  }

  clearInterval(localRuntimeLifecyclePollTimer);
  localRuntimeLifecyclePollTimer = null;
}

async function pollLocalRuntimeLifecycleOnce() {
  if (
    localRuntimeLifecyclePollInFlight ||
    !shouldMonitorLocalRuntimeLifecycle()
  ) {
    return;
  }

  const initialObserverStatus = getObserverFeedStatusView();
  if (
    initialObserverStatus.enabled !== true &&
    initialObserverStatus.running === true
  ) {
    localRuntimeLifecyclePollInFlight = true;
    try {
      await stopObserverFeed("stop-retry");
    } catch (error) {
      logError("[Observer Feed] Pending safe stop retry failed", {
        pid: initialObserverStatus.pid,
        error:
          error instanceof Error
            ? error.message
            : String(error || "Unknown stop error"),
      });
    } finally {
      localRuntimeLifecyclePollInFlight = false;
    }
    return;
  }

  let session;
  let matchId;
  let observerSessionId;
  try {
    session = getStoredSession();
    const observerStatus = getObserverFeedStatusView();
    matchId = requireMatchId(observerStatus.matchId);
    observerSessionId = String(observerStatus.sessionId || "").trim();
  } catch {
    return;
  }

  if (shouldRefreshAuthoritativeLiveMatchMap()) {
    void refreshAuthoritativeLiveMatchMap(session).catch((error) => {
      logWarn("[Observer Feed] Live match map refresh failed", {
        matchId,
        error:
          error instanceof Error
            ? error.message
            : String(error || "Unknown map refresh error"),
      });
    });
  }

  localRuntimeLifecyclePollInFlight = true;
  try {
    const { control, lifecycleStatus } = await fetchMatchControlState(
      session,
      matchId,
    );
    const isFinalizing =
      control?.isFinalizing === true ||
      lifecycleStatus === "FINISH_PENDING" ||
      lifecycleStatus === "ENDED";
    const isFinished = lifecycleStatus === "FINISHED";
    const boundSessionId = getObserverFeedBoundSessionId(control);
    const sessionMismatch = Boolean(
      observerSessionId &&
      boundSessionId &&
      boundSessionId !== observerSessionId,
    );
    if (!isFinalizing && !isFinished && !sessionMismatch) {
      return;
    }

    const currentObserverStatus = getObserverFeedStatusView();
    if (
      !isObserverFeedSessionActive(currentObserverStatus) ||
      currentObserverStatus.matchId !== matchId ||
      String(currentObserverStatus.sessionId || "").trim() !== observerSessionId
    ) {
      return;
    }

    const reason = isFinished
      ? "finished"
      : sessionMismatch
        ? "session-replaced"
        : "finalizing";
    logWarn("[Observer Feed] Backend lifecycle forced local runtime stop", {
      matchId,
      matchStatus: lifecycleStatus,
      controlStatus: control?.matchStatus ?? control?.status ?? null,
      reason,
    });
    telemetryBridge.stop(reason, {
      matchStatus: lifecycleStatus,
      isLocked: isFinished,
      isFinalizing,
    });
    await stopObserverFeed(reason);
  } catch (error) {
    logWarn("[Observer Feed] Lifecycle authority poll failed", {
      error:
        error instanceof Error
          ? error.message
          : String(error || "Unknown error"),
      matchId,
    });
  } finally {
    localRuntimeLifecyclePollInFlight = false;
  }
}

function refreshLocalRuntimeLifecyclePoller() {
  if (!shouldMonitorLocalRuntimeLifecycle()) {
    clearLocalRuntimeLifecyclePollTimer();
    return;
  }

  if (localRuntimeLifecyclePollTimer) {
    return;
  }

  localRuntimeLifecyclePollTimer = setInterval(() => {
    void pollLocalRuntimeLifecycleOnce();
  }, LOCAL_RUNTIME_LIFECYCLE_POLL_INTERVAL_MS);
  localRuntimeLifecyclePollTimer.unref?.();
  void pollLocalRuntimeLifecycleOnce();
}

function getCurrentWidgetMatchContext() {
  const observerFeedMatchId = normalizeOptionalString(
    observerFeedState.matchId,
  );
  if (observerFeedMatchId) {
    return {
      matchId: observerFeedMatchId,
      source: "observer-feed",
      workflowState: normalizeOptionalString(matchFlowState.workflowState),
      productionStatus: normalizeOptionalString(productionModeState.status),
    };
  }

  const productionMatchId = normalizeOptionalString(
    productionModeState.matchId,
  );
  if (productionMatchId) {
    return {
      matchId: productionMatchId,
      source: "production-mode",
      workflowState: normalizeOptionalString(matchFlowState.workflowState),
      productionStatus: normalizeOptionalString(productionModeState.status),
    };
  }

  const matchFlowMatchId = normalizeOptionalString(
    matchFlowState.currentMatchId,
  );
  return {
    matchId: matchFlowMatchId,
    source: matchFlowMatchId ? "match-flow" : null,
    workflowState: normalizeOptionalString(matchFlowState.workflowState),
    productionStatus: normalizeOptionalString(productionModeState.status),
  };
}

function normalizeShadowTelemetryBaseUrl(
  value,
  fallback = DEFAULT_SHADOW_TELEMETRY_BASE_URL,
) {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
    if (
      parsed.protocol !== "http:" ||
      !isConnectorLoopbackHostname(parsed.hostname) ||
      parsed.username ||
      parsed.password
    ) {
      return fallback;
    }
    if (!parsed.port) {
      parsed.port = String(DEFAULT_SHADOW_TELEMETRY_PORT);
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function getShadowTelemetryBaseUrlFromSettings() {
  return normalizeShadowTelemetryBaseUrl(
    configManager.getSettings()?.shadowTelemetryBaseUrl,
    "",
  );
}

function getShadowTelemetryBaseUrl() {
  return normalizeShadowTelemetryBaseUrl(
    shadowTelemetryBaseUrl || getShadowTelemetryBaseUrlFromSettings(),
  );
}

function applyShadowTelemetryBaseUrl(baseUrl, source = "system") {
  const normalized = normalizeShadowTelemetryBaseUrl(baseUrl, "");
  if (!normalized) {
    return getShadowTelemetryBaseUrl();
  }

  const previous = shadowTelemetryBaseUrl;
  shadowTelemetryBaseUrl = normalized;
  if (typeof telemetryBridge?.setShadowBaseUrl === "function") {
    telemetryBridge.setShadowBaseUrl(normalized);
  }

  if (previous !== normalized) {
    shadowTelemetryDiscoveryCache = {
      checkedAt: 0,
      health: null,
    };
    log("[launcher] ShadowTracker telemetry endpoint selected", {
      source,
      baseUrl: normalized,
    });
  }

  return normalized;
}

function persistShadowTelemetryBaseUrl(baseUrl, source = "discovery") {
  const normalized = applyShadowTelemetryBaseUrl(baseUrl, source);
  const settings = configManager.getSettings() || {};
  if (settings.shadowTelemetryBaseUrl !== normalized) {
    configManager.setSettings({
      ...settings,
      shadowTelemetryBaseUrl: normalized,
    });
  }
  return normalized;
}

function extractPortFromBaseUrl(baseUrl) {
  try {
    const parsed = new URL(normalizeShadowTelemetryBaseUrl(baseUrl));
    const port = Number(
      parsed.port || (parsed.protocol === "https:" ? 443 : 80),
    );
    return Number.isInteger(port) && port > 0
      ? port
      : DEFAULT_SHADOW_TELEMETRY_PORT;
  } catch {
    return DEFAULT_SHADOW_TELEMETRY_PORT;
  }
}

function getShadowTelemetryPort(baseUrl = getShadowTelemetryBaseUrl()) {
  return extractPortFromBaseUrl(baseUrl);
}

function getShadowTelemetryCandidateBaseUrls() {
  const configuredUrl = getShadowTelemetryBaseUrlFromSettings();
  const envUrl = normalizeShadowTelemetryBaseUrl(
    process.env.SHADOWTRACKER_TELEMETRY_BASE_URL,
    "",
  );
  const currentUrl = getShadowTelemetryBaseUrl();
  const urls = [
    configuredUrl,
    envUrl,
    currentUrl,
    DEFAULT_SHADOW_TELEMETRY_BASE_URL,
  ];

  for (const port of SHADOW_TELEMETRY_DISCOVERY_PORTS) {
    urls.push(`http://127.0.0.1:${port}`);
    urls.push(`http://localhost:${port}`);
  }

  const seen = new Set();
  return urls
    .map((candidate) => normalizeShadowTelemetryBaseUrl(candidate, ""))
    .filter((candidate) => {
      if (!candidate || seen.has(candidate)) {
        return false;
      }
      seen.add(candidate);
      return true;
    });
}

function isShadowTelemetryProbeResponse(pathname, response, options = {}) {
  const status = Number(response?.status);
  if (!Number.isFinite(status) || status < 200 || status >= 300) {
    return false;
  }

  const data = response?.data;
  if (pathname === "/health") {
    const validHealth = Boolean(
      data &&
      typeof data === "object" &&
      (data.status === "ok" ||
        Object.prototype.hasOwnProperty.call(data, "forwardEnabled") ||
        Object.prototype.hasOwnProperty.call(data, "forwardBaseUrl")),
    );
    return (
      validHealth &&
      matchesExpectedObserverRuntime(data?.runtime, options.expectedRuntime)
    );
  }

  if (options.expectedRuntime) {
    return false;
  }

  return true;
}

async function probeShadowTelemetryBaseUrl(baseUrl, checkedAt, options = {}) {
  const normalizedBaseUrl = normalizeShadowTelemetryBaseUrl(baseUrl, "");
  if (!normalizedBaseUrl) {
    return {
      reachable: false,
      baseUrl: null,
      lastResponseAt: null,
      lastCheckedAt: checkedAt,
      lastError: "Invalid ShadowTracker telemetry endpoint.",
    };
  }

  let lastError = "ShadowTracker did not respond.";
  for (const probePath of SHADOW_TELEMETRY_PROBE_PATHS) {
    try {
      const response = await axios.get(`${normalizedBaseUrl}${probePath}`, {
        timeout: SHADOW_TELEMETRY_PROBE_TIMEOUT_MS,
        ...(String(options.localAccessToken || "").trim()
          ? {
              headers: {
                "X-Arenzyra-Connector-Token": String(
                  options.localAccessToken,
                ).trim(),
              },
            }
          : {}),
        validateStatus: () => true,
      });

      if (isShadowTelemetryProbeResponse(probePath, response, options)) {
        return {
          reachable: true,
          baseUrl: normalizedBaseUrl,
          lastResponseAt: checkedAt,
          lastCheckedAt: checkedAt,
          runtime:
            probePath === "/health" && response?.data?.runtime
              ? { ...response.data.runtime }
              : null,
          lastError: null,
        };
      }

      if (
        probePath === "/health" &&
        options.expectedRuntime &&
        Number(response?.status) >= 200 &&
        Number(response?.status) < 300
      ) {
        lastError =
          "Observer connector identity did not match the owned runtime.";
        break;
      }

      if (Number(response?.status) >= 500) {
        lastError = `ShadowTracker returned HTTP ${response.status}.`;
      }
    } catch (error) {
      const code =
        error && typeof error === "object" ? String(error.code || "") : "";
      if (
        code &&
        !["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(
          code,
        )
      ) {
        lastError = code;
      }
    }
  }

  if (options.allowSocketFallback !== true) {
    return {
      reachable: false,
      baseUrl: normalizedBaseUrl,
      lastResponseAt: null,
      lastCheckedAt: checkedAt,
      lastError,
    };
  }

  const port = extractPortFromBaseUrl(normalizedBaseUrl);
  const portReachable = await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(300);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });

  if (portReachable) {
    return {
      reachable: true,
      baseUrl: normalizedBaseUrl,
      lastResponseAt: checkedAt,
      lastCheckedAt: checkedAt,
      lastError: null,
    };
  }

  return {
    reachable: false,
    baseUrl: normalizedBaseUrl,
    lastResponseAt: null,
    lastCheckedAt: checkedAt,
    lastError,
  };
}

function buildTelemetrySourceProcessEnv(config = null) {
  const normalizedConfig =
    config && typeof config === "object" ? config : { mode: "local" };
  const mode = normalizedConfig.mode === "direct" ? "direct" : "local";
  const mapKey = String(
    normalizedConfig.mapKey ||
      normalizedConfig.selectedMapKey ||
      process.env.ARENZYRA_FORCE_MAP_KEY ||
      "",
  ).trim();
  const baseEnv = {
    HOST: resolveObserverBindHost({
      isPackaged: app.isPackaged,
      env: process.env,
    }),
    PORT: String(
      getShadowTelemetryPort(
        normalizedConfig.observerBaseUrl || getShadowTelemetryBaseUrl(),
      ),
    ),
    ARENZYRA_OBSERVER_RUNTIME_NONCE: String(
      normalizedConfig.runtimeNonce || "",
    ).trim(),
    ARENZYRA_PCOB_CONNECTOR_TOKEN: String(
      normalizedConfig.localControlToken || "",
    ).trim(),
  };

  if (mode !== "direct") {
    return baseEnv;
  }

  return {
    ...baseEnv,
    FORWARD_ENABLE: "false",
    OBSERVER_FORWARD_ENABLE: "true",
    API_BASE_URL: normalizeBaseUrl(normalizedConfig.apiBase),
    MATCH_ID: requireMatchId(normalizedConfig.matchId),
    OBSERVER_SESSION_ID: String(normalizedConfig.sessionId || "").trim(),
    ARENZYRA_OBSERVER_FEED_TOKEN: String(
      normalizedConfig.feedToken || "",
    ).trim(),
    OBSERVER_FORWARD_LOG_PATH: path.join(
      app.getPath("userData"),
      "logs",
      "telemetry.log",
    ),
    PCOB_EVENT_SPOOL_DIR: path.join(
      app.getPath("userData"),
      "telemetry",
      "pcob-event-spool",
    ),
    ...(mapKey
      ? {
          ARENZYRA_FORCE_MAP_KEY: mapKey,
          OBSERVER_MAP_NAME: mapKey,
          MATCH_MAP_NAME: mapKey,
        }
      : {}),
  };
}

function isDirectTelemetrySourceConfig(config) {
  return Boolean(config && config.mode === "direct");
}

function sameTelemetrySourceConfig(currentConfig, nextConfig) {
  if (!currentConfig || !nextConfig) {
    return false;
  }

  if (currentConfig.mode !== nextConfig.mode) {
    return false;
  }

  if (currentConfig.mode !== "direct") {
    return true;
  }

  return sameObserverFeedConfig(currentConfig, nextConfig);
}

function getObserverFeedBoundSessionId(control) {
  return String(
    control?.binding?.sessionId || control?.pcobSessionId || "",
  ).trim();
}

async function validateObserverFeedRecoveryAuthority(config) {
  let session;
  try {
    session = getStoredSession();
    assertLauncherAccess();
  } catch (error) {
    return {
      allowed: false,
      terminal: true,
      reason:
        error instanceof Error
          ? error.message
          : "Launcher authorization is no longer available.",
    };
  }

  if (normalizeBaseUrl(session.apiBase) !== normalizeBaseUrl(config.apiBase)) {
    return {
      allowed: false,
      terminal: true,
      reason: "Observer feed API authority changed.",
    };
  }

  let control;
  let lifecycleStatus;
  try {
    const lifecycle = await fetchMatchControlState(session, config.matchId);
    control = lifecycle.control;
    lifecycleStatus = lifecycle.lifecycleStatus;
  } catch (error) {
    const authorityExpired =
      isUnauthorizedError(error) || error?.code === ACCESS_DENIED_ERROR_CODE;
    if (!authorityExpired) {
      logWarn(
        "[Observer Feed] Backend authority temporarily unavailable; recovering the same bound session for durable local capture",
        {
          matchId: config.matchId,
          sessionId: config.sessionId,
          error:
            error instanceof Error
              ? error.message
              : String(error || "Unknown authority error"),
        },
      );
      return { allowed: true, authorityDegraded: true };
    }
    return {
      allowed: false,
      terminal: true,
      reason: "Observer feed authorization expired.",
    };
  }

  if (
    control?.isFinalizing === true ||
    lifecycleStatus === "FINISH_PENDING" ||
    lifecycleStatus === "ENDED" ||
    lifecycleStatus === "FINISHED"
  ) {
    return {
      allowed: false,
      terminal: true,
      reason: "Observer feed recovery stopped because the match is finalizing.",
    };
  }

  if (lifecycleStatus !== "LIVE") {
    return {
      allowed: false,
      terminal: true,
      reason: `Observer feed recovery requires the same LIVE match (current state: ${
        lifecycleStatus || "unknown"
      }).`,
    };
  }

  const boundSessionId = getObserverFeedBoundSessionId(control);
  if (
    !boundSessionId ||
    boundSessionId !== String(config.sessionId || "").trim()
  ) {
    return {
      allowed: false,
      terminal: true,
      reason:
        "Observer feed recovery stopped because the match session binding changed.",
    };
  }

  return { allowed: true };
}

async function restartObserverFeedFromSupervisor(config, context = {}) {
  if (context.signal?.aborted || context.isCurrent?.() !== true) {
    return { ok: false, error: "Observer feed recovery was cancelled." };
  }

  const source = await ensureTelemetrySourceRunning({
    mode: "direct",
    apiBase: config.apiBase,
    observerBaseUrl: config.observerBaseUrl,
    matchId: config.matchId,
    sessionId: config.sessionId,
    feedToken: config.feedToken,
    mapKey: getDesiredObserverFallbackMapKey(config.matchId, config.mapKey),
    signal: context.signal,
  });

  if (context.signal?.aborted || context.isCurrent?.() !== true) {
    if (
      isChildProcessRunning(telemetryBridgeProcess) &&
      sameTelemetrySourceConfig(telemetrySourceProcessConfig, config)
    ) {
      await stopManagedTelemetrySourceProcess("supervisor-cancelled");
    }
    return { ok: false, error: "Observer feed recovery was cancelled." };
  }

  if (source?.error) {
    return { ok: false, error: source.error };
  }
  if (
    !isChildProcessRunning(telemetryBridgeProcess) ||
    !sameTelemetrySourceConfig(telemetrySourceProcessConfig, config)
  ) {
    return {
      ok: false,
      error: "Observer connector did not remain running after recovery.",
    };
  }

  setWidgetDirectObserverPollingAllowed(true);
  observerFeedHealthWatchdog.start(telemetrySourceProcessConfig);
  refreshLocalRuntimeLifecyclePoller();
  log("[Observer Feed] Connector recovered", {
    matchId: config.matchId,
    sessionId: config.sessionId,
    pid: telemetryBridgeProcess?.pid ?? null,
    ready: source.ready === true,
  });
  return { ok: true };
}

function sameOwnedObserverRuntimeConfig(left, right) {
  return Boolean(
    sameObserverFeedConfig(left, right) &&
    String(left?.runtimeNonce || "").trim() &&
    String(left?.runtimeNonce || "").trim() ===
      String(right?.runtimeNonce || "").trim(),
  );
}

async function probeOwnedObserverRuntimeHealth(config) {
  const child = telemetryBridgeProcess;
  const generation = telemetrySourceProcessGeneration;
  if (
    !isChildProcessRunning(child) ||
    !sameOwnedObserverRuntimeConfig(telemetrySourceProcessConfig, config)
  ) {
    return {
      healthy: false,
      error: "Owned observer connector process is not running.",
    };
  }

  const probe = await probeExactObserverRuntime(config);
  const stillCurrent =
    telemetryBridgeProcess === child &&
    telemetrySourceProcessGeneration === generation &&
    sameOwnedObserverRuntimeConfig(telemetrySourceProcessConfig, config);
  const healthy = stillCurrent && probe.present === true;
  return {
    healthy,
    error: healthy
      ? null
      : probe.error ||
        "Owned observer connector failed its exact runtime health check.",
  };
}

async function recycleUnhealthyObserverRuntime(config, context = {}) {
  if (
    context.isCurrent?.() !== true ||
    !isChildProcessRunning(telemetryBridgeProcess) ||
    !sameOwnedObserverRuntimeConfig(telemetrySourceProcessConfig, config)
  ) {
    return;
  }

  logWarn("[Observer Feed] Recycling unhealthy owned connector", {
    matchId: config.matchId,
    sessionId: config.sessionId,
    pid: telemetryBridgeProcess?.pid ?? null,
    consecutiveFailures: OBSERVER_FEED_HEALTH_FAILURE_THRESHOLD,
    error: context.error || null,
  });
  const stopResult = await stopManagedTelemetrySourceProcess(
    "health-watchdog-recycle",
  );
  if (stopResult.ok !== true) {
    observerFeedHealthWatchdog.stop();
    observerFeedSupervisor.disarm();
    setWidgetDirectObserverPollingAllowed(false);
    clearWidgetRuntimeState("observer-feed-health-stop-failed");
    setObserverFeedState({
      enabled: false,
      ready: false,
      running: true,
      lastError: stopResult.error,
    });
    refreshLocalRuntimeLifecyclePoller();
    return;
  }
  beginObserverFeedRecovery(
    config,
    context.error || "Owned observer connector stopped responding.",
    "observer-feed-health-watchdog",
  );
}

async function probeExactObserverRuntime(
  config,
  timeoutMs = SHADOW_TELEMETRY_PROBE_TIMEOUT_MS,
) {
  const expectedRuntime = getExpectedObserverRuntime(config);
  if (!expectedRuntime?.nonce) {
    return {
      present: false,
      absent: true,
      error: null,
    };
  }

  try {
    const baseUrl = normalizeShadowTelemetryBaseUrl(
      config?.observerBaseUrl || getShadowTelemetryBaseUrl(),
    );
    const response = await axios.get(
      new URL("/health", `${baseUrl}/`).toString(),
      {
        timeout: Math.max(1, Number(timeoutMs) || 1),
        headers: {
          "X-Arenzyra-Connector-Token": String(
            config?.localControlToken || "",
          ).trim(),
        },
        validateStatus: () => true,
      },
    );
    const runtime = response?.data?.runtime;
    const present = matchesExpectedObserverRuntime(runtime, expectedRuntime);
    return {
      present,
      absent: Boolean(runtime && typeof runtime === "object" && !present),
      error: present
        ? null
        : "The local health endpoint did not identify the expected observer runtime.",
    };
  } catch (error) {
    const errorCode = String(error?.code || "")
      .trim()
      .toUpperCase();
    const absent = errorCode === "ECONNREFUSED";
    return {
      present: false,
      absent,
      error:
        error instanceof Error && error.message
          ? error.message
          : "Owned observer connector did not respond to its local health check.",
    };
  }
}

async function requestExactObserverRuntimeShutdown(
  config,
  timeoutMs = OBSERVER_FEED_GRACEFUL_REQUEST_TIMEOUT_MS,
) {
  const expectedRuntime = getExpectedObserverRuntime(config);
  const localControlToken = String(config?.localControlToken || "").trim();
  if (!expectedRuntime?.nonce || !localControlToken) {
    return false;
  }

  const boundedTimeoutMs = Math.max(1, Number(timeoutMs) || 1);
  const ownershipProbe = await probeExactObserverRuntime(
    config,
    boundedTimeoutMs,
  );
  if (ownershipProbe.present !== true) {
    return false;
  }

  try {
    const baseUrl = normalizeShadowTelemetryBaseUrl(
      config?.observerBaseUrl || getShadowTelemetryBaseUrl(),
    );
    const response = await axios.post(
      new URL("/debug/observer/shutdown", `${baseUrl}/`).toString(),
      null,
      {
        timeout: boundedTimeoutMs,
        maxRedirects: 0,
        headers: {
          "X-Arenzyra-Connector-Token": localControlToken,
          "X-Arenzyra-Runtime-Nonce": expectedRuntime.nonce,
        },
        validateStatus: () => true,
      },
    );
    return response?.status === 202 && response?.data?.ok === true;
  } catch {
    return false;
  }
}

function captureObserverMapFallbackSyncTarget(matchId, mapKey) {
  const normalizedMatchId = String(matchId || "").trim();
  const canonicalMapKey = resolveDesiredObserverFallbackMapKey({
    bootstrapMapKey: mapKey,
  });
  const child = telemetryBridgeProcess;
  const config = telemetrySourceProcessConfig;
  const expectedRuntime = getExpectedObserverRuntime(config);
  const localControlToken = String(config?.localControlToken || "").trim();
  if (
    !normalizedMatchId ||
    !canonicalMapKey ||
    !isChildProcessRunning(child) ||
    !isDirectTelemetrySourceConfig(config) ||
    String(config.matchId || "").trim() !== normalizedMatchId ||
    !expectedRuntime?.nonce ||
    !localControlToken
  ) {
    return null;
  }

  const generation = telemetrySourceProcessGeneration;
  return {
    child,
    config,
    epoch: observerMapFallbackSyncEpoch,
    generation,
    identity: `${observerMapFallbackSyncEpoch}:${generation}:${expectedRuntime.nonce}:${canonicalMapKey}`,
    localControlToken,
    mapKey: canonicalMapKey,
    matchId: normalizedMatchId,
    observerBaseUrl: normalizeShadowTelemetryBaseUrl(
      config.observerBaseUrl || getShadowTelemetryBaseUrl(),
    ),
    runtimeNonce: expectedRuntime.nonce,
  };
}

function isCurrentObserverMapFallbackSyncTarget(target) {
  return Boolean(
    target &&
    target.epoch === observerMapFallbackSyncEpoch &&
    telemetryBridgeProcess === target.child &&
    telemetrySourceProcessConfig === target.config &&
    telemetrySourceProcessGeneration === target.generation &&
    isChildProcessRunning(target.child) &&
    isDirectTelemetrySourceConfig(target.config) &&
    String(target.config.matchId || "").trim() === target.matchId,
  );
}

async function requestExactObserverRuntimeMapFallback(
  target,
  timeoutMs = OBSERVER_FEED_GRACEFUL_REQUEST_TIMEOUT_MS,
) {
  if (!isCurrentObserverMapFallbackSyncTarget(target)) {
    return { ok: false, stale: true, error: "Observer runtime changed." };
  }

  try {
    const response = await axios.post(
      new URL(
        "/debug/observer/map-fallback",
        `${target.observerBaseUrl}/`,
      ).toString(),
      { mapKey: target.mapKey },
      {
        timeout: Math.max(1, Number(timeoutMs) || 1),
        maxRedirects: 0,
        headers: {
          "Content-Type": "application/json",
          "X-Arenzyra-Connector-Token": target.localControlToken,
          "X-Arenzyra-Runtime-Nonce": target.runtimeNonce,
        },
        validateStatus: () => true,
      },
    );
    const ok =
      response?.status === 200 &&
      response?.data?.ok === true &&
      response?.data?.fallbackMapKey === target.mapKey;
    return {
      ok,
      status: Number(response?.status) || null,
      error: ok
        ? null
        : response?.data?.error ||
          "The observer connector rejected the map fallback update.",
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error:
        error instanceof Error && error.message
          ? error.message
          : "The observer connector map fallback update failed.",
    };
  }
}

function clearObserverMapFallbackRetry(options = {}) {
  if (observerMapFallbackRetryTimer) {
    clearTimeout(observerMapFallbackRetryTimer);
    observerMapFallbackRetryTimer = null;
  }
  if (options.preserveAttempt !== true) {
    observerMapFallbackRetryTarget = null;
    observerMapFallbackRetryAttempt = 0;
  }
}

function scheduleObserverMapFallbackRetry(target) {
  if (
    observerMapFallbackSyncDesired ||
    !isCurrentObserverMapFallbackSyncTarget(target) ||
    observerMapFallbackLastAppliedIdentity === target.identity
  ) {
    return;
  }
  if (
    observerMapFallbackRetryTimer &&
    observerMapFallbackRetryTarget?.identity === target.identity
  ) {
    return;
  }

  clearObserverMapFallbackRetry({
    preserveAttempt:
      observerMapFallbackRetryTarget?.identity === target.identity,
  });
  observerMapFallbackRetryTarget = target;
  const delayMs =
    OBSERVER_MAP_FALLBACK_RETRY_DELAYS_MS[
      Math.min(
        observerMapFallbackRetryAttempt,
        OBSERVER_MAP_FALLBACK_RETRY_DELAYS_MS.length - 1,
      )
    ];
  observerMapFallbackRetryAttempt += 1;
  observerMapFallbackRetryTimer = setTimeout(() => {
    observerMapFallbackRetryTimer = null;
    if (!isCurrentObserverMapFallbackSyncTarget(target)) {
      clearObserverMapFallbackRetry();
      return;
    }

    const latestMapKey = getDesiredObserverFallbackMapKey(
      target.matchId,
      target.mapKey,
    );
    if (latestMapKey !== target.mapKey) {
      clearObserverMapFallbackRetry();
      void scheduleObserverMapFallbackSync(target.matchId, latestMapKey);
      return;
    }

    const refreshedTarget = captureObserverMapFallbackSyncTarget(
      target.matchId,
      target.mapKey,
    );
    if (refreshedTarget) {
      observerMapFallbackSyncDesired = refreshedTarget;
      ensureObserverMapFallbackSyncDrain();
    } else {
      clearObserverMapFallbackRetry();
    }
  }, delayMs);
  observerMapFallbackRetryTimer.unref?.();
}

async function drainObserverMapFallbackSyncQueue() {
  while (observerMapFallbackSyncDesired) {
    const target = observerMapFallbackSyncDesired;
    observerMapFallbackSyncDesired = null;
    if (!isCurrentObserverMapFallbackSyncTarget(target)) {
      continue;
    }
    if (observerMapFallbackLastAppliedIdentity === target.identity) {
      continue;
    }

    observerMapFallbackInFlightIdentity = target.identity;
    const result = await requestExactObserverRuntimeMapFallback(target);
    if (observerMapFallbackInFlightIdentity === target.identity) {
      observerMapFallbackInFlightIdentity = null;
    }
    if (!isCurrentObserverMapFallbackSyncTarget(target)) {
      continue;
    }
    if (result.ok === true) {
      observerMapFallbackLastAppliedIdentity = target.identity;
      observerMapFallbackLastWarningAt = 0;
      clearObserverMapFallbackRetry();
      continue;
    }

    // A timed-out local POST may have applied before its response was lost.
    // Forget the prior success so any later map (including a revert) is sent
    // explicitly instead of being incorrectly treated as already applied.
    observerMapFallbackLastAppliedIdentity = null;

    const now = Date.now();
    if (now - observerMapFallbackLastWarningAt >= 30_000) {
      observerMapFallbackLastWarningAt = now;
      logWarn("[Observer Feed] Live map fallback sync will retry", {
        matchId: target.matchId,
        mapKey: target.mapKey,
        status: result.status,
        error: result.error,
      });
    }
    scheduleObserverMapFallbackRetry(target);
  }
}

function ensureObserverMapFallbackSyncDrain() {
  if (observerMapFallbackSyncPromise) {
    return observerMapFallbackSyncPromise;
  }

  const syncPromise = drainObserverMapFallbackSyncQueue().catch((error) => {
    logWarn("[Observer Feed] Live map fallback sync queue failed", {
      error:
        error instanceof Error
          ? error.message
          : String(error || "Unknown map sync queue error"),
    });
  });
  observerMapFallbackSyncPromise = syncPromise;
  void syncPromise.finally(() => {
    if (observerMapFallbackSyncPromise === syncPromise) {
      observerMapFallbackSyncPromise = null;
    }
    if (observerMapFallbackSyncDesired) {
      ensureObserverMapFallbackSyncDrain();
    }
  });
  return syncPromise;
}

function scheduleObserverMapFallbackSync(matchId, mapKey) {
  const target = captureObserverMapFallbackSyncTarget(matchId, mapKey);
  if (!target) {
    return Promise.resolve({ ok: false, skipped: true });
  }
  if (observerMapFallbackInFlightIdentity === target.identity) {
    // The in-flight update is the newest value again. Drop any different map
    // that was queued while this request was running; otherwise that stale
    // value would be posted last after the current request settles.
    if (
      observerMapFallbackSyncDesired &&
      observerMapFallbackSyncDesired.identity !== target.identity
    ) {
      observerMapFallbackSyncDesired = null;
    }
    if (
      observerMapFallbackRetryTarget &&
      observerMapFallbackRetryTarget.identity !== target.identity
    ) {
      clearObserverMapFallbackRetry();
    }
    return Promise.resolve({ ok: false, pending: true });
  }
  if (observerMapFallbackSyncDesired?.identity === target.identity) {
    return Promise.resolve({ ok: false, pending: true });
  }
  const hasPendingDifferentUpdate = Boolean(
    observerMapFallbackInFlightIdentity ||
    observerMapFallbackSyncDesired ||
    observerMapFallbackRetryTarget,
  );
  if (
    observerMapFallbackLastAppliedIdentity === target.identity &&
    !hasPendingDifferentUpdate
  ) {
    clearObserverMapFallbackRetry();
    return Promise.resolve({ ok: true, skipped: true });
  }

  const retryingSameTarget =
    observerMapFallbackRetryTarget?.identity === target.identity;
  if (
    retryingSameTarget &&
    (observerMapFallbackRetryTimer || observerMapFallbackSyncPromise)
  ) {
    return Promise.resolve({ ok: false, retryScheduled: true });
  }
  if (observerMapFallbackRetryTarget && !retryingSameTarget) {
    clearObserverMapFallbackRetry();
  }

  observerMapFallbackSyncDesired = target;
  return ensureObserverMapFallbackSyncDrain();
}

function hasChildProcessExited(child) {
  return Boolean(
    !child || child.exitCode !== null || child.signalCode !== null,
  );
}

function waitForChildProcessExit(child, timeoutMs) {
  if (hasChildProcessExited(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", handleExit);
      child.removeListener("close", handleExit);
      resolve(exited === true || hasChildProcessExited(child));
    };
    const handleExit = () => finish(true);
    const timer = setTimeout(
      () => finish(hasChildProcessExited(child)),
      Math.max(1, Number(timeoutMs) || 1),
    );
    child.once("exit", handleExit);
    child.once("close", handleExit);
  });
}

async function waitForExactObserverRuntimeToDisappear(config, timeoutMs) {
  const expectedRuntime = getExpectedObserverRuntime(config);
  if (!expectedRuntime?.nonce) {
    return true;
  }

  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 1);
  while (Date.now() <= deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const probe = await probeExactObserverRuntime(
      config,
      Math.min(250, remainingMs),
    );
    if (probe.absent === true) {
      return true;
    }
    if (Date.now() >= deadline) {
      break;
    }
    await sleep(
      Math.min(OBSERVER_FEED_STOP_IDENTITY_POLL_MS, deadline - Date.now()),
    );
  }
  return false;
}

function killChildProcessTree(pid, options = {}) {
  const normalizedPid = Number(pid);
  if (!Number.isFinite(normalizedPid) || normalizedPid <= 0) {
    return false;
  }

  if (process.platform === "win32") {
    if (options?.force !== true) {
      return false;
    }
    try {
      const taskkill = resolveTrustedWindowsCommand("taskkill");
      const result = spawnSync(
        taskkill.executablePath,
        ["/PID", String(normalizedPid), "/T", "/F"],
        {
          windowsHide: true,
          env: taskkill.env,
          stdio: "ignore",
          timeout: 3_000,
        },
      );
      return result.status === 0;
    } catch {
      return false;
    }
  }

  try {
    process.kill(
      normalizedPid,
      options?.force === true ? "SIGKILL" : "SIGTERM",
    );
    return true;
  } catch {
    return false;
  }
}

async function performManagedTelemetrySourceStop(
  child,
  processConfig,
  generation,
  reason,
) {
  const pid = child?.pid ?? null;

  if (child) {
    telemetrySourceStoppingProcesses.add(child);
  }

  if (!pid) {
    if (
      telemetryBridgeProcess === child &&
      telemetrySourceProcessConfig === processConfig &&
      telemetrySourceProcessGeneration === generation
    ) {
      telemetryBridgeProcess = null;
      telemetrySourceProcessConfig = null;
    }
    return {
      ok: true,
      stopped: false,
      reason,
      mode: processConfig?.mode ?? null,
    };
  }

  const confirmation = await stopObserverProcessWithConfirmation({
    child,
    pid,
    graceTimeoutMs: OBSERVER_FEED_STOP_GRACE_TIMEOUT_MS,
    forceTimeoutMs: OBSERVER_FEED_STOP_FORCE_TIMEOUT_MS,
    identityTimeoutMs: OBSERVER_FEED_STOP_IDENTITY_TIMEOUT_MS,
    kill: async (targetPid, killOptions) => {
      if (killOptions?.force === true) {
        return killChildProcessTree(targetPid, { force: true });
      }
      if (process.platform === "win32") {
        return requestExactObserverRuntimeShutdown(processConfig);
      }
      return killChildProcessTree(targetPid, { force: false });
    },
    waitForExit: waitForChildProcessExit,
    waitForIdentityGone: (timeoutMs) =>
      waitForExactObserverRuntimeToDisappear(processConfig, timeoutMs),
  });
  const stopped = confirmation.stopped === true;

  if (
    stopped &&
    telemetryBridgeProcess === child &&
    telemetrySourceProcessConfig === processConfig &&
    telemetrySourceProcessGeneration === generation
  ) {
    telemetryBridgeProcess = null;
    telemetrySourceProcessConfig = null;
  }

  const logStop = stopped ? log : logError;
  logStop(
    stopped
      ? "[launcher] ob.js stop confirmed"
      : "[launcher] ob.js stop failed",
    {
      pid,
      reason,
      mode: processConfig?.mode ?? null,
      matchId: processConfig?.matchId ?? null,
      gracefulKillRequested: confirmation.gracefulKillRequested,
      forceKillRequested: confirmation.forceKillRequested,
      exited: confirmation.processExited,
      exactRuntimeGone: confirmation.exactRuntimeGone,
    },
  );

  if (!stopped) {
    return {
      ok: false,
      stopped: false,
      pid,
      reason,
      mode: processConfig?.mode ?? null,
      processExited: confirmation.processExited,
      exactRuntimeGone: confirmation.exactRuntimeGone,
      error: confirmation.error,
    };
  }

  return {
    ok: true,
    stopped,
    pid,
    reason,
    mode: processConfig?.mode ?? null,
  };
}

async function stopManagedTelemetrySourceProcess(reason = "stopped") {
  const child = telemetryBridgeProcess;
  const processConfig = telemetrySourceProcessConfig;
  const generation = telemetrySourceProcessGeneration;

  if (!child) {
    return {
      ok: true,
      stopped: false,
      reason,
      mode: processConfig?.mode ?? null,
    };
  }

  const existingStop = telemetrySourceStopOperations.get(child);
  if (existingStop) {
    return existingStop;
  }

  const stopPromise = performManagedTelemetrySourceStop(
    child,
    processConfig,
    generation,
    reason,
  );
  telemetrySourceStopOperations.set(child, stopPromise);
  try {
    return await stopPromise;
  } finally {
    if (telemetrySourceStopOperations.get(child) === stopPromise) {
      telemetrySourceStopOperations.delete(child);
    }
  }
}

function beginObserverFeedRecovery(config, errorMessage, widgetReason) {
  if (!observerFeedSupervisor.isActiveFor(config)) {
    return {
      scheduled: false,
      status: observerFeedSupervisor.getStatus(),
    };
  }

  setWidgetDirectObserverPollingAllowed(false);
  observerFeedHealthWatchdog.stop();
  clearWidgetRuntimeState(widgetReason);
  const recovery = observerFeedSupervisor.handleUnexpectedExit(config, {
    error: errorMessage,
  });
  const recovering =
    recovery.status.state === "waiting" ||
    recovery.status.state === "restarting";
  setObserverFeedState({
    enabled: recovering,
    running: false,
    mode: recovering ? "direct" : "off",
    managed: recovering,
    matchId: config.matchId || null,
    sessionId: config.sessionId || null,
    pid: null,
    scriptPath: config.scriptPath || null,
    ready: false,
    lastError: recovery.status.lastError || errorMessage,
    lastStoppedAt: new Date().toISOString(),
  });
  refreshLocalRuntimeLifecyclePoller();
  return recovery;
}

function attachTelemetrySourceProcessHandlers(child, config, generation) {
  let terminationHandled = false;
  let lastProcessError = null;

  const handleTermination = ({ code = null, signal = null, error = null }) => {
    if (terminationHandled) {
      return;
    }
    terminationHandled = true;

    const pid = child.pid ?? null;
    const terminationError = error || lastProcessError;
    const intentionalStop = telemetrySourceStoppingProcesses.has(child);
    telemetrySourceStoppingProcesses.delete(child);
    const ownsCurrentRuntime =
      telemetryBridgeProcess === child &&
      telemetrySourceProcessConfig === config &&
      telemetrySourceProcessGeneration === generation;

    if (ownsCurrentRuntime && !intentionalStop) {
      telemetryBridgeProcess = null;
      telemetrySourceProcessConfig = null;
    }

    if (isDirectTelemetrySourceConfig(config) && ownsCurrentRuntime) {
      if (intentionalStop) {
        setObserverFeedState({
          ready: false,
        });
      } else {
        const errorMessage =
          terminationError instanceof Error && terminationError.message
            ? terminationError.message
            : code !== null
              ? `ob.js exited unexpectedly (code ${code}).`
              : "ob.js exited unexpectedly.";
        const recovery = beginObserverFeedRecovery(
          config,
          errorMessage,
          error
            ? "observer-feed-process-error"
            : "observer-feed-process-exited",
        );
        if (
          recovery.scheduled !== true &&
          recovery.status.state === "idle" &&
          !isChildProcessRunning(telemetryBridgeProcess)
        ) {
          resetObserverFeedState({
            matchId: config.matchId || null,
            sessionId: config.sessionId || null,
            scriptPath: config.scriptPath || null,
            lastError: errorMessage,
            lastStoppedAt: new Date().toISOString(),
          });
        }
      }
    }

    log(
      terminationError ? "[launcher] ob.js failed" : "[launcher] ob.js exited",
      {
        code,
        signal,
        intentionalStop,
        ownsCurrentRuntime,
        generation,
        pid,
        mode: config?.mode ?? null,
        matchId: config?.matchId ?? null,
        scriptPath: config?.scriptPath ?? null,
        error:
          terminationError instanceof Error ? terminationError.message : null,
      },
    );
  };

  child.once("exit", (code, signal) => {
    handleTermination({ code, signal });
  });

  child.once("close", (code, signal) => {
    handleTermination({ code, signal });
  });

  child.once("error", (error) => {
    lastProcessError = error;
    if (telemetryBridgeProcess === child && child.pid) {
      void performManagedTelemetrySourceStop(
        child,
        config,
        generation,
        "process-error",
      ).catch((stopError) => {
        logError("[launcher] failed to stop errored ob.js runtime", {
          pid: child.pid,
          error:
            stopError instanceof Error ? stopError.message : String(stopError),
        });
      });
    }
    if (!child.pid) {
      handleTermination({ error });
    }
  });
}

async function isShadowTelemetryAvailable(options = {}) {
  const health = await probeShadowTelemetryHealth(options);
  return health?.reachable === true;
}

async function probeShadowTelemetryHealth(options = {}) {
  const now = Date.now();
  if (
    options.force !== true &&
    shadowTelemetryDiscoveryCache.health &&
    now - shadowTelemetryDiscoveryCache.checkedAt <
      SHADOW_TELEMETRY_DISCOVERY_CACHE_MS
  ) {
    return { ...shadowTelemetryDiscoveryCache.health };
  }

  const checkedAt = new Date().toISOString();
  const candidates = options.expectedRuntime
    ? [getShadowTelemetryBaseUrl()]
    : getShadowTelemetryCandidateBaseUrls();
  let lastHealth = null;

  for (const candidate of candidates) {
    const health = await probeShadowTelemetryBaseUrl(candidate, checkedAt, {
      allowSocketFallback:
        !options.expectedRuntime &&
        (candidate === getShadowTelemetryBaseUrl() ||
          candidate === DEFAULT_SHADOW_TELEMETRY_BASE_URL),
      expectedRuntime: options.expectedRuntime || null,
      localAccessToken: options.localAccessToken || null,
    });
    lastHealth = health;
    if (health.reachable === true) {
      persistShadowTelemetryBaseUrl(health.baseUrl, "discovery");
      shadowTelemetryDiscoveryCache = {
        checkedAt: Date.now(),
        health,
      };
      return { ...health };
    }
  }

  const result = lastHealth || {
    reachable: false,
    baseUrl: getShadowTelemetryBaseUrl(),
    lastResponseAt: null,
    lastCheckedAt: checkedAt,
    lastError: "ShadowTracker did not respond.",
  };
  shadowTelemetryDiscoveryCache = {
    checkedAt: Date.now(),
    health: result,
  };
  return { ...result };
}

async function probeShadowTelemetryHealthWithRecovery() {
  const initialProbe = await probeShadowTelemetryHealth();
  if (initialProbe?.reachable === true) {
    return initialProbe;
  }

  const now = Date.now();
  if (
    now - lastShadowTelemetryRecoveryAttemptAt <
    SHADOW_TELEMETRY_RECOVERY_COOLDOWN_MS
  ) {
    return initialProbe;
  }
  lastShadowTelemetryRecoveryAttemptAt = now;

  const recovery = await ensureTelemetrySourceRunning({ mode: "local" });
  const recoveredProbe = await probeShadowTelemetryHealth({ force: true });
  if (recoveredProbe?.reachable === true) {
    return recoveredProbe;
  }

  if (recovery?.error) {
    return {
      ...recoveredProbe,
      lastError: recovery.error,
    };
  }

  return recoveredProbe;
}

async function waitForShadowTelemetryReady(
  timeoutMs = SHADOW_TELEMETRY_READY_TIMEOUT_MS,
  expectedConfig = null,
  signal = null,
) {
  const startedAt = Date.now();
  const expectedRuntime = getExpectedObserverRuntime(expectedConfig);
  while (Date.now() - startedAt <= timeoutMs) {
    if (signal?.aborted === true) {
      return false;
    }
    if (
      await isShadowTelemetryAvailable({
        force: true,
        expectedRuntime,
        localAccessToken: expectedConfig?.localControlToken || null,
      })
    ) {
      return true;
    }
    if (signal?.aborted === true) {
      return false;
    }
    await sleep(SHADOW_TELEMETRY_READY_POLL_MS);
  }
  return false;
}

async function ensureTelemetrySourceRunning(options = {}) {
  const desiredMode = options?.mode === "direct" ? "direct" : "local";
  if (options?.signal?.aborted === true) {
    return {
      pid: null,
      scriptPath: null,
      started: false,
      alreadyRunning: false,
      ready: false,
      baseUrl: getShadowTelemetryBaseUrl(),
      connector: getConnectorSetupStatusView(),
      error: "Observer feed recovery was cancelled.",
    };
  }
  const connector = ensureManagedTelemetryBridgeInstalled({
    shadowTrackerPath: options?.shadowTrackerPath,
  });
  if (!connector.ok) {
    return {
      pid: null,
      scriptPath: connector.targetPath || null,
      started: false,
      alreadyRunning: false,
      ready: false,
      baseUrl: getShadowTelemetryBaseUrl(),
      connector,
      error: connector.error || "Arenzyra connector setup failed.",
    };
  }
  let managedRuntimeInputs;
  try {
    managedRuntimeInputs = prepareManagedConnectorRuntimeInputs(connector);
  } catch (error) {
    return {
      pid: null,
      scriptPath: connector.sourcePath || null,
      started: false,
      alreadyRunning: false,
      ready: false,
      baseUrl: getShadowTelemetryBaseUrl(),
      connector,
      error:
        error instanceof Error
          ? error.message
          : "Managed connector runtime inputs failed verification.",
    };
  }
  const resolvedScriptPath = managedRuntimeInputs.scriptPath;
  const desiredConfig =
    desiredMode === "direct"
      ? {
          mode: "direct",
          apiBase: normalizeBaseUrl(options?.apiBase),
          observerBaseUrl: normalizeShadowTelemetryBaseUrl(
            options?.observerBaseUrl || getShadowTelemetryBaseUrl(),
          ),
          matchId: requireMatchId(options?.matchId),
          sessionId: String(options?.sessionId || "").trim(),
          feedToken: String(options?.feedToken || "").trim(),
          runtimeNonce: String(options?.runtimeNonce || randomUUID()).trim(),
          localControlToken: String(
            connectorAccessToken,
          ).trim(),
          mapKey: String(
            options?.mapKey || productionModeState.selectedMapKey || "",
          )
            .trim()
            .toLowerCase(),
          scriptPath: resolvedScriptPath || telemetryBridgeScriptPath || null,
        }
      : {
          mode: "local",
          observerBaseUrl: normalizeShadowTelemetryBaseUrl(
            options?.observerBaseUrl || getShadowTelemetryBaseUrl(),
          ),
          runtimeNonce: String(options?.runtimeNonce || randomUUID()).trim(),
          localControlToken: String(
            connectorAccessToken,
          ).trim(),
          scriptPath: resolvedScriptPath || telemetryBridgeScriptPath || null,
        };

  if (desiredMode === "direct") {
    if (!desiredConfig.sessionId) {
      return {
        pid: null,
        scriptPath: desiredConfig.scriptPath,
        started: false,
        alreadyRunning: false,
        ready: false,
        baseUrl: getShadowTelemetryBaseUrl(),
        connector,
        error: "Observer feed sessionId is required.",
      };
    }

    if (!desiredConfig.feedToken) {
      return {
        pid: null,
        scriptPath: desiredConfig.scriptPath,
        started: false,
        alreadyRunning: false,
        ready: false,
        baseUrl: getShadowTelemetryBaseUrl(),
        connector,
        error: "Observer feed token is required.",
      };
    }
  }

  if (
    desiredMode !== "direct" &&
    isChildProcessRunning(telemetryBridgeProcess) &&
    !isDirectTelemetrySourceConfig(telemetrySourceProcessConfig) &&
    (await isShadowTelemetryAvailable({
      force: true,
      expectedRuntime: getExpectedObserverRuntime(
        telemetrySourceProcessConfig,
      ),
      localAccessToken:
        telemetrySourceProcessConfig?.localControlToken || null,
    }))
  ) {
    if (resolvedScriptPath) {
      telemetryBridgeScriptPath = resolvedScriptPath;
    }
    return {
      pid: telemetryBridgeProcess?.pid ?? null,
      scriptPath: resolvedScriptPath || telemetryBridgeScriptPath || null,
      started: false,
      alreadyRunning: true,
      ready: true,
      baseUrl: getShadowTelemetryBaseUrl(),
      connector,
      error: null,
    };
  }

  if (isChildProcessRunning(telemetryBridgeProcess)) {
    if (
      desiredMode !== "direct" &&
      isDirectTelemetrySourceConfig(telemetrySourceProcessConfig)
    ) {
      const ready = await waitForShadowTelemetryReady();
      return {
        pid: telemetryBridgeProcess?.pid ?? null,
        scriptPath: telemetryBridgeScriptPath || resolvedScriptPath || null,
        started: false,
        alreadyRunning: true,
        ready,
        baseUrl: getShadowTelemetryBaseUrl(),
        connector,
        error: null,
      };
    }

    if (
      sameTelemetrySourceConfig(telemetrySourceProcessConfig, desiredConfig)
    ) {
      const currentConfig = telemetrySourceProcessConfig;
      const ready = await waitForShadowTelemetryReady(
        SHADOW_TELEMETRY_READY_TIMEOUT_MS,
        currentConfig,
        options?.signal,
      );
      if (desiredMode === "direct") {
        setObserverFeedState({
          enabled: true,
          running: isChildProcessRunning(telemetryBridgeProcess),
          mode: "direct",
          managed: true,
          matchId: currentConfig.matchId,
          sessionId: currentConfig.sessionId,
          pid: telemetryBridgeProcess?.pid ?? null,
          scriptPath: telemetryBridgeScriptPath || resolvedScriptPath || null,
          ready,
          lastError: ready
            ? null
            : "The owned observer connector did not pass its identity health check.",
        });
        if (!ready) {
          const stopResult =
            await stopManagedTelemetrySourceProcess("readiness-timeout");
          setObserverFeedState({
            running: stopResult.ok !== true,
            pid: stopResult.ok === true ? null : telemetryBridgeProcess?.pid,
            ready: false,
            lastError:
              stopResult.ok === true
                ? "The owned observer connector did not pass its identity health check."
                : stopResult.error,
          });
        } else {
          void scheduleObserverMapFallbackSync(
            currentConfig.matchId,
            getDesiredObserverFallbackMapKey(
              currentConfig.matchId,
              currentConfig.mapKey,
            ),
          );
        }
      }
      return {
        pid: ready ? (telemetryBridgeProcess?.pid ?? null) : null,
        scriptPath: telemetryBridgeScriptPath || resolvedScriptPath || null,
        started: false,
        alreadyRunning: true,
        ready,
        baseUrl: getShadowTelemetryBaseUrl(),
        connector,
        error:
          desiredMode === "direct" && !ready
            ? "The owned observer connector did not pass its identity health check."
            : null,
      };
    }

    const stopResult = await stopManagedTelemetrySourceProcess("restart");
    if (stopResult.ok !== true) {
      return {
        pid: telemetryBridgeProcess?.pid ?? null,
        scriptPath: desiredConfig.scriptPath,
        started: false,
        alreadyRunning: true,
        ready: false,
        baseUrl: getShadowTelemetryBaseUrl(),
        connector,
        error: stopResult.error,
      };
    }
  }

  if (
    desiredMode === "direct" &&
    (await isShadowTelemetryAvailable({ force: true }))
  ) {
    return {
      pid: null,
      scriptPath: desiredConfig.scriptPath,
      started: false,
      alreadyRunning: false,
      ready: false,
      baseUrl: getShadowTelemetryBaseUrl(),
      connector,
      error:
        "A local ob.js endpoint is already active outside the launcher. Stop the external process before enabling Observer Feed.",
    };
  }

  if (!resolvedScriptPath) {
    telemetryBridgeScriptPath = "";
    return {
      pid: null,
      scriptPath: null,
      started: false,
      alreadyRunning: false,
      ready: false,
      baseUrl: getShadowTelemetryBaseUrl(),
      connector,
      error: app.isPackaged
        ? `ob.js was not found. Expected it at ${DEFAULT_TELEMETRY_BRIDGE_SCRIPT}.`
        : `ob.js was not found. Expected it at ${DEFAULT_TELEMETRY_BRIDGE_SCRIPT} or in the repo root.`,
    };
  }

  telemetryBridgeScriptPath = resolvedScriptPath;
  desiredConfig.scriptPath = resolvedScriptPath;
  log("[launcher] resolved telemetry source script", {
    mode: desiredMode,
    scriptPath: resolvedScriptPath,
    derivedFromShadowTracker:
      resolveTelemetryBridgeScriptFromShadowTrackerPath(
        resolveShadowTrackerExecutable(configManager.getShadowTrackerPath(), {
          preferRunning: true,
        }),
      ) || null,
    baseUrl: getShadowTelemetryBaseUrl(),
  });

  if (options?.signal?.aborted === true) {
    return {
      pid: null,
      scriptPath: resolvedScriptPath,
      started: false,
      alreadyRunning: false,
      ready: false,
      baseUrl: getShadowTelemetryBaseUrl(),
      connector,
      error: "Observer feed recovery was cancelled.",
    };
  }

  let spawnedChild = null;
  let spawnedGeneration = null;
  try {
    // Re-hash the trusted source and support files at the final launch boundary;
    // never execute the mutable copy installed inside the PCOB tree.
    managedRuntimeInputs = prepareManagedConnectorRuntimeInputs(connector);
    const child = spawnNodeScript(
      resolvedScriptPath,
      buildTelemetrySourceProcessEnv(desiredConfig),
      { dependencyRoots: managedRuntimeInputs.dependencyRoots },
    );
    spawnedChild = child;
    spawnedGeneration = telemetrySourceProcessGeneration + 1;
    telemetrySourceProcessGeneration = spawnedGeneration;
    telemetryBridgeProcess = child;
    telemetrySourceProcessConfig = desiredConfig;
    attachTelemetrySourceProcessHandlers(
      child,
      desiredConfig,
      spawnedGeneration,
    );

    if (desiredMode === "direct") {
      setObserverFeedState({
        enabled: true,
        running: true,
        mode: "direct",
        managed: true,
        matchId: desiredConfig.matchId,
        sessionId: desiredConfig.sessionId,
        pid: child.pid ?? null,
        scriptPath: resolvedScriptPath,
        ready: false,
        lastError: null,
        lastStartedAt: new Date().toISOString(),
      });
    }

    const ready = await waitForShadowTelemetryReady(
      SHADOW_TELEMETRY_READY_TIMEOUT_MS,
      desiredConfig,
      options?.signal,
    );
    if (options?.signal?.aborted === true) {
      const stopResult =
        await stopManagedTelemetrySourceProcess("startup-cancelled");
      if (stopResult.ok !== true) {
        throw new Error(stopResult.error);
      }
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new Error("Observer feed startup was cancelled.");
    }
    if (
      telemetryBridgeProcess !== child ||
      telemetrySourceProcessConfig !== desiredConfig ||
      telemetrySourceProcessGeneration !== spawnedGeneration ||
      !isChildProcessRunning(child)
    ) {
      throw new Error("Observer connector exited before it became ready.");
    }
    if (desiredMode === "direct" && !ready) {
      const stopResult =
        await stopManagedTelemetrySourceProcess("readiness-timeout");
      if (stopResult.ok !== true) {
        throw new Error(stopResult.error);
      }
      throw new Error(
        "The owned observer connector did not pass its identity health check.",
      );
    }
    if (desiredMode === "direct") {
      setObserverFeedState({
        enabled: true,
        running: true,
        mode: "direct",
        managed: true,
        matchId: desiredConfig.matchId,
        sessionId: desiredConfig.sessionId,
        pid: child.pid ?? null,
        scriptPath: resolvedScriptPath,
        ready,
        lastError: null,
        lastStartedAt: new Date().toISOString(),
      });
      void scheduleObserverMapFallbackSync(
        desiredConfig.matchId,
        getDesiredObserverFallbackMapKey(
          desiredConfig.matchId,
          desiredConfig.mapKey,
        ),
      );
    }
    return {
      pid: child.pid ?? null,
      scriptPath: resolvedScriptPath,
      started: true,
      alreadyRunning: false,
      ready,
      baseUrl: getShadowTelemetryBaseUrl(),
      connector,
      error: null,
    };
  } catch (error) {
    let startupError = error;
    const ownsFailedRuntime =
      spawnedChild !== null &&
      telemetryBridgeProcess === spawnedChild &&
      telemetrySourceProcessConfig === desiredConfig &&
      telemetrySourceProcessGeneration === spawnedGeneration;
    if (ownsFailedRuntime) {
      const stopResult =
        await stopManagedTelemetrySourceProcess("startup-failed");
      if (stopResult.ok !== true && options?.signal?.aborted !== true) {
        startupError = new Error(stopResult.error);
      }
    }
    if (
      desiredMode === "direct" &&
      options?.signal?.aborted !== true &&
      !isChildProcessRunning(telemetryBridgeProcess)
    ) {
      const errorMessage =
        startupError instanceof Error
          ? startupError.message
          : String(startupError || "Failed to start ob.js.");
      if (observerFeedSupervisor.isActiveFor(desiredConfig)) {
        setObserverFeedState({
          enabled: true,
          running: false,
          mode: "direct",
          managed: true,
          matchId: desiredConfig.matchId,
          sessionId: desiredConfig.sessionId,
          pid: null,
          scriptPath: desiredConfig.scriptPath,
          ready: false,
          lastError: errorMessage,
          lastStoppedAt: new Date().toISOString(),
        });
      } else {
        resetObserverFeedState({
          lastError: errorMessage,
          lastStoppedAt: new Date().toISOString(),
        });
      }
    }
    return {
      pid: null,
      scriptPath: resolvedScriptPath,
      started: false,
      alreadyRunning: false,
      ready: false,
      baseUrl: getShadowTelemetryBaseUrl(),
      connector,
      error:
        startupError instanceof Error
          ? startupError.message
          : String(startupError || "Failed to start ob.js."),
    };
  }
}

async function startObserverFeedForMatch(matchId) {
  const startedAt = Date.now();
  const session = getStoredSession();
  assertLauncherAccess();
  const requestedMatchId = requireMatchId(matchId);
  assertProductionModeReadyForMatch(requestedMatchId);

  if (telemetryBridge.getStatus().running) {
    throw new Error(
      "Stop the Telemetry Bridge before enabling the direct Observer Feed.",
    );
  }

  if (visualModeService.getStatus().running) {
    throw new Error(
      "Stop Visual Mode before enabling the direct Observer Feed.",
    );
  }

  const currentFeed = getObserverFeedStatusView();
  if (
    isObserverFeedSessionActive(currentFeed) &&
    currentFeed.matchId === requestedMatchId &&
    typeof currentFeed.sessionId === "string" &&
    currentFeed.sessionId.trim()
  ) {
    logger.child("production").info("[LiveDesk] Observer feed reused", {
      matchId: requestedMatchId,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    return {
      ...currentFeed,
      alreadyRunning: true,
      connector: getConnectorSetupStatusView(),
    };
  }
  if (isObserverFeedSessionActive(currentFeed)) {
    throw new Error(
      "Stop the current Observer Feed before starting it for another match.",
    );
  }

  observerFeedHealthWatchdog.stop();
  observerFeedSupervisor.disarm();
  const startOperation = observerFeedStartGate.begin();
  const sessionId = randomUUID();
  const selectedMapKey = getDesiredObserverFallbackMapKey(
    requestedMatchId,
    productionModeState.selectedMapKey,
  );
  setObserverFeedState({
    enabled: true,
    running: false,
    mode: "direct",
    managed: true,
    matchId: requestedMatchId,
    sessionId,
    pid: null,
    ready: false,
    lastError: null,
  });
  refreshLocalRuntimeLifecyclePoller();

  try {
    startOperation.assertCurrent();
    const pinnedMatchId = await pinSelectedMatchLive(
      session,
      requestedMatchId,
      sessionId,
      { signal: startOperation.signal },
    );
    startOperation.assertCurrent();

    const confirmedLifecycle = await assertMatchLifecycleStartable(
      session,
      pinnedMatchId,
      { signal: startOperation.signal },
    );
    startOperation.assertCurrent();
    const confirmedSessionId = getObserverFeedBoundSessionId(
      confirmedLifecycle.control,
    );
    if (
      confirmedLifecycle.lifecycleStatus === "LIVE" &&
      confirmedSessionId &&
      confirmedSessionId !== sessionId
    ) {
      throw new Error(
        "Observer feed start was blocked because the match session binding changed.",
      );
    }

    const tokenBundle = await createObserverFeedToken(session, {
      signal: startOperation.signal,
    });
    startOperation.assertCurrent();
    const source = await ensureTelemetrySourceRunning({
      mode: "direct",
      apiBase: session.apiBase,
      matchId: pinnedMatchId,
      sessionId,
      feedToken: tokenBundle.accessToken,
      mapKey: selectedMapKey,
      signal: startOperation.signal,
    });
    startOperation.assertCurrent();

    if (source?.error) {
      throw new Error(source.error);
    }

    if (
      !isChildProcessRunning(telemetryBridgeProcess) ||
      !isDirectTelemetrySourceConfig(telemetrySourceProcessConfig) ||
      String(telemetrySourceProcessConfig.sessionId || "").trim() !== sessionId
    ) {
      throw new Error(
        "Observer connector did not remain running after startup.",
      );
    }

    startOperation.assertCurrent();
    observerFeedSupervisor.arm(telemetrySourceProcessConfig);
    observerFeedHealthWatchdog.start(telemetrySourceProcessConfig);

    setWidgetDirectObserverPollingAllowed(true);
    refreshLocalRuntimeLifecyclePoller();
    const status = getObserverFeedStatusView();
    logger.child("production").info("[LiveDesk] Observer feed started", {
      matchId: requestedMatchId,
      durationMs: Math.max(0, Date.now() - startedAt),
      ready: status.ready === true,
      pid: status.pid ?? null,
    });
    return {
      ...status,
      alreadyRunning: false,
      connector: source?.connector || getConnectorSetupStatusView(),
      expiresIn: tokenBundle.expiresIn,
    };
  } catch (error) {
    const cancelled =
      startOperation.signal.aborted === true ||
      startOperation.isCurrent() !== true ||
      isObserverFeedStartCancelledError(error);
    const ownsStartedRuntime =
      isDirectTelemetrySourceConfig(telemetrySourceProcessConfig) &&
      String(telemetrySourceProcessConfig.sessionId || "").trim() === sessionId;
    let stopFailure = null;
    if (ownsStartedRuntime) {
      const stopResult = await stopManagedTelemetrySourceProcess(
        cancelled ? "startup-cancelled" : "startup-failed",
      );
      if (stopResult.ok !== true) {
        stopFailure = stopResult;
      }
    }

    if (!cancelled && startOperation.isCurrent()) {
      observerFeedHealthWatchdog.stop();
      observerFeedSupervisor.disarm();
      setWidgetDirectObserverPollingAllowed(false);
      if (stopFailure) {
        setObserverFeedState({
          enabled: false,
          running: true,
          ready: false,
          lastError: stopFailure.error,
        });
      } else {
        resetObserverFeedState({
          lastError:
            error instanceof Error
              ? error.message
              : String(error || "Observer feed startup failed."),
          lastStoppedAt: new Date().toISOString(),
        });
      }
      clearWidgetRuntimeState("observer-feed-start-failed");
      refreshLocalRuntimeLifecyclePoller();
    }

    if (stopFailure) {
      const stopError = new Error(stopFailure.error);
      stopError.code = "ARENZYRA_OBSERVER_FEED_STOP_FAILED";
      stopError.stopResult = stopFailure;
      throw stopError;
    }
    if (cancelled && startOperation.signal.reason instanceof Error) {
      throw startOperation.signal.reason;
    }
    throw error;
  } finally {
    startOperation.finish();
  }
}

async function stopObserverFeed(reason = "stopped") {
  observerFeedStartGate.cancel(reason);
  const currentFeed = getObserverFeedStatusView();
  observerFeedHealthWatchdog.stop();
  observerFeedSupervisor.disarm();
  setWidgetDirectObserverPollingAllowed(false);
  setObserverFeedState({
    enabled: false,
    ready: false,
  });
  const stopResult = await stopManagedTelemetrySourceProcess(reason);
  if (stopResult.ok !== true) {
    const failedState = setObserverFeedState({
      enabled: false,
      running: true,
      mode: currentFeed.mode,
      managed: true,
      matchId: currentFeed.matchId,
      sessionId: currentFeed.sessionId,
      pid: stopResult.pid ?? currentFeed.pid,
      ready: false,
      lastError: stopResult.error,
    });
    clearWidgetRuntimeState(reason);
    refreshLocalRuntimeLifecyclePoller();
    const error = new Error(stopResult.error);
    error.code = "ARENZYRA_OBSERVER_FEED_STOP_FAILED";
    error.stopResult = stopResult;
    error.observerFeed = failedState;
    throw error;
  }
  const nextState = resetObserverFeedState({
    lastStoppedAt: new Date().toISOString(),
    lastError: null,
    scriptPath: currentFeed.scriptPath,
  });
  clearWidgetRuntimeState(reason);
  refreshLocalRuntimeLifecyclePoller();
  return nextState;
}

async function stopObserverFeedSilently(reason = "stopped") {
  try {
    const status = await stopObserverFeed(reason);
    return { ok: true, status };
  } catch (error) {
    logError("[Observer Feed] Safe stop did not complete", {
      reason,
      error:
        error instanceof Error
          ? error.message
          : String(error || "Unknown stop error"),
    });
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : String(error || "Unknown stop error"),
      status: getObserverFeedStatusView(),
    };
  }
}

function getLauncherDefaults(apiBase) {
  const resolvedShadowTrackerPath =
    resolveShadowTrackerExecutable(configManager.getShadowTrackerPath(), {
      preferRunning: true,
    }) || configManager.getShadowTrackerPath();
  return {
    apiBase: normalizeBaseUrl(apiBase),
    teamAssetsDir: TEAM_ASSETS_DIR,
    brandingConfigPath: getBrandingConfigPath(),
    shadowTrackerPath: resolvedShadowTrackerPath,
    telemetryBridgeAvailable: true,
    sessionPath: sessionManager.getSessionPath(),
  };
}

function buildStartupBootstrapPayload(apiBase) {
  const resolvedApiBase = normalizeBaseUrl(apiBase);
  const defaults = getLauncherDefaults(resolvedApiBase);
  const bootstrapStatus = bootstrapService.getStatus();
  const authStage = bootstrapStatus?.stages?.AUTH_VALIDATION;
  const licenseStage = bootstrapStatus?.stages?.LICENSE_CHECK;
  const seatStage = bootstrapStatus?.stages?.SEAT_ACQUIRE;

  if (
    authStage?.status !== "completed" ||
    authStage?.meta?.authenticated !== true
  ) {
    return {
      ...defaults,
      session: null,
      access: null,
    };
  }

  if (licenseStage?.status === "failed" || seatStage?.status === "failed") {
    return {
      ...defaults,
      session: null,
      access: null,
    };
  }

  const storedSession = sessionManager.readSession();
  return {
    ...defaults,
    session: toSessionView(storedSession),
    access: toAccessView(launcherAccessState),
  };
}

async function bootstrapLauncher(apiBaseHint) {
  const adoptedApiBase = adoptBootstrapApiBaseHint(apiBaseHint);
  const resolvedApiBase = normalizeBaseUrl(adoptedApiBase);
  const defaults = getLauncherDefaults(resolvedApiBase);

  if (!didConsumeStartupBootstrapResult) {
    didConsumeStartupBootstrapResult = true;
    await bootstrapService.bootstrap();
    return buildStartupBootstrapPayload(resolvedApiBase);
  }

  const storedSession = sessionManager.readSession();

  if (!storedSession?.token && !storedSession?.refreshToken) {
    stopLauncherHeartbeat();
    launcherAccessState = null;
    startupLicenseStatus = null;
    return {
      ...defaults,
      session: null,
      access: null,
    };
  }

  try {
    const restored = await apiClient.restoreSession({
      apiBase: resolvedApiBase,
      token: storedSession.token,
      refreshToken: storedSession.refreshToken,
    });
    const nextSession = persistStoredSession({
      apiBase: restored.apiBase,
      token: restored.accessToken,
      accessToken: restored.accessToken,
      refreshToken: restored.refreshToken || storedSession.refreshToken,
      user: restored.user,
      organization: restored.organization,
    });
    const access = await evaluateLauncherAccess(nextSession);
    return {
      ...getLauncherDefaults(restored.apiBase),
      session: toSessionView(nextSession),
      access: toAccessView(access),
    };
  } catch (error) {
    if (isRecoverableBootstrapAuthError(error)) {
      stopLauncherHeartbeat();
      launcherAccessState = null;
      sessionManager.clearSession();
      startupLicenseStatus = null;
      return {
        ...defaults,
        session: null,
        access: null,
      };
    }
    throw error;
  }
}

if (singleInstanceLock) {
  app.on("second-instance", (_event, argv) => {
    consumeProtocolArguments(argv);
    focusMainWindow();
  });

  app.on("open-url", (event, urlValue) => {
    event.preventDefault();
    consumeProtocolArguments([urlValue]);
  });
}

async function loginLauncher(params) {
  const keepSignedIn = params?.keepSignedIn !== false;
  const resolvedApiBase = normalizeBaseUrl(params?.apiBase);
  const loginResult = await apiClient.login({
    apiBase: resolvedApiBase,
    email: params?.email,
    password: params?.password,
  });
  persistUserConfiguredApiBase(resolvedApiBase, "login");
  configManager.setSettings({ keepSignedIn });
  broadcastConfigUpdate("login");

  const nextSession = persistStoredSession({
    apiBase: loginResult.apiBase,
    token: loginResult.accessToken,
    accessToken: loginResult.accessToken,
    refreshToken: loginResult.refreshToken,
    user: loginResult.user,
    organization: loginResult.organization,
  });
  const access = await evaluateLauncherAccess(nextSession);
  await refreshWidgetHotkeyControlApproval(nextSession, {
    throwOnError: false,
  });

  return {
    apiBase: loginResult.apiBase,
    session: toSessionView(nextSession),
    access: toAccessView(access),
  };
}

if (singleInstanceLock) {
  app.whenReady().then(async () => {
    if (process.platform === "win32") {
      app.setAppUserModelId(APP_USER_MODEL_ID);
    }
    log("[launcher] structured logger ready", {
      logsDir: path.join(app.getPath("userData"), "logs"),
    });
    visualModeService.cleanupOrphanedCaptures({ force: true });
    await startWidgetServerForObsRecovery("app-ready");
    await bootstrapService.bootstrap();
    registerTrustedLauncherHandle("launcher:getConfig", () =>
      getLauncherConfigView(),
    );

    registerTrustedLauncherHandle("launcher:setConfig", (_event, payload) =>
      setLauncherConfigValue(payload?.key, payload?.value, "renderer"),
    );

    registerTrustedLauncherHandle("launcher:getDefaults", () =>
      getLauncherDefaults(),
    );

    registerTrustedLauncherOn("launcher:pathExists", (event, payload) => {
      event.returnValue = pathExistsOnDisk(payload?.targetPath);
    });

    registerTrustedLauncherOn("launcher:isFile", (event, payload) => {
      event.returnValue = isFileOnDisk(payload?.targetPath);
    });

    registerTrustedLauncherHandle(
      "launcher:bootstrap",
      async (_event, payload) => bootstrapLauncher(payload?.apiBase),
    );

    registerTrustedLauncherHandle("launcher:login", async (_event, payload) =>
      loginLauncher(payload),
    );

    registerTrustedLauncherHandle("launcher:logout", () =>
      endLauncherSession({ clearAuth: true }),
    );

    registerTrustedLauncherHandle(
      "launcher:chooseFile",
      async (_event, options) => {
        const result = await dialog.showOpenDialog({
          title: options?.title || "Select file",
          defaultPath: options?.defaultPath || undefined,
          properties: ["openFile"],
          filters: Array.isArray(options?.filters)
            ? options.filters
            : undefined,
        });
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        return result.filePaths[0];
      },
    );

    registerTrustedLauncherHandle("launcher:copyText", (_event, payload) => {
      const text = String(payload?.text || "");
      clipboard.writeText(text);
      return { ok: true };
    });

    registerTrustedLauncherHandle(
      "launcher:openExternal",
      async (_event, payload) => {
        const url = normalizeHttpUrl(payload?.url);
        await shell.openExternal(url);
        return { ok: true };
      },
    );

    registerTrustedLauncherHandle(
      "launcher:getLiveMatch",
      async (_event, payload) => {
        let session = null;
        try {
          session = getStoredSession();
        } catch {
          session = null;
        }
        const requestedApiBase = normalizeBaseUrl(
          payload?.apiBase || session?.apiBase,
        );
        if (session && requestedApiBase === normalizeBaseUrl(session.apiBase)) {
          return refreshAuthoritativeLiveMatchMap(session);
        }
        return fetchLiveMatch(requestedApiBase, session);
      },
    );

    registerTrustedLauncherHandle(
      "launcher:getNextMatchSuggestion",
      async (_event, payload) => {
        const session = getStoredSession();
        assertLauncherAccess();
        return apiClient.getNextMatchSuggestion({
          apiBase: session.apiBase,
          token: session.token,
          refreshToken: session.refreshToken,
          matchId: payload?.matchId,
          suggestedMatchId: payload?.suggestedMatchId,
        });
      },
    );

    registerTrustedLauncherHandle("launcher:listTournaments", async () => {
      const session = getStoredSession();
      assertLauncherAccess();
      return apiClient.listTournaments({
        apiBase: session.apiBase,
        token: session.token,
        refreshToken: session.refreshToken,
      });
    });

    registerTrustedLauncherHandle(
      "launcher:listStages",
      async (_event, payload) => {
        const session = getStoredSession();
        assertLauncherAccess();
        return apiClient.listStages({
          apiBase: session.apiBase,
          token: session.token,
          refreshToken: session.refreshToken,
          tournamentId: payload?.tournamentId,
        });
      },
    );

    registerTrustedLauncherHandle(
      "launcher:listMatches",
      async (_event, payload) => {
        const session = getStoredSession();
        assertLauncherAccess();
        return apiClient.listMatches({
          apiBase: session.apiBase,
          token: session.token,
          refreshToken: session.refreshToken,
          tournamentId: payload?.tournamentId,
        });
      },
    );

    registerTrustedLauncherHandle(
      "launcher:getMatchControl",
      async (_event, payload) => {
        const session = getStoredSession();
        assertLauncherAccess();
        const { control } = await fetchMatchControlState(
          session,
          payload?.matchId,
        );
        return control;
      },
    );

    registerTrustedLauncherHandle(
      "launcher:syncTeams",
      async (_event, payload) => {
        const session = getStoredSession();
        assertLauncherAccess();
        return syncTeams(session, payload?.matchId, {
          repairSlots: payload?.repairSlots === true,
        });
      },
    );

    registerTrustedLauncherHandle(
      "launcher:generateBranding",
      async (_event, payload) => {
        const session = getStoredSession();
        assertLauncherAccess();
        return generateBranding(session, payload?.matchId);
      },
    );

    registerTrustedLauncherHandle("launcher:getTelemetryStatus", () =>
      telemetryBridge.getStatus(),
    );

    registerTrustedLauncherHandle("launcher:getObserverFeedStatus", () =>
      getObserverFeedStatusView(),
    );

    registerTrustedLauncherHandle("launcher:listVisualSources", async () => {
      assertLauncherAccess();
      return visualModeService.listSources();
    });

    registerTrustedLauncherHandle("launcher:getVisualModeStatus", () =>
      visualModeService.getStatus(),
    );

    registerTrustedLauncherHandle("launcher:getVisualModeConfig", () =>
      visualModeService.getConfig(),
    );

    registerTrustedLauncherHandle(
      "launcher:setVisualModeConfig",
      (_event, payload) => {
        assertLauncherAccess();
        return visualModeService.setConfig(payload?.config || payload);
      },
    );

    registerTrustedLauncherHandle("launcher:getVisualReviewQueue", () =>
      visualModeService.getReviewQueue(),
    );

    registerTrustedLauncherHandle("launcher:clearVisualReviewQueue", () => {
      assertLauncherAccess();
      return visualModeService.clearReviewQueue();
    });

    registerTrustedLauncherHandle(
      "launcher:captureVisualReviewCandidate",
      async () => {
        assertLauncherAccess();
        return visualModeService.captureReviewCandidate();
      },
    );

    registerTrustedLauncherHandle(
      "launcher:runVisualReviewOcr",
      async (_event, payload) => {
        assertLauncherAccess();
        return runVisualReviewOcrPreview(payload?.id);
      },
    );

    registerTrustedLauncherHandle(
      "launcher:runVisualSlotMap",
      async (_event, payload) => {
        assertLauncherAccess();
        return runVisualSlotMap(payload?.id);
      },
    );

    registerTrustedLauncherHandle(
      "launcher:ignoreVisualReviewItem",
      (_event, payload) => {
        assertLauncherAccess();
        return visualModeService.ignoreReviewItem(payload?.id);
      },
    );

    registerTrustedLauncherHandle(
      "launcher:markVisualReviewItemReviewed",
      (_event, payload) => {
        assertLauncherAccess();
        return visualModeService.markReviewItemReviewed(payload?.id);
      },
    );

    registerTrustedLauncherHandle("launcher:getConnectorStatus", () =>
      getConnectorSetupStatusView(),
    );

    registerTrustedLauncherHandle(
      "launcher:repairConnector",
      (_event, payload) =>
        ensureManagedTelemetryBridgeInstalled({
          shadowTrackerPath: payload?.shadowTrackerPath,
        }),
    );

    registerTrustedLauncherHandle(
      "launcher:updateMatchFlowState",
      (_event, payload) => {
        const switchingWasEligible =
          getPcobMapControlLifecycleStatus().eligible;
        const previousMatchId = matchFlowState.currentMatchId;
        const nextMatchFlowState = normalizeMatchFlowState(payload);
        if (shouldInvalidateProductionModeState(nextMatchFlowState)) {
          productionModeState = createDefaultProductionModeState();
        }
        matchFlowState = nextMatchFlowState;
        if (previousMatchId !== matchFlowState.currentMatchId) {
          cancelPcobObserverConfirmation();
          pcobMapControlLastSelection = null;
        }
        if (
          switchingWasEligible &&
          !getPcobMapControlLifecycleStatus().eligible
        ) {
          cancelPcobObserverConfirmation();
        }
        return { ...matchFlowState };
      },
    );

    registerTrustedLauncherHandle(
      "launcher:enterProductionMode",
      async (_event, payload) => {
        const startedAt = Date.now();
        assertLauncherAccess();
        const requestedShadowTrackerPath =
          String(payload?.shadowTrackerPath || "").trim() ||
          configManager.getShadowTrackerPath() ||
          null;
        const result = await productionModeService.runPreflight({
          matchId: payload?.matchId,
          selectedMatch: payload?.selectedMatch ?? null,
          shadowTrackerPath: requestedShadowTrackerPath,
        });
        const preflightMatchId = String(
          result?.matchId || payload?.matchId || "",
        ).trim();
        if (
          liveMatchMapState.matchId &&
          (!isObserverFeedSessionActive() ||
            liveMatchMapState.matchId !== preflightMatchId)
        ) {
          resetLiveMatchMapSynchronization();
        }
        productionModeState = summarizeProductionModeResult(result);
        logger
          .child("production")
          .info("[LiveDesk] Production preflight completed", {
            matchId: result?.matchId ?? payload?.matchId ?? null,
            status: result?.status ?? null,
            durationMs: Math.max(0, Date.now() - startedAt),
            preflightDurationMs: Number.isFinite(Number(result?.durationMs))
              ? Number(result.durationMs)
              : null,
          });
        if (isProductionReadyStatus(result?.status)) {
          schedulePlayerPhotoCacheRefresh(
            result?.matchId || payload?.matchId,
            3000,
          );
        }
        return result;
      },
    );

    registerTrustedLauncherHandle("launcher:getWidgetServerStatus", () =>
      getWidgetServerStatusView(),
    );

    registerTrustedLauncherHandle(
      "launcher:getPinnedCommentatorDeskWindow",
      () => getPinnedCommentatorDeskWindowStatus(),
    );

    registerTrustedLauncherHandle(
      "launcher:openPinnedCommentatorDeskWindow",
      async (_event, payload) => openPinnedCommentatorDeskWindow(payload),
    );

    registerTrustedLauncherHandle(
      "launcher:closePinnedCommentatorDeskWindow",
      () => closePinnedCommentatorDeskWindow(),
    );

    registerTrustedLauncherHandle(
      "launcher:setPinnedCommentatorDeskClickThrough",
      (_event, payload) =>
        applyPinnedCommentatorDeskClickThrough(payload?.clickThrough === true),
    );

    registerTrustedLauncherHandle("launcher:getPinnedMapControlWindow", () =>
      getPinnedMapControlWindowStatus(),
    );

    registerTrustedLauncherHandle(
      "launcher:getPcobMapControlStatus",
      async () => {
        assertLauncherAccess();
        return getPcobMapControlStatus();
      },
    );

    registerTrustedLauncherHandle(
      "launcher:openPinnedMapControlWindow",
      async (_event, payload) => openPinnedMapControlWindow(payload),
    );

    registerTrustedLauncherHandle("launcher:closePinnedMapControlWindow", () =>
      closePinnedMapControlWindow(),
    );

    registerTrustedLauncherHandle(
      "launcher:setPinnedMapControlAlwaysOnTop",
      (_event, payload) =>
        applyPinnedMapControlAlwaysOnTop(payload?.alwaysOnTop === true),
    );

    ipcMain.handle("map-control:get-status", async (event) => {
      assertMapControlSender(event);
      return getPcobMapControlStatus();
    });

    ipcMain.handle("map-control:select-player", async (event, payload) => {
      assertMapControlSender(event);
      return selectPcobObserverFromMap(payload);
    });

    registerTrustedLauncherHandle("launcher:getAssetStatus", () =>
      getAssetStatusView(),
    );

    registerTrustedLauncherHandle("launcher:getHealthStatus", () =>
      healthService.getStatus(),
    );

    registerTrustedLauncherHandle("launcher:getBootstrapStatus", () =>
      bootstrapService.getStatus(),
    );

    registerTrustedLauncherHandle("launcher:getRecentLogs", (_event, payload) =>
      logger.getRecent(payload?.scope, payload?.limit),
    );

    registerTrustedLauncherHandle(
      "launcher:getWidgetCatalogState",
      async (_event, payload) => getWidgetCatalogState(payload),
    );

    registerTrustedLauncherHandle(
      "launcher:rotateWidgetCapability",
      async (_event, payload) => rotateWidgetCapability(payload),
    );

    registerTrustedLauncherHandle(
      "launcher:getWidgetHotkeyControl",
      async (_event, payload) => getWidgetHotkeyControlStatus(payload),
    );

    registerTrustedLauncherHandle(
      "launcher:updateWidgetHotkeyControl",
      async (_event, payload) => updateWidgetHotkeyControl(payload),
    );

    registerTrustedLauncherHandle(
      "launcher:triggerWidgetHotkeyControl",
      async (_event, payload) => triggerWidgetHotkeyControl(payload),
    );

    registerTrustedLauncherHandle(
      "launcher:getAiCasterAccess",
      async (_event, payload) => {
        assertLauncherAccess();
        return refreshAiCasterAccess(getStoredSession(), {
          throwOnError: true,
          organizationId: payload?.organizationId ?? null,
        });
      },
    );

    registerTrustedLauncherHandle(
      "launcher:updateAiCasterSettings",
      async (_event, payload) => updateAiCasterSettings(payload),
    );

    registerTrustedLauncherHandle(
      "launcher:previewAiCasterVoice",
      async (_event, payload) => previewAiCasterVoice(payload),
    );

    registerTrustedLauncherHandle(
      "launcher:getObserverCommandCenterSnapshot",
      (_event, payload) =>
        buildObserverCommandCenterSnapshot(payload?.mapKey ?? null),
    );

    registerTrustedLauncherHandle(
      "launcher:runObserverCommandAction",
      async (_event, payload) => {
        if (
          !widgetServer?.port ||
          typeof widgetServer.runObserverCommandAction !== "function"
        ) {
          throw new Error("Widget server is unavailable.");
        }

        const mapKey = payload?.mapKey ?? null;
        const normalizedPath = normalizeObserverCommandPath(
          payload?.path,
          mapKey,
        );
        const actionResult =
          await widgetServer.runObserverCommandAction(normalizedPath);
        return {
          ok: actionResult?.ok !== false,
          path: normalizedPath,
          actionResult: actionResult ?? null,
          snapshot: buildObserverCommandCenterSnapshot(mapKey),
        };
      },
    );

    registerTrustedLauncherHandle(
      "launcher:launchShadowTracker",
      async (_event, payload) => {
        assertLauncherAccess();
        const executablePath = resolveShadowTrackerExecutable(
          payload?.shadowTrackerPath,
          { preferRunning: false },
        );
        if (!executablePath) {
          throw new Error(
            `ShadowTrackerExtra.exe was not found. Use ${DEFAULT_SHADOWTRACKER_EXECUTABLE} or browse to the Win64 executable.`,
          );
        }

        const child = spawnDetached(executablePath, [], {
          cwd: path.dirname(executablePath),
          windowsHide: false,
        });
        configManager.setShadowTrackerPath(executablePath);
        const telemetrySource = await ensureTelemetrySourceRunning({
          shadowTrackerPath: executablePath,
        });
        const telemetry = telemetryBridge.getStatus();

        return {
          ok: true,
          pid: child.pid ?? null,
          executablePath,
          telemetry,
          telemetryError: null,
          connector:
            telemetrySource?.connector || getConnectorSetupStatusView(),
          telemetrySource: telemetrySource
            ? {
                pid: telemetrySource.pid,
                scriptPath: telemetrySource.scriptPath,
                started: telemetrySource.started,
                alreadyRunning: telemetrySource.alreadyRunning,
                ready: telemetrySource.ready,
                baseUrl: getShadowTelemetryBaseUrl(),
                connector: telemetrySource.connector || null,
              }
            : null,
          telemetrySourceError: telemetrySource?.error || null,
        };
      },
    );

    registerTrustedLauncherHandle(
      "launcher:startTelemetryBridge",
      async (_event, payload) => {
        const session = getStoredSession();
        assertLauncherAccess();
        const requestedMatchId = requireMatchId(payload?.matchId);
        if (isObserverFeedSessionActive()) {
          throw new Error(
            "Stop the direct Observer Feed before starting the Telemetry Bridge.",
          );
        }
        if (visualModeService.getStatus().running) {
          throw new Error(
            "Stop Visual Mode before starting the Telemetry Bridge.",
          );
        }
        assertProductionModeReadyForMatch(requestedMatchId);
        const currentTelemetryStatus = telemetryBridge.getStatus();
        const sessionId =
          currentTelemetryStatus.running &&
          currentTelemetryStatus.matchId === requestedMatchId &&
          typeof currentTelemetryStatus.sessionId === "string" &&
          currentTelemetryStatus.sessionId.trim()
            ? currentTelemetryStatus.sessionId.trim()
            : randomUUID();
        const matchId = await pinSelectedMatchLive(
          session,
          requestedMatchId,
          sessionId,
        );
        const telemetrySource = await ensureTelemetrySourceRunning();
        const activeSession = getStoredSession();
        const telemetry = await telemetryBridge.start({
          apiBase: activeSession.apiBase,
          token: activeSession.token,
          refreshToken: activeSession.refreshToken,
          matchId,
          sessionId,
        });
        setWidgetDirectObserverPollingAllowed(false);
        refreshLocalRuntimeLifecyclePoller();
        return {
          ...telemetry,
          connector:
            telemetrySource?.connector || getConnectorSetupStatusView(),
          telemetrySource: telemetrySource
            ? {
                pid: telemetrySource.pid,
                scriptPath: telemetrySource.scriptPath,
                started: telemetrySource.started,
                alreadyRunning: telemetrySource.alreadyRunning,
                ready: telemetrySource.ready,
                baseUrl: getShadowTelemetryBaseUrl(),
                connector: telemetrySource.connector || null,
              }
            : null,
          telemetrySourceError: telemetrySource?.error || null,
        };
      },
    );

    registerTrustedLauncherHandle("launcher:stopTelemetryBridge", () =>
      telemetryBridge.stop("stopped"),
    );

    registerTrustedLauncherHandle(
      "launcher:startVisualMode",
      async (_event, payload) => {
        const session = getStoredSession();
        assertLauncherAccess();
        const requestedMatchId = requireMatchId(payload?.matchId);
        if (telemetryBridge.getStatus().running) {
          throw new Error(
            "Stop the Telemetry Bridge before starting Visual Mode.",
          );
        }
        if (isObserverFeedSessionActive()) {
          throw new Error(
            "Stop the Observer Feed before starting Visual Mode.",
          );
        }
        await assertMatchLifecycleStartable(session, requestedMatchId);
        return visualModeService.start({
          matchId: requestedMatchId,
          config: payload?.config || {},
        });
      },
    );

    registerTrustedLauncherHandle("launcher:stopVisualMode", () =>
      visualModeService.stop("stopped"),
    );

    registerTrustedLauncherHandle(
      "launcher:startObserverFeed",
      async (_event, payload) => {
        const result = await startObserverFeedForMatch(payload?.matchId);
        return result;
      },
    );

    registerTrustedLauncherHandle("launcher:stopObserverFeed", () =>
      stopObserverFeed("stopped"),
    );

    registerTrustedLauncherHandle(
      "launcher:resetTelemetryForMatchSwitch",
      async () => {
        await stopObserverFeed("match-switch");
        visualModeService.stop("match-switch");
        productionModeState = createDefaultProductionModeState();
        resetLiveMatchMapSynchronization();
        return telemetryBridge.resetForMatchSwitch();
      },
    );

    registerTrustedLauncherHandle("launcher:consumePendingSyncCommand", () => {
      const command = pendingSyncCommand;
      pendingSyncCommand = null;
      return command;
    });

    createWindow();
    consumeProtocolArguments(process.argv);

    app.on("activate", () => {
      if (!mainWindow) {
        createWindow();
      }
    });
  });
}

app.on("before-quit", (event) => {
  if (quittingAfterCleanup) {
    return;
  }

  event.preventDefault();
  quittingAfterCleanup = true;
  const clearAuthOnQuit = !shouldKeepSignedIn();

  void Promise.resolve()
    .then(() => endLauncherSession({ clearAuth: clearAuthOnQuit }))
    .then(async (sessionEndResult) => {
      let observerStop = sessionEndResult?.observerFeedStop;
      if (observerStop?.ok !== true) {
        observerStop = await stopObserverFeedSilently("quit-retry");
      }
      if (observerStop?.ok !== true) {
        throw new Error(
          observerStop?.error ||
            "The observer connector could not be stopped safely.",
        );
      }

      try {
        closePinnedMapControlWindow();
        closePinnedCommentatorDeskWindow();
        cancelPcobObserverConfirmation();
        stopPcobHotkeyInput();
        widgetHotkeyControl.shutdown();
        await widgetServer?.stop();
      } catch (error) {
        logError(
          "[widget-server] stop failed during shutdown",
          error && error.stack ? error.stack : error,
        );
      } finally {
        widgetServer = null;
        app.quit();
      }
    })
    .catch((error) => {
      quittingAfterCleanup = false;
      const message =
        error instanceof Error
          ? error.message
          : String(error || "Unknown shutdown error");
      logError("[launcher] shutdown blocked by observer connector", message);
      dialog.showErrorBox(
        "Observer connector is still running",
        `${message}\n\nArenzyra stayed open so telemetry cannot continue silently. Stop the feed again or end the connector process before quitting.`,
      );
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
