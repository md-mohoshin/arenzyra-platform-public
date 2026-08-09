"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { run, _test } = require("./pcob-protected-spool-api-integration.cjs");

const descriptor = () => {
  const runId = "12345678-1234-4234-8234-123456789abc";
  return {
    id: "a".repeat(64),
    name: _test.containerName(runId),
    runId,
  };
};

const inspection = (container, overrides = {}) => ({
  Id: container.id,
  Name: "/" + container.name,
  Config: {
    Image: "postgres:16",
    Labels: { "com.arenzyra.pcob-spool-e2e": container.runId },
  },
  HostConfig: {
    Tmpfs: {
      "/var/lib/postgresql/data": "rw,noexec,nosuid,size=4294967296",
    },
  },
  Mounts: [{ Type: "tmpfs", Destination: "/var/lib/postgresql/data" }],
  ...overrides,
});

const dockerFailure = (message) => {
  const error = new Error(message);
  error.stderr = message;
  return error;
};

test("requires explicit disposable confirmation before any integration work", async () => {
  await assert.rejects(
    run({ confirmed: false, spools: [], batchSize: 64 }),
    /refusing to start docker without --confirm-disposable/i,
  );
});

test("CLI defaults are bounded and raw envelopes preserve exact event objects", () => {
  const options = _test.parseCli([]);
  assert.equal(options.confirmed, false);
  assert.equal(options.batchSize, 64);
  assert.equal(options.spools.length, 2);
  assert.throws(() => _test.parseCli(["--batch-size", "0"]), /1 through 500/);
  assert.throws(() => _test.parseCli(["--batch-size", "501"]), /1 through 500/);

  const events = [{ sequence: 41 }, { sequence: 42 }];
  const envelope = _test.rawEnvelope("immutable-stream", events);
  assert.equal(envelope.schema, "arenzyra.pcobRawEvents.v1");
  assert.equal(envelope.firstSequence, 41);
  assert.equal(envelope.lastSequence, 42);
  assert.equal(envelope.events, events);
});

test("protected spool resolution accepts only real files and does not open them for writing", () => {
  const requested = path.resolve(
    __dirname,
    "..",
    ".local-backups",
    "pcob-spool-ended-match-pre-recovery-20260802T214403",
  );
  const before = ["metadata.json", "events.ndjson"].map((name) => {
    const stat = fs.statSync(path.join(requested, name));
    return [stat.size, stat.mtimeMs];
  });
  const resolved = _test.resolveReadOnlySpool(requested);
  assert.equal(resolved.directory, fs.realpathSync.native(requested));
  assert.equal(fs.lstatSync(resolved.metadataPath).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(resolved.eventsPath).isSymbolicLink(), false);
  const after = [resolved.metadataPath, resolved.eventsPath].map((filename) => {
    const stat = fs.statSync(filename);
    return [stat.size, stat.mtimeMs];
  });
  assert.deepEqual(after, before);
});

test("map scope is explicit when PCOB root schemas contain no identity", () => {
  const scope = _test.recordingMapScope({
    shapes: {
      "/totalmessage": { keys: ["TotalPlayerList", "TeamInfoList"] },
      "/setgameglobalinfo": {
        keys: ["CircleArray", "PlaneStartLocX", "PlaneStopLocX"],
      },
    },
  });
  assert.equal(scope.providerMapIdentity, null);
  assert.equal(scope.databasePlaceholder, "RONDO");
  assert.match(scope.validationScope, /map identity is not exposed/i);
  assert.throws(
    () =>
      _test.recordingMapScope({
        shapes: { "/totalmessage": { keys: ["MapName"] } },
      }),
    /unexpectedly exposes a root map identity field/i,
  );
});

test("disposable cleanup retries transient inspection and verifies absence", async () => {
  const container = descriptor();
  const calls = [];
  const pauses = [];
  let inspections = 0;
  await _test.removeDisposablePostgres(container, {
    execute: async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === "rm") return { stdout: container.id, stderr: "" };
      inspections += 1;
      if (inspections === 1) {
        throw dockerFailure("temporary Docker daemon transport failure");
      }
      if (inspections === 2) {
        return { stdout: JSON.stringify([inspection(container)]), stderr: "" };
      }
      throw dockerFailure("Error: No such object: " + container.id);
    },
    pause: async (milliseconds) => pauses.push(milliseconds),
  });
  assert.deepEqual(
    calls.map((call) => call.slice(1, 3)),
    [
      ["inspect", container.id],
      ["inspect", container.id],
      ["rm", "--force"],
      ["inspect", container.id],
    ],
  );
  assert.deepEqual(pauses, [100, 200]);
});

test("cleanup never treats unknown Docker errors as successful removal", async () => {
  const container = descriptor();
  let calls = 0;
  await assert.rejects(
    _test.removeDisposablePostgres(container, {
      execute: async () => {
        calls += 1;
        throw dockerFailure("Docker daemon unavailable");
      },
      pause: async () => undefined,
    }),
    /removal could not be verified after 5 attempts/i,
  );
  assert.equal(calls, 5);
});

test("cleanup refuses mismatched ownership or persistent storage", async () => {
  const container = descriptor();
  let removed = false;
  await assert.rejects(
    _test.removeDisposablePostgres(container, {
      execute: async (_file, args) => {
        if (args[0] === "rm") {
          removed = true;
          return { stdout: "", stderr: "" };
        }
        return {
          stdout: JSON.stringify([
            inspection(container, {
              Mounts: [{ Type: "volume", Destination: "/data" }],
            }),
          ]),
          stderr: "",
        };
      },
      pause: async () => undefined,
    }),
    /persistent or unexpected storage/i,
  );
  assert.equal(removed, false);
});
