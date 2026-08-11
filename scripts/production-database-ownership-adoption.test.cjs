const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const provisioner = fs.readFileSync(
  path.join(__dirname, "provision-production-database-roles.sh"),
  "utf8",
);
const sql = fs.readFileSync(
  path.join(__dirname, "..", "infra", "sql", "bootstrap-production-roles.sql"),
  "utf8",
);

test("ownership adoption requires the complete explicit operator contract", () => {
  for (const marker of [
    "--adopt-reviewed-ownership",
    "--writers-stopped",
    "--confirm=ADOPT_REVIEWED_DATABASE_OWNERSHIP",
    "ARENZYRA_DEPLOY_LOCK_INHERITED",
  ]) {
    assert.match(provisioner, new RegExp(marker.replaceAll("-", "\\-")));
  }
  assert.match(
    provisioner,
    /grep -Ev '\^\(postgres\|redis\|proxy\|media-ai\)\$'/,
  );
  assert.match(
    provisioner,
    /every managed application and maintenance writer to be stopped/,
  );
});

test("ownership adoption holds a database fence around the exact transaction", () => {
  const workerConnect = provisioner.indexOf(
    'psql -X -v ON_ERROR_STOP=1 -f "$fence_fifo"',
  );
  const close = provisioner.indexOf("ALLOW_CONNECTIONS false");
  const terminate = provisioner.indexOf("pg_terminate_backend");
  const prepared = provisioner.indexOf("pg_prepared_xacts");
  const release = provisioner.indexOf(': > "$fence_continue"');
  const workerWait = provisioner.indexOf('if ! wait "$worker_pid"', release);
  const reopen = provisioner.indexOf("ALLOW_CONNECTIONS true");
  const lock = sql.indexOf("LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE");
  const alter = sql.indexOf("ALTER TABLE %I.%I OWNER TO %I");
  assert.ok(workerConnect > 0 && workerConnect < close);
  assert.ok(close < terminate && terminate < prepared);
  assert.ok(prepared < release && release < workerWait && workerWait < reopen);
  assert.ok(lock > 0 && lock < alter);
  assert.doesNotMatch(sql, /ALTER DATABASE[\s\S]*ALLOW_CONNECTIONS/);
  assert.match(sql, /NOT database\.datallowconn/);
  assert.match(sql, /activity\.pid <> pg_backend_pid\(\)/);
  assert.match(sql, /activity\.backend_type = 'client backend'/);
  assert.doesNotMatch(sql, /ELSE\s+1\s*\/\s*0/);
  assert.match(provisioner, /\[ "\$fence_state" = "f\|1\|0\|0" \]/);
  assert.match(provisioner, /if ! wait "\$worker_pid"; then[\s\S]*exit 75/);
});

test("ownership targets come only from the closed object policy", () => {
  assert.match(sql, /FROM arenzyra_object_policy policy[\s\S]*ALTER TABLE/);
  assert.match(sql, /FROM arenzyra_enum_policy policy/);
  assert.match(sql, /JOIN arenzyra_function_policy policy/);
  assert.match(sql, /api_migration_role/);
  assert.match(sql, /studio_migration_role/);
  assert.doesNotMatch(sql, /REASSIGN OWNED|DROP OWNED|ALTER EXTENSION/);
});

test("legacy partial adoption permits missing candidate objects but no unclassified present object", () => {
  assert.match(provisioner, /--legacy-cutover-partial/);
  assert.match(provisioner, /object_policy_require_complete=false/);
  for (const relation of [
    "policy.relation_name IS NULL",
    "type.policy_name IS NULL",
    "routine.policy_name IS NULL",
    "trigger.policy_name IS NULL",
  ]) {
    assert.match(sql, new RegExp(relation.replaceAll(".", "\\.")));
  }
  assert.match(
    sql,
    /missing_policy_relation[\s\S]*object_policy_require_complete/,
  );
});

test("ordinary role reconciliation does not activate ownership adoption", () => {
  assert.match(provisioner, /object_policy_adopt_ownership=false/);
  assert.match(
    provisioner,
    /if \[ "\$ADOPT_REVIEWED_OWNERSHIP" -eq 1 \]; then\s+object_policy_adopt_ownership=true/,
  );
  assert.equal(
    (sql.match(/\\if :object_policy_adopt_ownership/gu) ?? []).length,
    1,
  );
});
