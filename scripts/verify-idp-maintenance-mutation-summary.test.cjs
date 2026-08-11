"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseMutationSummary,
} = require("./verify-idp-maintenance-mutation-summary.cjs");

function encoded(value, mode) {
  return `${JSON.stringify(value, null, mode === "apply" ? 2 : 0)}\n`;
}

test("accepts a complete canonical IDP backfill result", () => {
  const value = {
    ok: true,
    mode: "apply",
    attemptedCredentials: 12,
    encryptedCredentials: 12,
    attemptedMessageScrubs: 12,
    scrubbedMessageSchedules: 12,
    updatedRows: 12,
  };
  assert.deepEqual(
    parseMutationSummary(encoded(value, "apply"), "apply"),
    value,
  );
});

test("accepts only a zero-plaintext validated constraint result", () => {
  const value = {
    ok: true,
    mode: "validate",
    totalSchedules: 12,
    legacySchedules: 0,
    invalidEncryptedSchedules: 0,
    plaintextMessageSchedules: 0,
    constraintValidated: true,
  };
  assert.deepEqual(
    parseMutationSummary(encoded(value, "validate"), "validate"),
    value,
  );
  for (const key of [
    "legacySchedules",
    "invalidEncryptedSchedules",
    "plaintextMessageSchedules",
  ]) {
    assert.throws(() =>
      parseMutationSummary(
        encoded({ ...value, [key]: 1 }, "validate"),
        "validate",
      ),
    );
  }
});

test("rejects noncanonical, partial, expanded, and inconsistent results", () => {
  const value = {
    ok: true,
    mode: "apply",
    attemptedCredentials: 2,
    encryptedCredentials: 2,
    attemptedMessageScrubs: 1,
    scrubbedMessageSchedules: 1,
    updatedRows: 2,
  };
  assert.throws(() => parseMutationSummary(JSON.stringify(value), "apply"));
  assert.throws(() =>
    parseMutationSummary(encoded({ ...value, extra: 1 }, "apply"), "apply"),
  );
  assert.throws(() =>
    parseMutationSummary(
      encoded({ ...value, encryptedCredentials: 1 }, "apply"),
      "apply",
    ),
  );
});
