"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createProductionModeService,
  resolveRegisteredMapKey,
} = require("./productionModeService.cjs");

test("production map resolution accepts every registered key and internal alias", () => {
  const expectations = {
    BALTIC_MAIN: "erangel",
    DESERT_MAIN: "miramar",
    SAVAGE_MAIN: "sanhok",
    DIHOROTOK_MAIN: "vikendi",
    LIVIK_AFTERMATH_VARIANT: "livik_aftermath",
    SUMMERLAND_MAIN: "karakin",
    NUSA: "nusa",
    NEON_MAIN: "rondo",
    TIGER_MAIN: "taego",
    KIKI_MAIN: "deston",
    CHIMERA_MAIN: "paramo",
    HEAVEN_MAIN: "haven",
  };

  for (const [input, expected] of Object.entries(expectations)) {
    assert.equal(resolveRegisteredMapKey(input), expected, input);
  }
});

test("production map resolution rejects unknown future maps", () => {
  assert.equal(resolveRegisteredMapKey("unknown_future_map"), null);
  assert.equal(resolveRegisteredMapKey("unknownerangelclone"), null);
  assert.equal(resolveRegisteredMapKey("super_miramarish_variant"), null);
});

test("production preflight still blocks when the specifically selected map asset is missing", async () => {
  const service = createProductionModeService({
    getMatchLifecycle: async () => ({ status: "READY" }),
    resolveShadowExecutable: () => "C:\\ShadowTracker\\ShadowTracker.exe",
    getHealthStatus: async () => ({
      backend: { reachable: true },
      auth: { authenticated: true, tokenValid: true },
      license: { licenseValid: true, seatActive: true },
      widgets: { running: true, reachable: true },
      shadow: { reachable: true },
    }),
    getAssetStatus: () => ({
      maps: {
        paramo: { assetAvailable: false },
      },
      requiredMissingKeys: ["paramo"],
    }),
    getTelemetryStatus: () => ({ running: false }),
    resetTelemetryForMatch: async () => ({
      running: false,
      matchId: null,
      queueSize: 0,
    }),
  });

  const result = await service.runPreflight({
    matchId: "match-paramo",
    selectedMatch: { id: "match-paramo", map: "CHIMERA_MAIN" },
  });
  const assetCheck = result.checks.find((check) => check.key === "assets");

  assert.equal(result.status, "BLOCKED");
  assert.equal(assetCheck?.status, "fail");
  assert.equal(assetCheck?.blocking, true);
  assert.match(assetCheck?.message || "", /selected map asset is missing for paramo/i);
});

test("production preflight awaits asynchronous ShadowTracker discovery without blocking the event loop", async () => {
  const logs = [];
  let releaseResolver;
  let resolverStarted = false;
  let connectorPath = null;
  const heldResolver = new Promise((resolve) => {
    releaseResolver = resolve;
  });
  const service = createProductionModeService({
    logger: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
    getMatchLifecycle: async () => ({ status: "READY" }),
    resolveShadowExecutable: async () => {
      resolverStarted = true;
      return heldResolver;
    },
    ensureConnectorInstalled: (shadowTrackerPath) => {
      connectorPath = shadowTrackerPath;
      return { ok: true, status: "ready" };
    },
    getHealthStatus: async () => ({
      backend: { reachable: true },
      auth: { authenticated: true, tokenValid: true },
      license: { licenseValid: true, seatActive: true },
      widgets: { running: true, reachable: true },
      shadow: { reachable: true },
    }),
    getAssetStatus: () => ({
      maps: { erangel: { assetAvailable: true } },
      requiredMissingKeys: [],
    }),
    getTelemetryStatus: () => ({ running: false }),
    resetTelemetryForMatch: async () => ({
      running: false,
      matchId: null,
      queueSize: 0,
    }),
    getSession: () => ({}),
    syncTeams: async () => ({
      matchId: "match-erangel",
      syncedCount: 2,
      slotCount: 2,
      slots: [],
      playerPhotoSyncSkipped: true,
    }),
    generateBranding: async () => ({
      matchId: "match-erangel",
      teamCount: 2,
      renderedCount: 0,
      cacheHitCount: 2,
      slots: [],
    }),
  });

  const preflight = service.runPreflight({
    matchId: "match-erangel",
    selectedMatch: { id: "match-erangel", map: "ERANGEL" },
  });
  let heartbeatRan = false;
  await new Promise((resolve) => {
    setImmediate(() => {
      heartbeatRan = true;
      resolve();
    });
  });

  assert.equal(heartbeatRan, true);
  assert.equal(resolverStarted, true);
  assert.equal(connectorPath, null);
  assert.match(logs[0] || "", /entering production mode/i);

  releaseResolver("C:\\ShadowTracker\\ShadowTrackerExtra.exe");
  const result = await preflight;

  assert.equal(connectorPath, "C:\\ShadowTracker\\ShadowTrackerExtra.exe");
  assert.equal(result.status, "READY");
});
