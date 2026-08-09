"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  MAX_INPUT_BYTES,
  formatInventory,
  parseInventoryJson,
} = require("./parse-production-entitlement-inventory.cjs");

const ROOT = path.resolve(__dirname, "..");
const SQL_PATH = path.join(
  ROOT,
  "infra",
  "sql",
  "production-entitlement-inventory.sql",
);
const DOCUMENTATION_PATH = path.join(
  ROOT,
  "docs",
  "codex",
  "PRODUCTION_ENTITLEMENT_INVENTORY.md",
);
const FIXTURE_PATH = path.join(
  __dirname,
  "test-fixtures",
  "production-entitlement-inventory.valid.json",
);
const PARSER_PATH = path.join(
  __dirname,
  "parse-production-entitlement-inventory.cjs",
);

const fixtureText = fs.readFileSync(FIXTURE_PATH, "utf8");
const fixture = JSON.parse(fixtureText);

function cloneFixture() {
  return JSON.parse(JSON.stringify(fixture));
}

function collectLeaves(value, keys = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [{ keys, value }];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    collectLeaves(child, [...keys, key]),
  );
}

test("accepts the exact aggregate fixture and emits stable sanitized JSON", () => {
  const parsed = parseInventoryJson(fixtureText);
  assert.deepEqual(parsed, fixture);
  assert.equal(formatInventory(parsed), fixtureText);

  const result = spawnSync(process.execPath, [PARSER_PATH], {
    input: fixtureText,
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, fixtureText);
});

test("fixture and sanitized output contain counts only", () => {
  const leaves = collectLeaves(fixture);
  assert.ok(leaves.length > 0);
  for (const { keys, value } of leaves) {
    assert.equal(typeof value, "number", keys.join("."));
    assert.ok(Number.isSafeInteger(value), keys.join("."));
    assert.ok(value >= 0, keys.join("."));
  }

  const forbiddenKey =
    /^(?:id|name|slug|email|password|token|credential|secret|connectionString)$/i;
  for (const { keys } of leaves) {
    assert.equal(
      keys.some((key) => forbiddenKey.test(key)),
      false,
      keys.join("."),
    );
  }
});

test("rejects unexpected fields without reflecting their name or value", () => {
  const withPrivateField = cloneFixture();
  withPrivateField.organizations.email = "private-person@example.invalid";
  assert.throws(
    () => parseInventoryJson(JSON.stringify(withPrivateField)),
    /unexpected object shape/,
  );

  const result = spawnSync(process.execPath, [PARSER_PATH], {
    input: JSON.stringify(withPrivateField),
    encoding: "utf8",
    env: {},
  });
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stderr, /email/i);
  assert.doesNotMatch(result.stderr, /private-person/i);
  assert.equal(result.stdout, "");
});

test("rejects malformed, multiple, oversized, and invalid UTF-8 input", () => {
  for (const input of [
    "",
    "null",
    "[]",
    "{}",
    `${fixtureText}${fixtureText}`,
    `${fixtureText} trailing`,
  ]) {
    assert.throws(() => parseInventoryJson(input));
  }
  assert.throws(
    () => parseInventoryJson(" ".repeat(MAX_INPUT_BYTES + 1)),
    /maximum aggregate size/,
  );

  const oversized = spawnSync(process.execPath, [PARSER_PATH], {
    input: Buffer.alloc(MAX_INPUT_BYTES + 1, 0x20),
    encoding: "utf8",
    env: {},
  });
  assert.equal(oversized.status, 2);
  assert.match(oversized.stderr, /maximum aggregate size/);

  const invalidUtf8 = spawnSync(process.execPath, [PARSER_PATH], {
    input: Buffer.from([0xff]),
    encoding: "utf8",
    env: {},
  });
  assert.equal(invalidUtf8.status, 2);
  assert.match(invalidUtf8.stderr, /valid UTF-8/);
});

test("rejects wrong versions, types, negative values, and unsafe integers", () => {
  for (const mutate of [
    (value) => {
      value.schemaVersion = 2;
    },
    (value) => {
      value.organizations.total = "12";
    },
    (value) => {
      value.organizations.total = -1;
    },
    (value) => {
      value.organizations.total = 1.5;
    },
    (value) => {
      value.organizations.total = Number.MAX_SAFE_INTEGER + 1;
    },
    (value) => {
      value.ownerReferences = [];
    },
  ]) {
    const candidate = cloneFixture();
    mutate(candidate);
    assert.throws(() => parseInventoryJson(JSON.stringify(candidate)));
  }
});

test("rejects every inconsistent aggregate partition", () => {
  const mutations = [
    (value) => value.organizations.total++,
    (value) => value.organizations.approvedAndActive++,
    (value) => value.nonDeletedOrganizationStatus.pending++,
    (value) => value.nonDeletedIsActive.inactive++,
    (value) => value.nonDeletedSubscriptionStatus.active++,
    (value) => value.nonDeletedPaidUntil.null++,
    (value) => value.nonDeletedTrialEndsAt.future++,
    (value) => value.nonDeletedTrialDates.invalidOrder++,
    (value) => value.activeState.paidUntilNull++,
    (value) => value.trialingState.valid++,
    (value) => value.expiredState.paidUntilExpired++,
    (value) => value.expiredState.trialEndsAtFuture++,
    (value) => value.nonDeletedPlans.nonNull++,
    (value) => value.nonDeletedPlans.legacyOrUnknown++,
    (value) => value.ownerReferences.linked++,
    (value) => (value.ownerAnomalies.linkedOwnerDeleted = 9),
    (value) => value.clockBoundedAccessCandidate.organizationBlocked++,
    (value) => (value.clockBoundedAccessCandidate.activePaidUntilFuture = 3),
  ];

  for (const mutate of mutations) {
    const candidate = cloneFixture();
    mutate(candidate);
    assert.throws(
      () => parseInventoryJson(JSON.stringify(candidate)),
      /Aggregate consistency check failed/,
    );
  }
});

test("reviewed SQL is transaction-read-only, bounded, and one aggregate JSON result", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  assert.match(
    sql,
    /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/,
  );
  assert.match(sql, /SET LOCAL statement_timeout = '15s';/);
  assert.match(sql, /SET LOCAL lock_timeout = '2s';/);
  assert.match(sql, /SET LOCAL idle_in_transaction_session_timeout = '20s';/);
  assert.match(sql, /transaction_timestamp\(\) AT TIME ZONE 'UTC'/);
  assert.match(sql, /SELECT json_build_object\(/);
  assert.match(sql, /FROM classified;\s*\n\s*COMMIT;/);
  assert.equal((sql.match(/SELECT json_build_object\(/g) ?? []).length, 1);
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT|UPDATE|UPSERT|MERGE|ALTER|DROP|CREATE|TRUNCATE|COPY|CALL|DO)\b/i,
  );
  assert.doesNotMatch(
    sql,
    /\b(?:array_agg|string_agg|json_agg|jsonb_agg|json_object_agg|jsonb_object_agg|row_to_json)\b/i,
  );
  assert.doesNotMatch(sql, /\bGROUP\s+BY\b/i);
});

test("reviewed SQL cannot emit forbidden row fields or arbitrary plan values", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  for (const forbiddenColumn of [
    "name",
    "slug",
    "email",
    "password",
    "broadcastKey",
    "kycNote",
    "deletedBy",
  ]) {
    assert.doesNotMatch(
      sql,
      new RegExp(`"${forbiddenColumn}"`, "i"),
      forbiddenColumn,
    );
  }
  assert.doesNotMatch(
    sql,
    /'(?:id|name|slug|email|password|token|credential|secret|connectionString)'\s*,/i,
  );
  assert.doesNotMatch(sql, /plan_id\s+AS\s+/i);
  assert.doesNotMatch(sql, /json_build_object\([^)]*plan_id/is);

  for (const canonicalPlan of [
    "discord-basic",
    "discord-ops",
    "production",
    "sports-production",
    "multi-game-production",
    "pubg-auto-launcher",
  ]) {
    assert.match(sql, new RegExp(`'${canonicalPlan}'`));
  }
  assert.match(sql, /'legacyOrUnknown'/);

  const identifierLines = sql
    .split(/\r?\n/)
    .filter((line) => /\."id"/.test(line));
  assert.deepEqual(
    identifierLines.map((line) => line.trim()),
    [
      'owner."id" IS NOT NULL AS owner_row_present,',
      'owner."organizationId" IS NOT DISTINCT FROM o."id"',
      'LEFT JOIN "User" AS owner ON owner."id" = o."ownerUserId"',
    ],
  );
});

test("documented production invocation is clean-parent, strict-SSH, and fileless", () => {
  const documentation = fs.readFileSync(DOCUMENTATION_PATH, "utf8");
  assert.match(documentation, /env -i \\\n[\s\S]*bash --noprofile --norc/);
  assert.match(
    documentation,
    /'env -i PATH=[^']+ HOME=\/root bash --noprofile --norc -ceu /,
  );
  for (const boundary of [
    "BatchMode=yes",
    "CheckHostIP=yes",
    "ClearAllForwardings=yes",
    "ForwardAgent=no",
    "GlobalKnownHostsFile=/dev/null",
    "IdentitiesOnly=yes",
    "StrictHostKeyChecking=yes",
    'UserKnownHostsFile="$known_hosts"',
    "git --no-optional-locks status --porcelain=v1 --untracked-files=all",
    "scripts/verify-production-release-source.cjs --check-checkout-only",
    "scripts/verify-production-database-container.sh",
    'docker exec -i "${database_binding[0]}"',
    "default_transaction_read_only=on",
    '< "$inventory_sql"',
    'node "$inventory_parser"',
  ]) {
    assert.ok(documentation.includes(boundary), boundary);
  }
  assert.doesNotMatch(documentation, /\b(?:scp|sftp)\b/);
});
