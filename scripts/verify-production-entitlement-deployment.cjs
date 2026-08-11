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
  return denials;
}

async function main(argv = process.argv.slice(2), stream = process.stdin) {
  if (argv.length !== 0) {
    throw new Error("This deployment gate accepts no arguments.");
  }
  const inventory = parseInventoryJson(await readBoundedStdin(stream));
  const denials = assertDeploymentEntitlements(inventory);
  process.stdout.write(
    `ENTITLEMENT CLOCK INVENTORY OBSERVED active_missing_clock=${denials.activePaidUntilNull} active_expired_clock=${denials.activePaidUntilExpired} trialing_invalid=${denials.trialingInvalid} legacy_unknown=${denials.legacyOrUnknownSubscription}. Runtime access remains clock-bounded; no customer state was changed.\n`,
  );
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(
      "ENTITLEMENT DEPLOYMENT GATE BLOCKED: aggregate evidence is invalid. No customer state was changed.\n",
    );
    process.exitCode = 75;
  });
}

module.exports = {
  assertDeploymentEntitlements,
  deploymentDenials,
  main,
};
