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
  const close = sql.indexOf("ALLOW_CONNECTIONS false");
  const terminate = sql.indexOf("pg_terminate_backend");
  const prepared = sql.indexOf("pg_prepared_xacts");
  const lock = sql.indexOf("LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE");
  const alter = sql.indexOf("ALTER TABLE %I.%I OWNER TO %I");
  const reopen = sql.lastIndexOf("ALLOW_CONNECTIONS true");
  assert.ok(close > 0 && close < terminate);
  assert.ok(terminate < prepared && prepared < lock);
  assert.ok(lock < alter && alter < reopen);
  assert.match(sql, /activity\.pid <> pg_backend_pid\(\)/);
  assert.match(sql, /activity\.backend_type = 'client backend'/);
});

test("ownership targets come only from the closed object policy", () => {
  assert.match(sql, /FROM arenzyra_object_policy policy[\s\S]*ALTER TABLE/);
  assert.match(sql, /FROM arenzyra_enum_policy policy/);
  assert.match(sql, /JOIN arenzyra_function_policy policy/);
  assert.match(sql, /api_migration_role/);
  assert.match(sql, /studio_migration_role/);
  assert.doesNotMatch(sql, /REASSIGN OWNED|DROP OWNED|ALTER EXTENSION/);
});

test("ordinary role reconciliation does not activate ownership adoption", () => {
  assert.match(provisioner, /object_policy_adopt_ownership=false/);
  assert.match(
    provisioner,
    /if \[ "\$ADOPT_REVIEWED_OWNERSHIP" -eq 1 \]; then\s+object_policy_adopt_ownership=true/,
  );
  assert.equal(
    (sql.match(/\\if :object_policy_adopt_ownership/gu) ?? []).length,
    2,
  );
});
