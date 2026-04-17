"use strict";

const axios = require("axios");

const DEFAULT_OBSERVER_BASE_URL = "http://127.0.0.1:10086";
const DEFAULT_POLL_INTERVAL_MS = 700;
const REQUEST_TIMEOUT_MS = 1200;

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

async function requestOptional(client, path) {
  try {
    const response = await client.get(path, {
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (response?.status >= 200 && response?.status < 300) {
      return response;
    }
  } catch (_) {
    // Ignore optional endpoint failures.
  }

  return null;
}

async function fetchObserverSnapshot(observerBaseUrl, forcedMapKey = null, previousPhase = null) {
  const client = axios.create({
    baseURL: observerBaseUrl || DEFAULT_OBSERVER_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: () => true,
  });

  const [
    allInfoResponse,
    playersResponse,
    teamsResponse,
    killResponse,
    circleResponse,
    gameGlobalInfoResponse,
  ] = await Promise.all([
    client.get("/getallinfo"),
    requestOptional(client, "/gettotalplayerlist"),
    requestOptional(client, "/getteaminfolist"),
    requestOptional(client, "/getkillinfo"),
    requestOptional(client, "/getcircleinfo"),
    requestOptional(client, "/getgameglobalinfo"),
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

  const circleResponseData = asRecord(circleResponse?.data);
  const baseCirclePayload =
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

  const normalizedForcedMapKey = normalizeMapKey(forcedMapKey);
  if (normalizedForcedMapKey) {
    if (asRecord(allInfo) && typeof allInfo.mapName !== "string") {
      allInfo.mapName = normalizedForcedMapKey;
    }
    if (asRecord(circlePayload) && typeof circlePayload.mapName !== "string") {
      circlePayload.mapName = normalizedForcedMapKey;
    }
  }

  const circleInfo = normalizeCircleInfo(circlePayload);
  const phase = detectMatchPhase({
    gameTime: circleInfo.gameTime,
    aliveTeams: countAliveTeams(teams),
    circleIndex: circleInfo.circleIndex,
    circleStatus: circleInfo.circleStatus,
    previousPhase,
  });

  return {
    players: Array.isArray(players) ? players : [],
    teams: Array.isArray(teams) ? teams : [],
    kills: Array.isArray(kills) ? kills : [],
    circlePayload,
    allInfo,
    observer: allInfo?.observingPlayer || allInfo?.ObservingPlayer || null,
    phase,
    empty: !hasSourceData,
  };
}

function createDirectObserverSnapshotPoller({
  observerBaseUrl = DEFAULT_OBSERVER_BASE_URL,
  getObserverBaseUrl = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  isEnabled = () => false,
  getForcedMapKey = () => null,
  onSnapshot = () => {},
  log = () => {},
} = {}) {
  let timer = null;
  let inFlight = false;
  let stopped = false;
  let lastErrorMessage = "";
  let lastErrorAt = 0;
  let lastStatusAt = 0;
  let lastPhase = null;

  function resolveObserverBaseUrl() {
    if (typeof getObserverBaseUrl === "function") {
      const value = String(getObserverBaseUrl() || "").trim();
      if (value) {
        return value;
      }
    }

    return observerBaseUrl || DEFAULT_OBSERVER_BASE_URL;
  }

  async function pollOnce() {
    if (stopped || inFlight || isEnabled() !== true) {
      return;
    }

    inFlight = true;
    try {
      const snapshot = await fetchObserverSnapshot(
        resolveObserverBaseUrl(),
        getForcedMapKey(),
        lastPhase,
      );
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
      onSnapshot(snapshot);

      const now = Date.now();
      if (now - lastStatusAt >= 5_000) {
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
        lastStatusAt = now;
      }
    } catch (error) {
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
      inFlight = false;
    }
  }

  function start() {
    if (timer || stopped) {
      return;
    }

    timer = setInterval(() => {
      void pollOnce();
    }, pollIntervalMs);
    timer.unref?.();
    void pollOnce();
  }

  async function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
  };
}

module.exports = {
  createDirectObserverSnapshotPoller,
  fetchObserverSnapshot,
};
