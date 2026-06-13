"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizePreviousMatchNumber,
  shouldApplyPreviousMatchSlotRecovery,
} = require("./slotRecoveryPolicy.cjs");

test("previous-match slot recovery applies only when current match has no assigned slots", () => {
  assert.equal(
    shouldApplyPreviousMatchSlotRecovery({
      currentAssignedCount: 0,
      needsSync: true,
    }),
    true,
  );
  assert.equal(
    shouldApplyPreviousMatchSlotRecovery({
      currentAssignedCount: 2,
      needsSync: true,
    }),
    false,
  );
});

test("previous-match slot recovery can still be explicitly allowed to overwrite", () => {
  assert.equal(
    shouldApplyPreviousMatchSlotRecovery({
      currentAssignedCount: 2,
      needsSync: true,
      allowOverwriteExistingSlots: true,
    }),
    true,
  );
});

test("previous-match slot recovery ignores no-op dry-run plans", () => {
  assert.equal(
    shouldApplyPreviousMatchSlotRecovery({
      currentAssignedCount: 0,
      needsSync: false,
    }),
    false,
  );
});

test("previous match numbers are normalized for recovery metadata", () => {
  assert.equal(normalizePreviousMatchNumber("4"), 4);
  assert.equal(normalizePreviousMatchNumber(null), null);
  assert.equal(normalizePreviousMatchNumber("not-a-number"), null);
});
