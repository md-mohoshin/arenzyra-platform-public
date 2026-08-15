"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  parseInventory,
  requireZeroInventory,
  RETIRED_WIDGET_KEYS,
} = require("./inspect-production-retired-widget-inventory.cjs");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const parserPath = path.join(
  root,
  "scripts",
  "inspect-production-retired-widget-inventory.cjs",
);

function inventoryRow(widgetKey, overrides = {}) {
  return {
    widgetKey,
    widgetInstances: 0,
    activeWidgetInstances: 0,
    approvalRows: 0,
    approvedRows: 0,
    ...overrides,
  };
}

function sampleInventory() {
  return {
    schemaVersion: 1,
    retiredWidgets: RETIRED_WIDGET_KEYS.map((widgetKey) =>
      inventoryRow(widgetKey),
    ),
  };
}

test("accepts only the exact seven-key aggregate inventory", () => {
  const sample = sampleInventory();
  sample.retiredWidgets[0] = inventoryRow("style.focal", {
    widgetInstances: 3,
    activeWidgetInstances: 2,
    approvalRows: 4,
    approvedRows: 1,
  });
  assert.deepEqual(parseInventory(JSON.stringify(sample)), sample);

  const extraField = structuredClone(sample);
  extraField.retiredWidgets[0].organizationId = "private";
  assert.throws(
    () => parseInventory(JSON.stringify(extraField)),
    /unexpected shape/,
  );

  const reordered = structuredClone(sample);
  [reordered.retiredWidgets[0], reordered.retiredWidgets[1]] = [
    reordered.retiredWidgets[1],
    reordered.retiredWidgets[0],
  ];
  assert.throws(() => parseInventory(JSON.stringify(reordered)), /reordered/);
});

test("rejects invalid or internally inconsistent aggregate counts", () => {
  for (const [field, value, expected] of [
    ["widgetInstances", -1, /invalid count/],
    ["approvalRows", 0.5, /invalid count/],
    ["activeWidgetInstances", 1, /exceeds its instance count/],
    ["approvedRows", 1, /exceeds its approval-row count/],
  ]) {
    const sample = sampleInventory();
    sample.retiredWidgets[0][field] = value;
    assert.throws(() => parseInventory(JSON.stringify(sample)), expected);
  }
});

test("zero-required mode blocks every nonzero retired-widget aggregate", () => {
  const zero = sampleInventory();
  assert.deepEqual(
    requireZeroInventory(parseInventory(JSON.stringify(zero))),
    zero,
  );

  for (const countKey of [
    "widgetInstances",
    "activeWidgetInstances",
    "approvalRows",
    "approvedRows",
  ]) {
    const sample = sampleInventory();
    const row = sample.retiredWidgets[4];
    if (countKey === "activeWidgetInstances") row.widgetInstances = 1;
    if (countKey === "approvedRows") row.approvalRows = 1;
    row[countKey] = 1;
    assert.throws(
      () => requireZeroInventory(parseInventory(JSON.stringify(sample))),
      /player-card/,
    );
  }
});

test("zero-required CLI has a closed argument and output contract", () => {
  const accepted = spawnSync(process.execPath, [parserPath, "--require-zero"], {
    input: JSON.stringify(sampleInventory()),
    encoding: "utf8",
    maxBuffer: 16 * 1024,
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(
    accepted.stdout,
    "RETIRED WIDGET ZERO INVENTORY VERIFIED keys=7\n",
  );

  const nonzero = sampleInventory();
  nonzero.retiredWidgets[6].approvalRows = 1;
  const blocked = spawnSync(process.execPath, [parserPath, "--require-zero"], {
    input: JSON.stringify(nonzero),
    encoding: "utf8",
    maxBuffer: 16 * 1024,
  });
  assert.equal(blocked.status, 75);
  assert.match(blocked.stderr, /winner/);
  assert.doesNotMatch(blocked.stderr, /organization|capability|token/i);

  const unsupported = spawnSync(process.execPath, [parserPath, "--unknown"], {
    input: JSON.stringify(sampleInventory()),
    encoding: "utf8",
    maxBuffer: 16 * 1024,
  });
  assert.equal(unsupported.status, 75);
  assert.match(unsupported.stderr, /unsupported arguments/);
});

test("production inspection is fixed-key, read-only, bounded, and separately allowlisted", () => {
  const sql = read("infra/sql/production-retired-widget-inventory.sql");
  const wrapper = read("scripts/inspect-production-retired-widget-inventory.sh");
  const parser = read("scripts/inspect-production-retired-widget-inventory.cjs");
  const zeroGate = read(
    "scripts/verify-production-retired-widget-zero-inventory.sh",
  );
  const dispatcher = read("scripts/production-reviewed-entrypoint.sh");
  const metadata = read("scripts/create-publish-release-metadata.cjs");
  const deploy = read("scripts/deploy-production.sh");

  assert.match(sql, /REPEATABLE READ READ ONLY/);
  assert.match(sql, /FROM "WidgetInstance"/);
  assert.match(sql, /FROM "OrganizationWidgetApproval"/);
  assert.match(sql, /count\(\*\) FILTER \(WHERE instance_row\."isActive"\)/);
  assert.match(sql, /count\(\*\) FILTER \(WHERE approval_row\."isApproved"\)/);
  for (const widgetKey of RETIRED_WIDGET_KEYS) {
    assert.equal(sql.match(new RegExp(`'${widgetKey}'`, "g"))?.length, 1);
  }
  assert.doesNotMatch(
    sql,
    /"(?:id|key|organizationId|tournamentId|matchId|capabilityHash|capabilityPrefix|approvedBy|approvedAt)"/,
  );
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);

  assert.match(wrapper, /\[ "\$#" -eq 0 \]/);
  assert.match(wrapper, /default_transaction_read_only=on/);
  assert.match(wrapper, /verify-production-database-container\.sh/);
  assert.match(wrapper, /production-retired-widget-inventory\.sql/);
  assert.doesNotMatch(
    wrapper,
    /docker\s+(?:compose|run|pull|restart|start|stop|rm)\b/,
  );
  assert.match(parser, /MAX_INPUT_BYTES = 4 \* 1024/);
  assert.match(parser, /--require-zero/);
  assert.match(zeroGate, /inspect-production-retired-widget-inventory\.sh/);
  assert.match(zeroGate, /--require-zero/);
  assert.doesNotMatch(
    zeroGate,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|docker|psql)\b/i,
  );
  assert.match(
    dispatcher,
    /retired-widget-inventory\)[\s\S]*accepts no arguments[\s\S]*require_nested_assembly[\s\S]*inspect-production-retired-widget-inventory\.sh/,
  );
  assert.match(metadata, /infra\/sql\/production-retired-widget-inventory\.sql/);
  assert.match(
    deploy,
    /verify_production_activation_boundary\(\)[\s\S]*?MODE" = "full"[\s\S]*?MODE" = "api-recovery"[\s\S]*?verify-production-retired-widget-zero-inventory\.sh/,
  );
  const fullBuild = deploy.indexOf('"${compose[@]}" build api media-ai web');
  const capacity = deploy.indexOf(
    "bash scripts/prepare-production-deploy-capacity.sh",
  );
  const preCapacityBoundary = deploy.lastIndexOf(
    "verify_production_activation_boundary",
    capacity,
  );
  const fullActivation = deploy.indexOf(
    '"${compose[@]}" up --no-build -d --pull never --no-deps',
    fullBuild,
  );
  const preBuildBoundary = deploy.lastIndexOf(
    "verify_production_activation_boundary",
    fullBuild,
  );
  const finalBoundary = deploy.lastIndexOf(
    "verify_production_activation_boundary",
    fullActivation,
  );
  const finalPreflight = deploy.lastIndexOf(
    'bash scripts/production-deploy-preflight.sh "${guard_args[@]}"',
    fullActivation,
  );
  const finalHealth = deploy.indexOf('wait_for_health "${services[@]}"');
  const postHealthBoundary = deploy.indexOf(
    "verify_production_activation_boundary",
    finalHealth,
  );
  assert.ok(
    capacity >= 0 &&
      preCapacityBoundary >= 0 &&
      preCapacityBoundary < capacity,
  );
  assert.ok(fullBuild >= 0 && fullActivation > fullBuild);
  assert.ok(preBuildBoundary >= 0 && preBuildBoundary < fullBuild);
  assert.ok(finalBoundary > fullBuild && finalBoundary < finalPreflight);
  assert.ok(finalPreflight < fullActivation);
  assert.ok(finalHealth > fullActivation && postHealthBoundary > finalHealth);
});
