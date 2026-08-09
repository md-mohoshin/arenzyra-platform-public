#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { execFile } = require("node:child_process");

const { auditSpool } = require("./pcob-protected-spool-audit.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const API_ROOT = path.join(REPO_ROOT, "apps", "api");
const LOOPBACK_HOST = "127.0.0.1";
const POSTGRES_IMAGE = "postgres:16";
const POSTGRES_DATABASE = "pcob_spool_e2e";
const CONTAINER_PREFIX = "arenzyra-pcob-spool-e2e-";
const CONTAINER_LABEL = "com.arenzyra.pcob-spool-e2e";
const TEMP_PREFIX = "arenzyra-pcob-spool-e2e-";
const DEFAULT_BATCH_SIZE = 64;
// Match.map is required by the database. Neither protected recording exposes a
// map identity in its PCOB root payload schemas, so this value is deliberately
// only a disposable database placeholder. Raw projection, lifecycle, and
// results assertions below never infer map identity from it.
const DISPOSABLE_MAP_PLACEHOLDER = "RONDO";
const DEFAULT_SPOOLS = [
  path.join(
    REPO_ROOT,
    ".local-backups",
    "pcob-spool-ended-match-pre-recovery-20260802T214403",
  ),
  path.join(
    REPO_ROOT,
    ".local-backups",
    "pcob-spool-match7-pre-recovery-20260802T191753Z",
  ),
];

let activeContainer = null;
let emergencyCleanupStarted = false;

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function progress(stage, details = {}) {
  process.stderr.write(JSON.stringify({ stage, ...details }) + "\n");
}

function parseCli(argv) {
  const spools = [];
  let batchSize = DEFAULT_BATCH_SIZE;
  let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help") {
      return { help: true, confirmed, spools, batchSize };
    }
    if (token === "--confirm-disposable") {
      confirmed = true;
      continue;
    }
    if (token === "--spool") {
      const value = argv[index + 1];
      assertCondition(value && !value.startsWith("--"), "--spool requires a path");
      spools.push(path.resolve(value));
      index += 1;
      continue;
    }
    if (token.startsWith("--spool=")) {
      spools.push(path.resolve(token.slice("--spool=".length)));
      continue;
    }
    if (token === "--batch-size") {
      batchSize = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith("--batch-size=")) {
      batchSize = Number(token.slice("--batch-size=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  assertCondition(
    Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= 500,
    "--batch-size must be an integer from 1 through 500",
  );
  return {
    help: false,
    confirmed,
    spools: spools.length > 0 ? spools : DEFAULT_SPOOLS,
    batchSize,
  };
}

function printHelp() {
  process.stdout.write(
    [
      "Disposable exact PCOB protected-spool API integration",
      "",
      "Usage:",
      "  node tools/pcob-protected-spool-api-integration.cjs --confirm-disposable [options]",
      "",
      "Options:",
      "  --spool PATH       Protected spool directory; repeatable",
      "  --batch-size N     Admission batch size, 1..500 (default 64)",
      "",
      "Safety:",
      "  * protected metadata.json/events.ndjson are opened read-only and rehashed",
      "  * cached postgres:16 only; no image pull",
      "  * unique tmpfs database with no bind mount or persistent volume",
      "  * database port bound only to 127.0.0.1",
      "  * external broadcasts/notifications/scoring are capture-only stubs",
      "  * no installed launcher or production endpoint is used",
      "",
    ].join("\n"),
  );
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function resolveReadOnlySpool(spoolPath) {
  const requested = path.resolve(spoolPath);
  const directoryStat = fs.lstatSync(requested);
  assertCondition(
    directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),
    `Spool must be a real directory: ${requested}`,
  );
  const realDirectory = fs.realpathSync.native(requested);
  const metadataPath = path.join(realDirectory, "metadata.json");
  const eventsPath = path.join(realDirectory, "events.ndjson");
  for (const filename of [metadataPath, eventsPath]) {
    const stat = fs.lstatSync(filename);
    assertCondition(
      stat.isFile() && !stat.isSymbolicLink(),
      `Protected input must be a real regular file: ${filename}`,
    );
  }
  return { directory: realDirectory, metadataPath, eventsPath };
}

function immutableFingerprint(audit) {
  return JSON.stringify(audit.immutableInputs);
}

function createSafeTempRoot() {
  const parent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, TEMP_PREFIX));
  return assertSafeTempRoot(root);
}

function assertSafeTempRoot(root) {
  const resolved = path.resolve(root);
  const parent = path.resolve(os.tmpdir());
  assertCondition(
    normalizedPath(path.dirname(resolved)) === normalizedPath(parent),
    "Refusing temporary cleanup outside the OS temp directory",
  );
  assertCondition(
    path.basename(resolved).startsWith(TEMP_PREFIX),
    "Unexpected disposable temp-directory name",
  );
  const stat = fs.lstatSync(resolved);
  assertCondition(stat.isDirectory() && !stat.isSymbolicLink(), "Unsafe temp root");
  const realRoot = fs.realpathSync.native(resolved);
  const realParent = fs.realpathSync.native(parent);
  assertCondition(
    normalizedPath(path.dirname(realRoot)) === normalizedPath(realParent),
    "Refusing redirected temporary cleanup",
  );
  return resolved;
}

function removeSafeTempRoot(root) {
  const verified = assertSafeTempRoot(root);
  fs.rmSync(verified, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      },
    );
  });
}

function safeSystemEnvironment(overrides = {}) {
  const allowed = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
  ];
  const environment = {};
  for (const key of allowed) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return { ...environment, ...overrides };
}

function containerName(runId) {
  const suffix = String(runId).replace(/[^a-z0-9]/gi, "").slice(0, 20).toLowerCase();
  assertCondition(suffix, "Invalid disposable run ID");
  return CONTAINER_PREFIX + suffix;
}

function dockerErrorText(error) {
  return [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function isMissingContainerError(error) {
  return /no such (object|container)/.test(dockerErrorText(error));
}

function verifyContainerOwnership(container, inspected) {
  assertCondition(
    container &&
      /^[a-f0-9]{12,64}$/.test(String(container.id || "")) &&
      container.name === containerName(container.runId),
    "Invalid disposable container descriptor",
  );
  assertCondition(
    inspected?.Id === container.id &&
      inspected?.Name === "/" + container.name &&
      inspected?.Config?.Image === POSTGRES_IMAGE &&
      inspected?.Config?.Labels?.[CONTAINER_LABEL] === container.runId,
    "Disposable container ownership verification failed",
  );
  assertCondition(
    Array.isArray(inspected.Mounts) &&
      inspected.Mounts.every(
        (mount) => mount.Type !== "bind" && mount.Type !== "volume",
      ) &&
      typeof inspected?.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"] ===
        "string",
    "Disposable PostgreSQL has persistent or unexpected storage",
  );
}

async function removeDisposablePostgres(container, dependencies = {}) {
  if (!container) return;
  const execute = dependencies.execute || execFileAsync;
  const pause = dependencies.pause || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let inspected;
    try {
      const result = await execute("docker", ["inspect", container.id]);
      inspected = JSON.parse(result.stdout)[0];
    } catch (error) {
      if (isMissingContainerError(error)) {
        if (activeContainer?.id === container.id) activeContainer = null;
        return;
      }
      lastError = error;
      if (attempt < 5) await pause(attempt * 100);
      continue;
    }
    verifyContainerOwnership(container, inspected);
    try {
      await execute("docker", ["rm", "--force", container.id]);
    } catch (error) {
      if (!isMissingContainerError(error)) lastError = error;
    }
    if (attempt < 5) await pause(attempt * 100);
  }
  throw new Error(
    "Disposable PostgreSQL removal could not be verified after 5 attempts" +
      (lastError ? `: ${dockerErrorText(lastError)}` : ""),
  );
}

async function startDisposablePostgres(runId) {
  const cached = await execFileAsync("docker", [
    "image",
    "inspect",
    POSTGRES_IMAGE,
    "--format",
    "{{.Id}}",
  ]).catch(() => null);
  assertCondition(
    cached?.stdout.trim().startsWith("sha256:"),
    `A locally cached ${POSTGRES_IMAGE} image is required; this tool never pulls`,
  );
  const name = containerName(runId);
  const password = crypto.randomBytes(24).toString("hex");
  const started = await execFileAsync("docker", [
    "run",
    "--pull",
    "never",
    "--rm",
    "--detach",
    "--name",
    name,
    "--label",
    `${CONTAINER_LABEL}=${runId}`,
    "--env",
    "POSTGRES_USER=postgres",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "--env",
    `POSTGRES_DB=${POSTGRES_DATABASE}`,
    "--tmpfs",
    "/var/lib/postgresql/data:rw,noexec,nosuid,size=4294967296",
    "--publish",
    `${LOOPBACK_HOST}::5432`,
    POSTGRES_IMAGE,
  ]);
  const id = started.stdout.trim();
  assertCondition(/^[a-f0-9]{12,64}$/.test(id), "Docker returned an invalid ID");
  const descriptor = { id, name, runId };
  activeContainer = descriptor;
  try {
    const inspected = JSON.parse(
      (await execFileAsync("docker", ["inspect", id])).stdout,
    )[0];
    verifyContainerOwnership(descriptor, inspected);
    const ports = inspected?.NetworkSettings?.Ports?.["5432/tcp"];
    assertCondition(
      Array.isArray(ports) &&
        ports.length === 1 &&
        ports[0].HostIp === LOOPBACK_HOST,
      "PostgreSQL is not bound exclusively to loopback",
    );
    const port = Number(ports[0].HostPort);
    assertCondition(Number.isSafeInteger(port) && port > 0, "Invalid PostgreSQL port");
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        // The official image briefly accepts connections through a temporary
        // initialization server and then restarts PostgreSQL. Do not mistake
        // that transient server for the final disposable runtime.
        const logs = await execFileAsync("docker", ["logs", id]);
        const initComplete = `${logs.stdout}\n${logs.stderr}`.includes(
          "PostgreSQL init process complete; ready for start up.",
        );
        if (!initComplete) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          continue;
        }
        await execFileAsync("docker", [
          "exec",
          id,
          "pg_isready",
          "--username",
          "postgres",
          "--dbname",
          POSTGRES_DATABASE,
        ]);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    assertCondition(ready, "Disposable PostgreSQL did not become ready");
    await execFileAsync("docker", [
      "exec",
      id,
      "psql",
      "--set",
      "ON_ERROR_STOP=1",
      "--username",
      "postgres",
      "--dbname",
      POSTGRES_DATABASE,
      "--command",
      "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    ]);
    return {
      ...descriptor,
      port,
      databaseUrl:
        `postgresql://postgres:${encodeURIComponent(password)}` +
        `@${LOOPBACK_HOST}:${port}/${POSTGRES_DATABASE}?schema=public`,
    };
  } catch (error) {
    await removeDisposablePostgres(descriptor).catch((cleanupError) => {
      error.message += `; cleanup also failed: ${cleanupError.message}`;
    });
    throw error;
  }
}

function installEmergencyCleanup() {
  const terminate = (reason, exitCode, error) => {
    if (emergencyCleanupStarted) return;
    emergencyCleanupStarted = true;
    if (error) progress("fatal-error", { reason, error: error.message || String(error) });
    const watchdog = setTimeout(() => process.exit(exitCode), 10_000);
    void removeDisposablePostgres(activeContainer)
      .catch((cleanupError) =>
        progress("emergency-cleanup-failed", {
          reason,
          error: cleanupError.message || String(cleanupError),
        }),
      )
      .finally(() => {
        clearTimeout(watchdog);
        process.exit(exitCode);
      });
  };
  process.once("SIGINT", () => terminate("SIGINT", 130));
  process.once("SIGTERM", () => terminate("SIGTERM", 143));
  process.once("uncaughtException", (error) => terminate("uncaughtException", 1, error));
  process.once("unhandledRejection", (error) => terminate("unhandledRejection", 1, error));
}

async function pushPrismaSchema(databaseUrl, tempRoot) {
  const prismaCli = require.resolve("prisma/build/index.js", {
    paths: [API_ROOT, REPO_ROOT],
  });
  const shadow = new URL(databaseUrl);
  shadow.pathname = "/postgres";
  const environment = safeSystemEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    SHADOW_DATABASE_URL: shadow.toString(),
    DOTENV_CONFIG_PATH: path.join(tempRoot, "intentionally-missing.env"),
    DOTENV_CONFIG_QUIET: "true",
  });
  try {
    await execFileAsync(
      process.execPath,
      [
        prismaCli,
        "db",
        "push",
        "--accept-data-loss",
        "--schema",
        path.join(API_ROOT, "prisma", "schema.prisma"),
      ],
      { cwd: API_ROOT, env: environment, timeout: 120_000 },
    );
  } catch (error) {
    const text = String(error.stderr || error.message || error).replaceAll(
      databaseUrl,
      "[loopback-database]",
    );
    throw new Error(`Prisma schema push failed: ${text.trim()}`);
  }
}

function configureIsolatedEnvironment(databaseUrl, tempRoot) {
  const shadow = new URL(databaseUrl);
  shadow.pathname = "/postgres";
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    SHADOW_DATABASE_URL: shadow.toString(),
    DOTENV_CONFIG_PATH: path.join(tempRoot, "intentionally-missing.env"),
    DOTENV_CONFIG_QUIET: "true",
    ENABLE_REDIS: "false",
    PCOB_SECRET: "isolated-pcob-spool-secret",
    COLLECTOR_SECRET: "isolated-collector-secret",
    JWT_SECRET: "isolated-jwt-secret",
    SUPERADMIN_EMAIL: "isolated-superadmin@example.invalid",
    SUPERADMIN_PASSWORD: "isolated-superadmin-password",
    OP_EMAIL: "isolated-operator@example.invalid",
    OP_PASSWORD: "isolated-operator-password",
    GAME_ADAPTER_TELEMETRY_POLL_ENABLED: "false",
    ALLOW_LEGACY_PCOB_INGEST: "false",
    PCOB_BASE_URL: "http://127.0.0.1:9",
    SHADOW_API_BASE: "http://127.0.0.1:9",
    PCOB_WS_URL: "",
    SHADOW_WS_URL: "",
    PCOB_RAW_PROCESSING_BATCH_SIZE: "500",
    PCOB_RAW_PROCESSING_LEASE_MS: "300000",
    PCOB_RAW_PROCESSOR_POLL_MS: "30000",
    PCOB_RAW_PROCESSOR_RETRY_MS: "250",
    PCOB_RAW_PROVIDER_TERMINAL_QUIET_MS: "15000",
    PCOB_RAW_RETENTION_ACKED_EVENTS: "100000",
    PCOB_RAW_RETENTION_STREAM_BYTES: "4294967296",
    PCOB_RAW_RETENTION_MATCH_BYTES: "17179869184",
    PCOB_RAW_HARD_MAX_EVENTS_PER_STREAM: "100000",
    PCOB_RAW_HARD_MAX_STREAM_BYTES: "4294967296",
    PCOB_RAW_HARD_MAX_MATCH_BYTES: "17179869184",
    OBSERVER_TELEMETRY_ACTIVE_WINDOW_MS: "300000",
    TS_NODE_PROJECT: path.join(API_ROOT, "tsconfig.json"),
    TS_NODE_TRANSPILE_ONLY: "true",
  });
  for (const key of [
    "DISCORD_BOT_TOKEN",
    "TELEGRAM_BOT_TOKEN",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASS",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ]) {
    process.env[key] = "";
  }
  const parsed = new URL(process.env.DATABASE_URL);
  assertCondition(
    parsed.protocol === "postgresql:" && parsed.hostname === LOOPBACK_HOST,
    "Refusing a non-loopback integration database",
  );
}

function loadActualClasses() {
  require("reflect-metadata");
  const nest = require(require.resolve("@nestjs/common", { paths: [API_ROOT] }));
  nest.Logger.overrideLogger(false);
  require(require.resolve("ts-node/register/transpile-only", { paths: [API_ROOT] }));
  const apiRequire = (relative) => require(path.join(API_ROOT, relative));
  return {
    PrismaService: apiRequire("src/db/prisma.service.ts").PrismaService,
    ObserverRawEventsService: apiRequire(
      "src/modules/observer/observer-raw-events.service.ts",
    ).ObserverRawEventsService,
    ObserverRawEventsProcessor: apiRequire(
      "src/modules/observer/observer-raw-events.processor.ts",
    ).ObserverRawEventsProcessor,
    ObserverController: apiRequire(
      "src/modules/observer/observer.controller.ts",
    ).ObserverController,
    PcobAdapter: apiRequire("src/modules/game-adapters/pubgm/pcob.adapter.ts")
      .PcobAdapter,
    GameAdapterTelemetryService: apiRequire(
      "src/modules/game-adapters/game-adapter-telemetry.service.ts",
    ).GameAdapterTelemetryService,
    TelemetryIngressService: apiRequire(
      "src/modules/telemetry/telemetry-ingress.service.ts",
    ).TelemetryIngressService,
    TelemetryEngineService: apiRequire(
      "src/modules/telemetry/telemetry-engine.service.ts",
    ).TelemetryEngineService,
    TelemetryPersistenceService: apiRequire(
      "src/modules/telemetry/telemetry-persistence.service.ts",
    ).TelemetryPersistenceService,
    TelemetryBroadcastService: apiRequire(
      "src/modules/telemetry/telemetry-broadcast.service.ts",
    ).TelemetryBroadcastService,
    TelemetryValidatorService: apiRequire(
      "src/modules/telemetry/telemetry-validator.service.ts",
    ).TelemetryValidatorService,
    TelemetryMappingService: apiRequire(
      "src/modules/telemetry/telemetry-mapping.service.ts",
    ).TelemetryMappingService,
    MatchControlStateStore: apiRequire(
      "src/modules/match-control/state.store.ts",
    ).MatchControlStateStore,
    LiveStateMirrorService: apiRequire(
      "src/modules/match-control/live-state-mirror.service.ts",
    ).LiveStateMirrorService,
    ResultsService: apiRequire("src/modules/results/results.service.ts").ResultsService,
    MatchConclusionService: apiRequire(
      "src/modules/results/match-conclusion.service.ts",
    ).MatchConclusionService,
    MatchControlService: apiRequire(
      "src/modules/match-control/match-control.service.ts",
    ).MatchControlService,
    prismaClient: require(require.resolve("@prisma/client", { paths: [API_ROOT] })),
  };
}

function captureMethod(captures, category, name, returnValue) {
  return (...args) => {
    captures.push({ category, name, args: JSON.parse(JSON.stringify(args ?? [])) });
    return typeof returnValue === "function" ? returnValue(...args) : returnValue;
  };
}

function createCapturedDependencies(captures) {
  const resultsEvents = {
    emitResultsUpdated: captureMethod(captures, "results-event", "results-updated"),
    emitLeaderboardUpdated: captureMethod(captures, "results-event", "leaderboard-updated"),
    emitTelemetryProjectionUpdated: captureMethod(
      captures,
      "results-event",
      "telemetry-projection-updated",
    ),
    emitMatchUpdate: captureMethod(captures, "results-event", "match-update"),
    emitControlContractUpdated: captureMethod(
      captures,
      "results-event",
      "control-contract-updated",
    ),
    emitResultsLockState: captureMethod(
      captures,
      "results-event",
      "results-lock-state",
      Promise.resolve(undefined),
    ),
    emitLiveWidgetSnapshots: captureMethod(
      captures,
      "results-event",
      "live-widget-snapshots",
      Promise.resolve(undefined),
    ),
  };
  const matchGateway = {
    emitLiveStateUpdates: captureMethod(captures, "match-gateway", "live-state-updates"),
    emitMatchAutoEnd: captureMethod(captures, "match-gateway", "match-auto-end"),
    emitMatchEnd: captureMethod(captures, "match-gateway", "match-end"),
    emitMatchState: captureMethod(captures, "match-gateway", "match-state"),
    emitMatchStateChanged: captureMethod(captures, "match-gateway", "match-state-changed"),
    emitTeamUpdate: captureMethod(captures, "match-gateway", "team-update"),
  };
  const stateBroadcaster = {
    broadcastUpdate: captureMethod(
      captures,
      "realtime-capture",
      "broadcast-update",
      Promise.resolve(undefined),
    ),
    broadcastEnd: captureMethod(
      captures,
      "realtime-capture",
      "broadcast-end",
      Promise.resolve(undefined),
    ),
  };
  return {
    resultsEvents,
    matchGateway,
    stateBroadcaster,
    observerState: {
      update: captureMethod(captures, "observer-state", "update"),
    },
    standings: {
      canEditResults: async () => ({ canEdit: true }),
    },
    audit: {
      log: captureMethod(captures, "audit", "log", Promise.resolve(undefined)),
    },
    scoring: {
      recomputeMatchAndTournament: captureMethod(
        captures,
        "scoring",
        "recompute-match-and-tournament",
        Promise.resolve(undefined),
      ),
    },
    scoreboard: {
      broadcast: captureMethod(
        captures,
        "scoreboard",
        "broadcast",
        Promise.resolve(undefined),
      ),
    },
    matches: {
      syncLiveHierarchy: captureMethod(
        captures,
        "hierarchy",
        "sync-live-hierarchy",
        Promise.resolve([]),
      ),
      validatePubgSlots: captureMethod(
        captures,
        "hierarchy",
        "validate-pubg-slots",
        Promise.resolve(undefined),
      ),
    },
    broadcast: {
      emitForMatch: captureMethod(
        captures,
        "broadcast",
        "emit-for-match",
        Promise.resolve(undefined),
      ),
    },
    realtime: {
      emitMatchStatusUpdated: captureMethod(
        captures,
        "realtime-capture",
        "match-status-updated",
      ),
      emitObserverMatchFinished: captureMethod(
        captures,
        "realtime-capture",
        "observer-match-finished",
      ),
    },
    ranking: {
      emitLiveRanking: captureMethod(
        captures,
        "ranking",
        "live-ranking",
        Promise.resolve(undefined),
      ),
      emitOverallRanking: captureMethod(
        captures,
        "ranking",
        "overall-ranking",
        Promise.resolve(undefined),
      ),
    },
    pcobGateway: {
      emitLastTeamStanding: captureMethod(
        captures,
        "pcob-gateway",
        "last-team-standing",
      ),
      emitMatchConcluded: captureMethod(
        captures,
        "pcob-gateway",
        "match-concluded",
      ),
    },
    replayBuffer: {
      recordState: captureMethod(captures, "replay-buffer", "record-state"),
      clearMatch: captureMethod(captures, "replay-buffer", "clear-match"),
    },
    matchStateService: {},
  };
}

async function createActualContext(databaseUrl, tempRoot) {
  configureIsolatedEnvironment(databaseUrl, tempRoot);
  const classes = loadActualClasses();
  const prisma = new classes.PrismaService();
  await prisma.onModuleInit();

  const captures = [];
  const captured = createCapturedDependencies(captures);
  const redis = { getClient: () => null };
  const store = new classes.MatchControlStateStore(redis);
  const liveMirror = new classes.LiveStateMirrorService(store);
  let actualResults = null;
  let actualMatchControl = null;
  const resultsProxy = {
    async syncAcceptedLiveTelemetryProjection(...args) {
      assertCondition(actualResults, "ResultsService delegate is unavailable");
      return actualResults.syncAcceptedLiveTelemetryProjection(...args);
    },
  };
  const lifecycleCalls = [];
  const matchControlProxy = {
    async applyAuthoritativeMatchEnd(...args) {
      assertCondition(actualMatchControl, "MatchControlService delegate is unavailable");
      const matchId = args[0];
      const rawWhere = {
        matchId,
        eventType: "PCOB_RAW_EVENT",
        source: { startsWith: "PCOB_RAW_V1:" },
      };
      const [before, durableRaw, pendingRawRows, processedRaw, cursorRow] =
        await Promise.all([
          store.get(matchId),
          prisma.telemetryEventLog.aggregate({
            where: rawWhere,
            _count: { _all: true },
            _max: { sequence: true },
          }),
          prisma.telemetryEventLog.count({
            where: { ...rawWhere, processedAt: null },
          }),
          prisma.telemetryEventLog.aggregate({
            where: { ...rawWhere, processedAt: { not: null } },
            _count: { _all: true },
            _max: { sequence: true },
          }),
          prisma.telemetryEventLog.findUnique({
            where: {
              matchId_source_sequence: {
                matchId,
                source: "PCOB_RAW_PROJECTION_V1",
                sequence: 0,
              },
            },
            select: { payloadJson: true },
          }),
        ]);
      const cursor =
        cursorRow?.payloadJson &&
        typeof cursorRow.payloadJson === "object" &&
        !Array.isArray(cursorRow.payloadJson)
          ? cursorRow.payloadJson
          : null;
      const rawActivity =
        cursor?.rawActivity &&
        typeof cursor.rawActivity === "object" &&
        !Array.isArray(cursor.rawActivity)
          ? cursor.rawActivity
          : null;
      const call = {
        startedAt: new Date().toISOString(),
        matchId,
        signal: args[1] ?? null,
        rawProjectionBoundary: {
          admittedHead: rawActivity?.rawSequence ?? null,
          activityRevision: rawActivity?.revision ?? null,
          durableRawRows: durableRaw._count._all,
          pendingRawRows,
          processedRawRows: processedRaw._count._all,
          maxDurableSequence: durableRaw._max.sequence,
          maxProcessedSequence: processedRaw._max.sequence,
          lastAppliedProjectionSequence:
            cursor?.lastAppliedProjectionSequence ?? null,
          lastAppliedProjectionAt: cursor?.lastAppliedProjectionAt ?? null,
        },
        before: before
          ? {
              status: before.status,
              aliveTeams: before.summary?.aliveTeams ?? null,
              winnerTeamId: before.summary?.winnerTeamId ?? null,
              teams: before.teams?.length ?? 0,
            }
          : null,
      };
      lifecycleCalls.push(call);
      try {
        const result = await actualMatchControl.applyAuthoritativeMatchEnd(...args);
        call.completedAt = new Date().toISOString();
        call.result = {
          status: result?.status ?? null,
          lifecycleStatus: result?.lifecycleStatus ?? null,
        };
        return result;
      } catch (error) {
        call.completedAt = new Date().toISOString();
        call.error = error?.message || String(error);
        throw error;
      }
    },
    async detectMatchFinish(...args) {
      assertCondition(actualMatchControl, "MatchControlService delegate is unavailable");
      return actualMatchControl.detectMatchFinish(...args);
    },
    async getLifecycleState(...args) {
      assertCondition(actualMatchControl, "MatchControlService delegate is unavailable");
      return actualMatchControl.getLifecycleState(...args);
    },
    async startMatch(...args) {
      assertCondition(actualMatchControl, "MatchControlService delegate is unavailable");
      return actualMatchControl.startMatch(...args);
    },
    async endMatch(...args) {
      assertCondition(actualMatchControl, "MatchControlService delegate is unavailable");
      return actualMatchControl.endMatch(...args);
    },
  };

  const persistence = new classes.TelemetryPersistenceService(prisma);
  const validator = new classes.TelemetryValidatorService();
  const mapping = new classes.TelemetryMappingService(prisma);
  const telemetryBroadcast = new classes.TelemetryBroadcastService(
    liveMirror,
    captured.stateBroadcaster,
    captured.observerState,
    prisma,
    undefined,
    resultsProxy,
  );
  const engine = new classes.TelemetryEngineService(
    prisma,
    matchControlProxy,
    validator,
    persistence,
    telemetryBroadcast,
    store,
    mapping,
    captured.replayBuffer,
  );
  const conclusion = new classes.MatchConclusionService(prisma, engine);
  actualResults = new classes.ResultsService(
    prisma,
    captured.resultsEvents,
    captured.standings,
    captured.audit,
    matchControlProxy,
    liveMirror,
    store,
    engine,
    captured.stateBroadcaster,
  );
  actualMatchControl = new classes.MatchControlService(
    prisma,
    captured.scoring,
    store,
    captured.matchGateway,
    captured.matchStateService,
    captured.scoreboard,
    captured.matches,
    captured.audit,
    actualResults,
    captured.resultsEvents,
    captured.broadcast,
    captured.realtime,
    captured.ranking,
    conclusion,
    liveMirror,
    captured.pcobGateway,
    undefined,
    undefined,
    captured.stateBroadcaster,
    captured.replayBuffer,
  );
  const ingress = new classes.TelemetryIngressService(
    prisma,
    engine,
    persistence,
    telemetryBroadcast,
    matchControlProxy,
  );
  const adapter = new classes.PcobAdapter(prisma);
  const resolver = { resolve: async () => adapter };
  const adapterTelemetry = new classes.GameAdapterTelemetryService(
    prisma,
    redis,
    resolver,
    ingress,
  );
  const rawEvents = new classes.ObserverRawEventsService(prisma);
  const rawProcessor = new classes.ObserverRawEventsProcessor(
    prisma,
    rawEvents,
    adapterTelemetry,
    matchControlProxy,
  );
  const stagedClaims = [];
  const stagedProcessor = {
    enqueue(result) {
      if (result?.processing?.sequences?.length) stagedClaims.push(result);
      return true;
    },
  };
  const unused = {};
  const controller = new classes.ObserverController(
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    prisma,
    matchControlProxy,
    adapterTelemetry,
    rawEvents,
    stagedProcessor,
  );
  return {
    ...classes,
    prisma,
    store,
    liveMirror,
    engine,
    results: actualResults,
    matchControl: actualMatchControl,
    matchControlProxy,
    conclusion,
    adapter,
    adapterTelemetry,
    rawEvents,
    rawProcessor,
    controller,
    stagedClaims,
    captures,
    lifecycleCalls,
    startedProcessor: false,
  };
}

function uniquePlayerRows(rows) {
  const counts = new Map();
  return rows.map((row, index) => {
    const base = String(row.playerName || "Player").trim() || "Player";
    const key = base.toLowerCase();
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    return {
      ...row,
      playerName: count === 1 ? base : `${base} (${count})`,
      stableIndex: index,
    };
  });
}

async function seedMatch(context, audit, index) {
  const suffix = crypto.randomUUID();
  const organization = await context.prisma.organization.create({
    data: {
      name: `Protected spool API E2E ${suffix}`,
      slug: `pcob-spool-e2e-${suffix}`,
      broadcastKey: crypto.randomBytes(32).toString("hex"),
      status: context.prismaClient.OrganizationStatus.APPROVED,
      kycStatus: context.prismaClient.KycStatus.APPROVED,
    },
  });
  const firstAt = new Date(audit.stream.firstReceivedAt);
  const matchStart = new Date(firstAt.getTime() - 1_000);
  const sessionId = `protected-spool-session-${crypto.randomUUID()}`;
  const finalTeams = audit.resultTimeline.final.teamsByRank;
  const mapScope = recordingMapScope(audit);
  const highestSlot = Math.max(
    ...finalTeams.map((team) => Number(team.teamId)),
  );
  assertCondition(
    finalTeams.every(
      (team) =>
        Number.isSafeInteger(Number(team.teamId)) && Number(team.teamId) > 0,
    ),
    "Protected spool contains an invalid team slot",
  );
  const match = await context.prisma.match.create({
    data: {
      name: `Protected exact spool ${index + 1}`,
      organizationId: organization.id,
      ownerUserId: "isolated-system-owner",
      status: context.prismaClient.MatchStatus.LIVE,
      liveState: context.prismaClient.LiveState.LIVE,
      liveAt: matchStart,
      startedAt: matchStart,
      slotCount: Math.max(25, highestSlot),
      map: context.prismaClient.MatchMap[DISPOSABLE_MAP_PLACEHOLDER],
      dataMode: context.prismaClient.DataMode.PCOB,
      dataSource: context.prismaClient.MatchDataSource.API,
      resultSource: context.prismaClient.MatchResultSource.TELEMETRY,
      telemetrySource: context.prismaClient.TelemetrySource.API,
      telemetrySourceLockedAt: matchStart,
      pcobSessionId: sessionId,
      pcobBoundAt: matchStart,
      pcobMode: true,
      pcobStatus: context.prismaClient.PcobStatus.READY,
      adapterKey: "pubgm-pcob",
      controlState: {
        create: {
          organizationId: organization.id,
          state: context.prismaClient.ControlState.LIVE,
          authorityMode: context.prismaClient.TelemetryAuthorityMode.AUTO,
          reason: "ISOLATED_PROTECTED_SPOOL_E2E",
          metaJson: { telemetrySource: "API" },
        },
      },
    },
  });

  const teamByRawId = new Map();
  for (const team of finalTeams) {
    const slotNumber = Number(team.teamId);
    const savedTeam = await context.prisma.team.create({
      data: {
        name: team.teamName || `Team ${slotNumber}`,
        organizationId: organization.id,
        ownerUserId: "isolated-system-owner",
      },
    });
    teamByRawId.set(String(team.teamId), savedTeam);
    await context.prisma.matchSlot.create({
      data: {
        matchId: match.id,
        slotNumber,
        teamId: savedTeam.id,
        lobbyStatus: context.prismaClient.LobbyStatus.READY,
        playersInLobby: team.playerRows.length,
      },
    });
    const slotResult = await context.prisma.matchSlotResult.create({
      data: {
        matchId: match.id,
        organizationId: organization.id,
        slotNumber,
        teamId: savedTeam.id,
        wasPresentInMatch: null,
        totalKills: 0,
        placementPoints: 0,
        totalPoints: 0,
      },
    });
    for (const player of uniquePlayerRows(team.playerRows)) {
      await context.prisma.matchSlotPlayerResult.create({
        data: {
          slotResultId: slotResult.id,
          organizationId: organization.id,
          playerName: player.playerName,
          pubgAccountId: player.playerOpenId,
          externalPlayerId: player.pubgPlayerId ?? player.playerOpenId,
          kills: 0,
          knocks: 0,
          assists: 0,
          damage: 0,
          isKnocked: false,
          isAlive: true,
          alive: true,
          isAutoFilled: false,
        },
      });
    }
  }

  return {
    organizationId: organization.id,
    matchId: match.id,
    sessionId,
    teamByRawId,
    mapScope,
    actor: {
      id: "isolated-pcob-spool-actor",
      actorId: "isolated-pcob-spool-actor",
      role: context.prismaClient.Role.ORGANIZER,
      actorRole: context.prismaClient.Role.ORGANIZER,
      organizationId: organization.id,
      actingOrgId: null,
    },
  };
}

async function* readEventBatches(eventsPath, batchSize) {
  const input = fs.createReadStream(eventsPath, { flags: "r" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let batch = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

function rawEnvelope(streamId, events) {
  assertCondition(events.length > 0, "Cannot build an empty raw envelope");
  return {
    schema: "arenzyra.pcobRawEvents.v1",
    streamId,
    firstSequence: events[0].sequence,
    lastSequence: events[events.length - 1].sequence,
    events,
  };
}

function recordingMapScope(audit) {
  const inspectedRoutes = ["/totalmessage", "/setgameglobalinfo"];
  const rootKeys = Object.fromEntries(
    inspectedRoutes.map((route) => [route, audit.shapes?.[route]?.keys ?? []]),
  );
  const identityKeys = Object.values(rootKeys)
    .flat()
    .filter((key) => /^(map|mapid|mapname|mapcode|maptype)$/i.test(
      String(key).replace(/[_-]/g, ""),
    ));
  assertCondition(
    identityKeys.length === 0,
    `Recording unexpectedly exposes a root map identity field: ${identityKeys.join(", ")}`,
  );
  return {
    providerMapIdentity: null,
    inspectedRootSchemas: rootKeys,
    databasePlaceholder: DISPOSABLE_MAP_PLACEHOLDER,
    validationScope:
      "raw admission, projection, lifecycle finalization, and exact results; map identity is not exposed by these recordings",
  };
}

async function admitProtectedSpool(context, input, audit, match, batchSize) {
  const metadata = JSON.parse(fs.readFileSync(input.metadataPath, "utf8"));
  let admitted = 0;
  let duplicates = 0;
  let batches = 0;
  let lastAck = null;
  let lastEnvelope = null;
  for await (const events of readEventBatches(input.eventsPath, batchSize)) {
    const envelope = rawEnvelope(metadata.streamId, events);
    const result = await context.controller.ingestTelemetry(
      {
        matchId: match.matchId,
        sessionId: match.sessionId,
        rawEvents: envelope,
      },
      { user: match.actor },
    );
    const ack = result?.rawEventsAck;
    assertCondition(ack, `Raw batch ${batches + 1} returned no durable ACK`);
    assertCondition(
      ack.streamId === metadata.streamId &&
        ack.highestContiguousSequence === events[events.length - 1].sequence,
      `Raw batch ${batches + 1} returned an invalid ACK boundary`,
    );
    admitted += ack.accepted;
    duplicates += ack.duplicates;
    batches += 1;
    lastAck = ack;
    lastEnvelope = envelope;
  }
  assertCondition(admitted === audit.stream.captured, "Not every event was admitted");
  assertCondition(duplicates === 0, "Initial replay unexpectedly contained duplicates");
  assertCondition(
    lastAck?.highestContiguousSequence === audit.stream.captured,
    "Final ACK did not reach the exact spool boundary",
  );
  assertCondition(lastEnvelope, "No raw envelope was admitted");
  const duplicateResult = await context.controller.ingestTelemetry(
    {
      matchId: match.matchId,
      sessionId: match.sessionId,
      rawEvents: lastEnvelope,
    },
    { user: match.actor },
  );
  const duplicateAck = duplicateResult?.rawEventsAck;
  assertCondition(
    duplicateAck?.accepted === 0 &&
      duplicateAck?.duplicates === lastEnvelope.events.length &&
      duplicateAck?.highestContiguousSequence === audit.stream.captured,
    "Exact duplicate retry accounting is invalid",
  );
  return {
    batches,
    admitted,
    initialDuplicates: duplicates,
    finalAck: lastAck,
    duplicateRetry: {
      events: lastEnvelope.events.length,
      accepted: duplicateAck.accepted,
      duplicates: duplicateAck.duplicates,
      highestContiguousSequence: duplicateAck.highestContiguousSequence,
    },
    lastAdmissionAt: new Date().toISOString(),
  };
}

async function readProjectionCursor(context, matchId) {
  const row = await context.prisma.telemetryEventLog.findUnique({
    where: {
      matchId_source_sequence: {
        matchId,
        source: "PCOB_RAW_PROJECTION_V1",
        sequence: 0,
      },
    },
    select: { payloadJson: true },
  });
  return row?.payloadJson &&
    typeof row.payloadJson === "object" &&
    !Array.isArray(row.payloadJson)
    ? row.payloadJson
    : null;
}

async function drainMatch(context, audit, match) {
  assertCondition(
    context.stagedClaims.length === 1,
    `Expected one deterministic staged claim, received ${context.stagedClaims.length}`,
  );
  if (!context.startedProcessor) {
    context.startedProcessor = true;
  }
  assertCondition(
    context.rawProcessor.enqueue(context.stagedClaims[0]) === true,
    "Actual raw processor rejected the staged durable claim",
  );
  context.stagedClaims.length = 0;

  const deadline = Date.now() + 10 * 60_000;
  let lastProgressAt = 0;
  let last = null;
  while (Date.now() < deadline) {
    await context.rawProcessor.drainNow();
    const [pending, processed, matchRow, cursor] = await Promise.all([
      context.prisma.telemetryEventLog.count({
        where: {
          matchId: match.matchId,
          eventType: "PCOB_RAW_EVENT",
          source: { startsWith: "PCOB_RAW_V1:" },
          processedAt: null,
        },
      }),
      context.prisma.telemetryEventLog.count({
        where: {
          matchId: match.matchId,
          eventType: "PCOB_RAW_EVENT",
          source: { startsWith: "PCOB_RAW_V1:" },
          processedAt: { not: null },
        },
      }),
      context.prisma.match.findUnique({
        where: { id: match.matchId },
        select: { status: true },
      }),
      readProjectionCursor(context, match.matchId),
    ]);
    const finishStatus = cursor?.finishCheck?.status ?? null;
    last = {
      pending,
      processed,
      matchStatus: matchRow?.status ?? null,
      finishStatus,
    };
    if (
      pending === 0 &&
      matchRow?.status === context.prismaClient.MatchStatus.FINISHED &&
      finishStatus === "COMPLETED"
    ) {
      return last;
    }
    if (Date.now() - lastProgressAt >= 5_000) {
      progress("protected-spool-drain", {
        recording: path.basename(audit.spoolPath),
        ...last,
      });
      lastProgressAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out draining protected spool: ${JSON.stringify(last)}`,
  );
}

function captureSummary(captures) {
  const counts = new Map();
  for (const capture of captures) {
    const key = `${capture.category}:${capture.name}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

async function validateFinalState(context, audit, match, admission) {
  const where = {
    matchId: match.matchId,
    eventType: "PCOB_RAW_EVENT",
    source: { startsWith: "PCOB_RAW_V1:" },
  };
  const [rawCount, unprocessed, rawAggregate, matchRow, slotResults, cursor] =
    await Promise.all([
      context.prisma.telemetryEventLog.count({ where }),
      context.prisma.telemetryEventLog.count({
        where: { ...where, processedAt: null },
      }),
      context.prisma.telemetryEventLog.aggregate({
        where,
        _min: { sequence: true },
        _max: { sequence: true },
      }),
      context.prisma.match.findUnique({
        where: { id: match.matchId },
        select: {
          status: true,
          liveState: true,
          endedAt: true,
          controlState: {
            select: { state: true, version: true, metaJson: true },
          },
        },
      }),
      context.prisma.matchSlotResult.findMany({
        where: { matchId: match.matchId },
        include: {
          team: { select: { id: true, name: true } },
          players: {
            select: {
              playerName: true,
              kills: true,
              knocks: true,
              assists: true,
              damage: true,
              isAlive: true,
              alive: true,
            },
          },
        },
        orderBy: { slotNumber: "asc" },
      }),
      readProjectionCursor(context, match.matchId),
    ]);

  assertCondition(rawCount === audit.stream.captured, "Durable raw row count mismatch");
  assertCondition(unprocessed === 0, "Raw outbox did not fully drain");
  assertCondition(
    rawAggregate._min.sequence === 1 &&
      rawAggregate._max.sequence === audit.stream.captured,
    "Durable raw sequence bounds are invalid",
  );
  assertCondition(
    matchRow?.status === context.prismaClient.MatchStatus.FINISHED &&
      matchRow?.liveState === context.prismaClient.LiveState.ENDED &&
      matchRow?.controlState?.state === context.prismaClient.ControlState.ENDED,
    "Actual MatchControl did not finish the match",
  );
  const meta = matchRow.controlState.metaJson ?? {};
  assertCondition(meta.resultFinalized === true, "Final result marker is missing");
  assertCondition(
    meta.resultNeedsConfirmation !== true,
    "Exact final result remained ambiguous",
  );
  assertCondition(
    Number(meta.aliveTeamsAtEnd) === 1 &&
      Number(meta.finishEligibilityAliveTeams) === 1,
    "Finalization did not observe exactly one alive team",
  );
  assertCondition(cursor?.finishCheck?.status === "COMPLETED", "Finish check is incomplete");
  assertCondition(cursor?.finishCheck?.providerMatchEnded === true, "Provider terminal evidence was lost");

  const byTeamId = new Map(slotResults.map((row) => [row.teamId, row]));
  const resultRows = [];
  for (const expected of audit.resultTimeline.final.teamsByRank) {
    const team = match.teamByRawId.get(String(expected.teamId));
    const actual = team ? byTeamId.get(team.id) : null;
    assertCondition(actual, `Missing result for ${expected.teamName}`);
    const playerKills = actual.players.reduce(
      (sum, player) => sum + Math.max(0, player.kills ?? 0),
      0,
    );
    assertCondition(
      actual.wasPresentInMatch === true &&
        actual.placement === expected.rank &&
        actual.finalPlacement === expected.rank &&
        actual.totalKills === expected.kills &&
        actual.finalKills === expected.kills &&
        actual.finalizedAt instanceof Date &&
        actual.isLocked === true,
      `Final team result mismatch for ${expected.teamName}`,
    );
    assertCondition(
      playerKills === expected.playerKills &&
        actual.players.length === expected.players,
      `Final player result mismatch for ${expected.teamName}`,
    );
    assertCondition(
      actual.players.every(
        (player) => player.isAlive === false && player.alive === false,
      ),
      `Final player lifecycle flags are invalid for ${expected.teamName}`,
    );
    resultRows.push({
      rank: actual.finalPlacement,
      teamName: actual.team?.name ?? expected.teamName,
      kills: actual.finalKills,
      players: actual.players.length,
      playerKills,
    });
  }
  resultRows.sort((left, right) => left.rank - right.rank);
  const winnerTeam = match.teamByRawId.get(
    String(audit.resultTimeline.final.teamsByRank.find((team) => team.rank === 1).teamId),
  );
  assertCondition(meta.winnerTeamId === winnerTeam?.id, "Final winner ID is invalid");

  const calls = context.lifecycleCalls.filter((call) => call.matchId === match.matchId);
  assertCondition(calls.length === 1, `Expected one authoritative end call, received ${calls.length}`);
  const call = calls[0];
  const quietUntil = Date.parse(call.signal?.rawFinishCheckQuietUntil ?? "");
  const calledAt = Date.parse(call.startedAt);
  assertCondition(
    Number.isFinite(quietUntil) && calledAt >= quietUntil,
    "MatchControl crossed the lifecycle boundary before the durable quiet window",
  );
  assertCondition(
    call.signal?.source === "PCOB_RAW_OUTBOX_DRAINED" &&
      call.signal?.providerMatchEnded === true &&
      call.before?.aliveTeams === 1 &&
      call.before?.teams === audit.resultTimeline.final.teams,
    "Authoritative end call used incomplete final telemetry",
  );
  assertCondition(
    call.rawProjectionBoundary?.admittedHead === audit.stream.captured &&
      call.rawProjectionBoundary?.durableRawRows === audit.stream.captured &&
      call.rawProjectionBoundary?.pendingRawRows === 0 &&
      call.rawProjectionBoundary?.processedRawRows === audit.stream.captured &&
      call.rawProjectionBoundary?.maxDurableSequence === audit.stream.captured &&
      call.rawProjectionBoundary?.maxProcessedSequence === audit.stream.captured,
    `MatchControl crossed before the raw projection drain: ${JSON.stringify(
      call.rawProjectionBoundary,
    )}`,
  );

  return {
    matchId: match.matchId,
    durableRawRows: rawCount,
    unprocessedRawRows: unprocessed,
    sequenceRange: {
      first: rawAggregate._min.sequence,
      last: rawAggregate._max.sequence,
    },
    lifecycle: {
      status: matchRow.status,
      liveState: matchRow.liveState,
      controlState: matchRow.controlState.state,
      resultFinalized: meta.resultFinalized,
      resultNeedsConfirmation: meta.resultNeedsConfirmation ?? false,
      aliveTeamsAtEnd: meta.aliveTeamsAtEnd,
      finishEligibilityAliveTeams: meta.finishEligibilityAliveTeams,
      finishCheckStatus: cursor.finishCheck.status,
      finishCheckQuietUntil: call.signal.rawFinishCheckQuietUntil,
      authoritativeEndCalledAt: call.startedAt,
      quietBoundaryRespected: calledAt >= quietUntil,
      providerTerminal: call.signal.providerMatchEnded,
      rawProjectionBoundary: call.rawProjectionBoundary,
    },
    results: resultRows,
    winner: resultRows[0],
    totalKills: resultRows.reduce((sum, row) => sum + row.kills, 0),
    totalPlayerKills: resultRows.reduce((sum, row) => sum + row.playerKills, 0),
    admission,
  };
}

async function replayOne(context, input, audit, index, batchSize) {
  const match = await seedMatch(context, audit, index);
  const captureStart = context.captures.length;
  const admission = await admitProtectedSpool(
    context,
    input,
    audit,
    match,
    batchSize,
  );
  const cursorAfterAdmission = await readProjectionCursor(context, match.matchId);
  assertCondition(
    cursorAfterAdmission?.rawActivity?.quietUntil,
    "Durable raw quiet fence was not persisted during admission",
  );
  progress("protected-spool-admitted", {
    recording: path.basename(input.directory),
    events: admission.admitted,
    batches: admission.batches,
    quietUntil: cursorAfterAdmission.rawActivity.quietUntil,
  });
  const drain = await drainMatch(context, audit, match);
  const database = await validateFinalState(context, audit, match, admission);
  return {
    recording: input.directory,
    immutableInputs: audit.immutableInputs,
    exactEvidence: {
      events: audit.stream.captured,
      finishedSequence: audit.terminalTail.finished.sequence,
      firstCompleteSequence:
        audit.resultTimeline.firstCompletePlacementsAfterFinished.sequence,
      firstCompleteAliveTeams:
        audit.resultTimeline.firstCompletePlacementsAfterFinished.aliveTeams,
      firstCompleteWinnerKills:
        audit.resultTimeline.firstCompletePlacementsAfterFinished.teamsByRank.find(
          (team) => team.rank === 1,
        ).kills,
      firstSingleAliveSequence:
        audit.resultTimeline.firstSingleAliveAfterFinished.sequence,
      finalSequence: audit.resultTimeline.final.sequence,
      finalPlayers: audit.resultTimeline.final.players,
      finalTeams: audit.resultTimeline.final.teams,
      finalKills: audit.resultTimeline.final.totalKills,
      finalAliveTeams: audit.resultTimeline.final.aliveTeams,
      tailDurationMs: audit.terminalTail.tailDurationMs,
    },
    mapScope: match.mapScope,
    drain,
    database,
    capturedSideEffects: captureSummary(context.captures.slice(captureStart)),
  };
}

async function run(options) {
  assertCondition(
    options.confirmed === true,
    "Refusing to start Docker without --confirm-disposable",
  );
  const inputs = options.spools.map(resolveReadOnlySpool);
  const baselineAudits = [];
  for (const input of inputs) {
    const audit = await auditSpool(input.directory, { inspectShapes: true });
    assertCondition(
      audit.protectedExpectationVerified === true,
      `Protected expectation is unavailable for ${input.directory}`,
    );
    baselineAudits.push(audit);
  }

  const runId = crypto.randomUUID();
  const tempRoot = createSafeTempRoot();
  let container = null;
  let context = null;
  let primaryError = null;
  const cleanupErrors = [];
  const matchIds = [];
  let reports = [];
  try {
    progress("disposable-postgres-start");
    container = await startDisposablePostgres(runId);
    progress("disposable-postgres-ready", {
      loopback: true,
      ephemeralPort: container.port,
      tmpfs: true,
      persistentVolumes: false,
    });
    await pushPrismaSchema(container.databaseUrl, tempRoot);
    progress("disposable-prisma-ready");
    context = await createActualContext(container.databaseUrl, tempRoot);
    for (let index = 0; index < inputs.length; index += 1) {
      reports.push(
        await replayOne(
          context,
          inputs[index],
          baselineAudits[index],
          index,
          options.batchSize,
        ),
      );
      matchIds.push(reports[reports.length - 1].database?.matchId);
      progress("protected-spool-validation-complete", {
        recording: path.basename(inputs[index].directory),
        winner: reports[reports.length - 1].database.winner,
      });
    }
  } catch (error) {
    primaryError = error;
  } finally {
    const contextCleanup = [
      ["raw-processor", async () => context?.rawProcessor?.onModuleDestroy?.()],
      ["match-control", async () => context?.matchControl?.onModuleDestroy?.()],
      ["adapter-telemetry", async () => context?.adapterTelemetry?.onModuleDestroy?.()],
      ["pcob-adapter", async () => context?.adapter?.onModuleDestroy?.()],
      [
        "state-store",
        async () => {
          if (context?.store && matchIds.length > 0) {
            await context.store.evictMatches(matchIds.filter(Boolean));
          }
        },
      ],
      ["prisma", async () => context?.prisma?.onModuleDestroy?.()],
    ];
    for (const [label, cleanup] of contextCleanup) {
      try {
        await cleanup();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error.message}`);
      }
    }
    try {
      await removeDisposablePostgres(container);
    } catch (error) {
      cleanupErrors.push(`postgres: ${error.message}`);
    }
    try {
      removeSafeTempRoot(tempRoot);
    } catch (error) {
      cleanupErrors.push(`temp: ${error.message}`);
    }
    for (let index = 0; index < inputs.length; index += 1) {
      try {
        const after = await auditSpool(inputs[index].directory, {
          inspectShapes: false,
        });
        assertCondition(
          immutableFingerprint(after) === immutableFingerprint(baselineAudits[index]),
          `Protected input changed during replay: ${inputs[index].directory}`,
        );
      } catch (error) {
        cleanupErrors.push(`protected-input-verification: ${error.message}`);
      }
    }
  }
  if (primaryError) {
    if (cleanupErrors.length > 0) {
      primaryError.message += `; cleanup errors: ${cleanupErrors.join("; ")}`;
    }
    throw primaryError;
  }
  assertCondition(cleanupErrors.length === 0, `Cleanup failed: ${cleanupErrors.join("; ")}`);
  return {
    ok: true,
    mode: "isolated-protected-pcob-spool-actual-api-integration",
    batchSize: options.batchSize,
    safety: {
      databaseHost: LOOPBACK_HOST,
      databasePort: "ephemeral",
      databaseStorage: "docker-tmpfs",
      cachedImageOnly: true,
      persistentVolumes: false,
      protectedInputsOpenedReadOnly: true,
      protectedInputsRehashedAfterRun: true,
      installedLauncherTouched: false,
      productionTouched: false,
      publicNetworkEndpointsUsed: false,
      realtimeSideEffects: "captured-only",
      resultNotifications: "captured-only",
      scoringSideEffects: "captured-only",
      containerCleanupVerified: true,
    },
    implementation: {
      observerController: "actual-in-process",
      rawAdmission: "actual",
      rawProcessor: "actual",
      pcobAdapter: "actual",
      telemetryIngress: "actual",
      telemetryEngine: "actual",
      telemetryPersistence: "actual",
      telemetryBroadcast: "actual-with-captured-transports",
      resultsService: "actual",
      matchConclusionService: "actual",
      matchControlService: "actual",
    },
    recordings: reports,
    totals: {
      recordings: reports.length,
      events: reports.reduce((sum, report) => sum + report.exactEvidence.events, 0),
      kills: reports.reduce((sum, report) => sum + report.database.totalKills, 0),
    },
  };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }
  const report = await run(cli);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (require.main === module) {
  installEmergencyCleanup();
  main().catch(async (error) => {
    let finalCleanupError = null;
    try {
      await removeDisposablePostgres(activeContainer);
    } catch (cleanupError) {
      finalCleanupError = cleanupError;
    }
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          error: error?.message || String(error),
          finalCleanupError: finalCleanupError?.message || null,
        },
        null,
        2,
      ) + "\n",
    );
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  _test: {
    parseCli,
    containerName,
    isMissingContainerError,
    verifyContainerOwnership,
    removeDisposablePostgres,
    resolveReadOnlySpool,
    rawEnvelope,
    recordingMapScope,
    captureSummary,
  },
};
