"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { _test } = require("./pcob-api-recording-integration.cjs");

const descriptor = () => {
  const runId = "12345678-1234-4234-8234-123456789abc";
  return {
    id: "a".repeat(64),
    name: _test.disposableContainerName(runId),
    runId,
  };
};

const inspection = (container, overrides = {}) => ({
  Id: container.id,
  Name: "/" + container.name,
  Config: {
    Image: "postgres:16",
    Labels: { "com.arenzyra.pcob-api-e2e": container.runId },
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

test("disposable cleanup retries a transient inspect and verifies removal", async () => {
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

test("disposable cleanup never treats an unknown inspect failure as absence", async () => {
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

test("disposable cleanup refuses a mismatched or persistent container", async () => {
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
