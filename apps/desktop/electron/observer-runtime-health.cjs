"use strict";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildObserverRuntimeIdentity(env = {}) {
  const directMode =
    normalizeString(env.OBSERVER_FORWARD_ENABLE).toLowerCase() === "true";
  return {
    nonce: normalizeString(env.ARENZYRA_OBSERVER_RUNTIME_NONCE) || null,
    mode: directMode ? "direct" : "local",
    matchId:
      normalizeString(env.MATCH_ID) ||
      normalizeString(env.OBSERVER_MATCH_ID) ||
      normalizeString(env.PCOB_MATCH_ID) ||
      null,
    sessionId:
      normalizeString(env.OBSERVER_SESSION_ID) ||
      normalizeString(env.SESSION_ID) ||
      null,
  };
}

function getExpectedObserverRuntime(config) {
  const nonce = normalizeString(config?.runtimeNonce);
  if (!nonce) {
    return null;
  }

  const directMode = normalizeString(config?.mode).toLowerCase() === "direct";

  return {
    nonce,
    mode: directMode ? "direct" : "local",
    matchId: directMode ? normalizeString(config.matchId) : "",
    sessionId: directMode ? normalizeString(config.sessionId) : "",
  };
}

function matchesExpectedObserverRuntime(runtime, expectedRuntime) {
  if (!expectedRuntime) {
    return true;
  }

  return Boolean(
    runtime &&
      typeof runtime === "object" &&
      normalizeString(runtime.nonce) === expectedRuntime.nonce &&
      normalizeString(runtime.mode).toLowerCase() === expectedRuntime.mode &&
      normalizeString(runtime.matchId) === expectedRuntime.matchId &&
      normalizeString(runtime.sessionId) === expectedRuntime.sessionId,
  );
}

module.exports = {
  buildObserverRuntimeIdentity,
  getExpectedObserverRuntime,
  matchesExpectedObserverRuntime,
};
