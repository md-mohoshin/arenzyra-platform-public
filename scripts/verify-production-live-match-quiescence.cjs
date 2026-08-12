#!/usr/bin/env node
"use strict";

const { TextDecoder } = require("node:util");

const MAX_INPUT_BYTES = 16 * 1024;
const COUNT = Symbol("aggregate-count");

const INVENTORY_SHAPE = Object.freeze({
  schemaVersion: 1,
  matches: {
    totalNonDeleted: COUNT,
    deploymentProtected: COUNT,
    quiescent: COUNT,
  },
  businessStatus: {
    draft: COUNT,
    live: COUNT,
    ended: COUNT,
    finishPending: COUNT,
    finished: COUNT,
    unknown: COUNT,
  },
  liveState: {
    upcoming: COUNT,
    live: COUNT,
    ended: COUNT,
    unknown: COUNT,
  },
  controlState: {
    none: COUNT,
    ready: COUNT,
    countdown: COUNT,
    live: COUNT,
    paused: COUNT,
    ended: COUNT,
    confirmed: COUNT,
    finishPending: COUNT,
    unknown: COUNT,
  },
  activitySignals: {
    recentTelemetry: COUNT,
    liveRound: COUNT,
  },
});

function fail(reason, exitCode = 75) {
  const error = new Error(reason);
  error.exitCode = exitCode;
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeAgainstShape(value, shape, label = "inventory") {
  if (shape === COUNT) {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(`${label} must be a non-negative safe integer.`);
    }
    return value;
  }
  if (typeof shape === "number") {
    if (value !== shape) fail(`${label} has an unsupported value.`);
    return shape;
  }
  if (!isRecord(value)) fail(`${label} must be an object.`);

  const expectedKeys = Object.keys(shape);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    // Never echo an unexpected key; it could itself contain private data.
    fail(`${label} has an unexpected object shape.`);
  }

  const sanitized = {};
  for (const key of expectedKeys) {
    sanitized[key] = sanitizeAgainstShape(
      value[key],
      shape[key],
      `${label}.${key}`,
    );
  }
  return sanitized;
}

function sum(values) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

function validateConsistency(inventory) {
  const total = inventory.matches.totalNonDeleted;
  if (inventory.matches.deploymentProtected + inventory.matches.quiescent !== total) {
    fail("Aggregate consistency check failed: protected match partition.");
  }
  if (sum(inventory.businessStatus) !== total) {
    fail("Aggregate consistency check failed: business status partition.");
  }
  if (sum(inventory.liveState) !== total) {
    fail("Aggregate consistency check failed: live-state partition.");
  }
  if (sum(inventory.controlState) !== total) {
    fail("Aggregate consistency check failed: control-state partition.");
  }

  const protectedCount = inventory.matches.deploymentProtected;
  const protectedSignals = [
    inventory.businessStatus.live,
    inventory.businessStatus.finishPending,
    inventory.businessStatus.unknown,
    inventory.liveState.live,
    inventory.liveState.unknown,
    inventory.controlState.countdown,
    inventory.controlState.live,
    inventory.controlState.paused,
    inventory.controlState.finishPending,
    inventory.controlState.unknown,
    inventory.activitySignals.recentTelemetry,
    inventory.activitySignals.liveRound,
  ];
  for (const signal of protectedSignals) {
    if (signal > protectedCount) {
      fail("Aggregate consistency check failed: protected signal containment.");
    }
  }
  if (protectedCount > protectedSignals.reduce((totalValue, value) => totalValue + value, 0)) {
    fail("Aggregate consistency check failed: protected signal union.");
  }
}

function parseInventory(input) {
  if (typeof input !== "string") fail("Inventory must be UTF-8 text.");
  if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
    fail("Inventory exceeds the maximum aggregate size.");
  }
  const trimmed = input.trim();
  if (!trimmed) fail("Inventory is empty.");

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    fail("Inventory must contain exactly one JSON aggregate.");
  }
  const sanitized = sanitizeAgainstShape(parsed, INVENTORY_SHAPE);
  validateConsistency(sanitized);
  return sanitized;
}

function verifyQuiescence(inventory) {
  if (inventory.matches.deploymentProtected !== 0) {
    fail(
      "LIVE MATCH QUIESCENCE BLOCKED: protected match activity exists; " +
        `protected=${inventory.matches.deploymentProtected} ` +
        `countdown=${inventory.controlState.countdown} ` +
        `business_live=${inventory.businessStatus.live} ` +
        `finish_pending=${inventory.businessStatus.finishPending} ` +
        `recent_telemetry=${inventory.activitySignals.recentTelemetry} ` +
        `live_round=${inventory.activitySignals.liveRound}. ` +
        "No deployment phase was authorized.",
    );
  }
  return (
    "LIVE MATCH QUIESCENCE VERIFIED " +
    `non_deleted=${inventory.matches.totalNonDeleted} protected=0\n`
  );
}

async function readBoundedStdin(stream) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > MAX_INPUT_BYTES) {
      fail("Inventory exceeds the maximum aggregate size.");
    }
    chunks.push(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, totalBytes),
    );
  } catch {
    fail("Inventory must be valid UTF-8 text.");
  }
}

async function main() {
  const inventory = parseInventory(await readBoundedStdin(process.stdin));
  process.stdout.write(verifyQuiescence(inventory));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "LIVE MATCH QUIESCENCE BLOCKED: unexpected verifier failure."}\n`,
    );
    process.exitCode =
      error && Number.isInteger(error.exitCode) ? error.exitCode : 75;
  });
}

module.exports = {
  INVENTORY_SHAPE,
  MAX_INPUT_BYTES,
  parseInventory,
  readBoundedStdin,
  sanitizeAgainstShape,
  validateConsistency,
  verifyQuiescence,
};
