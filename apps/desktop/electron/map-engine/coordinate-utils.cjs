"use strict";

// Registry world sizes are stored in full telemetry units such as 816000.
// Some observer feeds instead emit simplified 8000 / 4000 / 2000 style units.
// `normalizeWorldX/Y/Radius` apply an explicit detected scale factor before
// converting world coordinates into pixels.

function toFiniteNumber(value, fallback = 0) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveWorldSize(mapDefinition) {
  return Math.max(1, toFiniteNumber(mapDefinition?.worldSize, 1));
}

function resolveRenderBounds(mapDefinition) {
  const bounds = mapDefinition?.renderBounds;
  if (!bounds || typeof bounds !== "object") {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const x = clamp(toFiniteNumber(bounds.x, 0), 0, 1);
  const y = clamp(toFiniteNumber(bounds.y, 0), 0, 1);
  const width = clamp(toFiniteNumber(bounds.width, 1), 0.0001, Math.max(0.0001, 1 - x));
  const height = clamp(toFiniteNumber(bounds.height, 1), 0.0001, Math.max(0.0001, 1 - y));
  return { x, y, width, height };
}

function resolveImageWidth(imageWidth) {
  return Math.max(1, toFiniteNumber(imageWidth, 1));
}

function resolveImageHeight(imageHeight, imageWidth) {
  const fallbackWidth = resolveImageWidth(imageWidth);
  return Math.max(1, toFiniteNumber(imageHeight, fallbackWidth));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveCoordinateScaleFactor(options = {}) {
  const detectedScaleFactor = toFiniteNumber(options.detectedScaleFactor, 1);
  return detectedScaleFactor > 0 ? detectedScaleFactor : 1;
}

function normalizeWorldX(worldX, mapDefinition, options = {}) {
  const scaleFactor = resolveCoordinateScaleFactor(options);
  return clamp(
    toFiniteNumber(worldX, 0) * scaleFactor,
    0,
    resolveWorldSize(mapDefinition),
  );
}

function normalizeWorldY(worldY, mapDefinition, options = {}) {
  const scaleFactor = resolveCoordinateScaleFactor(options);
  return clamp(
    toFiniteNumber(worldY, 0) * scaleFactor,
    0,
    resolveWorldSize(mapDefinition),
  );
}

function normalizeWorldRadius(worldRadius, mapDefinition, options = {}) {
  const scaleFactor = resolveCoordinateScaleFactor(options);
  return Math.max(
    0,
    Math.min(
      resolveWorldSize(mapDefinition),
      toFiniteNumber(worldRadius, 0) * scaleFactor,
    ),
  );
}

function worldToPixelX(worldX, mapDefinition, imageWidth, options = {}) {
  const width = resolveImageWidth(imageWidth);
  const worldSize = resolveWorldSize(mapDefinition);
  const renderBounds = resolveRenderBounds(mapDefinition);
  const normalized = normalizeWorldX(worldX, mapDefinition, options) / worldSize;
  return clamp(((normalized - renderBounds.x) / renderBounds.width) * width, 0, width);
}

function worldToPixelY(worldY, mapDefinition, imageHeight, options = {}) {
  const height = resolveImageHeight(imageHeight, imageHeight);
  const worldSize = resolveWorldSize(mapDefinition);
  const renderBounds = resolveRenderBounds(mapDefinition);
  const normalizedFromTop = normalizeWorldY(worldY, mapDefinition, options) / worldSize;
  return clamp(((normalizedFromTop - renderBounds.y) / renderBounds.height) * height, 0, height);
}

function worldRadiusToPixelRadius(
  worldRadius,
  mapDefinition,
  imageWidth,
  imageHeight,
  options = {},
) {
  const width = resolveImageWidth(imageWidth);
  const height = resolveImageHeight(imageHeight, imageWidth);
  const worldSize = resolveWorldSize(mapDefinition);
  const renderBounds = resolveRenderBounds(mapDefinition);
  const pixelsPerWorldUnit = Math.min(
    width / (worldSize * renderBounds.width),
    height / (worldSize * renderBounds.height),
  );
  return Math.max(
    0,
    normalizeWorldRadius(worldRadius, mapDefinition, options) * pixelsPerWorldUnit,
  );
}

module.exports = {
  clamp,
  normalizeWorldRadius,
  normalizeWorldX,
  normalizeWorldY,
  resolveRenderBounds,
  resolveCoordinateScaleFactor,
  worldToPixelX,
  worldToPixelY,
  worldRadiusToPixelRadius,
};
