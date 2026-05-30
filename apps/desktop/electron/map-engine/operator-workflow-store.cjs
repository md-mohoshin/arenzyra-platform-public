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
