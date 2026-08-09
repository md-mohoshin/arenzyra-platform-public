#!/usr/bin/env node
"use strict";

const {
  parseInventoryJson,
  readBoundedStdin,
} = require("./parse-production-entitlement-inventory.cjs");

function deploymentDenials(inventory) {
  const access = inventory?.clockBoundedAccessCandidate;
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    throw new Error("Entitlement inventory was not parsed before policy review.");
  }
  return {
    activePaidUntilNull: access.activePaidUntilNull,
    activePaidUntilExpired: access.activePaidUntilExpired,
    trialingInvalid: access.trialingInvalid,
    legacyOrUnknownSubscription: access.legacyOrUnknownSubscription,
  };
}

function assertDeploymentEntitlements(inventory) {
  const denials = deploymentDenials(inventory);
  for (const count of Object.values(denials)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Entitlement deployment counts are invalid.");
    }
  }
  if (Object.values(denials).some((count) => count !== 0)) {
    const error = new Error(
      "Clock-bounded customer disposition is incomplete; no customer state was changed.",
    );
    error.denials = denials;
    throw error;
  }
  return denials;
}

async function main(argv = process.argv.slice(2), stream = process.stdin) {
  if (argv.length !== 0) {
    throw new Error("This deployment gate accepts no arguments.");
  }
  const inventory = parseInventoryJson(await readBoundedStdin(stream));
  const denials = assertDeploymentEntitlements(inventory);
  process.stdout.write(
    `ENTITLEMENT DEPLOYMENT GATE PASSED active_missing_clock=${denials.activePaidUntilNull} active_expired_clock=${denials.activePaidUntilExpired} trialing_invalid=${denials.trialingInvalid} legacy_unknown=${denials.legacyOrUnknownSubscription}\n`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    const denials = error?.denials;
    if (denials) {
      process.stderr.write(
        `ENTITLEMENT DEPLOYMENT GATE BLOCKED active_missing_clock=${denials.activePaidUntilNull} active_expired_clock=${denials.activePaidUntilExpired} trialing_invalid=${denials.trialingInvalid} legacy_unknown=${denials.legacyOrUnknownSubscription}. No customer state was changed.\n`,
      );
    } else {
      process.stderr.write(
        "ENTITLEMENT DEPLOYMENT GATE BLOCKED: aggregate evidence is invalid. No customer state was changed.\n",
      );
    }
    process.exitCode = 75;
  });
}

module.exports = {
  assertDeploymentEntitlements,
  deploymentDenials,
  main,
};
