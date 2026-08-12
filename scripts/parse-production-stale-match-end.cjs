#!/usr/bin/env node
"use strict";

const { TextDecoder } = require("node:util");

const MAX_INPUT_BYTES = 4096;

function fail(reason) {
  const error = new Error(reason);
  error.exitCode = 75;
  throw error;
}

function parseResult(input) {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
    fail("Stale-match recovery result is missing or oversized.");
  }
  let parsed;
  try {
    parsed = JSON.parse(input.trim());
  } catch {
    fail("Stale-match recovery result is not one JSON document.");
  }
  const expectedKeys = [
    "schemaVersion",
    "organizationName",
    "endedMatches",
    "resultFinalizationPerformed",
  ];
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.hasOwn(parsed, key)) ||
    parsed.schemaVersion !== 1 ||
    parsed.organizationName !== "Global Control" ||
    parsed.endedMatches !== 3 ||
    parsed.resultFinalizationPerformed !== false
  ) {
    fail("Stale-match recovery result did not prove the reviewed postcondition.");
  }
  return parsed;
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) fail("Stale-match recovery result is oversized.");
    chunks.push(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch {
    fail("Stale-match recovery result is not valid UTF-8.");
  }
}

async function main() {
  process.stdout.write(`${JSON.stringify(parseResult(await readStdin()))}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Stale-match recovery failed."}\n`);
    process.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : 75;
  });
}

module.exports = { parseResult };
