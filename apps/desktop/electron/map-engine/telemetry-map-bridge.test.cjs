"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMapTelemetryBridge } = require("./telemetry-map-bridge.cjs");

function createRegistryStub() {
  const definition = {
    key: "erangel",
    label: "Erangel",
    worldSize: 816000,
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
} = {}) {
  return {
    source: "direct-observer",
    phase: matchPhase,
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
    }),
  );

  assert.equal(engine.calls.zoneUpdates.length, 1);
  assert.equal(engine.calls.zoneUpdates[0].status, "2");
  assert.equal(engine.calls.zoneUpdates[0].mode, "closing");
  assert.equal(engine.calls.zoneUpdates[0].zoneMode, "closing");
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
    bridge.ingestSnapshot(createSnapshot({ matchPhase: "combat", circleStatus: "2" }));
    now += 31_000;
    bridge.ingestSnapshot(createSnapshot({ matchPhase: "combat", circleStatus: "2" }));
  } finally {
    Date.now = originalNow;
  }

  assert.equal(engine.calls.zoneUpdates.length, 2);
  assert.equal(engine.calls.zoneUpdates[0].circlesVisible, true);
  assert.equal(engine.calls.zoneUpdates[0].centerX, 408000);
  assert.equal(engine.calls.zoneUpdates[0].centerY, 408000);
  assert.equal(engine.calls.zoneUpdates[0].radius, 182610);
  assert.ok(engine.calls.zoneUpdates[0].flightPath);
  assert.equal(engine.calls.zoneUpdates[1].flightPath, null);
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
