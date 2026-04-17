"use strict";

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cors = require("cors");
const express = require("express");
const { getProcessDefaultApiBase } = require("../apiBaseDefaults.cjs");
const { createMapRegistry } = require("../map-engine/map-registry.cjs");
const { createMapTelemetryBridge } = require("../map-engine/telemetry-map-bridge.cjs");
const { createMapWidgetEngine } = require("../map-engine/map-widget-engine.cjs");
const { createDirectObserverSnapshotPoller } = require("./direct-observer-snapshot-poller.cjs");
const { registerHealthRoute } = require("./routes/health-route.cjs");
const { registerObsMapRoute } = require("./routes/obs-map-route.cjs");
const { registerObsPlayerPhotoRoute } = require("./routes/obs-player-photo-route.cjs");
const { registerTeamEliminatedRoute } = require("./routes/team-eliminated-route.cjs");
const { registerPermanentWidgetRoute } = require("./routes/permanent-widget-route.cjs");
const { createLocalWidgetBroadcast } = require("./ws/local-widget-broadcast.cjs");

const DEFAULT_PORT = 5510;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_TEAM_ASSETS_ROOT = "C:\\ArenzyraObserver\\assets\\teams";
const DEFAULT_PLAYER_ASSETS_ROOT = "C:\\ArenzyraObserver\\assets\\players";
const DEFAULT_LAUNCHER_LOG_PATH = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "arenzyra-observer-launcher",
  "logs",
  "launcher.log",
);
const MAX_LAUNCHER_LOG_TAIL_BYTES = 2 * 1024 * 1024;
const FORCED_MAP_LOG_CACHE_MS = 5_000;
const PLACEHOLDER_TEAM_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axzwoAAAAASUVORK5CYII=";
const PLACEHOLDER_PLAYER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axzwoAAAAASUVORK5CYII=";
const PLAYER_ASSET_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

let cachedLogForcedMapKey = null;
let cachedLogForcedMapKeyAt = 0;

function normalizeMapKeyValue(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizePlayerAssetKey(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || null;
}

function findPlayerAssetPath(playerAssetsRoot, playerId) {
  const key = normalizePlayerAssetKey(playerId);
  if (!key) {
    return null;
  }

  for (const extension of PLAYER_ASSET_EXTENSIONS) {
    const candidate = path.join(playerAssetsRoot, `${key}${extension}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readFileTail(filePath, maxBytes) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  if (length <= 0) {
    return "";
  }

  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(handle);
  }
}

function parseLatestSelectedMapKeyFromLauncherLog(filePath = DEFAULT_LAUNCHER_LOG_PATH) {
  const now = Date.now();
  if (now - cachedLogForcedMapKeyAt < FORCED_MAP_LOG_CACHE_MS) {
    return cachedLogForcedMapKey;
  }

  cachedLogForcedMapKeyAt = now;
  cachedLogForcedMapKey = null;

  const text = readFileTail(filePath, MAX_LAUNCHER_LOG_TAIL_BYTES);
  if (!text) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line || line[0] !== "{") {
      continue;
    }

    try {
      const entry = JSON.parse(line);
      if (String(entry?.message || "") !== "[Production] Check passed: assets") {
        continue;
      }

      const selectedMapKey = normalizeMapKeyValue(entry?.meta?.meta?.selectedMapKey);
      if (selectedMapKey) {
        cachedLogForcedMapKey = selectedMapKey;
        return cachedLogForcedMapKey;
      }
    } catch (_) {
      // Ignore malformed log lines from tail reads.
    }
  }

  return null;
}

function resolveBundledDefaultTeamPath() {
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "default-team.png"));
  }

  candidates.push(path.resolve(__dirname, "../../build/default-team.png"));

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function normalizePort(value, fallback = DEFAULT_PORT) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 65535) {
    return fallback;
  }
  return numeric;
}

function buildHttpUrl(host, port) {
  return `http://${host}:${port}`;
}

function isIpv4Family(family) {
  return family === "IPv4" || family === 4;
}

function isPrivateIpv4(address) {
  const octets = String(address || "")
    .split(".")
    .map((value) => Number(value));
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function getLanIp() {
  const candidates = [];
  const interfaces = os.networkInterfaces();

  Object.values(interfaces).forEach((entries) => {
    (entries || []).forEach((entry) => {
      if (!entry || entry.internal || !isIpv4Family(entry.family)) {
        return;
      }

      const address = String(entry.address || "").trim();
      if (!address || address.startsWith("169.254.")) {
        return;
      }

      candidates.push(address);
    });
  });

  return candidates.find(isPrivateIpv4) || candidates[0] || null;
}

function canExposeNetworkAddress(bindHost, lanIp) {
  if (!lanIp) {
    return false;
  }

  return bindHost === "0.0.0.0" || bindHost === "::" || bindHost === lanIp;
}

function startWidgetsServer(options = {}) {
  const scopedLogger =
    options?.logger &&
    typeof options.logger.info === "function" &&
    typeof options.logger.warn === "function" &&
    typeof options.logger.error === "function"
      ? options.logger
      : null;
  const legacyLog = typeof options.log === "function" ? options.log : () => {};
  const log = (message, meta) => {
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
  const logError = (message, meta) => {
    if (scopedLogger) {
      scopedLogger.error(message, meta);
      return;
    }

    if (typeof meta === "undefined") {
      legacyLog(message);
      return;
    }

    legacyLog(message, meta);
  };
  const port = normalizePort(
    options.port ?? process.env.ARENZYRA_WIDGET_PORT,
    DEFAULT_PORT,
  );
  const host = options.host || DEFAULT_HOST;
  const startedAt = Date.now();
  const localBaseUrl = buildHttpUrl("localhost", port);
  const lanIp = getLanIp();
  const networkBaseUrl = canExposeNetworkAddress(host, lanIp)
    ? buildHttpUrl(lanIp, port)
    : null;
  const teamAssetsRoot = path.resolve(
    options.teamAssetsRoot ||
      process.env.ARENZYRA_TEAM_ASSETS_DIR ||
      DEFAULT_TEAM_ASSETS_ROOT,
  );
  const playerAssetsRoot = path.resolve(
    options.playerAssetsRoot ||
      process.env.ARENZYRA_PLAYER_ASSETS_DIR ||
      DEFAULT_PLAYER_ASSETS_ROOT,
  );

  const registry = createMapRegistry({
    assetsRoot: options.assetsRoot,
    log,
  });
  registry.validateAssets();

  const app = express();
  const httpServer = http.createServer(app);
  let resolveReady = () => {};
  let rejectReady = () => {};
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const broadcast = createLocalWidgetBroadcast({
    path: options.wsPath || "/ws",
    log,
  });
  const engine = createMapWidgetEngine({
    registry,
    broadcast,
    log,
  });
  const telemetryBridge = createMapTelemetryBridge({
    engine,
    registry,
    log,
  });
  const runtimeForcedMapKey =
    typeof options.getForcedMapKey === "function"
      ? options.getForcedMapKey
      : () => null;
  const resolveForcedMapKey = () =>
    normalizeMapKeyValue(runtimeForcedMapKey()) ||
    parseLatestSelectedMapKeyFromLauncherLog();
  const directObserverPoller = createDirectObserverSnapshotPoller({
    observerBaseUrl: options.observerBaseUrl,
    getObserverBaseUrl:
      typeof options.getObserverBaseUrl === "function"
        ? options.getObserverBaseUrl
        : null,
    isEnabled:
      typeof options.shouldPollDirectObserver === "function"
        ? options.shouldPollDirectObserver
        : () => true,
    getForcedMapKey: resolveForcedMapKey,
    onSnapshot: (snapshot) => telemetryBridge.ingestSnapshot(snapshot),
    log,
  });
  directObserverPoller.start();

  broadcast.setSnapshotProvider(({ requestedMapKey }) =>
    engine.getSnapshot(requestedMapKey),
  );

  app.disable("x-powered-by");
  app.use(cors());
  app.use(
    "/assets/maps",
    express.static(registry.getAssetsRoot(), {
      index: false,
      fallthrough: true,
    }),
  );
  app.get(/^\/assets\/maps\/(.+)$/, (req, res, next) => {
    const resolvedAsset = registry.resolveAssetRequest(req.params?.[0] || req.path);
    if (!resolvedAsset) {
      next();
      return;
    }

    if (resolvedAsset.mode === "file" && resolvedAsset.absolutePath) {
      res.sendFile(resolvedAsset.absolutePath);
      return;
    }

    if (resolvedAsset.mode === "inline" && resolvedAsset.body) {
      res.type(resolvedAsset.mimeType || "image/svg+xml").send(resolvedAsset.body);
      return;
    }

    next();
  });
  app.use(
    "/assets/teams",
    express.static(teamAssetsRoot, {
      index: false,
      fallthrough: true,
    }),
  );
  app.get("/assets/default-team.png", (_req, res) => {
    const defaultTeamPath = path.join(teamAssetsRoot, "default-team.png");
    if (fs.existsSync(defaultTeamPath)) {
      res.sendFile(defaultTeamPath);
      return;
    }

    const bundledDefaultTeamPath = resolveBundledDefaultTeamPath();
    if (bundledDefaultTeamPath) {
      res.sendFile(bundledDefaultTeamPath);
      return;
    }

    res
      .type("png")
      .send(Buffer.from(PLACEHOLDER_TEAM_PNG_BASE64, "base64"));
  });
  app.use(
    "/assets/players",
    express.static(playerAssetsRoot, {
      index: false,
      fallthrough: true,
    }),
  );
  app.get(/^\/assets\/players\/(.+)\.png$/, (req, res, next) => {
    const playerAssetPath = findPlayerAssetPath(
      playerAssetsRoot,
      req.params?.[0] || "",
    );
    if (!playerAssetPath) {
      next();
      return;
    }

    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(playerAssetPath);
  });
  app.get("/assets/default-player.png", (_req, res) => {
    const defaultPlayerPath = path.join(playerAssetsRoot, "default-player.png");
    if (fs.existsSync(defaultPlayerPath)) {
      res.sendFile(defaultPlayerPath);
      return;
    }

    res
      .type("png")
      .send(Buffer.from(PLACEHOLDER_PLAYER_PNG_BASE64, "base64"));
  });
  app.use(
    "/obs/static",
    express.static(path.join(__dirname, "public"), {
      index: false,
      fallthrough: false,
    }),
  );

  registerHealthRoute(app, {
    startedAt,
    port,
    engine,
    registry,
  });
  registerObsMapRoute(app, {
    engine,
    registry,
    wsPath: broadcast.getPath(),
  });
  registerObsPlayerPhotoRoute(app, {
    resolveApiBase:
      typeof options.resolveApiBase === "function"
        ? options.resolveApiBase
        : () =>
            options.apiBase ||
            process.env.ARENZYRA_API_URL ||
            process.env.ARENZYRA_API_BASE ||
            getProcessDefaultApiBase(),
    wsPath: broadcast.getPath(),
    getCurrentMatchContext:
      typeof options.getCurrentMatchContext === "function"
        ? options.getCurrentMatchContext
        : () => null,
    log,
  });
  registerTeamEliminatedRoute(app, {
    log,
  });
  registerPermanentWidgetRoute(app, {
    resolveApiBase:
      typeof options.resolveApiBase === "function"
        ? options.resolveApiBase
        : () =>
            options.apiBase ||
            process.env.ARENZYRA_API_URL ||
            process.env.ARENZYRA_API_BASE ||
            getProcessDefaultApiBase(),
    wsPath: broadcast.getPath(),
    log,
  });

  const enableDebugRoutes =
    options.enableDebugRoutes === true ||
    (!options.disableDebugRoutes && process.env.NODE_ENV !== "production");
  const enableOperatorRoutes = options.enableOperatorRoutes !== false;

  function sendOperatorActionResponse(res, action, id, result, mapKey = null, extra = {}) {
    const snapshot = engine.getSnapshot(mapKey).productionSupport;
    res.json({
      ok: Boolean(result?.snapshot),
      action,
      id,
      pinState: engine.getPinState(),
      operatorState: snapshot?.operatorState ?? null,
      operatorWorkflowState: snapshot?.operatorWorkflowState ?? null,
      replayCandidates: snapshot?.replayCandidates ?? [],
      productionSupport: snapshot,
      ...extra,
    });
  }

  if (enableDebugRoutes) {
    app.get("/debug/map-demo/start", (req, res) => {
      const activeMapKey = engine.startMockFeed(req.query?.map);
      res.json({
        ok: Boolean(activeMapKey),
        mapKey: activeMapKey,
      });
    });

    app.get("/debug/map-demo/stop", (_req, res) => {
      engine.stopMockFeed();
      res.json({ ok: true });
    });

    app.get("/debug/map-calibration/start", (req, res) => {
      const scenario = engine.startCalibrationScenario(
        req.query?.map,
        req.query?.duration,
      );
      res.json({
        ok: Boolean(scenario),
        scenario,
      });
    });

    app.get("/debug/map-calibration/stop", (_req, res) => {
      engine.stopMockFeed();
      res.json({ ok: true });
    });

    app.get("/debug/map-state", (req, res) => {
      res.json({
        engine: engine.getStatus(),
        snapshot: engine.getSnapshot(req.query?.map ?? null),
        assetValidation: registry.getValidationSummary(),
      });
    });

    app.get("/debug/camera-assist/state", (req, res) => {
      const snapshot = engine.getSnapshot(req.query?.map ?? null).productionSupport;
      res.json({
        ok: Boolean(snapshot?.cameraAssistPayload),
        map: req.query?.map ?? null,
        cameraAssist: snapshot?.cameraAssistPayload ?? null,
        productionSupport: snapshot,
      });
    });

    app.get("/debug/camera-assist/reset-history", (req, res) => {
      const snapshot = engine.resetCameraAssistHistory(req.query?.map ?? null);
      res.json({
        ok: Boolean(snapshot),
        map: req.query?.map ?? null,
        cameraAssist: snapshot?.cameraAssistPayload ?? null,
        productionSupport: snapshot ?? engine.getSnapshot(req.query?.map ?? null).productionSupport,
      });
    });

    app.get("/debug/replay-markers", (req, res) => {
      const limit = Math.max(
        1,
        Math.min(
          100,
          Number.isFinite(Number(req.query?.limit)) ? Number(req.query.limit) : 20,
        ),
      );
      res.json(engine.getReplayMarkers(req.query?.map ?? null, limit));
    });
  }

  if (enableOperatorRoutes) {
    app.get("/debug/observer/pin-team", (req, res) => {
      const result = engine.pinTeam(req.query?.teamId ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "pin-team",
        req.query?.teamId ?? null,
        result,
        req.query?.map ?? null,
        {
          teamId: req.query?.teamId ?? null,
        },
      );
    });

    app.get("/debug/observer/unpin-team", (req, res) => {
      const result = engine.unpinTeam(req.query?.teamId ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "unpin-team",
        req.query?.teamId ?? null,
        result,
        req.query?.map ?? null,
        {
          teamId: req.query?.teamId ?? null,
        },
      );
    });

    app.get("/debug/observer/pin-target", (req, res) => {
      const result = engine.pinTarget(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "pin-target",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/observer/unpin-target", (req, res) => {
      const result = engine.unpinTarget(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "unpin-target",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/watch-now", (req, res) => {
      const result = engine.watchNowTarget(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "watch-now",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/select-target", (req, res) => {
      const result = engine.selectTarget(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "select-target",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/select-alert", (req, res) => {
      const result = engine.selectAlert(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "select-alert",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/pin-target", (req, res) => {
      const result = engine.pinTarget(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "pin-target",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/unpin-target", (req, res) => {
      const result = engine.unpinTarget(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "unpin-target",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/mark-replay", (req, res) => {
      const result = engine.markReplay(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "mark-replay",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/unmark-replay", (req, res) => {
      const result = engine.unmarkReplay(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "unmark-replay",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/suppress-target", (req, res) => {
      const result = engine.suppressTarget(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "suppress-target",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/unsuppress-target", (req, res) => {
      const result = engine.unsuppressTarget(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "unsuppress-target",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/center-target", (req, res) => {
      const result = engine.centerTarget(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "center-target",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/center-alert", (req, res) => {
      const result = engine.centerAlert(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "center-alert",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/center-replay", (req, res) => {
      const result = engine.centerReplayCandidate(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "center-replay",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/accept-recommendation", (req, res) => {
      const result = engine.acceptCameraRecommendation(req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "accept-recommendation",
        null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/dismiss-alert", (req, res) => {
      const result = engine.dismissAlert(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "dismiss-alert",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/undismiss-alert", (req, res) => {
      const result = engine.undismissAlert(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "undismiss-alert",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });

    app.get("/debug/operator/remove-replay", (req, res) => {
      const result = engine.removeReplay(req.query?.id ?? null, req.query?.map ?? null);
      sendOperatorActionResponse(
        res,
        "remove-replay",
        req.query?.id ?? null,
        result,
        req.query?.map ?? null,
      );
    });
  }

  app.use((req, res, next) => {
    if (req.path.startsWith("/assets/maps")) {
      res.status(404).json({
        error: "Map asset not found",
        path: req.path,
      });
      return;
    }

    next();
  });

  httpServer.on("upgrade", (request, socket, head) => {
    if (!broadcast.handleUpgrade(request, socket, head)) {
      socket.destroy();
    }
  });

  httpServer.on("error", (error) => {
    rejectReady(error);
    logError("Failed to start", {
      error: error instanceof Error ? error : String(error),
      host,
      port,
    });
  });

  httpServer.listen(port, host, () => {
    resolveReady(getStatusSnapshot());
    log("Listening", {
      localBaseUrl,
      host,
      port,
    });
    if (networkBaseUrl) {
      log("Network access ready", {
        networkBaseUrl,
      });
    }
    log("Routes ready", {
      health: `${localBaseUrl}/health`,
      obsMap: `${localBaseUrl}/obs/map`,
      obsPlayerPhoto: `${localBaseUrl}/obs/player-photo`,
      productionWidget: `${localBaseUrl}/w/:widgetInstanceKey`,
      legacyWidget: `${localBaseUrl}/w/:widgetKey/:key`,
      operatorPanel: `${localBaseUrl}/obs/map?operatorpanel=1`,
      cameraAssist: `${localBaseUrl}/obs/map?cameraassist=1`,
      fullOperatorMode:
        `${localBaseUrl}/obs/map?operatorpanel=1&assistpanel=1&cameraassist=1&debug=1`,
      debugMap: `${localBaseUrl}/obs/map?debug=1`,
    });
  });

  if (
    String(process.env.ARENZYRA_WIDGET_DEMO || "").trim() === "1" &&
    enableDebugRoutes
  ) {
    engine.startMockFeed(process.env.ARENZYRA_WIDGET_DEMO_MAP || null);
  }

  let stopped = false;

  function getStatusSnapshot() {
    const broadcastStatus =
      typeof broadcast.getStatus === "function"
        ? broadcast.getStatus()
        : {
            clientCount:
              typeof broadcast.getClientCount === "function" ? broadcast.getClientCount() : 0,
            lastBroadcastAt: null,
            path: typeof broadcast.getPath === "function" ? broadcast.getPath() : null,
          };
    return {
      running: !stopped,
      host: networkBaseUrl ? lanIp : host,
      port,
      path: broadcastStatus.path ?? null,
      clientCount: broadcastStatus.clientCount ?? 0,
      lastBroadcastAt: broadcastStatus.lastBroadcastAt ?? null,
      startedAt,
      localBaseUrl,
      networkBaseUrl,
    };
  }

  return {
    engine,
    getStatus() {
      return getStatusSnapshot();
    },
    getAssetStatus() {
      return registry.getValidationSummary();
    },
    host: networkBaseUrl ? lanIp : host,
    ingestTelemetrySnapshot(snapshot) {
      telemetryBridge.ingestSnapshot(snapshot);
    },
    port,
    registry,
    setTeamBranding(update) {
      return engine.applyTeamBrandingUpdate(update);
    },
    whenReady() {
      return readyPromise;
    },
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      engine.stopMockFeed();
      await directObserverPoller.stop();
      broadcast.close();

      await new Promise((resolve) => {
        try {
          httpServer.close(() => resolve());
        } catch (_) {
          resolve();
        }
      });
      log("Stopped");
    },
  };
}

module.exports = {
  startWidgetsServer,
};
