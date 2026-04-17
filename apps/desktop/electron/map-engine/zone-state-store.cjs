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

function cloneUpdate(update) {
  return {
    ...update,
    matchPhase: normalizeNullableString(update.matchPhase),
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

    if (!mapKey || centerX === null || centerY === null || radius === null) {
      return null;
    }

    const nextUpdate = {
      mapKey,
      phase: toFiniteNumber(update?.phase),
      matchPhase: normalizeNullableString(update?.matchPhase),
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
      timestamp: timing.eventTimestamp ?? receivedAt,
      receivedAt,
      targetEndAt: timing.targetEndAt,
      timing,
      currentCircle: {
        centerX,
        centerY,
        radius,
      },
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
      flightPath:
        toFiniteNumber(update?.flightPath?.start?.x) === null ||
        toFiniteNumber(update?.flightPath?.start?.y) === null ||
        toFiniteNumber(update?.flightPath?.end?.x) === null ||
        toFiniteNumber(update?.flightPath?.end?.y) === null
          ? null
          : {
              start: {
                x: toFiniteNumber(update?.flightPath?.start?.x),
                y: toFiniteNumber(update?.flightPath?.start?.y),
              },
              end: {
                x: toFiniteNumber(update?.flightPath?.end?.x),
                y: toFiniteNumber(update?.flightPath?.end?.y),
              },
            },
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
