"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  assertDeploymentEntitlements,
  deploymentDenials,
} = require("./verify-production-entitlement-deployment.cjs");

const root = path.resolve(__dirname, "..");
const fixturePath = path.join(
  __dirname,
  "test-fixtures",
  "production-entitlement-inventory.valid.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function policyInventory(overrides = {}) {
  return {
    clockBoundedAccessCandidate: {
      activePaidUntilNull: 0,
      activePaidUntilExpired: 0,
      trialingInvalid: 0,
      legacyOrUnknownSubscription: 0,
      ...overrides,
    },
  };
}

test("deployment policy permits only zero unresolved clock denials", () => {
  assert.deepEqual(assertDeploymentEntitlements(policyInventory()), {
    activePaidUntilNull: 0,
    activePaidUntilExpired: 0,
    trialingInvalid: 0,
    legacyOrUnknownSubscription: 0,
  });
  for (const key of Object.keys(deploymentDenials(policyInventory()))) {
    assert.throws(
      () => assertDeploymentEntitlements(policyInventory({ [key]: 1 })),
      /customer disposition is incomplete/,
      key,
    );
  }
});

test("observed-shape fixture remains mechanically blocked without mutation", () => {
  const gatePath = path.join(
    __dirname,
    "verify-production-entitlement-deployment.cjs",
  );
  const result = spawnSync(process.execPath, [gatePath], {
    input: JSON.stringify(fixture),
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 75);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /ENTITLEMENT DEPLOYMENT GATE BLOCKED/);
  assert.match(result.stderr, /active_missing_clock=2/);
  assert.match(result.stderr, /active_expired_clock=1/);
  assert.match(result.stderr, /trialing_invalid=1/);
  assert.match(result.stderr, /legacy_unknown=1/);
  assert.match(result.stderr, /No customer state was changed/);
});

test("production invariant wrapper streams the exact reviewed inventory", () => {
  const wrapper = fs.readFileSync(
    path.join(root, "scripts", "verify-production-entitlement-invariants.sh"),
    "utf8",
  );
  assert.match(wrapper, /infra\/sql\/production-entitlement-inventory\.sql/);
  assert.match(wrapper, /parse-production-entitlement-inventory\.cjs/);
  assert.match(wrapper, /verify-production-entitlement-deployment\.cjs/);
  assert.match(wrapper, /default_transaction_read_only=on/);
  assert.doesNotMatch(wrapper, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
});
