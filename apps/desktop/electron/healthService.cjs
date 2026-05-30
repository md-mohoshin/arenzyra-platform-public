"use strict";

const axios = require("axios");
const { getProcessDefaultApiBase } = require("./apiBaseDefaults.cjs");

const SNAPSHOT_CACHE_TTL_MS = 1000;
const FINALIZATION_DELAY_THRESHOLD_MS = 60_000;
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
const PRODUCTION_MODE_STATUSES = new Set([
  "READY",
  "READY_WITH_WARNINGS",
  "BLOCKED",
]);

function toIsoTimestamp(value = Date.now()) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  return null;
}

function asErrorMessage(error, fallback) {
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

function toStatusCode(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTelemetryStatus(telemetry = {}) {
  return {
    running: telemetry?.running === true,
    matchId: telemetry?.matchId ? String(telemetry.matchId) : null,
    sessionId: telemetry?.sessionId ? String(telemetry.sessionId) : null,
    packetsPerSecond: Number(telemetry?.packetsPerSecond ?? 0) || 0,
    lastPacketTime: toIsoTimestamp(telemetry?.lastPacketTime),
    connectionStatus: telemetry?.connectionStatus
      ? String(telemetry.connectionStatus)
      : "stopped",
    phase: telemetry?.phase ?? null,
    gameTime:
      typeof telemetry?.gameTime === "number" ? telemetry.gameTime : null,
    aliveTeams:
      typeof telemetry?.aliveTeams === "number" ? telemetry.aliveTeams : null,
    circleIndex:
      typeof telemetry?.circleIndex === "number" ? telemetry.circleIndex : null,
    circleStatus: telemetry?.circleStatus
      ? String(telemetry.circleStatus)
      : null,
    totalPackets: Number(telemetry?.totalPackets ?? 0) || 0,
    lastError: telemetry?.lastError ? String(telemetry.lastError) : null,
    connectedToBackend: telemetry?.connectedToBackend === true,
    queueSize: Number(telemetry?.queueSize ?? 0) || 0,
    lastSuccessAt: toIsoTimestamp(telemetry?.lastSuccessAt),
    matchStatus: telemetry?.matchStatus ? String(telemetry.matchStatus) : null,
    isLocked: telemetry?.isLocked === true,
    isFinalizing: telemetry?.isFinalizing === true,
    resultFinalized: telemetry?.resultFinalized === true,
    finalizationStartedAt: toIsoTimestamp(telemetry?.finalizationStartedAt),
    finalizationDurationMs:
      typeof telemetry?.finalizationDurationMs === "number" &&
      Number.isFinite(telemetry.finalizationDurationMs)
        ? Math.max(0, Number(telemetry.finalizationDurationMs))
        : null,
    transportConnected: telemetry?.transportConnected === true,
    packetsReceiving: telemetry?.packetsReceiving === true,
    telemetryAccepted: telemetry?.telemetryAccepted === true,
    telemetryActive: telemetry?.telemetryActive === true,
    lastTransportAt: toIsoTimestamp(telemetry?.lastTransportAt),
    lastAcceptedAt: toIsoTimestamp(telemetry?.lastAcceptedAt),
    lastIgnoredAt: toIsoTimestamp(telemetry?.lastIgnoredAt),
    lastIgnoredReason:
      typeof telemetry?.lastIgnoredReason === "string" &&
      telemetry.lastIgnoredReason.trim()
        ? telemetry.lastIgnoredReason.trim()
        : null,
  };
}

function normalizeMatchFlow(matchFlow = {}) {
  const workflowState = MATCH_FLOW_STATES.has(matchFlow?.workflowState)
    ? matchFlow.workflowState
    : "NO_MATCH";
  const nextMatchSuggestedId =
    typeof matchFlow?.nextMatchSuggestedId === "string" &&
    matchFlow.nextMatchSuggestedId.trim()
      ? matchFlow.nextMatchSuggestedId.trim()
      : null;

  return {
    currentMatchId:
      typeof matchFlow?.currentMatchId === "string" && matchFlow.currentMatchId.trim()
        ? matchFlow.currentMatchId.trim()
        : null,
    currentStatus:
      typeof matchFlow?.currentStatus === "string" && matchFlow.currentStatus.trim()
        ? matchFlow.currentStatus.trim()
        : null,
    nextMatchSuggestedId,
    nextMatchAvailable:
      matchFlow?.nextMatchAvailable === true && Boolean(nextMatchSuggestedId),
    workflowState,
  };
}

function normalizeProductionMode(productionMode = {}) {
  const workflowState = MATCH_FLOW_STATES.has(productionMode?.workflowState)
    ? productionMode.workflowState
    : "NO_MATCH";

  return {
    workflowState,
    status: PRODUCTION_MODE_STATUSES.has(productionMode?.status)
      ? productionMode.status
      : null,
    matchId:
      typeof productionMode?.matchId === "string" && productionMode.matchId.trim()
        ? productionMode.matchId.trim()
        : null,
    blockingIssueCount:
      typeof productionMode?.blockingIssueCount === "number" &&
      Number.isFinite(productionMode.blockingIssueCount)
        ? Math.max(0, Number(productionMode.blockingIssueCount))
        : 0,
    warningCount:
      typeof productionMode?.warningCount === "number" &&
      Number.isFinite(productionMode.warningCount)
        ? Math.max(0, Number(productionMode.warningCount))
        : 0,
    lastCheckedAt: toIsoTimestamp(productionMode?.lastCheckedAt),
  };
}

function buildLicenseHealth(session, accessState) {
  const authenticated = Boolean(session?.token || session?.refreshToken);
  if (accessState?.allowed === true) {
    return {
      licenseValid: true,
      seatActive: true,
      reason: null,
      machineId: accessState.machineId ? String(accessState.machineId) : null,
      activeSessions:
        typeof accessState.activeSessions === "number"
          ? accessState.activeSessions
          : null,
      maxObservers:
        typeof accessState.maxObservers === "number"
          ? accessState.maxObservers
          : null,
      license: accessState.license ?? null,
    };
  }

  if (accessState?.reason === "OBSERVER_LIMIT_REACHED") {
    return {
      licenseValid: true,
      seatActive: false,
      reason: "OBSERVER_LIMIT_REACHED",
      machineId: accessState.machineId ? String(accessState.machineId) : null,
      activeSessions:
        typeof accessState.activeSessions === "number"
          ? accessState.activeSessions
          : null,
      maxObservers:
        typeof accessState.maxObservers === "number"
          ? accessState.maxObservers
          : null,
      license: accessState.license ?? null,
    };
  }

  if (authenticated && accessState?.license && accessState?.reason == null) {
    return {
      licenseValid: true,
      seatActive: false,
      reason: null,
      machineId: accessState.machineId ? String(accessState.machineId) : null,
      activeSessions:
        typeof accessState.activeSessions === "number"
          ? accessState.activeSessions
          : null,
      maxObservers:
        typeof accessState.maxObservers === "number"
          ? accessState.maxObservers
          : null,
      license: accessState.license ?? null,
    };
  }

  if (authenticated) {
    return {
      licenseValid: false,
      seatActive: false,
      reason: accessState?.reason ? String(accessState.reason) : null,
      machineId: accessState?.machineId ? String(accessState.machineId) : null,
      activeSessions:
        typeof accessState?.activeSessions === "number"
          ? accessState.activeSessions
          : null,
      maxObservers:
        typeof accessState?.maxObservers === "number"
          ? accessState.maxObservers
          : null,
      license: accessState?.license ?? null,
    };
  }

  return {
    licenseValid: false,
    seatActive: false,
    reason: accessState?.reason ? String(accessState.reason) : null,
    machineId: accessState?.machineId ? String(accessState.machineId) : null,
    activeSessions: null,
    maxObservers: null,
    license: accessState?.license ?? null,
  };
}

function determineOverallStatus(snapshot) {
  const criticalIssues = [];
  const warningIssues = [];
  const infoIssues = [];

  if (snapshot.backend.reachable !== true) {
    criticalIssues.push("Backend API unreachable");
  }

  if (snapshot.auth.authenticated !== true) {
    criticalIssues.push("Authentication required");
  } else if (snapshot.auth.tokenValid !== true) {
    criticalIssues.push("Session token invalid");
  }

  if (snapshot.auth.authenticated === true) {
    if (snapshot.license.licenseValid !== true) {
      criticalIssues.push("License invalid");
    }
    if (snapshot.license.seatActive !== true) {
      criticalIssues.push("Launcher seat inactive");
    }
  }

  if (snapshot.telemetry.running !== true && snapshot.matchState.isLocked !== true) {
    criticalIssues.push("Telemetry bridge not running");
  }

  if (snapshot.widgets.running !== true) {
    criticalIssues.push("Widget server not running");
  } else if (snapshot.widgets.reachable !== true) {
    criticalIssues.push("Widget server self-check failed");
  }

  if (
    snapshot.telemetry.running === true &&
    snapshot.telemetry.connectedToBackend !== true &&
    snapshot.matchState.isLocked !== true &&
    snapshot.matchState.isFinalizing !== true
  ) {
    warningIssues.push("Telemetry backend disconnected");
  }

  if (snapshot.telemetry.queueSize > 0) {
    warningIssues.push(
      `Telemetry queue backlog (${snapshot.telemetry.queueSize})`,
    );
  }

  if (
    snapshot.matchState.isFinalizing === true &&
    typeof snapshot.matchState.finalizationDurationMs === "number" &&
    snapshot.matchState.finalizationDurationMs >= FINALIZATION_DELAY_THRESHOLD_MS
  ) {
    warningIssues.push("Match finalization taking longer than expected");
  }

  if (snapshot.matchState.isLocked === true) {
    warningIssues.push("Finished match locked");
  }

  if (snapshot.matchFlow.currentStatus === "FINISHED") {
    infoIssues.push("Match completed \u2014 awaiting next match");
  }

  if (snapshot.matchFlow.nextMatchAvailable === true) {
    infoIssues.push("Next match available");
  }

  if (snapshot.assets.requiredMissingKeys.length > 0) {
    warningIssues.push(
      `Missing required maps: ${snapshot.assets.requiredMissingKeys.join(", ")}`,
    );
  }

  if (snapshot.shadow.reachable !== true) {
    warningIssues.push("ShadowTracker unreachable");
  }

  if (criticalIssues.length > 0) {
    return {
      overallStatus: "critical",
      issues: [...criticalIssues, ...warningIssues, ...infoIssues],
    };
  }

  if (warningIssues.length > 0) {
    return {
      overallStatus: "warning",
      issues: [...warningIssues, ...infoIssues],
    };
  }

  return {
    overallStatus: "healthy",
    issues: infoIssues,
  };
}

function createHealthService(options = {}) {
  const scopedLogger =
    options?.logger &&
    typeof options.logger.info === "function" &&
    typeof options.logger.warn === "function" &&
    typeof options.logger.error === "function"
      ? options.logger
      : null;
  const legacyLog = typeof options?.log === "function" ? options.log : () => {};
  const logInfo = (message, meta) => {
    if (scopedLogger) {
      scopedLogger.info(message, meta);
      return;
    }

    if (typeof meta === "undefined") {
      legacyLog(message);
      return;
    }

    legacyLog(message, meta);
  };
  const logWarn = (message, meta) => {
    if (scopedLogger) {
      scopedLogger.warn(message, meta);
      return;
    }

    if (typeof meta === "undefined") {
      legacyLog(message);
      return;
    }

    legacyLog(message, meta);
  };
  const getConfig =
    typeof options?.getConfig === "function" ? options.getConfig : () => ({});
  const getSession =
    typeof options?.getSession === "function" ? options.getSession : () => null;
  const getAccessState =
    typeof options?.getAccessState === "function"
      ? options.getAccessState
      : () => null;
  const getTelemetryStatus =
    typeof options?.getTelemetryStatus === "function"
      ? options.getTelemetryStatus
      : () => ({});
  const getMatchFlow =
    typeof options?.getMatchFlow === "function"
      ? options.getMatchFlow
      : () => ({});
  const getProductionMode =
    typeof options?.getProductionMode === "function"
      ? options.getProductionMode
      : () => ({});
  const getWidgetStatus =
    typeof options?.getWidgetStatus === "function"
      ? options.getWidgetStatus
      : () => ({});
  const getAssetStatus =
    typeof options?.getAssetStatus === "function"
      ? options.getAssetStatus
      : () => ({});
  const probeShadow =
    typeof options?.probeShadow === "function"
      ? options.probeShadow
      : async () => ({
          reachable: false,
          lastResponseAt: null,
          lastCheckedAt: toIsoTimestamp(),
          lastError: "ShadowTracker probe is unavailable.",
        });

  let lastOverallStatus = null;
  let lastSnapshot = null;
  let lastSnapshotAt = 0;
  let inFlightSnapshot = null;
  let lastBackendSuccessAt = null;
  let lastWidgetSuccessAt = null;
  let lastShadowResponseAt = null;
  let lastDelayedFinalizationWarningKey = null;

  async function probeBackendStatus(config, session) {
    const checkedAt = toIsoTimestamp();
    const apiBase = String(config?.apiBase || getProcessDefaultApiBase()).trim();
    const accessToken = String(
      session?.token || session?.accessToken || "",
    ).trim();
    const hasRefreshToken = Boolean(
      String(session?.refreshToken || "").trim(),
    );
    const authenticated = Boolean(accessToken || hasRefreshToken);

    try {
      const response = await axios.get(`${apiBase}/auth/me`, {
        timeout: 1500,
        validateStatus: () => true,
        headers: {
          Accept: "application/json",
          ...(accessToken
            ? {
                Authorization: `Bearer ${accessToken}`,
              }
            : {}),
        },
      });
      const statusCode = toStatusCode(response?.status);
      const reachable = statusCode !== null && statusCode < 500;

      if (reachable) {
        lastBackendSuccessAt = checkedAt;
      }

      return {
        backend: {
          apiBase,
          reachable,
          statusCode,
          lastSuccessAt: lastBackendSuccessAt,
          lastCheckedAt: checkedAt,
          lastError: reachable
            ? null
            : `Backend returned HTTP ${statusCode ?? "unknown"}`,
        },
        auth: {
          authenticated,
          tokenValid: Boolean(accessToken) && statusCode === 200,
          hasRefreshToken,
          userId:
            session?.user?.id || session?.userId
              ? String(session?.user?.id || session?.userId)
              : null,
          organizationId:
            session?.organization?.id ||
            session?.organizationId ||
            session?.user?.organizationId
              ? String(
                  session?.organization?.id ||
                    session?.organizationId ||
                    session?.user?.organizationId,
                )
              : null,
          lastCheckedAt: checkedAt,
          lastError:
            authenticated && statusCode !== 200
              ? statusCode === 401 || statusCode === 403
                ? "Token invalid or expired."
                : reachable
                  ? `Auth probe returned HTTP ${statusCode}.`
                  : `Backend returned HTTP ${statusCode ?? "unknown"}.`
              : authenticated
                ? null
                : "Not authenticated.",
        },
      };
    } catch (error) {
      const message = asErrorMessage(error, "Backend probe failed.");
      return {
        backend: {
          apiBase,
          reachable: false,
          statusCode: null,
          lastSuccessAt: lastBackendSuccessAt,
          lastCheckedAt: checkedAt,
          lastError: message,
        },
        auth: {
          authenticated,
          tokenValid: false,
          hasRefreshToken,
          userId:
            session?.user?.id || session?.userId
              ? String(session?.user?.id || session?.userId)
              : null,
          organizationId:
            session?.organization?.id ||
            session?.organizationId ||
            session?.user?.organizationId
              ? String(
                  session?.organization?.id ||
                    session?.organizationId ||
                    session?.user?.organizationId,
                )
              : null,
          lastCheckedAt: checkedAt,
          lastError: authenticated ? message : "Not authenticated.",
        },
      };
    }
  }

  async function probeWidgetHealth(widgetStatus) {
    const checkedAt = toIsoTimestamp();
    const baseUrl =
      widgetStatus?.localBaseUrl ||
      widgetStatus?.baseUrl ||
      (widgetStatus?.port ? `http://localhost:${widgetStatus.port}` : null);
    const running = widgetStatus?.running === true;

    if (!running || !baseUrl) {
      return {
        running,
        reachable: false,
        port:
          typeof widgetStatus?.port === "number" ? widgetStatus.port : null,
        baseUrl: baseUrl ? String(baseUrl) : null,
        lastSuccessAt: lastWidgetSuccessAt,
        lastCheckedAt: checkedAt,
        lastError: running
          ? "Widget server base URL unavailable."
          : "Widget server is not running.",
      };
    }

    try {
      const response = await axios.get(`${baseUrl}/health`, {
        timeout: 1000,
        validateStatus: () => true,
      });
      const statusCode = toStatusCode(response?.status);
      const reachable = Boolean(statusCode && statusCode >= 200 && statusCode < 300);

      if (reachable) {
        lastWidgetSuccessAt = checkedAt;
      }

      return {
        running: true,
        reachable,
        port:
          typeof widgetStatus?.port === "number" ? widgetStatus.port : null,
        baseUrl: String(baseUrl),
        lastSuccessAt: lastWidgetSuccessAt,
        lastCheckedAt: checkedAt,
        lastError: reachable ? null : `Widget health returned HTTP ${statusCode}.`,
      };
    } catch (error) {
      return {
        running: true,
        reachable: false,
        port:
          typeof widgetStatus?.port === "number" ? widgetStatus.port : null,
        baseUrl: String(baseUrl),
        lastSuccessAt: lastWidgetSuccessAt,
        lastCheckedAt: checkedAt,
        lastError: asErrorMessage(error, "Widget self-check failed."),
      };
    }
  }

  async function buildSnapshot() {
    const checkedAt = toIsoTimestamp();
    const config = getConfig() || {};
    const session = getSession() || null;
    const accessState = getAccessState() || null;
    const telemetry = normalizeTelemetryStatus(getTelemetryStatus() || {});
    const matchFlow = normalizeMatchFlow(getMatchFlow() || {});
    const productionMode = normalizeProductionMode(getProductionMode() || {});
    const widgetStatus = getWidgetStatus() || {};
    const assetStatus = getAssetStatus() || {};

    const [backendProbe, widgets, shadowProbe] = await Promise.all([
      probeBackendStatus(config, session),
      probeWidgetHealth(widgetStatus),
      probeShadow(),
    ]);

    if (shadowProbe?.reachable === true && shadowProbe?.lastResponseAt) {
      lastShadowResponseAt =
        toIsoTimestamp(shadowProbe.lastResponseAt) || lastShadowResponseAt;
    }

    const snapshot = {
      checkedAt,
      backend: {
        apiBase: backendProbe.backend.apiBase,
        reachable: backendProbe.backend.reachable === true,
        statusCode: backendProbe.backend.statusCode,
        lastSuccessAt: backendProbe.backend.lastSuccessAt,
        lastCheckedAt: backendProbe.backend.lastCheckedAt,
        lastError: backendProbe.backend.lastError,
      },
      auth: backendProbe.auth,
      license: buildLicenseHealth(session, accessState),
      telemetry,
      matchState: {
        status: telemetry.matchStatus ?? null,
        isLocked: telemetry.isLocked === true,
        isFinalizing: telemetry.isFinalizing === true,
        finalizationStartedAt: telemetry.finalizationStartedAt ?? null,
        finalizationDurationMs: telemetry.finalizationDurationMs ?? null,
      },
      matchFlow,
      productionMode,
      widgets,
      assets: {
        requiredTotal: Number(assetStatus?.requiredTotal ?? 0) || 0,
        requiredAvailable: Number(assetStatus?.requiredAvailable ?? 0) || 0,
        requiredMissingKeys: Array.isArray(assetStatus?.requiredMissingKeys)
          ? [...assetStatus.requiredMissingKeys]
          : [],
        checkedAt: toIsoTimestamp(assetStatus?.checkedAt),
      },
      shadow: {
        reachable: shadowProbe?.reachable === true,
        baseUrl: shadowProbe?.baseUrl ? String(shadowProbe.baseUrl) : null,
        lastResponseAt:
          toIsoTimestamp(shadowProbe?.lastResponseAt) || lastShadowResponseAt,
        lastCheckedAt: toIsoTimestamp(shadowProbe?.lastCheckedAt) || checkedAt,
        lastError: shadowProbe?.lastError ? String(shadowProbe.lastError) : null,
      },
      overallStatus: "healthy",
      issues: [],
    };

    const overall = determineOverallStatus(snapshot);
    snapshot.overallStatus = overall.overallStatus;
    snapshot.issues = overall.issues;

    const delayedFinalization =
      snapshot.matchState.isFinalizing === true &&
      typeof snapshot.matchState.finalizationDurationMs === "number" &&
      snapshot.matchState.finalizationDurationMs >= FINALIZATION_DELAY_THRESHOLD_MS;
    if (delayedFinalization) {
      const warningKey = [
        snapshot.telemetry.matchId || "unknown",
        snapshot.matchState.finalizationStartedAt || "unknown",
      ].join(":");
      if (lastDelayedFinalizationWarningKey !== warningKey) {
        lastDelayedFinalizationWarningKey = warningKey;
        logWarn("Match finalization taking longer than expected", {
          matchId: snapshot.telemetry.matchId,
          finalizationStartedAt: snapshot.matchState.finalizationStartedAt,
          finalizationDurationMs: snapshot.matchState.finalizationDurationMs,
          thresholdMs: FINALIZATION_DELAY_THRESHOLD_MS,
        });
      }
    } else {
      lastDelayedFinalizationWarningKey = null;
    }

    if (lastOverallStatus && lastOverallStatus !== snapshot.overallStatus) {
      logInfo("Status changed", {
        from: lastOverallStatus,
        to: snapshot.overallStatus,
        issues: snapshot.issues,
      });
    }
    lastOverallStatus = snapshot.overallStatus;

    return snapshot;
  }

  async function getStatus() {
    const now = Date.now();
    if (lastSnapshot && now - lastSnapshotAt < SNAPSHOT_CACHE_TTL_MS) {
      return lastSnapshot;
    }

    if (inFlightSnapshot) {
      return inFlightSnapshot;
    }

    inFlightSnapshot = buildSnapshot()
      .then((snapshot) => {
        lastSnapshot = snapshot;
        lastSnapshotAt = Date.now();
        return snapshot;
      })
      .finally(() => {
        inFlightSnapshot = null;
      });

    return inFlightSnapshot;
  }

  return {
    getStatus,
  };
}

module.exports = {
  createHealthService,
};
