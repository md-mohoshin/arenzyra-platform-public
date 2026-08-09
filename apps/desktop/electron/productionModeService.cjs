"use strict";

const { normalizeMapKey } = require("./map-engine/map-asset-resolver.cjs");
const {
  isMapLookupMatch,
  MAP_DEFINITIONS,
  normalizeLookup: normalizeMapLookup,
} = require("./map-engine/map-registry.cjs");

const READY_STATUSES = new Set(["READY", "READY_WITH_WARNINGS"]);

function resolveRegisteredMapKey(value) {
  const normalized = normalizeMapLookup(value);
  if (!normalized) {
    return null;
  }

  let mostSpecific = null;
  let mostSpecificLength = -1;
  for (const definition of MAP_DEFINITIONS) {
    for (const candidate of [definition.key, ...(definition.aliases || [])]) {
      const lookup = normalizeMapLookup(candidate);
      if (
        isMapLookupMatch(normalized, lookup) &&
        lookup.length > mostSpecificLength
      ) {
        mostSpecific = definition.key;
        mostSpecificLength = lookup.length;
      }
    }
  }
  return mostSpecific;
}

function asErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

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

function normalizeLifecycleStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "DRAFT") {
    return "READY";
  }
  return normalized;
}

function isProductionEligibleLifecycleStatus(value) {
  const normalized = normalizeLifecycleStatus(value);
  return Boolean(
    normalized &&
      normalized !== "ENDED" &&
      normalized !== "FINISH_PENDING" &&
      normalized !== "FINISHED",
  );
}

function createProductionModeService(options = {}) {
  const scopedLogger =
    options?.logger &&
    typeof options.logger.info === "function" &&
    typeof options.logger.warn === "function" &&
    typeof options.logger.error === "function"
      ? options.logger
      : null;
  const legacyLog = typeof options?.log === "function" ? options.log : () => {};
  const getHealthStatus =
    typeof options?.getHealthStatus === "function"
      ? options.getHealthStatus
      : async () => ({});
  const getMatchLifecycle =
    typeof options?.getMatchLifecycle === "function"
      ? options.getMatchLifecycle
      : async () => ({ status: null });
  const resolveShadowExecutable =
    typeof options?.resolveShadowExecutable === "function"
      ? options.resolveShadowExecutable
      : () => "";
  const ensureConnectorInstalled =
    typeof options?.ensureConnectorInstalled === "function"
      ? options.ensureConnectorInstalled
      : null;
  const getTelemetryStatus =
    typeof options?.getTelemetryStatus === "function"
      ? options.getTelemetryStatus
      : () => ({});
  const resetTelemetryForMatch =
    typeof options?.resetTelemetryForMatch === "function"
      ? options.resetTelemetryForMatch
      : async () => ({});
  const getAssetStatus =
    typeof options?.getAssetStatus === "function"
      ? options.getAssetStatus
      : () => ({ maps: {}, requiredMissingKeys: [] });
  const getSession =
    typeof options?.getSession === "function" ? options.getSession : () => null;
  const syncTeams =
    typeof options?.syncTeams === "function" ? options.syncTeams : null;
  const generateBranding =
    typeof options?.generateBranding === "function"
      ? options.generateBranding
      : null;

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

  async function runPreflight(params = {}) {
    const preflightStartedAt = Date.now();
    const matchId = String(
      params?.matchId || params?.selectedMatch?.id || "",
    ).trim();
    const selectedMatch =
      params?.selectedMatch &&
      typeof params.selectedMatch === "object" &&
      !Array.isArray(params.selectedMatch)
        ? params.selectedMatch
        : null;
    const shadowTrackerPath = String(params?.shadowTrackerPath || "").trim();
    const checkedAt = toIsoTimestamp() || new Date().toISOString();
    const checks = [];
    const blockingIssues = [];
    const warnings = [];
    let blockingFailed = false;

    if (!matchId) {
      throw new Error("Select a match before entering production mode.");
    }

    logInfo(`[Production] Entering production mode for match ${matchId}`, {
      matchId,
    });

    const pushCheck = ({
      key,
      label,
      status,
      blocking = false,
      message,
      meta = undefined,
    }) => {
      const normalizedMessage = String(message || "").trim() || label;
      const entry = {
        key,
        label,
        status,
        blocking,
        message: normalizedMessage,
        ...(typeof meta === "undefined" ? {} : { meta }),
      };
      checks.push(entry);

      if (status === "warning" || (status === "fail" && blocking !== true)) {
        warnings.push(normalizedMessage);
      }
      if (status === "fail" && blocking === true) {
        blockingIssues.push(normalizedMessage);
        blockingFailed = true;
      }

      const logMeta = {
        matchId,
        key,
        label,
        blocking,
        message: normalizedMessage,
        ...(typeof meta === "undefined" ? {} : { meta }),
      };
      if (status === "pass") {
        logInfo(`[Production] Check passed: ${key}`, logMeta);
      } else if (status === "warning") {
        logWarn(`[Production] Check warning: ${key}`, logMeta);
      } else {
        logWarn(`[Production] Check failed: ${key}`, logMeta);
      }
    };

    let lifecycleStatus = null;
    try {
      const lifecycle = (await getMatchLifecycle(matchId)) || {};
      lifecycleStatus = normalizeLifecycleStatus(
        lifecycle?.status ??
          lifecycle?.matchStatus ??
          lifecycle?.control?.matchStatus ??
          lifecycle?.control?.status,
      );

      if (!lifecycleStatus) {
        pushCheck({
          key: "match",
          label: "Match",
          status: "fail",
          blocking: true,
          message: "Selected match could not be validated from backend state.",
        });
      } else if (!isProductionEligibleLifecycleStatus(lifecycleStatus)) {
        const message =
          lifecycle?.isFinalizing === true ||
          lifecycleStatus === "ENDED" ||
          lifecycleStatus === "FINISH_PENDING"
            ? "Selected match is finalizing and cannot enter production mode."
            : lifecycleStatus === "FINISHED"
              ? "Selected match is completed and locked."
              : `Selected match is not eligible for production mode (${lifecycleStatus}).`;
        pushCheck({
          key: "match",
          label: "Match",
          status: "fail",
          blocking: true,
          message,
          meta: {
            lifecycleStatus,
          },
        });
      } else {
        pushCheck({
          key: "match",
          label: "Match",
          status: "pass",
          blocking: false,
          message:
            lifecycleStatus === "LIVE"
              ? "Selected match is already LIVE and can be recovered for telemetry."
              : `Selected match is startable in ${lifecycleStatus} state.`,
          meta: {
            lifecycleStatus,
          },
        });
      }
    } catch (error) {
      pushCheck({
        key: "match",
        label: "Match",
        status: "fail",
        blocking: true,
        message: asErrorMessage(
          error,
          "Selected match could not be loaded from backend.",
        ),
      });
    }

    const resolvedShadowExecutable = await resolveShadowExecutable(
      shadowTrackerPath,
    );
    if (resolvedShadowExecutable && ensureConnectorInstalled) {
      try {
        const connectorStatus =
          ensureConnectorInstalled(resolvedShadowExecutable) || {};
        if (connectorStatus.ok !== true) {
          pushCheck({
            key: "connector",
            label: "Arenzyra Connector",
            status: "fail",
            blocking: true,
            message:
              connectorStatus.error ||
              "Arenzyra ob.js connector could not be installed.",
            meta: {
              status: connectorStatus.status || null,
              sourcePath: connectorStatus.sourcePath || null,
              targetPath: connectorStatus.targetPath || null,
              targetStrategy: connectorStatus.targetStrategy || null,
              targetExisting: connectorStatus.targetExisting === true,
              shadowTrackerPath: resolvedShadowExecutable,
              requiresAdmin: connectorStatus.requiresAdmin === true,
            },
          });
        } else {
          const action = connectorStatus.installed
            ? connectorStatus.repaired
              ? "repaired"
              : "installed"
            : "ready";
          pushCheck({
            key: "connector",
            label: "Arenzyra Connector",
            status: "pass",
            blocking: false,
            message: `Arenzyra ob.js connector is ${action}.`,
            meta: {
              status: connectorStatus.status || null,
              sourcePath: connectorStatus.sourcePath || null,
              targetPath: connectorStatus.targetPath || null,
              targetStrategy: connectorStatus.targetStrategy || null,
              targetExisting: connectorStatus.targetExisting === true,
              backupPath: connectorStatus.backupPath || null,
              sourceHash: connectorStatus.sourceHash || null,
              targetHash: connectorStatus.targetHash || null,
            },
          });
        }
      } catch (error) {
        pushCheck({
          key: "connector",
          label: "Arenzyra Connector",
          status: "fail",
          blocking: true,
          message: asErrorMessage(
            error,
            "Arenzyra ob.js connector could not be installed.",
          ),
          meta: {
            shadowTrackerPath: resolvedShadowExecutable,
          },
        });
      }
    }

    let health = null;
    try {
      health = (await getHealthStatus()) || {};
      const backendIssues = [];
      if (health?.backend?.reachable !== true) {
        backendIssues.push("Backend API unreachable.");
      }
      if (health?.auth?.authenticated !== true) {
        backendIssues.push("Organizer authentication required.");
      } else if (health?.auth?.tokenValid !== true) {
        backendIssues.push("Organizer session is invalid or expired.");
      }
      if (health?.license?.licenseValid !== true) {
        backendIssues.push("Launcher license is invalid.");
      }
      if (health?.license?.seatActive !== true) {
        backendIssues.push("Launcher seat is not active.");
      }

      if (backendIssues.length > 0) {
        pushCheck({
          key: "backend",
          label: "Backend",
          status: "fail",
          blocking: true,
          message: backendIssues.join(" "),
          meta: {
            apiBase: health?.backend?.apiBase || null,
            statusCode: health?.backend?.statusCode ?? null,
            reason: health?.license?.reason ?? null,
          },
        });
      } else {
        pushCheck({
          key: "backend",
          label: "Backend",
          status: "pass",
          blocking: false,
          message: "Backend, auth, license, and observer seat are ready.",
          meta: {
            apiBase: health?.backend?.apiBase || null,
          },
        });
      }
    } catch (error) {
      pushCheck({
        key: "backend",
        label: "Backend",
        status: "fail",
        blocking: true,
        message: asErrorMessage(error, "Backend preflight failed."),
      });
    }

    const widgetHealth = health?.widgets || {};
    if (widgetHealth?.running !== true) {
      pushCheck({
        key: "widgets",
        label: "Widget Server",
        status: "fail",
        blocking: true,
        message: "Widget server is not running.",
        meta: {
          port: widgetHealth?.port ?? null,
          baseUrl: widgetHealth?.baseUrl ?? null,
        },
      });
    } else if (widgetHealth?.reachable !== true) {
      pushCheck({
        key: "widgets",
        label: "Widget Server",
        status: "fail",
        blocking: true,
        message: widgetHealth?.lastError
          ? String(widgetHealth.lastError)
          : "Widget server health route did not respond.",
        meta: {
          port: widgetHealth?.port ?? null,
          baseUrl: widgetHealth?.baseUrl ?? null,
        },
      });
    } else {
      pushCheck({
        key: "widgets",
        label: "Widget Server",
        status: "pass",
        blocking: false,
        message: "Widget server is running and healthy.",
        meta: {
          port: widgetHealth?.port ?? null,
          baseUrl: widgetHealth?.baseUrl ?? null,
        },
      });
    }

    const assetStatus = getAssetStatus() || {};
    const rawSelectedMap = selectedMatch?.map || "";
    const normalizedSelectedMapKey = normalizeMapKey(rawSelectedMap);
    const registeredSelectedMapKey = resolveRegisteredMapKey(rawSelectedMap);
    const selectedMapKey = registeredSelectedMapKey || normalizedSelectedMapKey;
    const selectedMapAsset =
      selectedMapKey &&
      assetStatus?.maps &&
      typeof assetStatus.maps === "object" &&
      !Array.isArray(assetStatus.maps)
        ? assetStatus.maps[selectedMapKey] || null
        : null;
    const requiredMissingKeys = Array.isArray(assetStatus?.requiredMissingKeys)
      ? [...assetStatus.requiredMissingKeys]
      : [];

    if (normalizedSelectedMapKey && !registeredSelectedMapKey) {
      pushCheck({
        key: "assets",
        label: "Assets",
        status: "fail",
        blocking: true,
        message: `Selected map is not supported by this launcher: ${normalizedSelectedMapKey}.`,
        meta: {
          selectedMapKey: normalizedSelectedMapKey,
          requiredMissingKeys,
        },
      });
    } else if (
      selectedMapKey &&
      selectedMapAsset?.assetAvailable !== true
    ) {
      pushCheck({
        key: "assets",
        label: "Assets",
        status: "fail",
        blocking: true,
        message: `Selected map asset is missing for ${selectedMapKey}.`,
        meta: {
          selectedMapKey,
          requiredMissingKeys,
        },
      });
    } else if (requiredMissingKeys.length > 0) {
      pushCheck({
        key: "assets",
        label: "Assets",
        status: "warning",
        blocking: false,
        message: `Missing non-critical map assets: ${requiredMissingKeys.join(", ")}.`,
        meta: {
          selectedMapKey: selectedMapKey || null,
          requiredMissingKeys,
        },
      });
    } else {
      pushCheck({
        key: "assets",
        label: "Assets",
        status: "pass",
        blocking: false,
        message: selectedMapKey
          ? `Required assets are available for ${selectedMapKey}.`
          : "Required map assets are available.",
        meta: {
          selectedMapKey: selectedMapKey || null,
        },
      });
    }

    if (!resolvedShadowExecutable) {
      pushCheck({
        key: "shadow",
        label: "ShadowTracker",
        status: "fail",
        blocking: true,
        message:
          "ShadowTracker executable was not found. Set a valid path or install the supported build.",
      });
    } else if (health?.shadow?.reachable !== true) {
      pushCheck({
        key: "shadow",
        label: "ShadowTracker",
        status: "fail",
        blocking: true,
        message:
          "ShadowTracker local telemetry service is not reachable. Verify ShadowTracker is running and retry production mode.",
        meta: {
          executablePath: resolvedShadowExecutable,
          telemetryBaseUrl: health?.shadow?.baseUrl || null,
          lastError: health?.shadow?.lastError || null,
        },
      });
    } else {
      pushCheck({
        key: "shadow",
        label: "ShadowTracker",
        status: "pass",
        blocking: false,
        message: "ShadowTracker executable and local telemetry endpoint are ready.",
        meta: {
          executablePath: resolvedShadowExecutable,
          telemetryBaseUrl: health?.shadow?.baseUrl || null,
        },
      });
    }

    const telemetryStatus = getTelemetryStatus() || {};
    if (
      telemetryStatus?.running === true &&
      telemetryStatus?.matchId &&
      String(telemetryStatus.matchId).trim() !== matchId
    ) {
      pushCheck({
        key: "telemetry",
        label: "Telemetry",
        status: "fail",
        blocking: true,
        message: `Telemetry bridge is already running for match ${telemetryStatus.matchId}. Stop it before entering production mode for ${matchId}.`,
        meta: {
          runningMatchId: telemetryStatus.matchId,
          connectionStatus: telemetryStatus.connectionStatus || null,
        },
      });
    } else {
      try {
        const resetResult = (await resetTelemetryForMatch()) || {};
        const resetStillBusy =
          resetResult?.running === true ||
          Number(resetResult?.queueSize ?? 0) > 0 ||
          (typeof resetResult?.matchId === "string" && resetResult.matchId.trim());
        if (resetStillBusy) {
          pushCheck({
            key: "telemetry",
            label: "Telemetry",
            status: "fail",
            blocking: true,
            message: "Telemetry bridge could not be reset to a clean idle state.",
            meta: {
              running: resetResult?.running === true,
              matchId: resetResult?.matchId || null,
              queueSize: Number(resetResult?.queueSize ?? 0) || 0,
              connectionStatus: resetResult?.connectionStatus || null,
            },
          });
        } else {
          pushCheck({
            key: "telemetry",
            label: "Telemetry",
            status: "pass",
            blocking: false,
            message: "Telemetry bridge is reset and idle for the selected match.",
            meta: {
              connectionStatus: resetResult?.connectionStatus || null,
            },
          });
        }
      } catch (error) {
        pushCheck({
          key: "telemetry",
          label: "Telemetry",
          status: "fail",
          blocking: true,
          message: asErrorMessage(
            error,
            "Telemetry bridge could not be reset cleanly.",
          ),
        });
      }
    }

    let teamsResult = null;
    if (!blockingFailed && syncTeams) {
      try {
        const session = getSession();
        teamsResult = await syncTeams(session, matchId);
        const syncedCount = Number(teamsResult?.syncedCount ?? 0) || 0;
        const slotCount = Number(teamsResult?.slotCount ?? 0) || 0;
        const slotRecovery =
          teamsResult?.slotRecovery &&
          typeof teamsResult.slotRecovery === "object"
            ? teamsResult.slotRecovery
            : null;
        const teamsMeta = {
          matchId: teamsResult?.matchId || matchId,
          syncedCount,
          slotCount,
          teamAssetsDir: teamsResult?.teamAssetsDir || null,
          playerAssetsDir: teamsResult?.playerAssetsDir || null,
          playerPhotoSync: teamsResult?.playerPhotoSync || null,
          playerPhotoSyncSkipped: teamsResult?.playerPhotoSyncSkipped === true,
          slots: Array.isArray(teamsResult?.slots) ? teamsResult.slots : [],
          slotRecovery,
        };

        if (syncedCount < 2) {
          pushCheck({
            key: "teams",
            label: "Teams",
            status: "fail",
            blocking: true,
            message:
              slotRecovery?.message ||
              `Team sync prepared only ${syncedCount} assigned teams from ${slotCount} slots.`,
            meta: teamsMeta,
          });
        } else {
          pushCheck({
            key: "teams",
            label: "Teams",
            status: "pass",
            blocking: false,
            message: slotRecovery?.applied
              ? `${slotRecovery.message} Team sync prepared ${syncedCount} assigned teams from ${slotCount} slots.`
              : `Team sync prepared ${syncedCount} assigned teams from ${slotCount} slots.`,
            meta: teamsMeta,
          });
        }
      } catch (error) {
        pushCheck({
          key: "teams",
          label: "Teams",
          status: "fail",
          blocking: true,
          message: asErrorMessage(
            error,
            "Team sync could not be completed during production mode.",
          ),
        });
      }
    } else {
      pushCheck({
        key: "teams",
        label: "Teams",
        status: "warning",
        blocking: false,
        message: "Team sync was skipped until blocking issues are resolved.",
      });
    }

    if (!blockingFailed && teamsResult?.playerPhotoSyncSkipped === true) {
      pushCheck({
        key: "player-assets",
        label: "Player Photos",
        status: "pass",
        blocking: false,
        message:
          "Local player photo caching was skipped for faster Production Mode; widgets will use live/API photo fallbacks.",
        meta: {
          matchId: teamsResult?.matchId || matchId,
          skipped: true,
          playerAssetsDir: teamsResult?.playerAssetsDir || null,
        },
      });
    } else if (!blockingFailed && teamsResult?.playerPhotoSync) {
      const playerPhotoSync = teamsResult.playerPhotoSync;
      const totalPlayers = Number(playerPhotoSync?.totalPlayers ?? 0) || 0;
      const syncedPhotos = Number(playerPhotoSync?.syncedCount ?? 0) || 0;
      const missingPhotos = Number(playerPhotoSync?.missingPhotoCount ?? 0) || 0;
      const failedPhotos = Number(playerPhotoSync?.failedCount ?? 0) || 0;
      const meta = {
        matchId: teamsResult?.matchId || matchId,
        playerAssetsDir: playerPhotoSync?.playerAssetsDir || null,
        totalPlayers,
        syncedCount: syncedPhotos,
        missingPhotoCount: missingPhotos,
        failedCount: failedPhotos,
        failures: Array.isArray(playerPhotoSync?.failures)
          ? playerPhotoSync.failures
          : [],
        teamFetchFailures: Array.isArray(playerPhotoSync?.teamFetchFailures)
          ? playerPhotoSync.teamFetchFailures
          : [],
      };

      if (totalPlayers === 0) {
        pushCheck({
          key: "player-assets",
          label: "Player Photos",
          status: "warning",
          blocking: false,
          message:
            "No assigned player roster was available to cache local player photos.",
          meta,
        });
      } else if (failedPhotos > 0 || missingPhotos > 0) {
        pushCheck({
          key: "player-assets",
          label: "Player Photos",
          status: "warning",
          blocking: false,
          message: `Cached ${syncedPhotos}/${totalPlayers} player photos locally. ${missingPhotos} players have no uploaded photo and ${failedPhotos} downloads failed.`,
          meta,
        });
      } else {
        pushCheck({
          key: "player-assets",
          label: "Player Photos",
          status: "pass",
          blocking: false,
          message: `Cached ${syncedPhotos}/${totalPlayers} player photos locally.`,
          meta,
        });
      }
    } else {
      pushCheck({
        key: "player-assets",
        label: "Player Photos",
        status: "warning",
        blocking: false,
        message:
          "Player photo sync was skipped until blocking issues are resolved.",
      });
    }

    if (!blockingFailed && generateBranding) {
      try {
        const session = getSession();
        const brandingContext =
          teamsResult && Array.isArray(teamsResult.slots)
            ? {
                matchId: teamsResult.matchId || matchId,
                baseUrl: teamsResult.baseUrl || null,
                slots: teamsResult.slots,
              }
            : undefined;
        const brandingResult = await generateBranding(
          session,
          matchId,
          brandingContext,
        );
        const renderedCount = Number(brandingResult?.renderedCount ?? 0) || 0;
        const cacheHitCount = Number(brandingResult?.cacheHitCount ?? 0) || 0;
        const brandingMessage =
          renderedCount > 0
            ? `Branding was generated for ${brandingResult?.teamCount ?? 0} teams (${renderedCount} rendered, ${cacheHitCount} reused).`
            : `Branding was already current for ${brandingResult?.teamCount ?? 0} teams.`;
        pushCheck({
          key: "branding",
          label: "Branding",
          status: "pass",
          blocking: false,
          message: brandingMessage,
          meta: {
            matchId: brandingResult?.matchId || matchId,
            teamCount: brandingResult?.teamCount ?? 0,
            brandingConfigPath: brandingResult?.brandingConfigPath || null,
            teamAssetsDir: brandingResult?.teamAssetsDir || null,
            renderedCount,
            cacheHitCount,
            cachePath: brandingResult?.cachePath || null,
            reusedSyncedSlots: brandingResult?.reusedSyncedSlots === true,
            slots: Array.isArray(brandingResult?.slots)
              ? brandingResult.slots
              : [],
          },
        });
      } catch (error) {
        pushCheck({
          key: "branding",
          label: "Branding",
          status: "fail",
          blocking: true,
          message: asErrorMessage(
            error,
            "Branding generation could not be completed during production mode.",
          ),
        });
      }
    } else {
      pushCheck({
        key: "branding",
        label: "Branding",
        status: "warning",
        blocking: false,
        message: "Branding generation was skipped until blocking issues are resolved.",
      });
    }

    const hasBlockingFailures = checks.some(
      (check) => check.status === "fail" && check.blocking === true,
    );
    const hasWarnings = checks.some((check) => check.status === "warning");
    const status = hasBlockingFailures
      ? "BLOCKED"
      : hasWarnings
        ? "READY_WITH_WARNINGS"
        : "READY";

    const result = {
      status,
      checkedAt,
      durationMs: Math.max(0, Date.now() - preflightStartedAt),
      matchId,
      checks,
      blockingIssues,
      warnings,
    };

    if (READY_STATUSES.has(status)) {
      logInfo(`[Production] Production ready for match ${matchId}`, {
        matchId,
        status,
        warningCount: warnings.length,
      });
    } else {
      logWarn(`[Production] Production blocked for match ${matchId}`, {
        matchId,
        blockingIssues,
      });
    }

    return result;
  }

  return {
    runPreflight,
  };
}

module.exports = {
  createProductionModeService,
  isProductionReadyStatus: (status) => READY_STATUSES.has(status),
  resolveRegisteredMapKey,
};
