const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const net = require("node:net");

const INSTALL_ROOT =
  process.env.ARENZYRA_LAUNCHER_INSTALL_ROOT ||
  "C:\\Users\\mohos\\AppData\\Local\\Programs\\arenzyra-observer-launcher";
const SESSION_PATH = path.join(
  process.env.APPDATA || "",
  "arenzyra-observer-launcher",
  "launcher",
  "session.json",
);
const CONFIG_PATH = path.join(
  process.env.APPDATA || "",
  "arenzyra-observer-launcher",
  "launcher",
  "config.json",
);
const LOCAL_STATE_PATH = path.join(
  process.env.APPDATA || "",
  "arenzyra-observer-launcher",
  "Local State",
);
const REPO_ROOT = path.resolve(__dirname, "..");
const OB_SCRIPT_PATH = path.join(REPO_ROOT, "ob.js");
const DEFAULT_API_BASE = "http://localhost:3000";
const LOCAL_OBSERVER_BASE = "http://127.0.0.1:10086";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function decryptDpapiBuffer(buffer) {
  const payloadBase64 = buffer.toString("base64");
  const script = [
    "Add-Type -AssemblyName System.Security",
    `$inputBytes = [Convert]::FromBase64String('${payloadBase64}')`,
    "$outputBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($inputBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Write([Convert]::ToBase64String($outputBytes))",
  ].join("; ");

  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    windowsHide: true,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      String(
        result.stderr || result.stdout || "Failed to decrypt DPAPI payload.",
      ).trim(),
    );
  }

  const output = String(result.stdout || "").trim();
  if (!output) {
    throw new Error("DPAPI decrypt returned an empty response.");
  }

  return Buffer.from(output, "base64");
}

function getChromiumMasterKey() {
  const localState = readJson(LOCAL_STATE_PATH, {});
  const encryptedKeyBase64 = String(
    localState?.os_crypt?.encrypted_key || "",
  ).trim();
  if (!encryptedKeyBase64) {
    throw new Error(`Missing Chromium master key in ${LOCAL_STATE_PATH}`);
  }

  const encryptedKey = Buffer.from(encryptedKeyBase64, "base64");
  const dpapiPrefix = Buffer.from("DPAPI", "ascii");
  return decryptDpapiBuffer(encryptedKey.subarray(dpapiPrefix.length));
}

function decodeSecret(raw, encrypted) {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }

  if (!encrypted) {
    return value;
  }

  const masterKey = getChromiumMasterKey();
  const encryptedBytes = Buffer.from(value, "base64");
  const prefix = encryptedBytes.subarray(0, 3).toString("ascii");
  if (prefix !== "v10") {
    throw new Error(`Unsupported encrypted secret prefix: ${prefix}`);
  }

  const nonce = encryptedBytes.subarray(3, 15);
  const ciphertext = encryptedBytes.subarray(15, encryptedBytes.length - 16);
  const authTag = encryptedBytes.subarray(encryptedBytes.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function resolveNodeBinary() {
  const lookup = spawnSync("where", ["node.exe"], {
    windowsHide: true,
    encoding: "utf8",
  });
  const first =
    lookup.status === 0
      ? String(lookup.stdout || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean)
      : "";

  if (first && fs.existsSync(first)) {
    return first;
  }

  return process.env.NODE_BINARY || "node";
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}${
        body && typeof body === "object"
          ? ` ${JSON.stringify(body)}`
          : body
            ? ` ${String(body)}`
            : ""
      }`,
    );
  }

  return body;
}

async function requestAuthedJson(apiBase, accessToken, path) {
  return requestJson(`${apiBase}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

function normalizeLifecycleState(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return normalized || null;
}

function isLiveMatchCandidate(match) {
  const status = normalizeLifecycleState(match?.status);
  const liveState = normalizeLifecycleState(match?.liveState);
  return status === "LIVE" || liveState === "LIVE";
}

function toTimestamp(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareMatchRecency(left, right) {
  const leftTime = Math.max(
    toTimestamp(left?.liveAt),
    toTimestamp(left?.startedAt),
    toTimestamp(left?.updatedAt),
    toTimestamp(left?.scheduledAt),
    toTimestamp(left?.createdAt),
  );
  const rightTime = Math.max(
    toTimestamp(right?.liveAt),
    toTimestamp(right?.startedAt),
    toTimestamp(right?.updatedAt),
    toTimestamp(right?.scheduledAt),
    toTimestamp(right?.createdAt),
  );
  return rightTime - leftTime;
}

async function resolveLiveMatchFromPcob(apiBase, accessToken) {
  try {
    const payload = await requestAuthedJson(
      apiBase,
      accessToken,
      "/pcob/active-match",
    );
    if (payload?.active !== true || !payload?.matchId) {
      return null;
    }

    return {
      matchId: String(payload.matchId).trim(),
      sessionId: String(payload.pcobSessionId || "").trim() || null,
      source: "pcob/active-match",
    };
  } catch {
    return null;
  }
}

async function resolveLiveMatchFromMe(apiBase, accessToken) {
  try {
    const payload = await requestAuthedJson(
      apiBase,
      accessToken,
      "/me/active-match",
    );
    const matchId = String(payload?.matchId || payload?.id || "").trim();
    if (!matchId) {
      return null;
    }

    return {
      matchId,
      sessionId: String(payload?.pcobSessionId || "").trim() || null,
      source: "me/active-match",
    };
  } catch {
    return null;
  }
}

async function resolveLiveMatchFromOrganizer(apiBase, accessToken) {
  try {
    const tournamentsPayload = await requestAuthedJson(
      apiBase,
      accessToken,
      "/me/tournaments",
    );
    const tournaments = Array.isArray(tournamentsPayload)
      ? tournamentsPayload
      : Array.isArray(tournamentsPayload?.items)
        ? tournamentsPayload.items
        : [];

    const matchLists = await Promise.all(
      tournaments
        .map((tournament) => String(tournament?.id || "").trim())
        .filter(Boolean)
        .map(async (tournamentId) => {
          try {
            const matches = await requestAuthedJson(
              apiBase,
              accessToken,
              `/me/tournaments/${encodeURIComponent(tournamentId)}/matches`,
            );
            return Array.isArray(matches) ? matches : [];
          } catch {
            return [];
          }
        }),
    );

    const liveMatches = matchLists
      .flat()
      .filter((match) => String(match?.id || "").trim())
      .filter(isLiveMatchCandidate)
      .sort(compareMatchRecency);

    const selected = liveMatches[0] || null;
    if (!selected) {
      return null;
    }

    return {
      matchId: String(selected.id).trim(),
      sessionId: String(selected.pcobSessionId || "").trim() || null,
      source: "me/tournaments/:id/matches",
    };
  } catch {
    return null;
  }
}

async function resolveLiveMatch(apiBase, accessToken) {
  const scopedActiveMatch = await resolveLiveMatchFromMe(apiBase, accessToken);
  if (scopedActiveMatch?.matchId) {
    return scopedActiveMatch;
  }

  const pcobLiveMatch = await resolveLiveMatchFromPcob(apiBase, accessToken);
  if (pcobLiveMatch?.matchId) {
    return pcobLiveMatch;
  }

  const organizerLiveMatch = await resolveLiveMatchFromOrganizer(
    apiBase,
    accessToken,
  );
  if (organizerLiveMatch?.matchId) {
    return organizerLiveMatch;
  }

  if (String(accessToken || "").trim()) {
    return {
      matchId: null,
      sessionId: null,
      source: "scoped-active-match",
    };
  }

  const publicLiveMatch = await requestJson(`${apiBase}/public/live-match`);
  return {
    matchId: String(publicLiveMatch?.matchId || "").trim() || null,
    sessionId: null,
    source: "public/live-match",
  };
}

async function getBoundSessionId(apiBase, accessToken, matchId) {
  try {
    const control = await requestJson(
      `${apiBase}/me/matches/${encodeURIComponent(matchId)}/control`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    const sessionId = String(
      control?.binding?.sessionId || control?.pcobSessionId || "",
    ).trim();
    return sessionId || null;
  } catch {
    return null;
  }
}

async function ensureMatchControlStarted(
  apiBase,
  accessToken,
  matchId,
  sessionId,
) {
  await requestJson(
    `${apiBase}/me/matches/${encodeURIComponent(matchId)}/control/start`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionId }),
    },
  );
}

async function isLocalObserverReady() {
  try {
    const response = await fetch(`${LOCAL_OBSERVER_BASE}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return new Promise((resolve) => {
      const socket = net.createConnection({
        host: "127.0.0.1",
        port: 10086,
      });
      let settled = false;
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(300);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }
}

async function waitForLocalObserverReady(timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isLocalObserverReady()) {
      return true;
    }
    await delay(250);
  }
  return false;
}

async function main() {
  if (!fs.existsSync(SESSION_PATH)) {
    fail(`Launcher session not found at ${SESSION_PATH}`);
  }

  if (!fs.existsSync(OB_SCRIPT_PATH)) {
    fail(`ob.js not found at ${OB_SCRIPT_PATH}`);
  }

  if (await isLocalObserverReady()) {
    console.log(`ob.js is already listening on ${LOCAL_OBSERVER_BASE}`);
    return;
  }

  const session = readJson(SESSION_PATH, {});
  const config = readJson(CONFIG_PATH, {});
  const accessToken = decodeSecret(
    session.accessToken || session.token,
    session.accessTokenEncrypted ?? session.encrypted,
  );
  if (!accessToken) {
    fail("Could not decrypt launcher access token.");
  }

  const apiBase = String(config.apiBase || DEFAULT_API_BASE)
    .trim()
    .replace(/\/$/, "");
  const liveMatch =
    process.argv[2] && String(process.argv[2]).trim()
      ? {
          matchId: String(process.argv[2]).trim(),
          sessionId: null,
          source: "argv",
        }
      : await resolveLiveMatch(apiBase, accessToken);
  const matchId = String(liveMatch?.matchId || "").trim();
  if (!matchId) {
    fail("Backend did not return a live match id.");
  }

  const resolvedSessionId =
    String(liveMatch?.sessionId || "").trim() ||
    (await getBoundSessionId(apiBase, accessToken, matchId)) ||
    randomUUID();
  await ensureMatchControlStarted(
    apiBase,
    accessToken,
    matchId,
    resolvedSessionId,
  );
  const sessionId =
    (await getBoundSessionId(apiBase, accessToken, matchId)) ||
    resolvedSessionId;

  const tokenBundle = await requestJson(
    `${apiBase}/launcher/observer-feed-token`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const feedToken = String(tokenBundle?.accessToken || "").trim();
  if (!feedToken) {
    fail("Backend did not return an observer feed token.");
  }

  const nodeBinary = resolveNodeBinary();
  const child = spawn(nodeBinary, [OB_SCRIPT_PATH], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: "10086",
      FORWARD_ENABLE: "false",
      OBSERVER_FORWARD_ENABLE: "true",
      API_BASE_URL: apiBase,
      MATCH_ID: matchId,
      OBSERVER_SESSION_ID: sessionId,
      ARENZYRA_OBSERVER_FEED_TOKEN: feedToken,
    },
  });
  child.unref();

  const ready = await waitForLocalObserverReady();
  if (!ready) {
    fail(
      `ob.js did not become ready on ${LOCAL_OBSERVER_BASE}. Spawned PID ${
        child.pid || "unknown"
      }.`,
    );
  }

  console.log(
    JSON.stringify({
      ok: true,
      pid: child.pid ?? null,
      matchId,
      sessionId,
      apiBase,
      source: liveMatch?.source || null,
      port: 10086,
      expiresIn: tokenBundle?.expiresIn ?? null,
    }),
  );
}

main().catch((error) => {
  fail(error && error.message ? error.message : String(error));
});
