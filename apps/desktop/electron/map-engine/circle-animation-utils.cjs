"use strict";

const { getRemainingZoneMs } = require("./zone-timing-utils.cjs");

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function interpolateCircle(fromCircle, toCircle, progress) {
  if (!fromCircle || !toCircle) {
    return fromCircle || toCircle || null;
  }

  const normalizedProgress = clamp01(progress);
  return {
    centerX: lerp(fromCircle.centerX, toCircle.centerX, normalizedProgress),
    centerY: lerp(fromCircle.centerY, toCircle.centerY, normalizedProgress),
    radius: lerp(fromCircle.radius, toCircle.radius, normalizedProgress),
  };
}

function getAnimatedCircleState({
  currentCircle,
  nextCircle,
  timing,
  now = Date.now(),
} = {}) {
  if (!currentCircle) {
    return null;
  }

  const durationMs = timing?.durationMs;
  const remainingMs = getRemainingZoneMs(timing, now);
  if (
    !nextCircle ||
    durationMs === null ||
    durationMs <= 0 ||
    remainingMs === null
  ) {
    return {
      circle: { ...currentCircle },
      progress: 0,
      remainingMs,
      isAnimating: false,
    };
  }

  const progress = clamp01(1 - remainingMs / durationMs);
  return {
    circle: interpolateCircle(currentCircle, nextCircle, progress),
    progress,
    remainingMs,
    isAnimating: progress > 0 && progress < 1,
  };
}

module.exports = {
  clamp01,
  getAnimatedCircleState,
  interpolateCircle,
  lerp,
};
