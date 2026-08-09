#!/usr/bin/env node
"use strict";

const { TextDecoder } = require("node:util");

const MAX_INPUT_BYTES = 64 * 1024;
const COUNT = Symbol("aggregate-count");

const INVENTORY_SHAPE = Object.freeze({
  schemaVersion: 1,
  organizations: {
    total: COUNT,
    deleted: COUNT,
    nonDeleted: COUNT,
    approvedAndActive: COUNT,
    notApprovedOrInactive: COUNT,
  },
  nonDeletedOrganizationStatus: {
    pending: COUNT,
    approved: COUNT,
    suspended: COUNT,
    legacyOrUnknown: COUNT,
  },
  nonDeletedIsActive: {
    active: COUNT,
    inactive: COUNT,
    legacyOrUnknown: COUNT,
  },
  nonDeletedSubscriptionStatus: {
    active: COUNT,
    trialing: COUNT,
    expired: COUNT,
    legacyOrUnknown: COUNT,
  },
  nonDeletedPaidUntil: {
    null: COUNT,
    future: COUNT,
    expired: COUNT,
  },
  nonDeletedTrialEndsAt: {
    null: COUNT,
    future: COUNT,
    expired: COUNT,
  },
  nonDeletedTrialDates: {
    bothMissing: COUNT,
    startOnly: COUNT,
    endOnly: COUNT,
    orderedAndStarted: COUNT,
    orderedWithFutureStart: COUNT,
    invalidOrder: COUNT,
  },
  activeState: {
    paidUntilNull: COUNT,
    paidUntilFuture: COUNT,
    paidUntilExpired: COUNT,
    trialStartedAtPresent: COUNT,
    trialEndsAtPresent: COUNT,
  },
  trialingState: {
    valid: COUNT,
    expired: COUNT,
    missingDates: COUNT,
    paidUntilPresentWithCompleteDates: COUNT,
    invalidOrderOrFutureStart: COUNT,
    anyPaidUntilPresent: COUNT,
  },
  expiredState: {
    paidUntilNull: COUNT,
    paidUntilFuture: COUNT,
    paidUntilExpired: COUNT,
    trialEndsAtNull: COUNT,
    trialEndsAtFuture: COUNT,
    trialEndsAtExpired: COUNT,
    trialStartedAtPresent: COUNT,
  },
  nonDeletedPlans: {
    null: COUNT,
    nonNull: COUNT,
    discordBasic: COUNT,
    discordOps: COUNT,
    production: COUNT,
    sportsProduction: COUNT,
    multiGameProduction: COUNT,
    pubgAutoLauncher: COUNT,
    legacyOrUnknown: COUNT,
  },
  ownerReferences: {
    missing: COUNT,
    linked: COUNT,
    dangling: COUNT,
  },
  ownerAnomalies: {
    linkedOwnerDeleted: COUNT,
    linkedOwnerNotActive: COUNT,
    linkedOwnerOrganizationMismatch: COUNT,
  },
  clockBoundedAccessCandidate: {
    organizationBlocked: COUNT,
    activePaidUntilFuture: COUNT,
    activePaidUntilNull: COUNT,
    activePaidUntilExpired: COUNT,
    trialingValid: COUNT,
    trialingInvalid: COUNT,
    expired: COUNT,
    legacyOrUnknownSubscription: COUNT,
  },
});

function fail(reason) {
  throw new Error(reason);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeAgainstShape(value, shape, path = "inventory") {
  if (shape === COUNT) {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      fail(`${path} must be a non-negative safe integer.`);
    }
    return value;
  }
  if (typeof shape === "number") {
    if (value !== shape) {
      fail(`${path} has an unsupported value.`);
    }
    return shape;
  }
  if (!isRecord(value)) {
    fail(`${path} must be an object.`);
  }

  const expectedKeys = Object.keys(shape);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(value, key))
  ) {
    // Do not include an unexpected key in the error. It could itself contain
    // private production data.
    fail(`${path} has an unexpected object shape.`);
  }

  const sanitized = {};
  for (const key of expectedKeys) {
    sanitized[key] = sanitizeAgainstShape(
      value[key],
      shape[key],
      `${path}.${key}`,
    );
  }
  return sanitized;
}

function sum(object, keys = Object.keys(object)) {
  return keys.reduce((total, key) => total + object[key], 0);
}

function assertEqual(actual, expected, rule) {
  if (actual !== expected) {
    fail(`Aggregate consistency check failed: ${rule}.`);
  }
}

function assertAtMost(actual, maximum, rule) {
  if (actual > maximum) {
    fail(`Aggregate consistency check failed: ${rule}.`);
  }
}

function assertAtLeast(actual, minimum, rule) {
  if (actual < minimum) {
    fail(`Aggregate consistency check failed: ${rule}.`);
  }
}

function validateConsistency(inventory) {
  const organizations = inventory.organizations;
  const nonDeleted = organizations.nonDeleted;
  const organizationStatus = inventory.nonDeletedOrganizationStatus;
  const isActive = inventory.nonDeletedIsActive;
  const subscription = inventory.nonDeletedSubscriptionStatus;
  const active = inventory.activeState;
  const trialing = inventory.trialingState;
  const expired = inventory.expiredState;
  const plans = inventory.nonDeletedPlans;
  const ownerReferences = inventory.ownerReferences;
  const access = inventory.clockBoundedAccessCandidate;

  assertEqual(
    organizations.deleted + nonDeleted,
    organizations.total,
    "organization deletion partition",
  );
  assertEqual(
    organizations.approvedAndActive + organizations.notApprovedOrInactive,
    nonDeleted,
    "organization access-state partition",
  );
  assertEqual(
    sum(organizationStatus),
    nonDeleted,
    "organization status partition",
  );
  assertEqual(sum(isActive), nonDeleted, "isActive partition");
  assertAtMost(
    organizations.approvedAndActive,
    organizationStatus.approved,
    "approved-and-active count versus approved status",
  );
  assertAtMost(
    organizations.approvedAndActive,
    isActive.active,
    "approved-and-active count versus active flag",
  );
  assertAtLeast(
    organizations.approvedAndActive,
    Math.max(0, organizationStatus.approved + isActive.active - nonDeleted),
    "approved-and-active intersection lower bound",
  );

  assertEqual(sum(subscription), nonDeleted, "subscription status partition");
  assertEqual(
    sum(inventory.nonDeletedPaidUntil),
    nonDeleted,
    "paidUntil clock partition",
  );
  assertEqual(
    sum(inventory.nonDeletedTrialEndsAt),
    nonDeleted,
    "trialEndsAt clock partition",
  );
  assertEqual(
    sum(inventory.nonDeletedTrialDates),
    nonDeleted,
    "trial date-shape partition",
  );

  assertEqual(
    active.paidUntilNull + active.paidUntilFuture + active.paidUntilExpired,
    subscription.active,
    "ACTIVE paidUntil partition",
  );
  assertAtMost(
    active.trialStartedAtPresent,
    subscription.active,
    "ACTIVE trialStartedAt count",
  );
  assertAtMost(
    active.trialEndsAtPresent,
    subscription.active,
    "ACTIVE trialEndsAt count",
  );

  assertEqual(
    trialing.valid +
      trialing.expired +
      trialing.missingDates +
      trialing.paidUntilPresentWithCompleteDates +
      trialing.invalidOrderOrFutureStart,
    subscription.trialing,
    "TRIALING deterministic classification",
  );
  assertAtMost(
    trialing.paidUntilPresentWithCompleteDates,
    trialing.anyPaidUntilPresent,
    "TRIALING complete-date paidUntil count",
  );
  assertAtMost(
    trialing.anyPaidUntilPresent,
    trialing.paidUntilPresentWithCompleteDates + trialing.missingDates,
    "TRIALING paidUntil and date-shape overlap",
  );

  assertEqual(
    expired.paidUntilNull + expired.paidUntilFuture + expired.paidUntilExpired,
    subscription.expired,
    "EXPIRED paidUntil partition",
  );
  assertEqual(
    expired.trialEndsAtNull +
      expired.trialEndsAtFuture +
      expired.trialEndsAtExpired,
    subscription.expired,
    "EXPIRED trialEndsAt partition",
  );
  assertAtMost(
    expired.trialStartedAtPresent,
    subscription.expired,
    "EXPIRED trialStartedAt count",
  );

  assertEqual(plans.null + plans.nonNull, nonDeleted, "plan null partition");
  assertEqual(
    plans.discordBasic +
      plans.discordOps +
      plans.production +
      plans.sportsProduction +
      plans.multiGameProduction +
      plans.pubgAutoLauncher +
      plans.legacyOrUnknown,
    plans.nonNull,
    "known and legacy plan partition",
  );

  assertEqual(sum(ownerReferences), nonDeleted, "owner reference partition");
  for (const count of Object.values(inventory.ownerAnomalies)) {
    assertAtMost(count, ownerReferences.linked, "linked-owner anomaly count");
  }

  assertEqual(
    access.organizationBlocked,
    organizations.notApprovedOrInactive,
    "blocked organization access count",
  );
  assertEqual(
    access.activePaidUntilFuture +
      access.activePaidUntilNull +
      access.activePaidUntilExpired +
      access.trialingValid +
      access.trialingInvalid +
      access.expired +
      access.legacyOrUnknownSubscription,
    organizations.approvedAndActive,
    "clock-bounded eligible-organization partition",
  );
  assertEqual(
    sum(access),
    nonDeleted,
    "clock-bounded access candidate partition",
  );
  assertAtMost(
    access.activePaidUntilFuture,
    active.paidUntilFuture,
    "eligible ACTIVE future paidUntil count",
  );
  assertAtMost(
    access.activePaidUntilNull,
    active.paidUntilNull,
    "eligible ACTIVE null paidUntil count",
  );
  assertAtMost(
    access.activePaidUntilExpired,
    active.paidUntilExpired,
    "eligible ACTIVE expired paidUntil count",
  );
  assertAtMost(
    access.trialingValid,
    trialing.valid,
    "eligible valid TRIALING count",
  );
  assertAtMost(
    access.trialingInvalid,
    subscription.trialing - trialing.valid,
    "eligible invalid TRIALING count",
  );
  assertAtMost(access.expired, subscription.expired, "eligible EXPIRED count");
  assertAtMost(
    access.legacyOrUnknownSubscription,
    subscription.legacyOrUnknown,
    "eligible unknown-subscription count",
  );
}

function parseInventoryJson(input) {
  if (typeof input !== "string") {
    fail("Inventory input must be UTF-8 text.");
  }
  if (Buffer.byteLength(input, "utf8") > MAX_INPUT_BYTES) {
    fail("Inventory input exceeds the maximum aggregate size.");
  }

  const trimmed = input.trim();
  if (!trimmed) {
    fail("Inventory input is empty.");
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    fail("Inventory input must contain exactly one valid JSON aggregate.");
  }
  const sanitized = sanitizeAgainstShape(parsed, INVENTORY_SHAPE);
  validateConsistency(sanitized);
  return sanitized;
}

function formatInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

async function readBoundedStdin(stream) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > MAX_INPUT_BYTES) {
      fail("Inventory input exceeds the maximum aggregate size.");
    }
    chunks.push(bytes);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, totalBytes),
    );
  } catch {
    fail("Inventory input must be valid UTF-8 text.");
  }
}

async function main() {
  const input = await readBoundedStdin(process.stdin);
  const inventory = parseInventoryJson(input);
  process.stdout.write(formatInventory(inventory));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `PRODUCTION ENTITLEMENT INVENTORY BLOCKED: ${
        error instanceof Error ? error.message : "Unexpected parser failure."
      }\n`,
    );
    process.exitCode = 2;
  });
}

module.exports = {
  INVENTORY_SHAPE,
  MAX_INPUT_BYTES,
  formatInventory,
  parseInventoryJson,
  sanitizeAgainstShape,
  validateConsistency,
};
