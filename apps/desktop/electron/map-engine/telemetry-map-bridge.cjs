"use strict";

const {
  normalizeWorldRadius,
  normalizeWorldX,
  normalizeWorldY,
} = require("./coordinate-utils.cjs");

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

function extractFlightPath(circlePayload, depth = 0) {
  const root = asRecord(circlePayload);
  if (!root || depth > 2) {
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
    "route",
    "Route",
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

function buildInitialBlueZone(mapDefinition) {
  const worldSize = toFiniteNumber(mapDefinition?.worldSize);
  if (worldSize === null || worldSize <= 0) {
    return null;
  }

  const center = worldSize / 2;
  return {
    x: center,
    y: center,
    radius: center,
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

function pickCirclePayloadString(circlePayload, keys) {
  for (const record of getCirclePayloadRecords(circlePayload)) {
    const value = pickFirstString(record, keys);
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
    pickCirclePayloadString(circlePayload, [
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

  return (
    pickCirclePayloadNumber(circlePayload, [
      "timeRemaining",
      "TimeRemaining",
      "timeRemainingSeconds",
      "remainingTime",
      "RemainingTime",
      "remainingSeconds",
      "RemainTime",
      "remainTime",
    ]) ??
    pickCirclePayloadNumber(circlePayload, ["Counter", "counter"]) ??
    null
  );
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
  const previousCircle =
    currentIndex > 0
      ? circleArray[Math.max(0, currentIndex - 1)] || targetCircle
      : buildInitialBlueZone(mapDefinition) || targetCircle;

  if (!targetCircle || !previousCircle) {
    return null;
  }

  const timer = resolveCircleTimer(root);
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

  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function extractAlive(record) {
  const root = asRecord(record);
  if (!root) {
    return null;
  }

  for (const key of ["alive", "Alive", "isAlive", "IsAlive", "bAlive"]) {
    if (typeof root[key] === "boolean") {
      return root[key];
    }
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

  const hp = pickFirstNumber(root, ["hp", "HP", "health", "Health"]);
  if (hp !== null) {
    return hp > 0;
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

  return null;
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

function resolveCombatFallbackPosition(record, playerLookup) {
  const root = asRecord(record);
  if (!root || !(playerLookup instanceof Map)) {
    return null;
  }

  const killerTeamId = pickFirstString(root, [
    "killerTeamId",
    "killerTeam",
    "killerTeamID",
    "teamId",
  ]);
  const victimTeamId = pickFirstString(root, [
    "victimTeamId",
    "victimTeam",
    "targetTeamId",
    "targetTeam",
  ]);
  const candidateKeys = [
    [victimTeamId, pickFirstString(root, ["victimId", "victimPlayerId", "targetPlayerId"])],
    [victimTeamId, pickFirstString(root, ["victimName", "victim", "targetName"])],
    [killerTeamId, pickFirstString(root, ["killerId", "killerPlayerId", "attackerPlayerId"])],
    [killerTeamId, pickFirstString(root, ["killerName", "killer", "attackerName"])],
    [null, pickFirstString(root, ["victimName", "victim", "targetName"])],
    [null, pickFirstString(root, ["victimId", "victimPlayerId", "targetPlayerId"])],
    [null, pickFirstString(root, ["killerName", "killer", "attackerName"])],
    [null, pickFirstString(root, ["killerId", "killerPlayerId", "attackerPlayerId"])],
  ];

  for (const [teamId, playerKey] of candidateKeys) {
    const lookupKey = buildPlayerLookupKey(teamId, playerKey);
    if (!lookupKey) {
      continue;
    }

    const matchedPlayer = playerLookup.get(lookupKey);
    if (matchedPlayer) {
      return {
        x: matchedPlayer.x,
        y: matchedPlayer.y,
      };
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

    const rawPosition =
      extractCombatPosition(record) || resolveCombatFallbackPosition(record, playerLookup);
    if (!rawPosition) {
      continue;
    }

    const timestamp =
      pickFirstTimestamp(record, [
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
    const kind = extractCombatKind(record);
    const killerTeamId = pickFirstString(record, [
      "killerTeamId",
      "killerTeam",
      "killerTeamID",
      "teamId",
    ]);
    const killerPlayerId = pickFirstString(record, [
      "killerPlayerId",
      "killerId",
      "attackerPlayerId",
      "attackerId",
      "killerUid",
      "killerUID",
    ]);
    const victimTeamId = pickFirstString(record, [
      "victimTeamId",
      "victimTeam",
      "targetTeamId",
      "targetTeam",
    ]);
    const victimPlayerId = pickFirstString(record, [
      "victimPlayerId",
      "victimId",
      "targetPlayerId",
      "targetId",
      "victimUid",
      "victimUID",
    ]);
    const killerName = pickFirstString(record, [
      "killerName",
      "killer",
      "killerPlayer",
      "attackerName",
    ]);
    const victimName = pickFirstString(record, [
      "victimName",
      "victim",
      "targetName",
    ]);
    const x = normalizeWorldX(rawPosition.x, definition, {
      detectedScaleFactor: scaleFactor,
    });
    const y = normalizeWorldY(rawPosition.y, definition, {
      detectedScaleFactor: scaleFactor,
    });

    events.push({
      id: buildCombatEventId({
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

function createMapTelemetryBridge({ engine, registry, log = () => {} }) {
  let lastResolvedMapKey = null;

  function ingestSnapshot(snapshot) {
    const rawMapName = extractRawMapName(snapshot) || lastResolvedMapKey;
    const definition = registry.resolve(rawMapName);
    if (!definition) {
      return;
    }

    const receivedAt = Date.now();
    const eventTimestamp = extractEventTimestamp(snapshot);
    const timestamp = eventTimestamp ?? receivedAt;
    const sourceMapName = extractRawMapName(snapshot) || definition.label;
    const primaryZone = extractPrimaryZone(snapshot?.circlePayload);
    const nextZone = extractNextZone(snapshot?.circlePayload);
    const blueZone = extractBlueZone(snapshot?.circlePayload, definition);
    const flightPath = extractFlightPath(snapshot?.circlePayload);
    const rawKills = Array.isArray(snapshot?.kills) ? snapshot.kills : [];
    const rawPlayerSource = Array.isArray(snapshot?.players) ? snapshot.players : [];
    const rosterFilterResult = filterObserverCurrentRosterPlayers(
      rawPlayerSource,
      snapshot?.teams,
    );
    const rawPlayers = rosterFilterResult.players;
    const extractedPlayers = rawPlayers
      .map((player, index) => {
        const record = asRecord(player);
        const position = extractPosition(record);
        if (!record || !position) {
          return null;
        }

        return {
          playerId:
            pickFirstString(record, [
              "playerId",
              "PlayerId",
              "playerKey",
              "PlayerKey",
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
          teamSlot: extractTeamSlot(record),
          x: position.x,
          y: position.y,
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
          health: extractHealth(record),
        };
      })
      .filter(Boolean);
    const dedupeResult = dedupePositionedPlayers(extractedPlayers);
    const positionedPlayers = dedupeResult.players;

    const scaleFactor = detectCoordinateScale(definition, [
      primaryZone?.x,
      primaryZone?.y,
      primaryZone?.radius,
      nextZone?.x,
      nextZone?.y,
      nextZone?.radius,
      blueZone?.x,
      blueZone?.y,
      blueZone?.radius,
      flightPath?.start?.x,
      flightPath?.start?.y,
      flightPath?.end?.x,
      flightPath?.end?.y,
      ...positionedPlayers.flatMap((player) => [player.x, player.y]),
    ]);
    const coordinate = {
      scaleHint: definition.coordinateScaleHint ?? 1,
      detectedScaleFactor: scaleFactor,
      scaleMode: scaleFactor > 1 ? `scaled_x${scaleFactor}` : "full_units",
      worldSize: definition.worldSize,
    };
    const warnings = [];
    if (scaleFactor > 1) {
      warnings.push(`Normalized simplified telemetry coordinates by x${scaleFactor}.`);
    }
    if (definition.notes) {
      warnings.push(`Map calibration note: ${definition.notes}`);
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

    lastResolvedMapKey = definition.key;
    engine.syncMapContext({
      mapKey: definition.key,
      sourceMapName,
      timestamp,
    });

    if (primaryZone) {
      engine.applyZoneUpdate(
        {
          mapKey: definition.key,
          phase:
            pickCirclePayloadNumber(snapshot?.circlePayload, [
              "phase",
              "Phase",
              "phaseIndex",
              "circlePhase",
              "CircleIndex",
              "circleIndex",
            ]) ??
            pickFirstNumber(snapshot?.circle, ["circleIndex"]) ??
            null,
          matchPhase:
            typeof snapshot?.phase === "string" && snapshot.phase.trim()
              ? snapshot.phase.trim().toLowerCase()
              : null,
          status:
            pickCirclePayloadString(snapshot?.circlePayload, [
              "CircleStatus",
              "circleStatus",
              "status",
              "Status",
            ]) ?? null,
          centerX: normalizeWorldX(primaryZone.x, definition, {
            detectedScaleFactor: scaleFactor,
          }),
          centerY: normalizeWorldY(primaryZone.y, definition, {
            detectedScaleFactor: scaleFactor,
          }),
          radius: normalizeWorldRadius(primaryZone.radius, definition, {
            detectedScaleFactor: scaleFactor,
          }),
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
            !flightPath ||
            !flightPath.start ||
            !flightPath.end
              ? null
              : {
                  start: {
                    x: normalizeWorldX(flightPath.start.x, definition, {
                      detectedScaleFactor: scaleFactor,
                    }),
                    y: normalizeWorldY(flightPath.start.y, definition, {
                      detectedScaleFactor: scaleFactor,
                    }),
                  },
                  end: {
                    x: normalizeWorldX(flightPath.end.x, definition, {
                      detectedScaleFactor: scaleFactor,
                    }),
                    y: normalizeWorldY(flightPath.end.y, definition, {
                      detectedScaleFactor: scaleFactor,
                    }),
                  },
                },
          phaseDuration: resolveCirclePhaseDuration(snapshot?.circlePayload),
          timeRemaining: resolveCircleTimeRemaining(snapshot?.circlePayload),
          timestamp,
          receivedAt,
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
            x: normalizeWorldX(player.x, definition, {
              detectedScaleFactor: scaleFactor,
            }),
            y: normalizeWorldY(player.y, definition, {
              detectedScaleFactor: scaleFactor,
            }),
            kills: player.kills,
            alive: player.alive,
            knocked: player.knocked,
            health: player.health,
          })),
          timestamp,
          receivedAt,
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
  };
}

module.exports = {
  createMapTelemetryBridge,
};
