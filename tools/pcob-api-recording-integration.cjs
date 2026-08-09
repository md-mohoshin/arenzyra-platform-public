#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFile, spawn } = require("node:child_process");
const { once } = require("node:events");
const axios = require("axios");

const { resolveRecordingPacketsPath, sleep } = require("./pcob-live-utils.cjs");
const {
  replayRecordingToConnector,
} = require("./pcob-local-connector-replay.cjs");
const { readJsonl } = require("./pcob-recording-schema.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const API_ROOT = path.join(REPO_ROOT, "apps", "api");
const LOOPBACK_HOST = "127.0.0.1";
const TEMP_PREFIX = "arenzyra-pcob-api-e2e-";
const CONTAINER_PREFIX = "arenzyra-pcob-api-e2e-";
const CONTAINER_LABEL = "com.arenzyra.pcob-api-e2e";
const POSTGRES_IMAGE = "postgres:16";
const POSTGRES_DATABASE = "pcob_e2e";
const MAX_API_BODY_BYTES = 10 * 1024 * 1024;
const DOCKER_CLEANUP_ATTEMPTS = 5;
let activeDisposableContainer = null;
let emergencyCleanupStarted = false;

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function progress(stage, details = {}) {
  process.stderr.write(JSON.stringify({ stage, ...details }) + "\n");
}

function printHelp() {
  process.stdout.write(
    [
      "PCOB real-API recording integration validator",
      "",
      "Usage:",
      "  node tools/pcob-api-recording-integration.cjs [options]",
      "",
      "Options:",
      "  --recording PATH   Recording directory or packets.jsonl; repeatable",
      "                     Defaults to every full recording under recordings/pcob",
      "  --speed N          Replay speed. Default: 20",
      "  --allow-prisma-void-lock-shim",
      "                     Continue past Prisma 7's PostgreSQL void-result",
      "                     deserialization bug using the identical advisory lock SQL",
      "  --retention-probe-only",
      "                     Exercise over-limit cross-stream prune/gap SQL only",
      "  --help             Show this help",
      "",
      "Safety:",
      "  * Uses only a locally cached postgres:16 image (never pulls).",
      "  * PostgreSQL and HTTP listeners bind to 127.0.0.1 on ephemeral ports.",
      "  * Database storage is a tmpfs in a uniquely labelled disposable container.",
      "  * The connector uses a verified temporary spool and no installed launcher.",
      "",
    ].join("\n"),
  );
}

function parseCli(argv) {
  const recordings = [];
  let speed = 20;
  let allowPrismaVoidLockShim = false;
  let retentionProbeOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help") {
      return {
        help: true,
        recordings,
        speed,
        allowPrismaVoidLockShim,
        retentionProbeOnly,
      };
    }
    if (token === "--recording") {
      const value = argv[index + 1];
      assertCondition(
        value && !value.startsWith("--"),
        "--recording requires a path",
      );
      recordings.push(value);
      index += 1;
      continue;
    }
    if (token.startsWith("--recording=")) {
      recordings.push(token.slice("--recording=".length));
      continue;
    }
    if (token === "--speed") {
      const value = argv[index + 1];
      assertCondition(
        value && !value.startsWith("--"),
        "--speed requires a value",
      );
      speed = Number(value);
      index += 1;
      continue;
    }
    if (token.startsWith("--speed=")) {
      speed = Number(token.slice("--speed=".length));
      continue;
    }
    if (token === "--allow-prisma-void-lock-shim") {
      allowPrismaVoidLockShim = true;
      continue;
    }
    if (token === "--retention-probe-only") {
      retentionProbeOnly = true;
      continue;
    }
    throw new Error("Unknown argument: " + token);
  }
  assertCondition(
    Number.isFinite(speed) && speed >= 0 && speed <= 1000,
    "--speed must be a finite number from 0 through 1000",
  );
  assertCondition(
    !retentionProbeOnly || recordings.length === 0,
    "--retention-probe-only cannot be combined with --recording",
  );
  return {
    help: false,
    recordings,
    speed,
    allowPrismaVoidLockShim,
    retentionProbeOnly,
  };
}

function defaultFullRecordings() {
  const root = path.join(REPO_ROOT, "recordings", "pcob");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "packets.jsonl"))
    .filter((filename) => {
      try {
        return fs.statSync(filename).size >= 100 * 1024 * 1024;
      } catch {
        return false;
      }
    })
    .sort();
}

function resolveRecordings(values) {
  const inputs = values.length > 0 ? values : defaultFullRecordings();
  assertCondition(inputs.length > 0, "No full PCOB recordings were found");
  const seen = new Set();
  return inputs.flatMap((input) => {
    const packetsPath = path.resolve(resolveRecordingPacketsPath(input));
    const key =
      process.platform === "win32" ? packetsPath.toLowerCase() : packetsPath;
    if (seen.has(key)) return [];
    seen.add(key);
    const stat = fs.statSync(packetsPath);
    assertCondition(
      stat.isFile() && stat.size > 0,
      "Recording is empty: " + packetsPath,
    );
    return [{ packetsPath, fileSizeBytes: stat.size }];
  });
}

function normalizedPath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function createSafeTempRoot() {
  const tempParent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempParent, TEMP_PREFIX));
  assertSafeTempRoot(root);
  return root;
}

function assertSafeTempRoot(root) {
  const resolved = path.resolve(root);
  const tempParent = path.resolve(os.tmpdir());
  assertCondition(
    normalizedPath(path.dirname(resolved)) === normalizedPath(tempParent),
    "Refusing temporary cleanup outside the operating-system temp directory",
  );
  assertCondition(
    path.basename(resolved).startsWith(TEMP_PREFIX),
    "Refusing temporary cleanup for an unexpected directory name",
  );
  const stat = fs.lstatSync(resolved);
  assertCondition(
    stat.isDirectory() && !stat.isSymbolicLink(),
    "Unsafe temp root type",
  );
  const realParent = fs.realpathSync.native(tempParent);
  const realRoot = fs.realpathSync.native(resolved);
  assertCondition(
    normalizedPath(path.dirname(realRoot)) === normalizedPath(realParent),
    "Refusing temporary cleanup through a redirected path",
  );
  return resolved;
}

function removeSafeTempRoot(root) {
  const verified = assertSafeTempRoot(root);
  // Windows can briefly retain a connector journal handle after child exit.
  // Retry only this already realpath-verified OS-temp child; never broaden the
  // cleanup target or suppress a persistent cleanup failure.
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
      {
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        ...options,
      },
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

function disposableContainerName(runId) {
  const suffix = String(runId || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 20)
    .toLowerCase();
  assertCondition(suffix, "Disposable database run ID is invalid");
  return CONTAINER_PREFIX + suffix;
}

async function requireCachedPostgresImage() {
  try {
    const result = await execFileAsync("docker", [
      "image",
      "inspect",
      POSTGRES_IMAGE,
      "--format",
      "{{.Id}}",
    ]);
    assertCondition(
      result.stdout.trim().startsWith("sha256:"),
      "Cached image ID is invalid",
    );
  } catch (error) {
    throw new Error(
      "Local Docker and a cached " +
        POSTGRES_IMAGE +
        " image are required; the validator will not pull images",
    );
  }
}

async function startDisposablePostgres(runId) {
  await requireCachedPostgresImage();
  const name = disposableContainerName(runId);
  const password = crypto.randomBytes(24).toString("hex");
  let ownedContainer = null;
  try {
    const result = await execFileAsync("docker", [
      "run",
      "--pull",
      "never",
      "--rm",
      "--detach",
      "--name",
      name,
      "--label",
      CONTAINER_LABEL + "=" + runId,
      "--env",
      "POSTGRES_USER=postgres",
      "--env",
      "POSTGRES_PASSWORD=" + password,
      "--env",
      "POSTGRES_DB=" + POSTGRES_DATABASE,
      "--tmpfs",
      "/var/lib/postgresql/data:rw,noexec,nosuid,size=4294967296",
      "--publish",
      LOOPBACK_HOST + "::5432",
      POSTGRES_IMAGE,
    ]);
    const id = result.stdout.trim();
    assertCondition(
      /^[a-f0-9]{12,64}$/.test(id),
      "Docker did not return a container ID",
    );
    ownedContainer = { id, name, runId };
    activeDisposableContainer = ownedContainer;

    const inspectResult = await execFileAsync("docker", ["inspect", id]);
    const inspected = JSON.parse(inspectResult.stdout)[0];
    assertCondition(
      inspected &&
        inspected.Config &&
        inspected.Config.Labels &&
        inspected.Config.Labels[CONTAINER_LABEL] === runId,
      "Disposable database container label verification failed",
    );
    assertCondition(
      inspected.Name === "/" + name,
      "Disposable database name verification failed",
    );
    assertCondition(
      Array.isArray(inspected.Mounts) &&
        inspected.Mounts.every(
          (mount) => mount.Type !== "bind" && mount.Type !== "volume",
        ),
      "Disposable database unexpectedly has a persistent host mount",
    );
    const published =
      inspected.NetworkSettings &&
      inspected.NetworkSettings.Ports &&
      inspected.NetworkSettings.Ports["5432/tcp"];
    assertCondition(
      Array.isArray(published) &&
        published.length === 1 &&
        published[0].HostIp === LOOPBACK_HOST,
      "Disposable PostgreSQL was not bound exclusively to loopback",
    );
    const port = Number(published[0].HostPort);
    assertCondition(
      Number.isInteger(port) && port > 0,
      "Disposable PostgreSQL port is invalid",
    );

    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
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
          "SELECT 1",
        ]);
        ready = true;
        break;
      } catch {
        await sleep(250);
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
    const databaseUrl =
      "postgresql://postgres:" +
      encodeURIComponent(password) +
      "@" +
      LOOPBACK_HOST +
      ":" +
      port +
      "/" +
      POSTGRES_DATABASE +
      "?schema=public";
    return { id, name, runId, databaseUrl, port };
  } catch (error) {
    if (ownedContainer) {
      try {
        await removeDisposablePostgres(ownedContainer);
      } catch (cleanupError) {
        error.message +=
          "; disposable database cleanup also failed: " + cleanupError.message;
      }
    }
    throw error;
  }
}

function dockerErrorText(error) {
  return [error && error.message, error && error.stderr, error && error.stdout]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function isMissingDockerContainerError(error) {
  return /no such (object|container)/.test(dockerErrorText(error));
}

function clearActiveDisposableContainer(container) {
  if (
    activeDisposableContainer &&
    container &&
    activeDisposableContainer.id === container.id
  ) {
    activeDisposableContainer = null;
  }
}

function verifyDisposableContainerOwnership(container, inspected) {
  assertCondition(
    container &&
      /^[a-f0-9]{12,64}$/.test(String(container.id || "")) &&
      container.name === disposableContainerName(container.runId),
    "Refusing Docker cleanup for an invalid disposable container descriptor",
  );
  assertCondition(
    inspected &&
      inspected.Id === container.id &&
      inspected.Name === "/" + container.name &&
      inspected.Config &&
      inspected.Config.Image === POSTGRES_IMAGE &&
      inspected.Config.Labels &&
      inspected.Config.Labels[CONTAINER_LABEL] === container.runId,
    "Refusing to remove a Docker container that failed exact ownership verification",
  );
  assertCondition(
    Array.isArray(inspected.Mounts) &&
      inspected.Mounts.every(
        (mount) => mount.Type !== "bind" && mount.Type !== "volume",
      ) &&
      inspected.HostConfig &&
      inspected.HostConfig.Tmpfs &&
      typeof inspected.HostConfig.Tmpfs["/var/lib/postgresql/data"] ===
        "string",
    "Refusing to remove a disposable database with persistent or unexpected storage",
  );
}

async function removeDisposablePostgres(container, dependencies = {}) {
  if (!container) return;
  const execute = dependencies.execute || execFileAsync;
  const pause = dependencies.pause || sleep;
  let lastError = null;
  for (let attempt = 1; attempt <= DOCKER_CLEANUP_ATTEMPTS; attempt += 1) {
    let inspected;
    try {
      const result = await execute("docker", ["inspect", container.id]);
      inspected = JSON.parse(result.stdout)[0];
    } catch (error) {
      if (isMissingDockerContainerError(error)) {
        clearActiveDisposableContainer(container);
        return;
      }
      lastError = error;
      if (attempt < DOCKER_CLEANUP_ATTEMPTS) {
        await pause(100 * attempt);
        continue;
      }
      break;
    }
    verifyDisposableContainerOwnership(container, inspected);
    try {
      await execute("docker", ["rm", "--force", container.id]);
    } catch (error) {
      if (isMissingDockerContainerError(error)) {
        clearActiveDisposableContainer(container);
        return;
      }
      lastError = error;
    }
    if (attempt < DOCKER_CLEANUP_ATTEMPTS) {
      await pause(100 * attempt);
    }
  }
  throw new Error(
    "Disposable database removal could not be verified after " +
      DOCKER_CLEANUP_ATTEMPTS +
      " attempts" +
      (lastError ? ": " + dockerErrorText(lastError) : ""),
  );
}

function installEmergencyContainerCleanup() {
  const terminate = (reason, exitCode, error) => {
    if (emergencyCleanupStarted) return;
    emergencyCleanupStarted = true;
    if (error) {
      progress("fatal-error", {
        reason,
        error: error && error.message ? error.message : String(error),
      });
    }
    const watchdog = setTimeout(() => process.exit(exitCode), 10_000);
    void removeDisposablePostgres(activeDisposableContainer)
      .catch((cleanupError) => {
        progress("emergency-postgres-cleanup-failed", {
          reason,
          error:
            cleanupError && cleanupError.message
              ? cleanupError.message
              : String(cleanupError),
        });
      })
      .finally(() => {
        clearTimeout(watchdog);
        process.exit(exitCode);
      });
  };
  process.once("SIGINT", () => terminate("SIGINT", 130));
  process.once("SIGTERM", () => terminate("SIGTERM", 143));
  process.once("uncaughtException", (error) =>
    terminate("uncaughtException", 1, error),
  );
  process.once("unhandledRejection", (error) =>
    terminate("unhandledRejection", 1, error),
  );
}

async function pushPrismaSchema(databaseUrl, tempRoot) {
  const prismaCli = require.resolve("prisma/build/index.js", {
    paths: [API_ROOT, REPO_ROOT],
  });
  assertCondition(
    fs.statSync(prismaCli).isFile(),
    "Local Prisma CLI was not found",
  );
  const shadowDatabaseUrl = new URL(databaseUrl);
  shadowDatabaseUrl.pathname = "/postgres";
  const safeEnv = safeSystemEnvironment({
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    SHADOW_DATABASE_URL: shadowDatabaseUrl.toString(),
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
      { cwd: API_ROOT, env: safeEnv, timeout: 120000 },
    );
  } catch (error) {
    const message = String(error.stderr || error.message || error).replaceAll(
      databaseUrl,
      "[loopback-database]",
    );
    throw new Error("Prisma schema push failed: " + message.trim());
  }
}

function configureIsolatedApiEnvironment(databaseUrl, tempRoot) {
  const shadowDatabaseUrl = new URL(databaseUrl);
  shadowDatabaseUrl.pathname = "/postgres";
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    SHADOW_DATABASE_URL: shadowDatabaseUrl.toString(),
    DOTENV_CONFIG_PATH: path.join(tempRoot, "intentionally-missing.env"),
    DOTENV_CONFIG_QUIET: "true",
    PCOB_SECRET: "isolated-pcob-secret",
    COLLECTOR_SECRET: "isolated-collector-secret",
    JWT_SECRET: "isolated-jwt-secret",
    SUPERADMIN_EMAIL: "pcob-e2e-superadmin@example.invalid",
    SUPERADMIN_PASSWORD: "isolated-superadmin-password",
    OP_EMAIL: "pcob-e2e-operator@example.invalid",
    OP_PASSWORD: "isolated-operator-password",
    ENABLE_REDIS: "false",
    PCOB_BASE_URL: "http://127.0.0.1:9",
    SHADOW_API_BASE: "http://127.0.0.1:9",
    PCOB_WS_URL: "",
    SHADOW_WS_URL: "",
    GAME_ADAPTER_TELEMETRY_POLL_ENABLED: "false",
    ALLOW_LEGACY_PCOB_INGEST: "false",
    PCOB_RAW_RETENTION_ACKED_EVENTS: "100000",
    PCOB_RAW_RETENTION_STREAM_BYTES: "4294967296",
    PCOB_RAW_RETENTION_MATCH_BYTES: "17179869184",
    PCOB_RAW_HARD_MAX_EVENTS_PER_STREAM: "100000",
    PCOB_RAW_HARD_MAX_STREAM_BYTES: "4294967296",
    PCOB_RAW_HARD_MAX_MATCH_BYTES: "17179869184",
    PCOB_RAW_PROCESSING_BATCH_SIZE: "500",
    PCOB_RAW_PROCESSING_LEASE_MS: "60000",
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
    "Refusing to initialize Prisma with a non-loopback database",
  );
}

function loadActualApiClasses() {
  require("reflect-metadata");
  require(
    require.resolve("@nestjs/common", { paths: [API_ROOT, REPO_ROOT] }),
  ).Logger.overrideLogger(false);
  const registerPath = require.resolve("ts-node/register/transpile-only", {
    paths: [API_ROOT],
  });
  require(registerPath);
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
    MapStateService: apiRequire("src/modules/maps/map-state.service.ts")
      .MapStateService,
    prismaClient: require(
      require.resolve("@prisma/client", { paths: [API_ROOT] }),
    ),
  };
}

function summarizeIngressTelemetry(telemetry) {
  const players = Array.isArray(telemetry && telemetry.players)
    ? telemetry.players
    : [];
  return {
    players: players.length,
    positionedPlayers: players.filter((player) => {
      const position = player && (player.position || player.location);
      return (
        position &&
        Number.isFinite(finiteNumber(position.x)) &&
        Number.isFinite(finiteNumber(position.y))
      );
    }).length,
    teams: Array.isArray(telemetry && telemetry.teams)
      ? telemetry.teams.length
      : 0,
    events: Array.isArray(telemetry && telemetry.events)
      ? telemetry.events.length
      : 0,
    hasZone: Boolean(telemetry && telemetry.zone),
    hasAuxiliary: Boolean(telemetry && telemetry.auxiliary),
    hasFlightPath: Boolean(
      telemetry && telemetry.auxiliary && telemetry.auxiliary.flightPath,
    ),
  };
}

function installPrismaVoidLockCompatibility(rawEvents, prismaClient) {
  assertCondition(
    typeof rawEvents.lockRawMatch === "function",
    "ObserverRawEventsService advisory-lock implementation was not found",
  );
  let calls = 0;
  rawEvents.lockRawMatch = async (tx, matchId) => {
    calls += 1;
    await tx.$executeRaw(prismaClient.Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`arenzyra:pcob-raw:${matchId}`}, 0::bigint)
      )
    `);
  };
  return {
    enabled: true,
    get calls() {
      return calls;
    },
  };
}

async function createActualApiContext(databaseUrl, tempRoot, options = {}) {
  configureIsolatedApiEnvironment(databaseUrl, tempRoot);
  const classes = loadActualApiClasses();
  const prisma = new classes.PrismaService();
  await prisma.onModuleInit();
  const rawEvents = new classes.ObserverRawEventsService(prisma);
  const rawEventsCompatibility = options.allowPrismaVoidLockShim
    ? installPrismaVoidLockCompatibility(rawEvents, classes.prismaClient)
    : { enabled: false, calls: 0 };
  const adapter = new classes.PcobAdapter(prisma);
  const ingressByMatch = new Map();
  const telemetryIngress = {
    async ingestAdapterTelemetryEnvelope(telemetry) {
      const matchId = String((telemetry && telemetry.matchId) || "");
      const current = ingressByMatch.get(matchId) || {
        calls: 0,
        maxPlayers: 0,
        maxPositionedPlayers: 0,
        maxTeams: 0,
        adapterEvents: 0,
        zoneCalls: 0,
        auxiliaryCalls: 0,
        flightPathCalls: 0,
      };
      const summary = summarizeIngressTelemetry(telemetry);
      current.calls += 1;
      current.maxPlayers = Math.max(current.maxPlayers, summary.players);
      current.maxPositionedPlayers = Math.max(
        current.maxPositionedPlayers,
        summary.positionedPlayers,
      );
      current.maxTeams = Math.max(current.maxTeams, summary.teams);
      current.adapterEvents += summary.events;
      if (summary.hasZone) current.zoneCalls += 1;
      if (summary.hasAuxiliary) current.auxiliaryCalls += 1;
      if (summary.hasFlightPath) current.flightPathCalls += 1;
      current.last = summary;
      ingressByMatch.set(matchId, current);
      return { ok: true, ignored: false, reason: null };
    },
  };
  const redis = { getClient: () => null };
  const resolver = { resolve: async () => adapter };
  const adapterTelemetry = new classes.GameAdapterTelemetryService(
    prisma,
    redis,
    resolver,
    telemetryIngress,
  );
  const unused = {};
  const matchControl = {
    async getLifecycleState() {
      return {
        status: "LIVE",
        isLocked: false,
        isFinalizing: false,
        finalizationStartedAt: null,
        finalizationDurationMs: null,
      };
    },
    async applyAuthoritativeMatchEnd() {
      return {
        status: "LIVE",
        lifecycleStatus: "LIVE",
      };
    },
  };
  const rawEventsProcessor = new classes.ObserverRawEventsProcessor(
    prisma,
    rawEvents,
    adapterTelemetry,
    matchControl,
  );
  rawEventsProcessor.onModuleInit();
  const controller = new classes.ObserverController(
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    prisma,
    matchControl,
    adapterTelemetry,
    rawEvents,
    rawEventsProcessor,
  );
  const mapState = new classes.MapStateService(
    prisma,
    { emitMapState: async () => undefined },
    { get: async () => null },
  );
  return {
    ...classes,
    prisma,
    rawEvents,
    adapter,
    adapterTelemetry,
    rawEventsProcessor,
    controller,
    mapState,
    ingressByMatch,
    rawEventsCompatibility,
  };
}

function textValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMapName(value) {
  let normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const aliases = {
    BALTICMAIN: "ERANGEL",
    DESERTMAIN: "MIRAMAR",
    SAVAGEMAIN: "SANHOK",
    DHIHOROTOKMAIN: "VIKENDI",
    DIHOROTOKMAIN: "VIKENDI",
    NEONMAIN: "RONDO",
  };
  if (aliases[normalized]) return aliases[normalized];
  if (normalized.endsWith("MAIN")) normalized = normalized.slice(0, -4);
  return aliases[normalized] || normalized;
}

async function inspectRecordingMap(packetsPath) {
  const metadataPath = path.join(path.dirname(packetsPath), "metadata.json");
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      const fromMetadata =
        textValue(metadata.finalSummary && metadata.finalSummary.mapName) ||
        textValue(metadata.firstSummary && metadata.firstSummary.mapName);
      if (fromMetadata) return normalizeMapName(fromMetadata);
    } catch {}
  }
  for await (const { line } of readJsonl(packetsPath)) {
    const packet = JSON.parse(line);
    const mapName =
      textValue(packet.raw && packet.raw.mapName) ||
      textValue(packet.summary && packet.summary.mapName);
    if (mapName) return normalizeMapName(mapName);
  }
  throw new Error("Could not infer recording map: " + packetsPath);
}

function manifestExpectedEventCount(packetsPath) {
  const manifestPath = path.join(
    REPO_ROOT,
    "tools",
    "pcob-observed-schema.v1.json",
  );
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const recordingId = path.basename(path.dirname(packetsPath));
  const source = Array.isArray(manifest.sources)
    ? manifest.sources.find((candidate) => candidate.id === recordingId)
    : null;
  const count = Number(source && source.reconstructedEventCount);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

async function seedMatch(context, mapName, index) {
  const suffix = crypto.randomUUID();
  const organization = await context.prisma.organization.create({
    data: {
      name: "PCOB API E2E " + suffix,
      slug: "pcob-api-e2e-" + suffix,
      broadcastKey: crypto.randomBytes(32).toString("hex"),
      status: context.prismaClient.OrganizationStatus.APPROVED,
      kycStatus: context.prismaClient.KycStatus.APPROVED,
    },
  });
  const sessionId = "pcob-api-e2e-session-" + crypto.randomUUID();
  const match = await context.prisma.match.create({
    data: {
      name: "PCOB API recording " + (index + 1),
      organizationId: organization.id,
      status: context.prismaClient.MatchStatus.LIVE,
      liveState: context.prismaClient.LiveState.LIVE,
      map: context.prismaClient.MatchMap[mapName],
      dataMode: context.prismaClient.DataMode.MANUAL,
      dataSource: context.prismaClient.MatchDataSource.API,
      telemetrySource: context.prismaClient.TelemetrySource.API,
      telemetrySourceLockedAt: new Date(),
      pcobSessionId: sessionId,
      pcobBoundAt: new Date(),
      pcobMode: false,
      pcobStatus: context.prismaClient.PcobStatus.READY,
      adapterKey: "pubgm-pcob",
      startedAt: new Date(),
      controlState: {
        create: {
          organizationId: organization.id,
          state: context.prismaClient.ControlState.LIVE,
          reason: "ISOLATED_PCOB_API_E2E",
          metaJson: { telemetrySource: "API" },
        },
      },
    },
  });
  return {
    organizationId: organization.id,
    matchId: match.id,
    sessionId,
    actor: {
      id: "pcob-api-e2e-actor",
      actorId: "pcob-api-e2e-actor",
      role: context.prismaClient.Role.ORGANIZER,
      actorRole: context.prismaClient.Role.ORGANIZER,
      organizationId: organization.id,
      actingOrgId: null,
    },
  };
}

function rawSourceKey(sessionId, streamId) {
  const bindingHash = crypto
    .createHash("sha256")
    .update(sessionId + "\0" + streamId)
    .digest("hex")
    .slice(0, 40);
  return "PCOB_RAW_V1:" + bindingHash;
}

function buildProbeRawBatch(streamId) {
  const sequence = 1;
  const receivedAt = "2026-01-01T00:00:10.000Z";
  const method = "POST";
  const endpoint = "/setcircleinfo";
  const requestTarget = endpoint;
  const body = Buffer.from(JSON.stringify({ CircleIndex: "1", probe: true }));
  const bodySha256 = crypto.createHash("sha256").update(body).digest("hex");
  const eventId = crypto
    .createHash("sha256")
    .update(
      `${streamId}\n${sequence}\n${receivedAt}\n${method}\n${requestTarget}\n${bodySha256}`,
    )
    .digest("hex");
  return {
    schema: "arenzyra.pcobRawEvents.v1",
    streamId,
    firstSequence: sequence,
    lastSequence: sequence,
    events: [
      {
        eventId,
        sequence,
        endpoint,
        requestTarget,
        method,
        receivedAt,
        contentType: "application/json",
        query: "",
        headers: { "content-type": "application/json" },
        rawBodyBase64: body.toString("base64"),
        rawBodyEncoding: "identity",
        rawBodyBytes: body.length,
        bodySha256,
      },
    ],
  };
}

async function runCrossStreamRetentionProbe(context) {
  const hardLimitBytes = 64 * 1024;
  const match = await seedMatch(context, "RONDO", 9000);
  // Exercise archive-only admission against a real terminal lifecycle. The
  // raw-event service intentionally derives this boundary from the database;
  // a caller-provided hint must never be able to suppress projection for a
  // match that is still LIVE.
  await context.prisma.$transaction([
    context.prisma.match.update({
      where: { id: match.matchId },
      data: {
        status: context.prismaClient.MatchStatus.ENDED,
        liveState: context.prismaClient.LiveState.ENDED,
        endedAt: new Date(),
      },
    }),
    context.prisma.matchControlState.update({
      where: { matchId: match.matchId },
      data: {
        state: context.prismaClient.ControlState.ENDED,
        reason: "ISOLATED_PCOB_RETENTION_PROBE",
      },
    }),
  ]);
  const oldSessionId = "retention-probe-old-session";
  const oldStreamId = "retention-probe-old-stream";
  const oldSource = rawSourceKey(oldSessionId, oldStreamId);
  const oldRows = [1, 3].map((sequence) => {
    const payloadJson = {
      schema: "arenzyra.pcobRawEvent.v1",
      authority: "AUXILIARY_ONLY",
      binding: {
        matchId: match.matchId,
        sessionId: oldSessionId,
        source: "API",
        streamId: oldStreamId,
      },
      order: { firstSequence: 1, lastSequence: 3, sequence },
      event: {
        eventId: crypto
          .createHash("sha256")
          .update(`old:${sequence}`)
          .digest("hex"),
        endpoint: "/totalmessage",
        padding: "x".repeat(40_000),
      },
      auxiliary: null,
    };
    return {
      matchId: match.matchId,
      source: oldSource,
      sequence,
      eventType: "PCOB_RAW_EVENT",
      payloadJson,
      payloadBytes: Buffer.byteLength(JSON.stringify(payloadJson)),
      receivedAt: new Date(`2025-12-31T23:59:0${sequence}.000Z`),
      processedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  });
  await context.prisma.telemetryEventLog.createMany({ data: oldRows });
  const beforeBytes = oldRows.reduce((sum, row) => sum + row.payloadBytes, 0);
  assertCondition(
    beforeBytes > hardLimitBytes,
    "Retention probe fixture did not exceed the hard match limit",
  );

  const previousLimits = {
    hard: process.env.PCOB_RAW_HARD_MAX_MATCH_BYTES,
    retention: process.env.PCOB_RAW_RETENTION_MATCH_BYTES,
  };
  process.env.PCOB_RAW_HARD_MAX_MATCH_BYTES = String(hardLimitBytes);
  process.env.PCOB_RAW_RETENTION_MATCH_BYTES = String(hardLimitBytes);
  const newStreamId = "retention-probe-new-stream";
  let result;
  try {
    result = await context.rawEvents.ingest({
      matchId: match.matchId,
      sessionId: match.sessionId,
      source: "API",
      rawEvents: buildProbeRawBatch(newStreamId),
      archiveOnlyReason: "MATCH_ENDED",
    });
  } finally {
    if (previousLimits.hard === undefined) {
      delete process.env.PCOB_RAW_HARD_MAX_MATCH_BYTES;
    } else {
      process.env.PCOB_RAW_HARD_MAX_MATCH_BYTES = previousLimits.hard;
    }
    if (previousLimits.retention === undefined) {
      delete process.env.PCOB_RAW_RETENTION_MATCH_BYTES;
    } else {
      process.env.PCOB_RAW_RETENTION_MATCH_BYTES = previousLimits.retention;
    }
  }

  assertCondition(
    result.ack.accepted === 1 && result.ack.highestContiguousSequence === 1,
    "Retention probe new stream was not durably admitted",
  );
  const retained = await context.prisma.telemetryEventLog.findMany({
    where: {
      matchId: match.matchId,
      source: { startsWith: "PCOB_RAW_V1:" },
    },
    select: {
      source: true,
      sequence: true,
      eventType: true,
      payloadJson: true,
      payloadBytes: true,
      processedAt: true,
    },
    orderBy: [{ source: "asc" }, { sequence: "asc" }],
  });
  const oldRetained = retained.filter((row) => row.source === oldSource);
  const marker = oldRetained.find(
    (row) => row.eventType === "PCOB_RAW_RETENTION_WATERMARK",
  );
  const markerPayload = marker && marker.payloadJson;
  assertCondition(
    marker &&
      marker.sequence === -1 &&
      markerPayload &&
      markerPayload.streamId === oldStreamId &&
      markerPayload.highestPrunedSequence === 1,
    "Retention probe did not create the expected per-stream watermark",
  );
  assertCondition(
    !oldRetained.some((row) => row.sequence === 1) &&
      oldRetained.some(
        (row) =>
          row.sequence === 3 &&
          row.eventType === "PCOB_RAW_EVENT" &&
          row.processedAt !== null,
      ),
    "Retention probe crossed the deliberate sequence gap",
  );
  const newSource = rawSourceKey(match.sessionId, newStreamId);
  assertCondition(
    retained.some(
      (row) =>
        row.source === newSource &&
        row.sequence === 1 &&
        row.eventType === "PCOB_RAW_EVENT" &&
        row.processedAt !== null,
    ),
    "Retention probe new stream row is missing or unprocessed",
  );
  const afterBytes = retained.reduce(
    (sum, row) => sum + Number(row.payloadBytes || 0),
    0,
  );
  assertCondition(
    afterBytes <= hardLimitBytes,
    "Retention probe remained above the hard match limit after pruning",
  );
  return {
    matchId: match.matchId,
    hardLimitBytes,
    retainedBytesBeforeAdmission: beforeBytes,
    retainedBytesAfterAdmission: afterBytes,
    oldStream: {
      source: oldSource,
      initialSequences: [1, 3],
      retainedSequences: oldRetained.map((row) => row.sequence),
      markerSequence: marker.sequence,
      highestPrunedSequence: markerPayload.highestPrunedSequence,
      markerStreamId: markerPayload.streamId,
      gapAtSequence: 2,
      sequenceAfterGapPreserved: true,
    },
    newStream: {
      source: newSource,
      accepted: result.ack.accepted,
      highestContiguousSequence: result.ack.highestContiguousSequence,
      processed: true,
    },
  };
}

async function runShutdownRecoveryProbe(context) {
  const match = await seedMatch(context, "ERANGEL", 9001);
  const streamId = "shutdown-recovery-" + crypto.randomUUID();
  const admitted = await context.rawEvents.ingest({
    matchId: match.matchId,
    sessionId: match.sessionId,
    source: "API",
    rawEvents: buildProbeRawBatch(streamId),
  });
  assertCondition(
    admitted.processing.claimId && admitted.processing.sequences.length === 1,
    "Shutdown recovery probe did not create a local durable claim",
  );
  const originalClaimId = admitted.processing.claimId;
  assertCondition(
    context.rawEventsProcessor.enqueue(admitted) === true,
    "Shutdown recovery probe worker refused its pre-shutdown claim",
  );

  // onModuleDestroy runs synchronously through timer cancellation and queue
  // capture before its first await, so the enqueue setImmediate cannot consume
  // this fixture first. The hook must release this exact local claim.
  const shutdownStartedAt = Date.now();
  await context.rawEventsProcessor.onModuleDestroy();
  const replacement = await context.rawEvents.claimPendingProcessingBatch();
  const reclaimedAfterMs = Date.now() - shutdownStartedAt;
  assertCondition(
    replacement,
    "Shutdown recovery probe could not reclaim the raw row",
  );
  assertCondition(
    replacement.processing.matchId === match.matchId &&
      replacement.processing.sourceKey === admitted.processing.sourceKey &&
      replacement.processing.sequences.length === 1 &&
      replacement.processing.sequences[0] === 1,
    "Shutdown recovery probe reclaimed the wrong durable row",
  );
  assertCondition(
    replacement.processing.claimId &&
      replacement.processing.claimId !== originalClaimId,
    "Shutdown recovery probe did not acquire a replacement claim ID",
  );
  assertCondition(
    reclaimedAfterMs < 5_000,
    "Shutdown recovery probe waited for the 60 second lease instead of releasing it",
  );
  await context.rawEvents.releaseProcessingClaim(replacement);

  const durableRow = await context.prisma.telemetryEventLog.findFirst({
    where: {
      matchId: match.matchId,
      source: admitted.processing.sourceKey,
      sequence: 1,
      eventType: "PCOB_RAW_EVENT",
      processedAt: null,
    },
    select: { payloadJson: true },
  });
  assertCondition(
    durableRow,
    "Shutdown recovery probe durable row disappeared",
  );
  assertCondition(
    !durableRow.payloadJson.delivery,
    "Shutdown recovery probe replacement claim was not released",
  );
  return {
    matchId: match.matchId,
    streamId,
    sequence: 1,
    originalClaimId,
    replacementClaimId: replacement.processing.claimId,
    reclaimedAfterMs,
    immediateReplacement: true,
    replacementReleased: true,
  };
}

function isLoopbackRemote(remoteAddress) {
  const value = String(remoteAddress || "").toLowerCase();
  return (
    value === "127.0.0.1" ||
    value === "::1" ||
    value.startsWith("127.") ||
    value.startsWith("::ffff:127.")
  );
}

function sendJson(response, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(encoded.length),
    "Cache-Control": "no-store",
  });
  response.end(encoded);
}

async function readRequestBody(request, maximumBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new Error("observer_request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function extractFlightPath(payload) {
  if (!payload || typeof payload !== "object") return null;
  const startX = finiteNumber(
    payload.PlaneStartLocX ?? payload.planeStartLocX ?? payload.PlaneStartX,
  );
  const startY = finiteNumber(
    payload.PlaneStartLocY ?? payload.planeStartLocY ?? payload.PlaneStartY,
  );
  const endX = finiteNumber(
    payload.PlaneStopLocX ?? payload.planeStopLocX ?? payload.PlaneStopX,
  );
  const endY = finiteNumber(
    payload.PlaneStopLocY ?? payload.planeStopLocY ?? payload.PlaneStopY,
  );
  if (![startX, startY, endX, endY].every(Number.isFinite)) return null;
  return {
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
  };
}

function decodeRawEventPayload(event) {
  let body = Buffer.from(String(event.rawBodyBase64 || ""), "base64");
  if (event.rawBodyEncoding === "gzip") body = zlib.gunzipSync(body);
  return JSON.parse(body.toString("utf8"));
}

function matchBackendState(state, matchId) {
  let current = state.matches.get(matchId);
  if (!current) {
    current = {
      requests: 0,
      rawBatches: 0,
      legacyRequests: 0,
      sequences: new Set(),
      routeCounts: {},
      streamId: null,
      lastRawTelemetry: null,
      latestFlightPath: null,
      errors: [],
      acknowledgements: [],
      mapProjection: {
        samples: 0,
        maxPlayerMarkers: 0,
        maxTeamMarkers: 0,
        safeZoneSamples: 0,
        flightPathSamples: 0,
        errors: [],
      },
    };
    state.matches.set(matchId, current);
  }
  return current;
}

function observeAcceptedRawTelemetry(record, payload, result) {
  const envelope = payload.rawEvents;
  record.rawBatches += 1;
  record.lastRawTelemetry = payload;
  record.streamId = record.streamId || envelope.streamId;
  assertCondition(
    record.streamId === envelope.streamId,
    "API backend saw multiple streams",
  );
  for (const event of envelope.events) {
    if (!record.sequences.has(event.sequence)) {
      record.sequences.add(event.sequence);
      record.routeCounts[event.endpoint] =
        (record.routeCounts[event.endpoint] || 0) + 1;
    }
    if (event.endpoint === "/setgameglobalinfo") {
      const flightPath = extractFlightPath(decodeRawEventPayload(event));
      if (flightPath) record.latestFlightPath = flightPath;
    }
  }
  if (result && result.rawEventsAck) {
    record.acknowledgements.push(result.rawEventsAck);
  }
}

async function observeActualMapProjection(context, record, matchId) {
  try {
    const mapState = await context.mapState.getMapState(matchId);
    const projection = record.mapProjection;
    projection.samples += 1;
    projection.maxPlayerMarkers = Math.max(
      projection.maxPlayerMarkers,
      Array.isArray(mapState && mapState.playerMarkers)
        ? mapState.playerMarkers.length
        : 0,
    );
    projection.maxTeamMarkers = Math.max(
      projection.maxTeamMarkers,
      Array.isArray(mapState && mapState.teamMarkers)
        ? mapState.teamMarkers.length
        : 0,
    );
    if (mapState && mapState.circle && mapState.circle.safeZone) {
      projection.safeZoneSamples += 1;
    }
    if (numericFlightPath(mapState && mapState.flightPath)) {
      projection.flightPathSamples += 1;
    }
  } catch (error) {
    record.mapProjection.errors.push(
      error && error.message ? error.message : String(error),
    );
  }
}

function createActualApiLoopbackServer(context) {
  const state = { matches: new Map(), actors: new Map(), totalRequests: 0 };
  const server = http.createServer(async (request, response) => {
    state.totalRequests += 1;
    let matchRecord = null;
    try {
      assertCondition(
        isLoopbackRemote(request.socket.remoteAddress),
        "non-loopback API request rejected",
      );
      assertCondition(
        request.method === "POST" && request.url === "/api/observer/telemetry",
        "unexpected API integration route",
      );
      const rawBody = await readRequestBody(request, MAX_API_BODY_BYTES);
      const payload = JSON.parse(rawBody.toString("utf8"));
      const matchId = textValue(payload && payload.matchId);
      assertCondition(matchId, "telemetry matchId is required");
      const actor = state.actors.get(matchId);
      assertCondition(
        actor,
        "telemetry match is not registered in the isolated API",
      );
      matchRecord = matchBackendState(state, matchId);
      matchRecord.requests += 1;
      const result = await context.controller.ingestTelemetry(payload, {
        user: actor,
      });
      if (payload.rawEvents && Array.isArray(payload.rawEvents.events)) {
        observeAcceptedRawTelemetry(matchRecord, payload, result);
      } else {
        matchRecord.legacyRequests += 1;
      }
      await observeActualMapProjection(context, matchRecord, matchId);
      sendJson(response, 200, result);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (matchRecord) matchRecord.errors.push(message);
      const status =
        error && typeof error.getStatus === "function"
          ? error.getStatus()
          : message === "observer_request_too_large"
            ? 413
            : 500;
      sendJson(response, status, { ok: false, error: message });
    }
  });
  return {
    server,
    state,
    registerMatch(match) {
      state.actors.set(match.matchId, match.actor);
      matchBackendState(state, match.matchId);
    },
    snapshot(matchId) {
      const record = matchBackendState(state, matchId);
      return {
        requests: record.requests,
        rawBatches: record.rawBatches,
        legacyRequests: record.legacyRequests,
        uniqueEvents: record.sequences.size,
        sequences: Array.from(record.sequences).sort(
          (left, right) => left - right,
        ),
        routeCounts: Object.fromEntries(
          Object.entries(record.routeCounts).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
        streamId: record.streamId,
        latestFlightPath: record.latestFlightPath,
        errors: [...record.errors],
        acknowledgements: [...record.acknowledgements],
        lastRawTelemetry: record.lastRawTelemetry,
        mapProjection: {
          ...record.mapProjection,
          errors: [...record.mapProjection.errors],
        },
      };
    },
  };
}

async function listenLoopback(server) {
  server.listen(0, LOOPBACK_HOST);
  await once(server, "listening");
  const address = server.address();
  assertCondition(
    address && typeof address === "object",
    "Loopback API did not bind",
  );
  return address.port;
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function allocateFreeLoopbackPort() {
  const server = net.createServer();
  server.listen(0, LOOPBACK_HOST);
  await once(server, "listening");
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : null;
  assertCondition(
    Number.isInteger(port),
    "Could not allocate a connector port",
  );
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function boundedOutputAppend(current, chunk) {
  const next = current + chunk.toString("utf8");
  return next.length <= 64 * 1024 ? next : next.slice(next.length - 64 * 1024);
}

function connectorEnvironment(options) {
  return safeSystemEnvironment({
    NODE_ENV: "test",
    HOST: LOOPBACK_HOST,
    BIND_HOST: LOOPBACK_HOST,
    PORT: String(options.port),
    FORWARD_ENABLE: "false",
    FORWARD_BASE_URL: "http://127.0.0.1:9",
    OBSERVER_FORWARD_ENABLE: "true",
    API_BASE_URL: options.apiBase,
    MATCH_ID: options.matchId,
    OBSERVER_MATCH_ID: options.matchId,
    PCOB_MATCH_ID: options.matchId,
    OBSERVER_SESSION_ID: options.sessionId,
    SESSION_ID: options.sessionId,
    OBSERVER_FEED_TOKEN: "",
    ARENZYRA_OBSERVER_FEED_TOKEN: "",
    ARENZYRA_FORCE_MAP_KEY: options.mapName,
    PCOB_EVENT_SPOOL_DIR: options.spoolBase,
    PCOB_EVENT_SPOOL_MAX_BYTES: "1073741824",
    PCOB_EVENT_SPOOL_MAX_EVENTS: "100000",
    PCOB_RAW_EVENT_CAPTURE_ENABLE: "true",
    PCOB_RAW_EVENT_BATCH_SIZE: "64",
    OBSERVER_TELEMETRY_INTERVAL_MS: "100",
    ARENZYRA_PCOB_CONNECTOR_TOKEN: options.localReadToken,
    OBTOOLS_VERBOSE_LOG: "false",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: "127.0.0.1,localhost,::1",
    http_proxy: "",
    https_proxy: "",
    all_proxy: "",
    no_proxy: "127.0.0.1,localhost,::1",
    LOCALAPPDATA: options.tempRoot,
    APPDATA: options.tempRoot,
  });
}

async function startConnector(options) {
  const connectorPath = path.join(REPO_ROOT, "ob.js");
  const output = { stdout: "", stderr: "" };
  const child = spawn(process.execPath, [connectorPath], {
    cwd: REPO_ROOT,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: connectorEnvironment(options),
  });
  child.stdout.on("data", (chunk) => {
    output.stdout = boundedOutputAppend(output.stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    output.stderr = boundedOutputAppend(output.stderr, chunk);
  });
  await Promise.race([
    once(child, "spawn"),
    once(child, "error").then(([error]) => Promise.reject(error)),
  ]);
  return { child, output };
}

function childIsStopped(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function childFailureMessage(connector) {
  return [
    "isolated connector exited unexpectedly",
    connector.output.stderr.trim(),
    connector.output.stdout.trim(),
  ]
    .filter(Boolean)
    .join(": ");
}

function connectorTransportFailureLines(connector) {
  return String(
    (connector && connector.output && connector.output.stderr) || "",
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.includes("[observer-forward] telemetry send failed") ||
        line.includes("[observer-forward] backend unavailable"),
    )
    .slice(-20);
}

async function stopConnector(connector) {
  if (!connector || childIsStopped(connector.child)) return;
  const gracefulExit = once(connector.child, "exit");
  connector.child.kill("SIGTERM");
  await Promise.race([gracefulExit, sleep(5000)]);
  if (!childIsStopped(connector.child)) {
    const forcedExit = once(connector.child, "exit");
    connector.child.kill("SIGKILL");
    await Promise.race([forcedExit, sleep(5000)]);
  }
  assertCondition(
    childIsStopped(connector.child),
    "Could not stop isolated connector",
  );
}

async function waitForConnectorHealth(
  client,
  connectorBase,
  connector,
  localReadToken,
) {
  const deadline = Date.now() + 20000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (childIsStopped(connector.child)) {
      throw new Error(childFailureMessage(connector));
    }
    try {
      const response = await client.get(connectorBase + "/health", {
        headers: { "X-Arenzyra-Connector-Token": localReadToken },
        validateStatus: () => true,
      });
      if (
        response.status === 200 &&
        response.data &&
        response.data.status === "ok" &&
        response.data.rawEventStatus === "ok"
      ) {
        assertCondition(
          response.data.forwardEnabled === false,
          "Connector legacy forwarding was not disabled",
        );
        return response.data;
      }
      lastError = new Error("health response not ready");
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(
    "Timed out waiting for connector health" +
      (lastError && lastError.message ? ": " + lastError.message : ""),
  );
}

async function protectedMetrics(client, connectorBase, token) {
  const response = await client.get(
    connectorBase + "/debug/pcob-event-metrics",
    {
      headers: { "X-Arenzyra-Connector-Token": token },
      validateStatus: () => true,
    },
  );
  assertCondition(
    response.status === 200,
    "Protected metrics returned HTTP " + response.status,
  );
  return response.data;
}

async function waitForActualApiDrain(options) {
  const deadline = Date.now() + 240000;
  let lastMetrics = null;
  let lastBackend = null;
  while (Date.now() < deadline) {
    if (childIsStopped(options.connector.child)) {
      throw new Error(childFailureMessage(options.connector));
    }
    lastBackend = options.backend.snapshot(options.matchId);
    assertCondition(
      lastBackend.errors.length === 0,
      "Actual API backend errors: " + lastBackend.errors.join("; "),
    );
    lastMetrics = await protectedMetrics(
      options.client,
      options.connectorBase,
      options.localReadToken,
    );
    const drained =
      lastBackend.uniqueEvents === options.expectedEvents &&
      lastMetrics.rawEvents.acknowledgedSequence === options.expectedEvents &&
      lastMetrics.rawEvents.pendingEvents === 0 &&
      lastMetrics.handlerQueue.pendingEvents === 0 &&
      lastMetrics.forwardQueue.pendingEvents === 0;
    if (drained) return { metrics: lastMetrics, backend: lastBackend };
    await sleep(250);
  }
  throw new Error(
    "Timed out draining connector into actual API: " +
      JSON.stringify({
        expectedEvents: options.expectedEvents,
        backend: lastBackend,
        metrics: lastMetrics,
      }),
  );
}

async function waitForActualProjectionDrain(context, matchId) {
  const deadline = Date.now() + 240000;
  let lastPending = null;
  while (Date.now() < deadline) {
    await context.rawEventsProcessor.drainNow();
    lastPending = await context.prisma.telemetryEventLog.count({
      where: {
        matchId,
        eventType: "PCOB_RAW_EVENT",
        source: { startsWith: "PCOB_RAW_V1:" },
        processedAt: null,
      },
    });
    if (lastPending === 0) return;
    await sleep(100);
  }
  throw new Error(
    "Timed out draining actual API raw projections: " +
      JSON.stringify({ matchId, pendingRows: lastPending }),
  );
}

function assertZeroObject(value, label) {
  assertCondition(value && typeof value === "object", label + " is missing");
  for (const [key, count] of Object.entries(value)) {
    assertCondition(
      count === 0,
      label + "." + key + " expected 0, received " + count,
    );
  }
}

function assertContiguousSequences(sequences, expected) {
  assertCondition(
    sequences.length === expected,
    "Actual API unique event count mismatch",
  );
  for (let index = 0; index < expected; index += 1) {
    assertCondition(
      sequences[index] === index + 1,
      "Actual API raw event sequence gap at " + (index + 1),
    );
  }
}

function sortedObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertRouteCounts(actual, expected) {
  assertCondition(
    JSON.stringify(sortedObject(actual)) ===
      JSON.stringify(sortedObject(expected)),
    "Actual API route counts differ from reconstructed recording",
  );
}

function numericFlightPath(value) {
  if (!value || typeof value !== "object") return null;
  const result = {
    start: {
      x: finiteNumber(value.start && value.start.x),
      y: finiteNumber(value.start && value.start.y),
    },
    end: {
      x: finiteNumber(value.end && value.end.x),
      y: finiteNumber(value.end && value.end.y),
    },
  };
  return [result.start.x, result.start.y, result.end.x, result.end.y].every(
    Number.isFinite,
  )
    ? result
    : null;
}

function assertFlightPathEqual(actual, expected) {
  const normalized = numericFlightPath(actual);
  assertCondition(
    normalized && expected,
    "Actual API map flight path is missing",
  );
  for (const point of ["start", "end"]) {
    for (const axis of ["x", "y"]) {
      assertCondition(
        Math.abs(normalized[point][axis] - expected[point][axis]) < 1e-9,
        "Actual API flight path differs at " + point + "." + axis,
      );
    }
  }
  return normalized;
}

function assertNoRawBodyLeak(value) {
  const serialized = JSON.stringify(value);
  assertCondition(
    !serialized.includes("rawBodyBase64"),
    "Projected raw-event history leaked exact raw body bytes",
  );
}

async function validateDatabaseAndProjection(
  context,
  match,
  replay,
  backendState,
) {
  const where = {
    matchId: match.matchId,
    eventType: "PCOB_RAW_EVENT",
    source: { startsWith: "PCOB_RAW_V1:" },
  };
  const [rowCount, unprocessedCount, aggregate, telemetry] = await Promise.all([
    context.prisma.telemetryEventLog.count({ where }),
    context.prisma.telemetryEventLog.count({
      where: { ...where, processedAt: null },
    }),
    context.prisma.telemetryEventLog.aggregate({
      where,
      _min: { sequence: true },
      _max: { sequence: true },
    }),
    context.prisma.matchTelemetry.findUnique({
      where: { matchId: match.matchId },
      select: { payload: true, updatedAt: true },
    }),
  ]);
  assertCondition(
    rowCount === replay.postedEvents,
    "Durable raw row count mismatch",
  );
  assertCondition(
    unprocessedCount === 0,
    "Actual API left raw rows unprocessed",
  );
  assertCondition(
    aggregate._min.sequence === 1 &&
      aggregate._max.sequence === replay.postedEvents,
    "Durable raw sequence bounds are invalid",
  );
  assertCondition(
    telemetry && telemetry.payload,
    "Adapter compatibility telemetry is missing",
  );

  const mapState = await context.mapState.getMapState(match.matchId);
  assertCondition(
    mapState &&
      mapState.map &&
      normalizeMapName(mapState.map.mapName) === match.mapName,
    "Actual API map projection does not match the recording",
  );
  assertCondition(
    mapState.map.coordinateSystem === "WORLD",
    "Actual API map projection is not top-left WORLD",
  );
  assertCondition(
    backendState.mapProjection.errors.length === 0 &&
      backendState.mapProjection.samples > 0,
    "Actual API map projection sampling failed",
  );
  assertCondition(
    mapState.circle && mapState.circle.safeZone,
    "Actual API map projection has no safe zone",
  );
  const flightPath = assertFlightPathEqual(
    mapState.flightPath,
    backendState.latestFlightPath,
  );

  const compactHistory = await context.rawEvents.listMatchEvents({
    matchId: match.matchId,
    limit: 100,
    includeProviderPayload: false,
  });
  assertCondition(
    compactHistory.schema === "arenzyra.pcobRawEventHistory.v1" &&
      compactHistory.events.length > 0 &&
      compactHistory.events.length <= 100,
    "Actual raw-event history projection is invalid",
  );
  assertNoRawBodyLeak(compactHistory);
  const providerHistory = await context.rawEvents.listMatchEvents({
    matchId: match.matchId,
    limit: 5,
    includeProviderPayload: true,
  });
  assertCondition(
    providerHistory.events.length === 1,
    "Provider-payload history must clamp to one event",
  );
  assertNoRawBodyLeak(providerHistory);

  const ingress = context.ingressByMatch.get(match.matchId);
  assertCondition(
    ingress && ingress.calls > 0,
    "Actual adapter emitted no canonical envelopes",
  );
  assertCondition(
    ingress.maxPlayers > 0 &&
      ingress.maxTeams > 0 &&
      ingress.maxPositionedPlayers > 0,
    "Actual adapter emitted no positioned player/team state",
  );
  assertCondition(
    ingress.auxiliaryCalls > 0 && ingress.flightPathCalls > 0,
    "Actual adapter did not receive auxiliary flight-path state",
  );

  return {
    durableRows: rowCount,
    unprocessedRows: unprocessedCount,
    sequenceRange: {
      first: aggregate._min.sequence,
      last: aggregate._max.sequence,
    },
    history: {
      compactEvents: compactHistory.events.length,
      compactBytes: compactHistory.page.responseBytes,
      providerEvents: providerHistory.events.length,
      rawBodyExcluded: true,
    },
    adapterIngress: ingress,
    mapProjection: {
      mapName: mapState.map.mapName,
      worldSize: mapState.map.worldSize,
      coordinateSystem: mapState.map.coordinateSystem,
      playerMarkers: mapState.playerMarkers.length,
      teamMarkers: mapState.teamMarkers.length,
      samples: backendState.mapProjection.samples,
      maxPlayerMarkers: backendState.mapProjection.maxPlayerMarkers,
      maxTeamMarkers: backendState.mapProjection.maxTeamMarkers,
      safeZoneSamples: backendState.mapProjection.safeZoneSamples,
      flightPathSamples: backendState.mapProjection.flightPathSamples,
      hasSafeZone: Boolean(mapState.circle.safeZone),
      flightPath,
    },
  };
}

async function getConnectorMapOverlay(
  client,
  connectorBase,
  matchId,
  localReadToken,
) {
  const response = await client.get(
    connectorBase +
      "/widget/map-overlay?matchId=" +
      encodeURIComponent(matchId),
    {
      headers: { "X-Arenzyra-Connector-Token": localReadToken },
      validateStatus: () => true,
    },
  );
  assertCondition(
    response.status === 200,
    "Connector map overlay returned HTTP " + response.status,
  );
  return response.data;
}

async function replayOneRecording(options) {
  const mapName = await inspectRecordingMap(options.recording.packetsPath);
  assertCondition(
    options.context.prismaClient.MatchMap[mapName],
    "Recording map is not supported by the API MatchMap enum: " + mapName,
  );
  const manifestCount = manifestExpectedEventCount(
    options.recording.packetsPath,
  );
  const match = await seedMatch(options.context, mapName, options.index);
  match.mapName = mapName;
  options.apiServer.registerMatch(match);
  const connectorPort = await allocateFreeLoopbackPort();
  const connectorBase = "http://" + LOOPBACK_HOST + ":" + connectorPort;
  const localReadToken = crypto.randomBytes(32).toString("hex");
  const connector = await startConnector({
    port: connectorPort,
    apiBase: options.apiBase,
    matchId: match.matchId,
    sessionId: match.sessionId,
    mapName,
    tempRoot: options.tempRoot,
    spoolBase: path.join(options.tempRoot, "spool-" + options.index),
    localReadToken,
  });
  const client = axios.create({
    timeout: 30000,
    proxy: false,
    maxRedirects: 0,
    maxBodyLength: Infinity,
  });
  let stopped = false;
  try {
    await waitForConnectorHealth(
      client,
      connectorBase,
      connector,
      localReadToken,
    );
    progress("recording-replay-start", {
      recording: path.basename(path.dirname(options.recording.packetsPath)),
      mapName,
      speed: options.speed,
    });
    const replay = await replayRecordingToConnector({
      recording: options.recording.packetsPath,
      connectorBase,
      speed: options.speed,
      timeoutMs: 30000,
      send: true,
    });
    assertCondition(
      replay.postedEvents === replay.reconstructedEvents,
      "Not every reconstructed event was posted to the connector",
    );
    if (manifestCount !== null) {
      assertCondition(
        replay.reconstructedEvents === manifestCount,
        "Reconstructed count differs from checked-in full-recording manifest",
      );
    }
    progress("recording-replay-complete", {
      recording: path.basename(path.dirname(options.recording.packetsPath)),
      postedEvents: replay.postedEvents,
    });

    const drained = await waitForActualApiDrain({
      client,
      connectorBase,
      connector,
      backend: options.apiServer,
      matchId: match.matchId,
      localReadToken,
      expectedEvents: replay.postedEvents,
    });
    const metrics = drained.metrics;
    const backend = drained.backend;
    assertContiguousSequences(backend.sequences, replay.postedEvents);
    assertRouteCounts(backend.routeCounts, replay.byEndpoint);
    assertCondition(
      metrics.rawEvents.counters.captured === replay.postedEvents,
      "Connector capture count differs from reconstructed recording",
    );
    assertCondition(
      metrics.rawEvents.status === "ok",
      "Connector raw spool is degraded",
    );
    assertZeroObject(metrics.rawEvents.drops, "rawEvents.drops");
    assertZeroObject(metrics.rawEvents.rejected, "rawEvents.rejected");
    assertCondition(
      metrics.handlerQueue.droppedEvents === 0 &&
        metrics.forwardQueue.droppedEvents === 0,
      "Connector queue dropped events",
    );
    for (const key of [
      "appendFailures",
      "corruptJournalRecords",
      "acknowledgementErrors",
      "missingAcknowledgements",
      "noProgressAcknowledgements",
      "partialAcknowledgements",
    ]) {
      assertCondition(
        metrics.rawEvents.counters[key] === 0,
        "Connector raw counter " + key + " is non-zero",
      );
    }
    const deliveryCounters = metrics.rawEvents.counters;
    assertCondition(
      deliveryCounters.deliveryAttempts > 0 &&
        deliveryCounters.deliverySuccesses > 0,
      "Connector completed no successful raw delivery",
    );
    assertCondition(
      deliveryCounters.deliveryFailures < deliveryCounters.deliveryAttempts,
      "Connector raw delivery never recovered",
    );
    assertCondition(
      metrics.rawEvents.acknowledgedSequence === replay.postedEvents &&
        metrics.rawEvents.pendingEvents === 0,
      "Connector did not durably ACK and drain every reconstructed event",
    );
    assertCondition(backend.errors.length === 0, "Actual API returned errors");
    assertCondition(
      backend.latestFlightPath,
      "Recording delivered no flight path",
    );

    await waitForActualProjectionDrain(options.context, match.matchId);
    await observeActualMapProjection(options.context, backend, match.matchId);

    const connectorMap = await getConnectorMapOverlay(
      client,
      connectorBase,
      match.matchId,
      localReadToken,
    );
    assertCondition(
      connectorMap &&
        connectorMap.map &&
        normalizeMapName(connectorMap.map.mapName) === mapName,
      "Connector final map projection differs from recording",
    );

    const rowsBeforeDuplicate =
      await options.context.prisma.telemetryEventLog.count({
        where: {
          matchId: match.matchId,
          eventType: "PCOB_RAW_EVENT",
        },
      });
    assertCondition(
      backend.lastRawTelemetry,
      "No actual raw telemetry batch was retained for retry",
    );
    const duplicateResponse = await client.post(
      options.apiBase + "/api/observer/telemetry",
      backend.lastRawTelemetry,
      { validateStatus: () => true },
    );
    assertCondition(
      duplicateResponse.status === 200 &&
        duplicateResponse.data &&
        duplicateResponse.data.rawEventsAck,
      "Actual API duplicate retry did not return an ACK",
    );
    const duplicateAck = duplicateResponse.data.rawEventsAck;
    const duplicateEventCount =
      backend.lastRawTelemetry.rawEvents.events.length;
    assertCondition(
      duplicateAck.accepted === 0 &&
        duplicateAck.duplicates === duplicateEventCount &&
        duplicateAck.highestContiguousSequence === replay.postedEvents,
      "Actual API duplicate ACK accounting is invalid",
    );
    const rowsAfterDuplicate =
      await options.context.prisma.telemetryEventLog.count({
        where: {
          matchId: match.matchId,
          eventType: "PCOB_RAW_EVENT",
        },
      });
    assertCondition(
      rowsAfterDuplicate === rowsBeforeDuplicate,
      "Duplicate retry changed durable raw row count",
    );

    await stopConnector(connector);
    stopped = true;
    const database = await validateDatabaseAndProjection(
      options.context,
      match,
      replay,
      backend,
    );
    progress("recording-api-validation-complete", {
      recording: path.basename(path.dirname(options.recording.packetsPath)),
      durableRows: database.durableRows,
      processedRows: database.durableRows - database.unprocessedRows,
      acknowledgedSequence: metrics.rawEvents.acknowledgedSequence,
      delivery: {
        attempts: deliveryCounters.deliveryAttempts,
        successes: deliveryCounters.deliverySuccesses,
        failures: deliveryCounters.deliveryFailures,
        acknowledgements: deliveryCounters.acknowledgements,
      },
      duplicateRetry: {
        events: duplicateEventCount,
        accepted: duplicateAck.accepted,
        duplicates: duplicateAck.duplicates,
      },
      routes: replay.byEndpoint,
      mapName: database.mapProjection.mapName,
      flightPath: database.mapProjection.flightPath,
    });
    return {
      recording: options.recording.packetsPath,
      fileSizeBytes: options.recording.fileSizeBytes,
      mapName,
      manifestExpectedEvents: manifestCount,
      replay: {
        packetsRead: replay.packetsRead,
        reconstructedEvents: replay.reconstructedEvents,
        postedEvents: replay.postedEvents,
        routes: replay.byEndpoint,
      },
      connector: {
        capturedEvents: metrics.rawEvents.counters.captured,
        acknowledgedSequence: metrics.rawEvents.acknowledgedSequence,
        pendingEvents: metrics.rawEvents.pendingEvents,
        drops: metrics.rawEvents.drops,
        rejected: metrics.rawEvents.rejected,
        queueDrops: {
          handler: metrics.handlerQueue.droppedEvents,
          forward: metrics.forwardQueue.droppedEvents,
        },
        delivery: {
          attempts: deliveryCounters.deliveryAttempts,
          successes: deliveryCounters.deliverySuccesses,
          failures: deliveryCounters.deliveryFailures,
          acknowledgements: deliveryCounters.acknowledgements,
          failureLog: connectorTransportFailureLines(connector),
        },
        finalMapName: connectorMap.map.mapName,
      },
      actualApi: {
        controllerRequests: backend.requests,
        rawBatches: backend.rawBatches,
        legacyRequests: backend.legacyRequests,
        uniqueRawEvents: backend.uniqueEvents,
        routeCounts: backend.routeCounts,
        duplicateRetry: {
          events: duplicateEventCount,
          accepted: duplicateAck.accepted,
          duplicates: duplicateAck.duplicates,
          durableCountUnchanged: true,
        },
        errors: backend.errors,
      },
      database,
    };
  } finally {
    if (!stopped) await stopConnector(connector);
  }
}

async function run(options) {
  const runId = crypto.randomUUID();
  const tempRoot = createSafeTempRoot();
  let container = null;
  let context = null;
  let apiServer = null;
  let result = null;
  let primaryError = null;
  const cleanupErrors = [];
  const originalConsoleLog = console.log;
  console.log = () => undefined;
  try {
    progress("postgres-start");
    container = await startDisposablePostgres(runId);
    progress("postgres-ready", {
      loopback: true,
      ephemeralPort: true,
      tmpfs: true,
    });
    await pushPrismaSchema(container.databaseUrl, tempRoot);
    progress("prisma-schema-ready");
    context = await createActualApiContext(container.databaseUrl, tempRoot, {
      allowPrismaVoidLockShim: options.allowPrismaVoidLockShim,
    });
    const reports = [];
    let retentionProbe = null;
    let shutdownRecoveryProbe = null;
    if (options.retentionProbeOnly) {
      progress("cross-stream-retention-probe-start");
      retentionProbe = await runCrossStreamRetentionProbe(context);
      progress("cross-stream-retention-probe-complete", retentionProbe);
      progress("shutdown-recovery-probe-start");
      shutdownRecoveryProbe = await runShutdownRecoveryProbe(context);
      progress("shutdown-recovery-probe-complete", shutdownRecoveryProbe);
    } else {
      apiServer = createActualApiLoopbackServer(context);
      const apiPort = await listenLoopback(apiServer.server);
      const apiBase = "http://" + LOOPBACK_HOST + ":" + apiPort;
      for (let index = 0; index < options.recordings.length; index += 1) {
        reports.push(
          await replayOneRecording({
            context,
            apiServer,
            apiBase,
            tempRoot,
            recording: options.recordings[index],
            index,
            speed: options.speed,
          }),
        );
      }
    }
    result = {
      ok: true,
      mode: options.retentionProbeOnly
        ? "isolated-real-api-cross-stream-retention-probe"
        : "isolated-real-api-recording-integration",
      speed: options.speed,
      safety: {
        databaseHost: "loopback",
        databasePort: "ephemeral",
        databaseStorage: "docker-tmpfs",
        cachedImageOnly: true,
        persistentVolumes: false,
        apiTransport: options.retentionProbeOnly ? "not-started" : "loopback",
        connectorTransport: options.retentionProbeOnly
          ? "not-started"
          : "loopback",
        legacyForwardingDisabled: true,
        installedLauncherTouched: false,
        productionTouched: false,
      },
      implementation: {
        observerController: "actual",
        observerRawEventsService: context.rawEventsCompatibility.enabled
          ? "actual-with-advisory-lock-transport-shim"
          : "actual",
        observerRawEventsProcessor: "actual-durable-background-worker",
        prismaVoidLockCompatibility: {
          enabled: context.rawEventsCompatibility.enabled,
          calls: context.rawEventsCompatibility.calls,
          sqlSemantics: context.rawEventsCompatibility.enabled
            ? "identical pg_advisory_xact_lock via $executeRaw"
            : null,
        },
        pcobAdapter: "actual",
        adapterCompatibilityPersistence: "actual",
        mapStateProjection: "actual-map-circle-flight-path",
        mapPlayerTeamMarkers:
          "reported only; canonical telemetry engine/state store not exercised",
        canonicalTelemetryIngress: "capturing stub",
        nestJwtGuardAndGlobalPipes: "not exercised",
      },
      retentionProbe,
      shutdownRecoveryProbe,
      recordings: reports,
      totals: {
        recordingBytes: reports.reduce(
          (sum, report) => sum + report.fileSizeBytes,
          0,
        ),
        packetsRead: reports.reduce(
          (sum, report) => sum + report.replay.packetsRead,
          0,
        ),
        postedEvents: reports.reduce(
          (sum, report) => sum + report.replay.postedEvents,
          0,
        ),
        durableRows: reports.reduce(
          (sum, report) => sum + report.database.durableRows,
          0,
        ),
      },
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      if (apiServer) await closeServer(apiServer.server);
    } catch (error) {
      cleanupErrors.push("api-server: " + error.message);
    }
    try {
      if (context && context.rawEventsProcessor) {
        await context.rawEventsProcessor.onModuleDestroy();
      }
      if (context && context.adapterTelemetry) {
        context.adapterTelemetry.onModuleDestroy();
      }
      if (context && context.adapter) context.adapter.onModuleDestroy();
      if (context && context.prisma) await context.prisma.onModuleDestroy();
    } catch (error) {
      cleanupErrors.push("api-context: " + error.message);
    }
    try {
      await removeDisposablePostgres(container);
    } catch (error) {
      cleanupErrors.push("postgres: " + error.message);
    }
    try {
      removeSafeTempRoot(tempRoot);
    } catch (error) {
      cleanupErrors.push("temp: " + error.message);
    }
    console.log = originalConsoleLog;
  }
  if (primaryError) {
    if (cleanupErrors.length > 0) {
      primaryError.message += "; cleanup errors: " + cleanupErrors.join("; ");
    }
    throw primaryError;
  }
  assertCondition(
    cleanupErrors.length === 0,
    "Cleanup failed: " + cleanupErrors.join("; "),
  );
  return result;
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help) {
    printHelp();
    return;
  }
  const recordings = cli.retentionProbeOnly
    ? []
    : resolveRecordings(cli.recordings);
  const report = await run({
    recordings,
    speed: cli.speed,
    allowPrismaVoidLockShim: cli.allowPrismaVoidLockShim,
    retentionProbeOnly: cli.retentionProbeOnly,
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

if (require.main === module) {
  installEmergencyContainerCleanup();
  main().catch(async (error) => {
    let finalCleanupError = null;
    try {
      await removeDisposablePostgres(activeDisposableContainer);
    } catch (cleanupError) {
      finalCleanupError = cleanupError;
    }
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          error: error && error.message ? error.message : String(error),
          finalCleanupError: finalCleanupError
            ? finalCleanupError.message || String(finalCleanupError)
            : null,
        },
        null,
        2,
      ) + "\n",
    );
    process.exitCode = 1;
  });
}

module.exports = {
  defaultFullRecordings,
  resolveRecordings,
  run,
  _test: {
    disposableContainerName,
    isMissingDockerContainerError,
    removeDisposablePostgres,
    verifyDisposableContainerOwnership,
  },
};
