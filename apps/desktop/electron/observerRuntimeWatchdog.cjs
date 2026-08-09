"use strict";

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_FAILURE_THRESHOLD = 3;

function normalizeError(error, fallback) {
  if (error instanceof Error && error.message) {
    return error.message.trim() || fallback;
  }
  const message = typeof error === "string" ? error.trim() : "";
  return message || fallback;
}

function createObserverRuntimeWatchdog(options = {}) {
  if (typeof options.probe !== "function") {
    throw new TypeError("Observer runtime watchdog requires a probe callback.");
  }
  if (typeof options.onUnhealthy !== "function") {
    throw new TypeError(
      "Observer runtime watchdog requires an unhealthy callback.",
    );
  }

  const probe = options.probe;
  const onUnhealthy = options.onUnhealthy;
  const onStatusChange =
    typeof options.onStatusChange === "function"
      ? options.onStatusChange
      : () => {};
  const now = typeof options.now === "function" ? options.now : Date.now;
  const setTimer =
    typeof options.setTimer === "function" ? options.setTimer : setTimeout;
  const clearTimer =
    typeof options.clearTimer === "function" ? options.clearTimer : clearTimeout;
  const intervalMs = Math.max(
    1,
    Math.floor(Number(options.intervalMs) || DEFAULT_INTERVAL_MS),
  );
  const failureThreshold = Math.max(
    1,
    Math.floor(
      Number(options.failureThreshold) || DEFAULT_FAILURE_THRESHOLD,
    ),
  );

  let generation = 0;
  let activeConfig = null;
  let timer = null;
  let probeInFlightGeneration = null;
  let status = {
    state: "idle",
    consecutiveFailures: 0,
    failureThreshold,
    lastCheckedAt: null,
    lastHealthyAt: null,
    lastError: null,
  };

  function snapshot() {
    return { ...status };
  }

  function publish(patch = {}) {
    status = { ...status, ...patch, failureThreshold };
    const view = snapshot();
    try {
      onStatusChange(view);
    } catch {
      // Status rendering must never interfere with health supervision.
    }
    return view;
  }

  function clearScheduledProbe() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function isCurrent(expectedGeneration) {
    return expectedGeneration === generation && activeConfig !== null;
  }

  function scheduleNext(expectedGeneration) {
    if (!isCurrent(expectedGeneration) || status.state === "recycling") {
      return;
    }
    clearScheduledProbe();
    timer = setTimer(() => {
      timer = null;
      void pollOnce(expectedGeneration);
    }, intervalMs);
    timer?.unref?.();
  }

  async function pollOnce(expectedGeneration = generation) {
    if (
      !isCurrent(expectedGeneration) ||
      probeInFlightGeneration === expectedGeneration
    ) {
      return snapshot();
    }

    probeInFlightGeneration = expectedGeneration;
    const config = { ...activeConfig };
    let result;
    try {
      result = await probe(config, {
        isCurrent: () => isCurrent(expectedGeneration),
      });
    } catch (error) {
      result = { healthy: false, error };
    } finally {
      if (probeInFlightGeneration === expectedGeneration) {
        probeInFlightGeneration = null;
      }
    }

    if (!isCurrent(expectedGeneration)) {
      return snapshot();
    }

    const checkedAt = new Date(now()).toISOString();
    const healthy = result === true || result?.healthy === true;
    if (healthy) {
      publish({
        state: "healthy",
        consecutiveFailures: 0,
        lastCheckedAt: checkedAt,
        lastHealthyAt: checkedAt,
        lastError: null,
      });
      scheduleNext(expectedGeneration);
      return snapshot();
    }

    const consecutiveFailures = status.consecutiveFailures + 1;
    const lastError = normalizeError(
      result?.error,
      "Owned observer connector health check failed.",
    );
    if (consecutiveFailures < failureThreshold) {
      publish({
        state: "degraded",
        consecutiveFailures,
        lastCheckedAt: checkedAt,
        lastError,
      });
      scheduleNext(expectedGeneration);
      return snapshot();
    }

    clearScheduledProbe();
    publish({
      state: "recycling",
      consecutiveFailures,
      lastCheckedAt: checkedAt,
      lastError,
    });
    try {
      await onUnhealthy(config, {
        error: lastError,
        isCurrent: () => isCurrent(expectedGeneration),
      });
    } catch {
      // The recovery supervisor owns subsequent retry and error reporting.
    }
    return snapshot();
  }

  function start(config) {
    generation += 1;
    clearScheduledProbe();
    activeConfig = config && typeof config === "object" ? { ...config } : null;
    if (!activeConfig) {
      return publish({
        state: "idle",
        consecutiveFailures: 0,
        lastCheckedAt: null,
        lastHealthyAt: null,
        lastError: null,
      });
    }
    const view = publish({
      state: "healthy",
      consecutiveFailures: 0,
      lastCheckedAt: null,
      lastHealthyAt: new Date(now()).toISOString(),
      lastError: null,
    });
    scheduleNext(generation);
    return view;
  }

  function stop() {
    generation += 1;
    clearScheduledProbe();
    activeConfig = null;
    return publish({
      state: "idle",
      consecutiveFailures: 0,
      lastCheckedAt: null,
      lastHealthyAt: null,
      lastError: null,
    });
  }

  return {
    getStatus: snapshot,
    pollNow: () => pollOnce(generation),
    start,
    stop,
  };
}

module.exports = {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_INTERVAL_MS,
  createObserverRuntimeWatchdog,
};
