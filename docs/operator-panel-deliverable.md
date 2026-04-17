# Operator Panel Deliverable

## Changed Files
- `apps/desktop/electron/map-engine/operator-action-store.cjs`
- `apps/desktop/electron/map-engine/replay-candidate-store.cjs`
- `apps/desktop/electron/map-engine/observer-assist-config.cjs`
- `apps/desktop/electron/map-engine/observer-control-bridge.cjs`
- `apps/desktop/electron/map-engine/production-support-engine.cjs`
- `apps/desktop/electron/map-engine/map-widget-engine.cjs`
- `apps/desktop/electron/widget-server/server.cjs`
- `apps/desktop/electron/widget-server/routes/obs-map-route.cjs`
- `apps/desktop/electron/widget-server/public/obs-map-widget.css`
- `apps/desktop/electron/widget-server/public/obs-map-widget.js`

## Example URLs
- Operator panel: `http://localhost:5510/obs/map?operatorpanel=1`
- Full operator mode: `http://localhost:5510/obs/map?operatorpanel=1&assistpanel=1&debug=1`
- Watch now: `http://localhost:5510/debug/operator/watch-now?id=target-alpha`
- Pin target: `http://localhost:5510/debug/operator/pin-target?id=target-alpha`
- Unpin target: `http://localhost:5510/debug/operator/unpin-target?id=target-alpha`
- Mark replay: `http://localhost:5510/debug/operator/mark-replay?id=target-alpha`
- Unmark replay: `http://localhost:5510/debug/operator/unmark-replay?id=target-alpha`
- Suppress target: `http://localhost:5510/debug/operator/suppress-target?id=target-alpha`
- Unsuppress target: `http://localhost:5510/debug/operator/unsuppress-target?id=target-alpha`
- Dismiss alert: `http://localhost:5510/debug/operator/dismiss-alert?id=alert:123`
- Undo dismiss alert: `http://localhost:5510/debug/operator/undismiss-alert?id=alert:123`

## Brief Notes
- Operator state lives in memory in the desktop map engine, mirrors pin state, tracks watching-now, suppressions, dismissals, and replay IDs, and is surfaced as both `operatorState` and `observerOperatorSuggestion`.
- Suppression is cooldown-based via `TARGET_SUPPRESSION_MS`; suppressed targets are not deleted, and pinned/currently watched targets can remain visible while the suppression timer is active.
- Replay candidates are bounded by `MAX_REPLAY_CANDIDATES`, auto-expire via `REPLAY_CANDIDATE_TTL_MS`, and are refreshed in priority/recency order from target or alert actions.

## File: `apps/desktop/electron/map-engine/operator-action-store.cjs`

`$extension
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

function cloneWatchingTarget(target) {
  if (!target) {
    return null;
  }

  return {
    id: target.id,
    label: target.label,
    centerX: target.centerX,
    centerY: target.centerY,
    involvedTeamIds: [...target.involvedTeamIds],
    updatedAt: target.updatedAt,
    setAt: target.setAt,
  };
}

function cloneSuppression(entry) {
  return {
    id: entry.id,
    label: entry.label,
    centerX: entry.centerX,
    centerY: entry.centerY,
    involvedTeamIds: [...entry.involvedTeamIds],
    suppressedAt: entry.suppressedAt,
    expiresAt: entry.expiresAt,
  };
}

function cloneDismissal(entry) {
  return {
    id: entry.id,
    label: entry.label,
    centerX: entry.centerX,
    centerY: entry.centerY,
    involvedTeamIds: [...entry.involvedTeamIds],
    dismissedAt: entry.dismissedAt,
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
    setAt: Number.isFinite(source.setAt) ? source.setAt : now,
  };
}

function normalizeSuppressionTarget(target, expiresAt, now) {
  const normalized = normalizeTargetReference(target, target, now);
  if (!normalized) {
    return null;
  }

  return {
    id: normalized.id,
    label: normalized.label,
    centerX: normalized.centerX,
    centerY: normalized.centerY,
    involvedTeamIds: normalized.involvedTeamIds,
    suppressedAt: now,
    expiresAt,
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
    dismissedAt: Number.isFinite(source.dismissedAt) ? source.dismissedAt : now,
  };
}

function syncSet(targetSet, nextValues) {
  const normalizedValues = normalizeTeamIds(Array.isArray(nextValues) ? nextValues : []);
  let didChange = targetSet.size !== normalizedValues.length;

  if (!didChange) {
    for (const value of normalizedValues) {
      if (!targetSet.has(value)) {
        didChange = true;
        break;
      }
    }
  }

  if (!didChange) {
    return false;
  }

  targetSet.clear();
  for (const value of normalizedValues) {
    targetSet.add(value);
  }

  return true;
}

function syncStringSet(targetSet, nextValues) {
  const normalizedValues = Array.from(
    new Set((Array.isArray(nextValues) ? nextValues : []).map(normalizeId).filter(Boolean)),
  ).sort(compareIds);
  let didChange = targetSet.size !== normalizedValues.length;

  if (!didChange) {
    for (const value of normalizedValues) {
      if (!targetSet.has(value)) {
        didChange = true;
        break;
      }
    }
  }

  if (!didChange) {
    return false;
  }

  targetSet.clear();
  for (const value of normalizedValues) {
    targetSet.add(value);
  }

  return true;
}

function createOperatorActionStore() {
  let watchingNowTarget = null;
  let updatedAt = Date.now();
  const primaryPinnedTeamIds = new Set();
  const primaryPinnedTargetIds = new Set();
  const replayCandidateIds = new Set();
  const dismissedAlertsById = new Map();
  const suppressedTargetsById = new Map();

  function touch(now = Date.now()) {
    updatedAt = now;
  }

  function purgeSuppressedTargets(now = Date.now()) {
    let didChange = false;

    for (const [id, entry] of suppressedTargetsById.entries()) {
      if (Number.isFinite(entry.expiresAt) && entry.expiresAt <= now) {
        suppressedTargetsById.delete(id);
        didChange = true;
      }
    }

    if (didChange) {
      touch(now);
    }

    return didChange;
  }

  function boundDismissals(maxEntries, now) {
    if (!(maxEntries > 0) || dismissedAlertsById.size <= maxEntries) {
      return false;
    }

    const staleEntries = Array.from(dismissedAlertsById.values()).sort(
      (left, right) => left.dismissedAt - right.dismissedAt,
    );

    let didChange = false;
    while (staleEntries.length > maxEntries) {
      const entry = staleEntries.shift();
      if (entry && dismissedAlertsById.delete(entry.id)) {
        didChange = true;
      }
    }

    if (didChange) {
      touch(now);
    }

    return didChange;
  }

  function boundSuppressions(maxEntries, now) {
    if (!(maxEntries > 0) || suppressedTargetsById.size <= maxEntries) {
      return false;
    }

    const staleEntries = Array.from(suppressedTargetsById.values()).sort(
      (left, right) => left.expiresAt - right.expiresAt,
    );

    let didChange = false;
    while (staleEntries.length > maxEntries) {
      const entry = staleEntries.shift();
      if (entry && suppressedTargetsById.delete(entry.id)) {
        didChange = true;
      }
    }

    if (didChange) {
      touch(now);
    }

    return didChange;
  }

  function watchNow(target, now = Date.now()) {
    const normalized = normalizeTargetReference(target, target, now);
    if (!normalized) {
      return false;
    }

    watchingNowTarget = {
      ...normalized,
      setAt: now,
    };
    touch(now);
    return true;
  }

  function pinTeam(teamId, now = Date.now()) {
    const normalized = normalizeId(teamId);
    if (!normalized || primaryPinnedTeamIds.has(normalized)) {
      return false;
    }

    primaryPinnedTeamIds.add(normalized);
    touch(now);
    return true;
  }

  function unpinTeam(teamId, now = Date.now()) {
    const normalized = normalizeId(teamId);
    if (!normalized || !primaryPinnedTeamIds.delete(normalized)) {
      return false;
    }

    touch(now);
    return true;
  }

  function pinTarget(target, now = Date.now()) {
    const normalized = normalizeTargetReference(target, target, now);
    if (!normalized || primaryPinnedTargetIds.has(normalized.id)) {
      return false;
    }

    primaryPinnedTargetIds.add(normalized.id);
    touch(now);
    return true;
  }

  function unpinTarget(id, now = Date.now()) {
    const normalized = normalizeId(id);
    if (!normalized || !primaryPinnedTargetIds.delete(normalized)) {
      return false;
    }

    touch(now);
    return true;
  }

  function dismissAlert(alert, now = Date.now(), config = {}) {
    const normalized = normalizeAlertReference(alert, alert, now);
    if (!normalized || dismissedAlertsById.has(normalized.id)) {
      return false;
    }

    dismissedAlertsById.set(normalized.id, normalized);
    touch(now);
    boundDismissals(config.MAX_DISMISSED_ALERTS ?? 24, now);
    return true;
  }

  function undismissAlert(id, now = Date.now()) {
    const normalized = normalizeId(id);
    if (!normalized || !dismissedAlertsById.delete(normalized)) {
      return false;
    }

    touch(now);
    return true;
  }

  function suppressTarget(target, durationMs, now = Date.now(), config = {}) {
    const normalizedDuration = Math.max(
      1_000,
      Math.round(Number.isFinite(durationMs) ? durationMs : config.TARGET_SUPPRESSION_MS ?? 45_000),
    );
    const normalized = normalizeSuppressionTarget(target, now + normalizedDuration, now);
    if (!normalized) {
      return false;
    }

    suppressedTargetsById.set(normalized.id, normalized);
    touch(now);
    boundSuppressions(config.MAX_SUPPRESSED_TARGETS ?? 18, now);
    return true;
  }

  function unsuppressTarget(id, now = Date.now()) {
    const normalized = normalizeId(id);
    if (!normalized || !suppressedTargetsById.delete(normalized)) {
      return false;
    }

    touch(now);
    return true;
  }

  function refreshFromSnapshot({
    watchTargets,
    activeAlerts,
    pinState,
    replayCandidates,
    updatedAt: nextUpdatedAt,
  } = {}) {
    const now = Number.isFinite(nextUpdatedAt) ? nextUpdatedAt : Date.now();
    let didChange = purgeSuppressedTargets(now);

    didChange = syncSet(primaryPinnedTeamIds, pinState?.pinnedTeams) || didChange;
    didChange =
      syncStringSet(primaryPinnedTargetIds, pinState?.pinnedTargetIds) || didChange;
    didChange =
      syncStringSet(
        replayCandidateIds,
        Array.isArray(replayCandidates) ? replayCandidates.map((candidate) => candidate.id) : [],
      ) || didChange;

    const targetById = new Map(
      (Array.isArray(watchTargets) ? watchTargets : []).map((target) => [target.id, target]),
    );
    const pinnedTargetById = new Map(
      (Array.isArray(pinState?.pinnedTargets) ? pinState.pinnedTargets : []).map((target) => [
        target.id,
        target,
      ]),
    );
    const alertById = new Map(
      (Array.isArray(activeAlerts) ? activeAlerts : []).map((alert) => [alert.id, alert]),
    );

    if (watchingNowTarget) {
      const refreshedTarget =
        targetById.get(watchingNowTarget.id) || pinnedTargetById.get(watchingNowTarget.id) || null;
      if (refreshedTarget) {
        const normalized = normalizeTargetReference(
          {
            ...refreshedTarget,
            setAt: watchingNowTarget.setAt,
          },
          refreshedTarget.id,
          now,
        );
        if (normalized) {
          watchingNowTarget = normalized;
        }
      }
    }

    for (const [id, entry] of suppressedTargetsById.entries()) {
      const refreshedTarget =
        targetById.get(id) || pinnedTargetById.get(id) || null;
      if (!refreshedTarget) {
        continue;
      }

      suppressedTargetsById.set(id, {
        ...entry,
        label: String(refreshedTarget.label || entry.label || id).trim() || id,
        centerX: Number.isFinite(refreshedTarget.centerX) ? refreshedTarget.centerX : entry.centerX,
        centerY: Number.isFinite(refreshedTarget.centerY) ? refreshedTarget.centerY : entry.centerY,
        involvedTeamIds: normalizeTeamIds(
          Array.isArray(refreshedTarget.involvedTeamIds)
            ? refreshedTarget.involvedTeamIds
            : entry.involvedTeamIds,
        ),
      });
    }

    for (const [id, entry] of dismissedAlertsById.entries()) {
      const refreshedAlert = alertById.get(id);
      if (!refreshedAlert) {
        dismissedAlertsById.delete(id);
        didChange = true;
        continue;
      }

      dismissedAlertsById.set(id, {
        ...entry,
        label: String(refreshedAlert.label || entry.label || id).trim() || id,
        centerX: Number.isFinite(refreshedAlert.centerX) ? refreshedAlert.centerX : entry.centerX,
        centerY: Number.isFinite(refreshedAlert.centerY) ? refreshedAlert.centerY : entry.centerY,
        involvedTeamIds: normalizeTeamIds(
          Array.isArray(refreshedAlert.involvedTeamIds)
            ? refreshedAlert.involvedTeamIds
            : entry.involvedTeamIds,
        ),
      });
    }

    if (didChange) {
      touch(now);
    }
  }

  function getState(now = Date.now()) {
    purgeSuppressedTargets(now);

    return {
      watchingNowTargetId: watchingNowTarget ? watchingNowTarget.id : null,
      primaryPinnedTeamIds: Array.from(primaryPinnedTeamIds.values()).sort(compareIds),
      primaryPinnedTargetIds: Array.from(primaryPinnedTargetIds.values()).sort(compareIds),
      replayCandidateIds: Array.from(replayCandidateIds.values()).sort(compareIds),
      dismissedAlertIds: Array.from(dismissedAlertsById.keys()).sort(compareIds),
      suppressedTargetIds: Array.from(suppressedTargetsById.keys()).sort(compareIds),
      updatedAt,
    };
  }

  function getDetails(now = Date.now()) {
    purgeSuppressedTargets(now);

    return {
      watchingNowTarget: cloneWatchingTarget(watchingNowTarget),
      suppressedTargets: Array.from(suppressedTargetsById.values())
        .sort((left, right) => left.expiresAt - right.expiresAt)
        .map(cloneSuppression),
      dismissedAlerts: Array.from(dismissedAlertsById.values())
        .sort((left, right) => right.dismissedAt - left.dismissedAt)
        .map(cloneDismissal),
      updatedAt,
    };
  }

  function isTargetSuppressed(id, now = Date.now()) {
    purgeSuppressedTargets(now);
    const normalized = normalizeId(id);
    return normalized ? suppressedTargetsById.has(normalized) : false;
  }

  function isAlertDismissed(id) {
    const normalized = normalizeId(id);
    return normalized ? dismissedAlertsById.has(normalized) : false;
  }

  return {
    dismissAlert,
    getDetails,
    getState,
    isAlertDismissed,
    isTargetSuppressed,
    pinTarget,
    pinTeam,
    refreshFromSnapshot,
    suppressTarget,
    undismissAlert,
    unpinTarget,
    unpinTeam,
    unsuppressTarget,
    watchNow,
  };
}

module.exports = {
  createOperatorActionStore,
};
```

## File: `apps/desktop/electron/map-engine/replay-candidate-store.cjs`

`$extension
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

function normalizeSourceType(value) {
  return value === "alert" || value === "manual" ? value : "watch_target";
}

function normalizeTeamIds(teamIds) {
  if (!Array.isArray(teamIds)) {
    return [];
  }

  return Array.from(
    new Set(teamIds.map(normalizeId).filter(Boolean)),
  ).sort(compareIds);
}

function buildReplayCandidateId(sourceType, sourceId) {
  return `replay:${sourceType}:${sourceId}`;
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

function compareReplayCandidates(left, right) {
  return (
    right.createdAt - left.createdAt ||
    right.priorityHint - left.priorityHint ||
    left.id.localeCompare(right.id, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function normalizeReplayCandidate(candidate, defaultTtlMs, now = Date.now()) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const sourceType = normalizeSourceType(source.sourceType);
  const sourceId = normalizeId(source.sourceId || source.id);
  if (!sourceId) {
    return null;
  }

  const id = normalizeId(source.id) || buildReplayCandidateId(sourceType, sourceId);
  const createdAt = Number.isFinite(source.createdAt) ? source.createdAt : now;
  const expiresAt =
    source.expiresAt === null
      ? null
      : Number.isFinite(source.expiresAt)
        ? source.expiresAt
        : createdAt + defaultTtlMs;

  return {
    id,
    sourceType,
    sourceId,
    label: String(source.label || "").trim() || sourceId,
    centerX: Number.isFinite(source.centerX) ? source.centerX : undefined,
    centerY: Number.isFinite(source.centerY) ? source.centerY : undefined,
    involvedTeamIds: normalizeTeamIds(source.involvedTeamIds),
    createdAt,
    expiresAt,
    priorityHint: Math.max(0, Math.round(Number.isFinite(source.priorityHint) ? source.priorityHint : 0)),
  };
}

function createReplayCandidateStore() {
  const candidatesById = new Map();

  function purgeExpired(now = Date.now()) {
    let didChange = false;

    for (const [id, candidate] of candidatesById.entries()) {
      if (candidate.expiresAt !== null && Number.isFinite(candidate.expiresAt) && candidate.expiresAt <= now) {
        candidatesById.delete(id);
        didChange = true;
      }
    }

    return didChange;
  }

  function enforceCapacity(maxEntries) {
    if (!(maxEntries > 0) || candidatesById.size <= maxEntries) {
      return false;
    }

    const ordered = Array.from(candidatesById.values()).sort(compareReplayCandidates);
    let didChange = false;

    while (ordered.length > maxEntries) {
      const candidate = ordered.pop();
      if (candidate && candidatesById.delete(candidate.id)) {
        didChange = true;
      }
    }

    return didChange;
  }

  function addCandidate(candidate, config = {}, now = Date.now()) {
    const normalized = normalizeReplayCandidate(
      candidate,
      config.REPLAY_CANDIDATE_TTL_MS ?? 180_000,
      now,
    );
    if (!normalized) {
      return null;
    }

    purgeExpired(now);

    const existing = Array.from(candidatesById.values()).find(
      (entry) =>
        entry.sourceType === normalized.sourceType &&
        entry.sourceId === normalized.sourceId,
    );

    const nextCandidate = existing
      ? {
          ...existing,
          ...normalized,
          id: existing.id,
          createdAt: now,
          expiresAt:
            normalized.expiresAt === null
              ? null
              : now + (config.REPLAY_CANDIDATE_TTL_MS ?? 180_000),
        }
      : normalized;

    candidatesById.set(nextCandidate.id, nextCandidate);
    enforceCapacity(config.MAX_REPLAY_CANDIDATES ?? 12);
    return cloneReplayCandidate(nextCandidate);
  }

  function removeCandidate(id) {
    const normalizedId = normalizeId(id);
    return normalizedId ? candidatesById.delete(normalizedId) : false;
  }

  function removeCandidateBySourceId(sourceId) {
    const normalizedSourceId = normalizeId(sourceId);
    if (!normalizedSourceId) {
      return false;
    }

    let didChange = false;
    for (const [id, candidate] of candidatesById.entries()) {
      if (candidate.sourceId === normalizedSourceId || id === normalizedSourceId) {
        candidatesById.delete(id);
        didChange = true;
      }
    }

    return didChange;
  }

  function getCandidates(config = {}, now = Date.now()) {
    purgeExpired(now);
    enforceCapacity(config.MAX_REPLAY_CANDIDATES ?? 12);

    return Array.from(candidatesById.values())
      .sort(compareReplayCandidates)
      .map(cloneReplayCandidate);
  }

  return {
    addCandidate,
    getCandidates,
    removeCandidate,
    removeCandidateBySourceId,
  };
}

module.exports = {
  createReplayCandidateStore,
};
```

## File: `apps/desktop/electron/map-engine/observer-assist-config.cjs`

`$extension
"use strict";

function toFiniteNumber(value, fallback) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

const DEFAULT_OBSERVER_ASSIST_CONFIG = Object.freeze({
  // Ratio-based thresholds resolve against the current map world size.
  HOT_ZONE_TEAM_RADIUS: 0.06,
  PROXIMITY_RADIUS: 0.048,
  TEAM_STRAGGLER_RADIUS: 0.018,
  HOT_ZONE_RADIUS_PADDING: 0.012,
  COMBAT_CLUSTER_RADIUS: 0.026,
  ZONE_EDGE_BAND: 0.032,
  COMBAT_MEMORY_MS: 30_000,
  MAX_COMBAT_HISTORY: 90,
  MAX_FOCUS_CANDIDATES: 5,
  MAX_WATCH_TARGETS: 6,
  ALERT_COOLDOWN_MS: 18_000,
  ALERT_EXPIRY_MS: 22_000,
  TEAM_SPLIT_RADIUS_THRESHOLD: 0.034,
  TEAM_SPLIT_MEDIUM_FACTOR: 1.35,
  TEAM_SPLIT_HIGH_FACTOR: 1.8,
  FINAL_CIRCLE_PHASE_THRESHOLD: 7,
  WATCH_TARGET_DEDUPE_RADIUS: 0.022,
  PINNED_PRIORITY_BOOST: 260,
  WATCHING_NOW_PRIORITY_BOOST: 520,
  SUPPRESSED_PRIORITY_PENALTY: 320,
  MAX_ACTIVE_ALERTS: 18,
  MAX_SUPPRESSED_TARGETS: 18,
  MAX_DISMISSED_ALERTS: 24,
  KNOCK_SPIKE_THRESHOLD: 2,
  HIGH_RISK_FIGHT_SCORE: 150,
  TARGET_SUPPRESSION_MS: 45_000,
  REPLAY_CANDIDATE_TTL_MS: 180_000,
  MAX_REPLAY_CANDIDATES: 10,
  PROXIMITY_HIGH_FACTOR: 0.55,
  PROXIMITY_MEDIUM_FACTOR: 0.82,
});

function resolveObserverAssistConfig(mapDefinition, overrides = {}) {
  const worldSize = Math.max(1, toFiniteNumber(mapDefinition?.worldSize, 1));
  const base = {
    ...DEFAULT_OBSERVER_ASSIST_CONFIG,
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  };

  const hotZoneTeamRadius = Math.max(7_500, worldSize * toFiniteNumber(base.HOT_ZONE_TEAM_RADIUS, 0.06));
  const proximityRadius = Math.max(6_500, worldSize * toFiniteNumber(base.PROXIMITY_RADIUS, 0.048));

  return Object.freeze({
    HOT_ZONE_TEAM_RADIUS: hotZoneTeamRadius,
    PROXIMITY_RADIUS: proximityRadius,
    TEAM_STRAGGLER_RADIUS: Math.max(
      5_500,
      worldSize * toFiniteNumber(base.TEAM_STRAGGLER_RADIUS, 0.018),
    ),
    HOT_ZONE_RADIUS_PADDING: Math.max(
      4_000,
      worldSize * toFiniteNumber(base.HOT_ZONE_RADIUS_PADDING, 0.012),
    ),
    COMBAT_CLUSTER_RADIUS: Math.max(
      6_000,
      worldSize * toFiniteNumber(base.COMBAT_CLUSTER_RADIUS, 0.026),
    ),
    ZONE_EDGE_BAND: Math.max(5_000, worldSize * toFiniteNumber(base.ZONE_EDGE_BAND, 0.032)),
    COMBAT_MEMORY_MS: Math.max(5_000, Math.round(toFiniteNumber(base.COMBAT_MEMORY_MS, 30_000))),
    MAX_COMBAT_HISTORY: Math.max(
      10,
      Math.round(toFiniteNumber(base.MAX_COMBAT_HISTORY, 90)),
    ),
    MAX_WATCH_TARGETS: Math.max(
      1,
      Math.min(12, Math.round(toFiniteNumber(base.MAX_WATCH_TARGETS, 6))),
    ),
    MAX_FOCUS_CANDIDATES: Math.max(
      1,
      Math.min(8, Math.round(toFiniteNumber(base.MAX_FOCUS_CANDIDATES, 5))),
    ),
    ALERT_COOLDOWN_MS: Math.max(
      2_500,
      Math.round(toFiniteNumber(base.ALERT_COOLDOWN_MS, 18_000)),
    ),
    ALERT_EXPIRY_MS: Math.max(
      3_000,
      Math.round(toFiniteNumber(base.ALERT_EXPIRY_MS, 22_000)),
    ),
    TEAM_SPLIT_RADIUS_THRESHOLD: Math.max(
      6_500,
      worldSize * toFiniteNumber(base.TEAM_SPLIT_RADIUS_THRESHOLD, 0.034),
    ),
    TEAM_SPLIT_MEDIUM_FACTOR: Math.max(
      1.1,
      toFiniteNumber(base.TEAM_SPLIT_MEDIUM_FACTOR, 1.35),
    ),
    TEAM_SPLIT_HIGH_FACTOR: Math.max(
      1.3,
      toFiniteNumber(base.TEAM_SPLIT_HIGH_FACTOR, 1.8),
    ),
    FINAL_CIRCLE_PHASE_THRESHOLD: Math.max(
      1,
      Math.round(toFiniteNumber(base.FINAL_CIRCLE_PHASE_THRESHOLD, 7)),
    ),
    WATCH_TARGET_DEDUPE_RADIUS: Math.max(
      5_000,
      worldSize * toFiniteNumber(base.WATCH_TARGET_DEDUPE_RADIUS, 0.022),
    ),
    PINNED_PRIORITY_BOOST: Math.max(
      10,
      Math.round(toFiniteNumber(base.PINNED_PRIORITY_BOOST, 260)),
    ),
    WATCHING_NOW_PRIORITY_BOOST: Math.max(
      20,
      Math.round(toFiniteNumber(base.WATCHING_NOW_PRIORITY_BOOST, 520)),
    ),
    SUPPRESSED_PRIORITY_PENALTY: Math.max(
      20,
      Math.round(toFiniteNumber(base.SUPPRESSED_PRIORITY_PENALTY, 320)),
    ),
    MAX_ACTIVE_ALERTS: Math.max(
      4,
      Math.min(40, Math.round(toFiniteNumber(base.MAX_ACTIVE_ALERTS, 18))),
    ),
    MAX_SUPPRESSED_TARGETS: Math.max(
      4,
      Math.min(40, Math.round(toFiniteNumber(base.MAX_SUPPRESSED_TARGETS, 18))),
    ),
    MAX_DISMISSED_ALERTS: Math.max(
      4,
      Math.min(48, Math.round(toFiniteNumber(base.MAX_DISMISSED_ALERTS, 24))),
    ),
    KNOCK_SPIKE_THRESHOLD: Math.max(
      1,
      Math.round(toFiniteNumber(base.KNOCK_SPIKE_THRESHOLD, 2)),
    ),
    HIGH_RISK_FIGHT_SCORE: Math.max(
      40,
      Math.round(toFiniteNumber(base.HIGH_RISK_FIGHT_SCORE, 150)),
    ),
    TARGET_SUPPRESSION_MS: Math.max(
      5_000,
      Math.round(toFiniteNumber(base.TARGET_SUPPRESSION_MS, 45_000)),
    ),
    REPLAY_CANDIDATE_TTL_MS: Math.max(
      20_000,
      Math.round(toFiniteNumber(base.REPLAY_CANDIDATE_TTL_MS, 180_000)),
    ),
    MAX_REPLAY_CANDIDATES: Math.max(
      3,
      Math.min(24, Math.round(toFiniteNumber(base.MAX_REPLAY_CANDIDATES, 10))),
    ),
    PROXIMITY_HIGH_DISTANCE:
      proximityRadius * toFiniteNumber(base.PROXIMITY_HIGH_FACTOR, 0.55),
    PROXIMITY_MEDIUM_DISTANCE:
      proximityRadius * toFiniteNumber(base.PROXIMITY_MEDIUM_FACTOR, 0.82),
    WORLD_SIZE: worldSize,
  });
}

module.exports = {
  DEFAULT_OBSERVER_ASSIST_CONFIG,
  resolveObserverAssistConfig,
};
```

## File: `apps/desktop/electron/map-engine/observer-control-bridge.cjs`

`$extension
"use strict";

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

function buildObserverControlSuggestion({
  watchTargets,
  activeAlerts,
  pinState,
  updatedAt,
} = {}) {
  const topWatchTargets = Array.isArray(watchTargets) ? watchTargets.slice(0, 5) : [];
  const alerts = Array.isArray(activeAlerts) ? activeAlerts : [];
  const suggestedFocus = topWatchTargets.length
    ? {
        x: topWatchTargets[0].centerX,
        y: topWatchTargets[0].centerY,
      }
    : null;

  return {
    topWatchTargets: topWatchTargets.map((target) => ({
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
    })),
    activeAlerts: alerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      label: alert.label,
      centerX: alert.centerX,
      centerY: alert.centerY,
      involvedTeamIds: [...alert.involvedTeamIds],
      createdAt: alert.createdAt,
      expiresAt: alert.expiresAt,
    })),
    pinnedTeams: Array.isArray(pinState?.pinnedTeams) ? [...pinState.pinnedTeams] : [],
    suggestedFocusCenter: suggestedFocus,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

function buildObserverOperatorSuggestion({
  operatorState,
  replayCandidates,
  updatedAt,
} = {}) {
  return {
    watchingNowTargetId: operatorState?.watchingNowTargetId ?? null,
    replayCandidates: Array.isArray(replayCandidates)
      ? replayCandidates.map(cloneReplayCandidate)
      : [],
    suppressedTargetIds: Array.isArray(operatorState?.suppressedTargetIds)
      ? [...operatorState.suppressedTargetIds]
      : [],
    dismissedAlertIds: Array.isArray(operatorState?.dismissedAlertIds)
      ? [...operatorState.dismissedAlertIds]
      : [],
    primaryPinnedTeamIds: Array.isArray(operatorState?.primaryPinnedTeamIds)
      ? [...operatorState.primaryPinnedTeamIds]
      : [],
    primaryPinnedTargetIds: Array.isArray(operatorState?.primaryPinnedTargetIds)
      ? [...operatorState.primaryPinnedTargetIds]
      : [],
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

module.exports = {
  buildObserverControlSuggestion,
  buildObserverOperatorSuggestion,
};
```

## File: `apps/desktop/electron/map-engine/production-support-engine.cjs`

`$extension
"use strict";

const { resolveObserverAssistConfig } = require("./observer-assist-config.cjs");
const {
  buildObserverControlSuggestion,
  buildObserverOperatorSuggestion,
} = require("./observer-control-bridge.cjs");
const { createOperatorActionStore } = require("./operator-action-store.cjs");
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

function cloneObserverOperatorSuggestion(suggestion) {
  return {
    watchingNowTargetId: suggestion.watchingNowTargetId ?? null,
    replayCandidates: suggestion.replayCandidates.map(cloneReplayCandidate),
    suppressedTargetIds: [...suggestion.suppressedTargetIds],
    dismissedAlertIds: [...suggestion.dismissedAlertIds],
    primaryPinnedTeamIds: [...suggestion.primaryPinnedTeamIds],
    primaryPinnedTargetIds: [...suggestion.primaryPinnedTargetIds],
    updatedAt: suggestion.updatedAt,
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
    replayCandidates: snapshot.replayCandidates.map(cloneReplayCandidate),
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

function createProductionSupportEngine({ config: configOverrides = null } = {}) {
  const statesByMap = new Map();
  const pinnedWatchStore = createPinnedWatchStore();

  function ensureMapState(mapKey) {
    let state = statesByMap.get(mapKey);
    if (!state) {
      state = {
        alertEngine: createProductionAlertEngine(),
        assistSnapshot: null,
        latestSnapshot: null,
        operatorActionStore: createOperatorActionStore(),
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
    const observerControlSuggestion = buildObserverControlSuggestion({
      watchTargets,
      activeAlerts,
      pinState: refreshedPinState,
      updatedAt,
    });
    const observerOperatorSuggestion = buildObserverOperatorSuggestion({
      operatorState,
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
      replayCandidates,
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

  function watchNowTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    state.operatorActionStore.watchNow(target, Date.now());
    return recompute(mapKey, mapDefinition, Date.now());
  }

  function pinTeam(teamId, mapDefinition, mapKeyHint = null) {
    const didPin = pinnedWatchStore.pinTeam(teamId);
    if (!didPin) {
      return null;
    }

    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    state.operatorActionStore.pinTeam(teamId, Date.now());
    return recompute(mapKey, mapDefinition, Date.now());
  }

  function unpinTeam(teamId, mapDefinition, mapKeyHint = null) {
    pinnedWatchStore.unpinTeam(teamId);
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    state.operatorActionStore.unpinTeam(teamId, Date.now());
    return recompute(mapKey, mapDefinition, Date.now());
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
    state.operatorActionStore.pinTarget(target, Date.now());
    return recompute(mapKey, mapDefinition, Date.now());
  }

  function unpinTarget(id, mapDefinition, mapKeyHint = null) {
    pinnedWatchStore.unpinTarget(id);
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    state.operatorActionStore.unpinTarget(id, Date.now());
    return recompute(mapKey, mapDefinition, Date.now());
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
    return recompute(mapKey, mapDefinition, now);
  }

  function unmarkReplayById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    if (!state) {
      return null;
    }

    const removed = state.replayCandidateStore.removeCandidateBySourceId(id);
    if (!removed) {
      return null;
    }

    return recompute(mapKey, mapDefinition, Date.now());
  }

  function suppressTargetById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const target = findTargetById(state, id);
    if (!target) {
      return null;
    }

    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    state.operatorActionStore.suppressTarget(
      target,
      config.TARGET_SUPPRESSION_MS,
      Date.now(),
      config,
    );
    return recompute(mapKey, mapDefinition, Date.now());
  }

  function unsuppressTarget(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const didUnsuppress = state.operatorActionStore.unsuppressTarget(id, Date.now());
    if (!didUnsuppress) {
      return null;
    }

    return recompute(mapKey, mapDefinition, Date.now());
  }

  function dismissAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = statesByMap.get(mapKey);
    const alert = findAlertById(state, id);
    if (!alert) {
      return null;
    }

    const config = resolveObserverAssistConfig(mapDefinition, configOverrides);
    const didDismiss = state.operatorActionStore.dismissAlert(alert, Date.now(), config);
    if (!didDismiss) {
      return null;
    }

    return recompute(mapKey, mapDefinition, Date.now());
  }

  function undismissAlertById(id, mapDefinition, mapKeyHint = null) {
    const mapKey = normalizeMapKey(mapKeyHint || mapDefinition?.key);
    const state = ensureMapState(mapKey);
    const didUndismiss = state.operatorActionStore.undismissAlert(id, Date.now());
    if (!didUndismiss) {
      return null;
    }

    return recompute(mapKey, mapDefinition, Date.now());
  }

  return {
    applyObserverAssist,
    dismissAlertById,
    get,
    getPinState,
    markReplayById,
    pinTargetById,
    pinTeam,
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

## File: `apps/desktop/electron/map-engine/map-widget-engine.cjs`

`$extension
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
    }

    if (snapshot) {
      broadcastProductionSupport(snapshot);
    }

    return {
      pinState: productionSupportEngine.getPinState(),
      operatorState: snapshot?.operatorState ?? null,
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
    pinTarget: (id, mapKey = null) => runOperatorAction("pin-target", id, mapKey),
    pinTeam: (teamId, mapKey = null) => runOperatorAction("pin-team", teamId, mapKey),
    watchNowTarget: (id, mapKey = null) => runOperatorAction("watch-now", id, mapKey),
    markReplay: (id, mapKey = null) => runOperatorAction("mark-replay", id, mapKey),
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

## File: `apps/desktop/electron/widget-server/server.cjs`

`$extension
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

  if (enableDebugRoutes) {
    function sendOperatorActionResponse(res, action, id, result, mapKey = null, extra = {}) {
      const snapshot = engine.getSnapshot(mapKey).productionSupport;
      res.json({
        ok: Boolean(result?.snapshot),
        action,
        id,
        pinState: engine.getPinState(),
        operatorState: snapshot?.operatorState ?? null,
        replayCandidates: snapshot?.replayCandidates ?? [],
        productionSupport: snapshot,
        ...extra,
      });
    }

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

## File: `apps/desktop/electron/widget-server/routes/obs-map-route.cjs`

`$extension
"use strict";

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function normalizeDebugFlag(value) {
  return value === "1" || value === "true";
}

function registerObsMapRoute(app, { engine, registry, wsPath }) {
  app.get("/obs/map", (req, res) => {
    const requestedMapDefinition = registry.resolve(req.query?.map);
    const snapshot = engine.getSnapshot(requestedMapDefinition?.key ?? null);
    const bootstrap = {
      debug: normalizeDebugFlag(String(req.query?.debug || "")),
      requestedMapKey:
        requestedMapDefinition?.key ?? snapshot?.mapContext?.mapKey ?? registry.getDefaultKey(),
      wsPath,
      snapshot,
      serverTime: Date.now(),
    };

    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Arenzyra OBS Map</title>
    <link rel="stylesheet" href="/obs/static/obs-map-widget.css" />
  </head>
  <body>
    <div class="obs-map-root">
      <div class="widget-shell">
        <div class="map-stage" id="map-stage">
          <img id="map-image" alt="PUBG map image" draggable="false" />
          <canvas id="map-overlay"></canvas>
          <div class="status-pill" id="status-pill">Connecting...</div>
          <div class="timer-panel" id="timer-panel">
            <div class="timer-label">Zone Timer</div>
            <div class="timer-value" id="timer-value">--:--</div>
          </div>
          <div class="operator-stack" id="operator-stack">
            <div class="assist-panel" id="assist-panel" hidden>
              <div class="assist-title">Observer Assist</div>
              <div class="assist-grid" id="assist-grid"></div>
            </div>
            <div class="operator-panel" id="operator-panel" hidden>
              <div class="assist-title">Observer Panel</div>
              <div class="operator-panel-body" id="operator-panel-body"></div>
            </div>
            <div class="watch-queue-panel" id="watch-queue-panel" hidden>
              <div class="assist-title">Watch Queue</div>
              <div class="watch-queue-list" id="watch-queue-list"></div>
            </div>
            <div class="alerts-panel" id="alerts-panel" hidden>
              <div class="assist-title">Production Alerts</div>
              <div class="alerts-list" id="alerts-list"></div>
            </div>
          </div>
          <div class="debug-panel" id="debug-panel" hidden>
            <div class="debug-title">Map Debug</div>
            <div class="debug-grid" id="debug-grid"></div>
          </div>
        </div>
      </div>
    </div>
    <script>window.__ARENZYRA_MAP_WIDGET_BOOTSTRAP__ = ${safeJson(bootstrap)};</script>
    <script src="/obs/static/obs-map-widget.js"></script>
  </body>
</html>`);
  });
}

module.exports = {
  registerObsMapRoute,
};
```

## File: `apps/desktop/electron/widget-server/public/obs-map-widget.css`

`$extension
:root {
  color-scheme: dark;
  font-family: "Bahnschrift", "Segoe UI", Arial, sans-serif;
}

html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  color: #f5f7fa;
}

body {
  display: flex;
  align-items: center;
  justify-content: center;
}

.obs-map-root {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.widget-shell {
  position: relative;
  width: min(100vw, 100vh);
  max-width: 100vh;
  max-height: 100vh;
}

.map-stage {
  position: relative;
  width: 100%;
  overflow: hidden;
  isolation: isolate;
  background: rgba(5, 9, 14, 0.22);
}

#map-image {
  display: block;
  width: 100%;
  height: auto;
  user-select: none;
  -webkit-user-drag: none;
}

#map-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.status-pill,
.timer-panel,
.assist-panel,
.operator-panel,
.watch-queue-panel,
.alerts-panel,
.debug-panel {
  position: absolute;
  background: rgba(5, 9, 14, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(6px);
}

.status-pill {
  top: 10px;
  left: 10px;
  padding: 6px 10px;
  border-radius: 999px;
  font: 700 12px/1.2 "Bahnschrift", "Segoe UI", Arial, sans-serif;
  letter-spacing: 0.02em;
}

.timer-panel {
  top: 10px;
  right: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  text-align: right;
}

.timer-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.68;
}

.timer-value {
  margin-top: 2px;
  font: 700 20px/1 "Bahnschrift", "Segoe UI", Arial, sans-serif;
}

.operator-stack {
  position: absolute;
  top: 54px;
  right: 10px;
  width: min(332px, calc(100% - 20px));
  display: grid;
  gap: 10px;
}

.debug-panel {
  left: 10px;
  bottom: 10px;
  min-width: 280px;
  max-width: min(360px, calc(100% - 20px));
  max-height: calc(100% - 20px);
  overflow: auto;
  padding: 10px 12px;
  border-radius: 10px;
  font: 12px/1.3 "Cascadia Code", Consolas, monospace;
}

.assist-panel {
  position: relative;
  width: 100%;
  max-height: min(34vh, 280px);
  overflow: auto;
  padding: 10px 12px;
  border-radius: 12px;
  font: 12px/1.35 "Bahnschrift", "Segoe UI", Arial, sans-serif;
}

.operator-panel {
  position: relative;
  width: 100%;
  max-height: min(52vh, 420px);
  overflow: auto;
  padding: 10px 12px;
  border-radius: 12px;
  font: 12px/1.35 "Bahnschrift", "Segoe UI", Arial, sans-serif;
}

.watch-queue-panel,
.alerts-panel {
  position: relative;
  width: 100%;
  max-height: min(28vh, 220px);
  overflow: auto;
  padding: 10px 12px;
  border-radius: 12px;
  font: 12px/1.35 "Bahnschrift", "Segoe UI", Arial, sans-serif;
}

.assist-panel[hidden],
.operator-panel[hidden],
.watch-queue-panel[hidden],
.alerts-panel[hidden],
.operator-stack[hidden],
.debug-panel[hidden] {
  display: none;
}

.assist-title,
.debug-title {
  margin-bottom: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.assist-grid,
.debug-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
}

.operator-panel-body {
  display: grid;
  gap: 10px;
}

.operator-section {
  display: grid;
  gap: 8px;
}

.operator-section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.operator-section-title {
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.operator-section-meta {
  font-size: 10px;
  color: rgba(226, 232, 240, 0.6);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.operator-section-body {
  display: grid;
  gap: 8px;
}

.assist-grid .label,
.debug-grid .label {
  opacity: 0.7;
}

.assist-grid .value,
.debug-grid .value {
  text-align: right;
  white-space: pre-wrap;
  word-break: break-word;
}

.watch-queue-list,
.alerts-list {
  display: grid;
  gap: 8px;
}

.watch-item,
.alert-item,
.operator-card {
  display: grid;
  gap: 4px;
  padding: 8px 9px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.watch-item-header,
.alert-item-header,
.operator-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.watch-item-title,
.alert-item-title,
.operator-card-title {
  font-weight: 700;
  line-height: 1.3;
}

.watch-item-meta,
.alert-item-meta,
.watch-item-reasons,
.operator-card-meta,
.operator-card-extra {
  font-size: 11px;
  color: rgba(226, 232, 240, 0.72);
  line-height: 1.4;
  white-space: pre-wrap;
}

.watch-item-badge,
.alert-item-badge,
.operator-card-badges {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.watch-item-badge,
.alert-item-badge,
.operator-badge {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.watch-item-badge {
  background: rgba(255, 255, 255, 0.06);
}

.operator-badge {
  background: rgba(255, 255, 255, 0.06);
}

.operator-badge--watching {
  color: #bfdbfe;
  background: rgba(59, 130, 246, 0.16);
}

.operator-badge--pinned {
  color: #fde68a;
  background: rgba(245, 158, 11, 0.16);
}

.operator-badge--suppressed {
  color: #cbd5e1;
  background: rgba(100, 116, 139, 0.18);
}

.operator-badge--replay {
  color: #fecdd3;
  background: rgba(244, 63, 94, 0.14);
}

.alert-item-badge--info {
  color: #cbd5e1;
  background: rgba(148, 163, 184, 0.12);
}

.alert-item-badge--warning {
  color: #fde68a;
  background: rgba(245, 158, 11, 0.16);
}

.alert-item-badge--critical {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.18);
}

.operator-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.operator-action {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #f8fafc;
  border-radius: 999px;
  padding: 4px 9px;
  font: 600 10px/1 "Bahnschrift", "Segoe UI", Arial, sans-serif;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.operator-action:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.operator-action:disabled {
  opacity: 0.5;
  cursor: wait;
}

.operator-token-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.operator-token {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(241, 245, 249, 0.86);
  font-size: 11px;
}

.operator-token button {
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(226, 232, 240, 0.72);
  font: inherit;
  cursor: pointer;
  padding: 0;
}

.empty-panel {
  color: rgba(226, 232, 240, 0.7);
  font-size: 11px;
  line-height: 1.4;
}

@media (max-width: 700px) {
  .widget-shell {
    width: min(100vw, 100vh);
    max-width: 100vw;
  }

  .status-pill,
  .timer-panel {
    top: 6px;
  }

  .status-pill {
    left: 6px;
  }

  .timer-panel {
    right: 6px;
  }

  .operator-stack {
    top: auto;
    left: 6px;
    right: 6px;
    bottom: 112px;
    width: auto;
  }

  .debug-panel {
    left: 6px;
    right: 6px;
    bottom: 6px;
    min-width: 0;
    max-width: none;
  }
}
```

## File: `apps/desktop/electron/widget-server/public/obs-map-widget.js`

`$extension
(function () {
  const PLAYER_TTL_MS = 1800;
  const PLAYER_MIN_INTERPOLATION_MS = 90;
  const PLAYER_MAX_INTERPOLATION_MS = 420;
  const PLAYER_STALE_SNAP_MS = 2200;
  const PLAYER_SNAP_WORLD_RATIO = 0.035;
  const DEBUG_REFRESH_MS = 160;
  const KILL_PING_TTL_MS = 3000;
  const KILL_PING_MAX_COUNT = 20;
  const CLUSTER_WORLD_RATIO = 0.018;
  const CLUSTER_MIN_WORLD = 9000;
  const RENDER_REFERENCE_PX = 1040;
  const DEFAULT_STYLE = "esports";
  const OBS_LABEL_FONT_STACK = '"Bahnschrift", "Segoe UI", Arial, sans-serif';
  const DEBUG_FONT_STACK = '"Cascadia Code", Consolas, monospace';
  const FOCUS_LABEL_MAX_LENGTH = 28;
  const TEAM_COLOR_PALETTE = [
    "#FF4D4D",
    "#FFAA00",
    "#00C2FF",
    "#00E676",
    "#C084FC",
    "#FF6F91",
    "#FFD166",
    "#4DD0E1",
    "#F06292",
    "#64FFDA",
  ];

  const STYLE_CONFIGS = Object.freeze({
    minimal: Object.freeze({
      name: "minimal",
      defaultShowTeamNumbers: false,
      currentZoneFillAlpha: 0,
      markerGlow: false,
      markerInnerDot: false,
      showClusterRings: false,
      showZoneShade: false,
    }),
    esports: Object.freeze({
      name: "esports",
      defaultShowTeamNumbers: true,
      currentZoneFillAlpha: 0.035,
      markerGlow: true,
      markerInnerDot: true,
      showClusterRings: true,
      showZoneShade: true,
    }),
  });

  const bootstrap = window.__ARENZYRA_MAP_WIDGET_BOOTSTRAP__ || {};
  const query = new URLSearchParams(window.location.search);
  const stage = document.getElementById("map-stage");
  const image = document.getElementById("map-image");
  const canvas = document.getElementById("map-overlay");
  const statusPill = document.getElementById("status-pill");
  const timerValue = document.getElementById("timer-value");
  const operatorStack = document.getElementById("operator-stack");
  const assistPanel = document.getElementById("assist-panel");
  const assistGrid = document.getElementById("assist-grid");
  const operatorPanel = document.getElementById("operator-panel");
  const operatorPanelBody = document.getElementById("operator-panel-body");
  const watchQueuePanel = document.getElementById("watch-queue-panel");
  const watchQueueList = document.getElementById("watch-queue-list");
  const alertsPanel = document.getElementById("alerts-panel");
  const alertsList = document.getElementById("alerts-list");
  const debugPanel = document.getElementById("debug-panel");
  const debugGrid = document.getElementById("debug-grid");
  const context = canvas ? canvas.getContext("2d") : null;

  if (
    !stage ||
    !image ||
    !canvas ||
    !statusPill ||
    !timerValue ||
    !operatorStack ||
    !assistPanel ||
    !assistGrid ||
    !operatorPanel ||
    !operatorPanelBody ||
    !watchQueuePanel ||
    !watchQueueList ||
    !alertsPanel ||
    !alertsList ||
    !debugPanel ||
    !debugGrid ||
    !context
  ) {
    return;
  }

  function toFiniteNumber(value, fallback = null) {
    const numeric =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function normalizeFlag(value) {
    return value === "1" || value === "true";
  }

  function resolveQueryFlag(name, fallback = false) {
    if (!query.has(name)) {
      return fallback;
    }
    return normalizeFlag(query.get(name));
  }

  function normalizeStyle(value) {
    return value === "minimal" ? "minimal" : "esports";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function drawRoundedRectPath(ctx, x, y, width, height, radius) {
    const normalizedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, width, height, normalizedRadius);
      return;
    }

    ctx.moveTo(x + normalizedRadius, y);
    ctx.lineTo(x + width - normalizedRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + normalizedRadius);
    ctx.lineTo(x + width, y + height - normalizedRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - normalizedRadius, y + height);
    ctx.lineTo(x + normalizedRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - normalizedRadius);
    ctx.lineTo(x, y + normalizedRadius);
    ctx.quadraticCurveTo(x, y, x + normalizedRadius, y);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  function formatNumber(value, decimals = 2) {
    return Number.isFinite(value) ? Number(value).toFixed(decimals) : "--";
  }

  function formatTimestamp(value) {
    const numeric = toFiniteNumber(value);
    return numeric !== null ? new Date(numeric).toISOString() : "--";
  }

  function formatTimer(ms) {
    if (!Number.isFinite(ms)) {
      return "--:--";
    }

    if (ms <= 0) {
      return "00:00";
    }

    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function formatCircle(circle) {
    if (!circle) {
      return "--";
    }

    const x = toFiniteNumber(circle.centerX ?? circle.x);
    const y = toFiniteNumber(circle.centerY ?? circle.y);
    const radius = toFiniteNumber(circle.radius);
    if (x === null || y === null || radius === null) {
      return "--";
    }

    return `${formatNumber(x)}, ${formatNumber(y)} | r=${formatNumber(radius)}`;
  }

  function formatRemainingDetails(ms) {
    if (!Number.isFinite(ms)) {
      return "--";
    }

    return `${formatTimer(ms)} (${Math.max(0, Math.ceil(ms))} ms)`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  const teamColorCache = new Map();
  const rgbCache = new Map();

  function getHexRgb(hex) {
    if (!hex || typeof hex !== "string") {
      return null;
    }

    if (rgbCache.has(hex)) {
      return rgbCache.get(hex);
    }

    const normalized = hex.replace("#", "").trim();
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
      rgbCache.set(hex, null);
      return null;
    }

    const rgb = {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
    };
    rgbCache.set(hex, rgb);
    return rgb;
  }

  function colorWithAlpha(hex, alpha) {
    const rgb = getHexRgb(hex);
    if (!rgb) {
      return `rgba(255, 255, 255, ${clamp01(alpha)})`;
    }

    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp01(alpha)})`;
  }

  function getTeamColor(teamId) {
    const normalized = typeof teamId === "string" ? teamId.trim().toLowerCase() : "";
    const key = normalized || "__unknown__";
    if (teamColorCache.has(key)) {
      return teamColorCache.get(key);
    }

    const color = TEAM_COLOR_PALETTE[hashString(key) % TEAM_COLOR_PALETTE.length];
    teamColorCache.set(key, color);
    return color;
  }

  function parseNumericTeamIndex(teamId) {
    const normalized = typeof teamId === "string" ? teamId.trim() : "";
    if (!normalized) {
      return null;
    }

    if (/^\d{1,3}$/.test(normalized)) {
      const numeric = Number(normalized);
      return numeric > 0 ? numeric : null;
    }

    const directMatch = normalized.match(/^(?:team|t|slot|seed)[-_ ]?(\d{1,3})$/i);
    if (directMatch) {
      const numeric = Number(directMatch[1]);
      return numeric > 0 ? numeric : null;
    }

    return null;
  }

  function compareTeamIds(left, right) {
    const leftNumeric = parseNumericTeamIndex(left);
    const rightNumeric = parseNumericTeamIndex(right);

    if (leftNumeric !== null && rightNumeric !== null && leftNumeric !== rightNumeric) {
      return leftNumeric - rightNumeric;
    }
    if (leftNumeric !== null && rightNumeric === null) {
      return -1;
    }
    if (leftNumeric === null && rightNumeric !== null) {
      return 1;
    }

    return String(left).localeCompare(String(right), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  function formatTeamLabel(teamId) {
    const numeric = parseNumericTeamIndex(teamId);
    if (numeric !== null) {
      return `Team ${numeric}`;
    }

    const normalized = typeof teamId === "string" ? teamId.trim() : "";
    return normalized ? `Team ${normalized}` : "Unknown team";
  }

  function truncateLabel(value, maxLength = FOCUS_LABEL_MAX_LENGTH) {
    const normalized = String(value || "").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  const style = normalizeStyle(query.get("style") || DEFAULT_STYLE);
  const styleConfig = STYLE_CONFIGS[style] || STYLE_CONFIGS[DEFAULT_STYLE];

  const state = {
    connectionStatus: "connecting",
    debug: Boolean(bootstrap.debug) || resolveQueryFlag("debug"),
    assistFlags: {
      showHotZones: resolveQueryFlag("showhotzones"),
      showFocus: resolveQueryFlag("showfocus"),
      showProximity: resolveQueryFlag("showproximity"),
      showPanel: resolveQueryFlag("assistpanel") || Boolean(bootstrap.debug) || resolveQueryFlag("debug"),
    },
    assistMarkup: "",
    assistSnapshot: bootstrap.snapshot ? bootstrap.snapshot.observerAssist || null : null,
    debugFlags: {
      showCircleAnchors: resolveQueryFlag("showcircles"),
      showCoords: resolveQueryFlag("showcoords"),
      showGrid: resolveQueryFlag("showgrid"),
      showPlayerLabels: resolveQueryFlag("showplayers"),
    },
    debugMarkup: "",
    frame: {
      animatedCircle: null,
      clusters: [],
      focusCandidates: [],
      hotZones: [],
      killPingCount: 0,
      nextCircle: null,
      now: 0,
      players: [],
      proximities: [],
      remainingMs: null,
    },
    knownTeamIds: [],
    killPings: [],
    lastAlertsRefreshAt: 0,
    lastAssistRefreshAt: 0,
    lastDebugRefreshAt: 0,
    lastHeartbeatAt: null,
    lastMessageAt: null,
    lastOperatorActionPath: "",
    lastOperatorPanelRefreshAt: 0,
    lastPlayerMessageAt: null,
    lastWatchQueueRefreshAt: 0,
    lastStatusLabel: "",
    lastTimerLabel: "",
    lastZoneMessageAt: null,
    lastPlayerSnapshotById: new Map(),
    mapContext: null,
    operatorFlags: {
      showAlerts: resolveQueryFlag("alerts"),
      showPanel: resolveQueryFlag("operatorpanel"),
      showWatchQueue: resolveQueryFlag("watchqueue"),
    },
    operatorPanelMarkup: "",
    playerMotionById: new Map(),
    playersPacket: null,
    productionSupportSnapshot: bootstrap.snapshot ? bootstrap.snapshot.productionSupport || null : null,
    alertsMarkup: "",
    renderMetrics: {
      clusterDebugFont: "",
      clusterMinRadiusPx: 10,
      clusterPaddingPx: 6,
      clusterStrokeWidth: 1.2,
      debugFont: "",
      debugLineHeight: 12,
      focusBadgeRadius: 12,
      focusFont: "",
      focusLabelFont: "",
      killPingMaxRadius: 28,
      killPingMinRadius: 7,
      labelFont: "",
      labelOffsetX: 8,
      labelOffsetY: 6,
      labelStrokeWidth: 2.5,
      markerGlowBlur: 10,
      markerRadius: 5.5,
      markerStrokeWidth: 1.35,
      nextZoneLineWidth: 1.7,
      knockedCrossSize: 6,
      scale: 1,
      zoneGlowBlur: 12,
      zoneLineWidth: 2.4,
    },
    requestedMapKey: bootstrap.requestedMapKey || null,
    showTeamNumbers: resolveQueryFlag("showteamnumbers", styleConfig.defaultShowTeamNumbers),
    socket: null,
    socketReconnectTimer: null,
    style,
    styleConfig,
    teamClusters: [],
    teamDisplayIndexById: new Map(),
    teamMembersById: new Map(),
    visiblePlayers: [],
    watchQueueMarkup: "",
    zone: null,
  };

  function getMapDefinition() {
    return state.mapContext && state.mapContext.definition ? state.mapContext.definition : null;
  }

  function getScaleMetadata() {
    return (
      (state.zone && state.zone.coordinate) ||
      (state.playersPacket && state.playersPacket.coordinate) ||
      null
    );
  }

  function getDetectedScaleFactor() {
    return Math.max(1, toFiniteNumber(getScaleMetadata() && getScaleMetadata().detectedScaleFactor, 1));
  }

  function resolveWorldSize(mapDefinition) {
    return Math.max(1, toFiniteNumber(mapDefinition && mapDefinition.worldSize, 1));
  }

  function hasLoadedImage() {
    return Boolean(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  }

  function resolveImageDimensions() {
    const map = getMapDefinition();
    if (hasLoadedImage()) {
      return {
        height: image.naturalHeight,
        width: image.naturalWidth,
      };
    }

    return {
      height: toFiniteNumber(map && map.imageHeight, null),
      width: toFiniteNumber(map && map.imageWidth, null),
    };
  }

  function normalizeWorldX(worldX, mapDefinition, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    return clamp(
      toFiniteNumber(worldX, 0) * Math.max(1, toFiniteNumber(options && options.detectedScaleFactor, 1)),
      0,
      worldSize,
    );
  }

  function normalizeWorldY(worldY, mapDefinition, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    return clamp(
      toFiniteNumber(worldY, 0) * Math.max(1, toFiniteNumber(options && options.detectedScaleFactor, 1)),
      0,
      worldSize,
    );
  }

  function normalizeWorldRadius(worldRadius, mapDefinition, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    return clamp(
      toFiniteNumber(worldRadius, 0) * Math.max(1, toFiniteNumber(options && options.detectedScaleFactor, 1)),
      0,
      worldSize,
    );
  }

  function worldToPixelX(worldX, mapDefinition, width, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    return clamp((normalizeWorldX(worldX, mapDefinition, options) / worldSize) * width, 0, width);
  }

  function worldToPixelY(worldY, mapDefinition, height, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    return clamp(height - (normalizeWorldY(worldY, mapDefinition, options) / worldSize) * height, 0, height);
  }

  function worldRadiusToPixelRadius(worldRadius, mapDefinition, width, height, options) {
    const worldSize = resolveWorldSize(mapDefinition);
    return Math.max(
      0,
      normalizeWorldRadius(worldRadius, mapDefinition, options) *
        Math.min(width / worldSize, height / worldSize),
    );
  }

  function getCurrentCircle(zone) {
    if (!zone) {
      return null;
    }

    if (
      zone.currentCircle &&
      Number.isFinite(zone.currentCircle.centerX) &&
      Number.isFinite(zone.currentCircle.centerY) &&
      Number.isFinite(zone.currentCircle.radius)
    ) {
      return {
        centerX: zone.currentCircle.centerX,
        centerY: zone.currentCircle.centerY,
        radius: zone.currentCircle.radius,
      };
    }

    const centerX = toFiniteNumber(zone.centerX);
    const centerY = toFiniteNumber(zone.centerY);
    const radius = toFiniteNumber(zone.radius);
    if (centerX === null || centerY === null || radius === null) {
      return null;
    }

    return { centerX, centerY, radius };
  }

  function getNextCircle(zone) {
    if (!zone) {
      return null;
    }

    if (
      zone.nextCircle &&
      Number.isFinite(zone.nextCircle.centerX) &&
      Number.isFinite(zone.nextCircle.centerY) &&
      Number.isFinite(zone.nextCircle.radius)
    ) {
      return {
        centerX: zone.nextCircle.centerX,
        centerY: zone.nextCircle.centerY,
        radius: zone.nextCircle.radius,
      };
    }

    const centerX = toFiniteNumber(zone.nextCenterX);
    const centerY = toFiniteNumber(zone.nextCenterY);
    const radius = toFiniteNumber(zone.nextRadius);
    if (centerX === null || centerY === null || radius === null) {
      return null;
    }

    return { centerX, centerY, radius };
  }

  function getRemainingZoneMs(zone, now) {
    const targetEndAt = toFiniteNumber(zone && (zone.targetEndAt || (zone.timing && zone.timing.targetEndAt)));
    if (targetEndAt === null) {
      return null;
    }

    return Math.max(0, targetEndAt - now);
  }

  function getZoneDurationMs(zone) {
    const timeRemainingMs = toFiniteNumber(zone && zone.timeRemainingMs);
    if (timeRemainingMs !== null) {
      return timeRemainingMs;
    }

    const timeRemainingSeconds = toFiniteNumber(zone && zone.timeRemaining);
    if (timeRemainingSeconds !== null) {
      return timeRemainingSeconds * 1000;
    }

    return toFiniteNumber(zone && zone.timing && zone.timing.durationMs);
  }

  function getAnimatedCircleState(zone, now) {
    const currentCircle = getCurrentCircle(zone);
    const nextCircle = getNextCircle(zone);
    const durationMs = getZoneDurationMs(zone);
    const remainingMs = getRemainingZoneMs(zone, now);

    if (!currentCircle) {
      return {
        circle: null,
        isAnimating: false,
        progress: 0,
        remainingMs,
      };
    }

    if (!nextCircle || !Number.isFinite(durationMs) || durationMs <= 0 || remainingMs === null) {
      return {
        circle: currentCircle,
        isAnimating: false,
        progress: 0,
        remainingMs,
      };
    }

    const progress = clamp01(1 - remainingMs / durationMs);
    return {
      circle: {
        centerX: lerp(currentCircle.centerX, nextCircle.centerX, progress),
        centerY: lerp(currentCircle.centerY, nextCircle.centerY, progress),
        radius: lerp(currentCircle.radius, nextCircle.radius, progress),
      },
      isAnimating: progress > 0 && progress < 1,
      progress,
      remainingMs,
    };
  }

  function clearCanvas() {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function updateRenderMetrics(width, height) {
    const stageSize = Math.max(1, Math.min(width, height));
    const scale = clamp(stageSize / RENDER_REFERENCE_PX, 0.72, 2.35);
    const metrics = state.renderMetrics;
    const labelFontSize = Math.max(10, Math.round(10.5 * scale));
    const debugFontSize = Math.max(9, Math.round(9.5 * scale));
    const focusFontSize = Math.max(10, Math.round(10 * scale));
    const focusLabelFontSize = Math.max(9, Math.round(9.5 * scale));
    const isMinimal = state.style === "minimal";

    metrics.scale = scale;
    metrics.markerRadius = (isMinimal ? 4.3 : 5.8) * scale;
    metrics.markerStrokeWidth = Math.max(1, 1.2 * scale);
    metrics.knockedCrossSize = metrics.markerRadius * 0.92;
    metrics.markerGlowBlur = (isMinimal ? 0 : 12) * scale;
    metrics.clusterStrokeWidth = Math.max(1, 1.2 * scale);
    metrics.clusterPaddingPx = 6 * scale;
    metrics.clusterMinRadiusPx = 10 * scale;
    metrics.killPingMinRadius = 7 * scale;
    metrics.killPingMaxRadius = 30 * scale;
    metrics.zoneLineWidth = Math.max(1.8, 2.35 * scale);
    metrics.nextZoneLineWidth = Math.max(1.2, 1.7 * scale);
    metrics.zoneGlowBlur = 11 * scale;
    metrics.labelFont = `700 ${labelFontSize}px ${OBS_LABEL_FONT_STACK}`;
    metrics.labelStrokeWidth = Math.max(2, 2.35 * scale);
    metrics.labelOffsetX = 8 * scale;
    metrics.labelOffsetY = 5 * scale;
    metrics.debugFont = `600 ${debugFontSize}px ${DEBUG_FONT_STACK}`;
    metrics.clusterDebugFont = `700 ${debugFontSize}px ${OBS_LABEL_FONT_STACK}`;
    metrics.debugLineHeight = debugFontSize + 4;
    metrics.focusBadgeRadius = 11.5 * scale;
    metrics.focusFont = `700 ${focusFontSize}px ${OBS_LABEL_FONT_STACK}`;
    metrics.focusLabelFont = `600 ${focusLabelFontSize}px ${OBS_LABEL_FONT_STACK}`;
  }

  function syncCanvasSize() {
    const bounds = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const nextWidth = Math.max(1, Math.round(width * dpr));
    const nextHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = true;
    }

    updateRenderMetrics(width, height);
    return { height, width };
  }

  function resolveCircleScreenGeometry(circle, mapDefinition, width, height, options) {
    if (!mapDefinition || !circle) {
      return null;
    }

    return {
      radius: Math.max(2, worldRadiusToPixelRadius(circle.radius, mapDefinition, width, height, options)),
      x: worldToPixelX(circle.centerX ?? circle.x, mapDefinition, width, options),
      y: worldToPixelY(circle.centerY ?? circle.y, mapDefinition, height, options),
    };
  }

  function drawSafeZoneShade(circle, mapDefinition, width, height) {
    if (!state.styleConfig.showZoneShade || !circle || !mapDefinition) {
      return;
    }

    const geometry = resolveCircleScreenGeometry(circle, mapDefinition, width, height);
    if (!geometry) {
      return;
    }

    context.save();
    context.fillStyle =
      state.style === "minimal" ? "rgba(2, 6, 12, 0.08)" : "rgba(2, 6, 12, 0.16)";
    context.beginPath();
    context.rect(0, 0, width, height);
    context.moveTo(geometry.x + geometry.radius, geometry.y);
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2, true);
    context.fill("evenodd");
    context.restore();
  }

  function drawNextZoneCircle(circle, mapDefinition, width, height) {
    const geometry = resolveCircleScreenGeometry(circle, mapDefinition, width, height);
    if (!geometry) {
      return;
    }

    const metrics = state.renderMetrics;
    context.save();
    context.beginPath();
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
    context.setLineDash([12 * metrics.scale, 8 * metrics.scale]);
    context.lineWidth = metrics.nextZoneLineWidth;
    context.strokeStyle = "rgba(255, 255, 255, 0.46)";
    context.stroke();
    context.restore();
  }

  function drawCurrentZoneCircle(circle, mapDefinition, width, height) {
    const geometry = resolveCircleScreenGeometry(circle, mapDefinition, width, height);
    if (!geometry) {
      return;
    }

    const metrics = state.renderMetrics;
    context.save();

    if (state.styleConfig.currentZoneFillAlpha > 0) {
      context.beginPath();
      context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(255, 255, 255, ${state.styleConfig.currentZoneFillAlpha})`;
      context.fill();
    }

    context.beginPath();
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
    context.lineWidth = metrics.zoneLineWidth * 2.1;
    context.strokeStyle = "rgba(255, 255, 255, 0.16)";
    context.shadowColor =
      state.style === "minimal" ? "rgba(255, 255, 255, 0.16)" : "rgba(151, 240, 255, 0.28)";
    context.shadowBlur = metrics.zoneGlowBlur;
    context.stroke();

    context.beginPath();
    context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
    context.lineWidth = metrics.zoneLineWidth;
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(255, 255, 255, 0.97)";
    context.stroke();
    context.restore();
  }

  function drawHotZones(hotZones, mapDefinition, width, height) {
    if (!state.assistFlags.showHotZones || !mapDefinition || !Array.isArray(hotZones)) {
      return;
    }

    for (const hotZone of hotZones.slice(0, 6)) {
      const geometry = resolveCircleScreenGeometry(hotZone, mapDefinition, width, height);
      if (!geometry) {
        continue;
      }

      const intensity = clamp01((toFiniteNumber(hotZone.score, 0) || 0) / 220);
      const teamCount = Array.isArray(hotZone.involvedTeamIds) ? hotZone.involvedTeamIds.length : 0;
      const accent =
        (hotZone.recentKillCount || 0) > 0 || teamCount >= 3 ? "#F97316" : "#FBBF24";
      const fillGradient = context.createRadialGradient(
        geometry.x,
        geometry.y,
        Math.max(4, geometry.radius * 0.16),
        geometry.x,
        geometry.y,
        geometry.radius,
      );

      fillGradient.addColorStop(0, colorWithAlpha(accent, 0.14 + intensity * 0.09));
      fillGradient.addColorStop(0.6, colorWithAlpha(accent, 0.07 + intensity * 0.05));
      fillGradient.addColorStop(1, colorWithAlpha(accent, 0));

      context.save();
      context.beginPath();
      context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
      context.fillStyle = fillGradient;
      context.fill();

      context.beginPath();
      context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
      context.lineWidth = Math.max(1, state.renderMetrics.scale * 1.35);
      context.strokeStyle = colorWithAlpha(accent, 0.16 + intensity * 0.16);
      context.stroke();
      context.restore();
    }
  }

  function drawProximityLinks(proximities, mapDefinition, width, height) {
    if (!state.assistFlags.showProximity || !mapDefinition || !Array.isArray(proximities)) {
      return;
    }

    const metrics = state.renderMetrics;

    for (const proximity of proximities.slice(0, 14)) {
      const fromX = worldToPixelX(proximity.teamACenterX, mapDefinition, width);
      const fromY = worldToPixelY(proximity.teamACenterY, mapDefinition, height);
      const toX = worldToPixelX(proximity.teamBCenterX, mapDefinition, width);
      const toY = worldToPixelY(proximity.teamBCenterY, mapDefinition, height);
      const alpha =
        proximity.severity === "high" ? 0.3 : proximity.severity === "medium" ? 0.22 : 0.14;
      const accent =
        proximity.severity === "high"
          ? "#FB7185"
          : proximity.severity === "medium"
            ? "#FBBF24"
            : "#E2E8F0";

      context.save();
      context.setLineDash([8 * metrics.scale, 8 * metrics.scale]);
      context.lineWidth = Math.max(1, 1.1 * metrics.scale);
      context.strokeStyle = colorWithAlpha(accent, alpha);
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(toX, toY);
      context.stroke();
      context.restore();
    }
  }

  function drawFocusCandidates(focusCandidates, mapDefinition, width, height) {
    if (!state.assistFlags.showFocus || !mapDefinition || !Array.isArray(focusCandidates)) {
      return;
    }

    const metrics = state.renderMetrics;

    for (let index = 0; index < focusCandidates.length; index += 1) {
      const candidate = focusCandidates[index];
      const x = worldToPixelX(candidate.centerX, mapDefinition, width);
      const y = worldToPixelY(candidate.centerY, mapDefinition, height);
      const badgeRadius = metrics.focusBadgeRadius;
      const label = truncateLabel(candidate.label, 24);
      const accent =
        candidate.category === "recent-combat"
          ? "#FB7185"
          : candidate.category === "zone-edge"
            ? "#F97316"
            : candidate.category === "cluster"
              ? "#FBBF24"
              : "#E2E8F0";

      context.save();
      context.beginPath();
      context.arc(x, y, badgeRadius, 0, Math.PI * 2);
      context.fillStyle = "rgba(5, 9, 14, 0.88)";
      context.fill();
      context.lineWidth = Math.max(1.4, metrics.scale * 1.5);
      context.strokeStyle = colorWithAlpha(accent, 0.92);
      context.stroke();

      context.font = metrics.focusFont;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = colorWithAlpha(accent, 0.98);
      context.fillText(String(index + 1), x, y + 0.5);

      const labelX = x + badgeRadius + 8 * metrics.scale;
      const labelY = y - badgeRadius;
      const paddingX = 8 * metrics.scale;
      const labelWidth = Math.ceil(context.measureText(label).width + paddingX * 2);
      const labelHeight = Math.ceil(metrics.focusBadgeRadius * 1.55);
      const resolvedLabelX = clamp(labelX, 4, Math.max(4, width - labelWidth - 4));
      const resolvedLabelY = clamp(labelY, 4, Math.max(4, height - labelHeight - 4));

      context.fillStyle = "rgba(5, 9, 14, 0.82)";
      context.strokeStyle = colorWithAlpha(accent, 0.3);
      context.lineWidth = Math.max(1, metrics.scale);
      context.beginPath();
      drawRoundedRectPath(
        context,
        resolvedLabelX,
        resolvedLabelY,
        labelWidth,
        labelHeight,
        Math.max(8, 8 * metrics.scale),
      );
      context.fill();
      context.stroke();

      context.font = metrics.focusLabelFont;
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(248, 250, 252, 0.94)";
      context.fillText(label, resolvedLabelX + paddingX, resolvedLabelY + labelHeight / 2);
      context.restore();
    }
  }

  function drawGrid(width, height, mapDefinition) {
    if (!state.debug || !state.debugFlags.showGrid || !mapDefinition) {
      return;
    }

    const stepCount = 10;
    const worldSize = resolveWorldSize(mapDefinition);

    context.save();
    context.strokeStyle = "rgba(148, 163, 184, 0.18)";
    context.lineWidth = 1;
    context.setLineDash([4, 6]);

    for (let index = 1; index < stepCount; index += 1) {
      const ratio = index / stepCount;
      const x = width * ratio;
      const y = height * ratio;

      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();

      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    if (state.debugFlags.showCoords) {
      context.setLineDash([]);
      context.font = state.renderMetrics.debugFont;
      context.fillStyle = "rgba(226, 232, 240, 0.75)";

      for (let index = 0; index <= stepCount; index += 2) {
        const ratio = index / stepCount;
        const x = width * ratio;
        const y = height * ratio;
        const worldValue = Math.round(worldSize * ratio);

        context.fillText(String(worldValue), clamp(x + 4, 4, Math.max(4, width - 56)), height - 8);
        if (index < stepCount) {
          context.fillText(
            String(Math.round(worldSize * (1 - ratio))),
            6,
            clamp(y - 4, 12, Math.max(12, height - 12)),
          );
        }
      }
    }

    context.restore();
  }

  function drawCrosshair(worldX, worldY, mapDefinition, width, height, styleOptions, options) {
    const x = worldToPixelX(worldX, mapDefinition, width, options);
    const y = worldToPixelY(worldY, mapDefinition, height, options);
    const size = styleOptions.size || 8;

    context.save();
    context.strokeStyle = styleOptions.strokeStyle || "rgba(255,255,255,0.9)";
    context.lineWidth = styleOptions.lineWidth || 1.5;
    context.beginPath();
    context.moveTo(x - size, y);
    context.lineTo(x + size, y);
    context.moveTo(x, y - size);
    context.lineTo(x, y + size);
    context.stroke();

    if (styleOptions.label) {
      context.fillStyle =
        styleOptions.fillStyle || styleOptions.strokeStyle || "rgba(255,255,255,0.95)";
      context.font = state.renderMetrics.debugFont;
      context.fillText(styleOptions.label, x + size + 4, y - size - 2);
    }
    context.restore();
  }

  function getPlayerSnapDistanceWorld() {
    const mapDefinition = getMapDefinition();
    const worldSize = resolveWorldSize(mapDefinition);
    return Math.max(2000, worldSize * PLAYER_SNAP_WORLD_RATIO);
  }

  function getInterpolatedPlayerPosition(motion, now) {
    if (!motion) {
      return null;
    }

    const duration = motion.endAt - motion.startAt;
    if (!(duration > 0)) {
      return {
        x: motion.toX,
        y: motion.toY,
      };
    }

    const progress = clamp01((now - motion.startAt) / duration);
    return {
      x: lerp(motion.fromX, motion.toX, progress),
      y: lerp(motion.fromY, motion.toY, progress),
    };
  }

  function rebuildTeamDisplayIndexes() {
    state.knownTeamIds.sort(compareTeamIds);
    state.teamDisplayIndexById.clear();

    const usedIndexes = new Set();
    for (const teamId of state.knownTeamIds) {
      const numericIndex = parseNumericTeamIndex(teamId);
      if (numericIndex !== null && !usedIndexes.has(numericIndex)) {
        state.teamDisplayIndexById.set(teamId, numericIndex);
        usedIndexes.add(numericIndex);
      }
    }

    let nextFallbackIndex = 1;
    for (const teamId of state.knownTeamIds) {
      if (state.teamDisplayIndexById.has(teamId)) {
        continue;
      }

      while (usedIndexes.has(nextFallbackIndex)) {
        nextFallbackIndex += 1;
      }

      state.teamDisplayIndexById.set(teamId, nextFallbackIndex);
      usedIndexes.add(nextFallbackIndex);
      nextFallbackIndex += 1;
    }
  }

  function ensureTeamDisplayIndex(teamId) {
    if (!teamId) {
      return null;
    }

    if (!state.teamDisplayIndexById.has(teamId)) {
      if (state.knownTeamIds.indexOf(teamId) === -1) {
        state.knownTeamIds.push(teamId);
      }
      rebuildTeamDisplayIndexes();
    }

    return state.teamDisplayIndexById.get(teamId) || null;
  }

  function resetTransientState() {
    state.assistSnapshot = null;
    state.assistMarkup = "";
    state.alertsMarkup = "";
    state.killPings.length = 0;
    state.knownTeamIds.length = 0;
    state.lastAlertsRefreshAt = 0;
    state.lastPlayerMessageAt = null;
    state.lastOperatorPanelRefreshAt = 0;
    state.lastWatchQueueRefreshAt = 0;
    state.lastPlayerSnapshotById.clear();
    state.playerMotionById.clear();
    state.playersPacket = null;
    state.productionSupportSnapshot = null;
    state.operatorPanelMarkup = "";
    state.teamClusters.length = 0;
    state.teamDisplayIndexById.clear();
    for (const members of state.teamMembersById.values()) {
      members.length = 0;
    }
    state.teamMembersById.clear();
    state.visiblePlayers.length = 0;
    state.watchQueueMarkup = "";
  }

  function applyMapContext(mapContext) {
    const nextMapKey = mapContext && mapContext.mapKey ? mapContext.mapKey : null;
    const previousMapKey = state.mapContext && state.mapContext.mapKey ? state.mapContext.mapKey : null;

    if (previousMapKey && nextMapKey && previousMapKey !== nextMapKey) {
      state.zone = null;
      resetTransientState();
    }

    state.mapContext = mapContext || null;
    loadMapImage();
  }

  function applyObserverAssistPacket(snapshot) {
    state.assistSnapshot = snapshot || null;
  }

  function applyProductionSupportPacket(snapshot) {
    state.productionSupportSnapshot = snapshot || null;
  }

  function applyZonePacket(zonePacket, receivedAt) {
    state.zone = zonePacket || null;
    state.lastZoneMessageAt = zonePacket ? receivedAt : null;
  }

  function addKillPing(x, y, teamId, startedAt) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    let ping;
    if (state.killPings.length >= KILL_PING_MAX_COUNT) {
      ping = state.killPings.shift();
    } else {
      ping = {};
    }

    ping.startedAt = startedAt;
    ping.teamId = teamId || null;
    ping.x = x;
    ping.y = y;
    state.killPings.push(ping);
  }

  function applyPlayerPacket(playersPacket, receivedAt) {
    state.playersPacket = playersPacket || null;
    const players = playersPacket && Array.isArray(playersPacket.players) ? playersPacket.players : [];
    if (!playersPacket) {
      state.lastPlayerMessageAt = null;
      return;
    }

    const seenIds = new Set();
    const snapDistance = getPlayerSnapDistanceWorld();
    const previousPacketAt = state.lastPlayerMessageAt;
    const interpolationWindowMs = clamp(
      (previousPacketAt ? receivedAt - previousPacketAt : 180) * 0.85,
      PLAYER_MIN_INTERPOLATION_MS,
      PLAYER_MAX_INTERPOLATION_MS,
    );

    for (const player of players) {
      const playerId = String(player.playerId || "").trim();
      if (!playerId) {
        continue;
      }

      const previousSnapshot = state.lastPlayerSnapshotById.get(playerId) || null;
      if (
        previousSnapshot &&
        player.alive === false &&
        previousSnapshot.alive !== false &&
        (previousSnapshot.alive === true || previousSnapshot.knocked === true)
      ) {
        addKillPing(
          toFiniteNumber(player.x, previousSnapshot.x),
          toFiniteNumber(player.y, previousSnapshot.y),
          player.teamId || previousSnapshot.teamId || null,
          receivedAt,
        );
      }

      let snapshot = previousSnapshot;
      if (!snapshot) {
        snapshot = {};
        state.lastPlayerSnapshotById.set(playerId, snapshot);
      }
      snapshot.alive = player.alive;
      snapshot.knocked = player.knocked;
      snapshot.lastSeenAt = receivedAt;
      snapshot.teamId = player.teamId || null;
      snapshot.x = player.x;
      snapshot.y = player.y;

      seenIds.add(playerId);
      const existing = state.playerMotionById.get(playerId);
      const currentPosition = existing ? getInterpolatedPlayerPosition(existing, receivedAt) : null;
      const shouldSnap =
        !currentPosition ||
        !existing ||
        receivedAt - existing.lastSeenAt > PLAYER_STALE_SNAP_MS ||
        Math.hypot(player.x - currentPosition.x, player.y - currentPosition.y) >= snapDistance;

      state.playerMotionById.set(playerId, {
        alive: player.alive,
        endAt: shouldSnap ? receivedAt : receivedAt + interpolationWindowMs,
        fromX: shouldSnap ? player.x : currentPosition.x,
        fromY: shouldSnap ? player.y : currentPosition.y,
        knocked: player.knocked,
        lastSeenAt: receivedAt,
        playerId,
        receivedAt,
        startAt: receivedAt,
        teamId: player.teamId || null,
        toX: player.x,
        toY: player.y,
      });
    }

    for (const [playerId, motion] of state.playerMotionById.entries()) {
      if (seenIds.has(playerId)) {
        continue;
      }
      if (receivedAt - motion.lastSeenAt > PLAYER_TTL_MS) {
        state.playerMotionById.delete(playerId);
      }
    }

    for (const [playerId, snapshot] of state.lastPlayerSnapshotById.entries()) {
      if (seenIds.has(playerId)) {
        continue;
      }
      if (receivedAt - snapshot.lastSeenAt > PLAYER_TTL_MS * 4) {
        state.lastPlayerSnapshotById.delete(playerId);
      }
    }

    state.lastPlayerMessageAt = receivedAt;
  }

  function getTeamMemberBuffer(teamId) {
    if (!teamId) {
      return null;
    }

    let members = state.teamMembersById.get(teamId);
    if (!members) {
      members = [];
      state.teamMembersById.set(teamId, members);
    }
    return members;
  }

  function collectVisiblePlayers(now) {
    for (const members of state.teamMembersById.values()) {
      members.length = 0;
    }

    const visiblePlayers = state.visiblePlayers;
    let visibleCount = 0;

    for (const [playerId, motion] of state.playerMotionById.entries()) {
      if (now - motion.lastSeenAt > PLAYER_TTL_MS) {
        state.playerMotionById.delete(playerId);
        continue;
      }

      const position = getInterpolatedPlayerPosition(motion, now);
      if (!position) {
        continue;
      }

      let entry = visiblePlayers[visibleCount];
      if (!entry) {
        entry = {};
        visiblePlayers[visibleCount] = entry;
      }

      const teamId = motion.teamId || null;
      const playerState =
        motion.alive === false ? "eliminated" : motion.knocked === true ? "knocked" : "alive";

      entry.alive = motion.alive;
      entry.knocked = motion.knocked;
      entry.playerId = playerId;
      entry.state = playerState;
      entry.teamColor = teamId ? getTeamColor(teamId) : "#E2E8F0";
      entry.teamId = teamId;
      entry.teamIndex = teamId ? ensureTeamDisplayIndex(teamId) : null;
      entry.x = position.x;
      entry.y = position.y;

      if (playerState !== "eliminated" && teamId) {
        const members = getTeamMemberBuffer(teamId);
        if (members) {
          members.push(entry);
        }
      }

      visibleCount += 1;
    }

    visiblePlayers.length = visibleCount;
    return visiblePlayers;
  }

  function getClusterThresholdWorld(mapDefinition) {
    return Math.max(CLUSTER_MIN_WORLD, resolveWorldSize(mapDefinition) * CLUSTER_WORLD_RATIO);
  }

  function collectTeamClusters(mapDefinition) {
    const clusters = state.teamClusters;
    if (!mapDefinition) {
      clusters.length = 0;
      return clusters;
    }

    const thresholdWorld = getClusterThresholdWorld(mapDefinition);
    let clusterCount = 0;

    for (const [teamId, members] of state.teamMembersById.entries()) {
      if (!teamId || !members || members.length < 2) {
        continue;
      }

      let sumX = 0;
      let sumY = 0;
      for (const member of members) {
        sumX += member.x;
        sumY += member.y;
      }

      const centerX = sumX / members.length;
      const centerY = sumY / members.length;
      let maxDistanceFromCenter = 0;
      let maxPairDistance = 0;

      for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
        const leftMember = members[leftIndex];
        maxDistanceFromCenter = Math.max(
          maxDistanceFromCenter,
          Math.hypot(leftMember.x - centerX, leftMember.y - centerY),
        );

        for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
          const rightMember = members[rightIndex];
          maxPairDistance = Math.max(
            maxPairDistance,
            Math.hypot(leftMember.x - rightMember.x, leftMember.y - rightMember.y),
          );
        }
      }

      if (maxPairDistance > thresholdWorld) {
        continue;
      }

      let cluster = clusters[clusterCount];
      if (!cluster) {
        cluster = {};
        clusters[clusterCount] = cluster;
      }

      cluster.centerX = centerX;
      cluster.centerY = centerY;
      cluster.memberCount = members.length;
      cluster.radiusWorld = maxDistanceFromCenter;
      cluster.teamColor = getTeamColor(teamId);
      cluster.teamId = teamId;
      cluster.teamIndex = ensureTeamDisplayIndex(teamId);
      clusterCount += 1;
    }

    clusters.length = clusterCount;
    return clusters;
  }

  function drawMarkerCross(x, y, size, color, alpha) {
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineCap = "round";
    context.lineWidth = Math.max(1.25, state.renderMetrics.markerStrokeWidth);
    context.beginPath();
    context.moveTo(x - size, y - size);
    context.lineTo(x + size, y + size);
    context.moveTo(x + size, y - size);
    context.lineTo(x - size, y + size);
    context.stroke();
    context.restore();
  }

  function drawTeamNumberLabel(player, x, y) {
    if (!state.showTeamNumbers || !player.teamIndex) {
      return;
    }

    const metrics = state.renderMetrics;
    context.save();
    context.font = metrics.labelFont;
    context.lineJoin = "round";
    context.lineWidth = metrics.labelStrokeWidth;
    context.strokeStyle = "rgba(5, 9, 14, 0.94)";
    context.fillStyle =
      player.state === "eliminated" ? "rgba(148, 163, 184, 0.62)" : player.teamColor;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.globalAlpha = player.state === "knocked" ? 0.78 : player.state === "eliminated" ? 0.34 : 1;
    const text = String(player.teamIndex);
    const labelX = x + metrics.labelOffsetX + metrics.markerRadius;
    const labelY = y - metrics.labelOffsetY * 0.15;
    context.strokeText(text, labelX, labelY);
    context.fillText(text, labelX, labelY);
    context.restore();
  }

  function drawPlayerDebugText(player, x, y) {
    if (!state.debug || (!state.debugFlags.showPlayerLabels && !state.debugFlags.showCoords)) {
      return;
    }

    const fragments = [];
    if (state.debugFlags.showPlayerLabels) {
      fragments.push(player.teamId || player.playerId || "player");
    }
    if (state.debugFlags.showCoords) {
      fragments.push(`${Math.round(player.x)},${Math.round(player.y)}`);
    }
    if (fragments.length === 0) {
      return;
    }

    context.save();
    context.font = state.renderMetrics.debugFont;
    context.lineJoin = "round";
    context.lineWidth = Math.max(2, state.renderMetrics.scale * 1.8);
    context.strokeStyle = "rgba(5, 9, 14, 0.94)";
    context.fillStyle = "rgba(248, 250, 252, 0.92)";
    context.textAlign = "left";
    context.textBaseline = "top";
    const labelX = x + state.renderMetrics.markerRadius + 8 * state.renderMetrics.scale;
    const labelY = y + 6 * state.renderMetrics.scale;
    const text = fragments.join(" | ");
    context.strokeText(text, labelX, labelY);
    context.fillText(text, labelX, labelY);
    context.restore();
  }

  function drawPlayerMarker(player, mapDefinition, width, height) {
    const x = worldToPixelX(player.x, mapDefinition, width);
    const y = worldToPixelY(player.y, mapDefinition, height);
    const metrics = state.renderMetrics;
    const isEliminated = player.state === "eliminated";
    const isKnocked = player.state === "knocked";
    const baseColor = isEliminated ? "#94A3B8" : player.teamColor;
    const fillAlpha = isEliminated ? 0.22 : isKnocked ? 0.52 : 0.96;
    const outerStroke = isEliminated
      ? "rgba(71, 85, 105, 0.48)"
      : "rgba(5, 9, 14, 0.96)";

    context.save();
    context.globalAlpha = 1;

    if (state.styleConfig.markerGlow && !isEliminated) {
      context.shadowColor = colorWithAlpha(baseColor, isKnocked ? 0.32 : 0.58);
      context.shadowBlur = metrics.markerGlowBlur;
    }

    context.beginPath();
    context.arc(x, y, metrics.markerRadius, 0, Math.PI * 2);
    context.fillStyle = colorWithAlpha(baseColor, fillAlpha);
    context.fill();
    context.lineWidth = metrics.markerStrokeWidth;
    context.strokeStyle = outerStroke;
    context.stroke();

    if (state.styleConfig.markerInnerDot && !isEliminated) {
      context.beginPath();
      context.arc(x, y, Math.max(1.25, metrics.markerRadius * 0.3), 0, Math.PI * 2);
      context.shadowBlur = 0;
      context.fillStyle = isKnocked ? "rgba(255, 255, 255, 0.58)" : "rgba(255, 255, 255, 0.78)";
      context.fill();
    }

    context.restore();

    if (isKnocked || isEliminated) {
      drawMarkerCross(
        x,
        y,
        metrics.knockedCrossSize * 0.5,
        isEliminated ? "rgba(15, 23, 42, 0.72)" : "rgba(255, 255, 255, 0.84)",
        isEliminated ? 0.48 : 0.92,
      );
    }

    drawTeamNumberLabel(player, x, y);
    drawPlayerDebugText(player, x, y);
  }

  function drawPlayers(players, mapDefinition, width, height) {
    if (!mapDefinition || players.length === 0) {
      return;
    }

    for (const player of players) {
      if (player.state !== "eliminated") {
        continue;
      }
      if (!state.debug) {
        continue;
      }
      drawPlayerMarker(player, mapDefinition, width, height);
    }

    for (const player of players) {
      if (player.state === "eliminated") {
        continue;
      }
      drawPlayerMarker(player, mapDefinition, width, height);
    }
  }

  function drawTeamClusters(clusters, mapDefinition, width, height) {
    if (!mapDefinition || clusters.length === 0) {
      return;
    }
    if (!state.debug && !state.styleConfig.showClusterRings) {
      return;
    }

    const metrics = state.renderMetrics;

    for (const cluster of clusters) {
      const x = worldToPixelX(cluster.centerX, mapDefinition, width);
      const y = worldToPixelY(cluster.centerY, mapDefinition, height);
      const radiusPx =
        Math.max(
          metrics.clusterMinRadiusPx,
          worldRadiusToPixelRadius(cluster.radiusWorld, mapDefinition, width, height) +
            metrics.clusterPaddingPx +
            metrics.markerRadius,
        );

      context.save();
      context.beginPath();
      context.arc(x, y, radiusPx, 0, Math.PI * 2);
      context.lineWidth = metrics.clusterStrokeWidth;
      context.strokeStyle = colorWithAlpha(cluster.teamColor, state.debug ? 0.55 : 0.32);
      context.stroke();
      context.restore();

      if (state.debug) {
        const radiusMeters = Math.round(cluster.radiusWorld / 100);
        const debugText = `T${cluster.teamIndex || "?"} ${radiusMeters}m`;
        context.save();
        context.font = metrics.clusterDebugFont;
        context.lineJoin = "round";
        context.lineWidth = Math.max(2, metrics.scale * 1.8);
        context.strokeStyle = "rgba(5, 9, 14, 0.94)";
        context.fillStyle = colorWithAlpha(cluster.teamColor, 0.94);
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.strokeText(debugText, x + radiusPx + 6, y);
        context.fillText(debugText, x + radiusPx + 6, y);
        context.restore();
      }
    }
  }

  function drawKillPings(now, mapDefinition, width, height) {
    if (!mapDefinition || state.killPings.length === 0) {
      return 0;
    }

    const metrics = state.renderMetrics;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < state.killPings.length; readIndex += 1) {
      const ping = state.killPings[readIndex];
      const age = now - ping.startedAt;
      if (age < 0 || age > KILL_PING_TTL_MS) {
        continue;
      }

      state.killPings[writeIndex] = ping;
      writeIndex += 1;

      const progress = clamp01(age / KILL_PING_TTL_MS);
      const alpha = 1 - progress;
      const accent = ping.teamId ? getTeamColor(ping.teamId) : "#FFFFFF";
      const x = worldToPixelX(ping.x, mapDefinition, width);
      const y = worldToPixelY(ping.y, mapDefinition, height);
      const ringRadius = metrics.killPingMinRadius + metrics.killPingMaxRadius * progress;

      context.save();
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(x, y, ringRadius, 0, Math.PI * 2);
      context.lineWidth = lerp(4.25, 1.2, progress) * metrics.scale;
      context.strokeStyle = "rgba(255, 255, 255, 0.96)";
      context.shadowColor = colorWithAlpha(accent, 0.78 * alpha);
      context.shadowBlur = metrics.markerGlowBlur + 12 * metrics.scale;
      context.stroke();

      context.beginPath();
      context.arc(x, y, Math.max(metrics.killPingMinRadius * 0.55, ringRadius * 0.22), 0, Math.PI * 2);
      context.shadowBlur = 0;
      context.fillStyle = colorWithAlpha(accent, 0.26 * alpha);
      context.fill();

      context.beginPath();
      context.arc(x, y, Math.max(metrics.killPingMinRadius, ringRadius * 0.68), 0, Math.PI * 2);
      context.lineWidth = Math.max(1, 1.1 * metrics.scale);
      context.strokeStyle = colorWithAlpha(accent, 0.76 * alpha);
      context.stroke();
      context.restore();
    }

    state.killPings.length = writeIndex;
    return writeIndex;
  }

  function drawCircleDiagnostics(zone, animatedCircle, nextCircle, mapDefinition, width, height) {
    if (!state.debug || !state.debugFlags.showCircleAnchors || !mapDefinition) {
      return;
    }

    const rawScaleOptions = {
      detectedScaleFactor: getDetectedScaleFactor(),
    };

    if (zone && zone.raw && zone.raw.currentCircle) {
      drawCrosshair(
        zone.raw.currentCircle.centerX ?? zone.raw.currentCircle.x,
        zone.raw.currentCircle.centerY ?? zone.raw.currentCircle.y,
        mapDefinition,
        width,
        height,
        {
          label: "raw",
          size: 7,
          strokeStyle: "rgba(125, 211, 252, 0.95)",
        },
        rawScaleOptions,
      );
    }

    if (animatedCircle) {
      drawCrosshair(
        animatedCircle.centerX,
        animatedCircle.centerY,
        mapDefinition,
        width,
        height,
        {
          label: "anim",
          size: 8,
          strokeStyle: "rgba(96, 165, 250, 0.98)",
        },
      );
    }

    if (nextCircle) {
      drawCrosshair(
        nextCircle.centerX,
        nextCircle.centerY,
        mapDefinition,
        width,
        height,
        {
          label: "next",
          size: 8,
          strokeStyle: "rgba(248, 250, 252, 0.94)",
        },
      );
    }
  }

  function isHeartbeatStale(now) {
    return Boolean(
      state.connectionStatus === "connected" &&
        state.lastHeartbeatAt &&
        now - state.lastHeartbeatAt > 15000,
    );
  }

  function getConnectionLabel(now) {
    if (state.connectionStatus === "connected" && isHeartbeatStale(now)) {
      return "connected (stale)";
    }

    return state.connectionStatus;
  }

  function updateStatusPill(now) {
    const mapDefinition = getMapDefinition();
    let label = "Connecting...";

    if (!mapDefinition) {
      label = "Waiting for map context";
    } else if (!mapDefinition.assetAvailable) {
      label = "Map asset missing";
    } else if (!hasLoadedImage()) {
      label = "Loading map image";
    } else if (state.connectionStatus === "connected") {
      label = isHeartbeatStale(now) ? "Telemetry stale" : "Live telemetry";
    } else if (state.connectionStatus === "error") {
      label = "Connection error";
    } else if (state.connectionStatus === "disconnected") {
      label = "Disconnected";
    }

    const text = mapDefinition ? `${mapDefinition.label} | ${label}` : label;
    if (text !== state.lastStatusLabel) {
      statusPill.textContent = text;
      state.lastStatusLabel = text;
    }
  }

  function updateTimer(remainingMs) {
    const text = formatTimer(remainingMs);
    if (text !== state.lastTimerLabel) {
      timerValue.textContent = text;
      state.lastTimerLabel = text;
    }
  }

  function formatClusterSummary(clusters) {
    if (!clusters || clusters.length === 0) {
      return "--";
    }

    return clusters
      .slice(0, 8)
      .map((cluster) => `T${cluster.teamIndex || "?"}:${Math.round(cluster.radiusWorld / 100)}m`)
      .join(" | ");
  }

  function formatAssistMatchup(teamIds) {
    const source = Array.isArray(teamIds) ? teamIds.slice().sort(compareTeamIds) : [];
    if (source.length === 0) {
      return "--";
    }
    if (source.length === 1) {
      return formatTeamLabel(source[0]);
    }
    if (source.length === 2) {
      return `${formatTeamLabel(source[0])} vs ${formatTeamLabel(source[1])}`;
    }

    return `${source.length} teams`;
  }

  function formatHotZoneSummary(hotZones) {
    if (!Array.isArray(hotZones) || hotZones.length === 0) {
      return "--";
    }

    return hotZones
      .slice(0, 4)
      .map(
        (hotZone) =>
          `${formatAssistMatchup(hotZone.involvedTeamIds)} | ${Math.round(
            toFiniteNumber(hotZone.score, 0) || 0,
          )} pts | ${hotZone.recentCombatCount || hotZone.recentKillCount || 0} combat`,
      )
      .join("\n");
  }

  function formatProximitySummary(proximities) {
    if (!Array.isArray(proximities) || proximities.length === 0) {
      return "--";
    }

    return proximities
      .slice(0, 5)
      .map((proximity) => {
        const distanceMeters = Math.round((toFiniteNumber(proximity.distance, 0) || 0) / 100);
        return `${formatTeamLabel(proximity.teamA)} vs ${formatTeamLabel(
          proximity.teamB,
        )} | ${distanceMeters}m | ${String(proximity.severity || "low").toUpperCase()}`;
      })
      .join("\n");
  }

  function formatFocusSummary(focusCandidates) {
    if (!Array.isArray(focusCandidates) || focusCandidates.length === 0) {
      return "--";
    }

    return focusCandidates
      .slice(0, 5)
      .map(
        (candidate, index) =>
          `${index + 1}. ${candidate.label} (${Math.round(toFiniteNumber(candidate.score, 0) || 0)})`,
      )
      .join("\n");
  }

  function formatCompactTeamLabel(teamId) {
    const numeric = parseNumericTeamIndex(teamId);
    if (numeric !== null) {
      return `T${numeric}`;
    }

    const normalized = typeof teamId === "string" ? teamId.trim() : "";
    return normalized ? `T${normalized}` : "T?";
  }

  function formatCompactTeamList(teamIds) {
    const source = Array.isArray(teamIds) ? teamIds.filter(Boolean).slice().sort(compareTeamIds) : [];
    if (source.length === 0) {
      return "--";
    }

    const visible = source.slice(0, 4).map(formatCompactTeamLabel).join(", ");
    return source.length > 4 ? `${visible} +${source.length - 4}` : visible;
  }

  function formatRelativeAge(value, now = Date.now()) {
    const numeric = toFiniteNumber(value);
    if (numeric === null) {
      return "--";
    }

    const deltaSeconds = Math.max(0, Math.round((now - numeric) / 1000));
    if (deltaSeconds <= 1) {
      return "now";
    }
    if (deltaSeconds < 60) {
      return `${deltaSeconds}s ago`;
    }

    const minutes = Math.floor(deltaSeconds / 60);
    const seconds = deltaSeconds % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s ago`;
  }

  function formatPanelToken(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return "--";
    }

    return normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b[a-z]/g, function (match) {
        return match.toUpperCase();
      });
  }

  function buildEmptyPanelMarkup(label) {
    return `<div class="empty-panel">${escapeHtml(label)}</div>`;
  }

  function buildOperatorActionPath(action, id, paramName = "id", scope = "operator") {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
      return "";
    }

    const params = new URLSearchParams();
    params.set(paramName, normalizedId);
    if (state.requestedMapKey) {
      params.set("map", state.requestedMapKey);
    }

    return `/debug/${scope}/${action}?${params.toString()}`;
  }

  function formatCoordinateSummary(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return "--";
    }

    return `${formatNumber(x)}, ${formatNumber(y)}`;
  }

  function formatExpiryCountdown(expiresAt, now = Date.now()) {
    const numeric = toFiniteNumber(expiresAt);
    if (numeric === null) {
      return "active";
    }

    const remainingSeconds = Math.max(0, Math.ceil((numeric - now) / 1000));
    return `${remainingSeconds}s left`;
  }

  function buildOperatorActionButtonMarkup(label, actionPath) {
    if (!actionPath) {
      return "";
    }

    return `<button class="operator-action" type="button" data-action-path="${escapeAttribute(actionPath)}">${escapeHtml(label)}</button>`;
  }

  function buildOperatorBadgesMarkup(badges) {
    const source = Array.isArray(badges) ? badges.filter(Boolean) : [];
    if (source.length === 0) {
      return "";
    }

    return [
      '<div class="operator-card-badges">',
      ...source.map((badge) => {
        const tone = badge.tone ? ` operator-badge--${escapeHtml(badge.tone)}` : "";
        return `<div class="operator-badge${tone}">${escapeHtml(badge.label)}</div>`;
      }),
      "</div>",
    ].join("");
  }

  function buildOperatorCardMarkup({ title, meta, extra, badges, actions }) {
    return [
      '<div class="operator-card">',
      '<div class="operator-card-header">',
      `<div class="operator-card-title">${escapeHtml(truncateLabel(title, 46))}</div>`,
      buildOperatorBadgesMarkup(badges),
      "</div>",
      meta ? `<div class="operator-card-meta">${escapeHtml(meta)}</div>` : "",
      extra ? `<div class="operator-card-extra">${escapeHtml(extra)}</div>` : "",
      Array.isArray(actions) && actions.length > 0
        ? `<div class="operator-actions">${actions.join("")}</div>`
        : "",
      "</div>",
    ].join("");
  }

  function buildOperatorSectionMarkup(title, bodyMarkup, meta = "") {
    return [
      '<section class="operator-section">',
      '<div class="operator-section-header">',
      `<div class="operator-section-title">${escapeHtml(title)}</div>`,
      meta ? `<div class="operator-section-meta">${escapeHtml(meta)}</div>` : "",
      "</div>",
      `<div class="operator-section-body">${bodyMarkup}</div>`,
      "</section>",
    ].join("");
  }

  function buildTargetCardMarkup(target, now, options = {}) {
    const isWatchingNow = options.forceWatching || Boolean(target.operatorWatchingNow);
    const isPinned = options.forcePinned || Boolean(target.operatorPinned);
    const isSuppressed = options.forceSuppressed || Boolean(target.operatorSuppressed);
    const isReplay = options.forceReplay || Boolean(target.operatorReplayCandidate);
    const badges = [];

    if (isWatchingNow) {
      badges.push({ label: "Watching", tone: "watching" });
    }
    if (isPinned) {
      badges.push({ label: "Pinned", tone: "pinned" });
    }
    if (isSuppressed) {
      badges.push({ label: "Suppressed", tone: "suppressed" });
    }
    if (isReplay) {
      badges.push({ label: "Replay", tone: "replay" });
    }
    if (badges.length === 0 && target.category) {
      badges.push({ label: formatPanelToken(target.category) });
    }

    const metaParts = [
      `Teams ${formatCompactTeamList(target.involvedTeamIds)}`,
      Number.isFinite(target.priority) ? `Priority ${Math.round(target.priority)}` : null,
      target.updatedAt ? `Updated ${formatRelativeAge(target.updatedAt, now)}` : null,
    ].filter(Boolean);
    const extraParts = [];

    if (Array.isArray(target.reason) && target.reason.length > 0) {
      extraParts.push(target.reason.slice(0, 3).join(" | "));
    }
    if (Number.isFinite(target.centerX) && Number.isFinite(target.centerY)) {
      extraParts.push(`Focus ${formatCoordinateSummary(target.centerX, target.centerY)}`);
    }

    const actions = [];
    if (options.allowWatchNow !== false && !isWatchingNow) {
      actions.push(buildOperatorActionButtonMarkup("Watch now", buildOperatorActionPath("watch-now", target.id)));
    }
    if (options.allowPin !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          isPinned ? "Unpin" : "Pin",
          buildOperatorActionPath(isPinned ? "unpin-target" : "pin-target", target.id),
        ),
      );
    }
    if (options.allowReplay !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          isReplay ? "Unmark" : "Replay",
          buildOperatorActionPath(isReplay ? "unmark-replay" : "mark-replay", target.id),
        ),
      );
    }
    if (options.allowSuppress !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          isSuppressed ? "Unsuppress" : "Suppress",
          buildOperatorActionPath(
            isSuppressed ? "unsuppress-target" : "suppress-target",
            target.id,
          ),
        ),
      );
    }

    return buildOperatorCardMarkup({
      title: target.label || target.id,
      meta: metaParts.join(" | "),
      extra: extraParts.join(" | "),
      badges,
      actions,
    });
  }

  function buildAlertCardMarkup(alert, now, options = {}) {
    const isReplay = options.forceReplay || Boolean(alert.operatorReplayCandidate);
    const badges = [
      { label: formatPanelToken(alert.severity || "info") },
      ...(isReplay ? [{ label: "Replay", tone: "replay" }] : []),
    ];
    const meta = [
      formatPanelToken(alert.type || "alert"),
      `Teams ${formatCompactTeamList(alert.involvedTeamIds)}`,
      alert.createdAt ? `Triggered ${formatRelativeAge(alert.createdAt, now)}` : null,
      alert.expiresAt ? `Expires ${formatExpiryCountdown(alert.expiresAt, now)}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    const extra = Number.isFinite(alert.centerX) && Number.isFinite(alert.centerY)
      ? `Focus ${formatCoordinateSummary(alert.centerX, alert.centerY)}`
      : "";
    const actions = [];

    if (options.allowReplay !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          isReplay ? "Unmark" : "Replay",
          buildOperatorActionPath(isReplay ? "unmark-replay" : "mark-replay", alert.id),
        ),
      );
    }
    if (options.allowDismiss !== false) {
      actions.push(
        buildOperatorActionButtonMarkup(
          options.dismissLabel || "Dismiss",
          buildOperatorActionPath(options.dismissAction || "dismiss-alert", alert.id),
        ),
      );
    }

    return buildOperatorCardMarkup({
      title: alert.label || alert.id,
      meta,
      extra,
      badges,
      actions,
    });
  }

  function buildPinnedTeamMarkup(teamId) {
    const actionPath = buildOperatorActionPath(
      "unpin-team",
      teamId,
      "teamId",
      "observer",
    );

    return [
      '<div class="operator-token">',
      `<span>${escapeHtml(formatTeamLabel(teamId))}</span>`,
      `<button type="button" data-action-path="${escapeAttribute(actionPath)}">unpin</button>`,
      "</div>",
    ].join("");
  }

  function buildOperatorPanelMarkup(snapshot) {
    const operatorState =
      snapshot && snapshot.operatorState && typeof snapshot.operatorState === "object"
        ? snapshot.operatorState
        : {};
    const operatorDetails =
      snapshot && snapshot.operatorDetails && typeof snapshot.operatorDetails === "object"
        ? snapshot.operatorDetails
        : {};
    const pinState = snapshot && snapshot.pinState && typeof snapshot.pinState === "object" ? snapshot.pinState : {};
    const watchTargets = Array.isArray(snapshot?.watchTargets) ? snapshot.watchTargets : [];
    const activeAlerts = Array.isArray(snapshot?.activeAlerts) ? snapshot.activeAlerts : [];
    const replayCandidates = Array.isArray(snapshot?.replayCandidates) ? snapshot.replayCandidates : [];
    const pinnedTargets = Array.isArray(pinState.pinnedTargets) ? pinState.pinnedTargets : [];
    const suppressedTargets = Array.isArray(operatorDetails.suppressedTargets)
      ? operatorDetails.suppressedTargets
      : [];
    const dismissedAlerts = Array.isArray(operatorDetails.dismissedAlerts)
      ? operatorDetails.dismissedAlerts
      : [];
    const watchingNowTarget =
      operatorDetails.watchingNowTarget ||
      watchTargets.find((target) => target.id === operatorState.watchingNowTargetId) ||
      pinnedTargets.find((target) => target.id === operatorState.watchingNowTargetId) ||
      null;
    const now = Date.now();
    const topTargets = watchTargets.filter((target) => target.id !== operatorState.watchingNowTargetId);

    const watchingMarkup = watchingNowTarget
      ? buildTargetCardMarkup(
          {
            ...watchingNowTarget,
            operatorWatchingNow: true,
            operatorPinned: Boolean(
              watchTargets.find((target) => target.id === watchingNowTarget.id)?.operatorPinned,
            ),
            operatorSuppressed: Boolean(
              watchTargets.find((target) => target.id === watchingNowTarget.id)?.operatorSuppressed,
            ),
            operatorReplayCandidate: replayCandidates.some(
              (candidate) => candidate.sourceId === watchingNowTarget.id,
            ),
          },
          now,
          {
            allowWatchNow: false,
          },
        )
      : buildEmptyPanelMarkup("No active watched target.");

    const topTargetsMarkup =
      topTargets.length > 0
        ? topTargets.slice(0, 5).map((target) => buildTargetCardMarkup(target, now)).join("")
        : buildEmptyPanelMarkup("No active watch targets.");

    const activeAlertsMarkup =
      activeAlerts.length > 0
        ? activeAlerts.slice(0, 5).map((alert) => buildAlertCardMarkup(alert, now)).join("")
        : buildEmptyPanelMarkup("No active production alerts.");

    const replayCandidatesMarkup =
      replayCandidates.length > 0
        ? replayCandidates.map((candidate) => {
            const meta = [
              formatPanelToken(candidate.sourceType),
              `Teams ${formatCompactTeamList(candidate.involvedTeamIds)}`,
              `Marked ${formatRelativeAge(candidate.createdAt, now)}`,
              candidate.expiresAt ? `Expires ${formatExpiryCountdown(candidate.expiresAt, now)}` : null,
            ]
              .filter(Boolean)
              .join(" | ");
            const extra = Number.isFinite(candidate.centerX) && Number.isFinite(candidate.centerY)
              ? `Focus ${formatCoordinateSummary(candidate.centerX, candidate.centerY)}`
              : "";
            return buildOperatorCardMarkup({
              title: candidate.label || candidate.id,
              meta,
              extra,
              badges: [{ label: formatPanelToken(candidate.sourceType) }, { label: "Replay", tone: "replay" }],
              actions: [
                buildOperatorActionButtonMarkup(
                  "Unmark",
                  buildOperatorActionPath("unmark-replay", candidate.sourceId),
                ),
              ],
            });
          }).join("")
        : buildEmptyPanelMarkup("No replay candidates.");

    const pinsAndSuppressionsParts = [];
    if (Array.isArray(pinState.pinnedTeams) && pinState.pinnedTeams.length > 0) {
      pinsAndSuppressionsParts.push(
        `<div class="operator-token-list">${pinState.pinnedTeams.map(buildPinnedTeamMarkup).join("")}</div>`,
      );
    }
    if (pinnedTargets.length > 0) {
      pinsAndSuppressionsParts.push(
        pinnedTargets
          .filter((target) => target.id !== operatorState.watchingNowTargetId)
          .slice(0, 4)
          .map((target) => buildTargetCardMarkup({ ...target, operatorPinned: true }, now, { allowReplay: false }))
          .join(""),
      );
    }
    if (suppressedTargets.length > 0) {
      pinsAndSuppressionsParts.push(
        suppressedTargets
          .map((target) =>
            buildTargetCardMarkup(
              {
                ...target,
                updatedAt: target.suppressedAt,
                operatorSuppressed: true,
              },
              now,
              {
                allowPin: false,
              },
            ),
          )
          .join(""),
      );
    }
    if (dismissedAlerts.length > 0) {
      pinsAndSuppressionsParts.push(
        dismissedAlerts
          .map((alert) =>
            buildAlertCardMarkup(
              {
                ...alert,
                type: "dismissed_alert",
                severity: "info",
                createdAt: alert.dismissedAt,
              },
              now,
              {
                allowReplay: false,
                dismissAction: "undismiss-alert",
                dismissLabel: "Undo",
              },
            ),
          )
          .join(""),
      );
    }

    const pinsAndSuppressionsMarkup =
      pinsAndSuppressionsParts.length > 0
        ? pinsAndSuppressionsParts.join("")
        : buildEmptyPanelMarkup("No pins, suppressions, or dismissed alerts.");

    return [
      buildOperatorSectionMarkup("Watching Now", watchingMarkup, watchingNowTarget ? "live focus" : ""),
      buildOperatorSectionMarkup("Top Watch Targets", topTargetsMarkup, `${topTargets.length} visible`),
      buildOperatorSectionMarkup("Active Alerts", activeAlertsMarkup, `${activeAlerts.length} live`),
      buildOperatorSectionMarkup("Replay Candidates", replayCandidatesMarkup, `${replayCandidates.length} queued`),
      buildOperatorSectionMarkup("Pins / Suppressions", pinsAndSuppressionsMarkup, `${suppressedTargets.length} suppressed`),
    ].join("");
  }

  function buildWatchQueueMarkup(snapshot) {
    const watchTargets = Array.isArray(snapshot?.watchTargets) ? snapshot.watchTargets : [];
    if (watchTargets.length === 0) {
      return buildEmptyPanelMarkup("No active watch targets.");
    }

    const now = Date.now();
    return watchTargets
      .map((target, index) => {
        const score = Math.round(toFiniteNumber(target.score, 0) || 0);
        const priority = Math.round(toFiniteNumber(target.priority, 0) || 0);
        const badgeLabel = target.operatorWatchingNow
          ? "Watching"
          : target.operatorSuppressed
            ? "Suppressed"
            : target.operatorPinned
              ? "Pinned"
              : formatPanelToken(target.category);
        const meta = [
          `#${index + 1}`,
          `Score ${score}`,
          `Priority ${priority}`,
          `Teams ${formatCompactTeamList(target.involvedTeamIds)}`,
          `Updated ${formatRelativeAge(target.updatedAt, now)}`,
        ].join(" | ");
        const reasons = Array.isArray(target.reason) && target.reason.length > 0
          ? target.reason.slice(0, 3).join(" | ")
          : "No reason available";

        return [
          '<div class="watch-item">',
          '<div class="watch-item-header">',
          `<div class="watch-item-title">${escapeHtml(truncateLabel(target.label, 44))}</div>`,
          `<div class="watch-item-badge">${escapeHtml(badgeLabel)}</div>`,
          "</div>",
          `<div class="watch-item-meta">${escapeHtml(meta)}</div>`,
          `<div class="watch-item-reasons">${escapeHtml(reasons)}</div>`,
          "</div>",
        ].join("");
      })
      .join("");
  }

  function buildAlertsMarkup(snapshot) {
    const activeAlerts = Array.isArray(snapshot?.activeAlerts) ? snapshot.activeAlerts : [];
    if (activeAlerts.length === 0) {
      return buildEmptyPanelMarkup("No active production alerts.");
    }

    const now = Date.now();
    return activeAlerts
      .map((alert) => {
        const meta = [
          formatPanelToken(alert.type),
          `Teams ${formatCompactTeamList(alert.involvedTeamIds)}`,
          `Triggered ${formatRelativeAge(alert.createdAt, now)}`,
          alert.operatorReplayCandidate ? "Replay marked" : null,
        ]
          .filter(Boolean)
          .join(" | ");

        return [
          '<div class="alert-item">',
          '<div class="alert-item-header">',
          `<div class="alert-item-title">${escapeHtml(truncateLabel(alert.label, 48))}</div>`,
          `<div class="alert-item-badge alert-item-badge--${escapeHtml(String(alert.severity || "info").toLowerCase())}">${escapeHtml(formatPanelToken(alert.severity))}</div>`,
          "</div>",
          `<div class="alert-item-meta">${escapeHtml(meta)}</div>`,
          "</div>",
        ].join("");
      })
      .join("");
  }

  function buildAssistMarkup(snapshot) {
    const rows = [
      ["focus", formatFocusSummary(snapshot?.focusCandidates)],
      ["hot zones", formatHotZoneSummary(snapshot?.hotZones)],
      ["nearby teams", formatProximitySummary(snapshot?.teamProximities)],
      ["recent combat", snapshot ? String(snapshot.recentCombatCount ?? 0) : "--"],
      ["active fights", snapshot ? String(snapshot.activeFightCount ?? 0) : "--"],
      ["last update", snapshot ? formatTimestamp(snapshot.updatedAt) : "--"],
    ];

    return rows
      .map(
        ([label, value]) =>
          `<div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div>`,
      )
      .join("");
  }

  function buildDebugMarkup(frame) {
    const mapDefinition = getMapDefinition();
    const zone = state.zone;
    const playersPacket = state.playersPacket;
    const imageSize = resolveImageDimensions();
    const coordinate = getScaleMetadata();
    const assistSnapshot = state.assistSnapshot;
    const productionSupportSnapshot = state.productionSupportSnapshot;
    const observerControlSuggestion = productionSupportSnapshot
      ? productionSupportSnapshot.observerControlSuggestion || null
      : null;
    const warnings = [];

    if (mapDefinition && mapDefinition.notes) {
      warnings.push(mapDefinition.notes);
    }
    if (zone && Array.isArray(zone.warnings)) {
      warnings.push(...zone.warnings);
    }
    if (playersPacket && Array.isArray(playersPacket.warnings)) {
      warnings.push(...playersPacket.warnings);
    }

    const rows = [
      ["connection", getConnectionLabel(frame.now)],
      ["render style", state.style],
      ["team labels", state.showTeamNumbers ? "enabled" : "disabled"],
      ["map key", mapDefinition ? mapDefinition.key : "--"],
      ["world size", mapDefinition ? String(mapDefinition.worldSize) : "--"],
      [
        "image dims",
        imageSize.width && imageSize.height ? `${imageSize.width} x ${imageSize.height}` : "--",
      ],
      ["scale hint", coordinate ? String(coordinate.scaleHint ?? "--") : "--"],
      ["scale mode", coordinate ? String(coordinate.scaleMode ?? "--") : "--"],
      [
        "raw zone center",
        zone && zone.raw && zone.raw.currentCircle
          ? `${formatNumber(zone.raw.currentCircle.centerX ?? zone.raw.currentCircle.x)}, ${formatNumber(zone.raw.currentCircle.centerY ?? zone.raw.currentCircle.y)}`
          : "--",
      ],
      [
        "raw zone radius",
        zone && zone.raw && zone.raw.currentCircle ? formatNumber(zone.raw.currentCircle.radius) : "--",
      ],
      ["animated zone", formatCircle(frame.animatedCircle)],
      ["next zone", formatCircle(frame.nextCircle)],
      ["telemetry remaining", zone ? formatRemainingDetails(getZoneDurationMs(zone)) : "--"],
      ["live remaining", formatRemainingDetails(frame.remainingMs)],
      ["target end", formatTimestamp(zone && zone.targetEndAt)],
      ["zone packet ts", formatTimestamp(zone && zone.timestamp)],
      ["zone received", formatTimestamp(zone && zone.receivedAt)],
      ["player packet ts", formatTimestamp(playersPacket && playersPacket.timestamp)],
      ["player received", formatTimestamp(playersPacket && playersPacket.receivedAt)],
      ["last message", formatTimestamp(state.lastMessageAt)],
      [
        "timing source",
        zone && zone.timing && zone.timing.timingSource ? zone.timing.timingSource : "--",
      ],
      [
        "transport latency",
        zone && zone.timing && Number.isFinite(zone.timing.transportLatencyMs)
          ? `${Math.round(zone.timing.transportLatencyMs)} ms`
          : "--",
      ],
      ["player count", String(frame.players.length)],
      ["cluster count", String(frame.clusters.length)],
      ["cluster radii", formatClusterSummary(frame.clusters)],
      ["assist hot zones", String(frame.hotZones.length)],
      ["assist proximity", String(frame.proximities.length)],
      ["assist focus", String(frame.focusCandidates.length)],
      [
        "watch targets",
        String(productionSupportSnapshot ? productionSupportSnapshot.watchTargets?.length ?? 0 : 0),
      ],
      [
        "active alerts",
        String(productionSupportSnapshot ? productionSupportSnapshot.activeAlerts?.length ?? 0 : 0),
      ],
      [
        "split risks",
        String(productionSupportSnapshot ? productionSupportSnapshot.teamSplitRisks?.length ?? 0 : 0),
      ],
      [
        "pinned teams",
        productionSupportSnapshot
          ? formatCompactTeamList(productionSupportSnapshot.pinState?.pinnedTeams)
          : "--",
      ],
      [
        "pinned targets",
        productionSupportSnapshot
          ? String(productionSupportSnapshot.pinState?.pinnedTargetIds?.length ?? 0)
          : "--",
      ],
      [
        "watching now",
        productionSupportSnapshot?.operatorState?.watchingNowTargetId || "--",
      ],
      [
        "replay candidates",
        String(productionSupportSnapshot ? productionSupportSnapshot.replayCandidates?.length ?? 0 : 0),
      ],
      [
        "suppressed targets",
        productionSupportSnapshot?.operatorState?.suppressedTargetIds?.length
          ? productionSupportSnapshot.operatorState.suppressedTargetIds.join(", ")
          : "--",
      ],
      [
        "dismissed alerts",
        String(productionSupportSnapshot ? productionSupportSnapshot.operatorState?.dismissedAlertIds?.length ?? 0 : 0),
      ],
      [
        "suggested focus",
        observerControlSuggestion && observerControlSuggestion.suggestedFocusCenter
          ? `${formatNumber(observerControlSuggestion.suggestedFocusCenter.x)}, ${formatNumber(observerControlSuggestion.suggestedFocusCenter.y)}`
          : "--",
      ],
      ["recent combat", String(assistSnapshot ? assistSnapshot.recentCombatCount ?? 0 : 0)],
      ["active kill pings", String(frame.killPingCount)],
      ["map note", mapDefinition && mapDefinition.notes ? mapDefinition.notes : "--"],
      ["warnings", warnings.length > 0 ? warnings.join(" | ") : "--"],
    ];

    return rows
      .map(
        ([label, value]) =>
          `<div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div>`,
      )
      .join("");
  }

  function updateAssistPanel(frame) {
    assistPanel.hidden = !state.assistFlags.showPanel;
    if (!state.assistFlags.showPanel) {
      return;
    }

    if (frame.now - state.lastAssistRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildAssistMarkup(state.assistSnapshot);
    if (markup !== state.assistMarkup) {
      assistGrid.innerHTML = markup;
      state.assistMarkup = markup;
    }
    state.lastAssistRefreshAt = frame.now;
  }

  function updateOperatorPanel(frame) {
    operatorPanel.hidden = !state.operatorFlags.showPanel;
    if (!state.operatorFlags.showPanel) {
      return;
    }

    if (frame.now - state.lastOperatorPanelRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildOperatorPanelMarkup(state.productionSupportSnapshot);
    if (markup !== state.operatorPanelMarkup) {
      operatorPanelBody.innerHTML = markup;
      state.operatorPanelMarkup = markup;
    }
    state.lastOperatorPanelRefreshAt = frame.now;
  }

  function updateWatchQueuePanel(frame) {
    watchQueuePanel.hidden = !state.operatorFlags.showWatchQueue;
    if (!state.operatorFlags.showWatchQueue) {
      return;
    }

    if (frame.now - state.lastWatchQueueRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildWatchQueueMarkup(state.productionSupportSnapshot);
    if (markup !== state.watchQueueMarkup) {
      watchQueueList.innerHTML = markup;
      state.watchQueueMarkup = markup;
    }
    state.lastWatchQueueRefreshAt = frame.now;
  }

  function updateAlertsPanel(frame) {
    alertsPanel.hidden = !state.operatorFlags.showAlerts;
    if (!state.operatorFlags.showAlerts) {
      return;
    }

    if (frame.now - state.lastAlertsRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildAlertsMarkup(state.productionSupportSnapshot);
    if (markup !== state.alertsMarkup) {
      alertsList.innerHTML = markup;
      state.alertsMarkup = markup;
    }
    state.lastAlertsRefreshAt = frame.now;
  }

  function syncOperatorStackVisibility() {
    operatorStack.hidden = !(
      state.assistFlags.showPanel ||
      state.operatorFlags.showPanel ||
      state.operatorFlags.showWatchQueue ||
      state.operatorFlags.showAlerts
    );
  }

  function updateDebug(frame) {
    debugPanel.hidden = !state.debug;
    if (!state.debug) {
      return;
    }

    if (frame.now - state.lastDebugRefreshAt < DEBUG_REFRESH_MS) {
      return;
    }

    const markup = buildDebugMarkup(frame);
    if (markup !== state.debugMarkup) {
      debugGrid.innerHTML = markup;
      state.debugMarkup = markup;
    }
    state.lastDebugRefreshAt = frame.now;
  }

  function loadMapImage() {
    const mapDefinition = getMapDefinition();
    if (!mapDefinition || !mapDefinition.imageUrl) {
      return;
    }

    if (image.dataset.currentSrc === mapDefinition.imageUrl) {
      return;
    }

    image.dataset.currentSrc = mapDefinition.imageUrl;
    image.src = mapDefinition.imageUrl;
  }

  function drawFrame(now) {
    const mapDefinition = getMapDefinition();
    const assistSnapshot = state.assistSnapshot;
    const bounds = syncCanvasSize();
    const zoneAnimation = getAnimatedCircleState(state.zone, now);
    const nextCircle = getNextCircle(state.zone);
    const visiblePlayers = collectVisiblePlayers(now);
    const clusters = collectTeamClusters(mapDefinition);
    const hotZones =
      assistSnapshot && Array.isArray(assistSnapshot.hotZones) ? assistSnapshot.hotZones : [];
    const proximities =
      assistSnapshot && Array.isArray(assistSnapshot.teamProximities)
        ? assistSnapshot.teamProximities
        : [];
    const focusCandidates =
      assistSnapshot && Array.isArray(assistSnapshot.focusCandidates)
        ? assistSnapshot.focusCandidates
        : [];

    clearCanvas();
    drawGrid(bounds.width, bounds.height, mapDefinition);

    if (mapDefinition && zoneAnimation.circle) {
      drawSafeZoneShade(zoneAnimation.circle, mapDefinition, bounds.width, bounds.height);
    }

    drawHotZones(hotZones, mapDefinition, bounds.width, bounds.height);

    if (mapDefinition && nextCircle) {
      drawNextZoneCircle(nextCircle, mapDefinition, bounds.width, bounds.height);
    }

    if (mapDefinition && zoneAnimation.circle) {
      drawCurrentZoneCircle(zoneAnimation.circle, mapDefinition, bounds.width, bounds.height);
    }

    drawProximityLinks(proximities, mapDefinition, bounds.width, bounds.height);
    drawTeamClusters(clusters, mapDefinition, bounds.width, bounds.height);
    const activeKillPingCount = drawKillPings(now, mapDefinition, bounds.width, bounds.height);
    drawPlayers(visiblePlayers, mapDefinition, bounds.width, bounds.height);
    drawFocusCandidates(focusCandidates, mapDefinition, bounds.width, bounds.height);
    drawCircleDiagnostics(
      state.zone,
      zoneAnimation.circle,
      nextCircle,
      mapDefinition,
      bounds.width,
      bounds.height,
    );

    state.frame.animatedCircle = zoneAnimation.circle;
    state.frame.clusters = clusters;
    state.frame.focusCandidates = focusCandidates;
    state.frame.hotZones = hotZones;
    state.frame.killPingCount = activeKillPingCount;
    state.frame.nextCircle = nextCircle;
    state.frame.now = now;
    state.frame.players = visiblePlayers;
    state.frame.proximities = proximities;
    state.frame.remainingMs = zoneAnimation.remainingMs;

    updateStatusPill(now);
    updateTimer(state.frame.remainingMs);
    syncOperatorStackVisibility();
    updateAssistPanel(state.frame);
    updateOperatorPanel(state.frame);
    updateWatchQueuePanel(state.frame);
    updateAlertsPanel(state.frame);
    updateDebug(state.frame);
    window.requestAnimationFrame(renderLoop);
  }

  function buildSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL(`${protocol}//${window.location.host}${bootstrap.wsPath || "/ws"}`);
    if (state.requestedMapKey) {
      url.searchParams.set("map", state.requestedMapKey);
    }
    return url.toString();
  }

  function setConnectionStatus(status) {
    state.connectionStatus = status;
  }

  function scheduleReconnect() {
    if (state.socketReconnectTimer) {
      return;
    }

    state.socketReconnectTimer = window.setTimeout(function () {
      state.socketReconnectTimer = null;
      connect();
    }, 2000);
  }

  function handleMessage(data) {
    let message;
    try {
      message = typeof data === "string" ? JSON.parse(data) : data;
    } catch (_) {
      return;
    }

    const receivedAt = Date.now();
    state.lastMessageAt = receivedAt;

    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
      case "map_context":
        applyMapContext(message.payload || null);
        break;
      case "zone_update":
        applyZonePacket(message.payload || null, receivedAt);
        break;
      case "player_positions":
        applyPlayerPacket(message.payload || null, receivedAt);
        break;
      case "observer_assist":
        applyObserverAssistPacket(message.payload || null);
        break;
      case "production_support":
        applyProductionSupportPacket(message.payload || null);
        break;
      case "heartbeat":
        state.lastHeartbeatAt = receivedAt;
        break;
      default:
        break;
    }
  }

  async function runOperatorAction(actionPath, trigger) {
    if (!actionPath || state.lastOperatorActionPath === actionPath) {
      return;
    }

    state.lastOperatorActionPath = actionPath;
    if (trigger) {
      trigger.disabled = true;
    }

    try {
      const response = await window.fetch(actionPath, {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (payload && payload.productionSupport) {
        applyProductionSupportPacket(payload.productionSupport);
        state.lastOperatorPanelRefreshAt = 0;
        state.lastWatchQueueRefreshAt = 0;
        state.lastAlertsRefreshAt = 0;
        state.lastDebugRefreshAt = 0;
      }
    } catch (_) {
      // Ignore transient local operator route failures in the OBS widget.
    } finally {
      state.lastOperatorActionPath = "";
      if (trigger) {
        trigger.disabled = false;
      }
    }
  }

  function handleOperatorPanelClick(event) {
    const actionButton =
      event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-action-path]")
        : null;
    if (!actionButton) {
      return;
    }

    event.preventDefault();
    const actionPath = actionButton.getAttribute("data-action-path");
    runOperatorAction(actionPath, actionButton);
  }

  function connect() {
    if (
      state.socket &&
      (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(buildSocketUrl());
    state.socket = socket;
    setConnectionStatus("connecting");

    socket.addEventListener("open", function () {
      state.lastHeartbeatAt = Date.now();
      setConnectionStatus("connected");
    });

    socket.addEventListener("message", function (event) {
      handleMessage(event.data);
    });

    socket.addEventListener("close", function () {
      if (state.socket === socket) {
        state.socket = null;
      }
      setConnectionStatus("disconnected");
      scheduleReconnect();
    });

    socket.addEventListener("error", function () {
      setConnectionStatus("error");
    });
  }

  function renderLoop() {
    drawFrame(Date.now());
  }

  image.addEventListener("load", function () {
    syncCanvasSize();
  });

  image.addEventListener("error", function () {
    updateStatusPill(Date.now());
  });

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(function () {
      syncCanvasSize();
    });
    resizeObserver.observe(stage);
  }

  window.addEventListener("resize", function () {
    syncCanvasSize();
  });

  operatorPanel.addEventListener("click", handleOperatorPanelClick);

  applyMapContext(bootstrap.snapshot ? bootstrap.snapshot.mapContext : null);
  applyZonePacket(
    bootstrap.snapshot ? bootstrap.snapshot.zone : null,
    toFiniteNumber(bootstrap.serverTime, Date.now()),
  );
  applyPlayerPacket(
    bootstrap.snapshot ? bootstrap.snapshot.players : null,
    toFiniteNumber(bootstrap.serverTime, Date.now()),
  );
  applyObserverAssistPacket(bootstrap.snapshot ? bootstrap.snapshot.observerAssist : null);
  applyProductionSupportPacket(bootstrap.snapshot ? bootstrap.snapshot.productionSupport : null);
  syncCanvasSize();
  loadMapImage();
  connect();
  window.requestAnimationFrame(renderLoop);
})();
```
