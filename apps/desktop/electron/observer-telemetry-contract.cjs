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

const TEAM_COLLECTION_KEYS = new Set(["teams", "teaminfolist", "teamlist"]);

const LIVE_TEAM_PLACEMENT_FIELDS = new Set([
  "placement",
  "placementindex",
  "position",
  "rank",
]);

function isLiveTeamPlacementField(segments, normalizedField) {
  if (!LIVE_TEAM_PLACEMENT_FIELDS.has(normalizedField)) {
    return false;
  }

  const root = normalizeFieldName(segments[0] || "");
  return TEAM_COLLECTION_KEYS.has(root);
}

function sanitizeObserverTelemetryPayload(payload) {
  const strippedFields = [];

  const sanitize = (value, path, segments) => {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        sanitize(entry, `${path}[${index}]`, segments),
      );
    }

    const record = asRecord(value);
    if (!record) {
      return value;
    }

    const clone = {};
    for (const [key, nested] of Object.entries(record)) {
      const normalized = normalizeFieldName(key);
      const fieldPath = path ? `${path}.${key}` : key;
      if (
        RESULT_OR_LIFECYCLE_FIELDS.has(normalized) &&
        !isLiveTeamPlacementField(segments, normalized)
      ) {
        strippedFields.push(fieldPath);
        continue;
      }
      clone[key] = sanitize(nested, fieldPath, [...segments, key]);
    }
    return clone;
  };

  return {
    sanitizedPayload: sanitize(payload, "", []),
    strippedFields: strippedFields.sort((left, right) => left.localeCompare(right)),
  };
}

module.exports = {
  sanitizeObserverTelemetryPayload,
};
