"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFINITIONS,
  parseArguments,
  verifyIdpCredentialStorage,
} = require("./verify-idp-credential-storage.cjs");

const definition = [...DEFINITIONS].find(
  (candidate) => !candidate.endsWith(" NOT VALID"),
);
const valid = Object.freeze({
  migrationAppliedCount: "1",
  constraintCount: "1",
  constraintValidatedCount: "1",
  legacyCount: "0",
  constraintDefinitionHex: Buffer.from(definition, "utf8").toString("hex"),
});

test("final IDP storage gate requires exact migration, zero plaintext, and validation", () => {
  assert.deepEqual(verifyIdpCredentialStorage(valid), {
    migrationApplied: 1,
    constraints: 1,
    validated: 1,
    legacy: 0,
    allowUnvalidated: false,
  });
  for (const patch of [
    { migrationAppliedCount: "0" },
    { migrationAppliedCount: "2" },
    { constraintCount: "0" },
    { constraintValidatedCount: "0" },
    { legacyCount: "12" },
    { constraintDefinitionHex: Buffer.from("CHECK (true)").toString("hex") },
  ]) {
    assert.throws(() => verifyIdpCredentialStorage({ ...valid, ...patch }));
  }
});

test("backfill-only mode permits only the exact unvalidated intermediate state", () => {
  assert.equal(
    verifyIdpCredentialStorage(
      { ...valid, constraintValidatedCount: "0" },
      { allowUnvalidated: true },
    ).validated,
    0,
  );
  assert.throws(() =>
    verifyIdpCredentialStorage(
      { ...valid, constraintValidatedCount: "0", legacyCount: "1" },
      { allowUnvalidated: true },
    ),
  );
});

test("CLI argument schema is closed and duplicate-safe", () => {
  const argv = [
    "--migration-applied-count",
    "1",
    "--constraint-count",
    "1",
    "--constraint-validated-count",
    "1",
    "--legacy-count",
    "0",
    "--constraint-definition-hex",
    valid.constraintDefinitionHex,
  ];
  assert.equal(parseArguments(argv).allowUnvalidated, false);
  assert.equal(
    parseArguments([...argv, "--allow-unvalidated"]).allowUnvalidated,
    true,
  );
  assert.throws(() => parseArguments([...argv, "--unknown"]));
  assert.throws(() => parseArguments([...argv, ...argv.slice(0, 2)]));
});
