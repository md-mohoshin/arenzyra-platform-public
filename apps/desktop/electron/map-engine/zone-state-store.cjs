"use strict";

const { computeZoneTiming } = require("./zone-timing-utils.cjs");

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeMapKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeNullableString(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeZoneMode(value) {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null;
  if (!normalized) {
    return null;
  }

  if (
    normalized === "2" ||
    normalized === "closing" ||
    normalized === "moving" ||
    normalized === "shrinking" ||
    normalized === "shrink" ||
    normalized === "collapse" ||
    normalized === "collapsing"
  ) {
    return "closing";
  }

  if (
    normalized === "0" ||
    normalized === "1" ||
    normalized === "waiting" ||
    normalized === "wait" ||
    normalized === "idle" ||
    normalized === "hold" ||
    normalized === "holding" ||
    normalized === "opening" ||
    normalized === "open" ||
    normalized === "next"
  ) {
    return "waiting";
  }

  return null;
}

function isOpeningMatchPhase(value) {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? "";
  return (
    normalized === "plane" ||
    normalized === "parachuting" ||
    normalized === "lobby" ||
    normalized === "waiting"
  );
}

const SOURCE_PRIORITY = new Map([
  ["backend-canonical", 110],
  ["canonical-backend", 110],
  ["telemetry-bridge", 100],
  ["launcher-bridge", 100],
  ["backend", 90],
  ["direct-observer", 50],
  ["mock", 10],
  ["unknown", 0],
]);

function normalizeSource(value) {
  const source = String(value || "").trim().toLowerCase();
  return source || "unknown";
}

function sourcePriority(source) {
  return SOURCE_PRIORITY.get(normalizeSource(source)) ?? 0;
}

function cloneUpdate(update) {
  return {
    ...update,
    matchPhase: normalizeNullableString(update.matchPhase),
    mode: normalizeZoneMode(update.mode),
    zoneMode: normalizeZoneMode(update.zoneMode ?? update.mode),
    circlesVisible: update.circlesVisible !== false,
    source: update.source,
    timing: update.timing ? { ...update.timing } : null,
    currentCircle: update.currentCircle ? { ...update.currentCircle } : null,
    nextCircle: update.nextCircle ? { ...update.nextCircle } : null,
    blueCircle: update.blueCircle ? { ...update.blueCircle } : null,
    flightPath:
      update.flightPath && update.flightPath.start && update.flightPath.end
        ? {
            start: { ...update.flightPath.start },
            end: { ...update.flightPath.end },
          }
        : null,
    flightPathVisibleUntil: toFiniteNumber(update.flightPathVisibleUntil),
    raw: update.raw
      ? {
          currentCircle: update.raw.currentCircle ? { ...update.raw.currentCircle } : null,
          nextCircle: update.raw.nextCircle ? { ...update.raw.nextCircle } : null,
          blueCircle: update.raw.blueCircle ? { ...update.raw.blueCircle } : null,
          flightPath:
            update.raw.flightPath && update.raw.flightPath.start && update.raw.flightPath.end
              ? {
                  start: { ...update.raw.flightPath.start },
                  end: { ...update.raw.flightPath.end },
                }
              : null,
        }
      : null,
    coordinate: update.coordinate ? { ...update.coordinate } : null,
    warnings: [...update.warnings],
  };
}

function normalizeFlightPath(value) {
  const startX = toFiniteNumber(value?.start?.x);
  const startY = toFiniteNumber(value?.start?.y);
  const endX = toFiniteNumber(value?.end?.x);
  const endY = toFiniteNumber(value?.end?.y);

  if (startX === null || startY === null || endX === null || endY === null) {
    return null;
  }

  return {
    start: {
      x: startX,
      y: startY,
    },
    end: {
      x: endX,
      y: endY,
    },
  };
}

function createZoneStateStore() {
  const updatesByMap = new Map();

  function set(update) {
    const mapKey = normalizeMapKey(update?.mapKey);
    const receivedAt = toFiniteNumber(update?.receivedAt) ?? Date.now();
    const timing = computeZoneTiming({
      eventTimestamp: update?.timestamp,
      receivedAt,
      timeRemaining: update?.timeRemainingMs ?? update?.timeRemaining,
      phaseDuration:
        update?.phaseDurationMs ??
        update?.phaseDuration ??
        update?.timeRemainingMs ??
        update?.timeRemaining,
    });
    const centerX = toFiniteNumber(update?.centerX);
    const centerY = toFiniteNumber(update?.centerY);
    const radius = toFiniteNumber(update?.radius);
    const currentCircle =
      centerX === null || centerY === null || radius === null
        ? null
        : {
            centerX,
            centerY,
            radius,
          };
    const flightPath = normalizeFlightPath(update?.flightPath);

    if (!mapKey || (!currentCircle && !flightPath)) {
      return null;
    }
    const eventTimestamp = timing.eventTimestamp ?? receivedAt;
    const source = normalizeSource(update?.source);
    const current = updatesByMap.get(mapKey);
    const phase = toFiniteNumber(update?.phase);
    const currentPhase = toFiniteNumber(current?.phase);
    const startsNewRuntime = Boolean(
      current &&
        phase !== null &&
        currentPhase !== null &&
        phase < currentPhase &&
        isOpeningMatchPhase(update?.matchPhase),
    );
    if (
      current &&
      phase !== null &&
      currentPhase !== null &&
      phase < currentPhase &&
      !isOpeningMatchPhase(update?.matchPhase)
    ) {
      return null;
    }

    if (
      current &&
      (eventTimestamp < current.timestamp ||
        (eventTimestamp === current.timestamp &&
          sourcePriority(source) < sourcePriority(current.source)) ||
        (eventTimestamp === current.timestamp &&
          sourcePriority(source) === sourcePriority(current.source) &&
          receivedAt < current.receivedAt))
    ) {
      return null;
    }

    const nextUpdate = {
      mapKey,
      phase,
      aliveTeams: (() => {
        const value = toFiniteNumber(update?.aliveTeams ?? update?.teamsAlive);
        if (value !== null) {
          return Math.max(0, Math.trunc(value));
        }
        return startsNewRuntime ? null : current?.aliveTeams ?? null;
      })(),
      matchPhase: normalizeNullableString(update?.matchPhase),
      mode: normalizeZoneMode(update?.mode),
      zoneMode: normalizeZoneMode(update?.zoneMode ?? update?.mode),
      circlesVisible: update?.circlesVisible !== false,
      status: normalizeNullableString(update?.status),
      centerX,
      centerY,
      radius,
      nextCenterX: toFiniteNumber(update?.nextCenterX),
      nextCenterY: toFiniteNumber(update?.nextCenterY),
      nextRadius: toFiniteNumber(update?.nextRadius),
      blueCenterX: toFiniteNumber(update?.blueCenterX),
      blueCenterY: toFiniteNumber(update?.blueCenterY),
      blueRadius: toFiniteNumber(update?.blueRadius),
      phaseDuration:
        timing.phaseDurationMs === null
          ? toFiniteNumber(update?.phaseDuration)
          : timing.phaseDurationMs / 1000,
      phaseDurationMs: timing.phaseDurationMs,
      timeRemaining:
        timing.remainingMs === null ? toFiniteNumber(update?.timeRemaining) : timing.remainingMs / 1000,
      timeRemainingMs: timing.remainingMs,
      timestamp: eventTimestamp,
      receivedAt,
      source,
      targetEndAt: timing.targetEndAt,
      timing,
      currentCircle,
      nextCircle:
        toFiniteNumber(update?.nextCenterX) === null ||
        toFiniteNumber(update?.nextCenterY) === null ||
        toFiniteNumber(update?.nextRadius) === null
          ? null
          : {
              centerX: toFiniteNumber(update?.nextCenterX),
              centerY: toFiniteNumber(update?.nextCenterY),
              radius: toFiniteNumber(update?.nextRadius),
            },
      blueCircle:
        toFiniteNumber(update?.blueCenterX) === null ||
        toFiniteNumber(update?.blueCenterY) === null ||
        toFiniteNumber(update?.blueRadius) === null
          ? null
          : {
              centerX: toFiniteNumber(update?.blueCenterX),
              centerY: toFiniteNumber(update?.blueCenterY),
              radius: toFiniteNumber(update?.blueRadius),
            },
      flightPath,
      flightPathVisibleUntil: toFiniteNumber(update?.flightPathVisibleUntil),
      raw: update?.raw
        ? {
            currentCircle: update.raw.currentCircle
              ? { ...update.raw.currentCircle }
              : null,
            nextCircle: update.raw.nextCircle ? { ...update.raw.nextCircle } : null,
            blueCircle: update.raw.blueCircle ? { ...update.raw.blueCircle } : null,
            flightPath:
              update.raw.flightPath && update.raw.flightPath.start && update.raw.flightPath.end
                ? {
                    start: { ...update.raw.flightPath.start },
                    end: { ...update.raw.flightPath.end },
                  }
                : null,
          }
        : null,
      coordinate: update?.coordinate ? { ...update.coordinate } : null,
      warnings: Array.isArray(update?.warnings) ? [...update.warnings] : [],
    };

    updatesByMap.set(mapKey, nextUpdate);
    return cloneUpdate(nextUpdate);
  }

  function get(mapKey) {
    const current = updatesByMap.get(normalizeMapKey(mapKey));
    if (!current) {
      return null;
    }

    return cloneUpdate(current);
  }

  function clear(mapKey) {
    if (!mapKey) {
      updatesByMap.clear();
      return;
    }

    updatesByMap.delete(normalizeMapKey(mapKey));
  }

  function getLatest() {
    let latest = null;
    for (const value of updatesByMap.values()) {
      if (!latest || value.timestamp >= latest.timestamp) {
        latest = value;
      }
    }
    return latest ? cloneUpdate(latest) : null;
  }

  return {
    set,
    get,
    clear,
    getLatest,
  };
}

module.exports = {
  createZoneStateStore,
};
