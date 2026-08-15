"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { MAP_DEFINITIONS } = require("./map-engine/map-registry.cjs");
const { _testing, createTelemetryBridge } = require("./telemetryBridge.cjs");

test("transport normalization uses the shared world size for every registered map", () => {
  for (const definition of MAP_DEFINITIONS) {
    const normalized = _testing.normalizePosition(
      definition.worldSize / 2,
      definition.worldSize / 4,
      definition.aliases[0] || definition.key,
    );
    assert.deepEqual(
      normalized,
      { x: 0.5, y: 0.75 },
      `unexpected transport projection for ${definition.key}`,
    );
  }

  assert.equal(_testing.normalizePosition(100, 100, "unknown_future_map"), null);
  assert.equal(_testing.resolveTransportMapDefinition("unknownerangelclone"), null);
  assert.equal(_testing.resolveTransportMapDefinition("super_miramarish_variant"), null);
  assert.equal(
    _testing.resolveTransportMapDefinition("match_neon_main_variant")?.key,
    "rondo",
  );
});

test("transport treats captured PCOB liveState 1 as alive and 5 as dead", () => {
  assert.equal(
    _testing.isTransportPlayerAlive({ liveState: 1, bHasDied: false, health: 100 }),
    true,
  );
  assert.equal(
    _testing.isTransportPlayerAlive({ liveState: 5, bHasDied: true, health: 0 }),
    false,
  );
});

test("transport preserves nullable PCOB player metrics and monotonic stable-id maxima", () => {
  const metricCache = new Map();
  const first = _testing.normalizeTransportPlayers(
    [
      {
        uId: "shadow-uid-7",
        playerOpenId: "openid-7",
        TeamID: 12,
        playerName: "Alpha",
        damage: "635.25",
        maxKillDistance: "128.5",
        gotAirDropNum: "1",
      },
      {
        uId: "shadow-uid-8",
        playerOpenId: "openid-8",
        TeamID: 12,
        playerName: "Bravo",
      },
    ],
    "ERANGEL",
    metricCache,
  );

  assert.deepEqual(
    {
      damageDealt: first[0].damageDealt,
      longestEliminationDistanceM: first[0].longestEliminationDistanceM,
      airdropLootCount: first[0].airdropLootCount,
    },
    {
      damageDealt: 635.25,
      longestEliminationDistanceM: 128.5,
      airdropLootCount: 1,
    },
  );
  assert.deepEqual(
    {
      damageDealt: first[1].damageDealt,
      longestEliminationDistanceM: first[1].longestEliminationDistanceM,
      airdropLootCount: first[1].airdropLootCount,
    },
    {
      damageDealt: null,
      longestEliminationDistanceM: null,
      airdropLootCount: null,
    },
  );

  const later = _testing.normalizeTransportPlayers(
    [
      {
        uId: "rotated-shadow-uid-7",
        playerOpenId: "openid-7",
        TeamID: 12,
        playerName: "Alpha",
        damage: 600,
        maxKillDistance: null,
        gotAirDropNum: 0,
      },
    ],
    "ERANGEL",
    metricCache,
  );

  assert.deepEqual(
    {
      damageDealt: later[0].damageDealt,
      longestEliminationDistanceM: later[0].longestEliminationDistanceM,
      airdropLootCount: later[0].airdropLootCount,
    },
    {
      damageDealt: 635.25,
      longestEliminationDistanceM: 128.5,
      airdropLootCount: 1,
    },
  );
});

test("transport retry queue expires stale snapshots", () => {
  const now = 1_800_000_000_000;
  assert.equal(
    _testing.isPendingTelemetryEventFresh({ createdAt: now - 29_999 }, now),
    true,
  );
  assert.equal(
    _testing.isPendingTelemetryEventFresh({ createdAt: now - 30_001 }, now),
    false,
  );
  assert.equal(_testing.isPendingTelemetryEventFresh({}, now), false);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 10_000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for condition.");
}

function createShadowServer({
  players = [
    {
      playerId: "player-1",
      teamId: "team-1",
      x: 200000,
      y: 300000,
      isAlive: true,
    },
  ],
  teams = [
    {
      teamId: "team-1",
      slot: 1,
      liveMemberNum: 1,
      memberNum: 1,
    },
  ],
} = {}) {
  return http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    switch (req.url) {
      case "/getallinfo":
        res.end(JSON.stringify({ allInfo: { mapName: "ERANGEL" } }));
        return;
      case "/gettotalplayerlist":
        res.end(JSON.stringify({ playerInfoList: players }));
        return;
      case "/getteaminfolist":
        res.end(JSON.stringify({ teamInfoList: teams }));
        return;
      case "/getkillinfo":
        res.end(JSON.stringify({ killInfo: [] }));
        return;
      case "/getcircleinfo":
        res.end(
          JSON.stringify({
            circleInfo: {
              mapName: "ERANGEL",
              GameTime: 120,
              CircleIndex: 2,
              CircleStatus: "WAITING",
            },
          }),
        );
        return;
      case "/getgameglobalinfo":
        res.end(JSON.stringify({ gameGlobalInfo: {} }));
        return;
      case "/getobservingplayer":
        res.end(JSON.stringify({ observingPlayer: null }));
        return;
      default:
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not-found" }));
    }
  });
}

for (const { reason, initialOutage } of [
  { reason: "NO_STATE_CHANGE", initialOutage: false },
  { reason: "DURABLE_REPLAY_ALREADY_APPLIED", initialOutage: true },
]) {
  test(`transport treats ${reason} as a successful non-terminal acknowledgement`, async () => {
    const backendState = {
      postCount: 0,
      acknowledgedCount: 0,
    };
    const shadowServer = createShadowServer();
    const backendServer = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (
        req.method === "GET" &&
        /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")
      ) {
        res.end(JSON.stringify({ matchStatus: "LIVE" }));
        return;
      }

      if (req.method === "POST" && req.url === "/api/observer/telemetry") {
        backendState.postCount += 1;
        if (initialOutage && backendState.postCount === 1) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "temporary-outage" }));
          return;
        }

        backendState.acknowledgedCount += 1;
        res.end(
          JSON.stringify({
            ok: true,
            queued: false,
            ignored: true,
            reason,
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not-found" }));
    });

    const shadowAddress = await listen(shadowServer);
    const backendAddress = await listen(backendServer);
    const bridge = createTelemetryBridge({
      log: () => {},
      shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
    });

    try {
      await bridge.start({
        apiBase: `http://127.0.0.1:${backendAddress.port}`,
        token: "token",
        refreshToken: "refresh",
        matchId: `match-${reason.toLowerCase()}`,
        sessionId: `session-${reason.toLowerCase()}`,
      });

      const acknowledged = await waitFor(() => {
        const status = bridge.getStatus();
        return backendState.acknowledgedCount >= 1 &&
          status.running === true &&
          status.totalPackets >= 1
          ? status
          : null;
      });
      assert.equal(acknowledged.connectionStatus, "connected");
      assert.equal(acknowledged.queueSize, 0);
      assert.equal(acknowledged.lastError, null);

      const acknowledgedPostCount = backendState.postCount;
      await waitFor(() => backendState.postCount > acknowledgedPostCount, 3_000);
      const continued = bridge.getStatus();
      assert.equal(continued.running, true);
      assert.equal(continued.connectionStatus, "connected");
      assert.ok(continued.totalPackets >= 2);
    } finally {
      bridge.stop("stopped");
      await Promise.all([close(shadowServer), close(backendServer)]);
    }
  });
}

test("explicit terminal ignore reason without lifecycle fields stops transport", async () => {
  const backendState = { postCount: 0 };
  const shadowServer = createShadowServer();
  const backendServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (
      req.method === "GET" &&
      /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")
    ) {
      res.end(JSON.stringify({ matchStatus: "LIVE" }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/observer/telemetry") {
      backendState.postCount += 1;
      res.end(
        JSON.stringify({
          ok: true,
          ignored: true,
          reason: "MATCH_ENDED",
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const shadowAddress = await listen(shadowServer);
  const backendAddress = await listen(backendServer);
  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
  });

  try {
    await bridge.start({
      apiBase: `http://127.0.0.1:${backendAddress.port}`,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-explicit-end",
      sessionId: "session-explicit-end",
    });

    const finished = await waitFor(() => {
      const status = bridge.getStatus();
      return backendState.postCount >= 1 && status.running === false
        ? status
        : null;
    });
    assert.equal(finished.connectionStatus, "finished");
    assert.equal(finished.matchStatus, "FINISHED");
    assert.equal(finished.isLocked, true);
    assert.equal(finished.queueSize, 0);

    const stabilizedPostCount = backendState.postCount;
    await sleep(750);
    assert.equal(backendState.postCount, stabilizedPostCount);
  } finally {
    bridge.stop("stopped");
    await Promise.all([close(shadowServer), close(backendServer)]);
  }
});

test("finalizing transport response stops the bridge and purges queued telemetry", async () => {
  const backendState = {
    postCount: 0,
  };

  const shadowServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    switch (req.url) {
      case "/getallinfo":
        res.end(JSON.stringify({ allInfo: { mapName: "ERANGEL" } }));
        return;
      case "/gettotalplayerlist":
        res.end(
          JSON.stringify({
            playerInfoList: [
              {
                playerId: "player-1",
                teamId: "team-1",
                x: 200000,
                y: 300000,
                isAlive: true,
              },
            ],
          }),
        );
        return;
      case "/getteaminfolist":
        res.end(
          JSON.stringify({
            teamInfoList: [
              {
                teamId: "team-1",
                slot: 1,
                liveMemberNum: 1,
                memberNum: 1,
              },
            ],
          }),
        );
        return;
      case "/getkillinfo":
        res.end(JSON.stringify({ killInfo: [] }));
        return;
      case "/getcircleinfo":
        res.end(
          JSON.stringify({
            circleInfo: {
              mapName: "ERANGEL",
              GameTime: 120,
              CircleIndex: 2,
              CircleStatus: "WAITING",
            },
          }),
        );
        return;
      case "/getgameglobalinfo":
        res.end(JSON.stringify({ gameGlobalInfo: {} }));
        return;
      case "/getobservingplayer":
        res.end(JSON.stringify({ observingPlayer: null }));
        return;
      default:
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not-found" }));
    }
  });

  const backendServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")) {
      res.end(JSON.stringify({ matchStatus: "LIVE" }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/observer/telemetry") {
      backendState.postCount += 1;
      if (backendState.postCount === 1) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "temporary-outage" }));
        return;
      }

      res.end(
        JSON.stringify({
          ignored: true,
          reason: "MATCH_FINALIZING",
          matchStatus: "FINISH_PENDING",
          isFinalizing: true,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const shadowAddress = await listen(shadowServer);
  const backendAddress = await listen(backendServer);
  const shadowBaseUrl = `http://127.0.0.1:${shadowAddress.port}`;
  const backendBaseUrl = `http://127.0.0.1:${backendAddress.port}`;

  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl,
  });

  try {
    await bridge.start({
      apiBase: backendBaseUrl,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-1",
      sessionId: "session-1",
    });

    await waitFor(() => {
      const status = bridge.getStatus();
      return backendState.postCount >= 2 && status.running === false ? status : null;
    });

    const stopped = bridge.getStatus();
    assert.equal(stopped.connectionStatus, "finalizing");
    assert.equal(stopped.isFinalizing, true);
    assert.equal(stopped.queueSize, 0);

    const stabilizedPostCount = backendState.postCount;
    await sleep(1500);
    assert.equal(backendState.postCount, stabilizedPostCount);
  } finally {
    bridge.stop("stopped");
    await Promise.all([close(shadowServer), close(backendServer)]);
  }
});

test("transport payload preserves runtime-safe identity fields", async () => {
  let capturedPayload = null;

  const shadowServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    switch (req.url) {
      case "/getallinfo":
        res.end(JSON.stringify({ allInfo: { mapName: "ERANGEL" } }));
        return;
      case "/gettotalplayerlist":
        res.end(
          JSON.stringify({
            playerInfoList: [
              {
                playerId: "runtime-player-1",
                playerOpenId: "open-player-1",
                externalPlayerId: "external-player-1",
                playerName: "Stable Player",
                teamNo: 7,
                x: 200000,
                y: 300000,
                isAlive: true,
              },
            ],
          }),
        );
        return;
      case "/getteaminfolist":
        res.end(
          JSON.stringify({
            teamInfoList: [
              {
                teamNo: 7,
                teamName: "Stable Team",
                teamTag: "STB",
                liveMemberNum: 1,
                memberNum: 1,
              },
            ],
          }),
        );
        return;
      case "/getkillinfo":
        res.end(JSON.stringify({ killInfo: [] }));
        return;
      case "/getcircleinfo":
        res.end(
          JSON.stringify({
            circleInfo: {
              mapName: "ERANGEL",
              GameTime: 120,
              CircleIndex: 2,
              CircleStatus: "WAITING",
            },
          }),
        );
        return;
      case "/getgameglobalinfo":
        res.end(JSON.stringify({ gameGlobalInfo: {} }));
        return;
      case "/getobservingplayer":
        res.end(JSON.stringify({ observingPlayer: null }));
        return;
      default:
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not-found" }));
    }
  });

  const backendServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")) {
      res.end(JSON.stringify({ matchStatus: "LIVE" }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/observer/telemetry") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        capturedPayload = JSON.parse(body);
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const shadowAddress = await listen(shadowServer);
  const backendAddress = await listen(backendServer);
  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
  });

  try {
    await bridge.start({
      apiBase: `http://127.0.0.1:${backendAddress.port}`,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-identity",
      sessionId: "session-identity",
    });

    await waitFor(() => capturedPayload);

    assert.equal(capturedPayload.players.length, 1);
    assert.equal(capturedPayload.players[0].id, "runtime-player-1");
    assert.equal(capturedPayload.players[0].playerOpenId, "open-player-1");
    assert.equal(capturedPayload.players[0].externalPlayerId, "external-player-1");
    assert.equal(capturedPayload.players[0].playerName, "Stable Player");
    assert.equal(capturedPayload.players[0].teamId, "7");
    assert.equal(capturedPayload.players[0].teamNo, 7);
    assert.equal(capturedPayload.players[0].teamSlot, 7);
    assert.equal(capturedPayload.teams.length, 1);
    assert.equal(capturedPayload.teams[0].teamId, "7");
    assert.equal(capturedPayload.teams[0].slot, 7);
    assert.equal(capturedPayload.teams[0].teamNo, 7);
    assert.equal(capturedPayload.teams[0].teamName, "Stable Team");
    assert.equal(capturedPayload.teams[0].teamTag, "STB");
  } finally {
    bridge.stop("stopped");
    await Promise.all([close(shadowServer), close(backendServer)]);
  }
});

test("transport derives confirmed PCOB placements while leaving unplaced teams unset", async () => {
  let capturedPayload = null;
  const shadowServer = createShadowServer({
    players: [
      {
        uId: "team-one-a",
        playerName: "One A",
        teamId: 1,
        liveState: 1,
        rank: 2,
      },
      {
        uId: "team-one-b",
        playerName: "One B",
        teamId: 1,
        liveState: 1,
        rank: 2,
      },
      {
        uId: "team-two-a",
        playerName: "Two A",
        teamId: 2,
        liveState: 0,
        rank: 0,
      },
      {
        uId: "team-two-b",
        playerName: "Two B",
        teamId: 2,
        liveState: 0,
        rank: 0,
      },
      {
        uId: "team-three-a",
        playerName: "Three A",
        teamId: 3,
        liveState: 1,
        rank: 3,
      },
      {
        uId: "team-three-b",
        playerName: "Three B",
        teamId: 3,
        liveState: 1,
        rank: 4,
      },
    ],
    teams: [
      { teamId: 1, liveMemberNum: 0, memberNum: 2 },
      { teamId: 2, liveMemberNum: 2, memberNum: 2 },
      { teamId: 3, liveMemberNum: 0, memberNum: 2 },
    ],
  });
  const backendServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")) {
      res.end(JSON.stringify({ matchStatus: "LIVE" }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/observer/telemetry") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        capturedPayload = JSON.parse(body);
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const shadowAddress = await listen(shadowServer);
  const backendAddress = await listen(backendServer);
  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
  });

  try {
    await bridge.start({
      apiBase: `http://127.0.0.1:${backendAddress.port}`,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-placement",
      sessionId: "session-placement",
    });
    await waitFor(() => capturedPayload);

    const teamsById = new Map(
      capturedPayload.teams.map((team) => [team.teamId, team]),
    );
    assert.equal(teamsById.get("1").placement, 2);
    assert.equal(teamsById.get("2").placement, null);
    assert.equal(teamsById.get("3").placement, null);
  } finally {
    bridge.stop("stopped");
    await Promise.all([close(shadowServer), close(backendServer)]);
  }
});

test("transport payload keeps identity-bearing players even when position is unavailable", async () => {
  let capturedPayload = null;

  const shadowServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    switch (req.url) {
      case "/getallinfo":
        res.end(JSON.stringify({ allInfo: { mapName: "ERANGEL" } }));
        return;
      case "/gettotalplayerlist":
        res.end(
          JSON.stringify({
            playerInfoList: [
              {
                playerId: "runtime-player-2",
                playerOpenId: "open-player-2",
                externalPlayerId: "external-player-2",
                playerName: "No Position Player",
                teamNo: 4,
                isAlive: true,
                kills: 2,
              },
            ],
          }),
        );
        return;
      case "/getteaminfolist":
        res.end(
          JSON.stringify({
            teamInfoList: [
              {
                teamId: 4,
                teamName: "No Position Team",
                teamTag: "NPT",
                liveMemberNum: 1,
                memberNum: 1,
              },
            ],
          }),
        );
        return;
      case "/getkillinfo":
        res.end(JSON.stringify({ killInfo: [] }));
        return;
      case "/getcircleinfo":
        res.end(
          JSON.stringify({
            circleInfo: {
              mapName: "ERANGEL",
              GameTime: 120,
              CircleIndex: 2,
              CircleStatus: "WAITING",
            },
          }),
        );
        return;
      case "/getgameglobalinfo":
        res.end(JSON.stringify({ gameGlobalInfo: {} }));
        return;
      case "/getobservingplayer":
        res.end(JSON.stringify({ observingPlayer: null }));
        return;
      default:
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not-found" }));
    }
  });

  const backendServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")) {
      res.end(JSON.stringify({ matchStatus: "LIVE" }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/observer/telemetry") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        capturedPayload = JSON.parse(body);
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const shadowAddress = await listen(shadowServer);
  const backendAddress = await listen(backendServer);
  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
  });

  try {
    await bridge.start({
      apiBase: `http://127.0.0.1:${backendAddress.port}`,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-positionless",
      sessionId: "session-positionless",
    });

    await waitFor(() => capturedPayload);

    assert.equal(capturedPayload.players.length, 1);
    assert.equal(capturedPayload.players[0].id, "runtime-player-2");
    assert.equal(capturedPayload.players[0].playerOpenId, "open-player-2");
    assert.equal(capturedPayload.players[0].externalPlayerId, "external-player-2");
    assert.equal(capturedPayload.players[0].playerName, "No Position Player");
    assert.equal(capturedPayload.players[0].teamId, "4");
    assert.equal(capturedPayload.players[0].kills, 2);
    assert.equal(capturedPayload.players[0].position, null);
  } finally {
    bridge.stop("stopped");
    await Promise.all([close(shadowServer), close(backendServer)]);
  }
});

test("operator stop purges retry queue and disables telemetry runtime", async () => {
  const backendState = { postCount: 0 };
  const shadowServer = createShadowServer();
  const backendServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")) {
      res.end(JSON.stringify({ matchStatus: "LIVE" }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/observer/telemetry") {
      backendState.postCount += 1;
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "temporary-outage" }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const shadowAddress = await listen(shadowServer);
  const backendAddress = await listen(backendServer);
  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
  });

  try {
    await bridge.start({
      apiBase: `http://127.0.0.1:${backendAddress.port}`,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-stop",
      sessionId: "session-stop",
    });

    await waitFor(() => {
      const status = bridge.getStatus();
      return status.queueSize > 0 ? status : null;
    });

    const stopped = bridge.stop("operator-stop");
    assert.equal(stopped.running, false);
    assert.equal(stopped.connectionStatus, "operator-stop");
    assert.equal(stopped.queueSize, 0);
    assert.equal(stopped.sessionId, null);
    assert.equal(stopped.connectedToBackend, false);
  } finally {
    bridge.stop("stopped");
    await Promise.all([close(shadowServer), close(backendServer)]);
  }
});

test("match switch reset clears queued telemetry, match identity, and runtime counters", async () => {
  const shadowServer = createShadowServer();
  const backendServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")) {
      res.end(JSON.stringify({ matchStatus: "LIVE" }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/observer/telemetry") {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "temporary-outage" }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const shadowAddress = await listen(shadowServer);
  const backendAddress = await listen(backendServer);
  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
  });

  try {
    await bridge.start({
      apiBase: `http://127.0.0.1:${backendAddress.port}`,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-a",
      sessionId: "session-a",
    });

    await waitFor(() => {
      const status = bridge.getStatus();
      return status.queueSize > 0 && status.matchId === "match-a" ? status : null;
    });

    const reset = bridge.resetForMatchSwitch();
    assert.equal(reset.running, false);
    assert.equal(reset.matchId, null);
    assert.equal(reset.sessionId, null);
    assert.equal(reset.queueSize, 0);
    assert.equal(reset.totalPackets, 0);
    assert.equal(reset.telemetryAccepted, false);
    assert.equal(reset.matchStatus, null);
  } finally {
    bridge.stop("stopped");
    await Promise.all([close(shadowServer), close(backendServer)]);
  }
});

test("finished control status blocks bridge start", async () => {
  const shadowServer = createShadowServer();
  const backendServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")) {
      res.end(
        JSON.stringify({
          matchStatus: "FINISHED",
          isLocked: true,
          resultFinalized: true,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const shadowAddress = await listen(shadowServer);
  const backendAddress = await listen(backendServer);
  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
  });

  try {
    await assert.rejects(
      () =>
        bridge.start({
          apiBase: `http://127.0.0.1:${backendAddress.port}`,
          token: "token",
          refreshToken: "refresh",
          matchId: "match-finished",
          sessionId: "session-finished",
        }),
      /FINISHED/,
    );

    const status = bridge.getStatus();
    assert.equal(status.running, false);
    assert.equal(status.connectionStatus, "finished");
    assert.equal(status.isLocked, true);
    assert.equal(status.resultFinalized, true);
    assert.equal(status.queueSize, 0);
  } finally {
    bridge.stop("stopped");
    await Promise.all([close(shadowServer), close(backendServer)]);
  }
});

test("finished transport response stops bridge and clears queued telemetry", async () => {
  const backendState = { postCount: 0 };
  const shadowServer = createShadowServer();
  const backendServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && /^\/me\/matches\/[^/]+\/control$/.test(req.url || "")) {
      res.end(JSON.stringify({ matchStatus: "LIVE" }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/observer/telemetry") {
      backendState.postCount += 1;
      if (backendState.postCount === 1) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "temporary-outage" }));
        return;
      }

      res.end(
        JSON.stringify({
          ignored: true,
          reason: "MATCH_ENDED",
          matchStatus: "FINISHED",
          isLocked: true,
          resultFinalized: true,
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const shadowAddress = await listen(shadowServer);
  const backendAddress = await listen(backendServer);
  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
  });

  try {
    await bridge.start({
      apiBase: `http://127.0.0.1:${backendAddress.port}`,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-finish-response",
      sessionId: "session-finish-response",
    });

    const finished = await waitFor(() => {
      const status = bridge.getStatus();
      return backendState.postCount >= 2 && status.connectionStatus === "finished"
        ? status
        : null;
    });

    assert.equal(finished.running, false);
    assert.equal(finished.isLocked, true);
    assert.equal(finished.resultFinalized, true);
    assert.equal(finished.queueSize, 0);
    assert.equal(finished.telemetryAccepted, false);
  } finally {
    bridge.stop("stopped");
    await Promise.all([close(shadowServer), close(backendServer)]);
  }
});
