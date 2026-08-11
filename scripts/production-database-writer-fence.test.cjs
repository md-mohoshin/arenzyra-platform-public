"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const script = fs.readFileSync(
  path.join(__dirname, "production-database-writer-fence.sh"),
  "utf8",
);

test("writer fence is durable, locked, physical-target-bound, and session terminating", () => {
  assert.match(script, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
  assert.match(script, /flock -n 8/);
  assert.match(script, /verify-production-database-container\.sh/);
  assert.match(script, /pg_control_system/);
  assert.match(
    script,
    /ALTER ROLE :"api_runtime_role" NOSUPERUSER NOCREATEDB NOCREATEROLE[\s\S]*NOINHERIT NOREPLICATION NOBYPASSRLS :role_action/,
  );
  assert.match(
    script,
    /ALTER ROLE :"studio_runtime_role" NOSUPERUSER NOCREATEDB NOCREATEROLE[\s\S]*NOINHERIT NOREPLICATION NOBYPASSRLS :role_action/,
  );
  assert.match(script, /pg_terminate_backend/);
  assert.match(script, /pg_prepared_xacts/);
  assert.match(script, /writer-fence\.released/);
  assert.match(script, /--engage\|--engage-or-verify\|--release/);
  assert.match(script, /verify_engaged_marker/);
  assert.match(script, /count\(\*\) = 2[\s\S]*rolbypassrls/);
  assert.match(
    script,
    /DATABASE_WRITER_FENCE_PREDICATE name=runtime_role_count value=:runtime_role_count api=:api_runtime_role_count studio=:studio_runtime_role_count/,
  );
  assert.doesNotMatch(script, /\\quit\s+75/);
  assert.ok(
    script.indexOf("write_marker_state engaging") <
      script.indexOf("run_role_transition engage"),
  );
  assert.match(script, /state=engaged[\s\S]*state=engaging/);
  assert.doesNotMatch(script, /REASSIGN OWNED|DROP OWNED|ALTER DATABASE/);
});

test("fence release requires the clean IDP and entitlement postconditions", () => {
  const release = script.indexOf('if [ "$MODE" = engage ]');
  const idp = script.indexOf("verify-production-idp-encryption.sh", release);
  const entitlement = script.indexOf(
    "verify-production-entitlement-invariants.sh",
    release,
  );
  const login = script.indexOf("run_role_transition release", release);
  assert.ok(
    release > 0 && idp > release && entitlement > idp && login > entitlement,
  );
});
