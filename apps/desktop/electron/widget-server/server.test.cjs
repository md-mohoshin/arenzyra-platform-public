"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { startWidgetsServer } = require("./server.cjs");

function createLoggerStub() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function startJsonServer(handler) {
  const port = await getFreePort();
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: error?.message || String(error) }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function startServer(enableOperatorRoutes, options = {}) {
  const port = await getFreePort();
  const assetsRoot = path.resolve(__dirname, "../assets");
  const teamAssetsRoot = makeTempDir("arenzyra-widget-teams-");
  const playerAssetsRoot = makeTempDir("arenzyra-widget-players-");
  const server = startWidgetsServer({
    port,
    host: "127.0.0.1",
    assetsRoot,
    teamAssetsRoot,
    playerAssetsRoot,
    enableDebugRoutes: false,
    enableOperatorRoutes,
    shouldPollDirectObserver: () => false,
    resolveApiBase: options.resolveApiBase,
    getObserverBaseUrl: options.getObserverBaseUrl,
    getCurrentMatchContext: options.getCurrentMatchContext,
    requestPlayerPhotoRefresh: options.requestPlayerPhotoRefresh,
    logger: createLoggerStub(),
  });

  await server.whenReady();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    teamAssetsRoot,
    playerAssetsRoot,
  };
}

async function stopServer(instance) {
  if (!instance) {
    return;
  }

  await instance.server.stop();
  fs.rmSync(instance.teamAssetsRoot, { recursive: true, force: true });
  fs.rmSync(instance.playerAssetsRoot, { recursive: true, force: true });
}

test("widget mutation routes are disabled at the HTTP boundary when operator routes are off", async () => {
  const instance = await startServer(false);

  try {
    const response = await fetch(`${instance.baseUrl}/debug/operator/watch-now?id=player-1`);
    assert.equal(response.status, 404);
  } finally {
    await stopServer(instance);
  }
});

test("widget mutation routes remain available when operator routes are explicitly enabled", async () => {
  const instance = await startServer(true);

  try {
    const response = await fetch(`${instance.baseUrl}/debug/operator/watch-now?id=player-1`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.action, "watch-now");
    assert.equal(payload.id, "player-1");
  } finally {
    await stopServer(instance);
  }
});

test("widget runtime reset clears server-owned map runtime state", async () => {
  const instance = await startServer(false);

  try {
    instance.server.engine.applyZoneUpdate({
      mapKey: "erangel",
      phase: 3,
      centerX: 200000,
      centerY: 300000,
      radius: 50000,
      timestamp: Date.now(),
      source: "telemetry-bridge",
    });
    instance.server.engine.applyPlayerPositionUpdate({
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
      source: "telemetry-bridge",
    });

    assert.ok(instance.server.engine.getStatus().latestZoneUpdate);
    assert.ok(instance.server.engine.getStatus().latestPlayerUpdate);

    instance.server.clearRuntimeState({ reason: "finished" });

    const status = instance.server.engine.getStatus();
    const snapshot = instance.server.engine.getSnapshot("erangel");
    assert.equal(status.latestZoneUpdate, null);
    assert.equal(status.latestPlayerUpdate, null);
    assert.equal(snapshot.zone, null);
    assert.equal(snapshot.players, null);
  } finally {
    await stopServer(instance);
  }
});

test("player photo assets and state are served without browser caching", async () => {
  const instance = await startServer(false);

  try {
    fs.writeFileSync(path.join(instance.playerAssetsRoot, "player-1.png"), "png");
    fs.writeFileSync(path.join(instance.playerAssetsRoot, "player-2.webp"), "webp");

    const staticResponse = await fetch(
      `${instance.baseUrl}/assets/players/player-1.png`,
    );
    assert.equal(staticResponse.status, 200);
    assert.match(staticResponse.headers.get("cache-control") ?? "", /no-store/);

    const fallbackResponse = await fetch(
      `${instance.baseUrl}/assets/players/player-2.png`,
    );
    assert.equal(fallbackResponse.status, 200);
    assert.match(
      fallbackResponse.headers.get("cache-control") ?? "",
      /no-store/,
    );

    const stateResponse = await fetch(`${instance.baseUrl}/obs/player-photo/state`);
    assert.equal(stateResponse.status, 200);
    assert.match(stateResponse.headers.get("cache-control") ?? "", /no-store/);
    const statePayload = await stateResponse.json();
    assert.equal(typeof statePayload.playerAssetsVersion, "string");
  } finally {
    await stopServer(instance);
  }
});

test("player photo state polling does not refresh the photo cache", async () => {
  const api = await startJsonServer((req, res) => {
    if (req.url === "/api/observer/match/match-1/widget-state") {
      sendJson(res, 200, {
        matchId: "match-1",
        leaderboard: [],
        playerCard: null,
        circle: null,
      });
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  });
  const refreshCalls = [];
  const instance = await startServer(false, {
    resolveApiBase: () => api.baseUrl,
    getCurrentMatchContext: () => ({
      matchId: "match-1",
      workflowState: "MATCH_LIVE",
    }),
    requestPlayerPhotoRefresh: (matchId) => refreshCalls.push(matchId),
  });

  try {
    const stateResponse = await fetch(`${instance.baseUrl}/obs/player-photo/state`);
    assert.equal(stateResponse.status, 200);
    assert.deepEqual(refreshCalls, []);

    const pageResponse = await fetch(`${instance.baseUrl}/obs/player-photo`);
    assert.equal(pageResponse.status, 200);
    assert.deepEqual(refreshCalls, ["match-1"]);
  } finally {
    await stopServer(instance);
    await api.close();
  }
});

test("player photo focus route returns local observer focus without backend state", async () => {
  const observer = await startJsonServer((req, res) => {
    if (req.url === "/getobservingplayer") {
      sendJson(res, 200, {
        observingPlayer: {
          playerName: "Alpha",
          uId: "pubg-alpha",
          teamNo: 7,
        },
      });
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  });
  const instance = await startServer(false, {
    getObserverBaseUrl: () => observer.baseUrl,
    getCurrentMatchContext: () => ({
      matchId: "match-1",
      workflowState: "MATCH_LIVE",
    }),
  });

  try {
    const response = await fetch(`${instance.baseUrl}/obs/player-photo/focus`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const payload = await response.json();
    assert.equal(payload.matchId, "match-1");
    assert.equal(payload.focus.pubgPlayerId, "pubg-alpha");
    assert.equal(payload.focus.playerName, "Alpha");
    assert.equal(payload.focus.slot, "7");
  } finally {
    await stopServer(instance);
    await observer.close();
  }
});

test("player photo state prefers local observer focus and keeps uploaded roster photo", async () => {
  const api = await startJsonServer((req, res) => {
    if (req.url === "/api/observer/match/match-1/widget-state") {
      sendJson(res, 200, {
        matchId: "match-1",
        updatedAt: "2026-04-29T20:00:00.000Z",
        teamsAlive: 1,
        leaderboard: [
          {
            rank: 1,
            teamId: "team-duplicate",
            teamName: "Duplicate Team",
            teamTag: "DT",
            logoUrl: null,
            color: null,
            kills: 0,
            alivePlayers: 1,
            totalPlayers: 1,
            placement: null,
            isEliminated: false,
            players: [
              {
                playerId: "player-duplicate",
                playerName: "Alpha",
                avatarUrl: "/assets/defaults/default-player.png",
                kills: 0,
                alive: true,
                knocked: false,
                health: null,
                hasDied: false,
                lifeTelemetryFresh: true,
              },
            ],
          },
          {
            rank: 2,
            teamId: "team-1",
            teamName: "Alpha Team",
            teamTag: "AT",
            logoUrl: null,
            color: null,
            kills: 0,
            alivePlayers: 1,
            totalPlayers: 1,
            placement: null,
            isEliminated: false,
            players: [
              {
                playerId: "player-alpha",
                pubgPlayerId: "pubg-alpha",
                playerName: "Alpha",
                avatarUrl: "https://api.example.test/media/players/player-alpha/photo?v=2",
                kills: 3,
                alive: true,
                knocked: false,
                health: null,
                hasDied: false,
                lifeTelemetryFresh: true,
              },
            ],
          },
        ],
        playerCard: {
          playerId: "player-default",
          name: "Default Player",
          avatarUrl: "/assets/defaults/default-player.png",
          teamId: "team-2",
          teamName: "Default Team",
          teamTag: "DT",
          logoUrl: null,
          color: null,
          kills: 0,
          alive: true,
          damage: null,
        },
        killFeed: [],
        circle: null,
        winner: null,
      });
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  });
  const observer = await startJsonServer((req, res) => {
    if (req.url === "/getobservingplayer") {
      sendJson(res, 200, {
        observingPlayer: {
          playerOpenId: "open-alpha",
          0: "pubg-alpha",
          playerName: "Alpha",
        },
      });
      return;
    }
    sendJson(res, 404, { error: "not-found" });
  });
  const instance = await startServer(false, {
    resolveApiBase: () => api.baseUrl,
    getObserverBaseUrl: () => observer.baseUrl,
    getCurrentMatchContext: () => ({
      matchId: "match-1",
      workflowState: "MATCH_LIVE",
    }),
  });

  try {
    const response = await fetch(`${instance.baseUrl}/obs/player-photo/state`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.observerState.playerCard.playerId, "player-alpha");
    assert.equal(payload.observerState.playerCard.name, "Alpha");
    assert.equal(
      payload.observerState.playerCard.avatarUrl,
      "https://api.example.test/media/players/player-alpha/photo?v=2",
    );
  } finally {
    await stopServer(instance);
    await observer.close();
    await api.close();
  }
});
