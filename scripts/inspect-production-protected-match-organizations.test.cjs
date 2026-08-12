"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { parseSummary } = require("./inspect-production-protected-match-organizations.cjs");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const sample = {
  schemaVersion: 1,
  totalOrganizations: 1,
  organizations: [{
    organizationName: "Example Organization",
    protectedMatches: 3,
    businessLive: 1,
    businessFinishPending: 0,
    controlCountdown: 2,
    controlLive: 0,
    controlPaused: 0,
    controlFinishPending: 0,
    recentTelemetry: 0,
    liveRound: 0,
    unknownState: 0,
  }],
};

test("accepts only a bounded organization-name and count summary", () => {
  assert.deepEqual(parseSummary(JSON.stringify(sample)), sample);
  const expanded = structuredClone(sample);
  expanded.organizations[0].matchId = "private";
  assert.throws(() => parseSummary(JSON.stringify(expanded)), /unexpected shape/);
});

test("inspection is reviewed, read-only, bounded, and separately allowlisted", () => {
  const sql = read("infra/sql/production-protected-match-organizations.sql");
  const wrapper = read("scripts/inspect-production-protected-match-organizations.sh");
  const dispatcher = read("scripts/production-reviewed-entrypoint.sh");
  assert.match(sql, /REPEATABLE READ READ ONLY/);
  assert.match(sql, /INNER JOIN "Organization"/);
  assert.doesNotMatch(sql, /json_build_object\([\s\S]*?'(?:matchId|player|email|slug)'/i);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  assert.match(wrapper, /default_transaction_read_only=on/);
  assert.match(wrapper, /verify-production-database-container\.sh/);
  assert.doesNotMatch(wrapper, /docker\s+(?:compose|run|pull|restart|start|stop|rm)\b/);
  assert.match(
    dispatcher,
    /protected-match-organizations\)[\s\S]*require_nested_assembly[\s\S]*inspect-production-protected-match-organizations\.sh/,
  );
});
