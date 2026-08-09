"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const repoRoot = path.resolve(__dirname, "..");
const connectorToken = "pcob-test-dedicated-connector-token";
const defaultRuntimeNonce = "pcob-test-runtime-nonce";

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "arenzyra-pcob-test-"));
}

function removeTempDirectory(directory) {
  const resolved = path.resolve(directory);
  const expectedParent = path.resolve(os.tmpdir());
  if (
    path.dirname(resolved) !== expectedParent ||
    !path.basename(resolved).startsWith("arenzyra-pcob-test-")
  ) {
    throw new Error(`Refusing to remove unexpected test directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  server.close();
  await once(server, "close");
  return port;
}

function request(port, target, options = {}) {
  const body = Buffer.isBuffer(options.body)
    ? options.body
    : options.body === undefined
      ? null
      : Buffer.from(String(options.body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: target,
        method: options.method || "GET",
        headers: {
          ...(body ? { "Content-Length": String(body.length) } : {}),
          ...((options.method || "GET") === "GET" && options.auth !== false
            ? { "X-Arenzyra-Connector-Token": connectorToken }
            : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(responseBody.toString("utf8"));
          } catch {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: responseBody,
            json,
          });
        });
      },
    );
    req.once("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function postJson(port, target, value) {
  return request(port, target, {
    method: "POST",
    body: Buffer.from(JSON.stringify(value)),
    headers: { "Content-Type": "application/json" },
  });
}

async function waitFor(predicate, timeoutMs = 10_000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError || new Error("Timed out waiting for condition");
}

async function startConnector(options) {
  const port = options.port || (await freePort());
  const child = spawn(process.execPath, [path.join(repoRoot, "ob.js")], {
    cwd: repoRoot,
    windowsHide: true,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      FORWARD_ENABLE: "false",
      OBSERVER_FORWARD_ENABLE: options.backendBaseUrl ? "true" : "false",
      API_BASE_URL: options.backendBaseUrl || "http://127.0.0.1:9",
      MATCH_ID: options.matchId || "pcob-test-match",
      OBSERVER_SESSION_ID: options.sessionId || "pcob-test-session",
      OBSERVER_FEED_TOKEN: "",
      PCOB_EVENT_SPOOL_DIR: options.spoolBase,
      PCOB_EVENT_SPOOL_MAX_BYTES: String(256 * 1024 * 1024),
      PCOB_EVENT_SPOOL_RETENTION_MS: "60000",
      PCOB_MAX_BODY_BYTES: String(16 * 1024 * 1024),
      PCOB_RAW_EVENT_ENCODED_MAX_BYTES: String(6 * 1024 * 1024),
      PCOB_RAW_EVENT_BATCH_MAX_BYTES: String(7 * 1024 * 1024),
      PCOB_RAW_EVENT_CAPTURE_ENABLE: "true",
      ARENZYRA_PCOB_CONNECTOR_TOKEN: connectorToken,
      ARENZYRA_OBSERVER_RUNTIME_NONCE:
        options.runtimeNonce || defaultRuntimeNonce,
      PCOB_OUT_OF_GAME_RESET_DEBOUNCE_MS: "250",
      PCOB_TEST_CONTROL_ENABLE: "true",
      OBTOOLS_VERBOSE_LOG: "false",
      ...(options.extraEnv || {}),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.output = () => ({ stdout, stderr });

  try {
    await waitFor(async () => {
      const response = await request(port, "/health");
      return response.status === 200 && response.json;
    }, 10_000);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(
      `Connector failed to start: ${error.message}\nstdout=${stdout}\nstderr=${stderr}`,
    );
  }
  return { child, port };
}

async function stopConnector(connector) {
  if (!connector?.child || connector.child.exitCode !== null) {
    return;
  }
  if (connector.child.connected) {
    try {
      connector.child.send({ type: "arenzyra.pcob-test-shutdown.v1" });
      const graceful = await Promise.race([
        once(connector.child, "exit").then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
      ]);
      if (graceful) {
        return;
      }
    } catch {}
  }
  connector.child.kill("SIGTERM");
  await Promise.race([
    once(connector.child, "exit"),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Connector did not stop")), 5_000),
    ),
  ]);
}

function protectedGet(port, target) {
  return request(port, target, {
    headers: { "X-Arenzyra-Connector-Token": connectorToken },
  });
}

function runtimeControlPost(port, target, value, options = {}) {
  return request(port, target, {
    method: "POST",
    body: Buffer.from(JSON.stringify(value)),
    headers: {
      "Content-Type": "application/json",
      "X-Arenzyra-Connector-Token":
        options.connectorToken ?? connectorToken,
      "X-Arenzyra-Runtime-Nonce":
        options.runtimeNonce ?? defaultRuntimeNonce,
    },
  });
}

async function startBackend(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let payload = null;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {}
      handler(payload, req, res);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

function acknowledgeEnvelope(envelope, overrides = {}) {
  return {
    schema: "arenzyra.pcobRawEventsAck.v1",
    streamId: envelope.streamId,
    highestContiguousSequence: envelope.lastSequence,
    accepted: envelope.events.length,
    duplicates: 0,
    ...overrides,
  };
}

function respondJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
}

function spoolDirectories(baseDirectory) {
  return fs
    .readdirSync(baseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(baseDirectory, entry.name));
}

test(
  "keeps unbound local widgets live without creating an undeliverable raw spool",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    removeTempDirectory(spoolBase);
    let connector = null;
    try {
      connector = await startConnector({
        spoolBase,
        extraEnv: {
          MATCH_ID: "",
          OBSERVER_MATCH_ID: "",
          PCOB_MATCH_ID: "",
          OBSERVER_SESSION_ID: "",
          SESSION_ID: "",
        },
      });
      const response = await postJson(connector.port, "/totalmessage", {
        GameID: "unbound-local-game",
        TotalPlayerList: [{ playerName: "Local player" }],
        TeamInfoList: [{ teamName: "Local team" }],
      });
      assert.equal(response.status, 200);
      assert.equal(response.json.ok, true);
      assert.equal(response.json.eventId, undefined);

      const snapshot = await waitFor(async () => {
        const current = await request(connector.port, "/getobserversnapshot");
        return current.json?.gameId === "unbound-local-game"
          ? current.json
          : null;
      });
      assert.deepEqual(
        snapshot.playerInfoList.map((player) => player.playerName),
        ["Local player"],
      );
      const health = await request(connector.port, "/health");
      assert.equal(health.json.rawEvents.enabled, false);
      assert.equal(health.json.rawEvents.pendingEvents, 0);
      assert.equal(fs.existsSync(spoolBase), false);
    } finally {
      await stopConnector(connector);
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "captures exact no-content-type bytes, unknown routes, unsafe IDs, rapid kills, and safe game reset",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    let connector = null;
    try {
      connector = await startConnector({ spoolBase });
      const exactBody = Buffer.from(
        '{"RoomID":2379307503868300123,"FutureMystery":9007199254740993,"safe":9007199254740991}',
      );
      const accepted = await request(
        connector.port,
        "/setfutureendpoint?x=one%20two&x=2",
        {
          method: "POST",
          body: exactBody,
          headers: { "X-Pcob-Version": "future-1" },
        },
      );
      assert.equal(accepted.status, 200);
      assert.equal(accepted.json.sequence, 1);

      assert.equal(
        (
          await request(connector.port, "/getpcobevents", {
            auth: false,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(connector.port, "/getpcobevents", {
            headers: {
              "X-Arenzyra-Connector-Token": connectorToken,
              Origin: "https://untrusted.example",
            },
          })
        ).status,
        403,
      );

      const page = await protectedGet(
        connector.port,
        "/getpcobevents?afterSequence=0&limit=10&includeRaw=1",
      );
      assert.equal(page.status, 200);
      assert.equal(page.json.events.length, 1);
      const event = page.json.events[0];
      assert.equal(event.endpoint, "/setfutureendpoint");
      assert.equal(
        event.requestTarget,
        "/setfutureendpoint?x=one%20two&x=2",
      );
      assert.equal(event.query, "x=one%20two&x=2");
      assert.equal(event.contentType, null);
      assert.equal(event.rawBodyBase64, exactBody.toString("base64"));
      assert.equal(
        event.bodySha256,
        crypto.createHash("sha256").update(exactBody).digest("hex"),
      );
      assert.equal(event.payload.RoomID, "2379307503868300123");
      assert.equal(event.payload.FutureMystery, "9007199254740993");
      assert.equal(event.payload.safe, Number.MAX_SAFE_INTEGER);

      await Promise.all([
        postJson(connector.port, "/SETKILLINFO?Encoded=%2FCase", {
          CauserName: "One",
          VictimName: "A",
        }),
        postJson(connector.port, "/setkillinfo", {
          CauserName: "Two",
          VictimName: "B",
        }),
      ]);
      const rapidKills = await waitFor(async () => {
        const snapshot = await request(connector.port, "/getobserversnapshot");
        return snapshot.json?.killInfo?.length === 2 ? snapshot.json : null;
      });
      assert.deepEqual(
        new Set(rapidKills.killInfo.map((kill) => kill.CauserName)),
        new Set(["One", "Two"]),
      );

      await postJson(connector.port, "/totalmessage", {
        GameID: "game-old",
        TotalPlayerList: [{ playerName: "Old player" }],
        TeamInfoList: [{ teamName: "Old team" }],
      });
      await postJson(connector.port, "/setisingame", {});
      const beforeTransition = await request(connector.port, "/getobserversnapshot");
      assert.equal(beforeTransition.json.gameId, "game-old");
      assert.equal(beforeTransition.json.killInfo.length, 2);

      await postJson(connector.port, "/totalmessage", {
        GameID: "game-new",
        TotalPlayerList: [{ playerName: "New player" }],
        TeamInfoList: [{ teamName: "New team" }],
      });
      const afterTransition = await waitFor(async () => {
        const snapshot = await request(connector.port, "/getobserversnapshot");
        return snapshot.json?.gameId === "game-new" ? snapshot.json : null;
      });
      assert.deepEqual(afterTransition.killInfo, []);
      assert.deepEqual(
        afterTransition.playerInfoList.map((player) => player.playerName),
        ["New player"],
      );
      assert.equal(afterTransition.lifecycle.lastResetReason, "game_id_transition");

      await postJson(connector.port, "/setisingame", { isInGame: false });
      const afterExplicitOut = await waitFor(async () => {
        const snapshot = await request(connector.port, "/getobserversnapshot");
        return snapshot.json?.lifecycle?.lastResetReason === "explicit_out_of_game"
          ? snapshot.json
          : null;
      }, 3_000);
      assert.deepEqual(afterExplicitOut.playerInfoList, []);
      assert.equal(afterExplicitOut.isInGame, false);
    } finally {
      await stopConnector(connector);
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "retries the same ordered kill batch and follows a successful drain with legacy telemetry",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    const received = [];
    const backend = await startBackend((payload, req, res) => {
      received.push(payload);
      if (received.length === 1) {
        respondJson(res, 500, { error: "temporary" });
        return;
      }
      respondJson(
        res,
        200,
        payload.rawEvents
          ? { rawEventsAck: acknowledgeEnvelope(payload.rawEvents) }
          : { ok: true },
      );
    });
    let connector = null;
    try {
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
      });
      await postJson(connector.port, "/settotalplayerlist", {
        playerInfoList: [{ playerName: "Persistent player" }],
      });
      await Promise.all([
        postJson(connector.port, "/SETKILLINFO?Encoded=%2FCase", {
          CauserName: "Rapid one",
          VictimName: "A",
        }),
        postJson(connector.port, "/setkillinfo", {
          CauserName: "Rapid two",
          VictimName: "B",
        }),
      ]);
      await waitFor(() => received.length >= 3, 12_000);
      const firstEvents = received[0].rawEvents.events;
      const retriedEvents = received[1].rawEvents.events;
      assert.deepEqual(
        firstEvents.map((event) => event.sequence),
        [1, 2, 3],
      );
      assert.deepEqual(
        retriedEvents.map((event) => event.eventId),
        firstEvents.map((event) => event.eventId),
      );
      assert.deepEqual(
        firstEvents.map((event) => event.endpoint),
        ["/settotalplayerlist", "/setkillinfo", "/setkillinfo"],
      );
      assert.equal(
        firstEvents[1].requestTarget,
        "/SETKILLINFO?Encoded=%2FCase",
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(received[2], "rawEvents"),
        false,
      );
      assert.equal(received[2].players[0].playerName, "Persistent player");
      const metrics = await waitFor(async () => {
        const response = await protectedGet(
          connector.port,
          "/debug/pcob-event-metrics",
        );
        return response.json?.rawEvents?.pendingEvents === 0
          ? response.json.rawEvents
          : null;
      });
      assert.ok(metrics.counters.deliveryFailures >= 1);
      assert.ok(metrics.counters.deliverySuccesses >= 1);
      assert.equal(metrics.drops.unacknowledged, 0);
    } finally {
      await stopConnector(connector);
      if (backend.server.listening) {
        backend.server.close();
        await once(backend.server, "close");
      }
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "retains kill and raw-event data across both transport timeouts until durable ACK",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    const received = [];
    const backend = await startBackend((payload, req, res) => {
      received.push(payload);
      if (received.length <= 2) {
        setTimeout(() => {
          if (!res.writableEnded) {
            respondJson(res, 200, {
              rawEventsAck: acknowledgeEnvelope(payload.rawEvents),
            });
          }
        }, 600);
        return;
      }
      respondJson(res, 200, {
        rawEventsAck: acknowledgeEnvelope(payload.rawEvents),
      });
    });
    let connector = null;
    try {
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
        extraEnv: { OBSERVER_TELEMETRY_TIMEOUT_MS: "250" },
      });
      await postJson(connector.port, "/settotalplayerlist", {
        playerInfoList: [{ playerName: "Timeout survivor" }],
      });
      await postJson(connector.port, "/setkillinfo", {
        CauserName: "Timeout survivor",
        VictimName: "Timeout victim",
      });

      await waitFor(() => received.length >= 3, 12_000);
      const expectedEventIds = received[0].rawEvents.events.map(
        (event) => event.eventId,
      );
      assert.ok(expectedEventIds.length >= 2);
      assert.deepEqual(
        received[1].rawEvents.events.map((event) => event.eventId),
        expectedEventIds,
      );
      assert.deepEqual(
        received[2].rawEvents.events.map((event) => event.eventId),
        expectedEventIds,
      );
      for (const delivery of received.slice(0, 3)) {
        assert.equal(delivery.kills.length, 1);
        assert.equal(delivery.kills[0].CauserName, "Timeout survivor");
      }

      const metrics = await waitFor(async () => {
        const response = await protectedGet(
          connector.port,
          "/debug/pcob-event-metrics",
        );
        return response.json?.rawEvents?.pendingEvents === 0
          ? response.json.rawEvents
          : null;
      });
      assert.ok(metrics.counters.deliveryFailures >= 2);
      assert.ok(metrics.counters.deliverySuccesses >= 1);
      assert.equal(metrics.drops.unacknowledged, 0);
    } finally {
      await stopConnector(connector);
      if (backend.server.listening) {
        backend.server.close();
        await once(backend.server, "close");
      }
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "rejects malformed and no-progress ACKs, retaining the batch until a complete ACK",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    const received = [];
    const backend = await startBackend((payload, req, res) => {
      received.push(payload);
      const envelope = payload.rawEvents;
      if (received.length === 1) {
        respondJson(res, 200, {
          rawEventsAck: acknowledgeEnvelope(envelope, {
            highestContiguousSequence: String(envelope.lastSequence),
            accepted: String(envelope.events.length),
          }),
        });
        return;
      }
      if (received.length === 2) {
        respondJson(res, 200, {
          rawEventsAck: acknowledgeEnvelope(envelope, {
            highestContiguousSequence: 0,
          }),
        });
        return;
      }
      respondJson(res, 200, {
        rawEventsAck: acknowledgeEnvelope(envelope, {
          accepted: 0,
          duplicates: envelope.events.length,
        }),
      });
    });
    let connector = null;
    try {
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
      });
      await postJson(connector.port, "/setreviveplayer", {
        ReviverUID: "one",
        BeRevivedUID: "two",
      });
      await waitFor(() => received.length >= 3, 12_000);
      assert.deepEqual(
        received.slice(0, 3).map((payload) => payload.rawEvents.events[0].eventId),
        Array(3).fill(received[0].rawEvents.events[0].eventId),
      );
      const metrics = await waitFor(async () => {
        const response = await protectedGet(
          connector.port,
          "/debug/pcob-event-metrics",
        );
        return response.json?.rawEvents?.pendingEvents === 0
          ? response.json.rawEvents
          : null;
      });
      assert.ok(metrics.counters.acknowledgementErrors >= 1);
      assert.ok(metrics.counters.noProgressAcknowledgements >= 1);
      assert.equal(metrics.acknowledgedSequence, 1);
    } finally {
      await stopConnector(connector);
      backend.server.close();
      await once(backend.server, "close");
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "accepts an API watermark ahead of a resent batch without reusing sequences",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    const received = [];
    const backend = await startBackend((payload, req, res) => {
      received.push(payload);
      const envelope = payload.rawEvents;
      respondJson(res, 200, {
        rawEventsAck: acknowledgeEnvelope(
          envelope,
          received.length === 1
            ? { highestContiguousSequence: envelope.lastSequence + 5 }
            : {},
        ),
      });
    });
    let connector = null;
    try {
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
      });
      await postJson(connector.port, "/setreviveplayer", {
        ReviverUID: "first",
        BeRevivedUID: "first-target",
      });
      await waitFor(async () => {
        const response = await protectedGet(
          connector.port,
          "/debug/pcob-event-metrics",
        );
        return response.json?.rawEvents?.acknowledgedSequence === 6;
      });

      await postJson(connector.port, "/setreviveplayer", {
        ReviverUID: "second",
        BeRevivedUID: "second-target",
      });
      await waitFor(() => received.length >= 2, 12_000);

      assert.equal(received[0].rawEvents.firstSequence, 1);
      assert.equal(received[1].rawEvents.firstSequence, 7);
      assert.equal(received[1].rawEvents.events[0].sequence, 7);
      const metrics = await protectedGet(
        connector.port,
        "/debug/pcob-event-metrics",
      );
      assert.equal(metrics.json.rawEvents.pendingEvents, 0);
      assert.equal(metrics.json.rawEvents.counters.acknowledgementErrors, 0);
    } finally {
      await stopConnector(connector);
      if (backend.server.listening) {
        backend.server.close();
        await once(backend.server, "close");
      }
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "raw-only split never repeats kill mirrors in its compact or later legacy snapshots",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    const received = [];
    const backend = await startBackend((payload, req, res) => {
      received.push(payload);
      respondJson(
        res,
        200,
        payload.rawEvents
          ? { rawEventsAck: acknowledgeEnvelope(payload.rawEvents) }
          : { ok: true },
      );
    });
    let connector = null;
    try {
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
        extraEnv: {
          PCOB_RAW_EVENT_INLINE_MAX_BYTES: String(16 * 1024),
        },
      });
      await postJson(connector.port, "/settotalplayerlist", {
        playerInfoList: [{ playerName: "Persistent split player" }],
      });
      await postJson(connector.port, "/setkillinfo", {
        CauserName: "Large kill",
        VictimName: "Victim",
        padding: "X".repeat(32 * 1024),
      });

      await waitFor(() => received.length >= 3, 12_000);
      const [rawOnly, compactFollowup, laterLegacy] = received;
      assert.equal(rawOnly.rawEventsOnly, true);
      assert.ok(rawOnly.rawEvents.events.some(
        (event) => event.endpoint === "/setkillinfo",
      ));
      assert.deepEqual(rawOnly.kills, []);

      for (const snapshot of [compactFollowup, laterLegacy]) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(snapshot, "rawEvents"),
          false,
        );
        assert.deepEqual(snapshot.kills, []);
        assert.deepEqual(snapshot.observerSnapshot.killInfo, []);
        assert.deepEqual(snapshot.observerSnapshot.killInfoEntries, []);
        assert.equal(
          snapshot.players[0].playerName,
          "Persistent split player",
        );
      }
    } finally {
      await stopConnector(connector);
      if (backend.server.listening) {
        backend.server.close();
        await once(backend.server, "close");
      }
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "rejects an undeliverable body before sequence allocation so later events are not deadlocked",
  { timeout: 30_000 },
  async () => {
    const spoolBase = tempDirectory();
    let connector = null;
    try {
      connector = await startConnector({ spoolBase });
      const noisyValue = crypto
        .randomBytes(5 * 1024 * 1024)
        .toString("base64");
      const tooLargeForTransport = Buffer.from(
        JSON.stringify({ noise: noisyValue }),
      );
      assert.ok(tooLargeForTransport.length < 16 * 1024 * 1024);
      const rejected = await request(connector.port, "/setfutureblob", {
        method: "POST",
        body: tooLargeForTransport,
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(rejected.status, 413);
      assert.equal(
        rejected.json.error,
        "pcob_event_not_deliverable_within_transport_limits",
      );

      const accepted = await postJson(connector.port, "/setfutureblob", {
        small: true,
      });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.json.sequence, 1);
      const page = await protectedGet(
        connector.port,
        "/getpcobevents?includeRaw=1",
      );
      assert.equal(page.json.events.length, 1);
      assert.equal(page.json.events[0].sequence, 1);
      assert.deepEqual(page.json.events[0].payload, { small: true });
      const metrics = await protectedGet(
        connector.port,
        "/debug/pcob-event-metrics",
      );
      assert.ok(metrics.json.rawEvents.rejected.oversize >= 1);
      assert.equal(metrics.json.rawEvents.blockedEvent, null);
    } finally {
      await stopConnector(connector);
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "recovers only a truncated tail, retries after restart, and blocks a complete sequence gap",
  { timeout: 30_000 },
  async () => {
    const spoolBase = tempDirectory();
    let connector = null;
    let backend = null;
    try {
      connector = await startConnector({ spoolBase });
      const first = await postJson(connector.port, "/setplayerweapondetailinfo", {
        RoomID: "2379307503868300123",
      });
      assert.equal(first.json.sequence, 1);
      const firstEventId = first.json.eventId;
      await stopConnector(connector);
      connector = null;

      const [spoolDirectory] = spoolDirectories(spoolBase);
      const journalPath = path.join(spoolDirectory, "events.ndjson");
      fs.appendFileSync(journalPath, '{"schema":"torn');

      const delivered = [];
      backend = await startBackend((payload, req, res) => {
        delivered.push(payload);
        respondJson(res, 200, {
          rawEventsAck: acknowledgeEnvelope(payload.rawEvents),
        });
      });
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
      });
      await waitFor(() => delivered.length >= 1, 12_000);
      assert.equal(delivered[0].rawEvents.events[0].eventId, firstEventId);
      const recoveredMetrics = await protectedGet(
        connector.port,
        "/debug/pcob-event-metrics",
      );
      assert.equal(recoveredMetrics.json.rawEvents.status, "ok");
      assert.ok(
        recoveredMetrics.json.rawEvents.counters.recoveredTrailingBytes > 0,
      );

      const second = await postJson(connector.port, "/setplayersaminfo", {
        RoomID: "2379307503868300123",
      });
      assert.equal(second.json.sequence, 2);
      await waitFor(async () => {
        const metrics = await protectedGet(
          connector.port,
          "/debug/pcob-event-metrics",
        );
        return metrics.json?.rawEvents?.acknowledgedSequence === 2;
      }, 12_000);
      const acknowledgedLines = fs
        .readFileSync(journalPath, "utf8")
        .trim()
        .split(/\r?\n/);
      const gapEvent = JSON.parse(acknowledgedLines[acknowledgedLines.length - 1]);
      gapEvent.sequence = 4;
      gapEvent.eventId = crypto
        .createHash("sha256")
        .update(
          `${gapEvent.streamId}\n4\n${gapEvent.receivedAt}\n${gapEvent.method}\n${gapEvent.requestTarget}\n${gapEvent.bodySha256}`,
        )
        .digest("hex");
      await stopConnector(connector);
      connector = null;
      backend.server.close();
      await once(backend.server, "close");
      backend = null;

      fs.appendFileSync(journalPath, `${JSON.stringify(gapEvent)}\n`);

      connector = await startConnector({ spoolBase });
      const degraded = await request(connector.port, "/health");
      assert.equal(degraded.json.rawEventStatus, "degraded");
      const refused = await postJson(connector.port, "/setkillinfo", {
        VictimName: "must-not-ack",
      });
      assert.equal(refused.status, 503);
    } finally {
      await stopConnector(connector);
      if (backend) {
        backend.server.close();
        await once(backend.server, "close");
      }
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "keeps event identity stable when transport compression changes across restart",
  { timeout: 25_000 },
  async () => {
    const spoolBase = tempDirectory();
    const exactBody = Buffer.from(
      JSON.stringify({ blob: "A".repeat(128 * 1024) }),
    );
    const firstDeliveries = [];
    let backend = await startBackend((payload, req, res) => {
      firstDeliveries.push(payload);
      respondJson(res, 200, {
        rawEventsAck: acknowledgeEnvelope(payload.rawEvents, {
          highestContiguousSequence: 0,
        }),
      });
    });
    let connector = null;
    try {
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
        extraEnv: {
          PCOB_RAW_EVENT_GZIP_THRESHOLD_BYTES: String(2 * 1024 * 1024),
        },
      });
      await request(connector.port, "/setlargecompressible", {
        method: "POST",
        body: exactBody,
        headers: { "Content-Type": "application/json" },
      });
      await waitFor(() => firstDeliveries.length >= 1, 12_000);
      const firstEvent = firstDeliveries[0].rawEvents.events[0];
      assert.equal(firstEvent.rawBodyEncoding, "identity");
      assert.equal(
        Buffer.from(firstEvent.rawBodyBase64, "base64").equals(exactBody),
        true,
      );
      await waitFor(async () => {
        const response = await protectedGet(
          connector.port,
          "/debug/pcob-event-metrics",
        );
        return response.json?.rawEvents?.counters?.noProgressAcknowledgements >= 1;
      });
      await stopConnector(connector);
      connector = null;
      backend.server.close();
      await once(backend.server, "close");

      const restartedDeliveries = [];
      backend = await startBackend((payload, req, res) => {
        restartedDeliveries.push(payload);
        respondJson(res, 200, {
          rawEventsAck: acknowledgeEnvelope(payload.rawEvents),
        });
      });
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
        extraEnv: {
          PCOB_RAW_EVENT_GZIP_THRESHOLD_BYTES: "1024",
        },
      });
      await waitFor(() => restartedDeliveries.length >= 1, 12_000);
      const restartedEvent = restartedDeliveries[0].rawEvents.events[0];
      assert.equal(restartedEvent.eventId, firstEvent.eventId);
      assert.equal(restartedEvent.bodySha256, firstEvent.bodySha256);
      assert.equal(restartedEvent.rawBodyEncoding, "gzip");
      assert.equal(
        zlib
          .gunzipSync(Buffer.from(restartedEvent.rawBodyBase64, "base64"))
          .equals(exactBody),
        true,
      );
    } finally {
      await stopConnector(connector);
      if (backend.server.listening) {
        backend.server.close();
        await once(backend.server, "close");
      }
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "retention cleanup never removes an old spool with unacknowledged events",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    let connector = null;
    try {
      connector = await startConnector({
        spoolBase,
        matchId: "archived-match",
        sessionId: "archived-session",
      });
      await postJson(connector.port, "/setfuturearchivedroute", { retained: true });
      await stopConnector(connector);
      connector = null;

      const [archivedDirectory] = spoolDirectories(spoolBase);
      const metadataPath = path.join(archivedDirectory, "metadata.json");
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      metadata.closedAt = new Date(Date.now() - 120_000).toISOString();
      fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

      connector = await startConnector({
        spoolBase,
        matchId: "active-match",
        sessionId: "active-session",
      });
      assert.equal(fs.existsSync(archivedDirectory), true);
      const metrics = await protectedGet(
        connector.port,
        "/debug/pcob-event-metrics",
      );
      assert.ok(metrics.json.rawEvents.inactiveSpoolDirectories >= 1);
      assert.ok(metrics.json.rawEvents.archiveCleanup.skippedDirectories >= 1);
    } finally {
      await stopConnector(connector);
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "authenticated exact-runtime shutdown compacts acknowledged events and closes the spool",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    let connector = null;
    let backend = null;
    try {
      backend = await startBackend((payload, req, res) => {
        respondJson(res, 200, {
          rawEventsAck: acknowledgeEnvelope(payload.rawEvents),
        });
      });
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
        matchId: "close-compaction-match",
        sessionId: "close-compaction-session",
        runtimeNonce: "close-compaction-runtime",
        extraEnv: { PCOB_TEST_CONTROL_ENABLE: "false" },
      });
      const accepted = await postJson(connector.port, "/setclosecompaction", {
        acknowledged: true,
      });
      assert.equal(accepted.status, 200);
      await waitFor(async () => {
        const metrics = await protectedGet(
          connector.port,
          "/debug/pcob-event-metrics",
        );
        return metrics.json?.rawEvents?.acknowledgedSequence === 1;
      }, 12_000);

      const unauthenticatedShutdown = await request(
        connector.port,
        "/debug/observer/shutdown",
        {
          method: "POST",
          headers: {
            "X-Arenzyra-Runtime-Nonce": "close-compaction-runtime",
          },
        },
      );
      assert.equal(unauthenticatedShutdown.status, 401);

      const foreignRuntimeShutdown = await request(
        connector.port,
        "/debug/observer/shutdown",
        {
          method: "POST",
          headers: {
            "X-Arenzyra-Connector-Token": connectorToken,
            "X-Arenzyra-Runtime-Nonce": "foreign-runtime",
          },
        },
      );
      assert.equal(foreignRuntimeShutdown.status, 409);
      assert.equal((await request(connector.port, "/health")).status, 200);

      const exitPromise = once(connector.child, "exit");
      const gracefulShutdown = await request(
        connector.port,
        "/debug/observer/shutdown",
        {
          method: "POST",
          headers: {
            "X-Arenzyra-Connector-Token": connectorToken,
            "X-Arenzyra-Runtime-Nonce": "close-compaction-runtime",
          },
        },
      );
      assert.equal(gracefulShutdown.status, 202);
      assert.equal(gracefulShutdown.json?.ok, true);
      await Promise.race([
        exitPromise,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Connector did not exit after shutdown")),
            5_000,
          ),
        ),
      ]);

      const [archivedDirectory] = spoolDirectories(spoolBase);
      const journalPath = path.join(archivedDirectory, "events.ndjson");
      const metadata = JSON.parse(
        fs.readFileSync(path.join(archivedDirectory, "metadata.json"), "utf8"),
      );
      assert.equal(fs.statSync(journalPath).size, 0);
      assert.equal(metadata.acknowledgedSequence, 1);
      assert.equal(metadata.nextSequence, 2);
      assert.ok(metadata.closedAt);
      assert.ok(metadata.counters.compactions >= 1);
      assert.ok(metadata.counters.compactedEvents >= 1);
    } finally {
      await stopConnector(connector);
      if (backend?.server?.listening) {
        backend.server.close();
        await once(backend.server, "close");
      }
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "authenticated runtime map fallback hot-updates while PCOB map data stays authoritative",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    let connector = null;
    try {
      connector = await startConnector({
        spoolBase,
        matchId: "runtime-map-match",
        sessionId: "runtime-map-session",
        extraEnv: { ARENZYRA_FORCE_MAP_KEY: "ERANGEL" },
      });

      const initialSnapshot = await request(
        connector.port,
        "/getobserversnapshot",
      );
      assert.equal(initialSnapshot.status, 200);
      assert.equal(initialSnapshot.json?.mapName, "ERANGEL");
      assert.equal(initialSnapshot.json?.mapNameSource, "runtime-fallback");
      assert.equal(initialSnapshot.json?.mapSelection?.mapKey, "erangel");
      assert.equal(initialSnapshot.json?.allInfo?.mapName, "ERANGEL");

      const unauthenticated = await request(
        connector.port,
        "/debug/observer/map-fallback",
        {
          method: "POST",
          body: Buffer.from(JSON.stringify({ mapKey: "miramar" })),
          headers: {
            "Content-Type": "application/json",
            "X-Arenzyra-Runtime-Nonce": defaultRuntimeNonce,
          },
        },
      );
      assert.equal(unauthenticated.status, 401);

      const foreignRuntime = await runtimeControlPost(
        connector.port,
        "/debug/observer/map-fallback",
        { mapKey: "miramar" },
        { runtimeNonce: "foreign-runtime" },
      );
      assert.equal(foreignRuntime.status, 409);

      const nonCanonical = await runtimeControlPost(
        connector.port,
        "/debug/observer/map-fallback",
        { mapKey: "MIRAMAR" },
      );
      assert.equal(nonCanonical.status, 400);
      assert.equal(nonCanonical.json?.error, "runtime_map_key_invalid");

      const oversizedKey = await runtimeControlPost(
        connector.port,
        "/debug/observer/map-fallback",
        { mapKey: "a".repeat(33) },
      );
      assert.equal(oversizedKey.status, 400);

      const updated = await runtimeControlPost(
        connector.port,
        "/debug/observer/map-fallback",
        { mapKey: "miramar" },
      );
      assert.equal(updated.status, 200);
      assert.equal(updated.json?.fallbackMapKey, "miramar");
      assert.equal(updated.json?.effectiveMapName, "MIRAMAR");
      assert.equal(updated.json?.effectiveMapSource, "runtime-fallback");

      const fallbackSnapshot = await request(
        connector.port,
        "/getobserversnapshot",
      );
      assert.equal(fallbackSnapshot.json?.mapName, "MIRAMAR");
      assert.equal(fallbackSnapshot.json?.mapNameSource, "runtime-fallback");
      assert.equal(fallbackSnapshot.json?.allInfo?.mapName, "MIRAMAR");
      const fallbackCircle = await request(connector.port, "/getcircleinfo");
      assert.equal(fallbackCircle.json?.mapName, "MIRAMAR");
      assert.equal(fallbackCircle.json?.mapNameSource, "runtime-fallback");
      const fallbackOverlay = await request(
        connector.port,
        "/widget/map-overlay",
      );
      assert.equal(fallbackOverlay.json?.map?.mapName, "MIRAMAR");

      const pcobAccepted = await postJson(connector.port, "/totalmessage", {
        GameID: "runtime-map-game",
        MapName: "SANHOK",
        TotalPlayerList: [],
        TeamInfoList: [],
      });
      assert.equal(pcobAccepted.status, 200);
      const pcobSnapshot = await waitFor(async () => {
        const candidate = await request(connector.port, "/getobserversnapshot");
        return candidate.json?.mapNameSource === "pcob" ? candidate.json : null;
      });
      assert.equal(pcobSnapshot.mapName, "SANHOK");

      const fallbackChangedUnderPcob = await runtimeControlPost(
        connector.port,
        "/debug/observer/map-fallback",
        { mapKey: "rondo" },
      );
      assert.equal(fallbackChangedUnderPcob.status, 200);
      assert.equal(fallbackChangedUnderPcob.json?.fallbackMapKey, "rondo");
      assert.equal(fallbackChangedUnderPcob.json?.effectiveMapName, "SANHOK");
      assert.equal(fallbackChangedUnderPcob.json?.effectiveMapSource, "pcob");

      const authoritativeSnapshot = await request(
        connector.port,
        "/getobserversnapshot",
      );
      assert.equal(authoritativeSnapshot.json?.mapName, "SANHOK");
      assert.equal(authoritativeSnapshot.json?.mapNameSource, "pcob");
      assert.equal(authoritativeSnapshot.json?.mapSelection?.fallbackMapKey, "rondo");
      assert.equal(authoritativeSnapshot.json?.allInfo?.mapName, "SANHOK");
      const authoritativeOverlay = await request(
        connector.port,
        "/widget/map-overlay",
      );
      assert.equal(authoritativeOverlay.json?.map?.mapName, "SANHOK");
    } finally {
      await stopConnector(connector);
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "base pressure removes only a fully acknowledged recent archive and preserves unacknowledged data",
  { timeout: 35_000 },
  async () => {
    const spoolBase = tempDirectory();
    const largeBody = Buffer.from(
      JSON.stringify({ blob: "A".repeat(1_550_000) }),
    );
    let connector = null;
    let backend = null;
    let acknowledgedDirectory = null;
    let unacknowledgedDirectory = null;
    try {
      backend = await startBackend((payload, req, res) => {
        respondJson(res, 200, {
          rawEventsAck: acknowledgeEnvelope(payload.rawEvents),
        });
      });
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
        matchId: "pressure-acknowledged-match",
        sessionId: "pressure-acknowledged-session",
      });
      const acknowledgedPost = await request(
        connector.port,
        "/setpressureacknowledged",
        {
          method: "POST",
          body: largeBody,
          headers: {
            "Content-Type": "application/json",
            "X-Arenzyra-Connector-Token": connectorToken,
          },
        },
      );
      assert.equal(acknowledgedPost.status, 200);
      await waitFor(async () => {
        const metrics = await protectedGet(
          connector.port,
          "/debug/pcob-event-metrics",
        );
        return metrics.json?.rawEvents?.acknowledgedSequence === 1;
      }, 12_000);
      [acknowledgedDirectory] = spoolDirectories(spoolBase);
      const acknowledgedJournalPath = path.join(
        acknowledgedDirectory,
        "events.ndjson",
      );
      const acknowledgedJournal = fs.readFileSync(acknowledgedJournalPath);
      assert.ok(acknowledgedJournal.length > 1_900_000);
      await stopConnector(connector);
      connector = null;
      fs.writeFileSync(acknowledgedJournalPath, acknowledgedJournal);
      backend.server.close();
      await once(backend.server, "close");
      backend = null;

      connector = await startConnector({
        spoolBase,
        matchId: "pressure-unacknowledged-match",
        sessionId: "pressure-unacknowledged-session",
      });
      const unacknowledgedPost = await request(
        connector.port,
        "/setpressureunacknowledged",
        {
          method: "POST",
          body: largeBody,
          headers: {
            "Content-Type": "application/json",
            "X-Arenzyra-Connector-Token": connectorToken,
          },
        },
      );
      assert.equal(unacknowledgedPost.status, 200);
      await stopConnector(connector);
      connector = null;
      unacknowledgedDirectory = spoolDirectories(spoolBase).find(
        (directory) => directory !== acknowledgedDirectory,
      );
      assert.ok(unacknowledgedDirectory);
      assert.ok(
        fs.statSync(path.join(unacknowledgedDirectory, "events.ndjson")).size >
          1_900_000,
      );

      connector = await startConnector({
        spoolBase,
        matchId: "pressure-active-match",
        sessionId: "pressure-active-session",
        extraEnv: {
          PCOB_EVENT_SPOOL_MAX_BYTES: String(4 * 1024 * 1024),
        },
      });
      assert.equal(fs.existsSync(acknowledgedDirectory), true);
      assert.equal(fs.existsSync(unacknowledgedDirectory), true);
      const acceptedAfterCleanup = await request(
        connector.port,
        "/setpressurecleanup",
        {
          method: "POST",
          body: Buffer.from(JSON.stringify({ retained: true })),
          headers: {
            "Content-Type": "application/json",
            "X-Arenzyra-Connector-Token": connectorToken,
          },
        },
      );
      assert.equal(acceptedAfterCleanup.status, 200);
      assert.equal(fs.existsSync(acknowledgedDirectory), false);
      assert.equal(fs.existsSync(unacknowledgedDirectory), true);
      const metrics = await protectedGet(
        connector.port,
        "/debug/pcob-event-metrics",
      );
      assert.ok(
        metrics.json.rawEvents.archiveCleanup.pressureRemovedDirectories >= 1,
      );
      assert.ok(metrics.json.rawEvents.archiveCleanup.pressureRemovedBytes > 0);
      assert.equal(metrics.json.rawEvents.inactiveSpoolDirectories, 1);
      assert.equal(metrics.json.rawEvents.rejected.full, 0);
    } finally {
      await stopConnector(connector);
      if (backend?.server?.listening) {
        backend.server.close();
        await once(backend.server, "close");
      }
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "spool backpressure stays explicit while local live widgets continue updating",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    const protectedArchiveBody = Buffer.from(
      JSON.stringify({ blob: "P".repeat(3_300_000) }),
    );
    let connector = null;
    let backend = null;
    const forwarded = [];
    try {
      connector = await startConnector({
        spoolBase,
        matchId: "protected-archive-match",
        sessionId: "protected-archive-session",
      });
      const protectedArchivePost = await request(
        connector.port,
        "/setprotectedarchive",
        {
          method: "POST",
          body: protectedArchiveBody,
          headers: {
            "Content-Type": "application/json",
            "X-Arenzyra-Connector-Token": connectorToken,
          },
        },
      );
      assert.equal(protectedArchivePost.status, 200);
      await stopConnector(connector);
      connector = null;

      const [protectedArchiveDirectory] = spoolDirectories(spoolBase);
      assert.ok(protectedArchiveDirectory);
      assert.ok(
        fs.statSync(path.join(protectedArchiveDirectory, "events.ndjson")).size >
          4 * 1024 * 1024,
      );

      backend = await startBackend((payload, req, res) => {
        forwarded.push(payload);
        respondJson(res, 200, { ok: true });
      });
      connector = await startConnector({
        spoolBase,
        backendBaseUrl: backend.baseUrl,
        matchId: "live-widget-match",
        sessionId: "live-widget-session",
        extraEnv: {
          PCOB_EVENT_SPOOL_MAX_BYTES: String(4 * 1024 * 1024),
        },
      });
      const rejected = await postJson(connector.port, "/totalmessage", {
        GameID: "live-widget-game",
        MapName: "SAVAGE_MAIN",
        TotalPlayerList: [
          {
            teamId: 4,
            uId: "live-player-1",
            playerName: "Live Player",
            liveState: 0,
            location: { x: 204000, y: 204000 },
          },
        ],
        TeamInfoList: [
          { teamId: 4, teamName: "Live Team", liveMemberNum: 1 },
        ],
      });
      assert.equal(rejected.status, 507);
      assert.deepEqual(rejected.json, {
        ok: false,
        error: "pcob_event_spool_full",
        localProjectionQueued: true,
      });
      const malformedState = await request(
        connector.port,
        "/totalmessage",
        {
          method: "POST",
          body: Buffer.from('{"TotalPlayerList":['),
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      assert.equal(malformedState.status, 507);
      assert.equal(malformedState.json.localProjectionQueued, false);
      const emptyState = await postJson(connector.port, "/totalmessage", {});
      assert.equal(emptyState.status, 507);
      assert.equal(emptyState.json.localProjectionQueued, false);
      const unknownState = await postJson(connector.port, "/setfuturestate", {
        state: "live",
      });
      assert.equal(unknownState.status, 507);
      assert.equal(unknownState.json.localProjectionQueued, false);
      const validLifecycleState = await request(
        connector.port,
        "/setisingame",
        {
          method: "POST",
          body: Buffer.from("InGame"),
          headers: { "Content-Type": "text/plain" },
        },
      );
      assert.equal(validLifecycleState.status, 507);
      assert.equal(validLifecycleState.json.localProjectionQueued, true);
      const invalidLifecycleState = await request(
        connector.port,
        "/setisingame",
        {
          method: "POST",
          body: Buffer.from("not-a-pcob-state"),
          headers: { "Content-Type": "text/plain" },
        },
      );
      assert.equal(invalidLifecycleState.status, 507);
      assert.equal(invalidLifecycleState.json.localProjectionQueued, false);
      const firstRejectedKill = await postJson(
        connector.port,
        "/setkillinfo",
        { CauserName: "Winner", VictimName: "Victim" },
      );
      const duplicateRejectedKill = await postJson(
        connector.port,
        "/setkillinfo",
        { CauserName: "Winner", VictimName: "Victim" },
      );
      assert.equal(firstRejectedKill.status, 507);
      assert.equal(firstRejectedKill.json.localProjectionQueued, false);
      assert.equal(duplicateRejectedKill.status, 507);
      assert.equal(duplicateRejectedKill.json.localProjectionQueued, false);

      const overlay = await waitFor(async () => {
        const candidate = await request(connector.port, "/widget/map-overlay");
        return candidate.status === 200 &&
          candidate.json?.map?.mapName === "SANHOK"
          ? candidate
          : null;
      });
      assert.equal(overlay.json.map.worldSize, 408000);
      const snapshot = await waitFor(async () => {
        const candidate = await request(connector.port, "/getobserversnapshot");
        return Array.isArray(candidate.json?.killInfo) ? candidate.json : null;
      });
      assert.deepEqual(snapshot.killInfo, []);
      assert.equal(snapshot.playerInfoList.length, 1);
      assert.equal(snapshot.playerInfoList[0].playerName, "Live Player");
      assert.equal(snapshot.rawRoutePayloads?.["/setfuturestate"], undefined);
      await waitFor(
        () =>
          forwarded.some(
            (payload) =>
              Array.isArray(payload?.players) &&
              payload.players.some(
                (player) => player?.playerName === "Live Player",
              ),
          ),
        12_000,
      );
      assert.ok(
        forwarded.every(
          (payload) => !Array.isArray(payload?.kills) || payload.kills.length === 0,
        ),
        "rejected transient combat packets must not reach backend snapshots",
      );

      const metrics = await protectedGet(
        connector.port,
        "/debug/pcob-event-metrics",
      );
      assert.equal(metrics.json.rawEvents.rejected.full, 8);
      assert.equal(metrics.json.rawEvents.retainedEvents, 0);
      assert.equal(fs.existsSync(protectedArchiveDirectory), true);
    } finally {
      await stopConnector(connector);
      if (backend?.server?.listening) {
        backend.server.close();
        await once(backend.server, "close");
      }
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "connector keeps the opening Rondo flight path while preserving later recall paths raw",
  { timeout: 20_000 },
  async () => {
    const spoolBase = tempDirectory();
    let connector = null;
    const openingPath = {
      PlaneStartLocX: "919171.437500",
      PlaneStartLocY: "635857.562500",
      PlaneStopLocX: "-162147.937500",
      PlaneStopLocY: "430360.093750",
    };
    const recallPath = {
      PlaneStartLocX: "-151496.031250",
      PlaneStartLocY: "515753.718750",
      PlaneStopLocX: "826383.125000",
      PlaneStopLocY: "27338.406250",
    };
    const normalizedOpeningPath = {
      start: { x: 919171.4375, y: 635857.5625 },
      end: { x: -162147.9375, y: 430360.09375 },
      coordinateSystem: "WORLD",
    };
    const normalizedRecallPath = {
      start: { x: -151496.03125, y: 515753.71875 },
      end: { x: 826383.125, y: 27338.40625 },
      coordinateSystem: "WORLD",
    };

    try {
      connector = await startConnector({
        spoolBase,
        matchId: "rondo-flight-path-match",
        sessionId: "rondo-flight-path-session",
      });
      await postJson(connector.port, "/totalmessage", {
        GameID: "rondo-game-a",
        MapName: "RONDO",
        TotalPlayerList: [],
        TeamInfoList: [],
      });
      await postJson(connector.port, "/setgameglobalinfo", {
        CircleArray: [],
        ...openingPath,
      });
      await postJson(connector.port, "/setgameglobalinfo", {
        CircleArray: [{ x: 408000, y: 408000, r: 200000 }],
        ...recallPath,
      });

      const snapshot = await request(connector.port, "/getobserversnapshot");
      assert.equal(snapshot.status, 200);
      assert.deepEqual(snapshot.json?.normalized?.flightPath, normalizedOpeningPath);
      assert.deepEqual(
        snapshot.json?.routePayloads?.["/setgameglobalinfo"]?.flightPath,
        normalizedOpeningPath,
      );
      assert.equal(
        snapshot.json?.routePayloads?.["/setgameglobalinfo"]?.CircleArray?.length,
        1,
        "later circle geometry must still update",
      );
      assert.equal(snapshot.json?.flightPathDiagnostics?.conflictingUpdateCount, 1);
      assert.deepEqual(
        snapshot.json?.flightPathDiagnostics?.lastConflictingPath,
        normalizedRecallPath,
      );
      assert.equal(
        snapshot.json?.rawRoutePayloads?.["/setgameglobalinfo"]?.payload
          ?.PlaneStartLocX,
        recallPath.PlaneStartLocX,
        "the exact latest PCOB route remains available in raw diagnostics",
      );

      const overlay = await request(connector.port, "/widget/map-overlay");
      assert.equal(overlay.status, 200);
      assert.deepEqual(overlay.json?.flightPath, normalizedOpeningPath);

      await postJson(connector.port, "/totalmessage", {
        GameID: "rondo-game-b",
        MapName: "RONDO",
        TotalPlayerList: [],
        TeamInfoList: [],
      });
      await postJson(connector.port, "/setgameglobalinfo", {
        CircleArray: [],
        ...recallPath,
      });
      const nextMatchSnapshot = await request(
        connector.port,
        "/getobserversnapshot",
      );
      assert.deepEqual(
        nextMatchSnapshot.json?.normalized?.flightPath,
        normalizedRecallPath,
      );
      assert.equal(
        nextMatchSnapshot.json?.flightPathDiagnostics?.conflictingUpdateCount,
        0,
      );
    } finally {
      await stopConnector(connector);
      removeTempDirectory(spoolBase);
    }
  },
);

test(
  "direct map overlay resolves every API and desktop PUBG map alias",
  { timeout: 30_000 },
  async () => {
    const spoolBase = tempDirectory();
    let connector = null;
    const mapAliases = [
      {
        mapName: "ERANGEL",
        worldSize: 816000,
        aliases: ["ERANGEL8X8", "ERANGEL_MAIN", "BALTIC_MAIN", "BALTICMAIN"],
      },
      {
        mapName: "MIRAMAR",
        worldSize: 816000,
        aliases: ["MIRAMAR8X8", "DESERT_MAIN", "DESERTMAIN"],
      },
      {
        mapName: "SANHOK",
        worldSize: 408000,
        aliases: ["SANHOK4X4", "SAVAGE_MAIN", "SAVAGEMAIN"],
      },
      {
        mapName: "VIKENDI",
        worldSize: 612000,
        aliases: ["VIKENDI6X6", "DIHOROTOK_MAIN", "DIHOROTOKMAIN"],
      },
      { mapName: "LIVIK", worldSize: 408000, aliases: ["LIVIK4X4"] },
      {
        mapName: "LIVIK AFTERMATH",
        worldSize: 408000,
        aliases: ["LIVIK_AFTERMATH", "LIVIKAFTERMATH", "AFTERMATH"],
      },
      {
        mapName: "KARAKIN",
        worldSize: 204000,
        aliases: ["KARAKIN2X2", "SUMMERLAND_MAIN", "SUMMERLANDMAIN"],
      },
      { mapName: "NUSA", worldSize: 102000, aliases: ["NUSA1X1"] },
      {
        mapName: "RONDO",
        worldSize: 816000,
        aliases: [
          "RONDO8X8",
          "RONDO_MAIN",
          "RONDOMAIN",
          "NEON_MAIN",
          "NEONMAIN",
        ],
      },
      {
        mapName: "TAEGO",
        worldSize: 816000,
        aliases: ["TAEGO8X8", "TIGER_MAIN", "TIGERMAIN"],
      },
      {
        mapName: "DESTON",
        worldSize: 816000,
        aliases: ["DESTON8X8", "KIKI_MAIN", "KIKIMAIN"],
      },
      {
        mapName: "PARAMO",
        worldSize: 306000,
        aliases: ["PARAMO3X3", "CHIMERA_MAIN", "CHIMERAMAIN"],
      },
      {
        mapName: "HAVEN",
        worldSize: 102000,
        aliases: [
          "HAVEN1X1",
          "HAVENMAIN",
          "HEAVEN_MAIN",
          "HEAVENMAIN",
        ],
      },
    ];
    try {
      connector = await startConnector({
        spoolBase,
        matchId: "map-alias-match",
        sessionId: "map-alias-session",
      });
      let gameIndex = 0;
      for (const config of mapAliases) {
        for (const alias of config.aliases) {
          gameIndex += 1;
          const accepted = await postJson(connector.port, "/totalmessage", {
            GameID: `map-alias-game-${gameIndex}`,
            MapName: alias,
            TotalPlayerList: [],
            TeamInfoList: [],
          });
          assert.equal(accepted.status, 200, alias);
          const overlay = await waitFor(async () => {
            const candidate = await request(connector.port, "/widget/map-overlay");
            return candidate.status === 200 &&
              candidate.json?.map?.mapName === config.mapName
              ? candidate
              : null;
          });
          assert.equal(overlay.status, 200, alias);
          assert.equal(overlay.json?.map?.mapName, config.mapName, alias);
          assert.equal(overlay.json?.map?.worldSize, config.worldSize, alias);
          assert.equal(overlay.json?.map?.coordinateSystem, "WORLD", alias);
        }
      }
    } finally {
      await stopConnector(connector);
      removeTempDirectory(spoolBase);
    }
  },
);
