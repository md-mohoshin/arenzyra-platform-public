"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const {
  parseInventory,
  verifyQuiescence,
} = require("./verify-production-live-match-quiescence.cjs");

function inventory(overrides = {}) {
  const value = {
    schemaVersion: 1,
    matches: { totalNonDeleted: 2, deploymentProtected: 0, quiescent: 2 },
    businessStatus: {
      draft: 1,
      live: 0,
      ended: 0,
      finishPending: 0,
      finished: 1,
      unknown: 0,
    },
    liveState: { upcoming: 1, live: 0, ended: 1, unknown: 0 },
    controlState: {
      none: 1,
      ready: 0,
      countdown: 0,
      live: 0,
      paused: 0,
      ended: 0,
      confirmed: 1,
      finishPending: 0,
      unknown: 0,
    },
    activitySignals: { recentTelemetry: 0, liveRound: 0 },
  };
  return Object.assign(value, overrides);
}

test("accepts a count-only quiescent production inventory", () => {
  const parsed = parseInventory(JSON.stringify(inventory()));
  assert.equal(
    verifyQuiescence(parsed),
    "LIVE MATCH QUIESCENCE VERIFIED non_deleted=2 protected=0\n",
  );
});

test("blocks countdown, live, finalizing, telemetry, and round activity", () => {
  for (const mutate of [
    (value) => {
      value.controlState.none = 0;
      value.controlState.countdown = 1;
    },
    (value) => {
      value.businessStatus.draft = 0;
      value.businessStatus.live = 1;
    },
    (value) => {
      value.businessStatus.draft = 0;
      value.businessStatus.finishPending = 1;
    },
    (value) => {
      value.activitySignals.recentTelemetry = 1;
    },
    (value) => {
      value.activitySignals.liveRound = 1;
    },
  ]) {
    const value = inventory();
    mutate(value);
    value.matches.deploymentProtected = 1;
    value.matches.quiescent = 1;
    assert.throws(
      () => verifyQuiescence(parseInventory(JSON.stringify(value))),
      /LIVE MATCH QUIESCENCE BLOCKED/,
    );
  }
});

test("rejects malformed aggregates without reflecting unexpected keys", () => {
  const value = inventory();
  value.privateMatchIdentifier = "must-not-appear";
  assert.throws(
    () => parseInventory(JSON.stringify(value)),
    (error) => {
      assert.match(error.message, /unexpected object shape/);
      assert.doesNotMatch(error.message, /privateMatchIdentifier|must-not-appear/);
      return true;
    },
  );
});

test("production quiescence query is read-only, aggregate-only, and bounded", () => {
  const sql = read("infra/sql/production-live-match-quiescence.sql");
  const wrapper = read("scripts/verify-production-live-match-quiescence.sh");

  assert.match(sql, /REPEATABLE READ READ ONLY/);
  assert.match(sql, /statement_timeout/);
  assert.match(sql, /lock_timeout/);
  assert.match(sql, /FROM "Match"/);
  assert.match(sql, /LEFT JOIN "MatchControlState"/);
  assert.match(sql, /FROM "MatchRound"/);
  assert.match(sql, /interval '2 minutes'/);
  assert.match(
    sql,
    /"pcobLastSeenAt" IS NOT NULL[\s\S]*"pcobLastSeenAt" >=/,
  );
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  assert.doesNotMatch(sql, /json_build_object\([\s\S]*?"(?:id|name|email|slug)"/i);

  assert.match(wrapper, /default_transaction_read_only=on/);
  assert.match(wrapper, /ON_ERROR_STOP=1/);
  assert.match(wrapper, /verify-production-database-container\.sh/);
  assert.doesNotMatch(wrapper, /docker\s+(?:compose|run|pull|restart|start|stop|rm)\b/);
});
