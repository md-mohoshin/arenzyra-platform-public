"use strict";

function clonePinnedTarget(target) {
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
    mapKey: target.mapKey || null,
  };
}

function normalizeTeamId(teamId) {
  return typeof teamId === "string" && teamId.trim() ? teamId.trim() : null;
}

function normalizePinnedTarget(target) {
  if (!target || typeof target !== "object") {
    return null;
  }

  const id = String(target.id || "").trim();
  if (!id) {
    return null;
  }

  return {
    id,
    label: String(target.label || "").trim() || id,
    score: Number.isFinite(target.score) ? target.score : 0,
    centerX: Number.isFinite(target.centerX) ? target.centerX : 0,
    centerY: Number.isFinite(target.centerY) ? target.centerY : 0,
    category: target.category === "pinned" ? "pinned" : target.category || "pinned",
    involvedTeamIds: Array.isArray(target.involvedTeamIds)
      ? target.involvedTeamIds.filter((teamId) => typeof teamId === "string" && teamId.trim())
      : [],
    reason: Array.isArray(target.reason)
      ? target.reason.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [],
    updatedAt: Number.isFinite(target.updatedAt) ? target.updatedAt : Date.now(),
    priority: Number.isFinite(target.priority) ? target.priority : 0,
    mapKey: typeof target.mapKey === "string" && target.mapKey.trim() ? target.mapKey.trim() : null,
  };
}

function createPinnedWatchStore() {
  const pinnedTeams = new Set();
  const pinnedTargetsById = new Map();

  function pinTeam(teamId) {
    const normalized = normalizeTeamId(teamId);
    if (!normalized) {
      return false;
    }

    pinnedTeams.add(normalized);
    return true;
  }

  function unpinTeam(teamId) {
    const normalized = normalizeTeamId(teamId);
    if (!normalized) {
      return false;
    }

    return pinnedTeams.delete(normalized);
  }

  function pinTarget(target) {
    const normalized = normalizePinnedTarget(target);
    if (!normalized) {
      return false;
    }

    pinnedTargetsById.set(normalized.id, normalized);
    return true;
  }

  function updatePinnedTargets(mapKey, watchTargets) {
    const normalizedMapKey =
      typeof mapKey === "string" && mapKey.trim() ? mapKey.trim() : null;
    const source = Array.isArray(watchTargets) ? watchTargets : [];

    for (const watchTarget of source) {
      if (!pinnedTargetsById.has(watchTarget.id)) {
        continue;
      }

      pinTarget({
        ...watchTarget,
        mapKey: normalizedMapKey,
      });
    }
  }

  function unpinTarget(id) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) {
      return false;
    }

    return pinnedTargetsById.delete(normalizedId);
  }

  function isTeamPinned(teamId) {
    const normalized = normalizeTeamId(teamId);
    return normalized ? pinnedTeams.has(normalized) : false;
  }

  function isTargetPinned(id) {
    const normalizedId = String(id || "").trim();
    return normalizedId ? pinnedTargetsById.has(normalizedId) : false;
  }

  function getState() {
    const teams = Array.from(pinnedTeams.values()).sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
    );
    const targets = Array.from(pinnedTargetsById.values()).map(clonePinnedTarget);
    targets.sort((left, right) => right.updatedAt - left.updatedAt);

    return {
      pinnedTeams: teams,
      pinnedTargetIds: targets.map((target) => target.id),
      pinnedTargets: targets,
    };
  }

  function clear() {
    pinnedTeams.clear();
    pinnedTargetsById.clear();
  }

  return {
    clear,
    getState,
    isTargetPinned,
    isTeamPinned,
    pinTarget,
    pinTeam,
    unpinTarget,
    unpinTeam,
    updatePinnedTargets,
  };
}

module.exports = {
  createPinnedWatchStore,
};
