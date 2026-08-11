#!/usr/bin/env node
"use strict";

const COUNT_FIELDS = Object.freeze([
  "organizationCount",
  "activeCount",
  "activeInconsistentCount",
  "activeMissingPaidCount",
  "activeTrialPresentCount",
  "trialingCount",
  "trialingInconsistentCount",
  "expiredCount",
  "expiredInconsistentCount",
  "unknownStatusCount",
]);

function parseCount(value, label) {
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

function parseEntitlementCounts(values) {
  if (!Array.isArray(values) || values.length !== COUNT_FIELDS.length) {
    throw new Error(
      `Expected exactly ${COUNT_FIELDS.length} entitlement aggregate counts.`,
    );
  }
  return Object.fromEntries(
    COUNT_FIELDS.map((field, index) => [
      field,
      parseCount(values[index], field),
    ]),
  );
}

function verifyEntitlementInvariants(
  counts,
  { allowLegacyActiveStaleTrial = false } = {},
) {
  const stateCount =
    counts.activeCount +
    counts.trialingCount +
    counts.expiredCount +
    counts.unknownStatusCount;
  if (stateCount !== counts.organizationCount) {
    return {
      ok: false,
      reason: "aggregate-state-count-mismatch",
      counts,
    };
  }
  if (
    counts.activeInconsistentCount > counts.activeCount ||
    counts.activeMissingPaidCount > counts.activeCount ||
    counts.activeTrialPresentCount > counts.activeCount ||
    counts.trialingInconsistentCount > counts.trialingCount ||
    counts.expiredInconsistentCount > counts.expiredCount
  ) {
    return {
      ok: false,
      reason: "aggregate-inconsistent-count-exceeds-state-count",
      counts,
    };
  }
  if (
    counts.activeInconsistentCount <
      Math.max(
        counts.activeMissingPaidCount,
        counts.activeTrialPresentCount,
      ) ||
    counts.activeInconsistentCount >
      counts.activeMissingPaidCount + counts.activeTrialPresentCount
  ) {
    return {
      ok: false,
      reason: "aggregate-active-inconsistency-breakdown-mismatch",
      counts,
    };
  }

  const inconsistentCount =
    counts.activeInconsistentCount +
    counts.trialingInconsistentCount +
    counts.expiredInconsistentCount +
    counts.unknownStatusCount;
  if (inconsistentCount !== 0) {
    if (
      allowLegacyActiveStaleTrial &&
      counts.activeInconsistentCount > 0 &&
      counts.activeMissingPaidCount === 0 &&
      counts.activeTrialPresentCount === counts.activeInconsistentCount &&
      counts.trialingInconsistentCount === 0 &&
      counts.expiredInconsistentCount === 0 &&
      counts.unknownStatusCount === 0
    ) {
      return {
        ok: true,
        reason: "legacy-active-stale-trial-reconcile-pending",
        inconsistentCount,
        legacyActiveStaleTrialReconcilePending:
          counts.activeInconsistentCount,
        counts,
      };
    }
    return {
      ok: false,
      reason: "inconsistent-production-entitlements",
      inconsistentCount,
      counts,
    };
  }
  return {
    ok: true,
    reason: "canonical-entitlement-counts-zero",
    inconsistentCount: 0,
    counts,
  };
}

function flagValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index === process.argv.length - 1) {
    throw new Error(`${name} requires a value.`);
  }
  return process.argv[index + 1];
}

function countsFromFlags() {
  return parseEntitlementCounts(
    COUNT_FIELDS.map((field) =>
      flagValue(
        `--${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      ),
    ),
  );
}

function countSummary(counts) {
  return (
    `organizations=${counts.organizationCount} ` +
    `active=${counts.activeCount} ` +
    `active_inconsistent=${counts.activeInconsistentCount} ` +
    `active_missing_paid=${counts.activeMissingPaidCount} ` +
    `active_trial_present=${counts.activeTrialPresentCount} ` +
    `trialing=${counts.trialingCount} ` +
    `trialing_inconsistent=${counts.trialingInconsistentCount} ` +
    `expired=${counts.expiredCount} ` +
    `expired_inconsistent=${counts.expiredInconsistentCount} ` +
    `unknown_status=${counts.unknownStatusCount}`
  );
}

function main() {
  const result = verifyEntitlementInvariants(countsFromFlags(), {
    allowLegacyActiveStaleTrial: process.argv.includes(
      "--allow-legacy-active-stale-trial",
    ),
  });
  if (!result.ok) {
    process.stderr.write(
      `ENTITLEMENT INVARIANT GATE BLOCKED reason=${result.reason} ` +
        `${countSummary(result.counts)}\n` +
        "Use the reviewed reconciliation procedure in docs/product/MANUAL_BILLING_RUNBOOK.md. " +
        "This gate did not update or identify any organization.\n",
    );
    process.exitCode = 75;
    return;
  }
  process.stdout.write(
    `ENTITLEMENT INVARIANT GATE PASSED reason=${result.reason} ` +
      `${countSummary(result.counts)} inconsistent=${result.inconsistentCount} ` +
      `legacy_active_stale_trial_reconcile_pending=${result.legacyActiveStaleTrialReconcilePending ?? 0}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `ENTITLEMENT INVARIANT GATE ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}

module.exports = {
  COUNT_FIELDS,
  parseCount,
  parseEntitlementCounts,
  verifyEntitlementInvariants,
};
