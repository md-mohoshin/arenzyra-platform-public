/**
 * ObTools forwarder / logger
 * - Receives PUBG observer POST payloads on port 10086
 * - Forwards the parsed payloads to the Flask shadow receiver
 * - Keeps the original handlers intact by reusing the parsed body
 */
const express = require("express");
const axios = require("axios");

const PORT = process.env.PORT ? Number(process.env.PORT) : 10086;
const FORWARD_ENABLE = (process.env.FORWARD_ENABLE ?? "true").toLowerCase() !== "false";
const FORWARD_BASE_URL = (process.env.FORWARD_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const OBSERVER_TELEMETRY_URL = `${API_BASE_URL}/api/observer/telemetry`;
const OBSERVER_FORWARD_ENABLE =
  (process.env.OBSERVER_FORWARD_ENABLE ?? "false").toLowerCase() === "true";
const OBSERVER_FEED_TOKEN = String(
  process.env.OBSERVER_FEED_TOKEN || process.env.ARENZYRA_OBSERVER_FEED_TOKEN || "",
).trim();
const MATCH_ID = String(
  process.env.MATCH_ID || process.env.OBSERVER_MATCH_ID || process.env.PCOB_MATCH_ID || "",
).trim();
const SESSION_ID = String(
  process.env.OBSERVER_SESSION_ID || process.env.SESSION_ID || "",
).trim();
const TELEMETRY_INTERVAL_MS = 1000;
const TELEMETRY_TIMEOUT_MS = 5000;
const TELEMETRY_RETRY_DELAY_MS = 1000;
const MAX_ROUTE_PAYLOADS = 40;
const MAX_HANDLER_BATCH_SIZE = 2;
const MAX_DIRECT_ACHIEVEMENT_EVENTS = 50;
const DIRECT_ACHIEVEMENT_STREAK_WINDOW_MS = 8_000;
const FALLBACK_KILL_EVENT_GAP_MS = DIRECT_ACHIEVEMENT_STREAK_WINDOW_MS + 1_000;
const VERBOSE_LOG = (process.env.OBTOOLS_VERBOSE_LOG ?? "false").toLowerCase() === "true";
const LARGE_NUMERIC_ID_KEYS = [
  "id",
  "playerId",
  "playerID",
  "externalPlayerId",
  "externalId",
  "uid",
  "Uid",
  "UID",
  "userId",
  "UserId",
  "accountId",
  "AccountId",
  "playerOpenId",
  "playerOpenID",
  "PlayerOpenId",
  "PlayerOpenID",
  "openId",
  "OpenId",
  "openid",
];

const app = express();
const shadowState = {
  allInfo: {},
  playerInfoList: [],
  teamInfoList: [],
  killInfo: [],
  killInfoEntries: [],
  circleInfo: {},
  bestCircleInfo: {},
  observingPlayer: {},
  isInGame: false,
  routePayloads: {},
  rawRoutePayloads: {},
  updatedAt: null,
};
let telemetryTimer = null;
let telemetryInFlight = false;
let observerSequence = 0;
const pendingRoutePayloads = new Map();
let routeDrainScheduled = false;

function nextObserverSequence() {
  observerSequence += 1;
  return observerSequence;
}

const rawBodyParser = express.raw({
  type: "*/*",
  limit: "10mb",
  verify: (req, res, buf) => {
    // Keep the raw payload so parsing can happen after the request is acknowledged.
    req.rawBody = buf;
  },
});

// GET probes should bypass raw-body parsing so launcher health checks stay responsive.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    return next();
  }
  return rawBodyParser(req, res, next);
});

async function forwardToFlask(url, payload) {
  try {
    await axios.post(url, payload, {
      timeout: 1500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err?.response?.status;
    const message = status ? `HTTP ${status}` : err.message;
    console.error(`[forward] Failed to POST ${url}: ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postObserverTelemetry(payload) {
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await axios.post(OBSERVER_TELEMETRY_URL, payload, {
        timeout: TELEMETRY_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          ...(OBSERVER_FEED_TOKEN
            ? { Authorization: `Bearer ${OBSERVER_FEED_TOKEN}` }
            : {}),
        },
      });
      if (VERBOSE_LOG) {
        console.log("Telemetry forwarded to Arenzyra");
      }
      return true;
    } catch (err) {
      lastError = err;
      console.error(`[observer-forward] telemetry send failed (attempt ${attempt}): ${err?.message || err}`);
      if (attempt < 2) {
        await sleep(TELEMETRY_RETRY_DELAY_MS);
      }
    }
  }

  if (lastError) {
    console.error("[observer-forward] backend unavailable; will retry on next poll");
  }
  return false;
}

// --- Existing handlers (keep behavior intact) ---
function describePayload(data) {
  if (Array.isArray(data)) {
    return `array(length=${data.length})`;
  }

  if (data && typeof data === "object") {
    const keys = Object.keys(data).slice(0, 8);
    const parts = [`keys=${keys.join(",") || "none"}`];

    if (Array.isArray(data.TotalPlayerList)) {
      parts.push(`players=${data.TotalPlayerList.length}`);
    }
    if (Array.isArray(data.TeamInfoList)) {
      parts.push(`teams=${data.TeamInfoList.length}`);
    }
    if (Array.isArray(data.killInfo)) {
      parts.push(`kills=${data.killInfo.length}`);
    }
    if (Array.isArray(data.playerInfoList)) {
      parts.push(`players=${data.playerInfoList.length}`);
    }
    if (Array.isArray(data.teamInfoList)) {
      parts.push(`teams=${data.teamInfoList.length}`);
    }

    return parts.join(" ");
  }

  return String(data ?? "").slice(0, 120);
}

function logHandler(name) {
  return (data) => {
    if (VERBOSE_LOG) {
      console.log(`[${name}] ${describePayload(data)}`);
    }
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestampMsValue(value) {
  const numeric = numberValue(value);
  if (numeric !== null) {
    return numeric;
  }

  const text = textValue(value);
  if (!text) {
    return null;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanValue(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const normalized = value.trim().toLowerCase();
    if (["true", "alive", "live", "running", "knocked", "down", "dbno"].includes(normalized)) {
      return true;
    }
    if (["false", "dead", "eliminated"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function firstTextValue(record, keys, fallback = null) {
  const source = asObject(record);
  if (!source || Object.keys(source).length === 0) {
    return fallback;
  }
  for (const key of keys) {
    const value = textValue(source[key]);
    if (value) {
      return value;
    }
  }
  return fallback;
}

function firstNumberValue(record, keys, fallback = null) {
  const source = asObject(record);
  if (!source || Object.keys(source).length === 0) {
    return fallback;
  }
  for (const key of keys) {
    const value = numberValue(source[key]);
    if (value !== null) {
      return value;
    }
  }
  return fallback;
}

function extractDirectPoint(value) {
  const record = asObject(value);
  if (!record || Object.keys(record).length === 0) {
    return null;
  }

  const x = firstNumberValue(record, [
    "x",
    "X",
    "posX",
    "PosX",
    "locationX",
    "LocationX",
    "worldX",
    "WorldX",
    "coordX",
    "CoordX",
  ]);
  const y = firstNumberValue(record, [
    "y",
    "Y",
    "posY",
    "PosY",
    "locationY",
    "LocationY",
    "worldY",
    "WorldY",
    "coordY",
    "CoordY",
  ]);

  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function extractDirectFlightPath(payload, depth = 0) {
  if (depth > 4 || payload === null || payload === undefined) {
    return null;
  }

  const pointArray = asArray(payload);
  if (pointArray.length >= 2) {
    const start = extractDirectPoint(pointArray[0]);
    const end = extractDirectPoint(pointArray[pointArray.length - 1]);
    if (start && end) {
      return { start, end, coordinateSystem: "WORLD" };
    }
  }

  const record = asObject(payload);
  if (!record || Object.keys(record).length === 0) {
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
    const start = extractDirectPoint(record[startKey]);
    const end = extractDirectPoint(record[endKey]);
    if (start && end) {
      return { start, end, coordinateSystem: "WORLD" };
    }
  }

  const startX = firstNumberValue(record, [
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
  const startY = firstNumberValue(record, [
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
  const endX = firstNumberValue(record, [
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
  const endY = firstNumberValue(record, [
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
      coordinateSystem: "WORLD",
    };
  }

  const routePoints = asArray(
    record.routePoints ??
      record.RoutePoints ??
      record.points ??
      record.Points ??
      record.route ??
      record.Route,
  );
  if (routePoints.length >= 2) {
    const start = extractDirectPoint(routePoints[0]);
    const end = extractDirectPoint(routePoints[routePoints.length - 1]);
    if (start && end) {
      return { start, end, coordinateSystem: "WORLD" };
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
    const nested = extractDirectFlightPath(record[key], depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function formatSlotLabel(slot) {
  if (typeof slot === "number" && Number.isFinite(slot)) {
    return `Slot ${slot}`;
  }
  return "Team";
}

const DIRECT_TEAM_ID_KEYS = [
  "teamId",
  "teamID",
  "TeamId",
  "TeamID",
  "team",
  "id",
  "ID",
];

const DIRECT_TEAM_SLOT_KEYS = [
  "slot",
  "Slot",
  "teamNo",
  "teamNumber",
  "teamIndex",
  "order",
];

const DIRECT_TEAM_NAME_KEYS = ["teamName", "TeamName", "name"];
const DIRECT_TEAM_TAG_KEYS = ["teamTag", "tag", "Tag"];
const DIRECT_TEAM_LOGO_KEYS = [
  "logoUrl",
  "LogoUrl",
  "logoPicUrl",
  "logoPICUrl",
  "logo",
];

function compactDirectTeamIdentity(value) {
  const normalized = textValue(value);
  if (!normalized) {
    return null;
  }
  const compact = normalized.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return compact.length > 0 ? compact : null;
}

function isPlaceholderDirectTeamIdentity(value) {
  const compact = compactDirectTeamIdentity(value);
  if (!compact) {
    return false;
  }
  return (
    compact === "team" ||
    compact === "unknownteam" ||
    /^team\d+$/.test(compact) ||
    /^slot\d+$/.test(compact) ||
    /^s\d+$/.test(compact)
  );
}

function hasMeaningfulDirectTeamIdentity(value) {
  const normalized = textValue(value);
  return Boolean(normalized) && !isPlaceholderDirectTeamIdentity(normalized);
}

function extractDirectTeamId(record) {
  return firstTextValue(asObject(record), DIRECT_TEAM_ID_KEYS);
}

function extractDirectTeamSlot(record) {
  const slot = firstNumberValue(asObject(record), DIRECT_TEAM_SLOT_KEYS);
  return slot === null ? null : Math.trunc(slot);
}

function mergeDirectTeamRecord(current, incoming) {
  const nextRecord = asObject(cloneShallow(incoming));
  if (!nextRecord) {
    return incoming;
  }

  const previous = asObject(current);
  if (!previous) {
    return nextRecord;
  }

  for (const key of Object.keys(previous)) {
    if (nextRecord[key] === undefined || nextRecord[key] === null || nextRecord[key] === "") {
      nextRecord[key] = previous[key];
    }
  }

  const currentTeamId = extractDirectTeamId(nextRecord);
  if (!currentTeamId) {
    const previousTeamId = extractDirectTeamId(previous);
    if (previousTeamId) {
      nextRecord.teamId = previousTeamId;
    }
  }

  const currentSlot = extractDirectTeamSlot(nextRecord);
  if (currentSlot === null) {
    const previousSlot = extractDirectTeamSlot(previous);
    if (previousSlot !== null) {
      nextRecord.slot = previousSlot;
    }
  }

  const currentName = firstTextValue(nextRecord, DIRECT_TEAM_NAME_KEYS);
  if (!hasMeaningfulDirectTeamIdentity(currentName)) {
    const previousName = firstTextValue(previous, DIRECT_TEAM_NAME_KEYS);
    if (hasMeaningfulDirectTeamIdentity(previousName)) {
      nextRecord.teamName = previousName;
    }
  }

  const currentTag = firstTextValue(nextRecord, DIRECT_TEAM_TAG_KEYS);
  if (!hasMeaningfulDirectTeamIdentity(currentTag)) {
    const previousTag = firstTextValue(previous, DIRECT_TEAM_TAG_KEYS);
    if (hasMeaningfulDirectTeamIdentity(previousTag)) {
      nextRecord.teamTag = previousTag;
    }
  }

  const currentLogo = firstTextValue(nextRecord, DIRECT_TEAM_LOGO_KEYS);
  if (!currentLogo) {
    const previousLogo = firstTextValue(previous, DIRECT_TEAM_LOGO_KEYS);
    if (previousLogo) {
      nextRecord.logoUrl = previousLogo;
    }
  }

  return nextRecord;
}

function mergeDirectTeamInfoList(nextList, currentList) {
  const nextTeams = asArray(nextList);
  const currentTeams = asArray(currentList);
  if (currentTeams.length === 0) {
    return nextTeams;
  }
  if (nextTeams.length === 0) {
    return currentTeams.map((team) => cloneShallow(team));
  }

  const seenTeamIds = new Set();
  const seenSlots = new Set();

  const currentById = new Map();
  const currentBySlot = new Map();
  for (const team of currentTeams) {
    const record = asObject(team);
    if (!record) {
      continue;
    }
    const teamId = extractDirectTeamId(record);
    const slot = extractDirectTeamSlot(record);
    if (teamId && !currentById.has(teamId)) {
      currentById.set(teamId, record);
    }
    if (slot !== null && !currentBySlot.has(slot)) {
      currentBySlot.set(slot, record);
    }
  }

  const mergedTeams = nextTeams.map((team) => {
    const record = asObject(team);
    if (!record) {
      return team;
    }
    const teamId = extractDirectTeamId(record);
    const slot = extractDirectTeamSlot(record);
    const previous =
      (teamId ? currentById.get(teamId) : null) ??
      (slot !== null ? currentBySlot.get(slot) : null) ??
      null;
    const merged = mergeDirectTeamRecord(previous, record);
    const mergedId = extractDirectTeamId(merged);
    const mergedSlot = extractDirectTeamSlot(merged);
    if (mergedId) {
      seenTeamIds.add(mergedId);
    }
    if (mergedSlot !== null) {
      seenSlots.add(mergedSlot);
    }
    return merged;
  });

  if (mergedTeams.length < currentTeams.length) {
    for (const team of currentTeams) {
      const record = asObject(team);
      if (!record) {
        continue;
      }
      const teamId = extractDirectTeamId(record);
      const slot = extractDirectTeamSlot(record);
      if ((teamId && seenTeamIds.has(teamId)) || (slot !== null && seenSlots.has(slot))) {
        continue;
      }
      mergedTeams.push(cloneShallow(record));
      if (teamId) {
        seenTeamIds.add(teamId);
      }
      if (slot !== null) {
        seenSlots.add(slot);
      }
    }
  }

  return mergedTeams;
}

function isDirectPlayerAlive(record) {
  const source = asObject(record);
  if (!source || Object.keys(source).length === 0) {
    return true;
  }

  const explicitAlive = booleanValue(
    source.isAlive ?? source.IsAlive ?? source.alive ?? source.Alive ?? source.bAlive,
  );
  const explicitDead = booleanValue(
    source.hasDied ??
      source.HasDied ??
      source.bHasDied ??
      source.dead ??
      source.isDead ??
      source.eliminated,
  );
  if (explicitAlive === false || explicitDead === true) {
    return false;
  }

  const stateValue =
    source.liveState ??
    source.LiveState ??
    source.live_state ??
    source.state ??
    source.State ??
    source.status ??
    source.Status;
  const numeric = numberValue(stateValue);
  if (numeric !== null) {
    if (numeric === 1 || numeric === 5) {
      return false;
    }
    if (numeric === 0 || numeric === 3 || numeric === 4) {
      return true;
    }
  }

  const label = textValue(stateValue)?.toLowerCase() ?? null;
  if (label === "dead" || label === "eliminated") {
    return false;
  }
  if (label && ["alive", "live", "running", "down", "knocked", "dbno"].includes(label)) {
    return true;
  }

  const health = firstNumberValue(source, [
    "health",
    "Health",
    "hp",
    "HP",
    "currentHealth",
    "CurrentHealth",
  ]);
  if (health !== null) {
    return health > 0;
  }

  if (explicitAlive === true || explicitDead === false) {
    return true;
  }

  return true;
}

function isDirectPlayerKnocked(record) {
  const source = asObject(record);
  if (!source || Object.keys(source).length === 0) {
    return false;
  }

  const explicit = booleanValue(
    source.isKnocked ??
      source.IsKnocked ??
      source.knocked ??
      source.down ??
      source.isDown ??
      source.isDowned,
  );
  if (explicit !== null) {
    return explicit;
  }

  const stateValue =
    source.liveState ??
    source.LiveState ??
    source.state ??
    source.State ??
    source.status ??
    source.Status;
  const numeric = numberValue(stateValue);
  if (numeric !== null) {
    return numeric === 4;
  }

  const label = textValue(stateValue)?.toLowerCase() ?? null;
  return label === "knocked" || label === "down" || label === "dbno";
}

function extractDirectPosition(payload) {
  const record = asObject(payload);
  const candidate =
    record?.position ??
    record?.location ??
    record?.pos ??
    record?.loc ??
    payload;
  const posRecord = asObject(candidate);
  if (!posRecord || Object.keys(posRecord).length === 0) {
    return null;
  }

  const x = numberValue(
    posRecord.x ??
      posRecord.X ??
      posRecord.lon ??
      posRecord.lng ??
      posRecord.long ??
      null,
  );
  const y = numberValue(posRecord.y ?? posRecord.Y ?? posRecord.lat ?? null);
  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function normalizeDirectPlayers() {
  const normalized = [];
  const seen = new Set();

  for (const player of asArray(shadowState.playerInfoList)) {
    const record = asObject(player);
    if (!record || Object.keys(record).length === 0) {
      continue;
    }

    const playerId =
      firstTextValue(record, [
        "playerOpenId",
        "playerOpenID",
        "PlayerOpenId",
        "PlayerOpenID",
        "openId",
        "OpenId",
        "openid",
      ]) ??
      firstTextValue(record, ["externalPlayerId", "externalId"]) ??
      firstTextValue(record, [
        "playerId",
        "playerID",
        "PlayerId",
        "PlayerID",
        "id",
        "ID",
      ]) ??
      firstTextValue(record, ["playerName", "PlayerName", "ign", "name"]);
    if (!playerId || seen.has(playerId)) {
      continue;
    }

    seen.add(playerId);
    const alive = isDirectPlayerAlive(record);
    const position = extractDirectPosition(record);
    normalized.push({
      playerId,
      teamId: firstTextValue(record, [
        "teamId",
        "teamID",
        "TeamId",
        "TeamID",
        "team_id",
      ]),
      playerName:
        firstTextValue(record, ["playerName", "PlayerName", "ign", "IGN", "name"]) ??
        "Player",
      kills: Math.max(
        0,
        Math.trunc(
          firstNumberValue(record, [
            "kills",
            "killNum",
            "killCount",
            "killnum",
            "kill_count",
          ], 0) ?? 0,
        ),
      ),
      alive,
      knocked: alive ? isDirectPlayerKnocked(record) : false,
      health:
        firstNumberValue(record, [
          "health",
          "Health",
          "hp",
          "HP",
          "currentHealth",
          "CurrentHealth",
        ]) ?? null,
      outsideBlueCircle:
        booleanValue(
          record.isOutsideBlueCircle ??
            record.outsideBlueCircle ??
            record.isOutsideSafeZone ??
            record.outsideSafeZone,
        ) ?? null,
      x: position?.x ?? null,
      y: position?.y ?? null,
    });
  }

  return normalized;
}

function normalizeDirectTeams(players) {
  const playersByTeam = new Map();
  for (const player of Array.isArray(players) ? players : []) {
    const teamId = textValue(player?.teamId);
    if (!teamId) {
      continue;
    }
    const bucket = playersByTeam.get(teamId) ?? [];
    bucket.push(player);
    playersByTeam.set(teamId, bucket);
  }

  const normalized = [];
  const seen = new Set();

  for (const team of asArray(shadowState.teamInfoList)) {
    const record = asObject(team);
    if (!record || Object.keys(record).length === 0) {
      continue;
    }

    const teamId =
      extractDirectTeamId(record) ??
      firstTextValue(record, DIRECT_TEAM_NAME_KEYS);
    if (!teamId || seen.has(teamId)) {
      continue;
    }
    seen.add(teamId);

    const teamPlayers = playersByTeam.get(teamId) ?? [];
    const alivePlayers =
      firstNumberValue(record, [
        "alivePlayers",
        "AlivePlayers",
        "aliveCount",
        "remainPlayerNum",
        "remainingPlayers",
        "liveMemberNum",
        "LiveMemberNum",
        "aliveMemberNum",
        "AliveMemberNum",
      ]) ?? teamPlayers.filter((player) => player.alive === true).length;
    const totalPlayers =
      firstNumberValue(record, [
        "totalPlayers",
        "TotalPlayers",
        "totalPlayerCount",
        "playerCount",
        "memberNum",
        "playerNum",
      ]) ?? teamPlayers.length;

    normalized.push({
      teamId,
      teamName:
        firstTextValue(record, DIRECT_TEAM_NAME_KEYS) ??
        formatSlotLabel(firstNumberValue(record, DIRECT_TEAM_SLOT_KEYS)),
      teamTag: firstTextValue(record, DIRECT_TEAM_TAG_KEYS),
      slot: (() => {
        const slot = firstNumberValue(record, DIRECT_TEAM_SLOT_KEYS);
        return slot === null ? null : Math.trunc(slot);
      })(),
      logoUrl: firstTextValue(record, DIRECT_TEAM_LOGO_KEYS) ?? null,
      kills: Math.max(
        0,
        Math.trunc(
          firstNumberValue(record, ["kills", "Kills", "killNum", "KillNum", "killCount"], 0) ?? 0,
        ),
      ),
      alivePlayers: Math.max(0, Math.trunc(alivePlayers)),
      totalPlayers: Math.max(0, Math.trunc(totalPlayers)),
      placement: (() => {
        const placement = firstNumberValue(record, ["rank", "Rank", "placement", "placementIndex"]);
        return placement === null ? null : Math.trunc(placement);
      })(),
      players: teamPlayers,
    });
  }

  for (const [teamId, teamPlayers] of playersByTeam.entries()) {
    if (seen.has(teamId)) {
      continue;
    }
    normalized.push({
      teamId,
      teamName: formatSlotLabel(null),
      teamTag: null,
      slot: null,
      logoUrl: null,
      kills: Math.max(
        0,
        teamPlayers.reduce(
          (total, player) => total + Math.max(0, Math.trunc(numberValue(player?.kills) ?? 0)),
          0,
        ),
      ),
      alivePlayers: teamPlayers.filter((player) => player.alive === true).length,
      totalPlayers: teamPlayers.length,
      placement: null,
      players: teamPlayers,
    });
  }

  return normalized;
}

function sortDirectLeaderboardTeams(teams) {
  return [...teams].sort((left, right) => {
    const leftAlive = Math.max(0, Math.trunc(numberValue(left?.alivePlayers) ?? 0));
    const rightAlive = Math.max(0, Math.trunc(numberValue(right?.alivePlayers) ?? 0));
    const leftEliminated = leftAlive <= 0;
    const rightEliminated = rightAlive <= 0;

    if (leftEliminated !== rightEliminated) {
      return leftEliminated ? 1 : -1;
    }
    if (!leftEliminated) {
      const leftKills = Math.max(0, Math.trunc(numberValue(left?.kills) ?? 0));
      const rightKills = Math.max(0, Math.trunc(numberValue(right?.kills) ?? 0));
      if (rightKills !== leftKills) {
        return rightKills - leftKills;
      }
      if (rightAlive !== leftAlive) {
        return rightAlive - leftAlive;
      }
    }

    const leftPlacement = numberValue(left?.placement) ?? Number.MAX_SAFE_INTEGER;
    const rightPlacement = numberValue(right?.placement) ?? Number.MAX_SAFE_INTEGER;
    if (leftPlacement !== rightPlacement) {
      return leftPlacement - rightPlacement;
    }

    const leftSlot = numberValue(left?.slot) ?? Number.MAX_SAFE_INTEGER;
    const rightSlot = numberValue(right?.slot) ?? Number.MAX_SAFE_INTEGER;
    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }

    return String(left?.teamName ?? left?.teamTag ?? left?.teamId ?? "").localeCompare(
      String(right?.teamName ?? right?.teamTag ?? right?.teamId ?? ""),
    );
  });
}

function normalizeDirectCircle() {
  const circleSources = [
    shadowState.routePayloads["/setgameglobalinfo"],
    shadowState.routePayloads["/setcircleinfo"],
    shadowState.bestCircleInfo,
    shadowState.circleInfo,
    shadowState.allInfo?.CircleInfo,
    shadowState.allInfo?.circleInfo,
    shadowState.allInfo?.circle,
  ];
  const candidates = [];
  for (const candidateSource of circleSources) {
    candidates.push(...collectCircleCandidates(candidateSource));
  }

  const pickCircleCandidate = (scoreCandidate) => {
    let best = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      const score = scoreCandidate(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best ? projectCirclePayload(best) : {};
  };
  const geometrySource = pickCircleCandidate((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return -1;
    }

    let score = 0;
    if (Array.isArray(candidate.CircleArray) && candidate.CircleArray.length > 0) {
      score += 120;
    }
    if (
      (candidate.safeZone && typeof candidate.safeZone === "object") ||
      (candidate.safezone && typeof candidate.safezone === "object") ||
      (candidate.blueZone && typeof candidate.blueZone === "object")
    ) {
      score += 100;
    }
    if (
      (candidate.nextZone && typeof candidate.nextZone === "object") ||
      (candidate.nextzone && typeof candidate.nextzone === "object") ||
      (candidate.whiteZone && typeof candidate.whiteZone === "object")
    ) {
      score += 90;
    }
    if (
      (candidate.zoneCenter && typeof candidate.zoneCenter === "object") ||
      candidate.zoneRadius !== undefined
    ) {
      score += 70;
    }

    return score;
  });
  const timingSource = pickCircleCandidate((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return -1;
    }

    let score = 0;
    if (
      candidate.phase !== undefined ||
      candidate.phaseIndex !== undefined ||
      candidate.circlePhase !== undefined ||
      candidate.CircleIndex !== undefined ||
      candidate.circleIndex !== undefined
    ) {
      score += 40;
    }
    if (
      candidate.CircleStatus !== undefined ||
      candidate.circleStatus !== undefined
    ) {
      score += 30;
    }
    if (candidate.Counter !== undefined || candidate.MaxTime !== undefined) {
      score += 50;
    }
    if (
      candidate.nextShrinkAt !== undefined ||
      candidate.nextShrinkTs !== undefined ||
      candidate.nextShrinkTime !== undefined ||
      candidate.zoneNextShrinkAt !== undefined ||
      candidate.nextPhaseAt !== undefined ||
      candidate.remainingTime !== undefined ||
      candidate.countdown !== undefined
    ) {
      score += 25;
    }

    return score;
  });
  const source = {
    ...geometrySource,
    ...timingSource,
  };
  if (!source || Object.keys(source).length === 0) {
    return null;
  }

  const circleArray = asArray(source.CircleArray);
  const phaseIndex =
    firstNumberValue(source, [
      "phase",
      "phaseIndex",
      "circlePhase",
      "CircleIndex",
      "circleIndex",
    ], null) ?? null;
  const circleArrayIndex =
    phaseIndex !== null && Number.isFinite(phaseIndex)
      ? Math.max(0, Math.trunc(phaseIndex) - 1)
      : 0;
  const objectOrNull = (value) => {
    const record = asObject(value);
    return Object.keys(record).length > 0 ? record : null;
  };
  const safeZone =
    objectOrNull(source.safeZone ?? source.safezone ?? source.blueZone) ??
    objectOrNull(circleArray[Math.min(circleArrayIndex, Math.max(circleArray.length - 1, 0))]);
  const nextZone =
    objectOrNull(source.nextZone ?? source.nextzone ?? source.whiteZone) ??
    objectOrNull(circleArray[circleArrayIndex + 1]);
  const toZone = (zone) => {
    if (!zone || Object.keys(zone).length === 0) {
      return null;
    }
    const x = numberValue(zone.x ?? zone.X ?? zone.cx ?? zone.centerX);
    const y = numberValue(zone.y ?? zone.Y ?? zone.cy ?? zone.centerY);
    const r = numberValue(zone.r ?? zone.R ?? zone.radius ?? zone.Radius ?? zone.Size);
    if (x === null || y === null || r === null) {
      return null;
    }
    return { x, y, r };
  };
  const toIso = (value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const ms = value > 1_000_000_000_000 ? value : value * 1000;
      return new Date(ms).toISOString();
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return toIso(numeric);
      }
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return new Date(parsed).toISOString();
      }
    }
    return null;
  };
  const toFutureIso = (value, referenceIso) => {
    const referenceMs = referenceIso ? Date.parse(referenceIso) : Date.now();
    const baseMs = Number.isNaN(referenceMs) ? Date.now() : referenceMs;

    if (typeof value === "number" && Number.isFinite(value)) {
      if (value >= 0 && value <= 86_400) {
        return new Date(baseMs + value * 1000).toISOString();
      }
      return toIso(value);
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        if (numeric >= 0 && numeric <= 86_400) {
          return new Date(baseMs + numeric * 1000).toISOString();
        }
        return toIso(numeric);
      }
      return toIso(value);
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return null;
  };
  const counter =
    firstNumberValue(source, ["Counter", "counter"], null) ??
    firstNumberValue(nextZone, ["Counter", "counter"], null);
  const maxTime =
    firstNumberValue(source, ["MaxTime", "maxTime"], null) ??
    firstNumberValue(nextZone, ["MaxTime", "maxTime"], null);
  const nextShrinkAt =
    toFutureIso(
      source.nextShrinkAt ??
        source.nextShrinkTs ??
        source.nextShrinkTime ??
        source.zoneNextShrinkAt ??
        source.nextPhaseAt ??
        source.remainingTime ??
        source.countdown ??
        null,
      shadowState.updatedAt,
    ) ??
    (counter !== null && maxTime !== null && maxTime >= counter
      ? toFutureIso(maxTime - counter, shadowState.updatedAt)
      : null);

  return {
    phase: phaseIndex,
    status: textValue(source.CircleStatus ?? source.circleStatus) ?? null,
    counterSeconds: counter,
    maxTimeSeconds: maxTime,
    nextShrinkAt,
    safeZone: toZone(safeZone),
    nextZone: toZone(nextZone),
  };
}

function buildMergedCircleInfo() {
  const selectedCircle = pickRichestCirclePayload(
    shadowState.routePayloads["/setgameglobalinfo"],
    shadowState.routePayloads["/setcircleinfo"],
    shadowState.bestCircleInfo,
    shadowState.circleInfo,
    shadowState.allInfo?.CircleInfo,
    shadowState.allInfo?.circleInfo,
    shadowState.allInfo?.circle,
  );
  const normalized = normalizeDirectCircle();

  if (!normalized) {
    return selectedCircle;
  }

  const phase =
    normalized.phase ??
    firstNumberValue(selectedCircle, [
      "CircleIndex",
      "circleIndex",
      "phase",
      "phaseIndex",
      "circlePhase",
    ], null);
  const status =
    normalized.status ??
    textValue(selectedCircle.CircleStatus ?? selectedCircle.circleStatus ?? selectedCircle.status) ??
    null;
  const counter =
    normalized.counterSeconds ??
    firstNumberValue(selectedCircle, ["Counter", "counter", "counterSeconds"], null);
  const maxTime =
    normalized.maxTimeSeconds ??
    firstNumberValue(selectedCircle, ["MaxTime", "maxTime", "maxTimeSeconds"], null);

  return {
    ...selectedCircle,
    phase,
    circleIndex: selectedCircle.circleIndex ?? phase,
    CircleIndex: selectedCircle.CircleIndex ?? phase,
    status,
    circleStatus: selectedCircle.circleStatus ?? status,
    CircleStatus: selectedCircle.CircleStatus ?? status,
    Counter: selectedCircle.Counter ?? counter,
    counter: selectedCircle.counter ?? counter,
    counterSeconds: counter,
    MaxTime: selectedCircle.MaxTime ?? maxTime,
    maxTime: selectedCircle.maxTime ?? maxTime,
    maxTimeSeconds: maxTime,
    nextShrinkAt: normalized.nextShrinkAt ?? selectedCircle.nextShrinkAt ?? null,
    safeZone:
      normalized.safeZone ??
      selectedCircle.safeZone ??
      selectedCircle.safezone ??
      selectedCircle.blueZone ??
      null,
    nextZone:
      normalized.nextZone ??
      selectedCircle.nextZone ??
      selectedCircle.nextzone ??
      selectedCircle.whiteZone ??
      null,
    updatedAt: shadowState.updatedAt ?? new Date().toISOString(),
  };
}

function buildDirectPlayerCard(players, teams) {
  const observer = asObject(shadowState.observingPlayer);
  if (!observer || Object.keys(observer).length === 0) {
    return null;
  }

  const observerPlayerId = firstTextValue(observer, [
    "playerOpenId",
    "playerOpenID",
    "PlayerOpenId",
    "PlayerOpenID",
    "externalPlayerId",
    "externalId",
    "playerId",
    "playerID",
    "PlayerId",
    "PlayerID",
    "id",
    "ID",
  ]);
  const observerName = firstTextValue(observer, [
    "playerName",
    "PlayerName",
    "ign",
    "IGN",
    "name",
    "Name",
  ]);
  const observerTeamId = firstTextValue(observer, [
    "teamId",
    "teamID",
    "TeamId",
    "TeamID",
    "team_id",
  ]);
  const observerSlot = firstNumberValue(observer, [
    "slot",
    "Slot",
    "teamNo",
    "teamNumber",
    "teamIndex",
    "order",
  ]);
  const normalizedObserverName = observerName ? observerName.toLowerCase() : null;

  let matchedPlayer = null;
  if (observerPlayerId) {
    matchedPlayer =
      players.find((player) => textValue(player?.playerId) === observerPlayerId) ?? null;
  }
  if (!matchedPlayer && normalizedObserverName) {
    matchedPlayer =
      players.find((player) => {
        const sameName =
          textValue(player?.playerName)?.toLowerCase() === normalizedObserverName;
        if (!sameName) {
          return false;
        }
        return !observerTeamId || textValue(player?.teamId) === observerTeamId;
      }) ?? null;
  }

  let matchedTeam = null;
  if (matchedPlayer?.teamId) {
    matchedTeam =
      teams.find((team) => textValue(team?.teamId) === textValue(matchedPlayer.teamId)) ?? null;
  }
  if (!matchedTeam && observerTeamId) {
    matchedTeam =
      teams.find((team) => textValue(team?.teamId) === observerTeamId) ?? null;
  }
  if (!matchedTeam && observerSlot !== null) {
    matchedTeam =
      teams.find((team) => Math.trunc(numberValue(team?.slot) ?? -1) === Math.trunc(observerSlot)) ??
      null;
  }

  return {
    playerId: textValue(matchedPlayer?.playerId) ?? observerPlayerId ?? null,
    name: textValue(matchedPlayer?.playerName) ?? observerName ?? "Player",
    avatarUrl:
      firstTextValue(observer, ["avatarUrl", "AvatarUrl", "photoUrl", "PhotoUrl"]) ?? null,
    teamId: textValue(matchedTeam?.teamId) ?? textValue(matchedPlayer?.teamId) ?? observerTeamId ?? null,
    teamName:
      textValue(matchedTeam?.teamName) ??
      firstTextValue(observer, ["teamName", "TeamName", "name"]) ??
      null,
    teamTag:
      textValue(matchedTeam?.teamTag) ??
      firstTextValue(observer, ["teamTag", "tag", "Tag"]) ??
      null,
    logoUrl: textValue(matchedTeam?.logoUrl) ?? null,
    color: null,
    kills:
      Math.max(
        0,
        Math.trunc(
          numberValue(matchedPlayer?.kills) ??
            firstNumberValue(observer, ["kills", "Kills", "killNum", "KillNum", "killCount"], 0) ??
            0,
        ),
      ),
    alive: matchedPlayer?.alive === true ? true : isDirectPlayerAlive(observer),
    damage: firstNumberValue(observer, [
      "damage",
      "Damage",
      "damageDealt",
      "DamageDealt",
      "totalDamage",
      "TotalDamage",
      "damageValue",
      "DamageValue",
    ]),
  };
}

function extractDirectMapName() {
  const allInfo = asObject(shadowState.allInfo);
  const routePayloads = asObject(shadowState.routePayloads);
  const gameGlobalInfo = asObject(routePayloads?.["/setgameglobalinfo"]);
  const circleInfo = asObject(routePayloads?.["/setcircleinfo"]);
  const players = Array.isArray(shadowState.playerInfoList)
    ? shadowState.playerInfoList
    : [];
  const firstPlayer = asObject(players[0]);
  const observingPlayer = asObject(shadowState.observingPlayer);

  for (const candidate of [
    allInfo,
    gameGlobalInfo,
    circleInfo,
    firstPlayer,
    observingPlayer,
  ]) {
    const mapName = firstTextValue(candidate, [
      "mapName",
      "MapName",
      "map",
      "Map",
      "mapId",
      "MapId",
      "MapNameStr",
    ]);
    if (mapName) {
      return mapName;
    }
  }

  return null;
}

function buildDirectLeaderboardPayload(matchIdOverride) {
  const players = normalizeDirectPlayers();
  const teams = sortDirectLeaderboardTeams(normalizeDirectTeams(players));
  const teamsAlive = teams.reduce(
    (count, team) => count + (Math.max(0, Math.trunc(numberValue(team.alivePlayers) ?? 0)) > 0 ? 1 : 0),
    0,
  );
  const flightPath =
    extractDirectFlightPath(shadowState.routePayloads["/setgameglobalinfo"]) ??
    extractDirectFlightPath(shadowState.allInfo) ??
    null;

  const leaderboard = teams.map((team, index) => {
    const alivePlayers = Math.max(0, Math.trunc(numberValue(team.alivePlayers) ?? 0));
    const totalPlayers = Math.max(alivePlayers, Math.trunc(numberValue(team.totalPlayers) ?? 0));
    const isEliminated = alivePlayers <= 0;
    const playersList = [...(Array.isArray(team.players) ? team.players : [])]
      .sort((left, right) => {
        if ((left.alive === true) !== (right.alive === true)) {
          return left.alive === true ? -1 : 1;
        }
        const rightKills = Math.max(0, Math.trunc(numberValue(right.kills) ?? 0));
        const leftKills = Math.max(0, Math.trunc(numberValue(left.kills) ?? 0));
        if (rightKills !== leftKills) {
          return rightKills - leftKills;
        }
        return String(left.playerName ?? "").localeCompare(String(right.playerName ?? ""));
      })
      .map((player) => ({
        playerId: textValue(player.playerId),
        playerName: textValue(player.playerName) ?? "Player",
        avatarUrl: null,
        kills: Math.max(0, Math.trunc(numberValue(player.kills) ?? 0)),
        alive: player.alive === true,
        knocked: player.alive === true && player.knocked === true,
      health: numberValue(player.health),
      outsideBlueCircle:
        typeof player.outsideBlueCircle === "boolean"
          ? player.outsideBlueCircle
          : null,
      x: numberValue(player.x),
      y: numberValue(player.y),
        hasDied: player.alive === true ? false : true,
        lifeTelemetryFresh: true,
      }));

    const placement =
      team.placement !== null && team.placement !== undefined
        ? Math.max(1, Math.trunc(numberValue(team.placement) ?? 1))
        : teamsAlive === 1 && !isEliminated
          ? 1
          : null;

    return {
      rank: index + 1,
      teamId: textValue(team.teamId),
      slot: team.slot === null ? null : Math.trunc(numberValue(team.slot) ?? 0),
      teamName:
        textValue(team.teamName) ??
        textValue(team.teamTag) ??
        formatSlotLabel(numberValue(team.slot)),
      teamTag: textValue(team.teamTag),
      logoUrl: textValue(team.logoUrl),
      color: null,
      kills: Math.max(0, Math.trunc(numberValue(team.kills) ?? 0)),
      alivePlayers: isEliminated ? 0 : alivePlayers,
      totalPlayers: totalPlayers > 0 ? totalPlayers : null,
      placement,
      isEliminated,
      players: playersList,
    };
  });

  const winner =
    leaderboard.find((team) => team.alivePlayers > 0 && teamsAlive === 1) ??
    leaderboard.find((team) => team.placement === 1) ??
    null;

  return {
    matchId: textValue(matchIdOverride) ?? getObserverMatchId() ?? "observer-direct",
    updatedAt: shadowState.updatedAt ?? new Date().toISOString(),
    mapName: extractDirectMapName(),
    teamsAlive,
    leaderboard,
    killFeed: [],
    playerCard: buildDirectPlayerCard(players, teams),
    circle: normalizeDirectCircle(),
    flightPath,
    winner: winner
      ? {
          teamId: winner.teamId,
          slot: winner.slot,
          teamName: winner.teamName,
          teamTag: winner.teamTag,
          logoUrl: winner.logoUrl,
          color: null,
          kills: winner.kills,
          alivePlayers: winner.alivePlayers,
          placement: winner.placement,
        }
      : null,
  };
}

const DIRECT_MAP_OVERLAY_CONFIGS = {
  ERANGEL: {
    mapName: "ERANGEL",
    worldSize: 816000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  MIRAMAR: {
    mapName: "MIRAMAR",
    worldSize: 816000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  SANHOK: {
    mapName: "SANHOK",
    worldSize: 408000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  VIKENDI: {
    mapName: "VIKENDI",
    worldSize: 612000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  LIVIK: {
    mapName: "LIVIK",
    worldSize: 408000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  LIVIK_AFTERMATH: {
    mapName: "LIVIK AFTERMATH",
    worldSize: 408000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  KARAKIN: {
    mapName: "KARAKIN",
    worldSize: 204000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  NUSA: {
    mapName: "NUSA",
    worldSize: 102000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
  RONDO: {
    mapName: "RONDO",
    worldSize: 816000,
    coordinateSystem: "WORLD_BOTTOM_LEFT",
    coordinateScaleHint: 102,
  },
};

function normalizeDirectMapOverlayKey(value) {
  const normalized = textValue(value);
  if (!normalized) {
    return null;
  }

  return normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function resolveDirectMapOverlayConfig(mapName) {
  const key = normalizeDirectMapOverlayKey(mapName);
  return key ? DIRECT_MAP_OVERLAY_CONFIGS[key] ?? null : null;
}

function clampDirectMapOverlay(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveDirectTimestampMs(value) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function directPlayerHasMapPosition(player) {
  return Boolean(
    player &&
      typeof player.x === "number" &&
      Number.isFinite(player.x) &&
      typeof player.y === "number" &&
      Number.isFinite(player.y),
  );
}

function detectDirectMapOverlayCoordinateScale(mapConfig, values) {
  const hint = numberValue(mapConfig?.coordinateScaleHint) ?? 1;
  if (hint <= 1 || !mapConfig) {
    return 1;
  }

  const finiteValues = values.filter(
    (value) => Number.isFinite(value) && Math.abs(value) > 0,
  );
  if (finiteValues.length === 0) {
    return 1;
  }

  const maxValue = Math.max(...finiteValues.map((value) => Math.abs(value)));
  return maxValue <= mapConfig.worldSize / 20 ? hint : 1;
}

function scaleDirectMapOverlayValue(value, scaleFactor) {
  return Number.isFinite(value) ? value * scaleFactor : value;
}

function buildDirectMapOverlayPlayerMarkers(players, scaleFactor) {
  return (Array.isArray(players) ? players : [])
    .filter((player) => directPlayerHasMapPosition(player))
    .map((player) => ({
      playerId: player.playerId ?? null,
      teamId: player.teamId ?? null,
      x: scaleDirectMapOverlayValue(player.x, scaleFactor),
      y: scaleDirectMapOverlayValue(player.y, scaleFactor),
      alive: player.alive === true,
      knocked: player.alive === true && player.knocked === true,
    }));
}

function buildDirectMapOverlayTeamMarkers(playerMarkers) {
  const teamsById = new Map();
  for (const marker of Array.isArray(playerMarkers) ? playerMarkers : []) {
    if (!marker.teamId) {
      continue;
    }

    const current = teamsById.get(marker.teamId) ?? {
      teamId: marker.teamId,
      x: 0,
      y: 0,
      alive: false,
      playerCount: 0,
      alivePlayers: 0,
    };
    current.x += marker.x;
    current.y += marker.y;
    current.playerCount += 1;
    if (marker.alive !== false) {
      current.alive = true;
      current.alivePlayers += 1;
    }
    teamsById.set(marker.teamId, current);
  }

  return Array.from(teamsById.values()).map((marker) => ({
    ...marker,
    x: marker.playerCount > 0 ? marker.x / marker.playerCount : marker.x,
    y: marker.playerCount > 0 ? marker.y / marker.playerCount : marker.y,
  }));
}

function scaleDirectMapOverlayCircle(circle, scaleFactor) {
  if (!circle) {
    return null;
  }

  return {
    safeZone: circle.safeZone
      ? {
          x: scaleDirectMapOverlayValue(circle.safeZone.x, scaleFactor),
          y: scaleDirectMapOverlayValue(circle.safeZone.y, scaleFactor),
          r: scaleDirectMapOverlayValue(circle.safeZone.r, scaleFactor),
        }
      : null,
    nextZone: circle.nextZone
      ? {
          x: scaleDirectMapOverlayValue(circle.nextZone.x, scaleFactor),
          y: scaleDirectMapOverlayValue(circle.nextZone.y, scaleFactor),
          r: scaleDirectMapOverlayValue(circle.nextZone.r, scaleFactor),
        }
      : null,
    phase: circle.phase ?? null,
    status: circle.status ?? null,
    counterSeconds: circle.counterSeconds ?? null,
    maxTimeSeconds: circle.maxTimeSeconds ?? null,
    nextShrinkAt: circle.nextShrinkAt ?? null,
  };
}

function scaleDirectMapOverlayFlightPath(flightPath, scaleFactor, coordinateSystem) {
  if (!flightPath) {
    return null;
  }

  return {
    start: {
      x: scaleDirectMapOverlayValue(flightPath.start.x, scaleFactor),
      y: scaleDirectMapOverlayValue(flightPath.start.y, scaleFactor),
    },
    end: {
      x: scaleDirectMapOverlayValue(flightPath.end.x, scaleFactor),
      y: scaleDirectMapOverlayValue(flightPath.end.y, scaleFactor),
    },
    coordinateSystem: flightPath.coordinateSystem ?? coordinateSystem ?? "WORLD",
  };
}

function deriveDirectMapOverlayWorldSize(baseWorldSize, points, circles, flightPath) {
  const base =
    typeof baseWorldSize === "number" && Number.isFinite(baseWorldSize)
      ? baseWorldSize
      : null;
  if (!base) {
    return null;
  }
  return base;
}

function clipDirectLineToMapBounds(point, direction, worldSize) {
  const intersections = [];
  const epsilon = 1e-6;

  const pushIntersection = (t) => {
    const x = point.x + direction.x * t;
    const y = point.y + direction.y * t;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < -epsilon ||
      x > worldSize + epsilon ||
      y < -epsilon ||
      y > worldSize + epsilon
    ) {
      return;
    }

    const clampedX = clampDirectMapOverlay(x, 0, worldSize);
    const clampedY = clampDirectMapOverlay(y, 0, worldSize);
    const duplicate = intersections.some(
      (candidate) =>
        Math.abs(candidate.x - clampedX) < 1 &&
        Math.abs(candidate.y - clampedY) < 1,
    );
    if (!duplicate) {
      intersections.push({ x: clampedX, y: clampedY, t });
    }
  };

  if (Math.abs(direction.x) > epsilon) {
    pushIntersection((0 - point.x) / direction.x);
    pushIntersection((worldSize - point.x) / direction.x);
  }
  if (Math.abs(direction.y) > epsilon) {
    pushIntersection((0 - point.y) / direction.y);
    pushIntersection((worldSize - point.y) / direction.y);
  }

  if (intersections.length < 2) {
    return null;
  }

  intersections.sort((left, right) => left.t - right.t);
  const start = intersections[0];
  const end = intersections[intersections.length - 1];
  if (!start || !end) {
    return null;
  }

  return {
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
  };
}

function inferDirectMapOverlayFlightPath(playerMarkers, circle, worldSizeHint) {
  const phase = circle?.phase ?? null;
  if (phase !== null && phase > 1) {
    return null;
  }

  const samples = (Array.isArray(playerMarkers) ? playerMarkers : [])
    .filter((marker) => marker.alive === true)
    .map((marker) => ({
      x: marker.x,
      y: marker.y,
    }));
  if (samples.length < 12) {
    return null;
  }

  const worldSize =
    typeof worldSizeHint === "number" && Number.isFinite(worldSizeHint)
      ? worldSizeHint
      : 816000;
  const mean = samples.reduce(
    (acc, sample) => {
      acc.x += sample.x;
      acc.y += sample.y;
      return acc;
    },
    { x: 0, y: 0 },
  );
  mean.x /= samples.length;
  mean.y /= samples.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const sample of samples) {
    const dx = sample.x - mean.x;
    const dy = sample.y - mean.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const discriminant = Math.max(0, trace * trace - 4 * det);
  const eigenValue = (trace + Math.sqrt(discriminant)) / 2;
  let direction =
    Math.abs(sxy) > 1e-6
      ? { x: eigenValue - syy, y: sxy }
      : sxx >= syy
        ? { x: 1, y: 0 }
        : { x: 0, y: 1 };
  const magnitude = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-6) {
    return null;
  }

  direction = {
    x: direction.x / magnitude,
    y: direction.y / magnitude,
  };

  const projections = samples.map(
    (sample) =>
      (sample.x - mean.x) * direction.x + (sample.y - mean.y) * direction.y,
  );
  const span = Math.max(...projections) - Math.min(...projections);
  if (!Number.isFinite(span) || span < worldSize * 0.12) {
    return null;
  }

  return clipDirectLineToMapBounds(mean, direction, worldSize);
}

function buildDirectMapOverlayPayload(matchIdOverride) {
  const directPlayers = normalizeDirectPlayers();
  const payload = buildDirectLeaderboardPayload(matchIdOverride);
  const mapConfig = resolveDirectMapOverlayConfig(payload.mapName);
  const scaleFactor = detectDirectMapOverlayCoordinateScale(mapConfig, [
    ...directPlayers.flatMap((player) => [player.x, player.y]),
    payload.circle?.safeZone?.x,
    payload.circle?.safeZone?.y,
    payload.circle?.safeZone?.r,
    payload.circle?.nextZone?.x,
    payload.circle?.nextZone?.y,
    payload.circle?.nextZone?.r,
    payload.flightPath?.start?.x,
    payload.flightPath?.start?.y,
    payload.flightPath?.end?.x,
    payload.flightPath?.end?.y,
  ]);
  const playerMarkers = buildDirectMapOverlayPlayerMarkers(
    directPlayers,
    scaleFactor,
  );
  const teamMarkers = buildDirectMapOverlayTeamMarkers(playerMarkers);
  const scaledCircle = scaleDirectMapOverlayCircle(payload.circle, scaleFactor);
  const markerPoints = [
    ...playerMarkers.map((marker) => ({ x: marker.x, y: marker.y })),
    ...teamMarkers.map((marker) => ({ x: marker.x, y: marker.y })),
  ];
  const provisionalWorldSize = deriveDirectMapOverlayWorldSize(
    mapConfig?.worldSize ?? null,
    markerPoints,
    [scaledCircle?.safeZone, scaledCircle?.nextZone],
    null,
  );
  const directFlightPath = scaleDirectMapOverlayFlightPath(
    payload.flightPath,
    scaleFactor,
    mapConfig?.coordinateSystem ?? "WORLD_BOTTOM_LEFT",
  );
  const inferredFlightPath =
    directFlightPath == null
      ? (() => {
          const inferred = inferDirectMapOverlayFlightPath(
            playerMarkers,
            scaledCircle,
            provisionalWorldSize ?? mapConfig?.worldSize ?? null,
          );
          if (!inferred) {
            return null;
          }

          return {
            ...inferred,
            coordinateSystem: mapConfig?.coordinateSystem ?? "WORLD_BOTTOM_LEFT",
          };
        })()
      : null;
  const flightPath = directFlightPath ?? inferredFlightPath ?? null;
  const effectiveWorldSize = deriveDirectMapOverlayWorldSize(
    mapConfig?.worldSize ?? null,
    markerPoints,
    [scaledCircle?.safeZone, scaledCircle?.nextZone],
    flightPath,
  );
  const nextShrinkAtMs = resolveDirectTimestampMs(scaledCircle?.nextShrinkAt ?? null);
  const xs = playerMarkers.map((marker) => marker.x).filter(Number.isFinite);
  const ys = playerMarkers.map((marker) => marker.y).filter(Number.isFinite);

  return {
    matchId: payload.matchId || textValue(matchIdOverride) || "observer-direct",
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
    map:
      mapConfig && effectiveWorldSize
        ? {
            mapName: mapConfig.mapName,
            worldSize: effectiveWorldSize,
            coordinateSystem: mapConfig.coordinateSystem,
          }
        : mapConfig,
    debug: {
      producer: "observer-map-overlay",
      totalPlayers: directPlayers.length,
      positionedPlayers: playerMarkers.length,
      playerMarkers: playerMarkers.length,
      teamMarkers: teamMarkers.length,
      worldSize: effectiveWorldSize ?? mapConfig?.worldSize ?? null,
      bounds: {
        minX: xs.length > 0 ? Math.min(...xs) : null,
        maxX: xs.length > 0 ? Math.max(...xs) : null,
        minY: ys.length > 0 ? Math.min(...ys) : null,
        maxY: ys.length > 0 ? Math.max(...ys) : null,
      },
    },
    circle: scaledCircle
      ? {
          safeZone: scaledCircle.safeZone ?? null,
          nextZone: scaledCircle.nextZone ?? null,
          phaseIndex: scaledCircle.phase ?? null,
          status: scaledCircle.status ?? null,
          counterSeconds: scaledCircle.counterSeconds ?? null,
          maxTimeSeconds: scaledCircle.maxTimeSeconds ?? null,
          nextShrinkAt: scaledCircle.nextShrinkAt ?? null,
          timerRemaining:
            nextShrinkAtMs !== null ? Math.max(0, nextShrinkAtMs - Date.now()) : null,
          timeRemainingToNextPhase:
            nextShrinkAtMs !== null
              ? Math.max(0, Math.ceil((nextShrinkAtMs - Date.now()) / 1000))
              : null,
          phaseLabel:
            scaledCircle.phase !== null && scaledCircle.phase !== undefined
              ? `Phase ${scaledCircle.phase}`
              : null,
        }
      : null,
    flightPath,
    teamMarkers,
    playerMarkers,
  };
}

function normalizeDirectKillEvents() {
  const candidates = [];

  const collectCandidates = (value, metadata = {}, depth = 0) => {
    if (depth > 4 || value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        collectCandidates(item, metadata, depth + 1);
      }
      return;
    }

    const record = asObject(value);
    if (!record || Object.keys(record).length === 0) {
      return;
    }

    let expanded = false;
    for (const nested of [
      record.events,
      record.KillList,
      record.killList,
      record.kills,
      record.killInfo,
      record.KillInfo,
      record.list,
      record.data,
    ]) {
      if (Array.isArray(nested) && nested.length > 0) {
        expanded = true;
        collectCandidates(nested, metadata, depth + 1);
      }
    }

    if (!expanded) {
      candidates.push({
        record,
        receivedAtMs:
          numberValue(metadata?.receivedAtMs) ??
          (candidates.length + 1) * FALLBACK_KILL_EVENT_GAP_MS,
        sequence: candidates.length,
      });
    }
  };

  const killInfoEntries =
    asArray(shadowState.killInfoEntries).length > 0
      ? [...asArray(shadowState.killInfoEntries)].reverse()
      : [...asArray(shadowState.killInfo)].reverse().map((payload, index) => ({
          payload,
          receivedAtMs: (index + 1) * FALLBACK_KILL_EVENT_GAP_MS,
        }));

  for (const entry of killInfoEntries) {
    const entryRecord = asObject(entry);
    collectCandidates(entryRecord?.payload ?? entry, {
      receivedAtMs: numberValue(entryRecord?.receivedAtMs),
    });
  }

  const events = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const record = candidate.record;
    const resultStatus = firstTextValue(record, [
      "ResultHealthStatus",
      "resultHealthStatus",
      "healthStatus",
    ]);
    if (resultStatus && resultStatus !== "1") {
      continue;
    }

    const killerPlayerId =
      firstTextValue(record, [
        "killerPlayerId",
        "killerPlayerID",
        "killerPlayerExternalId",
        "killerId",
        "killerID",
        "killerOpenId",
        "killerOpenID",
        "CauserUID",
        "causerUid",
        "AttackerUID",
        "attackerUid",
      ]) ?? null;
    const killerTeamId =
      firstTextValue(record, [
        "killerTeamId",
        "killerTeamID",
        "attackerTeamId",
        "attackerTeamID",
        "AttackerTeamId",
        "AttackerTeamID",
        "CauserTeamId",
        "causerTeamId",
        "teamId",
      ]) ?? null;
    const killerName =
      firstTextValue(record, [
        "killerName",
        "killerIgn",
        "killerPlayerName",
        "killer",
        "CauserName",
        "causerName",
        "AttackerName",
        "attackerName",
      ]) ?? null;
    const victimPlayerId =
      firstTextValue(record, [
        "victimPlayerId",
        "victimPlayerID",
        "victimPlayerExternalId",
        "victimId",
        "victimID",
        "deadPlayerId",
        "VictimUID",
        "victimUid",
      ]) ?? null;
    const victimTeamId =
      firstTextValue(record, [
        "victimTeamId",
        "victimTeamID",
        "VictimTeamId",
        "VictimTeamID",
        "deadTeamId",
        "DeadTeamId",
      ]) ?? null;
    const victimName =
      firstTextValue(record, [
        "victimName",
        "victimIgn",
        "victimPlayerName",
        "victim",
        "VictimName",
      ]) ?? null;
    const weapon =
      firstTextValue(record, [
        "weapon",
        "Weapon",
        "weaponName",
        "WeaponName",
        "damageCauserName",
        "causerName",
        "causer",
      ]) ?? null;
    const cause =
      firstTextValue(record, [
        "damageType",
        "DamageType",
        "killType",
        "KillType",
        "reason",
        "Reason",
        "cause",
        "Cause",
      ]) ?? null;
    if (!killerPlayerId && !killerTeamId && !victimPlayerId && !victimTeamId) {
      continue;
    }

    const killId =
      firstTextValue(record, ["killId", "KillId", "id", "ID", "eventId"]) ??
      (() => {
        const rawTimestampMs =
          firstNumberValue(record, [
            "timestamp",
            "Timestamp",
            "ts",
            "time",
            "eventTime",
          ]) ?? timestampMsValue(firstTextValue(record, ["timestamp", "Timestamp", "ts", "time"]));
        const relativeTimestampSeconds = firstNumberValue(record, [
          "CurGameTime",
          "curGameTime",
          "GameTime",
          "gameTime",
        ]);
        const timeKey =
          rawTimestampMs !== null
            ? `ts:${Math.trunc(rawTimestampMs)}`
            : relativeTimestampSeconds !== null
              ? `gt:${Math.trunc(relativeTimestampSeconds * 1000)}`
              : `rcv:${Math.trunc(candidate.receivedAtMs)}`;

        return [
          killerPlayerId ?? killerName ?? killerTeamId ?? "unknown-killer",
          victimPlayerId ?? victimName ?? victimTeamId ?? "unknown-victim",
          victimTeamId ?? "unknown-team",
          timeKey,
        ].join(":");
      })();

    if (seen.has(killId)) {
      continue;
    }
    seen.add(killId);

    const rawTimestampMs =
      firstNumberValue(record, [
        "timestamp",
        "Timestamp",
        "ts",
        "time",
        "eventTime",
      ]) ?? timestampMsValue(firstTextValue(record, ["timestamp", "Timestamp", "ts", "time"]));
    const relativeTimestampSeconds = firstNumberValue(record, [
      "CurGameTime",
      "curGameTime",
      "GameTime",
      "gameTime",
    ]);
    const timestamp =
      rawTimestampMs ??
      (relativeTimestampSeconds !== null
        ? Math.trunc(relativeTimestampSeconds * 1000)
        : Math.trunc(candidate.receivedAtMs));

    events.push({
      eventId: killId,
      killerPlayerId,
      killerTeamId,
      killerName,
      victimPlayerId,
      victimTeamId,
      victimName,
      weapon,
      cause,
      timestamp,
    });
  }

  events.sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
    return String(left.eventId).localeCompare(String(right.eventId));
  });

  return events;
}

function detectDirectSpecialKillType(kill) {
  const source = [kill.weapon, kill.cause]
    .map((value) => textValue(value)?.toLowerCase() ?? "")
    .filter((value) => value.length > 0)
    .join(" ");

  if (!source) {
    return null;
  }

  if (/\b(grenade|frag)\b/.test(source)) {
    return "GRENADE_KILL";
  }

  if (
    /\b(vehicle|buggy|dacia|uaz|bike|motorcycle|motorbike|truck|brdm|boat|snowmobile|scooter|pickup|monster truck|coupe rb|van|sedan)\b/.test(
      source,
    )
  ) {
    return "VEHICLE_KILL";
  }

  return null;
}

function buildDirectAchievementPayload(matchIdOverride) {
  const matchId = textValue(matchIdOverride) ?? getObserverMatchId() ?? "observer-direct";
  const players = normalizeDirectPlayers();
  const teams = normalizeDirectTeams(players);
  const playersById = new Map();
  const playersByName = new Map();
  const teamsById = new Map();
  const teamRemainingPlayers = new Map();

  for (const player of players) {
    if (textValue(player.playerId)) {
      playersById.set(textValue(player.playerId), player);
    }
    if (textValue(player.playerName)) {
      playersByName.set(textValue(player.playerName).toLowerCase(), player);
    }
  }

  for (const team of teams) {
    const teamId = textValue(team.teamId);
    if (!teamId) {
      continue;
    }
    teamsById.set(teamId, team);
    const inferredSize = Math.max(
      0,
      Math.trunc(numberValue(team.totalPlayers) ?? 0),
      Array.isArray(team.players) ? team.players.length : 0,
      Math.trunc(numberValue(team.alivePlayers) ?? 0),
    );
    teamRemainingPlayers.set(teamId, inferredSize);
  }

  const seenVictimsByTeam = new Map();
  const streaksByPlayer = new Map();
  const events = [];
  const emitted = new Set();
  let firstBloodEmitted = false;

  const pushEvent = (event) => {
    if (!event || emitted.has(event.eventId)) {
      return;
    }
    emitted.add(event.eventId);
    events.push(event);
  };

  for (const kill of normalizeDirectKillEvents()) {
    const killerPlayer =
      (kill.killerPlayerId ? playersById.get(kill.killerPlayerId) : null) ??
      (kill.killerName ? playersByName.get(kill.killerName.toLowerCase()) : null) ??
      null;
    const killerTeamId =
      kill.killerTeamId ??
      textValue(killerPlayer?.teamId) ??
      null;
    const killerTeam = killerTeamId ? teamsById.get(killerTeamId) ?? null : null;
    const killerName =
      kill.killerName ??
      textValue(killerPlayer?.playerName) ??
      null;
    const timestampIso = new Date(kill.timestamp).toISOString();
    const hasKillerIdentity =
      Boolean(killerPlayer?.playerId) ||
      Boolean(kill.killerPlayerId) ||
      Boolean(killerName);

    const killerIdentity = killerPlayer?.playerId ?? killerName ?? null;
    if (!firstBloodEmitted && hasKillerIdentity) {
      firstBloodEmitted = true;
      pushEvent({
        matchId,
        eventId: `${matchId}:FIRST_BLOOD:${kill.eventId}`,
        type: "FIRST_BLOOD",
        player: {
          id: killerPlayer?.playerId ?? kill.killerPlayerId ?? null,
          name: killerName,
          photoUrl: null,
        },
        team: {
          id: killerTeamId,
          name: textValue(killerTeam?.teamName),
          tag: textValue(killerTeam?.teamTag),
          logoUrl: textValue(killerTeam?.logoUrl),
        },
        timestamp: timestampIso,
      });
    }
    const specialKillType = detectDirectSpecialKillType(kill);
    if (specialKillType) {
      pushEvent({
        matchId,
        eventId: `${matchId}:${specialKillType}:${kill.eventId}`,
        type: specialKillType,
        player: {
          id: killerPlayer?.playerId ?? kill.killerPlayerId ?? null,
          name: killerName,
          photoUrl: null,
        },
        team: {
          id: killerTeamId,
          name: textValue(killerTeam?.teamName),
          tag: textValue(killerTeam?.teamTag),
          logoUrl: textValue(killerTeam?.logoUrl),
        },
        timestamp: timestampIso,
      });
    }

    if (killerIdentity) {
      const streak = (
        streaksByPlayer.get(killerIdentity) ?? []
      ).filter((marker) => kill.timestamp - marker.timestamp <= DIRECT_ACHIEVEMENT_STREAK_WINDOW_MS);
      streak.push({ eventId: kill.eventId, timestamp: kill.timestamp });
      streaksByPlayer.set(killerIdentity, streak);

      const streakType =
        streak.length === 3
          ? "TRIPLE_KILL"
          : streak.length >= 4
            ? "QUADRA_KILL"
            : null;
      if (streakType) {
        pushEvent({
          matchId,
          eventId: `${matchId}:${streakType}:${kill.eventId}`,
          type: streakType,
          player: {
            id: killerPlayer?.playerId ?? kill.killerPlayerId ?? null,
            name: killerName,
            photoUrl: null,
          },
          team: {
            id: killerTeamId,
            name: textValue(killerTeam?.teamName),
            tag: textValue(killerTeam?.teamTag),
            logoUrl: textValue(killerTeam?.logoUrl),
          },
          timestamp: timestampIso,
        });
      }
    }

    const victimTeamId = kill.victimTeamId;
    if (!victimTeamId || !teamRemainingPlayers.has(victimTeamId)) {
      continue;
    }

    const victimKey =
      kill.victimPlayerId ??
      [victimTeamId, kill.victimName ?? "unknown-victim", kill.eventId].join(":");
    const seenVictims = seenVictimsByTeam.get(victimTeamId) ?? new Set();
    if (seenVictims.has(victimKey)) {
      continue;
    }
    seenVictims.add(victimKey);
    seenVictimsByTeam.set(victimTeamId, seenVictims);

    const remaining = Math.max(
      0,
      Math.trunc(teamRemainingPlayers.get(victimTeamId) ?? 0) - 1,
    );
    teamRemainingPlayers.set(victimTeamId, remaining);

    if (remaining !== 0 || !killerIdentity) {
      continue;
    }

    pushEvent({
      matchId,
      eventId: `${matchId}:TEAM_WIPE:${kill.eventId}`,
      type: "TEAM_WIPE",
      player: {
        id: killerPlayer?.playerId ?? kill.killerPlayerId ?? null,
        name: killerName,
        photoUrl: null,
      },
      team: {
        id: killerTeamId,
        name: textValue(killerTeam?.teamName),
        tag: textValue(killerTeam?.teamTag),
        logoUrl: textValue(killerTeam?.logoUrl),
      },
      timestamp: timestampIso,
    });

    const killerAlivePlayers = Math.max(
      0,
      Math.trunc(numberValue(killerTeam?.alivePlayers) ?? 0),
    );
    if (killerTeamId && killerAlivePlayers === 1) {
      pushEvent({
        matchId,
        eventId: `${matchId}:CLUTCH:${kill.eventId}`,
        type: "CLUTCH",
        player: {
          id: killerPlayer?.playerId ?? kill.killerPlayerId ?? null,
          name: killerName,
          photoUrl: null,
        },
        team: {
          id: killerTeamId,
          name: textValue(killerTeam?.teamName),
          tag: textValue(killerTeam?.teamTag),
          logoUrl: textValue(killerTeam?.logoUrl),
        },
        timestamp: timestampIso,
      });
    }
  }

  return {
    matchId,
    updatedAt: shadowState.updatedAt ?? new Date().toISOString(),
    events: events.slice(-MAX_DIRECT_ACHIEVEMENT_EVENTS),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const largeNumericIdPattern = new RegExp(
  `(\"(?:${LARGE_NUMERIC_ID_KEYS.map(escapeRegExp).join("|")})\"\\s*:\\s*)(-?\\d{16,})(?=\\s*[,}])`,
  "g",
);

function preserveLargeNumericIdentifiers(rawText) {
  if (typeof rawText !== "string" || rawText.length === 0 || !rawText.includes(":")) {
    return rawText;
  }
  return rawText.replace(largeNumericIdPattern, '$1"$2"');
}

function cloneShallow(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 16).map((entry) => (entry && typeof entry === "object" ? { ...entry } : entry));
  }
  if (value && typeof value === "object") {
    return { ...value };
  }
  return value;
}

function hasCircleCoreFields(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }

  return (
    record.CircleArray !== undefined ||
    record.safeZone !== undefined ||
    record.safezone !== undefined ||
    record.blueZone !== undefined ||
    record.nextZone !== undefined ||
    record.nextzone !== undefined ||
    record.whiteZone !== undefined ||
    record.zoneCenter !== undefined ||
    record.zoneRadius !== undefined ||
    record.phase !== undefined ||
    record.phaseIndex !== undefined ||
    record.circlePhase !== undefined ||
    record.CircleIndex !== undefined ||
    record.circleIndex !== undefined ||
    record.CircleStatus !== undefined ||
    record.circleStatus !== undefined ||
    record.Counter !== undefined ||
    record.MaxTime !== undefined
  );
}

function circleCandidateScore(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return -1;
  }

  let score = 0;
  if (Array.isArray(record.CircleArray) && record.CircleArray.length > 0) {
    score += 95;
  }
  if (
    (record.safeZone && typeof record.safeZone === "object") ||
    (record.safezone && typeof record.safezone === "object") ||
    (record.blueZone && typeof record.blueZone === "object")
  ) {
    score += 100;
  }
  if (
    (record.nextZone && typeof record.nextZone === "object") ||
    (record.nextzone && typeof record.nextzone === "object") ||
    (record.whiteZone && typeof record.whiteZone === "object")
  ) {
    score += 80;
  }
  if (
    (record.zoneCenter && typeof record.zoneCenter === "object") ||
    record.zoneRadius !== undefined
  ) {
    score += 70;
  }
  if (record.zone && typeof record.zone === "object") {
    score += 50;
  }
  if (
    record.phase !== undefined ||
    record.phaseIndex !== undefined ||
    record.circlePhase !== undefined ||
    record.CircleIndex !== undefined ||
    record.circleIndex !== undefined
  ) {
    score += 12;
  }
  if (
    record.CircleStatus !== undefined ||
    record.circleStatus !== undefined ||
    record.Counter !== undefined ||
    record.MaxTime !== undefined
  ) {
    score += 6;
  }

  return score;
}

const CIRCLE_LOOKUP_KEYS = [
  "circle",
  "Circle",
  "circleInfo",
  "CircleInfo",
  "zone",
  "zones",
  "map",
  "data",
  "Data",
  "result",
  "Result",
];

const CIRCLE_SNAPSHOT_KEYS = [
  "CircleArray",
  "safeZone",
  "safezone",
  "blueZone",
  "nextZone",
  "nextzone",
  "whiteZone",
  "zoneCenter",
  "zoneRadius",
  "zone",
  "phase",
  "phaseIndex",
  "circlePhase",
  "CircleIndex",
  "circleIndex",
  "CircleStatus",
  "circleStatus",
  "Counter",
  "MaxTime",
];

function projectCirclePayload(record) {
  const source = asObject(record);
  if (!source || Object.keys(source).length === 0) {
    return {};
  }

  const projected = {};
  for (const key of CIRCLE_SNAPSHOT_KEYS) {
    if (source[key] !== undefined) {
      projected[key] = cloneShallow(source[key]);
    }
  }

  return projected;
}

function collectCircleCandidates(payload) {
  const root = asObject(payload);
  if (!root || Object.keys(root).length === 0) {
    return [];
  }

  const allInfo = asObject(root.allinfo ?? root.allInfo);
  const sources = [root];
  if (allInfo && Object.keys(allInfo).length > 0) {
    sources.push(allInfo);
  }
  const candidates = [];

  for (const source of sources) {
    if (hasCircleCoreFields(source)) {
      candidates.push(source);
    }
    for (const key of CIRCLE_LOOKUP_KEYS) {
      const nested = asObject(source[key]);
      if (hasCircleCoreFields(nested)) {
        candidates.push(nested);
      }
    }
  }

  return candidates;
}

function pickRichestCirclePayload(...sources) {
  let best = null;
  let bestScore = -1;

  for (const source of sources) {
    for (const candidate of collectCircleCandidates(source)) {
      const score = circleCandidateScore(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }

  return best ? projectCirclePayload(best) : {};
}

function updateBestCircle(candidate) {
  if (!candidate || Object.keys(candidate).length === 0) {
    return;
  }

  const bestScore = circleCandidateScore(shadowState.bestCircleInfo);
  const nextScore = circleCandidateScore(candidate);
  if (nextScore >= bestScore) {
    shadowState.bestCircleInfo = candidate;
  }
}

function rememberRoutePayload(path, payload) {
  shadowState.rawRoutePayloads[path] = {
    payload: payload ?? null,
    receivedAt: new Date().toISOString(),
  };

  let reduced = pickRichestCirclePayload(payload);
  const flightPath = extractDirectFlightPath(payload);
  const rawRecord = asObject(payload);

  if (Object.keys(reduced).length === 0) {
    if (path === "/totalmessage") {
      const allInfo = asObject(payload?.allinfo ?? payload?.allInfo ?? payload);
      reduced = {
        players: asArray(allInfo.TotalPlayerList).length,
        teams: asArray(allInfo.TeamInfoList).length,
        updatedAt: new Date().toISOString(),
      };
      const allInfoFlightPath = extractDirectFlightPath(allInfo);
      if (allInfoFlightPath) {
        reduced.flightPath = allInfoFlightPath;
      }
    } else if (path === "/settotalplayerlist") {
      reduced = {
        players: asArray(payload?.playerInfoList ?? payload?.TotalPlayerList ?? payload).length,
        updatedAt: new Date().toISOString(),
      };
    } else if (path === "/setteaminfolist" || path === "/getteaminfo") {
      reduced = {
        teams: asArray(payload?.teamInfoList ?? payload?.TeamInfoList ?? payload).length,
        updatedAt: new Date().toISOString(),
      };
    } else if (path === "/setkillinfo") {
      const record = asObject(payload);
      reduced = {
        attacker: record.AttackerName ?? record.attackerName ?? null,
        victim: record.VictimName ?? record.victimName ?? null,
        updatedAt: new Date().toISOString(),
      };
    } else if (path === "/setobservingplayer") {
      const record = asObject(payload);
      reduced = {
        observingPlayer:
          record.PlayerName ??
          record.playerName ??
          record.ObserverName ??
          record.observerName ??
          null,
        updatedAt: new Date().toISOString(),
      };
    } else if (path === "/setisingame") {
      reduced = { isInGame: shadowState.isInGame, updatedAt: new Date().toISOString() };
    } else {
      reduced = { updatedAt: new Date().toISOString() };
    }
  } else {
    updateBestCircle(reduced);
  }

  if (
    (path === "/setcircleinfo" || path === "/setgameglobalinfo") &&
    rawRecord &&
    Object.keys(rawRecord).length > 0
  ) {
    reduced = {
      ...cloneShallow(rawRecord),
      ...reduced,
      updatedAt: reduced.updatedAt ?? new Date().toISOString(),
    };
  }

  if (flightPath) {
    reduced = {
      ...reduced,
      flightPath,
      updatedAt: reduced.updatedAt ?? new Date().toISOString(),
    };
  }

  shadowState.routePayloads[path] = reduced;

  const paths = Object.keys(shadowState.routePayloads);
  if (paths.length <= MAX_ROUTE_PAYLOADS) {
    return;
  }

  const overflow = paths.length - MAX_ROUTE_PAYLOADS;
  for (const stalePath of paths.slice(0, overflow)) {
    delete shadowState.routePayloads[stalePath];
    delete shadowState.rawRoutePayloads[stalePath];
  }
}

function updateShadowState(path, payload) {
  shadowState.updatedAt = new Date().toISOString();
  rememberRoutePayload(path, payload);

  if (path === "/totalmessage") {
    const nextAllInfo = asObject(payload?.allinfo ?? payload?.allInfo ?? payload) ?? {};
    const nextPlayerInfoList = asArray(
      nextAllInfo.TotalPlayerList ?? nextAllInfo.playerInfoList,
    );
    const nextTeamInfoList = mergeDirectTeamInfoList(
      asArray(nextAllInfo.TeamInfoList ?? nextAllInfo.teamInfoList),
      shadowState.teamInfoList,
    );
    shadowState.allInfo = {
      ...nextAllInfo,
      TotalPlayerList: nextPlayerInfoList,
      TeamInfoList: nextTeamInfoList,
    };
    shadowState.playerInfoList = nextPlayerInfoList;
    shadowState.teamInfoList = nextTeamInfoList;
    const totalCircle = pickRichestCirclePayload(shadowState.allInfo);
    if (Object.keys(totalCircle).length > 0) {
      shadowState.circleInfo = totalCircle;
      updateBestCircle(totalCircle);
    }
    return;
  }

  if (path === "/settotalplayerlist") {
    const list = asArray(payload?.playerInfoList ?? payload?.TotalPlayerList ?? payload);
    shadowState.playerInfoList = list;
    shadowState.allInfo = {
      ...shadowState.allInfo,
      TotalPlayerList: list,
    };
    return;
  }

  if (path === "/setteaminfolist") {
    const list = mergeDirectTeamInfoList(
      asArray(payload?.teamInfoList ?? payload?.TeamInfoList ?? payload),
      shadowState.teamInfoList,
    );
    shadowState.teamInfoList = list;
    shadowState.allInfo = {
      ...shadowState.allInfo,
      TeamInfoList: list,
    };
    return;
  }

  if (path === "/setkillinfo") {
    shadowState.killInfoEntries.unshift({
      payload,
      receivedAtMs: Date.now(),
    });
    shadowState.killInfoEntries = shadowState.killInfoEntries.slice(0, 100);
    shadowState.killInfo.unshift(payload);
    shadowState.killInfo = shadowState.killInfo.slice(0, 100);
    return;
  }

  if (path === "/setcircleinfo") {
    const rawCircle = asObject(payload);
    const circle =
      rawCircle && Object.keys(rawCircle).length > 0 && hasCircleCoreFields(rawCircle)
        ? { ...rawCircle }
        : pickRichestCirclePayload(payload);
    shadowState.circleInfo = circle;
    updateBestCircle(circle);
    shadowState.allInfo = {
      ...shadowState.allInfo,
      CircleInfo: circle,
    };
    return;
  }

  if (path === "/setobservingplayer") {
    shadowState.observingPlayer = asObject(payload);
    return;
  }

  if (path === "/setisingame") {
    shadowState.isInGame =
      payload === "InGame" ||
      payload === true ||
      payload?.isInGame === true;
  }

  const inferredCircle = pickRichestCirclePayload(payload);
  if (Object.keys(inferredCircle).length > 0) {
    shadowState.circleInfo = inferredCircle;
    updateBestCircle(inferredCircle);
  }
}

function getObserverMatchId() {
  return MATCH_ID;
}

function buildObserverTelemetryPayload() {
  const selectedCircle = buildMergedCircleInfo();

  return {
    matchId: getObserverMatchId(),
    sessionId: SESSION_ID || null,
    timestamp: Date.now(),
    players: asArray(shadowState.playerInfoList),
    teams: asArray(shadowState.teamInfoList),
    kills: asArray(shadowState.killInfo),
    observer: asObject(shadowState.observingPlayer),
    circle: selectedCircle,
    circleInfo: selectedCircle,
  };
}

function hasMeaningfulObserverTelemetry(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const players = Array.isArray(payload.players) ? payload.players.length : 0;
  const teams = Array.isArray(payload.teams) ? payload.teams.length : 0;
  return players > 0 || teams > 0;
}

async function forwardObserverTelemetry() {
  if (telemetryInFlight) {
    return;
  }

  telemetryInFlight = true;
  try {
    const payload = buildObserverTelemetryPayload();
    if (!payload.matchId) {
      return;
    }
    if (!hasMeaningfulObserverTelemetry(payload)) {
      if (VERBOSE_LOG) {
        console.log("[observer-forward] skipped empty observer snapshot");
      }
      return;
    }
    payload.sequence = nextObserverSequence();

    await postObserverTelemetry(payload);
  } catch (err) {
    console.error(`[observer-forward] Failed to POST ${OBSERVER_TELEMETRY_URL}: ${err?.message || err}`);
  } finally {
    telemetryInFlight = false;
  }
}

function startObserverTelemetryLoop() {
  if (telemetryTimer) {
    return;
  }

  telemetryTimer = setInterval(() => {
    forwardObserverTelemetry().catch((err) => {
      console.error(`[observer-forward] telemetry loop failed: ${err?.message || err}`);
    });
  }, TELEMETRY_INTERVAL_MS);

  forwardObserverTelemetry().catch((err) => {
    console.error(`[observer-forward] initial telemetry send failed: ${err?.message || err}`);
  });
}

const handlers = {
  "/totalmessage": logHandler("totalmessage"),
  "/setcircleinfo": logHandler("setcircleinfo"),
  "/setkillinfo": logHandler("setkillinfo"),
  "/setteaminfolist": logHandler("setteaminfolist"),
  "/settotalplayerlist": logHandler("settotalplayerlist"),
  "/setteambackpackinfo": logHandler("setteambackpackinfo"),
  "/setobservingplayer": logHandler("setobservingplayer"),
};

function runHandler(path, payload) {
  updateShadowState(path, payload);
  const handler = handlers[path];
  if (handler) handler(payload);
  else logHandler(path || "unknown")(payload);
}

function flushPendingHandlers() {
  routeDrainScheduled = false;
  const pendingPaths = Array.from(pendingRoutePayloads.keys()).slice(0, MAX_HANDLER_BATCH_SIZE);

  for (const path of pendingPaths) {
    const rawPayload = pendingRoutePayloads.get(path);
    pendingRoutePayloads.delete(path);
    try {
      const rawBuffer = Buffer.isBuffer(rawPayload)
        ? rawPayload
        : Buffer.from(rawPayload || "");
      const rawText = rawBuffer.toString("utf8");
      let parsed = null;

      if (rawText.trim().length > 0) {
        try {
          parsed = JSON.parse(preserveLargeNumericIdentifiers(rawText));
        } catch {
          parsed = null;
        }
      } else {
        parsed = {};
      }

      const payload = parsed !== null ? parsed : { raw: rawText };
      if (FORWARD_ENABLE) {
        const targetPath = path.startsWith("/") ? path : `/${path}`;
        const targetUrl = `${FORWARD_BASE_URL}${targetPath}`;
        const payloadForForward =
          parsed !== null
            ? parsed
            : rawText.trim().length > 0
              ? { raw: rawText }
              : {};
        forwardToFlask(targetUrl, payloadForForward).catch(() => {
          // Errors are handled inside forwarder; swallow to avoid breaking handlers
        });
      }
      runHandler(path, payload);
    } catch (err) {
      console.error(`[handler] Failed to process ${path}: ${err?.message || err}`);
    }
  }

  if (pendingRoutePayloads.size > 0) {
    processHandlerAsync();
  }
}

function processHandlerAsync(path, rawPayload) {
  if (typeof path === "string") {
    pendingRoutePayloads.set(path, rawPayload);
  }
  if (routeDrainScheduled) {
    return;
  }
  routeDrainScheduled = true;
  setImmediate(flushPendingHandlers);
}

// Register explicit POST routes so legacy callers still work
Object.keys(handlers).forEach((route) => {
  app.post(route, (req, res) => {
    res.json({ ok: true });
    processHandlerAsync(route, req.rawBody);
  });
});

// Catch-all POST handler (keeps compatibility for any other event)
// Use a regex route to avoid path-to-regexp errors on "*"
app.post(/^\/.*/, (req, res) => {
  res.json({ ok: true });
  processHandlerAsync(req.path, req.rawBody);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    forwardEnabled: FORWARD_ENABLE,
    forwardBaseUrl: FORWARD_BASE_URL,
  });
});

app.get("/getallinfo", (req, res) => {
  res.json({ allinfo: shadowState.allInfo });
});

app.get("/gettotalplayerlist", (req, res) => {
  res.json({ playerInfoList: shadowState.playerInfoList });
});

app.get("/getteaminfolist", (req, res) => {
  res.json({ teamInfoList: shadowState.teamInfoList });
});

app.get("/getteaminfo", (req, res) => {
  res.json({ teamInfoList: shadowState.teamInfoList });
});

app.get("/getkillinfo", (req, res) => {
  res.json({ killInfo: shadowState.killInfo });
});

app.get("/getcircleinfo", (req, res) => {
  res.json(buildMergedCircleInfo());
});

app.get("/getgameglobalinfo", (req, res) => {
  res.json({
    gameGlobalInfo: shadowState.routePayloads["/setgameglobalinfo"] ?? {},
  });
});

app.get("/getroutepayloads", (req, res) => {
  res.json({ routePayloads: shadowState.routePayloads });
});

app.get("/debug/shadow-state", (req, res) => {
  res.json({
    activeMatchId: getObserverMatchId() || null,
    updatedAt: shadowState.updatedAt,
    isInGame: shadowState.isInGame,
    allInfo: shadowState.allInfo,
    playerInfoList: shadowState.playerInfoList,
    teamInfoList: shadowState.teamInfoList,
    killInfo: shadowState.killInfo,
    circleInfo: shadowState.circleInfo,
    bestCircleInfo: shadowState.bestCircleInfo,
    observingPlayer: shadowState.observingPlayer,
    routePayloads: shadowState.routePayloads,
    rawRoutePayloads: shadowState.rawRoutePayloads,
  });
});

app.get("/getobservingplayer", (req, res) => {
  res.json({ observingPlayer: shadowState.observingPlayer });
});

app.get("/isingame", (req, res) => {
  res.json({ isInGame: shadowState.isInGame });
});

app.get("/widget/leaderboard", (req, res) => {
  const requestedMatchId = textValue(req.query?.matchId);
  const activeMatchId = getObserverMatchId();
  if (requestedMatchId && activeMatchId && requestedMatchId !== activeMatchId) {
    res.status(409).json({
      message: `Observer feed is bound to match ${activeMatchId}.`,
      activeMatchId,
      requestedMatchId,
    });
    return;
  }

  res.json(buildDirectLeaderboardPayload(requestedMatchId));
});

app.get("/widget/map-overlay", (req, res) => {
  const requestedMatchId = textValue(req.query?.matchId);
  const activeMatchId = getObserverMatchId();
  if (requestedMatchId && activeMatchId && requestedMatchId !== activeMatchId) {
    res.status(409).json({
      message: `Observer feed is bound to match ${activeMatchId}.`,
      activeMatchId,
      requestedMatchId,
    });
    return;
  }

  res.json(buildDirectMapOverlayPayload(requestedMatchId));
});

app.get("/widget/achievements", (req, res) => {
  const requestedMatchId = textValue(req.query?.matchId);
  const activeMatchId = getObserverMatchId();
  if (requestedMatchId && activeMatchId && requestedMatchId !== activeMatchId) {
    res.status(409).json({
      message: `Observer feed is bound to match ${activeMatchId}.`,
      activeMatchId,
      requestedMatchId,
    });
    return;
  }

  res.json(buildDirectAchievementPayload(requestedMatchId));
});

app.listen(PORT, () => {
  console.log(`ObTools server listening on http://127.0.0.1:${PORT}`);
  console.log(`Forwarding -> ${FORWARD_ENABLE ? FORWARD_BASE_URL : "disabled"}`);
  console.log(
    `Observer telemetry -> ${OBSERVER_FORWARD_ENABLE ? OBSERVER_TELEMETRY_URL : "disabled"}`
  );
  if (OBSERVER_FORWARD_ENABLE) {
    console.log(
      `Observer feed match=${MATCH_ID || "missing"} session=${SESSION_ID || "missing"} auth=${OBSERVER_FEED_TOKEN ? "enabled" : "disabled"}`
    );
  }
  if (OBSERVER_FORWARD_ENABLE) {
    startObserverTelemetryLoop();
  }
});
