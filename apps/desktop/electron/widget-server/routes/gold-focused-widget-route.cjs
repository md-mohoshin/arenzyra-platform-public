"use strict";

const {
  normalizeObserverFocus,
} = require("./obs-player-photo-route.cjs");
const {
  buildGoldFocusedWidgetState,
} = require("./gold-focused-widget-state.cjs");

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readQueryValue(value) {
  return asString(Array.isArray(value) ? value[0] : value);
}

function safelyRead(reader) {
  if (typeof reader !== "function") return null;
  try {
    return asRecord(reader());
  } catch {
    return null;
  }
}

function resolveMatchContext(getCurrentMatchContext) {
  const context = safelyRead(getCurrentMatchContext);
  return {
    matchId: asString(context?.matchId) || null,
    source: asString(context?.source) || null,
    workflowState: asString(context?.workflowState) || null,
    productionStatus: asString(context?.productionStatus) || null,
  };
}

function registerGoldFocusedWidgetRoute(
  app,
  {
    getCurrentMatchContext = () => null,
    getLocalObserverSnapshot = () => null,
    getLocalWidgetSnapshot = () => null,
    getPlayerAssetsVersion = () => null,
  } = {},
) {
  let cachedPlayerAssetsVersion = "0:0";
  let playerAssetsVersionCheckedAt = 0;

  function resolvePlayerAssetsVersion() {
    const now = Date.now();
    if (now - playerAssetsVersionCheckedAt < 1_000) {
      return cachedPlayerAssetsVersion;
    }
    playerAssetsVersionCheckedAt = now;
    try {
      cachedPlayerAssetsVersion = asString(getPlayerAssetsVersion()) || "0:0";
    } catch {
      // Keep the last known version during a transient filesystem failure.
    }
    return cachedPlayerAssetsVersion;
  }

  app.get("/obs/gold-focused/state", (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    const current = resolveMatchContext(getCurrentMatchContext);
    const requestedMatchId = readQueryValue(req.query?.matchId) || null;

    if (requestedMatchId && requestedMatchId !== current.matchId) {
      res.json({
        ok: true,
        matchId: current.matchId,
        goldFocused: null,
        reason: current.matchId ? "match changed" : "match unavailable",
        source: current.source,
        workflowState: current.workflowState,
        productionStatus: current.productionStatus,
      });
      return;
    }

    const localObserverSnapshot = safelyRead(getLocalObserverSnapshot);
    const localWidgetSnapshot = safelyRead(getLocalWidgetSnapshot);
    const focus = normalizeObserverFocus(
      localObserverSnapshot?.observer || localObserverSnapshot,
    );
    const matchId = current.matchId || requestedMatchId;
    const goldFocused = buildGoldFocusedWidgetState({
      matchId,
      focus,
      localObserverSnapshot,
      localWidgetSnapshot,
      playerAssetsVersion: resolvePlayerAssetsVersion(),
    });

    res.json({
      ok: true,
      matchId,
      goldFocused,
      source: current.source || localObserverSnapshot?.source || null,
      workflowState: current.workflowState,
      productionStatus: current.productionStatus,
    });
  });
}

module.exports = {
  registerGoldFocusedWidgetRoute,
  resolveMatchContext,
};
