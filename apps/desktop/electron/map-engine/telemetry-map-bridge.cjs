"use strict";

const {
  normalizeWorldRadius,
  normalizeWorldX,
  normalizeWorldY,
} = require("./coordinate-utils.cjs");

const MATCH_OPENING_PHASES = new Set(["plane", "parachuting", "lobby", "waiting"]);
const FLIGHT_PATH_POST_CIRCLE_RETENTION_MS = 30_000;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function pickFirstString(record, keys) {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function normalizeStatusValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return null;
}

function pickFirstStatus(record, keys) {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = normalizeStatusValue(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeIdentityValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  return null;
}

function pickFirstIdentity(record, keys) {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = normalizeIdentityValue(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function pickFirstNumber(record, keys) {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = toFiniteNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function pickFirstBoolean(record, keys) {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    if (typeof record[key] === "boolean") {
      return record[key];
    }
  }

  return null;
}

function toTimestampMs(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 10 ** 12) {
      return value;
    }
    if (value >= 10 ** 9 && value < 10 ** 12) {
      return value * 1000;
    }
    return null;
  }

  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return toTimestampMs(numeric);
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function pickFirstTimestamp(record, keys) {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const timestamp = toTimestampMs(record[key]);
    if (timestamp !== null) {
      return timestamp;
    }
  }

  return null;
}

function pickFirstRecord(record, keys) {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function extractRawMapName(snapshot) {
  const candidates = [
    snapshot?.allInfo,
    snapshot?.circlePayload,
    asRecord(snapshot?.observerSnapshot),
    asRecord(snapshot?.raw),
    Array.isArray(snapshot?.players) ? asRecord(snapshot.players[0]) : null,
    asRecord(snapshot?.observer),
  ];

  for (const candidate of candidates) {
    const rawMapName = pickFirstString(candidate, [
      "mapName",
      "MapName",
      "map",
      "Map",
      "mapId",
      "MapId",
      "MapNameStr",
    ]);

    if (rawMapName) {
      return rawMapName;
    }
  }

  return null;
}

function extractCircleGeometry(source) {
  const root = asRecord(source);
  if (!root) {
    return null;
  }

  const nested =
    pickFirstRecord(root, [
      "center",
      "Center",
      "zoneCenter",
      "ZoneCenter",
      "location",
      "Location",
      "position",
      "Position",
    ]) || root;

  const x = pickFirstNumber(nested, [
    "x",
    "X",
    "centerX",
    "CenterX",
    "posX",
    "PosX",
    "locationX",
    "LocationX",
  ]);
  const y = pickFirstNumber(nested, [
    "y",
    "Y",
    "centerY",
    "CenterY",
    "posY",
    "PosY",
    "locationY",
    "LocationY",
  ]);
  const radius = pickFirstNumber(root, [
    "r",
    "R",
    "radius",
    "Radius",
    "size",
    "Size",
    "zoneRadius",
    "ZoneRadius",
  ]);

  if (x === null || y === null || radius === null) {
    return null;
  }

  return { x, y, radius };
}

function extractWorldPoint(source) {
  const root = asRecord(source);
  if (!root) {
    return null;
  }

  const nested =
    pickFirstRecord(root, [
      "center",
      "Center",
      "location",
      "Location",
      "position",
      "Position",
      "start",
      "Start",
      "end",
      "End",
    ]) || root;

  const x = pickFirstNumber(nested, [
    "x",
    "X",
    "centerX",
    "CenterX",
    "posX",
    "PosX",
    "locationX",
    "LocationX",
  ]);
  const y = pickFirstNumber(nested, [
    "y",
    "Y",
    "centerY",
    "CenterY",
    "posY",
    "PosY",
    "locationY",
    "LocationY",
  ]);

  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function extractLiveState(record) {
  const value = pickFirstNumber(asRecord(record), [
    "liveState",
    "LiveState",
    "lifeState",
    "LifeState",
  ]);
  return value === null ? null : Math.trunc(value);
}

function extractFlightPath(source, depth = 0) {
  if (depth > 2) {
    return null;
  }

  if (Array.isArray(source)) {
    if (source.length >= 2) {
      const start = extractWorldPoint(source[0]);
      const end = extractWorldPoint(source[source.length - 1]);
      if (start && end) {
        return { start, end };
      }
    }

    for (const entry of source) {
      const nested = extractFlightPath(entry, depth + 1);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  const root = asRecord(source);
  if (!root) {
    return null;
  }

  const nestedPointSets = [
    ["start", "end"],
    ["startPoint", "endPoint"],
    ["startPos", "endPos"],
    ["startPosition", "endPosition"],
    ["routeStart", "routeEnd"],
    ["routeStartPos", "routeEndPos"],
    ["planeStart", "planeEnd"],
    ["planeStartPos", "planeEndPos"],
    ["flightStart", "flightEnd"],
    ["flightStartPos", "flightEndPos"],
    ["aircraftStart", "aircraftEnd"],
    ["aircraftStartPos", "aircraftEndPos"],
    ["lineStart", "lineEnd"],
  ];

  for (const [startKey, endKey] of nestedPointSets) {
    const start = extractWorldPoint(root[startKey]);
    const end = extractWorldPoint(root[endKey]);
    if (start && end) {
      return { start, end };
    }
  }

  const startX = pickFirstNumber(root, [
    "startX",
    "StartX",
    "routeStartX",
    "RouteStartX",
    "planeStartX",
    "PlaneStartX",
    "PlaneStartLocX",
    "flightStartX",
    "FlightStartX",
    "aircraftStartX",
    "AircraftStartX",
  ]);
  const startY = pickFirstNumber(root, [
    "startY",
    "StartY",
    "routeStartY",
    "RouteStartY",
    "planeStartY",
    "PlaneStartY",
    "PlaneStartLocY",
    "flightStartY",
    "FlightStartY",
    "aircraftStartY",
    "AircraftStartY",
  ]);
  const endX = pickFirstNumber(root, [
    "endX",
    "EndX",
    "routeEndX",
    "RouteEndX",
    "planeEndX",
    "PlaneEndX",
    "PlaneStopLocX",
    "flightEndX",
    "FlightEndX",
    "aircraftEndX",
    "AircraftEndX",
  ]);
  const endY = pickFirstNumber(root, [
    "endY",
    "EndY",
    "routeEndY",
    "RouteEndY",
    "planeEndY",
    "PlaneEndY",
    "PlaneStopLocY",
    "flightEndY",
    "FlightEndY",
    "aircraftEndY",
    "AircraftEndY",
  ]);

  if (startX !== null && startY !== null && endX !== null && endY !== null) {
    return {
      start: { x: startX, y: startY },
      end: { x: endX, y: endY },
    };
  }

  const routePoints = Array.isArray(root.routePoints)
    ? root.routePoints
    : Array.isArray(root.RoutePoints)
      ? root.RoutePoints
      : Array.isArray(root.points)
        ? root.points
        : Array.isArray(root.Points)
          ? root.Points
          : Array.isArray(root.route)
            ? root.route
            : Array.isArray(root.Route)
              ? root.Route
              : [];
  if (routePoints.length >= 2) {
    const start = extractWorldPoint(routePoints[0]);
    const end = extractWorldPoint(routePoints[routePoints.length - 1]);
    if (start && end) {
      return { start, end };
    }
  }

  for (const key of [
    "flightPath",
    "flightpath",
    "flightLine",
    "FlightLine",
    "flightRouteLine",
    "FlightRouteLine",
    "planePath",
    "PlanePath",
    "route",
    "Route",
    "routePayload",
    "RoutePayload",
    "routePayloads",
    "RoutePayloads",
    "planeRoute",
    "PlaneRoute",
    "flightRoute",
    "FlightRoute",
    "aircraftRoute",
    "AircraftRoute",
    "gameGlobalInfo",
    "GameGlobalInfo",
    "globalInfo",
    "GlobalInfo",
    "data",
    "Data",
  ]) {
    const nested = extractFlightPath(root[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function unwrapRoutePayload(value) {
  const record = asRecord(value);
  return record && Object.prototype.hasOwnProperty.call(record, "payload")
    ? record.payload
    : value;
}

function extractNamedRoutePayload(routePayloads, routeNames) {
  const root = asRecord(routePayloads);
  if (!root) {
    return null;
  }

  for (const routeName of routeNames) {
    const payload = asRecord(unwrapRoutePayload(root[routeName]));
    if (payload) {
      return payload;
    }
  }

  return null;
}

function extractFlightPathFromRoutePayloads(routePayloads) {
  const root = asRecord(routePayloads);
  if (!root) {
    return null;
  }

  for (const routeName of [
    "/setgameglobalinfo",
    "/getgameglobalinfo",
    "setgameglobalinfo",
    "getgameglobalinfo",
  ]) {
    const flightPath = extractFlightPath(unwrapRoutePayload(root[routeName]));
    if (flightPath) {
      return flightPath;
    }
  }

  return extractFlightPath(root);
}

function extractSnapshotFlightPath(snapshot) {
  const observerSnapshot = asRecord(snapshot?.observerSnapshot);
  const rawSnapshot = asRecord(snapshot?.raw);

  return (
    extractFlightPath(observerSnapshot?.normalized?.flightPath) ??
    extractFlightPath(rawSnapshot?.normalized?.flightPath) ??
    extractFlightPathFromRoutePayloads(observerSnapshot?.routePayloads) ??
    extractFlightPathFromRoutePayloads(observerSnapshot?.rawRoutePayloads) ??
    extractFlightPathFromRoutePayloads(rawSnapshot?.routePayloads) ??
    extractFlightPathFromRoutePayloads(rawSnapshot?.rawRoutePayloads) ??
    extractFlightPath(snapshot?.circlePayload) ??
    extractFlightPathFromRoutePayloads(snapshot?.routePayloads) ??
    extractFlightPathFromRoutePayloads(snapshot?.rawRoutePayloads) ??
    extractFlightPath(snapshot?.allInfo)
  );
}

function extractSnapshotCirclePayload(snapshot) {
  const observerSnapshot = asRecord(snapshot?.observerSnapshot);
  const rawSnapshot = asRecord(snapshot?.raw);
  const routeStores = [
    observerSnapshot?.rawRoutePayloads,
    observerSnapshot?.routePayloads,
    rawSnapshot?.rawRoutePayloads,
    rawSnapshot?.routePayloads,
    snapshot?.rawRoutePayloads,
    snapshot?.routePayloads,
  ];
  const globalPayloads = routeStores
    .map((routeStore) =>
      extractNamedRoutePayload(routeStore, [
        "/setgameglobalinfo",
        "/getgameglobalinfo",
        "setgameglobalinfo",
        "getgameglobalinfo",
      ]),
    )
    .filter(Boolean);
  const timerPayloads = routeStores
    .map((routeStore) =>
      extractNamedRoutePayload(routeStore, [
        "/setcircleinfo",
        "/getcircleinfo",
        "setcircleinfo",
        "getcircleinfo",
      ]),
    )
    .filter(Boolean);
  const records = [
    ...globalPayloads,
    asRecord(observerSnapshot?.gameGlobalInfo),
    asRecord(rawSnapshot?.gameGlobalInfo),
    asRecord(observerSnapshot?.circleInfo),
    asRecord(rawSnapshot?.circleInfo),
    asRecord(observerSnapshot?.normalized?.circle),
    asRecord(rawSnapshot?.normalized?.circle),
    ...timerPayloads,
    asRecord(snapshot?.circle),
    asRecord(snapshot?.circlePayload),
  ].filter(Boolean);

  return records.length > 0 ? Object.assign({}, ...records) : null;
}

function clipFlightPathToMapBounds(flightPath, definition, options = {}) {
  if (!flightPath?.start || !flightPath?.end) {
    return null;
  }

  const scaleFactor =
    Number.isFinite(options.detectedScaleFactor) && options.detectedScaleFactor > 0
      ? options.detectedScaleFactor
      : 1;
  const worldSize = Number.isFinite(definition?.worldSize) && definition.worldSize > 0
    ? definition.worldSize
    : 1;
  const start = {
    x: toFiniteNumber(flightPath.start.x),
    y: toFiniteNumber(flightPath.start.y),
  };
  const end = {
    x: toFiniteNumber(flightPath.end.x),
    y: toFiniteNumber(flightPath.end.y),
  };

  if (start.x === null || start.y === null || end.x === null || end.y === null) {
    return null;
  }

  const x1 = start.x * scaleFactor;
  const y1 = start.y * scaleFactor;
  const x2 = end.x * scaleFactor;
  const y2 = end.y * scaleFactor;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let minT = 0;
  let maxT = 1;

  const clipEdge = (p, q) => {
    if (p === 0) {
      return q >= 0;
    }
    const t = q / p;
    if (p < 0) {
      if (t > maxT) {
        return false;
      }
      if (t > minT) {
        minT = t;
      }
    } else {
      if (t < minT) {
        return false;
      }
      if (t < maxT) {
        maxT = t;
      }
    }
    return true;
  };

  if (
    !clipEdge(-dx, x1) ||
    !clipEdge(dx, worldSize - x1) ||
    !clipEdge(-dy, y1) ||
    !clipEdge(dy, worldSize - y1)
  ) {
    return null;
  }

  return {
    start: {
      x: x1 + dx * minT,
      y: y1 + dy * minT,
    },
    end: {
      x: x1 + dx * maxT,
      y: y1 + dy * maxT,
    },
  };
}

function extractPrimaryZone(circlePayload) {
  const root = asRecord(circlePayload);
  if (!root) {
    return null;
  }

  const fromSafeZone = extractCircleGeometry(
    pickFirstRecord(root, ["safeZone", "safezone", "zone", "currentZone"]),
  );
  if (fromSafeZone) {
    return fromSafeZone;
  }

  const fromBlueZone = extractCircleGeometry(
    pickFirstRecord(root, ["blueZone", "BlueZone"]),
  );
  if (fromBlueZone) {
    return fromBlueZone;
  }

  const circleArray = getCircleArrayZones(root);
  const circleArrayIndex = resolveCircleArrayIndex(root, circleArray.length);
  if (circleArrayIndex !== null && circleArray[circleArrayIndex]) {
    return circleArray[circleArrayIndex];
  }

  return extractCircleGeometry(root);
}

function circlesRoughlyMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  const radiusReference = Math.max(
    Math.abs(toFiniteNumber(left.radius) ?? 0),
    Math.abs(toFiniteNumber(right.radius) ?? 0),
  );
  const tolerance = Math.max(32, radiusReference * 0.0015);
  return (
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance &&
    Math.abs(left.radius - right.radius) <= tolerance
  );
}

function circleContainsCircle(outer, inner) {
  if (!outer || !inner) {
    return false;
  }

  const distance = Math.hypot(outer.x - inner.x, outer.y - inner.y);
  const tolerance = Math.max(64, Math.abs(outer.radius) * 0.002);
  return distance + inner.radius <= outer.radius + tolerance;
}

function buildInitialBlueZone(mapDefinition) {
  const worldSize = toFiniteNumber(mapDefinition?.worldSize);
  if (worldSize === null || worldSize <= 0) {
    return null;
  }

  const center = worldSize / 2;
  return {
    x: center,
    y: center,
    radius: Math.hypot(center, center) + worldSize * 0.08,
  };
}

function resolveExplicitBlueZone(circlePayload, fallbackCurrentCircle) {
  const root = asRecord(circlePayload);
  if (!root) {
    return null;
  }

  const currentBlueZone = extractCircleGeometry(
    pickFirstRecord(root, ["currentBlueZone", "CurrentBlueZone"]),
  );
  if (currentBlueZone) {
    if (
      fallbackCurrentCircle &&
      (circlesRoughlyMatch(currentBlueZone, fallbackCurrentCircle) ||
        !circleContainsCircle(currentBlueZone, fallbackCurrentCircle))
    ) {
      return null;
    }
    return currentBlueZone;
  }

  const legacyBlueZone = extractCircleGeometry(
    pickFirstRecord(root, ["blueZone", "BlueZone"]),
  );
  if (!legacyBlueZone) {
    return null;
  }

  // In live ShadowTracker payloads, "blueZone" often aliases the current safe zone.
  // Ignore it when it matches the current circle and fall back to phase-array reconstruction.
  if (circlesRoughlyMatch(legacyBlueZone, fallbackCurrentCircle)) {
    return null;
  }

  if (
    fallbackCurrentCircle &&
    !circleContainsCircle(legacyBlueZone, fallbackCurrentCircle)
  ) {
    return null;
  }

  return legacyBlueZone;
}

function extractNextZone(circlePayload) {
  const root = asRecord(circlePayload);
  if (!root) {
    return null;
  }

  const explicitNextZone = extractCircleGeometry(
    pickFirstRecord(root, ["nextZone", "nextzone", "whiteZone", "WhiteZone"]),
  );
  if (explicitNextZone) {
    return explicitNextZone;
  }

  const circleArray = getCircleArrayZones(root);
  const circleArrayIndex = resolveCircleArrayIndex(root, circleArray.length);
  if (
    circleArrayIndex !== null &&
    circleArrayIndex + 1 < circleArray.length &&
    circleArray[circleArrayIndex + 1]
  ) {
    return circleArray[circleArrayIndex + 1];
  }

  return null;
}

function getCirclePayloadRecords(circlePayload) {
  const root = asRecord(circlePayload);
  if (!root) {
    return [];
  }

  return [
    root,
    asRecord(root.circleInfo),
    asRecord(root.CircleInfo),
    asRecord(root.circle),
    asRecord(root.Circle),
  ].filter(Boolean);
}

function pickCirclePayloadNumber(circlePayload, keys) {
  for (const record of getCirclePayloadRecords(circlePayload)) {
    const value = pickFirstNumber(record, keys);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function pickCirclePayloadStatus(circlePayload, keys) {
  for (const record of getCirclePayloadRecords(circlePayload)) {
    const value = pickFirstStatus(record, keys);
    if (value) {
      return value;
    }
  }

  return null;
}

function pickCirclePayloadTimestamp(circlePayload, keys) {
  for (const record of getCirclePayloadRecords(circlePayload)) {
    const value = pickFirstTimestamp(record, keys);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function isCircleShrinkingStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return (
    normalized === "2" ||
    normalized === "moving" ||
    normalized === "shrinking" ||
    normalized === "closing"
  );
}

function resolveCircleMode(circlePayload) {
  const status =
    pickCirclePayloadStatus(circlePayload, [
      "CircleStatus",
      "circleStatus",
      "status",
      "Status",
    ]) ?? null;
  const normalized = String(status || "").trim().toLowerCase();

  if (
    normalized === "2" ||
    normalized === "moving" ||
    normalized === "shrinking" ||
    normalized === "shrink" ||
    normalized === "closing" ||
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

function resolveCircleTimer(circlePayload) {
  const counter = pickCirclePayloadNumber(circlePayload, [
    "Counter",
    "counter",
    "counterSeconds",
    "elapsedSeconds",
    "elapsedTime",
  ]);
  const maxTime = pickCirclePayloadNumber(circlePayload, [
    "MaxTime",
    "maxTime",
    "maxTimeSeconds",
    "phaseDuration",
    "PhaseDuration",
    "duration",
    "Duration",
  ]);
  const status =
    pickCirclePayloadStatus(circlePayload, [
      "CircleStatus",
      "circleStatus",
      "status",
      "Status",
    ]) ?? null;

  if (counter === null || maxTime === null || maxTime <= 0) {
    return {
      counter,
      maxTime,
      progress: null,
      remainingTime: null,
      status,
    };
  }

  // ShadowTracker's Counter is elapsed phase time, not remaining time.
  const elapsed = Math.max(0, Math.min(maxTime, counter));
  return {
    counter,
    maxTime,
    progress: clamp01(elapsed / maxTime),
    remainingTime: Math.max(0, maxTime - elapsed),
    status,
  };
}

function resolveCircleTimeRemaining(circlePayload) {
  const timer = resolveCircleTimer(circlePayload);
  if (timer.remainingTime !== null) {
    return timer.remainingTime;
  }

  const targetEndAt = pickCirclePayloadTimestamp(circlePayload, [
    "nextShrinkAt",
    "nextShrinkTs",
    "nextShrinkTime",
    "zoneNextShrinkAt",
    "nextPhaseAt",
  ]);
  if (targetEndAt !== null) {
    return Math.max(0, (targetEndAt - Date.now()) / 1000);
  }

  const remainingMs = pickCirclePayloadNumber(circlePayload, [
    "remainingMs",
    "timeRemainingMs",
  ]);
  if (remainingMs !== null) {
    return Math.max(0, remainingMs / 1000);
  }

  const explicitRemaining = pickCirclePayloadNumber(circlePayload, [
      "timeRemaining",
      "TimeRemaining",
      "timeRemainingSeconds",
      "remainingTime",
      "RemainingTime",
      "remainingSeconds",
      "RemainTime",
      "remainTime",
    ]);
  if (explicitRemaining !== null) {
    return explicitRemaining;
  }

  // PCOB Counter is elapsed time whenever MaxTime is present. In particular,
  // MaxTime=0 does not turn Counter into a remaining-time value.
  return timer.maxTime === null
    ? pickCirclePayloadNumber(circlePayload, ["Counter", "counter"])
    : null;
}

function resolveCirclePhaseDuration(circlePayload) {
  const timer = resolveCircleTimer(circlePayload);
  if (timer.maxTime !== null) {
    return timer.maxTime;
  }

  return (
    pickCirclePayloadNumber(circlePayload, [
      "phaseDuration",
      "PhaseDuration",
      "duration",
      "Duration",
      "MaxTime",
      "maxTime",
      "maxTimeSeconds",
    ]) ?? null
  );
}

function shouldShowZoneCircles(matchPhase, circlePayload) {
  const normalizedPhase = String(matchPhase || "").trim().toLowerCase();
  if (!MATCH_OPENING_PHASES.has(normalizedPhase)) {
    return true;
  }

  // Direct observer payloads can expose future circles before they are visible in the match.
  // Keep the geometry hidden until the opening timer has fully elapsed.
  const remainingTime = resolveCircleTimeRemaining(circlePayload);
  if (remainingTime === null) {
    return false;
  }

  return remainingTime <= 0;
}

function resolveCircleArrayIndex(circlePayload, circleArrayLength) {
  if (!Number.isFinite(circleArrayLength) || circleArrayLength <= 0) {
    return null;
  }

  const phase =
    pickCirclePayloadNumber(circlePayload, [
      "phase",
      "Phase",
      "phaseIndex",
      "circlePhase",
      "CircleIndex",
      "circleIndex",
    ]) ?? circleArrayLength;

  return Math.max(0, Math.min(circleArrayLength - 1, Math.trunc(phase) - 1));
}

function getCircleArrayZones(circlePayload) {
  const root = asRecord(circlePayload);
  const circleArray = Array.isArray(root?.CircleArray)
    ? root.CircleArray
    : Array.isArray(root?.circleArray)
      ? root.circleArray
      : [];

  return circleArray.map((entry) => extractCircleGeometry(entry));
}

function lerpNumber(start, end, progress) {
  return start + (end - start) * progress;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function interpolateCircle(start, end, progress) {
  return {
    x: lerpNumber(start.x, end.x, progress),
    y: lerpNumber(start.y, end.y, progress),
    radius: lerpNumber(start.radius, end.radius, progress),
  };
}

function extractBlueZone(circlePayload, mapDefinition) {
  const root = asRecord(circlePayload);
  if (!root) {
    return null;
  }

  const fallbackCurrentCircle = extractPrimaryZone(root);
  const explicitBlueZone = resolveExplicitBlueZone(root, fallbackCurrentCircle);
  if (explicitBlueZone) {
    return explicitBlueZone;
  }

  const circleArray = getCircleArrayZones(root);
  if (circleArray.length === 0) {
    return null;
  }

  const currentIndex = resolveCircleArrayIndex(root, circleArray.length);
  if (currentIndex === null) {
    return null;
  }
  const targetCircle = circleArray[currentIndex];
  const timer = resolveCircleTimer(root);
  const previousCircle =
    currentIndex > 0
      ? circleArray[Math.max(0, currentIndex - 1)] || targetCircle
      : isCircleShrinkingStatus(timer.status)
        ? buildInitialBlueZone(mapDefinition) || targetCircle
        : null;

  if (!targetCircle || !previousCircle) {
    return null;
  }

  const canAnimateFromTimer =
    timer.progress !== null &&
    !circlesRoughlyMatch(previousCircle, targetCircle) &&
    (isCircleShrinkingStatus(timer.status) || timer.status === null);
  if (canAnimateFromTimer) {
    return interpolateCircle(previousCircle, targetCircle, timer.progress);
  }

  return previousCircle;
}

function extractPosition(record) {
  const root = asRecord(record);
  if (!root) {
    return null;
  }

  const nested =
    pickFirstRecord(root, [
      "location",
      "Location",
      "position",
      "Position",
      "pos",
      "Pos",
      "transform",
      "Transform",
    ]) || root;

  const x = pickFirstNumber(nested, [
    "x",
    "X",
    "posX",
    "PosX",
    "locationX",
    "LocationX",
  ]);
  const y = pickFirstNumber(nested, [
    "y",
    "Y",
    "posY",
    "PosY",
    "locationY",
    "LocationY",
  ]);
  const z = pickFirstNumber(nested, [
    "z",
    "Z",
    "posZ",
    "PosZ",
    "locationZ",
    "LocationZ",
  ]);

  if (x === null || y === null) {
    return null;
  }

  return { x, y, z };
}

function extractAlive(record) {
  const root = asRecord(record);
  if (!root) {
    return null;
  }

  const explicitAlive = pickFirstBoolean(root, [
    "alive",
    "Alive",
    "isAlive",
    "IsAlive",
    "bAlive",
  ]);
  const explicitDead = pickFirstBoolean(root, [
    "bHasDied",
    "hasDied",
    "HasDied",
    "isDead",
    "IsDead",
    "dead",
    "eliminated",
  ]);
  if (explicitAlive === false || explicitDead === true) {
    return false;
  }

  const aliveState = pickFirstString(root, ["aliveState", "AliveState", "state", "State"]);
  if (aliveState) {
    const normalized = aliveState.toLowerCase();
    if (
      normalized.includes("dead") ||
      normalized.includes("died") ||
      normalized.includes("eliminated")
    ) {
      return false;
    }
    if (
      normalized.includes("alive") ||
      normalized.includes("running") ||
      normalized.includes("standing")
    ) {
      return true;
    }
  }

  const liveState = pickFirstNumber(root, ["liveState", "LiveState", "lifeState", "LifeState"]);
  if (liveState !== null) {
    return Math.trunc(liveState) !== 5;
  }

  const hp = pickFirstNumber(root, ["hp", "HP", "health", "Health"]);
  if (hp !== null) {
    return hp > 0;
  }

  if (explicitAlive === true || explicitDead === false) {
    return true;
  }

  return null;
}

function extractHealth(record) {
  const root = asRecord(record);
  if (!root) {
    return null;
  }

  const hp = pickFirstNumber(root, ["hp", "HP", "health", "Health"]);
  if (hp === null) {
    return null;
  }

  return Math.max(0, Math.min(100, hp));
}

function extractKnocked(record) {
  const root = asRecord(record);
  if (!root) {
    return null;
  }

  for (const key of ["knocked", "Knocked", "isKnocked", "IsKnocked", "isDown", "IsDown"]) {
    if (typeof root[key] === "boolean") {
      return root[key];
    }
  }

  const aliveState = pickFirstString(root, ["aliveState", "AliveState", "state", "State"]);
  if (aliveState) {
    const normalized = aliveState.toLowerCase();
    if (normalized.includes("knocked") || normalized.includes("down")) {
      return true;
    }
  }

  const liveState = pickFirstNumber(root, ["liveState", "LiveState", "lifeState", "LifeState"]);
  if (liveState !== null) {
    return Math.trunc(liveState) === 4;
  }

  return null;
}

function extractInVehicle(record) {
  const root = asRecord(record);
  if (!root) {
    return null;
  }

  for (const key of [
    "inVehicle",
    "InVehicle",
    "isInVehicle",
    "IsInVehicle",
    "isDriving",
    "IsDriving",
    "isRiding",
    "IsRiding",
  ]) {
    if (typeof root[key] === "boolean") {
      return root[key];
    }
  }

  const aliveState = pickFirstString(root, ["aliveState", "AliveState", "state", "State"]);
  if (aliveState) {
    const normalized = aliveState.toLowerCase();
    if (
      normalized.includes("vehicle") ||
      normalized.includes("driving") ||
      normalized.includes("riding")
    ) {
      return true;
    }
  }

  const liveState = pickFirstNumber(root, ["liveState", "LiveState", "lifeState", "LifeState"]);
  if (liveState !== null) {
    return Math.trunc(liveState) === 3;
  }

  return null;
}

function extractIsFiring(record) {
  return pickFirstBoolean(asRecord(record), ["isFiring", "IsFiring"]) === true;
}

function normalizeAngleDegrees(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }

  const degrees = Math.abs(numeric) <= Math.PI * 2 + 0.001 ? (numeric * 180) / Math.PI : numeric;
  return ((degrees % 360) + 360) % 360;
}

function extractFireAngle(record) {
  const root = asRecord(record);
  if (!root) {
    return null;
  }

  return normalizeAngleDegrees(
    pickFirstNumber(root, [
      "fireAngle",
      "FireAngle",
      "firingAngle",
      "FiringAngle",
      "shootAngle",
      "ShootAngle",
      "aimAngle",
      "AimAngle",
      "weaponAngle",
      "WeaponAngle",
      "viewAngle",
      "ViewAngle",
      "viewYaw",
      "ViewYaw",
      "yaw",
      "Yaw",
      "rotationYaw",
      "RotationYaw",
      "rotYaw",
      "RotYaw",
      "direction",
      "Direction",
      "heading",
      "Heading",
      "facing",
      "Facing",
      "orientation",
      "Orientation",
    ]),
  );
}

function normalizeDirectionVector(xValue, yValue) {
  const x = toFiniteNumber(xValue);
  const y = toFiniteNumber(yValue);
  if (x === null || y === null) {
    return null;
  }

  const magnitude = Math.hypot(x, y);
  if (!Number.isFinite(magnitude) || magnitude <= 0.0001) {
    return null;
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
  };
}

function extractFireDirection(record) {
  const root = asRecord(record);
  if (!root) {
    return null;
  }

  const direct = normalizeDirectionVector(
    pickFirstNumber(root, [
      "fireDirectionX",
      "FireDirectionX",
      "firingDirectionX",
      "FiringDirectionX",
      "aimDirectionX",
      "AimDirectionX",
      "viewDirectionX",
      "ViewDirectionX",
      "directionX",
      "DirectionX",
      "dirX",
      "DirX",
    ]),
    pickFirstNumber(root, [
      "fireDirectionY",
      "FireDirectionY",
      "firingDirectionY",
      "FiringDirectionY",
      "aimDirectionY",
      "AimDirectionY",
      "viewDirectionY",
      "ViewDirectionY",
      "directionY",
      "DirectionY",
      "dirY",
      "DirY",
    ]),
  );
  if (direct) {
    return direct;
  }

  const nested =
    pickFirstRecord(root, [
      "fireDirection",
      "FireDirection",
      "firingDirection",
      "FiringDirection",
      "aimDirection",
      "AimDirection",
      "viewDirection",
      "ViewDirection",
      "direction",
      "Direction",
      "rotation",
      "Rotation",
    ]) || null;
  if (!nested) {
    return null;
  }

  return normalizeDirectionVector(
    pickFirstNumber(nested, ["x", "X", "dx", "DX", "dirX", "DirX"]),
    pickFirstNumber(nested, ["y", "Y", "dy", "DY", "dirY", "DirY"]),
  );
}

function normalizeSlotNumber(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }

  const slot = Math.trunc(numeric);
  return slot > 0 ? slot : null;
}

function extractTeamSlot(record) {
  const root = asRecord(record);
  if (!root) {
    return null;
  }

  const directSlot = pickFirstNumber(root, [
    "slot",
    "Slot",
    "slotNumber",
    "SlotNumber",
    "teamNo",
    "TeamNo",
    "teamNumber",
    "TeamNumber",
    "teamIndex",
    "TeamIndex",
  ]);
  if (directSlot !== null) {
    return normalizeSlotNumber(directSlot);
  }

  const numericTeamId = pickFirstNumber(root, ["teamId", "TeamId", "teamID", "TeamID"]);
  if (numericTeamId !== null) {
    return normalizeSlotNumber(numericTeamId);
  }

  return normalizeSlotNumber(pickFirstString(root, ["teamId", "TeamId", "teamID", "TeamID"]));
}

function extractTeamKey(record) {
  const slot = extractTeamSlot(record);
  if (slot !== null) {
    return String(slot);
  }

  return pickFirstIdentity(record, ["teamId", "TeamId", "teamID", "TeamID", "teamNo", "TeamNo"]);
}

function extractPlayerControlIdentity(record) {
  return pickFirstIdentity(asRecord(record), [
    "uId",
    "uid",
    "UID",
    "playerOpenId",
    "playerOpenID",
    "PlayerOpenId",
    "PlayerOpenID",
    "openId",
    "OpenId",
    "openid",
    "playerId",
    "PlayerId",
    "playerID",
    "PlayerID",
    "playerKey",
    "PlayerKey",
  ]);
}

function extractExpectedRosterSize(record) {
  const size = pickFirstNumber(asRecord(record), [
    "totalPlayers",
    "TotalPlayers",
    "totalPlayerCount",
    "playerCount",
    "memberNum",
    "MemberNum",
    "playerNum",
    "PlayerNum",
    "liveMemberNum",
    "LiveMemberNum",
    "aliveMemberNum",
    "AliveMemberNum",
  ]);
  if (size === null) {
    return null;
  }

  const normalized = Math.trunc(size);
  return normalized >= 1 && normalized <= 9 ? normalized : null;
}

function filterObserverCurrentRosterPlayers(players, teams) {
  const source = Array.isArray(players) ? players : [];
  const teamSource = Array.isArray(teams) ? teams : [];
  const currentTeamKeys = new Set(
    teamSource.map((team) => extractTeamKey(asRecord(team))).filter(Boolean),
  );
  const expectedMaxRosterSize = currentTeamKeys.size * 4;

  if (
    source.length === 0 ||
    currentTeamKeys.size === 0 ||
    source.length <= expectedMaxRosterSize
  ) {
    return {
      players: source,
      staleCount: 0,
    };
  }

  const roster = [];
  const closedTeamKeys = new Set();
  const teamCounts = new Map();
  let lastTeamKey = null;
  let staleBlockDetected = false;
  let overflowDetected = false;

  for (const player of source) {
    const record = asRecord(player);
    const teamKey = extractTeamKey(record);
    if (!teamKey || !currentTeamKeys.has(teamKey)) {
      continue;
    }

    if (lastTeamKey !== null && teamKey !== lastTeamKey) {
      closedTeamKeys.add(lastTeamKey);
    }

    if (teamKey !== lastTeamKey && closedTeamKeys.has(teamKey)) {
      staleBlockDetected = true;
      break;
    }

    lastTeamKey = teamKey;

    const teamCount = teamCounts.get(teamKey) || 0;
    if (teamCount >= 4) {
      overflowDetected = true;
      continue;
    }

    teamCounts.set(teamKey, teamCount + 1);
    roster.push(player);
  }

  if (
    (staleBlockDetected || overflowDetected) &&
    roster.length >= currentTeamKeys.size &&
    roster.length <= expectedMaxRosterSize
  ) {
    return {
      players: roster,
      staleCount: Math.max(0, source.length - roster.length),
    };
  }

  return {
    players: source,
    staleCount: 0,
  };
}

function normalizeLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

function computeTelemetryQuality(record) {
  const root = asRecord(record);
  if (!root) {
    return 0;
  }

  let score = 0;
  if (
    pickFirstString(root, [
      "playerOpenId",
      "playerOpenID",
      "PlayerOpenId",
      "PlayerOpenID",
      "openId",
      "OpenId",
      "openid",
    ])
  ) {
    score += 1000;
  }

  if (
    pickFirstIdentity(root, [
      "uId",
      "uid",
      "UID",
      "playerKey",
      "PlayerKey",
      "playerId",
      "PlayerId",
      "playerID",
      "PlayerID",
    ])
  ) {
    score += 100;
  }

  for (const key of [
    "damage",
    "Damage",
    "killNum",
    "KillNum",
    "killNumBeforeDie",
    "KillNumBeforeDie",
    "assists",
    "Assists",
    "knockouts",
    "Knockouts",
    "rank",
    "Rank",
    "survivalTime",
    "SurvivalTime",
  ]) {
    if ((toFiniteNumber(root[key]) ?? 0) > 0) {
      score += 1;
    }
  }

  if (pickFirstBoolean(root, ["isFiring", "IsFiring"]) === true) {
    score += 1;
  }

  return score;
}

function buildPlayerDedupeKey(player) {
  const playerKey = normalizeLookupValue(
    player?.sourceDedupeId || player?.playerId || player?.playerName,
  );
  if (!playerKey) {
    return null;
  }

  const teamKey = normalizeLookupValue(player?.teamId || player?.teamSlot);
  return teamKey ? `${teamKey}:${playerKey}` : playerKey;
}

function dedupePositionedPlayers(players) {
  const source = Array.isArray(players) ? players : [];
  const order = [];
  const byKey = new Map();
  let duplicateCount = 0;

  for (const player of source) {
    const key = buildPlayerDedupeKey(player);
    if (!key) {
      order.push(null);
      continue;
    }

    if (!byKey.has(key)) {
      byKey.set(key, player);
      order.push(key);
      continue;
    }

    duplicateCount += 1;
    const current = byKey.get(key);
    const currentQuality = toFiniteNumber(current?.sourceQuality) ?? 0;
    const nextQuality = toFiniteNumber(player?.sourceQuality) ?? 0;
    if (nextQuality > currentQuality) {
      byKey.set(key, player);
    }
  }

  const deduped = [];
  for (const key of order) {
    if (!key) {
      continue;
    }

    const player = byKey.get(key);
    if (player) {
      deduped.push(player);
      byKey.delete(key);
    }
  }

  return {
    players: deduped,
    duplicateCount,
  };
}

function buildPlayerLookupKey(teamId, playerKey) {
  const normalizedPlayerKey = normalizeLookupValue(playerKey);
  if (!normalizedPlayerKey) {
    return null;
  }

  const normalizedTeamId = normalizeLookupValue(teamId);
  return normalizedTeamId
    ? `${normalizedTeamId}:${normalizedPlayerKey}`
    : normalizedPlayerKey;
}

function registerPlayerLookup(lookup, teamId, playerKey, player) {
  const key = buildPlayerLookupKey(teamId, playerKey);
  if (!key || lookup.has(key)) {
    return;
  }

  lookup.set(key, player);
}

function buildPlayerLookup(players) {
  const lookup = new Map();
  const source = Array.isArray(players) ? players : [];

  for (const player of source) {
    registerPlayerLookup(lookup, player.teamId, player.playerId, player);
    registerPlayerLookup(lookup, player.teamId, player.playerName, player);
    registerPlayerLookup(lookup, null, player.playerId, player);
    registerPlayerLookup(lookup, null, player.playerName, player);
  }

  return lookup;
}

function extractCombatPosition(record) {
  const direct = extractPosition(record);
  if (direct) {
    return direct;
  }

  const root = asRecord(record);
  if (!root) {
    return null;
  }

  const nestedCandidates = [
    pickFirstRecord(root, [
      "deathPosition",
      "DeathPosition",
      "victimPosition",
      "VictimPosition",
      "killerPosition",
      "KillerPosition",
      "targetPosition",
      "TargetPosition",
      "impactPosition",
      "ImpactPosition",
      "hitPosition",
      "HitPosition",
    ]),
    pickFirstRecord(root, ["victim", "Victim", "target", "Target"]),
    pickFirstRecord(root, ["killer", "Killer", "attacker", "Attacker"]),
  ];

  for (const candidate of nestedCandidates) {
    const position = extractPosition(candidate);
    if (position) {
      return position;
    }
  }

  return null;
}

function extractCombatKind(record) {
  const root = asRecord(record);
  if (!root) {
    return "kill";
  }

  const knockFlag = pickFirstBoolean(root, [
    "isKnock",
    "IsKnock",
    "knock",
    "Knock",
    "isKnocked",
    "IsKnocked",
    "isDown",
    "IsDown",
  ]);
  if (knockFlag === true) {
    return "knock";
  }

  const killFlag = pickFirstBoolean(root, [
    "isKill",
    "IsKill",
    "kill",
    "Kill",
    "finished",
    "Finished",
  ]);
  if (killFlag === true) {
    return "kill";
  }

  // ShadowTracker PCOB reports 1 when the victim is knocked and 2 when the
  // victim is eliminated. This field is more authoritative than the generic
  // route/status labels used by other telemetry providers.
  const resultHealthStatus = pickFirstStatus(root, [
    "ResultHealthStatus",
    "resultHealthStatus",
  ]);
  if (resultHealthStatus === "1") {
    return "knock";
  }
  if (resultHealthStatus === "2") {
    return "kill";
  }

  const eventType = pickFirstString(root, [
    "eventType",
    "EventType",
    "type",
    "Type",
    "eventName",
    "EventName",
    "status",
    "Status",
    "result",
    "Result",
    "action",
    "Action",
  ]);
  const normalized = normalizeLookupValue(eventType);
  if (
    normalized.includes("knock") ||
    normalized.includes("down") ||
    normalized.includes("dbno")
  ) {
    return "knock";
  }

  return "kill";
}

function resolveCombatParticipant(playerLookup, teamId, identities) {
  if (!(playerLookup instanceof Map)) {
    return null;
  }

  for (const identity of identities) {
    for (const candidateTeamId of [teamId, null]) {
      const lookupKey = buildPlayerLookupKey(candidateTeamId, identity);
      if (!lookupKey) {
        continue;
      }
      const matchedPlayer = playerLookup.get(lookupKey);
      if (matchedPlayer) {
        return matchedPlayer;
      }
    }
  }

  return null;
}

function buildCombatEventId({
  kind,
  timestamp,
  x,
  y,
  killerPlayerId,
  killerTeamId,
  victimPlayerId,
  victimTeamId,
  killerName,
  victimName,
}) {
  return [
    kind,
    Math.round(timestamp),
    Math.round(x / 250),
    Math.round(y / 250),
    normalizeLookupValue(killerPlayerId),
    normalizeLookupValue(killerTeamId),
    normalizeLookupValue(victimPlayerId),
    normalizeLookupValue(victimTeamId),
    normalizeLookupValue(killerName),
    normalizeLookupValue(victimName),
  ].join("|");
}

function extractCombatEvents({
  kills,
  positionedPlayers,
  definition,
  scaleFactor,
  fallbackTimestamp,
}) {
  const source = Array.isArray(kills) ? kills : [];
  const playerLookup = buildPlayerLookup(positionedPlayers);
  const events = [];

  for (const item of source) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const explicitKillerTeamId = pickFirstIdentity(record, [
      "killerTeamId",
      "killerTeam",
      "killerTeamID",
      "CauserTeamID",
      "CauserTeamId",
      "causerTeamId",
      "teamId",
    ]);
    const killerPlayerId = pickFirstIdentity(record, [
      "CauserUID",
      "causerUID",
      "causerUid",
      "killerPlayerId",
      "killerId",
      "attackerPlayerId",
      "attackerId",
      "killerUid",
      "killerUID",
    ]);
    const explicitVictimTeamId = pickFirstIdentity(record, [
      "victimTeamId",
      "victimTeam",
      "targetTeamId",
      "targetTeam",
      "VictimTeamID",
      "VictimTeamId",
    ]);
    const victimPlayerId = pickFirstIdentity(record, [
      "VictimUID",
      "victimUID",
      "victimUid",
      "victimPlayerId",
      "victimId",
      "targetPlayerId",
      "targetId",
    ]);
    const killerName = pickFirstString(record, [
      "CauserName",
      "causerName",
      "killerName",
      "killer",
      "killerPlayer",
      "attackerName",
    ]);
    const victimName = pickFirstString(record, [
      "VictimName",
      "victimName",
      "victim",
      "targetName",
    ]);
    const resolvedKiller = resolveCombatParticipant(
      playerLookup,
      explicitKillerTeamId,
      [killerPlayerId, killerName],
    );
    const resolvedVictim = resolveCombatParticipant(
      playerLookup,
      explicitVictimTeamId,
      [victimPlayerId, victimName],
    );
    const killerTeamId =
      explicitKillerTeamId ||
      normalizeIdentityValue(resolvedKiller?.teamId) ||
      normalizeIdentityValue(resolvedKiller?.teamSlot);
    const victimTeamId =
      explicitVictimTeamId ||
      normalizeIdentityValue(resolvedVictim?.teamId) ||
      normalizeIdentityValue(resolvedVictim?.teamSlot);
    const rawPosition =
      extractCombatPosition(record) ||
      (resolvedVictim ? { x: resolvedVictim.x, y: resolvedVictim.y } : null) ||
      (resolvedKiller ? { x: resolvedKiller.x, y: resolvedKiller.y } : null);
    if (!rawPosition) {
      continue;
    }

    const timestamp =
      pickFirstTimestamp(record, [
        "_pcobReceivedAtMs",
        "receivedAtMs",
        "ts",
        "TS",
        "timestamp",
        "Timestamp",
        "time",
        "Time",
        "killTime",
        "KillTime",
        "eventTime",
        "EventTime",
      ]) ?? fallbackTimestamp;
    const relativeEventTime = pickFirstNumber(record, [
      "CurGameTime",
      "curGameTime",
      "gameTime",
      "GameTime",
    ]);
    const identityTimestamp =
      relativeEventTime === null ? timestamp : Math.round(relativeEventTime * 1000);
    const kind = extractCombatKind(record);
    const x = normalizeWorldX(rawPosition.x, definition, {
      detectedScaleFactor: scaleFactor,
    });
    const y = normalizeWorldY(rawPosition.y, definition, {
      detectedScaleFactor: scaleFactor,
    });

    events.push({
      id: buildCombatEventId({
        kind,
        timestamp: identityTimestamp,
        x,
        y,
        killerPlayerId,
        killerTeamId,
        victimPlayerId,
        victimTeamId,
        killerName,
        victimName,
      }),
      kind,
      x,
      y,
      timestamp,
      killerPlayerId: killerPlayerId || null,
      killerTeamId: killerTeamId || null,
      killerName: killerName || null,
      victimPlayerId: victimPlayerId || null,
      victimTeamId: victimTeamId || null,
      victimName: victimName || null,
    });
  }

  return events;
}

function extractEventTimestamp(snapshot) {
  const timestampKeys = [
    "timestamp",
    "Timestamp",
    "packetTimestamp",
    "PacketTimestamp",
    "eventTimestamp",
    "EventTimestamp",
    "serverTimestamp",
    "ServerTimestamp",
    "serverTime",
    "ServerTime",
    "createdAt",
    "CreatedAt",
    "updatedAt",
    "UpdatedAt",
    "ts",
    "TS",
  ];
  const candidates = [
    asRecord(snapshot),
    snapshot?.circlePayload ? asRecord(snapshot.circlePayload) : null,
    snapshot?.allInfo ? asRecord(snapshot.allInfo) : null,
    snapshot?.observer ? asRecord(snapshot.observer) : null,
    Array.isArray(snapshot?.players) ? asRecord(snapshot.players[0]) : null,
  ];

  for (const candidate of candidates) {
    const timestamp = pickFirstTimestamp(candidate, timestampKeys);
    if (timestamp !== null) {
      return timestamp;
    }
  }

  return null;
}

function extractRouteReceivedAt(routePayloads, routeName) {
  const root = asRecord(routePayloads);
  const entry = asRecord(root?.[routeName]);
  return pickFirstTimestamp(entry, [
    "receivedAt",
    "receivedAtMs",
    "updatedAt",
    "timestamp",
  ]);
}

function extractPlayerEventTimestamp(snapshot) {
  const observerSnapshot = asRecord(snapshot?.observerSnapshot);
  const rawSnapshot = asRecord(snapshot?.raw);
  const routeStores = [
    observerSnapshot?.rawRoutePayloads,
    rawSnapshot?.rawRoutePayloads,
    observerSnapshot?.routePayloads,
    rawSnapshot?.routePayloads,
    snapshot?.rawRoutePayloads,
    snapshot?.routePayloads,
  ];

  for (const routeStore of routeStores) {
    const timestamp = extractRouteReceivedAt(routeStore, "/totalmessage");
    if (timestamp !== null) {
      return timestamp;
    }
  }
  return null;
}

function detectCoordinateScale(mapDefinition, values) {
  const hint = toFiniteNumber(mapDefinition?.coordinateScaleHint) ?? 1;
  if (hint <= 1) {
    return 1;
  }

  const finiteValues = values.filter((value) => Number.isFinite(value) && Math.abs(value) > 0);
  if (finiteValues.length === 0) {
    return 1;
  }

  const maxValue = Math.max(...finiteValues.map((value) => Math.abs(value)));
  return maxValue <= mapDefinition.worldSize / 20 ? hint : 1;
}

function buildCoordinateBoundsDiagnostics({
  definition,
  scaleFactor,
  players,
  primaryZone,
  nextZone,
}) {
  const worldSize = toFiniteNumber(definition?.worldSize);
  const safeScaleFactor = toFiniteNumber(scaleFactor) ?? 1;
  const tolerance = worldSize === null ? 0 : Math.max(1, worldSize * 0.001);
  const isOutside = (value) => {
    const numeric = toFiniteNumber(value);
    return (
      worldSize !== null &&
      worldSize > 0 &&
      numeric !== null &&
      (numeric * safeScaleFactor < -tolerance ||
        numeric * safeScaleFactor > worldSize + tolerance)
    );
  };
  const playerPoints = (Array.isArray(players) ? players : []).filter(
    (player) => Number.isFinite(player?.x) && Number.isFinite(player?.y),
  );
  const zonePoints = [primaryZone, nextZone].filter(
    (zone) => Number.isFinite(zone?.x) && Number.isFinite(zone?.y),
  );
  const playerOutOfBoundsCount = playerPoints.filter(
    (player) => isOutside(player.x) || isOutside(player.y),
  ).length;
  const zoneCenterOutOfBoundsCount = zonePoints.filter(
    (zone) => isOutside(zone.x) || isOutside(zone.y),
  ).length;

  return {
    boundsStatus:
      playerOutOfBoundsCount > 0 || zoneCenterOutOfBoundsCount > 0
        ? "out-of-bounds-observed"
        : "within-nominal-bounds",
    playerCoordinateSampleCount: playerPoints.length,
    playerOutOfBoundsCount,
    zoneCenterSampleCount: zonePoints.length,
    zoneCenterOutOfBoundsCount,
  };
}

function hasExplicitPcobWorldCoordinates(snapshot, source) {
  const normalizedSource = normalizeLookupValue(source);
  if (normalizedSource === "direct-observer" || normalizedSource === "telemetry-bridge") {
    return true;
  }

  const observerSnapshot = asRecord(snapshot?.observerSnapshot);
  const rawSnapshot = asRecord(snapshot?.raw);
  const producer = normalizeLookupValue(
    observerSnapshot?.producer || rawSnapshot?.producer,
  );
  const coordinateSystem = normalizeLookupValue(
    observerSnapshot?.normalized?.flightPath?.coordinateSystem ||
      rawSnapshot?.normalized?.flightPath?.coordinateSystem,
  );
  return producer.includes("shadowtracker") || coordinateSystem === "world";
}

function extractSnapshotPlayers(snapshot) {
  if (Array.isArray(snapshot?.players) && snapshot.players.length > 0) {
    return snapshot.players;
  }

  const observerSnapshot = asRecord(snapshot?.observerSnapshot);
  const rawSnapshot = asRecord(snapshot?.raw);
  const candidates = [
    observerSnapshot?.normalized?.players,
    observerSnapshot?.playerInfoList,
    observerSnapshot?.allInfo?.TotalPlayerList,
    rawSnapshot?.normalized?.players,
    rawSnapshot?.playerInfoList,
    rawSnapshot?.allInfo?.TotalPlayerList,
  ];
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) || [];
}

function extractSnapshotTeams(snapshot) {
  if (Array.isArray(snapshot?.teams) && snapshot.teams.length > 0) {
    return snapshot.teams;
  }

  const observerSnapshot = asRecord(snapshot?.observerSnapshot);
  const rawSnapshot = asRecord(snapshot?.raw);
  const candidates = [
    observerSnapshot?.normalized?.teams,
    observerSnapshot?.teamInfoList,
    observerSnapshot?.allInfo?.TeamInfoList,
    rawSnapshot?.normalized?.teams,
    rawSnapshot?.teamInfoList,
    rawSnapshot?.allInfo?.TeamInfoList,
  ];
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) || [];
}

function unwrapPcobKillEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      const wrapper = asRecord(entry);
      const payload = asRecord(wrapper?.payload);
      if (!payload) {
        return null;
      }

      const receivedAtMs = toFiniteNumber(wrapper.receivedAtMs);
      return receivedAtMs === null
        ? payload
        : { ...payload, _pcobReceivedAtMs: receivedAtMs };
    })
    .filter(Boolean);
}

function extractSnapshotKills(snapshot) {
  const observerSnapshot = asRecord(snapshot?.observerSnapshot);
  const rawSnapshot = asRecord(snapshot?.raw);
  const retainedEntries = [
    ...unwrapPcobKillEntries(observerSnapshot?.killInfoEntries),
    ...unwrapPcobKillEntries(rawSnapshot?.killInfoEntries),
  ];
  if (retainedEntries.length > 0) {
    return retainedEntries;
  }

  const candidates = [
    snapshot?.kills,
    observerSnapshot?.killInfo,
    rawSnapshot?.killInfo,
  ];
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length > 0) || [];
}

function createMapTelemetryBridge({ engine, registry, log: _log = () => {} }) {
  let lastResolvedMapKey = null;
  const lastFlightPathByMapKey = new Map();
  const firstCircleVisibleAtByMapKey = new Map();
  const coordinateScaleByMapAndSource = new Map();
  const flightPathRetentionEligibleByMapKey = new Set();
  const playerControlRosterByMapAndTeam = new Map();

  function resolvePcobPlayerControlNumbers({ players, teams, mapKey, matchPhase }) {
    const numbersByPlayerKey = new Map();
    const unresolvedTeamKeys = new Set();
    const playersByTeam = new Map();
    const expectedRosterSizeByTeam = new Map();

    for (const team of Array.isArray(teams) ? teams : []) {
      const teamKey = extractTeamKey(asRecord(team));
      const expectedRosterSize = extractExpectedRosterSize(team);
      if (teamKey && expectedRosterSize !== null) {
        expectedRosterSizeByTeam.set(teamKey, expectedRosterSize);
      }
    }

    for (const player of Array.isArray(players) ? players : []) {
      const record = asRecord(player);
      const teamKey = extractTeamKey(record);
      if (!record || !teamKey) {
        continue;
      }
      const group = playersByTeam.get(teamKey) || [];
      group.push(record);
      playersByTeam.set(teamKey, group);
    }

    const canSeedFromCurrentPhase = MATCH_OPENING_PHASES.has(matchPhase);
    for (const [teamKey, teamPlayers] of playersByTeam) {
      const rosterCacheKey = `${mapKey}:${teamKey}`;
      let roster = playerControlRosterByMapAndTeam.get(rosterCacheKey) || null;
      const identities = teamPlayers.map((player) =>
        normalizeLookupValue(extractPlayerControlIdentity(player)),
      );
      const expectedRosterSize = expectedRosterSizeByTeam.get(teamKey) ?? null;
      const uniqueIdentities = new Set(identities.filter(Boolean));
      const trustworthyOpeningRoster =
        canSeedFromCurrentPhase &&
        expectedRosterSize !== null &&
        expectedRosterSize === teamPlayers.length &&
        identities.every(Boolean) &&
        uniqueIdentities.size === teamPlayers.length &&
        teamPlayers.every((player) => extractAlive(player) === true);

      if (!roster && trustworthyOpeningRoster) {
        roster = new Map();
        identities.forEach((identity, index) => roster.set(identity, index + 1));
        playerControlRosterByMapAndTeam.set(rosterCacheKey, roster);
      } else if (roster && trustworthyOpeningRoster) {
        const usedNumbers = new Set(roster.values());
        for (const identity of identities) {
          if (roster.has(identity)) {
            continue;
          }
          let nextNumber = 1;
          while (usedNumbers.has(nextNumber) && nextNumber <= 9) {
            nextNumber += 1;
          }
          if (nextNumber <= 9) {
            roster.set(identity, nextNumber);
            usedNumbers.add(nextNumber);
          }
        }
      }

      for (let index = 0; index < teamPlayers.length; index += 1) {
        const identity = identities[index];
        const controlKey = identity ? `${teamKey}:${identity}` : null;
        const playerNumber = identity && roster ? roster.get(identity) ?? null : null;
        if (controlKey && playerNumber !== null) {
          numbersByPlayerKey.set(controlKey, playerNumber);
        } else {
          unresolvedTeamKeys.add(teamKey);
        }
      }
    }

    return {
      numbersByPlayerKey,
      unresolvedTeamKeys,
      get(record) {
        const teamKey = extractTeamKey(record);
        const identity = normalizeLookupValue(extractPlayerControlIdentity(record));
        return teamKey && identity
          ? numbersByPlayerKey.get(`${teamKey}:${identity}`) ?? null
          : null;
      },
    };
  }

  function reset() {
    lastResolvedMapKey = null;
    lastFlightPathByMapKey.clear();
    firstCircleVisibleAtByMapKey.clear();
    coordinateScaleByMapAndSource.clear();
    flightPathRetentionEligibleByMapKey.clear();
    playerControlRosterByMapAndTeam.clear();
  }

  function ingestSnapshot(snapshot, options = {}) {
    const skipZoneUpdate = options?.skipZoneUpdate === true;
    const circlePayload = extractSnapshotCirclePayload(snapshot);
    const rawMapName = extractRawMapName(snapshot) || lastResolvedMapKey;
    const definition = registry.resolve(rawMapName);
    if (!definition) {
      return;
    }

    const receivedAt = Date.now();
    const eventTimestamp = extractEventTimestamp(snapshot);
    const timestamp = eventTimestamp ?? receivedAt;
    const playerTimestamp = extractPlayerEventTimestamp(snapshot) ?? timestamp;
    const source =
      typeof snapshot?.source === "string" && snapshot.source.trim()
        ? snapshot.source.trim()
        : "unknown";
    const sourceMapName = extractRawMapName(snapshot) || definition.label;
    const matchPhase =
      typeof snapshot?.phase === "string" && snapshot.phase.trim()
        ? snapshot.phase.trim().toLowerCase()
        : null;
    const openingPhaseActive = MATCH_OPENING_PHASES.has(matchPhase);
    const circlesVisible = shouldShowZoneCircles(matchPhase, circlePayload);
    const primaryZone = extractPrimaryZone(circlePayload);
    const nextZone = extractNextZone(circlePayload);
    const blueZone = extractBlueZone(circlePayload, definition);
    const extractedFlightPath = extractSnapshotFlightPath(snapshot);
    const previousFlightPath = lastFlightPathByMapKey.get(definition.key) ?? null;
    const flightPathChanged =
      Boolean(extractedFlightPath?.start && extractedFlightPath?.end) &&
      previousFlightPath === null;
    if (
      extractedFlightPath?.start &&
      extractedFlightPath?.end &&
      previousFlightPath === null
    ) {
      lastFlightPathByMapKey.set(definition.key, {
        start: { ...extractedFlightPath.start },
        end: { ...extractedFlightPath.end },
      });
      if (openingPhaseActive || !primaryZone) {
        flightPathRetentionEligibleByMapKey.add(definition.key);
      }
    }
    // Keep the first official opening route for the match. Rondo emits later
    // recall-plane routes through the same PCOB fields and can alternate them
    // with the opening route; allowing those updates here makes both the line
    // and synthetic plane marker jump. reset() releases the lock for the next
    // match, while the connector's raw-event spool retains every supplied path.
    const retainedFlightPathForScale =
      lastFlightPathByMapKey.get(definition.key) ?? null;
    const rawKills = extractSnapshotKills(snapshot);
    const rawPlayerSource = extractSnapshotPlayers(snapshot);
    const rawTeamSource = extractSnapshotTeams(snapshot);
    const rosterFilterResult = filterObserverCurrentRosterPlayers(
      rawPlayerSource,
      rawTeamSource,
    );
    const rawPlayers = rosterFilterResult.players;
    const explicitPcobWorldCoordinates = hasExplicitPcobWorldCoordinates(
      snapshot,
      source,
    );
    const pcobPlayerControlNumbers = explicitPcobWorldCoordinates
      ? resolvePcobPlayerControlNumbers({
          players: rawPlayers,
          teams: rawTeamSource,
          mapKey: definition.key,
          matchPhase,
        })
      : null;
    const playerCountByTeam = new Map();
    const extractedPlayers = rawPlayers
      .map((player, index) => {
        const record = asRecord(player);
        if (!record) {
          return null;
        }

        const teamSlot = extractTeamSlot(record);
        const teamKey = extractTeamKey(record);
        let playerNumber = pcobPlayerControlNumbers?.get(record) ?? null;
        if (!pcobPlayerControlNumbers && teamKey) {
          playerNumber = (playerCountByTeam.get(teamKey) || 0) + 1;
          playerCountByTeam.set(teamKey, playerNumber);
        }

        const position = extractPosition(record);
        if (!position) {
          return null;
        }

        return {
          playerId:
            pickFirstIdentity(record, [
              "uId",
              "uid",
              "UID",
              "playerId",
              "PlayerId",
              "playerID",
              "PlayerID",
              "playerKey",
              "PlayerKey",
              "playerOpenId",
              "playerOpenID",
              "PlayerOpenId",
              "PlayerOpenID",
              "uid",
              "UID",
              "name",
              "Name",
              "playerName",
            ]) || `player-${index + 1}`,
          sourceDedupeId:
            pickFirstIdentity(record, [
              "uId",
              "uid",
              "UID",
              "playerKey",
              "PlayerKey",
              "playerId",
              "PlayerId",
              "playerID",
              "PlayerID",
              "playerOpenId",
              "playerOpenID",
              "PlayerOpenId",
              "PlayerOpenID",
              "openId",
              "OpenId",
              "openid",
              "playerName",
              "PlayerName",
              "name",
              "Name",
            ]) || `player-${index + 1}`,
          sourceQuality: computeTelemetryQuality(record),
          playerName:
            pickFirstString(record, [
              "playerName",
              "PlayerName",
              "name",
              "Name",
            ]) || null,
          teamId:
            pickFirstString(record, [
              "teamId",
              "TeamId",
              "teamID",
              "TeamID",
            ]) ||
            (() => {
              const numericTeamId = pickFirstNumber(record, [
                "teamId",
                "TeamId",
                "teamID",
                "TeamID",
              ]);
              return numericTeamId === null ? null : String(Math.trunc(numericTeamId));
            })() ||
            (() => {
              const slot = extractTeamSlot(record);
              return slot === null ? null : String(slot);
            })() ||
            pickFirstString(record, [
              "teamNo",
              "TeamNo",
              "teamIndex",
            ]) || null,
          teamSlot,
          playerNumber,
          x: position.x,
          y: position.y,
          z: position.z,
          liveState: extractLiveState(record),
          kills: Math.max(
            0,
            Math.trunc(
              pickFirstNumber(record, [
                "kills",
                "Kills",
                "killNum",
                "KillNum",
                "killCount",
                "KillCount",
              ]) ?? 0,
            ),
          ),
          alive: extractAlive(record),
          knocked: extractKnocked(record),
          inVehicle: extractInVehicle(record),
          health: extractHealth(record),
          isFiring: extractIsFiring(record),
          fireAngle: extractFireAngle(record),
          fireDirection: extractFireDirection(record),
        };
      })
      .filter(Boolean);
    const dedupeResult = dedupePositionedPlayers(extractedPlayers);
    const positionedPlayers = dedupeResult.players;

    const coordinateValues = [
      primaryZone?.x,
      primaryZone?.y,
      primaryZone?.radius,
      nextZone?.x,
      nextZone?.y,
      nextZone?.radius,
      blueZone?.x,
      blueZone?.y,
      blueZone?.radius,
      retainedFlightPathForScale?.start?.x,
      retainedFlightPathForScale?.start?.y,
      retainedFlightPathForScale?.end?.x,
      retainedFlightPathForScale?.end?.y,
      ...positionedPlayers.flatMap((player) => [player.x, player.y]),
    ];
    const scaleCacheKey = `${definition.key}:${source.toLowerCase()}`;
    const cachedScaleFactor = coordinateScaleByMapAndSource.get(scaleCacheKey);
    const scaleFactor = explicitPcobWorldCoordinates
      ? 1
      : cachedScaleFactor ?? detectCoordinateScale(definition, coordinateValues);
    coordinateScaleByMapAndSource.set(scaleCacheKey, scaleFactor);
    const calibrationStatus =
      typeof definition.telemetryCalibrationStatus === "string" &&
      definition.telemetryCalibrationStatus.trim()
        ? definition.telemetryCalibrationStatus.trim()
        : "provisional";
    const boundsDiagnostics = buildCoordinateBoundsDiagnostics({
      definition,
      scaleFactor,
      players: positionedPlayers,
      primaryZone,
      nextZone,
    });
    const coordinate = {
      scaleHint: definition.coordinateScaleHint ?? 1,
      detectedScaleFactor: scaleFactor,
      scaleMode: scaleFactor > 1 ? `scaled_x${scaleFactor}` : "full_units",
      worldSize: definition.worldSize,
      calibrationStatus,
      ...boundsDiagnostics,
    };
    const warnings = [];
    if (scaleFactor > 1) {
      warnings.push(`Normalized simplified telemetry coordinates by x${scaleFactor}.`);
    }
    if (definition.notes) {
      warnings.push(`Map calibration note: ${definition.notes}`);
    }
    if (calibrationStatus !== "recording-backed") {
      warnings.push(
        `Telemetry-to-image alignment is provisional for ${definition.label}; nominal bounds and north-up orientation are not recording-backed.`,
      );
    }
    if (boundsDiagnostics.boundsStatus === "out-of-bounds-observed") {
      warnings.push(
        `Observed coordinates outside ${definition.label}'s nominal ${definition.worldSize}-unit bounds (${boundsDiagnostics.playerOutOfBoundsCount} player, ${boundsDiagnostics.zoneCenterOutOfBoundsCount} zone center); rendered edge clamping is not calibration evidence.`,
      );
    }
    if (dedupeResult.duplicateCount > 0) {
      warnings.push(
        `Dropped ${dedupeResult.duplicateCount} duplicate player telemetry record(s).`,
      );
    }
    if (rosterFilterResult.staleCount > 0) {
      warnings.push(
        `Filtered ${rosterFilterResult.staleCount} stale observer player record(s).`,
      );
    }
    if (pcobPlayerControlNumbers?.unresolvedTeamKeys.size > 0) {
      warnings.push(
        `PCOB map control is disabled for ${pcobPlayerControlNumbers.unresolvedTeamKeys.size} team(s) without a trustworthy opening roster order.`,
      );
    }

    lastResolvedMapKey = definition.key;
    engine.syncMapContext({
      mapKey: definition.key,
      sourceMapName,
      timestamp,
    });

    if (primaryZone && circlesVisible === true) {
      if (!firstCircleVisibleAtByMapKey.has(definition.key)) {
        firstCircleVisibleAtByMapKey.set(definition.key, receivedAt);
      }
    } else if (circlesVisible === false) {
      firstCircleVisibleAtByMapKey.delete(definition.key);
    }

    const firstCircleVisibleAt =
      firstCircleVisibleAtByMapKey.get(definition.key) ?? null;
    const flightPathVisibleUntil =
      firstCircleVisibleAt === null
        ? null
        : firstCircleVisibleAt + FLIGHT_PATH_POST_CIRCLE_RETENTION_MS;
    const flightPathRetentionActive =
      flightPathRetentionEligibleByMapKey.has(definition.key) &&
      flightPathVisibleUntil !== null &&
      receivedAt <= flightPathVisibleUntil;
    const preCircleFlightPathActive = !primaryZone;
    const flightPath =
      openingPhaseActive || preCircleFlightPathActive || flightPathRetentionActive
        ? lastFlightPathByMapKey.get(definition.key) ?? null
        : null;
    const shouldKeepFlightPath =
      Boolean(flightPath) &&
      (!primaryZone ||
        (openingPhaseActive && circlesVisible === false) ||
        flightPathRetentionActive);
    const normalizedFlightPath = shouldKeepFlightPath
      ? clipFlightPathToMapBounds(flightPath, definition, {
          detectedScaleFactor: scaleFactor,
        })
      : null;

    if ((!skipZoneUpdate || flightPathChanged) && (primaryZone || flightPath)) {
      engine.applyZoneUpdate(
        {
          mapKey: definition.key,
          phase:
            pickCirclePayloadNumber(circlePayload, [
              "phase",
              "Phase",
              "phaseIndex",
              "circlePhase",
              "CircleIndex",
              "circleIndex",
            ]) ??
            pickFirstNumber(snapshot?.circle, ["circleIndex"]) ??
            null,
          matchPhase,
          circlesVisible,
          status:
            pickCirclePayloadStatus(circlePayload, [
              "CircleStatus",
              "circleStatus",
              "status",
              "Status",
            ]) ?? null,
          mode: resolveCircleMode(circlePayload),
          zoneMode: resolveCircleMode(circlePayload),
          centerX: primaryZone
            ? normalizeWorldX(primaryZone.x, definition, {
                detectedScaleFactor: scaleFactor,
              })
            : null,
          centerY: primaryZone
            ? normalizeWorldY(primaryZone.y, definition, {
                detectedScaleFactor: scaleFactor,
              })
            : null,
          radius: primaryZone
            ? normalizeWorldRadius(primaryZone.radius, definition, {
                detectedScaleFactor: scaleFactor,
              })
            : null,
          nextCenterX:
            nextZone === null
              ? null
              : normalizeWorldX(nextZone.x, definition, {
                  detectedScaleFactor: scaleFactor,
                }),
          nextCenterY:
            nextZone === null
              ? null
              : normalizeWorldY(nextZone.y, definition, {
                  detectedScaleFactor: scaleFactor,
                }),
          nextRadius:
            nextZone === null
              ? null
              : normalizeWorldRadius(nextZone.radius, definition, {
                  detectedScaleFactor: scaleFactor,
                }),
          blueCenterX:
            blueZone === null
              ? null
              : normalizeWorldX(blueZone.x, definition, {
                  detectedScaleFactor: scaleFactor,
                }),
          blueCenterY:
            blueZone === null
              ? null
              : normalizeWorldY(blueZone.y, definition, {
                  detectedScaleFactor: scaleFactor,
                }),
          blueRadius:
            blueZone === null
              ? null
              : normalizeWorldRadius(blueZone.radius, definition, {
                  detectedScaleFactor: scaleFactor,
                }),
          flightPath:
            normalizedFlightPath === null
              ? null
              : {
                  start: { ...normalizedFlightPath.start },
                  end: { ...normalizedFlightPath.end },
                },
          flightPathVisibleUntil:
            normalizedFlightPath === null ? null : flightPathVisibleUntil,
          phaseDuration: resolveCirclePhaseDuration(circlePayload),
          timeRemaining: resolveCircleTimeRemaining(circlePayload),
          timestamp,
          receivedAt,
          source,
          raw: {
            currentCircle: primaryZone ? { ...primaryZone } : null,
            nextCircle: nextZone ? { ...nextZone } : null,
            blueCircle: blueZone ? { ...blueZone } : null,
            flightPath:
              !flightPath || !flightPath.start || !flightPath.end
                ? null
                : {
                    start: { ...flightPath.start },
                    end: { ...flightPath.end },
                  },
          },
          coordinate,
          warnings,
        },
        { sourceMapName },
      );
    }

    const combatEvents = extractCombatEvents({
      kills: rawKills,
      positionedPlayers,
      definition,
      scaleFactor,
      fallbackTimestamp: timestamp,
    });

    if (positionedPlayers.length > 0) {
      engine.applyPlayerPositionUpdate(
        {
          mapKey: definition.key,
          players: positionedPlayers.map((player) => ({
            playerId: player.playerId,
            playerName: player.playerName,
            teamId: player.teamId,
            teamSlot: player.teamSlot,
            playerNumber: player.playerNumber,
            x: normalizeWorldX(player.x, definition, {
              detectedScaleFactor: scaleFactor,
            }),
            y: normalizeWorldY(player.y, definition, {
              detectedScaleFactor: scaleFactor,
            }),
            z: player.z,
            liveState: player.liveState,
            kills: player.kills,
            alive: player.alive,
            knocked: player.knocked,
            inVehicle: player.inVehicle,
            health: player.health,
            isFiring: player.isFiring,
            fireAngle: player.fireAngle,
            fireDirection: player.fireDirection,
          })),
          timestamp: playerTimestamp,
          receivedAt,
          source,
          coordinate,
          warnings,
        },
        { sourceMapName },
      );
    }

    if (combatEvents.length > 0) {
      engine.applyCombatEvents(
        {
          mapKey: definition.key,
          events: combatEvents,
          timestamp,
        },
        { sourceMapName },
      );
    }

  }

  return {
    ingestSnapshot,
    reset,
  };
}

module.exports = {
  createMapTelemetryBridge,
};
