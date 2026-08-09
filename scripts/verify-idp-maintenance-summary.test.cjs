"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertCleanSummary,
  parseSummary,
  sanitizedLine,
} = require("./verify-idp-maintenance-summary.cjs");

function summary(overrides = {}) {
  return {
    ok: true,
    mode: "dry-run",
    applicable: true,
    zeroPlaintext: true,
    storageReady: true,
    envelopeConstraintReady: true,
    totalSchedules: 12,
    encryptedSchedules: 12,
    invalidEncryptedSchedules: 0,
    legacySchedules: 0,
    plaintextMessageSchedules: 0,
    oversizedLegacySchedules: 0,
    ...overrides,
  };
}

function text(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

test("accepts only the canonical authenticated clean dry-run postcondition", () => {
  const parsed = parseSummary(text(summary()));
  assert.deepEqual(assertCleanSummary(parsed), summary());
  assert.equal(
    sanitizedLine(parsed, "IDP COMPILED STORAGE VERIFIED"),
    "IDP COMPILED STORAGE VERIFIED ok=true applicable=true zero_plaintext=true total=12 encrypted=12 invalid_encrypted=0 legacy=0 plaintext_messages=0 oversized_legacy=0\n",
  );
});

test("preview accepts a consistent non-clean inventory but final verification blocks", () => {
  const preview = summary({
    ok: false,
    zeroPlaintext: false,
    encryptedSchedules: 0,
    legacySchedules: 12,
    plaintextMessageSchedules: 12,
  });
  const parsed = parseSummary(text(preview));
  assert.equal(parsed.ok, false);
  assert.throws(() => assertCleanSummary(parsed), /not clean/);
});

test("rejects every false clean postcondition and inconsistent count", () => {
  for (const candidate of [
    summary({ ok: false }),
    summary({ applicable: false }),
    summary({ zeroPlaintext: false }),
    summary({ storageReady: false }),
    summary({ envelopeConstraintReady: false }),
    summary({ invalidEncryptedSchedules: 1 }),
    summary({ legacySchedules: 1 }),
    summary({ plaintextMessageSchedules: 1 }),
    summary({ oversizedLegacySchedules: 1 }),
    summary({ totalSchedules: 13 }),
    summary({ encryptedSchedules: -1 }),
  ]) {
    assert.throws(() => assertCleanSummary(parseSummary(text(candidate))));
  }
});

test("rejects noncanonical, duplicate, expanded, and multiple JSON", () => {
  const valid = summary();
  assert.throws(() => parseSummary(JSON.stringify(valid)));
  assert.throws(() =>
    parseSummary(text({ ...valid, privateScheduleId: "secret" })),
  );
  assert.throws(() =>
    parseSummary(text(valid).replace('"ok": true', '"ok": false,\n  "ok": true')),
  );
  assert.throws(() => parseSummary(`${text(valid)}${text(valid)}`));
  assert.throws(() => parseSummary(text({ ...valid, mode: "apply" })));
});
