#!/usr/bin/env node
"use strict";

const { TextDecoder } = require("node:util");

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_SCHEDULES = 10_000_000;
const APPLY_KEYS = Object.freeze([
  "ok",
  "mode",
  "attemptedCredentials",
  "encryptedCredentials",
  "attemptedMessageScrubs",
  "scrubbedMessageSchedules",
  "updatedRows",
]);
const VALIDATE_KEYS = Object.freeze([
  "ok",
  "mode",
  "totalSchedules",
  "legacySchedules",
  "invalidEncryptedSchedules",
  "plaintextMessageSchedules",
  "constraintValidated",
]);

function assertExactKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("IDP maintenance output is not one object.");
  }
  if (JSON.stringify(Object.keys(value)) !== JSON.stringify(expected)) {
    throw new Error("IDP maintenance output shape is not reviewed.");
  }
}

function assertCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SCHEDULES) {
    throw new Error("IDP maintenance count is invalid.");
  }
}

function parseMutationSummary(input, mode) {
  if (
    typeof input !== "string" ||
    Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES
  ) {
    throw new Error("IDP maintenance output is absent or oversized.");
  }
  let value;
  try {
    value = JSON.parse(input);
  } catch {
    throw new Error("IDP maintenance output is not valid JSON.");
  }
  const keys = mode === "apply" ? APPLY_KEYS : VALIDATE_KEYS;
  assertExactKeys(value, keys);
  const canonical = `${JSON.stringify(value, null, mode === "apply" ? 2 : 0)}\n`;
  if (input !== canonical || value.ok !== true || value.mode !== mode) {
    throw new Error("IDP maintenance result is not canonical or successful.");
  }

  if (mode === "apply") {
    for (const key of keys.slice(2)) assertCount(value[key]);
    if (
      value.encryptedCredentials !== value.attemptedCredentials ||
      value.scrubbedMessageSchedules !== value.attemptedMessageScrubs ||
      value.updatedRows <
        Math.max(value.attemptedCredentials, value.attemptedMessageScrubs) ||
      value.updatedRows >
        value.attemptedCredentials + value.attemptedMessageScrubs
    ) {
      throw new Error("IDP backfill counts are inconsistent.");
    }
  } else {
    for (const key of keys.slice(2, -1)) assertCount(value[key]);
    if (
      value.legacySchedules !== 0 ||
      value.invalidEncryptedSchedules !== 0 ||
      value.plaintextMessageSchedules !== 0 ||
      value.constraintValidated !== true
    ) {
      throw new Error("IDP validation postcondition is not clean.");
    }
  }
  return value;
}

async function readBoundedStdin(stream) {
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_INPUT_BYTES) {
      throw new Error("IDP maintenance output is oversized.");
    }
    chunks.push(bytes);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
}

async function main(argv = process.argv.slice(2), stream = process.stdin) {
  if (argv.length !== 1 || !["--apply", "--validate"].includes(argv[0])) {
    throw new Error("Expected exactly --apply or --validate.");
  }
  const mode = argv[0].slice(2);
  const result = parseMutationSummary(await readBoundedStdin(stream), mode);
  if (mode === "apply") {
    process.stdout.write(
      `IDP BACKFILL VERIFIED encrypted=${result.encryptedCredentials} scrubbed_messages=${result.scrubbedMessageSchedules} updated_rows=${result.updatedRows}\n`,
    );
  } else {
    process.stdout.write(
      `IDP ENVELOPE VALIDATION VERIFIED total=${result.totalSchedules} constraint_validated=true\n`,
    );
  }
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(
      "IDP MAINTENANCE MUTATION BLOCKED: result evidence is invalid.\n",
    );
    process.exitCode = 75;
  });
}

module.exports = { APPLY_KEYS, VALIDATE_KEYS, parseMutationSummary };
