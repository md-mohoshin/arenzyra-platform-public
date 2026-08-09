"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildObserverRuntimeIdentity,
  getExpectedObserverRuntime,
  matchesExpectedObserverRuntime,
} = require("./observer-runtime-health.cjs");

test("connector health exposes exact direct runtime identity without feed token", () => {
  const runtime = buildObserverRuntimeIdentity({
    OBSERVER_FORWARD_ENABLE: "true",
    ARENZYRA_OBSERVER_RUNTIME_NONCE: "runtime-nonce-1",
    MATCH_ID: "match-1",
    OBSERVER_SESSION_ID: "session-1",
    ARENZYRA_OBSERVER_FEED_TOKEN: "must-not-leak",
  });

  assert.deepEqual(runtime, {
    nonce: "runtime-nonce-1",
    mode: "direct",
    matchId: "match-1",
    sessionId: "session-1",
  });
  assert.equal(JSON.stringify(runtime).includes("must-not-leak"), false);
});

test("launcher rejects stale or foreign runtime health identity", () => {
  const expected = getExpectedObserverRuntime({
    mode: "direct",
    runtimeNonce: "runtime-nonce-1",
    matchId: "match-1",
    sessionId: "session-1",
  });
  assert.equal(matchesExpectedObserverRuntime({ ...expected }, expected), true);

  for (const mismatch of [
    { ...expected, nonce: "stale-runtime" },
    { ...expected, mode: "local" },
    { ...expected, matchId: "match-2" },
    { ...expected, sessionId: "session-2" },
    null,
  ]) {
    assert.equal(matchesExpectedObserverRuntime(mismatch, expected), false);
  }
});

test("local connector health omits direct match authority", () => {
  assert.deepEqual(buildObserverRuntimeIdentity({}), {
    nonce: null,
    mode: "local",
    matchId: null,
    sessionId: null,
  });
});

test("launcher can bind a managed local connector to its exact runtime nonce", () => {
  const expected = getExpectedObserverRuntime({
    mode: "local",
    runtimeNonce: "local-runtime-nonce-1",
  });

  assert.deepEqual(expected, {
    nonce: "local-runtime-nonce-1",
    mode: "local",
    matchId: "",
    sessionId: "",
  });
  assert.equal(
    matchesExpectedObserverRuntime(
      {
        nonce: "local-runtime-nonce-1",
        mode: "local",
        matchId: null,
        sessionId: null,
      },
      expected,
    ),
    true,
  );
  assert.equal(
    matchesExpectedObserverRuntime(
      {
        nonce: "foreign-runtime-nonce",
        mode: "local",
        matchId: null,
        sessionId: null,
      },
      expected,
    ),
    false,
  );
});

test("root connector publishes the shared identity contract on health", () => {
  const connectorSource = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "..", "ob.js"),
    "utf8",
  );
  assert.match(
    connectorSource,
    /require\(resolveConnectorModulePath\("observer-runtime-health\.cjs"\)\)/,
  );
  assert.match(
    connectorSource,
    /app\.get\("\/health"[\s\S]*runtime:\s*buildObserverRuntimeIdentity\(process\.env\)/,
  );
});
