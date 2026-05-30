"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { createTelemetryBridge } = require("./telemetryBridge.cjs");
const { startWidgetsServer } = require("./widget-server/server.cjs");

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

function readJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
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

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createLoggerStub() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

async function startWidgetRuntime() {
  const port = await getFreePort();
  const teamAssetsRoot = makeTempDir("arenzyra-gate-teams-");
  const playerAssetsRoot = makeTempDir("arenzyra-gate-players-");
  const server = startWidgetsServer({
    port,
    host: "127.0.0.1",
    assetsRoot: path.resolve(__dirname, "assets"),
    teamAssetsRoot,
    playerAssetsRoot,
    enableDebugRoutes: false,
    enableOperatorRoutes: false,
    shouldPollDirectObserver: () => false,
    logger: createLoggerStub(),
  });
  await server.whenReady();
  return {
    server,
    teamAssetsRoot,
    playerAssetsRoot,
  };
}

async function stopWidgetRuntime(runtime) {
  if (!runtime) {
    return;
  }
  await runtime.server.stop();
  fs.rmSync(runtime.teamAssetsRoot, { recursive: true, force: true });
  fs.rmSync(runtime.playerAssetsRoot, { recursive: true, force: true });
}

function createShadowServer() {
  const state = {
    players: [
      {
        playerId: "a-player-1",
        playerName: "A One",
        teamId: "team-1",
        teamNo: 1,
        x: 200000,
        y: 300000,
        isAlive: true,
      },
      {
        playerId: "a-player-2",
        playerName: "A Two",
        teamId: "team-2",
        teamNo: 2,
        x: 300000,
        y: 350000,
        isAlive: true,
      },
    ],
    teams: [
      {
        teamId: "team-1",
        teamName: "Alpha",
        teamNo: 1,
        liveMemberNum: 1,
        memberNum: 1,
      },
      {
        teamId: "team-2",
        teamName: "Bravo",
        teamNo: 2,
        liveMemberNum: 1,
        memberNum: 1,
      },
    ],
  };

  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    switch (req.url) {
      case "/getallinfo":
        res.end(JSON.stringify({ allInfo: { mapName: "ERANGEL" } }));
        return;
      case "/gettotalplayerlist":
        res.end(JSON.stringify({ playerInfoList: state.players }));
        return;
      case "/getteaminfolist":
        res.end(JSON.stringify({ teamInfoList: state.teams }));
        return;
      case "/getkillinfo":
        res.end(JSON.stringify({ killInfo: [] }));
        return;
      case "/getcircleinfo":
        res.end(
          JSON.stringify({
            circleInfo: {
              mapName: "ERANGEL",
              GameTime: 180,
              CircleIndex: 3,
              CircleStatus: "SHRINKING",
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
        writeJson(res, 404, { error: "not-found" });
    }
  });

  return { server, state };
}

function createBackendServer() {
  const state = {
    matches: {
      "match-a": {
        status: "DRAFT",
        sessionId: null,
        resultFinalized: false,
      },
      "match-b": {
        status: "DRAFT",
        sessionId: null,
        resultFinalized: false,
      },
    },
    failNextTelemetryForMatchA: true,
    finishNextTelemetryForMatchA: false,
    telemetryPosts: [],
  };

  const controlPayload = (matchId) => {
    const match = state.matches[matchId];
    const status = match?.status ?? "DRAFT";
    return {
      matchId,
      matchStatus: status,
      isLocked: status === "FINISHED",
      isFinalizing: status === "FINISH_PENDING" || status === "ENDED",
      resultFinalized: match?.resultFinalized === true,
    };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const controlMatch = url.pathname.match(/^\/me\/matches\/([^/]+)\/control$/);
    if (req.method === "GET" && controlMatch) {
      const matchId = decodeURIComponent(controlMatch[1]);
      if (!state.matches[matchId]) {
        writeJson(res, 404, { error: "match-not-found" });
        return;
      }
      writeJson(res, 200, controlPayload(matchId));
      return;
    }

    const startMatch = url.pathname.match(/^\/me\/matches\/([^/]+)\/control\/start$/);
    if (req.method === "POST" && startMatch) {
      const matchId = decodeURIComponent(startMatch[1]);
      const body = await readJson(req);
      const match = state.matches[matchId];
      if (!match) {
        writeJson(res, 404, { error: "match-not-found" });
        return;
      }
      if (match.status === "FINISHED") {
        writeJson(res, 409, { code: "MATCH_FINISHED" });
        return;
      }
      match.status = "LIVE";
      match.sessionId = body.sessionId || null;
      match.resultFinalized = false;
      writeJson(res, 200, controlPayload(matchId));
      return;
    }

    const resultsPatch = url.pathname.match(
      /^\/me\/matches\/([^/]+)\/results\/team\/([^/]+)\/players$/,
    );
    if (req.method === "PATCH" && resultsPatch) {
      const matchId = decodeURIComponent(resultsPatch[1]);
      const match = state.matches[matchId];
      if (match?.status === "FINISHED") {
        writeJson(res, 409, {
          code: "RESULTS_LOCKED",
          message: "Results are locked for this match.",
        });
        return;
      }
      writeJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/observer/telemetry") {
      const body = await readJson(req);
      state.telemetryPosts.push(body);
      const matchId = body.matchId;
      const match = state.matches[matchId];
      if (!match || match.status !== "LIVE") {
        writeJson(res, 200, {
          ok: true,
          ignored: true,
          reason: "MATCH_NOT_LIVE",
          matchId,
        });
        return;
      }
      if (matchId === "match-a" && state.failNextTelemetryForMatchA) {
        state.failNextTelemetryForMatchA = false;
        writeJson(res, 503, { error: "temporary-outage" });
        return;
      }
      if (matchId === "match-a" && state.finishNextTelemetryForMatchA) {
        match.status = "FINISHED";
        match.resultFinalized = true;
        state.finishNextTelemetryForMatchA = false;
        writeJson(res, 200, {
          ok: true,
          ignored: true,
          reason: "MATCH_ENDED",
          matchId,
          matchStatus: "FINISHED",
          isLocked: true,
          resultFinalized: true,
        });
        return;
      }
      writeJson(res, 200, {
        ok: true,
        matchId,
        matchStatus: "LIVE",
        telemetryAccepted: true,
      });
      return;
    }

    writeJson(res, 404, { error: "not-found" });
  });

  return { server, state };
}

async function postJson(baseUrl, pathName, payload) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("release gate: match A finalizes, launcher freezes, widget resets, match B starts clean", async () => {
  const shadow = createShadowServer();
  const backend = createBackendServer();
  const shadowAddress = await listen(shadow.server);
  const backendAddress = await listen(backend.server);
  const backendBaseUrl = `http://127.0.0.1:${backendAddress.port}`;
  const widgetRuntime = await startWidgetRuntime();
  const bridge = createTelemetryBridge({
    log: () => {},
    shadowBaseUrl: `http://127.0.0.1:${shadowAddress.port}`,
    onSnapshot: (snapshot) => widgetRuntime.server.ingestTelemetrySnapshot(snapshot),
  });

  try {
    const matchAStart = await postJson(
      backendBaseUrl,
      "/me/matches/match-a/control/start",
      { sessionId: "session-a" },
    );
    assert.equal(matchAStart.status, 200);
    assert.equal(matchAStart.body.matchStatus, "LIVE");

    await bridge.start({
      apiBase: backendBaseUrl,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-a",
      sessionId: "session-a",
    });

    await waitFor(() => {
      const status = bridge.getStatus();
      return status.queueSize > 0 ? status : null;
    });

    await waitFor(() => {
      const accepted = backend.state.telemetryPosts.filter(
        (entry) => entry.matchId === "match-a",
      ).length;
      const status = bridge.getStatus();
      return accepted >= 2 && status.queueSize === 0 ? status : null;
    });
    assert.ok(widgetRuntime.server.engine.getStatus().latestPlayerUpdate);

    backend.state.finishNextTelemetryForMatchA = true;
    const frozen = await waitFor(() => {
      const status = bridge.getStatus();
      return status.connectionStatus === "finished" ? status : null;
    }, 12_000);
    assert.equal(frozen.running, false);
    assert.equal(frozen.isLocked, true);
    assert.equal(frozen.resultFinalized, true);
    assert.equal(frozen.queueSize, 0);

    widgetRuntime.server.clearRuntimeState({ reason: "finished" });
    const widgetStatus = widgetRuntime.server.engine.getStatus();
    assert.equal(widgetStatus.latestZoneUpdate, null);
    assert.equal(widgetStatus.latestPlayerUpdate, null);

    const postFinishMutation = await fetch(
      `${backendBaseUrl}/me/matches/match-a/results/team/team-1/players`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ players: [] }),
      },
    );
    assert.equal(postFinishMutation.status, 409);

    const reset = bridge.resetForMatchSwitch();
    assert.equal(reset.matchId, null);
    assert.equal(reset.sessionId, null);
    assert.equal(reset.queueSize, 0);

    const matchBStart = await postJson(
      backendBaseUrl,
      "/me/matches/match-b/control/start",
      { sessionId: "session-b" },
    );
    assert.equal(matchBStart.status, 200);
    assert.equal(matchBStart.body.matchStatus, "LIVE");

    await bridge.start({
      apiBase: backendBaseUrl,
      token: "token",
      refreshToken: "refresh",
      matchId: "match-b",
      sessionId: "session-b",
    });

    await waitFor(() => {
      const matchBPosts = backend.state.telemetryPosts.filter(
        (entry) => entry.matchId === "match-b",
      );
      const status = bridge.getStatus();
      return matchBPosts.length >= 1 && status.matchId === "match-b"
        ? { matchBPosts, status }
        : null;
    });

    const firstMatchBPost = backend.state.telemetryPosts.find(
      (entry) => entry.matchId === "match-b",
    );
    const matchBStatus = bridge.getStatus();
    assert.equal(firstMatchBPost.sessionId, "session-b");
    assert.equal(firstMatchBPost.sequence, 1);
    assert.equal(matchBStatus.matchId, "match-b");
    assert.equal(matchBStatus.sessionId, "session-b");
    assert.equal(matchBStatus.matchStatus, "LIVE");
    assert.equal(matchBStatus.queueSize, 0);
  } finally {
    bridge.stop("stopped");
    await stopWidgetRuntime(widgetRuntime);
    await Promise.all([close(shadow.server), close(backend.server)]);
  }
});
