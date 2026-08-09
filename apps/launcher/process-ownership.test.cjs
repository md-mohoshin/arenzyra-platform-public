"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPortOwnership } = require("./process-ownership.cjs");

test("busy ports are managed only when the launcher owns a live child PID", () => {
  assert.equal(
    classifyPortOwnership({ busy: true, childPid: 123, managedProcessRunning: true }),
    "managed",
  );
  assert.equal(
    classifyPortOwnership({ busy: true, childPid: null, managedProcessRunning: false }),
    "unmanaged",
  );
  assert.equal(
    classifyPortOwnership({ busy: true, childPid: 123, managedProcessRunning: false }),
    "unmanaged",
  );
  assert.equal(
    classifyPortOwnership({ busy: false, childPid: null, managedProcessRunning: false }),
    "free",
  );
});
