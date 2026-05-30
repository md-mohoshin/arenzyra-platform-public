"use strict";

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMapKey(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function compareIds(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function uniqueList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  ).sort(compareIds);
}

function cloneReplayMarker(marker) {
  return {
    id: marker.id,
    timestamp: marker.timestamp,
    type: marker.type,
    description: marker.description,
    teams: marker.teams ? [...marker.teams] : undefined,
    players: marker.players ? [...marker.players] : undefined,
    map: marker.map ?? undefined,
  };
}

function compareReplayMarkers(left, right) {
  return (
    right.timestamp - left.timestamp ||
    String(left.id || "").localeCompare(String(right.id || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function createReplayMarkerStore({
  maxLength = 100,
  ttlMs = 20 * 60_000,
} = {}) {
  const markers = [];
  let sequence = 0;

  function purge(now = Date.now()) {
    const maxAgeMs = Math.max(1_000, toFiniteNumber(ttlMs) ?? 20 * 60_000);
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < markers.length; readIndex += 1) {
      const marker = markers[readIndex];
      if (!marker || now - marker.timestamp > maxAgeMs) {
        continue;
      }

      markers[writeIndex] = marker;
      writeIndex += 1;
    }

    markers.length = writeIndex;

    const maxEntries = Math.max(1, Math.round(toFiniteNumber(maxLength) ?? 100));
    if (markers.length <= maxEntries) {
      return;
    }

    markers.sort(compareReplayMarkers);
    markers.length = maxEntries;
  }

  function addMarker(marker, now = Date.now()) {
    const source = marker && typeof marker === "object" ? marker : {};
    const timestamp = toFiniteNumber(source.timestamp) ?? now;
    const type = normalizeId(source.type);
    const description = normalizeId(source.description);

    if (!type || !description) {
      return null;
    }

    purge(now);

    sequence += 1;
    const normalized = {
      id:
        normalizeId(source.id) ||
        `replay-marker:${type.toLowerCase()}:${Math.round(timestamp)}:${sequence}`,
      timestamp,
      type,
      description,
      teams: uniqueList(source.teams),
      players: uniqueList(source.players),
      map: normalizeMapKey(source.map),
    };

    markers.push(normalized);
    markers.sort(compareReplayMarkers);

    const maxEntries = Math.max(1, Math.round(toFiniteNumber(maxLength) ?? 100));
    if (markers.length > maxEntries) {
      markers.length = maxEntries;
    }

    return cloneReplayMarker(normalized);
  }

  function getMarkers(options = {}, now = Date.now()) {
    purge(now);

    const mapKey = normalizeMapKey(options?.mapKey ?? options?.map);
    const limit = Math.max(1, Math.round(toFiniteNumber(options?.limit) ?? maxLength));

    return markers
      .filter((marker) => !mapKey || marker.map === mapKey)
      .slice(0, limit)
      .map(cloneReplayMarker);
  }

  function getLatestMarker(options = {}, now = Date.now()) {
    const [latest] = getMarkers({ ...options, limit: 1 }, now);
    return latest || null;
  }

  function clear(mapKey = null) {
    const normalizedMapKey = normalizeMapKey(mapKey);
    if (!normalizedMapKey) {
      markers.length = 0;
      return;
    }

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < markers.length; readIndex += 1) {
      const marker = markers[readIndex];
      if (marker?.map === normalizedMapKey) {
        continue;
      }

      markers[writeIndex] = marker;
      writeIndex += 1;
    }

    markers.length = writeIndex;
  }

  return {
    addMarker,
    clear,
    getLatestMarker,
    getMarkers,
    purge,
  };
}

module.exports = {
  cloneReplayMarker,
  createReplayMarkerStore,
};
