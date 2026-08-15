#!/usr/bin/env node
"use strict";

const { TextDecoder } = require("node:util");

const MAX_INPUT_BYTES = 4 * 1024;
const RETIRED_WIDGET_KEYS = Object.freeze([
  "style.focal",
  "team-status",
  "teams-alive",
  "kill-feed",
  "player-card",
  "map-overlay",
  "winner",
]);
const INVENTORY_KEYS = Object.freeze([
  "widgetKey",
  "widgetInstances",
  "activeWidgetInstances",
  "approvalRows",
  "approvedRows",
]);

function fail(reason) {
  const error = new Error(reason);
  error.exitCode = 75;
  throw error;
}

function hasExactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function parseInventory(input) {
  if (
    typeof input !== "string" ||
    Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES
  ) {
    fail("Retired-widget inventory is missing or oversized.");
  }

  let parsed;
  try {
    parsed = JSON.parse(input.trim());
  } catch {
    fail("Retired-widget inventory is not one JSON document.");
  }

  if (!hasExactKeys(parsed, ["schemaVersion", "retiredWidgets"])) {
    fail("Retired-widget inventory has an unexpected shape.");
  }
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.retiredWidgets)) {
    fail("Retired-widget inventory has an unsupported version or list.");
  }
  if (parsed.retiredWidgets.length !== RETIRED_WIDGET_KEYS.length) {
    fail("Retired-widget inventory does not contain the exact reviewed key set.");
  }

  for (let index = 0; index < RETIRED_WIDGET_KEYS.length; index += 1) {
    const inventory = parsed.retiredWidgets[index];
    if (!hasExactKeys(inventory, INVENTORY_KEYS)) {
      fail("Retired-widget inventory entry has an unexpected shape.");
    }
    if (inventory.widgetKey !== RETIRED_WIDGET_KEYS[index]) {
      fail("Retired-widget inventory keys are missing, duplicated, or reordered.");
    }
    for (const countKey of INVENTORY_KEYS.slice(1)) {
      if (!Number.isSafeInteger(inventory[countKey]) || inventory[countKey] < 0) {
        fail("Retired-widget inventory entry has an invalid count.");
      }
    }
    if (inventory.activeWidgetInstances > inventory.widgetInstances) {
      fail("Retired-widget active instance count exceeds its instance count.");
    }
    if (inventory.approvedRows > inventory.approvalRows) {
      fail("Retired-widget approved count exceeds its approval-row count.");
    }
  }

  return parsed;
}

function requireZeroInventory(inventory) {
  const nonzero = inventory.retiredWidgets.filter((entry) =>
    INVENTORY_KEYS.slice(1).some((countKey) => entry[countKey] !== 0),
  );
  if (nonzero.length > 0) {
    fail(
      `Retired-widget inventory is not empty for: ${nonzero
        .map((entry) => entry.widgetKey)
        .join(", ")}.`,
    );
  }
  return inventory;
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) fail("Retired-widget inventory is oversized.");
    chunks.push(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, size),
    );
  } catch {
    fail("Retired-widget inventory is not valid UTF-8.");
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length === 1 && args[0] !== "--require-zero")
  ) {
    fail("Retired-widget inventory parser received unsupported arguments.");
  }
  const inventory = parseInventory(await readStdin());
  if (args[0] === "--require-zero") {
    requireZeroInventory(inventory);
    process.stdout.write("RETIRED WIDGET ZERO INVENTORY VERIFIED keys=7\n");
    return;
  }
  process.stdout.write(`${JSON.stringify(inventory)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Retired-widget inventory failed."}\n`,
    );
    process.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : 75;
  });
}

module.exports = {
  parseInventory,
  requireZeroInventory,
  RETIRED_WIDGET_KEYS,
};
