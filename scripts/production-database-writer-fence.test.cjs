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
  assert.match(
    script,
    /--engage\|--engage-or-verify\|--release\|--recover-closed/,
  );
  assert.match(script, /verify_engaged_marker/);
  assert.match(script, /count\(\*\) = 2[\s\S]*rolbypassrls/);
  assert.match(
    script,
    /rolcanlogin IS DISTINCT FROM :'"'"'expected_login'"'"'::boolean/,
  );
  assert.doesNotMatch(script, /rolcanlogin::text/);
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
  assert.doesNotMatch(script, /REASSIGN OWNED|DROP OWNED/);
});

test("closed database recovery is exact, marker-bound, and session empty", () => {
  const launcher = fs.readFileSync(
    path.join(__dirname, "production-reviewed-entrypoint.sh"),
    "utf8",
  );
  const containerGate = fs.readFileSync(
    path.join(__dirname, "verify-production-database-container.sh"),
    "utf8",
  );
  assert.match(
    launcher,
    /legacy-cutover-database-reopen\)[\s\S]*requires one immutable release ID[\s\S]*require_nested_assembly[\s\S]*recovery_release_id="\$1"[\s\S]*shift[\s\S]*acquire-production-deploy-lock\.sh[\s\S]*--recover-closed --release-id "\$recovery_release_id"/,
  );
  assert.match(script, /recover-closed[\s\S]*--allow-database-closed/);
  assert.match(
    script,
    /recover-closed[\s\S]*verify_engaged_marker[\s\S]*production-deploy-preflight\.sh --allow-cutover-transition[\s\S]*f\|0\|0[\s\S]*ALLOW_CONNECTIONS true/,
  );
  assert.match(
    containerGate,
    /--allow-database-closed[\s\S]*-d postgres[\s\S]*database\.datallowconn/,
  );
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
