"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePcobMapControlLifecycle,
} = require("./pcobMapControlPolicy.cjs");

function resolve(overrides = {}) {
  return resolvePcobMapControlLifecycle({
    matchFlow: {
      currentMatchId: "match-1",
      currentStatus: "LIVE",
      ...overrides.matchFlow,
    },
    telemetry: {
      running: true,
      matchId: "match-1",
      telemetryAccepted: true,
      ...overrides.telemetry,
    },
    observerFeed: {
      running: false,
      ready: false,
      matchId: null,
      ...overrides.observerFeed,
    },
  });
}

test("PCOB map switching becomes eligible for a live match with accepted telemetry", () => {
  const status = resolve();

  assert.equal(status.eligible, true);
  assert.equal(status.matchLive, true);
  assert.equal(status.telemetrySourceReady, true);
  assert.equal(status.telemetrySource, "telemetry-bridge");
});

test("PCOB map switching becomes ineligible as soon as the match finishes", () => {
  for (const currentStatus of ["FINISH_PENDING", "ENDED", "FINISHED"]) {
    const status = resolve({
      matchFlow: { currentStatus },
    });

    assert.equal(status.eligible, false, currentStatus);
    assert.equal(status.matchFinished, true, currentStatus);
  }
});

test("PCOB map switching requires an explicit LIVE web-app match state", () => {
  for (const currentStatus of ["READY", "PAUSED", null]) {
    const status = resolve({
      matchFlow: { currentStatus },
    });

    assert.equal(status.eligible, false, String(currentStatus));
    assert.equal(status.matchLive, false, String(currentStatus));
  }
});

test("PCOB map switching stays disabled when telemetry stops or belongs to another match", () => {
  assert.equal(
    resolve({
      telemetry: { running: false },
    }).eligible,
    false,
  );
  assert.equal(
    resolve({
      telemetry: { matchId: "match-2" },
    }).eligible,
    false,
  );
  assert.equal(
    resolve({
      telemetry: {
        telemetryAccepted: false,
        telemetryActive: false,
      },
    }).eligible,
    false,
  );
});

test("PCOB map switching recovers automatically when accepted telemetry returns", () => {
  const lost = resolve({
    telemetry: {
      telemetryAccepted: false,
      telemetryActive: false,
    },
  });
  const recovered = resolve();

  assert.equal(lost.eligible, false);
  assert.equal(recovered.eligible, true);
});

test("PCOB map switching accepts a ready direct observer feed for the live match", () => {
  const status = resolve({
    telemetry: {
      running: false,
      telemetryAccepted: false,
    },
    observerFeed: {
      running: true,
      ready: true,
      matchId: "match-1",
    },
  });

  assert.equal(status.eligible, true);
  assert.equal(status.telemetrySource, "observer-feed");
});
