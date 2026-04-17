"use strict";

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cloneHistoryEntry(entry) {
  return {
    action: entry.action,
    currentTargetId: entry.currentTargetId,
    recommendedTargetId: entry.recommendedTargetId,
    generatedAt: entry.generatedAt,
  };
}

function createCameraRecommendationHistory() {
  let currentWatchedTargetId = null;
  let lastSwitchAt = null;
  let previousTargetId = null;
  let lastAction = null;
  let lastRecommendationAt = null;
  const recentRecommendationHistory = [];

  function getRetentionMs(config = {}) {
    const flapWindowMs = Math.max(
      5_000,
      Math.round(config.RECOMMENDATION_FLAP_WINDOW_MS ?? 16_000),
    );
    return Math.max(45_000, flapWindowMs * 3);
  }

  function getMaxEntries(config = {}) {
    return Math.max(
      4,
      Math.min(20, Math.round(config.MAX_CAMERA_RECOMMENDATION_HISTORY ?? 10)),
    );
  }

  function purgeHistory(now = Date.now(), config = {}) {
    const retentionMs = getRetentionMs(config);
    const maxEntries = getMaxEntries(config);
    const minGeneratedAt = now - retentionMs;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < recentRecommendationHistory.length; readIndex += 1) {
      const entry = recentRecommendationHistory[readIndex];
      if (!entry || entry.generatedAt < minGeneratedAt) {
        continue;
      }

      recentRecommendationHistory[writeIndex] = entry;
      writeIndex += 1;
    }

    recentRecommendationHistory.length = writeIndex;

    if (recentRecommendationHistory.length > maxEntries) {
      recentRecommendationHistory.splice(
        0,
        recentRecommendationHistory.length - maxEntries,
      );
    }
  }

  function observeWatchedTarget(targetId, switchedAt = null, now = Date.now()) {
    const normalizedTargetId = normalizeId(targetId);
    if (currentWatchedTargetId === normalizedTargetId) {
      if (
        normalizedTargetId &&
        Number.isFinite(switchedAt) &&
        (!Number.isFinite(lastSwitchAt) || switchedAt > lastSwitchAt)
      ) {
        lastSwitchAt = switchedAt;
      }
      return false;
    }

    if (currentWatchedTargetId && currentWatchedTargetId !== normalizedTargetId) {
      previousTargetId = currentWatchedTargetId;
    }

    currentWatchedTargetId = normalizedTargetId;
    if (normalizedTargetId) {
      lastSwitchAt = Number.isFinite(switchedAt) ? switchedAt : now;
    }

    return true;
  }

  function recordRecommendation(recommendation, now = Date.now(), config = {}) {
    if (!recommendation || typeof recommendation !== "object") {
      return false;
    }

    purgeHistory(now, config);

    const entry = {
      action: String(recommendation.action || "stay"),
      currentTargetId: normalizeId(recommendation.currentTargetId),
      recommendedTargetId: normalizeId(recommendation.recommendedTargetId),
      generatedAt: Number.isFinite(recommendation.generatedAt)
        ? recommendation.generatedAt
        : now,
    };

    const lastEntry =
      recentRecommendationHistory.length > 0
        ? recentRecommendationHistory[recentRecommendationHistory.length - 1]
        : null;

    if (
      lastEntry &&
      lastEntry.action === entry.action &&
      lastEntry.currentTargetId === entry.currentTargetId &&
      lastEntry.recommendedTargetId === entry.recommendedTargetId
    ) {
      lastEntry.generatedAt = entry.generatedAt;
    } else {
      recentRecommendationHistory.push(entry);
      purgeHistory(now, config);
    }

    lastAction = entry.action;
    lastRecommendationAt = entry.generatedAt;
    return true;
  }

  function getState(now = Date.now(), config = {}) {
    purgeHistory(now, config);

    return {
      currentWatchedTargetId,
      lastSwitchAt,
      previousTargetId,
      lastAction,
      lastRecommendationAt,
      recentRecommendationHistory: recentRecommendationHistory.map(cloneHistoryEntry),
    };
  }

  function reset() {
    currentWatchedTargetId = null;
    lastSwitchAt = null;
    previousTargetId = null;
    lastAction = null;
    lastRecommendationAt = null;
    recentRecommendationHistory.length = 0;
  }

  return {
    getState,
    observeWatchedTarget,
    recordRecommendation,
    reset,
  };
}

module.exports = {
  createCameraRecommendationHistory,
};
