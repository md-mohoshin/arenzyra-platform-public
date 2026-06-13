"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  createDirectObserverSnapshotPoller,
} = require("./direct-observer-snapshot-poller.cjs");

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

async function waitFor(predicate, timeoutMs = 5_000, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) {
      return result;
    }
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for condition.");
}

test("direct observer poller stop prevents direct-mode runtime polling", async () => {
  const requests = [];
  const snapshots = [];
  const observerServer = http.createServer((req, res) => {
    requests.push(req.url);
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
                teamNo: 1,
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
                teamNo: 1,
                teamName: "Alpha",
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

  const address = await listen(observerServer);
  const poller = createDirectObserverSnapshotPoller({
    observerBaseUrl: `http://127.0.0.1:${address.port}`,
    pollIntervalMs: 25,
    isEnabled: () => true,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    log: () => {},
  });

  try {
    poller.start();
    await waitFor(() => snapshots.length >= 1);
    await poller.stop();

    const requestsAtStop = requests.length;
    await sleep(100);
    assert.equal(requests.length, requestsAtStop);
    assert.equal(snapshots[0].source, "direct-observer");
  } finally {
    await poller.stop();
    await close(observerServer);
  }
});
