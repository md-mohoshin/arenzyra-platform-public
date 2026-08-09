"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createObserverRuntimeWatchdog,
} = require("./observerRuntimeWatchdog.cjs");

function createFakeClock() {
  let currentTime = Date.parse("2026-08-02T12:00:00.000Z");
  let nextId = 1;
  const timers = new Map();

  async function flush() {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  }

  return {
    now: () => currentTime,
    setTimer(callback, delayMs) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, dueAt: currentTime + delayMs });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    async advanceBy(durationMs) {
      const target = currentTime + durationMs;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= target)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        currentTime = timer.dueAt;
        timer.callback();
        await flush();
      }
      currentTime = target;
      await flush();
    },
    timerCount: () => timers.size,
  };
}

test("watchdog recycles only after three consecutive local health failures", async () => {
  const clock = createFakeClock();
  const unhealthyCalls = [];
  const probeCalls = [];
  const watchdog = createObserverRuntimeWatchdog({
    intervalMs: 2_000,
    failureThreshold: 3,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    probe: async (config) => {
      probeCalls.push(config);
      return { healthy: false, error: "identity health failed" };
    },
    onUnhealthy: async (config, context) => {
      unhealthyCalls.push({ config, context });
    },
  });
  const config = {
    mode: "direct",
    matchId: "match-1",
    sessionId: "session-1",
    runtimeNonce: "nonce-1",
  };
  watchdog.start(config);

  await clock.advanceBy(2_000);
  assert.equal(watchdog.getStatus().state, "degraded");
  assert.equal(watchdog.getStatus().consecutiveFailures, 1);
  assert.equal(unhealthyCalls.length, 0);
  await clock.advanceBy(2_000);
  assert.equal(watchdog.getStatus().consecutiveFailures, 2);
  assert.equal(unhealthyCalls.length, 0);
  await clock.advanceBy(2_000);

  assert.equal(probeCalls.length, 3);
  assert.equal(unhealthyCalls.length, 1);
  assert.deepEqual(unhealthyCalls[0].config, config);
  assert.equal(unhealthyCalls[0].context.isCurrent(), true);
  assert.equal(watchdog.getStatus().state, "recycling");
  assert.equal(clock.timerCount(), 0);
});

test("one healthy exact-runtime response clears the failure streak", async () => {
  const clock = createFakeClock();
  const outcomes = [false, false, true, false];
  let unhealthyCount = 0;
  const watchdog = createObserverRuntimeWatchdog({
    intervalMs: 10,
    failureThreshold: 3,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    probe: async () => ({ healthy: outcomes.shift() }),
    onUnhealthy: async () => {
      unhealthyCount += 1;
    },
  });
  watchdog.start({ runtimeNonce: "nonce-1" });

  await clock.advanceBy(20);
  assert.equal(watchdog.getStatus().consecutiveFailures, 2);
  await clock.advanceBy(10);
  assert.equal(watchdog.getStatus().state, "healthy");
  assert.equal(watchdog.getStatus().consecutiveFailures, 0);
  await clock.advanceBy(10);
  assert.equal(watchdog.getStatus().consecutiveFailures, 1);
  assert.equal(unhealthyCount, 0);
});

test("stop cancels scheduled checks and ignores a stale in-flight result", async () => {
  const clock = createFakeClock();
  let resolveProbe;
  let unhealthyCount = 0;
  const watchdog = createObserverRuntimeWatchdog({
    intervalMs: 10,
    failureThreshold: 1,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    probe: () =>
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    onUnhealthy: async () => {
      unhealthyCount += 1;
    },
  });
  watchdog.start({ runtimeNonce: "nonce-1" });
  await clock.advanceBy(10);

  watchdog.stop();
  resolveProbe({ healthy: false });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(unhealthyCount, 0);
  assert.equal(watchdog.getStatus().state, "idle");
  assert.equal(clock.timerCount(), 0);
});
