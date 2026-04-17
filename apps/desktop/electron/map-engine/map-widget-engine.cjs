"use strict";

const { buildCalibrationScenario } = require("./debug-calibration-utils.cjs");
const { createObserverAssistEngine } = require("./observer-assist-engine.cjs");
const { createPlayerPositionStore } = require("./player-position-store.cjs");
const { createProductionSupportEngine } = require("./production-support-engine.cjs");
const { createTeamBrandingStore } = require("./team-branding-store.cjs");
const { createZoneStateStore } = require("./zone-state-store.cjs");

function buildMapContextPayload(registry, definition, sourceMapName, timestamp) {
  if (!definition) {
    return null;
  }

  return {
    mapKey: definition.key,
    sourceMapName: sourceMapName || null,
    definition: registry.toClientDefinition(definition),
    timestamp: timestamp || Date.now(),
  };
}

function createMapWidgetEngine({ registry, broadcast, log = () => {} }) {
  const observerAssistEngine = createObserverAssistEngine({ log });
  const zoneStateStore = createZoneStateStore();
  const playerPositionStore = createPlayerPositionStore();
  const productionSupportEngine = createProductionSupportEngine({ log });
  const teamBrandingStore = createTeamBrandingStore();

  let currentMapKey = null;
  let currentSourceMapName = null;
  let mockFeedTimer = null;
  let mockTick = 0;
  let activeFeed = null;

  function getDefinition(mapKey) {
    return registry.resolve(mapKey);
  }

  function ensureMapContext({ mapKey, sourceMapName, timestamp, force = false } = {}) {
    const definition = getDefinition(mapKey || currentMapKey);
    if (!definition) {
      return null;
    }

    const nextSourceMapName = sourceMapName || currentSourceMapName || definition.label;
    const nextTimestamp = timestamp || Date.now();
    const changed =
      force ||
      currentMapKey !== definition.key ||
      currentSourceMapName !== nextSourceMapName;

    currentMapKey = definition.key;
    currentSourceMapName = nextSourceMapName;

    const payload = buildMapContextPayload(
      registry,
      definition,
      nextSourceMapName,
      nextTimestamp,
    );

    if (changed) {
      broadcast.broadcast("map_context", payload, nextTimestamp);
    }

    return payload;
  }

  function setMapContext(context) {
    return ensureMapContext({ ...context, force: true });
  }

  function syncMapContext(context) {
    return ensureMapContext({ ...context, force: false });
  }

  function broadcastObserverAssist(snapshot) {
    if (!snapshot) {
      return null;
    }

    broadcast.broadcast("observer_assist", snapshot, snapshot.updatedAt ?? Date.now());
    return snapshot;
  }

  function broadcastProductionSupport(snapshot) {
    if (!snapshot) {
      return null;
    }

    broadcast.broadcast("production_support", snapshot, snapshot.updatedAt ?? Date.now());
    return snapshot;
  }

  function updateAssistPipeline(observerAssistSnapshot, definition) {
    if (!observerAssistSnapshot || !definition) {
      return {
        observerAssistSnapshot,
        productionSupportSnapshot: null,
      };
    }

    const productionSupportSnapshot = productionSupportEngine.applyObserverAssist(
      observerAssistSnapshot,
      definition,
    );
    const enrichedObserverAssistSnapshot =
      observerAssistEngine.applyProductionSupport(productionSupportSnapshot, definition) ||
      observerAssistSnapshot;

    broadcastObserverAssist(enrichedObserverAssistSnapshot);
    broadcastProductionSupport(productionSupportSnapshot);

    return {
      observerAssistSnapshot: enrichedObserverAssistSnapshot,
      productionSupportSnapshot,
    };
  }

  function applyZoneUpdate(update, options = {}) {
    const normalized = zoneStateStore.set(update);
    if (!normalized) {
      return null;
    }

    ensureMapContext({
      mapKey: normalized.mapKey,
      sourceMapName: options.sourceMapName,
      timestamp: normalized.timestamp,
    });
    broadcast.broadcast("zone_update", normalized, normalized.timestamp);
    const definition = getDefinition(normalized.mapKey);
    productionSupportEngine.setZoneUpdate(normalized, definition);
    const observerAssistSnapshot = observerAssistEngine.applyZoneUpdate(
      normalized,
      definition,
    );
    updateAssistPipeline(observerAssistSnapshot, definition);
    return normalized;
  }

  function applyPlayerPositionUpdate(update, options = {}) {
    const normalized = playerPositionStore.set(update);
    if (!normalized) {
      return null;
    }

    ensureMapContext({
      mapKey: normalized.mapKey,
      sourceMapName: options.sourceMapName,
      timestamp: normalized.timestamp,
    });
    broadcast.broadcast("player_positions", normalized, normalized.timestamp);
    const definition = getDefinition(normalized.mapKey);
    productionSupportEngine.setPlayerPositions(normalized, definition);
    const observerAssistSnapshot = observerAssistEngine.applyPlayerPositions(
      normalized,
      definition,
    );
    updateAssistPipeline(observerAssistSnapshot, definition);
    return normalized;
  }

  function applyTeamBrandingUpdate(update) {
    const normalized = teamBrandingStore.set(update);
    broadcast.broadcast("team_branding", normalized, normalized.timestamp);
    return normalized;
  }

  function applyCombatEvents(update, options = {}) {
    const requestedMapKey = String(update?.mapKey || currentMapKey || "").trim().toLowerCase();
    const definition = getDefinition(requestedMapKey);
    if (!definition) {
      return null;
    }

    const timestamp = update?.timestamp || Date.now();
    ensureMapContext({
      mapKey: definition.key,
      sourceMapName: options.sourceMapName,
      timestamp,
    });

    const observerAssistSnapshot = observerAssistEngine.applyCombatEvents(
      {
        mapKey: definition.key,
        events: Array.isArray(update?.events) ? update.events : [],
        timestamp,
      },
      definition,
    );
    return updateAssistPipeline(observerAssistSnapshot, definition).productionSupportSnapshot;
  }

  function runOperatorAction(action, value, preferredMapKey = null) {
    const definition = getResolvedDefinition(preferredMapKey);
    if (!definition) {
      return null;
    }

    let snapshot = null;
    if (action === "pin-team") {
      snapshot = productionSupportEngine.pinTeam(value, definition, definition.key);
    } else if (action === "unpin-team") {
      snapshot = productionSupportEngine.unpinTeam(value, definition, definition.key);
    } else if (action === "pin-target") {
      snapshot = productionSupportEngine.pinTargetById(value, definition, definition.key);
    } else if (action === "unpin-target") {
      snapshot = productionSupportEngine.unpinTarget(value, definition, definition.key);
    } else if (action === "watch-now") {
      snapshot = productionSupportEngine.watchNowTargetById(value, definition, definition.key);
    } else if (action === "mark-replay") {
      snapshot = productionSupportEngine.markReplayById(value, definition, definition.key);
    } else if (action === "unmark-replay") {
      snapshot = productionSupportEngine.unmarkReplayById(value, definition, definition.key);
    } else if (action === "suppress-target") {
      snapshot = productionSupportEngine.suppressTargetById(value, definition, definition.key);
    } else if (action === "unsuppress-target") {
      snapshot = productionSupportEngine.unsuppressTarget(value, definition, definition.key);
    } else if (action === "dismiss-alert") {
      snapshot = productionSupportEngine.dismissAlertById(value, definition, definition.key);
    } else if (action === "undismiss-alert") {
      snapshot = productionSupportEngine.undismissAlertById(value, definition, definition.key);
    } else if (action === "select-target") {
      snapshot = productionSupportEngine.selectTargetById(value, definition, definition.key);
    } else if (action === "select-alert") {
      snapshot = productionSupportEngine.selectAlertById(value, definition, definition.key);
    } else if (action === "center-target") {
      snapshot = productionSupportEngine.centerTargetById(value, definition, definition.key);
    } else if (action === "center-alert") {
      snapshot = productionSupportEngine.centerAlertById(value, definition, definition.key);
    } else if (action === "center-replay") {
      snapshot = productionSupportEngine.centerReplayCandidateById(
        value,
        definition,
        definition.key,
      );
    } else if (action === "accept-recommendation") {
      snapshot = productionSupportEngine.acceptCameraRecommendation(definition, definition.key);
    } else if (action === "remove-replay") {
      snapshot = productionSupportEngine.unmarkReplayById(value, definition, definition.key);
    }

    if (snapshot) {
      broadcastProductionSupport(snapshot);
    }

    return {
      pinState: productionSupportEngine.getPinState(),
      operatorState: snapshot?.operatorState ?? null,
      operatorWorkflowState: snapshot?.operatorWorkflowState ?? null,
      replayCandidates: snapshot?.replayCandidates ?? [],
      snapshot,
    };
  }

  function getResolvedDefinition(preferredMapKey) {
    return (
      getDefinition(preferredMapKey) ||
      getDefinition(currentMapKey) ||
      registry.getDefaultDefinition()
    );
  }

  function getSnapshot(preferredMapKey) {
    const definition = getResolvedDefinition(preferredMapKey);
    if (!definition) {
      return {
        mapContext: null,
        observerAssist: null,
        productionSupport: null,
        teamBranding: null,
        zone: null,
        players: null,
      };
    }

    return {
      mapContext: buildMapContextPayload(
        registry,
        definition,
        currentSourceMapName || definition.label,
        Date.now(),
      ),
      observerAssist: observerAssistEngine.get(definition.key),
      productionSupport: productionSupportEngine.get(definition.key),
      teamBranding: teamBrandingStore.get(),
      zone: zoneStateStore.get(definition.key),
      players: playerPositionStore.get(definition.key),
    };
  }

  function resetCameraAssistHistory(preferredMapKey = null) {
    const definition = getResolvedDefinition(preferredMapKey);
    if (!definition) {
      return null;
    }

    const snapshot = productionSupportEngine.resetCameraAssistHistory(
      definition,
      definition.key,
    );
    if (snapshot) {
      broadcastProductionSupport(snapshot);
    }

    return snapshot;
  }

  function buildMockPlayers(worldSize, tick) {
    const anchors = [
      ["p1", "Atlas", "alpha", 0.18, 0.22],
      ["p2", "Bishop", "alpha", 0.22, 0.28],
      ["p3", "Cipher", "beta", 0.55, 0.41],
      ["p4", "Drift", "beta", 0.58, 0.46],
      ["p5", "Echo", "charlie", 0.35, 0.69],
      ["p6", "Flint", "charlie", 0.38, 0.66],
      ["p7", "Ghost", "delta", 0.72, 0.57],
      ["p8", "Halo", "delta", 0.76, 0.61],
    ];

    return anchors.map(([playerId, playerName, teamId, startX, startY], index) => {
      const wobble = tick / 6 + index * 0.4;
      const knocked = index === 6 && tick % 18 > 12;
      return {
        playerId,
        playerName,
        teamId,
        x: worldSize * (startX + Math.sin(wobble) * 0.012),
        y: worldSize * (startY + Math.cos(wobble * 0.9) * 0.012),
        alive: true,
        knocked,
        health: knocked ? 22 : Math.max(38, Math.round(100 - ((tick + index * 9) % 55))),
      };
    });
  }

  function pushMockFrame(mapKey) {
    const definition = getDefinition(mapKey) || registry.getDefaultDefinition();
    if (!definition) {
      return;
    }

    const tick = mockTick;
    const phase = Math.max(1, Math.min(8, Math.floor(tick / 10) + 1));
    const currentRadius = Math.max(
      definition.worldSize * 0.08,
      definition.worldSize * (0.34 - tick * 0.004),
    );
    const nextRadius = Math.max(
      definition.worldSize * 0.05,
      currentRadius * 0.72,
    );
    const centerX =
      definition.worldSize * (0.48 + Math.sin(tick / 12) * 0.06);
    const centerY =
      definition.worldSize * (0.53 + Math.cos(tick / 15) * 0.05);
    const nextCenterX = centerX + definition.worldSize * 0.05;
    const nextCenterY = centerY - definition.worldSize * 0.03;
    const timeRemaining = Math.max(0, 35 - (tick % 36));
    const timestamp = Date.now();

    applyZoneUpdate(
      {
        mapKey: definition.key,
        phase,
        centerX,
        centerY,
        radius: currentRadius,
        nextCenterX,
        nextCenterY,
        nextRadius,
        timeRemaining,
        timestamp,
      },
      { sourceMapName: definition.label },
    );

    applyPlayerPositionUpdate(
      {
        mapKey: definition.key,
        players: buildMockPlayers(definition.worldSize, tick),
        timestamp,
      },
      { sourceMapName: definition.label },
    );
  }

  function startMockFeed(mapKey) {
    const definition = getDefinition(mapKey) || registry.getDefaultDefinition();
    if (!definition) {
      return null;
    }

    stopMockFeed();
    mockTick = 0;
    activeFeed = {
      mode: "mock",
      mapKey: definition.key,
      durationSeconds: null,
      startedAt: Date.now(),
      targetEndAt: null,
    };
    pushMockFrame(definition.key);
    mockFeedTimer = setInterval(() => {
      mockTick += 1;
      pushMockFrame(definition.key);
    }, 1000);
    log(`[widget-demo] started map mock feed map=${definition.key}`);
    return definition.key;
  }

  function startCalibrationScenario(mapKey, durationSeconds) {
    const definition = getDefinition(mapKey) || registry.getDefaultDefinition();
    if (!definition) {
      return null;
    }

    const scenario = buildCalibrationScenario(definition, { durationSeconds });
    if (!scenario) {
      return null;
    }

    stopMockFeed();
    const startedAt = Date.now();
    const targetEndAt = startedAt + scenario.durationSeconds * 1000;
    activeFeed = {
      mode: "calibration",
      mapKey: definition.key,
      durationSeconds: scenario.durationSeconds,
      startedAt,
      targetEndAt,
      scenario: scenario.label,
    };

    applyZoneUpdate(
      {
        ...scenario.zoneUpdate,
        timestamp: startedAt,
        receivedAt: startedAt,
      },
      { sourceMapName: definition.label },
    );

    applyPlayerPositionUpdate(
      {
        ...scenario.playerUpdate,
        timestamp: startedAt,
        receivedAt: startedAt,
      },
      { sourceMapName: definition.label },
    );

    log(
      `[widget-demo] started calibration scenario map=${definition.key} durationSeconds=${scenario.durationSeconds}`,
    );

    return {
      mapKey: definition.key,
      durationSeconds: scenario.durationSeconds,
      targetEndAt,
      scenario: scenario.label,
    };
  }

  function stopMockFeed() {
    if (mockFeedTimer) {
      clearInterval(mockFeedTimer);
      mockFeedTimer = null;
    }

    if (activeFeed) {
      log(`[widget-demo] stopped ${activeFeed.mode} feed`);
    }

    activeFeed = null;
  }

  function getReplayMarkers(preferredMapKey = null, limit = 20) {
    if (!preferredMapKey) {
      return productionSupportEngine.getReplayMarkers(null, limit);
    }

    const definition = getResolvedDefinition(preferredMapKey);
    return productionSupportEngine.getReplayMarkers(definition?.key ?? null, limit);
  }

  function getStatus() {
    return {
      currentMapKey,
      currentSourceMapName,
      activeFeed: activeFeed ? { ...activeFeed } : null,
      mockFeedRunning: Boolean(mockFeedTimer),
      latestObserverAssist: observerAssistEngine.get(currentMapKey),
      latestProductionSupport: productionSupportEngine.get(currentMapKey),
      latestTeamBranding: teamBrandingStore.get(),
      pinState: productionSupportEngine.getPinState(),
      latestZoneUpdate: zoneStateStore.getLatest(),
      latestPlayerUpdate: playerPositionStore.getLatest(),
    };
  }

  return {
    applyCombatEvents,
    applyPlayerPositionUpdate,
    applyTeamBrandingUpdate,
    applyZoneUpdate,
    getReplayMarkers,
    getSnapshot,
    getStatus,
    getPinState: productionSupportEngine.getPinState,
    resetCameraAssistHistory,
    pinTarget: (id, mapKey = null) => runOperatorAction("pin-target", id, mapKey),
    pinTeam: (teamId, mapKey = null) => runOperatorAction("pin-team", teamId, mapKey),
    watchNowTarget: (id, mapKey = null) => runOperatorAction("watch-now", id, mapKey),
    markReplay: (id, mapKey = null) => runOperatorAction("mark-replay", id, mapKey),
    selectAlert: (id, mapKey = null) => runOperatorAction("select-alert", id, mapKey),
    selectTarget: (id, mapKey = null) => runOperatorAction("select-target", id, mapKey),
    centerTarget: (id, mapKey = null) => runOperatorAction("center-target", id, mapKey),
    centerAlert: (id, mapKey = null) => runOperatorAction("center-alert", id, mapKey),
    centerReplayCandidate: (id, mapKey = null) => runOperatorAction("center-replay", id, mapKey),
    acceptCameraRecommendation: (mapKey = null) =>
      runOperatorAction("accept-recommendation", null, mapKey),
    removeReplay: (id, mapKey = null) => runOperatorAction("remove-replay", id, mapKey),
    unmarkReplay: (id, mapKey = null) => runOperatorAction("unmark-replay", id, mapKey),
    suppressTarget: (id, mapKey = null) => runOperatorAction("suppress-target", id, mapKey),
    unsuppressTarget: (id, mapKey = null) => runOperatorAction("unsuppress-target", id, mapKey),
    dismissAlert: (id, mapKey = null) => runOperatorAction("dismiss-alert", id, mapKey),
    undismissAlert: (id, mapKey = null) => runOperatorAction("undismiss-alert", id, mapKey),
    setMapContext,
    startCalibrationScenario,
    startMockFeed,
    stopMockFeed,
    syncMapContext,
    unpinTarget: (id, mapKey = null) => runOperatorAction("unpin-target", id, mapKey),
    unpinTeam: (teamId, mapKey = null) => runOperatorAction("unpin-team", teamId, mapKey),
  };
}

module.exports = {
  createMapWidgetEngine,
};
