"use strict";

function clampDurationSeconds(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) {
    return 60;
  }

  return Math.max(10, Math.min(600, Math.round(numeric)));
}

function buildCalibrationPlayers(worldSize) {
  const anchors = [
    ["cal-a", "alpha", 0.2, 0.22],
    ["cal-b", "alpha", 0.27, 0.35],
    ["cal-c", "bravo", 0.46, 0.48],
    ["cal-d", "charlie", 0.61, 0.29],
    ["cal-e", "delta", 0.76, 0.61],
    ["cal-f", "echo", 0.83, 0.18],
  ];

  return anchors.map(([playerId, teamId, xRatio, yRatio]) => ({
    playerId,
    teamId,
    x: worldSize * xRatio,
    y: worldSize * yRatio,
    alive: true,
    knocked: false,
  }));
}

function buildCalibrationScenario(definition, options = {}) {
  if (!definition) {
    return null;
  }

  const worldSize = Math.max(1, Number(definition.worldSize) || 1);
  const durationSeconds = clampDurationSeconds(options.durationSeconds);
  const warnings = [
    "Synthetic calibration feed active.",
  ];

  if (definition.notes) {
    warnings.push(`Map note: ${definition.notes}`);
  }

  const coordinate = {
    scaleHint: definition.coordinateScaleHint ?? 1,
    detectedScaleFactor: 1,
    scaleMode: "full_units_calibration",
  };

  const currentCircle = {
    centerX: worldSize * 0.42,
    centerY: worldSize * 0.58,
    radius: worldSize * 0.31,
  };
  const nextCircle = {
    centerX: worldSize * 0.64,
    centerY: worldSize * 0.36,
    radius: worldSize * 0.13,
  };

  return {
    durationSeconds,
    label: "linear_zone_shrink",
    zoneUpdate: {
      mapKey: definition.key,
      phase: 4,
      centerX: currentCircle.centerX,
      centerY: currentCircle.centerY,
      radius: currentCircle.radius,
      nextCenterX: nextCircle.centerX,
      nextCenterY: nextCircle.centerY,
      nextRadius: nextCircle.radius,
      timeRemaining: durationSeconds,
      raw: {
        currentCircle: { ...currentCircle },
        nextCircle: { ...nextCircle },
      },
      coordinate,
      warnings,
    },
    playerUpdate: {
      mapKey: definition.key,
      players: buildCalibrationPlayers(worldSize),
      coordinate,
      warnings,
    },
  };
}

module.exports = {
  buildCalibrationScenario,
};
