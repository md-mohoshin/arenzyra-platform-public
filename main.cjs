const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
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
  REQUIRED_PUBG_MAP_KEYS,
} = require("./map-engine/map-asset-resolver.cjs");
const { createSessionManager } = require("./sessionManager.cjs");
const { createTelemetryBridge } = require("./telemetryBridge.cjs");
const { startWidgetsServer } = require("./widget-server/server.cjs");
let electronModule = require("electron");
const preloadPath = path.join(__dirname, "preload.cjs");
const REPO_ROOT = path.resolve(__dirname);
const TEAM_ASSETS_DIR = "C:\\ArenzyraObserver\\assets\\teams";
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
const OLDER_TELEMETRY_BRIDGE_SCRIPT = "C:\\PCOB 401\\ObToolsNew\\ob.js";
const LEGACY_TELEMETRY_BRIDGE_SCRIPT = "C:\\PCOB 402\\ObToolsNew\\ob.js";
const DEFAULT_TELEMETRY_BRIDGE_SCRIPT = path.join(
  CURRENT_PCOB_ROOT,
  "ObToolsNew",
  "ob.js",
);
const REPO_TELEMETRY_BRIDGE_SCRIPT = path.join(REPO_ROOT, "ob.js");
const OLDER_SHADOWTRACKER_PREFIX = "C:\\PCOB 401\\";
const LEGACY_SHADOWTRACKER_PREFIX = "C:\\PCOB 402\\";
const DEFAULT_SHADOWTRACKER_PREFIX = `${CURRENT_PCOB_ROOT}\\`;
const OLDER_TELEMETRY_BRIDGE_PREFIX = "C:\\PCOB 401\\";
const LEGACY_TELEMETRY_BRIDGE_PREFIX = "C:\\PCOB 402\\";
const DEFAULT_TELEMETRY_BRIDGE_PREFIX = `${CURRENT_PCOB_ROOT}\\`;
const PLACEHOLDER_LOGO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axzwoAAAAASUVORK5CYII=";
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const SESSION_INACTIVITY_WINDOW_DAYS = 15;
const SESSION_INACTIVITY_WINDOW_MS =
  SESSION_INACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
const ACCESS_DENIED_ERROR_CODE = "ARENZYRA_LAUNCHER_ACCESS_DENIED";
const SHADOW_TELEMETRY_BASE_URL = "http://127.0.0.1:10086";
const SHADOW_TELEMETRY_PROBE_PATHS = [
  "/health",
  "/getallinfo",
  "/gettotalplayerlist",
  "/getteaminfolist",
  "/getteaminfo",
];
const SHADOW_TELEMETRY_PROBE_TIMEOUT_MS = 800;
const SHADOW_TELEMETRY_READY_TIMEOUT_MS = 4_000;
const SHADOW_TELEMETRY_READY_POLL_MS = 250;
const OBSERVER_COMMAND_PATH_PREFIXES = Object.freeze([
  "/debug/operator/",
  "/debug/observer/",
  "/debug/camera-assist/",
]);

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

const { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } =
  electronModule;
const isDev = !app.isPackaged;
const devPort = process.env.DEV_SERVER_PORT || "5400";
const LAUNCHER_PROTOCOL = "arenzyra-launcher";
const APP_USER_MODEL_ID = "com.arenzyra.observerlauncher";

let telemetryBridgeProcess = null;
let telemetryBridgeScriptPath = "";
let launcherAccessState = null;
let launcherHeartbeatTimer = null;
let quittingAfterCleanup = false;
let mainWindow = null;
let pendingSyncCommand = null;
let windowLoaded = false;
let widgetServer = null;
let didConsumeStartupBootstrapResult = false;
let startupLicenseStatus = null;
let lastSessionActivityPersistAt = 0;
const telemetryBridge = createTelemetryBridge({
  logger: logger.child("telemetry"),
  log,
  refreshAuth: refreshTelemetryAuth,
  onUnauthorized: handleTelemetryUnauthorized,
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
const configManager = createConfigManager({
  getUserDataPath: () => app.getPath("userData"),
  env: process.env,
  log: logger.child("config").log,
});
const healthService = createHealthService({
  logger: logger.child("health"),
  getConfig: () => getLauncherConfigView(),
  getSession: () => sessionManager.readSession(),
  getAccessState: () => launcherAccessState,
  getTelemetryStatus: () => telemetryBridge.getStatus(),
  getWidgetStatus: () => getWidgetServerStatusView(),
  getAssetStatus: () => getAssetStatusView(),
  probeShadow: () => probeShadowTelemetryHealth(),
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
        return {
          meta: {
            apiBase: configView.apiBase,
            apiBaseSource: configView.apiBaseSource,
            apiEnvironment: configView.apiEnvironment,
            shadowTrackerPath: configView.shadowTrackerPath || null,
          },
        };
      },
    },
    {
      name: "SESSION_RESTORE",
      run: async () => {
        const storedSession = sessionManager.readSession();
        const expiryInfo = getStoredSessionExpiryInfo();
        const hasStoredSession = hasStoredLauncherSession(storedSession);
        const expired = expiryInfo?.expired === true;
        if (!hasStoredSession || expired) {
          startupLicenseStatus = null;
          stopLauncherHeartbeat();
          launcherAccessState = null;
          telemetryBridge.stop("stopped");
        }

        return {
          meta: {
            sessionPresent: hasStoredSession && !expired,
            sessionExpired: expired,
            hasAccessToken: Boolean(String(storedSession?.token || "").trim()),
            hasRefreshToken: Boolean(
              String(storedSession?.refreshToken || "").trim(),
            ),
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
        if (!hasStoredLauncherSession(storedSession) || expiryInfo?.expired === true) {
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

        const resolvedSession = await validateStoredLauncherSession(
          normalizeBaseUrl(),
        );
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

        const licenseStatus = startupLicenseStatus || (await checkLauncherLicense(session));
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
        if (!widgetServer) {
          widgetServer = startWidgetsServer({
            port: Number(process.env.ARENZYRA_WIDGET_PORT || 5510),
            enableDebugRoutes: isDev,
            enableOperatorRoutes: true,
            teamAssetsRoot: TEAM_ASSETS_DIR,
            resolveApiBase: () => normalizeBaseUrl(),
            logger: logger.child("widgets"),
          });
        }

        if (typeof widgetServer?.whenReady === "function") {
          await widgetServer.whenReady();
        }

        const widgetStatus = getWidgetServerStatusView();
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
  const storedSession = sessionManager.readSession();
  if (storedSession?.token || storedSession?.refreshToken) {
    telemetryBridge.updateAuth({
      apiBase: configView.apiBase,
      token: storedSession?.token || "",
      refreshToken: storedSession?.refreshToken || "",
    });
  }
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
    logInfo("[auth] session activity refreshed", { reason });
  }
  return nextSession;
}

const apiClient = createLauncherApiClient({
  resolveApiBase: normalizeBaseUrl,
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
  onUnauthorized: () => {
    stopLauncherHeartbeat();
    launcherAccessState = null;
    startupLicenseStatus = null;
    telemetryBridge.stop("stopped");
    lastSessionActivityPersistAt = 0;
    sessionManager.clearSession();
  },
});

async function refreshTelemetryAuth(params = {}) {
  const storedSession = sessionManager.readSession() ?? {};
  const resolvedApiBase = normalizeBaseUrl(params?.apiBase || storedSession?.apiBase);
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

function buildEmptyObserverCommandCenterSnapshot() {
  const telemetryStatus = telemetryBridge.getStatus();
  return {
    telemetry: {
      connected: telemetryStatus.connectionStatus === "connected",
      lastUpdateAt: toNullableTimestamp(telemetryStatus.lastPacketTime),
      mapKey: null,
      playerCount: null,
      phase: telemetryStatus.phase ?? null,
      connectionStatus: telemetryStatus.connectionStatus ?? "stopped",
      matchId: telemetryStatus.matchId ?? null,
      packetsPerSecond: telemetryStatus.packetsPerSecond ?? 0,
      aliveTeams: telemetryStatus.aliveTeams ?? null,
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
    typeof widgetServer.engine.getStatus === "function" ? widgetServer.engine.getStatus() : null;
  const requestedMapKey = String(preferredMapKey || engineStatus?.currentMapKey || "").trim() || null;
  const engineSnapshot =
    typeof widgetServer.engine.getSnapshot === "function"
      ? widgetServer.engine.getSnapshot(requestedMapKey)
      : null;
  const productionSupport =
    engineSnapshot?.productionSupport ?? engineStatus?.latestProductionSupport ?? null;
  const latestPlayers = engineSnapshot?.players ?? engineStatus?.latestPlayerUpdate ?? null;
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
      connected: telemetryStatus.connectionStatus === "connected",
      lastUpdateAt: toNullableTimestamp(telemetryStatus.lastPacketTime),
      mapKey: resolvedMapKey,
      playerCount: Array.isArray(latestPlayers?.players) ? latestPlayers.players.length : null,
      phase: telemetryStatus.phase ?? null,
      connectionStatus: telemetryStatus.connectionStatus ?? "stopped",
      matchId: telemetryStatus.matchId ?? null,
      packetsPerSecond: telemetryStatus.packetsPerSecond ?? 0,
      aliveTeams: telemetryStatus.aliveTeams ?? null,
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
    recommendation: productionSupport?.cameraAssistPayload?.recommendation ?? null,
    cameraAssistPayload: productionSupport?.cameraAssistPayload ?? null,
    observerControlSuggestion: productionSupport?.observerControlSuggestion ?? null,
    observerOperatorSuggestion: productionSupport?.observerOperatorSuggestion ?? null,
    watchTargets: Array.isArray(productionSupport?.watchTargets) ? productionSupport.watchTargets : [],
    alerts: Array.isArray(productionSupport?.activeAlerts) ? productionSupport.activeAlerts : [],
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
      webSecurity: false,
    },
  });
  mainWindow = win;
  windowLoaded = false;

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
    .then(() => log("[electron] Loaded dist HTML"))
    .catch((err) =>
      log(
        "[electron] Failed to load dist HTML",
        err && err.stack ? err.stack : err,
      ),
    );
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

  const action = (parsed.hostname || parsed.pathname.replace(/^\/+/, "")).toLowerCase();
  if (action !== "sync") {
    return null;
  }

  const matchId = normalizeOptionalString(parsed.searchParams.get("matchId"));
  if (!matchId) {
    return null;
  }

  return {
    apiBase: normalizeOptionalString(parsed.searchParams.get("apiBase")),
    tournamentId: normalizeOptionalString(parsed.searchParams.get("tournamentId")),
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

function setLauncherConfigValue(key, value, source = "renderer") {
  const result = configManager.setConfigValue(key, value, { source });
  if (result.changed) {
    log("[config] renderer config updated", {
      key,
      source,
    });
    syncRuntimeConfig(source);
  }
  return getLauncherConfigView();
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
  if (typeof responseData?.message === "string" && responseData.message.trim()) {
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

async function getWidgetCatalogState(payload) {
  assertLauncherAccess();
  const session = getStoredSession();
  const organizationId =
    asOptionalString(payload?.organizationId) ||
    asOptionalString(session?.organization?.id) ||
    asOptionalString(session?.user?.organizationId);
  const widgetKeys = Array.from(
    new Set(
      (Array.isArray(payload?.widgetKeys) ? payload.widgetKeys : [])
        .map((widgetKey) => String(widgetKey || "").trim())
        .filter(Boolean),
    ),
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
    const response = await axios.get(`${session.apiBase}/api/widgets/access-list`, {
      params: { organizationId },
      timeout: 10000,
      headers: {
        Accept: "application/json",
      },
    });
    accessList = response?.data ?? null;
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
    return {
      organizationId,
      organizationSlug: null,
      enforced,
      items: Object.fromEntries(
        widgetKeys.map((widgetKey) => [
          widgetKey,
          {
            widgetKey,
            widgetInstanceId: null,
            widgetInstanceKey: null,
            organizationSlug: null,
            matchId: null,
            tournamentId: null,
            approved: null,
            message: unresolvedMessage,
          },
        ]),
      ),
    };
  }

  const items = await Promise.all(
    widgetKeys.map(async (widgetKey) => {
      const approval = approvals.get(widgetKey);
      const approved =
        approval?.isApproved === true || (!approval && enforced === false);
      const fallbackMessage = approved
        ? "Widget instance key not resolved yet"
        : "Widget not approved for this organization.";

      try {
        const response = await axios.get(
          `${session.apiBase}/widgets/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(
            widgetKey,
          )}`,
          {
            timeout: 10000,
            headers: {
              Accept: "application/json",
            },
          },
        );
        const resolved = response?.data ?? null;
        const widgetInstanceKey = asOptionalString(resolved?.key);
        const widgetInstanceId = asOptionalString(resolved?.id);
        return [
          widgetKey,
          {
            widgetKey,
            widgetInstanceId,
            widgetInstanceKey,
            organizationSlug:
              asOptionalString(resolved?.organization?.slug) || organizationSlug,
            matchId: asOptionalString(resolved?.match?.id),
            tournamentId: asOptionalString(resolved?.tournament?.id),
            approved,
            message: widgetInstanceKey ? null : fallbackMessage,
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

  return {
    organizationId,
    organizationSlug,
    enforced,
    items: Object.fromEntries(items),
  };
}

function getWidgetServerStatusView() {
  const fallbackPort = Number(process.env.ARENZYRA_WIDGET_PORT || 5510);
  const resolvedFallbackPort = Number.isInteger(fallbackPort) ? fallbackPort : 5510;
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

  return {
    running: status?.running === true,
    host: status?.host ? String(status.host) : null,
    port,
    path: status?.path ? String(status.path) : null,
    clientCount: Number(status?.clientCount ?? 0) || 0,
    lastBroadcastAt:
      typeof status?.lastBroadcastAt === "number" ? status.lastBroadcastAt : null,
    startedAt:
      typeof status?.startedAt === "number" ? status.startedAt : null,
    baseUrl: localBaseUrl,
    localBaseUrl,
    networkBaseUrl,
  };
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
    checkedAt:
      typeof status.checkedAt === "number" ? status.checkedAt : null,
    assetsRoot: status.assetsRoot ? String(status.assetsRoot) : null,
    routePrefix: status.routePrefix ? String(status.routePrefix) : "/assets/maps",
    fallbackAssetUrl: status.fallbackAssetUrl
      ? String(status.fallbackAssetUrl)
      : "/assets/maps/map-not-available.svg",
    fallbackAssetPath: status.fallbackAssetPath
      ? String(status.fallbackAssetPath)
      : null,
    total: Number(status.total ?? 0) || 0,
    available: Number(status.available ?? 0) || 0,
    missing: Number(status.missing ?? 0) || 0,
    availableKeys: Array.isArray(status.availableKeys) ? [...status.availableKeys] : [],
    missingKeys: Array.isArray(status.missingKeys) ? [...status.missingKeys] : [],
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
    (error instanceof Error &&
      error.message.includes(UNAUTHORIZED_ERROR_CODE))
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
  launcherAccessState = null;
  startupLicenseStatus = null;
  telemetryBridge.stop(options?.reason || "stopped");
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
        activeSessions:
          Number.isFinite(access.activeSessions) ? access.activeSessions : null,
        maxObservers:
          Number.isFinite(access.maxObservers) ? access.maxObservers : null,
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
    reason: currentAccess?.allowed === true ? null : currentAccess?.reason ?? null,
    license:
      licenseStatus?.licenseCheck?.license ??
      currentAccess?.license ??
      null,
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

  const storedSession = sessionManager.readSession();
  if (!storedSession?.token && !storedSession?.refreshToken) {
    telemetryBridge.stop("stopped");
    if (options.clearAuth === true) {
      sessionManager.clearSession();
    }
    return { ok: true };
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
    telemetryBridge.stop("stopped");
    if (options.clearAuth === true) {
      sessionManager.clearSession();
    }
  }

  return { ok: true };
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

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function toShadowTeamName(slot) {
  const source =
    slot?.team?.tag ||
    slot?.team?.name ||
    slot?.teamId ||
    `TEAM_${slot?.slotNumber ?? "0"}`;
  const normalized = String(source)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `TEAM_${slot?.slotNumber ?? "0"}`;
}

function toShadowLogoPath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function getBrandingConfigPath() {
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(os.homedir(), "AppData", "Local");
  return path.join(
    localAppData,
    "ShadowTrackerExtra",
    "Saved",
    "TeamLogoAndColor.ini",
  );
}

function ensurePlaceholderLogo() {
  ensureDir(TEAM_ASSETS_DIR);
  const placeholderPath = path.join(TEAM_ASSETS_DIR, "default-team.png");
  if (!fs.existsSync(placeholderPath)) {
    const bundledDefaultTeamPath = resolveBundledDefaultTeamPath();
    if (bundledDefaultTeamPath) {
      fs.copyFileSync(bundledDefaultTeamPath, placeholderPath);
    } else {
      fs.writeFileSync(
        placeholderPath,
        Buffer.from(PLACEHOLDER_LOGO_BASE64, "base64"),
      );
    }
  }
  return placeholderPath;
}

function resolveLogoUrl(baseUrl, logoUrl) {
  if (!logoUrl) return null;
  try {
    return new URL(String(logoUrl), `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

function detectFileExtension(urlValue, contentType) {
  const content = String(contentType || "").toLowerCase();
  if (content.includes("image/jpeg")) return ".jpg";
  if (content.includes("image/webp")) return ".webp";
  if (content.includes("image/bmp")) return ".bmp";
  if (content.includes("image/svg")) return ".svg";
  if (content.includes("image/png")) return ".png";

  try {
    const parsed = new URL(urlValue);
    const extension = path.extname(parsed.pathname || "").toLowerCase();
    if (extension) return extension;
  } catch {
    // ignore parse errors
  }

  return ".png";
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
    teamId: slot?.teamId ? String(slot.teamId) : teamRecord?.id ? String(teamRecord.id) : null,
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

async function fetchLiveMatch(apiBase) {
  const normalizedBase = normalizeBaseUrl(apiBase);
  const publicPayload = await tryFetchLiveMatch(
    `${normalizedBase}/public/live-match`,
  );
  if (publicPayload?.matchId) {
    return {
      apiBase: normalizedBase,
      matchId: publicPayload.matchId ? String(publicPayload.matchId) : null,
      status: publicPayload.status ? String(publicPayload.status) : null,
      source: "public/live-match",
    };
  }

  const feedPayload = await tryFetchLiveMatch(`${normalizedBase}/match/live`);
  if (feedPayload?.match?.id || feedPayload?.matchId || feedPayload?.id) {
    return {
      apiBase: normalizedBase,
      matchId: String(
        feedPayload?.match?.id || feedPayload?.matchId || feedPayload?.id,
      ),
      status:
        feedPayload?.match?.status || feedPayload?.status
          ? String(feedPayload?.match?.status || feedPayload?.status)
          : null,
      source: "match/live",
    };
  }

  return {
    apiBase: normalizedBase,
    matchId: publicPayload?.matchId ? String(publicPayload.matchId) : null,
    status:
      publicPayload?.status || feedPayload?.match?.status || feedPayload?.status
        ? String(
            publicPayload?.status ||
              feedPayload?.match?.status ||
              feedPayload?.status,
          )
        : null,
    source: publicPayload ? "public/live-match" : feedPayload ? "match/live" : null,
  };
}

async function resolveRequestedMatch(apiBase, matchId) {
  const trimmedMatchId = String(matchId || "").trim();
  if (trimmedMatchId) {
    return {
      matchId: trimmedMatchId,
      source: "manual",
      status: null,
    };
  }

  const liveMatch = await fetchLiveMatch(apiBase);
  if (!liveMatch.matchId) {
    throw new Error(
      "No live match is available. Start a live match or enter a match ID manually.",
    );
  }

  return liveMatch;
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
    const response = await axios.get(logoUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
    });
    const extension = detectFileExtension(
      logoUrl,
      response?.headers?.["content-type"],
    );
    const filePath = path.join(
      TEAM_ASSETS_DIR,
      `${String(slot.slotNumber).padStart(2, "0")}_${teamSlug}${extension}`,
    );
    fs.writeFileSync(filePath, Buffer.from(response.data));
    return {
      ...slot,
      localLogoPath: filePath,
      resolvedColor: colorHex,
      usedPlaceholder: false,
      logoDownloaded: true,
    };
  } catch (err) {
    logWarn(
      "[launcher] logo download failed",
      slot?.slotNumber,
      logoUrl,
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

async function syncTeams(session, matchId) {
  ensureDir(TEAM_ASSETS_DIR);
  const placeholderPath = ensurePlaceholderLogo();
  const { baseUrl, matchId: normalizedMatchId, slots } =
    await fetchObserverSlots(session, matchId);

  const assignedSlots = slots.filter((slot) => slot.teamId || slot.team);
  const syncedSlots = [];
  for (const slot of assignedSlots) {
    syncedSlots.push(
      await downloadLogoForSlot(baseUrl, slot, placeholderPath),
    );
  }

  return {
    ok: true,
    matchId: normalizedMatchId,
    matchSource: "selected",
    slotCount: slots.length,
    syncedCount: syncedSlots.length,
    teamAssetsDir: TEAM_ASSETS_DIR,
    slots: syncedSlots,
  };
}

async function generateBranding(session, matchId) {
  const requestedMatchId = requireMatchId(matchId);
  const payload =
    (await apiClient.generateShadowBranding({
      apiBase: session.apiBase,
      token: session.token,
      refreshToken: session.refreshToken,
      matchId: requestedMatchId,
    })) ?? {};
  const slotList = Array.isArray(payload?.slots) ? payload.slots : [];
  return {
    ok: payload?.ok !== false,
    matchId: payload?.matchId
      ? String(payload.matchId)
      : requestedMatchId,
    matchSource: "selected",
    brandingConfigPath: payload?.brandingConfigPath
      ? String(payload.brandingConfigPath)
      : getBrandingConfigPath(),
    teamAssetsDir: payload?.teamAssetsDir
      ? String(payload.teamAssetsDir)
      : TEAM_ASSETS_DIR,
    teamCount: Number(payload?.teamCount ?? slotList.length),
    slots: slotList.map(normalizeSlot),
  };
}

async function pinSelectedMatchLive(session, matchId, sessionId) {
  const requestedMatchId = requireMatchId(matchId);
  await assertMatchLifecycleStartable(session, requestedMatchId);
  await apiClient.startMatchControl({
    apiBase: session.apiBase,
    token: session.token,
    refreshToken: session.refreshToken,
    matchId: requestedMatchId,
    sessionId,
  });
  return requestedMatchId;
}

function readWherePaths(binaryName) {
  try {
    const result = spawnSync("where.exe", [binaryName], {
      encoding: "utf8",
      windowsHide: true,
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
  if (normalized === "ENDED") {
    return "FINISHED";
  }
  return normalized;
}

async function assertMatchLifecycleStartable(session, matchId) {
  const control = await apiClient.getMatchControl({
    apiBase: session.apiBase,
    token: session.token,
    refreshToken: session.refreshToken,
    matchId,
  });
  const lifecycleStatus = normalizeMatchLifecycleStatus(
    control?.matchStatus || control?.status,
  );

  if (lifecycleStatus === "FINISHED") {
    logWarn("[Telemetry] Cannot start, match is FINISHED", {
      matchId,
    });
    throw new Error("Cannot start telemetry: match is FINISHED.");
  }
  if (lifecycleStatus === "FINISH_PENDING") {
    throw new Error("Cannot start telemetry while the match is finalizing.");
  }
}

function findExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

function isExistingFile(filePath) {
  if (!filePath) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
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

function getShadowTrackerCandidates() {
  return uniquePaths([
    DEFAULT_SHADOWTRACKER_EXECUTABLE,
    LEGACY_SHADOWTRACKER_EXECUTABLE,
    OLDER_SHADOWTRACKER_EXECUTABLE,
    path.join(DEFAULT_SHADOWTRACKER_PREFIX, "WindowsNoEditor", "ShadowTrackerExtra.exe"),
    path.join(LEGACY_SHADOWTRACKER_PREFIX, "WindowsNoEditor", "ShadowTrackerExtra.exe"),
    path.join(OLDER_SHADOWTRACKER_PREFIX, "WindowsNoEditor", "ShadowTrackerExtra.exe"),
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
    ...readWherePaths("ShadowTrackerExtra.exe"),
  ]);
}

function getTelemetryBridgeCandidates() {
  return uniquePaths([
    REPO_TELEMETRY_BRIDGE_SCRIPT,
    DEFAULT_TELEMETRY_BRIDGE_SCRIPT,
    LEGACY_TELEMETRY_BRIDGE_SCRIPT,
    OLDER_TELEMETRY_BRIDGE_SCRIPT,
  ]);
}

function resolveShadowTrackerExecutable(inputPath) {
  const providedPath = migrateLegacyPrefix(
    inputPath,
    [OLDER_SHADOWTRACKER_PREFIX, LEGACY_SHADOWTRACKER_PREFIX],
    DEFAULT_SHADOWTRACKER_PREFIX,
  );

  return findExistingFile([
    ...getShadowTrackerInputCandidates(providedPath),
    ...getShadowTrackerCandidates(),
  ]);
}

function resolveTelemetryBridgeScript(inputPath) {
  const providedPath = migrateLegacyPrefix(
    inputPath,
    [OLDER_TELEMETRY_BRIDGE_PREFIX, LEGACY_TELEMETRY_BRIDGE_PREFIX],
    DEFAULT_TELEMETRY_BRIDGE_PREFIX,
  );
  if (providedPath && fs.existsSync(providedPath)) {
    return providedPath;
  }
  return findExistingPath(getTelemetryBridgeCandidates());
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

function spawnNodeScript(scriptPath) {
  const nodePaths = readWherePaths("node.exe");
  if (nodePaths.length > 0) {
    return spawnDetached(nodePaths[0], [scriptPath], {
      cwd: path.dirname(scriptPath),
    });
  }

  return spawnDetached(process.execPath, [scriptPath], {
    cwd: path.dirname(scriptPath),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isChildProcessRunning(child) {
  return Boolean(child && child.exitCode === null && !child.killed);
}

async function isShadowTelemetryAvailable() {
  for (const probePath of SHADOW_TELEMETRY_PROBE_PATHS) {
    try {
      const response = await axios.get(`${SHADOW_TELEMETRY_BASE_URL}${probePath}`, {
        timeout: SHADOW_TELEMETRY_PROBE_TIMEOUT_MS,
        validateStatus: () => true,
      });
      if (response.status < 500) {
        return true;
      }
    } catch (error) {
      const code =
        error && typeof error === "object" ? String(error.code || "") : "";
      if (
        code &&
        !["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(code)
      ) {
        logWarn("[launcher] telemetry source probe failed", code);
      }
    }
  }

  const portReachable = await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 10086 });
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
    return true;
  }

  return false;
}

async function probeShadowTelemetryHealth() {
  const checkedAt = new Date().toISOString();

  for (const probePath of SHADOW_TELEMETRY_PROBE_PATHS) {
    try {
      const response = await axios.get(`${SHADOW_TELEMETRY_BASE_URL}${probePath}`, {
        timeout: SHADOW_TELEMETRY_PROBE_TIMEOUT_MS,
        validateStatus: () => true,
      });

      if (response.status < 500) {
        return {
          reachable: true,
          lastResponseAt: checkedAt,
          lastCheckedAt: checkedAt,
          lastError: null,
        };
      }

      return {
        reachable: false,
        lastResponseAt: null,
        lastCheckedAt: checkedAt,
        lastError: `ShadowTracker returned HTTP ${response.status}.`,
      };
    } catch (error) {
      const code =
        error && typeof error === "object" ? String(error.code || "") : "";
      if (
        code &&
        !["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(code)
      ) {
        return {
          reachable: false,
          lastResponseAt: null,
          lastCheckedAt: checkedAt,
          lastError: code,
        };
      }
    }
  }

  const portReachable = await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 10086 });
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
      lastResponseAt: checkedAt,
      lastCheckedAt: checkedAt,
      lastError: null,
    };
  }

  return {
    reachable: false,
    lastResponseAt: null,
    lastCheckedAt: checkedAt,
    lastError: "ShadowTracker did not respond.",
  };
}

async function waitForShadowTelemetryReady(
  timeoutMs = SHADOW_TELEMETRY_READY_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await isShadowTelemetryAvailable()) {
      return true;
    }
    await sleep(SHADOW_TELEMETRY_READY_POLL_MS);
  }
  return false;
}

async function ensureTelemetrySourceRunning() {
  const resolvedScriptPath = resolveTelemetryBridgeScript(telemetryBridgeScriptPath);

  if (await isShadowTelemetryAvailable()) {
    if (resolvedScriptPath) {
      telemetryBridgeScriptPath = resolvedScriptPath;
    }
    return {
      pid: telemetryBridgeProcess?.pid ?? null,
      scriptPath: resolvedScriptPath || telemetryBridgeScriptPath || null,
      started: false,
      alreadyRunning: true,
      ready: true,
      error: null,
    };
  }

  if (isChildProcessRunning(telemetryBridgeProcess)) {
    const ready = await waitForShadowTelemetryReady();
    return {
      pid: telemetryBridgeProcess?.pid ?? null,
      scriptPath: telemetryBridgeScriptPath || resolvedScriptPath || null,
      started: false,
      alreadyRunning: true,
      ready,
      error: null,
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
      error: `ob.js was not found. Expected it at ${DEFAULT_TELEMETRY_BRIDGE_SCRIPT} or in the repo root.`,
    };
  }

  telemetryBridgeScriptPath = resolvedScriptPath;

  try {
    const child = spawnNodeScript(resolvedScriptPath);
    telemetryBridgeProcess = child;

    child.once("exit", (code, signal) => {
      if (telemetryBridgeProcess === child) {
        telemetryBridgeProcess = null;
      }
      log("[launcher] ob.js exited", {
        code,
        signal,
        scriptPath: resolvedScriptPath,
      });
    });

    child.once("error", (error) => {
      log(
        "[launcher] ob.js spawn error",
        error && error.stack ? error.stack : error,
      );
    });

    const ready = await waitForShadowTelemetryReady();
    return {
      pid: child.pid ?? null,
      scriptPath: resolvedScriptPath,
      started: true,
      alreadyRunning: false,
      ready,
      error: null,
    };
  } catch (error) {
    telemetryBridgeProcess = null;
    return {
      pid: null,
      scriptPath: resolvedScriptPath,
      started: false,
      alreadyRunning: false,
      ready: false,
      error:
        error instanceof Error
          ? error.message
          : String(error || "Failed to start ob.js."),
    };
  }
}

function getLauncherDefaults(apiBase) {
  return {
    apiBase: normalizeBaseUrl(apiBase),
    teamAssetsDir: TEAM_ASSETS_DIR,
    brandingConfigPath: getBrandingConfigPath(),
    shadowTrackerPath: configManager.getShadowTrackerPath(),
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
  const loginResult = await apiClient.login({
    apiBase: params?.apiBase,
    email: params?.email,
    password: params?.password,
  });
  persistUserConfiguredApiBase(params?.apiBase, "login");

  const nextSession = persistStoredSession({
    apiBase: loginResult.apiBase,
    token: loginResult.accessToken,
    accessToken: loginResult.accessToken,
    refreshToken: loginResult.refreshToken,
    user: loginResult.user,
    organization: loginResult.organization,
  });
  const access = await evaluateLauncherAccess(nextSession);

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
  await bootstrapService.bootstrap();
  ipcMain.handle("launcher:getConfig", () => getLauncherConfigView());

  ipcMain.handle("launcher:setConfig", (_event, payload) =>
    setLauncherConfigValue(payload?.key, payload?.value, "renderer"),
  );

  ipcMain.handle("launcher:getDefaults", () => getLauncherDefaults());

  ipcMain.on("launcher:pathExists", (event, payload) => {
    event.returnValue = pathExistsOnDisk(payload?.targetPath);
  });

  ipcMain.on("launcher:isFile", (event, payload) => {
    event.returnValue = isFileOnDisk(payload?.targetPath);
  });

  ipcMain.handle("launcher:bootstrap", async (_event, payload) =>
    bootstrapLauncher(payload?.apiBase),
  );

  ipcMain.handle("launcher:login", async (_event, payload) =>
    loginLauncher(payload),
  );

  ipcMain.handle("launcher:logout", () => endLauncherSession({ clearAuth: true }));

  ipcMain.handle("launcher:chooseFile", async (_event, options) => {
    const result = await dialog.showOpenDialog({
      title: options?.title || "Select file",
      defaultPath: options?.defaultPath || undefined,
      properties: ["openFile"],
      filters: Array.isArray(options?.filters) ? options.filters : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle("launcher:copyText", (_event, payload) => {
    const text = String(payload?.text || "");
    clipboard.writeText(text);
    return { ok: true };
  });

  ipcMain.handle("launcher:openExternal", async (_event, payload) => {
    const url = normalizeHttpUrl(payload?.url);
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("launcher:getLiveMatch", async (_event, payload) =>
    fetchLiveMatch(payload?.apiBase),
  );

  ipcMain.handle("launcher:listTournaments", async () => {
    const session = getStoredSession();
    assertLauncherAccess();
    return apiClient.listTournaments({
      apiBase: session.apiBase,
      token: session.token,
      refreshToken: session.refreshToken,
    });
  });

  ipcMain.handle("launcher:listStages", async (_event, payload) => {
    const session = getStoredSession();
    assertLauncherAccess();
    return apiClient.listStages({
      apiBase: session.apiBase,
      token: session.token,
      refreshToken: session.refreshToken,
      tournamentId: payload?.tournamentId,
    });
  });

  ipcMain.handle("launcher:listMatches", async (_event, payload) => {
    const session = getStoredSession();
    assertLauncherAccess();
    return apiClient.listMatches({
      apiBase: session.apiBase,
      token: session.token,
      refreshToken: session.refreshToken,
      tournamentId: payload?.tournamentId,
    });
  });

  ipcMain.handle("launcher:syncTeams", async (_event, payload) => {
    const session = getStoredSession();
    assertLauncherAccess();
    return syncTeams(session, payload?.matchId);
  });

  ipcMain.handle("launcher:generateBranding", async (_event, payload) => {
    const session = getStoredSession();
    assertLauncherAccess();
    return generateBranding(session, payload?.matchId);
  });

  ipcMain.handle("launcher:getTelemetryStatus", () =>
    telemetryBridge.getStatus(),
  );

  ipcMain.handle("launcher:getWidgetServerStatus", () =>
    getWidgetServerStatusView(),
  );

  ipcMain.handle("launcher:getAssetStatus", () => getAssetStatusView());

  ipcMain.handle("launcher:getHealthStatus", () => healthService.getStatus());

  ipcMain.handle("launcher:getBootstrapStatus", () => bootstrapService.getStatus());

  ipcMain.handle("launcher:getRecentLogs", (_event, payload) =>
    logger.getRecent(payload?.scope, payload?.limit),
  );

  ipcMain.handle("launcher:getWidgetCatalogState", async (_event, payload) =>
    getWidgetCatalogState(payload),
  );

  ipcMain.handle("launcher:getObserverCommandCenterSnapshot", (_event, payload) =>
    buildObserverCommandCenterSnapshot(payload?.mapKey ?? null),
  );

  ipcMain.handle("launcher:runObserverCommandAction", async (_event, payload) => {
    if (!widgetServer?.port) {
      throw new Error("Widget server is unavailable.");
    }

    const mapKey = payload?.mapKey ?? null;
    const normalizedPath = normalizeObserverCommandPath(payload?.path, mapKey);
    const response = await axios.get(`http://127.0.0.1:${widgetServer.port}${normalizedPath}`, {
      timeout: 3000,
    });
    return {
      ok: response?.data?.ok !== false,
      path: normalizedPath,
      actionResult: response?.data ?? null,
      snapshot: buildObserverCommandCenterSnapshot(mapKey),
    };
  });

  ipcMain.handle("launcher:launchShadowTracker", async (_event, payload) => {
    assertLauncherAccess();
    const executablePath = resolveShadowTrackerExecutable(
      payload?.shadowTrackerPath,
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

    const session = getStoredSession();
    const requestedMatchId = requireMatchId(payload?.matchId);
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
    let telemetry = null;
    let telemetryError = null;

    try {
      const activeSession = getStoredSession();
      telemetry = await telemetryBridge.start({
        apiBase: activeSession.apiBase,
        token: activeSession.token,
        refreshToken: activeSession.refreshToken,
        matchId,
        sessionId,
      });
    } catch (error) {
      telemetryError =
        error instanceof Error
          ? error.message
          : String(error || "Failed to start telemetry bridge.");
      logError("[launcher] auto-start telemetry failed", telemetryError);
    }

    return {
      ok: true,
      pid: child.pid ?? null,
      executablePath,
      telemetry,
      telemetryError,
      telemetrySource: telemetrySource
        ? {
            pid: telemetrySource.pid,
            scriptPath: telemetrySource.scriptPath,
            started: telemetrySource.started,
            alreadyRunning: telemetrySource.alreadyRunning,
            ready: telemetrySource.ready,
          }
        : null,
      telemetrySourceError: telemetrySource?.error || null,
    };
  });

  ipcMain.handle("launcher:startTelemetryBridge", async (_event, payload) => {
    const session = getStoredSession();
    assertLauncherAccess();
    const requestedMatchId = requireMatchId(payload?.matchId);
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
    return {
      ...telemetry,
      telemetrySource: telemetrySource
        ? {
            pid: telemetrySource.pid,
            scriptPath: telemetrySource.scriptPath,
            started: telemetrySource.started,
            alreadyRunning: telemetrySource.alreadyRunning,
            ready: telemetrySource.ready,
          }
        : null,
      telemetrySourceError: telemetrySource?.error || null,
    };
  });

  ipcMain.handle("launcher:stopTelemetryBridge", () =>
    telemetryBridge.stop("stopped"),
  );

  ipcMain.handle("launcher:consumePendingSyncCommand", () => {
    const command = pendingSyncCommand;
    pendingSyncCommand = null;
    return command;
  });

  createWindow();
  consumeProtocolArguments(process.argv);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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

  void Promise.resolve()
    .then(() => endLauncherSession({ clearAuth: false }))
    .finally(async () => {
      try {
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
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
