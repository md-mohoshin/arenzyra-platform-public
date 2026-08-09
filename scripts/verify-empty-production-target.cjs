#!/usr/bin/env node
"use strict";

function parseCount(value, label = "application-relation-count") {
  const text = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} exceeds the safe integer range.`);
  }
  return parsed;
}

function verifyEmptyProductionTarget(applicationRelationCount) {
  if (applicationRelationCount !== 0) {
    return {
      ok: false,
      reason: "production-target-is-not-empty",
      applicationRelationCount,
    };
  }
  return {
    ok: true,
    reason: "production-target-has-zero-application-relations",
    applicationRelationCount: 0,
  };
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index === process.argv.length - 1) {
    throw new Error(`${name} requires a value.`);
  }
  return process.argv[index + 1];
}

function main() {
  const result = verifyEmptyProductionTarget(
    parseCount(flagValue("--application-relation-count")),
  );
  if (!result.ok) {
    process.stderr.write(
      `EMPTY TARGET GATE BLOCKED reason=${result.reason} ` +
        `application_relations=${result.applicationRelationCount}\n` +
        "--first-deploy cannot be used for an existing or pre-populated database. " +
        "No table name or row data was read or printed.\n",
    );
    process.exitCode = 75;
    return;
  }
  process.stdout.write("EMPTY TARGET GATE PASSED application_relations=0\n");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `EMPTY TARGET GATE ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}

module.exports = { parseCount, verifyEmptyProductionTarget };
