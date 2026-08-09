"use strict";

const { resolveRegisteredMapKey } = require("./productionModeService.cjs");

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isActiveDirectObserverMatch(observerFeedState, matchId) {
  const observerMatchId = normalizeString(observerFeedState?.matchId);
  if (!observerMatchId || observerMatchId !== matchId) {
    return false;
  }

  return Boolean(
    normalizeString(observerFeedState?.mode).toLowerCase() === "direct" &&
      observerFeedState?.managed === true &&
      (observerFeedState?.enabled === true ||
        observerFeedState?.running === true ||
        ["waiting", "restarting"].includes(
          normalizeString(observerFeedState?.recoveryState).toLowerCase(),
        )),
  );
}

function resolveLiveMatchMapSyncPlan({
  liveMatch,
  productionModeState,
  observerFeedState,
} = {}) {
  if (!liveMatch || typeof liveMatch !== "object" || Array.isArray(liveMatch)) {
    return null;
  }

  // Only organization-scoped authenticated metadata is allowed to steer a
  // running launcher. Public live-match fallbacks may belong to another org.
  if (normalizeString(liveMatch.source) !== "me/active-match") {
    return null;
  }

  const status = normalizeString(liveMatch.status).toUpperCase();
  if (status !== "LIVE") {
    return null;
  }

  const matchId = normalizeString(liveMatch.matchId);
  const mapKey = resolveRegisteredMapKey(liveMatch.map);
  if (!matchId || !mapKey) {
    return null;
  }

  const productionMatchId = normalizeString(productionModeState?.matchId);
  const productionMatch = productionMatchId === matchId;
  const observerMatch = isActiveDirectObserverMatch(observerFeedState, matchId);
  if (!productionMatch && !observerMatch) {
    return null;
  }

  const previousMapKey = resolveRegisteredMapKey(
    productionModeState?.selectedMapKey,
  );
  return {
    matchId,
    mapKey,
    previousMapKey,
    mapChanged: previousMapKey !== mapKey,
    productionMatch,
    observerMatch,
  };
}

function resolveDesiredObserverFallbackMapKey({
  matchId,
  liveMapState,
  productionModeState,
  bootstrapMapKey = null,
} = {}) {
  const normalizedMatchId = normalizeString(matchId);
  if (!normalizedMatchId) {
    return resolveRegisteredMapKey(bootstrapMapKey);
  }

  if (normalizeString(liveMapState?.matchId) === normalizedMatchId) {
    const liveMapKey = resolveRegisteredMapKey(liveMapState?.mapKey);
    if (liveMapKey) {
      return liveMapKey;
    }
  }

  if (normalizeString(productionModeState?.matchId) === normalizedMatchId) {
    const productionMapKey = resolveRegisteredMapKey(
      productionModeState?.selectedMapKey,
    );
    if (productionMapKey) {
      return productionMapKey;
    }
  }

  return resolveRegisteredMapKey(bootstrapMapKey);
}

module.exports = {
  resolveDesiredObserverFallbackMapKey,
  resolveLiveMatchMapSyncPlan,
};
