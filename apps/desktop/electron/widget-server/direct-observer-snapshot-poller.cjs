"use strict";

const axios = require("axios");

const DEFAULT_OBSERVER_BASE_URL = "http://127.0.0.1:10086";
const DEFAULT_POLL_INTERVAL_MS = 700;
const DEFAULT_CIRCLE_POLL_INTERVAL_MS = 150;
const REQUEST_TIMEOUT_MS = 1200;
const CIRCLE_REQUEST_TIMEOUT_MS = 450;
const CIRCLE_CACHE_MAX_AGE_MS = 1000;
const HANDLED_CIRCLE_SIGNATURE_TTL_MS = 3000;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function hasObjectKeys(value) {
  return Boolean(asRecord(value) && Object.keys(value).length > 0);
}

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeMapKey(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function buildZone(entry) {
  const record = asRecord(entry);
  if (!record) {
    return null;
  }

  const x = toFiniteNumber(record.x ?? record.X ?? record.cx ?? record.centerX);
  const y = toFiniteNumber(record.y ?? record.Y ?? record.cy ?? record.centerY);
  const r = toFiniteNumber(record.r ?? record.R ?? record.radius ?? record.Radius ?? record.Size);
  if (x === null || y === null || r === null) {
    return null;
  }

  return { x, y, r };
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

    for (const key of ["circleInfoList", "CircleInfoList", "circles", "Circles"]) {
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
      gameTime: toFiniteNumber(candidate.GameTime ?? candidate.gameTime),
      circleIndex: toFiniteNumber(
        candidate.CircleIndex ??
          candidate.circleIndex ??
          candidate.phase ??
          candidate.phaseIndex ??
          candidate.zonePhaseIndex,
      ),
      circleStatus:
        circleStatus === undefined || circleStatus === null ? null : String(circleStatus),
    };
  }

  return {
    gameTime: null,
    circleIndex: null,
    circleStatus: null,
  };
}

function getCirclePayloadRecords(payload) {
  const root = asRecord(payload);
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

function pickCircleValue(payload, keys) {
  for (const record of getCirclePayloadRecords(payload)) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) {
        return record[key];
      }
    }
  }

  return null;
}

function pickCircleZone(payload, keys) {
  for (const record of getCirclePayloadRecords(payload)) {
    for (const key of keys) {
      const zone = buildZone(record[key]);
      if (zone) {
        return zone;
      }
    }
  }

  return null;
}

function createCirclePayloadSignature(payload) {
  const info = normalizeCircleInfo(payload);
  const counter = toFiniteNumber(
    pickCircleValue(payload, ["Counter", "counter", "counterSeconds", "elapsedSeconds"]),
  );
  const maxTime = toFiniteNumber(
    pickCircleValue(payload, ["MaxTime", "maxTime", "maxTimeSeconds", "phaseDuration"]),
  );
  const circleArrayValue = pickCircleValue(payload, ["CircleArray", "circleArray"]);
  const circleArray = Array.isArray(circleArrayValue)
    ? circleArrayValue.map((entry) => buildZone(entry)).filter(Boolean)
    : [];

  return JSON.stringify({
    mapName: normalizeMapKey(
      pickCircleValue(payload, ["mapName", "MapName", "map", "Map"]),
    ),
    gameTime: info.gameTime,
    phase: info.circleIndex,
    status: info.circleStatus,
    counter,
    maxTime,
    remaining:
      counter !== null && maxTime !== null
        ? null
        : pickCircleValue(payload, [
            "remainingMs",
            "timeRemainingMs",
            "timeRemaining",
            "remainingTime",
            "remainingSeconds",
          ]),
    targetEndAt:
      counter !== null && maxTime !== null
        ? null
        : pickCircleValue(payload, [
            "nextShrinkAt",
            "nextShrinkTs",
            "nextShrinkTime",
            "zoneNextShrinkAt",
            "nextPhaseAt",
          ]),
    safeZone: pickCircleZone(payload, [
      "safeZone",
      "safezone",
      "zone",
      "currentZone",
    ]),
    nextZone: pickCircleZone(payload, [
      "nextZone",
      "nextzone",
      "whiteZone",
      "WhiteZone",
    ]),
    blueZone: pickCircleZone(payload, [
      "currentBlueZone",
      "CurrentBlueZone",
      "blueZone",
      "BlueZone",
    ]),
    circleArray,
  });
}

function circlePayloadHasGeometry(payload) {
  const circleArrayValue = pickCircleValue(payload, [
    "CircleArray",
    "circleArray",
  ]);
  return Boolean(
    pickCircleZone(payload, ["safeZone", "safezone", "zone", "currentZone"]) ||
      pickCircleZone(payload, ["nextZone", "nextzone", "whiteZone", "WhiteZone"]) ||
      pickCircleZone(payload, [
        "currentBlueZone",
        "CurrentBlueZone",
        "blueZone",
        "BlueZone",
      ]) ||
      (Array.isArray(circleArrayValue) &&
        circleArrayValue.some((entry) => Boolean(buildZone(entry))))
  );
}

function countAliveTeams(teams) {
  if (!Array.isArray(teams) || teams.length === 0) {
    return null;
  }

  let observedTeams = 0;
  let aliveTeams = 0;

  for (const team of teams) {
    const liveMemberNum = toFiniteNumber(
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

  if (aliveTeams !== null && aliveTeams <= 1) {
    return "finished";
  }

  return previousPhase ?? "combat";
}

async function requestOptional(
  client,
  path,
  timeoutMs = REQUEST_TIMEOUT_MS,
  signal = undefined,
) {
  try {
    const response = await client.get(path, {
      timeout: timeoutMs,
      validateStatus: () => true,
      signal,
    });
    if (response?.status >= 200 && response?.status < 300) {
      return response;
    }
  } catch (_) {
    // Ignore optional endpoint failures.
  }

  return null;
}

function extractCircleResponsePayload(responseData) {
  const root = asRecord(responseData);
  if (!root) {
    return null;
  }

  return (
    (hasObjectKeys(root.circleInfo) ? root.circleInfo : null) ||
    (hasObjectKeys(root.CircleInfo) ? root.CircleInfo : null) ||
    (hasObjectKeys(root.circle) ? root.circle : null) ||
    (hasObjectKeys(root.Circle) ? root.Circle : null) ||
    (hasObjectKeys(root) ? root : null)
  );
}

const MAP_NAME_FIELDS = [
  "mapName",
  "MapName",
  "map",
  "Map",
  "mapId",
  "MapId",
];

function extractMapCandidate(payload) {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const field = MAP_NAME_FIELDS.find(
    (key) => typeof root[key] === "string" && root[key].trim(),
  );
  if (!field) {
    return null;
  }

  const source =
    typeof root.mapNameSource === "string"
      ? root.mapNameSource.trim().toLowerCase()
      : null;
  return {
    mapName: root[field].trim(),
    source,
  };
}

function resolveAuthoritativeMapCandidate(records) {
  let legacyCandidate = null;
  for (const record of records) {
    const candidate = extractMapCandidate(record);
    if (!candidate || candidate.source === "runtime-fallback") {
      continue;
    }
    if (candidate.source === "pcob") {
      return candidate;
    }
    legacyCandidate ??= candidate;
  }
  return legacyCandidate;
}

function applyAuthoritativeMapCandidate(payload, candidate) {
  const root = asRecord(payload) ?? {};
  if (!candidate) {
    return { ...root };
  }

  const next = {
    ...root,
    mapName: candidate.mapName,
  };
  delete next.fallbackMapKey;
  if (candidate.source) {
    next.mapNameSource = candidate.source;
  } else {
    delete next.mapNameSource;
  }
  return next;
}

function applyForcedMapKey(mapPayload, forcedMapKey) {
  const root = asRecord(mapPayload);
  if (!root) {
    return null;
  }

  const normalizedForcedMapKey = normalizeMapKey(forcedMapKey);
  if (!normalizedForcedMapKey) {
    return { ...root };
  }

  const existingMap = extractMapCandidate(root);
  if (existingMap && existingMap.source !== "runtime-fallback") {
    return { ...root };
  }

  return {
    ...root,
    mapName: normalizedForcedMapKey,
    mapNameSource: "runtime-fallback",
    fallbackMapKey: normalizedForcedMapKey,
  };
}

async function fetchObserverCircleSnapshot(
  observerBaseUrl,
  forcedMapKey = null,
  previousPhase = null,
  options = {},
) {
  const accessToken = String(options?.accessToken || "").trim();
  const client = axios.create({
    baseURL: observerBaseUrl || DEFAULT_OBSERVER_BASE_URL,
    timeout: CIRCLE_REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
    ...(accessToken
      ? { headers: { "X-Arenzyra-Connector-Token": accessToken } }
      : {}),
  });
  const response = await client.get("/getcircleinfo", {
    timeout: CIRCLE_REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
    signal: options?.signal,
  });
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error(
      `Observer getcircleinfo failed with status ${response?.status ?? "unknown"}.`,
    );
  }

  const circlePayload = applyForcedMapKey(
    extractCircleResponsePayload(response.data),
    forcedMapKey,
  );
  if (!hasObjectKeys(circlePayload)) {
    return null;
  }

  const circleInfo = normalizeCircleInfo(circlePayload);
  return {
    players: [],
    teams: [],
    kills: [],
    backpacks: [],
    circlePayload,
    allInfo: null,
    routePayloads: null,
    observerSnapshot: null,
    observer: null,
    phase: detectMatchPhase({
      gameTime: circleInfo.gameTime,
      aliveTeams: null,
      circleIndex: circleInfo.circleIndex,
      circleStatus: circleInfo.circleStatus,
      previousPhase,
    }),
    source: "direct-observer",
    empty: false,
  };
}

async function fetchObserverSnapshot(
  observerBaseUrl,
  forcedMapKey = null,
  previousPhase = null,
  options = {},
) {
  const accessToken = String(options?.accessToken || "").trim();
  const client = axios.create({
    baseURL: observerBaseUrl || DEFAULT_OBSERVER_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
    ...(accessToken
      ? { headers: { "X-Arenzyra-Connector-Token": accessToken } }
      : {}),
  });
  const cachedCirclePayload = asRecord(options?.circlePayload);
  const signal = options?.signal;

  const [
    allInfoResponse,
    playersResponse,
    teamsResponse,
    killResponse,
    backpackResponse,
    circleResponse,
    gameGlobalInfoResponse,
    observerResponse,
    routePayloadsResponse,
    observerSnapshotResponse,
  ] = await Promise.all([
    client.get("/getallinfo", { signal }),
    requestOptional(client, "/gettotalplayerlist", REQUEST_TIMEOUT_MS, signal),
    requestOptional(client, "/getteaminfolist", REQUEST_TIMEOUT_MS, signal),
    requestOptional(client, "/getkillinfo", REQUEST_TIMEOUT_MS, signal),
    requestOptional(client, "/getteambackpackinfo", REQUEST_TIMEOUT_MS, signal),
    cachedCirclePayload
      ? Promise.resolve(null)
      : requestOptional(client, "/getcircleinfo", REQUEST_TIMEOUT_MS, signal),
    cachedCirclePayload
      ? Promise.resolve(null)
      : requestOptional(client, "/getgameglobalinfo", REQUEST_TIMEOUT_MS, signal),
    requestOptional(client, "/getobservingplayer", REQUEST_TIMEOUT_MS, signal),
    requestOptional(client, "/getroutepayloads", REQUEST_TIMEOUT_MS, signal),
    requestOptional(client, "/getobserversnapshot", REQUEST_TIMEOUT_MS, signal),
  ]);

  if (!allInfoResponse || allInfoResponse.status < 200 || allInfoResponse.status >= 300) {
    throw new Error(`Observer getallinfo failed with status ${allInfoResponse?.status ?? "unknown"}.`);
  }

  const allInfo =
    allInfoResponse?.data?.allInfo ||
    allInfoResponse?.data?.allinfo ||
    allInfoResponse?.data ||
    null;
  const players =
    playersResponse?.data?.playerInfoList ||
    playersResponse?.data?.PlayerInfoList ||
    allInfo?.playerInfoList ||
    allInfo?.PlayerInfoList ||
    allInfo?.TotalPlayerList ||
    [];
  const teams =
    teamsResponse?.data?.teamInfoList ||
    teamsResponse?.data?.TeamInfoList ||
    teamsResponse?.data?.teams ||
    allInfo?.teamInfoList ||
    allInfo?.TeamInfoList ||
    allInfo?.TeamList ||
    [];
  const kills =
    killResponse?.data?.killInfo ||
    killResponse?.data?.KillInfo ||
    killResponse?.data?.killList ||
    killResponse?.data?.KillList ||
    killResponse?.data?.events ||
    [];
  const backpacks =
    backpackResponse?.data?.backpacks ||
    backpackResponse?.data?.TeamBackpackInfo ||
    backpackResponse?.data?.teamBackpackInfo ||
    allInfo?.TeamBackpackInfo ||
    allInfo?.teamBackpackInfo ||
    [];
  const routePayloads =
    routePayloadsResponse?.data?.routePayloads ||
    routePayloadsResponse?.data ||
    null;
  const observerSnapshot =
    observerSnapshotResponse?.data?.observerSnapshot ||
    observerSnapshotResponse?.data?.snapshot ||
    observerSnapshotResponse?.data ||
    null;
  const observerResponseData = asRecord(observerResponse?.data);
  const observer =
    asRecord(observerResponseData?.observingPlayer) ||
    asRecord(observerResponseData?.ObservingPlayer) ||
    asRecord(observerResponseData?.observer) ||
    (observerResponseData && Object.keys(observerResponseData).length > 0
      ? observerResponseData
      : null) ||
    asRecord(observerSnapshot?.observingPlayer) ||
    asRecord(allInfo?.observingPlayer) ||
    asRecord(allInfo?.ObservingPlayer) ||
    null;

  const circleResponseData = asRecord(circleResponse?.data);
  const baseCirclePayload =
    cachedCirclePayload ||
    (hasObjectKeys(circleResponseData?.circleInfo) ? circleResponseData.circleInfo : null) ||
    (hasObjectKeys(circleResponseData?.CircleInfo) ? circleResponseData.CircleInfo : null) ||
    (hasObjectKeys(circleResponseData?.circle) ? circleResponseData.circle : null) ||
    (hasObjectKeys(circleResponseData?.Circle) ? circleResponseData.Circle : null) ||
    (hasObjectKeys(circleResponseData) ? circleResponseData : null) ||
    allInfo?.circleInfo ||
    allInfo?.CircleInfo ||
    allInfo?.safeZoneInfo ||
    allInfo?.SafeZoneInfo ||
    null;
  const gameGlobalResponseData = asRecord(gameGlobalInfoResponse?.data);
  const gameGlobalInfo =
    (hasObjectKeys(gameGlobalResponseData?.gameGlobalInfo) ? gameGlobalResponseData.gameGlobalInfo : null) ||
    (hasObjectKeys(gameGlobalResponseData?.GameGlobalInfo) ? gameGlobalResponseData.GameGlobalInfo : null) ||
    (hasObjectKeys(gameGlobalResponseData?.globalInfo) ? gameGlobalResponseData.globalInfo : null) ||
    (hasObjectKeys(gameGlobalResponseData?.GlobalInfo) ? gameGlobalResponseData.GlobalInfo : null) ||
    (hasObjectKeys(gameGlobalResponseData?.data) ? gameGlobalResponseData.data : null) ||
    (hasObjectKeys(gameGlobalResponseData?.Data) ? gameGlobalResponseData.Data : null) ||
    allInfo?.gameGlobalInfo ||
    allInfo?.GameGlobalInfo ||
    allInfo?.globalInfo ||
    allInfo?.GlobalInfo ||
    (hasObjectKeys(gameGlobalResponseData) ? gameGlobalResponseData : null) ||
    null;
  const hasSourceData =
    (Array.isArray(players) && players.length > 0) ||
    (Array.isArray(teams) && teams.length > 0) ||
    (Array.isArray(kills) && kills.length > 0) ||
    (Array.isArray(backpacks) && backpacks.length > 0) ||
    hasObjectKeys(allInfo) ||
    hasObjectKeys(baseCirclePayload) ||
    hasObjectKeys(gameGlobalInfo);

  const circleRoot =
    baseCirclePayload && typeof baseCirclePayload === "object" && !Array.isArray(baseCirclePayload)
      ? baseCirclePayload
      : {};
  const circleInfoRoot =
    circleRoot?.circleInfo && typeof circleRoot.circleInfo === "object"
      ? circleRoot.circleInfo
      : circleRoot?.CircleInfo && typeof circleRoot.CircleInfo === "object"
        ? circleRoot.CircleInfo
        : circleRoot;
  const normalizedObserverCircle = asRecord(observerSnapshot?.normalized?.circle);
  const circleIndexRaw =
    circleInfoRoot?.CircleIndex ??
    circleInfoRoot?.circleIndex ??
    circleInfoRoot?.phase ??
    circleInfoRoot?.phaseIndex ??
    gameGlobalInfo?.CircleIndex ??
    gameGlobalInfo?.circleIndex ??
    gameGlobalInfo?.phase ??
    gameGlobalInfo?.phaseIndex ??
    null;
  const circleIndex =
    circleIndexRaw === null || circleIndexRaw === undefined || circleIndexRaw === ""
      ? null
      : Number(circleIndexRaw);
  const circleArray = Array.isArray(gameGlobalInfo?.CircleArray)
    ? gameGlobalInfo.CircleArray
    : Array.isArray(gameGlobalInfo?.circleArray)
      ? gameGlobalInfo.circleArray
      : Array.isArray(circleRoot?.CircleArray)
        ? circleRoot.CircleArray
        : Array.isArray(circleRoot?.circleArray)
          ? circleRoot.circleArray
          : [];
  const circleArrayIndex =
    Number.isFinite(circleIndex) ? Math.max(0, Math.trunc(circleIndex) - 1) : 0;
  const safeZone = buildZone(circleArray[circleArrayIndex]);
  const nextZone = buildZone(circleArray[circleArrayIndex + 1]);

  const circlePayload = {
    ...(gameGlobalInfo && typeof gameGlobalInfo === "object" ? gameGlobalInfo : {}),
    ...(normalizedObserverCircle || {}),
    ...(circleRoot && typeof circleRoot === "object" ? circleRoot : {}),
  };
  if (circleArray.length > 0 && circlePayload.CircleArray === undefined) {
    circlePayload.CircleArray = circleArray;
  }
  if (safeZone && circlePayload.safeZone === undefined) {
    circlePayload.safeZone = safeZone;
  }
  if (nextZone && circlePayload.nextZone === undefined) {
    circlePayload.nextZone = nextZone;
  }

  const routePayloadRecords = Object.values(asRecord(routePayloads) ?? {});
  const authoritativeMap = resolveAuthoritativeMapCandidate([
    allInfo,
    circlePayload,
    observerSnapshot,
    asRecord(observerSnapshot?.allInfo),
    asRecord(observerSnapshot?.circleInfo),
    ...routePayloadRecords,
    Array.isArray(players) ? players[0] : null,
    observer,
  ]);
  const applyEffectiveMap = authoritativeMap
    ? (payload) => applyAuthoritativeMapCandidate(payload, authoritativeMap)
    : (payload) => applyForcedMapKey(payload, forcedMapKey);
  const effectiveAllInfo = applyEffectiveMap(allInfo);
  const effectiveCirclePayload = applyEffectiveMap(circlePayload);
  const effectiveObserverSnapshot = applyEffectiveMap(observerSnapshot);

  const circleInfo = normalizeCircleInfo(effectiveCirclePayload);
  const aliveTeams = countAliveTeams(teams);
  const phase = detectMatchPhase({
    gameTime: circleInfo.gameTime,
    aliveTeams,
    circleIndex: circleInfo.circleIndex,
    circleStatus: circleInfo.circleStatus,
    previousPhase,
  });

  return {
    players: Array.isArray(players) ? players : [],
    teams: Array.isArray(teams) ? teams : [],
    kills: Array.isArray(kills) ? kills : [],
    backpacks: Array.isArray(backpacks) ? backpacks : [],
    circlePayload: effectiveCirclePayload,
    allInfo: effectiveAllInfo,
    routePayloads,
    observerSnapshot: effectiveObserverSnapshot,
    observer,
    aliveTeams,
    phase,
    source: "direct-observer",
    empty: !hasSourceData,
  };
}

function createDirectObserverSnapshotPoller({
  observerBaseUrl = DEFAULT_OBSERVER_BASE_URL,
  getObserverBaseUrl = null,
  getAccessToken = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  circlePollIntervalMs = DEFAULT_CIRCLE_POLL_INTERVAL_MS,
  isEnabled = () => false,
  isCircleEnabled = isEnabled,
  getForcedMapKey = () => null,
  onSnapshot = () => {},
  onZoneSnapshot = () => {},
  log = () => {},
} = {}) {
  let timer = null;
  let circleTimer = null;
  let inFlight = false;
  let circleInFlight = false;
  let activePollPromise = null;
  let activeCirclePollPromise = null;
  let pollAbortController = null;
  let circleAbortController = null;
  let stopped = false;
  let lastErrorMessage = "";
  let lastErrorAt = 0;
  let lastCircleErrorMessage = "";
  let lastCircleErrorAt = 0;
  let lastStatusAt = 0;
  let lastPhase = null;
  let latestCircleSnapshot = null;
  let latestCircleReceivedAt = 0;
  let latestObserverSnapshot = null;
  let lastCircleSignature = "";
  let latestCirclePayloadSignature = "";
  const handledCircleSignatures = new Map();
  let generation = 0;

  function reset() {
    generation += 1;
    pollAbortController?.abort();
    circleAbortController?.abort();
    lastPhase = null;
    latestCircleSnapshot = null;
    latestCircleReceivedAt = 0;
    latestObserverSnapshot = null;
    lastCircleSignature = "";
    latestCirclePayloadSignature = "";
    handledCircleSignatures.clear();
  }

  function resolveObserverBaseUrl() {
    if (typeof getObserverBaseUrl === "function") {
      const value = String(getObserverBaseUrl() || "").trim();
      if (value) {
        return value;
      }
    }

    return observerBaseUrl || DEFAULT_OBSERVER_BASE_URL;
  }

  function resolveAccessToken() {
    return typeof getAccessToken === "function"
      ? String(getAccessToken() || "").trim()
      : "";
  }

  function pruneHandledCircleSignatures(now = Date.now()) {
    for (const [signature, handledAt] of handledCircleSignatures) {
      if (now - handledAt > HANDLED_CIRCLE_SIGNATURE_TTL_MS) {
        handledCircleSignatures.delete(signature);
      }
    }
  }

  function wasCirclePayloadHandled(circlePayload, now = Date.now()) {
    pruneHandledCircleSignatures(now);
    const signature = createCirclePayloadSignature(circlePayload);
    const handledAt = handledCircleSignatures.get(signature);
    return (
      Number.isFinite(handledAt) &&
      now - handledAt <= HANDLED_CIRCLE_SIGNATURE_TTL_MS
    );
  }

  async function pollOnce() {
    if (stopped || inFlight) {
      return;
    }
    if (isEnabled() !== true) {
      return;
    }

    const pollGeneration = generation;
    const abortController = new AbortController();
    pollAbortController = abortController;
    inFlight = true;
    try {
      const pollStartedAt = Date.now();
      const hasFreshCircleSnapshot =
        latestCircleSnapshot &&
        pollStartedAt - latestCircleReceivedAt <= CIRCLE_CACHE_MAX_AGE_MS;
      const snapshot = await fetchObserverSnapshot(
        resolveObserverBaseUrl(),
        getForcedMapKey(),
        lastPhase,
        hasFreshCircleSnapshot
            ? {
                circlePayload: latestCircleSnapshot.circlePayload,
                signal: abortController.signal,
                accessToken: resolveAccessToken(),
              }
          : {
              signal: abortController.signal,
              accessToken: resolveAccessToken(),
            },
      );
      if (stopped || pollGeneration !== generation) {
        return;
      }
      if (snapshot.empty === true) {
        const now = Date.now();
        if (now - lastStatusAt >= 5_000) {
          log("observer snapshot empty; waiting for live packets", {
            players: 0,
            teams: 0,
            kills: 0,
          });
          lastStatusAt = now;
        }
        return;
      }
      lastPhase = typeof snapshot?.phase === "string" && snapshot.phase.trim() ? snapshot.phase : null;
      const fastCircleStillFresh =
        latestCircleSnapshot &&
        Date.now() - latestCircleReceivedAt <= CIRCLE_CACHE_MAX_AGE_MS;
      snapshot.zoneHandledByFastLane = Boolean(
        fastCircleStillFresh &&
          wasCirclePayloadHandled(snapshot.circlePayload),
      );
      const ingestedAt = Date.now();
      latestObserverSnapshot = {
        ...snapshot,
        receivedAt: ingestedAt,
      };
      onSnapshot(latestObserverSnapshot);

      if (ingestedAt - lastStatusAt >= 5_000) {
        log("observer snapshot ingested", {
          players: snapshot.players.length,
          teams: snapshot.teams.length,
          kills: snapshot.kills.length,
          mapName:
            snapshot?.allInfo?.mapName ||
            snapshot?.allInfo?.MapName ||
            snapshot?.circlePayload?.mapName ||
            snapshot?.circlePayload?.MapName ||
            null,
          phase: snapshot?.phase || null,
        });
        lastStatusAt = ingestedAt;
      }
    } catch (error) {
      if (stopped || pollGeneration !== generation) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error || "Observer poll failed.");
      const now = Date.now();
      if (message !== lastErrorMessage || now - lastErrorAt >= 10_000) {
        log("observer snapshot poll failed", {
          error: message,
        });
        lastErrorMessage = message;
        lastErrorAt = now;
      }
    } finally {
      if (pollAbortController === abortController) {
        pollAbortController = null;
      }
      inFlight = false;
    }
  }

  async function pollCircleOnce() {
    if (stopped || circleInFlight) {
      return;
    }
    if (isCircleEnabled() !== true) {
      latestCircleSnapshot = null;
      latestCircleReceivedAt = 0;
      lastCircleSignature = "";
      latestCirclePayloadSignature = "";
      handledCircleSignatures.clear();
      return;
    }

    const pollGeneration = generation;
    const abortController = new AbortController();
    circleAbortController = abortController;
    circleInFlight = true;
    try {
      const snapshot = await fetchObserverCircleSnapshot(
        resolveObserverBaseUrl(),
        getForcedMapKey(),
        lastPhase,
        {
          signal: abortController.signal,
          accessToken: resolveAccessToken(),
        },
      );
      if (stopped || pollGeneration !== generation) {
        return;
      }
      if (!snapshot) {
        return;
      }

      const receivedAt = Date.now();
      latestCircleSnapshot = snapshot;
      latestCircleReceivedAt = receivedAt;
      latestCirclePayloadSignature = createCirclePayloadSignature(
        snapshot.circlePayload,
      );
      const signature = `${snapshot.phase || ""}|${latestCirclePayloadSignature}`;
      if (signature === lastCircleSignature) {
        return;
      }

      lastCircleSignature = signature;
      onZoneSnapshot(snapshot);
      if (circlePayloadHasGeometry(snapshot.circlePayload)) {
        handledCircleSignatures.set(latestCirclePayloadSignature, receivedAt);
      }
      pruneHandledCircleSignatures(receivedAt);
    } catch (error) {
      if (stopped || pollGeneration !== generation) {
        return;
      }
      const message =
        error instanceof Error ? error.message : String(error || "Observer circle poll failed.");
      const now = Date.now();
      if (message !== lastCircleErrorMessage || now - lastCircleErrorAt >= 10_000) {
        log("observer circle poll failed; full snapshot fallback remains active", {
          error: message,
        });
        lastCircleErrorMessage = message;
        lastCircleErrorAt = now;
      }
    } finally {
      if (circleAbortController === abortController) {
        circleAbortController = null;
      }
      circleInFlight = false;
    }
  }

  function launchPollOnce() {
    if (activePollPromise) {
      return activePollPromise;
    }
    const pending = pollOnce();
    activePollPromise = pending;
    void pending.then(
      () => {
        if (activePollPromise === pending) activePollPromise = null;
      },
      () => {
        if (activePollPromise === pending) activePollPromise = null;
      },
    );
    return pending;
  }

  function launchCirclePollOnce() {
    if (activeCirclePollPromise) {
      return activeCirclePollPromise;
    }
    const pending = pollCircleOnce();
    activeCirclePollPromise = pending;
    void pending.then(
      () => {
        if (activeCirclePollPromise === pending) {
          activeCirclePollPromise = null;
        }
      },
      () => {
        if (activeCirclePollPromise === pending) {
          activeCirclePollPromise = null;
        }
      },
    );
    return pending;
  }

  function start() {
    if (timer || stopped) {
      return;
    }

    timer = setInterval(() => {
      void launchPollOnce();
    }, pollIntervalMs);
    timer.unref?.();
    circleTimer = setInterval(() => {
      void launchCirclePollOnce();
    }, circlePollIntervalMs);
    circleTimer.unref?.();
    void launchCirclePollOnce();
    void launchPollOnce();
  }

  async function stop() {
    stopped = true;
    reset();
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (circleTimer) {
      clearInterval(circleTimer);
      circleTimer = null;
    }
    const pending = [activePollPromise, activeCirclePollPromise].filter(
      Boolean,
    );
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }

  return {
    getLatestSnapshot() {
      if (!latestObserverSnapshot) {
        return null;
      }
      return {
        ...latestObserverSnapshot,
        players: Array.isArray(latestObserverSnapshot.players)
          ? [...latestObserverSnapshot.players]
          : [],
        teams: Array.isArray(latestObserverSnapshot.teams)
          ? [...latestObserverSnapshot.teams]
          : [],
      };
    },
    hasHandledCirclePayload(circlePayload) {
      return wasCirclePayloadHandled(circlePayload);
    },
    reset,
    start,
    stop,
  };
}

module.exports = {
  circlePayloadHasGeometry,
  createCirclePayloadSignature,
  createDirectObserverSnapshotPoller,
  fetchObserverCircleSnapshot,
  fetchObserverSnapshot,
};
