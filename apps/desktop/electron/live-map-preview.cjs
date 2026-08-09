"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const axios = require("axios");
const { startWidgetsServer } = require("./widget-server/server.cjs");

const DEFAULT_WIDGET_PORT = 5511;
const OBSERVER_BASE_URL = "http://127.0.0.1:10086";
const OBSERVER_ACCESS_TOKEN = crypto.randomBytes(32).toString("hex");
const observerClient = axios.create({
  baseURL: OBSERVER_BASE_URL,
  headers: { "X-Arenzyra-Connector-Token": OBSERVER_ACCESS_TOKEN },
});
const LAUNCHER_USER_DATA_DIR_NAME = "arenzyra-observer-launcher";
const OBSERVER_DATA_DIR_NAME = "ArenzyraObserver";
const SHADOWTRACKER_DATA_DIR_NAME = "ShadowTrackerExtra";
const DEFAULT_TEAM_NAME = "Arenzyra";
const DEFAULT_TEAM_TAG = "AZ";
const MAX_LOG_TAIL_BYTES = 2 * 1024 * 1024;
const POLL_INTERVAL_MS = 700;
const READY_TIMEOUT_MS = 10_000;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toFiniteNumber(value) {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeSlot(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }

  const slot = Math.trunc(numeric);
  return slot > 0 ? slot : null;
}

function normalizePathValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getPathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function normalizeAbsolutePath(value, label, platform) {
  const normalized = normalizePathValue(value);
  if (!normalized) {
    return null;
  }

  const pathApi = getPathApi(platform);
  if (!pathApi.isAbsolute(normalized)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return pathApi.normalize(normalized);
}

function resolveWindowsSystemDriveRoot(env, platform) {
  if (platform !== "win32") {
    return null;
  }

  const pathApi = getPathApi(platform);
  const systemRoot = normalizeAbsolutePath(
    env.SystemRoot || env.SYSTEMROOT,
    "SystemRoot",
    platform,
  );
  if (systemRoot) {
    return pathApi.parse(systemRoot).root;
  }

  const systemDrive = normalizePathValue(env.SystemDrive || env.SYSTEMDRIVE);
  if (!systemDrive) {
    return null;
  }
  const candidate = /^[A-Za-z]:$/.test(systemDrive)
    ? `${systemDrive}\\`
    : systemDrive;
  const normalizedDrive = normalizeAbsolutePath(
    candidate,
    "SystemDrive",
    platform,
  );
  if (pathApi.parse(normalizedDrive).root !== normalizedDrive) {
    throw new Error("SystemDrive must resolve to a drive root.");
  }
  return normalizedDrive;
}

function resolveLiveMapRuntimePaths(
  env = process.env,
  platform = process.platform,
) {
  const pathApi = getPathApi(platform);
  const launcherLogOverride = normalizeAbsolutePath(
    env.ARENZYRA_LAUNCHER_LOG_PATH,
    "ARENZYRA_LAUNCHER_LOG_PATH",
    platform,
  );
  const brandingIniOverride = normalizeAbsolutePath(
    env.ARENZYRA_TEAM_BRANDING_INI_PATH,
    "ARENZYRA_TEAM_BRANDING_INI_PATH",
    platform,
  );
  const teamAssetsOverride = normalizeAbsolutePath(
    env.ARENZYRA_TEAM_ASSETS_ROOT,
    "ARENZYRA_TEAM_ASSETS_ROOT",
    platform,
  );

  const launcherUserDataOverride = normalizeAbsolutePath(
    env.ARENZYRA_LAUNCHER_USER_DATA,
    "ARENZYRA_LAUNCHER_USER_DATA",
    platform,
  );
  const appData = normalizeAbsolutePath(env.APPDATA, "APPDATA", platform);
  const launcherUserData =
    launcherUserDataOverride ||
    (platform === "win32" && appData
      ? pathApi.join(appData, LAUNCHER_USER_DATA_DIR_NAME)
      : null);

  const shadowTrackerSavedOverride = normalizeAbsolutePath(
    env.ARENZYRA_SHADOWTRACKER_SAVED_ROOT,
    "ARENZYRA_SHADOWTRACKER_SAVED_ROOT",
    platform,
  );
  const localAppData = normalizeAbsolutePath(
    env.LOCALAPPDATA,
    "LOCALAPPDATA",
    platform,
  );
  const shadowTrackerSavedRoot =
    shadowTrackerSavedOverride ||
    (platform === "win32" && localAppData
      ? pathApi.join(localAppData, SHADOWTRACKER_DATA_DIR_NAME, "Saved")
      : null);

  const observerDataOverride = normalizeAbsolutePath(
    env.ARENZYRA_OBSERVER_DATA_ROOT,
    "ARENZYRA_OBSERVER_DATA_ROOT",
    platform,
  );
  const systemDriveRoot = resolveWindowsSystemDriveRoot(env, platform);
  const observerDataRoot =
    observerDataOverride ||
    (systemDriveRoot
      ? pathApi.join(systemDriveRoot, OBSERVER_DATA_DIR_NAME)
      : null);

  const launcherLogPath =
    launcherLogOverride ||
    (launcherUserData
      ? pathApi.join(launcherUserData, "logs", "launcher.log")
      : null);
  const teamBrandingIniPath =
    brandingIniOverride ||
    (shadowTrackerSavedRoot
      ? pathApi.join(shadowTrackerSavedRoot, "TeamLogoAndColor.ini")
      : null);
  const teamAssetsRoot =
    teamAssetsOverride ||
    (observerDataRoot
      ? pathApi.join(observerDataRoot, "assets", "teams")
      : null);

  const missing = [];
  if (!launcherLogPath) {
    missing.push("ARENZYRA_LAUNCHER_LOG_PATH or ARENZYRA_LAUNCHER_USER_DATA/APPDATA");
  }
  if (!teamBrandingIniPath) {
    missing.push(
      "ARENZYRA_TEAM_BRANDING_INI_PATH or ARENZYRA_SHADOWTRACKER_SAVED_ROOT/LOCALAPPDATA",
    );
  }
  if (!teamAssetsRoot) {
    missing.push(
      "ARENZYRA_TEAM_ASSETS_ROOT or ARENZYRA_OBSERVER_DATA_ROOT/SystemRoot",
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Unable to resolve live-map runtime paths. Set ${missing.join(", ")}.`,
    );
  }

  return {
    launcherLogPath,
    teamAssetsRoot,
    teamBrandingIniPath,
  };
}

function buildTeamAssetUrl(filePath) {
  const normalizedPath = normalizePathValue(filePath);
  if (!normalizedPath) {
    return null;
  }

  const fileName = path.basename(normalizedPath);
  if (!fileName) {
    return null;
  }

  return `/assets/teams/${encodeURIComponent(fileName)}`;
}

function readFileTail(filePath, maxBytes) {
  if (!fs.existsSync(filePath)) {
    return "";
  }

  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  if (length <= 0) {
    return "";
  }

  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(handle);
  }
}

function parseLatestBrandingFromLauncherLog(filePath) {
  const text = readFileTail(filePath, MAX_LOG_TAIL_BYTES);
  if (!text) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line || line[0] !== "{") {
      continue;
    }

    try {
      const entry = JSON.parse(line);
      const message = String(entry?.message || "");
      if (
        message !== "[Production] Check passed: branding" &&
        message !== "[Production] Check passed: teams"
      ) {
        continue;
      }

      const payload = entry?.meta?.meta;
      const slots = Array.isArray(payload?.slots) ? payload.slots : [];
      if (!slots.length) {
        continue;
      }

      return {
        matchId: payload?.matchId ? String(payload.matchId) : null,
        slots,
      };
    } catch (_) {
      // Ignore malformed lines from tail reads.
    }
  }

  return null;
}

function parseLatestSelectedMapKeyFromLauncherLog(filePath) {
  const text = readFileTail(filePath, MAX_LOG_TAIL_BYTES);
  if (!text) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line || line[0] !== "{") {
      continue;
    }

    try {
      const entry = JSON.parse(line);
      if (String(entry?.message || "") !== "[Production] Check passed: assets") {
        continue;
      }

      const selectedMapKey = normalizePathValue(entry?.meta?.meta?.selectedMapKey);
      if (selectedMapKey) {
        return selectedMapKey;
      }
    } catch (_) {
      // Ignore malformed lines from tail reads.
    }
  }

  return null;
}

function parseIniTuple(line) {
  const result = {};
  const matches = line.match(/^TeamLogoAndColor=\((.*)\)$/);
  if (!matches) {
    return null;
  }

  const body = matches[1];
  const parts = body.split(/,(?=[A-Za-z])/);
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function rgbToHex(r, g, b) {
  const channels = [r, g, b].map((value) => {
    const numeric = Math.max(0, Math.min(255, Math.trunc(toFiniteNumber(value) ?? 0)));
    return numeric.toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`.toUpperCase();
}

function parseBrandingIni(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const teams = [];
  for (const line of lines) {
    if (!line.startsWith("TeamLogoAndColor=(")) {
      continue;
    }

    const tuple = parseIniTuple(line.trim());
    if (!tuple) {
      continue;
    }

    const slot = normalizeSlot(tuple.TeamNo);
    if (slot === null) {
      continue;
    }

    teams.push({
      teamId: `slot-${slot}`,
      slot,
      teamName: normalizePathValue(tuple.TeamName) || DEFAULT_TEAM_NAME,
      teamTag: DEFAULT_TEAM_TAG,
      logoUrl:
        buildTeamAssetUrl(tuple.TeamLogoPath) || buildTeamAssetUrl(tuple.KillInfoPath) || null,
      color: rgbToHex(tuple.TeamColorR, tuple.TeamColorG, tuple.TeamColorB),
    });
  }

  return teams;
}

function buildBrandingPayload({ launcherLogPath, teamBrandingIniPath }) {
  const iniTeams = parseBrandingIni(teamBrandingIniPath);
  const iniTeamsBySlot = new Map(iniTeams.map((team) => [team.slot, team]));
  const fromLog = parseLatestBrandingFromLauncherLog(launcherLogPath);
  if (fromLog && Array.isArray(fromLog.slots) && fromLog.slots.length > 0) {
    return {
      matchId: fromLog.matchId,
      timestamp: Date.now(),
      teams: fromLog.slots
        .map((slot) => {
          const team = slot?.team && typeof slot.team === "object" ? slot.team : null;
          const slotNumber = normalizeSlot(slot?.slotNumber ?? slot?.teamNo ?? slot?.slot);
          const iniTeam = slotNumber !== null ? iniTeamsBySlot.get(slotNumber) || null : null;
          const localLogoPath = normalizePathValue(slot?.localLogoPath);
          const logoUrl = buildTeamAssetUrl(localLogoPath);
          return {
            teamId:
              slot?.teamId || team?.id ? String(slot?.teamId || team?.id) : slotNumber ? `slot-${slotNumber}` : null,
            slot: slotNumber,
            teamName:
              normalizePathValue(team?.name) ||
              normalizePathValue(slot?.teamName) ||
              iniTeam?.teamName ||
              DEFAULT_TEAM_NAME,
            teamTag: normalizePathValue(team?.tag) || normalizePathValue(slot?.teamTag) || DEFAULT_TEAM_TAG,
            logoUrl: logoUrl || iniTeam?.logoUrl || "/assets/default-team.png",
            color:
              normalizePathValue(slot?.resolvedColor) ||
              normalizePathValue(team?.accentLight) ||
              normalizePathValue(team?.accentDark) ||
              iniTeam?.color ||
              null,
          };
        })
        .filter((team) => team.slot !== null || team.teamId || team.teamName),
    };
  }

  return {
    matchId: null,
    timestamp: Date.now(),
    teams: iniTeams.map((team) => ({
      ...team,
      logoUrl: team.logoUrl || "/assets/default-team.png",
    })),
  };
}

async function probeObserverHealth() {
  try {
    const response = await observerClient.get("/health", {
      timeout: 800,
      validateStatus: () => true,
    });
    return response.status >= 200 && response.status < 300;
  } catch (_) {
    return false;
  }
}

async function waitForObserverReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeObserverHealth()) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function startObserverBridgeIfNeeded() {
  const obScriptPath = path.resolve(__dirname, "../../..", "ob.js");
  if (!fs.existsSync(obScriptPath)) {
    throw new Error(`ob.js not found at ${obScriptPath}`);
  }

  const child = spawn(process.execPath, [obScriptPath], {
    cwd: path.dirname(obScriptPath),
    env: {
      ...process.env,
      PORT: "10086",
      FORWARD_ENABLE: "false",
      OBSERVER_FORWARD_ENABLE: "false",
      ARENZYRA_PCOB_CONNECTOR_TOKEN: OBSERVER_ACCESS_TOKEN,
      OBTOOLS_VERBOSE_LOG: process.env.OBTOOLS_VERBOSE_LOG || "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => {
    const text = String(chunk || "").trim();
    if (text) {
      console.log(`[ob.js] ${text}`);
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = String(chunk || "").trim();
    if (text) {
      console.error(`[ob.js] ${text}`);
    }
  });
  child.once("exit", (code, signal) => {
    console.log(`[ob.js] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });

  return child;
}

async function fetchObserverSnapshot() {
  const [
    allInfoResponse,
    playersResponse,
    teamsResponse,
    killResponse,
    backpackResponse,
    circleResponse,
    gameGlobalInfoResponse,
    routePayloadsResponse,
    observerSnapshotResponse,
  ] = await Promise.all([
    observerClient.get("/getallinfo", {
      timeout: 1200,
      validateStatus: () => true,
    }),
    observerClient.get("/gettotalplayerlist", {
      timeout: 1200,
      validateStatus: () => true,
    }),
    observerClient.get("/getteaminfolist", {
      timeout: 1200,
      validateStatus: () => true,
    }),
    observerClient.get("/getkillinfo", {
      timeout: 1200,
      validateStatus: () => true,
    }),
    observerClient.get("/getteambackpackinfo", {
      timeout: 1200,
      validateStatus: () => true,
    }),
    observerClient.get("/getcircleinfo", {
      timeout: 1200,
      validateStatus: () => true,
    }),
    observerClient.get("/getgameglobalinfo", {
      timeout: 1200,
      validateStatus: () => true,
    }),
    observerClient.get("/getroutepayloads", {
      timeout: 1200,
      validateStatus: () => true,
    }),
    observerClient.get("/getobserversnapshot", {
      timeout: 1200,
      validateStatus: () => true,
    }),
  ]);

  const allInfo = allInfoResponse?.data?.allInfo || allInfoResponse?.data?.allinfo || allInfoResponse?.data || null;
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
    [];
  const kills =
    killResponse?.data?.killInfo ||
    killResponse?.data?.KillInfo ||
    killResponse?.data?.killList ||
    killResponse?.data?.KillList ||
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
  const baseCirclePayload =
    circleResponse?.data ||
    allInfo?.circleInfo ||
    allInfo?.CircleInfo ||
    allInfo?.safeZoneInfo ||
    allInfo?.SafeZoneInfo ||
    null;
  const gameGlobalInfo =
    gameGlobalInfoResponse?.data?.gameGlobalInfo ||
    gameGlobalInfoResponse?.data?.GameGlobalInfo ||
    gameGlobalInfoResponse?.data ||
    null;
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
    null;
  const circleIndex =
    circleIndexRaw === null || circleIndexRaw === undefined || circleIndexRaw === ""
      ? null
      : Number(circleIndexRaw);
  const circleArray = Array.isArray(gameGlobalInfo?.CircleArray) ? gameGlobalInfo.CircleArray : [];
  const circleArrayIndex = Number.isFinite(circleIndex) ? Math.max(0, Math.trunc(circleIndex) - 1) : 0;
  const toZone = (entry) => {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const x = Number(entry.x ?? entry.X ?? entry.cx ?? entry.centerX);
    const y = Number(entry.y ?? entry.Y ?? entry.cy ?? entry.centerY);
    const r = Number(entry.r ?? entry.R ?? entry.radius ?? entry.Radius ?? entry.Size);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r) ? { x, y, r } : null;
  };
  const safeZone = toZone(circleArray[circleArrayIndex]);
  const nextZone = toZone(circleArray[circleArrayIndex + 1]);
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

  return {
    players: Array.isArray(players) ? players : [],
    teams: Array.isArray(teams) ? teams : [],
    kills: Array.isArray(kills) ? kills : [],
    backpacks: Array.isArray(backpacks) ? backpacks : [],
    circlePayload,
    allInfo,
    routePayloads,
    observerSnapshot,
    observer: allInfo?.observingPlayer || allInfo?.ObservingPlayer || null,
  };
}

async function main() {
  const runtimePaths = resolveLiveMapRuntimePaths();
  const port = normalizeSlot(process.env.ARENZYRA_LIVE_MAP_PORT) || DEFAULT_WIDGET_PORT;
  const forcedMapKey = normalizePathValue(process.env.ARENZYRA_FORCE_MAP_KEY) ||
    parseLatestSelectedMapKeyFromLauncherLog(runtimePaths.launcherLogPath);
  let observerChild = null;
  let widgetServer = null;
  let pollTimer = null;
  let shuttingDown = false;
  let inFlight = false;
  let lastStatusAt = 0;

  async function shutdown(reason) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[live-map-preview] stopping (${reason})`);

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (widgetServer && typeof widgetServer.stop === "function") {
      await widgetServer.stop().catch(() => {});
      widgetServer = null;
    }

    if (observerChild && !observerChild.killed) {
      try {
        observerChild.kill("SIGTERM");
      } catch (_) {
        // Ignore.
      }
    }
  }

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => {
      void shutdown(signal).finally(() => process.exit(0));
    });
  }

  const observerReady = await probeObserverHealth();
  if (!observerReady) {
    console.log("[live-map-preview] observer bridge missing on 10086, starting repo ob.js");
    observerChild = startObserverBridgeIfNeeded();
    const ready = await waitForObserverReady(READY_TIMEOUT_MS);
    if (!ready) {
      throw new Error("Timed out waiting for ob.js to expose 10086.");
    }
  }

  widgetServer = startWidgetsServer({
    port,
    host: "127.0.0.1",
    teamAssetsRoot: runtimePaths.teamAssetsRoot,
    log(message, meta) {
      if (typeof meta === "undefined") {
        console.log(`[widget] ${message}`);
      } else {
        console.log(`[widget] ${message}`, meta);
      }
    },
  });
  await widgetServer.whenReady();

  const brandingPayload = buildBrandingPayload(runtimePaths);
  if (brandingPayload.teams.length > 0) {
    widgetServer.setTeamBranding(brandingPayload);
    console.log(
      `[live-map-preview] loaded branding for ${brandingPayload.teams.length} slots` +
        (brandingPayload.matchId ? ` (match ${brandingPayload.matchId})` : ""),
    );
  } else {
    console.log("[live-map-preview] no local branding payload found");
  }

  const status = widgetServer.getStatus();
  console.log(`[live-map-preview] ready at ${status.localBaseUrl}/obs/map`);
  console.log(`[live-map-preview] debug at ${status.localBaseUrl}/debug/map-state`);

  const pollOnce = async () => {
    if (inFlight || shuttingDown) {
      return;
    }
    inFlight = true;

    try {
      const snapshot = await fetchObserverSnapshot();
      if (snapshot.allInfo && !normalizePathValue(snapshot.allInfo.mapName) && forcedMapKey) {
        snapshot.allInfo.mapName = forcedMapKey;
      }
      if (snapshot.circlePayload && !normalizePathValue(snapshot.circlePayload.mapName) && forcedMapKey) {
        snapshot.circlePayload.mapName = forcedMapKey;
      }
      widgetServer.ingestTelemetrySnapshot(snapshot);

      const now = Date.now();
      if (now - lastStatusAt >= 5_000) {
        const playerCount = snapshot.players.length;
        const teamCount = snapshot.teams.length;
        const killCount = snapshot.kills.length;
        const mapName =
          snapshot?.allInfo?.mapName ||
          snapshot?.allInfo?.MapName ||
          snapshot?.allInfo?.map ||
          snapshot?.allInfo?.Map ||
          "unknown";
        console.log(
          `[live-map-preview] live players=${playerCount} teams=${teamCount} kills=${killCount} map=${mapName}`,
        );
        lastStatusAt = now;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "observer poll failed");
      console.error(`[live-map-preview] observer poll failed: ${message}`);
    } finally {
      inFlight = false;
    }
  };

  await pollOnce();
  pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);
}

if (require.main === module) {
  main().catch((error) => {
    const message =
      error instanceof Error
        ? error.stack || error.message
        : String(error || "unknown");
    console.error(`[live-map-preview] fatal: ${message}`);
    process.exit(1);
  });
}

module.exports = {
  buildBrandingPayload,
  normalizeAbsolutePath,
  resolveLiveMapRuntimePaths,
  resolveWindowsSystemDriveRoot,
};
