"use strict";

function normalizePreviousMatchNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldApplyPreviousMatchSlotRecovery(options = {}) {
  const currentAssignedCount = Number(options.currentAssignedCount ?? 0) || 0;
  const needsSync = options.needsSync === true;
  const allowOverwriteExistingSlots =
    options.allowOverwriteExistingSlots === true;

  return (
    needsSync &&
    (currentAssignedCount <= 0 || allowOverwriteExistingSlots === true)
  );
}

module.exports = {
  normalizePreviousMatchNumber,
  shouldApplyPreviousMatchSlotRecovery,
};
