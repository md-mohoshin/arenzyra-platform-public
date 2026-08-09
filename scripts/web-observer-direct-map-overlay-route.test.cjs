"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const webRoot = path.join(repoRoot, "apps", "arenzyra-web");
const helperPath = path.join(
  webRoot,
  "src",
  "components",
  "widgets",
  "live-widget-map-overlay-helpers.ts",
);
const routePath = path.join(
  webRoot,
  "app",
  "api",
  "widgets",
  "observer-direct",
  "map-overlay",
  "route.ts",
);

function compileTypeScriptModule(filename, requireOverrides = {}) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(
    errors.length,
    0,
    errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
      .join("\n"),
  );

  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const defaultRequire = loaded.require.bind(loaded);
  loaded.require = (request) =>
    Object.prototype.hasOwnProperty.call(requireOverrides, request)
      ? requireOverrides[request]
      : defaultRequire(request);
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

const helpers = compileTypeScriptModule(helperPath);
const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "test";
const route = compileTypeScriptModule(routePath, {
  "@/components/widgets/live-widget-map-overlay-helpers": helpers,
  "@/lib/server/observer-direct-access": {
    authorizeObserverDirectRequest: ({ rawMatchId }) => ({
      ok: true,
      matchId: rawMatchId,
    }),
    createObserverDirectCapability: () => "test-capability",
    OBSERVER_DIRECT_CAPABILITY_HEADER: "x-arenzyra-observer-capability",
    observerDirectCapabilityAllowsMatch: () => false,
    observerDirectCapabilityRequired: () => false,
  },
});
if (previousNodeEnv === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = previousNodeEnv;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function invokeRoute({ direct, leaderboard }) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/widget/map-overlay?")) {
      return jsonResponse(direct);
    }
    if (url.includes("/api/widgets/observer-direct/leaderboard?")) {
      return jsonResponse(leaderboard);
    }
    throw new Error("Unexpected fetch in route test: " + url);
  };
  try {
    const response = await route.GET(
      new Request(
        "http://web.test/api/widgets/observer-direct/map-overlay?matchId=match-1",
      ),
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    return response.json();
  } finally {
    global.fetch = originalFetch;
  }
}

function playerMarker(playerId, teamId) {
  return {
    playerId,
    teamId,
    x: 0,
    y: 0,
    alive: true,
  };
}

function leaderboardPlayer(playerId) {
  return {
    playerId,
    x: 0,
    y: 0,
    alive: true,
    knocked: false,
  };
}

const flightPath = {
  start: { x: 100_000, y: 200_000 },
  end: { x: 300_000, y: 400_000 },
  coordinateSystem: "WORLD",
};

test("direct markers retain leaderboard fallback map and flight path", async () => {
  const payload = await invokeRoute({
    direct: {
      matchId: "match-1",
      updatedAt: "2026-08-01T10:00:01.000Z",
      map: null,
      circle: null,
      flightPath: null,
      teamMarkers: [],
      playerMarkers: [
        playerMarker("direct-1", "direct-team"),
        playerMarker("direct-2", "direct-team"),
      ],
    },
    leaderboard: {
      matchId: "match-1",
      updatedAt: "2026-08-01T10:00:00.000Z",
      mapName: "RONDO",
      leaderboard: [
        {
          teamId: "fallback-team",
          players: [leaderboardPlayer("fallback-1")],
        },
      ],
      circle: null,
      flightPath,
    },
  });

  assert.equal(payload.debug.producer, "observer-map-overlay");
  assert.deepEqual(
    payload.playerMarkers.map((marker) => marker.playerId),
    ["direct-1", "direct-2"],
  );
  assert.equal(payload.map.mapName, "RONDO");
  assert.equal(payload.map.worldSize, 816_000);
  assert.deepEqual(payload.flightPath, flightPath);
});

test("leaderboard markers retain direct overlay map and flight path", async () => {
  const payload = await invokeRoute({
    direct: {
      matchId: "match-1",
      updatedAt: "2026-08-01T10:00:00.000Z",
      map: {
        mapName: "RONDO",
        worldSize: 816_000,
        coordinateSystem: "WORLD",
      },
      circle: null,
      flightPath,
      teamMarkers: [],
      playerMarkers: [playerMarker("direct-1", "direct-team")],
    },
    leaderboard: {
      matchId: "match-1",
      updatedAt: "2026-08-01T10:00:01.000Z",
      mapName: null,
      leaderboard: [
        {
          teamId: "fallback-team",
          players: [
            leaderboardPlayer("fallback-1"),
            leaderboardPlayer("fallback-2"),
          ],
        },
      ],
      circle: null,
      flightPath: null,
    },
  });

  assert.equal(payload.debug.producer, "observer-leaderboard-derived-fallback");
  assert.deepEqual(
    payload.playerMarkers.map((marker) => marker.playerId),
    ["fallback-1", "fallback-2"],
  );
  assert.equal(payload.map.mapName, "RONDO");
  assert.equal(payload.map.worldSize, 816_000);
  assert.deepEqual(payload.flightPath, flightPath);
});

test("legacy bottom-left PCOB labels normalize to top-left without Y inversion", async () => {
  const legacyFlightPath = {
    start: { x: 100_000, y: 120_000 },
    end: { x: 300_000, y: 700_000 },
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  };
  const payload = await invokeRoute({
    direct: {
      matchId: "match-1",
      updatedAt: "2026-08-01T10:00:01.000Z",
      map: {
        mapName: "RONDO",
        worldSize: 816_000,
        coordinateSystem: "WORLD_BOTTOM_LEFT",
      },
      circle: null,
      flightPath: legacyFlightPath,
      teamMarkers: [],
      playerMarkers: [playerMarker("direct-1", "direct-team")],
    },
    leaderboard: {
      matchId: "match-1",
      updatedAt: "2026-08-01T10:00:00.000Z",
      mapName: null,
      leaderboard: [],
      circle: null,
      flightPath: null,
    },
  });

  assert.equal(payload.map.coordinateSystem, "WORLD");
  assert.equal(payload.flightPath.coordinateSystem, "WORLD");
  assert.equal(payload.flightPath.start.y, legacyFlightPath.start.y);
  assert.equal(payload.flightPath.end.y, legacyFlightPath.end.y);

  const projectedStart = helpers.projectMapOverlayPointToPercent(
    payload.flightPath.start.x,
    payload.flightPath.start.y,
    payload.map.worldSize,
    payload.flightPath.coordinateSystem,
  );
  assert.ok(
    projectedStart.top < 50,
    "top-left PCOB Y remains near the map top",
  );
  assert.ok(
    Math.abs(projectedStart.top - (120_000 / 816_000) * 100) < 1e-9,
    "legacy label does not vertically invert the flight path",
  );
});

test("leaderboard-selected legacy flight paths normalize to top-left WORLD", async () => {
  const legacyFlightPath = {
    start: { x: 100_000, y: 120_000 },
    end: { x: 700_000, y: 600_000 },
    coordinateSystem: "WORLD_BOTTOM_LEFT",
  };
  const payload = await invokeRoute({
    direct: {
      matchId: "match-1",
      updatedAt: "2026-08-01T10:00:00.000Z",
      map: null,
      circle: null,
      flightPath: null,
      teamMarkers: [],
      playerMarkers: [playerMarker("direct-1", "direct-team")],
    },
    leaderboard: {
      matchId: "match-1",
      updatedAt: "2026-08-01T10:00:01.000Z",
      mapName: "RONDO",
      leaderboard: [
        {
          teamId: "fallback-team",
          players: [
            leaderboardPlayer("fallback-1"),
            leaderboardPlayer("fallback-2"),
          ],
        },
      ],
      circle: null,
      flightPath: legacyFlightPath,
    },
  });

  assert.equal(payload.debug.producer, "observer-leaderboard-derived-fallback");
  assert.equal(payload.map.coordinateSystem, "WORLD");
  assert.equal(payload.flightPath.coordinateSystem, "WORLD");
  assert.equal(payload.flightPath.start.y, legacyFlightPath.start.y);
  assert.equal(payload.flightPath.end.y, legacyFlightPath.end.y);
});
