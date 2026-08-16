"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createMapTelemetryBridge } = require("./telemetry-map-bridge.cjs");
const { MAP_DEFINITIONS } = require("./map-registry.cjs");

function createRegistryStub({
  key = "erangel",
  label = "Erangel",
  worldSize = 816000,
} = {}) {
  const definition = {
    key,
    label,
    worldSize,
    coordinateScaleHint: 1,
    notes: null,
  };

  return {
    resolve(mapKey) {
      return String(mapKey || "").trim().toLowerCase() === definition.key
        ? definition
        : null;
    },
  };
}

function createEngineStub() {
  const calls = {
    mapContexts: [],
    zoneUpdates: [],
    playerUpdates: [],
    combatUpdates: [],
  };

  return {
    calls,
    syncMapContext(payload) {
      calls.mapContexts.push(payload);
      return payload;
    },
    applyZoneUpdate(payload) {
      calls.zoneUpdates.push(payload);
      return payload;
    },
    applyPlayerPositionUpdate(payload) {
      calls.playerUpdates.push(payload);
      return payload;
    },
    applyCombatEvents(payload) {
      calls.combatUpdates.push(payload);
      return payload;
    },
  };
}

function createSnapshot({
  matchPhase = "parachuting",
  timeRemaining = 60,
  circleStatus = null,
  aliveTeams = null,
} = {}) {
  return {
    source: "direct-observer",
    phase: matchPhase,
    aliveTeams,
    circlePayload: {
      mapName: "erangel",
      safeZone: {
        x: 408000,
        y: 408000,
        r: 182610,
      },
      nextZone: {
        x: 436000,
        y: 392000,
        r: 111600,
      },
      currentBlueZone: {
        x: 408000,
        y: 408000,
        r: 408000,
      },
      flightPath: {
        start: {
          x: 120000,
          y: 780000,
        },
        end: {
          x: 710000,
          y: 36000,
        },
      },
      timeRemaining,
      phaseDuration: Math.max(timeRemaining, 60),
      circleIndex: 1,
      CircleStatus: circleStatus,
      GameTime: 45,
    },
    players: [],
    teams: [],
    kills: [],
  };
}

function createFlightPathOnlySnapshot() {
  return {
    source: "direct-observer",
    phase: "plane",
    circlePayload: {
      mapName: "erangel",
      flightPath: {
        start: {
          x: 120000,
          y: 780000,
        },
        end: {
          x: 710000,
          y: 36000,
        },
      },
      timeRemaining: 24,
      phaseDuration: 60,
      GameTime: 12,
    },
    players: [],
    teams: [],
    kills: [],
  };
}

function createRoutePayloadFlightPathSnapshot() {
  return {
    source: "direct-observer",
    phase: "plane",
    circlePayload: {
      mapName: "erangel",
      timeRemaining: 24,
      phaseDuration: 60,
      GameTime: 12,
    },
    routePayloads: {
      routePayloads: {
        planeRoute: {
          start: {
            x: 120000,
            y: 780000,
          },
          end: {
            x: 710000,
            y: 36000,
          },
        },
      },
    },
    players: [],
    teams: [],
    kills: [],
  };
}

function createPcobRoutePayloadFlightPathSnapshot() {
  return {
    source: "direct-observer",
    phase: "plane",
    circlePayload: {
      mapName: "erangel",
      timeRemaining: 24,
      phaseDuration: 60,
      GameTime: 12,
    },
    routePayloads: {
      "/setgameglobalinfo": {
        PlaneStartLocX: 543300.625,
        PlaneStartLocY: 951586.5625,
        PlaneStopLocX: 358180.875,
        PlaneStopLocY: -161006.8125,
        flightPath: {
          start: { x: 543300.625, y: 951586.5625 },
          end: { x: 358180.875, y: -161006.8125 },
          coordinateSystem: "WORLD",
        },
      },
    },
    players: [],
    teams: [],
    kills: [],
  };
}

function readFirstJsonLine(filePath, maxBytes = 1024 * 1024) {
  const descriptor = fs.openSync(filePath, "r");
  const chunks = [];
  let totalBytes = 0;
  try {
    while (totalBytes < maxBytes) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes - totalBytes));
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) {
        break;
      }
      const chunk = buffer.subarray(0, bytesRead);
      const newlineIndex = chunk.indexOf(0x0a);
      if (newlineIndex >= 0) {
        chunks.push(chunk.subarray(0, newlineIndex));
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      chunks.push(chunk);
      totalBytes += bytesRead;
    }
  } finally {
    fs.closeSync(descriptor);
  }

  throw new Error(`No complete JSON line found within ${maxBytes} bytes.`);
}

function readFirstJsonLineMatching(
  filePath,
  predicate,
  { maxBytes = 16 * 1024 * 1024, maxLines = 64 } = {},
) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const completeText = buffer.subarray(0, bytesRead).toString("utf8");
    const completeLineBoundary = completeText.lastIndexOf("\n");
    const lines = completeText
      .slice(0, completeLineBoundary >= 0 ? completeLineBoundary : 0)
      .split(/\r?\n/)
      .slice(0, maxLines);

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const packet = JSON.parse(line);
      if (predicate(packet)) {
        return packet;
      }
    }
  } finally {
    fs.closeSync(descriptor);
  }

  throw new Error(
    `No matching complete JSON line found within ${maxBytes} bytes and ${maxLines} lines.`,
  );
}

test("telemetry map bridge hides opening circles until the release timer expires", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(
    createSnapshot({
      matchPhase: "parachuting",
      timeRemaining: 42,
    }),
  );

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].matchPhase, "parachuting");
  assert.equal(engine.calls.zoneUpdates[0].circlesVisible, false);
  assert.deepEqual(engine.calls.zoneUpdates[0].flightPath, {
    start: {
      x: 120000,
      y: 780000,
    },
    end: {
      x: 710000,
      y: 36000,
    },
  });
});

test("telemetry map bridge reveals circles once the opening timer has elapsed", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(
    createSnapshot({
      matchPhase: "parachuting",
      timeRemaining: 0,
    }),
  );

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].circlesVisible, true);
});

test("telemetry map bridge can skip a full-snapshot zone already emitted by the fast lane", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  const snapshot = createSnapshot({
    matchPhase: "combat",
    circleStatus: "2",
  });
  delete snapshot.circlePayload.flightPath;
  bridge.ingestSnapshot(snapshot, { skipZoneUpdate: true });

  assert.equal(engine.calls.zoneUpdates.length, 0);
  assert.equal(engine.calls.mapContexts.length, 1);
});

test("telemetry map bridge emits a newly discovered flight path despite fast-lane circle dedupe", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const fastSnapshot = createSnapshot({
    matchPhase: "plane",
    circleStatus: "1",
  });
  delete fastSnapshot.circlePayload.flightPath;
  bridge.ingestSnapshot(fastSnapshot);

  const fullSnapshot = createPcobRoutePayloadFlightPathSnapshot();
  fullSnapshot.circlePayload.safeZone = fastSnapshot.circlePayload.safeZone;
  bridge.ingestSnapshot(fullSnapshot, { skipZoneUpdate: true });
  bridge.ingestSnapshot(fullSnapshot, { skipZoneUpdate: true });

  assert.equal(engine.calls.zoneUpdates.length, 2);
  assert.ok(engine.calls.zoneUpdates[1].flightPath);
});

test("telemetry map bridge maps numeric circle status 2 to closing mode", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(
    createSnapshot({
      matchPhase: "combat",
      timeRemaining: 18,
      circleStatus: "2",
      aliveTeams: 12,
    }),
  );

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].status, "2");
  assert.equal(engine.calls.zoneUpdates[0].mode, "closing");
  assert.equal(engine.calls.zoneUpdates[0].zoneMode, "closing");
  assert.equal(engine.calls.zoneUpdates[0].aliveTeams, 12);
});

test("telemetry map bridge maps numeric number circle status 2 to closing mode", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(
    createSnapshot({
      matchPhase: "combat",
      timeRemaining: 18,
      circleStatus: 2,
    }),
  );

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].status, "2");
  assert.equal(engine.calls.zoneUpdates[0].mode, "closing");
  assert.equal(engine.calls.zoneUpdates[0].zoneMode, "closing");
});

test("telemetry map bridge seeds PCOB player numbers from a complete opening roster", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const snapshot = createSnapshot({ matchPhase: "plane" });
  snapshot.teams = [
    { teamId: 2, liveMemberNum: 2 },
    { teamId: 7, liveMemberNum: 3 },
  ];
  snapshot.players = [
    {
      uId: "team-2-player-1",
      playerName: "Two One",
      teamId: 2,
      location: { x: 100000, y: 110000 },
    },
    {
      uId: "team-2-player-2",
      playerName: "Two Two",
      teamId: 2,
      location: { x: 101000, y: 111000 },
    },
    {
      uId: "team-7-player-1",
      playerName: "Seven One",
      teamId: 7,
      location: { x: 200000, y: 210000 },
    },
    {
      uId: "team-7-player-2",
      playerName: "Seven Two",
      teamId: 7,
      location: { x: 201000, y: 211000 },
    },
    {
      uId: "team-7-player-3",
      playerName: "Seven Three",
      teamId: 7,
      location: { x: 202000, y: 212000 },
    },
  ].map((player) => ({ ...player, health: 100, liveState: 1 }));

  bridge.ingestSnapshot(snapshot);

  assert.equal(engine.calls.playerUpdates.length, 1);
  assert.deepEqual(
    engine.calls.playerUpdates[0].players.map((player) => ({
      playerId: player.playerId,
      teamSlot: player.teamSlot,
      playerNumber: player.playerNumber,
    })),
    [
      { playerId: "team-2-player-1", teamSlot: 2, playerNumber: 1 },
      { playerId: "team-2-player-2", teamSlot: 2, playerNumber: 2 },
      { playerId: "team-7-player-1", teamSlot: 7, playerNumber: 1 },
      { playerId: "team-7-player-2", teamSlot: 7, playerNumber: 2 },
      { playerId: "team-7-player-3", teamSlot: 7, playerNumber: 3 },
    ],
  );
});

test("telemetry map bridge keeps PCOB control ordinals stable through death reordering and reset", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const player = (uId, playerName, liveState = 1) => ({
    uId,
    playerName,
    teamId: 4,
    location: { x: 100000 + Number(uId), y: 110000 },
    health: liveState === 5 ? 0 : 100,
    liveState,
  });
  const opening = createSnapshot({ matchPhase: "plane" });
  opening.teams = [{ teamId: 4, liveMemberNum: 4 }];
  opening.players = [
    player("1", "Tryhard"),
    player("2", "ICE"),
    player("3", "Killer"),
    player("4", "ESKOM"),
  ];
  bridge.ingestSnapshot(opening);

  const reordered = createSnapshot({ matchPhase: "combat", circleStatus: "2" });
  reordered.teams = [{ teamId: 4, liveMemberNum: 3 }];
  reordered.players = [
    player("1", "Tryhard", 2),
    player("3", "Killer", 2),
    player("4", "ESKOM", 2),
    player("2", "ICE", 5),
  ];
  bridge.ingestSnapshot(reordered);

  assert.deepEqual(
    engine.calls.playerUpdates[1].players.map((entry) => [
      entry.playerName,
      entry.playerNumber,
    ]),
    [
      ["Tryhard", 1],
      ["Killer", 3],
      ["ESKOM", 4],
      ["ICE", 2],
    ],
  );

  bridge.reset();
  const nextMatch = createSnapshot({ matchPhase: "plane" });
  nextMatch.teams = [{ teamId: 4, liveMemberNum: 4 }];
  nextMatch.players = [
    player("4", "ESKOM"),
    player("3", "Killer"),
    player("2", "ICE"),
    player("1", "Tryhard"),
  ];
  bridge.ingestSnapshot(nextMatch);
  assert.deepEqual(
    engine.calls.playerUpdates[2].players.map((entry) => entry.playerNumber),
    [1, 2, 3, 4],
  );
});

test("telemetry map bridge fails PCOB map control closed on a late partial roster", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const snapshot = createSnapshot({ matchPhase: "combat", circleStatus: "2" });
  snapshot.teams = [{ teamId: 4, liveMemberNum: 3 }];
  snapshot.players = [
    { uId: "1", playerName: "A", teamId: 4, location: { x: 1, y: 1 }, liveState: 2 },
    { uId: "3", playerName: "C", teamId: 4, location: { x: 2, y: 2 }, liveState: 2 },
    { uId: "4", playerName: "D", teamId: 4, location: { x: 3, y: 3 }, liveState: 2 },
    { uId: "2", playerName: "B", teamId: 4, location: { x: 4, y: 4 }, liveState: 5 },
  ];

  bridge.ingestSnapshot(snapshot);

  assert.deepEqual(
    engine.calls.playerUpdates[0].players.map((entry) => entry.playerNumber),
    [null, null, null, null],
  );
  assert.match(
    engine.calls.playerUpdates[0].warnings.join(" "),
    /map control is disabled/i,
  );
});

test("telemetry map bridge preserves PCOB uId and maps captured combat semantics", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const snapshot = createSnapshot({ matchPhase: "combat", circleStatus: "2" });
  snapshot.players = [
    {
      uId: 533228770,
      playerName: "7sinsNODY999",
      teamId: 7,
      location: { x: 410000, y: 420000, z: 1200 },
      health: 100,
      liveState: 0,
    },
    {
      uId: 5452861577,
      playerName: "NXSIMIRAGE",
      teamId: 8,
      location: { x: 430000, y: 440000, z: 1200 },
      health: 0,
      liveState: 4,
    },
    {
      uId: 5452861578,
      playerName: "NXSPLAYER2",
      teamId: 8,
      location: { x: 450000, y: 460000, z: 1200 },
      health: 0,
      liveState: 5,
    },
  ];
  snapshot.kills = [];
  snapshot.observerSnapshot = {
    killInfoEntries: [
      {
        payload: {
          CauserName: "7sinsNODY999",
          VictimName: "NXSIMIRAGE",
          CauserUID: "533228770",
          VictimUID: "5452861577",
          ResultHealthStatus: "1",
          CurGameTime: "141",
        },
        receivedAtMs: 1_783_637_217_904,
      },
      {
        payload: {
          CauserName: "7sinsNODY999",
          VictimName: "NXSPLAYER2",
          CauserUID: "533228770",
          VictimUID: "5452861578",
          ResultHealthStatus: "2",
          CurGameTime: "143",
        },
        receivedAtMs: 1_783_637_219_904,
      },
    ],
  };

  bridge.ingestSnapshot(snapshot);

  assert.deepEqual(
    engine.calls.playerUpdates[0].players.map((player) => player.playerId),
    ["533228770", "5452861577", "5452861578"],
  );
  assert.equal(engine.calls.playerUpdates[0].players[0].z, 1200);
  assert.equal(engine.calls.playerUpdates[0].players[0].liveState, 0);
  assert.equal(engine.calls.combatUpdates.length, 1);
  assert.deepEqual(
    engine.calls.combatUpdates[0].events.map((event) => ({
      kind: event.kind,
      killerPlayerId: event.killerPlayerId,
      killerTeamId: event.killerTeamId,
      victimPlayerId: event.victimPlayerId,
      victimTeamId: event.victimTeamId,
      x: event.x,
      y: event.y,
    })),
    [
      {
        kind: "knock",
        killerPlayerId: "533228770",
        killerTeamId: "7",
        victimPlayerId: "5452861577",
        victimTeamId: "8",
        x: 430000,
        y: 440000,
      },
      {
        kind: "kill",
        killerPlayerId: "533228770",
        killerTeamId: "7",
        victimPlayerId: "5452861578",
        victimTeamId: "8",
        x: 450000,
        y: 460000,
      },
    ],
  );
});

test("telemetry map bridge maps numeric circle status 1 to waiting mode", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(
    createSnapshot({
      matchPhase: "combat",
      timeRemaining: 18,
      circleStatus: "1",
    }),
  );

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].status, "1");
  assert.equal(engine.calls.zoneUpdates[0].mode, "waiting");
  assert.equal(engine.calls.zoneUpdates[0].zoneMode, "waiting");
});

test("telemetry map bridge does not treat PCOB Counter as remaining when MaxTime is zero", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const snapshot = createSnapshot({ matchPhase: "combat", circleStatus: "1" });
  delete snapshot.circlePayload.timeRemaining;
  delete snapshot.circlePayload.phaseDuration;
  snapshot.circlePayload.Counter = 42;
  snapshot.circlePayload.MaxTime = 0;

  bridge.ingestSnapshot(snapshot);

  assert.equal(engine.calls.zoneUpdates[0].timeRemaining, null);
  assert.equal(engine.calls.zoneUpdates[0].phaseDuration, 0);
});

test("telemetry map bridge merges recorded PCOB circle geometry with timer-only payloads", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "combat",
    circlePayload: {
      mapName: "erangel",
      GameTime: "82",
      CircleStatus: "1",
      CircleIndex: "0",
      Counter: "82",
      MaxTime: "0",
    },
    observerSnapshot: {
      mapName: "erangel",
      normalized: {
        circle: {
          phase: 0,
          status: "1",
          counterSeconds: 82,
          maxTimeSeconds: 0,
          safeZone: { x: 603216.5, y: 278990.8125, r: 229068 },
          nextZone: null,
        },
      },
    },
    players: [],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].centerX, 603216.5);
  assert.equal(engine.calls.zoneUpdates[0].centerY, 278990.8125);
  assert.equal(engine.calls.zoneUpdates[0].radius, 229068);
  assert.equal(engine.calls.zoneUpdates[0].timeRemaining, null);
});

test("telemetry map bridge forwards flight path before first zone circle exists", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(createFlightPathOnlySnapshot());

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].matchPhase, "plane");
  assert.equal(engine.calls.zoneUpdates[0].centerX, null);
  assert.deepEqual(engine.calls.zoneUpdates[0].flightPath, {
    start: {
      x: 120000,
      y: 780000,
    },
    end: {
      x: 710000,
      y: 36000,
    },
  });
});

test("telemetry map bridge forwards flight path from route payloads", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(createRoutePayloadFlightPathSnapshot());

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].matchPhase, "plane");
  assert.deepEqual(engine.calls.zoneUpdates[0].flightPath, {
    start: {
      x: 120000,
      y: 780000,
    },
    end: {
      x: 710000,
      y: 36000,
    },
  });
});

test("telemetry map bridge reads the real PCOB slash-named game-global route", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(createPcobRoutePayloadFlightPathSnapshot());

  assert.equal(engine.calls.zoneUpdates.length, 1);
  const { flightPath } = engine.calls.zoneUpdates[0];
  assert.ok(flightPath);
  assert.ok(flightPath.start.x >= 0 && flightPath.start.x <= 816000);
  assert.ok(flightPath.start.y >= 0 && flightPath.start.y <= 816000);
  assert.ok(flightPath.end.x >= 0 && flightPath.end.x <= 816000);
  assert.ok(flightPath.end.y >= 0 && flightPath.end.y <= 816000);
});

test("telemetry map bridge prefers the normalized PCOB observer flight path", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const snapshot = createPcobRoutePayloadFlightPathSnapshot();
  snapshot.routePayloads = null;
  snapshot.observerSnapshot = {
    normalized: {
      flightPath: {
        start: { x: 120000, y: 780000 },
        end: { x: 710000, y: 36000 },
        coordinateSystem: "WORLD",
      },
    },
  };

  bridge.ingestSnapshot(snapshot);

  assert.deepEqual(engine.calls.zoneUpdates[0].flightPath, {
    start: { x: 120000, y: 780000 },
    end: { x: 710000, y: 36000 },
  });
});

test("telemetry map bridge keeps the opening Rondo path when PCOB alternates a recall-plane route", () => {
  const rondoDefinition = MAP_DEFINITIONS.find(
    (definition) => definition.key === "rondo",
  );
  assert.ok(rondoDefinition);
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(rondoDefinition),
  });
  const openingPath = {
    start: { x: 919171.4375, y: 635857.5625 },
    end: { x: -162147.9375, y: 430360.09375 },
    coordinateSystem: "WORLD",
  };
  const recallPath = {
    start: { x: -151496.03125, y: 515753.71875 },
    end: { x: 826383.125, y: 27338.40625 },
    coordinateSystem: "WORLD",
  };
  const snapshotFor = (flightPath) => ({
    source: "direct-observer",
    phase: "plane",
    circlePayload: { mapName: "rondo", GameTime: 12 },
    observerSnapshot: { normalized: { flightPath } },
    players: [],
    teams: [],
    kills: [],
  });

  bridge.ingestSnapshot(snapshotFor(openingPath));
  bridge.ingestSnapshot(snapshotFor(recallPath));
  bridge.ingestSnapshot(snapshotFor(openingPath));
  bridge.ingestSnapshot(snapshotFor(recallPath));

  assert.equal(engine.calls.zoneUpdates.length, 4);
  const renderedPaths = engine.calls.zoneUpdates.map((update) => update.flightPath);
  assert.ok(renderedPaths[0]);
  for (const renderedPath of renderedPaths.slice(1)) {
    assert.deepEqual(renderedPath, renderedPaths[0]);
  }

  bridge.reset();
  bridge.ingestSnapshot(snapshotFor(recallPath));
  assert.notDeepEqual(engine.calls.zoneUpdates.at(-1).flightPath, renderedPaths[0]);
});

test("telemetry map bridge reads wrapped raw PCOB route payloads", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const snapshot = createPcobRoutePayloadFlightPathSnapshot();
  snapshot.routePayloads = null;
  snapshot.observerSnapshot = {
    rawRoutePayloads: {
      "/setgameglobalinfo": {
        receivedAt: "2026-07-09T22:13:46.584Z",
        payload: {
          PlaneStartLocX: 120000,
          PlaneStartLocY: 780000,
          PlaneStopLocX: 710000,
          PlaneStopLocY: 36000,
        },
      },
    },
  };

  bridge.ingestSnapshot(snapshot);

  assert.deepEqual(engine.calls.zoneUpdates[0].flightPath, {
    start: { x: 120000, y: 780000 },
    end: { x: 710000, y: 36000 },
  });
});

const pcobRecordingPath = path.resolve(
  __dirname,
  "../../../../recordings/pcob/normal-no-recall-1783637101011/packets.jsonl",
);
const rondoPcobRecordingPath = path.resolve(
  __dirname,
  "../../../../recordings/pcob/rondo-recall-1783635224496/packets.jsonl",
);
const pcobFixtureDirectory = path.resolve(__dirname, "test-fixtures/pcob");

function readPcobFixture(fileName) {
  return JSON.parse(
    fs.readFileSync(path.join(pcobFixtureDirectory, fileName), "utf8"),
  );
}

test("telemetry map bridge always replays the sanitized Erangel PCOB flight path fixture", () => {
  const packet = readPcobFixture("erangel-opening.json");
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "plane",
    circlePayload: { mapName: packet.raw.mapName, GameTime: 1 },
    observerSnapshot: packet.raw,
    players: [],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.ok(engine.calls.zoneUpdates[0].flightPath);
  assert.notDeepEqual(
    engine.calls.zoneUpdates[0].flightPath.start,
    engine.calls.zoneUpdates[0].flightPath.end,
  );
  for (const point of Object.values(engine.calls.zoneUpdates[0].flightPath)) {
    assert.ok(point.x >= 0 && point.x <= 816000);
    assert.ok(point.y >= 0 && point.y <= 816000);
  }
});

test("telemetry map bridge always replays the sanitized Rondo PCOB flight path fixture", () => {
  const packet = readPcobFixture("rondo-opening.json");
  const rondoDefinition = MAP_DEFINITIONS.find(
    (definition) => definition.key === "rondo",
  );
  assert.ok(rondoDefinition);
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(rondoDefinition),
  });

  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "plane",
    circlePayload: { mapName: packet.raw.mapName, GameTime: 1 },
    observerSnapshot: packet.raw,
    players: [],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.ok(engine.calls.zoneUpdates[0].flightPath);
  assert.notDeepEqual(
    engine.calls.zoneUpdates[0].flightPath.start,
    engine.calls.zoneUpdates[0].flightPath.end,
  );
  for (const point of Object.values(engine.calls.zoneUpdates[0].flightPath)) {
    assert.ok(point.x >= 0 && point.x <= rondoDefinition.worldSize);
    assert.ok(point.y >= 0 && point.y <= rondoDefinition.worldSize);
  }
});

test(
  "telemetry map bridge replays the first available real PCOB recording packet",
  { skip: !fs.existsSync(pcobRecordingPath) },
  () => {
    const packet = readFirstJsonLine(pcobRecordingPath);
    assert.ok(packet?.raw?.normalized?.flightPath);

    const engine = createEngineStub();
    const bridge = createMapTelemetryBridge({
      engine,
      registry: createRegistryStub(),
    });
    bridge.ingestSnapshot({
      source: "direct-observer",
      phase: "plane",
      circlePayload: {
        mapName: packet.raw.mapName,
        GameTime: 1,
      },
      observerSnapshot: packet.raw,
      players: [],
      teams: [],
      kills: [],
    });

    assert.equal(engine.calls.zoneUpdates.length, 1);
    const { flightPath } = engine.calls.zoneUpdates[0];
    assert.ok(flightPath);
    for (const point of [flightPath.start, flightPath.end]) {
      assert.ok(point.x >= 0 && point.x <= 816000);
      assert.ok(point.y >= 0 && point.y <= 816000);
    }
  },
);

test(
  "telemetry map bridge replays the recorded Rondo flight path",
  { skip: !fs.existsSync(rondoPcobRecordingPath) },
  () => {
    const packet = readFirstJsonLineMatching(
      rondoPcobRecordingPath,
      (candidate) => Boolean(candidate?.raw?.normalized?.flightPath),
    );
    assert.equal(packet.raw.mapName, "rondo");

    const rondoDefinition = MAP_DEFINITIONS.find(
      (definition) => definition.key === "rondo",
    );
    assert.ok(rondoDefinition);
    const engine = createEngineStub();
    const bridge = createMapTelemetryBridge({
      engine,
      registry: createRegistryStub(rondoDefinition),
    });
    bridge.ingestSnapshot({
      source: "direct-observer",
      phase: "plane",
      circlePayload: {
        mapName: packet.raw.mapName,
        GameTime: 1,
      },
      observerSnapshot: packet.raw,
      players: [],
      teams: [],
      kills: [],
    });

    assert.equal(engine.calls.zoneUpdates.length, 1);
    const { flightPath } = engine.calls.zoneUpdates[0];
    assert.ok(flightPath);
    assert.notDeepEqual(flightPath.start, flightPath.end);
    for (const point of [flightPath.start, flightPath.end]) {
      assert.ok(point.x >= 0 && point.x <= rondoDefinition.worldSize);
      assert.ok(point.y >= 0 && point.y <= rondoDefinition.worldSize);
    }
  },
);

test("telemetry map bridge reset does not reuse a previous match flight path", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(createRoutePayloadFlightPathSnapshot());
  bridge.reset();
  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "plane",
    circlePayload: { mapName: "erangel", GameTime: 2 },
    players: [],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.zoneUpdates.length, 1);
});

test("telemetry map bridge keeps real PCOB world units for clustered coordinates", () => {
  const engine = createEngineStub();
  const registry = createRegistryStub();
  const originalResolve = registry.resolve;
  registry.resolve = (mapKey) => {
    const definition = originalResolve(mapKey);
    return definition ? { ...definition, coordinateScaleHint: 102 } : null;
  };
  const bridge = createMapTelemetryBridge({ engine, registry });

  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "combat",
    circlePayload: { mapName: "erangel" },
    players: [
      {
        uId: 10,
        playerName: "Near Origin",
        teamId: 1,
        location: { x: 7000, y: 8000 },
      },
    ],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.playerUpdates[0].coordinate.detectedScaleFactor, 1);
  assert.equal(engine.calls.playerUpdates[0].players[0].x, 7000);
  assert.equal(engine.calls.playerUpdates[0].players[0].y, 8000);
});

test("telemetry map bridge timestamps player updates from the PCOB totalmessage revision", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const snapshot = createSnapshot({ matchPhase: "combat", circleStatus: "2" });
  snapshot.players = [
    {
      uId: 10,
      playerName: "Timestamped Player",
      teamId: 1,
      location: { x: 7000, y: 8000 },
    },
  ];
  snapshot.observerSnapshot = {
    rawRoutePayloads: {
      "/totalmessage": {
        receivedAt: "2026-07-09T22:13:46.584Z",
        payload: {},
      },
    },
  };

  bridge.ingestSnapshot(snapshot);

  assert.equal(
    engine.calls.playerUpdates[0].timestamp,
    Date.parse("2026-07-09T22:13:46.584Z"),
  );
});

test("telemetry map bridge retains simplified-coordinate support for non-PCOB sources", () => {
  const engine = createEngineStub();
  const registry = createRegistryStub();
  const originalResolve = registry.resolve;
  registry.resolve = (mapKey) => {
    const definition = originalResolve(mapKey);
    return definition ? { ...definition, coordinateScaleHint: 102 } : null;
  };
  const bridge = createMapTelemetryBridge({ engine, registry });

  bridge.ingestSnapshot({
    source: "mock",
    phase: "combat",
    circlePayload: { mapName: "erangel" },
    players: [
      {
        playerId: "scaled-player",
        teamId: 1,
        location: { x: 4000, y: 5000 },
      },
    ],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.playerUpdates[0].coordinate.detectedScaleFactor, 102);
  assert.equal(engine.calls.playerUpdates[0].players[0].x, 408000);
  assert.equal(engine.calls.playerUpdates[0].players[0].y, 510000);
});

test("telemetry map bridge projects players, circles, and flight paths on all registered maps", () => {
  for (const definition of MAP_DEFINITIONS) {
    const engine = createEngineStub();
    const registry = {
      resolve(value) {
        return String(value || "").toLowerCase() === definition.key
          ? { ...definition, coordinateScaleHint: 102 }
          : null;
      },
    };
    const bridge = createMapTelemetryBridge({ engine, registry });
    const worldSize = definition.worldSize;

    bridge.ingestSnapshot({
      source: "direct-observer",
      phase: "plane",
      circlePayload: {
        mapName: definition.key,
        safeZone: {
          x: worldSize * 0.5,
          y: worldSize * 0.5,
          r: worldSize * 0.2,
        },
      },
      observerSnapshot: {
        normalized: {
          flightPath: {
            start: { x: -worldSize * 0.1, y: worldSize * 0.8 },
            end: { x: worldSize * 1.1, y: worldSize * 0.2 },
            coordinateSystem: "WORLD",
          },
        },
      },
      players: [
        {
          uId: 99,
          playerName: "Map Matrix Player",
          teamId: 1,
          location: { x: worldSize * 0.25, y: worldSize * 0.75 },
        },
      ],
      teams: [],
      kills: [],
    });

    assert.equal(engine.calls.zoneUpdates.length, 1, definition.key);
    assert.equal(engine.calls.playerUpdates.length, 1, definition.key);
    assert.equal(engine.calls.zoneUpdates[0].centerX, worldSize * 0.5, definition.key);
    assert.equal(engine.calls.playerUpdates[0].players[0].x, worldSize * 0.25, definition.key);
    assert.equal(
      engine.calls.playerUpdates[0].coordinate.calibrationStatus,
      definition.telemetryCalibrationStatus || "provisional",
      definition.key,
    );
    assert.equal(
      engine.calls.playerUpdates[0].coordinate.boundsStatus,
      "within-nominal-bounds",
      definition.key,
    );
    if (definition.telemetryCalibrationStatus !== "recording-backed") {
      assert.ok(
        engine.calls.playerUpdates[0].warnings.some((warning) =>
          warning.includes("alignment is provisional"),
        ),
        definition.key,
      );
    }
    const flightPath = engine.calls.zoneUpdates[0].flightPath;
    assert.ok(flightPath, definition.key);
    for (const point of [flightPath.start, flightPath.end]) {
      assert.ok(point.x >= 0 && point.x <= worldSize, definition.key);
      assert.ok(point.y >= 0 && point.y <= worldSize, definition.key);
    }
  }
});

test("telemetry map bridge reports nominal-bound clamping instead of treating it as calibration", () => {
  const engine = createEngineStub();
  const definition = {
    key: "provisional_map",
    label: "Provisional Map",
    worldSize: 1000,
    coordinateScaleHint: 1,
    telemetryCalibrationStatus: "provisional",
  };
  const bridge = createMapTelemetryBridge({
    engine,
    registry: {
      resolve(value) {
        return String(value || "").toLowerCase() === definition.key
          ? definition
          : null;
      },
    },
  });

  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "combat",
    circlePayload: {
      mapName: definition.key,
      safeZone: { x: 500, y: 500, r: 250 },
    },
    players: [
      {
        uId: 1,
        teamId: 1,
        playerName: "Out of bounds",
        location: { x: 1250, y: 500 },
      },
    ],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.playerUpdates.length, 1);
  assert.equal(engine.calls.playerUpdates[0].players[0].x, 1000);
  assert.equal(
    engine.calls.playerUpdates[0].coordinate.boundsStatus,
    "out-of-bounds-observed",
  );
  assert.equal(engine.calls.playerUpdates[0].coordinate.playerOutOfBoundsCount, 1);
  assert.equal(engine.calls.playerUpdates[0].coordinate.zoneCenterOutOfBoundsCount, 0);
  assert.ok(
    engine.calls.playerUpdates[0].warnings.some((warning) =>
      warning.includes("rendered edge clamping is not calibration evidence"),
    ),
  );
});

test("telemetry map bridge keeps known flight path before first circle when phase is combat", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(createRoutePayloadFlightPathSnapshot());
  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "combat",
    circlePayload: {
      mapName: "erangel",
      timeRemaining: 75,
      phaseDuration: 0,
      CircleStatus: "1",
      GameTime: 30,
    },
    players: [],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.zoneUpdates.length, 2);
  assert.equal(engine.calls.zoneUpdates[1].matchPhase, "combat");
  assert.equal(engine.calls.zoneUpdates[1].centerX, null);
  assert.deepEqual(engine.calls.zoneUpdates[1].flightPath, {
    start: {
      x: 120000,
      y: 780000,
    },
    end: {
      x: 710000,
      y: 36000,
    },
  });
});

test("telemetry map bridge keeps flight path for 30 seconds after first circle shows", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const originalNow = Date.now;
  let now = 1_780_000_000_000;
  Date.now = () => now;

  try {
    bridge.ingestSnapshot(createRoutePayloadFlightPathSnapshot());
    now += 10_000;
    bridge.ingestSnapshot(
      createSnapshot({
        matchPhase: "combat",
        timeRemaining: 0,
        circleStatus: "2",
      }),
    );
    now += 29_000;
    bridge.ingestSnapshot(
      createSnapshot({
        matchPhase: "combat",
        timeRemaining: 0,
        circleStatus: "2",
      }),
    );
    now += 2_000;
    bridge.ingestSnapshot(
      createSnapshot({
        matchPhase: "combat",
        timeRemaining: 0,
        circleStatus: "2",
      }),
    );
  } finally {
    Date.now = originalNow;
  }

  assert.equal(engine.calls.zoneUpdates.length, 4);
  assert.deepEqual(engine.calls.zoneUpdates[1].flightPath, {
    start: {
      x: 120000,
      y: 780000,
    },
    end: {
      x: 710000,
      y: 36000,
    },
  });
  assert.deepEqual(engine.calls.zoneUpdates[2].flightPath, {
    start: {
      x: 120000,
      y: 780000,
    },
    end: {
      x: 710000,
      y: 36000,
    },
  });
  assert.equal(engine.calls.zoneUpdates[3].flightPath, null);
});

test("telemetry map bridge clips off-map flight path without changing slope", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "plane",
    circlePayload: {
      mapName: "erangel",
      flightPath: {
        start: {
          x: -135039,
          y: 578285.125,
        },
        end: {
          x: 831684.125,
          y: 33392.75,
        },
      },
      circleIndex: 0,
      CircleStatus: "1",
      timeRemaining: 14,
    },
    players: [],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.zoneUpdates.length, 1);
  const { flightPath } = engine.calls.zoneUpdates[0];
  assert.equal(flightPath.start.x, 0);
  assert.ok(Math.abs(flightPath.start.y - 502170.548) < 0.01);
  assert.equal(flightPath.end.x, 816000);
  assert.ok(Math.abs(flightPath.end.y - 42233.089) < 0.01);
});

test("telemetry map bridge clears flight path after circle retention window expires", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const originalNow = Date.now;
  let now = 1_780_100_000_000;
  Date.now = () => now;

  try {
    bridge.ingestSnapshot(createRoutePayloadFlightPathSnapshot());
    now += 1_000;
    bridge.ingestSnapshot(createSnapshot({ matchPhase: "combat", circleStatus: "2" }));
    now += 31_000;
    bridge.ingestSnapshot(createSnapshot({ matchPhase: "combat", circleStatus: "2" }));
  } finally {
    Date.now = originalNow;
  }

  assert.equal(engine.calls.zoneUpdates.length, 3);
  assert.equal(engine.calls.zoneUpdates[1].circlesVisible, true);
  assert.equal(engine.calls.zoneUpdates[1].centerX, 408000);
  assert.equal(engine.calls.zoneUpdates[1].centerY, 408000);
  assert.equal(engine.calls.zoneUpdates[1].radius, 182610);
  assert.ok(engine.calls.zoneUpdates[1].flightPath);
  assert.equal(engine.calls.zoneUpdates[2].flightPath, null);
});

test("late combat attachment does not show a stale persistent PCOB plane path", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot(createSnapshot({ matchPhase: "combat", circleStatus: "2" }));

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].flightPath, null);
});

test("expired persistent PCOB path does not bypass fast-lane dedupe repeatedly", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });
  const originalNow = Date.now;
  let now = 1_780_200_000_000;
  Date.now = () => now;

  try {
    const snapshot = createSnapshot({ matchPhase: "combat", circleStatus: "2" });
    bridge.ingestSnapshot(snapshot);
    now += 31_000;
    bridge.ingestSnapshot(snapshot, { skipZoneUpdate: true });
    bridge.ingestSnapshot(snapshot, { skipZoneUpdate: true });
    bridge.ingestSnapshot(snapshot, { skipZoneUpdate: true });
  } finally {
    Date.now = originalNow;
  }

  assert.equal(engine.calls.zoneUpdates.length, 1);
});

test("telemetry map bridge forwards live fighting state", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot({
    ...createSnapshot({ matchPhase: "combat", circleStatus: "2" }),
    players: [
      {
        playerKey: 101,
        playerName: "Shooter",
        teamId: 1,
        location: { x: 410000, y: 410000 },
        health: 100,
        liveState: 0,
        isFiring: true,
        aimAngle: 90,
        fireDirection: { x: 3, y: 4 },
      },
      {
        playerKey: 102,
        playerName: "Active",
        teamId: 2,
        location: { x: 420000, y: 420000 },
        health: 93,
        liveState: 3,
        isFiring: false,
      },
      {
        playerKey: 103,
        playerName: "Knocked",
        teamId: 3,
        location: { x: 430000, y: 430000 },
        health: 64,
        liveState: 4,
        isFiring: false,
      },
      {
        playerKey: 104,
        playerName: "Dead",
        teamId: 4,
        location: { x: 440000, y: 440000 },
        health: 0,
        liveState: 5,
      },
    ],
  });

  assert.equal(engine.calls.playerUpdates.length, 1);
  const players = engine.calls.playerUpdates[0].players;
  assert.equal(players[0].isFiring, true);
  assert.equal(players[0].fireAngle, 90);
  assert.deepEqual(players[0].fireDirection, { x: 0.6, y: 0.8 });
  assert.equal(players[0].knocked, false);
  assert.equal(players[0].inVehicle, false);
  assert.equal(players[0].alive, true);
  assert.equal(players[1].knocked, false);
  assert.equal(players[1].inVehicle, true);
  assert.equal(players[1].alive, true);
  assert.equal(players[2].knocked, true);
  assert.equal(players[2].inVehicle, false);
  assert.equal(players[2].alive, true);
  assert.equal(players[3].alive, false);
});

test("telemetry map bridge does not mark active liveState 3 players as knocked", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot({
    ...createSnapshot({ matchPhase: "combat", circleStatus: "2" }),
    players: [
      {
        playerKey: 201,
        playerName: "KTBxAHMED",
        teamId: 20,
        location: { x: 410000, y: 410000 },
        health: 100,
        liveState: 3,
      },
      {
        playerKey: 202,
        playerName: "ActuallyKnocked",
        teamId: 20,
        location: { x: 430000, y: 430000 },
        health: 52,
        liveState: 4,
      },
    ],
  });

  assert.equal(engine.calls.playerUpdates.length, 1);
  const players = engine.calls.playerUpdates[0].players;
  assert.equal(players[0].knocked, false);
  assert.equal(players[0].inVehicle, true);
  assert.equal(players[0].alive, true);
  assert.equal(players[1].knocked, true);
  assert.equal(players[1].inVehicle, false);
  assert.equal(players[1].alive, true);
});

test("telemetry map bridge keeps explicit death authoritative over an alive numeric state", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot({
    ...createSnapshot({ matchPhase: "combat", circleStatus: "2" }),
    players: [
      {
        uId: 301,
        playerName: "Recalled",
        teamId: 30,
        location: { x: 410000, y: 410000 },
        health: 100,
        liveState: 1,
        bHasDied: false,
      },
      {
        uId: 302,
        playerName: "Explicitly Dead",
        teamId: 31,
        location: { x: 420000, y: 420000 },
        health: 100,
        liveState: 1,
        bHasDied: true,
      },
    ],
  });

  assert.equal(engine.calls.playerUpdates[0].players[0].alive, true);
  assert.equal(engine.calls.playerUpdates[0].players[1].alive, false);
});

test("telemetry map bridge does not synthesize full-map blue zone while first circle waits", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "combat",
    circlePayload: {
      mapName: "erangel",
      CircleArray: [
        {
          X: "267370.625000",
          Y: "601703.125000",
          Size: "182610.000000",
        },
      ],
      phase: 1,
      circleIndex: 1,
      CircleStatus: "0",
      Counter: 150,
      MaxTime: 163,
      safeZone: {
        x: 267370.625,
        y: 601703.125,
        r: 182610,
      },
      nextZone: null,
    },
    players: [],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].centerX, 267370.625);
  assert.equal(engine.calls.zoneUpdates[0].blueCenterX, null);
  assert.equal(engine.calls.zoneUpdates[0].blueRadius, null);
  assert.equal(engine.calls.zoneUpdates[0].raw.blueCircle, null);
});

test("telemetry map bridge starts first closing blue zone outside the map when live blue equals safe circle", () => {
  const engine = createEngineStub();
  const bridge = createMapTelemetryBridge({
    engine,
    registry: createRegistryStub(),
  });

  bridge.ingestSnapshot({
    source: "direct-observer",
    phase: "combat",
    circlePayload: {
      mapName: "erangel",
      CircleArray: [
        {
          X: "267370.625000",
          Y: "601703.125000",
          Size: "182610.000000",
        },
      ],
      phase: 1,
      circleIndex: 1,
      CircleStatus: "2",
      Counter: 0,
      MaxTime: 163,
      safeZone: {
        x: 267370.625,
        y: 601703.125,
        r: 182610,
      },
      currentBlueZone: {
        x: 267370.625,
        y: 601703.125,
        r: 182610,
      },
    },
    players: [],
    teams: [],
    kills: [],
  });

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].centerX, 267370.625);
  assert.equal(engine.calls.zoneUpdates[0].blueCenterX, 408000);
  assert.equal(engine.calls.zoneUpdates[0].blueCenterY, 408000);
  assert.ok(engine.calls.zoneUpdates[0].blueRadius > 640000);
  assert.ok(engine.calls.zoneUpdates[0].raw.blueCircle.radius > 640000);
});
