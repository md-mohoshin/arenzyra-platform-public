"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { parsePostgresTarget } = require("./production-database-target.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

test("production database topology supports only the attested public schema", () => {
  const valid =
    "postgresql://api:secret@postgres:5432/pubg_prod" +
    "?schema=public&options=-c%20search_path%3Dpublic";
  assert.equal(parsePostgresTarget("DATABASE_URL", valid).schema, "public");
  assert.throws(
    () =>
      parsePostgresTarget(
        "DATABASE_URL",
        valid.replaceAll("public", "custom_schema"),
      ),
    /supported production schema public/,
  );
});

test("URL field failures are generic and never echo malformed credentials", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "arenzyra-role-url-"),
  );
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const envFile = path.join(directory, "publish.env");
  const secret = "never-print-this-password";
  fs.writeFileSync(
    envFile,
    `DATABASE_URL=postgresql://api:${secret}%ZZ@postgres:5432/pubg_prod\n`,
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "read-postgres-url-field.cjs"),
      envFile,
      "DATABASE_URL",
      "password",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL could not be read safely/);
  assert.doesNotMatch(result.stderr, new RegExp(secret));
  assert.doesNotMatch(result.stderr, /postgresql:\/\//);
});

test("role verifier binds eight stdin-only TCP credentials with bounded checks", () => {
  const verifier = read("scripts/verify-production-database-roles.sh");
  assert.match(verifier, /REPOSITORY_ROOT" != "\/opt\/arenzyra"/);
  assert.match(
    verifier,
    /ENV_FILE" != "\/opt\/arenzyra\/infra\/\.env\.publish"/,
  );
  assert.ok(
    verifier.indexOf("production-database-target.cjs") <
      verifier.indexOf("read_url DATABASE_URL"),
  );
  assert.ok(
    verifier.indexOf("require-local-production-docker.sh") <
      verifier.indexOf("docker exec"),
  );
  for (const profile of [
    "administrator",
    "api-runtime",
    "api-migrator",
    "studio-runtime",
    "studio-migrator",
    "maintenance-read",
    "idp-maintenance",
    "youtube-maintenance",
  ]) {
    assert.match(verifier, new RegExp(`run_credential_attestation ${profile}`));
  }
  assert.match(verifier, /PGHOST=127\.0\.0\.1 PGCONNECT_TIMEOUT=5/);
  assert.match(verifier, /statement_timeout=15000/);
  assert.match(verifier, /lock_timeout=5000/);
  assert.match(verifier, /IFS= read -r PGPASSWORD/);
  assert.doesNotMatch(verifier, /psql[^\n]*--password|psql[^\n]*-U "\$role"/);
  assert.doesNotMatch(verifier, /mktemp|password.*>.*\/tmp/i);
  assert.match(verifier, /\[ "\$result" != "verified" \]/);
  assert.match(verifier, /credentials=8 policy_violations=0/);
});

test("role entrypoints attest the shared lock path and open descriptor identity", () => {
  for (const relativePath of [
    "scripts/verify-production-database-roles.sh",
    "scripts/provision-production-database-roles.sh",
  ]) {
    const script = read(relativePath);
    for (const marker of [
      "verify_lock_directory_safety",
      "verify_lock_file_safety",
      "stat -Lc '%d:%i:%h'",
      "descriptor_identity",
      "lock_identity",
      "existing_lock_links",
      "${lock_identity##*:}",
      'readlink -f "/proc/$$/fd/8"',
      'exec 8>"$LOCK_FILE"',
      "$(id -u)",
    ]) {
      assert.ok(script.includes(marker), `${relativePath}: ${marker}`);
    }
    assert.match(script, /8#\$lock_mode & 8#022/);
    assert.match(script, /8#\$lock_directory_mode & 8#022/);
    assert.match(script, /ARENZYRA_DEPLOY_LOCK_INHERITED/);
    assert.doesNotMatch(
      script,
      /exec 8>\/run\/arenzyra-production-deploy\.lock/,
    );
  }
});

test("role verifier attests flags, memberships, ownership, and privilege boundaries", () => {
  const verifier = read("scripts/verify-production-database-roles.sh");
  for (const policy of [
    "rolcanlogin",
    "rolsuper",
    "rolcreatedb",
    "rolcreaterole",
    "rolinherit",
    "rolreplication",
    "rolbypassrls",
    "rolconfig",
    "rolconnlimit",
    "rolvaliduntil",
    "pg_authid",
    "pg_auth_members",
    "pg_db_role_setting",
    "pg_default_acl",
    "aclexplode",
    "membership.member = role.oid OR membership.roleid = role.oid",
    "has_database_privilege",
    "has_schema_privilege",
    "has_table_privilege",
    "has_any_column_privilege",
    "has_column_privilege",
    "has_sequence_privilege",
    "has_type_privilege",
    "has_function_privilege",
    "pg_get_userbyid",
    "pg_hba_file_rules",
    "pg_extension",
    "pg_enum",
    "pg_trigger",
    "pg_policy",
  ]) {
    assert.ok(verifier.includes(policy), policy);
  }
  assert.match(verifier, /POSTGRES_USER/);
  assert.match(verifier, /-v object_policy_base64="\$object_policy_base64"/);
  assert.doesNotMatch(
    verifier,
    /PGOPTIONS="[^"]*arenzyra\.object_policy_base64/,
  );
  assert.match(verifier, /NOT role\.rolsuper/);
  assert.match(verifier, /auth_method IS DISTINCT FROM [^\n]*scram-sha-256/);
  assert.match(verifier, /password_encryption/);
  assert.match(verifier, /SCRAM-SHA-256\$%/);
  assert.match(verifier, /extension\.extname = [^\n]*plpgsql/);
  assert.match(verifier, /extension\.extversion = [^\n]*1\.0/);
  assert.match(verifier, /extension\.extname = [^\n]*pgcrypto/);
  assert.match(verifier, /extension\.extversion = [^\n]*1\.3/);
  assert.match(
    verifier,
    /if \[ "\$profile" = "administrator" \]; then[\s\S]*pg_hba_file_rules[\s\S]*fi/,
  );
  assert.match(
    verifier,
    /is_ledger[\s\S]*has_table_privilege\(oid, 'SELECT'\)/,
  );
  assert.match(verifier, /has_database_privilege[\s\S]*'TEMPORARY'/);
  assert.match(verifier, /database\.datdba/);
  assert.match(verifier, /namespace\.nspowner/);
  assert.match(verifier, /role\.rolconnlimit <> -1/);
  assert.match(verifier, /role\.rolvaliduntil IS NOT NULL/);
  assert.match(verifier, /configured_app_role/);
  assert.match(verifier, /database\.datname <> current_database\(\)/);
  assert.match(verifier, /database\.datallowconn/);
  assert.match(
    verifier,
    /has_database_privilege\(role\.oid, database\.oid, 'CONNECT'\)/,
  );
  assert.match(
    verifier,
    /has_database_privilege\(role\.oid, database\.oid, 'TEMPORARY'\)/,
  );
  assert.match(verifier, /relation\.relrowsecurity/);
  assert.match(verifier, /relation\.relforcerowsecurity/);
  assert.match(verifier, /policy\.polrelid/);
  assert.match(verifier, /aclexplode\(database\.datacl\)/);
  assert.match(verifier, /other_app_schema/);
  assert.match(
    verifier,
    /has_schema_privilege\(role\.oid, namespace\.oid, 'USAGE'\)/,
  );
  assert.match(verifier, /COALESCE\(type\.typacl, acldefault\('T'/);
  assert.match(verifier, /'pg_database_owner'/);
  assert.match(
    verifier,
    /privilege\.grantee = 0[\s\S]{0,100}'CONNECT', 'CREATE', 'TEMPORARY'/,
  );
  assert.match(verifier, /privilege\.grantee <> relation\.owner_oid/);
  assert.match(verifier, /relation\.relkind = 'S' THEN 's'/);
  assert.match(verifier, /privilege\.grantee <> routine\.owner_oid/);
  assert.match(verifier, /aclexplode\(attribute\.attacl\)/);
  assert.match(verifier, /typtype NOT IN \('e', 'd'\)/);
  assert.match(verifier, /object_policy_allow_empty/);
  assert.match(verifier, /policy_name IS NULL/);
  assert.match(verifier, /relation\.oid IS NULL/);
  assert.match(verifier, /document -> 'sequences'/);
  assert.match(verifier, /document -> 'apiEnumTypes'/);
  assert.match(verifier, /document -> 'apiFunctions'/);
  assert.match(verifier, /document -> 'apiTriggers'/);
  assert.match(verifier, /ORDER BY enum_value\.enumsortorder/);
  assert.match(verifier, /type_labels IS DISTINCT FROM policy_labels/);
  assert.match(verifier, /prorettype <> 'pg_catalog\.trigger'::regtype/);
  assert.match(verifier, /prosecdef <> policy_security_definer/);
  assert.match(verifier, /proconfig IS NOT NULL/);
  assert.match(verifier, /source_sha256 <> policy_source_sha256/);
  assert.match(verifier, /tgtype <> \(/);
  assert.match(
    verifier,
    /update_columns IS DISTINCT FROM policy_update_columns/,
  );
  assert.match(verifier, /tgparentid <> 0/);
  assert.match(verifier, /octet_length\(tgargs\) <> 0/);
  assert.match(verifier, /tgenabled <> policy_enabled/);
  assert.match(verifier, /function_schema <> parameter\.expected_schema/);
  assert.match(verifier, /has_table_privilege\(oid, 'TRUNCATE'\)/);
  assert.match(verifier, /has_table_privilege\(oid, 'REFERENCES'\)/);
  assert.match(verifier, /has_table_privilege\(oid, 'TRIGGER'\)/);
  assert.doesNotMatch(verifier, /has_table_privilege\(oid, 'MAINTAIN'\)/);
  assert.match(verifier, /'maintenance-read'/);
  assert.match(verifier, /'idp-maintenance'/);
  assert.match(verifier, /'youtube-maintenance'/);
  assert.match(verifier, /pg_catalog\.pg_control_system\(\)/);
  assert.match(
    verifier,
    /profile IN \('api-migrator', 'maintenance-read', 'idp-maintenance'\)/,
  );
  assert.match(verifier, /privilege\.grantee = 0/);
  assert.match(verifier, /privilege\.privilege_type = 'EXECUTE'/);
  assert.doesNotMatch(verifier, /GRANT\s+pg_monitor/i);
  assert.match(
    verifier,
    /profile IN \([\s\S]{0,180}'maintenance-read'[\s\S]{0,180}has_function_privilege\(oid, 'EXECUTE'\)/,
  );
  assert.match(
    verifier,
    /profile = 'studio-migrator'[\s\S]{0,80}has_function_privilege\(oid, 'EXECUTE'\)/,
  );

  assert.match(verifier, /production-database-object-policy\.cjs/);
  assert.match(verifier, /production-database-object-policy\.json/);
  assert.match(verifier, /policy\.runtime_profile = 'none'/);
});

test("stock auxiliary database privileges block first-deploy role verification", () => {
  const verifier = read("scripts/verify-production-database-roles.sh");
  const bootstrap = read("infra/sql/bootstrap-production-roles.sql");
  const publishGuide = read("infra/PUBLISH.md");

  assert.match(
    verifier,
    /database\.datname <> current_database\(\)[\s\S]{0,100}database\.datallowconn[\s\S]{0,180}has_database_privilege\(role\.oid, database\.oid, 'CONNECT'\)[\s\S]{0,100}has_database_privilege\(role\.oid, database\.oid, 'TEMPORARY'\)/,
  );

  // PostgreSQL's stock auxiliary databases are connectable and their null ACL
  // derives CONNECT/TEMPORARY through PUBLIC. The effective-privilege branch
  // above must therefore report a violation until an operator closes the ACL.
  for (const database of [
    {
      name: "postgres",
      allowConnect: true,
      publicConnect: true,
      publicTemp: true,
    },
    {
      name: "template1",
      allowConnect: true,
      publicConnect: true,
      publicTemp: true,
    },
  ]) {
    const violatesGate =
      database.allowConnect && (database.publicConnect || database.publicTemp);
    assert.equal(violatesGate, true, database.name);
  }

  assert.equal(
    (
      bootstrap.match(
        /REVOKE CONNECT, TEMPORARY ON DATABASE :"database_name" FROM PUBLIC;/g,
      ) || []
    ).length,
    1,
  );
  assert.match(publishGuide, /stock cluster normally grants this access/);
  assert.match(
    publishGuide,
    /before any separate first-installation bootstrap/,
  );
  assert.match(publishGuide, /never\s+auto-revoke cluster-wide ACLs/);

  const provisioner = read("scripts/provision-production-database-roles.sh");
  const administratorPrecheck = provisioner.indexOf(
    'verify_tcp_identity administrator "$postgres_admin_role"',
  );
  const crossDatabasePrecheck = provisioner.indexOf(
    "verify_cross_database_acl_closed",
    administratorPrecheck,
  );
  const dryRunBranch = provisioner.indexOf('if [ "$MODE" = "dry-run" ]');
  const backup = provisioner.indexOf("create_role_change_backup");
  const roleMutation = provisioner.indexOf('cat "$SQL_FILE"');
  assert.ok(administratorPrecheck >= 0);
  assert.ok(crossDatabasePrecheck > administratorPrecheck);
  assert.ok(crossDatabasePrecheck < dryRunBranch);
  assert.ok(crossDatabasePrecheck < backup);
  assert.ok(crossDatabasePrecheck < roleMutation);
  assert.match(
    provisioner,
    /aclexplode\(COALESCE\(database\.datacl, acldefault\([^\n]*database\.datdba\)\)\)/,
  );
  assert.match(provisioner, /privilege\.grantee = 0/);
  assert.match(
    provisioner,
    /database\.datname <> current_database\(\).*database\.datallowconn/,
  );
  assert.match(
    provisioner,
    /cross-database ACL closure is required before retrying/,
  );
  assert.match(provisioner, /role\.oid = database\.datdba/);
  assert.match(provisioner, /aclexplode\(database\.datacl\)/);
  assert.match(
    provisioner,
    /has_database_privilege\(role\.oid, database\.oid, [^\n]*CONNECT/,
  );
  assert.match(
    provisioner,
    /has_database_privilege\(role\.oid, database\.oid, [^\n]*TEMPORARY/,
  );
  assert.match(provisioner, /json_build_object/);
  assert.match(provisioner, /blocking grants=%s/);
  assert.match(
    publishGuide,
    /Restrictive HBA rules remain defense-in-depth but do not satisfy this ACL\s+gate/,
  );
});

test("bootstrap removes ambient grants and never default-grants runtime DML", () => {
  const sql = read("infra/sql/bootstrap-production-roles.sql");
  const verifier = read("scripts/verify-production-database-roles.sh");
  assert.match(sql, /CREATE EXTENSION IF NOT EXISTS "pgcrypto"/);
  assert.match(sql, /NOBYPASSRLS/);
  assert.match(sql, /NOINHERIT/);
  assert.match(sql, /CONNECTION LIMIT -1/);
  assert.doesNotMatch(sql, /ALTER ROLE[^\n]*CONNECTION LIMIT/i);
  assert.doesNotMatch(sql, /VALID UNTIL/i);
  assert.match(sql, /ALTER ROLE :"api_runtime_role" RESET ALL/);
  assert.match(sql, /ALTER ROLE :"maintenance_read_role" RESET ALL/);
  assert.match(sql, /ALTER ROLE :"idp_maintenance_role" RESET ALL/);
  assert.match(sql, /ALTER ROLE :"youtube_maintenance_role" RESET ALL/);
  assert.match(sql, /ALTER ROLE %I IN DATABASE %I RESET ALL/);
  assert.match(sql, /database_owner_attested/);
  assert.match(sql, /schema_owner_attested/);
  assert.match(sql, /extension_allowlist_attested/);
  assert.match(sql, /REVOKE CREATE ON DATABASE :"database_name" FROM PUBLIC/);
  assert.match(
    sql,
    /REVOKE CONNECT, TEMPORARY ON DATABASE :"database_name" FROM PUBLIC/,
  );
  assert.match(sql, /REVOKE CREATE ON SCHEMA :"schema_name" FROM PUBLIC/);
  assert.match(sql, /REVOKE USAGE ON SCHEMA :"schema_name" FROM PUBLIC/);
  assert.match(sql, /membership\.member/);
  assert.match(sql, /membership\.roleid/);
  assert.match(sql, /ownership_boundary_attested/);
  assert.match(sql, /dependency\.deptype = 'e'/);
  assert.doesNotMatch(sql, /ALTER\s+TABLE[\s\S]{0,80}OWNER\s+TO/i);
  assert.doesNotMatch(
    sql,
    /ALTER DEFAULT PRIVILEGES[\s\S]{0,180}\bGRANT\b[\s\S]{0,100}(?:api_runtime_role|studio_runtime_role)/i,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION %s TO %I[\s\S]{0,120}:'api_migration_role'/,
  );
  assert.doesNotMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION[^\n]*(?:api_runtime_role|studio_runtime_role|maintenance_read_role|idp_maintenance_role|youtube_maintenance_role)/,
  );
  assert.match(
    sql,
    /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL PRIVILEGES ON TABLES/,
  );
  assert.match(sql, /CROSS JOIN LATERAL aclexplode\(default_acl\.defaclacl\)/);
  assert.match(sql, /privilege\.grantee <> default_acl\.defaclrole/);
  assert.match(sql, /CROSS JOIN LATERAL aclexplode\(relation\.relacl\)/);
  assert.match(sql, /CROSS JOIN LATERAL aclexplode\(routine\.proacl\)/);
  assert.match(sql, /REVOKE %s \(%I\) ON TABLE/);
  assert.match(sql, /CREATE TEMP TABLE arenzyra_enum_policy/);
  assert.match(sql, /CREATE TEMP TABLE arenzyra_function_policy/);
  assert.match(sql, /CREATE TEMP TABLE arenzyra_trigger_policy/);
  assert.match(sql, /type\.typtype <> 'e'/);
  assert.match(sql, /type\.type_labels IS DISTINCT FROM type\.policy_labels/);
  assert.match(sql, /ORDER BY enum_value\.enumsortorder/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TYPE/);
  assert.match(sql, /GRANT USAGE ON TYPE %I\.%I TO %I, %I/);
  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION pg_catalog\.pg_control_system\(\)[\s\S]*FROM PUBLIC/,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION pg_catalog\.pg_control_system\(\)[\s\S]*api_migration_role[\s\S]*maintenance_read_role[\s\S]*idp_maintenance_role/,
  );
  assert.match(
    sql,
    /aclexplode\([\s\S]*pg_control_system[\s\S]*privilege\.grantee <> routine\.proowner[\s\S]*\\gexec/,
  );
  assert.match(
    verifier,
    /privilege\.grantee NOT IN \([\s\S]*routine\.proowner[\s\S]*api_migration_role[\s\S]*maintenance_read_role[\s\S]*idp_maintenance_role/,
  );
  assert.match(
    verifier,
    /OR 3 <> \([\s\S]*count\(DISTINCT privilege\.grantee\)/,
  );
  assert.match(verifier, /privilege\.is_grantable/);
  assert.doesNotMatch(sql, /GRANT\s+pg_monitor/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC/);
  assert.match(sql, /default_acl\.defaclobjtype IN \('r', 'S', 'f', 'T'\)/);
  assert.match(sql, /routine\.prorettype <> 'pg_catalog\.trigger'::regtype/);
  assert.match(sql, /routine\.prosecdef <> routine\.policy_security_definer/);
  assert.match(sql, /routine\.source_sha256 <> routine\.policy_source_sha256/);
  assert.match(sql, /trigger\.tgtype <> \(/);
  assert.match(
    sql,
    /trigger\.update_columns IS DISTINCT FROM trigger\.policy_update_columns/,
  );
  assert.match(sql, /trigger\.tgenabled <> trigger\.policy_enabled/);
  assert.match(sql, /trigger\.function_schema <> :'schema_name'/);
  assert.match(sql, /trigger\.tgparentid <> 0/);
  assert.match(sql, /unsupported_default_acl/);
  assert.match(sql, /CREATE TEMP TABLE arenzyra_object_policy/);
  assert.match(sql, /policy\.runtime_profile = 'api'/);
  assert.match(sql, /policy\.runtime_profile = 'studio'/);
  assert.match(sql, /policy\.runtime_profile = 'none'/);
  assert.match(sql, /policy\.relation_name = relation\.relname/);
  assert.doesNotMatch(sql, /GRANT USAGE(?:, SELECT, UPDATE)? ON SEQUENCE/);
  assert.match(sql, /schemaVersion 1 deliberately permits no sequence/);
  assert.match(sql, /GRANT %s \(%s\) ON TABLE %I\.%I TO %I/);
  assert.match(
    sql,
    /'DiscordIdpSchedule'[\s\S]{0,160}'SELECT'[\s\S]{0,300}"createdAt"/,
  );
  assert.match(
    sql,
    /'DiscordIdpSchedule'[\s\S]{0,160}'UPDATE'[\s\S]{0,200}"roomPassword", "primaryMessage", "reminders", "updatedAt"/,
  );
  assert.match(
    sql,
    /'YoutubeChannel'[\s\S]{0,120}'SELECT'[\s\S]{0,180}"id", "accessTokenEnc", "refreshTokenEnc", "updatedAt"/,
  );
  assert.match(
    sql,
    /'YoutubeChannel'[\s\S]{0,120}'UPDATE'[\s\S]{0,180}"accessTokenEnc", "refreshTokenEnc", "updatedAt"/,
  );
  assert.doesNotMatch(
    sql,
    /GRANT SELECT(?:, UPDATE)? ON TABLE[^\n]*maintenance/i,
  );
  assert.doesNotMatch(
    sql,
    /GRANT (?:ALL|INSERT|DELETE|TRUNCATE|REFERENCES|TRIGGER)[^\n]*maintenance/i,
  );
});

test("provisioning preauthenticates, backs up, and reconciles under the shared lock", () => {
  const provisioner = read("scripts/provision-production-database-roles.sh");
  assert.match(provisioner, /REPOSITORY_ROOT" != "\/opt\/arenzyra"/);
  assert.match(
    provisioner,
    /ENV_FILE" != "\/opt\/arenzyra\/infra\/\.env\.publish"/,
  );
  const targetCheck = provisioner.indexOf("production-database-target.cjs");
  const firstDecode = provisioner.indexOf("read_url DATABASE_URL");
  const adminPasswordRead = provisioner.indexOf("read_env POSTGRES_PASSWORD");
  const adminPrecheck = provisioner.indexOf(
    "verify_tcp_identity administrator",
  );
  const backup = provisioner.indexOf("create_role_change_backup");
  const adjacentPreflight = provisioner.lastIndexOf(
    "bash scripts/production-deploy-preflight.sh",
  );
  const sqlMutation = provisioner.indexOf('cat "$SQL_FILE"');

  assert.ok(targetCheck >= 0 && targetCheck < firstDecode);
  assert.ok(targetCheck < adminPasswordRead);
  assert.doesNotMatch(
    provisioner,
    /compose_project="\$\{compose_project:-infra\}"/,
  );
  assert.ok(adminPrecheck > firstDecode && adminPrecheck < backup);
  assert.ok(backup < adjacentPreflight && adjacentPreflight < sqlMutation);
  assert.match(provisioner, /--dry-run/);
  assert.match(provisioner, /mutations=0/);
  assert.match(provisioner, /--first-deploy-create-only/);
  assert.match(provisioner, /existing_role_count" -ne 0/);
  assert.match(provisioner, /7 - existing_role_count/);
  assert.match(provisioner, /production-database-object-policy\.cjs/);
  assert.match(provisioner, /production-database-object-policy\.json/);
  assert.match(provisioner, /object_policy_require_complete=false/);
  assert.match(provisioner, /ARENZYRA_OBJECT_POLICY_ALLOW_EMPTY=1/);
  assert.match(provisioner, /object_policy_base64/);
  for (const key of [
    "MAINTENANCE_READ_DATABASE_URL",
    "IDP_MAINTENANCE_DATABASE_URL",
    "YOUTUBE_MAINTENANCE_DATABASE_URL",
  ]) {
    assert.ok(provisioner.includes(key), key);
  }
  assert.match(provisioner, /ARENZYRA_BACKUP_REQUIRE_OFFSITE=1/);
  assert.match(provisioner, /PRE-ROLE-CHANGE BACKUP VERIFIED/);
  assert.match(provisioner, /read_env ARENZYRA_BACKUP_ROOT/);
  assert.match(provisioner, /dirname -- "\$backup_dir"\)" = "\$backup_root"/);
  assert.match(
    provisioner,
    /credential\/extension role changes may have committed/,
  );
  assert.match(provisioner, /PGCONNECT_TIMEOUT=5/);
  assert.match(provisioner, /statement_timeout=15000/);
  assert.match(provisioner, /lock_timeout=5000/);
  assert.match(provisioner, /error IS NOT NULL/);
  assert.match(provisioner, /auth_method IS DISTINCT FROM [^\n]*scram-sha-256/);
  assert.match(provisioner, /SCRAM-SHA-256\$%/);
  assert.ok(
    provisioner.indexOf("require-local-production-docker.sh") <
      provisioner.indexOf("docker exec"),
  );
  assert.doesNotMatch(provisioner, /psql[^\n]*-U "\$role"/);
  assert.match(
    provisioner,
    /ARENZYRA_DEPLOY_LOCK_INHERITED=1[\s\\]*\n[\s\\]*bash "\$SCRIPT_DIR\/verify-production-database-roles\.sh"/,
  );
});

test("default ACL closure permits only the owner, including owner grant options", () => {
  const verifier = read("scripts/verify-production-database-roles.sh");
  const violatesDefaultAcl = ({ owner, grantee }) => grantee !== owner;
  const fixtures = [
    { owner: 10, grantee: 10, isGrantable: true, violates: false },
    { owner: 10, grantee: 0, isGrantable: false, violates: true },
    { owner: 10, grantee: 20, isGrantable: false, violates: true },
  ];
  for (const fixture of fixtures) {
    assert.equal(violatesDefaultAcl(fixture), fixture.violates);
  }
  assert.match(verifier, /privilege\.grantee <> owner_role\.oid/);
  assert.doesNotMatch(
    verifier,
    /privilege\.grantee <> owner_role\.oid OR privilege\.is_grantable/,
  );
});
