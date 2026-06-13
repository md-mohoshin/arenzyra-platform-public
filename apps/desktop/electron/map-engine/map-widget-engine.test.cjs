"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMapWidgetEngine } = require("./map-widget-engine.cjs");

function createRegistryStub() {
  const definition = {
    key: "erangel",
    label: "Erangel",
    worldSize: 816000,
    coordinateScaleHint: 1,
    notes: null,
  };

  return {
    getDefaultDefinition() {
      return definition;
    },
    resolve(mapKey) {
      return String(mapKey || "").trim().toLowerCase() === definition.key
        ? definition
        : null;
    },
    toClientDefinition(value) {
      return {
        key: value.key,
        label: value.label,
        worldSize: value.worldSize,
      };
    },
  };
}

function createBroadcastStub() {
  return {
    broadcast() {},
  };
}

test("clearRuntimeState removes stale zone and player updates from the widget engine", () => {
  const engine = createMapWidgetEngine({
    registry: createRegistryStub(),
    broadcast: createBroadcastStub(),
  });

  engine.applyZoneUpdate({
    mapKey: "erangel",
    phase: 3,
    centerX: 200000,
    centerY: 300000,
    radius: 50000,
    timestamp: Date.now(),
  });
  engine.applyPlayerPositionUpdate({
    mapKey: "erangel",
    players: [
      {
        playerId: "player-1",
        teamId: "team-1",
        x: 200000,
        y: 300000,
      },
    ],
    timestamp: Date.now(),
  });

  const before = engine.getSnapshot("erangel");
  assert.ok(before.zone);
  assert.ok(before.players);
  assert.equal(before.players.players.length, 1);

  engine.clearRuntimeState({ reason: "finalizing" });

  const after = engine.getSnapshot("erangel");
  const status = engine.getStatus();
  assert.equal(after.zone, null);
  assert.equal(after.players, null);
  assert.equal(after.observerAssist, null);
  assert.equal(after.productionSupport, null);
  assert.equal(status.latestZoneUpdate, null);
  assert.equal(status.latestPlayerUpdate, null);
});

test("local runtime stores reject older dual-source updates", () => {
  const engine = createMapWidgetEngine({
    registry: createRegistryStub(),
    broadcast: createBroadcastStub(),
  });
  const baseTimestamp = Date.now();

  const newerZone = engine.applyZoneUpdate({
    mapKey: "erangel",
    phase: 3,
    centerX: 200000,
    centerY: 300000,
    radius: 50000,
    timestamp: baseTimestamp + 1000,
    receivedAt: baseTimestamp + 1000,
    source: "telemetry-bridge",
  });
  const staleZone = engine.applyZoneUpdate({
    mapKey: "erangel",
    phase: 2,
    centerX: 100000,
    centerY: 100000,
    radius: 25000,
    timestamp: baseTimestamp,
    receivedAt: baseTimestamp + 2000,
    source: "direct-observer",
  });

  const newerPlayers = engine.applyPlayerPositionUpdate({
    mapKey: "erangel",
    players: [
      {
        playerId: "player-1",
        teamId: "team-1",
        x: 200000,
        y: 300000,
      },
    ],
    timestamp: baseTimestamp + 1000,
    receivedAt: baseTimestamp + 1000,
    source: "telemetry-bridge",
  });
  const stalePlayers = engine.applyPlayerPositionUpdate({
    mapKey: "erangel",
    players: [
      {
        playerId: "player-1",
        teamId: "team-1",
        x: 100000,
        y: 100000,
      },
    ],
    timestamp: baseTimestamp,
    receivedAt: baseTimestamp + 2000,
    source: "direct-observer",
  });

  const snapshot = engine.getSnapshot("erangel");
  assert.ok(newerZone);
  assert.equal(staleZone, null);
  assert.ok(newerPlayers);
  assert.equal(stalePlayers, null);
  assert.equal(snapshot.zone.centerX, 200000);
  assert.equal(snapshot.players.players[0].x, 200000);
});

test("local runtime stores reject lower-priority source at the same timestamp", () => {
  const engine = createMapWidgetEngine({
    registry: createRegistryStub(),
    broadcast: createBroadcastStub(),
  });

  engine.applyPlayerPositionUpdate({
    mapKey: "erangel",
    players: [
      {
        playerId: "player-1",
        teamId: "team-1",
        x: 200000,
        y: 300000,
      },
    ],
    timestamp: 2000,
    receivedAt: 2000,
    source: "telemetry-bridge",
  });
  const rejected = engine.applyPlayerPositionUpdate({
    mapKey: "erangel",
    players: [
      {
        playerId: "player-1",
        teamId: "team-1",
        x: 400000,
        y: 500000,
      },
    ],
    timestamp: 2000,
    receivedAt: 3000,
    source: "direct-observer",
  });

  assert.equal(rejected, null);
  assert.equal(
    engine.getSnapshot("erangel").players.players[0].x,
    200000,
  );
});

test("local runtime normalizes numeric zone modes before broadcasting", () => {
  const engine = createMapWidgetEngine({
    registry: createRegistryStub(),
    broadcast: createBroadcastStub(),
  });
  const baseTimestamp = Date.now();

  const waitingZone = engine.applyZoneUpdate({
    mapKey: "erangel",
    phase: 2,
    mode: "1",
    zoneMode: "1",
    centerX: 200000,
    centerY: 300000,
    radius: 50000,
    timestamp: baseTimestamp,
    receivedAt: baseTimestamp,
  });
  const closingZone = engine.applyZoneUpdate({
    mapKey: "erangel",
    phase: 2,
    mode: 2,
    zoneMode: 2,
    centerX: 210000,
    centerY: 310000,
    radius: 45000,
    timestamp: baseTimestamp + 1000,
    receivedAt: baseTimestamp + 1000,
  });

  assert.equal(waitingZone.mode, "waiting");
  assert.equal(waitingZone.zoneMode, "waiting");
  assert.equal(closingZone.mode, "closing");
  assert.equal(closingZone.zoneMode, "closing");
  assert.equal(engine.getSnapshot("erangel").zone.mode, "closing");
});

test("local runtime accepts opening flight path before first zone circle", () => {
  const engine = createMapWidgetEngine({
    registry: createRegistryStub(),
    broadcast: createBroadcastStub(),
  });
  const timestamp = Date.now();
  const flightPathVisibleUntil = timestamp + 30_000;

  const zone = engine.applyZoneUpdate({
    mapKey: "erangel",
    matchPhase: "plane",
    flightPath: {
      start: { x: 120000, y: 780000 },
      end: { x: 710000, y: 36000 },
    },
    flightPathVisibleUntil,
    timestamp,
    receivedAt: timestamp,
    source: "telemetry-bridge",
  });

  assert.ok(zone);
  assert.equal(zone.currentCircle, null);
  assert.deepEqual(zone.flightPath, {
    start: { x: 120000, y: 780000 },
    end: { x: 710000, y: 36000 },
  });
  assert.equal(zone.flightPathVisibleUntil, flightPathVisibleUntil);
  assert.deepEqual(engine.getSnapshot("erangel").zone.flightPath, zone.flightPath);
  assert.equal(
    engine.getSnapshot("erangel").zone.flightPathVisibleUntil,
    flightPathVisibleUntil,
  );
});

test("local runtime rejects stale zone phase regressions after observer restart", () => {
  const engine = createMapWidgetEngine({
    registry: createRegistryStub(),
    broadcast: createBroadcastStub(),
  });
  const baseTimestamp = Date.now();

  const currentZone = engine.applyZoneUpdate({
    mapKey: "erangel",
    phase: 4,
    matchPhase: "combat",
    centerX: 331263,
    centerY: 299390,
    radius: 41359,
    timestamp: baseTimestamp,
    receivedAt: baseTimestamp,
    source: "direct-observer",
  });
  const staleRestartZone = engine.applyZoneUpdate({
    mapKey: "erangel",
    phase: 2,
    matchPhase: "combat",
    centerX: 370388,
    centerY: 384531,
    radius: 165438,
    timestamp: baseTimestamp + 1000,
    receivedAt: baseTimestamp + 1000,
    source: "direct-observer",
  });

  assert.ok(currentZone);
  assert.equal(staleRestartZone, null);
  assert.equal(engine.getSnapshot("erangel").zone.phase, 4);
  assert.equal(engine.getSnapshot("erangel").zone.centerX, 331263);
});

test("production support resolves numeric telemetry slots through launcher team branding", () => {
  const engine = createMapWidgetEngine({
    registry: createRegistryStub(),
    broadcast: createBroadcastStub(),
  });
  const timestamp = Date.now();

  engine.applyZoneUpdate({
    mapKey: "erangel",
    phase: 5,
    centerX: 100000,
    centerY: 100000,
    radius: 90000,
    timestamp,
    receivedAt: timestamp,
    source: "direct-observer",
  });
  engine.applyPlayerPositionUpdate({
    mapKey: "erangel",
    players: [
      { playerId: "hes-1", teamId: "5", teamSlot: 5, x: 100000, y: 100000, alive: true },
      { playerId: "hes-2", teamId: "5", teamSlot: 5, x: 100800, y: 100000, alive: true },
      { playerId: "hes-3", teamId: "5", teamSlot: 5, x: 101200, y: 100400, alive: true, knocked: true },
      { playerId: "hes-4", teamId: "5", teamSlot: 5, x: 99600, y: 100300, alive: true, knocked: true },
      { playerId: "nex-1", teamId: "7", teamSlot: 7, x: 103000, y: 100000, alive: true },
      { playerId: "nex-2", teamId: "7", teamSlot: 7, x: 103800, y: 100200, alive: true },
      { playerId: "nex-3", teamId: "7", teamSlot: 7, x: 104100, y: 100500, alive: true, knocked: true },
      { playerId: "nex-4", teamId: "7", teamSlot: 7, x: 102700, y: 100700, alive: true, knocked: true },
    ],
    timestamp: timestamp + 1,
    receivedAt: timestamp + 1,
    source: "direct-observer",
  });

  assert.equal(
    engine.getSnapshot("erangel").productionSupport.fightAlertCandidate.matchup,
    "Arenzyra vs Arenzyra",
  );

  engine.applyTeamBrandingUpdate({
    matchId: "match-1",
    timestamp: timestamp + 2,
    teams: [
      { slot: 5, teamName: "HES Esports", teamTag: "HES" },
      { slot: 7, teamName: "Nex ESPORT", teamTag: "NEX" },
    ],
  });

  const productionSupport = engine.getSnapshot("erangel").productionSupport;
  assert.equal(
    productionSupport.fightAlertCandidate.matchup,
    "HES Esports vs Nex ESPORT",
  );
  assert.ok(
    productionSupport.activeAlerts.some((alert) =>
      alert.label.includes("HES Esports vs Nex ESPORT"),
    ),
  );
});
