#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { parseResult } = require("./parse-production-stale-match-end.cjs");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("result parser accepts only the exact identifier-free recovery proof", () => {
  const expected = {
    schemaVersion: 1,
    organizationName: "Global Control",
    endedMatches: 2,
    resultFinalizationPerformed: false,
  };
  assert.deepEqual(parseResult(JSON.stringify(expected)), expected);
  assert.throws(
    () => parseResult(JSON.stringify({ ...expected, endedMatches: 3 })),
    /did not prove/,
  );
  assert.throws(
    () => parseResult(JSON.stringify({ ...expected, matchId: "secret" })),
    /did not prove/,
  );
});

test("recovery is exact, stale, transactional, and result-preserving", () => {
  const sql = read("infra/sql/production-end-stale-global-control-matches.sql");
  assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE/);
  assert.match(sql, /organization_row\.name = 'Global Control'/);
  assert.match(sql, /target_count <> 2 OR countdown_count <> 2 OR live_count <> 0/);
  assert.match(sql, /interval '15 minutes'/);
  assert.match(sql, /protected_count <> 2/);
  assert.match(sql, /protected_count <> 0/);
  assert.match(sql, /aggregate_protected_count <> 2/);
  assert.match(sql, /aggregate_protected_count <> 0/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /status = 'ENDED'::"MatchStatus"/);
  assert.match(sql, /state = 'ENDED'::"ControlState"/);
  assert.match(sql, /OPERATOR_ENDED_STALE_MATCH_FOR_SAFE_DEPLOYMENT/);
  assert.match(sql, /resultFinalizationPerformed', FALSE/);
  assert.doesNotMatch(sql, /status = 'FINISHED'/);
  assert.doesNotMatch(sql, /DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
});

test("wrapper verifies off-site backup and repeats preflight before mutation", () => {
  const wrapper = read("scripts/end-production-stale-global-control-matches.sh");
  assert.match(wrapper, /source scripts\/acquire-production-deploy-lock\.sh/);
  assert.match(wrapper, /ARENZYRA_BACKUP_REQUIRE_OFFSITE=1/);
  assert.match(wrapper, /BACKUP_COMPLETE OFFSITE_VERIFIED/);
  assert.match(
    wrapper,
    /acquire_production_activation_lock\s+bash scripts\/production-deploy-preflight\.sh\s+verify_production_activation_lock[\s\S]*docker exec -i/,
  );
  assert.match(wrapper, /verify-production-live-match-quiescence\.sh/);
  assert.doesNotMatch(wrapper, /docker (?:system )?prune|docker volume rm|rm -rf/);
});

test("reviewed entrypoint exposes the recovery with no arguments", () => {
  const launcher = read("scripts/production-reviewed-entrypoint.sh");
  assert.match(
    launcher,
    /end-stale-global-control-matches\)[\s\S]*accepts no arguments[\s\S]*require_nested_assembly[\s\S]*end-production-stale-global-control-matches\.sh/,
  );
});
