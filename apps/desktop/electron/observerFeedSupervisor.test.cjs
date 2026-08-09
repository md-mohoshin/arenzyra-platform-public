"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  OBSERVER_FEED_START_CANCELLED_ERROR_CODE,
  createObserverFeedStartGate,
  createObserverFeedSupervisor,
  sameObserverFeedConfig,
  stopObserverProcessWithConfirmation,
} = require("./observerFeedSupervisor.cjs");

const BASE_TIME = Date.parse("2026-08-02T10:00:00.000Z");
const DIRECT_CONFIG = Object.freeze({
  mode: "direct",
  apiBase: "https://api.example.test",
  matchId: "match-1",
  sessionId: "session-1",
  feedToken: "secret-feed-token",
  mapKey: "erangel",
  scriptPath: "C:\\PCOB\\ObToolsNew\\ob.js",
});

function createFakeClock() {
  let currentTime = BASE_TIME;
  let nextTimerId = 1;
  const timers = new Map();

  const flushPromises = async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  };

  return {
    now: () => currentTime,
    setTimer(callback, delayMs) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, {
        callback,
        dueAt: currentTime + Math.max(0, Number(delayMs) || 0),
      });
      return timerId;
    },
    clearTimer(timerId) {
      timers.delete(timerId);
    },
    async advanceBy(durationMs) {
      const targetTime = currentTime + durationMs;
      while (true) {
        const nextEntry = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= targetTime)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
        if (!nextEntry) {
          break;
        }
        const [timerId, timer] = nextEntry;
        timers.delete(timerId);
        currentTime = timer.dueAt;
        timer.callback();
        await flushPromises();
      }
      currentTime = targetTime;
      await flushPromises();
    },
    pendingTimerCount: () => timers.size,
  };
}

function createTestSupervisor(overrides = {}) {
  const clock = overrides.clock || createFakeClock();
  const restartCalls = [];
  const guardCalls = [];
  const supervisor = createObserverFeedSupervisor({
    restartDelaysMs: [1_000, 2_000, 5_000],
    maxRestartAttempts: 3,
    restartWindowMs: 120_000,
    stableRunMs: 60_000,
    jitterRatio: 0,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    canRestart: async (config, context) => {
      guardCalls.push({ config, context });
      if (overrides.canRestart) {
        return overrides.canRestart(config, context);
      }
      return { allowed: true };
    },
    restart: async (config, context) => {
      restartCalls.push({ config, context });
      if (overrides.restart) {
        return overrides.restart(config, context);
      }
      return { ok: true };
    },
  });

  return { clock, guardCalls, restartCalls, supervisor };
}

test("start gate cancels an in-flight start immediately", () => {
  const gate = createObserverFeedStartGate();
  const operation = gate.begin();

  assert.equal(operation.isCurrent(), true);
  assert.equal(gate.hasPending(), true);
  assert.equal(gate.cancel("operator-stop"), true);
  assert.equal(operation.signal.aborted, true);
  assert.equal(operation.isCurrent(), false);
  assert.equal(gate.hasPending(), false);
  assert.throws(
    () => operation.assertCurrent(),
    (error) =>
      error?.code === OBSERVER_FEED_START_CANCELLED_ERROR_CODE &&
      /operator-stop/.test(error.message),
  );
});

test("a stale start cannot finish or cancel its replacement", () => {
  const gate = createObserverFeedStartGate();
  const staleOperation = gate.begin();
  const currentOperation = gate.begin();

  assert.equal(staleOperation.signal.aborted, true);
  assert.equal(staleOperation.isCurrent(), false);
  assert.equal(currentOperation.isCurrent(), true);

  staleOperation.finish();
  assert.equal(currentOperation.isCurrent(), true);
  assert.equal(gate.hasPending(), true);

  currentOperation.finish();
  assert.equal(gate.hasPending(), false);
});

test("confirmed stop waits for exit and exact runtime disappearance", async () => {
  const calls = [];
  const result = await stopObserverProcessWithConfirmation({
    child: { pid: 321 },
    graceTimeoutMs: 1_250,
    forceTimeoutMs: 1_750,
    identityTimeoutMs: 1_000,
    kill: async (pid, options) => {
      calls.push(["kill", pid, options.force]);
      return true;
    },
    waitForExit: async (_child, timeoutMs) => {
      calls.push(["exit", timeoutMs]);
      return true;
    },
    waitForIdentityGone: async (timeoutMs) => {
      calls.push(["identity", timeoutMs]);
      return true;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.stopped, true);
  assert.deepEqual(calls, [
    ["kill", 321, false],
    ["exit", 1_250],
    ["identity", 1_000],
  ]);
});

test("confirmed stop force-kills after grace but never claims a live identity stopped", async () => {
  const killModes = [];
  let exitChecks = 0;
  const result = await stopObserverProcessWithConfirmation({
    child: { pid: 654 },
    graceTimeoutMs: 1_250,
    forceTimeoutMs: 1_750,
    identityTimeoutMs: 1_000,
    kill: async (_pid, options) => {
      killModes.push(options.force);
      return true;
    },
    waitForExit: async () => {
      exitChecks += 1;
      return exitChecks >= 2;
    },
    waitForIdentityGone: async () => false,
  });

  assert.deepEqual(killModes, [false, true]);
  assert.equal(result.processExited, true);
  assert.equal(result.exactRuntimeGone, false);
  assert.equal(result.ok, false);
  assert.match(result.error, /exact runtime identity is still responding/);
});

test("confirmed stop fails closed when the child never exits", async () => {
  let identityChecks = 0;
  const result = await stopObserverProcessWithConfirmation({
    child: { pid: 987 },
    kill: async () => false,
    waitForExit: async () => false,
    waitForIdentityGone: async () => {
      identityChecks += 1;
      return true;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.processExited, false);
  assert.equal(identityChecks, 0);
  assert.match(result.error, /did not exit/);
});

test("unexpected exit restarts the exact match session after bounded backoff", async () => {
  const { clock, guardCalls, restartCalls, supervisor } = createTestSupervisor();
  supervisor.arm(DIRECT_CONFIG);

  const recovery = supervisor.handleUnexpectedExit(DIRECT_CONFIG, {
    error: "connector exited with code 1",
  });
  assert.equal(recovery.scheduled, true);
  assert.equal(recovery.status.state, "waiting");
  assert.equal(recovery.status.restartAttempts, 1);
  assert.equal(recovery.status.nextRestartAt, "2026-08-02T10:00:01.000Z");

  await clock.advanceBy(999);
  assert.equal(restartCalls.length, 0);
  await clock.advanceBy(1);

  assert.equal(guardCalls.length, 1);
  assert.equal(restartCalls.length, 1);
  assert.deepEqual(restartCalls[0].config, DIRECT_CONFIG);
  assert.equal(restartCalls[0].context.signal.aborted, false);
  assert.equal(restartCalls[0].context.isCurrent(), true);
  assert.equal(supervisor.getStatus().state, "healthy");
  assert.equal(supervisor.getStatus().restartAttempts, 1);
  assert.equal(
    supervisor.getStatus().lastRestartAt,
    "2026-08-02T10:00:01.000Z",
  );

  await clock.advanceBy(60_000);
  assert.equal(supervisor.getStatus().restartAttempts, 0);
});

test("disarm cancels pending recovery so intentional stops never restart", async () => {
  const { clock, restartCalls, supervisor } = createTestSupervisor();
  supervisor.arm(DIRECT_CONFIG);
  supervisor.handleUnexpectedExit(DIRECT_CONFIG, { error: "unexpected exit" });

  supervisor.disarm();
  await clock.advanceBy(60_000);

  assert.equal(restartCalls.length, 0);
  assert.equal(clock.pendingTimerCount(), 0);
  assert.equal(supervisor.getStatus().state, "idle");
});

test("an error followed by exit schedules only one replacement", async () => {
  const { clock, restartCalls, supervisor } = createTestSupervisor();
  supervisor.arm(DIRECT_CONFIG);

  const errorRecovery = supervisor.handleUnexpectedExit(DIRECT_CONFIG, {
    error: "spawn error",
  });
  const exitRecovery = supervisor.handleUnexpectedExit(DIRECT_CONFIG, {
    error: "exit after error",
  });
  assert.equal(errorRecovery.scheduled, true);
  assert.equal(exitRecovery.scheduled, false);

  await clock.advanceBy(1_000);
  assert.equal(restartCalls.length, 1);
  assert.equal(supervisor.getStatus().state, "healthy");
});

test("stale exit from a previous match session cannot restart", async () => {
  const { clock, restartCalls, supervisor } = createTestSupervisor();
  const nextConfig = {
    ...DIRECT_CONFIG,
    matchId: "match-2",
    sessionId: "session-2",
    feedToken: "new-secret-feed-token",
  };
  supervisor.arm(DIRECT_CONFIG);
  supervisor.arm(nextConfig);

  const staleRecovery = supervisor.handleUnexpectedExit(DIRECT_CONFIG, {
    error: "late exit event",
  });
  await clock.advanceBy(60_000);

  assert.equal(staleRecovery.scheduled, false);
  assert.equal(restartCalls.length, 0);
  assert.equal(supervisor.getStatus().state, "healthy");
  assert.equal(supervisor.isActiveFor(nextConfig), true);
  assert.equal(supervisor.isActiveFor(DIRECT_CONFIG), false);
});

test("terminal lifecycle or session authority blocks recovery", async () => {
  const { clock, restartCalls, supervisor } = createTestSupervisor({
    canRestart: async () => ({
      allowed: false,
      terminal: true,
      reason: "Match session binding changed.",
    }),
  });
  supervisor.arm(DIRECT_CONFIG);
  supervisor.handleUnexpectedExit(DIRECT_CONFIG, { error: "unexpected exit" });

  await clock.advanceBy(1_000);

  assert.equal(restartCalls.length, 0);
  assert.equal(supervisor.getStatus().state, "blocked");
  assert.equal(
    supervisor.getStatus().blockedReason,
    "Match session binding changed.",
  );
  assert.equal(clock.pendingTimerCount(), 0);
});

test("repeated failures open the circuit after the configured attempt limit", async () => {
  const { clock, restartCalls, supervisor } = createTestSupervisor({
    restart: async () => {
      throw new Error("spawn failed");
    },
  });
  supervisor.arm(DIRECT_CONFIG);
  supervisor.handleUnexpectedExit(DIRECT_CONFIG, { error: "unexpected exit" });

  await clock.advanceBy(1_000);
  assert.equal(supervisor.getStatus().state, "waiting");
  assert.equal(supervisor.getStatus().restartAttempts, 2);
  await clock.advanceBy(2_000);
  assert.equal(supervisor.getStatus().state, "waiting");
  assert.equal(supervisor.getStatus().restartAttempts, 3);
  await clock.advanceBy(5_000);

  assert.equal(restartCalls.length, 3);
  assert.equal(supervisor.getStatus().state, "circuit-open");
  assert.equal(supervisor.getStatus().restartAttempts, 3);
  assert.equal(supervisor.getStatus().nextRestartAt, null);
  assert.equal(supervisor.getStatus().blockedReason, "spawn failed");
  assert.equal(clock.pendingTimerCount(), 0);
});

test("observer feed configuration equality includes secret session authority", () => {
  assert.equal(sameObserverFeedConfig(DIRECT_CONFIG, { ...DIRECT_CONFIG }), true);
  assert.equal(
    sameObserverFeedConfig(DIRECT_CONFIG, {
      ...DIRECT_CONFIG,
      mapKey: "miramar",
    }),
    true,
  );
  assert.equal(
    sameObserverFeedConfig(DIRECT_CONFIG, {
      ...DIRECT_CONFIG,
      sessionId: "session-other",
    }),
    false,
  );
  assert.equal(
    sameObserverFeedConfig(DIRECT_CONFIG, {
      ...DIRECT_CONFIG,
      feedToken: "token-other",
    }),
    false,
  );
});

test("launcher recovery reuses authority without rebinding or minting a token", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const start = source.indexOf(
    "async function restartObserverFeedFromSupervisor(",
  );
  const end = source.indexOf("\nfunction sameOwnedObserverRuntimeConfig", start);
  const recoverySource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(recoverySource, /matchId:\s*config\.matchId/);
  assert.match(recoverySource, /sessionId:\s*config\.sessionId/);
  assert.match(recoverySource, /feedToken:\s*config\.feedToken/);
  assert.match(
    recoverySource,
    /mapKey:\s*getDesiredObserverFallbackMapKey\(config\.matchId, config\.mapKey\)/,
  );
  assert.doesNotMatch(recoverySource, /pinSelectedMatchLive/);
  assert.doesNotMatch(recoverySource, /createObserverFeedToken/);
  assert.doesNotMatch(recoverySource, /randomUUID/);
});

test("launcher status snapshot exposes recovery and local health state", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const start = source.indexOf("function getObserverFeedStatusView(");
  const end = source.indexOf("\nfunction setObserverFeedState", start);
  const statusSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(statusSource, /recoveryState:\s*recovery\.state/);
  assert.match(statusSource, /restartAttempts:\s*recovery\.restartAttempts/);
  assert.match(statusSource, /healthState:\s*health\.state/);
  assert.match(
    statusSource,
    /consecutiveHealthFailures:\s*health\.consecutiveFailures/,
  );
});

test("launcher initial start propagates cancellation through every async stage", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const start = source.indexOf("async function startObserverFeedForMatch(");
  const end = source.indexOf("\nasync function stopObserverFeed(", start);
  const startSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(startSource, /observerFeedStartGate\.begin\(\)/);
  assert.match(startSource, /pinSelectedMatchLive\([\s\S]*startOperation\.signal/);
  assert.match(startSource, /createObserverFeedToken\([\s\S]*startOperation\.signal/);
  assert.match(startSource, /ensureTelemetrySourceRunning\([\s\S]*signal:\s*startOperation\.signal/);
  assert.match(startSource, /startOperation\.assertCurrent\(\)/);
  assert.match(startSource, /startOperation\.finish\(\)/);
});

test("launcher stop confirms child exit and exact runtime disappearance", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const start = source.indexOf(
    "async function performManagedTelemetrySourceStop(",
  );
  const end = source.indexOf("\nfunction beginObserverFeedRecovery", start);
  const stopSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(stopSource, /stopObserverProcessWithConfirmation\(/);
  assert.match(stopSource, /waitForExit:\s*waitForChildProcessExit/);
  assert.match(stopSource, /waitForExactObserverRuntimeToDisappear\(/);
  assert.match(stopSource, /const stopped = confirmation\.stopped === true/);
  assert.match(stopSource, /telemetrySourceStopOperations\.get\(child\)/);
  assert.match(
    stopSource,
    /telemetryBridgeProcess === child[\s\S]*telemetrySourceProcessGeneration === generation/,
  );
});

test("Windows launcher requests an authenticated exact-runtime shutdown before bounded force fallback", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const requestStart = source.indexOf(
    "async function requestExactObserverRuntimeShutdown(",
  );
  const requestEnd = source.indexOf(
    "\nfunction hasChildProcessExited",
    requestStart,
  );
  const requestSource = source.slice(requestStart, requestEnd);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);
  assert.ok(
    requestSource.indexOf("probeExactObserverRuntime(") <
      requestSource.indexOf("axios.post("),
  );
  assert.match(requestSource, /ownershipProbe\.present !== true/);
  assert.match(
    requestSource,
    /"X-Arenzyra-Connector-Token":\s*localControlToken/,
  );
  assert.match(
    requestSource,
    /"X-Arenzyra-Runtime-Nonce":\s*expectedRuntime\.nonce/,
  );

  const killStart = source.indexOf("function killChildProcessTree(");
  const killEnd = source.indexOf(
    "\nasync function performManagedTelemetrySourceStop",
    killStart,
  );
  const killSource = source.slice(killStart, killEnd);
  assert.ok(killStart >= 0 && killEnd > killStart);
  assert.match(
    killSource,
    /process\.platform === "win32"[\s\S]*options\?\.force !== true[\s\S]*return false;[\s\S]*resolveTrustedWindowsCommand\("taskkill"\)[\s\S]*taskkill\.executablePath[\s\S]*env:\s*taskkill\.env/,
  );
  assert.match(killSource, /\["\/PID", String\(normalizedPid\), "\/T", "\/F"\]/);

  const stopStart = source.indexOf(
    "async function performManagedTelemetrySourceStop(",
  );
  const stopEnd = source.indexOf(
    "\nasync function stopManagedTelemetrySourceProcess",
    stopStart,
  );
  const stopSource = source.slice(stopStart, stopEnd);
  assert.match(
    stopSource,
    /killOptions\?\.force === true[\s\S]*killChildProcessTree\(targetPid, \{ force: true \}\)/,
  );
  assert.match(
    stopSource,
    /process\.platform === "win32"[\s\S]*requestExactObserverRuntimeShutdown\(processConfig\)/,
  );
});

test("every launcher-managed connector receives a private control token and runtime nonce", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const envStart = source.indexOf("function buildTelemetrySourceProcessEnv(");
  const envEnd = source.indexOf("\nfunction isDirectTelemetrySourceConfig", envStart);
  const envSource = source.slice(envStart, envEnd);
  assert.match(envSource, /ARENZYRA_OBSERVER_RUNTIME_NONCE/);
  assert.match(envSource, /ARENZYRA_PCOB_CONNECTOR_TOKEN/);
  assert.match(envSource, /normalizedConfig\.localControlToken/);

  const configStart = source.indexOf("  const desiredConfig =");
  const configEnd = source.indexOf(
    '\n  if (desiredMode === "direct")',
    configStart,
  );
  const configSource = source.slice(configStart, configEnd);
  assert.equal(
    [...configSource.matchAll(/runtimeNonce:\s*String\(/g)].length,
    2,
  );
  assert.equal(
    [...configSource.matchAll(/localControlToken:\s*String\(/g)].length,
    2,
  );
});

test("operator stop cancels pending initial start before waiting for process exit", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const start = source.indexOf("async function stopObserverFeed(");
  const end = source.indexOf("\nasync function stopObserverFeedSilently", start);
  const stopSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  const cancelAt = stopSource.indexOf("observerFeedStartGate.cancel(reason)");
  const awaitStopAt = stopSource.indexOf(
    "await stopManagedTelemetrySourceProcess(reason)",
  );
  assert.ok(cancelAt >= 0);
  assert.ok(awaitStopAt > cancelAt);
});

test("a failed intentional stop remains visible and is retried without restart", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const start = source.indexOf("async function pollLocalRuntimeLifecycleOnce(");
  const end = source.indexOf(
    "\nfunction refreshLocalRuntimeLifecyclePoller",
    start,
  );
  const pollerSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(pollerSource, /initialObserverStatus\.enabled !== true/);
  assert.match(pollerSource, /initialObserverStatus\.running === true/);
  assert.match(pollerSource, /await stopObserverFeed\("stop-retry"\)/);
  assert.doesNotMatch(pollerSource, /observerFeedSupervisor\.arm/);
});

test("launcher API requests used by initial start carry the abort signal", () => {
  const source = fs.readFileSync(path.join(__dirname, "apiClient.cjs"), "utf8");
  assert.match(source, /signal:\s*config\?\.signal/);

  for (const methodName of [
    "getActiveMatch",
    "startMatchControl",
    "getMatchControl",
    "createObserverFeedToken",
  ]) {
    const start = source.indexOf(`async ${methodName}(params)`);
    const end = source.indexOf("\n    async ", start + 1);
    const methodSource = source.slice(start, end >= 0 ? end : undefined);
    assert.ok(start >= 0, `${methodName} should exist`);
    assert.match(methodSource, /signal:\s*params\?\.signal/);
  }
});
