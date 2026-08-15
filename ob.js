/**
 * ObTools forwarder / logger
 * - Receives PUBG observer POST payloads on port 10086
 * - Forwards the parsed payloads to the Flask shadow receiver
 * - Keeps the original handlers intact by reusing the parsed body
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const os = require("os");

function requireConnectorDependency(packageName) {
  if (process.env.ARENZYRA_MANAGED_CONNECTOR !== "1") {
    return require(packageName);
  }

  let dependencyRoots;
  try {
    dependencyRoots = JSON.parse(
      String(process.env.ARENZYRA_CONNECTOR_DEPENDENCY_MAP || ""),
    );
  } catch {
    throw new Error("Managed connector dependency map is invalid.");
  }
  if (
    !dependencyRoots ||
    typeof dependencyRoots !== "object" ||
    Array.isArray(dependencyRoots)
  ) {
    throw new Error("Managed connector dependency map is required.");
  }
  const packagePath = String(dependencyRoots[packageName] || "").trim();
  if (!packagePath || !path.isAbsolute(packagePath)) {
    throw new Error(
      `Managed connector dependency path is invalid: ${packageName}`,
    );
  }
  return require(path.resolve(packagePath));
}

const express = requireConnectorDependency("express");
const axios = requireConnectorDependency("axios");

function resolveConnectorModulePath(fileName) {
  const candidates = [
    path.join(__dirname, fileName),
    path.join(__dirname, "apps", "desktop", "electron", fileName),
    process.resourcesPath
      ? path.join(process.resourcesPath, "connectors", fileName)
      : "",
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Connector helper not found: ${fileName}. Checked: ${candidates
      .filter(Boolean)
      .join(", ")}`,
  );
}

const {
  createDirectObserverTransportState,
} = require(resolveConnectorModulePath("direct-observer-transport-payload.cjs"));
const {
  buildObserverRuntimeIdentity,
} = require(resolveConnectorModulePath("observer-runtime-health.cjs"));
const {
  CONNECTOR_TOKEN_HEADER,
  createConnectorHttpAccessPolicy,
} = require(resolveConnectorModulePath("connector-http-access-policy.cjs"));

const HOST = String(process.env.HOST || process.env.BIND_HOST || "127.0.0.1").trim() || "127.0.0.1";
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
const OBSERVER_FORWARD_LOG_PATH = String(
  process.env.OBSERVER_FORWARD_LOG_PATH || "",
).trim();
const MATCH_ID = String(
  process.env.MATCH_ID || process.env.OBSERVER_MATCH_ID || process.env.PCOB_MATCH_ID || "",
).trim();
const SESSION_ID = String(
  process.env.OBSERVER_SESSION_ID || process.env.SESSION_ID || "",
).trim();
const FORCED_MAP_NAME = String(
  process.env.ARENZYRA_FORCE_MAP_KEY ||
    process.env.ARENZYRA_MAP_KEY ||
    process.env.OBSERVER_MAP_NAME ||
    process.env.OBSERVER_MAP_KEY ||
    process.env.MATCH_MAP_NAME ||
    process.env.MAP_NAME ||
    "",
).trim();
const PCOB_RUNTIME_MAP_KEY_MAX_LENGTH = 32;
const PCOB_RUNTIME_MAP_CONTROL_MAX_BODY_BYTES = 1_024;
let runtimeFallbackMap = null;
const TELEMETRY_INTERVAL_MS = boundedIntegerEnv(
  "OBSERVER_TELEMETRY_INTERVAL_MS",
  1_000,
  100,
  10_000,
);
const TELEMETRY_TIMEOUT_MS = Math.min(
  30_000,
  Math.max(
    250,
    Number.isFinite(Number(process.env.OBSERVER_TELEMETRY_TIMEOUT_MS))
      ? Math.trunc(Number(process.env.OBSERVER_TELEMETRY_TIMEOUT_MS))
      : 5_000,
  ),
);
const TELEMETRY_RETRY_DELAY_MS = 1000;
const OBSERVER_TELEMETRY_REQUEST_SAFE_BYTES = 9 * 1024 * 1024;
const MAX_ROUTE_PAYLOADS = 40;
const MAX_HANDLER_BATCH_SIZE = 2;
const PCOB_MAX_BODY_BYTES = boundedIntegerEnv(
  "PCOB_MAX_BODY_BYTES",
  16 * 1024 * 1024,
  64 * 1024,
  16 * 1024 * 1024,
);
const PCOB_RAW_EVENT_CAPTURE_REQUESTED =
  (process.env.PCOB_RAW_EVENT_CAPTURE_ENABLE ?? "true").toLowerCase() !== "false";
const PCOB_RAW_EVENT_CAPTURE_ENABLE =
  PCOB_RAW_EVENT_CAPTURE_REQUESTED && Boolean(MATCH_ID && SESSION_ID);
const PCOB_EVENT_SPOOL_MAX_BYTES = boundedIntegerEnv(
  "PCOB_EVENT_SPOOL_MAX_BYTES",
  256 * 1024 * 1024,
  4 * 1024 * 1024,
  1024 * 1024 * 1024,
);
const PCOB_EVENT_SPOOL_MAX_EVENTS = boundedIntegerEnv(
  "PCOB_EVENT_SPOOL_MAX_EVENTS",
  100_000,
  100,
  1_000_000,
);
const PCOB_EVENT_SPOOL_RETENTION_MS = boundedIntegerEnv(
  "PCOB_EVENT_SPOOL_RETENTION_MS",
  24 * 60 * 60 * 1000,
  60_000,
  30 * 24 * 60 * 60 * 1000,
);
const PCOB_RAW_EVENT_BATCH_SIZE = boundedIntegerEnv(
  "PCOB_RAW_EVENT_BATCH_SIZE",
  64,
  1,
  500,
);
const PCOB_RAW_EVENT_BATCH_MAX_BYTES = boundedIntegerEnv(
  "PCOB_RAW_EVENT_BATCH_MAX_BYTES",
  7 * 1024 * 1024,
  64 * 1024,
  8 * 1024 * 1024,
);
const PCOB_RAW_EVENT_ENCODED_MAX_BYTES = boundedIntegerEnv(
  "PCOB_RAW_EVENT_ENCODED_MAX_BYTES",
  6 * 1024 * 1024,
  64 * 1024,
  8 * 1024 * 1024,
);
const PCOB_RAW_EVENT_INLINE_MAX_BYTES = boundedIntegerEnv(
  "PCOB_RAW_EVENT_INLINE_MAX_BYTES",
  512 * 1024,
  16 * 1024,
  2 * 1024 * 1024,
);
const PCOB_RAW_EVENT_GZIP_THRESHOLD_BYTES = boundedIntegerEnv(
  "PCOB_RAW_EVENT_GZIP_THRESHOLD_BYTES",
  64 * 1024,
  1024,
  2 * 1024 * 1024,
);
const PCOB_RAW_EVENT_PAYLOAD_MAX_BYTES = boundedIntegerEnv(
  "PCOB_RAW_EVENT_PAYLOAD_MAX_BYTES",
  256 * 1024,
  4 * 1024,
  2 * 1024 * 1024,
);
const PCOB_OUT_OF_GAME_RESET_DEBOUNCE_MS = boundedIntegerEnv(
  "PCOB_OUT_OF_GAME_RESET_DEBOUNCE_MS",
  3_000,
  250,
  30_000,
);
const PCOB_EVENT_SPOOL_METADATA_RESERVE_BYTES = 64 * 1024;
const PCOB_RAW_EVENT_REQUEST_TARGET_MAX_BYTES = 16 * 1024;
const PCOB_RAW_EVENT_BATCH_ORIGINAL_MAX_BYTES = 32 * 1024 * 1024;
const PCOB_CONNECTOR_TOKEN =
  String(process.env.ARENZYRA_PCOB_CONNECTOR_TOKEN || "").trim() ||
  crypto.randomBytes(32).toString("hex");
// Keep handler work bounded without coalescing packets by route. PCOB can emit
// several event packets for the same endpoint in one event-loop turn (kills,
// revives, assists, and similar routes); a Map keyed by route silently replaced
// the earlier packets before the handler drain ran.
const MAX_PENDING_HANDLER_EVENTS = 2_048;
const MAX_PENDING_HANDLER_BYTES = 64 * 1024 * 1024;
const PENDING_HANDLER_OVERFLOW_LOG_INTERVAL_MS = 5_000;
const REJECTED_LOCAL_PROJECTION_DEDUPE_MS = 10_000;
const MAX_REJECTED_LOCAL_PROJECTION_KEYS = 2_048;
// Admission failures may still feed local/backend widgets, but only through
// routes whose payload represents replaceable current state. Transient combat,
// achievement, and unknown packets must wait for durable raw admission; if
// projected here and then retried successfully, they could be applied twice.
const REJECTED_LOCAL_PROJECTION_STATE_ROUTES = new Set([
  "/totalmessage",
  "/setcircleinfo",
  "/setgameglobalinfo",
  "/setobservingplayer",
  "/setteaminfolist",
  "/settotalplayerlist",
  "/setteambackpackinfo",
  "/setisingame",
]);
const MAX_PENDING_FORWARD_EVENTS = 2_048;
const MAX_PENDING_FORWARD_BYTES = 64 * 1024 * 1024;
const MAX_DIRECT_ACHIEVEMENT_EVENTS = 50;
const DIRECT_ACHIEVEMENT_STREAK_WINDOW_MS = 8_000;
const FALLBACK_KILL_EVENT_GAP_MS = DIRECT_ACHIEVEMENT_STREAK_WINDOW_MS + 1_000;
const ACHIEVEMENT_EVENT_TIMESTAMP_FLOOR_MS = Date.parse("2020-01-01T00:00:00.000Z");
const FIRST_BLOOD_MAX_RELATIVE_TIME_SECONDS = 8 * 60;
const DIRECT_OBSERVER_LIVE_STALE_MS = 120_000;
const DIRECT_BACKPACK_CACHE_TTL_MS = Math.max(
  0,
  Math.trunc(Number(process.env.OBSERVER_BACKPACK_CACHE_TTL_MS ?? 1_800_000)),
);
const DIRECT_BACKPACK_SEEN_AT_MS_KEY = "__arenzyraBackpackSeenAtMs";
const DIRECT_BACKPACK_SEEN_AT_KEY = "__arenzyraBackpackSeenAt";
const VERBOSE_LOG = (process.env.OBTOOLS_VERBOSE_LOG ?? "false").toLowerCase() === "true";

function boundedIntegerEnv(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function writeObserverForwardLog(level, message, meta = {}) {
  const normalizedLevel = level === "error" || level === "warn" ? level : "info";
  const consoleMethod =
    normalizedLevel === "error"
      ? console.error
      : normalizedLevel === "warn"
        ? console.warn
        : console.log;
  consoleMethod(message);

  if (!OBSERVER_FORWARD_LOG_PATH) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level: normalizedLevel,
    scope: "observer-forward",
    message,
    meta,
    target: path.basename(OBSERVER_FORWARD_LOG_PATH),
  };
  fs.appendFile(
    OBSERVER_FORWARD_LOG_PATH,
    `${JSON.stringify(entry)}\n`,
    () => {},
  );
}
const PCOB_RAW_EVENT_SCHEMA = "arenzyra.pcobRawEvents.v1";
const PCOB_RAW_EVENT_ACK_SCHEMA = "arenzyra.pcobRawEventsAck.v1";
const PCOB_RAW_EVENT_PAGE_SCHEMA = "arenzyra.pcobRawEventPage.v1";
const PCOB_RAW_EVENT_RECORD_SCHEMA = "arenzyra.pcobRawEvent.v1";
const PCOB_RAW_EVENT_HEADER_DENYLIST = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
]);
const PCOB_RAW_EVENT_HEADER_ALLOWLIST = new Set(
  String(
    process.env.PCOB_RAW_EVENT_HEADER_ALLOWLIST ||
      "content-type,content-length,user-agent,x-request-id,x-correlation-id,x-pcob-version",
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && !PCOB_RAW_EVENT_HEADER_DENYLIST.has(value)),
);

function safeSpoolPathSegment(value, fallback = "default") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function defaultPcobEventSpoolBaseDirectory() {
  const root =
    String(process.env.LOCALAPPDATA || process.env.APPDATA || process.env.TEMP || "").trim() ||
    os.tmpdir();
  return path.join(root, "Arenzyra", "pcob-event-spool");
}

const PCOB_EVENT_SPOOL_BASE_DIR = path.resolve(
  String(process.env.PCOB_EVENT_SPOOL_DIR || "").trim() ||
    defaultPcobEventSpoolBaseDirectory(),
);
const PCOB_EVENT_SPOOL_BINDING = [
  MATCH_ID || "no-match",
  SESSION_ID || "no-session",
].join("--");
const PCOB_EVENT_SPOOL_BINDING_HASH = crypto
  .createHash("sha256")
  .update(PCOB_EVENT_SPOOL_BINDING)
  .digest("hex")
  .slice(0, 12);

function resolvePcobEventSpoolDirectory() {
  return path.join(
    PCOB_EVENT_SPOOL_BASE_DIR,
    `${safeSpoolPathSegment(PCOB_EVENT_SPOOL_BINDING)}-${PCOB_EVENT_SPOOL_BINDING_HASH}`,
  );
}

const PCOB_EVENT_SPOOL_DIR = resolvePcobEventSpoolDirectory();

function fsyncDirectoryBestEffort(directory) {
  if (process.platform === "win32") {
    return;
  }
  let descriptor = null;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch {
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
  }
}

function atomicWriteFileSync(targetPath, data) {
  const directory = path.dirname(targetPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporaryPath, "w", 0o600);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    try {
      fs.renameSync(temporaryPath, targetPath);
    } catch (error) {
      if (!fs.existsSync(targetPath)) {
        throw error;
      }
      const backupPath = `${targetPath}.replace-${process.pid}`;
      try {
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        fs.renameSync(targetPath, backupPath);
        fs.renameSync(temporaryPath, targetPath);
        fs.unlinkSync(backupPath);
      } catch (replacementError) {
        if (!fs.existsSync(targetPath) && fs.existsSync(backupPath)) {
          fs.renameSync(backupPath, targetPath);
        }
        throw replacementError;
      }
    }
    fsyncDirectoryBestEffort(directory);
  } finally {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    if (fs.existsSync(temporaryPath)) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {}
    }
  }
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

function captureAllowedPcobHeaders(headers) {
  const captured = {};
  const source = headers && typeof headers === "object" ? headers : {};
  for (const name of PCOB_RAW_EVENT_HEADER_ALLOWLIST) {
    const value = normalizeHeaderValue(source[name]);
    if (value !== null) {
      captured[name] = value;
    }
  }
  return captured;
}

function rawEventPayloadShape(payload) {
  if (Array.isArray(payload)) {
    return { payloadType: "array", payloadTopLevelKeys: [] };
  }
  if (payload && typeof payload === "object") {
    return {
      payloadType: "object",
      payloadTopLevelKeys: Object.keys(payload).slice(0, 64),
    };
  }
  return { payloadType: payload === null ? "null" : typeof payload, payloadTopLevelKeys: [] };
}

function defineRawEventStoredBytes(event, byteLength) {
  Object.defineProperty(event, "_storedBytes", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: byteLength,
  });
  return event;
}

function isStrictChildPath(baseDirectory, candidatePath) {
  const relative = path.relative(path.resolve(baseDirectory), path.resolve(candidatePath));
  return Boolean(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
  );
}

function normalizedPathForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function regularFileBytesUnder(directory, depth = 0) {
  if (depth > 4) {
    return 0;
  }
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    try {
      if (entry.isFile()) {
        total += fs.statSync(candidate).size;
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
        total += regularFileBytesUnder(candidate, depth + 1);
      } else if (entry.isSymbolicLink()) {
        total += fs.lstatSync(candidate).size;
      }
    } catch {}
  }
  return total;
}

function inspectPcobSpoolBase(baseDirectory, activeDirectory) {
  const result = {
    inactiveBytes: 0,
    inactiveDirectories: 0,
    activeAuxiliaryBytes: 0,
  };
  if (!fs.existsSync(baseDirectory)) {
    return result;
  }
  const activeResolved = normalizedPathForComparison(activeDirectory);
  for (const entry of fs.readdirSync(baseDirectory, { withFileTypes: true })) {
    const candidate = path.resolve(baseDirectory, entry.name);
    if (!isStrictChildPath(baseDirectory, candidate)) {
      continue;
    }
    if (normalizedPathForComparison(candidate) === activeResolved) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        for (const child of fs.readdirSync(candidate, { withFileTypes: true })) {
          if (child.name === "metadata.json" || child.name === "events.ndjson") {
            continue;
          }
          const childPath = path.join(candidate, child.name);
          try {
            result.activeAuxiliaryBytes += child.isDirectory()
              ? regularFileBytesUnder(childPath)
              : fs.lstatSync(childPath).size;
          } catch {}
        }
      }
      continue;
    }
    if (entry.isFile()) {
      try {
        result.inactiveBytes += fs.statSync(candidate).size;
      } catch {}
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      try {
        result.inactiveBytes += fs.lstatSync(candidate).size;
      } catch {}
      continue;
    }
    result.inactiveDirectories += 1;
    result.inactiveBytes += regularFileBytesUnder(candidate);
  }
  return result;
}

function archivedPcobSpoolCanBeRemoved(directory, retentionMs, nowMs) {
  const metadataPath = path.join(directory, "metadata.json");
  const journalPath = path.join(directory, "events.ndjson");
  let entries;
  try {
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      return false;
    }
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  const names = new Set(entries.map((entry) => entry.name));
  if (
    entries.some((entry) => entry.isSymbolicLink()) ||
    names.size !== 2 ||
    !names.has("metadata.json") ||
    !names.has("events.ndjson")
  ) {
    return false;
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    const closedAtMs = timestampMsValue(metadata?.closedAt);
    const next = numberValue(metadata?.nextSequence);
    const acknowledged = numberValue(metadata?.acknowledgedSequence);
    if (
      metadata?.schema !== "arenzyra.pcobEventSpoolMetadata.v1" ||
      !textValue(metadata?.streamId) ||
      closedAtMs === null ||
      nowMs - closedAtMs < retentionMs ||
      next === null ||
      acknowledged === null ||
      !Number.isSafeInteger(next) ||
      !Number.isSafeInteger(acknowledged) ||
      next < 1 ||
      acknowledged < next - 1
    ) {
      return false;
    }

    const journal = fs.readFileSync(journalPath);
    if (journal.length > 0 && journal[journal.length - 1] !== 0x0a) {
      return false;
    }
    let previousSequence = null;
    for (const line of journal.toString("utf8").split(/\r?\n/)) {
      if (!line) {
        continue;
      }
      const event = JSON.parse(line);
      const body = Buffer.from(event?.rawBodyBase64 || "", "base64");
      const expectedEventId =
        typeof event?.streamId === "string" &&
        Number.isSafeInteger(event?.sequence) &&
        typeof event?.receivedAt === "string" &&
        typeof event?.method === "string" &&
        typeof event?.requestTarget === "string" &&
        typeof event?.bodySha256 === "string"
          ? crypto
              .createHash("sha256")
              .update(
                `${event.streamId}\n${event.sequence}\n${event.receivedAt}\n${event.method}\n${event.requestTarget}\n${event.bodySha256}`,
              )
              .digest("hex")
          : null;
      if (
        event?.schema !== PCOB_RAW_EVENT_RECORD_SCHEMA ||
        event.streamId !== metadata.streamId ||
        !Number.isSafeInteger(event.sequence) ||
        event.sequence < 1 ||
        event.sequence > acknowledged ||
        (previousSequence !== null && event.sequence !== previousSequence + 1) ||
        body.toString("base64") !== event.rawBodyBase64 ||
        body.length !== event.rawBodyBytes ||
        crypto.createHash("sha256").update(body).digest("hex") !== event.bodySha256 ||
        event.eventId !== expectedEventId
      ) {
        return false;
      }
      previousSequence = event.sequence;
    }
    if (previousSequence !== null && previousSequence !== next - 1) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function cleanupArchivedPcobSpools(
  baseDirectory,
  activeDirectory,
  retentionMs,
  options = {},
) {
  const result = { removedDirectories: 0, removedBytes: 0, skippedDirectories: 0 };
  const resolvedBase = path.resolve(baseDirectory);
  if (
    resolvedBase === path.parse(resolvedBase).root ||
    !fs.existsSync(resolvedBase)
  ) {
    return result;
  }
  const effectiveRetentionMs = options.ignoreRetention === true ? 0 : retentionMs;
  const minimumBytesToRemove = Math.max(
    0,
    Math.trunc(numberValue(options.minimumBytesToRemove) ?? 0),
  );
  const activeResolved = normalizedPathForComparison(activeDirectory);
  const nowMs = Date.now();
  let entries;
  try {
    entries = fs.readdirSync(resolvedBase, { withFileTypes: true });
  } catch {
    return result;
  }
  const removable = [];
  for (const entry of entries) {
    const candidate = path.resolve(resolvedBase, entry.name);
    if (
      normalizedPathForComparison(candidate) === activeResolved ||
      !isStrictChildPath(resolvedBase, candidate) ||
      !entry.isDirectory() ||
      entry.isSymbolicLink()
    ) {
      continue;
    }
    if (!archivedPcobSpoolCanBeRemoved(candidate, effectiveRetentionMs, nowMs)) {
      result.skippedDirectories += 1;
      continue;
    }
    const metadataPath = path.join(candidate, "metadata.json");
    const journalPath = path.join(candidate, "events.ndjson");
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      removable.push({
        candidate,
        metadataPath,
        journalPath,
        closedAtMs: timestampMsValue(metadata?.closedAt) ?? nowMs,
        bytes: fs.statSync(metadataPath).size + fs.statSync(journalPath).size,
      });
    } catch {
      result.skippedDirectories += 1;
    }
  }

  removable.sort(
    (left, right) =>
      left.closedAtMs - right.closedAtMs ||
      left.candidate.localeCompare(right.candidate),
  );
  for (const archive of removable) {
    if (
      minimumBytesToRemove > 0 &&
      result.removedBytes >= minimumBytesToRemove
    ) {
      break;
    }
    try {
      if (
        !archivedPcobSpoolCanBeRemoved(
          archive.candidate,
          effectiveRetentionMs,
          Date.now(),
        )
      ) {
        result.skippedDirectories += 1;
        continue;
      }
      fs.unlinkSync(archive.journalPath);
      fs.unlinkSync(archive.metadataPath);
      fs.rmdirSync(archive.candidate);
      result.removedDirectories += 1;
      result.removedBytes += archive.bytes;
    } catch {
      result.skippedDirectories += 1;
    }
  }
  return result;
}

function createPcobRawEventSpool(options = {}) {
  const enabled = options.enabled !== false;
  const directory = path.resolve(String(options.directory || PCOB_EVENT_SPOOL_DIR));
  const baseDirectory = path.resolve(
    String(options.baseDirectory || path.dirname(directory)),
  );
  const journalPath = path.join(directory, "events.ndjson");
  const metadataPath = path.join(directory, "metadata.json");
  const maxBytes = Math.max(1, Math.trunc(numberValue(options.maxBytes) ?? PCOB_EVENT_SPOOL_MAX_BYTES));
  const metadataReserveBytes = Math.min(
    PCOB_EVENT_SPOOL_METADATA_RESERVE_BYTES,
    Math.max(256, Math.trunc(maxBytes / 16)),
  );
  const maxEvents = Math.max(1, Math.trunc(numberValue(options.maxEvents) ?? PCOB_EVENT_SPOOL_MAX_EVENTS));
  const retentionMs = Math.max(
    1,
    Math.trunc(numberValue(options.retentionMs) ?? PCOB_EVENT_SPOOL_RETENTION_MS),
  );
  const batchSize = Math.max(
    1,
    Math.trunc(numberValue(options.batchSize) ?? PCOB_RAW_EVENT_BATCH_SIZE),
  );
  const batchMaxBytes = Math.max(
    1,
    Math.trunc(numberValue(options.batchMaxBytes) ?? PCOB_RAW_EVENT_BATCH_MAX_BYTES),
  );
  const encodedEventMaxBytes = Math.max(
    1,
    Math.trunc(numberValue(options.encodedEventMaxBytes) ?? PCOB_RAW_EVENT_ENCODED_MAX_BYTES),
  );
  const events = [];
  const routeStats = new Map();
  let descriptor = null;
  let journalBytes = 0;
  let streamId = null;
  let nextSequence = 1;
  let acknowledgedSequence = 0;
  let initializationError = null;
  let maintenanceScheduled = false;
  let closed = false;
  let closedAt = null;
  let lastUndeliverable = null;
  let inactiveSpoolBytes = 0;
  let inactiveSpoolDirectories = 0;
  let activeAuxiliaryBytes = 0;
  let archiveCleanup = {
    removedDirectories: 0,
    removedBytes: 0,
    skippedDirectories: 0,
    pressureRuns: 0,
    pressureRemovedDirectories: 0,
    pressureRemovedBytes: 0,
    pressureSkippedDirectories: 0,
  };
  const counters = {
    captured: 0,
    appendFailures: 0,
    rejectedFull: 0,
    rejectedOversize: 0,
    rejectedParser: 0,
    rejectedRequestTarget: 0,
    rejectedBytes: 0,
    corruptJournalRecords: 0,
    recoveredTrailingBytes: 0,
    recoveredTrailingRecords: 0,
    deliveryAttempts: 0,
    deliveryFailures: 0,
    deliverySuccesses: 0,
    acknowledgements: 0,
    acknowledgementErrors: 0,
    missingAcknowledgements: 0,
    noProgressAcknowledgements: 0,
    partialAcknowledgements: 0,
    compactedEvents: 0,
    compactedBytes: 0,
    compactions: 0,
  };

  function eventStorageRecord(event) {
    return {
      schema: PCOB_RAW_EVENT_RECORD_SCHEMA,
      streamId: event.streamId,
      eventId: event.eventId,
      sequence: event.sequence,
      endpoint: event.endpoint,
      method: event.method,
      receivedAt: event.receivedAt,
      receivedAtMs: event.receivedAtMs,
      requestTarget: event.requestTarget,
      contentType: event.contentType,
      query: event.query,
      headers: event.headers,
      rawBodyEncoding: "identity",
      rawBodyBytes: event.rawBodyBytes,
      rawBodyBase64: event.rawBodyBase64,
      bodySha256: event.bodySha256,
      payloadType: event.payloadType,
      payloadTopLevelKeys: event.payloadTopLevelKeys,
    };
  }

  function eventStorageLine(event) {
    return `${JSON.stringify(eventStorageRecord(event))}\n`;
  }

  function metadataRecord() {
    return {
      schema: "arenzyra.pcobEventSpoolMetadata.v1",
      streamId,
      nextSequence,
      acknowledgedSequence,
      bindingHash: PCOB_EVENT_SPOOL_BINDING_HASH,
      closedAt,
      updatedAt: new Date().toISOString(),
      counters,
    };
  }

  function persistMetadata() {
    if (!enabled || initializationError || closed) {
      return;
    }
    try {
      atomicWriteFileSync(metadataPath, `${JSON.stringify(metadataRecord(), null, 2)}\n`);
    } catch (error) {
      initializationError = "metadata_write_failed";
      counters.appendFailures += 1;
    }
  }

  function updateRouteStats(event) {
    const endpoint = String(event?.endpoint || "/unknown");
    const existing = routeStats.get(endpoint) ?? {
      endpoint,
      retainedEvents: 0,
      firstSequence: null,
      lastSequence: null,
      lastReceivedAt: null,
      payloadTypes: new Set(),
      payloadTopLevelKeys: new Set(),
    };
    existing.retainedEvents += 1;
    existing.firstSequence =
      existing.firstSequence === null
        ? event.sequence
        : Math.min(existing.firstSequence, event.sequence);
    existing.lastSequence =
      existing.lastSequence === null ? event.sequence : Math.max(existing.lastSequence, event.sequence);
    existing.lastReceivedAt = event.receivedAt;
    if (event.payloadType) {
      existing.payloadTypes.add(event.payloadType);
    }
    for (const key of Array.isArray(event.payloadTopLevelKeys)
      ? event.payloadTopLevelKeys.slice(0, 64)
      : []) {
      if (existing.payloadTopLevelKeys.size >= 128) {
        break;
      }
      existing.payloadTopLevelKeys.add(String(key));
    }
    routeStats.set(endpoint, existing);
  }

  function rebuildRouteStats() {
    routeStats.clear();
    for (const event of events) {
      updateRouteStats(event);
    }
  }

  function refreshBaseInspection() {
    try {
      const baseInspection = inspectPcobSpoolBase(baseDirectory, directory);
      inactiveSpoolBytes = baseInspection.inactiveBytes;
      inactiveSpoolDirectories = baseInspection.inactiveDirectories;
      activeAuxiliaryBytes = baseInspection.activeAuxiliaryBytes;
      return true;
    } catch {
      return false;
    }
  }

  function cleanupArchivedSpoolsForPressure(minimumBytesToRemove) {
    const cleanup = cleanupArchivedPcobSpools(
      baseDirectory,
      directory,
      retentionMs,
      {
        ignoreRetention: true,
        minimumBytesToRemove,
      },
    );
    archiveCleanup.removedDirectories += cleanup.removedDirectories;
    archiveCleanup.removedBytes += cleanup.removedBytes;
    archiveCleanup.skippedDirectories += cleanup.skippedDirectories;
    archiveCleanup.pressureRuns += 1;
    archiveCleanup.pressureRemovedDirectories += cleanup.removedDirectories;
    archiveCleanup.pressureRemovedBytes += cleanup.removedBytes;
    archiveCleanup.pressureSkippedDirectories += cleanup.skippedDirectories;
    refreshBaseInspection();
    return cleanup;
  }

  function validateJournalEvent(event, expectedStreamId, previousSequence) {
    if (
      event?.schema !== PCOB_RAW_EVENT_RECORD_SCHEMA ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 1 ||
      typeof event.streamId !== "string" ||
      !event.streamId ||
      (expectedStreamId && event.streamId !== expectedStreamId) ||
      (previousSequence !== null && event.sequence !== previousSequence + 1) ||
      typeof event.eventId !== "string" ||
      !event.eventId ||
      typeof event.rawBodyBase64 !== "string" ||
      event.rawBodyEncoding !== "identity" ||
      typeof event.bodySha256 !== "string" ||
      typeof event.requestTarget !== "string" ||
      typeof event.receivedAt !== "string" ||
      typeof event.method !== "string"
    ) {
      throw new Error("invalid journal record");
    }
    const body = Buffer.from(event.rawBodyBase64, "base64");
    if (
      body.toString("base64") !== event.rawBodyBase64 ||
      body.length !== event.rawBodyBytes ||
      crypto.createHash("sha256").update(body).digest("hex") !== event.bodySha256
    ) {
      throw new Error("journal body integrity mismatch");
    }
    const expectedEventId = crypto
      .createHash("sha256")
      .update(
        `${event.streamId}\n${event.sequence}\n${event.receivedAt}\n${event.method}\n${event.requestTarget}\n${event.bodySha256}`,
      )
      .digest("hex");
    if (event.eventId !== expectedEventId) {
      throw new Error("journal event identity mismatch");
    }
  }

  function loadJournal(expectedStreamId) {
    if (!fs.existsSync(journalPath)) {
      return;
    }
    const raw = fs.readFileSync(journalPath);
    let offset = 0;
    let lastCompleteOffset = 0;
    let previousSequence = null;
    let journalStreamId = expectedStreamId || null;
    while (offset < raw.length) {
      const newlineOffset = raw.indexOf(0x0a, offset);
      if (newlineOffset < 0) {
        break;
      }
      const lineBuffer = raw.subarray(offset, newlineOffset);
      const line = lineBuffer.toString("utf8").replace(/\r$/, "");
      try {
        const event = JSON.parse(line);
        validateJournalEvent(event, journalStreamId, previousSequence);
        journalStreamId = journalStreamId || event.streamId;
        defineRawEventStoredBytes(event, newlineOffset + 1 - offset);
        events.push(event);
        previousSequence = event.sequence;
      } catch (error) {
        counters.corruptJournalRecords += 1;
        throw new Error(
          `journal_corrupt_at_record_${events.length + 1}:${error?.message || error}`,
        );
      }
      offset = newlineOffset + 1;
      lastCompleteOffset = offset;
    }
    if (lastCompleteOffset < raw.length) {
      const recoveredBytes = raw.length - lastCompleteOffset;
      fs.truncateSync(journalPath, lastCompleteOffset);
      counters.recoveredTrailingBytes += recoveredBytes;
      counters.recoveredTrailingRecords += 1;
    }
    journalBytes = lastCompleteOffset;
  }

  function initialize() {
    if (!enabled) {
      streamId = `disabled-${crypto.randomUUID()}`;
      return;
    }
    try {
      fs.mkdirSync(baseDirectory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") {
        fs.chmodSync(baseDirectory, 0o700);
      }
      if (!isStrictChildPath(baseDirectory, directory)) {
        throw new Error("active_spool_must_be_a_direct_child_of_base");
      }
      archiveCleanup = {
        ...archiveCleanup,
        ...cleanupArchivedPcobSpools(
          baseDirectory,
          directory,
          retentionMs,
        ),
      };
      refreshBaseInspection();
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") {
        fs.chmodSync(directory, 0o700);
      }
      let metadata = null;
      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        } catch (error) {
          counters.corruptJournalRecords += 1;
          throw new Error(`metadata_corrupt:${error?.message || error}`);
        }
        if (
          metadata?.schema !== "arenzyra.pcobEventSpoolMetadata.v1" ||
          (metadata.bindingHash &&
            metadata.bindingHash !== PCOB_EVENT_SPOOL_BINDING_HASH)
        ) {
          throw new Error("metadata_binding_or_schema_mismatch");
        }
      }
      if (metadata?.counters && typeof metadata.counters === "object") {
        for (const key of Object.keys(counters)) {
          const value = numberValue(metadata.counters[key]);
          if (value !== null) {
            counters[key] = Math.max(0, Math.trunc(value));
          }
        }
      }
      acknowledgedSequence = Math.max(
        0,
        Math.trunc(numberValue(metadata?.acknowledgedSequence) ?? 0),
      );
      streamId = textValue(metadata?.streamId);
      loadJournal(streamId);
      if (!streamId && events.length > 0) {
        streamId = textValue(events[0]?.streamId);
      }
      streamId = streamId || `pcob-${crypto.randomUUID()}`;
      const highestSequence = events.reduce(
        (maximum, event) => Math.max(maximum, event.sequence),
        0,
      );
      const metadataNextSequence = Math.max(
        1,
        Math.trunc(numberValue(metadata?.nextSequence) ?? 1),
      );
      if (events.length > 0) {
        const firstSequence = events[0].sequence;
        if (
          (firstSequence !== 1 && firstSequence !== acknowledgedSequence + 1) ||
          metadataNextSequence >
            Math.max(highestSequence, acknowledgedSequence) + 1
        ) {
          throw new Error("journal_sequence_gap_or_cursor_mismatch");
        }
        nextSequence = Math.max(highestSequence, acknowledgedSequence) + 1;
      } else {
        if (metadataNextSequence > acknowledgedSequence + 1) {
          throw new Error("journal_missing_unacknowledged_tail");
        }
        nextSequence = acknowledgedSequence + 1;
      }
      closedAt = null;
      rebuildRouteStats();
      descriptor = fs.openSync(journalPath, "a", 0o600);
      persistMetadata();
      if (process.platform !== "win32") {
        fs.chmodSync(journalPath, 0o600);
        if (fs.existsSync(metadataPath)) {
          fs.chmodSync(metadataPath, 0o600);
        }
      }
    } catch (error) {
      initializationError = "spool_init_failed";
      try {
        if (descriptor !== null) {
          fs.closeSync(descriptor);
        }
      } catch {}
      descriptor = null;
    }
  }

  function closeDescriptor() {
    if (descriptor === null) {
      return;
    }
    try {
      fs.fsyncSync(descriptor);
    } catch {}
    try {
      fs.closeSync(descriptor);
    } catch {}
    descriptor = null;
  }

  function compactAcknowledged(options = {}) {
    if (!enabled || initializationError || closed || acknowledgedSequence <= 0) {
      return false;
    }
    const force = options.force === true;
    const nowMs = Date.now();
    const acknowledged = events.filter((event) => event.sequence <= acknowledgedSequence);
    if (acknowledged.length === 0) {
      return false;
    }
    const acknowledgedBytes = acknowledged.reduce(
      (total, event) => total + Math.max(0, Math.trunc(event._storedBytes || 0)),
      0,
    );
    const oldestAcknowledgedMs = acknowledged.reduce((oldest, event) => {
      const value = timestampMsValue(event.receivedAtMs ?? event.receivedAt) ?? nowMs;
      return Math.min(oldest, value);
    }, nowMs);
    const retentionElapsed = nowMs - oldestAcknowledgedMs >= retentionMs;
    const meaningfulFraction = acknowledgedBytes * 2 >= Math.max(1, journalBytes);
    const thresholdReached = acknowledgedBytes >= 64 * 1024 * 1024 && meaningfulFraction;
    if (!force && !retentionElapsed && !thresholdReached) {
      return false;
    }

    const retained = events.filter((event) => event.sequence > acknowledgedSequence);
    const contents = retained.map((event) => eventStorageLine(event)).join("");
    try {
      closeDescriptor();
      atomicWriteFileSync(journalPath, contents);
      events.length = 0;
      events.push(...retained);
      journalBytes = Buffer.byteLength(contents);
      for (const event of events) {
        defineRawEventStoredBytes(event, Buffer.byteLength(eventStorageLine(event)));
      }
      counters.compactedEvents += acknowledged.length;
      counters.compactedBytes += acknowledgedBytes;
      counters.compactions += 1;
      rebuildRouteStats();
      descriptor = fs.openSync(journalPath, "a", 0o600);
      persistMetadata();
      return true;
    } catch (error) {
      initializationError = "spool_compaction_failed";
      counters.appendFailures += 1;
      return false;
    }
  }

  function scheduleMaintenance() {
    if (maintenanceScheduled || closed || !enabled) {
      return;
    }
    maintenanceScheduled = true;
    setImmediate(() => {
      maintenanceScheduled = false;
      compactAcknowledged();
    });
  }

  function recordRejection(kind, byteLength = 0) {
    if (kind === "oversize") {
      counters.rejectedOversize += 1;
    } else if (kind === "parser") {
      counters.rejectedParser += 1;
    } else if (kind === "request_target") {
      counters.rejectedRequestTarget += 1;
    } else {
      counters.rejectedFull += 1;
    }
    counters.rejectedBytes += Math.max(0, Math.trunc(numberValue(byteLength) ?? 0));
    persistMetadata();
  }

  function appendRequest({ method, endpoint, originalUrl, headers, rawBody, receivedAtMs } = {}) {
    if (!enabled) {
      return { ok: true, captured: false, event: null };
    }
    if (initializationError || descriptor === null || closed) {
      counters.appendFailures += 1;
      return {
        ok: false,
        status: 503,
        error: initializationError || "raw_event_spool_unavailable",
      };
    }
    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
    if (body.length > PCOB_MAX_BODY_BYTES) {
      recordRejection("oversize", body.length);
      return { ok: false, status: 413, error: "pcob_body_too_large" };
    }
    const timestampMs = Math.trunc(numberValue(receivedAtMs) ?? Date.now());
    const receivedAt = new Date(timestampMs).toISOString();
    const target = String(originalUrl || endpoint || "/");
    const targetBytes = Buffer.byteLength(target);
    if (targetBytes > PCOB_RAW_EVENT_REQUEST_TARGET_MAX_BYTES) {
      recordRejection("request_target", targetBytes);
      return { ok: false, status: 414, error: "pcob_request_target_too_large" };
    }
    const querySeparator = target.indexOf("?");
    const query = querySeparator >= 0 ? target.slice(querySeparator + 1) : "";
    const normalizedEndpoint = String(endpoint || target.split("?", 1)[0] || "/");
    const bodySha256 = crypto.createHash("sha256").update(body).digest("hex");
    const sequence = nextSequence;
    const eventId = crypto
      .createHash("sha256")
      .update(`${streamId}\n${sequence}\n${receivedAt}\n${String(method || "POST")}\n${target}\n${bodySha256}`)
      .digest("hex");
    const parsedPayload = parsePcobRawBuffer(body);
    const payloadShape = rawEventPayloadShape(parsedPayload);
    const event = {
      schema: PCOB_RAW_EVENT_RECORD_SCHEMA,
      streamId,
      eventId,
      sequence,
      endpoint: normalizedEndpoint,
      method: String(method || "POST").toUpperCase(),
      receivedAt,
      receivedAtMs: timestampMs,
      requestTarget: target,
      contentType: textValue(headers?.["content-type"]) ?? null,
      query,
      headers: captureAllowedPcobHeaders(headers),
      rawBodyEncoding: "identity",
      rawBodyBytes: body.length,
      rawBodyBase64: body.toString("base64"),
      bodySha256,
      ...payloadShape,
    };
    const candidateTransport = transportEvent(event);
    const candidateEnvelopeBytes = Buffer.byteLength(
      JSON.stringify({
        schema: PCOB_RAW_EVENT_SCHEMA,
        streamId,
        firstSequence: sequence,
        lastSequence: sequence,
        events: [candidateTransport.output],
      }),
    );
    if (
      candidateTransport.encodedBytes > encodedEventMaxBytes ||
      candidateEnvelopeBytes > batchMaxBytes
    ) {
      recordRejection("oversize", body.length);
      return {
        ok: false,
        status: 413,
        error: "pcob_event_not_deliverable_within_transport_limits",
      };
    }
    const line = eventStorageLine(event);
    const storedBytes = Buffer.byteLength(line);

    const projectedBaseBytes =
      inactiveSpoolBytes +
      activeAuxiliaryBytes +
      journalBytes +
      storedBytes +
      metadataReserveBytes;
    if (events.length + 1 > maxEvents || projectedBaseBytes > maxBytes) {
      compactAcknowledged({ force: true });
    }
    let projectedBaseBytesAfterCompaction =
      inactiveSpoolBytes +
      activeAuxiliaryBytes +
      journalBytes +
      storedBytes +
      metadataReserveBytes;
    if (
      !initializationError &&
      descriptor !== null &&
      projectedBaseBytesAfterCompaction > maxBytes
    ) {
      refreshBaseInspection();
      projectedBaseBytesAfterCompaction =
        inactiveSpoolBytes +
        activeAuxiliaryBytes +
        journalBytes +
        storedBytes +
        metadataReserveBytes;
      if (projectedBaseBytesAfterCompaction > maxBytes) {
        cleanupArchivedSpoolsForPressure(
          projectedBaseBytesAfterCompaction - maxBytes,
        );
        projectedBaseBytesAfterCompaction =
          inactiveSpoolBytes +
          activeAuxiliaryBytes +
          journalBytes +
          storedBytes +
          metadataReserveBytes;
      }
    }
    if (
      initializationError ||
      descriptor === null ||
      events.length + 1 > maxEvents ||
      projectedBaseBytesAfterCompaction > maxBytes
    ) {
      recordRejection("full", storedBytes);
      return { ok: false, status: 507, error: "pcob_event_spool_full" };
    }

    const originalJournalBytes = journalBytes;
    try {
      const written = fs.writeSync(descriptor, line, null, "utf8");
      if (written !== storedBytes) {
        throw new Error(`short spool write (${written}/${storedBytes})`);
      }
      fs.fsyncSync(descriptor);
      defineRawEventStoredBytes(event, storedBytes);
      events.push(event);
      journalBytes += storedBytes;
      nextSequence = sequence + 1;
      counters.captured += 1;
      updateRouteStats(event);
      if (counters.captured % 25 === 0) {
        persistMetadata();
      }
      scheduleMaintenance();
      return { ok: true, captured: true, event, payload: parsedPayload };
    } catch (error) {
      counters.appendFailures += 1;
      try {
        fs.ftruncateSync(descriptor, originalJournalBytes);
        fs.fsyncSync(descriptor);
      } catch {
        initializationError = "spool_recovery_failed";
      }
      persistMetadata();
      return {
        ok: false,
        status: 507,
        error: "pcob_event_spool_append_failed",
      };
    }
  }

  function parsedPayloadForEvent(event) {
    try {
      return parsePcobRawBuffer(Buffer.from(event.rawBodyBase64, "base64"));
    } catch {
      return null;
    }
  }

  function transportEvent(event) {
    if (event._transportCache) {
      return event._transportCache;
    }
    const originalBody = Buffer.from(event.rawBodyBase64, "base64");
    let encodedBody = originalBody;
    let rawBodyEncoding = "identity";
    if (originalBody.length >= PCOB_RAW_EVENT_GZIP_THRESHOLD_BYTES) {
      try {
        const compressed = zlib.gzipSync(originalBody, { level: 6 });
        if (compressed.length < originalBody.length) {
          encodedBody = compressed;
          rawBodyEncoding = "gzip";
        }
      } catch {}
    }
    const parsedPayload = parsedPayloadForEvent(event);
    let payload = parsedPayload;
    let payloadOmitted = false;
    try {
      if (Buffer.byteLength(JSON.stringify(parsedPayload)) > PCOB_RAW_EVENT_PAYLOAD_MAX_BYTES) {
        payload = null;
        payloadOmitted = true;
      }
    } catch {
      payload = null;
      payloadOmitted = true;
    }
    const output = {
      eventId: event.eventId,
      sequence: event.sequence,
      endpoint: event.endpoint,
      requestTarget: event.requestTarget,
      method: event.method,
      receivedAt: event.receivedAt,
      contentType: event.contentType ?? null,
      query: event.query ?? "",
      headers: event.headers ?? {},
      rawBodyEncoding,
      rawBodyBytes: originalBody.length,
      rawBodyBase64: encodedBody.toString("base64"),
      bodySha256: event.bodySha256,
      payload,
      ...(payloadOmitted ? { payloadOmitted: true } : {}),
    };
    const encodedBytes = Buffer.byteLength(JSON.stringify(output));
    event._transportCache = { output, encodedBytes };
    return event._transportCache;
  }

  function buildDeliveryBatch() {
    const pending = events.filter((event) => event.sequence > acknowledgedSequence);
    const selected = [];
    let encodedBytes = 0;
    let originalBodyBytes = 0;
    lastUndeliverable = null;
    for (const event of pending) {
      if (selected.length >= batchSize) {
        break;
      }
      const transformed = transportEvent(event);
      if (transformed.encodedBytes > encodedEventMaxBytes) {
        lastUndeliverable = {
          eventId: event.eventId,
          sequence: event.sequence,
          endpoint: event.endpoint,
          encodedBytes: transformed.encodedBytes,
          limitBytes: encodedEventMaxBytes,
          reason: "encoded_event_too_large",
        };
        break;
      }
      if (
        originalBodyBytes + event.rawBodyBytes >
        PCOB_RAW_EVENT_BATCH_ORIGINAL_MAX_BYTES
      ) {
        break;
      }
      const candidateEvents = [...selected, transformed.output];
      const candidateBytes = Buffer.byteLength(
        JSON.stringify({
          schema: PCOB_RAW_EVENT_SCHEMA,
          streamId,
          firstSequence: candidateEvents[0]?.sequence ?? null,
          lastSequence: candidateEvents[candidateEvents.length - 1]?.sequence ?? null,
          events: candidateEvents,
        }),
      );
      if (candidateBytes > batchMaxBytes) {
        if (selected.length === 0) {
          lastUndeliverable = {
            eventId: event.eventId,
            sequence: event.sequence,
            endpoint: event.endpoint,
            encodedBytes: transformed.encodedBytes,
            limitBytes: batchMaxBytes,
            reason: "encoded_batch_too_large",
          };
        }
        break;
      }
      selected.push(transformed.output);
      encodedBytes = candidateBytes;
      originalBodyBytes += event.rawBodyBytes;
    }
    const envelope = {
      schema: PCOB_RAW_EVENT_SCHEMA,
      streamId,
      firstSequence: selected.length > 0 ? selected[0].sequence : null,
      lastSequence: selected.length > 0 ? selected[selected.length - 1].sequence : null,
      events: selected,
    };
    return {
      envelope,
      encodedBytes: selected.length > 0 ? encodedBytes : Buffer.byteLength(JSON.stringify(envelope)),
      originalBodyBytes,
      pendingEvents: pending.length,
      blocked: lastUndeliverable,
    };
  }

  function markDeliveryAttempt() {
    counters.deliveryAttempts += 1;
  }

  function markDeliveryFailure() {
    counters.deliveryFailures += 1;
  }

  function markDeliverySuccess() {
    counters.deliverySuccesses += 1;
  }

  function applyAcknowledgement(acknowledgement, sentEnvelope) {
    if (!sentEnvelope || !Array.isArray(sentEnvelope.events) || sentEnvelope.events.length === 0) {
      return { acknowledged: false, reason: "no_events_sent" };
    }
    if (!acknowledgement || typeof acknowledgement !== "object") {
      counters.missingAcknowledgements += 1;
      return { acknowledged: false, reason: "missing_ack" };
    }
    const highest = acknowledgement.highestContiguousSequence;
    const accepted = acknowledgement.accepted;
    const duplicates = acknowledgement.duplicates;
    const sentCount = sentEnvelope.events.length;
    if (
      acknowledgement.schema !== PCOB_RAW_EVENT_ACK_SCHEMA ||
      acknowledgement.streamId !== streamId ||
      !Number.isSafeInteger(highest) ||
      !Number.isSafeInteger(accepted) ||
      !Number.isSafeInteger(duplicates) ||
      accepted < 0 ||
      duplicates < 0 ||
      accepted + duplicates !== sentCount ||
      highest < acknowledgedSequence
    ) {
      counters.acknowledgementErrors += 1;
      persistMetadata();
      return { acknowledged: false, reason: "invalid_ack" };
    }
    if (highest === acknowledgedSequence) {
      counters.noProgressAcknowledgements += 1;
      persistMetadata();
      return {
        acknowledged: false,
        progressed: false,
        complete: false,
        reason: "ack_no_contiguous_progress",
      };
    }
    if (highest > acknowledgedSequence) {
      acknowledgedSequence = highest;
      // The API watermark is authoritative for this immutable stream. It can
      // be ahead when local acknowledgement metadata was lost after later
      // events had already reached the API. Never reuse those sequences.
      nextSequence = Math.max(nextSequence, highest + 1);
      counters.acknowledgements += 1;
      if (highest < sentEnvelope.lastSequence) {
        counters.partialAcknowledgements += 1;
      }
      persistMetadata();
      scheduleMaintenance();
    }
    const complete = highest >= sentEnvelope.lastSequence;
    return {
      acknowledged: complete,
      progressed: true,
      complete,
      highestContiguousSequence: acknowledgedSequence,
      ...(complete ? {} : { reason: "ack_partial_progress" }),
    };
  }

  function routeMetrics() {
    const pendingCounts = new Map();
    for (const event of events) {
      if (event.sequence <= acknowledgedSequence) {
        continue;
      }
      pendingCounts.set(event.endpoint, (pendingCounts.get(event.endpoint) ?? 0) + 1);
    }
    return Array.from(routeStats.values())
      .map((record) => ({
        endpoint: record.endpoint,
        retainedEvents: record.retainedEvents,
        pendingEvents: pendingCounts.get(record.endpoint) ?? 0,
        firstSequence: record.firstSequence,
        lastSequence: record.lastSequence,
        lastReceivedAt: record.lastReceivedAt,
        payloadTypes: Array.from(record.payloadTypes).sort(),
        payloadTopLevelKeys: Array.from(record.payloadTopLevelKeys).sort(),
      }))
      .sort((left, right) => left.endpoint.localeCompare(right.endpoint));
  }

  function getMetrics() {
    const pending = events.filter((event) => event.sequence > acknowledgedSequence);
    const pendingBytes = pending.reduce(
      (total, event) => total + Math.max(0, Math.trunc(event._storedBytes || 0)),
      0,
    );
    let metadataBytes = 0;
    try {
      metadataBytes = fs.statSync(metadataPath).size;
    } catch {}
    const baseRetainedBytes =
      inactiveSpoolBytes +
      activeAuxiliaryBytes +
      journalBytes +
      metadataBytes;
    const full =
      events.length >= maxEvents ||
      baseRetainedBytes + metadataReserveBytes >= maxBytes;
    return {
      schema: "arenzyra.pcobEventSpoolMetrics.v1",
      enabled,
      status: !enabled
        ? "disabled"
        : initializationError || full || lastUndeliverable
          ? "degraded"
          : "ok",
      streamId,
      maxBytes,
      sizeLimitScope: "match-session-spool-base",
      maxEvents,
      retentionMs,
      maxIngressBodyBytes: PCOB_MAX_BODY_BYTES,
      maxRequestTargetBytes: PCOB_RAW_EVENT_REQUEST_TARGET_MAX_BYTES,
      batchOriginalBodyMaxBytes: PCOB_RAW_EVENT_BATCH_ORIGINAL_MAX_BYTES,
      batchSize,
      batchMaxBytes,
      encodedEventMaxBytes,
      journalBytes,
      baseRetainedBytes,
      inactiveSpoolBytes,
      inactiveSpoolDirectories,
      activeAuxiliaryBytes,
      archiveCleanup: { ...archiveCleanup },
      retainedEvents: events.length,
      pendingEvents: pending.length,
      pendingBytes,
      acknowledgedSequence,
      nextSequence,
      oldestPendingSequence: pending[0]?.sequence ?? null,
      newestPendingSequence: pending[pending.length - 1]?.sequence ?? null,
      full,
      initializationError,
      blockedEvent: lastUndeliverable,
      drops: {
        unacknowledged: 0,
        retention: 0,
        corruptJournalRecords: counters.corruptJournalRecords,
      },
      rejected: {
        full: counters.rejectedFull,
        oversize: counters.rejectedOversize,
        parser: counters.rejectedParser,
        requestTarget: counters.rejectedRequestTarget,
        bytes: counters.rejectedBytes,
      },
      counters: { ...counters },
      routes: routeMetrics(),
    };
  }

  function readEvents({ afterSequence = 0, limit = 25, includeRaw = false, includePayload = true } = {}) {
    const normalizedAfter = Math.max(0, Math.trunc(numberValue(afterSequence) ?? 0));
    const maximumLimit = includeRaw ? 10 : 100;
    const normalizedLimit = Math.max(
      1,
      Math.min(maximumLimit, Math.trunc(numberValue(limit) ?? 25)),
    );
    const matching = events.filter((event) => event.sequence > normalizedAfter);
    const page = matching.slice(0, normalizedLimit).map((event) => ({
      eventId: event.eventId,
      sequence: event.sequence,
      endpoint: event.endpoint,
      requestTarget: event.requestTarget,
      method: event.method,
      receivedAt: event.receivedAt,
      contentType: event.contentType ?? null,
      query: event.query ?? "",
      headers: event.headers ?? {},
      rawBodyEncoding: "identity",
      rawBodyBytes: event.rawBodyBytes,
      ...(includeRaw ? { rawBodyBase64: event.rawBodyBase64 } : {}),
      bodySha256: event.bodySha256,
      ...(includePayload ? { payload: parsedPayloadForEvent(event) } : {}),
      acknowledged: event.sequence <= acknowledgedSequence,
    }));
    return {
      schema: PCOB_RAW_EVENT_PAGE_SCHEMA,
      streamId,
      afterSequence: normalizedAfter,
      nextAfterSequence: page[page.length - 1]?.sequence ?? normalizedAfter,
      hasMore: matching.length > page.length,
      events: page,
    };
  }

  function getSnapshotSummary() {
    const metrics = getMetrics();
    const auxiliary = events.filter(
      (event) =>
        event.endpoint !== "/totalmessage" &&
        event.endpoint !== "/setcircleinfo" &&
        event.endpoint !== "/setobservingplayer" &&
        event.endpoint !== "/setteambackpackinfo",
    );
    const latestByEndpoint = new Map();
    for (const event of auxiliary) {
      latestByEndpoint.set(event.endpoint, event);
    }
    const toSummary = (event) => ({
      sequence: event.sequence,
      endpoint: event.endpoint,
      receivedAt: event.receivedAt,
      rawBodyBytes: event.rawBodyBytes,
      payloadType: event.payloadType,
      payloadTopLevelKeys: event.payloadTopLevelKeys,
      acknowledged: event.sequence <= acknowledgedSequence,
    });
    return {
      schema: "arenzyra.pcobRawEventSummary.v1",
      streamId,
      status: metrics.status,
      pendingEvents: metrics.pendingEvents,
      pendingBytes: metrics.pendingBytes,
      acknowledgedSequence,
      nextSequence,
      blockedEvent: metrics.blockedEvent,
      drops: metrics.drops,
      rejected: metrics.rejected,
      routes: metrics.routes.map((route) => ({
        endpoint: route.endpoint,
        retainedEvents: route.retainedEvents,
        pendingEvents: route.pendingEvents,
        lastSequence: route.lastSequence,
        lastReceivedAt: route.lastReceivedAt,
        payloadTopLevelKeys: route.payloadTopLevelKeys,
      })),
      auxiliaryLatest: Array.from(latestByEndpoint.values())
        .sort((left, right) => left.sequence - right.sequence)
        .map(toSummary),
      auxiliaryRecent: auxiliary.slice(-32).map(toSummary),
    };
  }

  function close() {
    if (closed) {
      return;
    }
    compactAcknowledged({ force: true });
    closedAt = new Date().toISOString();
    persistMetadata();
    closed = true;
    closeDescriptor();
  }

  initialize();
  const maintenanceTimer = enabled
    ? setInterval(() => scheduleMaintenance(), Math.min(60_000, retentionMs))
    : null;
  maintenanceTimer?.unref?.();

  return {
    appendRequest,
    applyAcknowledgement,
    buildDeliveryBatch,
    close,
    compactAcknowledged,
    getMetrics,
    getSnapshotSummary,
    markDeliveryAttempt,
    markDeliveryFailure,
    markDeliverySuccess,
    readEvents,
    recordRejection,
  };
}

const app = express();
const shadowState = {
  allInfo: {},
  playerInfoList: [],
  teamInfoList: [],
  teamBackpackInfo: [],
  killInfo: [],
  killInfoEntries: [],
  circleInfo: {},
  bestCircleInfo: {},
  observingPlayer: {},
  isInGame: false,
  gameId: null,
  routePayloads: {},
  rawRoutePayloads: {},
  playerMetricMaxima: new Map(),
  gameTimeSecondsMax: null,
  matchFlightPath: null,
  conflictingFlightPathCount: 0,
  lastConflictingFlightPath: null,
  lastConflictingFlightPathAt: null,
  updatedAt: null,
};
const transportState = createDirectObserverTransportState();
const rawEventSpool = createPcobRawEventSpool({
  enabled: PCOB_RAW_EVENT_CAPTURE_ENABLE,
  directory: PCOB_EVENT_SPOOL_DIR,
});
const lifecycleState = {
  resetCount: 0,
  lastResetAt: null,
  lastResetReason: null,
  lastGameplayEventAt: null,
  pendingOutOfGameSince: null,
};
let outOfGameResetTimer = null;
let outOfGameResetGeneration = 0;
let telemetryTimer = null;
let telemetryInFlight = false;
let observerSequence = 0;
const pendingRouteEvents = [];
let pendingRouteEventHead = 0;
let pendingRouteEventBytes = 0;
let pendingRouteEventDrops = 0;
let lastPendingRouteOverflowLogAt = 0;
let routeDrainScheduled = false;
const rejectedLocalProjectionKeys = new Map();
const pendingForwardEvents = [];
let pendingForwardEventHead = 0;
let pendingForwardEventBytes = 0;
let pendingForwardEventDrops = 0;
let lastPendingForwardOverflowLogAt = 0;
let forwardDrainActive = false;

function nextObserverSequence() {
  observerSequence += 1;
  return observerSequence;
}

const rawBodyParser = express.raw({
  type: () => true,
  limit: PCOB_MAX_BODY_BYTES,
  inflate: false,
  verify: (req, res, buf) => {
    // Keep the exact request bytes for the durable append before acknowledgement
    // and for the asynchronous legacy/widget handlers afterward.
    req.rawBody = buf;
  },
});

const connectorAccessPolicy = createConnectorHttpAccessPolicy({
  token: PCOB_CONNECTOR_TOKEN,
  port: PORT,
  log: (message, meta) => writeObserverForwardLog("warn", message, meta),
});

// Apply the loopback Host/Origin/capability boundary before body parsing. Native
// ShadowTracker telemetry cannot attach a launcher header, so the policy admits
// only its no-Origin `/set...` and `/totalmessage` POST shapes without the
// capability. Reads, controls, and every other request remain capability-bound.
app.use(connectorAccessPolicy.middleware);

// GET probes should bypass raw-body parsing so launcher health checks stay responsive.
app.use((req, res, next) => {
  if (req.method !== "POST") {
    return next();
  }
  return rawBodyParser(req, res, next);
});

app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large" || error?.status === 413) {
    const rejectedBytes =
      numberValue(req.headers?.["content-length"]) ?? PCOB_MAX_BODY_BYTES + 1;
    rawEventSpool.recordRejection("oversize", rejectedBytes);
    res.status(413).json({
      ok: false,
      error: "pcob_body_too_large",
      maxBodyBytes: PCOB_MAX_BODY_BYTES,
    });
    return;
  }
  if (req.method === "POST") {
    const rejectedBytes = numberValue(req.headers?.["content-length"]) ?? 0;
    rawEventSpool.recordRejection("parser", rejectedBytes);
    res.status(Math.max(400, Math.min(499, Number(error?.status) || 400))).json({
      ok: false,
      error: "pcob_body_unreadable",
    });
    return;
  }
  next(error);
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
  const rawEnvelope =
    payload?.rawEvents && Array.isArray(payload.rawEvents.events)
      ? payload.rawEvents
      : null;
  const hasRawEvents = Boolean(rawEnvelope && rawEnvelope.events.length > 0);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (hasRawEvents) {
      rawEventSpool.markDeliveryAttempt();
    }
    try {
      let rawDeliveryComplete = !hasRawEvents;
      const response = await axios.post(OBSERVER_TELEMETRY_URL, payload, {
        timeout: TELEMETRY_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          ...(OBSERVER_FEED_TOKEN
            ? { Authorization: `Bearer ${OBSERVER_FEED_TOKEN}` }
            : {}),
        },
      });
      const responseBody =
        response?.data && typeof response.data === "object"
          ? response.data
          : null;
      const ignored = responseBody?.ignored === true;
      const reason =
        typeof responseBody?.reason === "string" && responseBody.reason.trim()
          ? responseBody.reason.trim()
          : null;
      if (hasRawEvents) {
        const acknowledgement = rawEventSpool.applyAcknowledgement(
          responseBody?.rawEventsAck,
          rawEnvelope,
        );
        if (acknowledgement.acknowledged) {
          rawEventSpool.markDeliverySuccess();
          rawDeliveryComplete = true;
        } else {
          rawEventSpool.markDeliveryFailure();
        }
      }
      if (ignored && reason !== "NO_STATE_CHANGE") {
        writeObserverForwardLog(
          "warn",
          `[observer-forward] backend ignored telemetry: ${reason || "UNKNOWN"}`,
          {
            matchId: payload?.matchId || null,
            sessionId: payload?.sessionId || null,
            sequence: payload?.sequence ?? null,
            reason,
          },
        );
        return false;
      }
      if (VERBOSE_LOG) {
        writeObserverForwardLog("info", "Telemetry forwarded to Arenzyra", {
          matchId: payload?.matchId || null,
          sessionId: payload?.sessionId || null,
          sequence: payload?.sequence ?? null,
          queued: responseBody?.queued === true,
          ignored,
          reason,
        });
      }
      return rawDeliveryComplete;
    } catch (err) {
      lastError = err;
      if (hasRawEvents) {
        rawEventSpool.markDeliveryFailure();
      }
      writeObserverForwardLog(
        "error",
        `[observer-forward] telemetry send failed (attempt ${attempt}): ${err?.message || err}`,
        {
          matchId: payload?.matchId || null,
          sessionId: payload?.sessionId || null,
          sequence: payload?.sequence ?? null,
          status: err?.response?.status ?? null,
        },
      );
      if (attempt < 2) {
        await sleep(TELEMETRY_RETRY_DELAY_MS);
      }
    }
  }

  if (lastError) {
    writeObserverForwardLog(
      "error",
      "[observer-forward] backend unavailable; will retry on next poll",
      {
        matchId: payload?.matchId || null,
        sessionId: payload?.sessionId || null,
        sequence: payload?.sequence ?? null,
      },
    );
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

function cloneDirectFlightPath(flightPath) {
  if (!flightPath?.start || !flightPath?.end) {
    return null;
  }

  const startX = numberValue(flightPath.start.x);
  const startY = numberValue(flightPath.start.y);
  const endX = numberValue(flightPath.end.x);
  const endY = numberValue(flightPath.end.y);
  if (startX === null || startY === null || endX === null || endY === null) {
    return null;
  }

  return {
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
    coordinateSystem: flightPath.coordinateSystem ?? "WORLD",
  };
}

function directFlightPathsEqual(left, right) {
  return Boolean(
    left?.start &&
      left?.end &&
      right?.start &&
      right?.end &&
      left.start.x === right.start.x &&
      left.start.y === right.start.y &&
      left.end.x === right.end.x &&
      left.end.y === right.end.y,
  );
}

function rememberMatchFlightPath(candidate, receivedAt = new Date().toISOString()) {
  const normalized = cloneDirectFlightPath(candidate);
  if (!normalized) {
    return cloneDirectFlightPath(shadowState.matchFlightPath);
  }

  if (!shadowState.matchFlightPath) {
    shadowState.matchFlightPath = normalized;
    return cloneDirectFlightPath(normalized);
  }

  if (!directFlightPathsEqual(shadowState.matchFlightPath, normalized)) {
    // Rondo recall planes can cause PCOB to alternate `/setgameglobalinfo`
    // between the original match route and a later recall route. The first
    // official route belongs to the opening flight and remains authoritative
    // until the game lifecycle resets. Exact later payloads are still retained
    // by rawRoutePayloads and the durable raw-event spool.
    shadowState.conflictingFlightPathCount += 1;
    shadowState.lastConflictingFlightPath = normalized;
    shadowState.lastConflictingFlightPathAt = receivedAt;
  }

  return cloneDirectFlightPath(shadowState.matchFlightPath);
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
    if (numeric === 5) {
      return false;
    }
    if (numeric === 0 || numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4) {
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

function normalizeDirectAngleDegrees(value) {
  const numeric = numberValue(value);
  if (numeric === null) {
    return null;
  }

  const degrees = Math.abs(numeric) <= Math.PI * 2 + 0.001 ? (numeric * 180) / Math.PI : numeric;
  return ((degrees % 360) + 360) % 360;
}

function normalizeDirectDirectionVector(xValue, yValue) {
  const x = numberValue(xValue);
  const y = numberValue(yValue);
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

function extractDirectIsFiring(record) {
  const source = asObject(record);
  const explicit = booleanValue(
    source.isFiring ??
      source.IsFiring ??
      source.firing ??
      source.Firing ??
      source.isShooting ??
      source.IsShooting ??
      source.shooting ??
      source.Shooting,
  );
  if (explicit !== null) {
    return explicit;
  }

  const state = textValue(
    source.weaponState ??
      source.WeaponState ??
      source.combatState ??
      source.CombatState ??
      source.action ??
      source.Action,
  )?.toLowerCase();
  return state === "firing" || state === "shooting" || state === "fire";
}

function extractDirectFireAngle(record) {
  const source = asObject(record);
  return normalizeDirectAngleDegrees(
    firstNumberValue(source, [
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

function extractDirectFireDirection(record) {
  const source = asObject(record);
  const direct = normalizeDirectDirectionVector(
    firstNumberValue(source, [
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
    firstNumberValue(source, [
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

  const nestedCandidates = [
    source.fireDirection,
    source.FireDirection,
    source.firingDirection,
    source.FiringDirection,
    source.aimDirection,
    source.AimDirection,
    source.viewDirection,
    source.ViewDirection,
    source.direction,
    source.Direction,
    source.rotation,
    source.Rotation,
  ];
  for (const candidate of nestedCandidates) {
    const nested = asObject(candidate);
    if (!nested || Object.keys(nested).length === 0) {
      continue;
    }

    const vector = normalizeDirectDirectionVector(
      firstNumberValue(nested, ["x", "X", "dx", "DX", "dirX", "DirX"]),
      firstNumberValue(nested, ["y", "Y", "dy", "DY", "dirY", "DirY"]),
    );
    if (vector) {
      return vector;
    }
  }

  return null;
}

function normalizeDirectPlayerMetric(value, { integer = false } = {}) {
  const numeric = numberValue(value);
  if (numeric === null) {
    return null;
  }
  const nonNegative = Math.max(0, numeric);
  return integer ? Math.trunc(nonNegative) : nonNegative;
}

function rememberDirectPlayerMetrics(playerIds, incoming) {
  const aliases = Array.from(
    new Set(
      playerIds
        .map(textValue)
        .filter(Boolean)
        .map((value) => `id:${value.toLowerCase()}`),
    ),
  );
  if (aliases.length === 0) {
    return incoming;
  }

  let existing = null;
  for (const alias of aliases) {
    const candidate = shadowState.playerMetricMaxima.get(alias);
    if (candidate) {
      existing = candidate;
      break;
    }
  }

  const merged = {
    damageDealt:
      incoming.damageDealt === null
        ? (existing?.damageDealt ?? null)
        : Math.max(existing?.damageDealt ?? 0, incoming.damageDealt),
    longestEliminationDistanceM:
      incoming.longestEliminationDistanceM === null
        ? (existing?.longestEliminationDistanceM ?? null)
        : Math.max(
            existing?.longestEliminationDistanceM ?? 0,
            incoming.longestEliminationDistanceM,
          ),
    airdropLootCount:
      incoming.airdropLootCount === null
        ? (existing?.airdropLootCount ?? null)
        : Math.max(existing?.airdropLootCount ?? 0, incoming.airdropLootCount),
  };
  for (const alias of aliases) {
    shadowState.playerMetricMaxima.set(alias, merged);
  }
  return merged;
}

function normalizeDirectPlayers() {
  const normalized = [];
  const seen = new Set();

  for (const player of asArray(shadowState.playerInfoList)) {
    const record = asObject(player);
    if (!record || Object.keys(record).length === 0) {
      continue;
    }

    const playerOpenId = firstTextValue(record, [
      "playerOpenId",
      "playerOpenID",
      "PlayerOpenId",
      "PlayerOpenID",
      "openId",
      "OpenId",
      "openid",
    ]);
    const pubgPlayerId = firstTextValue(record, [
      "uId",
      "UId",
      "uid",
      "UID",
      "pubgPlayerId",
      "inGameId",
      "playerId",
      "playerID",
      "PlayerId",
      "PlayerID",
      "id",
      "ID",
    ]);
    const externalPlayerId =
      firstTextValue(record, ["externalPlayerId", "externalId"]) ?? pubgPlayerId;
    const playerName = firstTextValue(record, ["playerName", "PlayerName", "ign", "name"]);
    const playerIds = Array.from(
      new Set([pubgPlayerId, externalPlayerId, playerOpenId, playerName].filter(Boolean)),
    );
    const playerId = playerIds[0] ?? null;
    if (!playerId || seen.has(playerId)) {
      continue;
    }

    seen.add(playerId);
    const alive = isDirectPlayerAlive(record);
    const position = extractDirectPosition(record);
    const fireDirection = extractDirectFireDirection(record);
    const fireAngle = fireDirection ? null : extractDirectFireAngle(record);
    const metrics = rememberDirectPlayerMetrics(
      [pubgPlayerId, externalPlayerId, playerOpenId],
      {
        damageDealt: normalizeDirectPlayerMetric(
          record.damageDealt ??
            record.DamageDealt ??
            record.damage ??
            record.Damage ??
            record.totalDamage ??
            record.TotalDamage ??
            record.damageValue ??
            record.DamageValue,
        ),
        longestEliminationDistanceM: normalizeDirectPlayerMetric(
          record.longestEliminationDistanceM ??
            record.maxKillDistance ??
            record.MaxKillDistance,
        ),
        airdropLootCount: normalizeDirectPlayerMetric(
          record.airdropLootCount ??
            record.gotAirDropNum ??
            record.GotAirDropNum,
          { integer: true },
        ),
      },
    );
    normalized.push({
      playerId,
      playerIds,
      externalPlayerId,
      pubgPlayerId,
      playerOpenId,
      teamId: firstTextValue(record, [
        "teamId",
        "teamID",
        "TeamId",
        "TeamID",
        "team_id",
      ]),
      teamName: firstTextValue(record, ["teamName", "TeamName", "name", "Name"]) ?? null,
      playerName: playerName ?? firstTextValue(record, ["IGN", "Name"]) ?? "Player",
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
      assists: Math.max(
        0,
        Math.trunc(
          firstNumberValue(record, [
            "assists",
            "Assists",
            "assistNum",
            "AssistNum",
            "assistCount",
            "AssistCount",
          ]) ?? 0,
        ),
      ),
      damage: metrics.damageDealt,
      damageDealt: metrics.damageDealt,
      longestEliminationDistanceM: metrics.longestEliminationDistanceM,
      airdropLootCount: metrics.airdropLootCount,
      knockouts: Math.max(
        0,
        Math.trunc(
          firstNumberValue(record, [
            "knockouts",
            "Knockouts",
            "knockNum",
            "KnockNum",
            "knockCount",
            "KnockCount",
          ]) ?? 0,
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
      isFiring: extractDirectIsFiring(record),
      fireAngle,
      fireDirection,
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

const DIRECT_BACKPACK_LIST_KEYS = [
  "backpacks",
  "Backpacks",
  "TeamBackpackInfo",
  "teamBackpackInfo",
  "TeamBackPackInfo",
  "teamBackPackInfo",
  "teamBackpackList",
  "TeamBackpackList",
  "teamBackPackList",
  "TeamBackPackList",
  "data",
  "Data",
  "result",
  "Result",
  "allinfo",
  "allInfo",
];

const DIRECT_BACKPACK_ITEMS_KEYS = [
  "items",
  "Items",
  "backpack",
  "Backpack",
  "equipment",
  "Equipment",
  "inventory",
  "Inventory",
  "weapons",
  "Weapons",
];

const DIRECT_BACKPACK_META_KEYS = new Set(
  [
    "teamId",
    "TeamId",
    "teamID",
    "TeamID",
    "team",
    "Team",
    "slot",
    "Slot",
    "teamName",
    "TeamName",
    "name",
    "Name",
    "playerKey",
    "PlayerKey",
    "playerId",
    "PlayerId",
    "playerID",
    "PlayerID",
    "uid",
    "uId",
    "UId",
    "UID",
    "MainWeapon1ID",
    "mainWeapon1ID",
    "mainWeapon1Id",
    "MainWeapon1AmmoNuminClip",
    "mainWeapon1AmmoNuminClip",
    "MainWeapon2ID",
    "mainWeapon2ID",
    "mainWeapon2Id",
    "MainWeapon2AmmoNuminClip",
    "mainWeapon2AmmoNuminClip",
    DIRECT_BACKPACK_SEEN_AT_MS_KEY,
    DIRECT_BACKPACK_SEEN_AT_KEY,
    ...DIRECT_BACKPACK_ITEMS_KEYS,
  ].map((key) => key.toLowerCase()),
);

const DIRECT_BACKPACK_EQUIPMENT_SLOTS = [
  {
    name: "mainWeapon1",
    label: "Main Weapon 1",
    idKeys: ["MainWeapon1ID", "mainWeapon1ID", "mainWeapon1Id"],
    ammoKeys: ["MainWeapon1AmmoNuminClip", "mainWeapon1AmmoNuminClip"],
  },
  {
    name: "mainWeapon2",
    label: "Main Weapon 2",
    idKeys: ["MainWeapon2ID", "mainWeapon2ID", "mainWeapon2Id"],
    ammoKeys: ["MainWeapon2AmmoNuminClip", "mainWeapon2AmmoNuminClip"],
  },
];

function parseDirectBackpackValueString(value) {
  const text = textValue(value);
  if (!text || !text.includes(":")) {
    return null;
  }

  const parsed = {};
  for (const part of text.split(",")) {
    const separator = part.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim().toLowerCase();
    const number = numberValue(part.slice(separator + 1).trim());
    if (key && number !== null) {
      parsed[key] = number;
    }
  }

  if (Object.keys(parsed).length === 0) {
    return null;
  }

  return {
    count: parsed.num ?? parsed.count ?? parsed.quantity ?? null,
    quality: parsed.quality ?? null,
    worth: parsed.worth ?? null,
  };
}

function extractDirectBackpackList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asObject(payload);
  if (!record || Object.keys(record).length === 0) {
    return [];
  }

  for (const key of DIRECT_BACKPACK_LIST_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
    const nested = asObject(value);
    if (nested && Object.keys(nested).length > 0) {
      const nestedList = extractDirectBackpackList(nested);
      if (nestedList.length > 0) {
        return nestedList;
      }
    }
  }

  if (
    firstTextValue(record, ["teamId", "TeamId", "teamID", "TeamID", "team", "Team"]) &&
    DIRECT_BACKPACK_ITEMS_KEYS.some((key) => record[key] !== undefined)
  ) {
    return [record];
  }

  return [];
}

const DIRECT_BACKPACK_TEAM_ID_KEYS = [
  "teamId",
  "TeamId",
  "teamID",
  "TeamID",
  "team",
  "Team",
];
const DIRECT_BACKPACK_SLOT_KEYS = [
  "slot",
  "Slot",
  "teamNo",
  "TeamNo",
  "teamNumber",
  "TeamNumber",
  "teamIndex",
  "TeamIndex",
  "order",
  "Order",
];
const DIRECT_BACKPACK_PLAYER_ID_KEYS = [
  "playerId",
  "PlayerId",
  "playerID",
  "PlayerID",
  "playerKey",
  "PlayerKey",
  "uid",
  "uId",
  "UId",
  "UID",
];

function cloneDirectBackpackRecord(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneDirectBackpackRecord(entry));
  }
  if (value && typeof value === "object") {
    return { ...value };
  }
  return value;
}

function directBackpackIdentity(entry) {
  const source = asObject(entry);
  if (!source || Object.keys(source).length === 0) {
    return null;
  }

  const playerId = firstTextValue(source, DIRECT_BACKPACK_PLAYER_ID_KEYS);
  if (playerId) {
    return `player:${playerId}`;
  }

  const teamId = firstTextValue(source, DIRECT_BACKPACK_TEAM_ID_KEYS);
  if (teamId) {
    return `team:${teamId}`;
  }

  const slot = firstNumberValue(source, DIRECT_BACKPACK_SLOT_KEYS);
  if (slot !== null) {
    return `slot:${Math.trunc(slot)}`;
  }

  return null;
}

function directBackpackTeamId(entry) {
  const source = asObject(entry);
  if (!source || Object.keys(source).length === 0) {
    return null;
  }
  return firstTextValue(source, DIRECT_BACKPACK_TEAM_ID_KEYS);
}

function directBackpackSlot(entry) {
  const source = asObject(entry);
  if (!source || Object.keys(source).length === 0) {
    return null;
  }

  const slot = firstNumberValue(source, [
    ...DIRECT_BACKPACK_SLOT_KEYS,
    ...DIRECT_BACKPACK_TEAM_ID_KEYS,
  ]);
  return slot === null ? null : Math.trunc(slot);
}

function directBackpackSeenAtMs(entry) {
  const source = asObject(entry);
  if (!source || Object.keys(source).length === 0) {
    return null;
  }

  const explicit = numberValue(source[DIRECT_BACKPACK_SEEN_AT_MS_KEY]);
  if (explicit !== null) {
    return explicit;
  }

  const text = textValue(source[DIRECT_BACKPACK_SEEN_AT_KEY]);
  if (!text) {
    return null;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function markDirectBackpackRecordSeen(entry, seenAtMs) {
  const copy = cloneDirectBackpackRecord(entry);
  const record = asObject(copy);
  if (record) {
    record[DIRECT_BACKPACK_SEEN_AT_MS_KEY] = seenAtMs;
    record[DIRECT_BACKPACK_SEEN_AT_KEY] = new Date(seenAtMs).toISOString();
  }
  return copy;
}

function stripDirectBackpackInternalKeys(entry) {
  const copy = cloneDirectBackpackRecord(entry);
  const record = asObject(copy);
  if (record) {
    delete record[DIRECT_BACKPACK_SEEN_AT_MS_KEY];
    delete record[DIRECT_BACKPACK_SEEN_AT_KEY];
  }
  return copy;
}

function stripDirectBackpackInternalKeysList(list) {
  return asArray(list).map((entry) => stripDirectBackpackInternalKeys(entry));
}

function extractDirectPlayerTeamSlot(record) {
  const slot = firstNumberValue(asObject(record), [
    "teamId",
    "TeamId",
    "teamID",
    "TeamID",
    "team",
    "Team",
    "slot",
    "Slot",
    "teamNo",
    "TeamNo",
    "teamNumber",
    "TeamNumber",
  ]);
  return slot === null ? null : Math.trunc(slot);
}

function extractDirectTeamAlivePlayers(record) {
  const source = asObject(record);
  if (!source || Object.keys(source).length === 0) {
    return null;
  }

  const explicit = firstNumberValue(source, [
    "alivePlayers",
    "AlivePlayers",
    "aliveCount",
    "AliveCount",
    "aliveNum",
    "AliveNum",
    "liveMemberNum",
    "LiveMemberNum",
    "aliveMemberNum",
    "AliveMemberNum",
    "remainPlayerNum",
    "RemainPlayerNum",
    "remainingPlayers",
    "RemainingPlayers",
    "playerAlive",
    "PlayerAlive",
  ]);
  if (explicit !== null) {
    return Math.max(0, Math.trunc(explicit));
  }

  const total = firstNumberValue(source, [
    "totalPlayers",
    "TotalPlayers",
    "playerCount",
    "PlayerCount",
    "teamSize",
    "TeamSize",
  ]);
  if (total !== null) {
    const dead = firstNumberValue(source, [
      "deadPlayers",
      "DeadPlayers",
      "eliminatedPlayers",
      "EliminatedPlayers",
      "deadNum",
      "DeadNum",
    ]);
    if (dead !== null) {
      return Math.max(0, Math.trunc(total) - Math.max(0, Math.trunc(dead)));
    }
  }

  return null;
}

function buildAliveDirectBackpackSlotSet() {
  const slots = new Set();

  for (const player of asArray(shadowState.playerInfoList)) {
    const slot = extractDirectPlayerTeamSlot(player);
    if (slot !== null && isDirectPlayerAlive(player)) {
      slots.add(slot);
    }
  }

  if (slots.size > 0) {
    return slots;
  }

  for (const team of asArray(shadowState.teamInfoList)) {
    const slot = extractDirectTeamSlot(team) ?? firstNumberValue(asObject(team), DIRECT_TEAM_ID_KEYS);
    if (slot === null) {
      continue;
    }
    const alivePlayers = extractDirectTeamAlivePlayers(team);
    if (alivePlayers === null || alivePlayers > 0) {
      slots.add(Math.trunc(slot));
    }
  }

  return slots;
}

function shouldKeepDirectBackpackRecord(entry, aliveSlots, nowMs) {
  const seenAtMs = directBackpackSeenAtMs(entry);
  if (seenAtMs === null) {
    return false;
  }
  if (DIRECT_BACKPACK_CACHE_TTL_MS > 0 && nowMs - seenAtMs > DIRECT_BACKPACK_CACHE_TTL_MS) {
    return false;
  }

  const slot = directBackpackSlot(entry);
  return aliveSlots.size === 0 || slot === null || aliveSlots.has(slot);
}

function isDirectBackpackAliveSlot(entry, aliveSlots) {
  const slot = directBackpackSlot(entry);
  return aliveSlots.size === 0 || slot === null || aliveSlots.has(slot);
}

function mergeDirectBackpackRecord(previous, incoming) {
  const previousRecord = asObject(previous);
  const incomingRecord = asObject(incoming);
  if (
    !previousRecord ||
    Object.keys(previousRecord).length === 0 ||
    !incomingRecord ||
    Object.keys(incomingRecord).length === 0
  ) {
    return cloneDirectBackpackRecord(incoming);
  }

  const merged = { ...incomingRecord };
  for (const key of [
    ...DIRECT_BACKPACK_TEAM_ID_KEYS,
    ...DIRECT_BACKPACK_SLOT_KEYS,
    ...DIRECT_BACKPACK_PLAYER_ID_KEYS,
  ]) {
    if (
      (merged[key] === undefined || merged[key] === null || merged[key] === "") &&
      previousRecord[key] !== undefined &&
      previousRecord[key] !== null &&
      previousRecord[key] !== ""
    ) {
      merged[key] = previousRecord[key];
    }
  }
  return merged;
}

function buildDirectBackpackReplacementScope(entries) {
  const slots = new Set();
  const teamIds = new Set();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const slot = directBackpackSlot(entry);
    if (slot !== null) {
      slots.add(Math.trunc(slot));
    }

    const teamId = directBackpackTeamId(entry);
    if (teamId) {
      teamIds.add(teamId);
    }
  }

  return {
    slots,
    teamIds,
    hasScope: slots.size > 0 || teamIds.size > 0,
  };
}

function isDirectBackpackReplacedByIncoming(entry, replacementScope) {
  if (!replacementScope?.hasScope) {
    return false;
  }

  const slot = directBackpackSlot(entry);
  if (slot !== null && replacementScope.slots.has(Math.trunc(slot))) {
    return true;
  }

  const teamId = directBackpackTeamId(entry);
  return Boolean(teamId && replacementScope.teamIds.has(teamId));
}

function mergeDirectBackpackInfoList(current, incoming, options = {}) {
  const nowMs = numberValue(options.nowMs) ?? Date.now();
  const aliveSlots = buildAliveDirectBackpackSlotSet();
  const currentList = Array.isArray(current) ? current : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const replacementScope = buildDirectBackpackReplacementScope(incomingList);
  const merged = [];
  const byIdentity = new Map();

  for (const entry of currentList) {
    if (!shouldKeepDirectBackpackRecord(entry, aliveSlots, nowMs)) {
      continue;
    }
    if (isDirectBackpackReplacedByIncoming(entry, replacementScope)) {
      continue;
    }
    const identity = directBackpackIdentity(entry);
    const copy = cloneDirectBackpackRecord(entry);
    if (identity && byIdentity.has(identity)) {
      const existing = byIdentity.get(identity);
      const nextEntry = mergeDirectBackpackRecord(existing.entry, copy);
      merged[existing.index] = nextEntry;
      byIdentity.set(identity, { index: existing.index, entry: nextEntry });
      continue;
    }
    if (identity) {
      byIdentity.set(identity, { index: merged.length, entry: copy });
    }
    merged.push(copy);
  }

  for (const entry of incomingList) {
    if (!isDirectBackpackAliveSlot(entry, aliveSlots)) {
      continue;
    }
    const identity = directBackpackIdentity(entry);
    const copy = markDirectBackpackRecordSeen(entry, nowMs);
    if (identity && byIdentity.has(identity)) {
      const existing = byIdentity.get(identity);
      const nextEntry = markDirectBackpackRecordSeen(
        mergeDirectBackpackRecord(existing.entry, copy),
        nowMs,
      );
      merged[existing.index] = nextEntry;
      byIdentity.set(identity, { index: existing.index, entry: nextEntry });
      continue;
    }
    if (identity) {
      byIdentity.set(identity, { index: merged.length, entry: copy });
    }
    merged.push(copy);
  }

  return merged;
}

function refreshDirectBackpackInfoCache(nowMs = Date.now()) {
  const next = mergeDirectBackpackInfoList(shadowState.teamBackpackInfo, [], { nowMs });
  shadowState.teamBackpackInfo = next;
  shadowState.allInfo = {
    ...shadowState.allInfo,
    TeamBackpackInfo: next,
  };
  return next;
}

function normalizeDirectBackpackItem(value, fallbackName = null) {
  const record = asObject(value);
  if (record && Object.keys(record).length > 0) {
    const packed =
      parseDirectBackpackValueString(record.count) ??
      parseDirectBackpackValueString(record.Count) ??
      parseDirectBackpackValueString(record.value) ??
      parseDirectBackpackValueString(record.Value);
    const name =
      firstTextValue(record, [
        "name",
        "Name",
        "itemName",
        "ItemName",
        "item",
        "Item",
        "type",
        "Type",
        "id",
        "ID",
      ]) ?? textValue(fallbackName);
    const count =
      firstNumberValue(record, [
        "count",
        "Count",
        "num",
        "Num",
        "amount",
        "Amount",
        "quantity",
        "Quantity",
        "value",
        "Value",
      ]) ?? packed?.count ?? null;
    if (!name) {
      return null;
    }
    const normalized = {
      name,
      itemId: /^\d+$/.test(name) ? name : firstTextValue(record, ["itemId", "ItemId", "ItemID"]),
      count: count === null ? null : Math.max(0, Math.trunc(count)),
      raw: value,
    };
    if (packed?.quality !== null && packed?.quality !== undefined) {
      normalized.quality = packed.quality;
    }
    if (packed?.worth !== null && packed?.worth !== undefined) {
      normalized.worth = packed.worth;
    }
    return normalized;
  }

  const name = textValue(fallbackName) ?? textValue(value);
  if (!name) {
    return null;
  }

  const packed = parseDirectBackpackValueString(value);
  return {
    name,
    itemId: /^\d+$/.test(name) ? name : null,
    count: packed?.count ?? numberValue(value),
    ...(packed?.quality !== null && packed?.quality !== undefined
      ? { quality: packed.quality }
      : {}),
    ...(packed?.worth !== null && packed?.worth !== undefined ? { worth: packed.worth } : {}),
    raw: value,
  };
}

function normalizeDirectBackpackItems(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeDirectBackpackItem(entry))
      .filter(Boolean);
  }

  const record = asObject(value);
  if (!record || Object.keys(record).length === 0) {
    return [];
  }

  for (const key of DIRECT_BACKPACK_ITEMS_KEYS) {
    if (record[key] !== undefined) {
      return normalizeDirectBackpackItems(record[key]);
    }
  }

  return Object.entries(record)
    .filter(([key]) => !DIRECT_BACKPACK_META_KEYS.has(key.toLowerCase()))
    .map(([key, entryValue]) => {
      const nested = asObject(entryValue);
      if (nested && Object.keys(nested).length > 0) {
        return normalizeDirectBackpackItem(
          { name: key, ...nested },
          key,
        );
      }
      return normalizeDirectBackpackItem(
        { name: key, count: entryValue },
        key,
      );
    })
    .filter(Boolean);
}

function extractDirectBackpackEquipmentItems(record) {
  const source = asObject(record);
  if (!source || Object.keys(source).length === 0) {
    return [];
  }

  return DIRECT_BACKPACK_EQUIPMENT_SLOTS.map((slot) => {
    const itemId = firstTextValue(source, slot.idKeys);
    if (!itemId || itemId === "0" || itemId === "-1") {
      return null;
    }
    const ammoInClip = firstNumberValue(source, slot.ammoKeys);
    return {
      name: slot.label,
      slot: slot.name,
      itemId,
      count: 1,
      ammoInClip: ammoInClip === null ? null : Math.max(0, Math.trunc(ammoInClip)),
      raw: slot.idKeys.reduce((carry, key) => {
        if (source[key] !== undefined) {
          carry[key] = source[key];
        }
        return carry;
      }, {}),
    };
  }).filter(Boolean);
}

function normalizeDirectBackpacks(payload) {
  return extractDirectBackpackList(payload)
    .map((entry) => {
      const record = asObject(entry);
      if (!record || Object.keys(record).length === 0) {
        return null;
      }

      const teamId = firstTextValue(record, [
        "teamId",
        "TeamId",
        "teamID",
        "TeamID",
        "team",
        "Team",
      ]);
      const playerId = firstTextValue(record, [
        "playerId",
        "PlayerId",
        "playerID",
        "PlayerID",
        "playerKey",
        "PlayerKey",
        "uid",
        "uId",
        "UId",
        "UID",
      ]);
      const slot = directBackpackSlot(record);
      const items = normalizeDirectBackpackItems(record);
      const equipment = [
        ...extractDirectBackpackEquipmentItems(record),
        ...items,
      ];
      const hasExplicitCounts = items.some((item) => numberValue(item.count) !== null);
      const itemCount = hasExplicitCounts
        ? items.reduce(
            (total, item) =>
              total + Math.max(0, Math.trunc(numberValue(item.count) ?? 1)),
            0,
          )
        : items.length;

      return {
        teamId,
        playerId,
        slot: slot === null ? null : Math.trunc(slot),
        items,
        equipment,
        itemCount,
        raw: entry,
      };
    })
    .filter(Boolean);
}

function directBackpackGroupKey(backpack) {
  const slot = numberValue(backpack?.slot);
  if (slot !== null) {
    return `slot:${Math.trunc(slot)}`;
  }

  const teamId = textValue(backpack?.teamId);
  if (teamId) {
    return `team:${teamId}`;
  }

  const playerId = textValue(backpack?.playerId);
  return playerId ? `player:${playerId}` : null;
}

function mergeDirectBackpackItem(itemMap, item) {
  const name = textValue(item?.name);
  const itemId = textValue(item?.itemId);
  const key = itemId ?? name;
  if (!key) {
    return;
  }

  const count = Math.max(0, Math.trunc(numberValue(item?.count) ?? 1));
  const existing = itemMap.get(key);
  itemMap.set(key, {
    ...existing,
    ...item,
    name: name ?? existing?.name ?? itemId,
    itemId: itemId ?? existing?.itemId ?? null,
    count: (Math.max(0, Math.trunc(numberValue(existing?.count) ?? 0)) + count),
  });
}

function aggregateDirectBackpacks(backpacks) {
  const groups = new Map();

  for (const backpack of Array.isArray(backpacks) ? backpacks : []) {
    const key = directBackpackGroupKey(backpack);
    if (!key) {
      continue;
    }

    const group = groups.get(key) ?? {
      teamId: null,
      slot: null,
      playerIds: new Set(),
      itemMap: new Map(),
      equipmentMap: new Map(),
      raw: [],
    };
    const teamId = textValue(backpack?.teamId);
    const slot = numberValue(backpack?.slot);
    const playerId = textValue(backpack?.playerId);

    if (!group.teamId && teamId) {
      group.teamId = teamId;
    }
    if (group.slot === null && slot !== null) {
      group.slot = Math.trunc(slot);
    }
    if (playerId) {
      group.playerIds.add(playerId);
    }
    for (const item of Array.isArray(backpack?.items) ? backpack.items : []) {
      mergeDirectBackpackItem(group.itemMap, item);
    }
    for (const item of Array.isArray(backpack?.equipment) ? backpack.equipment : []) {
      mergeDirectBackpackItem(group.equipmentMap, item);
    }
    group.raw.push(backpack?.raw ?? backpack);
    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group) => {
    const items = Array.from(group.itemMap.values());
    const equipment = Array.from(group.equipmentMap.values());
    const playerIds = Array.from(group.playerIds);
    return {
      teamId: group.teamId,
      playerId: playerIds.length === 1 ? playerIds[0] : null,
      slot: group.slot,
      items,
      equipment: equipment.length > 0 ? equipment : items,
      itemCount: items.reduce(
        (total, item) =>
          total + Math.max(0, Math.trunc(numberValue(item?.count) ?? 0)),
        0,
      ),
      raw: group.raw,
    };
  });
}

function buildDirectBackpackTotals(backpacks) {
  const byItem = new Map();
  let itemCount = 0;

  for (const backpack of Array.isArray(backpacks) ? backpacks : []) {
    itemCount += Math.max(0, Math.trunc(numberValue(backpack?.itemCount) ?? 0));
    for (const item of Array.isArray(backpack?.items) ? backpack.items : []) {
      const name = textValue(item?.name);
      if (!name) {
        continue;
      }
      const count = Math.max(0, Math.trunc(numberValue(item?.count) ?? 1));
      byItem.set(name, (byItem.get(name) ?? 0) + count);
    }
  }

  return {
    teams: Array.isArray(backpacks) ? backpacks.length : 0,
    itemCount,
    byItem: Array.from(byItem.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
  };
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
    if (candidate.GameTime !== undefined || candidate.gameTime !== undefined) {
      score += 35;
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
  const incomingGameTimeSeconds = normalizeDirectPlayerMetric(
    source.GameTime ?? source.gameTime ?? source.gameTimeSeconds,
  );
  if (incomingGameTimeSeconds !== null) {
    shadowState.gameTimeSecondsMax = Math.max(
      shadowState.gameTimeSecondsMax ?? 0,
      incomingGameTimeSeconds,
    );
  }

  return {
    phase: phaseIndex,
    status: textValue(source.CircleStatus ?? source.circleStatus) ?? null,
    gameTimeSeconds: shadowState.gameTimeSecondsMax,
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
  const gameTimeSeconds =
    normalized.gameTimeSeconds ??
    normalizeDirectPlayerMetric(
      selectedCircle.GameTime ??
        selectedCircle.gameTime ??
        selectedCircle.gameTimeSeconds,
    );

  return {
    ...selectedCircle,
    phase,
    circleIndex: selectedCircle.circleIndex ?? phase,
    CircleIndex: selectedCircle.CircleIndex ?? phase,
    status,
    circleStatus: selectedCircle.circleStatus ?? status,
    CircleStatus: selectedCircle.CircleStatus ?? status,
    GameTime: selectedCircle.GameTime ?? gameTimeSeconds,
    gameTime: selectedCircle.gameTime ?? gameTimeSeconds,
    gameTimeSeconds,
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

  const observerPubgPlayerId = firstTextValue(observer, [
    "uId",
    "UId",
    "uid",
    "UID",
    "0",
    "pubgPlayerId",
    "inGameId",
    "playerId",
    "playerID",
    "PlayerId",
    "PlayerID",
    "id",
    "ID",
  ]);
  const observerExternalPlayerId =
    firstTextValue(observer, ["externalPlayerId", "externalId"]) ?? observerPubgPlayerId;
  const observerPlayerOpenId = firstTextValue(observer, [
    "playerOpenId",
    "playerOpenID",
    "PlayerOpenId",
    "PlayerOpenID",
    "openId",
    "OpenId",
    "openid",
  ]);
  const observerPlayerIds = Array.from(
    new Set(
      [
        observerPubgPlayerId,
        observerExternalPlayerId,
        observerPlayerOpenId,
      ].filter(Boolean),
    ),
  );
  const observerPlayerId = observerPlayerIds[0] ?? null;
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
  if (observerPlayerIds.length > 0) {
    matchedPlayer =
      players.find((player) => {
        const playerIds = Array.from(
          new Set(
            [
              player?.playerId,
              player?.pubgPlayerId,
              player?.externalPlayerId,
              player?.playerOpenId,
              ...(Array.isArray(player?.playerIds) ? player.playerIds : []),
            ]
              .map(textValue)
              .filter(Boolean),
          ),
        );
        return playerIds.some((id) => observerPlayerIds.includes(id));
      }) ?? null;
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
    externalPlayerId:
      textValue(matchedPlayer?.externalPlayerId) ?? observerExternalPlayerId ?? null,
    pubgPlayerId: textValue(matchedPlayer?.pubgPlayerId) ?? observerPubgPlayerId ?? null,
    playerOpenId: textValue(matchedPlayer?.playerOpenId) ?? observerPlayerOpenId ?? null,
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
    damage:
      numberValue(matchedPlayer?.damageDealt ?? matchedPlayer?.damage) ??
      normalizeDirectPlayerMetric(
        firstNumberValue(observer, [
          "damageDealt",
          "DamageDealt",
          "damage",
          "Damage",
          "totalDamage",
          "TotalDamage",
          "damageValue",
          "DamageValue",
        ]),
      ),
    damageDealt:
      numberValue(matchedPlayer?.damageDealt) ??
      normalizeDirectPlayerMetric(
        firstNumberValue(observer, [
          "damageDealt",
          "DamageDealt",
          "damage",
          "Damage",
          "totalDamage",
          "TotalDamage",
          "damageValue",
          "DamageValue",
        ]),
      ),
    longestEliminationDistanceM:
      numberValue(matchedPlayer?.longestEliminationDistanceM) ??
      normalizeDirectPlayerMetric(
        firstNumberValue(observer, [
          "longestEliminationDistanceM",
          "maxKillDistance",
          "MaxKillDistance",
        ]),
      ),
    airdropLootCount:
      numberValue(matchedPlayer?.airdropLootCount) ??
      normalizeDirectPlayerMetric(
        firstNumberValue(observer, [
          "airdropLootCount",
          "gotAirDropNum",
          "GotAirDropNum",
        ]),
        { integer: true },
      ),
  };
}

function extractDirectPcobMapName() {
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

function getDirectMapSelection() {
  const pcobMapName = extractDirectPcobMapName();
  if (pcobMapName) {
    const pcobConfig = resolveDirectMapOverlayConfig(pcobMapName);
    return {
      mapName: pcobMapName,
      mapKey: findDirectMapOverlayConfigKey(pcobConfig),
      source: "pcob",
      fallbackMapKey: runtimeFallbackMap?.mapKey ?? null,
      fallbackMapName: runtimeFallbackMap?.mapName ?? null,
      fallbackUpdatedAt: runtimeFallbackMap?.updatedAt ?? null,
    };
  }

  if (runtimeFallbackMap) {
    return {
      mapName: runtimeFallbackMap.mapName,
      mapKey: runtimeFallbackMap.mapKey,
      source: "runtime-fallback",
      fallbackMapKey: runtimeFallbackMap.mapKey,
      fallbackMapName: runtimeFallbackMap.mapName,
      fallbackUpdatedAt: runtimeFallbackMap.updatedAt,
    };
  }

  return {
    mapName: null,
    mapKey: null,
    source: "none",
    fallbackMapKey: null,
    fallbackMapName: null,
    fallbackUpdatedAt: null,
  };
}

function extractDirectMapName() {
  return getDirectMapSelection().mapName;
}

function exposeDirectMapSelection(record, selection = getDirectMapSelection()) {
  const root = asObject(record);
  if (!selection.mapName) {
    return { ...root };
  }

  return {
    ...root,
    mapName: selection.mapName,
    mapNameSource: selection.source,
    fallbackMapKey: selection.fallbackMapKey,
  };
}

function hasRecentDirectObserverTelemetry() {
  const updatedAtMs = timestampMsValue(shadowState.updatedAt);
  if (updatedAtMs === null || Date.now() - updatedAtMs > DIRECT_OBSERVER_LIVE_STALE_MS) {
    return false;
  }

  return (
    asArray(shadowState.playerInfoList).length > 0 ||
    asArray(shadowState.teamInfoList).length > 0 ||
    asArray(shadowState.killInfo).length > 0 ||
    Object.keys(asObject(shadowState.circleInfo)).length > 0
  );
}

function getDirectIsInGame() {
  return shadowState.isInGame === true || hasRecentDirectObserverTelemetry();
}

function buildDirectLeaderboardPayload(matchIdOverride) {
  const players = normalizeDirectPlayers();
  const teams = sortDirectLeaderboardTeams(normalizeDirectTeams(players));
  const teamsAlive = teams.reduce(
    (count, team) => count + (Math.max(0, Math.trunc(numberValue(team.alivePlayers) ?? 0)) > 0 ? 1 : 0),
    0,
  );
  const flightPath =
    cloneDirectFlightPath(shadowState.matchFlightPath) ??
    extractDirectFlightPath(shadowState.routePayloads["/setgameglobalinfo"]) ??
    extractDirectFlightPath(shadowState.allInfo) ??
    null;
  const teamBackpackInfo = refreshDirectBackpackInfoCache();
  const publicTeamBackpackInfo = stripDirectBackpackInternalKeysList(teamBackpackInfo);
  const playerBackpacks = normalizeDirectBackpacks(
    asArray(publicTeamBackpackInfo).length > 0
      ? publicTeamBackpackInfo
      : shadowState.allInfo,
  );
  const backpacks = aggregateDirectBackpacks(playerBackpacks);
  const backpacksByTeamId = new Map(
    backpacks
      .filter((backpack) => textValue(backpack.teamId))
      .map((backpack) => [textValue(backpack.teamId), backpack]),
  );
  const backpacksBySlot = new Map(
    backpacks
      .filter((backpack) => numberValue(backpack.slot) !== null)
      .map((backpack) => [Math.trunc(numberValue(backpack.slot) ?? 0), backpack]),
  );
  const backpackTotals = buildDirectBackpackTotals(backpacks);

  const leaderboard = teams.map((team, index) => {
    const alivePlayers = Math.max(0, Math.trunc(numberValue(team.alivePlayers) ?? 0));
    const totalPlayers = Math.max(alivePlayers, Math.trunc(numberValue(team.totalPlayers) ?? 0));
    const isEliminated = alivePlayers <= 0;
    const backpack = isEliminated
      ? null
      : (textValue(team.teamId) ? backpacksByTeamId.get(textValue(team.teamId)) : null) ??
        (numberValue(team.slot) !== null
          ? backpacksBySlot.get(Math.trunc(numberValue(team.slot) ?? 0))
          : null) ??
        null;
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
        externalPlayerId: textValue(player.externalPlayerId),
        pubgPlayerId: textValue(player.pubgPlayerId),
        playerOpenId: textValue(player.playerOpenId),
        playerName: textValue(player.playerName) ?? "Player",
        avatarUrl: null,
        kills: Math.max(0, Math.trunc(numberValue(player.kills) ?? 0)),
        assists: Math.max(0, Math.trunc(numberValue(player.assists) ?? 0)),
        damage: numberValue(player.damageDealt ?? player.damage),
        damageDealt: numberValue(player.damageDealt),
        longestEliminationDistanceM: numberValue(
          player.longestEliminationDistanceM,
        ),
        airdropLootCount: numberValue(player.airdropLootCount),
        knockouts: Math.max(0, Math.trunc(numberValue(player.knockouts) ?? 0)),
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
      backpack,
      equipment: backpack,
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
    backpacks,
    backpackTotals,
    equipmentTotals: backpackTotals,
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
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  MIRAMAR: {
    mapName: "MIRAMAR",
    worldSize: 816000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  SANHOK: {
    mapName: "SANHOK",
    worldSize: 408000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  VIKENDI: {
    mapName: "VIKENDI",
    worldSize: 612000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  LIVIK: {
    mapName: "LIVIK",
    worldSize: 408000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  LIVIK_AFTERMATH: {
    mapName: "LIVIK AFTERMATH",
    worldSize: 408000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  KARAKIN: {
    mapName: "KARAKIN",
    worldSize: 204000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  NUSA: {
    mapName: "NUSA",
    worldSize: 102000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  RONDO: {
    mapName: "RONDO",
    worldSize: 816000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  TAEGO: {
    mapName: "TAEGO",
    worldSize: 816000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  DESTON: {
    mapName: "DESTON",
    worldSize: 816000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  PARAMO: {
    mapName: "PARAMO",
    worldSize: 306000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
  HAVEN: {
    mapName: "HAVEN",
    worldSize: 102000,
    coordinateSystem: "WORLD",
    coordinateScaleHint: 102,
  },
};

const DIRECT_MAP_OVERLAY_ALIASES = {
  ERANGEL8X8: "ERANGEL",
  ERANGEL_MAIN: "ERANGEL",
  BALTIC_MAIN: "ERANGEL",
  BALTICMAIN: "ERANGEL",
  MIRAMAR8X8: "MIRAMAR",
  DESERT_MAIN: "MIRAMAR",
  DESERTMAIN: "MIRAMAR",
  SANHOK4X4: "SANHOK",
  SAVAGE_MAIN: "SANHOK",
  SAVAGEMAIN: "SANHOK",
  VIKENDI6X6: "VIKENDI",
  DIHOROTOK_MAIN: "VIKENDI",
  DIHOROTOKMAIN: "VIKENDI",
  LIVIK4X4: "LIVIK",
  LIVIKAFTERMATH: "LIVIK_AFTERMATH",
  AFTERMATH: "LIVIK_AFTERMATH",
  KARAKIN2X2: "KARAKIN",
  SUMMERLAND_MAIN: "KARAKIN",
  SUMMERLANDMAIN: "KARAKIN",
  NUSA1X1: "NUSA",
  RONDO8X8: "RONDO",
  RONDO_MAIN: "RONDO",
  RONDOMAIN: "RONDO",
  NEON_MAIN: "RONDO",
  NEONMAIN: "RONDO",
  TAEGO8X8: "TAEGO",
  TIGER_MAIN: "TAEGO",
  TIGERMAIN: "TAEGO",
  DESTON8X8: "DESTON",
  KIKI_MAIN: "DESTON",
  KIKIMAIN: "DESTON",
  PARAMO3X3: "PARAMO",
  CHIMERA_MAIN: "PARAMO",
  CHIMERAMAIN: "PARAMO",
  HAVEN1X1: "HAVEN",
  HAVENMAIN: "HAVEN",
  HEAVEN_MAIN: "HAVEN",
  HEAVENMAIN: "HAVEN",
};

function normalizeDirectMapOverlayKey(value) {
  const normalized = textValue(value);
  if (!normalized) {
    return null;
  }

  return normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function isDirectMapOverlayLookupMatch(value, candidate) {
  const normalizedValue = normalizeDirectMapOverlayKey(value);
  const normalizedCandidate = normalizeDirectMapOverlayKey(candidate);
  if (!normalizedValue || !normalizedCandidate) {
    return false;
  }
  return (
    normalizedValue === normalizedCandidate ||
    `_${normalizedValue}_`.includes(`_${normalizedCandidate}_`)
  );
}

function resolveDirectMapOverlayConfig(mapName) {
  const key = normalizeDirectMapOverlayKey(mapName);
  if (!key) {
    return null;
  }

  const direct =
    DIRECT_MAP_OVERLAY_CONFIGS[key] ??
    DIRECT_MAP_OVERLAY_CONFIGS[DIRECT_MAP_OVERLAY_ALIASES[key]] ??
    null;
  if (direct) {
    return direct;
  }

  let resolvedKey = null;
  let resolvedLength = -1;
  for (const configKey of Object.keys(DIRECT_MAP_OVERLAY_CONFIGS)) {
    if (
      isDirectMapOverlayLookupMatch(key, configKey) &&
      configKey.length > resolvedLength
    ) {
      resolvedKey = configKey;
      resolvedLength = configKey.length;
    }
  }
  for (const [alias, configKey] of Object.entries(DIRECT_MAP_OVERLAY_ALIASES)) {
    if (
      isDirectMapOverlayLookupMatch(key, alias) &&
      alias.length > resolvedLength
    ) {
      resolvedKey = configKey;
      resolvedLength = alias.length;
    }
  }
  return resolvedKey ? DIRECT_MAP_OVERLAY_CONFIGS[resolvedKey] ?? null : null;
}

function findDirectMapOverlayConfigKey(config) {
  if (!config) {
    return null;
  }
  const entry = Object.entries(DIRECT_MAP_OVERLAY_CONFIGS).find(
    ([, candidate]) => candidate === config,
  );
  return entry ? entry[0].toLowerCase() : null;
}

function resolveRuntimeFallbackMap(value, { requireCanonicalKey = false } = {}) {
  if (typeof value !== "string") {
    return null;
  }
  const raw = value.trim();
  if (
    !raw ||
    Buffer.byteLength(raw, "utf8") > PCOB_RUNTIME_MAP_KEY_MAX_LENGTH
  ) {
    return null;
  }

  const normalized = normalizeDirectMapOverlayKey(raw);
  if (!normalized) {
    return null;
  }
  const configKey = DIRECT_MAP_OVERLAY_CONFIGS[normalized]
    ? normalized
    : DIRECT_MAP_OVERLAY_ALIASES[normalized] ?? null;
  const config = configKey ? DIRECT_MAP_OVERLAY_CONFIGS[configKey] ?? null : null;
  if (!config) {
    return null;
  }

  const mapKey = configKey.toLowerCase();
  if (requireCanonicalKey && raw !== mapKey) {
    return null;
  }

  return {
    mapKey,
    mapName: config.mapName,
  };
}

const initialRuntimeFallbackMap = resolveRuntimeFallbackMap(FORCED_MAP_NAME);
if (initialRuntimeFallbackMap) {
  runtimeFallbackMap = {
    ...initialRuntimeFallbackMap,
    updatedAt: new Date().toISOString(),
  };
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
      isFiring: player.isFiring === true,
      fireAngle: numberValue(player.fireAngle),
      fireDirection: player.fireDirection ? { ...player.fireDirection } : null,
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
    mapConfig?.coordinateSystem ?? "WORLD",
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
            coordinateSystem: mapConfig?.coordinateSystem ?? "WORLD",
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

function normalizeAchievementTimestamp(
  rawTimestampMs,
  relativeTimestampSeconds,
  updatedAtMs,
  candidate,
  maxRelativeTimestampMs,
) {
  const hasUsableRawTimestamp =
    rawTimestampMs !== null && rawTimestampMs >= ACHIEVEMENT_EVENT_TIMESTAMP_FLOOR_MS;
  if (hasUsableRawTimestamp) {
    return Math.trunc(rawTimestampMs);
  }

  if (relativeTimestampSeconds !== null && maxRelativeTimestampMs !== null) {
    const relativeTimestampMs = Math.trunc(relativeTimestampSeconds * 1000);
    return Math.max(0, updatedAtMs - (maxRelativeTimestampMs - relativeTimestampMs));
  }

  return Math.trunc(numberValue(candidate?.receivedAtMs) ?? updatedAtMs);
}

function achievementIsoTimestamp(value, fallback = null) {
  const timestamp =
    timestampMsValue(value) ??
    timestampMsValue(fallback) ??
    Date.now();
  return new Date(timestamp).toISOString();
}

function canEmitDirectFirstBlood(kills, teams) {
  if (!Array.isArray(kills) || kills.length === 0) {
    return false;
  }

  const earliestRelativeGameTimeSeconds = kills.reduce((minimum, kill) => {
    const relativeGameTimeSeconds = numberValue(kill?.relativeGameTimeSeconds);
    if (relativeGameTimeSeconds === null) {
      return minimum;
    }
    if (minimum === null || relativeGameTimeSeconds < minimum) {
      return relativeGameTimeSeconds;
    }
    return minimum;
  }, null);
  if (
    earliestRelativeGameTimeSeconds !== null &&
    earliestRelativeGameTimeSeconds > FIRST_BLOOD_MAX_RELATIVE_TIME_SECONDS
  ) {
    return false;
  }

  const currentTotalKills = (Array.isArray(teams) ? teams : []).reduce(
    (sum, team) => sum + Math.max(0, Math.trunc(numberValue(team?.kills) ?? 0)),
    0,
  );
  if (currentTotalKills > kills.length + 1) {
    return false;
  }

  const totalTeams = Array.isArray(teams) ? teams.length : 0;
  const aliveTeams = (Array.isArray(teams) ? teams : []).reduce(
    (sum, team) =>
      sum +
      (Math.max(0, Math.trunc(numberValue(team?.alivePlayers) ?? 0)) > 0 ? 1 : 0),
    0,
  );
  if (totalTeams >= 8 && aliveTeams > 0 && aliveTeams <= totalTeams - 2) {
    return false;
  }

  return true;
}

function collectDirectAssistRecords(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectDirectAssistRecords(entry, depth + 1));
  }

  const record = asObject(value);
  if (!record || Object.keys(record).length === 0) {
    return [];
  }

  const nestedLists = [
    record.PlayerAssistInfo,
    record.playerAssistInfo,
    record.assistInfo,
    record.AssistInfo,
    record.assists,
    record.Assists,
    record.list,
    record.data,
    record.Data,
  ].filter(Array.isArray);
  if (nestedLists.length > 0) {
    return nestedLists.flatMap((list) => collectDirectAssistRecords(list, depth + 1));
  }

  return [record];
}

function firstAssistArrayId(record) {
  for (const value of [
    record.assistUIdArray,
    record.assistUidArray,
    record.AssistUIdArray,
    record.assistUIDArray,
    record.assistPlayerIds,
    record.assistPlayerIDs,
  ]) {
    if (Array.isArray(value)) {
      const found = value.map(textValue).find(Boolean);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function buildDirectAssistLookup(playersById = new Map()) {
  const records = [
    ...collectDirectAssistRecords(shadowState.routePayloads["/setplayerassistinfo"]),
    ...collectDirectAssistRecords(shadowState.rawRoutePayloads["/setplayerassistinfo"]?.payload),
    ...collectDirectAssistRecords(shadowState.allInfo),
  ];
  const lookup = new Map();

  for (const record of records) {
    const killerPlayerId = firstTextValue(record, [
      "killerUId",
      "killerUid",
      "killerUID",
      "killerPlayerId",
      "killerPlayerID",
    ]);
    const victimPlayerId = firstTextValue(record, [
      "victimUId",
      "victimUid",
      "victimUID",
      "victimPlayerId",
      "victimPlayerID",
    ]);
    const assistPlayerId =
      firstAssistArrayId(record) ??
      firstTextValue(record, [
        "assistUId",
        "assistUid",
        "assistUID",
        "assistPlayerId",
        "assistPlayerID",
      ]);
    if (!assistPlayerId) {
      continue;
    }

    const assistPlayer = playersById.get(assistPlayerId) ?? null;
    const assist = {
      assistPlayerId,
      assistName: textValue(assistPlayer?.playerName) ?? null,
      assistTeamId: textValue(assistPlayer?.teamId) ?? null,
      raw: record,
    };
    const keys = [
      killerPlayerId && victimPlayerId ? `${killerPlayerId}:${victimPlayerId}` : null,
      victimPlayerId ? `victim:${victimPlayerId}` : null,
    ].filter(Boolean);
    for (const key of keys) {
      lookup.set(key, assist);
    }
  }

  return lookup;
}

function lookupDirectAssist(assistLookup, killerPlayerId, victimPlayerId) {
  if (!assistLookup || !victimPlayerId) {
    return null;
  }
  return (
    (killerPlayerId ? assistLookup.get(`${killerPlayerId}:${victimPlayerId}`) : null) ??
    assistLookup.get(`victim:${victimPlayerId}`) ??
    null
  );
}

function normalizeDirectKillEvents(playersById = new Map(), playersByName = new Map()) {
  const candidates = [];
  const assistLookup = buildDirectAssistLookup(playersById);
  const fallbackBaseTimestampMs =
    timestampMsValue(shadowState.updatedAt) ?? Date.now();

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
          Math.max(
            0,
            fallbackBaseTimestampMs -
              candidates.length * FALLBACK_KILL_EVENT_GAP_MS,
          ),
        sequence: candidates.length,
      });
    }
  };

  const killInfoEntries =
    asArray(shadowState.killInfoEntries).length > 0
      ? [...asArray(shadowState.killInfoEntries)].reverse()
      : [...asArray(shadowState.killInfo)].reverse().map((payload, index) => ({
          payload,
          receivedAtMs: Math.max(
            0,
            fallbackBaseTimestampMs - index * FALLBACK_KILL_EVENT_GAP_MS,
          ),
        }));

  for (const entry of killInfoEntries) {
    const entryRecord = asObject(entry);
    collectCandidates(entryRecord?.payload ?? entry, {
      receivedAtMs: numberValue(entryRecord?.receivedAtMs),
    });
  }

  const updatedAtMs = timestampMsValue(shadowState.updatedAt) ?? Date.now();
  const maxRelativeTimestampMs = candidates.reduce((currentMax, candidate) => {
    const relativeTimestampSeconds = firstNumberValue(candidate.record, [
      "CurGameTime",
      "curGameTime",
      "GameTime",
      "gameTime",
    ]);
    if (relativeTimestampSeconds === null) {
      return currentMax;
    }

    const relativeTimestampMs = Math.trunc(relativeTimestampSeconds * 1000);
    if (currentMax === null || relativeTimestampMs > currentMax) {
      return relativeTimestampMs;
    }
    return currentMax;
  }, null);

  const events = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const record = candidate.record;
    const resultStatus = firstTextValue(record, [
      "ResultHealthStatus",
      "resultHealthStatus",
      "healthStatus",
    ]);
    // Captured PCOB semantics: 1 is a knock, 2 is the final elimination.
    if (resultStatus && resultStatus !== "2") {
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
    const killerPlayer =
      (killerPlayerId ? playersById.get(killerPlayerId) : null) ??
      (killerName ? playersByName.get(killerName.toLowerCase()) : null) ??
      null;
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
    const victimName =
      firstTextValue(record, [
        "victimName",
        "victimIgn",
        "victimPlayerName",
        "victim",
        "VictimName",
      ]) ?? null;
    const victimPlayer =
      (victimPlayerId ? playersById.get(victimPlayerId) : null) ??
      (victimName ? playersByName.get(victimName.toLowerCase()) : null) ??
      null;
    const victimTeamId =
      firstTextValue(record, [
        "victimTeamId",
        "victimTeamID",
        "VictimTeamId",
        "VictimTeamID",
        "deadTeamId",
        "DeadTeamId",
      ]) ??
      textValue(victimPlayer?.teamId) ??
      null;
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
    const itemId =
      firstTextValue(record, [
        "ItemID",
        "itemID",
        "itemId",
        "ItemId",
        "WeaponId",
        "WeaponID",
        "weaponId",
        "weaponID",
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
    const directAssist = lookupDirectAssist(assistLookup, killerPlayerId, victimPlayerId);
    const assistPlayerId =
      firstTextValue(record, [
        "assistPlayerId",
        "assistPlayerID",
        "assistantPlayerId",
        "assistantPlayerID",
        "assisterPlayerId",
        "assisterPlayerID",
        "assistUid",
        "assistUID",
        "AssistUID",
        "AssisterUID",
      ]) ??
      directAssist?.assistPlayerId ??
      null;
    const assistName =
      firstTextValue(record, [
        "assistName",
        "assistantName",
        "assisterName",
        "AssistName",
        "AssistantName",
        "AssisterName",
      ]) ??
      directAssist?.assistName ??
      null;
    const assistPlayer =
      (assistPlayerId ? playersById.get(assistPlayerId) : null) ??
      (assistName ? playersByName.get(assistName.toLowerCase()) : null) ??
      null;
    const assistTeamId =
      firstTextValue(record, [
        "assistTeamId",
        "assistTeamID",
        "assistantTeamId",
        "assistantTeamID",
        "assisterTeamId",
        "assisterTeamID",
        "AssistTeamId",
        "AssistTeamID",
        "AssisterTeamId",
        "AssisterTeamID",
      ]) ??
      directAssist?.assistTeamId ??
      textValue(assistPlayer?.teamId) ??
      null;
    const assists =
      firstNumberValue(record, [
        "assists",
        "Assists",
        "assistCount",
        "AssistCount",
        "assistNum",
        "AssistNum",
      ]) ?? null;
    const damage =
      firstNumberValue(record, [
        "damage",
        "Damage",
        "damageValue",
        "DamageValue",
        "damageAmount",
        "DamageAmount",
      ]) ?? null;
    const distance =
      firstNumberValue(record, [
        "distance",
        "Distance",
        "killDistance",
        "KillDistance",
        "shotDistance",
        "ShotDistance",
      ]) ?? null;
    const headshot =
      booleanValue(
        record.isHeadShot ??
          record.IsHeadShot ??
          record.isHeadshot ??
          record.IsHeadshot ??
          record.headshot ??
          record.Headshot,
      ) ?? null;
    if (!killerPlayerId && !killerTeamId && !victimPlayerId && !victimTeamId) {
      continue;
    }

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
    const timestamp = normalizeAchievementTimestamp(
      rawTimestampMs,
      relativeTimestampSeconds,
      updatedAtMs,
      candidate,
      maxRelativeTimestampMs,
    );
    const timeKey =
      rawTimestampMs !== null && rawTimestampMs >= ACHIEVEMENT_EVENT_TIMESTAMP_FLOOR_MS
        ? `ts:${Math.trunc(rawTimestampMs)}`
        : relativeTimestampSeconds !== null
          ? `gt:${Math.trunc(relativeTimestampSeconds * 1000)}`
          : `rcv:${Math.trunc(numberValue(candidate.receivedAtMs) ?? updatedAtMs)}`;
    const killId =
      firstTextValue(record, ["killId", "KillId", "id", "ID", "eventId"]) ??
      [
        killerPlayerId ?? killerName ?? killerTeamId ?? "unknown-killer",
        victimPlayerId ?? victimName ?? victimTeamId ?? "unknown-victim",
        victimTeamId ?? "unknown-team",
        timeKey,
      ].join(":");

    if (seen.has(killId)) {
      continue;
    }
    seen.add(killId);

    events.push({
      eventId: killId,
      killerPlayerId: textValue(killerPlayer?.playerId) ?? killerPlayerId,
      killerTeamId: textValue(killerPlayer?.teamId) ?? killerTeamId,
      killerName: textValue(killerPlayer?.playerName) ?? killerName,
      victimPlayerId: textValue(victimPlayer?.playerId) ?? victimPlayerId,
      victimTeamId,
      victimName: textValue(victimPlayer?.playerName) ?? victimName,
      weapon,
      itemId,
      cause,
      assistPlayerId: textValue(assistPlayer?.playerId) ?? assistPlayerId,
      assistTeamId,
      assistName: textValue(assistPlayer?.playerName) ?? assistName,
      assists,
      damage,
      distance,
      headshot,
      raw: record,
      relativeGameTimeSeconds: relativeTimestampSeconds,
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

const DIRECT_GRENADE_KILL_ITEM_IDS = new Set(["602004"]);
const DIRECT_MOLOTOV_KILL_ITEM_IDS = new Set(["602003"]);

function isDirectVehicleKillItemId(value) {
  const itemId = textValue(value);
  return Boolean(itemId && /^190\d+/.test(itemId));
}

function detectDirectSpecialKillType(kill) {
  const itemId =
    textValue(kill?.itemId) ??
    firstTextValue(asObject(kill?.raw), ["ItemID", "itemID", "itemId", "ItemId"]);
  if (itemId && DIRECT_GRENADE_KILL_ITEM_IDS.has(itemId)) {
    return "GRENADE_KILL";
  }
  if (itemId && DIRECT_MOLOTOV_KILL_ITEM_IDS.has(itemId)) {
    return "MOLOTOV_KILL";
  }
  if (isDirectVehicleKillItemId(itemId)) {
    return "VEHICLE_KILL";
  }

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

  if (/\b(molotov|incendiary)\b/.test(source)) {
    return "MOLOTOV_KILL";
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
    for (const playerId of Array.isArray(player.playerIds) ? player.playerIds : [player.playerId]) {
      if (textValue(playerId)) {
        playersById.set(textValue(playerId), player);
      }
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
  const kills = normalizeDirectKillEvents(playersById, playersByName);
  let firstBloodEmitted = !canEmitDirectFirstBlood(kills, teams);

  const pushEvent = (event) => {
    if (!event || emitted.has(event.eventId)) {
      return;
    }
    emitted.add(event.eventId);
    events.push(event);
  };

  for (const kill of kills) {
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
    const timestampIso = achievementIsoTimestamp(kill.timestamp, shadowState.updatedAt);
    const hasKillerIdentity =
      Boolean(killerPlayer?.playerId) ||
      Boolean(kill.killerPlayerId) ||
      Boolean(killerName);

    const killerIdentity = killerPlayer?.playerId ?? killerName ?? null;
    const buildEvent = (type, eventId, extra = {}) => {
      const victimTeam = kill.victimTeamId ? teamsById.get(kill.victimTeamId) ?? null : null;
      const assistPlayer =
        (kill.assistPlayerId ? playersById.get(kill.assistPlayerId) : null) ??
        (kill.assistName ? playersByName.get(kill.assistName.toLowerCase()) : null) ??
        null;
      const assistTeamId =
        kill.assistTeamId ??
        textValue(assistPlayer?.teamId) ??
        null;
      const assistTeam = assistTeamId ? teamsById.get(assistTeamId) ?? null : null;
      const hasVictim =
        Boolean(kill.victimPlayerId) ||
        Boolean(kill.victimName) ||
        Boolean(kill.victimTeamId);
      const hasAssist =
        Boolean(assistPlayer?.playerId) ||
        Boolean(kill.assistPlayerId) ||
        Boolean(kill.assistName) ||
        Boolean(assistTeamId);

      return {
        matchId,
        eventId,
        type,
        ...(numberValue(extra.kills) !== null
          ? { kills: Math.max(0, Math.trunc(numberValue(extra.kills))) }
          : {}),
        player: {
          id: killerPlayer?.playerId ?? kill.killerPlayerId ?? null,
          name: killerName,
          photoUrl: null,
        },
        team: {
          id: killerTeamId,
          name: textValue(killerTeam?.teamName) ?? textValue(killerPlayer?.teamName) ?? null,
          tag: textValue(killerTeam?.teamTag),
          logoUrl: textValue(killerTeam?.logoUrl),
        },
        victim: hasVictim
          ? {
              id: kill.victimPlayerId ?? null,
              name: kill.victimName ?? null,
              teamId: kill.victimTeamId ?? null,
              teamName: textValue(victimTeam?.teamName) ?? null,
              teamTag: textValue(victimTeam?.teamTag) ?? null,
              logoUrl: textValue(victimTeam?.logoUrl) ?? null,
            }
          : null,
        assist: hasAssist
          ? {
              id: assistPlayer?.playerId ?? kill.assistPlayerId ?? null,
              name: textValue(assistPlayer?.playerName) ?? kill.assistName ?? null,
              teamId: assistTeamId,
              teamName:
                textValue(assistTeam?.teamName) ??
                textValue(assistPlayer?.teamName) ??
                null,
              teamTag: textValue(assistTeam?.teamTag) ?? null,
              logoUrl: textValue(assistTeam?.logoUrl) ?? null,
            }
          : null,
        weapon: kill.weapon ?? null,
        itemId: kill.itemId ?? null,
        cause: kill.cause ?? null,
        assists: numberValue(kill.assists),
        damage: numberValue(kill.damage),
        distance: numberValue(kill.distance),
        headshot: typeof kill.headshot === "boolean" ? kill.headshot : null,
        relativeGameTimeSeconds: numberValue(kill.relativeGameTimeSeconds),
        killEventId: kill.eventId,
        raw: kill.raw ?? null,
        playerStats: killerPlayer
          ? {
              kills: numberValue(killerPlayer.kills),
              assists: numberValue(killerPlayer.assists),
              damage: numberValue(killerPlayer.damage),
              knockouts: numberValue(killerPlayer.knockouts),
              alive: killerPlayer.alive === true,
              knocked: killerPlayer.knocked === true,
              health: numberValue(killerPlayer.health),
              outsideBlueCircle:
                typeof killerPlayer.outsideBlueCircle === "boolean"
                  ? killerPlayer.outsideBlueCircle
                  : null,
              x: numberValue(killerPlayer.x),
              y: numberValue(killerPlayer.y),
            }
          : null,
        teamStats: killerTeam
          ? {
              slot: numberValue(killerTeam.slot),
              kills: numberValue(killerTeam.kills),
              alivePlayers: numberValue(killerTeam.alivePlayers),
              totalPlayers: numberValue(killerTeam.totalPlayers),
              placement: numberValue(killerTeam.placement),
            }
          : null,
        timestamp: timestampIso,
      };
    };

    if (!firstBloodEmitted && hasKillerIdentity) {
      firstBloodEmitted = true;
      pushEvent(buildEvent("FIRST_BLOOD", `${matchId}:FIRST_BLOOD:${kill.eventId}`));
    }
    const specialKillType = detectDirectSpecialKillType(kill);
    if (specialKillType) {
      pushEvent(buildEvent(specialKillType, `${matchId}:${specialKillType}:${kill.eventId}`));
    }
    if (kill.headshot === true) {
      pushEvent(buildEvent("HEADSHOT", `${matchId}:HEADSHOT:${kill.eventId}`));
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
        pushEvent(
          buildEvent(streakType, `${matchId}:${streakType}:${kill.eventId}`, {
            kills: streak.length,
          }),
        );
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

    pushEvent(buildEvent("TEAM_WIPE", `${matchId}:TEAM_WIPE:${kill.eventId}`));

    const killerAlivePlayers = Math.max(
      0,
      Math.trunc(numberValue(killerTeam?.alivePlayers) ?? 0),
    );
    if (killerTeamId && killerAlivePlayers === 1) {
      pushEvent(buildEvent("CLUTCH", `${matchId}:CLUTCH:${kill.eventId}`));
    }
  }

  return {
    matchId,
    updatedAt: shadowState.updatedAt ?? new Date().toISOString(),
    events: events.slice(-MAX_DIRECT_ACHIEVEMENT_EVENTS),
  };
}

function preserveLargeNumericIdentifiers(rawText) {
  if (typeof rawText !== "string" || rawText.length === 0) {
    return rawText;
  }

  // JSON.parse rounds integers outside JavaScript's safe range. Walk the JSON
  // text instead of matching a finite list of ID field names so RoomID and any
  // future PCOB identifier remain exact in the convenience payload. The raw
  // request bytes are stored separately and are never changed by this parser.
  let output = "";
  let index = 0;
  let inString = false;
  let escaped = false;
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  const minimum = BigInt(Number.MIN_SAFE_INTEGER);

  while (index < rawText.length) {
    const character = rawText[index];
    if (inString) {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      index += 1;
      continue;
    }

    if (character === "-" || (character >= "0" && character <= "9")) {
      const match = rawText.slice(index).match(/^-?(?:0|[1-9]\d*)/);
      if (match) {
        const token = match[0];
        const nextCharacter = rawText[index + token.length] ?? "";
        if (nextCharacter !== "." && nextCharacter !== "e" && nextCharacter !== "E") {
          try {
            const value = BigInt(token);
            if (value > maximum || value < minimum) {
              output += `"${token}"`;
              index += token.length;
              continue;
            }
          } catch {}
        }
      }
    }

    output += character;
    index += 1;
  }

  return output;
}

function parsePcobRawBuffer(rawBuffer) {
  const body = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer || "");
  const rawText = body.toString("utf8");
  if (!rawText.trim()) {
    return {};
  }
  try {
    return JSON.parse(preserveLargeNumericIdentifiers(rawText));
  } catch {
    return { raw: rawText };
  }
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
    record.GameTime !== undefined ||
    record.gameTime !== undefined ||
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
    record.GameTime !== undefined ||
    record.gameTime !== undefined ||
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
  "GameTime",
  "gameTime",
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
  const receivedAt = new Date().toISOString();
  shadowState.rawRoutePayloads[path] = {
    payload: payload ?? null,
    receivedAt,
  };

  let reduced = pickRichestCirclePayload(payload);
  const observedFlightPath = extractDirectFlightPath(payload);
  const flightPath = observedFlightPath
    ? rememberMatchFlightPath(observedFlightPath, receivedAt)
    : null;
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
    } else if (path === "/setteambackpackinfo") {
      const backpacks = aggregateDirectBackpacks(normalizeDirectBackpacks(payload));
      const totals = buildDirectBackpackTotals(backpacks);
      reduced = {
        backpacks: backpacks.length,
        itemCount: totals.itemCount,
        totals,
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
      reduced = { isInGame: getDirectIsInGame(), updatedAt: new Date().toISOString() };
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

function cancelOutOfGameReset() {
  outOfGameResetGeneration += 1;
  if (outOfGameResetTimer) {
    clearTimeout(outOfGameResetTimer);
    outOfGameResetTimer = null;
  }
  lifecycleState.pendingOutOfGameSince = null;
}

function resetShadowState(reason, nextGameId = null) {
  cancelOutOfGameReset();
  shadowState.allInfo = {};
  shadowState.playerInfoList = [];
  shadowState.teamInfoList = [];
  shadowState.teamBackpackInfo = [];
  shadowState.killInfo = [];
  shadowState.killInfoEntries = [];
  shadowState.circleInfo = {};
  shadowState.bestCircleInfo = {};
  shadowState.observingPlayer = {};
  shadowState.isInGame = false;
  shadowState.gameId = textValue(nextGameId);
  shadowState.routePayloads = {};
  shadowState.rawRoutePayloads = {};
  shadowState.playerMetricMaxima.clear();
  shadowState.gameTimeSecondsMax = null;
  shadowState.matchFlightPath = null;
  shadowState.conflictingFlightPathCount = 0;
  shadowState.lastConflictingFlightPath = null;
  shadowState.lastConflictingFlightPathAt = null;
  shadowState.updatedAt = new Date().toISOString();
  transportState.resetState();
  lifecycleState.resetCount += 1;
  lifecycleState.lastResetAt = shadowState.updatedAt;
  lifecycleState.lastResetReason = String(reason || "unknown");
}

function scheduleOutOfGameReset() {
  if (!lifecycleState.pendingOutOfGameSince) {
    lifecycleState.pendingOutOfGameSince = new Date().toISOString();
  }
  outOfGameResetGeneration += 1;
  const generation = outOfGameResetGeneration;
  if (outOfGameResetTimer) {
    clearTimeout(outOfGameResetTimer);
  }

  const checkQuietPeriod = () => {
    if (
      generation !== outOfGameResetGeneration ||
      !lifecycleState.pendingOutOfGameSince
    ) {
      return;
    }
    const lastActivityMs =
      timestampMsValue(lifecycleState.lastGameplayEventAt) ??
      timestampMsValue(lifecycleState.pendingOutOfGameSince) ??
      Date.now();
    const remainingMs =
      PCOB_OUT_OF_GAME_RESET_DEBOUNCE_MS - (Date.now() - lastActivityMs);
    if (remainingMs > 0) {
      outOfGameResetTimer = setTimeout(checkQuietPeriod, remainingMs);
      outOfGameResetTimer.unref?.();
      return;
    }
    outOfGameResetTimer = null;
    resetShadowState("explicit_out_of_game");
  };

  outOfGameResetTimer = setTimeout(checkQuietPeriod, PCOB_OUT_OF_GAME_RESET_DEBOUNCE_MS);
  outOfGameResetTimer.unref?.();
}

function noteGameplayActivity(receivedAtMs = Date.now()) {
  lifecycleState.lastGameplayEventAt = new Date(receivedAtMs).toISOString();
  if (lifecycleState.pendingOutOfGameSince) {
    scheduleOutOfGameReset();
  }
}

function explicitInGameState(payload) {
  if (typeof payload === "boolean") {
    return payload;
  }
  if (typeof payload === "number") {
    return payload === 1 ? true : payload === 0 ? false : null;
  }
  if (typeof payload === "string") {
    const normalized = payload.trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (["ingame", "playing", "active", "true", "1"].includes(normalized)) {
      return true;
    }
    if (
      ["outgame", "notingame", "lobby", "ended", "finished", "false", "0"].includes(
        normalized,
      )
    ) {
      return false;
    }
    return null;
  }
  const record = asObject(payload);
  if (!record) {
    return null;
  }
  for (const key of [
    "isInGame",
    "IsInGame",
    "inGame",
    "InGame",
    "gameState",
    "GameState",
    "status",
    "Status",
  ]) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return explicitInGameState(record[key]);
    }
  }
  return null;
}

function lifecycleSummary() {
  return {
    ...lifecycleState,
    gameId: shadowState.gameId,
    resetDebounceMs: PCOB_OUT_OF_GAME_RESET_DEBOUNCE_MS,
  };
}

function updateShadowState(path, payload) {
  if (path === "/totalmessage") {
    const incomingAllInfo = asObject(payload?.allinfo ?? payload?.allInfo ?? payload) ?? {};
    const incomingGameId = firstTextValue(incomingAllInfo, [
      "GameID",
      "gameId",
      "GameId",
      "gameID",
    ]);
    if (
      incomingGameId &&
      shadowState.gameId &&
      incomingGameId !== shadowState.gameId
    ) {
      resetShadowState("game_id_transition", incomingGameId);
    } else if (incomingGameId) {
      shadowState.gameId = incomingGameId;
    }
  }

  if (path !== "/setisingame") {
    noteGameplayActivity();
  } else {
    const nextInGame = explicitInGameState(payload);
    if (nextInGame === true) {
      shadowState.isInGame = true;
      cancelOutOfGameReset();
    } else if (nextInGame === false) {
      shadowState.isInGame = false;
      scheduleOutOfGameReset();
    }
  }

  shadowState.updatedAt = new Date().toISOString();
  rememberRoutePayload(path, payload);

  if (path === "/totalmessage") {
    const nextAllInfo = asObject(payload?.allinfo ?? payload?.allInfo ?? payload) ?? {};
    const nextPlayerInfoList = asArray(
      nextAllInfo.TotalPlayerList ?? nextAllInfo.playerInfoList,
    );
    const rawTeamInfoList = asArray(nextAllInfo.TeamInfoList ?? nextAllInfo.teamInfoList);
    const nextTeamBackpackInfo = extractDirectBackpackList(nextAllInfo);
    const hasTeamBackpackInfo =
      nextTeamBackpackInfo.length > 0 ||
      nextAllInfo.TeamBackpackInfo !== undefined ||
      nextAllInfo.teamBackpackInfo !== undefined ||
      nextAllInfo.TeamBackPackInfo !== undefined ||
      nextAllInfo.teamBackPackInfo !== undefined ||
      nextAllInfo.TeamBackPackList !== undefined ||
      nextAllInfo.teamBackPackList !== undefined ||
      nextAllInfo.TeamBackpackList !== undefined ||
      nextAllInfo.teamBackpackList !== undefined ||
      nextAllInfo.backpacks !== undefined;
    const nextTeamInfoList = mergeDirectTeamInfoList(
      rawTeamInfoList,
      shadowState.teamInfoList,
    );
    transportState.ingestTotalMessage({
      ...nextAllInfo,
      TotalPlayerList: nextPlayerInfoList,
      TeamInfoList: rawTeamInfoList,
      ...(hasTeamBackpackInfo ? { TeamBackpackInfo: nextTeamBackpackInfo } : {}),
    });
    shadowState.playerInfoList = nextPlayerInfoList;
    shadowState.teamInfoList = nextTeamInfoList;
    shadowState.teamBackpackInfo = mergeDirectBackpackInfoList(
      shadowState.teamBackpackInfo,
      nextTeamBackpackInfo,
    );
    shadowState.allInfo = {
      ...nextAllInfo,
      TotalPlayerList: nextPlayerInfoList,
      TeamInfoList: nextTeamInfoList,
      TeamBackpackInfo: shadowState.teamBackpackInfo,
    };
    const totalCircle = pickRichestCirclePayload(shadowState.allInfo);
    if (Object.keys(totalCircle).length > 0) {
      shadowState.circleInfo = totalCircle;
      updateBestCircle(totalCircle);
    }
    return;
  }

  if (path === "/settotalplayerlist") {
    const list = asArray(payload?.playerInfoList ?? payload?.TotalPlayerList ?? payload);
    transportState.ingestPlayerList(list);
    shadowState.playerInfoList = list;
    const teamBackpackInfo = refreshDirectBackpackInfoCache();
    shadowState.allInfo = {
      ...shadowState.allInfo,
      TotalPlayerList: list,
      TeamBackpackInfo: teamBackpackInfo,
    };
    return;
  }

  if (path === "/setteaminfolist") {
    const rawList = asArray(payload?.teamInfoList ?? payload?.TeamInfoList ?? payload);
    const list = mergeDirectTeamInfoList(
      rawList,
      shadowState.teamInfoList,
    );
    transportState.ingestTeamList(rawList);
    shadowState.teamInfoList = list;
    const teamBackpackInfo = refreshDirectBackpackInfoCache();
    shadowState.allInfo = {
      ...shadowState.allInfo,
      TeamInfoList: list,
      TeamBackpackInfo: teamBackpackInfo,
    };
    return;
  }

  if (path === "/setteambackpackinfo") {
    const list = extractDirectBackpackList(payload);
    const mergedList = mergeDirectBackpackInfoList(shadowState.teamBackpackInfo, list);
    transportState.ingestBackpackInfo({
      TeamBackpackInfo: list,
    });
    shadowState.teamBackpackInfo = mergedList;
    shadowState.allInfo = {
      ...shadowState.allInfo,
      TeamBackpackInfo: mergedList,
    };
    return;
  }

  if (path === "/setkillinfo") {
    transportState.ingestKillInfo(payload);
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
    transportState.ingestCircleInfo(payload);
    shadowState.circleInfo = circle;
    updateBestCircle(circle);
    shadowState.allInfo = {
      ...shadowState.allInfo,
      CircleInfo: circle,
    };
    return;
  }

  if (path === "/setobservingplayer") {
    transportState.ingestObserver(payload);
    shadowState.observingPlayer = asObject(payload);
    return;
  }

  if (path === "/setisingame") {
    return;
  }

  const inferredCircle = pickRichestCirclePayload(payload);
  if (Object.keys(inferredCircle).length > 0) {
    transportState.ingestInferredCircle(payload);
    shadowState.circleInfo = inferredCircle;
    updateBestCircle(inferredCircle);
  }
}

function getObserverMatchId() {
  return MATCH_ID;
}

function buildDirectObserverSnapshot() {
  const teamBackpackInfo = refreshDirectBackpackInfoCache();
  const publicTeamBackpackInfo = stripDirectBackpackInternalKeysList(teamBackpackInfo);
  const mapSelection = getDirectMapSelection();
  const publicAllInfo = exposeDirectMapSelection(
    {
      ...shadowState.allInfo,
      TeamBackpackInfo: publicTeamBackpackInfo,
    },
    mapSelection,
  );
  const players = normalizeDirectPlayers();
  const teams = sortDirectLeaderboardTeams(normalizeDirectTeams(players));
  const playerBackpacks = normalizeDirectBackpacks(
    asArray(publicTeamBackpackInfo).length > 0
      ? publicTeamBackpackInfo
      : publicAllInfo,
  );
  const backpacks = aggregateDirectBackpacks(playerBackpacks);
  const circle = normalizeDirectCircle();
  const flightPath =
    cloneDirectFlightPath(shadowState.matchFlightPath) ??
    extractDirectFlightPath(shadowState.routePayloads["/setgameglobalinfo"]) ??
    extractDirectFlightPath(publicAllInfo) ??
    null;

  return {
    producer: "shadowtracker-ob-js",
    activeMatchId: getObserverMatchId() || null,
    sessionId: SESSION_ID || null,
    gameId: shadowState.gameId,
    updatedAt: shadowState.updatedAt ?? new Date().toISOString(),
    isInGame: getDirectIsInGame(),
    lifecycle: lifecycleSummary(),
    rawEventSummary: rawEventSpool.getSnapshotSummary(),
    mapName: mapSelection.mapName,
    mapNameSource: mapSelection.source,
    mapSelection,
    allInfo: publicAllInfo,
    playerInfoList: shadowState.playerInfoList,
    teamInfoList: shadowState.teamInfoList,
    teamBackpackInfo: publicTeamBackpackInfo,
    killInfo: shadowState.killInfo,
    killInfoEntries: shadowState.killInfoEntries,
    circleInfo: shadowState.circleInfo,
    bestCircleInfo: shadowState.bestCircleInfo,
    observingPlayer: shadowState.observingPlayer,
    routePayloads: shadowState.routePayloads,
    rawRoutePayloads: shadowState.rawRoutePayloads,
    normalized: {
      players,
      teams,
      backpacks,
      playerBackpacks,
      backpackTotals: buildDirectBackpackTotals(backpacks),
      circle,
      flightPath,
    },
    flightPathDiagnostics: {
      canonical: cloneDirectFlightPath(shadowState.matchFlightPath),
      conflictingUpdateCount: shadowState.conflictingFlightPathCount,
      lastConflictingPath: cloneDirectFlightPath(
        shadowState.lastConflictingFlightPath,
      ),
      lastConflictingAt: shadowState.lastConflictingFlightPathAt,
    },
  };
}

function buildObserverTelemetryPayload(rawBatch = rawEventSpool.buildDeliveryBatch()) {
  const payload = transportState.buildPayload({
    matchId: getObserverMatchId(),
    sessionId: SESSION_ID || null,
    timestamp: Date.now(),
  });
  const snapshot = buildDirectObserverSnapshot();
  const transportSnapshot = {
    ...snapshot,
    // The top-level transient fields are the delivery contract. Keeping the
    // widget history arrays in the backend snapshot would replay old kills on
    // later legacy snapshots after their raw events were already acknowledged.
    killInfo: [],
    killInfoEntries: [],
  };
  return {
    ...payload,
    source: "shadowtracker-ob-js",
    allInfo: shadowState.allInfo,
    routePayloads: shadowState.routePayloads,
    rawRoutePayloads: shadowState.rawRoutePayloads,
    isInGame: getDirectIsInGame(),
    observerSnapshot: transportSnapshot,
    raw: transportSnapshot,
    ...(rawBatch.envelope.events.length > 0
      ? { rawEvents: rawBatch.envelope }
      : {}),
  };
}

function hasMeaningfulObserverTelemetry(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const players = Array.isArray(payload.players) ? payload.players.length : 0;
  const teams = Array.isArray(payload.teams) ? payload.teams.length : 0;
  const kills = Array.isArray(payload.kills) ? payload.kills.length : 0;
  const backpacks = Array.isArray(payload.backpacks) ? payload.backpacks.length : 0;
  const rawEvents = Array.isArray(payload.rawEvents?.events)
    ? payload.rawEvents.events.length
    : 0;
  const hasCircle =
    payload.circle && typeof payload.circle === "object"
      ? Object.keys(payload.circle).length > 0
      : false;
  return players > 0 || teams > 0 || kills > 0 || backpacks > 0 || rawEvents > 0 || hasCircle;
}

function observerPayloadBytes(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function compactObserverTelemetryPayload(payload) {
  const compactSnapshot = {
    ...payload.observerSnapshot,
    allInfo: {},
    routePayloads: {},
    rawRoutePayloads: {},
  };
  return {
    ...payload,
    allInfo: {},
    routePayloads: {},
    rawRoutePayloads: {},
    observerSnapshot: compactSnapshot,
    raw: compactSnapshot,
  };
}

function stripTransientEventMirrors(payload) {
  const snapshot = {
    ...payload.observerSnapshot,
    killInfo: [],
    killInfoEntries: [],
    circleInfo: {},
    bestCircleInfo: {},
  };
  return {
    ...payload,
    kills: [],
    circle: {},
    circleInfo: {},
    observerSnapshot: snapshot,
    raw: snapshot,
  };
}

async function forwardObserverTelemetry() {
  if (telemetryInFlight) {
    return;
  }

  telemetryInFlight = true;
  try {
    const transientCursor = transportState.captureTransientCursor();
    const rawBatch = rawEventSpool.buildDeliveryBatch();
    let payload = buildObserverTelemetryPayload(rawBatch);
    let rawOnlySplit = false;
    let transientAcknowledgedByRawOnly = false;
    if (!payload.matchId) {
      return;
    }
    if (
      rawBatch.envelope.events.length > 0 &&
      (rawBatch.encodedBytes > PCOB_RAW_EVENT_INLINE_MAX_BYTES ||
        observerPayloadBytes(payload) > OBSERVER_TELEMETRY_REQUEST_SAFE_BYTES)
    ) {
      rawOnlySplit = true;
      const rawOnlyPayload = {
        matchId: payload.matchId,
        sessionId: payload.sessionId,
        timestamp: Date.now(),
        sequence: nextObserverSequence(),
        source: "shadowtracker-ob-js",
        rawEventsOnly: true,
        players: [],
        teams: [],
        backpacks: [],
        teamBackpackInfo: [],
        kills: [],
        observer: {},
        circle: {},
        circleInfo: {},
        rawEvents: rawBatch.envelope,
      };
      const rawOnlyDelivered = await postObserverTelemetry(rawOnlyPayload);
      if (rawOnlyDelivered) {
        transportState.ackTransientEvents(transientCursor);
        transientAcknowledgedByRawOnly = true;
      }
      const compactedPayload = compactObserverTelemetryPayload(payload);
      const payloadWithoutRawEvents = { ...compactedPayload };
      delete payloadWithoutRawEvents.rawEvents;
      payload = stripTransientEventMirrors(payloadWithoutRawEvents);
    }
    if (observerPayloadBytes(payload) > OBSERVER_TELEMETRY_REQUEST_SAFE_BYTES) {
      payload = compactObserverTelemetryPayload(payload);
    }
    if (!hasMeaningfulObserverTelemetry(payload)) {
      if (VERBOSE_LOG) {
        console.log("[observer-forward] skipped empty observer snapshot");
      }
      return;
    }
    payload.sequence = nextObserverSequence();

    const delivered = await postObserverTelemetry(payload);
    if (
      delivered &&
      !transientAcknowledgedByRawOnly &&
      !rawOnlySplit
    ) {
      transportState.ackTransientEvents(transientCursor);
    }
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

function pendingRouteEventCount() {
  return Math.max(0, pendingRouteEvents.length - pendingRouteEventHead);
}

function pendingForwardEventCount() {
  return Math.max(0, pendingForwardEvents.length - pendingForwardEventHead);
}

function forwardPayloadByteLength(payload) {
  try {
    return Buffer.byteLength(JSON.stringify(payload));
  } catch {
    return 0;
  }
}

function dequeuePendingForwardEvent() {
  if (pendingForwardEventCount() === 0) {
    return null;
  }

  const event = pendingForwardEvents[pendingForwardEventHead] ?? null;
  pendingForwardEvents[pendingForwardEventHead] = undefined;
  pendingForwardEventHead += 1;
  if (event) {
    pendingForwardEventBytes = Math.max(
      0,
      pendingForwardEventBytes - event.byteLength,
    );
  }

  if (pendingForwardEventHead >= pendingForwardEvents.length) {
    pendingForwardEvents.length = 0;
    pendingForwardEventHead = 0;
    pendingForwardEventBytes = 0;
  } else if (
    pendingForwardEventHead >= 1_024 &&
    pendingForwardEventHead * 2 >= pendingForwardEvents.length
  ) {
    pendingForwardEvents.splice(0, pendingForwardEventHead);
    pendingForwardEventHead = 0;
  }

  return event;
}

function enqueuePendingForwardEvent(targetUrl, payload) {
  const byteLength = forwardPayloadByteLength(payload);
  let droppedThisEnqueue = 0;

  while (
    pendingForwardEventCount() > 0 &&
    (pendingForwardEventCount() >= MAX_PENDING_FORWARD_EVENTS ||
      pendingForwardEventBytes + byteLength > MAX_PENDING_FORWARD_BYTES)
  ) {
    dequeuePendingForwardEvent();
    droppedThisEnqueue += 1;
  }

  if (droppedThisEnqueue > 0) {
    pendingForwardEventDrops += droppedThisEnqueue;
    const now = Date.now();
    if (
      now - lastPendingForwardOverflowLogAt >=
      PENDING_HANDLER_OVERFLOW_LOG_INTERVAL_MS
    ) {
      lastPendingForwardOverflowLogAt = now;
      console.warn(
        `[forward] Pending FIFO capacity reached; dropped ${droppedThisEnqueue} oldest packet(s). totalDropped=${pendingForwardEventDrops}`,
      );
    }
  }

  pendingForwardEvents.push({ targetUrl, payload, byteLength });
  pendingForwardEventBytes += byteLength;
  void flushPendingForwards();
}

async function flushPendingForwards() {
  if (forwardDrainActive) {
    return;
  }
  forwardDrainActive = true;

  try {
    while (pendingForwardEventCount() > 0) {
      const event = dequeuePendingForwardEvent();
      if (!event) {
        continue;
      }
      await forwardToFlask(event.targetUrl, event.payload);
    }
  } finally {
    forwardDrainActive = false;
    if (pendingForwardEventCount() > 0) {
      setImmediate(() => {
        void flushPendingForwards();
      });
    }
  }
}

function rawPayloadByteLength(rawPayload) {
  if (Buffer.isBuffer(rawPayload)) {
    return rawPayload.length;
  }
  if (rawPayload === null || rawPayload === undefined) {
    return 0;
  }
  return Buffer.byteLength(String(rawPayload));
}

function dequeuePendingRouteEvent() {
  if (pendingRouteEventCount() === 0) {
    return null;
  }

  const event = pendingRouteEvents[pendingRouteEventHead] ?? null;
  pendingRouteEvents[pendingRouteEventHead] = undefined;
  pendingRouteEventHead += 1;
  if (event) {
    pendingRouteEventBytes = Math.max(
      0,
      pendingRouteEventBytes - event.byteLength,
    );
  }

  if (pendingRouteEventHead >= pendingRouteEvents.length) {
    pendingRouteEvents.length = 0;
    pendingRouteEventHead = 0;
    pendingRouteEventBytes = 0;
  } else if (
    pendingRouteEventHead >= 1_024 &&
    pendingRouteEventHead * 2 >= pendingRouteEvents.length
  ) {
    pendingRouteEvents.splice(0, pendingRouteEventHead);
    pendingRouteEventHead = 0;
  }

  return event;
}

function enqueuePendingRouteEvent(path, rawPayload) {
  const byteLength = rawPayloadByteLength(rawPayload);
  let droppedThisEnqueue = 0;

  while (
    pendingRouteEventCount() > 0 &&
    (pendingRouteEventCount() >= MAX_PENDING_HANDLER_EVENTS ||
      pendingRouteEventBytes + byteLength > MAX_PENDING_HANDLER_BYTES)
  ) {
    dequeuePendingRouteEvent();
    droppedThisEnqueue += 1;
  }

  if (droppedThisEnqueue > 0) {
    pendingRouteEventDrops += droppedThisEnqueue;
    const now = Date.now();
    if (
      now - lastPendingRouteOverflowLogAt >=
      PENDING_HANDLER_OVERFLOW_LOG_INTERVAL_MS
    ) {
      lastPendingRouteOverflowLogAt = now;
      console.warn(
        `[handler] Pending FIFO capacity reached; dropped ${droppedThisEnqueue} oldest packet(s) before queuing ${path}. totalDropped=${pendingRouteEventDrops}`,
      );
    }
  }

  pendingRouteEvents.push({ path, rawPayload, byteLength });
  pendingRouteEventBytes += byteLength;
}

function flushPendingHandlers() {
  routeDrainScheduled = false;
  const batchSize = Math.min(
    pendingRouteEventCount(),
    MAX_HANDLER_BATCH_SIZE,
  );

  for (let index = 0; index < batchSize; index += 1) {
    const pendingEvent = dequeuePendingRouteEvent();
    if (!pendingEvent) {
      continue;
    }
    const { path, rawPayload } = pendingEvent;
    try {
      const rawBuffer = Buffer.isBuffer(rawPayload)
        ? rawPayload
        : Buffer.from(rawPayload || "");
      const payload = parsePcobRawBuffer(rawBuffer);
      if (FORWARD_ENABLE) {
        const targetPath = path.startsWith("/") ? path : `/${path}`;
        const targetUrl = `${FORWARD_BASE_URL}${targetPath}`;
        enqueuePendingForwardEvent(targetUrl, payload);
      }
      runHandler(path, payload);
    } catch (err) {
      console.error(`[handler] Failed to process ${path}: ${err?.message || err}`);
    }
  }

  if (pendingRouteEventCount() > 0) {
    processHandlerAsync();
  }
}

function processHandlerAsync(path, rawPayload) {
  if (typeof path === "string") {
    enqueuePendingRouteEvent(path, rawPayload);
  }
  if (routeDrainScheduled) {
    return;
  }
  routeDrainScheduled = true;
  setImmediate(flushPendingHandlers);
}

function isSafeRejectedLocalProjectionPayload(path, rawPayload) {
  const rawBuffer = Buffer.isBuffer(rawPayload)
    ? rawPayload
    : Buffer.from(rawPayload || "");
  const rawText = rawBuffer.toString("utf8");
  if (!rawText.trim()) {
    return false;
  }

  if (path === "/setisingame") {
    let decoded = rawText;
    try {
      decoded = JSON.parse(preserveLargeNumericIdentifiers(rawText));
    } catch {}
    return explicitInGameState(decoded) !== null;
  }

  try {
    const decoded = JSON.parse(preserveLargeNumericIdentifiers(rawText));
    if (Array.isArray(decoded)) {
      return decoded.length > 0;
    }
    return Boolean(
      decoded &&
        typeof decoded === "object" &&
        Object.keys(decoded).length > 0,
    );
  } catch {
    return false;
  }
}

function queueRejectedLocalProjection(path, rawPayload) {
  if (
    !REJECTED_LOCAL_PROJECTION_STATE_ROUTES.has(path) ||
    !isSafeRejectedLocalProjectionPayload(path, rawPayload)
  ) {
    return false;
  }
  const now = Date.now();
  for (const [key, seenAt] of rejectedLocalProjectionKeys) {
    if (now - seenAt < REJECTED_LOCAL_PROJECTION_DEDUPE_MS) {
      break;
    }
    rejectedLocalProjectionKeys.delete(key);
  }
  const rawBuffer = Buffer.isBuffer(rawPayload)
    ? rawPayload
    : Buffer.from(rawPayload || "");
  const key = crypto
    .createHash("sha256")
    .update(String(path || "/"))
    .update("\n")
    .update(rawBuffer)
    .digest("hex");
  const seenAt = rejectedLocalProjectionKeys.get(key);
  if (
    Number.isFinite(seenAt) &&
    now - seenAt < REJECTED_LOCAL_PROJECTION_DEDUPE_MS
  ) {
    return false;
  }
  rejectedLocalProjectionKeys.delete(key);
  while (rejectedLocalProjectionKeys.size >= MAX_REJECTED_LOCAL_PROJECTION_KEYS) {
    const oldestKey = rejectedLocalProjectionKeys.keys().next().value;
    if (oldestKey === undefined) break;
    rejectedLocalProjectionKeys.delete(oldestKey);
  }
  rejectedLocalProjectionKeys.set(key, now);
  processHandlerAsync(path, rawPayload);
  return true;
}

function isLoopbackRemoteAddress(remoteAddress) {
  const value = String(remoteAddress || "").toLowerCase();
  return (
    value === "127.0.0.1" ||
    value === "::1" ||
    value.startsWith("127.") ||
    value.startsWith("::ffff:127.")
  );
}

function secureTokenEquals(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ""), "utf8");
  const expectedBuffer = Buffer.from(String(expected || ""), "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function requireLocalPcobReadAccess(req, res, next) {
  if (
    !isLoopbackRemoteAddress(req.socket?.remoteAddress) ||
    textValue(req.headers?.origin) ||
    !secureTokenEquals(req.headers?.[CONNECTOR_TOKEN_HEADER], PCOB_CONNECTOR_TOKEN)
  ) {
    res.status(403).json({ error: "pcob_local_read_forbidden" });
    return;
  }
  next();
}

function requireExactObserverRuntime(req, res, next) {
  const runtime = buildObserverRuntimeIdentity(process.env);
  if (
    !runtime.nonce ||
    !secureTokenEquals(
      req.headers?.["x-arenzyra-runtime-nonce"],
      runtime.nonce,
    )
  ) {
    res.status(409).json({ error: "observer_runtime_identity_mismatch" });
    return;
  }
  next();
}

function parseRuntimeMapControlBody(req) {
  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(req.rawBody || "");
  if (rawBody.length > PCOB_RUNTIME_MAP_CONTROL_MAX_BODY_BYTES) {
    return { error: "runtime_map_control_body_too_large", status: 413 };
  }

  try {
    const value = JSON.parse(rawBody.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "runtime_map_control_body_invalid", status: 400 };
    }
    return { value };
  } catch {
    return { error: "runtime_map_control_body_invalid", status: 400 };
  }
}

function acceptPcobPost(route, req, res) {
  const appended = rawEventSpool.appendRequest({
    method: req.method,
    endpoint: route,
    originalUrl: req.originalUrl,
    headers: req.headers,
    rawBody: req.rawBody,
    receivedAtMs: Date.now(),
  });
  if (!appended.ok) {
    // Durable capture backpressure must stay visible to PCOB, but it must not
    // freeze the operator's local widgets. Keep the response non-successful so
    // the producer can retry, while projecting this exact packet through the
    // bounded in-memory FIFO. The packet is not represented as durably saved.
    const status = appended.status || 503;
    const localProjectionQueued =
      status !== 413 &&
      status !== 414 &&
      queueRejectedLocalProjection(route, req.rawBody);
    res.status(status).json({
      ok: false,
      error: appended.error || "pcob_event_not_accepted",
      localProjectionQueued,
    });
    return;
  }
  res.json({
    ok: true,
    ...(appended.captured
      ? {
          eventId: appended.event.eventId,
          sequence: appended.event.sequence,
        }
      : {}),
  });
  processHandlerAsync(route, req.rawBody);
}

app.post(
  "/debug/observer/shutdown",
  requireLocalPcobReadAccess,
  requireExactObserverRuntime,
  (req, res) => {
    res.status(202).json({ ok: true, shuttingDown: true });
    setImmediate(shutdownConnector);
  },
);

app.post(
  "/debug/observer/map-fallback",
  requireLocalPcobReadAccess,
  requireExactObserverRuntime,
  (req, res) => {
    const parsed = parseRuntimeMapControlBody(req);
    if (parsed.error) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(parsed.value, "mapKey")) {
      res.status(400).json({ error: "runtime_map_key_required" });
      return;
    }

    const requestedMapKey = parsed.value.mapKey;
    const resolved =
      requestedMapKey === null
        ? null
        : resolveRuntimeFallbackMap(requestedMapKey, {
            requireCanonicalKey: true,
          });
    if (requestedMapKey !== null && !resolved) {
      res.status(400).json({
        error: "runtime_map_key_invalid",
        maxLength: PCOB_RUNTIME_MAP_KEY_MAX_LENGTH,
      });
      return;
    }

    if (!resolved) {
      runtimeFallbackMap = null;
    } else if (runtimeFallbackMap?.mapKey !== resolved.mapKey) {
      runtimeFallbackMap = {
        ...resolved,
        updatedAt: new Date().toISOString(),
      };
    }

    const selection = getDirectMapSelection();
    res.json({
      ok: true,
      fallbackMapKey: runtimeFallbackMap?.mapKey ?? null,
      fallbackMapName: runtimeFallbackMap?.mapName ?? null,
      fallbackUpdatedAt: runtimeFallbackMap?.updatedAt ?? null,
      effectiveMapKey: selection.mapKey,
      effectiveMapName: selection.mapName,
      effectiveMapSource: selection.source,
    });
  },
);

// Register explicit POST routes so legacy callers still work
Object.keys(handlers).forEach((route) => {
  app.post(route, (req, res) => {
    acceptPcobPost(route, req, res);
  });
});

// ShadowTracker has additional version-specific event names. Preserve only its
// bounded `set...` namespace; never turn arbitrary POST paths into telemetry.
app.post(/^\/set[a-z0-9]{1,64}$/i, (req, res) => {
  acceptPcobPost(req.path, req, res);
});

app.get("/health", (req, res) => {
  const rawEventMetrics = rawEventSpool.getMetrics();
  res.json({
    status: "ok",
    forwardEnabled: FORWARD_ENABLE,
    forwardBaseUrl: FORWARD_BASE_URL,
    runtime: buildObserverRuntimeIdentity(process.env),
    pcobMaxBodyBytes: PCOB_MAX_BODY_BYTES,
    connectorTokenRequired: true,
    rawEventStatus: rawEventMetrics.status,
    rawEvents: {
      enabled: rawEventMetrics.enabled,
      pendingEvents: rawEventMetrics.pendingEvents,
      pendingBytes: rawEventMetrics.pendingBytes,
      retainedEvents: rawEventMetrics.retainedEvents,
      full: rawEventMetrics.full,
      drops: rawEventMetrics.drops,
      rejected: rawEventMetrics.rejected,
      routes: rawEventMetrics.routes.map((route) => ({
        endpoint: route.endpoint,
        pendingEvents: route.pendingEvents,
      })),
    },
    lifecycle: {
      resetCount: lifecycleState.resetCount,
      pendingOutOfGame: Boolean(lifecycleState.pendingOutOfGameSince),
    },
  });
});

app.get("/getpcobevents", requireLocalPcobReadAccess, (req, res) => {
  res.json(
    rawEventSpool.readEvents({
      afterSequence: req.query?.afterSequence,
      limit: req.query?.limit,
      includeRaw: String(req.query?.includeRaw || "") === "1",
      includePayload: String(req.query?.includePayload ?? "1") !== "0",
    }),
  );
});

app.get("/debug/pcob-event-metrics", requireLocalPcobReadAccess, (req, res) => {
  res.json({
    rawEvents: rawEventSpool.getMetrics(),
    lifecycle: lifecycleSummary(),
    handlerQueue: {
      pendingEvents: pendingRouteEventCount(),
      pendingBytes: pendingRouteEventBytes,
      droppedEvents: pendingRouteEventDrops,
    },
    forwardQueue: {
      pendingEvents: pendingForwardEventCount(),
      pendingBytes: pendingForwardEventBytes,
      droppedEvents: pendingForwardEventDrops,
    },
  });
});

app.get("/getallinfo", (req, res) => {
  const teamBackpackInfo = refreshDirectBackpackInfoCache();
  res.json({
    allinfo: exposeDirectMapSelection({
      ...shadowState.allInfo,
      TeamBackpackInfo: stripDirectBackpackInternalKeysList(teamBackpackInfo),
    }),
  });
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

app.get("/getteambackpackinfo", (req, res) => {
  const teamBackpackInfo = refreshDirectBackpackInfoCache();
  const publicTeamBackpackInfo = stripDirectBackpackInternalKeysList(teamBackpackInfo);
  const playerBackpacks = normalizeDirectBackpacks(
    asArray(publicTeamBackpackInfo).length > 0
      ? publicTeamBackpackInfo
      : shadowState.allInfo,
  );
  const backpacks = aggregateDirectBackpacks(playerBackpacks);
  const totals = buildDirectBackpackTotals(backpacks);
  res.json({
    TeamBackpackInfo: publicTeamBackpackInfo,
    teamBackpackInfo: publicTeamBackpackInfo,
    backpacks,
    playerBackpacks,
    totals,
    backpackTotals: totals,
    equipmentTotals: totals,
  });
});

app.get("/getkillinfo", (req, res) => {
  res.json({ killInfo: shadowState.killInfo });
});

app.get("/getcircleinfo", (req, res) => {
  res.json(exposeDirectMapSelection(buildMergedCircleInfo()));
});

app.get("/getgameglobalinfo", (req, res) => {
  res.json({
    gameGlobalInfo: exposeDirectMapSelection(
      shadowState.routePayloads["/setgameglobalinfo"] ?? {},
    ),
  });
});

app.get("/getroutepayloads", (req, res) => {
  res.json({ routePayloads: shadowState.routePayloads });
});

app.get("/getrawroutepayloads", (req, res) => {
  res.json({ rawRoutePayloads: shadowState.rawRoutePayloads });
});

app.get("/getobserversnapshot", (req, res) => {
  res.json(buildDirectObserverSnapshot());
});

app.get("/debug/shadow-state", (req, res) => {
  res.json({
    activeMatchId: getObserverMatchId() || null,
    updatedAt: shadowState.updatedAt,
    isInGame: getDirectIsInGame(),
    allInfo: shadowState.allInfo,
    playerInfoList: shadowState.playerInfoList,
    teamInfoList: shadowState.teamInfoList,
    teamBackpackInfo: shadowState.teamBackpackInfo,
    killInfo: shadowState.killInfo,
    circleInfo: shadowState.circleInfo,
    bestCircleInfo: shadowState.bestCircleInfo,
    observingPlayer: shadowState.observingPlayer,
    routePayloads: shadowState.routePayloads,
    rawRoutePayloads: shadowState.rawRoutePayloads,
    flightPathDiagnostics: {
      canonical: cloneDirectFlightPath(shadowState.matchFlightPath),
      conflictingUpdateCount: shadowState.conflictingFlightPathCount,
      lastConflictingPath: cloneDirectFlightPath(
        shadowState.lastConflictingFlightPath,
      ),
      lastConflictingAt: shadowState.lastConflictingFlightPathAt,
    },
  });
});

app.get("/getobservingplayer", (req, res) => {
  res.json({ observingPlayer: shadowState.observingPlayer });
});

app.get("/isingame", (req, res) => {
  res.json({ isInGame: getDirectIsInGame() });
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

  try {
    res.json(buildDirectAchievementPayload(requestedMatchId));
  } catch (error) {
    console.error("[widget/achievements] failed to build direct payload", error);
    res.status(200).json({
      matchId: requestedMatchId ?? activeMatchId ?? "observer-direct",
      updatedAt: shadowState.updatedAt ?? new Date().toISOString(),
      events: [],
      error: "achievement_payload_unavailable",
    });
  }
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`ObTools server listening on http://${HOST}:${PORT}`);
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

httpServer.once("close", () => {
  rawEventSpool.close();
});
process.once("exit", () => {
  rawEventSpool.close();
});

let shutdownStarted = false;
function shutdownConnector() {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }
  cancelOutOfGameReset();
  rawEventSpool.close();
  httpServer.close(() => {
    process.exit(0);
  });
  const forcedExitTimer = setTimeout(() => {
    rawEventSpool.close();
    process.exit(0);
  }, 2_000);
  forcedExitTimer.unref?.();
}

process.once("SIGINT", shutdownConnector);
process.once("SIGTERM", shutdownConnector);
if (
  process.env.PCOB_TEST_CONTROL_ENABLE === "true" &&
  typeof process.send === "function"
) {
  process.on("message", (message) => {
    if (message?.type === "arenzyra.pcob-test-shutdown.v1") {
      shutdownConnector();
    }
  });
}
