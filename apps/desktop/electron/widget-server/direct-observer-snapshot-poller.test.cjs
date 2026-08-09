"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  createCirclePayloadSignature,
  createDirectObserverSnapshotPoller,
  fetchObserverCircleSnapshot,
  fetchObserverSnapshot,
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
        res.end(
          JSON.stringify({
            observingPlayer: { "0": "533228770", isAds: true },
          }),
        );
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

    // Requests already accepted by the OS before AbortController cancellation
    // may still reach the local test server. Let that bounded in-flight batch
    // drain, then prove the stopped intervals do not start another batch.
    await sleep(75);
    const requestsAtStop = requests.length;
    await sleep(100);
    assert.equal(requests.length, requestsAtStop);
    assert.equal(snapshots[0].source, "direct-observer");
    assert.deepEqual(snapshots[0].observer, {
      "0": "533228770",
      isAds: true,
    });
  } finally {
    await poller.stop();
    await close(observerServer);
  }
});

test("direct observer poller reset discards in-flight match data", async () => {
  const fullSnapshots = [];
  const zoneSnapshots = [];
  const heldResponses = { all: null, circle: null };
  let enabled = true;
  let holdFirstGeneration = true;
  const observerServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/getallinfo") {
      if (holdFirstGeneration && !heldResponses.all) {
        heldResponses.all = res;
        return;
      }
      res.end(JSON.stringify({ allInfo: { mapName: "ERANGEL" } }));
      return;
    }
    if (req.url === "/getcircleinfo") {
      if (holdFirstGeneration && !heldResponses.circle) {
        heldResponses.circle = res;
        return;
      }
      res.end(
        JSON.stringify({
          mapName: "ERANGEL",
          phase: 1,
          CircleStatus: "1",
          Counter: 1,
          MaxTime: 60,
          safeZone: { x: 400000, y: 400000, r: 100000 },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });
  const address = await listen(observerServer);
  const poller = createDirectObserverSnapshotPoller({
    observerBaseUrl: `http://127.0.0.1:${address.port}`,
    pollIntervalMs: 20,
    circlePollIntervalMs: 20,
    isEnabled: () => enabled,
    isCircleEnabled: () => enabled,
    onSnapshot: (snapshot) => fullSnapshots.push(snapshot),
    onZoneSnapshot: (snapshot) => zoneSnapshots.push(snapshot),
    log: () => {},
  });

  try {
    poller.start();
    await waitFor(() => heldResponses.all && heldResponses.circle);
    enabled = false;
    poller.reset();
    holdFirstGeneration = false;
    heldResponses.all.end(JSON.stringify({ allInfo: { mapName: "OLD_MAP" } }));
    heldResponses.circle.end(
      JSON.stringify({
        mapName: "OLD_MAP",
        phase: 7,
        CircleStatus: "2",
        Counter: 59,
        MaxTime: 60,
        safeZone: { x: 1, y: 1, r: 1 },
      }),
    );
    await sleep(75);
    assert.equal(fullSnapshots.length, 0);
    assert.equal(zoneSnapshots.length, 0);

    enabled = true;
    await waitFor(() => fullSnapshots.length > 0 && zoneSnapshots.length > 0);
    assert.equal(fullSnapshots[0].allInfo.mapName, "ERANGEL");
    assert.equal(zoneSnapshots[0].circlePayload.mapName, "ERANGEL");
  } finally {
    await poller.stop();
    await close(observerServer);
  }
});

test("direct observer poller emits circle changes before a slow full snapshot completes", async () => {
  const fullSnapshots = [];
  const zoneSnapshots = [];
  const observerServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/getallinfo") {
      setTimeout(() => {
        res.end(JSON.stringify({ allInfo: { mapName: "ERANGEL" } }));
      }, 300);
      return;
    }
    if (req.url === "/getcircleinfo") {
      res.end(
        JSON.stringify({
          mapName: "ERANGEL",
          phase: 4,
          CircleStatus: "2",
          Counter: 40,
          MaxTime: 60,
          safeZone: { x: 400000, y: 400000, r: 100000 },
          nextZone: { x: 420000, y: 410000, r: 50000 },
          updatedAt: new Date().toISOString(),
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const address = await listen(observerServer);
  const startedAt = Date.now();
  const poller = createDirectObserverSnapshotPoller({
    observerBaseUrl: `http://127.0.0.1:${address.port}`,
    pollIntervalMs: 500,
    circlePollIntervalMs: 25,
    isEnabled: () => true,
    onSnapshot: (snapshot) => fullSnapshots.push(snapshot),
    onZoneSnapshot: (snapshot) => zoneSnapshots.push({
      snapshot,
      receivedAt: Date.now(),
    }),
    log: () => {},
  });

  try {
    poller.start();
    const firstZone = await waitFor(() => zoneSnapshots[0]);
    assert.ok(firstZone.receivedAt - startedAt < 200);
    assert.equal(firstZone.snapshot.circlePayload.Counter, 40);
    assert.equal(fullSnapshots.length, 0);
  } finally {
    await poller.stop();
    await close(observerServer);
  }
});

test("circle signature ignores transport timestamps but tracks countdown changes", () => {
  const base = {
    mapName: "ERANGEL",
    phase: 4,
    CircleStatus: "2",
    Counter: 40,
    MaxTime: 60,
    safeZone: { x: 400000, y: 400000, r: 100000 },
    nextZone: { x: 420000, y: 410000, r: 50000 },
  };

  assert.equal(
    createCirclePayloadSignature({
      ...base,
      updatedAt: "2026-07-26T20:00:00.000Z",
      nextShrinkAt: "2026-07-26T20:00:20.000Z",
    }),
    createCirclePayloadSignature({
      ...base,
      updatedAt: "2026-07-26T20:00:00.150Z",
      nextShrinkAt: "2026-07-26T20:00:20.150Z",
    }),
  );
  assert.notEqual(
    createCirclePayloadSignature(base),
    createCirclePayloadSignature({
      ...base,
      Counter: 41,
    }),
  );
});

test("fast circle polling replaces only an explicitly tagged runtime fallback map", async () => {
  let responsePayload = {};
  const observerServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/getcircleinfo") {
      res.end(JSON.stringify(responsePayload));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });
  const address = await listen(observerServer);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    responsePayload = {
      mapName: "erangel",
      mapNameSource: "runtime-fallback",
      fallbackMapKey: "erangel",
      GameTime: 10,
    };
    const replaced = await fetchObserverCircleSnapshot(
      baseUrl,
      "miramar",
    );
    assert.equal(replaced.circlePayload.mapName, "miramar");
    assert.equal(replaced.circlePayload.mapNameSource, "runtime-fallback");
    assert.equal(replaced.circlePayload.fallbackMapKey, "miramar");

    responsePayload = {
      mapName: "SANHOK",
      mapNameSource: "pcob",
      GameTime: 10,
    };
    const pcob = await fetchObserverCircleSnapshot(baseUrl, "rondo");
    assert.equal(pcob.circlePayload.mapName, "SANHOK");
    assert.equal(pcob.circlePayload.mapNameSource, "pcob");

    responsePayload = { MapName: "VIKENDI", GameTime: 10 };
    const legacy = await fetchObserverCircleSnapshot(baseUrl, "taego");
    assert.equal(legacy.circlePayload.MapName, "VIKENDI");
    assert.equal(legacy.circlePayload.mapName, undefined);
    assert.equal(legacy.circlePayload.mapNameSource, undefined);

    responsePayload = { GameTime: 10 };
    const missing = await fetchObserverCircleSnapshot(baseUrl, "deston");
    assert.equal(missing.circlePayload.mapName, "deston");
    assert.equal(missing.circlePayload.mapNameSource, "runtime-fallback");
  } finally {
    await close(observerServer);
  }
});

test("full polling replaces tagged fallback maps without overriding PCOB or legacy maps", async () => {
  let mapName = "erangel";
  let mapNameSource = "runtime-fallback";
  const observerServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const mapPayload = {
      mapName,
      ...(mapNameSource ? { mapNameSource } : {}),
    };
    if (req.url === "/getallinfo") {
      res.end(JSON.stringify({ allInfo: mapPayload }));
      return;
    }
    if (req.url === "/getcircleinfo") {
      res.end(JSON.stringify({ ...mapPayload, GameTime: 10 }));
      return;
    }
    if (req.url === "/getobserversnapshot") {
      res.end(JSON.stringify(mapPayload));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });
  const address = await listen(observerServer);
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const replaced = await fetchObserverSnapshot(baseUrl, "miramar");
    assert.equal(replaced.allInfo.mapName, "miramar");
    assert.equal(replaced.circlePayload.mapName, "miramar");
    assert.equal(replaced.observerSnapshot.mapName, "miramar");
    assert.equal(replaced.allInfo.mapNameSource, "runtime-fallback");

    mapName = "SANHOK";
    mapNameSource = "pcob";
    const pcob = await fetchObserverSnapshot(baseUrl, "rondo");
    assert.equal(pcob.allInfo.mapName, "SANHOK");
    assert.equal(pcob.circlePayload.mapName, "SANHOK");
    assert.equal(pcob.observerSnapshot.mapName, "SANHOK");

    mapName = "ERANGEL";
    mapNameSource = null;
    const legacy = await fetchObserverSnapshot(baseUrl, "taego");
    assert.equal(legacy.allInfo.mapName, "ERANGEL");
    assert.equal(legacy.circlePayload.mapName, "ERANGEL");
    assert.equal(legacy.observerSnapshot.mapName, "ERANGEL");
  } finally {
    await close(observerServer);
  }
});

test("observer snapshot PCOB map outranks forced fallback injected into earlier records", async () => {
  const observerServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/getallinfo") {
      res.end(JSON.stringify({ allInfo: {} }));
      return;
    }
    if (req.url === "/getcircleinfo") {
      res.end(JSON.stringify({ GameTime: 10 }));
      return;
    }
    if (req.url === "/getobserversnapshot") {
      res.end(
        JSON.stringify({
          mapName: "MIRAMAR",
          mapNameSource: "pcob",
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });
  const address = await listen(observerServer);

  try {
    const snapshot = await fetchObserverSnapshot(
      `http://127.0.0.1:${address.port}`,
      "erangel",
    );
    assert.equal(snapshot.allInfo.mapName, "MIRAMAR");
    assert.equal(snapshot.allInfo.mapNameSource, "pcob");
    assert.equal(snapshot.circlePayload.mapName, "MIRAMAR");
    assert.equal(snapshot.circlePayload.mapNameSource, "pcob");
    assert.equal(snapshot.observerSnapshot.mapName, "MIRAMAR");
  } finally {
    await close(observerServer);
  }
});

test("full observer snapshot merges recorded PCOB circle geometry with timer-only fast data", async () => {
  const observerServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/getallinfo") {
      res.end(JSON.stringify({ allInfo: { mapName: "ERANGEL" } }));
      return;
    }
    if (req.url === "/getobserversnapshot") {
      res.end(
        JSON.stringify({
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
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });
  const address = await listen(observerServer);

  try {
    const snapshot = await fetchObserverSnapshot(
      `http://127.0.0.1:${address.port}`,
      null,
      null,
      {
        circlePayload: {
          mapName: "ERANGEL",
          GameTime: "82",
          CircleStatus: "1",
          CircleIndex: "0",
          Counter: "82",
          MaxTime: "0",
        },
      },
    );

    assert.deepEqual(snapshot.circlePayload.safeZone, {
      x: 603216.5,
      y: 278990.8125,
      r: 229068,
    });
    assert.equal(snapshot.circlePayload.Counter, "82");
    assert.equal(snapshot.circlePayload.MaxTime, "0");
  } finally {
    await close(observerServer);
  }
});

test("full snapshots are marked handled when they reuse the fast circle payload", async () => {
  const snapshots = [];
  let circleCounter = 12;
  const observerServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    switch (req.url) {
      case "/getallinfo":
        res.end(JSON.stringify({ allInfo: { mapName: "ERANGEL" } }));
        return;
      case "/getcircleinfo":
        res.end(
          JSON.stringify({
            mapName: "ERANGEL",
            phase: 2,
            CircleStatus: "2",
            Counter: circleCounter,
            MaxTime: 60,
            safeZone: { x: 400000, y: 400000, r: 100000 },
            nextZone: { x: 420000, y: 410000, r: 50000 },
          }),
        );
        return;
      default:
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not-found" }));
    }
  });

  const address = await listen(observerServer);
  const poller = createDirectObserverSnapshotPoller({
    observerBaseUrl: `http://127.0.0.1:${address.port}`,
    pollIntervalMs: 40,
    circlePollIntervalMs: 20,
    isEnabled: () => true,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onZoneSnapshot: () => {},
    log: () => {},
  });

  try {
    poller.start();
    const snapshot = await waitFor(
      () => snapshots.find((entry) => entry.zoneHandledByFastLane === true),
    );
    assert.equal(snapshot.circlePayload.Counter, circleCounter);
  } finally {
    circleCounter += 1;
    await poller.stop();
    await close(observerServer);
  }
});

test("circle lane remains active while the duplicate full poller is disabled", async () => {
  const requests = [];
  const zoneSnapshots = [];
  const circlePayload = {
    mapName: "ERANGEL",
    phase: 3,
    CircleStatus: "2",
    Counter: 30,
    MaxTime: 50,
    safeZone: { x: 400000, y: 400000, r: 100000 },
    nextZone: { x: 420000, y: 410000, r: 50000 },
  };
  const observerServer = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/getcircleinfo") {
      res.end(JSON.stringify(circlePayload));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const address = await listen(observerServer);
  const poller = createDirectObserverSnapshotPoller({
    observerBaseUrl: `http://127.0.0.1:${address.port}`,
    pollIntervalMs: 20,
    circlePollIntervalMs: 20,
    isEnabled: () => false,
    isCircleEnabled: () => true,
    onSnapshot: () => {
      throw new Error("full poller must remain disabled");
    },
    onZoneSnapshot: (snapshot) => zoneSnapshots.push(snapshot),
    log: () => {},
  });

  try {
    poller.start();
    await waitFor(() => zoneSnapshots.length === 1);
    assert.equal(requests.includes("/getallinfo"), false);
    assert.equal(poller.hasHandledCirclePayload(circlePayload), true);
  } finally {
    await poller.stop();
    await close(observerServer);
  }
});
