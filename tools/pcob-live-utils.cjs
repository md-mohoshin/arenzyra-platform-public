const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEFAULT_PCOB_ENDPOINT = "http://127.0.0.1:10086/getobserversnapshot";
const LAUNCHER_USER_DATA_DIR_NAME = "arenzyra-observer-launcher";

function getPathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function normalizeAbsolutePath(value, label, platform) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return null;
  }

  const pathApi = getPathApi(platform);
  if (!pathApi.isAbsolute(normalized)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  return pathApi.normalize(normalized);
}

function resolveLauncherUserData(
  env = process.env,
  platform = process.platform,
) {
  const pathApi = getPathApi(platform);
  const explicitUserData = normalizeAbsolutePath(
    env.ARENZYRA_LAUNCHER_USER_DATA,
    "ARENZYRA_LAUNCHER_USER_DATA",
    platform,
  );
  if (explicitUserData) {
    return explicitUserData;
  }

  const appData = normalizeAbsolutePath(env.APPDATA, "APPDATA", platform);
  return platform === "win32" && appData
    ? pathApi.join(appData, LAUNCHER_USER_DATA_DIR_NAME)
    : null;
}

function requireLauncherUserData(userData, platform = process.platform) {
  const resolved = normalizeAbsolutePath(
    userData,
    "Launcher user-data path",
    platform,
  );
  if (!resolved) {
    throw new Error(
      "Launcher user-data path is unavailable. Set ARENZYRA_LAUNCHER_USER_DATA to an absolute path.",
    );
  }
  return resolved;
}

const DEFAULT_LAUNCHER_USER_DATA = resolveLauncherUserData();

function parseArgs(argv) {
  const args = {};
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      rest.push(token);
      continue;
    }

    const raw = token.slice(2);
    const eqIndex = raw.indexOf("=");
    if (eqIndex >= 0) {
      args[raw.slice(0, eqIndex)] = raw.slice(eqIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[raw] = true;
      continue;
    }

    args[raw] = next;
    index += 1;
  }
  return { args, rest };
}

function stringArg(args, name, fallback = "") {
  const value = args[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberArg(args, name, fallback, options = {}) {
  const value = args[name];
  const parsed = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const integer = Math.trunc(parsed);
  if (options.min !== undefined && integer < options.min) {
    return fallback;
  }
  if (options.max !== undefined && integer > options.max) {
    return fallback;
  }
  return integer;
}

function boolArg(args, name, fallback = false) {
  if (args[name] === undefined) {
    return fallback;
  }
  if (args[name] === true) {
    return true;
  }
  const value = String(args[name]).trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function timestampSlug(date = new Date()) {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:]/g, "")
    .replace(/[T]/g, "_");
}

function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function getJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
    req.on("error", reject);
  });
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function countAlivePlayers(snapshot) {
  const teams = arrayValue(snapshot?.allInfo?.TeamInfoList);
  const fromTeams = teams.reduce(
    (sum, team) => sum + Math.max(0, Number(team?.liveMemberNum || 0)),
    0,
  );
  if (fromTeams > 0) {
    return fromTeams;
  }
  const players = arrayValue(snapshot?.normalized?.players);
  return players.filter((player) => player?.alive === true).length;
}

function countAliveTeams(snapshot) {
  const teams = arrayValue(snapshot?.allInfo?.TeamInfoList);
  const fromTeams = teams.filter(
    (team) => Number(team?.liveMemberNum || 0) > 0,
  ).length;
  if (fromTeams > 0) {
    return fromTeams;
  }
  const normalizedTeams = arrayValue(snapshot?.normalized?.teams);
  return normalizedTeams.filter((team) => Number(team?.alivePlayers || 0) > 0)
    .length;
}

function sumKills(snapshot) {
  const teams = arrayValue(snapshot?.allInfo?.TeamInfoList);
  const fromTeams = teams.reduce(
    (sum, team) => sum + Math.max(0, Number(team?.killNum || 0)),
    0,
  );
  if (fromTeams > 0) {
    return fromTeams;
  }
  const players = arrayValue(snapshot?.normalized?.players);
  return players.reduce(
    (sum, player) => sum + Math.max(0, Number(player?.kills || 0)),
    0,
  );
}

function snapshotSummary(snapshot) {
  const sessionId =
    typeof snapshot?.sessionId === "string" && snapshot.sessionId.trim()
      ? snapshot.sessionId.trim()
      : null;
  return {
    updatedAt: snapshot?.updatedAt || null,
    isInGame: snapshot?.isInGame ?? null,
    mapName: snapshot?.mapName || null,
    alivePlayers: countAlivePlayers(snapshot),
    aliveTeams: countAliveTeams(snapshot),
    kills: sumKills(snapshot),
    killEvents: arrayValue(snapshot?.killInfo).length,
    phase:
      snapshot?.normalized?.circle?.phase ??
      snapshot?.allInfo?.CircleInfo?.CircleIndex ??
      null,
    sessionId,
  };
}

function buildObserverTelemetryPayload(snapshot, options) {
  const timestamp = options.timestamp ?? Date.now();
  const sessionId =
    options.sessionId ||
    (typeof snapshot?.sessionId === "string" && snapshot.sessionId.trim()
      ? snapshot.sessionId.trim()
      : `replay-${timestamp}`);
  return {
    matchId: options.matchId,
    sessionId,
    sequence: options.sequence ?? timestamp,
    timestamp,
    zonePhase:
      snapshot?.normalized?.circle?.phase ??
      snapshot?.allInfo?.CircleInfo?.CircleIndex ??
      null,
    circle:
      snapshot?.allInfo?.CircleInfo ?? snapshot?.normalized?.circle ?? null,
    circleInfo:
      snapshot?.allInfo?.CircleInfo ?? snapshot?.normalized?.circle ?? null,
    players: arrayValue(snapshot?.normalized?.players),
    teams: arrayValue(snapshot?.allInfo?.TeamInfoList).length
      ? arrayValue(snapshot?.allInfo?.TeamInfoList)
      : arrayValue(snapshot?.normalized?.teams),
    backpacks: snapshot?.teamBackpackInfo || [],
    teamBackpackInfo: snapshot?.teamBackpackInfo || [],
    kills: arrayValue(snapshot?.killInfo),
    observer: snapshot?.observingPlayer || null,
    allInfo: snapshot?.allInfo || null,
    routePayloads: snapshot?.routePayloads || null,
    observerSnapshot: snapshot,
    raw: snapshot,
  };
}

function decryptDpapiBase64(base64) {
  const script = `
    Add-Type -AssemblyName System.Security;
    $bytes = [Convert]::FromBase64String($env:DPAPI_BLOB);
    $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);
    [Convert]::ToBase64String($plain)
  `;
  return Buffer.from(
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, DPAPI_BLOB: base64 },
      },
    ).trim(),
    "base64",
  );
}

function getOsCryptKey(userData = DEFAULT_LAUNCHER_USER_DATA) {
  const resolvedUserData = requireLauncherUserData(userData);
  const localState = JSON.parse(
    fs.readFileSync(path.join(resolvedUserData, "Local State"), "utf8"),
  );
  const encryptedKey = Buffer.from(
    String(localState?.os_crypt?.encrypted_key || ""),
    "base64",
  );
  const prefix = encryptedKey.subarray(0, 5).toString("utf8");
  const dpapiBlob =
    prefix === "DPAPI" ? encryptedKey.subarray(5) : encryptedKey;
  return decryptDpapiBase64(dpapiBlob.toString("base64"));
}

function decryptChromiumSecret(value, key) {
  const raw = Buffer.from(String(value || ""), "base64");
  if (raw.subarray(0, 3).toString("utf8") !== "v10") {
    return raw.toString("utf8");
  }
  const nonce = raw.subarray(3, 15);
  const ciphertext = raw.subarray(15, raw.length - 16);
  const tag = raw.subarray(raw.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

function readLauncherSession(userData = DEFAULT_LAUNCHER_USER_DATA) {
  const resolvedUserData = requireLauncherUserData(userData);
  const payload = JSON.parse(
    fs.readFileSync(
      path.join(resolvedUserData, "launcher", "session.json"),
      "utf8",
    ),
  );
  const key = getOsCryptKey(resolvedUserData);
  const token = payload.accessTokenEncrypted
    ? decryptChromiumSecret(payload.accessToken, key)
    : String(payload.accessToken || payload.token || "");
  const refreshToken = payload.refreshTokenEncrypted
    ? decryptChromiumSecret(payload.refreshToken, key)
    : String(payload.refreshToken || "");
  return {
    apiBase: String(payload.apiBase || "https://api.arenzyra.com").replace(
      /\/$/,
      "",
    ),
    token,
    accessToken: token,
    refreshToken,
    user: payload.user || null,
    organization: payload.organization || null,
  };
}

function resolveRecordingPacketsPath(recordingPath) {
  const absolute = path.resolve(recordingPath);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    return path.join(absolute, "packets.jsonl");
  }
  return absolute;
}

module.exports = {
  DEFAULT_LAUNCHER_USER_DATA,
  DEFAULT_PCOB_ENDPOINT,
  boolArg,
  buildObserverTelemetryPayload,
  ensureDir,
  getJson,
  hashValue,
  numberArg,
  parseArgs,
  readLauncherSession,
  requireLauncherUserData,
  resolveLauncherUserData,
  resolveRecordingPacketsPath,
  sanitizeSlug,
  sleep,
  snapshotSummary,
  stringArg,
  timestampSlug,
  writeJson,
};
