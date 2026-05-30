"use strict";

const MAX_EVENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MIN_EVENT_TIMESTAMP_MS = Date.UTC(2020, 0, 1);

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function toDurationMs(timeRemaining) {
  const numeric = toFiniteNumber(timeRemaining);
  if (numeric === null) {
    return null;
  }

  // ShadowTracker-style payloads typically send remaining time in seconds.
  // If a future source sends milliseconds, keep large values as-is.
  return Math.abs(numeric) > 1000 ? numeric : numeric * 1000;
}

function isUsableEventTimestamp(eventTimestamp, receivedAt) {
  const numeric = toFiniteNumber(eventTimestamp);
  if (numeric === null) {
    return false;
  }

  if (numeric < MIN_EVENT_TIMESTAMP_MS) {
    return false;
  }

  return Math.abs(receivedAt - numeric) <= MAX_EVENT_CLOCK_SKEW_MS;
}

function computeZoneTiming({
  eventTimestamp,
  receivedAt = Date.now(),
  timeRemaining,
  phaseDuration,
} = {}) {
  const normalizedReceivedAt = toFiniteNumber(receivedAt) ?? Date.now();
  const remainingMs = toDurationMs(timeRemaining);
  const phaseDurationMs = toDurationMs(phaseDuration) ?? remainingMs;
  const hasEventTimestamp = isUsableEventTimestamp(eventTimestamp, normalizedReceivedAt);
  const normalizedEventTimestamp = hasEventTimestamp
    ? toFiniteNumber(eventTimestamp)
    : null;
  const baseTimestamp = normalizedEventTimestamp ?? normalizedReceivedAt;

  return {
    receivedAt: normalizedReceivedAt,
    eventTimestamp: normalizedEventTimestamp,
    baseTimestamp,
    remainingMs,
    phaseDurationMs,
    durationMs: phaseDurationMs,
    targetEndAt:
      remainingMs === null ? null : Math.max(baseTimestamp + remainingMs, normalizedReceivedAt),
    timingSource: normalizedEventTimestamp ? "event_timestamp" : "received_at",
    transportLatencyMs:
      normalizedEventTimestamp === null
        ? null
        : Math.max(0, normalizedReceivedAt - normalizedEventTimestamp),
  };
}

function getRemainingZoneMs(timingState, now = Date.now()) {
  const targetEndAt = toFiniteNumber(timingState?.targetEndAt);
  if (targetEndAt === null) {
    return null;
  }

  return Math.max(0, targetEndAt - (toFiniteNumber(now) ?? Date.now()));
}

module.exports = {
  computeZoneTiming,
  getRemainingZoneMs,
  toDurationMs,
};
