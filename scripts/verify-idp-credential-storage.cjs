#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadManifest } = require("./verify-production-migration-safety.cjs");

const IDP_ENVELOPE_SQL_PATTERN =
  "^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$";
const IDP_ENVELOPE_CONSTRAINT_DEFINITIONS = new Set(
  [
    `CHECK ("roomPassword" ~ '${IDP_ENVELOPE_SQL_PATTERN}')`,
    `CHECK (("roomPassword" ~ '${IDP_ENVELOPE_SQL_PATTERN}'))`,
    `CHECK ("roomPassword" ~ '${IDP_ENVELOPE_SQL_PATTERN}'::text)`,
    `CHECK (("roomPassword" ~ '${IDP_ENVELOPE_SQL_PATTERN}'::text))`,
  ].flatMap((definition) => [definition, `${definition} NOT VALID`]),
);

function parseCount(value, label) {
  if (!/^(?:0|[1-9][0-9]*)$/.test(String(value))) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return Number(value);
}

function verifyIdpCredentialStorage({
  envelopeConstraintDefinition,
  envelopeConstraintCount,
  migrationAppliedCount,
  legacyScheduleCount,
  manifest,
}) {
  const idp = manifest.idpCredentialStorage;
  if (migrationAppliedCount !== 1) {
    return { ok: false, reason: "idp-storage-migration-not-applied" };
  }
  if (envelopeConstraintCount !== 1) {
    return {
      ok: false,
      reason: "idp-storage-envelope-constraint-missing",
      envelopeConstraintCount,
    };
  }
  if (!IDP_ENVELOPE_CONSTRAINT_DEFINITIONS.has(envelopeConstraintDefinition)) {
    return {
      ok: false,
      reason: "idp-storage-envelope-constraint-mismatch",
    };
  }
  if (legacyScheduleCount !== 0) {
    return {
      ok: false,
      reason: "legacy-plaintext-idp-schedules-remain",
      legacyScheduleCount,
    };
  }
  return {
    ok: true,
    reason: "legacy-plaintext-count-zero",
    legacyScheduleCount: 0,
    envelopePrefix: idp.envelopePrefix,
  };
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index === process.argv.length - 1) {
    throw new Error(`${name} requires a value.`);
  }
  return process.argv[index + 1];
}

function parseConstraintDefinitionHex(value) {
  if (value === "-") return "";
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error("constraint-definition-hex must be canonical hex.");
  }
  const decoded = Buffer.from(value, "hex").toString("utf8");
  if (Buffer.from(decoded, "utf8").toString("hex") !== value.toLowerCase()) {
    throw new Error("constraint-definition-hex is not canonical UTF-8.");
  }
  return decoded;
}

function main() {
  const manifestPath = process.argv.includes("--manifest")
    ? path.resolve(flagValue("--manifest"))
    : undefined;
  const manifest = loadManifest(manifestPath);
  const result = verifyIdpCredentialStorage({
    envelopeConstraintDefinition: parseConstraintDefinitionHex(
      flagValue("--constraint-definition-hex"),
    ),
    envelopeConstraintCount: parseCount(
      flagValue("--constraint-count"),
      "constraint-count",
    ),
    migrationAppliedCount: parseCount(
      flagValue("--migration-applied-count"),
      "migration-applied-count",
    ),
    legacyScheduleCount: parseCount(
      flagValue("--legacy-count"),
      "legacy-count",
    ),
    manifest,
  });
  if (!result.ok) {
    process.stderr.write(
      `IDP ENCRYPTION GATE BLOCKED: ${result.reason}\n` +
        `${JSON.stringify(result)}\n` +
        "The backfill is manual-only. Stop old API writers before applying it, keep them stopped, then verify again.\n",
    );
    process.exitCode = 75;
    return;
  }
  process.stdout.write(
    "IDP ENCRYPTION GATE PASSED legacy_plaintext_schedules=0\n",
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `IDP ENCRYPTION GATE ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}

module.exports = {
  IDP_ENVELOPE_CONSTRAINT_DEFINITIONS,
  parseConstraintDefinitionHex,
  parseCount,
  verifyIdpCredentialStorage,
};
