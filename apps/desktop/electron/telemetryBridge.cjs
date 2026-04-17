const axios = require("axios");
const { randomUUID } = require("node:crypto");
const { getProcessDefaultApiBase } = require("./apiBaseDefaults.cjs");

function normalizeHttpBaseUrl(value, fallback, options = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
    const defaultLocalPort = options.defaultLocalPort
      ? String(options.defaultLocalPort)
      : "";
    if (
      defaultLocalPort &&
      !parsed.port &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    ) {
      parsed.port = defaultLocalPort;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function normalizeMatchStatusValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "DRAFT") {
    return "READY";
  }
  return normalized;
}

function isFinalizingMatchStatus(value) {
  const normalized = normalizeMatchStatusValue(value);
  return normalized === "FINISH_PENDING" || normalized === "ENDED";
}

function isLockedMatchStatus(value) {
  return normalizeMatchStatusValue(value) === "FINISHED";
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

const DEFAULT_SHADOW_BASE_URL = normalizeHttpBaseUrl(
  process.env.SHADOWTRACKER_TELEMETRY_BASE_URL,
  "http://127.0.0.1:10086",
  { defaultLocalPort: 10086 },
);
const DEFAULT_POLL_INTERVAL_MS = 1000;
const CONTROL_STATUS_POLL_INTERVAL_MS = 5000;
const MAX_PENDING_EVENTS = 750;
const QUEUE_FLUSH_BATCH_SIZE = 25;
const RETRY_BACKOFF_STEPS_MS = [1000, 2000, 5000, 10000];

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractArray(payload, keys) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return record[key];
    }
  }

  return [];
}

function extractRecord(payload, keys) {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (nested) {
      return nested;
    }
  }

  return record;
}

function hasCircleSignal(circle) {
  return Boolean(
    circle &&
      (circle.gameTime !== null ||
        circle.circleIndex !== null ||
        (typeof circle.circleStatus === "string" &&
          circle.circleStatus.trim().length > 0)),
  );
}

function hasCircleFields(record) {
  if (!record) {
    return false;
  }

  return (
    record.GameTime !== undefined ||
    record.gameTime !== undefined ||
    record.CircleIndex !== undefined ||
    record.circleIndex !== undefined ||
    record.phase !== undefined ||
    record.phaseIndex !== undefined ||
    record.zonePhaseIndex !== undefined ||
    record.CircleStatus !== undefined ||
    record.circleStatus !== undefined
  );
}

function normalizeCircleInfo(payload) {
  const candidates = [];
  const root = asRecord(payload);

  if (root) {
    candidates.push(root);

    for (const key of [
      "circleInfo",
      "CircleInfo",
      "circle",
      "Circle",
      "data",
      "Data",
      "result",
      "Result",
    ]) {
      const nested = asRecord(root[key]);
      if (nested) {
        candidates.push(nested);
      }
    }

    for (const key of [
      "circleInfoList",
      "CircleInfoList",
      "circles",
      "Circles",
    ]) {
      if (!Array.isArray(root[key]) || root[key].length === 0) {
        continue;
      }
      const firstEntry = asRecord(root[key][0]);
      if (firstEntry) {
        candidates.push(firstEntry);
      }
    }
  }

  for (const candidate of candidates) {
    if (!hasCircleFields(candidate)) {
      continue;
    }

    const circleStatus = candidate.CircleStatus ?? candidate.circleStatus;
    return {
      gameTime: toNumber(candidate.GameTime ?? candidate.gameTime),
      circleIndex: toNumber(
        candidate.CircleIndex ??
          candidate.circleIndex ??
          candidate.phase ??
          candidate.phaseIndex ??
          candidate.zonePhaseIndex,
      ),
      circleStatus:
        circleStatus === undefined || circleStatus === null
          ? null
          : String(circleStatus),
    };
  }

  return {
    gameTime: null,
    circleIndex: null,
    circleStatus: null,
  };
}

function buildCircleZoneFromArrayEntry(entry) {
  const root = asRecord(entry);
  if (!root) {
    return null;
  }

  const x = toNumber(root.x ?? root.X ?? root.cx ?? root.centerX);
  const y = toNumber(root.y ?? root.Y ?? root.cy ?? root.centerY);
  const radius = toNumber(root.r ?? root.R ?? root.radius ?? root.Radius ?? root.Size);
  if (x === null || y === null || radius === null) {
    return null;
  }

  return { x, y, r: radius };
}

function mergeCirclePayload(circlePayload, gameGlobalInfoPayload) {
  const circleRoot = asRecord(circlePayload);
  const gameGlobalRoot = asRecord(gameGlobalInfoPayload);
  if (!circleRoot && !gameGlobalRoot) {
    return null;
  }

  const merged = {
    ...(gameGlobalRoot || {}),
    ...(circleRoot || {}),
  };
  const circleArray = Array.isArray(gameGlobalRoot?.CircleArray)
    ? gameGlobalRoot.CircleArray
    : Array.isArray(merged.CircleArray)
      ? merged.CircleArray
      : [];
  const circleIndex = normalizeCircleInfo(circleRoot || merged).circleIndex;
  const arrayIndex =
    circleIndex !== null ? Math.max(0, Math.trunc(circleIndex) - 1) : 0;

  if (circleArray.length > 0 && merged.CircleArray === undefined) {
    merged.CircleArray = circleArray;
  }

  if (merged.safeZone === undefined) {
    const safeZone = buildCircleZoneFromArrayEntry(circleArray[arrayIndex]);
    if (safeZone) {
      merged.safeZone = safeZone;
    }
  }

  if (merged.nextZone === undefined) {
    const nextZone = buildCircleZoneFromArrayEntry(circleArray[arrayIndex + 1]);
    if (nextZone) {
      merged.nextZone = nextZone;
    }
  }

  return merged;
}

function countAliveTeams(teams) {
  if (!Array.isArray(teams) || teams.length === 0) {
    return null;
  }

  let observedTeams = 0;
  let aliveTeams = 0;

  for (const team of teams) {
    const liveMemberNum = toNumber(
      team?.liveMemberNum ??
        team?.LiveMemberNum ??
        team?.aliveMemberNum ??
        team?.AliveMemberNum ??
        team?.alivePlayers,
    );

    if (liveMemberNum === null) {
      continue;
    }

    observedTeams += 1;
    if (liveMemberNum > 0) {
      aliveTeams += 1;
    }
  }

  return observedTeams > 0 ? aliveTeams : null;
}

function normalizeTextValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function normalizeBooleanValue(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string" && value.trim()) {
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

function extractTransportPosition(record) {
  const candidate =
    asRecord(record?.position) ??
    asRecord(record?.pos) ??
    asRecord(record?.location) ??
    asRecord(record);
  if (!candidate) {
    return null;
  }
  const x = toNumber(
    candidate.x ?? candidate.X ?? candidate.lon ?? candidate.longitude,
  );
  const y = toNumber(
    candidate.y ?? candidate.Y ?? candidate.lat ?? candidate.latitude,
  );
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
}

function normalizePosition(rawX, rawY, map) {
  const mapSizes = {
    ERANGEL: 816000,
    MIRAMAR: 816000,
    LIVIK: 409600,
    SANHOK: 409600,
    RONDO: 816000,
  };

  const size = mapSizes[String(map || "").toUpperCase()] || 816000;

  const x = rawX / size;
  const y = 1 - (rawY / size);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    console.warn("[LAUNCHER][INVALID_POSITION]", { rawX, rawY, map, size });
    return null;
  }

  return { x, y };
}

function extractTransportMap(snapshot) {
  const candidates = [
    snapshot?.allInfo,
    snapshot?.circlePayload,
    Array.isArray(snapshot?.players) ? asRecord(snapshot.players[0]) : null,
    asRecord(snapshot?.observer),
  ];

  for (const candidate of candidates) {
    const rawMap = normalizeTextValue(
      candidate?.mapName ??
        candidate?.MapName ??
        candidate?.map ??
        candidate?.Map ??
        candidate?.mapId ??
        candidate?.MapId ??
        candidate?.MapNameStr,
    );
    if (!rawMap) {
      continue;
    }

    const normalized = rawMap.toUpperCase();
    if (["ERANGEL", "ERANGEL8X8", "ERANGEL_MAIN", "BALTIC_MAIN"].includes(normalized)) {
      return "ERANGEL";
    }
    if (["MIRAMAR", "MIRAMAR8X8", "DESERT_MAIN"].includes(normalized)) {
      return "MIRAMAR";
    }
    if (["LIVIK", "LIVIK4X4"].includes(normalized)) {
      return "LIVIK";
    }
    if (["SANHOK", "SANHOK4X4", "SAVAGE_MAIN"].includes(normalized)) {
      return "SANHOK";
    }
    if (["RONDO", "RONDO8X8", "RONDO_MAIN"].includes(normalized)) {
      return "RONDO";
    }

    return normalized;
  }

  return null;
}

function isTransportPlayerAlive(record) {
  const explicitAlive = normalizeBooleanValue(
    record?.isAlive ?? record?.IsAlive ?? record?.alive ?? record?.Alive ?? record?.bAlive,
  );
  const explicitDead = normalizeBooleanValue(
    record?.hasDied ??
      record?.HasDied ??
      record?.bHasDied ??
      record?.dead ??
      record?.isDead ??
      record?.eliminated,
  );
  if (explicitAlive === false || explicitDead === true) {
    return false;
  }

  const stateValue =
    record?.liveState ??
    record?.LiveState ??
    record?.live_state ??
    record?.state ??
    record?.State ??
    record?.status ??
    record?.Status;
  const numeric = toNumber(stateValue);
  if (numeric !== null) {
    if (numeric === 1 || numeric === 5) {
      return false;
    }
    if (numeric === 0 || numeric === 3 || numeric === 4) {
      return true;
    }
  }
  const label = normalizeTextValue(stateValue)?.toLowerCase();
  if (["dead", "eliminated"].includes(label)) {
    return false;
  }
  if (["alive", "live", "running", "down", "knocked", "dbno"].includes(label)) {
    return true;
  }

  const health = toNumber(
    record?.health ??
      record?.Health ??
      record?.hp ??
      record?.HP ??
      record?.currentHealth ??
      record?.CurrentHealth,
  );
  if (health !== null) {
    return health > 0;
  }

  if (explicitAlive === true || explicitDead === false) {
    return true;
  }

  return true;
}

function isTransportPlayerKnocked(record) {
  const raw =
    record?.isKnocked ??
    record?.IsKnocked ??
    record?.knocked ??
    record?.down ??
    record?.isDown ??
    record?.isDowned;
  const explicit = normalizeBooleanValue(raw);
  if (explicit !== null) {
    return explicit;
  }
  const stateValue =
    record?.liveState ??
    record?.LiveState ??
    record?.state ??
    record?.State ??
    record?.status ??
    record?.Status;
  const numeric = toNumber(stateValue);
  if (numeric !== null) {
    return numeric === 4;
  }
  const label = normalizeTextValue(stateValue)?.toLowerCase();
  return label === "knocked" || label === "down" || label === "dbno";
}

function normalizeTransportPlayers(players, map, timestamp) {
  if (!Array.isArray(players) || players.length === 0) {
    return [];
  }

  const incoming = [];
  const seen = new Set();

  for (const player of players) {
    const record = asRecord(player);
    if (!record) {
      continue;
    }

    const pubgAccountId = normalizeTextValue(
      record.playerOpenId ??
        record.playerOpenID ??
        record.PlayerOpenId ??
        record.PlayerOpenID ??
        record.openId ??
        record.OpenId ??
        record.openid,
    );
    const externalPlayerId = normalizeTextValue(
      record.externalPlayerId ?? record.externalId,
    );
    const playerId =
      normalizeTextValue(
        record.playerId ??
          record.id ??
          record.playerID ??
          record.PlayerId ??
          record.PlayerID,
      ) ??
      externalPlayerId ??
      pubgAccountId;
    const teamId = normalizeTextValue(
      record.teamId ??
        record.teamID ??
        record.TeamId ??
        record.TeamID ??
        record.team_id,
    );

    const key = pubgAccountId ?? externalPlayerId ?? playerId;
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    const isAlive = isTransportPlayerAlive(record);
    incoming.push({
      id: playerId,
      teamId,
      isAlive,
      isKnocked: isAlive ? isTransportPlayerKnocked(record) : false,
      kills: Math.max(
        0,
        Math.trunc(
          toNumber(
            record.kills ??
              record.killNum ??
              record.killCount ??
              record.killnum ??
              record.kill_count,
          ) ?? 0,
        ),
      ),
      position: extractTransportPosition(record),
    });
  }

  return incoming
    .map((p) => {
      console.log("[TRACE][LAUNCHER][RAW]", {
        playerId: p.id,
        rawX: p.position?.x,
        rawY: p.position?.y,
        timestamp: Date.now(),
      });

      const normalized = normalizePosition(p.position?.x, p.position?.y, map);
      if (!normalized) {
        return null;
      }

      const normalizedX = normalized.x;
      const normalizedY = normalized.y;
      console.log("[TRACE][LAUNCHER][OUT]", {
        playerId: p.id,
        normX: normalizedX,
        normY: normalizedY,
        timestamp,
      });

      return {
        id: p.id,
        teamId: p.teamId,
        isAlive: !!p.isAlive,
        isKnocked: !!p.isKnocked,
        kills: p.kills ?? 0,
        position: {
          x: normalizedX,
          y: normalizedY,
        },
      };
    })
    .filter(Boolean);
}

function normalizeTransportTeams(teams, players) {
  const normalizedPlayers = Array.isArray(players) ? players : [];
  const playersByTeam = new Map();
  for (const player of normalizedPlayers) {
    const teamId = normalizeTextValue(player?.teamId);
    if (!teamId) {
      continue;
    }
    const bucket = playersByTeam.get(teamId) ?? [];
    bucket.push(player);
    playersByTeam.set(teamId, bucket);
  }

  const normalizedTeams = [];
  const seen = new Set();
  const sourceTeams = Array.isArray(teams) ? teams : [];

  for (const team of sourceTeams) {
    const record = asRecord(team);
    if (!record) {
      continue;
    }

    const teamId = normalizeTextValue(
      record.teamId ??
        record.teamID ??
        record.TeamId ??
        record.TeamID ??
        record.team ??
        record.id,
    );
    if (!teamId || seen.has(teamId)) {
      continue;
    }

    seen.add(teamId);
    const teamPlayers = playersByTeam.get(teamId) ?? [];
    const alivePlayers =
      toNumber(
        record.alivePlayers ??
          record.aliveCount ??
          record.remainingPlayers ??
          record.remainPlayers ??
          record.remainPlayerNum ??
          record.liveMemberNum,
      ) ?? teamPlayers.filter((player) => player?.isAlive === true).length;
    const totalPlayers =
      toNumber(
        record.totalPlayers ??
          record.totalPlayerCount ??
          record.playerCount ??
          record.memberNum ??
          record.playerNum,
      ) ?? teamPlayers.length;
    const eliminatedFlag = normalizeBooleanValue(record.eliminated);
    const slot = toNumber(
      record.slot ??
        record.slotNumber ??
        record.teamNumber ??
        record.teamNo ??
        record.order,
    );

    normalizedTeams.push({
      teamId,
      slot: slot === null ? null : Math.trunc(slot),
      alivePlayers: Math.max(0, Math.trunc(alivePlayers)),
      totalPlayers: Math.max(0, Math.trunc(totalPlayers)),
      eliminated:
        eliminatedFlag === null ? Math.trunc(alivePlayers) <= 0 : eliminatedFlag,
    });
  }

  for (const [teamId, teamPlayers] of playersByTeam.entries()) {
    if (seen.has(teamId)) {
      continue;
    }
    normalizedTeams.push({
      teamId,
      slot: null,
      alivePlayers: teamPlayers.filter((player) => player?.isAlive === true).length,
      totalPlayers: teamPlayers.length,
      eliminated: teamPlayers.every((player) => player?.isAlive !== true),
    });
  }

  return normalizedTeams.sort((left, right) => {
    const leftSlot = left.slot ?? Number.MAX_SAFE_INTEGER;
    const rightSlot = right.slot ?? Number.MAX_SAFE_INTEGER;
    if (leftSlot !== rightSlot) {
      return leftSlot - rightSlot;
    }
    return String(left.teamId).localeCompare(String(right.teamId));
  });
}

function detectMatchPhase({
  gameTime,
  aliveTeams,
  circleIndex,
  circleStatus,
  previousPhase,
}) {
  if (gameTime !== null && gameTime < 30) {
    return "plane";
  }

  if (gameTime !== null && gameTime < 90) {
    return "parachuting";
  }

  const hasCircleSignal =
    gameTime !== null ||
    circleIndex !== null ||
    (typeof circleStatus === "string" && circleStatus.trim().length > 0);

  if (!hasCircleSignal) {
    return previousPhase ?? "plane";
  }

  if (aliveTeams !== null && aliveTeams > 5) {
    return "combat";
  }

  if (aliveTeams !== null && aliveTeams <= 5 && aliveTeams > 1) {
    return "endgame";
  }

  if (aliveTeams === 1) {
    return "endgame";
  }

  return previousPhase ?? "combat";
}

function getErrorStatus(error) {
  const status = Number(error?.response?.status);
  return Number.isFinite(status) ? status : null;
}

function getErrorMessage(error, fallback = "Unknown error") {
  const responseData = error?.response?.data;
  if (Array.isArray(responseData?.message) && responseData.message.length > 0) {
    return responseData.message.map((item) => String(item)).join(", ");
  }
  if (typeof responseData?.message === "string" && responseData.message.trim()) {
    return responseData.message.trim();
  }
  if (typeof responseData?.error === "string" && responseData.error.trim()) {
    return responseData.error.trim();
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function isUnauthorizedBackendError(error) {
  if (getErrorStatus(error) === 401) {
    return true;
  }

  return String(error?.code || "").trim() === "ARENZYRA_AUTH_UNAUTHORIZED";
}

function isNetworkError(error) {
  const code = String(error?.code || "")
    .trim()
    .toUpperCase();
  if (
    [
      "ECONNABORTED",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ETIMEDOUT",
      "ERR_NETWORK",
    ].includes(code)
  ) {
    return true;
  }

  return false;
}

function isRetryableBackendError(error) {
  const status = getErrorStatus(error);
  if (isNetworkError(error)) {
    return true;
  }

  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function buildErrorWithStatus(message, status) {
  const error = new Error(message);
  if (Number.isFinite(status)) {
    error.status = status;
  }
  return error;
}

function classifyQueueReason(error) {
  const status = getErrorStatus(error);
  if (status === 401) {
    return "token expired";
  }
  if (isNetworkError(error)) {
    return "network error";
  }
  if (status !== null) {
    return `backend ${status}`;
  }
  return getErrorMessage(error, "request failed");
}

async function requestShadowEndpoint(client, paths) {
  let lastError = null;
  const candidates = Array.isArray(paths) ? paths : [paths];

  for (let index = 0; index < candidates.length; index += 1) {
    const path = candidates[index];
    const hasFallbackPath = index < candidates.length - 1;
    for (const attempt of [
      { method: "get", retryStatuses: new Set([404, 405]) },
      { method: "post", retryStatuses: new Set([404]) },
    ]) {
      try {
        return await client.request({
          url: path,
          method: attempt.method,
        });
      } catch (error) {
        lastError = error;
        const status = error?.response?.status;
        const code = error?.code;
        if (hasFallbackPath && code === "ECONNABORTED") {
          break;
        }
        if (!status || !attempt.retryStatuses.has(status)) {
          throw error;
        }
      }
    }
  }

  throw lastError || new Error("ShadowTracker request failed");
}

async function getOptional(client, paths, { onError } = {}) {
  try {
    return await requestShadowEndpoint(
      client,
      Array.isArray(paths) ? paths : [paths],
    );
  } catch (error) {
    const status = error?.response?.status;
    if (status === 404 || status === 405) {
      return null;
    }
    if (typeof onError === "function") {
      onError(error);
    }
    return null;
  }
}

function createTelemetryBridge({
  logger = null,
  log = () => {},
  onSnapshot = null,
  refreshAuth = null,
  onUnauthorized = null,
  shadowBaseUrl = null,
} = {}) {
  const telemetryLogger =
    logger &&
    typeof logger.info === "function" &&
    typeof logger.warn === "function" &&
    typeof logger.error === "function"
      ? logger
      : null;
  const logInfo = (message, meta) => {
    if (telemetryLogger) {
      telemetryLogger.info(message, meta);
      return;
    }

    if (typeof meta === "undefined") {
      log(message);
      return;
    }

    log(message, meta);
  };
  const logWarn = (message, meta) => {
    if (telemetryLogger) {
      telemetryLogger.warn(message, meta);
      return;
    }

    if (typeof meta === "undefined") {
      log(message);
      return;
    }

    log(message, meta);
  };
  const logError = (message, meta) => {
    if (telemetryLogger) {
      telemetryLogger.error(message, meta);
      return;
    }

    if (typeof meta === "undefined") {
      log(message);
      return;
    }

    log(message, meta);
  };
  let pollTimer = null;
  let retryTimer = null;
  let running = false;
  let pollInFlight = false;
  let flushInFlight = false;
  let backendBaseUrl = "";
  let backendToken = "";
  let backendRefreshToken = "";
  let matchId = "";
  let currentSessionId = "";
  let currentSequence = 0;
  let sequenceMatchId = "";
  let telemetryEnabled = false;
  let refreshAuthPromise = null;
  let packetTimes = [];
  let pendingEvents = [];
  let retryAttempt = 0;
  let lastControlStatusCheckAt = 0;
  let lastLoggedShadowError = "";
  let lastLoggedShadowErrorAt = 0;
  let backendRetryMode = false;
  let finishTransitionLogged = false;

  let currentShadowBaseUrl = normalizeHttpBaseUrl(
    shadowBaseUrl,
    DEFAULT_SHADOW_BASE_URL,
    { defaultLocalPort: 10086 },
  );

  const shadowClient = axios.create({
    baseURL: currentShadowBaseUrl,
    timeout: 5000,
  });
  let backendClient = null;

  const state = {
    running: false,
    matchId: null,
    sessionId: null,
    packetsPerSecond: 0,
    lastPacketTime: null,
    connectionStatus: "stopped",
    phase: null,
    gameTime: null,
    aliveTeams: null,
    circleIndex: null,
    circleStatus: null,
    totalPackets: 0,
    lastError: null,
    connectedToBackend: false,
    queueSize: 0,
    lastSuccessAt: null,
    matchStatus: null,
    isLocked: false,
    isFinalizing: false,
    resultFinalized: false,
    finalizationStartedAt: null,
    finalizationDurationMs: null,
    transportConnected: false,
    packetsReceiving: false,
    telemetryAccepted: false,
    telemetryActive: false,
    lastTransportAt: null,
    lastAcceptedAt: null,
    lastIgnoredAt: null,
    lastIgnoredReason: null,
  };

  const refreshPacketsPerSecond = () => {
    const now = Date.now();
    packetTimes = packetTimes.filter((ts) => now - ts < 1000);
    state.packetsPerSecond = packetTimes.length;
  };

  const setState = (patch) => {
    Object.assign(state, patch);
    state.queueSize = pendingEvents.length;
  };

  const summarizeTransportPayload = (payload) => ({
    players: Array.isArray(payload?.players) ? payload.players.length : 0,
    teams: Array.isArray(payload?.teams) ? payload.teams.length : 0,
    zonePhase: payload?.zonePhase ?? null,
  });

  const buildTransportLogMeta = (event, extra = {}) => ({
    matchId: event?.payload?.matchId ?? matchId ?? null,
    sessionId: event?.payload?.sessionId ?? currentSessionId ?? null,
    sequence: event?.payload?.sequence ?? null,
    timestamp: event?.payload?.timestamp ?? null,
    payloadSummary: summarizeTransportPayload(event?.payload ?? null),
    ...extra,
  });

  const getStatus = () => {
    refreshPacketsPerSecond();
    if (state.isFinalizing === true && state.finalizationStartedAt) {
      const startedAtMs = Date.parse(state.finalizationStartedAt);
      state.finalizationDurationMs = Number.isFinite(startedAtMs)
        ? Math.max(0, Date.now() - startedAtMs)
        : null;
    }
    return {
      ...state,
      queueSize: pendingEvents.length,
      shadowBaseUrl: currentShadowBaseUrl,
    };
  };

  const setShadowBaseUrl = (value) => {
    const normalized = normalizeHttpBaseUrl(
      value,
      currentShadowBaseUrl || DEFAULT_SHADOW_BASE_URL,
      { defaultLocalPort: 10086 },
    );
    currentShadowBaseUrl = normalized;
    shadowClient.defaults.baseURL = normalized;
    return normalized;
  };

  const clearPollTimer = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const clearRetryTimer = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const setLifecycleState = (matchStatus, options = {}) => {
    const normalizedMatchStatus = normalizeMatchStatusValue(matchStatus);
    const nextIsFinalizing =
      options.isFinalizing === true || isFinalizingMatchStatus(normalizedMatchStatus);
    const nextIsLocked =
      options.isLocked === true || isLockedMatchStatus(normalizedMatchStatus);
    const normalizedFinalizationStartedAt = normalizeIsoTimestamp(
      options.finalizationStartedAt,
    );
    const normalizedFinalizationDurationMs =
      typeof options.finalizationDurationMs === "number" &&
      Number.isFinite(options.finalizationDurationMs)
        ? Math.max(0, Number(options.finalizationDurationMs))
        : normalizedFinalizationStartedAt && nextIsFinalizing
          ? Math.max(0, Date.now() - Date.parse(normalizedFinalizationStartedAt))
          : null;

    setState({
      matchStatus: normalizedMatchStatus,
      isLocked: nextIsLocked,
      isFinalizing: nextIsFinalizing,
      finalizationStartedAt:
        normalizedFinalizationStartedAt ??
        (nextIsFinalizing || nextIsLocked ? state.finalizationStartedAt : null),
      finalizationDurationMs:
        normalizedFinalizationDurationMs ??
        (nextIsFinalizing || nextIsLocked ? state.finalizationDurationMs : null),
    });

    return {
      matchStatus: normalizedMatchStatus,
      isLocked: nextIsLocked,
      isFinalizing: nextIsFinalizing,
      finalizationStartedAt:
        normalizedFinalizationStartedAt ??
        (nextIsFinalizing || nextIsLocked ? state.finalizationStartedAt : null),
      finalizationDurationMs:
        normalizedFinalizationDurationMs ??
        (nextIsFinalizing || nextIsLocked ? state.finalizationDurationMs : null),
    };
  };

  const ensureTransportSequenceMatch = ({
    reason = "match-load",
    nextMatchId = matchId || null,
    nextSessionId = currentSessionId || null,
  } = {}) => {
    const normalizedMatchId =
      typeof nextMatchId === "string" ? nextMatchId.trim() : "";
    if (!normalizedMatchId || sequenceMatchId === normalizedMatchId) {
      return;
    }

    sequenceMatchId = normalizedMatchId;
    currentSequence = 0;
    logInfo("transport-sequence-reset", {
      matchId: normalizedMatchId,
      sessionId: nextSessionId,
      sequence: currentSequence,
      payloadSummary: null,
      reason,
    });
  };

  const nextTransportSequence = () => {
    ensureTransportSequenceMatch();
    currentSequence += 1;
    return currentSequence;
  };

  const logShadowFailure = (message) => {
    const now = Date.now();
    if (
      message !== lastLoggedShadowError ||
      now - lastLoggedShadowErrorAt >= 5000
    ) {
      logWarn("ShadowTracker read failed, will retry", {
        error: message,
      });
      lastLoggedShadowError = message;
      lastLoggedShadowErrorAt = now;
    }
  };

  const markBackendRetryMode = (message) => {
    if (!backendRetryMode) {
      backendRetryMode = true;
      logWarn("Backend unreachable, entering retry mode", {
        error: message,
      });
    }

    setState({
      connectedToBackend: false,
      connectionStatus: "retrying",
      lastError: message,
    });
  };

  const markBackendReconnected = () => {
    if (backendRetryMode) {
      backendRetryMode = false;
      logInfo("Reconnected, flushing queue", {
        queueSize: pendingEvents.length,
      });
    }
  };

  const resolveRetryDelayMs = () =>
    RETRY_BACKOFF_STEPS_MS[
      Math.min(retryAttempt, RETRY_BACKOFF_STEPS_MS.length - 1)
    ];

  const scheduleQueueRetry = (delayMs = null) => {
    clearRetryTimer();
    if (!running || !telemetryEnabled || pendingEvents.length === 0) {
      return;
    }

    const nextDelay =
      typeof delayMs === "number" && delayMs >= 0
        ? delayMs
        : resolveRetryDelayMs();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flushQueue("retry");
    }, nextDelay);
  };

  const updateBackendClient = () => {
    if (!backendBaseUrl || !backendToken) {
      backendClient = null;
      return false;
    }

    backendClient = axios.create({
      baseURL: backendBaseUrl,
      timeout: 5000,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${backendToken}`,
      },
    });
    return true;
  };

  const updateAuth = ({ apiBase, token, refreshToken } = {}) => {
    backendBaseUrl = normalizeHttpBaseUrl(
      apiBase || backendBaseUrl,
      getProcessDefaultApiBase(),
    );
    backendToken = String(token || backendToken || "").trim();
    backendRefreshToken = String(refreshToken || backendRefreshToken || "").trim();
    return updateBackendClient();
  };

  const refreshBackendAuth = async (reason = "token expired") => {
    if (refreshAuthPromise) {
      return refreshAuthPromise;
    }

    if (typeof refreshAuth !== "function") {
      throw buildErrorWithStatus(
        "Telemetry auth refresh is unavailable.",
        401,
      );
    }

    if (!backendRefreshToken) {
      throw buildErrorWithStatus(
        "Telemetry refresh token is unavailable.",
        401,
      );
    }

    refreshAuthPromise = Promise.resolve()
      .then(() =>
        refreshAuth({
          apiBase: backendBaseUrl,
          token: backendToken,
          refreshToken: backendRefreshToken,
          matchId,
          sessionId: currentSessionId,
          reason,
        }),
      )
      .then((bundle) => {
        if (!bundle) {
          throw buildErrorWithStatus(
            "Telemetry auth refresh returned no session.",
            401,
          );
        }

        updateAuth({
          apiBase: bundle.apiBase || backendBaseUrl,
          token: bundle.accessToken || bundle.token || backendToken,
          refreshToken: bundle.refreshToken || backendRefreshToken,
        });
        logInfo("Token refreshed", {
          matchId,
          sessionId: currentSessionId,
        });
        return bundle;
      })
      .finally(() => {
        refreshAuthPromise = null;
      });

    return refreshAuthPromise;
  };

  const handleUnauthorized = async (error) => {
    const message = getErrorMessage(
      error,
      "Telemetry authorization failed.",
    );
    logWarn("Authorization failed", {
      error: message,
      matchId,
      sessionId: currentSessionId,
    });
    setState({
      connectedToBackend: false,
      connectionStatus: "unauthorized",
      lastError: message,
    });

    if (typeof onUnauthorized === "function") {
      try {
        await onUnauthorized({
          error,
          matchId,
          sessionId: currentSessionId,
        });
      } catch (callbackError) {
        logError("Unauthorized callback failed", {
          error: callbackError,
        });
      }
    }

    stop("unauthorized");
  };

  const normalizeControlStatus = (value) => {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().toUpperCase();
    return normalized || null;
  };

  const normalizeLifecyclePayload = (payload) => {
    const record = asRecord(payload) || {};
    const controlStatus = normalizeControlStatus(
      record.status ?? record.controlStatus,
    );
    const matchStatus = normalizeMatchStatusValue(
      record.matchStatus ?? record.lifecycleStatus ?? record.matchLifecycleStatus,
    );
    const telemetry = asRecord(record.telemetry) || {};
    const resultFinalized = record.resultFinalized === true;
    return {
      controlStatus,
      matchStatus,
      resultFinalized,
      isLocked:
        record.isLocked === true || isLockedMatchStatus(matchStatus) === true,
      isFinalizing:
        (resultFinalized !== true &&
          record.isFinalizing === true) ||
        isFinalizingMatchStatus(matchStatus) === true,
      finalizationStartedAt: normalizeIsoTimestamp(record.finalizationStartedAt),
      finalizationDurationMs:
        typeof record.finalizationDurationMs === "number" &&
        Number.isFinite(record.finalizationDurationMs)
          ? Math.max(0, Number(record.finalizationDurationMs))
          : null,
      transportConnected: telemetry.transportConnected === true,
      packetsReceiving: telemetry.packetsReceiving === true,
      telemetryAccepted: telemetry.telemetryAccepted === true,
      telemetryActive: telemetry.telemetryActive === true,
      lastTransportAt: normalizeIsoTimestamp(telemetry.lastTransportAt),
      lastAcceptedAt: normalizeIsoTimestamp(telemetry.lastAcceptedAt),
      lastIgnoredAt: normalizeIsoTimestamp(telemetry.lastIgnoredAt),
      lastIgnoredReason:
        typeof telemetry.lastIgnoredReason === "string" &&
        telemetry.lastIgnoredReason.trim()
          ? telemetry.lastIgnoredReason.trim()
          : null,
    };
  };

  const performBackendRequest = async (
    execute,
    { allowRefresh = true, label = "backend request" } = {},
  ) => {
    if (!backendClient) {
      throw buildErrorWithStatus(
        "Telemetry backend client is not ready.",
        401,
      );
    }

    try {
      return await execute(backendClient);
    } catch (error) {
      if (getErrorStatus(error) === 401 && allowRefresh) {
        await refreshBackendAuth(label);
        if (!backendClient) {
          throw buildErrorWithStatus(
            "Telemetry backend client is not ready after token refresh.",
            401,
          );
        }
        return execute(backendClient);
      }
      throw error;
    }
  };

  const fetchControlStatus = async ({ force = false } = {}) => {
    if (!backendClient || !matchId) {
      return null;
    }

    const now = Date.now();
    if (!force && now - lastControlStatusCheckAt < CONTROL_STATUS_POLL_INTERVAL_MS) {
      return null;
    }

    lastControlStatusCheckAt = now;
    try {
      const response = await performBackendRequest(
        (client) =>
          client.get(`/me/matches/${encodeURIComponent(matchId)}/control`),
        {
          label: "control status",
        },
      );
      return normalizeLifecyclePayload(response?.data);
    } catch (error) {
      const status = getErrorStatus(error);
      const message = getErrorMessage(
        error,
        "Control status check failed.",
      );
      if (isUnauthorizedBackendError(error)) {
        await handleUnauthorized(error);
        return null;
      }
      if (isRetryableBackendError(error)) {
        markBackendRetryMode(message);
        return null;
      }

      logWarn("Control status check failed", {
        error: message,
        status,
      });
      setState({
        lastError: message,
      });
      return null;
    }
  };

  const stop = (reason = "stopped", options = {}) => {
    const lifecycle = setLifecycleState(
      options.matchStatus ?? state.matchStatus ?? null,
      {
        isLocked: options.isLocked === true,
        isFinalizing: options.isFinalizing === true,
      },
    );
    clearPollTimer();
    clearRetryTimer();
    if (reason === "finished") {
      logInfo("[Telemetry] Cleared pending telemetry due to match finish", {
        matchId,
        queueSize: pendingEvents.length,
      });
    } else if (pendingEvents.length > 0) {
      logInfo("Stopping telemetry, clearing queued events", {
        queueSize: pendingEvents.length,
        reason,
      });
    }

    running = false;
    pollInFlight = false;
    flushInFlight = false;
    telemetryEnabled = false;
    backendClient = null;
    backendToken = "";
    backendRefreshToken = "";
    backendBaseUrl = "";
    currentSessionId = "";
    pendingEvents = [];
    retryAttempt = 0;
    refreshAuthPromise = null;
    backendRetryMode = false;
    lastControlStatusCheckAt = 0;
    finishTransitionLogged = lifecycle.isFinalizing;
    refreshPacketsPerSecond();
    setState({
      running: false,
      connectedToBackend: false,
      connectionStatus: reason,
      sessionId: null,
      queueSize: 0,
      matchStatus: lifecycle.matchStatus,
      isLocked: lifecycle.isLocked,
      isFinalizing: lifecycle.isFinalizing,
      resultFinalized: options.resultFinalized === true,
      finalizationStartedAt: lifecycle.finalizationStartedAt ?? null,
      finalizationDurationMs: lifecycle.finalizationDurationMs ?? null,
      transportConnected: false,
      packetsReceiving: false,
      telemetryAccepted: false,
      telemetryActive: false,
      lastTransportAt: null,
      lastAcceptedAt: null,
      lastIgnoredAt: null,
      lastIgnoredReason: null,
    });
    return getStatus();
  };

  const resetForMatchSwitch = () => {
    clearPollTimer();
    clearRetryTimer();
    if (pendingEvents.length > 0) {
      logInfo("Resetting telemetry bridge state for match switch", {
        matchId,
        queueSize: pendingEvents.length,
      });
    }

    running = false;
    pollInFlight = false;
    flushInFlight = false;
    telemetryEnabled = false;
    backendClient = null;
    backendToken = "";
    backendRefreshToken = "";
    backendBaseUrl = "";
    matchId = "";
    currentSessionId = "";
    pendingEvents = [];
    retryAttempt = 0;
    refreshAuthPromise = null;
    backendRetryMode = false;
    lastControlStatusCheckAt = 0;
    finishTransitionLogged = false;
    packetTimes = [];
    lastLoggedShadowError = "";
    lastLoggedShadowErrorAt = 0;
    setState({
      running: false,
      matchId: null,
      sessionId: null,
      packetsPerSecond: 0,
      lastPacketTime: null,
      connectionStatus: "stopped",
      phase: null,
      gameTime: null,
      aliveTeams: null,
      circleIndex: null,
      circleStatus: null,
      totalPackets: 0,
      lastError: null,
      connectedToBackend: false,
      queueSize: 0,
      lastSuccessAt: null,
      matchStatus: null,
      isLocked: false,
      isFinalizing: false,
      resultFinalized: false,
      finalizationStartedAt: null,
      finalizationDurationMs: null,
      transportConnected: false,
      packetsReceiving: false,
      telemetryAccepted: false,
      telemetryActive: false,
      lastTransportAt: null,
      lastAcceptedAt: null,
      lastIgnoredAt: null,
      lastIgnoredReason: null,
    });
    return getStatus();
  };

  const applyBackendLifecycleState = (lifecycle, source = "backend") => {
    if (!lifecycle) {
      return null;
    }

    setState({
      resultFinalized: lifecycle.resultFinalized === true,
      transportConnected: lifecycle.transportConnected === true,
      packetsReceiving: lifecycle.packetsReceiving === true,
      telemetryAccepted: lifecycle.telemetryAccepted === true,
      telemetryActive: lifecycle.telemetryActive === true,
      lastTransportAt: lifecycle.lastTransportAt ?? null,
      lastAcceptedAt: lifecycle.lastAcceptedAt ?? null,
      lastIgnoredAt: lifecycle.lastIgnoredAt ?? null,
      lastIgnoredReason: lifecycle.lastIgnoredReason ?? null,
    });
    const normalized = setLifecycleState(lifecycle.matchStatus, lifecycle);
    if (normalized.isLocked) {
      logInfo("[Telemetry] Stopped due to match finish", {
        source,
        matchId,
        matchStatus: normalized.matchStatus,
      });
      return stop("finished", {
        ...normalized,
        resultFinalized: lifecycle.resultFinalized === true,
      });
    }

    if (normalized.isFinalizing) {
      telemetryEnabled = false;
      clearRetryTimer();
      if (!finishTransitionLogged) {
        finishTransitionLogged = true;
        logInfo("[Telemetry] Queue frozen due to match finalization", {
          source,
          matchId,
          matchStatus: normalized.matchStatus,
        });
      }
      setState({
        connectedToBackend: true,
        connectionStatus: "finalizing",
        lastError: null,
        matchStatus: normalized.matchStatus,
        isLocked: false,
        isFinalizing: true,
        resultFinalized: false,
        finalizationStartedAt: normalized.finalizationStartedAt ?? null,
        finalizationDurationMs: normalized.finalizationDurationMs ?? null,
      });
      return normalized;
    }

    if (normalized.matchStatus === "LIVE") {
      const resumed = state.isFinalizing === true || telemetryEnabled !== true;
      telemetryEnabled = true;
      finishTransitionLogged = false;
      if (resumed) {
        logInfo("Backend returned match to LIVE", {
          source,
          matchId,
        });
      }
      if (pendingEvents.length > 0) {
        scheduleQueueRetry(0);
      }
      setState({
        matchStatus: normalized.matchStatus,
        isLocked: false,
        isFinalizing: false,
        resultFinalized: false,
        finalizationStartedAt: null,
        finalizationDurationMs: null,
      });
      return normalized;
    }

    if (normalized.matchStatus === "READY") {
      logInfo("Backend returned match to READY; bridge stopped", {
        source,
        matchId,
      });
      return stop("ready", normalized);
    }

    return normalized;
  };

  const fetchSnapshot = async () => {
    const [
      allInfoResponse,
      playersResponse,
      killsResponse,
      teamsResponse,
      circleResponse,
      gameGlobalInfoResponse,
      observerResponse,
    ] = await Promise.all([
      getOptional(shadowClient, ["/getallinfo"]),
      requestShadowEndpoint(shadowClient, ["/gettotalplayerlist"]),
      requestShadowEndpoint(shadowClient, ["/getkillinfo"]),
      requestShadowEndpoint(shadowClient, ["/getteaminfolist", "/getteaminfo"]),
      getOptional(shadowClient, ["/getcircleinfo"]),
      getOptional(shadowClient, ["/getgameglobalinfo"]),
      getOptional(shadowClient, ["/getobservingplayer"]),
    ]);

    const playersDirect = extractArray(playersResponse?.data, [
      "playerInfoList",
      "PlayerInfoList",
      "TotalPlayerList",
      "totalPlayerList",
      "players",
    ]);
    const allInfo = extractRecord(allInfoResponse?.data, [
      "allinfo",
      "allInfo",
      "data",
      "Data",
      "result",
      "Result",
    ]);
    const playersFromAllInfo = extractArray(allInfo, [
      "TotalPlayerList",
      "totalPlayerList",
      "playerInfoList",
      "PlayerInfoList",
      "players",
    ]);
    const kills = extractArray(killsResponse?.data, [
      "events",
      "KillList",
      "killList",
      "kills",
      "KillInfo",
      "killInfo",
    ]);
    const teamsDirect = extractArray(teamsResponse?.data, [
      "TeamInfoList",
      "teamInfoList",
      "teams",
      "TeamList",
      "teamList",
    ]);
    const teamsFromAllInfo = extractArray(allInfo, [
      "TeamInfoList",
      "teamInfoList",
      "TeamList",
      "teamList",
      "teams",
    ]);
    const players =
      playersDirect.length > 0 ? playersDirect : playersFromAllInfo;
    const teams = teamsDirect.length > 0 ? teamsDirect : teamsFromAllInfo;
    const gameGlobalInfo = extractRecord(gameGlobalInfoResponse?.data, [
      "gameGlobalInfo",
      "GameGlobalInfo",
      "data",
      "Data",
      "result",
      "Result",
    ]);
    const circlePayload = mergeCirclePayload(
      circleResponse?.data ?? allInfo?.CircleInfo ?? allInfo?.circleInfo ?? null,
      gameGlobalInfo,
    );
    const circle = normalizeCircleInfo(circlePayload);
    const observerDirect = extractRecord(observerResponse?.data, [
      "observingPlayer",
      "observer",
      "ObservingPlayer",
    ]);
    const observer =
      observerDirect ??
      extractRecord(allInfo, [
        "observingPlayer",
        "observer",
        "ObservingPlayer",
      ]);
    const aliveTeams = countAliveTeams(teams);
    const phase = detectMatchPhase({
      gameTime: circle.gameTime,
      aliveTeams,
      circleIndex: circle.circleIndex,
      circleStatus: circle.circleStatus,
      previousPhase: state.phase,
    });

    return {
      players,
      kills,
      teams,
      circle,
      circlePayload,
      allInfo,
      aliveTeams,
      phase,
      observer,
    };
  };

  const normalizeCurrentSnapshot = (snapshot) => {
    // Current-poll assembly only; never recover or replay prior telemetry state here.
    return {
      players: Array.isArray(snapshot?.players) ? snapshot.players : [],
      kills: Array.isArray(snapshot?.kills) ? snapshot.kills : [],
      teams: Array.isArray(snapshot?.teams) ? snapshot.teams : [],
      circle: snapshot.circle ?? {
        gameTime: null,
        circleIndex: null,
        circleStatus: null,
      },
      circlePayload: snapshot.circlePayload ?? null,
      allInfo: snapshot.allInfo ?? null,
      aliveTeams: snapshot.aliveTeams ?? null,
      phase: snapshot.phase ?? null,
      observer: snapshot.observer ?? null,
    };
  };

  const buildTransportEvent = (snapshot) => {
    const map = extractTransportMap(snapshot);
    const sequence = nextTransportSequence();
    const timestamp = Date.now();
    const players = normalizeTransportPlayers(snapshot.players, map, timestamp);
    const teams = normalizeTransportTeams(snapshot.teams, players);
    const kills = Array.isArray(snapshot.kills) ? snapshot.kills : [];
    const payload = {
      matchId,
      sessionId: currentSessionId,
      sequence,
      timestamp,
      zonePhase: snapshot.circle.circleIndex,
      circle: snapshot.circlePayload || snapshot.circle,
      circleInfo: snapshot.circlePayload || snapshot.circle,
      players,
      teams,
      kills,
    };

    return {
      id: randomUUID(),
      createdAt: timestamp,
      attempts: 0,
      lastAttemptAt: null,
      payload,
      meta: {
        phase: snapshot.phase,
        gameTime: snapshot.circle.gameTime,
        aliveTeams: countAliveTeams(teams),
        circleIndex: snapshot.circle.circleIndex,
        circleStatus: snapshot.circle.circleStatus,
      },
    };
  };

  const enqueueEvent = (event, reason) => {
    if (!event) {
      return;
    }

    if (state.isFinalizing === true || state.isLocked === true || !telemetryEnabled) {
      return;
    }

    if (pendingEvents.length >= MAX_PENDING_EVENTS) {
      const droppedEvent = pendingEvents.shift();
      logWarn("Queue overflow, dropped oldest event", {
        maxPendingEvents: MAX_PENDING_EVENTS,
        droppedSequence: droppedEvent?.payload?.sequence ?? null,
      });
    }

    pendingEvents.push(event);
    setState({
      connectedToBackend: false,
      connectionStatus: "retrying",
      lastError: reason ? `Queued: ${reason}` : state.lastError,
    });
    logWarn("Event queued", {
      reason: reason || "retry",
      queueSize: pendingEvents.length,
    });
  };

  const handleIgnoredResponse = (response, event) => {
    if (!response?.data?.ignored) {
      return false;
    }

    const lifecycle = normalizeLifecyclePayload(response?.data);
    if (lifecycle.matchStatus) {
      applyBackendLifecycleState(lifecycle, "telemetry-ignore");
    }

    const ignoreReason =
      typeof response.data.reason === "string" && response.data.reason.trim()
        ? response.data.reason.trim()
        : "IGNORED";

    logWarn(
      "transport-post-rejected",
      buildTransportLogMeta(event, {
        reason: ignoreReason,
        status: response?.status ?? null,
      }),
    );

    if (!lifecycle.matchStatus) {
      telemetryEnabled = false;
      logInfo("Backend ignored telemetry; stopping forwarding", {
        matchId,
        sessionId: currentSessionId,
        reason: ignoreReason,
      });
      stop(
        ignoreReason === "MATCH_ENDED" || ignoreReason === "RESULT_FINALIZED"
          ? "ended"
          : "ignored",
      );
    }
    return true;
  };

  const recordSuccessfulSend = (event) => {
    const now = Date.now();
    packetTimes.push(now);
    refreshPacketsPerSecond();
    markBackendReconnected();
    logInfo("transport-payload-sent", buildTransportLogMeta(event));
    setState({
      running: true,
      matchId,
      sessionId: currentSessionId,
      connectionStatus: "connected",
      phase: event?.meta?.phase ?? state.phase,
      gameTime:
        event?.meta?.gameTime !== undefined
          ? event.meta.gameTime
          : state.gameTime,
      aliveTeams:
        event?.meta?.aliveTeams !== undefined
          ? event.meta.aliveTeams
          : state.aliveTeams,
      circleIndex:
        event?.meta?.circleIndex !== undefined
          ? event.meta.circleIndex
          : state.circleIndex,
      circleStatus:
        event?.meta?.circleStatus !== undefined
          ? event.meta.circleStatus
          : state.circleStatus,
      connectedToBackend: true,
      lastPacketTime: new Date(now).toISOString(),
      lastSuccessAt: new Date(now).toISOString(),
      lastError: null,
      totalPackets: state.totalPackets + 1,
    });
  };

  const sendEvent = async (event) => {
    event.attempts += 1;
    event.lastAttemptAt = Date.now();
    logInfo(
      "transport-payload-sending",
      buildTransportLogMeta(event, {
        attempt: event.attempts,
        queueSize: pendingEvents.length,
      }),
    );
    return performBackendRequest(
      (client) => client.post("/api/observer/telemetry", event.payload),
      {
        label: "telemetry post",
      },
    );
  };

  const flushQueue = async (trigger = "retry") => {
    if (
      !running ||
      !telemetryEnabled ||
      state.isFinalizing === true ||
      state.isLocked === true ||
      flushInFlight ||
      pendingEvents.length === 0
    ) {
      return;
    }

    flushInFlight = true;
    clearRetryTimer();
    logInfo("Retrying queue", {
      trigger,
      queueSize: pendingEvents.length,
      retryAttempt,
    });

    try {
      let processed = 0;
      while (
        running &&
        telemetryEnabled &&
        state.isFinalizing !== true &&
        state.isLocked !== true &&
        pendingEvents.length > 0 &&
        processed < QUEUE_FLUSH_BATCH_SIZE
      ) {
        const event = pendingEvents[0];

        try {
          const response = await sendEvent(event);
          if (handleIgnoredResponse(response, event)) {
            return;
          }

          pendingEvents.shift();
          retryAttempt = 0;
          recordSuccessfulSend(event);
          processed += 1;
        } catch (error) {
          const status = getErrorStatus(error);
          const message = getErrorMessage(
            error,
            "Telemetry queue flush failed.",
          );

          if (isUnauthorizedBackendError(error)) {
            await handleUnauthorized(error);
            return;
          }

          if (isRetryableBackendError(error)) {
            retryAttempt += 1;
            markBackendRetryMode(message);
            scheduleQueueRetry(resolveRetryDelayMs());
            return;
          }

          pendingEvents.shift();
          logWarn(
            "transport-post-rejected",
            buildTransportLogMeta(event, {
              reason: message,
              status,
              queueSize: pendingEvents.length,
            }),
          );
          logError("Dropping event after non-retryable backend error", {
            error: message,
            status,
            queueSize: pendingEvents.length,
          });
          setState({
            connectedToBackend: false,
            connectionStatus: "error",
            lastError: message,
          });
          processed += 1;
        }
      }

      if (pendingEvents.length === 0) {
        retryAttempt = 0;
        logInfo("Queue flushed successfully");
      } else if (
        running &&
        telemetryEnabled &&
        state.isFinalizing !== true &&
        state.isLocked !== true
      ) {
        scheduleQueueRetry(trigger === "retry" ? 500 : 250);
      }
    } finally {
      flushInFlight = false;
      setState({});
    }
  };

  const forwardSnapshot = async (snapshot) => {
    if (
      !telemetryEnabled ||
      state.isFinalizing === true ||
      state.isLocked === true
    ) {
      return;
    }

    const event = buildTransportEvent(snapshot);
    if (pendingEvents.length > 0 || flushInFlight || retryTimer || backendRetryMode) {
      enqueueEvent(event, pendingEvents.length > 0 ? "queue backlog" : "retry mode");
      scheduleQueueRetry(0);
      return;
    }

    try {
      const response = await sendEvent(event);
      if (handleIgnoredResponse(response, event)) {
        return;
      }

      recordSuccessfulSend(event);
    } catch (error) {
      const status = getErrorStatus(error);
      const message = getErrorMessage(error, "Telemetry send failed.");

      if (isUnauthorizedBackendError(error)) {
        await handleUnauthorized(error);
        return;
      }

      if (isRetryableBackendError(error)) {
        enqueueEvent(event, classifyQueueReason(error));
        retryAttempt += 1;
        markBackendRetryMode(message);
        scheduleQueueRetry(resolveRetryDelayMs());
        return;
      }

      logWarn(
        "transport-post-rejected",
        buildTransportLogMeta(event, {
          reason: message,
          status,
        }),
      );
      logError("Live telemetry send failed", {
        error: message,
        status,
      });
      setState({
        connectedToBackend: false,
        connectionStatus: "error",
        lastError: message,
      });
    }
  };

  const tick = async () => {
    if (!running || pollInFlight) {
      return;
    }

    pollInFlight = true;
    try {
      const controlStatus = await fetchControlStatus();
      if (controlStatus?.matchStatus) {
        const lifecycleResult = applyBackendLifecycleState(
          controlStatus,
          "status-poll",
        );
        if (lifecycleResult?.isLocked) {
          return;
        }
      }

      const rawSnapshot = await fetchSnapshot();
      const snapshot = normalizeCurrentSnapshot(rawSnapshot);

      if (state.isFinalizing === true) {
        lastLoggedShadowError = "";
        setState({
          running: true,
          matchId,
          sessionId: currentSessionId,
          phase: snapshot.phase,
          gameTime: snapshot.circle.gameTime,
          aliveTeams: snapshot.aliveTeams,
          circleIndex: snapshot.circle.circleIndex,
          circleStatus: snapshot.circle.circleStatus,
          connectedToBackend: true,
          connectionStatus: "finalizing",
          lastError: null,
        });
        return;
      }

      lastLoggedShadowError = "";
      if (typeof onSnapshot === "function") {
        try {
          onSnapshot(snapshot);
        } catch (error) {
          logError("onSnapshot callback failed", {
            error,
          });
        }
      }
      const hasShadowSignal =
        snapshot.players.length > 0 ||
        snapshot.teams.length > 0 ||
        hasCircleSignal(snapshot.circle);
      const hasForwardableData =
        snapshot.players.length > 0 ||
        snapshot.teams.length > 0 ||
        snapshot.circle.circleIndex !== null;

      if (!hasShadowSignal) {
        setState({
          running: true,
          matchId,
          sessionId: currentSessionId,
          connectionStatus:
            pendingEvents.length > 0 ? "retrying" : "waiting-for-data",
          phase: state.phase,
          lastError: null,
        });
        return;
      }

      if (!hasForwardableData) {
        setState({
          running: true,
          matchId,
          sessionId: currentSessionId,
          connectionStatus:
            pendingEvents.length > 0 ? "retrying" : "waiting-for-data",
          phase: snapshot.phase,
          gameTime: snapshot.circle.gameTime,
          aliveTeams: snapshot.aliveTeams,
          circleIndex: snapshot.circle.circleIndex,
          circleStatus: snapshot.circle.circleStatus,
          lastError: null,
        });
        return;
      }

      await forwardSnapshot(snapshot);
    } catch (error) {
      const message = getErrorMessage(
        error,
        "ShadowTracker read failed.",
      );
      setState({
        running: true,
        matchId,
        sessionId: currentSessionId,
        connectionStatus:
          pendingEvents.length > 0 ? "retrying" : "shadow-error",
        lastError: message,
      });
      logShadowFailure(message);
    } finally {
      pollInFlight = false;
    }
  };

  const start = async ({
    apiBase,
    token,
    refreshToken,
    matchId: nextMatchId,
    sessionId,
  }) => {
    const normalizedApiBase = normalizeHttpBaseUrl(
      apiBase,
      getProcessDefaultApiBase(),
    );
    const normalizedToken = String(token || "").trim();
    const normalizedRefreshToken = String(refreshToken || "").trim();
    const normalizedMatchId = String(nextMatchId || "").trim();
    const normalizedSessionId =
      typeof sessionId === "string" && sessionId.trim().length > 0
        ? sessionId.trim()
        : randomUUID();
    if (!normalizedApiBase) {
      throw new Error("apiBase is required.");
    }
    if (!normalizedToken) {
      throw new Error("token is required.");
    }
    if (!normalizedMatchId) {
      throw new Error("matchId is required.");
    }

    if (
      running &&
      backendBaseUrl === normalizedApiBase &&
      backendToken === normalizedToken &&
      matchId === normalizedMatchId &&
      currentSessionId === normalizedSessionId
    ) {
      return {
        ...getStatus(),
        alreadyRunning: true,
      };
    }

    stop("stopped");
    updateAuth({
      apiBase: normalizedApiBase,
      token: normalizedToken,
      refreshToken: normalizedRefreshToken,
    });
    matchId = normalizedMatchId;
    currentSessionId = normalizedSessionId;
    const lifecycle = await fetchControlStatus({ force: true });
    if (lifecycle?.isLocked) {
      logWarn("[Telemetry] Cannot start, match is FINISHED", {
        matchId,
      });
      stop("finished", lifecycle);
      throw new Error("Cannot start telemetry: match is FINISHED.");
    }
    if (lifecycle?.isFinalizing) {
      stop("finalizing", lifecycle);
      throw new Error("Cannot start telemetry while the match is finalizing.");
    }
    telemetryEnabled = true;
    packetTimes = [];
    retryAttempt = 0;
    lastControlStatusCheckAt = 0;
    finishTransitionLogged = false;
    ensureTransportSequenceMatch({
      reason: "match-load",
      nextMatchId: matchId,
      nextSessionId: currentSessionId,
    });
    setState({
      running: true,
      matchId,
      sessionId: currentSessionId,
      packetsPerSecond: 0,
      lastPacketTime: null,
      connectionStatus: "connecting",
      phase: null,
      gameTime: null,
      aliveTeams: null,
      circleIndex: null,
      circleStatus: null,
      totalPackets: 0,
      lastError: null,
      connectedToBackend: false,
      queueSize: 0,
      lastSuccessAt: null,
      matchStatus: lifecycle?.matchStatus ?? state.matchStatus ?? null,
      isLocked: false,
      isFinalizing: false,
      resultFinalized: false,
      finalizationStartedAt: null,
      finalizationDurationMs: null,
      transportConnected: lifecycle?.transportConnected === true,
      packetsReceiving: lifecycle?.packetsReceiving === true,
      telemetryAccepted: lifecycle?.telemetryAccepted === true,
      telemetryActive: lifecycle?.telemetryActive === true,
      lastTransportAt: lifecycle?.lastTransportAt ?? null,
      lastAcceptedAt: lifecycle?.lastAcceptedAt ?? null,
      lastIgnoredAt: lifecycle?.lastIgnoredAt ?? null,
      lastIgnoredReason: lifecycle?.lastIgnoredReason ?? null,
    });
    running = true;
    logInfo("transport-session-started", {
      matchId,
      sessionId: currentSessionId,
      sequence: currentSequence,
      payloadSummary: null,
    });
    logInfo("Started", {
      matchId,
      sessionId: currentSessionId,
      shadowBaseUrl: currentShadowBaseUrl,
      backendBaseUrl: backendBaseUrl,
      intervalMs: DEFAULT_POLL_INTERVAL_MS,
    });
    pollTimer = setInterval(() => {
      void tick();
    }, DEFAULT_POLL_INTERVAL_MS);
    void tick();

    return {
      ...getStatus(),
      alreadyRunning: false,
    };
  };

  return {
    start,
    stop,
    resetForMatchSwitch,
    getStatus,
    updateAuth,
    setShadowBaseUrl,
  };
}

module.exports = {
  createTelemetryBridge,
};
