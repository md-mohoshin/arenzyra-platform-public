const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");

const {
  RAW_EVENTS_ACK_SCHEMA,
  RAW_EVENTS_SCHEMA,
  SnapshotRawEventReconstructor,
  analyzeRecording,
  buildObservedManifest,
  canonicalJson,
  compareObservedManifest,
  comparePathDocuments,
  materializeSyntheticEvent,
  validateRawEventsAck,
} = require("./pcob-recording-schema.cjs");
const {
  parseLoopbackBase,
} = require("./pcob-local-connector-replay.cjs");

const fixtureDir = path.resolve(
  __dirname,
  "test-fixtures",
  "pcob",
  "compact-recording",
);
const manifestPath = path.resolve(__dirname, "pcob-observed-schema.v1.json");

function fixturePackets() {
  return fs
    .readFileSync(path.join(fixtureDir, "packets.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
}

test("streams the compact recording and inventories all 15 observed routes", async () => {
  const analysis = await analyzeRecording(fixtureDir);
  assert.equal(analysis.packetCount, 3);
  assert.equal(analysis.okPacketCount, 3);
  assert.equal(analysis.changedPacketCount, 2);
  assert.deepEqual(analysis.parseErrors, []);
  assert.deepEqual(analysis.indexErrors, []);
  assert.deepEqual(analysis.hashErrors, []);
  assert.deepEqual(analysis.changeFlagErrors, []);
  assert.deepEqual(analysis.metadataErrors, []);
  assert.deepEqual(analysis.rawReducedRouteMismatches, []);
  assert.equal(Object.keys(analysis.routes).length, 15);
  assert.equal(analysis.routes["/setcircleinfo"].observedVersions, 2);
  assert.equal(analysis.routes["/setkillinfo"].observedVersions, 2);
  assert.equal(analysis.reconstructedRawEvents.events, 19);
  assert.equal(
    analysis.reconstructedRawEvents.overwrittenKillEventsRecovered,
    1,
  );
});

test("reconstructed rawEvents are deterministic, ordered, and explicitly synthetic", () => {
  const packets = fixturePackets();
  const first = new SnapshotRawEventReconstructor({ fallbackSeed: "fixture" });
  const firstBatch = first.consume(packets[0]);
  const secondBatch = first.consume(packets[1]);
  const repeatedBatch = first.consume(packets[2]);

  assert.equal(firstBatch.schema, RAW_EVENTS_SCHEMA);
  assert.equal(firstBatch.syntheticFromSnapshot, true);
  assert.deepEqual(
    firstBatch.events.slice(0, 3).map((event) => event.endpoint),
    ["/setcircleinfo", "/setkillinfo", "/setobservingplayer"],
  );
  assert.deepEqual(
    secondBatch.events.map((event) => event.endpoint),
    [
      "/setcircleinfo",
      "/setobservingplayer",
      "/setkillinfo",
      "/setkillinfo",
    ],
  );
  assert.deepEqual(
    secondBatch.events.map((event) => event.sequence),
    [16, 17, 18, 19],
  );
  assert.equal(repeatedBatch, null);

  for (const event of [...firstBatch.events, ...secondBatch.events]) {
    assert.equal(event.syntheticFromSnapshot, true);
    assert.equal(event.method, "POST");
    assert.equal(event.contentType, "application/json");
    assert.equal(event.query, "");
    assert.equal(event.requestTarget, event.endpoint);
    assert.deepEqual(event.headers, {});
    assert.equal(event.rawBodyEncoding, "identity");
    const body = Buffer.from(event.rawBodyBase64, "base64");
    assert.equal(event.rawBodyBytes, body.length);
    assert.equal(body.toString("utf8"), canonicalJson(event.payload));
    assert.equal(
      event.bodySha256,
      crypto.createHash("sha256").update(body).digest("hex"),
    );
    assert.equal(
      event.eventId,
      crypto
        .createHash("sha256")
        .update(
          `${firstBatch.streamId}\n${event.sequence}\n${event.receivedAt}\n${event.method}\n${event.requestTarget}\n${event.bodySha256}`,
        )
        .digest("hex"),
    );
  }

  const second = new SnapshotRawEventReconstructor({ fallbackSeed: "fixture" });
  assert.deepEqual(second.consume(packets[0]), firstBatch);
  assert.deepEqual(second.consume(packets[1]), secondBatch);
});

test("synthetic event identity includes the exact request target and query", () => {
  const event = materializeSyntheticEvent(
    {
      endpoint: "/setkillinfo",
      query: "slot=1&name=A%20B",
      receivedAt: "2026-08-01T10:11:12.345Z",
      payload: { VictimName: "Example" },
    },
    "snapshot:test-stream",
    7,
  );

  assert.equal(event.query, "slot=1&name=A%20B");
  assert.equal(
    event.requestTarget,
    "/setkillinfo?slot=1&name=A%20B",
  );
  assert.equal(
    event.eventId,
    crypto
      .createHash("sha256")
      .update(
        `snapshot:test-stream\n7\n${event.receivedAt}\nPOST\n${event.requestTarget}\n${event.bodySha256}`,
      )
      .digest("hex"),
  );
});

test("kill history recovers an overwritten event without claiming other routes are lossless", () => {
  const packets = fixturePackets();
  const reconstructor = new SnapshotRawEventReconstructor();
  reconstructor.consume(packets[0]);
  const batch = reconstructor.consume(packets[1]);

  const killEvents = batch.events.filter(
    (event) => event.endpoint === "/setkillinfo",
  );
  assert.equal(killEvents.length, 2);
  assert.deepEqual(
    killEvents.map((event) => event.payload.VictimName),
    ["C", "D"],
  );
  assert.equal(reconstructor.stats.killHistoryEvents, 3);
  assert.equal(reconstructor.seenRouteVersions.get("/setkillinfo").size, 2);
});

test("a replay resume can consume prior packets without materializing bodies", () => {
  const packets = fixturePackets();
  const reconstructor = new SnapshotRawEventReconstructor();
  const skipped = reconstructor.consume(packets[0], { materialize: false });
  assert.equal(skipped.firstSequence, 1);
  assert.equal(skipped.lastSequence, 15);
  assert.equal(skipped.events[0].rawBodyBase64, undefined);

  const resumed = reconstructor.consume(packets[1]);
  assert.equal(resumed.firstSequence, 16);
  assert.equal(resumed.lastSequence, 19);
  assert.equal(typeof resumed.events[0].rawBodyBase64, "string");
});

test("schema comparison detects added fields, missing fields, and type regressions", () => {
  const expected = {
    "$": { types: ["object"] },
    "$.value": { types: ["number"] },
  };
  assert.equal(comparePathDocuments(expected, expected).ok, true);

  const added = {
    ...expected,
    "$.unexpected": { types: ["string"] },
  };
  assert.deepEqual(comparePathDocuments(expected, added).unexpected, [
    "$.unexpected",
  ]);
  assert.deepEqual(
    comparePathDocuments(expected, { "$": expected.$ }).missing,
    ["$.value"],
  );
  assert.equal(
    comparePathDocuments(expected, {
      "$": expected.$,
      "$.value": { types: ["string"] },
    }).typeMismatches.length,
    1,
  );
});

test("manifest comparison reports route-field regressions", async () => {
  const analysis = await analyzeRecording(fixtureDir, {
    includeSnapshotSchema: false,
  });
  const expected = buildObservedManifest([analysis], {
    recordingPaths: ["tools/test-fixtures/pcob/compact-recording"],
  });
  const actual = structuredClone(expected);
  actual.routes["/setcircleinfo"].rawPayloadPaths["$.newField"] = {
    types: ["string"],
  };
  const comparison = compareObservedManifest(expected, actual, {
    exact: true,
    compareSnapshot: false,
  });
  assert.equal(comparison.ok, false);
  assert.equal(
    comparison.errors.some(
      (error) =>
        error.scope === "/setcircleinfo.rawPayloadPaths" &&
        error.unexpected.includes("$.newField"),
    ),
    true,
  );
});

test("rawEvents acknowledgements enforce stream, ordering, and accounting", () => {
  const packets = fixturePackets();
  const batch = new SnapshotRawEventReconstructor().consume(packets[0]);
  const valid = validateRawEventsAck(
    {
      schema: RAW_EVENTS_ACK_SCHEMA,
      streamId: batch.streamId,
      highestContiguousSequence: batch.lastSequence,
      accepted: batch.events.length - 2,
      duplicates: 2,
    },
    batch,
  );
  assert.equal(valid.ok, true);

  const invalid = validateRawEventsAck(
    {
      schema: RAW_EVENTS_ACK_SCHEMA,
      streamId: "wrong-stream",
      highestContiguousSequence: batch.lastSequence - 1,
      accepted: 0,
      duplicates: 0,
    },
    batch,
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.length, 3);

  for (const malformed of [
    {
      schema: RAW_EVENTS_ACK_SCHEMA,
      streamId: batch.streamId,
      accepted: batch.events.length,
      duplicates: 0,
    },
    {
      schema: RAW_EVENTS_ACK_SCHEMA,
      streamId: batch.streamId,
      highestContiguousSequence: batch.lastSequence + 1,
      accepted: batch.events.length,
      duplicates: 0,
    },
    {
      schema: RAW_EVENTS_ACK_SCHEMA,
      streamId: batch.streamId,
      highestContiguousSequence: batch.lastSequence,
      accepted: batch.events.length,
      duplicates: 1,
    },
    {
      schema: RAW_EVENTS_ACK_SCHEMA,
      streamId: batch.streamId,
      highestContiguousSequence: String(batch.lastSequence),
      accepted: String(batch.events.length),
      duplicates: 0,
    },
  ]) {
    assert.equal(validateRawEventsAck(malformed, batch).ok, false);
  }
});

test("live replay exposes an end-to-end network-free rawEvents mode", () => {
  const output = execFileSync(
    process.execPath,
    [
      path.resolve(__dirname, "pcob-live-replay.cjs"),
      "--recording",
      fixtureDir,
      "--raw-events",
      "--speed",
      "0",
    ],
    { encoding: "utf8" },
  );
  const jsonStart = output.indexOf('{\n  "mode"');
  assert.notEqual(jsonStart, -1);
  const report = JSON.parse(output.slice(jsonStart));
  assert.equal(report.mode, "dry-run");
  assert.equal(report.packetsRead, 3);
  assert.equal(report.rawEvents.events, 19);
  assert.equal(report.rawEvents.batches, 2);
  assert.equal(report.rawEvents.syntheticFromSnapshot, true);
});

test("local connector replay rejects non-loopback targets", () => {
  assert.throws(
    () => parseLoopbackBase("https://api.arenzyra.com"),
    /loopback-only/,
  );
  assert.equal(
    parseLoopbackBase("http://127.0.0.1:10086").origin,
    "http://127.0.0.1:10086",
  );
});

test("local connector replay drives an isolated fake connector in event order", async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok", forwardEnabled: false }));
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [
          path.resolve(__dirname, "pcob-local-connector-replay.cjs"),
          "--recording",
          fixtureDir,
          "--connector-base",
          `http://127.0.0.1:${address.port}`,
          "--speed",
          "0",
          "--send",
          "--confirm-local-send",
          "--confirm-isolated-connector",
          "--json",
        ],
        { encoding: "utf8" },
        (error, output, stderr) => {
          if (error) {
            reject(new Error(`${error.message}\n${stderr}`));
            return;
          }
          resolve(output);
        },
      );
    });
    const report = JSON.parse(stdout);
    assert.equal(report.mode, "local-send");
    assert.equal(report.reconstructedEvents, 19);
    assert.equal(report.postedEvents, 19);
    assert.equal(requests.length, 19);
    assert.deepEqual(
      requests.slice(0, 3).map((request) => request.url),
      ["/setcircleinfo", "/setkillinfo", "/setobservingplayer"],
    );
    assert.equal(requests[0].method, "POST");
    assert.equal(
      requests[0].headers["x-arenzyra-synthetic-replay"],
      "true",
    );
    assert.deepEqual(JSON.parse(requests[0].body), {
      CircleIndex: "0",
      CircleStatus: "0",
      Counter: "1",
      GameTime: "20",
      MaxTime: "60",
    });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("checked-in manifest is versioned and names exactly the 15 observed routes", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.schema, "arenzyra.pcobObservedSchemaManifest.v1");
  assert.equal(manifest.version, 1);
  assert.deepEqual(Object.keys(manifest.routes).sort(), [
    "/setairdropboxinfo",
    "/setcircleinfo",
    "/setentertopeightafterrevive",
    "/setgameglobalinfo",
    "/setisingame",
    "/setkillinfo",
    "/setobservingplayer",
    "/setplayerassistinfo",
    "/setplayersaminfo",
    "/setplayerssightusageinfo",
    "/setplayerweapondetailinfo",
    "/setplayerweaponinfo",
    "/setreviveplayer",
    "/setteambackpackinfo",
    "/totalmessage",
  ]);
  assert.deepEqual(
    manifest.routes["/setplayersaminfo"].unknownArrayElementPaths,
    ["$.PickUpData", "$.UseData"],
  );
  assert.deepEqual(
    manifest.routes["/setplayerweaponinfo"].unknownArrayElementPaths,
    ["$.TotalPlayerWeaponReport"],
  );
  assert.ok(
    manifest.routes["/setplayerweapondetailinfo"].rawPayloadPaths["$.RoomID"]
      .unsafeNumberCount > 0,
  );
  assert.ok(
    manifest.routes["/setplayersaminfo"].rawPayloadPaths["$.RoomID"]
      .unsafeNumberCount > 0,
  );
});
