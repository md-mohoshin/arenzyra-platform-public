"use strict";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeFieldName(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const RESULT_OR_LIFECYCLE_FIELDS = new Set([
  "controlstatus",
  "ended",
  "endedat",
  "finalizationdurationms",
  "finalizationstartedat",
  "finalplacement",
  "finalplacements",
  "finished",
  "isended",
  "isfinalizing",
  "isfinished",
  "islocked",
  "lifecycle",
  "lifecyclestatus",
  "matchendedat",
  "matchstatus",
  "placement",
  "placementindex",
  "placements",
  "rank",
  "ranks",
  "resultfinalized",
  "resultslocked",
  "winner",
  "winnerteam",
  "winnerteamid",
]);

function sanitizeObserverTelemetryPayload(payload) {
  const strippedFields = [];

  const sanitize = (value, path) => {
    if (Array.isArray(value)) {
      return value.map((entry, index) => sanitize(entry, `${path}[${index}]`));
    }

    const record = asRecord(value);
    if (!record) {
      return value;
    }

    const clone = {};
    for (const [key, nested] of Object.entries(record)) {
      const normalized = normalizeFieldName(key);
      const fieldPath = path ? `${path}.${key}` : key;
      if (RESULT_OR_LIFECYCLE_FIELDS.has(normalized)) {
        strippedFields.push(fieldPath);
        continue;
      }
      clone[key] = sanitize(nested, fieldPath);
    }
    return clone;
  };

  return {
    sanitizedPayload: sanitize(payload, ""),
    strippedFields: strippedFields.sort((left, right) => left.localeCompare(right)),
  };
}

module.exports = {
  sanitizeObserverTelemetryPayload,
};
