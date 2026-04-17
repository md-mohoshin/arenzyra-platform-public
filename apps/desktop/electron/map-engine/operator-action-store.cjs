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
