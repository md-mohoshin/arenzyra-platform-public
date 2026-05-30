# Observer Command Center Deliverable

## Changed File List
- apps/desktop/electron/map-engine/operator-workflow-store.cjs
- apps/desktop/electron/map-engine/production-support-engine.cjs
- apps/desktop/electron/map-engine/map-widget-engine.cjs
- apps/desktop/electron/widget-server/ws/local-widget-broadcast.cjs
- apps/desktop/electron/widget-server/server.cjs
- apps/desktop/electron/main.cjs
- apps/desktop/src/types.ts
- apps/desktop/src/api/api-client.ts
- apps/desktop/src/screens/dashboard-screen.tsx
- apps/desktop/src/services/observer-command-center.ts
- apps/desktop/src/hooks/use-observer-command-center.ts
- apps/desktop/src/screens/observer-command-center.tsx
- apps/desktop/src/styles.css

## Command Center Location
- Lives inside the Electron renderer dashboard at `apps/desktop/src/screens/observer-command-center.tsx`.
- Integrated into the authenticated launcher dashboard via `apps/desktop/src/screens/dashboard-screen.tsx`.

## Access
- Open the Electron desktop app, sign in, and use the main dashboard. The Observer Command Center renders below the launcher action cards and above the loaded match teams table.
- Local widget action routes remain available on the widget server, for example:
  - `http://localhost:5510/debug/operator/watch-now?id=target-alpha`
  - `http://localhost:5510/debug/operator/center-alert?id=alert:123`
  - `http://localhost:5510/debug/operator/center-replay?id=replay:watch_target:target-alpha`
  - `http://localhost:5510/debug/operator/accept-recommendation`
  - `http://localhost:5510/debug/observer/unpin-team?teamId=team-4`

## Snapshot Data Flow
- The Electron main process aggregates telemetry bridge status, widget server health, and the current map-engine production-support snapshot into `launcher:getObserverCommandCenterSnapshot`.
- The renderer polls that IPC endpoint on a lightweight interval through `use-observer-command-center.ts` and renders the command center from the returned snapshot.

## Action Wiring
- Desktop actions call `launcher:runObserverCommandAction`, which validates a local operator/debug path and forwards it to the same widget-server action routes already used by the map widget operator panel.
- Those routes continue to flow through the existing `map-widget-engine` and `production-support-engine` stores, so desktop UI and widget UI share the same operator behavior.

## Refresh Strategy
- Renderer polling interval is centralized in `apps/desktop/src/services/observer-command-center.ts` and defaults to `1250ms`.
- Operator actions also return a fresh snapshot immediately after the route call so the UI updates without waiting for the next poll cycle.

## apps/desktop/electron/map-engine/operator-workflow-store.cjs

`$ext
"use strict";

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTeamIds(teamIds) {
  if (!Array.isArray(teamIds)) {
    return [];
  }

  return Array.from(
    new Set(teamIds.map(normalizeId).filter(Boolean)),
  ).sort(compareIds);
}

function normalizePoint(point) {
  const source = point && typeof point === "object" ? point : {};
  const x = Number.isFinite(source.x) ? source.x : Number.isFinite(source.centerX) ? source.centerX : null;
  const y = Number.isFinite(source.y) ? source.y : Number.isFinite(source.centerY) ? source.centerY : null;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x,
    y,
  };
}

function normalizeTargetReference(target, fallbackId = null, now = Date.now()) {
  const source = target && typeof target === "object" ? target : {};
  const id = normalizeId(source.id || fallbackId);
  if (!id) {
    return null;
  }

  return {
    id,
    label: String(source.label || "").trim() || id,
    centerX: Number.isFinite(source.centerX) ? source.centerX : undefined,
    centerY: Number.isFinite(source.centerY) ? source.centerY : undefined,
    involvedTeamIds: normalizeTeamIds(source.involvedTeamIds),
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : now,
    selectedAt: Number.isFinite(source.selectedAt) ? source.selectedAt : now,
  };
}

function normalizeAlertReference(alert, fallbackId = null, now = Date.now()) {
  const source = alert && typeof alert === "object" ? alert : {};
  const id = normalizeId(source.id || fallbackId);
  if (!id) {
    return null;
  }

  return {
    id,
    label: String(source.label || "").trim() || id,
    centerX: Number.isFinite(source.centerX) ? source.centerX : undefined,
    centerY: Number.isFinite(source.centerY) ? source.centerY : undefined,
    involvedTeamIds: normalizeTeamIds(source.involvedTeamIds),
    createdAt: Number.isFinite(source.createdAt) ? source.createdAt : now,
    selectedAt: Number.isFinite(source.selectedAt) ? source.selectedAt : now,
  };
}

function createOperatorWorkflowStore() {
  let selectedTarget = null;
  let selectedAlert = null;
  let highlightedTargetId = null;
  let mapFocusCenter = null;
  let mapFocusUntil = null;
  let lastAction = null;
  let updatedAt = Date.now();

  function touch(now = Date.now(), nextAction = undefined) {
    updatedAt = now;
    if (nextAction !== undefined) {
      const normalizedAction =
        typeof nextAction === "string" && nextAction.trim() ? nextAction.trim() : null;
      lastAction = normalizedAction;
    }
  }

  function purgeExpiredFocus(now = Date.now()) {
    if (!Number.isFinite(mapFocusUntil) || mapFocusUntil > now) {
      return false;
    }

    mapFocusCenter = null;
    mapFocusUntil = null;
    highlightedTargetId = null;
    return true;
  }

  function refreshSelectedTarget(targetById, now) {
    if (!selectedTarget) {
      return;
    }

    const previousSelectedId = selectedTarget.id;
    const refreshed = targetById.get(selectedTarget.id);
    if (!refreshed) {
      selectedTarget = null;
      if (highlightedTargetId === previousSelectedId && !mapFocusCenter) {
        highlightedTargetId = null;
      }
      return;
    }

    selectedTarget = normalizeTargetReference(
      {
        ...refreshed,
        selectedAt: selectedTarget.selectedAt,
      },
      selectedTarget.id,
      now,
    );
  }

  function refreshSelectedAlert(alertById, now) {
    if (!selectedAlert) {
      return;
    }

    const refreshed = alertById.get(selectedAlert.id);
    if (!refreshed) {
      selectedAlert = null;
      return;
    }

    selectedAlert = normalizeAlertReference(
      {
        ...refreshed,
        selectedAt: selectedAlert.selectedAt,
      },
      selectedAlert.id,
      now,
    );
  }

  function noteAction(label, now = Date.now()) {
    touch(now, label);
    return true;
  }

  function selectTarget(target, now = Date.now(), actionLabel = null) {
    const normalized = normalizeTargetReference(target, target, now);
    if (!normalized) {
      return false;
    }

    selectedTarget = normalized;
    touch(now, actionLabel || `Selected ${normalized.label}`);
    return true;
  }

  function selectAlert(alert, now = Date.now(), actionLabel = null) {
    const normalized = normalizeAlertReference(alert, alert, now);
    if (!normalized) {
      return false;
    }

    selectedAlert = normalized;
    touch(now, actionLabel || `Selected alert ${normalized.label}`);
    return true;
  }

  function noteTargetAction(target, actionLabel, now = Date.now()) {
    const normalized = normalizeTargetReference(target, target, now);
    if (!normalized) {
      return false;
    }

    selectedTarget = normalized;
    touch(now, actionLabel || `Updated ${normalized.label}`);
    return true;
  }

  function noteAlertAction(alert, actionLabel, now = Date.now()) {
    const normalized = normalizeAlertReference(alert, alert, now);
    if (!normalized) {
      return false;
    }

    selectedAlert = normalized;
    touch(now, actionLabel || `Updated alert ${normalized.label}`);
    return true;
  }

  function focusTarget(target, durationMs, now = Date.now(), actionLabel = null) {
    const normalized = normalizeTargetReference(target, target, now);
    if (!normalized) {
      return false;
    }

    const focusCenter = normalizePoint(normalized);
    selectedTarget = normalized;
    highlightedTargetId = normalized.id;
    mapFocusCenter = focusCenter;
    mapFocusUntil =
      focusCenter && Number.isFinite(durationMs)
        ? now + Math.max(1_000, Math.round(durationMs))
        : null;
    touch(now, actionLabel || `Centered ${normalized.label}`);
    return true;
  }

  function focusAlert(alert, durationMs, now = Date.now(), actionLabel = null) {
    const normalized = normalizeAlertReference(alert, alert, now);
    if (!normalized) {
      return false;
    }

    const focusCenter = normalizePoint(normalized);
    selectedAlert = normalized;
    highlightedTargetId = null;
    mapFocusCenter = focusCenter;
    mapFocusUntil =
      focusCenter && Number.isFinite(durationMs)
        ? now + Math.max(1_000, Math.round(durationMs))
        : null;
    touch(now, actionLabel || `Centered alert ${normalized.label}`);
    return true;
  }

  function focusReplayCandidate(candidate, durationMs, now = Date.now(), actionLabel = null) {
    const source = candidate && typeof candidate === "object" ? candidate : {};
    const focusCenter = normalizePoint(source);
    if (!focusCenter) {
      return false;
    }

    highlightedTargetId = null;
    mapFocusCenter = focusCenter;
    mapFocusUntil =
      Number.isFinite(durationMs) ? now + Math.max(1_000, Math.round(durationMs)) : null;
    touch(
      now,
      actionLabel ||
        `Centered replay ${String(source.label || source.id || "candidate").trim() || "candidate"}`,
    );
    return true;
  }

  function acceptRecommendation(target, durationMs, recommendationAction, now = Date.now()) {
    const normalized = normalizeTargetReference(target, target, now);
    if (!normalized) {
      return false;
    }

    const actionToken =
      typeof recommendationAction === "string" && recommendationAction.trim()
        ? recommendationAction.trim()
        : "recommendation";
    const focusCenter = normalizePoint(normalized);
    selectedTarget = normalized;
    highlightedTargetId = normalized.id;
    mapFocusCenter = focusCenter;
    mapFocusUntil =
      focusCenter && Number.isFinite(durationMs)
        ? now + Math.max(1_000, Math.round(durationMs))
        : null;
    touch(now, `Accepted ${actionToken} ${normalized.label}`);
    return true;
  }

  function refreshFromSnapshot({
    watchTargets,
    activeAlerts,
    pinState,
    operatorDetails,
    cameraAssistPayload,
    updatedAt: nextUpdatedAt,
  } = {}) {
    const now = Number.isFinite(nextUpdatedAt) ? nextUpdatedAt : Date.now();
    purgeExpiredFocus(now);

    const targetCollections = [
      watchTargets,
      pinState?.pinnedTargets,
      operatorDetails?.suppressedTargets,
      operatorDetails?.watchingNowTarget ? [operatorDetails.watchingNowTarget] : [],
      cameraAssistPayload?.topWatchTargets,
    ];
    const alertCollections = [
      activeAlerts,
      operatorDetails?.dismissedAlerts,
      cameraAssistPayload?.activeAlerts,
    ];
    const targetById = new Map();
    const alertById = new Map();

    for (const collection of targetCollections) {
      for (const target of Array.isArray(collection) ? collection : []) {
        if (target && target.id && !targetById.has(target.id)) {
          targetById.set(target.id, target);
        }
      }
    }

    for (const collection of alertCollections) {
      for (const alert of Array.isArray(collection) ? collection : []) {
        if (alert && alert.id && !alertById.has(alert.id)) {
          alertById.set(alert.id, alert);
        }
      }
    }

    const highlightedId = highlightedTargetId;
    refreshSelectedTarget(targetById, now);
    refreshSelectedAlert(alertById, now);

    if (highlightedId && !targetById.has(highlightedId) && !mapFocusCenter) {
      highlightedTargetId = null;
    }
  }

  function getState(now = Date.now()) {
    purgeExpiredFocus(now);

    return {
      selectedTargetId: selectedTarget ? selectedTarget.id : null,
      selectedAlertId: selectedAlert ? selectedAlert.id : null,
      highlightedTargetId,
      mapFocusCenter: mapFocusCenter ? { ...mapFocusCenter } : null,
      mapFocusUntil: Number.isFinite(mapFocusUntil) ? mapFocusUntil : null,
      lastAction,
      updatedAt,
    };
  }

  return {
    acceptRecommendation,
    focusAlert,
    focusReplayCandidate,
    focusTarget,
    getState,
    noteAction,
    noteAlertAction,
    noteTargetAction,
    refreshFromSnapshot,
    selectAlert,
    selectTarget,
  };
}

module.exports = {
  createOperatorWorkflowStore,
};
```

## apps/desktop/electron/map-engine/production-support-engine.cjs

`$ext
"use strict";

const { createCameraAssistEngine } = require("./camera-assist-engine.cjs");
const { resolveObserverAssistConfig } = require("./observer-assist-config.cjs");
const {
  buildObserverControlSuggestion,
  buildObserverOperatorSuggestion,
} = require("./observer-control-bridge.cjs");
const { createOperatorActionStore } = require("./operator-action-store.cjs");
const { createOperatorWorkflowStore } = require("./operator-workflow-store.cjs");
const { createPinnedWatchStore } = require("./pinned-watch-store.cjs");
const { createProductionAlertEngine } = require("./production-alert-engine.cjs");
const { createReplayCandidateStore } = require("./replay-candidate-store.cjs");
const { detectTeamSplitRisks } = require("./team-split-risk-detector.cjs");
const { summarizeTeams } = require("./team-proximity-utils.cjs");
const { buildWatchTargetQueue } = require("./watch-target-queue.cjs");

function uniqueList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cloneWatchTarget(target) {
  return {
    id: target.id,
    label: target.label,
    score: target.score,
    centerX: target.centerX,
    centerY: target.centerY,
    category: target.category,
    involvedTeamIds: [...target.involvedTeamIds],
    reason: [...target.reason],
    updatedAt: target.updatedAt,
    priority: target.priority,
    operatorWatchingNow: Boolean(target.operatorWatchingNow),
    operatorPinned: Boolean(target.operatorPinned),
    operatorSuppressed: Boolean(target.operatorSuppressed),
    operatorReplayCandidate: Boolean(target.operatorReplayCandidate),
  };
}

function cloneAlert(alert) {
  return {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    label: alert.label,
    centerX: alert.centerX,
    centerY: alert.centerY,
    involvedTeamIds: [...alert.involvedTeamIds],
    createdAt: alert.createdAt,
    expiresAt: alert.expiresAt,
    operatorReplayCandidate: Boolean(alert.operatorReplayCandidate),
  };
}

function cloneReplayCandidate(candidate) {
  return {
    id: candidate.id,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    label: candidate.label,
    centerX: candidate.centerX,
    centerY: candidate.centerY,
    involvedTeamIds: [...candidate.involvedTeamIds],
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
  };
}

function cloneTeamSplitRisk(splitRisk) {
  return {
    teamId: splitRisk.teamId,
    spreadRadius: splitRisk.spreadRadius,
    severity: splitRisk.severity,
    centerX: splitRisk.centerX,
    centerY: splitRisk.centerY,
    updatedAt: splitRisk.updatedAt,
    activePlayerCount: splitRisk.activePlayerCount,
    nearestHotZoneId: splitRisk.nearestHotZoneId,
    nearestHotZoneDistance: splitRisk.nearestHotZoneDistance,
    distanceToZoneEdge: splitRisk.distanceToZoneEdge,
    isLateGame: splitRisk.isLateGame,
    isNearHotZone: splitRisk.isNearHotZone,
    isZoneEdgeDanger: splitRisk.isZoneEdgeDanger,
    inDangerContext: splitRisk.inDangerContext,
  };
}

function cloneOperatorState(operatorState) {
  return {
    watchingNowTargetId: operatorState.watchingNowTargetId ?? null,
    primaryPinnedTeamIds: [...operatorState.primaryPinnedTeamIds],
    primaryPinnedTargetIds: [...operatorState.primaryPinnedTargetIds],
    replayCandidateIds: [...operatorState.replayCandidateIds],
    dismissedAlertIds: [...operatorState.dismissedAlertIds],
    suppressedTargetIds: [...operatorState.suppressedTargetIds],
    updatedAt: operatorState.updatedAt,
  };
}

function cloneOperatorDetails(operatorDetails) {
  return {
    watchingNowTarget: operatorDetails.watchingNowTarget
      ? {
          ...operatorDetails.watchingNowTarget,
          involvedTeamIds: [...operatorDetails.watchingNowTarget.involvedTeamIds],
        }
      : null,
    suppressedTargets: operatorDetails.suppressedTargets.map((target) => ({
      ...target,
      involvedTeamIds: [...target.involvedTeamIds],
    })),
    dismissedAlerts: operatorDetails.dismissedAlerts.map((alert) => ({
      ...alert,
      involvedTeamIds: [...alert.involvedTeamIds],
    })),
    updatedAt: operatorDetails.updatedAt,
  };
}

function cloneOperatorWorkflowState(operatorWorkflowState) {
  return {
    selectedTargetId: operatorWorkflowState?.selectedTargetId ?? null,
    selectedAlertId: operatorWorkflowState?.selectedAlertId ?? null,
    highlightedTargetId: operatorWorkflowState?.highlightedTargetId ?? null,
    mapFocusCenter: operatorWorkflowState?.mapFocusCenter
      ? {
          x: operatorWorkflowState.mapFocusCenter.x,
          y: operatorWorkflowState.mapFocusCenter.y,
        }
      : null,
    mapFocusUntil: operatorWorkflowState?.mapFocusUntil ?? null,
    lastAction: operatorWorkflowState?.lastAction ?? null,
    updatedAt: operatorWorkflowState?.updatedAt ?? Date.now(),
  };
}

function cloneOperatorWorkflowConfig(operatorWorkflowConfig) {
  return {
    mapFocusHighlightMs: operatorWorkflowConfig?.mapFocusHighlightMs ?? null,
    operatorActionStatusMs: operatorWorkflowConfig?.operatorActionStatusMs ?? null,
    maxSelectableWatchTargets: operatorWorkflowConfig?.maxSelectableWatchTargets ?? null,
  };
}

function cloneObserverOperatorSuggestion(suggestion) {
  return {
    watchingNowTargetId: suggestion.watchingNowTargetId ?? null,
    replayCandidates: suggestion.replayCandidates.map(cloneReplayCandidate),
    suppressedTargetIds: [...suggestion.suppressedTargetIds],
    dismissedAlertIds: [...suggestion.dismissedAlertIds],
    primaryPinnedTeamIds: [...suggestion.primaryPinnedTeamIds],
    primaryPinnedTargetIds: [...suggestion.primaryPinnedTargetIds],
    selectedTargetId: suggestion.selectedTargetId ?? null,
    selectedAlertId: suggestion.selectedAlertId ?? null,
    highlightedTargetId: suggestion.highlightedTargetId ?? null,
    mapFocusCenter: suggestion.mapFocusCenter
      ? {
          x: suggestion.mapFocusCenter.x,
          y: suggestion.mapFocusCenter.y,
        }
      : null,
    mapFocusUntil: suggestion.mapFocusUntil ?? null,
    lastAction: suggestion.lastAction ?? null,
    updatedAt: suggestion.updatedAt,
  };
}

function cloneCameraAssistRecommendation(recommendation) {
  return {
    action: recommendation.action,
    currentTargetId: recommendation.currentTargetId ?? null,
    recommendedTargetId: recommendation.recommendedTargetId ?? null,
    backupTargetIds: [...recommendation.backupTargetIds],
    confidence: recommendation.confidence,
    reasons: [...recommendation.reasons],
    scoreDelta: recommendation.scoreDelta ?? null,
    generatedAt: recommendation.generatedAt,
  };
}

function cloneCameraAssistHistoryEntry(entry) {
  return {
    action: entry.action,
    currentTargetId: entry.currentTargetId ?? null,
    recommendedTargetId: entry.recommendedTargetId ?? null,
    generatedAt: entry.generatedAt,
  };
}

function cloneCameraAssistPayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    recommendation: cloneCameraAssistRecommendation(payload.recommendation),
    currentWatchedTargetId: payload.currentWatchedTargetId ?? null,
    topWatchTargets: payload.topWatchTargets.map(cloneWatchTarget),
    activeAlerts: payload.activeAlerts.map(cloneAlert),
    observerState: {
      watchingNowTargetId: payload.observerState?.watchingNowTargetId ?? null,
      primaryPinnedTeamIds: [...(payload.observerState?.primaryPinnedTeamIds ?? [])],
      primaryPinnedTargetIds: [...(payload.observerState?.primaryPinnedTargetIds ?? [])],
    },
    history: {
      lastSwitchAt: payload.history?.lastSwitchAt ?? null,
      previousTargetId: payload.history?.previousTargetId ?? null,
      lastAction: payload.history?.lastAction ?? null,
      recentRecommendationHistory: Array.isArray(payload.history?.recentRecommendationHistory)
        ? payload.history.recentRecommendationHistory.map(cloneCameraAssistHistoryEntry)
        : [],
    },
    debug: payload.debug
      ? {
          ...payload.debug,
          recentRecommendationHistory: Array.isArray(payload.debug.recentRecommendationHistory)
            ? payload.debug.recentRecommendationHistory.map(cloneCameraAssistHistoryEntry)
            : [],
        }
      : null,
    updatedAt: payload.updatedAt,
  };
}

function getAlertReplayPriority(severity) {
  if (severity === "critical") {
    return 320;
  }
  if (severity === "warning") {
    return 220;
  }
  return 140;
}

function normalizeMapKey(value) {
  return String(value || "").trim().toLowerCase();
}

function getTargetDisplayRank(target) {
  if (target.operatorWatchingNow) {
    return 0;
  }
  if (target.operatorPinned && !target.operatorSuppressed) {
    return 1;
  }
  if (!target.operatorSuppressed) {
    return 2;
  }
  return 3;
}

function compareWatchTargets(left, right) {
  return (
    getTargetDisplayRank(left) - getTargetDisplayRank(right) ||
    right.priority - left.priority ||
    right.score - left.score ||
    String(left.id || "").localeCompare(String(right.id || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function decorateWatchTargets(watchTargets, operatorState, replayCandidates, config, updatedAt) {
  const sourceTargets = Array.isArray(watchTargets) ? watchTargets : [];
  const suppressedIds = new Set(operatorState?.suppressedTargetIds || []);
  const pinnedTeamIds = new Set(operatorState?.primaryPinnedTeamIds || []);
  const pinnedTargetIds = new Set(operatorState?.primaryPinnedTargetIds || []);
  const replaySourceIds = new Set(
    (Array.isArray(replayCandidates) ? replayCandidates : []).map((candidate) => candidate.sourceId),
  );
  const watchingNowTargetId = operatorState?.watchingNowTargetId ?? null;
  const visibleTargets = [];

  for (const target of sourceTargets) {
    const isWatchingNow = watchingNowTargetId === target.id;
    const isPinned =
      pinnedTargetIds.has(target.id) ||
      target.involvedTeamIds.some((teamId) => pinnedTeamIds.has(teamId));
    const isSuppressed = suppressedIds.has(target.id);
    const isReplayCandidate = replaySourceIds.has(target.id);
    const decorated = {
      ...target,
      priority:
        target.priority +
        (isWatchingNow ? config?.WATCHING_NOW_PRIORITY_BOOST ?? 0 : 0) -
        (isSuppressed ? config?.SUPPRESSED_PRIORITY_PENALTY ?? 0 : 0),
      reason: uniqueList([
        ...(isWatchingNow ? ["Watching now"] : []),
        ...(isPinned ? ["Pinned by operator"] : []),
        ...(isReplayCandidate ? ["Replay candidate"] : []),
        ...(isSuppressed ? ["Suppressed by operator"] : []),
        ...target.reason,
      ]),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : target.updatedAt,
      operatorWatchingNow: isWatchingNow,
      operatorPinned: isPinned,
      operatorSuppressed: isSuppressed,
      operatorReplayCandidate: isReplayCandidate,
    };

    if (isSuppressed && !isPinned && !isWatchingNow) {
      continue;
    }

    visibleTargets.push(decorated);
  }

  return visibleTargets
    .sort(compareWatchTargets)
    .slice(0, config?.MAX_WATCH_TARGETS ?? 6);
}

function decorateActiveAlerts(activeAlerts, operatorState, replayCandidates) {
  const sourceAlerts = Array.isArray(activeAlerts) ? activeAlerts : [];
  const dismissedIds = new Set(operatorState?.dismissedAlertIds || []);
  const replaySourceIds = new Set(
    (Array.isArray(replayCandidates) ? replayCandidates : []).map((candidate) => candidate.sourceId),
  );

  return sourceAlerts
    .filter((alert) => !dismissedIds.has(alert.id))
    .map((alert) => ({
      ...alert,
      operatorReplayCandidate: replaySourceIds.has(alert.id),
    }));
}

function buildReplayCandidateFromTarget(target, now) {
  return {
    sourceType: "watch_target",
    sourceId: target.id,
    label: target.label,
    centerX: target.centerX,
    centerY: target.centerY,
    involvedTeamIds: target.involvedTeamIds,
    createdAt: now,
    priorityHint: Math.round(Number.isFinite(target.priority) ? target.priority : target.score || 0),
  };
}

function buildReplayCandidateFromAlert(alert, now) {
  return {
    sourceType: "alert",
    sourceId: alert.id,
    label: alert.label,
    centerX: alert.centerX,
    centerY: alert.centerY,
    involvedTeamIds: alert.involvedTeamIds,
    createdAt: now,
    priorityHint: getAlertReplayPriority(alert.severity),
  };
}

function findTargetById(state, id) {
  const normalizedId = normalizeId(id);
  if (!normalizedId || !state) {
    return null;
  }

  const operatorDetails = state.operatorActionStore.getDetails();
  const collections = [
    state.rawWatchTargets,
    state.latestSnapshot?.watchTargets,
    state.latestSnapshot?.pinState?.pinnedTargets,
    operatorDetails.suppressedTargets,
    operatorDetails.watchingNowTarget ? [operatorDetails.watchingNowTarget] : [],
  ];

  for (const collection of collections) {
    const match = (Array.isArray(collection) ? collection : []).find((target) => target.id === normalizedId);
    if (match) {
      return match;
    }
  }

  return null;
}

function findAlertById(state, id) {
  const normalizedId = normalizeId(id);
  if (!normalizedId || !state) {
    return null;
  }

  const operatorDetails = state.operatorActionStore.getDetails();
  const collections = [
    state.rawActiveAlerts,
    state.latestSnapshot?.activeAlerts,
    operatorDetails.dismissedAlerts,
  ];

  for (const collection of collections) {
    const match = (Array.isArray(collection) ? collection : []).find((alert) => alert.id === normalizedId);
    if (match) {
      return match;
    }
  }

  return null;
}

function findReplayCandidateById(state, id) {
  const normalizedId = normalizeId(id);
  if (!normalizedId || !state) {
    return null;
  }

  const candidates = Array.isArray(state.latestSnapshot?.replayCandidates)
    ? state.latestSnapshot.replayCandidates
    : [];

  return (
    candidates.find((candidate) => candidate.id === normalizedId) ||
    candidates.find((candidate) => candidate.sourceId === normalizedId) ||
    null
  );
}

function cloneProductionSupportSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  return {
    mapKey: snapshot.mapKey,
    updatedAt: snapshot.updatedAt,
    watchTargets: snapshot.watchTargets.map(cloneWatchTarget),
    activeAlerts: snapshot.activeAlerts.map(cloneAlert),
    teamSplitRisks: snapshot.teamSplitRisks.map(cloneTeamSplitRisk),
    pinState: {
      pinnedTeams: [...snapshot.pinState.pinnedTeams],
      pinnedTargetIds: [...snapshot.pinState.pinnedTargetIds],
      pinnedTargets: snapshot.pinState.pinnedTargets.map((target) => ({
        ...target,
        involvedTeamIds: [...target.involvedTeamIds],
        reason: [...target.reason],
      })),
    },
    operatorState: cloneOperatorState(snapshot.operatorState),
    operatorDetails: cloneOperatorDetails(snapshot.operatorDetails),
    operatorWorkflowState: cloneOperatorWorkflowState(snapshot.operatorWorkflowState),
    operatorWorkflowConfig: cloneOperatorWorkflowConfig(snapshot.operatorWorkflowConfig),
    replayCandidates: snapshot.replayCandidates.map(cloneReplayCandidate),
    cameraAssistPayload: cloneCameraAssistPayload(snapshot.cameraAssistPayload),
    observerControlSuggestion: {
      ...snapshot.observerControlSuggestion,
      topWatchTargets: snapshot.observerControlSuggestion.topWatchTargets.map(cloneWatchTarget),
      activeAlerts: snapshot.observerControlSuggestion.activeAlerts.map(cloneAlert),
      pinnedTeams: [...snapshot.observerControlSuggestion.pinnedTeams],
      suggestedFocusCenter: snapshot.observerControlSuggestion.suggestedFocusCenter
        ? { ...snapshot.observerControlSuggestion.suggestedFocusCenter }
        : null,
    },
    observerOperatorSuggestion: cloneObserverOperatorSuggestion(
      snapshot.observerOperatorSuggestion,
    ),
  };
}

function buildOperatorWorkflowConfig(config) {
  return {
    mapFocusHighlightMs: config?.MAP_FOCUS_HIGHLIGHT_MS ?? 4_500,
    operatorActionStatusMs: config?.OPERATOR_ACTION_STATUS_MS ?? 3_800,
    maxSelectableWatchTargets: config?.MAX_SELECTABLE_WATCH_TARGETS ?? 5,
  };
}

function createProductionSupportEngine({ config: configOverrides = null } = {}) {
  const statesByMap = new Map();
  const pinnedWatchStore = createPinnedWatchStore();

  function ensureMapState(mapKey) {
    let state = statesByMap.get(mapKey);
    if (!state) {
      state = {
        alertEngine: createProductionAlertEngine(),
        assistSnapshot: null,
        cameraAssistEngine: createCameraAssistEngine(),
        latestSnapshot: null,
        operatorActionStore: createOperatorActionStore(),
        operatorWorkflowStore: createOperatorWorkflowStore(),
        playersPacket: null,
        rawActiveAlerts: [],
        rawWatchTargets: [],
        replayCandidateStore: createReplayCandidateStore(),
        zonePacket: null,
      };
      statesByMap.set(mapKey, state);
    }
    return state;
  }

  function recompute(mapKey, mapDefinition, updatedAt) {
    const normalizedMapKey = normalizeMapKey(mapKey);
    if (!normalizedMapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(normalizedMapKey);
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const teamSummaries = summarizeTeams(state.playersPacket?.players ?? [], config);
    const teamSplitRisks = detectTeamSplitRisks({
      teamSummaries,
      hotZones: state.assistSnapshot?.hotZones ?? [],
      zone: state.zonePacket,
      config,
      updatedAt,
    });
    const pinState = pinnedWatchStore.getState();
    const rawWatchTargets = buildWatchTargetQueue({
      focusCandidates: state.assistSnapshot?.focusCandidates ?? [],
      hotZones: state.assistSnapshot?.hotZones ?? [],
      teamProximities: state.assistSnapshot?.teamProximities ?? [],
      teamSummaries,
      teamSplitRisks,
      pinState,
      mapKey: normalizedMapKey,
      config,
      updatedAt,
    });

    pinnedWatchStore.updatePinnedTargets(normalizedMapKey, rawWatchTargets);
    const refreshedPinState = pinnedWatchStore.getState();
    const rawActiveAlerts = state.alertEngine.evaluate({
      assistSnapshot: state.assistSnapshot,
      teamSplitRisks,
      zone: state.zonePacket,
      config,
      updatedAt,
    });
    const replayCandidates = state.replayCandidateStore.getCandidates(config, updatedAt);

    state.operatorActionStore.refreshFromSnapshot({
      watchTargets: rawWatchTargets,
      activeAlerts: rawActiveAlerts,
      pinState: refreshedPinState,
      replayCandidates,
      updatedAt,
    });

    const operatorState = state.operatorActionStore.getState(updatedAt);
    const operatorDetails = state.operatorActionStore.getDetails(updatedAt);
    const watchTargets = decorateWatchTargets(
      rawWatchTargets,
      operatorState,
      replayCandidates,
      config,
      updatedAt,
    );
    const activeAlerts = decorateActiveAlerts(
      rawActiveAlerts,
      operatorState,
      replayCandidates,
    );
    const cameraAssistPayload = state.cameraAssistEngine.evaluate({
      watchTargets,
      activeAlerts,
      operatorState,
      operatorDetails,
      updatedAt,
      config,
    });
    state.operatorWorkflowStore.refreshFromSnapshot({
      watchTargets,
      activeAlerts,
      pinState: refreshedPinState,
      operatorDetails,
      cameraAssistPayload,
      updatedAt,
    });
    const operatorWorkflowState = state.operatorWorkflowStore.getState(updatedAt);
    const observerControlSuggestion = buildObserverControlSuggestion({
      watchTargets,
      activeAlerts,
      pinState: refreshedPinState,
      updatedAt,
    });
    const observerOperatorSuggestion = buildObserverOperatorSuggestion({
      operatorState,
      operatorWorkflowState,
      replayCandidates,
      updatedAt,
    });

    state.rawWatchTargets = rawWatchTargets;
    state.rawActiveAlerts = rawActiveAlerts;
    state.latestSnapshot = {
      mapKey: normalizedMapKey,
      updatedAt,
      watchTargets,
      activeAlerts,
      teamSplitRisks,
      pinState: refreshedPinState,
      operatorState,
      operatorDetails,
      operatorWorkflowState,
      operatorWorkflowConfig: buildOperatorWorkflowConfig(config),
      replayCandidates,
      cameraAssistPayload,
      observerControlSuggestion,
      observerOperatorSuggestion,
    };

    return cloneProductionSupportSnapshot(state.latestSnapshot);
  }

  function setZoneUpdate(zonePacket, mapDefinition) {
    const mapKey = normalizeMapKey(zonePacket?.mapKey);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(mapKey);
    state.zonePacket = zonePacket || null;
    return null;
  }

  function setPlayerPositions(playersPacket, mapDefinition) {
    const mapKey = normalizeMapKey(playersPacket?.mapKey);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(mapKey);
    state.playersPacket = playersPacket || null;
    return null;
  }

  function applyObserverAssist(assistSnapshot, mapDefinition) {
    const mapKey = normalizeMapKey(assistSnapshot?.mapKey);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(mapKey);
    state.assistSnapshot = assistSnapshot || null;
    return recompute(mapKey, mapDefinition, assistSnapshot?.updatedAt ?? Date.now());
  }

  function get(mapKey) {
    const state = statesByMap.get(normalizeMapKey(mapKey));
    return cloneProductionSupportSnapshot(state?.latestSnapshot ?? null);
  }

  function getPinState() {
    return pinnedWatchStore.getState();
  }

  function resetCameraAssistHistory(mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    if (!mapKey || !mapDefinition) {
      return null;
    }

    const state = ensureMapState(mapKey);
    state.cameraAssistEngine.resetHistory();
    return recompute(mapKey, mapDefinition, Date.now());
  }

  function watchNowTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    const now = Date.now();
    state.operatorActionStore.watchNow(target, now);
    state.operatorWorkflowStore.noteTargetAction(target, `Watching ${target.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function pinTeam(teamId, mapDefinition, mapKeyHint = null) {
    const didPin = pinnedWatchStore.pinTeam(teamId);
    if (!didPin) {
      return null;
    }

    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const now = Date.now();
    state.operatorActionStore.pinTeam(teamId, now);
    state.operatorWorkflowStore.noteAction(`Pinned team ${teamId}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function unpinTeam(teamId, mapDefinition, mapKeyHint = null) {
    pinnedWatchStore.unpinTeam(teamId);
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const now = Date.now();
    state.operatorActionStore.unpinTeam(teamId, now);
    state.operatorWorkflowStore.noteAction(`Unpinned team ${teamId}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function pinTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    pinnedWatchStore.pinTarget({
      ...target,
      mapKey,
    });
    const now = Date.now();
    state.operatorActionStore.pinTarget(target, now);
    state.operatorWorkflowStore.noteTargetAction(target, `Pinned ${target.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function unpinTarget(id, mapDefinition, mapKeyHint = null) {
    pinnedWatchStore.unpinTarget(id);
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const now = Date.now();
    const target = findTargetById(state, id);
    state.operatorActionStore.unpinTarget(id, now);
    if (target) {
      state.operatorWorkflowStore.noteTargetAction(target, `Unpinned ${target.label}`, now);
    } else {
      state.operatorWorkflowStore.noteAction(`Unpinned target ${id}`, now);
    }
    return recompute(mapKey, mapDefinition, now);
  }

  function markReplayById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    if (!state) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const target = findTargetById(state, id);
    if (target) {
      state.replayCandidateStore.addCandidate(
        buildReplayCandidateFromTarget(target, now),
        config,
        now,
      );
      state.operatorWorkflowStore.noteTargetAction(
        target,
        `Marked replay ${target.label}`,
        now,
      );
      return recompute(mapKey, mapDefinition, now);
    }

    const alert = findAlertById(state, id);
    if (!alert) {
      return null;
    }

    state.replayCandidateStore.addCandidate(
      buildReplayCandidateFromAlert(alert, now),
      config,
      now,
    );
    state.operatorWorkflowStore.noteAlertAction(alert, `Marked replay ${alert.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function unmarkReplayById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    if (!state) {
      return null;
    }

    const replayCandidate = findReplayCandidateById(state, id);
    const target = replayCandidate ? findTargetById(state, replayCandidate.sourceId) : findTargetById(state, id);
    const alert = replayCandidate ? findAlertById(state, replayCandidate.sourceId) : findAlertById(state, id);
    const removed = state.replayCandidateStore.removeCandidateBySourceId(id);
    if (!removed) {
      return null;
    }

    const now = Date.now();
    if (target) {
      state.operatorWorkflowStore.noteTargetAction(
        target,
        `Removed replay ${target.label}`,
        now,
      );
    } else if (alert) {
      state.operatorWorkflowStore.noteAlertAction(alert, `Removed replay ${alert.label}`, now);
    } else if (replayCandidate) {
      state.operatorWorkflowStore.noteAction(`Removed replay ${replayCandidate.label}`, now);
    }

    return recompute(mapKey, mapDefinition, now);
  }

  function suppressTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const now = Date.now();
    state.operatorActionStore.suppressTarget(
      target,
      config.TARGET_SUPPRESSION_MS,
      now,
      config,
    );
    state.operatorWorkflowStore.noteTargetAction(target, `Suppressed ${target.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function unsuppressTarget(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const target = findTargetById(state, id);
    const now = Date.now();
    const didUnsuppress = state.operatorActionStore.unsuppressTarget(id, now);
    if (!didUnsuppress) {
      return null;
    }

    if (target) {
      state.operatorWorkflowStore.noteTargetAction(
        target,
        `Unsuppressed ${target.label}`,
        now,
      );
    } else {
      state.operatorWorkflowStore.noteAction(`Unsuppressed target ${id}`, now);
    }

    return recompute(mapKey, mapDefinition, now);
  }

  function dismissAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const alert = findAlertById(state, id);
    if (!alert) {
      return null;
    }

    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const now = Date.now();
    const didDismiss = state.operatorActionStore.dismissAlert(alert, now, config);
    if (!didDismiss) {
      return null;
    }

    state.operatorWorkflowStore.noteAlertAction(alert, `Dismissed ${alert.label}`, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function undismissAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const alert = findAlertById(state, id);
    const now = Date.now();
    const didUndismiss = state.operatorActionStore.undismissAlert(id, now);
    if (!didUndismiss) {
      return null;
    }

    if (alert) {
      state.operatorWorkflowStore.noteAlertAction(alert, `Restored ${alert.label}`, now);
    } else {
      state.operatorWorkflowStore.noteAction(`Restored alert ${id}`, now);
    }

    return recompute(mapKey, mapDefinition, now);
  }

  function selectTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    const now = Date.now();
    state.operatorWorkflowStore.selectTarget(target, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function selectAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const alert = findAlertById(state, id);
    if (!alert) {
      return null;
    }

    const now = Date.now();
    state.operatorWorkflowStore.selectAlert(alert, now);
    return recompute(mapKey, mapDefinition, now);
  }

  function centerTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    state.operatorWorkflowStore.focusTarget(
      target,
      config.MAP_FOCUS_HIGHLIGHT_MS,
      now,
      `Centered ${target.label}`,
    );
    return recompute(mapKey, mapDefinition, now);
  }

  function centerAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const alert = findAlertById(state, id);
    if (!alert) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const didFocus = state.operatorWorkflowStore.focusAlert(
      alert,
      config.MAP_FOCUS_HIGHLIGHT_MS,
      now,
      `Centered alert ${alert.label}`,
    );
    if (!didFocus) {
      return null;
    }
    return recompute(mapKey, mapDefinition, now);
  }

  function centerReplayCandidateById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const replayCandidate = findReplayCandidateById(state, id);
    if (!replayCandidate) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const didFocus = state.operatorWorkflowStore.focusReplayCandidate(
      replayCandidate,
      config.MAP_FOCUS_HIGHLIGHT_MS,
      now,
      `Centered replay ${replayCandidate.label}`,
    );
    if (!didFocus) {
      return null;
    }
    return recompute(mapKey, mapDefinition, now);
  }

  function acceptCameraRecommendation(mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const recommendation = state?.latestSnapshot?.cameraAssistPayload?.recommendation || null;
    if (
      !recommendation ||
      recommendation.action === "stay" ||
      !normalizeId(recommendation.recommendedTargetId)
    ) {
      return null;
    }

    const target = findTargetById(state, recommendation.recommendedTargetId);
    if (!target) {
      return null;
    }

    const now = Date.now();
    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    state.operatorActionStore.watchNow(target, now);
    state.operatorWorkflowStore.acceptRecommendation(
      target,
      config.MAP_FOCUS_HIGHLIGHT_MS,
      recommendation.action,
      now,
    );
    return recompute(mapKey, mapDefinition, now);
  }

  return {
    acceptCameraRecommendation,
    applyObserverAssist,
    centerAlertById,
    centerReplayCandidateById,
    centerTargetById,
    dismissAlertById,
    get,
    getPinState,
    markReplayById,
    pinTargetById,
    pinTeam,
    resetCameraAssistHistory,
    selectAlertById,
    selectTargetById,
    setPlayerPositions,
    setZoneUpdate,
    suppressTargetById,
    undismissAlertById,
    unmarkReplayById,
    unpinTarget,
    unpinTeam,
    unsuppressTarget,
    watchNowTargetById,
  };
}

module.exports = {
  createProductionSupportEngine,
};
```

## apps/desktop/electron/map-engine/map-widget-engine.cjs

`$ext
"use strict";

const { buildCalibrationScenario } = require("./debug-calibration-utils.cjs");
const { createObserverAssistEngine } = require("./observer-assist-engine.cjs");
const { createPlayerPositionStore } = require("./player-position-store.cjs");
const { createProductionSupportEngine } = require("./production-support-engine.cjs");
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
  const observerAssistEngine = createObserverAssistEngine();
  const zoneStateStore = createZoneStateStore();
  const playerPositionStore = createPlayerPositionStore();
  const productionSupportEngine = createProductionSupportEngine();

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
    broadcastObserverAssist(observerAssistSnapshot);
    broadcastProductionSupport(
      productionSupportEngine.applyObserverAssist(observerAssistSnapshot, definition),
    );
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
    broadcastObserverAssist(observerAssistSnapshot);
    broadcastProductionSupport(
      productionSupportEngine.applyObserverAssist(observerAssistSnapshot, definition),
    );
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

    broadcastObserverAssist(observerAssistSnapshot);
    return broadcastProductionSupport(
      productionSupportEngine.applyObserverAssist(observerAssistSnapshot, definition),
    );
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
      ["p1", "alpha", 0.18, 0.22],
      ["p2", "alpha", 0.22, 0.28],
      ["p3", "beta", 0.55, 0.41],
      ["p4", "beta", 0.58, 0.46],
      ["p5", "charlie", 0.35, 0.69],
      ["p6", "charlie", 0.38, 0.66],
      ["p7", "delta", 0.72, 0.57],
      ["p8", "delta", 0.76, 0.61],
    ];

    return anchors.map(([playerId, teamId, startX, startY], index) => {
      const wobble = tick / 6 + index * 0.4;
      return {
        playerId,
        teamId,
        x: worldSize * (startX + Math.sin(wobble) * 0.012),
        y: worldSize * (startY + Math.cos(wobble * 0.9) * 0.012),
        alive: true,
        knocked: index === 6 && tick % 18 > 12,
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

  function getStatus() {
    return {
      currentMapKey,
      currentSourceMapName,
      activeFeed: activeFeed ? { ...activeFeed } : null,
      mockFeedRunning: Boolean(mockFeedTimer),
      latestObserverAssist: observerAssistEngine.get(currentMapKey),
      latestProductionSupport: productionSupportEngine.get(currentMapKey),
      pinState: productionSupportEngine.getPinState(),
      latestZoneUpdate: zoneStateStore.getLatest(),
      latestPlayerUpdate: playerPositionStore.getLatest(),
    };
  }

  return {
    applyCombatEvents,
    applyPlayerPositionUpdate,
    applyZoneUpdate,
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
```

## apps/desktop/electron/widget-server/ws/local-widget-broadcast.cjs

`$ext
"use strict";

const { WebSocketServer, WebSocket } = require("ws");

function createLocalWidgetBroadcast({
  path = "/ws",
  heartbeatIntervalMs = 5000,
  log = () => {},
} = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();
  let snapshotProvider = null;
  let lastBroadcastAt = null;

  function send(client, type, payload, timestamp = Date.now()) {
    if (!client || client.readyState !== WebSocket.OPEN) {
      return false;
    }

    client.send(
      JSON.stringify({
        type,
        timestamp,
        payload,
      }),
    );
    lastBroadcastAt = timestamp;
    return true;
  }

  function broadcast(type, payload, timestamp = Date.now()) {
    for (const client of clients) {
      send(client, type, payload, timestamp);
    }
  }

  function getRequestedMapKey(request) {
    try {
      const parsed = new URL(request.url || path, "ws://127.0.0.1");
      return parsed.searchParams.get("map");
    } catch {
      return null;
    }
  }

  function sendSnapshot(client, request) {
    if (typeof snapshotProvider !== "function") {
      return;
    }

    try {
      const snapshot = snapshotProvider({
        requestedMapKey: getRequestedMapKey(request),
      });

      if (snapshot?.mapContext) {
        send(
          client,
          "map_context",
          snapshot.mapContext,
          snapshot.mapContext.timestamp ?? Date.now(),
        );
      }
      if (snapshot?.zone) {
        send(client, "zone_update", snapshot.zone, snapshot.zone.timestamp ?? Date.now());
      }
      if (snapshot?.players) {
        send(
          client,
          "player_positions",
          snapshot.players,
          snapshot.players.timestamp ?? Date.now(),
        );
      }
      if (snapshot?.observerAssist) {
        send(
          client,
          "observer_assist",
          snapshot.observerAssist,
          snapshot.observerAssist.updatedAt ?? Date.now(),
        );
      }
      if (snapshot?.productionSupport) {
        send(
          client,
          "production_support",
          snapshot.productionSupport,
          snapshot.productionSupport.updatedAt ?? Date.now(),
        );
      }

      send(
        client,
        "heartbeat",
        {
          serverTime: Date.now(),
          connectedClients: clients.size,
        },
        Date.now(),
      );
    } catch (error) {
      log(
        "[widget-ws] failed to send initial snapshot",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  wss.on("connection", (client, request) => {
    clients.add(client);

    client.on("close", () => {
      clients.delete(client);
    });

    client.on("error", (error) => {
      log(
        "[widget-ws] client error",
        error instanceof Error ? error.message : String(error),
      );
    });

    sendSnapshot(client, request);
  });

  const heartbeatTimer = setInterval(() => {
    broadcast(
      "heartbeat",
      {
        serverTime: Date.now(),
        connectedClients: clients.size,
      },
      Date.now(),
    );
  }, heartbeatIntervalMs);

  function handleUpgrade(request, socket, head) {
    const url = request.url || "";
    if (!url.startsWith(path)) {
      return false;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
    return true;
  }

  function close() {
    clearInterval(heartbeatTimer);
    for (const client of clients) {
      try {
        client.close();
      } catch (_) {
        // ignore close failures
      }
    }
    clients.clear();
    wss.close();
  }

  return {
    broadcast,
    close,
    getClientCount: () => clients.size,
    getPath: () => path,
    getStatus: () => ({
      clientCount: clients.size,
      lastBroadcastAt,
      path,
    }),
    handleUpgrade,
    send,
    setSnapshotProvider(provider) {
      snapshotProvider = provider;
    },
  };
}

module.exports = {
  createLocalWidgetBroadcast,
};
```

## apps/desktop/electron/widget-server/server.cjs

`$ext
"use strict";

const http = require("node:http");
const path = require("node:path");
const cors = require("cors");
const express = require("express");
const { createMapRegistry } = require("../map-engine/map-registry.cjs");
const { createMapTelemetryBridge } = require("../map-engine/telemetry-map-bridge.cjs");
const { createMapWidgetEngine } = require("../map-engine/map-widget-engine.cjs");
const { registerHealthRoute } = require("./routes/health-route.cjs");
const { registerObsMapRoute } = require("./routes/obs-map-route.cjs");
const { createLocalWidgetBroadcast } = require("./ws/local-widget-broadcast.cjs");

const DEFAULT_PORT = 5510;
const DEFAULT_HOST = "127.0.0.1";

function normalizePort(value, fallback = DEFAULT_PORT) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 65535) {
    return fallback;
  }
  return numeric;
}

function startWidgetsServer(options = {}) {
  const log = typeof options.log === "function" ? options.log : () => {};
  const port = normalizePort(
    options.port ?? process.env.ARENZYRA_WIDGET_PORT,
    DEFAULT_PORT,
  );
  const host = options.host || DEFAULT_HOST;
  const startedAt = Date.now();

  const registry = createMapRegistry({
    assetsRoot: options.assetsRoot,
    log,
  });
  registry.validateAssets();

  const app = express();
  const httpServer = http.createServer(app);
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
    log(
      "[widget-server] failed to start",
      error instanceof Error ? error.message : String(error),
    );
  });

  httpServer.listen(port, host, () => {
    log(`[widget-server] listening on http://localhost:${port}`);
    log(`[widget-server] health route http://localhost:${port}/health`);
    log(`[widget-server] OBS map widget http://localhost:${port}/obs/map`);
    log(
      `[widget-server] OBS operator panel http://localhost:${port}/obs/map?operatorpanel=1`,
    );
    log(
      `[widget-server] OBS camera assist http://localhost:${port}/obs/map?cameraassist=1`,
    );
    log(
      `[widget-server] OBS full operator mode http://localhost:${port}/obs/map?operatorpanel=1&assistpanel=1&cameraassist=1&debug=1`,
    );
    log(
      `[widget-server] OBS map widget debug http://localhost:${port}/obs/map?debug=1`,
    );
  });

  if (
    String(process.env.ARENZYRA_WIDGET_DEMO || "").trim() === "1" &&
    enableDebugRoutes
  ) {
    engine.startMockFeed(process.env.ARENZYRA_WIDGET_DEMO_MAP || null);
  }

  let stopped = false;

  return {
    engine,
    getStatus() {
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
        host,
        port,
        path: broadcastStatus.path ?? null,
        clientCount: broadcastStatus.clientCount ?? 0,
        lastBroadcastAt: broadcastStatus.lastBroadcastAt ?? null,
        startedAt,
      };
    },
    host,
    ingestTelemetrySnapshot(snapshot) {
      telemetryBridge.ingestSnapshot(snapshot);
    },
    port,
    registry,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      engine.stopMockFeed();
      broadcast.close();

      await new Promise((resolve) => {
        try {
          httpServer.close(() => resolve());
        } catch (_) {
          resolve();
        }
      });
      log("[widget-server] stopped");
    },
  };
}

module.exports = {
  startWidgetsServer,
};
```

## apps/desktop/electron/main.cjs

`$ext
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const axios = require("axios");
const {
  createLauncherApiClient,
  OBSERVER_LIMIT_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
} = require("./apiClient.cjs");
const { createSessionManager } = require("./sessionManager.cjs");
const { createTelemetryBridge } = require("./telemetryBridge.cjs");
const { startWidgetsServer } = require("./widget-server/server.cjs");
let electronModule = require("electron");

const logPath = path.join(__dirname, "..", "electron-debug.log");
const TEAM_ASSETS_DIR = "C:\\ArenzyraObserver\\assets\\teams";
const DEFAULT_API_BASE = "http://localhost:3000";
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
const OLDER_SHADOWTRACKER_PREFIX = "C:\\PCOB 401\\";
const LEGACY_SHADOWTRACKER_PREFIX = "C:\\PCOB 402\\";
const DEFAULT_SHADOWTRACKER_PREFIX = `${CURRENT_PCOB_ROOT}\\`;
const OLDER_TELEMETRY_BRIDGE_PREFIX = "C:\\PCOB 401\\";
const LEGACY_TELEMETRY_BRIDGE_PREFIX = "C:\\PCOB 402\\";
const DEFAULT_TELEMETRY_BRIDGE_PREFIX = `${CURRENT_PCOB_ROOT}\\`;
const PLACEHOLDER_LOGO_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axzwoAAAAASUVORK5CYII=";
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const ACCESS_DENIED_ERROR_CODE = "ARENZYRA_LAUNCHER_ACCESS_DENIED";
const SHADOW_TELEMETRY_BASE_URL = "http://127.0.0.1:10086";
const SHADOW_TELEMETRY_PROBE_PATHS = [
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

const log = (...args) => {
  const line = `[${new Date().toISOString()}] ${args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ")}\n`;
  try {
    fs.appendFileSync(logPath, line);
  } catch (_) {
    // ignore file errors
  }
  console.log(...args);
};

process.on("exit", (code) => log("[electron] process exit", code));
process.on("uncaughtException", (err) => {
  log("[electron] uncaughtException", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (reason) => {
  log("[electron] unhandledRejection", reason);
});

if (
  typeof electronModule === "string" ||
  !electronModule ||
  typeof electronModule.app === "undefined"
) {
  if (process.env.ARENZYRA_ELECTRON_RESPAWNED === "1") {
    log("[electron] respawn failed; still not getting electron module. Aborting.");
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

const { app, BrowserWindow, dialog, ipcMain, safeStorage } = electronModule;
const isDev = !app.isPackaged;
const devPort = process.env.DEV_SERVER_PORT || "5400";
const LAUNCHER_PROTOCOL = "arenzyra-launcher";

let telemetryBridgeProcess = null;
let telemetryBridgeScriptPath = "";
let launcherAccessState = null;
let launcherHeartbeatTimer = null;
let quittingAfterCleanup = false;
let mainWindow = null;
let pendingSyncCommand = null;
let windowLoaded = false;
let widgetServer = null;
const telemetryBridge = createTelemetryBridge({
  log,
  onSnapshot: (snapshot) => {
    try {
      widgetServer?.ingestTelemetrySnapshot(snapshot);
    } catch (error) {
      log(
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
const apiClient = createLauncherApiClient({
  normalizeBaseUrl,
  onUnauthorized: () => {
    stopLauncherHeartbeat();
    launcherAccessState = null;
    telemetryBridge.stop("stopped");
    sessionManager.clearSession();
  },
});

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
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: "#08141c",
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
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
    log("[electron] Renderer load failed", { code, desc, url });
    if (!isDev) return;
    win
      .loadURL(`http://localhost:${devPort}`)
      .then(() => log("[electron] Reloaded dev server after fail"))
      .catch((err) => {
        log(
          "[electron] Retry loadURL failed, falling back to dist",
          err && err.stack ? err.stack : err,
        );
        const indexPath = path.join(__dirname, "../dist/index.html");
        win
          .loadFile(indexPath)
          .catch((loadErr) =>
            log(
              "[electron] loadFile failed",
              loadErr && loadErr.stack ? loadErr.stack : loadErr,
            ),
          );
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
    createWindow();
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
    log(
      "[launcher] failed to register protocol",
      error && error.stack ? error.stack : error,
    );
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return DEFAULT_API_BASE;
  }

  try {
    return new URL(
      trimmed.includes("://") ? trimmed : `http://${trimmed}`,
    ).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_API_BASE;
  }
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

function requireMatchId(matchId) {
  const trimmedMatchId = String(matchId || "").trim();
  if (!trimmedMatchId) {
    throw new Error("Select a match before running this action.");
  }
  return trimmedMatchId;
}

function getStoredSession() {
  const session = sessionManager.readSession();
  if (!session?.token) {
    throw createUnauthorizedError();
  }
  return {
    ...session,
    apiBase: normalizeBaseUrl(session.apiBase || DEFAULT_API_BASE),
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

async function evaluateLauncherAccess(session, options = {}) {
  const machineId = sessionManager.getMachineId();
  const licenseCheck = await apiClient.getLauncherLicense({
    apiBase: session.apiBase,
    token: session.token,
  });

  if (licenseCheck?.valid !== true) {
    stopLauncherHeartbeat();
    launcherAccessState = {
      allowed: false,
      reason: licenseCheck?.reason || "LICENSE_INVALID",
      license: licenseCheck?.license ?? null,
      machineId,
      activeSessions: null,
      maxObservers: Number.isFinite(licenseCheck?.license?.maxObservers)
        ? Number(licenseCheck.license.maxObservers)
        : null,
    };
    return launcherAccessState;
  }

  try {
    const sessionStart = await apiClient.startLauncherSession({
      apiBase: session.apiBase,
      token: session.token,
      machineId,
    });

    launcherAccessState = {
      allowed: true,
      reason: null,
      license: sessionStart?.license ?? licenseCheck?.license ?? null,
      machineId,
      activeSessions: Number.isFinite(sessionStart?.activeSessions)
        ? Number(sessionStart.activeSessions)
        : null,
      maxObservers: Number.isFinite(sessionStart?.maxObservers)
        ? Number(sessionStart.maxObservers)
        : Number.isFinite(licenseCheck?.license?.maxObservers)
          ? Number(licenseCheck.license.maxObservers)
          : null,
    };

    if (options.startHeartbeat !== false) {
      startLauncherHeartbeat(session);
    }

    return launcherAccessState;
  } catch (error) {
    if (error?.code === OBSERVER_LIMIT_ERROR_CODE) {
      stopLauncherHeartbeat();
      launcherAccessState = {
        allowed: false,
        reason: OBSERVER_LIMIT_ERROR_CODE,
        license: error?.license ?? licenseCheck?.license ?? null,
        machineId:
          typeof error?.machineId === "string" && error.machineId.trim()
            ? error.machineId.trim()
            : machineId,
        activeSessions: Number.isFinite(error?.activeSessions)
          ? Number(error.activeSessions)
          : null,
        maxObservers: Number.isFinite(error?.maxObservers)
          ? Number(error.maxObservers)
          : Number.isFinite(licenseCheck?.license?.maxObservers)
            ? Number(licenseCheck.license.maxObservers)
            : null,
      };
      return launcherAccessState;
    }

    throw error;
  }
}

function startLauncherHeartbeat(session) {
  stopLauncherHeartbeat();
  launcherHeartbeatTimer = setInterval(() => {
    void maintainLauncherSession(session);
  }, HEARTBEAT_INTERVAL_MS);
}

async function maintainLauncherSession(session) {
  try {
    const access = await evaluateLauncherAccess(session, {
      startHeartbeat: false,
    });
    if (access?.allowed !== true) {
      log("[launcher] access heartbeat blocked", access);
    }
  } catch (error) {
    if (isUnauthorizedError(error)) {
      stopLauncherHeartbeat();
      launcherAccessState = null;
      telemetryBridge.stop("stopped");
      sessionManager.clearSession();
      return;
    }

    log(
      "[launcher] heartbeat failed",
      error && error.stack ? error.stack : error,
    );
  }
}

async function endLauncherSession(options = {}) {
  stopLauncherHeartbeat();
  launcherAccessState = null;

  const storedSession = sessionManager.readSession();
  if (!storedSession?.token) {
    telemetryBridge.stop("stopped");
    if (options.clearAuth === true) {
      sessionManager.clearSession();
    }
    return { ok: true };
  }

  try {
    await apiClient.endLauncherSession({
      apiBase: normalizeBaseUrl(storedSession.apiBase || DEFAULT_API_BASE),
      token: storedSession.token,
      machineId: sessionManager.getMachineId(),
    });
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      log(
        "[launcher] failed to end launcher session",
        error && error.stack ? error.stack : error,
      );
    }
  } finally {
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
    fs.writeFileSync(
      placeholderPath,
      Buffer.from(PLACEHOLDER_LOGO_BASE64, "base64"),
    );
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
    log(
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

async function pinSelectedMatchLive(session, matchId) {
  const requestedMatchId = requireMatchId(matchId);
  await apiClient.startMatchControl({
    apiBase: session.apiBase,
    token: session.token,
    matchId: requestedMatchId,
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
  const repoBridgeScript = path.resolve(__dirname, "..", "..", "..", "ob.js");
  return uniquePaths([
    DEFAULT_TELEMETRY_BRIDGE_SCRIPT,
    LEGACY_TELEMETRY_BRIDGE_SCRIPT,
    OLDER_TELEMETRY_BRIDGE_SCRIPT,
    repoBridgeScript,
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
        log("[launcher] telemetry source probe failed", code);
      }
    }
  }

  return false;
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
    apiBase: normalizeBaseUrl(apiBase || DEFAULT_API_BASE),
    teamAssetsDir: TEAM_ASSETS_DIR,
    brandingConfigPath: getBrandingConfigPath(),
    shadowTrackerPath: resolveShadowTrackerExecutable(""),
    telemetryBridgeAvailable: true,
    sessionPath: sessionManager.getSessionPath(),
  };
}

async function bootstrapLauncher(apiBaseHint) {
  const storedSession = sessionManager.readSession();
  const resolvedApiBase = normalizeBaseUrl(
    storedSession?.apiBase || apiBaseHint || DEFAULT_API_BASE,
  );
  const defaults = getLauncherDefaults(resolvedApiBase);

  if (!storedSession?.token) {
    stopLauncherHeartbeat();
    launcherAccessState = null;
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
    });
    const nextSession = {
      apiBase: restored.apiBase,
      token: storedSession.token,
      user: restored.user,
      organization: restored.organization,
    };
    sessionManager.writeSession(nextSession);
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

  const nextSession = {
    apiBase: loginResult.apiBase,
    token: loginResult.accessToken,
    user: loginResult.user,
    organization: loginResult.organization,
  };

  sessionManager.writeSession(nextSession);
  const access = await evaluateLauncherAccess(nextSession);

  return {
    apiBase: loginResult.apiBase,
    session: toSessionView(nextSession),
    access: toAccessView(access),
  };
}

if (singleInstanceLock) {
app.whenReady().then(() => {
  registerLauncherProtocol();
  consumeProtocolArguments(process.argv);
  widgetServer = startWidgetsServer({
    port: Number(process.env.ARENZYRA_WIDGET_PORT || 5510),
    enableDebugRoutes: isDev,
    enableOperatorRoutes: true,
    log,
  });
  ipcMain.handle("launcher:getDefaults", () =>
    getLauncherDefaults(DEFAULT_API_BASE),
  );

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

  ipcMain.handle("launcher:getLiveMatch", async (_event, payload) =>
    fetchLiveMatch(payload?.apiBase),
  );

  ipcMain.handle("launcher:listTournaments", async () => {
    const session = getStoredSession();
    assertLauncherAccess();
    return apiClient.listTournaments({
      apiBase: session.apiBase,
      token: session.token,
    });
  });

  ipcMain.handle("launcher:listStages", async (_event, payload) => {
    const session = getStoredSession();
    assertLauncherAccess();
    return apiClient.listStages({
      apiBase: session.apiBase,
      token: session.token,
      tournamentId: payload?.tournamentId,
    });
  });

  ipcMain.handle("launcher:listMatches", async (_event, payload) => {
    const session = getStoredSession();
    assertLauncherAccess();
    return apiClient.listMatches({
      apiBase: session.apiBase,
      token: session.token,
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
    const matchId = await pinSelectedMatchLive(session, payload?.matchId);
    const telemetrySource = await ensureTelemetrySourceRunning();
    let telemetry = null;
    let telemetryError = null;

    try {
      telemetry = await telemetryBridge.start({
        apiBase: session.apiBase,
        token: session.token,
        matchId,
      });
    } catch (error) {
      telemetryError =
        error instanceof Error
          ? error.message
          : String(error || "Failed to start telemetry bridge.");
      log("[launcher] auto-start telemetry failed", telemetryError);
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
    const matchId = await pinSelectedMatchLive(session, payload?.matchId);
    const telemetrySource = await ensureTelemetrySourceRunning();
    const telemetry = await telemetryBridge.start({
      apiBase: session.apiBase,
      token: session.token,
      matchId,
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
        log(
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
```

## apps/desktop/src/types.ts

`$ext
export type LauncherSlot = {
  id: string;
  slotNumber: number;
  teamId: string | null;
  lobbyStatus: string | null;
  attendanceStatus?: string | null;
  playersInLobby: number | null;
  resolvedColor?: string | null;
  localLogoPath?: string | null;
  team: {
    id: string;
    name: string | null;
    tag: string | null;
    logoUrl: string | null;
    accentLight?: string | null;
    accentDark?: string | null;
  } | null;
};

export type ActionTone = "neutral" | "success" | "error";

export type StatusMessage = {
  tone: ActionTone;
  title: string;
  detail: string;
};

export type LauncherDefaults = {
  apiBase: string;
  teamAssetsDir: string;
  brandingConfigPath: string;
  shadowTrackerPath: string;
  telemetryBridgeAvailable?: boolean;
  sessionPath?: string;
};

export type LauncherUser = {
  id: string;
  email: string | null;
  name?: string | null;
  role: string | null;
  organizationId: string | null;
};

export type LauncherOrganization = {
  id: string;
  name: string | null;
} | null;

export type LauncherSession = {
  user: LauncherUser;
  organization: LauncherOrganization;
};

export type LauncherAccessReason =
  | "LICENSE_EXPIRED"
  | "LICENSE_MISSING"
  | "LICENSE_SUSPENDED"
  | "LICENSE_INVALID"
  | "OBSERVER_LIMIT_REACHED";

export type LauncherLicense = {
  id: string;
  type: string;
  status: string;
  expiresAt: string;
  maxObservers: number;
};

export type LauncherAccessState = {
  allowed: boolean;
  reason: LauncherAccessReason | null;
  license: LauncherLicense | null;
  machineId: string;
  activeSessions: number | null;
  maxObservers: number | null;
};

export type LauncherBootstrap = LauncherDefaults & {
  session: LauncherSession | null;
  access: LauncherAccessState | null;
};

export type LauncherLiveMatch = {
  apiBase: string;
  matchId: string | null;
  status: string | null;
  source: string | null;
};

export type LauncherSyncCommand = {
  apiBase: string | null;
  tournamentId: string | null;
  matchId: string;
};

export type TournamentSummary = {
  id: string;
  name: string | null;
  status?: string | null;
  liveState?: string | null;
  stageCount?: number;
  matchCount?: number;
};

export type StageSummary = {
  id: string;
  name: string;
  order: number;
  maxTeams: number | null;
  liveState: string | null;
  liveAt?: string | null;
  endedAt?: string | null;
  groupCount: number;
  matchCount: number;
  groups: Array<{
    id: string;
    name: string | null;
    matchCount: number;
  }>;
};

export type MatchSummary = {
  id: string;
  name?: string | null;
  stageId?: string | null;
  groupId?: string | null;
  map?: string | null;
  status?: string | null;
  liveState?: string | null;
  dataMode?: string | null;
  matchNumber?: number | null;
  group?: {
    id: string;
    name: string | null;
  } | null;
};

export type MatchPhase =
  | "plane"
  | "parachuting"
  | "combat"
  | "endgame"
  | "finished"
  | null;

export type TelemetryBridgeStatus = {
  running: boolean;
  matchId: string | null;
  packetsPerSecond: number;
  lastPacketTime: string | null;
  connectionStatus: string;
  phase: MatchPhase;
  gameTime: number | null;
  aliveTeams: number | null;
  circleIndex: number | null;
  circleStatus: string | null;
  totalPackets: number;
  lastError: string | null;
};

export type FileFilter = {
  name: string;
  extensions: string[];
};

export type SyncTeamsResult = {
  matchId: string;
  matchSource: string;
  slotCount: number;
  syncedCount: number;
  teamAssetsDir: string;
  slots: LauncherSlot[];
};

export type GenerateBrandingResult = {
  matchId: string;
  matchSource: string;
  teamCount: number;
  brandingConfigPath: string;
  teamAssetsDir: string;
  slots: LauncherSlot[];
};

export type TelemetrySourceStatus = {
  pid: number | null;
  scriptPath: string | null;
  started: boolean;
  alreadyRunning: boolean;
  ready: boolean;
};

export type LaunchShadowTrackerResult = {
  pid: number | null;
  executablePath: string;
  telemetry:
    | (TelemetryBridgeStatus & {
        alreadyRunning?: boolean;
      })
    | null;
  telemetryError: string | null;
  telemetrySource: TelemetrySourceStatus | null;
  telemetrySourceError: string | null;
};

export type StartTelemetryBridgeResult = TelemetryBridgeStatus & {
  alreadyRunning: boolean;
  telemetrySource: TelemetrySourceStatus | null;
  telemetrySourceError: string | null;
};

export type MapFocusCenter = {
  x: number;
  y: number;
};

export type WatchTarget = {
  id: string;
  label: string;
  score: number;
  centerX?: number;
  centerY?: number;
  category: string | null;
  involvedTeamIds: string[];
  reason: string[];
  updatedAt: number;
  priority: number;
  operatorWatchingNow: boolean;
  operatorPinned: boolean;
  operatorSuppressed: boolean;
  operatorReplayCandidate: boolean;
  mapKey?: string | null;
};

export type ProductionAlert = {
  id: string;
  type: string;
  severity: string;
  label: string;
  centerX?: number;
  centerY?: number;
  involvedTeamIds: string[];
  createdAt: number;
  expiresAt?: number | null;
  operatorReplayCandidate: boolean;
};

export type ReplayCandidate = {
  id: string;
  sourceType: "watch_target" | "alert" | "manual";
  sourceId: string;
  label: string;
  centerX?: number;
  centerY?: number;
  involvedTeamIds: string[];
  createdAt: number;
  expiresAt?: number | null;
};

export type OperatorState = {
  watchingNowTargetId?: string | null;
  primaryPinnedTeamIds: string[];
  primaryPinnedTargetIds: string[];
  replayCandidateIds: string[];
  dismissedAlertIds: string[];
  suppressedTargetIds: string[];
  updatedAt: number;
};

export type OperatorDetails = {
  watchingNowTarget: WatchTarget | null;
  suppressedTargets: WatchTarget[];
  dismissedAlerts: ProductionAlert[];
  updatedAt: number;
};

export type OperatorWorkflowState = {
  selectedTargetId?: string | null;
  selectedAlertId?: string | null;
  highlightedTargetId?: string | null;
  mapFocusCenter?: MapFocusCenter | null;
  mapFocusUntil?: number | null;
  lastAction?: string | null;
  updatedAt: number;
};

export type OperatorWorkflowConfig = {
  mapFocusHighlightMs?: number | null;
  operatorActionStatusMs?: number | null;
  maxSelectableWatchTargets?: number | null;
};

export type CameraAssistRecommendation = {
  action: "stay" | "switch" | "prepare";
  currentTargetId?: string | null;
  recommendedTargetId?: string | null;
  backupTargetIds: string[];
  confidence: number;
  reasons: string[];
  scoreDelta?: number | null;
  generatedAt: number;
};

export type CameraAssistHistoryEntry = {
  action: string;
  currentTargetId?: string | null;
  recommendedTargetId?: string | null;
  generatedAt: number;
};

export type CameraAssistDebugState = {
  currentTargetScore?: number | null;
  recommendedTargetScore?: number | null;
  scoreDelta?: number | null;
  dwellRemainingMs?: number | null;
  switchCooldownRemainingMs?: number | null;
  emergencySwitchEligible?: boolean;
  flapGuardActive?: boolean;
  lastAction?: string | null;
  lastSwitchAt?: number | null;
  recentRecommendationHistory?: CameraAssistHistoryEntry[];
};

export type CameraAssistPayload = {
  recommendation: CameraAssistRecommendation;
  currentWatchedTargetId?: string | null;
  topWatchTargets: WatchTarget[];
  activeAlerts: ProductionAlert[];
  observerState: {
    watchingNowTargetId?: string | null;
    primaryPinnedTeamIds: string[];
    primaryPinnedTargetIds: string[];
  };
  history: {
    lastSwitchAt?: number | null;
    previousTargetId?: string | null;
    lastAction?: string | null;
    recentRecommendationHistory: CameraAssistHistoryEntry[];
  };
  debug?: CameraAssistDebugState | null;
  updatedAt: number;
};

export type PinState = {
  pinnedTeams: string[];
  pinnedTargetIds: string[];
  pinnedTargets: WatchTarget[];
};

export type ObserverCommandCenterTelemetry = {
  connected: boolean;
  lastUpdateAt?: number | null;
  mapKey?: string | null;
  playerCount?: number | null;
  phase?: string | null;
  connectionStatus?: string | null;
  matchId?: string | null;
  packetsPerSecond?: number | null;
  aliveTeams?: number | null;
  gameTime?: number | null;
  circleIndex?: number | null;
  circleStatus?: string | null;
  lastError?: string | null;
  totalPackets?: number | null;
};

export type ObserverCommandCenterWidgetServer = {
  running: boolean;
  port?: number | null;
  host?: string | null;
  path?: string | null;
  clientCount?: number | null;
  lastBroadcastAt?: number | null;
};

export type ObserverCommandCenterSnapshot = {
  telemetry: ObserverCommandCenterTelemetry;
  widgetServer: ObserverCommandCenterWidgetServer;
  mapContext: {
    mapKey?: string | null;
    sourceMapName?: string | null;
    definition?: Record<string, unknown> | null;
    timestamp?: number | null;
  } | null;
  mapKey?: string | null;
  recommendation: CameraAssistRecommendation | null;
  cameraAssistPayload: CameraAssistPayload | null;
  observerControlSuggestion: Record<string, unknown> | null;
  observerOperatorSuggestion: Record<string, unknown> | null;
  watchTargets: WatchTarget[];
  alerts: ProductionAlert[];
  replayCandidates: ReplayCandidate[];
  operatorState: OperatorState | null;
  operatorDetails: OperatorDetails | null;
  operatorWorkflowState: OperatorWorkflowState | null;
  operatorWorkflowConfig: OperatorWorkflowConfig | null;
  pinState: PinState | null;
  updatedAt: number;
};

export type ObserverCommandActionResponse = {
  ok: boolean;
  path: string;
  actionResult: Record<string, unknown> | null;
  snapshot: ObserverCommandCenterSnapshot;
};
```

## apps/desktop/src/api/api-client.ts

`$ext
import type {
  LauncherAccessReason,
  FileFilter,
  GenerateBrandingResult,
  LauncherBootstrap,
  ObserverCommandActionResponse,
  ObserverCommandCenterSnapshot,
  LauncherLiveMatch,
  LauncherSession,
  LauncherSyncCommand,
  LaunchShadowTrackerResult,
  MatchSummary,
  StageSummary,
  StartTelemetryBridgeResult,
  SyncTeamsResult,
  TelemetryBridgeStatus,
  TournamentSummary,
} from "../types";

type LauncherIpc = {
  invoke: (channel: string, payload?: unknown) => Promise<unknown>;
  on: (
    channel: string,
    listener: (_event: unknown, ...args: unknown[]) => void,
  ) => void;
  removeListener: (
    channel: string,
    listener: (_event: unknown, ...args: unknown[]) => void,
  ) => void;
};

const UNAUTHORIZED_MESSAGE = "ARENZYRA_AUTH_UNAUTHORIZED";
const ACCESS_DENIED_MESSAGE = "ARENZYRA_LAUNCHER_ACCESS_DENIED";

export class LauncherUnauthorizedError extends Error {
  constructor(message = "Session expired. Please log in again.") {
    super(message);
    this.name = "LauncherUnauthorizedError";
  }
}

export class LauncherAccessDeniedError extends Error {
  reason: LauncherAccessReason | null;

  constructor(reason: LauncherAccessReason | null) {
    super("Launcher access is blocked.");
    this.name = "LauncherAccessDeniedError";
    this.reason = reason;
  }
}

const getIpc = (): LauncherIpc => {
  const electron = (
    window as Window &
      typeof globalThis & {
        require?: (id: string) => { ipcRenderer?: LauncherIpc };
      }
  ).require?.("electron");

  if (!electron?.ipcRenderer) {
    throw new Error("Electron IPC is unavailable. Start this UI inside Electron.");
  }

  return electron.ipcRenderer;
};

export const getErrorMessage = (error: unknown) => {
  if (error instanceof LauncherUnauthorizedError) {
    return error.message;
  }
  if (error instanceof LauncherAccessDeniedError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Action failed.";
};

export const isUnauthorizedError = (error: unknown) =>
  error instanceof LauncherUnauthorizedError ||
  getErrorMessage(error).includes(UNAUTHORIZED_MESSAGE);

export const isAccessDeniedError = (error: unknown) =>
  error instanceof LauncherAccessDeniedError ||
  getErrorMessage(error).includes(ACCESS_DENIED_MESSAGE);

const parseAccessDeniedReason = (
  message: string,
): LauncherAccessReason | null => {
  const match = message.match(
    /ARENZYRA_LAUNCHER_ACCESS_DENIED::([A-Z_]+)/,
  );
  return match ? (match[1] as LauncherAccessReason) : null;
};

const invoke = async <T,>(channel: string, payload?: unknown): Promise<T> => {
  try {
    return (await getIpc().invoke(channel, payload)) as T;
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes(ACCESS_DENIED_MESSAGE)) {
      throw new LauncherAccessDeniedError(parseAccessDeniedReason(message));
    }
    if (message.includes(UNAUTHORIZED_MESSAGE)) {
      throw new LauncherUnauthorizedError();
    }
    throw new Error(message);
  }
};

export const launcherApi = {
  bootstrap(apiBase?: string) {
    return invoke<LauncherBootstrap>("launcher:bootstrap", { apiBase });
  },

  login(email: string, password: string, apiBase: string) {
    return invoke<{
      apiBase: string;
      session: LauncherSession;
      access: LauncherBootstrap["access"];
    }>("launcher:login", {
      email,
      password,
      apiBase,
    });
  },

  logout() {
    return invoke<{ ok: boolean }>("launcher:logout");
  },

  getLiveMatch(apiBase?: string) {
    return invoke<LauncherLiveMatch>("launcher:getLiveMatch", { apiBase });
  },

  listTournaments() {
    return invoke<TournamentSummary[]>("launcher:listTournaments");
  },

  listStages(tournamentId: string) {
    return invoke<StageSummary[]>("launcher:listStages", { tournamentId });
  },

  listMatches(tournamentId: string) {
    return invoke<MatchSummary[]>("launcher:listMatches", { tournamentId });
  },

  syncTeams(matchId: string) {
    return invoke<SyncTeamsResult>("launcher:syncTeams", { matchId });
  },

  generateBranding(matchId: string) {
    return invoke<GenerateBrandingResult>("launcher:generateBranding", {
      matchId,
    });
  },

  chooseFile(title: string, filters: FileFilter[], defaultPath: string) {
    return invoke<string | null>("launcher:chooseFile", {
      title,
      filters,
      defaultPath,
    });
  },

  getTelemetryStatus() {
    return invoke<TelemetryBridgeStatus>("launcher:getTelemetryStatus");
  },

  getObserverCommandCenterSnapshot(mapKey?: string | null) {
    return invoke<ObserverCommandCenterSnapshot>(
      "launcher:getObserverCommandCenterSnapshot",
      { mapKey },
    );
  },

  runObserverCommandAction(path: string, mapKey?: string | null) {
    return invoke<ObserverCommandActionResponse>("launcher:runObserverCommandAction", {
      path,
      mapKey,
    });
  },

  launchShadowTracker(shadowTrackerPath: string, matchId: string) {
    return invoke<LaunchShadowTrackerResult>("launcher:launchShadowTracker", {
      shadowTrackerPath,
      matchId,
    });
  },

  startTelemetryBridge(matchId: string) {
    return invoke<StartTelemetryBridgeResult>("launcher:startTelemetryBridge", {
      matchId,
    });
  },

  stopTelemetryBridge() {
    return invoke<TelemetryBridgeStatus>("launcher:stopTelemetryBridge");
  },

  consumePendingSyncCommand() {
    return invoke<LauncherSyncCommand | null>("launcher:consumePendingSyncCommand");
  },

  onSyncPending(handler: () => void) {
    const ipc = getIpc();
    const listener = () => handler();
    ipc.on("launcher:sync-pending", listener);
    return () => {
      ipc.removeListener("launcher:sync-pending", listener);
    };
  },
};
```

## apps/desktop/src/screens/dashboard-screen.tsx

`$ext
import type {
  LauncherAccessState,
  LauncherLicense,
  LauncherSession,
  LauncherSlot,
  MatchPhase,
  MatchSummary,
  StageSummary,
  StatusMessage,
  TelemetryBridgeStatus,
  TournamentSummary,
} from "../types";
import { ObserverCommandCenter } from "./observer-command-center";

type DashboardScreenProps = {
  apiBase: string;
  session: LauncherSession;
  access: LauncherAccessState;
  license: LauncherLicense | null;
  tournaments: TournamentSummary[];
  stages: StageSummary[];
  matches: MatchSummary[];
  selectedTournamentId: string;
  selectedStageId: string;
  selectedMatchId: string;
  teamAssetsDir: string;
  brandingConfigPath: string;
  shadowTrackerPath: string;
  telemetryBridgeAvailable: boolean;
  telemetryStatus: TelemetryBridgeStatus;
  status: StatusMessage;
  slots: LauncherSlot[];
  lastSyncTime: string | null;
  busyAction: string | null;
  loadingMatch: boolean;
  onTournamentChange: (value: string) => void;
  onStageChange: (value: string) => void;
  onMatchChange: (value: string) => void;
  onShadowTrackerPathChange: (value: string) => void;
  onBrowseShadowTracker: () => void;
  onSyncTeams: () => void;
  onGenerateBranding: () => void;
  onLaunchShadowTracker: () => void;
  onToggleTelemetry: () => void;
  onLogout: () => void;
};

const MATCH_PHASE_META: Record<
  Exclude<MatchPhase, null>,
  { label: string; icon: string }
> = {
  plane: { label: "Plane Phase", icon: "\u2708" },
  parachuting: { label: "Parachuting", icon: "\uD83E\uDE82" },
  combat: { label: "Combat", icon: "\u2694" },
  endgame: { label: "Endgame", icon: "\uD83D\uDD25" },
  finished: { label: "Finished", icon: "\uD83C\uDFC1" },
};

const formatTeamName = (slot: LauncherSlot) =>
  slot.team?.tag || slot.team?.name || slot.teamId || `Team ${slot.slotNumber}`;

const formatTime = (value: string | null) => {
  if (!value) {
    return "--";
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleTimeString();
};

const formatConnectionStatus = (value: string | null | undefined) => {
  const normalized = String(value || "").trim();
  return normalized ? normalized.replace(/[-_]/g, " ").toUpperCase() : "--";
};

const isLiveState = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .toUpperCase() === "LIVE";

const formatDate = (value: string | null | undefined) => {
  if (!value) {
    return "--";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(parsed));
};

const formatPhaseDisplay = (phase: MatchPhase) => {
  if (!phase) {
    return "--";
  }

  const meta = MATCH_PHASE_META[phase];
  return `${meta.icon} ${meta.label}`;
};

const formatStageLabel = (stage: StageSummary) =>
  `#${stage.order} ${stage.name}${isLiveState(stage.liveState) ? " [LIVE]" : ""}`;

const formatMatchLabel = (match: MatchSummary) => {
  const numberLabel =
    typeof match.matchNumber === "number" ? `Match ${match.matchNumber}` : "Match";
  const nameLabel = match.name ? ` - ${match.name}` : "";
  const groupLabel = match.group?.name ? ` (${match.group.name})` : "";
  const liveLabel =
    isLiveState(match.liveState) || isLiveState(match.status) ? " [LIVE]" : "";
  return `${numberLabel}${nameLabel}${groupLabel}${liveLabel}`;
};

const formatTournamentLabel = (tournament: TournamentSummary) =>
  `${tournament.name || tournament.id}${
    isLiveState(tournament.liveState) || isLiveState(tournament.status)
      ? " [LIVE]"
      : ""
  }`;

export function DashboardScreen(props: DashboardScreenProps) {
  const phaseDisplay = formatPhaseDisplay(props.telemetryStatus.phase);
  const connectionStatusDisplay = formatConnectionStatus(
    props.telemetryStatus.connectionStatus,
  );
  const selectedTournament =
    props.tournaments.find((item) => item.id === props.selectedTournamentId) ||
    null;
  const selectedStage =
    props.stages.find((item) => item.id === props.selectedStageId) || null;
  const selectedMatch =
    props.matches.find((item) => item.id === props.selectedMatchId) || null;
  const actionsDisabled =
    Boolean(props.busyAction) || props.loadingMatch || !props.selectedMatchId;

  return (
    <div className="app-shell">
      <div className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">Arenzyra Observer Launcher</span>
          <h1>Authenticated observer control.</h1>
          <p>
            Select a tournament, stage, and match from your organization, then
            sync teams, generate ShadowTracker branding, launch the client, and
            run telemetry from one authenticated workflow.
          </p>
          <div className="hero-actions">
            <button
              className="secondary-button"
              onClick={props.onLogout}
              disabled={Boolean(props.busyAction) || props.loadingMatch}
            >
              Logout
            </button>
          </div>
        </div>

        <div className="hero-meta">
          <div className="meta-pill">
            <span>Organizer</span>
            <strong>{props.session.user.email || props.session.user.id}</strong>
          </div>
          <div className="meta-pill">
            <span>Organization</span>
            <strong>
              {props.session.organization?.name ||
                props.session.user.organizationId ||
                "--"}
            </strong>
          </div>
          <div className="meta-pill">
            <span>Tournament</span>
            <strong>{selectedTournament?.name || "--"}</strong>
          </div>
          <div className="meta-pill">
            <span>Stage</span>
            <strong>{selectedStage ? formatStageLabel(selectedStage) : "--"}</strong>
          </div>
          <div className="meta-pill">
            <span>Match</span>
            <strong>{selectedMatch ? formatMatchLabel(selectedMatch) : "--"}</strong>
          </div>
          <div className="meta-pill">
            <span>Telemetry Status</span>
            <strong>{connectionStatusDisplay}</strong>
          </div>
          <div className="meta-pill">
            <span>License</span>
            <strong>{props.license?.type || "--"}</strong>
          </div>
          <div className="meta-pill">
            <span>License Expires</span>
            <strong>{formatDate(props.license?.expiresAt)}</strong>
          </div>
        </div>
      </div>

      <div className="layout-grid">
        <section className="panel">
          <div className="panel-heading">
            <span className="panel-kicker">Production Scope</span>
            <h2>Authenticated Match Selection</h2>
          </div>

          <div className="path-card">
            <span className="path-label">API Base</span>
            <code>{props.apiBase}</code>
          </div>

          <label className="field">
            <span>Tournament</span>
            <select
              value={props.selectedTournamentId}
              onChange={(event) => props.onTournamentChange(event.target.value)}
              disabled={Boolean(props.busyAction) || props.loadingMatch}
            >
              <option value="">Select a tournament</option>
              {props.tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {formatTournamentLabel(tournament)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Stage</span>
            <select
              value={props.selectedStageId}
              onChange={(event) => props.onStageChange(event.target.value)}
              disabled={
                !props.selectedTournamentId ||
                Boolean(props.busyAction) ||
                props.loadingMatch
              }
            >
              <option value="">Select a stage</option>
              {props.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {formatStageLabel(stage)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Match</span>
            <select
              value={props.selectedMatchId}
              onChange={(event) => props.onMatchChange(event.target.value)}
              disabled={
                !props.selectedTournamentId ||
                Boolean(props.busyAction) ||
                props.loadingMatch
              }
            >
              <option value="">Select a match</option>
              {props.matches.map((match) => (
                <option key={match.id} value={match.id}>
                  {formatMatchLabel(match)}
                </option>
              ))}
            </select>
          </label>

          <div className="path-card">
            <span className="path-label">Team logos folder</span>
            <code>{props.teamAssetsDir}</code>
          </div>

          <div className="path-card">
            <span className="path-label">Branding config file</span>
            <code>{props.brandingConfigPath}</code>
          </div>

          <div className="status-card status-card--neutral">
            <strong>Arenzyra License</strong>
            <div className="license-stats">
              <div className="license-stat">
                <span>Type</span>
                <strong>{props.license?.type || "--"}</strong>
              </div>
              <div className="license-stat">
                <span>Expires</span>
                <strong>{formatDate(props.license?.expiresAt)}</strong>
              </div>
              <div className="license-stat">
                <span>Observers Allowed</span>
                <strong>
                  {props.license?.maxObservers ?? props.access.maxObservers ?? "--"}
                </strong>
              </div>
              <div className="license-stat">
                <span>Active Sessions</span>
                <strong>{props.access.activeSessions ?? "--"}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <span className="panel-kicker">Match Control</span>
            <h2>Runtime Status</h2>
          </div>

          <label className="field">
            <span>ShadowTrackerExtra.exe</span>
            <div className="input-row">
              <input
                value={props.shadowTrackerPath}
                onChange={(event) =>
                  props.onShadowTrackerPathChange(event.target.value)
                }
                placeholder="C:\\PCOB\\Win64_Release4.3.0_No14_4.3.0.20920_Shipping_OB_Shelled\\WindowsNoEditor\\ShadowTrackerExtra\\Binaries\\Win64\\ShadowTrackerExtra.exe"
                disabled={Boolean(props.busyAction) || props.loadingMatch}
              />
              <button
                className="secondary-button"
                onClick={props.onBrowseShadowTracker}
                disabled={Boolean(props.busyAction) || props.loadingMatch}
              >
                Browse
              </button>
            </div>
          </label>

          <div className="path-card">
            <span className="path-label">Match Phase</span>
            <code>{phaseDisplay}</code>
          </div>

          <div className="path-card">
            <span className="path-label">Telemetry Status</span>
            <code>{connectionStatusDisplay}</code>
          </div>

          <div className="path-card">
            <span className="path-label">Packets/sec</span>
            <code>{props.telemetryStatus.packetsPerSecond}</code>
          </div>

          <div className="path-card">
            <span className="path-label">Last packet time</span>
            <code>{formatTime(props.telemetryStatus.lastPacketTime)}</code>
          </div>

          <div className="path-card">
            <span className="path-label">Last sync</span>
            <code>
              {props.loadingMatch ? "Loading selected match..." : formatTime(props.lastSyncTime)}
            </code>
          </div>

          {!props.telemetryBridgeAvailable ? (
            <div className="status-card status-card--error">
              <strong>Telemetry bridge unavailable</strong>
              <p>Restart the Electron launcher to load the telemetry bridge.</p>
            </div>
          ) : null}

          {props.telemetryStatus.lastError ? (
            <div className="status-card status-card--error">
              <strong>Telemetry error</strong>
              <p>{props.telemetryStatus.lastError}</p>
            </div>
          ) : null}

          <div className={`status-card status-card--${props.status.tone}`}>
            <strong>{props.status.title}</strong>
            <p>{props.status.detail}</p>
          </div>
        </section>
      </div>

      <section className="actions-panel">
        <button
          className="action-button action-button--sync"
          onClick={props.onSyncTeams}
          disabled={actionsDisabled}
        >
          <span>Sync Teams</span>
          <small>Fetch slots, player data, and team logos for the selected match.</small>
        </button>

        <button
          className="action-button action-button--branding"
          onClick={props.onGenerateBranding}
          disabled={actionsDisabled}
        >
          <span>Generate ShadowTracker Branding</span>
          <small>Write TeamLogoAndColor for the selected production match.</small>
        </button>

        <button
          className="action-button action-button--launch"
          onClick={props.onLaunchShadowTracker}
          disabled={actionsDisabled}
        >
          <span>Launch ShadowTracker</span>
          <small>Start ShadowTrackerExtra.exe, auto-start ob.js, and start telemetry.</small>
        </button>

        <button
          className="action-button action-button--bridge"
          onClick={props.onToggleTelemetry}
          disabled={
            actionsDisabled || !props.telemetryBridgeAvailable
          }
        >
          <span>
            {props.telemetryStatus.running
              ? "Stop Telemetry Bridge"
              : "Start Telemetry Bridge"}
          </span>
          <small>
            Auto-start ob.js when needed and send authenticated ShadowTracker telemetry for the selected match.
          </small>
        </button>
      </section>

      <ObserverCommandCenter />

      <section className="panel table-panel">
        <div className="panel-heading">
          <span className="panel-kicker">Assigned Slots</span>
          <h2>Loaded Match Teams</h2>
        </div>

        {props.slots.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Team</th>
                  <th>Lobby</th>
                  <th>Players</th>
                  <th>Color</th>
                  <th>Logo Path</th>
                </tr>
              </thead>
              <tbody>
                {props.slots.map((slot) => (
                  <tr key={slot.id}>
                    <td>{slot.slotNumber}</td>
                    <td>
                      <div className="team-cell">
                        <strong>{formatTeamName(slot)}</strong>
                        <span>{slot.teamId || "--"}</span>
                      </div>
                    </td>
                    <td>{slot.attendanceStatus || slot.lobbyStatus || "--"}</td>
                    <td>{slot.playersInLobby ?? "--"}</td>
                    <td>
                      <div className="color-chip-row">
                        <span
                          className="color-chip"
                          style={{
                            background:
                              slot.resolvedColor ||
                              slot.team?.accentLight ||
                              slot.team?.accentDark ||
                              "#FFFFFF",
                          }}
                        />
                        <code>
                          {slot.resolvedColor ||
                            slot.team?.accentLight ||
                            slot.team?.accentDark ||
                            "#FFFFFF"}
                        </code>
                      </div>
                    </td>
                    <td>
                      <code className="logo-path">
                        {slot.localLogoPath || "--"}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            {props.selectedMatchId
              ? "No team slots loaded yet. The launcher will populate this table when the selected match is synced."
              : "Select a match to load team slots, player data, and team logos."}
          </div>
        )}
      </section>
    </div>
  );
}
```

## apps/desktop/src/services/observer-command-center.ts

`$ext
import type { ObserverCommandCenterSnapshot } from "../types";

export const COMMAND_CENTER_POLL_INTERVAL_MS = 1250;

const emptyArray = <T,>(): T[] => [];

export const emptyObserverCommandCenterSnapshot: ObserverCommandCenterSnapshot = {
  telemetry: {
    connected: false,
    lastUpdateAt: null,
    mapKey: null,
    playerCount: null,
    phase: null,
    connectionStatus: "stopped",
    matchId: null,
    packetsPerSecond: 0,
    aliveTeams: null,
    gameTime: null,
    circleIndex: null,
    circleStatus: null,
    lastError: null,
    totalPackets: 0,
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
  watchTargets: emptyArray(),
  alerts: emptyArray(),
  replayCandidates: emptyArray(),
  operatorState: null,
  operatorDetails: null,
  operatorWorkflowState: null,
  operatorWorkflowConfig: null,
  pinState: null,
  updatedAt: 0,
};

function buildActionPath(
  pathname: string,
  params: Record<string, string | null | undefined>,
) {
  const url = new URL(pathname, "http://127.0.0.1");
  Object.entries(params).forEach(([key, value]) => {
    const normalized = typeof value === "string" ? value.trim() : value;
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  });
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

export const observerCommandRoutes = {
  acceptRecommendation(mapKey?: string | null) {
    return buildActionPath("/debug/operator/accept-recommendation", {
      map: mapKey ?? null,
    });
  },
  centerAlert(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/center-alert", { id, map: mapKey ?? null });
  },
  centerReplay(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/center-replay", { id, map: mapKey ?? null });
  },
  centerTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/center-target", { id, map: mapKey ?? null });
  },
  dismissAlert(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/dismiss-alert", { id, map: mapKey ?? null });
  },
  markReplay(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/mark-replay", { id, map: mapKey ?? null });
  },
  pinTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/pin-target", { id, map: mapKey ?? null });
  },
  pinTeam(teamId: string, mapKey?: string | null) {
    return buildActionPath("/debug/observer/pin-team", {
      teamId,
      map: mapKey ?? null,
    });
  },
  removeReplay(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/remove-replay", { id, map: mapKey ?? null });
  },
  resetCameraAssistHistory(mapKey?: string | null) {
    return buildActionPath("/debug/camera-assist/reset-history", {
      map: mapKey ?? null,
    });
  },
  selectAlert(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/select-alert", { id, map: mapKey ?? null });
  },
  selectTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/select-target", { id, map: mapKey ?? null });
  },
  suppressTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/suppress-target", { id, map: mapKey ?? null });
  },
  undismissAlert(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/undismiss-alert", { id, map: mapKey ?? null });
  },
  unmarkReplay(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/unmark-replay", { id, map: mapKey ?? null });
  },
  unpinTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/unpin-target", { id, map: mapKey ?? null });
  },
  unpinTeam(teamId: string, mapKey?: string | null) {
    return buildActionPath("/debug/observer/unpin-team", {
      teamId,
      map: mapKey ?? null,
    });
  },
  unsuppressTarget(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/unsuppress-target", { id, map: mapKey ?? null });
  },
  watchNow(id: string, mapKey?: string | null) {
    return buildActionPath("/debug/operator/watch-now", { id, map: mapKey ?? null });
  },
};
```

## apps/desktop/src/hooks/use-observer-command-center.ts

`$ext
import { startTransition, useEffect, useRef, useState } from "react";
import { getErrorMessage, launcherApi } from "../api/api-client";
import { COMMAND_CENTER_POLL_INTERVAL_MS, emptyObserverCommandCenterSnapshot } from "../services/observer-command-center";
import type {
  ObserverCommandActionResponse,
  ObserverCommandCenterSnapshot,
} from "../types";

type UseObserverCommandCenterResult = {
  snapshot: ObserverCommandCenterSnapshot;
  loading: boolean;
  error: string | null;
  busyActionPath: string | null;
  refresh: () => Promise<ObserverCommandCenterSnapshot>;
  runAction: (path: string) => Promise<ObserverCommandActionResponse>;
};

export function useObserverCommandCenter(
  preferredMapKey?: string | null,
): UseObserverCommandCenterResult {
  const [snapshot, setSnapshot] = useState<ObserverCommandCenterSnapshot>(
    emptyObserverCommandCenterSnapshot,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyActionPath, setBusyActionPath] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const mapKeyRef = useRef<string | null>(preferredMapKey ?? null);

  useEffect(() => {
    mapKeyRef.current = preferredMapKey ?? null;
  }, [preferredMapKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async (markLoaded = false) => {
      try {
        const nextSnapshot = await launcherApi.getObserverCommandCenterSnapshot(
          mapKeyRef.current,
        );
        if (cancelled || !mountedRef.current) {
          return nextSnapshot;
        }
        startTransition(() => {
          setSnapshot(nextSnapshot);
        });
        setError(null);
        if (markLoaded) {
          setLoading(false);
        }
        return nextSnapshot;
      } catch (nextError) {
        if (!cancelled && mountedRef.current) {
          setError(getErrorMessage(nextError));
          if (markLoaded) {
            setLoading(false);
          }
        }
        throw nextError;
      }
    };

    void loadSnapshot(true).catch(() => undefined);
    const timer = window.setInterval(() => {
      void loadSnapshot(false).catch(() => undefined);
    }, COMMAND_CENTER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [preferredMapKey]);

  const refresh = async () => {
    const nextSnapshot = await launcherApi.getObserverCommandCenterSnapshot(
      mapKeyRef.current,
    );
    if (mountedRef.current) {
      startTransition(() => {
        setSnapshot(nextSnapshot);
      });
      setError(null);
      setLoading(false);
    }
    return nextSnapshot;
  };

  const runAction = async (path: string) => {
    setBusyActionPath(path);
    try {
      const result = await launcherApi.runObserverCommandAction(
        path,
        mapKeyRef.current,
      );
      if (mountedRef.current) {
        startTransition(() => {
          setSnapshot(result.snapshot);
        });
        setError(null);
      }
      return result;
    } catch (nextError) {
      if (mountedRef.current) {
        setError(getErrorMessage(nextError));
      }
      throw nextError;
    } finally {
      if (mountedRef.current) {
        setBusyActionPath((current) => (current === path ? null : current));
      }
    }
  };

  return {
    snapshot,
    loading,
    error,
    busyActionPath,
    refresh,
    runAction,
  };
}
```

## apps/desktop/src/screens/observer-command-center.tsx

`$ext
import type { ReactNode } from "react";
import { useObserverCommandCenter } from "../hooks/use-observer-command-center";
import { observerCommandRoutes } from "../services/observer-command-center";
import type {
  ObserverCommandCenterSnapshot,
  ProductionAlert,
  WatchTarget,
} from "../types";

function formatRelativeTime(timestamp?: number | null) {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "--";
  }

  const deltaMs = Math.max(0, Date.now() - timestamp);
  if (deltaMs < 1_000) {
    return "just now";
  }

  const seconds = Math.round(deltaMs / 1_000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.round(hours / 24)}d ago`;
}

function formatCountdown(timestamp?: number | null) {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return "--";
  }

  const deltaMs = Math.max(0, timestamp - Date.now());
  const seconds = Math.round(deltaMs / 1_000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function formatConfidence(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

function formatScore(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(Math.round(value))
    : "--";
}

function hasCoordinates(value: { centerX?: number; centerY?: number } | null | undefined) {
  return Boolean(
    value &&
      typeof value.centerX === "number" &&
      Number.isFinite(value.centerX) &&
      typeof value.centerY === "number" &&
      Number.isFinite(value.centerY),
  );
}

function buildTargetLookup(snapshot: ObserverCommandCenterSnapshot) {
  const lookup = new Map<string, WatchTarget>();
  const collections = [
    snapshot.watchTargets,
    snapshot.pinState?.pinnedTargets ?? [],
    snapshot.operatorDetails?.suppressedTargets ?? [],
    snapshot.operatorDetails?.watchingNowTarget
      ? [snapshot.operatorDetails.watchingNowTarget]
      : [],
    snapshot.cameraAssistPayload?.topWatchTargets ?? [],
  ];

  collections.forEach((collection) => {
    collection.forEach((target) => {
      if (target?.id && !lookup.has(target.id)) {
        lookup.set(target.id, target);
      }
    });
  });

  return lookup;
}

function buildAlertLookup(snapshot: ObserverCommandCenterSnapshot) {
  const lookup = new Map<string, ProductionAlert>();
  const collections = [
    snapshot.alerts,
    snapshot.operatorDetails?.dismissedAlerts ?? [],
    snapshot.cameraAssistPayload?.activeAlerts ?? [],
  ];

  collections.forEach((collection) => {
    collection.forEach((alert) => {
      if (alert?.id && !lookup.has(alert.id)) {
        lookup.set(alert.id, alert);
      }
    });
  });

  return lookup;
}

function StatusChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  return (
    <div className={`command-center-chip command-center-chip--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warning" | "danger" | "success";
}) {
  return <span className={`command-center-badge command-center-badge--${tone}`}>{children}</span>;
}

function InlineAction({
  label,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "accent" | "danger";
}) {
  return (
    <button
      className={`command-center-action command-center-action--${tone}`}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {label}
    </button>
  );
}

export function ObserverCommandCenter() {
  const { snapshot, loading, error, busyActionPath, refresh, runAction } =
    useObserverCommandCenter();
  const mapKey = snapshot.mapKey ?? snapshot.telemetry.mapKey ?? null;
  const targetLookup = buildTargetLookup(snapshot);
  const alertLookup = buildAlertLookup(snapshot);
  const operatorState = snapshot.operatorState;
  const workflowState = snapshot.operatorWorkflowState;
  const actionStatusMs = snapshot.operatorWorkflowConfig?.operatorActionStatusMs ?? 3_800;
  const watchedTarget =
    snapshot.operatorDetails?.watchingNowTarget ??
    (operatorState?.watchingNowTargetId
      ? targetLookup.get(operatorState.watchingNowTargetId) ?? null
      : null);
  const selectedTarget = workflowState?.selectedTargetId
    ? targetLookup.get(workflowState.selectedTargetId) ?? null
    : null;
  const selectedAlert = workflowState?.selectedAlertId
    ? alertLookup.get(workflowState.selectedAlertId) ?? null
    : null;
  const recommendation = snapshot.recommendation;
  const recommendedTarget =
    recommendation?.recommendedTargetId
      ? targetLookup.get(recommendation.recommendedTargetId) ?? null
      : null;
  const selectedTargetReplay = selectedTarget
    ? snapshot.replayCandidates.some(
        (candidate) =>
          candidate.id === selectedTarget.id || candidate.sourceId === selectedTarget.id,
      )
    : false;
  const selectedTargetPinned = Boolean(
    selectedTarget &&
      (selectedTarget.operatorPinned ||
        snapshot.pinState?.pinnedTargetIds.includes(selectedTarget.id) ||
        operatorState?.primaryPinnedTargetIds.includes(selectedTarget.id)),
  );
  const selectedTargetSuppressed = Boolean(
    selectedTarget &&
      (selectedTarget.operatorSuppressed ||
        operatorState?.suppressedTargetIds.includes(selectedTarget.id)),
  );
  const selectedAlertReplay = selectedAlert
    ? snapshot.replayCandidates.some(
        (candidate) =>
          candidate.id === selectedAlert.id || candidate.sourceId === selectedAlert.id,
      )
    : false;
  const showRecentAction = Boolean(
    workflowState?.lastAction &&
      workflowState.updatedAt &&
      Date.now() - workflowState.updatedAt <= actionStatusMs,
  );

  const isBusy = (path: string | null) => Boolean(path && busyActionPath === path);
  const execute = async (path: string | null) => {
    if (!path) {
      return;
    }
    try {
      await runAction(path);
    } catch (_) {
      // Errors surface through the hook state.
    }
  };

  return (
    <section className="panel observer-command-center">
      <div className="panel-heading observer-command-center__heading">
        <div>
          <span className="panel-kicker">Observer Command Center</span>
          <h2>Live Production Console</h2>
        </div>
        <div className="observer-command-center__toolbar">
          {showRecentAction ? (
            <div className="observer-command-center__status">
              <span>Recent action</span>
              <strong>{workflowState?.lastAction}</strong>
            </div>
          ) : null}
          <button
            className="secondary-button observer-command-center__refresh"
            onClick={() => {
              void refresh().catch(() => undefined);
            }}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="status-card status-card--error observer-command-center__error">
          <strong>Command Center refresh failed</strong>
          <p>{error}</p>
        </div>
      ) : null}

      <div className="command-center-status-row">
        <StatusChip
          label="Telemetry"
          value={
            snapshot.telemetry.connected
              ? "Connected"
              : snapshot.telemetry.connectionStatus || "Offline"
          }
          tone={
            snapshot.telemetry.connected
              ? "success"
              : snapshot.telemetry.lastError
                ? "danger"
                : "warning"
          }
        />
        <StatusChip
          label="Widget Server"
          value={
            snapshot.widgetServer.running
              ? `Running${snapshot.widgetServer.port ? ` :${snapshot.widgetServer.port}` : ""}`
              : "Stopped"
          }
          tone={snapshot.widgetServer.running ? "success" : "danger"}
        />
        <StatusChip
          label="Current Map"
          value={snapshot.mapContext?.sourceMapName || snapshot.mapKey || "--"}
        />
        <StatusChip
          label="Players"
          value={snapshot.telemetry.playerCount ?? "--"}
          tone={snapshot.telemetry.playerCount ? "accent" : "neutral"}
        />
        <StatusChip label="Zone Phase" value={snapshot.telemetry.phase || "--"} />
        <StatusChip
          label="Last Telemetry"
          value={formatRelativeTime(snapshot.telemetry.lastUpdateAt)}
          tone={snapshot.telemetry.connected ? "success" : "warning"}
        />
        <StatusChip
          label="Last Broadcast"
          value={formatRelativeTime(snapshot.widgetServer.lastBroadcastAt)}
          tone={snapshot.widgetServer.lastBroadcastAt ? "success" : "warning"}
        />
      </div>

      <div className="command-center-grid">
        <section className="observer-command-panel observer-command-panel--focus">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Current Focus</span>
              <h3>Watching Now & Recommendation</h3>
            </div>
            {loading ? <Badge tone="warning">Loading</Badge> : <Badge tone="success">Live</Badge>}
          </div>

          <div className="command-center-focus-grid">
            <div className="command-center-focus-card">
              <span className="observer-command-label">Watching now</span>
              <strong>{watchedTarget?.label || operatorState?.watchingNowTargetId || "--"}</strong>
              <p>
                {watchedTarget
                  ? `${watchedTarget.category || "watch_target"} | ${formatScore(watchedTarget.score)} score`
                  : "No watched target selected."}
              </p>
              {watchedTarget?.reason?.length ? (
                <div className="command-center-reasons">
                  {watchedTarget.reason.slice(0, 3).map((reason) => (
                    <Badge key={reason}>{reason}</Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="command-center-focus-card">
              <span className="observer-command-label">Recommendation</span>
              <strong>
                {recommendation
                  ? `${recommendation.action.toUpperCase()}${recommendation.recommendedTargetId ? ` -> ${recommendedTarget?.label || recommendation.recommendedTargetId}` : ""}`
                  : "--"}
              </strong>
              <p>
                Confidence {formatConfidence(recommendation?.confidence)} | Delta{" "}
                {formatScore(recommendation?.scoreDelta ?? null)}
              </p>
              <div className="command-center-reasons">
                {recommendation?.reasons?.length ? (
                  recommendation.reasons.slice(0, 3).map((reason) => (
                    <Badge key={reason} tone="accent">
                      {reason}
                    </Badge>
                  ))
                ) : (
                  <Badge>No active recommendation</Badge>
                )}
              </div>
              <p className="observer-command-muted">
                Backup targets:{" "}
                {recommendation?.backupTargetIds?.length
                  ? recommendation.backupTargetIds
                      .map((id) => targetLookup.get(id)?.label || id)
                      .join(", ")
                  : "--"}
              </p>
            </div>
          </div>

          <div className="command-center-inline-actions">
            {(() => {
              const acceptPath =
                recommendation &&
                recommendation.action !== "stay" &&
                recommendation.recommendedTargetId
                  ? observerCommandRoutes.acceptRecommendation(mapKey)
                  : null;
              const recommendedId = recommendation?.recommendedTargetId ?? null;
              const centerPath = recommendedId
                ? observerCommandRoutes.centerTarget(recommendedId, mapKey)
                : null;
              const watchPath = recommendedId
                ? observerCommandRoutes.watchNow(recommendedId, mapKey)
                : null;
              const pinPath = recommendedId
                ? observerCommandRoutes.pinTarget(recommendedId, mapKey)
                : null;
              const replayPath = recommendedId
                ? observerCommandRoutes.markReplay(recommendedId, mapKey)
                : null;

              return (
                <>
                  <InlineAction
                    label="Accept Recommendation"
                    tone="accent"
                    onClick={() => {
                      void execute(acceptPath);
                    }}
                    disabled={!acceptPath || isBusy(acceptPath)}
                  />
                  <InlineAction
                    label="Center Recommended"
                    onClick={() => {
                      void execute(centerPath);
                    }}
                    disabled={!centerPath || isBusy(centerPath)}
                  />
                  <InlineAction
                    label="Watch Recommended"
                    onClick={() => {
                      void execute(watchPath);
                    }}
                    disabled={!watchPath || isBusy(watchPath)}
                  />
                  <InlineAction
                    label="Pin Recommended"
                    onClick={() => {
                      void execute(pinPath);
                    }}
                    disabled={!pinPath || isBusy(pinPath)}
                  />
                  <InlineAction
                    label="Mark Recommended Replay"
                    onClick={() => {
                      void execute(replayPath);
                    }}
                    disabled={!replayPath || isBusy(replayPath)}
                  />
                </>
              );
            })()}
          </div>
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Watch Queue</span>
              <h3>Top Targets</h3>
            </div>
            <Badge tone="accent">{snapshot.watchTargets.length} live</Badge>
          </div>

          {snapshot.watchTargets.length ? (
            <div className="command-center-list">
              {snapshot.watchTargets.map((target, index) => {
                const selectPath = observerCommandRoutes.selectTarget(target.id, mapKey);
                const watchPath = observerCommandRoutes.watchNow(target.id, mapKey);
                const pinPath = target.operatorPinned
                  ? observerCommandRoutes.unpinTarget(target.id, mapKey)
                  : observerCommandRoutes.pinTarget(target.id, mapKey);
                const replayPath = target.operatorReplayCandidate
                  ? observerCommandRoutes.removeReplay(target.id, mapKey)
                  : observerCommandRoutes.markReplay(target.id, mapKey);
                const suppressPath = target.operatorSuppressed
                  ? observerCommandRoutes.unsuppressTarget(target.id, mapKey)
                  : observerCommandRoutes.suppressTarget(target.id, mapKey);
                const centerPath = observerCommandRoutes.centerTarget(target.id, mapKey);
                const isSelected = workflowState?.selectedTargetId === target.id;

                return (
                  <article
                    key={target.id}
                    className={`command-center-item${isSelected ? " command-center-item--selected" : ""}`}
                  >
                    <div className="command-center-item__header">
                      <div>
                        <strong>
                          #{index + 1} {target.label}
                        </strong>
                        <p>
                          {target.category || "watch_target"} | {formatScore(target.score)} score |{" "}
                          {target.involvedTeamIds.join(", ") || "--"}
                        </p>
                      </div>
                      <div className="command-center-badges">
                        {target.operatorWatchingNow ? <Badge tone="success">Watched</Badge> : null}
                        {target.operatorPinned ? <Badge tone="accent">Pinned</Badge> : null}
                        {target.operatorSuppressed ? <Badge tone="warning">Suppressed</Badge> : null}
                        {target.operatorReplayCandidate ? <Badge tone="danger">Replay</Badge> : null}
                      </div>
                    </div>
                    <p className="observer-command-muted">
                      {target.reason.slice(0, 3).join(" | ") || "No scoring reasons."}
                    </p>
                    <div className="command-center-item__actions">
                      <InlineAction label="Select" onClick={() => void execute(selectPath)} disabled={isBusy(selectPath)} />
                      <InlineAction label="Watch" tone="accent" onClick={() => void execute(watchPath)} disabled={isBusy(watchPath)} />
                      <InlineAction
                        label={target.operatorPinned ? "Unpin" : "Pin"}
                        onClick={() => void execute(pinPath)}
                        disabled={isBusy(pinPath)}
                      />
                      <InlineAction
                        label={target.operatorReplayCandidate ? "Remove Replay" : "Replay"}
                        onClick={() => void execute(replayPath)}
                        disabled={isBusy(replayPath)}
                      />
                      <InlineAction
                        label={target.operatorSuppressed ? "Unsuppress" : "Suppress"}
                        onClick={() => void execute(suppressPath)}
                        disabled={isBusy(suppressPath)}
                      />
                      <InlineAction label="Center" onClick={() => void execute(centerPath)} disabled={isBusy(centerPath)} />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">Watch targets will appear here when telemetry is live.</div>
          )}
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Alerts</span>
              <h3>Active Alerts</h3>
            </div>
            <Badge tone={snapshot.alerts.length ? "warning" : "neutral"}>
              {snapshot.alerts.length} active
            </Badge>
          </div>

          {snapshot.alerts.length ? (
            <div className="command-center-list">
              {snapshot.alerts.map((alert) => {
                const selectPath = observerCommandRoutes.selectAlert(alert.id, mapKey);
                const dismissPath = observerCommandRoutes.dismissAlert(alert.id, mapKey);
                const replayPath = alert.operatorReplayCandidate
                  ? observerCommandRoutes.removeReplay(alert.id, mapKey)
                  : observerCommandRoutes.markReplay(alert.id, mapKey);
                const centerPath = hasCoordinates(alert)
                  ? observerCommandRoutes.centerAlert(alert.id, mapKey)
                  : null;
                const isSelected = workflowState?.selectedAlertId === alert.id;

                return (
                  <article
                    key={alert.id}
                    className={`command-center-item${isSelected ? " command-center-item--selected" : ""}`}
                  >
                    <div className="command-center-item__header">
                      <div>
                        <strong>{alert.label}</strong>
                        <p>
                          {alert.type} | {alert.severity} | {alert.involvedTeamIds.join(", ") || "--"}
                        </p>
                      </div>
                      <div className="command-center-badges">
                        <Badge
                          tone={
                            alert.severity === "critical"
                              ? "danger"
                              : alert.severity === "warning"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {alert.severity}
                        </Badge>
                        {alert.operatorReplayCandidate ? <Badge tone="accent">Replay</Badge> : null}
                      </div>
                    </div>
                    <p className="observer-command-muted">
                      Raised {formatRelativeTime(alert.createdAt)} | Expires in{" "}
                      {formatCountdown(alert.expiresAt)}
                    </p>
                    <div className="command-center-item__actions">
                      <InlineAction label="Select" onClick={() => void execute(selectPath)} disabled={isBusy(selectPath)} />
                      <InlineAction label="Dismiss" tone="danger" onClick={() => void execute(dismissPath)} disabled={isBusy(dismissPath)} />
                      <InlineAction
                        label={alert.operatorReplayCandidate ? "Remove Replay" : "Mark Replay"}
                        onClick={() => void execute(replayPath)}
                        disabled={isBusy(replayPath)}
                      />
                      <InlineAction
                        label="Center"
                        onClick={() => void execute(centerPath)}
                        disabled={!centerPath || isBusy(centerPath)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">No active production alerts.</div>
          )}
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Replay Queue</span>
              <h3>Replay Candidates</h3>
            </div>
            <Badge tone="accent">{snapshot.replayCandidates.length} queued</Badge>
          </div>

          {snapshot.replayCandidates.length ? (
            <div className="command-center-list">
              {snapshot.replayCandidates.map((candidate) => {
                const removePath = observerCommandRoutes.removeReplay(candidate.id, mapKey);
                const centerPath = hasCoordinates(candidate)
                  ? observerCommandRoutes.centerReplay(candidate.id, mapKey)
                  : null;
                const promoteTarget = targetLookup.get(candidate.sourceId) ?? null;
                const watchPath = promoteTarget
                  ? observerCommandRoutes.watchNow(promoteTarget.id, mapKey)
                  : null;

                return (
                  <article key={candidate.id} className="command-center-item">
                    <div className="command-center-item__header">
                      <div>
                        <strong>{candidate.label}</strong>
                        <p>
                          {candidate.sourceType} | {candidate.involvedTeamIds.join(", ") || "--"}
                        </p>
                      </div>
                      <div className="command-center-badges">
                        <Badge tone="danger">Replay</Badge>
                      </div>
                    </div>
                    <p className="observer-command-muted">
                      Added {formatRelativeTime(candidate.createdAt)} | Expires in{" "}
                      {formatCountdown(candidate.expiresAt)}
                    </p>
                    <div className="command-center-item__actions">
                      <InlineAction label="Remove" tone="danger" onClick={() => void execute(removePath)} disabled={isBusy(removePath)} />
                      <InlineAction
                        label="Center"
                        onClick={() => void execute(centerPath)}
                        disabled={!centerPath || isBusy(centerPath)}
                      />
                      <InlineAction
                        label="Promote to Watch"
                        tone="accent"
                        onClick={() => void execute(watchPath)}
                        disabled={!watchPath || isBusy(watchPath)}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">Replay-ready moments will accumulate here.</div>
          )}
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Pins & Suppressions</span>
              <h3>Operator Overrides</h3>
            </div>
            <Badge>
              {(snapshot.pinState?.pinnedTeams.length || 0) +
                (snapshot.pinState?.pinnedTargets.length || 0)}{" "}
              pins
            </Badge>
          </div>

          <div className="command-center-stack">
            <div className="command-center-subsection">
              <span className="observer-command-label">Pinned teams</span>
              {(snapshot.pinState?.pinnedTeams.length ?? 0) ? (
                <div className="command-center-token-list">
                  {snapshot.pinState?.pinnedTeams.map((teamId) => {
                    const path = observerCommandRoutes.unpinTeam(teamId, mapKey);
                    return (
                      <div key={teamId} className="command-center-token">
                        <strong>{teamId}</strong>
                        <InlineAction label="Unpin" onClick={() => void execute(path)} disabled={isBusy(path)} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="observer-command-muted">No pinned teams.</p>
              )}
            </div>

            <div className="command-center-subsection">
              <span className="observer-command-label">Pinned targets</span>
              {(snapshot.pinState?.pinnedTargets.length ?? 0) ? (
                <div className="command-center-token-list">
                  {snapshot.pinState?.pinnedTargets.map((target) => {
                    const path = observerCommandRoutes.unpinTarget(target.id, mapKey);
                    return (
                      <div key={target.id} className="command-center-token">
                        <strong>{target.label}</strong>
                        <InlineAction label="Unpin" onClick={() => void execute(path)} disabled={isBusy(path)} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="observer-command-muted">No pinned targets.</p>
              )}
            </div>

            <div className="command-center-subsection">
              <span className="observer-command-label">Suppressed targets</span>
              {(snapshot.operatorDetails?.suppressedTargets.length ?? 0) ? (
                <div className="command-center-token-list">
                  {snapshot.operatorDetails?.suppressedTargets.map((target) => {
                    const path = observerCommandRoutes.unsuppressTarget(target.id, mapKey);
                    return (
                      <div key={target.id} className="command-center-token">
                        <strong>{target.label}</strong>
                        <InlineAction
                          label="Unsuppress"
                          onClick={() => void execute(path)}
                          disabled={isBusy(path)}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="observer-command-muted">No suppressed targets.</p>
              )}
            </div>

            <div className="command-center-subsection">
              <span className="observer-command-label">Dismissed alerts</span>
              {(snapshot.operatorDetails?.dismissedAlerts.length ?? 0) ? (
                <div className="command-center-token-list">
                  {snapshot.operatorDetails?.dismissedAlerts.map((alert) => {
                    const path = observerCommandRoutes.undismissAlert(alert.id, mapKey);
                    return (
                      <div key={alert.id} className="command-center-token">
                        <strong>{alert.label}</strong>
                        <InlineAction label="Restore" onClick={() => void execute(path)} disabled={isBusy(path)} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="observer-command-muted">No dismissed alerts.</p>
              )}
            </div>
          </div>
        </section>

        <section className="observer-command-panel">
          <div className="observer-command-panel__heading">
            <div>
              <span className="observer-command-panel__kicker">Workflow Status</span>
              <h3>Selection & Quick Actions</h3>
            </div>
            <Badge tone={workflowState?.mapFocusUntil ? "accent" : "neutral"}>
              {workflowState?.mapFocusUntil ? "Focus active" : "Idle"}
            </Badge>
          </div>

          <div className="command-center-stack">
            <div className="command-center-focus-summary">
              <span className="observer-command-label">Selected target</span>
              <strong>{selectedTarget?.label || workflowState?.selectedTargetId || "--"}</strong>
              <div className="command-center-badges">
                {selectedTargetPinned ? <Badge tone="accent">Pinned</Badge> : null}
                {selectedTargetSuppressed ? <Badge tone="warning">Suppressed</Badge> : null}
                {selectedTargetReplay ? <Badge tone="danger">Replay</Badge> : null}
              </div>
            </div>

            <div className="command-center-inline-actions">
              {selectedTarget ? (
                <>
                  <InlineAction
                    label="Watch"
                    tone="accent"
                    onClick={() => void execute(observerCommandRoutes.watchNow(selectedTarget.id, mapKey))}
                  />
                  <InlineAction
                    label={selectedTargetPinned ? "Unpin" : "Pin"}
                    onClick={() =>
                      void execute(
                        selectedTargetPinned
                          ? observerCommandRoutes.unpinTarget(selectedTarget.id, mapKey)
                          : observerCommandRoutes.pinTarget(selectedTarget.id, mapKey),
                      )
                    }
                  />
                  <InlineAction
                    label={selectedTargetReplay ? "Remove Replay" : "Replay"}
                    onClick={() =>
                      void execute(
                        selectedTargetReplay
                          ? observerCommandRoutes.removeReplay(selectedTarget.id, mapKey)
                          : observerCommandRoutes.markReplay(selectedTarget.id, mapKey),
                      )
                    }
                  />
                  <InlineAction
                    label={selectedTargetSuppressed ? "Unsuppress" : "Suppress"}
                    onClick={() =>
                      void execute(
                        selectedTargetSuppressed
                          ? observerCommandRoutes.unsuppressTarget(selectedTarget.id, mapKey)
                          : observerCommandRoutes.suppressTarget(selectedTarget.id, mapKey),
                      )
                    }
                  />
                  <InlineAction
                    label="Center"
                    onClick={() => void execute(observerCommandRoutes.centerTarget(selectedTarget.id, mapKey))}
                  />
                </>
              ) : (
                <p className="observer-command-muted">Select a watch target to arm quick actions.</p>
              )}
            </div>

            <div className="command-center-focus-summary">
              <span className="observer-command-label">Selected alert</span>
              <strong>{selectedAlert?.label || workflowState?.selectedAlertId || "--"}</strong>
              <div className="command-center-badges">
                {selectedAlertReplay ? <Badge tone="danger">Replay</Badge> : null}
              </div>
            </div>

            <div className="command-center-inline-actions">
              {selectedAlert ? (
                <>
                  <InlineAction
                    label="Dismiss"
                    tone="danger"
                    onClick={() => void execute(observerCommandRoutes.dismissAlert(selectedAlert.id, mapKey))}
                  />
                  <InlineAction
                    label={selectedAlertReplay ? "Remove Replay" : "Mark Replay"}
                    onClick={() =>
                      void execute(
                        selectedAlertReplay
                          ? observerCommandRoutes.removeReplay(selectedAlert.id, mapKey)
                          : observerCommandRoutes.markReplay(selectedAlert.id, mapKey),
                      )
                    }
                  />
                  <InlineAction
                    label="Center"
                    onClick={() => void execute(observerCommandRoutes.centerAlert(selectedAlert.id, mapKey))}
                    disabled={!hasCoordinates(selectedAlert)}
                  />
                </>
              ) : (
                <p className="observer-command-muted">Select an alert to act on it directly.</p>
              )}
            </div>

            <div className="command-center-metadata">
              <div>
                <span>Highlighted target</span>
                <strong>{workflowState?.highlightedTargetId || "--"}</strong>
              </div>
              <div>
                <span>Map focus</span>
                <strong>
                  {workflowState?.mapFocusCenter
                    ? `${Math.round(workflowState.mapFocusCenter.x)}, ${Math.round(
                        workflowState.mapFocusCenter.y,
                      )}`
                    : "--"}
                </strong>
              </div>
              <div>
                <span>Focus expires</span>
                <strong>{formatCountdown(workflowState?.mapFocusUntil)}</strong>
              </div>
              <div>
                <span>Last action</span>
                <strong>{workflowState?.lastAction || "--"}</strong>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
```

## apps/desktop/src/styles.css

`$ext
:root {
  color-scheme: dark;
  font-family: "Bahnschrift", "Aptos", "Segoe UI Variable", sans-serif;
  --bg: #061118;
  --panel: rgba(8, 18, 27, 0.82);
  --line: rgba(137, 183, 214, 0.18);
  --text: #eef7ff;
  --muted: #98acc0;
  --accent: #71f0d4;
  --danger: #ff7a70;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-height: 100%;
}

body {
  margin: 0;
  background:
    radial-gradient(circle at top left, rgba(67, 146, 211, 0.18), transparent 34%),
    radial-gradient(circle at 85% 14%, rgba(113, 240, 212, 0.12), transparent 22%),
    linear-gradient(135deg, #061118 0%, #081a24 40%, #050c12 100%);
  color: var(--text);
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.8), transparent 90%);
}

code {
  font-family: "Cascadia Code", "Consolas", monospace;
}

.app-shell {
  width: min(1380px, calc(100vw - 40px));
  margin: 0 auto;
  padding: 28px 0 36px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.login-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

.login-card,
.access-card,
.hero-card,
.panel,
.actions-panel {
  border: 1px solid var(--line);
  background: var(--panel);
  backdrop-filter: blur(18px);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}

.login-card {
  width: min(760px, 100%);
  border-radius: 28px;
  padding: 30px;
  display: grid;
  gap: 24px;
  background:
    linear-gradient(135deg, rgba(10, 29, 44, 0.95), rgba(8, 17, 28, 0.92)),
    radial-gradient(circle at top right, rgba(113, 240, 212, 0.08), transparent 30%);
}

.access-card {
  width: min(920px, 100%);
  border-radius: 28px;
  padding: 30px;
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 22px;
  background:
    linear-gradient(135deg, rgba(10, 29, 44, 0.95), rgba(8, 17, 28, 0.92)),
    radial-gradient(circle at top right, rgba(255, 122, 112, 0.08), transparent 30%);
}

.login-copy h1,
.access-copy h1,
.hero-copy h1 {
  margin: 12px 0 10px;
  font-size: clamp(2.2rem, 4vw, 3.4rem);
  line-height: 0.96;
  letter-spacing: -0.04em;
}

.login-copy p,
.access-copy p,
.hero-copy p {
  margin: 0;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.6;
}

.login-form {
  display: grid;
  gap: 14px;
}

.access-meta {
  display: grid;
  gap: 12px;
}

.access-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

.hero-card {
  border-radius: 28px;
  padding: 28px;
  display: grid;
  grid-template-columns: 1.35fr 0.95fr;
  gap: 22px;
  background:
    linear-gradient(135deg, rgba(10, 29, 44, 0.95), rgba(8, 17, 28, 0.92)),
    radial-gradient(circle at top right, rgba(113, 240, 212, 0.08), transparent 30%);
}

.hero-actions {
  margin-top: 18px;
}

.eyebrow,
.panel-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
  color: var(--accent);
}

.eyebrow::before,
.panel-kicker::before {
  content: "";
  width: 18px;
  height: 1px;
  background: currentColor;
}

.hero-meta {
  display: grid;
  gap: 12px;
}

.meta-pill {
  padding: 14px 16px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(14, 31, 46, 0.82), rgba(10, 20, 29, 0.9));
  border: 1px solid rgba(140, 191, 226, 0.16);
}

.meta-pill span {
  display: block;
  font-size: 0.72rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-bottom: 6px;
}

.meta-pill strong {
  display: block;
  font-size: 0.96rem;
  line-height: 1.35;
  word-break: break-word;
}

.layout-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.panel {
  border-radius: 22px;
  padding: 22px;
}

.panel-heading {
  margin-bottom: 18px;
}

.panel-heading h2 {
  margin: 10px 0 0;
  font-size: 1.25rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field span {
  color: var(--muted);
  font-size: 0.86rem;
}

.field input,
.field select {
  width: 100%;
  border: 1px solid rgba(150, 193, 220, 0.16);
  background: rgba(3, 12, 19, 0.72);
  color: var(--text);
  border-radius: 14px;
  padding: 13px 14px;
  font: inherit;
  outline: none;
  transition: border-color 140ms ease, transform 140ms ease;
}

.field input:focus,
.field select:focus {
  border-color: rgba(113, 240, 212, 0.52);
  transform: translateY(-1px);
}

.input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.primary-button,
.secondary-button {
  border-radius: 14px;
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border: 0;
  background: linear-gradient(140deg, #79f2cb, #27c6a5);
  color: #041118;
  padding: 14px 18px;
  font-weight: 700;
}

.secondary-button {
  border: 1px solid rgba(147, 191, 220, 0.18);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
  padding: 0 16px;
}

.primary-button:hover:not(:disabled),
.secondary-button:hover:not(:disabled) {
  filter: brightness(1.04);
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.path-card,
.status-card {
  border-radius: 18px;
  padding: 14px 16px;
  background: rgba(4, 12, 18, 0.7);
  border: 1px solid rgba(149, 191, 220, 0.12);
}

.path-card + .path-card,
.status-card + .status-card {
  margin-top: 10px;
}

.path-label {
  display: block;
  color: var(--muted);
  font-size: 0.78rem;
  margin-bottom: 8px;
}

.path-card code,
.status-card p,
.empty-state code,
.color-chip-row code,
.logo-path {
  word-break: break-word;
}

.license-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.license-stat {
  border-radius: 14px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(149, 191, 220, 0.12);
}

.license-stat span {
  display: block;
  color: var(--muted);
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

.license-stat strong {
  display: block;
  word-break: break-word;
}

.status-card strong {
  display: block;
  margin-bottom: 6px;
}

.status-card p {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}

.status-card--success {
  border-color: rgba(113, 240, 212, 0.36);
  background: rgba(12, 40, 38, 0.52);
}

.status-card--error {
  border-color: rgba(255, 122, 112, 0.34);
  background: rgba(50, 17, 22, 0.58);
}

.status-card--neutral {
  border-color: rgba(149, 191, 220, 0.16);
}

.actions-panel {
  border-radius: 24px;
  padding: 18px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.action-button {
  border: 0;
  border-radius: 20px;
  padding: 18px;
  color: #041118;
  cursor: pointer;
  min-height: 136px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  text-align: left;
  font: inherit;
  transition: transform 160ms ease, filter 160ms ease;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.action-button:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.03);
}

.action-button:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}

.action-button span {
  display: block;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.25;
}

.action-button small {
  display: block;
  color: rgba(4, 17, 24, 0.72);
  line-height: 1.4;
  font-size: 0.88rem;
}

.action-button--sync {
  background: linear-gradient(140deg, #79f2cb, #27c6a5);
}

.action-button--branding {
  background: linear-gradient(140deg, #f7d56d, #ee9b41);
}

.action-button--launch {
  background: linear-gradient(140deg, #90d9ff, #3aa3ee);
}

.action-button--bridge {
  background: linear-gradient(140deg, #f2a978, #ea6f54);
}

.observer-command-center {
  padding: 24px;
  background:
    linear-gradient(160deg, rgba(8, 20, 30, 0.96), rgba(7, 15, 22, 0.92)),
    radial-gradient(circle at top right, rgba(113, 240, 212, 0.08), transparent 28%);
}

.observer-command-center__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.observer-command-center__toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.observer-command-center__status {
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(113, 240, 212, 0.22);
  background: rgba(9, 31, 33, 0.56);
}

.observer-command-center__status span,
.observer-command-label,
.observer-command-panel__kicker,
.command-center-chip span,
.command-center-metadata span {
  display: block;
  color: var(--muted);
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.observer-command-center__status strong {
  display: block;
  margin-top: 4px;
}

.observer-command-center__refresh {
  min-height: 40px;
}

.observer-command-center__error {
  margin-bottom: 16px;
}

.command-center-status-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.command-center-chip {
  border-radius: 18px;
  padding: 14px 16px;
  border: 1px solid rgba(149, 191, 220, 0.14);
  background: rgba(4, 12, 18, 0.74);
}

.command-center-chip strong {
  display: block;
  margin-top: 8px;
  font-size: 0.96rem;
  line-height: 1.3;
}

.command-center-chip--success {
  border-color: rgba(113, 240, 212, 0.28);
  background: rgba(9, 33, 34, 0.66);
}

.command-center-chip--warning {
  border-color: rgba(247, 213, 109, 0.26);
  background: rgba(38, 28, 14, 0.58);
}

.command-center-chip--danger {
  border-color: rgba(255, 122, 112, 0.28);
  background: rgba(43, 17, 21, 0.58);
}

.command-center-chip--accent {
  border-color: rgba(144, 217, 255, 0.28);
  background: rgba(12, 25, 38, 0.62);
}

.command-center-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.observer-command-panel {
  border-radius: 20px;
  padding: 18px;
  border: 1px solid rgba(149, 191, 220, 0.12);
  background: rgba(5, 13, 19, 0.72);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.observer-command-panel--focus {
  grid-column: 1 / -1;
}

.observer-command-panel__heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.observer-command-panel__heading h3 {
  margin: 8px 0 0;
  font-size: 1.05rem;
}

.command-center-focus-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.command-center-focus-card,
.command-center-focus-summary,
.command-center-subsection,
.command-center-metadata > div,
.command-center-token,
.command-center-item {
  border-radius: 16px;
  border: 1px solid rgba(149, 191, 220, 0.12);
  background: rgba(7, 17, 24, 0.82);
}

.command-center-focus-card,
.command-center-focus-summary,
.command-center-subsection {
  padding: 14px;
}

.command-center-focus-card strong,
.command-center-focus-summary strong,
.command-center-token strong,
.command-center-item strong {
  display: block;
  margin-top: 6px;
  font-size: 0.98rem;
  line-height: 1.35;
}

.command-center-focus-card p,
.command-center-item__header p,
.observer-command-muted {
  margin: 8px 0 0;
  color: var(--muted);
  line-height: 1.5;
}

.command-center-reasons,
.command-center-badges,
.command-center-inline-actions,
.command-center-item__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.command-center-reasons,
.command-center-item__actions {
  margin-top: 10px;
}

.command-center-badges {
  justify-content: flex-end;
}

.command-center-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(149, 191, 220, 0.14);
  background: rgba(255, 255, 255, 0.04);
  font-size: 0.74rem;
  color: var(--text);
}

.command-center-badge--accent {
  border-color: rgba(113, 240, 212, 0.26);
  background: rgba(14, 46, 41, 0.6);
}

.command-center-badge--warning {
  border-color: rgba(247, 213, 109, 0.24);
  background: rgba(56, 40, 14, 0.54);
}

.command-center-badge--danger {
  border-color: rgba(255, 122, 112, 0.26);
  background: rgba(63, 20, 24, 0.58);
}

.command-center-badge--success {
  border-color: rgba(113, 240, 212, 0.24);
  background: rgba(11, 39, 38, 0.58);
}

.command-center-list,
.command-center-stack,
.command-center-token-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.command-center-item {
  padding: 14px;
}

.command-center-item--selected {
  border-color: rgba(113, 240, 212, 0.38);
  box-shadow: inset 0 0 0 1px rgba(113, 240, 212, 0.16);
}

.command-center-item__header,
.command-center-token {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.command-center-action {
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(149, 191, 220, 0.16);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
  cursor: pointer;
  font: inherit;
}

.command-center-action--accent {
  border-color: rgba(113, 240, 212, 0.24);
  background: rgba(14, 46, 41, 0.6);
}

.command-center-action--danger {
  border-color: rgba(255, 122, 112, 0.24);
  background: rgba(63, 20, 24, 0.58);
}

.command-center-action:hover:not(:disabled) {
  filter: brightness(1.05);
}

.command-center-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.command-center-metadata {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.command-center-metadata > div {
  padding: 12px;
}

.command-center-metadata strong {
  display: block;
  margin-top: 6px;
  line-height: 1.35;
}

.table-panel {
  padding-bottom: 10px;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 920px;
}

th,
td {
  padding: 14px 12px;
  border-top: 1px solid rgba(149, 191, 220, 0.12);
  text-align: left;
  vertical-align: top;
}

th {
  color: var(--muted);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

tbody tr:hover {
  background: rgba(255, 255, 255, 0.02);
}

.team-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.team-cell span {
  color: var(--muted);
  font-size: 0.8rem;
}

.color-chip-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.color-chip {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.04);
}

.empty-state {
  padding: 18px 4px 6px;
  color: var(--muted);
  line-height: 1.6;
}

@media (max-width: 1180px) {
  .actions-panel {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .command-center-status-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .app-shell {
    width: min(100vw - 24px, 1380px);
    padding-top: 12px;
  }

  .hero-card,
  .layout-grid,
  .actions-panel {
    grid-template-columns: 1fr;
  }

  .hero-card,
  .panel,
  .actions-panel,
  .login-card,
  .access-card {
    border-radius: 20px;
  }

  .access-card {
    grid-template-columns: 1fr;
  }

  .input-row {
    grid-template-columns: 1fr;
  }

  .command-center-grid,
  .command-center-focus-grid,
  .command-center-metadata {
    grid-template-columns: 1fr;
  }

  .command-center-status-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .observer-command-center__heading,
  .observer-command-panel__heading,
  .command-center-item__header,
  .command-center-token {
    flex-direction: column;
    align-items: flex-start;
  }

  .command-center-badges {
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .command-center-status-row {
    grid-template-columns: 1fr;
  }
}
```

