const DEFAULT_RESTART_DELAYS_MS = Object.freeze([
  1_000,
  2_000,
  5_000,
  10_000,
  30_000,
]);
const DEFAULT_RESTART_WINDOW_MS = 2 * 60 * 1_000;
const DEFAULT_STABLE_RUN_MS = 60 * 1_000;
const OBSERVER_FEED_START_CANCELLED_ERROR_CODE =
  "ARENZYRA_OBSERVER_FEED_START_CANCELLED";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cloneConfig(config) {
  return config && typeof config === "object" ? { ...config } : null;
}

function sameObserverFeedConfig(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    normalizeString(left.mode).toLowerCase() === "direct" &&
    normalizeString(right.mode).toLowerCase() === "direct" &&
    normalizeString(left.apiBase).replace(/\/+$/, "") ===
      normalizeString(right.apiBase).replace(/\/+$/, "") &&
    normalizeString(left.observerBaseUrl).replace(/\/+$/, "").toLowerCase() ===
      normalizeString(right.observerBaseUrl)
        .replace(/\/+$/, "")
        .toLowerCase() &&
    normalizeString(left.matchId) === normalizeString(right.matchId) &&
    normalizeString(left.sessionId) === normalizeString(right.sessionId) &&
    normalizeString(left.feedToken) === normalizeString(right.feedToken) &&
    // mapKey is mutable fallback state, not observer-feed process identity.
    normalizeString(left.scriptPath).toLowerCase() ===
      normalizeString(right.scriptPath).toLowerCase()
  );
}

function normalizeError(error, fallback) {
  if (error instanceof Error && normalizeString(error.message)) {
    return normalizeString(error.message);
  }
  if (normalizeString(error)) {
    return normalizeString(error);
  }
  return fallback;
}

function createObserverFeedStartCancelledError(reason = "cancelled") {
  const normalizedReason = normalizeString(reason) || "cancelled";
  const error = new Error(
    `Observer feed start was cancelled (${normalizedReason}).`,
  );
  error.code = OBSERVER_FEED_START_CANCELLED_ERROR_CODE;
  return error;
}

function isObserverFeedStartCancelledError(error) {
  return error?.code === OBSERVER_FEED_START_CANCELLED_ERROR_CODE;
}

function createObserverFeedStartGate() {
  let generation = 0;
  let currentOperation = null;

  function cancel(reason = "cancelled") {
    generation += 1;
    const operation = currentOperation;
    currentOperation = null;
    if (operation && operation.signal.aborted !== true) {
      operation.controller.abort(createObserverFeedStartCancelledError(reason));
    }
    return Boolean(operation);
  }

  function begin() {
    cancel("superseded");
    const operationGeneration = generation;
    const controller = new AbortController();
    const operation = {
      controller,
      generation: operationGeneration,
      signal: controller.signal,
      isCurrent: () =>
        currentOperation === operation &&
        generation === operationGeneration &&
        controller.signal.aborted !== true,
      assertCurrent: () => {
        if (
          currentOperation === operation &&
          generation === operationGeneration &&
          controller.signal.aborted !== true
        ) {
          return;
        }
        if (controller.signal.reason instanceof Error) {
          throw controller.signal.reason;
        }
        throw createObserverFeedStartCancelledError();
      },
      finish: () => {
        if (currentOperation === operation) {
          currentOperation = null;
        }
      },
    };
    currentOperation = operation;
    return operation;
  }

  return {
    begin,
    cancel,
    hasPending: () => currentOperation !== null,
  };
}

async function stopObserverProcessWithConfirmation(options = {}) {
  const child = options.child || null;
  const pid = Number(options.pid ?? child?.pid);
  if (!child || !Number.isFinite(pid) || pid <= 0) {
    return {
      ok: true,
      stopped: false,
      pid: Number.isFinite(pid) && pid > 0 ? pid : null,
      gracefulKillRequested: false,
      forceKillRequested: false,
      processExited: true,
      exactRuntimeGone: true,
      error: null,
    };
  }

  if (
    typeof options.kill !== "function" ||
    typeof options.waitForExit !== "function" ||
    typeof options.waitForIdentityGone !== "function"
  ) {
    throw new TypeError(
      "Confirmed observer stop requires kill, exit, and identity checks.",
    );
  }

  const gracefulKillRequested =
    (await options.kill(pid, { force: false })) === true;
  let processExited =
    (await options.waitForExit(
      child,
      Math.max(1, Number(options.graceTimeoutMs) || 1),
    )) === true;
  let forceKillRequested = false;
  if (!processExited) {
    forceKillRequested =
      (await options.kill(pid, { force: true })) === true;
    processExited =
      (await options.waitForExit(
        child,
        Math.max(1, Number(options.forceTimeoutMs) || 1),
      )) === true;
  }

  const exactRuntimeGone =
    processExited &&
    (await options.waitForIdentityGone(
      Math.max(1, Number(options.identityTimeoutMs) || 1),
    )) === true;
  const stopped = processExited && exactRuntimeGone;
  return {
    ok: stopped,
    stopped,
    pid,
    gracefulKillRequested,
    forceKillRequested,
    processExited,
    exactRuntimeGone,
    error: stopped
      ? null
      : !processExited
        ? `Observer connector process ${pid} did not exit after bounded termination attempts.`
        : "The stopped connector's exact runtime identity is still responding locally.",
  };
}

function createObserverFeedSupervisor(options = {}) {
  if (typeof options.restart !== "function") {
    throw new TypeError("Observer feed supervisor requires a restart callback.");
  }

  const restart = options.restart;
  const canRestart =
    typeof options.canRestart === "function"
      ? options.canRestart
      : async () => ({ allowed: true });
  const onStatusChange =
    typeof options.onStatusChange === "function"
      ? options.onStatusChange
      : () => {};
  const now = typeof options.now === "function" ? options.now : Date.now;
  const random = typeof options.random === "function" ? options.random : Math.random;
  const setTimer =
    typeof options.setTimer === "function" ? options.setTimer : setTimeout;
  const clearTimer =
    typeof options.clearTimer === "function" ? options.clearTimer : clearTimeout;
  const restartDelaysMs =
    Array.isArray(options.restartDelaysMs) && options.restartDelaysMs.length > 0
      ? options.restartDelaysMs.map((value) =>
          Math.max(0, Math.floor(Number(value) || 0)),
        )
      : [...DEFAULT_RESTART_DELAYS_MS];
  const maxRestartAttempts = Math.max(
    1,
    Math.floor(
      Number(options.maxRestartAttempts) || restartDelaysMs.length,
    ),
  );
  const restartWindowMs = Math.max(
    1,
    Math.floor(
      Number(options.restartWindowMs) || DEFAULT_RESTART_WINDOW_MS,
    ),
  );
  const stableRunMs = Math.max(
    1,
    Math.floor(Number(options.stableRunMs) || DEFAULT_STABLE_RUN_MS),
  );
  const jitterRatio = Math.max(
    0,
    Math.min(0.5, Number.isFinite(Number(options.jitterRatio))
      ? Number(options.jitterRatio)
      : 0.1),
  );

  let generation = 0;
  let activeConfig = null;
  let restartTimer = null;
  let stableTimer = null;
  let operationController = null;
  let restartAttemptTimes = [];
  let status = {
    state: "idle",
    restartAttempts: 0,
    maxRestartAttempts,
    nextRestartAt: null,
    lastUnexpectedExitAt: null,
    lastRestartAt: null,
    blockedReason: null,
    lastError: null,
  };

  function snapshot() {
    return { ...status };
  }

  function publish(patch = {}) {
    status = {
      ...status,
      ...patch,
      maxRestartAttempts,
    };
    const view = snapshot();
    try {
      onStatusChange(view);
    } catch {
      // Health reporting must never break recovery.
    }
    return view;
  }

  function cancelRestartTimer() {
    if (restartTimer !== null) {
      clearTimer(restartTimer);
      restartTimer = null;
    }
  }

  function cancelStableTimer() {
    if (stableTimer !== null) {
      clearTimer(stableTimer);
      stableTimer = null;
    }
  }

  function cancelOperation() {
    operationController?.abort();
    operationController = null;
  }

  function clearOperation(controller) {
    if (operationController === controller) {
      operationController = null;
    }
  }

  function pruneRestartAttempts(timestamp = now()) {
    restartAttemptTimes = restartAttemptTimes.filter(
      (attemptAt) => timestamp - attemptAt < restartWindowMs,
    );
  }

  function isCurrent(expectedGeneration, config) {
    return (
      expectedGeneration === generation &&
      activeConfig !== null &&
      sameObserverFeedConfig(activeConfig, config)
    );
  }

  function openCircuit(reason) {
    cancelRestartTimer();
    cancelStableTimer();
    cancelOperation();
    activeConfig = null;
    return publish({
      state: "circuit-open",
      restartAttempts: restartAttemptTimes.length,
      nextRestartAt: null,
      blockedReason:
        normalizeError(reason, "Observer feed recovery reached its retry limit."),
      lastError: normalizeError(
        reason,
        "Observer feed recovery reached its retry limit.",
      ),
    });
  }

  function blockRestart(reason) {
    cancelRestartTimer();
    cancelStableTimer();
    cancelOperation();
    activeConfig = null;
    return publish({
      state: "blocked",
      nextRestartAt: null,
      blockedReason: normalizeError(
        reason,
        "Observer feed recovery was blocked by match authority.",
      ),
      lastError: normalizeError(
        reason,
        "Observer feed recovery was blocked by match authority.",
      ),
    });
  }

  function markStableAfterDelay(expectedGeneration, config) {
    cancelStableTimer();
    stableTimer = setTimer(() => {
      stableTimer = null;
      if (!isCurrent(expectedGeneration, config) || status.state !== "healthy") {
        return;
      }
      restartAttemptTimes = [];
      publish({ restartAttempts: 0 });
    }, stableRunMs);
    stableTimer?.unref?.();
  }

  function scheduleNextRestart(expectedGeneration, config, error) {
    if (!isCurrent(expectedGeneration, config)) {
      return { scheduled: false, status: snapshot() };
    }

    const timestamp = now();
    pruneRestartAttempts(timestamp);
    if (restartAttemptTimes.length >= maxRestartAttempts) {
      return {
        scheduled: false,
        status: openCircuit(error),
      };
    }

    const attempt = restartAttemptTimes.length + 1;
    const baseDelayMs =
      restartDelaysMs[Math.min(attempt - 1, restartDelaysMs.length - 1)];
    const delayMs = Math.max(
      0,
      Math.round(
        baseDelayMs + baseDelayMs * jitterRatio * (random() * 2 - 1),
      ),
    );
    restartAttemptTimes.push(timestamp);
    const nextRestartAt = new Date(timestamp + delayMs).toISOString();
    const lastError = normalizeError(
      error,
      "The observer connector stopped unexpectedly.",
    );

    cancelRestartTimer();
    publish({
      state: "waiting",
      restartAttempts: restartAttemptTimes.length,
      nextRestartAt,
      blockedReason: null,
      lastError,
    });

    restartTimer = setTimer(() => {
      restartTimer = null;
      void runRestart(expectedGeneration, config);
    }, delayMs);
    restartTimer?.unref?.();
    return { scheduled: true, status: snapshot() };
  }

  async function runRestart(expectedGeneration, config) {
    if (!isCurrent(expectedGeneration, config)) {
      return;
    }

    const controller = new AbortController();
    operationController = controller;
    const context = {
      signal: controller.signal,
      isCurrent: () => isCurrent(expectedGeneration, config),
    };
    publish({
      state: "restarting",
      nextRestartAt: null,
      blockedReason: null,
    });

    let guard;
    try {
      guard = await canRestart(cloneConfig(config), context);
    } catch (error) {
      guard = {
        allowed: false,
        terminal: false,
        reason: normalizeError(
          error,
          "Could not verify whether observer feed recovery is safe.",
        ),
      };
    }

    if (!isCurrent(expectedGeneration, config) || context.signal.aborted) {
      clearOperation(controller);
      return;
    }

    if (guard?.allowed !== true) {
      clearOperation(controller);
      const reason = normalizeError(
        guard?.reason,
        "Could not verify whether observer feed recovery is safe.",
      );
      if (guard?.terminal === true) {
        blockRestart(reason);
        return;
      }
      scheduleNextRestart(expectedGeneration, config, reason);
      return;
    }

    try {
      const result = await restart(cloneConfig(config), context);
      if (!isCurrent(expectedGeneration, config) || context.signal.aborted) {
        return;
      }
      if (result?.ok === false) {
        throw new Error(
          normalizeError(result?.error, "Observer feed recovery failed."),
        );
      }

      clearOperation(controller);
      publish({
        state: "healthy",
        restartAttempts: restartAttemptTimes.length,
        nextRestartAt: null,
        lastRestartAt: new Date(now()).toISOString(),
        blockedReason: null,
        lastError: null,
      });
      markStableAfterDelay(expectedGeneration, config);
    } catch (error) {
      clearOperation(controller);
      if (!isCurrent(expectedGeneration, config)) {
        return;
      }
      scheduleNextRestart(
        expectedGeneration,
        config,
        normalizeError(error, "Observer feed recovery failed."),
      );
    }
  }

  function arm(config) {
    if (
      normalizeString(config?.mode).toLowerCase() !== "direct" ||
      !normalizeString(config?.matchId) ||
      !normalizeString(config?.sessionId) ||
      !normalizeString(config?.feedToken)
    ) {
      throw new TypeError(
        "Observer feed supervisor requires a complete direct-feed configuration.",
      );
    }

    generation += 1;
    cancelRestartTimer();
    cancelStableTimer();
    cancelOperation();
    activeConfig = cloneConfig(config);
    restartAttemptTimes = [];
    return publish({
      state: "healthy",
      restartAttempts: 0,
      nextRestartAt: null,
      lastUnexpectedExitAt: null,
      lastRestartAt: null,
      blockedReason: null,
      lastError: null,
    });
  }

  function disarm() {
    generation += 1;
    cancelRestartTimer();
    cancelStableTimer();
    cancelOperation();
    activeConfig = null;
    restartAttemptTimes = [];
    return publish({
      state: "idle",
      restartAttempts: 0,
      nextRestartAt: null,
      lastUnexpectedExitAt: null,
      lastRestartAt: null,
      blockedReason: null,
      lastError: null,
    });
  }

  function handleUnexpectedExit(config, details = {}) {
    if (!activeConfig || !sameObserverFeedConfig(activeConfig, config)) {
      return { scheduled: false, status: snapshot() };
    }
    if (restartTimer !== null || status.state === "restarting") {
      return { scheduled: false, status: snapshot() };
    }

    cancelStableTimer();
    const timestamp = now();
    publish({
      lastUnexpectedExitAt: new Date(timestamp).toISOString(),
      lastError: normalizeError(
        details.error,
        "The observer connector stopped unexpectedly.",
      ),
    });
    return scheduleNextRestart(generation, cloneConfig(activeConfig), details.error);
  }

  function isActiveFor(config) {
    return Boolean(activeConfig && sameObserverFeedConfig(activeConfig, config));
  }

  return {
    arm,
    disarm,
    getStatus: snapshot,
    handleUnexpectedExit,
    isActiveFor,
  };
}

module.exports = {
  DEFAULT_RESTART_DELAYS_MS,
  DEFAULT_RESTART_WINDOW_MS,
  DEFAULT_STABLE_RUN_MS,
  OBSERVER_FEED_START_CANCELLED_ERROR_CODE,
  createObserverFeedStartCancelledError,
  createObserverFeedStartGate,
  createObserverFeedSupervisor,
  isObserverFeedStartCancelledError,
  sameObserverFeedConfig,
  stopObserverProcessWithConfirmation,
};
