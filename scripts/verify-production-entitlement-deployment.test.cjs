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

test("deployment inventory validates counts without blocking natural clock expiry", () => {
  assert.deepEqual(assertDeploymentEntitlements(policyInventory()), {
    activePaidUntilNull: 0,
    activePaidUntilExpired: 0,
    trialingInvalid: 0,
    legacyOrUnknownSubscription: 0,
  });
  for (const key of Object.keys(deploymentDenials(policyInventory()))) {
    assert.equal(
      assertDeploymentEntitlements(policyInventory({ [key]: 1 }))[key],
      1,
      key,
    );
  }
});

test("observed-shape fixture reports clock inventory without mutation", () => {
  const gatePath = path.join(
    __dirname,
    "verify-production-entitlement-deployment.cjs",
  );
  const result = spawnSync(process.execPath, [gatePath], {
    input: JSON.stringify(fixture),
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /ENTITLEMENT CLOCK INVENTORY OBSERVED/);
  assert.match(result.stdout, /active_missing_clock=2/);
  assert.match(result.stdout, /active_expired_clock=1/);
  assert.match(result.stdout, /trialing_invalid=1/);
  assert.match(result.stdout, /legacy_unknown=1/);
  assert.match(result.stdout, /Runtime access remains clock-bounded/);
  assert.match(result.stdout, /no customer state was changed/i);
});

test("malformed deployment inventory still fails closed", () => {
  assert.throws(
    () =>
      assertDeploymentEntitlements(
        policyInventory({ activePaidUntilExpired: -1 }),
      ),
    /counts are invalid/,
  );
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
