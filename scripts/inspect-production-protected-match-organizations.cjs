#!/usr/bin/env node
"use strict";

const { TextDecoder } = require("node:util");

const MAX_INPUT_BYTES = 32 * 1024;
const MAX_ORGANIZATIONS = 100;
const MAX_NAME_LENGTH = 200;
const countKeys = Object.freeze([
  "protectedMatches",
  "businessLive",
  "businessFinishPending",
  "controlCountdown",
  "controlLive",
  "controlPaused",
  "controlFinishPending",
  "recentTelemetry",
  "liveRound",
  "unknownState",
]);
const organizationKeys = Object.freeze(["organizationName", ...countKeys]);

function fail(reason) {
  const error = new Error(reason);
  error.exitCode = 75;
  throw error;
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function parseSummary(input) {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
    fail("Protected-match organization summary is missing or oversized.");
  }
  let parsed;
  try {
    parsed = JSON.parse(input.trim());
  } catch {
    fail("Protected-match organization summary is not one JSON document.");
  }
  if (!exactKeys(parsed, ["schemaVersion", "totalOrganizations", "organizations"])) {
    fail("Protected-match organization summary has an unexpected shape.");
  }
  if (parsed.schemaVersion !== 1 || !Number.isSafeInteger(parsed.totalOrganizations)) {
    fail("Protected-match organization summary has an unsupported version or count.");
  }
  if (
    !Array.isArray(parsed.organizations) ||
    parsed.organizations.length !== parsed.totalOrganizations ||
    parsed.organizations.length > MAX_ORGANIZATIONS
  ) {
    fail("Protected-match organization summary has an invalid organization inventory.");
  }
  const names = new Set();
  for (const organization of parsed.organizations) {
    if (!exactKeys(organization, organizationKeys)) {
      fail("Protected-match organization entry has an unexpected shape.");
    }
    if (
      typeof organization.organizationName !== "string" ||
      organization.organizationName.length < 1 ||
      organization.organizationName.length > MAX_NAME_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(organization.organizationName)
    ) {
      fail("Protected-match organization entry has an invalid name.");
    }
    if (names.has(organization.organizationName)) {
      fail("Protected-match organization names are not unique.");
    }
    names.add(organization.organizationName);
    for (const key of countKeys) {
      if (!Number.isSafeInteger(organization[key]) || organization[key] < 0) {
        fail("Protected-match organization entry has an invalid count.");
      }
      if (key !== "protectedMatches" && organization[key] > organization.protectedMatches) {
        fail("Protected-match organization signal exceeds its protected inventory.");
      }
    }
    if (organization.protectedMatches < 1) {
      fail("Protected-match organization entry is empty.");
    }
  }
  return parsed;
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) fail("Protected-match organization summary is oversized.");
    chunks.push(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch {
    fail("Protected-match organization summary is not valid UTF-8.");
  }
}

async function main() {
  process.stdout.write(`${JSON.stringify(parseSummary(await readStdin()))}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Protected-match organization inspection failed."}\n`);
    process.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : 75;
  });
}

module.exports = { parseSummary };
