"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveDesiredObserverFallbackMapKey,
  resolveLiveMatchMapSyncPlan,
} = require("./liveMatchMapSync.cjs");

function createObserverFeedState(overrides = {}) {
  return {
    enabled: true,
    running: true,
    managed: true,
    mode: "direct",
    matchId: "match-live",
    recoveryState: "healthy",
    ...overrides,
  };
}

test("accepts a registered map update for the exact authenticated LIVE match", () => {
  assert.deepEqual(
    resolveLiveMatchMapSyncPlan({
      liveMatch: {
        source: "me/active-match",
        status: "LIVE",
        matchId: "match-live",
        map: "DESERT_MAIN",
      },
      productionModeState: {
        matchId: "match-live",
        selectedMapKey: "erangel",
      },
      observerFeedState: createObserverFeedState(),
    }),
    {
      matchId: "match-live",
      mapKey: "miramar",
      previousMapKey: "erangel",
      mapChanged: true,
      productionMatch: true,
      observerMatch: true,
    },
  );
});

test("accepts the same map during recovery so a failed runtime update can retry", () => {
  const plan = resolveLiveMatchMapSyncPlan({
    liveMatch: {
      source: "me/active-match",
      status: "LIVE",
      matchId: "match-live",
      map: "MIRAMAR",
    },
    productionModeState: {
      matchId: "match-live",
      selectedMapKey: "miramar",
    },
    observerFeedState: createObserverFeedState({
      running: false,
      recoveryState: "waiting",
    }),
  });

  assert.equal(plan?.mapKey, "miramar");
  assert.equal(plan?.mapChanged, false);
  assert.equal(plan?.observerMatch, true);
});

test("rejects public, non-LIVE, unrelated, and unsupported map metadata", () => {
  const baseline = {
    liveMatch: {
      source: "me/active-match",
      status: "LIVE",
      matchId: "match-live",
      map: "MIRAMAR",
    },
    productionModeState: {
      matchId: "match-live",
      selectedMapKey: "erangel",
    },
    observerFeedState: createObserverFeedState(),
  };

  assert.equal(
    resolveLiveMatchMapSyncPlan({
      ...baseline,
      liveMatch: { ...baseline.liveMatch, source: "public/live-match" },
    }),
    null,
  );
  assert.equal(
    resolveLiveMatchMapSyncPlan({
      ...baseline,
      liveMatch: { ...baseline.liveMatch, status: "READY" },
    }),
    null,
  );
  assert.equal(
    resolveLiveMatchMapSyncPlan({
      ...baseline,
      liveMatch: { ...baseline.liveMatch, matchId: "match-other" },
    }),
    null,
  );
  assert.equal(
    resolveLiveMatchMapSyncPlan({
      ...baseline,
      liveMatch: { ...baseline.liveMatch, map: "unknown_future_map" },
    }),
    null,
  );
});

test("an active observer match remains an exact guard when production state is absent", () => {
  const plan = resolveLiveMatchMapSyncPlan({
    liveMatch: {
      source: "me/active-match",
      status: "LIVE",
      matchId: "match-live",
      map: "NEON_MAIN",
    },
    productionModeState: {},
    observerFeedState: createObserverFeedState(),
  });

  assert.equal(plan?.mapKey, "rondo");
  assert.equal(plan?.productionMatch, false);
  assert.equal(plan?.observerMatch, true);
});

test("recovery uses the latest same-match map and never another match's map", () => {
  assert.equal(
    resolveDesiredObserverFallbackMapKey({
      matchId: "match-live",
      liveMapState: { matchId: "match-live", mapKey: "miramar" },
      productionModeState: {
        matchId: "match-live",
        selectedMapKey: "erangel",
      },
      bootstrapMapKey: "erangel",
    }),
    "miramar",
  );

  assert.equal(
    resolveDesiredObserverFallbackMapKey({
      matchId: "match-live",
      liveMapState: { matchId: "match-other", mapKey: "rondo" },
      productionModeState: { matchId: "match-other", selectedMapKey: "taego" },
      bootstrapMapKey: "BALTIC_MAIN",
    }),
    "erangel",
  );
});

test("launcher hot-sync is authenticated, retryable, and never restarts the feed", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const applyStart = source.indexOf(
    "function applyAuthoritativeLiveMatchMap(",
  );
  const applyEnd = source.indexOf(
    "\nasync function refreshAuthoritativeLiveMatchMap(",
    applyStart,
  );
  const applySource = source.slice(applyStart, applyEnd);
  const requestStart = source.indexOf(
    "async function requestExactObserverRuntimeMapFallback(",
  );
  const requestEnd = source.indexOf(
    "\nasync function drainObserverMapFallbackSyncQueue(",
    requestStart,
  );
  const requestSource = source.slice(requestStart, requestEnd);

  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  assert.match(applySource, /resolveLiveMatchMapSyncPlan/);
  assert.match(applySource, /scheduleObserverMapFallbackSync/);
  assert.doesNotMatch(applySource, /stopObserverFeed|clearWidgetRuntimeState/);

  assert.ok(requestStart >= 0 && requestEnd > requestStart);
  assert.match(requestSource, /\/debug\/observer\/map-fallback/);
  assert.match(requestSource, /X-Arenzyra-Connector-Token/);
  assert.match(requestSource, /X-Arenzyra-Runtime-Nonce/);
  assert.match(requestSource, /fallbackMapKey === target\.mapKey/);
});

test("main-process polling and recovery both reuse the latest desired map", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(
    source,
    /LIVE_MATCH_MAP_REFRESH_INTERVAL_MS = 5_000/,
  );
  assert.match(
    source,
    /refreshAuthoritativeLiveMatchMap\(session\)/,
  );
  assert.match(
    source,
    /mapKey:\s*getDesiredObserverFallbackMapKey\(config\.matchId, config\.mapKey\)/,
  );
  assert.match(
    source,
    /getForcedMapKey:\s*\(\) => getDesiredObserverFallbackMapKey\(\)/,
  );
});

test("map refresh invalidates only the direct poller and does not reset widget state", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "widget-server", "server.cjs"),
    "utf8",
  );
  const start = source.indexOf("refreshDirectObserverSnapshot() {");
  const end = source.indexOf("\n    clearRuntimeState(", start);
  const refreshSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(refreshSource, /directObserverPoller\.reset\(\)/);
  assert.doesNotMatch(
    refreshSource,
    /runtime_reset|telemetryBridge\.reset|engine\.clearRuntimeState/,
  );
});

test("a transient connector failure retries with bounded cancellable backoff", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const retryStart = source.indexOf(
    "function scheduleObserverMapFallbackRetry(",
  );
  const retryEnd = source.indexOf(
    "\nasync function drainObserverMapFallbackSyncQueue(",
    retryStart,
  );
  const retrySource = source.slice(retryStart, retryEnd);
  const drainEnd = source.indexOf(
    "\nfunction ensureObserverMapFallbackSyncDrain(",
    retryEnd,
  );
  const drainSource = source.slice(retryEnd, drainEnd);
  const scheduleStart = source.indexOf(
    "function scheduleObserverMapFallbackSync(",
    drainEnd,
  );
  const scheduleEnd = source.indexOf(
    "\nfunction hasChildProcessExited(",
    scheduleStart,
  );
  const scheduleSource = source.slice(scheduleStart, scheduleEnd);

  assert.ok(retryStart >= 0 && retryEnd > retryStart);
  assert.match(retrySource, /OBSERVER_MAP_FALLBACK_RETRY_DELAYS_MS/);
  assert.match(retrySource, /isCurrentObserverMapFallbackSyncTarget/);
  assert.match(retrySource, /setTimeout/);
  assert.match(retrySource, /\.unref\?\.\(\)/);
  assert.match(drainSource, /scheduleObserverMapFallbackRetry\(target\)/);
  assert.match(scheduleSource, /retryingSameTarget/);
  assert.match(scheduleSource, /retryScheduled: true/);
  assert.match(
    scheduleSource,
    /observerMapFallbackRetryTarget && !retryingSameTarget/,
  );
  assert.match(
    scheduleSource,
    /observerMapFallbackInFlightIdentity === target\.identity/,
  );
  assert.match(
    scheduleSource,
    /observerMapFallbackSyncDesired\.identity !== target\.identity[\s\S]*observerMapFallbackSyncDesired = null/,
  );
  assert.match(
    drainSource,
    /timed-out local POST[\s\S]*observerMapFallbackLastAppliedIdentity = null/,
  );
});
