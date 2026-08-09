#!/usr/bin/env node
"use strict";

const ENVELOPE_PATTERN =
  "^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$";
const DEFINITIONS = new Set(
  [
    `CHECK ("roomPassword" ~ '${ENVELOPE_PATTERN}')`,
    `CHECK (("roomPassword" ~ '${ENVELOPE_PATTERN}'))`,
    `CHECK ("roomPassword" ~ '${ENVELOPE_PATTERN}'::text)`,
    `CHECK (("roomPassword" ~ '${ENVELOPE_PATTERN}'::text))`,
  ].flatMap((definition) => [definition, `${definition} NOT VALID`]),
);

function parseCount(value, label) {
  if (!/^(?:0|[1-9][0-9]{0,9})$/.test(value ?? "")) {
    throw new Error(`${label} is not a bounded count`);
  }
  return Number(value);
}

function decodeDefinition(value) {
  if (value === "-" || !/^(?:[0-9a-f]{2}){1,1024}$/.test(value ?? "")) {
    throw new Error("constraint definition is absent or invalid");
  }
  const bytes = Buffer.from(value, "hex");
  const definition = bytes.toString("utf8");
  if (!Buffer.from(definition, "utf8").equals(bytes)) {
    throw new Error("constraint definition is not canonical UTF-8");
  }
  return definition;
}

function verifyIdpCredentialStorage(input, { allowUnvalidated = false } = {}) {
  const migrationApplied = parseCount(
    input.migrationAppliedCount,
    "migration applied count",
  );
  const constraints = parseCount(input.constraintCount, "constraint count");
  const validated = parseCount(
    input.constraintValidatedCount,
    "constraint validated count",
  );
  const legacy = parseCount(input.legacyCount, "legacy credential count");
  const definition = decodeDefinition(input.constraintDefinitionHex);

  if (migrationApplied !== 1) {
    throw new Error("the exact IDP storage migration is not applied once");
  }
  if (constraints !== 1 || !DEFINITIONS.has(definition)) {
    throw new Error("the IDP envelope CHECK is absent or not exact");
  }
  if (legacy !== 0) {
    throw new Error("legacy plaintext IDP credentials remain");
  }
  if (validated !== 1 && !(allowUnvalidated && validated === 0)) {
    throw new Error("the IDP envelope CHECK is not validated");
  }
  return Object.freeze({
    migrationApplied,
    constraints,
    validated,
    legacy,
    allowUnvalidated,
  });
}

function parseArguments(argv) {
  const values = Object.create(null);
  const valueFlags = new Set([
    "--migration-applied-count",
    "--constraint-count",
    "--constraint-validated-count",
    "--legacy-count",
    "--constraint-definition-hex",
  ]);
  let allowUnvalidated = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--allow-unvalidated") {
      if (allowUnvalidated) throw new Error("duplicate --allow-unvalidated");
      allowUnvalidated = true;
      continue;
    }
    if (!valueFlags.has(flag) || Object.hasOwn(values, flag)) {
      throw new Error("unsupported or duplicate IDP verification argument");
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`missing value for ${flag}`);
    values[flag] = value;
  }
  if (Object.keys(values).length !== valueFlags.size) {
    throw new Error("IDP verification arguments are incomplete");
  }
  return { values, allowUnvalidated };
}

function main() {
  try {
    const { values, allowUnvalidated } = parseArguments(
      process.argv.slice(2),
    );
    const result = verifyIdpCredentialStorage(
      {
        migrationAppliedCount: values["--migration-applied-count"],
        constraintCount: values["--constraint-count"],
        constraintValidatedCount: values["--constraint-validated-count"],
        legacyCount: values["--legacy-count"],
        constraintDefinitionHex: values["--constraint-definition-hex"],
      },
      { allowUnvalidated },
    );
    process.stdout.write(
      `IDP CREDENTIAL STORAGE VERIFIED migration=${result.migrationApplied} ` +
        `constraint=${result.constraints} validated=${result.validated} ` +
        `legacy=${result.legacy}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `IDP ENCRYPTION GATE BLOCKED: ${
        error instanceof Error ? error.message : "verification failed"
      }\n`,
    );
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  DEFINITIONS,
  ENVELOPE_PATTERN,
  parseArguments,
  verifyIdpCredentialStorage,
};
