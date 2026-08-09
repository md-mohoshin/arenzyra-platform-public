#!/usr/bin/env node
"use strict";

const { TextDecoder } = require("node:util");

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_SCHEDULES = 10_000_000;
const SUMMARY_KEYS = Object.freeze([
  "ok",
  "mode",
  "applicable",
  "zeroPlaintext",
  "storageReady",
  "envelopeConstraintReady",
  "totalSchedules",
  "encryptedSchedules",
  "invalidEncryptedSchedules",
  "legacySchedules",
  "plaintextMessageSchedules",
  "oversizedLegacySchedules",
]);

function fail(message) {
  throw new Error(message);
}

function parseSummary(input) {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
    fail("Compiled IDP summary is absent or oversized.");
  }
  let value;
  try {
    value = JSON.parse(input);
  } catch {
    fail("Compiled IDP summary is not one JSON object.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("Compiled IDP summary is not one JSON object.");
  }
  if (
    Object.keys(value).length !== SUMMARY_KEYS.length ||
    SUMMARY_KEYS.some((key) => !Object.hasOwn(value, key))
  ) {
    fail("Compiled IDP summary shape is not reviewed.");
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== input) {
    fail("Compiled IDP summary is not canonical.");
  }
  for (const key of [
    "ok",
    "applicable",
    "zeroPlaintext",
    "storageReady",
    "envelopeConstraintReady",
  ]) {
    if (typeof value[key] !== "boolean") {
      fail("Compiled IDP summary contains an invalid boolean.");
    }
  }
  if (value.mode !== "dry-run") {
    fail("Compiled IDP summary is not a dry-run result.");
  }
  for (const key of [
    "totalSchedules",
    "encryptedSchedules",
    "invalidEncryptedSchedules",
    "legacySchedules",
    "plaintextMessageSchedules",
    "oversizedLegacySchedules",
  ]) {
    if (
      !Number.isSafeInteger(value[key]) ||
      value[key] < 0 ||
      value[key] > MAX_SCHEDULES
    ) {
      fail("Compiled IDP summary contains an invalid count.");
    }
  }
  if (
    value.encryptedSchedules + value.legacySchedules !== value.totalSchedules ||
    value.invalidEncryptedSchedules > value.encryptedSchedules ||
    value.plaintextMessageSchedules > value.totalSchedules ||
    value.oversizedLegacySchedules > value.legacySchedules
  ) {
    fail("Compiled IDP summary counts are inconsistent.");
  }
  const applicable =
    value.storageReady &&
    value.envelopeConstraintReady &&
    value.oversizedLegacySchedules === 0 &&
    value.invalidEncryptedSchedules === 0;
  const zeroPlaintext =
    value.legacySchedules === 0 && value.plaintextMessageSchedules === 0;
  if (
    value.applicable !== applicable ||
    value.zeroPlaintext !== zeroPlaintext ||
    value.ok !== (applicable && zeroPlaintext)
  ) {
    fail("Compiled IDP summary booleans are inconsistent.");
  }
  return value;
}

function assertCleanSummary(summary) {
  if (
    summary.ok !== true ||
    summary.applicable !== true ||
    summary.zeroPlaintext !== true ||
    summary.storageReady !== true ||
    summary.envelopeConstraintReady !== true ||
    summary.invalidEncryptedSchedules !== 0 ||
    summary.legacySchedules !== 0 ||
    summary.plaintextMessageSchedules !== 0 ||
    summary.oversizedLegacySchedules !== 0
  ) {
    fail("Compiled IDP storage postcondition is not clean.");
  }
  return summary;
}

async function readBoundedStdin(stream) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > MAX_INPUT_BYTES) {
      fail("Compiled IDP summary is absent or oversized.");
    }
    chunks.push(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, totalBytes),
    );
  } catch {
    fail("Compiled IDP summary is not valid UTF-8.");
  }
}

function sanitizedLine(summary, label) {
  return `${label} ok=${summary.ok} applicable=${summary.applicable} zero_plaintext=${summary.zeroPlaintext} total=${summary.totalSchedules} encrypted=${summary.encryptedSchedules} invalid_encrypted=${summary.invalidEncryptedSchedules} legacy=${summary.legacySchedules} plaintext_messages=${summary.plaintextMessageSchedules} oversized_legacy=${summary.oversizedLegacySchedules}\n`;
}

async function main(argv = process.argv.slice(2), stream = process.stdin) {
  if (
    argv.length !== 1 ||
    (argv[0] !== "--preview" && argv[0] !== "--require-clean")
  ) {
    fail("Expected exactly --preview or --require-clean.");
  }
  const summary = parseSummary(await readBoundedStdin(stream));
  if (argv[0] === "--require-clean") {
    assertCleanSummary(summary);
    process.stdout.write(sanitizedLine(summary, "IDP COMPILED STORAGE VERIFIED"));
  } else {
    process.stdout.write(sanitizedLine(summary, "IDP COMPILED STORAGE SUMMARY"));
  }
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(
      "IDP COMPILED STORAGE BLOCKED: dry-run evidence is invalid or not clean.\n",
    );
    process.exitCode = 75;
  });
}

module.exports = {
  MAX_INPUT_BYTES,
  SUMMARY_KEYS,
  assertCleanSummary,
  main,
  parseSummary,
  sanitizedLine,
};
