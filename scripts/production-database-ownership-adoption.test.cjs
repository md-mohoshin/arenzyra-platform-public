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
  const reopen = provisioner.indexOf("ALLOW_CONNECTIONS true", workerWait);
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
  assert.match(
    provisioner,
    /cleanup_fence_files\(\)[\s\S]*trap - EXIT HUP INT TERM[\s\S]*fence_closed[\s\S]*ALLOW_CONNECTIONS true[\s\S]*printf "\%s\\n" "DATABASE ROLE PROVISIONING CLEANUP BLOCKED: target database connections could not be restored\."/,
  );
  assert.match(
    provisioner,
    /exec 9<&0[\s\S]*cat <&9[\s\S]*> "\$fence_fifo" &[\s\S]*feed_pid="\$!"[\s\S]*exec 9<&-/,
  );
  assert.ok(
    provisioner.indexOf("exec 9<&0") <
      provisioner.indexOf('psql -X -v ON_ERROR_STOP=1 -f "$fence_fifo"'),
  );
});

test("ownership fence variables are expanded only inside the container shell", () => {
  const innerShell = provisioner.slice(
    provisioner.indexOf("docker exec -i"),
    provisioner.indexOf("\n'\n", provisioner.indexOf("docker exec -i")),
  );
  assert.doesNotMatch(
    innerShell,
    /'''\$(?:PGDATABASE|PGUSER|fence_application|worker_backend_pid)'''/,
  );
  assert.match(innerShell, /\\\$arenzyra\\\$\$PGDATABASE\\\$arenzyra\\\$/);
  assert.match(innerShell, /\\\$arenzyra\\\$\$PGUSER\\\$arenzyra\\\$/);
  assert.match(
    innerShell,
    /\\\$arenzyra\\\$\$fence_application\\\$arenzyra\\\$/,
  );
});

test("ownership targets come only from the closed object policy", () => {
  assert.match(sql, /FROM arenzyra_object_policy policy[\s\S]*ALTER TABLE/);
  assert.match(sql, /FROM arenzyra_enum_policy policy/);
  assert.match(sql, /JOIN arenzyra_function_policy policy/);
  assert.match(sql, /api_migration_role/);
  assert.match(sql, /studio_migration_role/);
  assert.doesNotMatch(sql, /REASSIGN OWNED|DROP OWNED|ALTER EXTENSION/);
  assert.doesNotMatch(provisioner, /REASSIGN OWNED|DROP OWNED/);
});

test("legacy partial adoption permits missing candidate objects but no unclassified present object", () => {
  assert.match(provisioner, /--legacy-cutover-partial/);
  assert.match(provisioner, /object_policy_require_complete=false/);
  assert.match(provisioner, /object_policy_partial_preflight=true/);
  assert.match(sql, /legacy_partial_object_boundary_attested/);
  assert.ok(
    sql.indexOf("legacy_partial_object_boundary_attested") <
      sql.indexOf('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'),
  );
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

test("stopped legacy cutover may adopt only the reviewed administrator credential", () => {
  const hbaRemediation = provisioner.indexOf(
    "remediate_legacy_host_authentication",
  );
  const failedTcp = provisioner.indexOf(
    'if ! verify_tcp_identity administrator "$postgres_admin_role"',
  );
  const adoption = provisioner.indexOf(
    "adopt_legacy_administrator_credential",
    failedTcp,
  );
  const repeatedTcp = provisioner.indexOf(
    'verify_tcp_identity administrator "$postgres_admin_role"',
    adoption,
  );
  assert.ok(
    hbaRemediation >= 0 &&
      failedTcp > hbaRemediation &&
      adoption > failedTcp &&
      repeatedTcp > adoption,
  );
  assert.match(
    provisioner,
    /remediate_legacy_host_authentication\(\)[\s\S]*verified\\\|0\\\|4\\\|4[\s\S]*arenzyra-pre-host-scram-[\s\S]*changed != 4 \|\| invalid != 0[\s\S]*pg_reload_conf\(\)/,
  );
  assert.match(
    provisioner,
    /remediate_legacy_host_authentication\(\)[\s\S]*cp -p -- "\$backup_file" "\$rollback_file"[\s\S]*mv -f -- "\$rollback_file" "\$hba_file"[\s\S]*trap rollback EXIT/,
  );
  assert.match(
    provisioner,
    /adopt_legacy_administrator_credential\(\)[\s\S]*\[ "\$MODE" = apply \][\s\S]*\[ "\$LEGACY_CUTOVER_PARTIAL" -eq 1 \][\s\S]*verify_adoption_writers_stopped/,
  );
  assert.match(provisioner, /postgres_admin_password_base64/);
  assert.match(provisioner, /PGHOST=\/var\/run\/postgresql/);
  assert.match(provisioner, /inet_client_addr\(\) IS NULL/);
  assert.match(
    provisioner,
    /CREATE TEMP TABLE arenzyra_legacy_admin_credential[\s\S]*ON COMMIT DROP/,
  );
  assert.match(
    provisioner,
    /EXECUTE format\('ALTER ROLE %I PASSWORD %L', current_user, desired_password\)/,
  );
  const adoptionBody = provisioner.slice(
    provisioner.indexOf("adopt_legacy_administrator_credential()"),
    provisioner.indexOf("verify_cross_database_acl_closed()"),
  );
  assert.match(
    adoptionBody,
    /"\$postgres_admin_role" "\$postgres_admin_password_base64"/,
  );
  assert.match(
    adoptionBody,
    /current_setting\('"'"'port'"'"'\) = current_setting\('"'"'arenzyra\.expected_port'"'"'\)/,
  );
  assert.doesNotMatch(adoptionBody, /inet_server_port\(\)/);
  assert.doesNotMatch(adoptionBody, /"\$postgres_admin_password"/);
});

test("legacy administrator diagnostic is allowlisted, bounded, and read-only", () => {
  const repositoryRoot = path.resolve(__dirname, "..");
  const diagnostic = fs.readFileSync(
    path.join(
      repositoryRoot,
      "scripts",
      "diagnose-production-legacy-database-admin.sh",
    ),
    "utf8",
  );
  const launcher = fs.readFileSync(
    path.join(repositoryRoot, "scripts", "production-reviewed-entrypoint.sh"),
    "utf8",
  );
  assert.match(
    launcher,
    /legacy-admin-diagnose\)[\s\S]*accepts no arguments[\s\S]*require_nested_assembly[\s\S]*diagnose-production-legacy-database-admin\.sh/,
  );
  assert.match(
    launcher,
    /legacy-transition-admin-diagnose\)[\s\S]*accepts no arguments[\s\S]*require_nested_assembly[\s\S]*diagnose-production-legacy-database-admin\.sh[\s\S]*--cutover-transition/,
  );
  assert.match(
    diagnostic,
    /production-deploy-preflight\.sh --allow-legacy-cutover-interrupted/,
  );
  assert.match(
    diagnostic,
    /production-deploy-preflight\.sh --allow-cutover-transition/,
  );
  assert.match(
    diagnostic,
    /\[ "\$1" = "--cutover-transition" \][\s\S]*PREFLIGHT_MODE="cutover-transition"[\s\S]*shift[\s\S]*source scripts\/acquire-production-deploy-lock\.sh/,
  );
  assert.match(
    diagnostic,
    /PREFLIGHT_MODE" = "cutover-transition"[\s\S]*database_verify_args=\(\)[\s\S]*database_verify_args=\(--allow-running-legacy-backup\)[\s\S]*verify-production-database-container\.sh "\$\{database_verify_args\[@\]\}"/,
  );
  assert.match(diagnostic, /default_transaction_read_only=on/);
  assert.match(diagnostic, /PGHOST=\/var\/run\/postgresql/);
  assert.match(diagnostic, /export PGUSER PGDATABASE PGPORT/);
  assert.doesNotMatch(diagnostic, /<<<\s*"\$(?:socket|hba)_summary"/);
  assert.match(diagnostic, /tcp_reviewed_password/);
  assert.match(diagnostic, /hba_non_scram/);
  assert.doesNotMatch(
    diagnostic,
    /\b(?:ALTER|CREATE|DROP|TRUNCATE|UPDATE|DELETE|INSERT)\b/,
  );
  const publicOutputBoundary = diagnostic.slice(
    diagnostic.indexOf('case "$diagnostic" in'),
  );
  assert.doesNotMatch(
    publicOutputBoundary,
    /\$(?:postgres_admin_password|reviewed_password)/,
  );
});
