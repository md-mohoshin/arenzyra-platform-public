\set ON_ERROR_STOP on

BEGIN;

-- The checked-in policy is validated against the Prisma schema, every API
-- migration, and the Studio migration before it reaches psql. Keep a
-- transaction-local classification table so ownership and runtime grants are
-- derived only from reviewed names, never from migrator ownership alone.
CREATE TEMP TABLE arenzyra_object_policy (
  relation_name text PRIMARY KEY,
  relation_kind "char" NOT NULL CHECK (relation_kind = 'r'),
  owner_profile text NOT NULL CHECK (owner_profile IN ('api', 'studio')),
  runtime_profile text NOT NULL CHECK (runtime_profile IN ('api', 'studio', 'none')),
  CHECK (runtime_profile = 'none' OR runtime_profile = owner_profile)
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE arenzyra_enum_policy (
  type_name text PRIMARY KEY,
  type_labels text[] NOT NULL CHECK (cardinality(type_labels) > 0),
  owner_profile text NOT NULL CHECK (owner_profile = 'api'),
  runtime_profile text NOT NULL CHECK (runtime_profile = 'api')
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE arenzyra_function_policy (
  function_name text NOT NULL,
  owner_profile text NOT NULL CHECK (owner_profile = 'api'),
  function_kind "char" NOT NULL CHECK (function_kind = 'f'),
  identity_arguments text NOT NULL CHECK (identity_arguments = ''),
  result_type text NOT NULL CHECK (result_type = 'trigger'),
  language_name text NOT NULL CHECK (language_name = 'plpgsql'),
  security_definer boolean NOT NULL CHECK (NOT security_definer),
  volatility text NOT NULL CHECK (volatility = 'volatile'),
  parallel_safety text NOT NULL CHECK (parallel_safety = 'unsafe'),
  is_strict boolean NOT NULL CHECK (NOT is_strict),
  is_leakproof boolean NOT NULL CHECK (NOT is_leakproof),
  returns_set boolean NOT NULL CHECK (NOT returns_set),
  argument_defaults integer NOT NULL CHECK (argument_defaults = 0),
  estimated_cost real NOT NULL CHECK (estimated_cost = 100),
  estimated_rows real NOT NULL CHECK (estimated_rows = 0),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (function_name, identity_arguments)
) ON COMMIT PRESERVE ROWS;

CREATE TEMP TABLE arenzyra_trigger_policy (
  trigger_name text NOT NULL,
  owner_profile text NOT NULL CHECK (owner_profile = 'api'),
  table_name text NOT NULL,
  function_name text NOT NULL,
  function_identity_arguments text NOT NULL
    CHECK (function_identity_arguments = ''),
  enabled "char" NOT NULL CHECK (enabled = 'O'),
  is_internal boolean NOT NULL CHECK (NOT is_internal),
  timing text NOT NULL CHECK (timing = 'BEFORE'),
  trigger_level text NOT NULL CHECK (trigger_level = 'ROW'),
  fires_insert boolean NOT NULL,
  fires_update boolean NOT NULL,
  fires_delete boolean NOT NULL,
  fires_truncate boolean NOT NULL,
  update_columns text[] NOT NULL,
  PRIMARY KEY (table_name, trigger_name),
  FOREIGN KEY (function_name, function_identity_arguments)
    REFERENCES arenzyra_function_policy (function_name, identity_arguments)
) ON COMMIT PRESERVE ROWS;

WITH policy AS (
  SELECT convert_from(
    decode(:'object_policy_base64', 'base64'),
    'UTF8'
  )::jsonb AS document
), classified AS (
  SELECT name, 'api'::text AS owner_profile, 'api'::text AS runtime_profile
  FROM policy,
    LATERAL jsonb_array_elements_text(document -> 'apiRuntimeTables') AS item(name)
  UNION ALL
  SELECT name, 'api', 'none'
  FROM policy,
    LATERAL jsonb_array_elements_text(document -> 'apiMigrationLedgers') AS item(name)
  UNION ALL
  SELECT name, 'studio', 'studio'
  FROM policy,
    LATERAL jsonb_array_elements_text(document -> 'studioRuntimeTables') AS item(name)
  UNION ALL
  SELECT name, 'studio', 'none'
  FROM policy,
    LATERAL jsonb_array_elements_text(document -> 'studioMigrationLedgers') AS item(name)
)
INSERT INTO arenzyra_object_policy (
  relation_name,
  relation_kind,
  owner_profile,
  runtime_profile
)
SELECT name, 'r', owner_profile, runtime_profile
FROM classified;

WITH policy AS (
  SELECT convert_from(
    decode(:'object_policy_base64', 'base64'),
    'UTF8'
  )::jsonb AS document
)
INSERT INTO arenzyra_enum_policy (
  type_name,
  type_labels,
  owner_profile,
  runtime_profile
)
SELECT
  item.name,
  ARRAY(SELECT jsonb_array_elements_text(item.labels)),
  'api',
  'api'
FROM policy,
  LATERAL jsonb_to_recordset(document -> 'apiEnumTypes') AS item(
    name text,
    labels jsonb
  );

WITH policy AS (
  SELECT convert_from(
    decode(:'object_policy_base64', 'base64'),
    'UTF8'
  )::jsonb AS document
)
INSERT INTO arenzyra_function_policy (
  function_name,
  owner_profile,
  function_kind,
  identity_arguments,
  result_type,
  language_name,
  security_definer,
  volatility,
  parallel_safety,
  is_strict,
  is_leakproof,
  returns_set,
  argument_defaults,
  estimated_cost,
  estimated_rows,
  source_sha256
)
SELECT
  item.name,
  item."ownerProfile",
  item.kind::"char",
  item."identityArguments",
  item."resultType",
  item.language,
  item."securityDefiner",
  item.volatility,
  item.parallel,
  item.strict,
  item.leakproof,
  item."returnsSet",
  item."argumentDefaults",
  item.cost,
  item.rows,
  item."sourceSha256"
FROM policy,
  LATERAL jsonb_to_recordset(document -> 'apiFunctions') AS item(
    name text,
    "ownerProfile" text,
    kind text,
    "identityArguments" text,
    "resultType" text,
    language text,
    "securityDefiner" boolean,
    volatility text,
    parallel text,
    strict boolean,
    leakproof boolean,
    "returnsSet" boolean,
    "argumentDefaults" integer,
    cost real,
    rows real,
    "sourceSha256" text
  );

WITH policy AS (
  SELECT convert_from(
    decode(:'object_policy_base64', 'base64'),
    'UTF8'
  )::jsonb AS document
)
INSERT INTO arenzyra_trigger_policy (
  trigger_name,
  owner_profile,
  table_name,
  function_name,
  function_identity_arguments,
  enabled,
  is_internal,
  timing,
  trigger_level,
  fires_insert,
  fires_update,
  fires_delete,
  fires_truncate,
  update_columns
)
SELECT
  item.name,
  item."ownerProfile",
  item."tableName",
  item."functionName",
  item."functionIdentityArguments",
  item.enabled::"char",
  item.internal,
  item.timing,
  item.level,
  item.events ? 'INSERT',
  item.events ? 'UPDATE',
  item.events ? 'DELETE',
  item.events ? 'TRUNCATE',
  ARRAY(
    SELECT jsonb_array_elements_text(item."updateColumns")
  )
FROM policy,
  LATERAL jsonb_to_recordset(document -> 'apiTriggers') AS item(
    name text,
    "ownerProfile" text,
    "tableName" text,
    "functionName" text,
    "functionIdentityArguments" text,
    enabled text,
    internal boolean,
    timing text,
    level text,
    events jsonb,
    "updateColumns" jsonb
  );

WITH policy AS (
  SELECT convert_from(
    decode(:'object_policy_base64', 'base64'),
    'UTF8'
  )::jsonb AS document
)
SELECT 1 / CASE WHEN
  document ->> 'schemaVersion' = '1'
  AND document ->> 'databaseSchema' = :'schema_name'
  AND jsonb_array_length(document -> 'sequences') = 0
  AND jsonb_array_length(document -> 'apiEnumTypes') = 69
  AND jsonb_array_length(document -> 'apiFunctions') = 2
  AND jsonb_array_length(document -> 'apiTriggers') = 2
  AND (SELECT count(*) FROM arenzyra_object_policy) = 139
  AND (SELECT count(*) FROM arenzyra_enum_policy) = 69
  AND (SELECT count(*) FROM arenzyra_function_policy) = 2
  AND (SELECT count(*) FROM arenzyra_trigger_policy) = 2
THEN 1 ELSE 0 END AS object_policy_document_attested
FROM policy;

SELECT 1 / CASE WHEN EXISTS (
  SELECT 1 FROM pg_database database
  WHERE database.datname = current_database()
    AND database.datdba = (SELECT oid FROM pg_roles WHERE rolname = current_user)
) THEN 1 ELSE 0 END AS database_owner_attested;
SELECT 1 / CASE WHEN EXISTS (
  SELECT 1 FROM pg_namespace namespace
  WHERE namespace.nspname = :'schema_name'
    AND namespace.nspowner IN (
      SELECT oid FROM pg_roles
      WHERE rolname IN (current_user, 'pg_database_owner')
    )
) THEN 1 ELSE 0 END AS schema_owner_attested;

-- The one-time legacy path permits candidate objects to be absent before
-- migrations, but every object already present must be classified and have an
-- explicitly accepted predecessor owner. Run this before extension, role, ACL,
-- or ownership mutation so a legacy-shape mismatch fails without persistent
-- database changes.
\if :object_policy_partial_preflight
WITH present_relation AS (
  SELECT relation.oid, relation.relname, relation.relkind, relation.relowner
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = :'schema_name'
    AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objid = relation.oid
        AND dependency.deptype = 'e'
    )
), relation_violation AS (
  SELECT relation.oid
  FROM present_relation relation
  LEFT JOIN arenzyra_object_policy policy
    ON policy.relation_name = relation.relname
   AND policy.relation_kind = relation.relkind
  WHERE policy.relation_name IS NULL
     OR pg_get_userbyid(relation.relowner) NOT IN (
       current_user,
       'postgres',
       CASE policy.owner_profile
         WHEN 'api' THEN :'api_migration_role'
         WHEN 'studio' THEN :'studio_migration_role'
         ELSE ''
       END
     )
), present_type AS (
  SELECT type.oid, type.typname, type.typtype, type.typowner
  FROM pg_type type
  JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
  WHERE namespace.nspname = :'schema_name'
    AND NOT (
      type.typrelid <> 0 AND EXISTS (
        SELECT 1 FROM pg_class typed_relation
        WHERE typed_relation.oid = type.typrelid
          AND typed_relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_type element_type WHERE element_type.typarray = type.oid
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_type'::regclass
        AND dependency.objid = type.oid
        AND dependency.deptype = 'e'
    )
), type_violation AS (
  SELECT type.oid
  FROM present_type type
  LEFT JOIN arenzyra_enum_policy policy ON policy.type_name = type.typname
  WHERE policy.type_name IS NULL
     OR type.typtype <> 'e'
     OR pg_get_userbyid(type.typowner) NOT IN (
       current_user, 'postgres', :'api_migration_role'
     )
), present_function AS (
  SELECT routine.oid, routine.proname, routine.prokind, routine.proowner,
    pg_get_function_identity_arguments(routine.oid) AS identity_arguments
  FROM pg_proc routine
  JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
  WHERE namespace.nspname = :'schema_name'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_proc'::regclass
        AND dependency.objid = routine.oid
        AND dependency.deptype = 'e'
    )
), function_violation AS (
  SELECT routine.oid
  FROM present_function routine
  LEFT JOIN arenzyra_function_policy policy
    ON policy.function_name = routine.proname
   AND policy.identity_arguments = routine.identity_arguments
  WHERE policy.function_name IS NULL
     OR routine.prokind <> policy.function_kind
     OR pg_get_userbyid(routine.proowner) NOT IN (
       current_user, 'postgres', :'api_migration_role'
     )
), present_trigger AS (
  SELECT trigger.oid, trigger.tgname, relation.relname AS table_name,
    routine.proname AS function_name,
    pg_get_function_identity_arguments(routine.oid) AS identity_arguments
  FROM pg_trigger trigger
  JOIN pg_class relation ON relation.oid = trigger.tgrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_proc routine ON routine.oid = trigger.tgfoid
  WHERE namespace.nspname = :'schema_name'
    AND NOT trigger.tgisinternal
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_trigger'::regclass
        AND dependency.objid = trigger.oid
        AND dependency.deptype = 'e'
    )
), trigger_violation AS (
  SELECT trigger.oid
  FROM present_trigger trigger
  LEFT JOIN arenzyra_trigger_policy policy
    ON policy.table_name = trigger.table_name
   AND policy.trigger_name = trigger.tgname
  WHERE policy.trigger_name IS NULL
     OR trigger.function_name <> policy.function_name
     OR trigger.identity_arguments <> policy.function_identity_arguments
), violation AS (
  SELECT oid FROM relation_violation
  UNION ALL SELECT oid FROM type_violation
  UNION ALL SELECT oid FROM function_violation
  UNION ALL SELECT oid FROM trigger_violation
)
SELECT 1 / CASE WHEN count(*) = 0 THEN 1 ELSE 0 END
  AS legacy_partial_object_boundary_attested
FROM violation;
\endif

-- The administrator installs the trusted extension required by the initial
-- Prisma migration. Dedicated migrators intentionally have no database CREATE.
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA :"schema_name";
SELECT 1 / CASE WHEN EXISTS (
  SELECT 1
  FROM pg_extension extension
  JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgcrypto'
    AND namespace.nspname = :'schema_name'
) THEN 1 ELSE 0 END AS pgcrypto_attested;
SELECT 1 / CASE WHEN current_setting('password_encryption') = 'scram-sha-256'
  THEN 1 ELSE 0 END AS scram_password_encryption_attested;
SELECT 1 / CASE WHEN count(*) = 2 AND count(*) FILTER (
  WHERE (extension.extname = 'plpgsql'
      AND extension.extversion = '1.0'
      AND namespace.nspname = 'pg_catalog')
    OR (extension.extname = 'pgcrypto'
      AND extension.extversion = '1.3'
      AND namespace.nspname = :'schema_name')
) = 2 THEN 1 ELSE 0 END AS extension_allowlist_attested
FROM pg_extension extension
JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace;

-- Create-only credentials. Existing passwords are preserved and must already
-- authenticate successfully before this SQL is invoked. New roles receive the
-- exact unlimited connection policy and a NULL expiration by default. Existing
-- connection limits and expirations are deliberately not widened here; the
-- verifier blocks them for explicit DBA review and repair.
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1',
  :'api_runtime_role',
  convert_from(decode(:'api_runtime_password_base64', 'base64'), 'UTF8')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'api_runtime_role')
\gexec
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1',
  :'api_migration_role',
  convert_from(decode(:'api_migration_password_base64', 'base64'), 'UTF8')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'api_migration_role')
\gexec
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1',
  :'studio_runtime_role',
  convert_from(decode(:'studio_runtime_password_base64', 'base64'), 'UTF8')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'studio_runtime_role')
\gexec
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1',
  :'studio_migration_role',
  convert_from(decode(:'studio_migration_password_base64', 'base64'), 'UTF8')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'studio_migration_role')
\gexec
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1',
  :'maintenance_read_role',
  convert_from(decode(:'maintenance_read_password_base64', 'base64'), 'UTF8')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'maintenance_read_role')
\gexec
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1',
  :'idp_maintenance_role',
  convert_from(decode(:'idp_maintenance_password_base64', 'base64'), 'UTF8')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'idp_maintenance_role')
\gexec
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1',
  :'youtube_maintenance_role',
  convert_from(decode(:'youtube_maintenance_password_base64', 'base64'), 'UTF8')
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'youtube_maintenance_role')
\gexec

ALTER ROLE :"api_runtime_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE :"api_migration_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE :"studio_runtime_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE :"studio_migration_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE :"maintenance_read_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE :"idp_maintenance_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE :"youtube_maintenance_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE :"api_runtime_role" RESET ALL;
ALTER ROLE :"api_migration_role" RESET ALL;
ALTER ROLE :"studio_runtime_role" RESET ALL;
ALTER ROLE :"studio_migration_role" RESET ALL;
ALTER ROLE :"maintenance_read_role" RESET ALL;
ALTER ROLE :"idp_maintenance_role" RESET ALL;
ALTER ROLE :"youtube_maintenance_role" RESET ALL;

SELECT format(
  'ALTER ROLE %I IN DATABASE %I RESET ALL',
  role.rolname,
  database.datname
)
FROM pg_db_role_setting setting
JOIN pg_roles role ON role.oid = setting.setrole
JOIN pg_database database ON database.oid = setting.setdatabase
WHERE role.rolname IN (
  :'api_runtime_role',
  :'api_migration_role',
  :'studio_runtime_role',
  :'studio_migration_role',
  :'maintenance_read_role',
  :'idp_maintenance_role',
  :'youtube_maintenance_role'
)
\gexec

-- Remove every membership from the application roles. NOINHERIT alone is not
-- sufficient because SET ROLE would still expose the granted role.
SELECT format('REVOKE %I FROM %I', granted.rolname, member_role.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
JOIN pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname = ANY (ARRAY[
  :'api_runtime_role',
  :'api_migration_role',
  :'studio_runtime_role',
  :'studio_migration_role',
  :'maintenance_read_role',
  :'idp_maintenance_role',
  :'youtube_maintenance_role'
])
\gexec
SELECT format('REVOKE %I FROM %I', granted.rolname, member_role.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
JOIN pg_roles member_role ON member_role.oid = membership.member
WHERE granted.rolname = ANY (ARRAY[
  :'api_runtime_role',
  :'api_migration_role',
  :'studio_runtime_role',
  :'studio_migration_role',
  :'maintenance_read_role',
  :'idp_maintenance_role',
  :'youtube_maintenance_role'
])
\gexec

-- Commit the credential-only phase so an existing installation can perform a
-- separately reviewed ownership repair after the next phase fails closed.
COMMIT;

-- The explicit ownership-adoption mode is entered only after the provisioner
-- has established this already-connected worker and, from the postgres
-- database, closed the target database and terminated every other client. A
-- session cannot set ALLOW_CONNECTIONS=false for its own current database, so
-- the two-session fence is intentionally enforced outside this SQL stream.
-- Recheck that exact fence here before beginning any ownership transaction.
\if :object_policy_adopt_ownership
SELECT 1 / CASE WHEN
  EXISTS (
    SELECT 1
    FROM pg_database database
    WHERE database.datname = :'database_name'
      AND NOT database.datallowconn
  )
  AND current_database() = :'database_name'
  AND
  NOT EXISTS (
    SELECT 1
    FROM pg_stat_activity activity
    WHERE activity.datname = :'database_name'
      AND activity.pid <> pg_backend_pid()
      AND activity.backend_type = 'client backend'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_prepared_xacts prepared
    WHERE prepared.database = :'database_name'
  )
THEN 1 ELSE 0 END AS reviewed_database_fence_attested;
\endif
BEGIN;

-- Existing installations may opt into one explicit ownership-adoption pass.
-- The shell boundary requires the reviewed confirmation and a separately
-- attested writer stop. This transaction then takes ACCESS EXCLUSIVE locks on
-- every exact policy table before changing any owner. It never enumerates
-- objects outside the closed policy and accepts only the administrator,
-- PostgreSQL's stock owner, or the final reviewed owners as predecessors.
SELECT 1 / CASE WHEN NOT :'object_policy_adopt_ownership'::boolean OR (
  (
    NOT :'object_policy_require_complete'::boolean
    OR (SELECT count(*) FROM arenzyra_object_policy) = (
      SELECT count(*)
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN arenzyra_object_policy policy
        ON policy.relation_name = relation.relname
       AND policy.relation_kind = relation.relkind
      WHERE namespace.nspname = :'schema_name'
        AND relation.relkind = 'r'
    )
  )
  AND (
    SELECT count(*)
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN arenzyra_object_policy policy
      ON policy.relation_name = relation.relname
     AND policy.relation_kind = relation.relkind
    WHERE namespace.nspname = :'schema_name'
      AND relation.relkind = 'r'
      AND pg_get_userbyid(relation.relowner) IN (
        current_user,
        'postgres',
        :'api_migration_role',
        :'studio_migration_role'
      )
  ) = (
    SELECT count(*)
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = :'schema_name'
      AND relation.relkind = 'r'
  )
) THEN 1 ELSE 0 END AS reviewed_relation_adoption_precondition;

SELECT format(
  'LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE',
  :'schema_name',
  policy.relation_name
)
FROM arenzyra_object_policy policy
JOIN pg_class relation
  ON relation.relname = policy.relation_name
 AND relation.relkind = policy.relation_kind
JOIN pg_namespace namespace
  ON namespace.oid = relation.relnamespace
 AND namespace.nspname = :'schema_name'
WHERE :'object_policy_adopt_ownership'::boolean
ORDER BY policy.relation_name
\gexec

SELECT format(
  'ALTER TABLE %I.%I OWNER TO %I',
  :'schema_name',
  policy.relation_name,
  CASE policy.owner_profile
    WHEN 'api' THEN :'api_migration_role'
    WHEN 'studio' THEN :'studio_migration_role'
  END
)
FROM arenzyra_object_policy policy
JOIN pg_class relation
  ON relation.relname = policy.relation_name
 AND relation.relkind = policy.relation_kind
JOIN pg_namespace namespace
  ON namespace.oid = relation.relnamespace
 AND namespace.nspname = :'schema_name'
WHERE :'object_policy_adopt_ownership'::boolean
ORDER BY policy.relation_name
\gexec

SELECT 1 / CASE WHEN NOT :'object_policy_adopt_ownership'::boolean OR (
  (
    NOT :'object_policy_require_complete'::boolean
    OR (SELECT count(*) FROM arenzyra_enum_policy) = (
      SELECT count(*)
      FROM pg_type type
      JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
      JOIN arenzyra_enum_policy policy ON policy.type_name = type.typname
      WHERE namespace.nspname = :'schema_name'
        AND type.typtype = 'e'
    )
  )
  AND (
    SELECT count(*)
    FROM pg_type type
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    JOIN arenzyra_enum_policy policy ON policy.type_name = type.typname
    WHERE namespace.nspname = :'schema_name'
      AND type.typtype = 'e'
      AND pg_get_userbyid(type.typowner) IN (
        current_user,
        'postgres',
        :'api_migration_role'
      )
  ) = (
    SELECT count(*)
    FROM pg_type type
    JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = :'schema_name'
      AND type.typtype = 'e'
  )
) THEN 1 ELSE 0 END AS reviewed_enum_adoption_precondition;

SELECT format(
  'ALTER TYPE %I.%I OWNER TO %I',
  :'schema_name',
  policy.type_name,
  :'api_migration_role'
)
FROM arenzyra_enum_policy policy
JOIN pg_type type ON type.typname = policy.type_name
JOIN pg_namespace namespace
  ON namespace.oid = type.typnamespace
 AND namespace.nspname = :'schema_name'
WHERE :'object_policy_adopt_ownership'::boolean
ORDER BY policy.type_name
\gexec

SELECT 1 / CASE WHEN NOT :'object_policy_adopt_ownership'::boolean OR (
  NOT :'object_policy_require_complete'::boolean
  OR (SELECT count(*) FROM arenzyra_function_policy) = (
    SELECT count(*)
    FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    JOIN arenzyra_function_policy policy
      ON policy.function_name = routine.proname
     AND policy.identity_arguments = pg_get_function_identity_arguments(routine.oid)
    WHERE namespace.nspname = :'schema_name'
      AND routine.prokind = policy.function_kind
      AND pg_get_userbyid(routine.proowner) IN (
        current_user,
        'postgres',
        :'api_migration_role'
      )
  )
) THEN 1 ELSE 0 END AS reviewed_function_adoption_precondition;

SELECT format(
  'ALTER FUNCTION %s OWNER TO %I',
  routine.oid::regprocedure,
  :'api_migration_role'
)
FROM pg_proc routine
JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
JOIN arenzyra_function_policy policy
  ON policy.function_name = routine.proname
 AND policy.identity_arguments = pg_get_function_identity_arguments(routine.oid)
WHERE :'object_policy_adopt_ownership'::boolean
  AND namespace.nspname = :'schema_name'
ORDER BY routine.oid::regprocedure::text
\gexec

-- Existing objects must already have the reviewed owner. This deliberately
-- fails instead of silently transferring admin-owned production objects.
WITH present_relation AS (
  SELECT relation.oid, relation.relname, relation.relkind, relation.relowner
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = :'schema_name'
    AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend dependency
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objid = relation.oid
        AND dependency.deptype = 'e'
    )
), relation_mismatch AS (
  SELECT relation.oid
  FROM present_relation relation
  LEFT JOIN arenzyra_object_policy policy
    ON policy.relation_name = relation.relname
   AND policy.relation_kind = relation.relkind
  WHERE policy.relation_name IS NULL
     OR pg_get_userbyid(relation.relowner) <> CASE policy.owner_profile
       WHEN 'api' THEN :'api_migration_role'
       WHEN 'studio' THEN :'studio_migration_role'
       ELSE ''
     END
), missing_policy_relation AS (
  SELECT 1 AS oid
  FROM arenzyra_object_policy policy
  LEFT JOIN present_relation relation
    ON relation.relname = policy.relation_name
   AND relation.relkind = policy.relation_kind
  WHERE :'object_policy_require_complete'::boolean
    AND relation.oid IS NULL
), present_type AS (
  SELECT
    type.oid,
    type.typname,
    type.typtype,
    type.typowner,
    policy.type_name AS policy_name,
    policy.type_labels AS policy_labels,
    ARRAY(
      SELECT enum_value.enumlabel::text
      FROM pg_enum enum_value
      WHERE enum_value.enumtypid = type.oid
      ORDER BY enum_value.enumsortorder
    ) AS type_labels
  FROM pg_type type
  JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
  LEFT JOIN arenzyra_enum_policy policy ON policy.type_name = type.typname
  WHERE namespace.nspname = :'schema_name'
    AND NOT (
      type.typrelid <> 0 AND EXISTS (
        SELECT 1 FROM pg_class typed_relation
        WHERE typed_relation.oid = type.typrelid
          AND typed_relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_type element_type
      WHERE element_type.typarray = type.oid
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend dependency
      WHERE dependency.classid = 'pg_type'::regclass
        AND dependency.objid = type.oid
        AND dependency.deptype = 'e'
    )
), type_mismatch AS (
  SELECT type.oid
  FROM present_type type
  WHERE type.policy_name IS NULL
     OR type.typtype <> 'e'
     OR pg_get_userbyid(type.typowner) <> :'api_migration_role'
     OR type.type_labels IS DISTINCT FROM type.policy_labels
), missing_policy_type AS (
  SELECT 1 AS oid
  FROM arenzyra_enum_policy policy
  LEFT JOIN present_type type ON type.typname = policy.type_name
  WHERE :'object_policy_require_complete'::boolean
    AND type.oid IS NULL
), present_function AS (
  SELECT
    routine.oid,
    routine.proname,
    routine.proowner,
    routine.prokind,
    routine.prorettype,
    routine.proretset,
    routine.prosecdef,
    routine.proleakproof,
    routine.proisstrict,
    routine.provolatile,
    routine.proparallel,
    routine.pronargs,
    routine.pronargdefaults,
    routine.provariadic,
    routine.prosupport,
    routine.proallargtypes,
    routine.proargmodes,
    routine.proargnames,
    routine.proargdefaults,
    routine.protrftypes,
    routine.probin,
    routine.prosqlbody,
    routine.proconfig,
    routine.procost,
    routine.prorows,
    language.lanname AS language_name,
    pg_get_function_identity_arguments(routine.oid) AS identity_arguments,
    pg_get_function_result(routine.oid) AS result_type,
    encode(sha256(convert_to(routine.prosrc, 'UTF8')), 'hex') AS source_sha256,
    policy.function_name AS policy_name,
    policy.owner_profile AS policy_owner_profile,
    policy.function_kind AS policy_kind,
    policy.result_type AS policy_result_type,
    policy.language_name AS policy_language_name,
    policy.security_definer AS policy_security_definer,
    policy.volatility AS policy_volatility,
    policy.parallel_safety AS policy_parallel_safety,
    policy.is_strict AS policy_is_strict,
    policy.is_leakproof AS policy_is_leakproof,
    policy.returns_set AS policy_returns_set,
    policy.argument_defaults AS policy_argument_defaults,
    policy.estimated_cost AS policy_estimated_cost,
    policy.estimated_rows AS policy_estimated_rows,
    policy.source_sha256 AS policy_source_sha256
  FROM pg_proc routine
  JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
  JOIN pg_language language ON language.oid = routine.prolang
  LEFT JOIN arenzyra_function_policy policy
    ON policy.function_name = routine.proname
   AND policy.identity_arguments = pg_get_function_identity_arguments(routine.oid)
  WHERE namespace.nspname = :'schema_name'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend dependency
      WHERE dependency.classid = 'pg_proc'::regclass
        AND dependency.objid = routine.oid
        AND dependency.deptype = 'e'
    )
), function_mismatch AS (
  SELECT routine.oid
  FROM present_function routine
  WHERE routine.policy_name IS NULL
     OR pg_get_userbyid(routine.proowner) <> :'api_migration_role'
     OR routine.prokind <> routine.policy_kind
     OR routine.prorettype <> 'pg_catalog.trigger'::regtype
     OR routine.result_type <> routine.policy_result_type
     OR routine.language_name <> routine.policy_language_name
     OR routine.prosecdef <> routine.policy_security_definer
     OR routine.proconfig IS NOT NULL
     OR routine.provolatile <> CASE routine.policy_volatility
       WHEN 'volatile' THEN 'v'::"char"
       ELSE '!'::"char"
     END
     OR routine.proparallel <> CASE routine.policy_parallel_safety
       WHEN 'unsafe' THEN 'u'::"char"
       ELSE '!'::"char"
     END
     OR routine.proisstrict <> routine.policy_is_strict
     OR routine.proleakproof <> routine.policy_is_leakproof
     OR routine.proretset <> routine.policy_returns_set
     OR routine.pronargs <> 0
     OR routine.pronargdefaults <> routine.policy_argument_defaults
     OR routine.provariadic <> 0
     OR routine.prosupport <> 0
     OR routine.proallargtypes IS NOT NULL
     OR routine.proargmodes IS NOT NULL
     OR routine.proargnames IS NOT NULL
     OR routine.proargdefaults IS NOT NULL
     OR routine.protrftypes IS NOT NULL
     OR routine.probin IS NOT NULL
     OR routine.prosqlbody IS NOT NULL
     OR routine.procost <> routine.policy_estimated_cost
     OR routine.prorows <> routine.policy_estimated_rows
     OR routine.source_sha256 <> routine.policy_source_sha256
), missing_policy_function AS (
  SELECT 1 AS oid
  FROM arenzyra_function_policy policy
  LEFT JOIN present_function routine
    ON routine.proname = policy.function_name
   AND routine.identity_arguments = policy.identity_arguments
  WHERE :'object_policy_require_complete'::boolean
    AND routine.oid IS NULL
), present_trigger AS (
  SELECT
    trigger.oid,
    trigger.tgname,
    relation.relname AS table_name,
    relation.relowner AS table_owner,
    routine.proname AS function_name,
    function_namespace.nspname AS function_schema,
    routine.proowner AS function_owner,
    pg_get_function_identity_arguments(routine.oid) AS function_identity_arguments,
    trigger.tgenabled,
    trigger.tgisinternal,
    trigger.tgtype,
    trigger.tgparentid,
    trigger.tgconstraint,
    trigger.tgconstrrelid,
    trigger.tgconstrindid,
    trigger.tgdeferrable,
    trigger.tginitdeferred,
    trigger.tgnargs,
    trigger.tgargs,
    trigger.tgqual,
    trigger.tgoldtable,
    trigger.tgnewtable,
    ARRAY(
      SELECT attribute.attname::text
      FROM unnest(trigger.tgattr::smallint[]) WITH ORDINALITY
        AS trigger_column(attnum, position)
      JOIN pg_attribute attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attnum = trigger_column.attnum
      ORDER BY trigger_column.position
    ) AS update_columns,
    policy.trigger_name AS policy_name,
    policy.owner_profile AS policy_owner_profile,
    policy.function_name AS policy_function_name,
    policy.function_identity_arguments AS policy_function_identity_arguments,
    policy.enabled AS policy_enabled,
    policy.is_internal AS policy_is_internal,
    policy.fires_insert AS policy_fires_insert,
    policy.fires_update AS policy_fires_update,
    policy.fires_delete AS policy_fires_delete,
    policy.fires_truncate AS policy_fires_truncate,
    policy.update_columns AS policy_update_columns
  FROM pg_trigger trigger
  JOIN pg_class relation ON relation.oid = trigger.tgrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_proc routine ON routine.oid = trigger.tgfoid
  JOIN pg_namespace function_namespace
    ON function_namespace.oid = routine.pronamespace
  LEFT JOIN arenzyra_trigger_policy policy
    ON policy.table_name = relation.relname
   AND policy.trigger_name = trigger.tgname
  WHERE namespace.nspname = :'schema_name'
    AND NOT trigger.tgisinternal
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend dependency
      WHERE dependency.classid = 'pg_trigger'::regclass
        AND dependency.objid = trigger.oid
        AND dependency.deptype = 'e'
    )
), trigger_mismatch AS (
  SELECT trigger.oid
  FROM present_trigger trigger
  WHERE trigger.policy_name IS NULL
     OR trigger.policy_owner_profile <> 'api'
     OR pg_get_userbyid(trigger.table_owner) <> :'api_migration_role'
     OR pg_get_userbyid(trigger.function_owner) <> :'api_migration_role'
     OR trigger.function_schema <> :'schema_name'
     OR trigger.function_name <> trigger.policy_function_name
     OR trigger.function_identity_arguments <>
       trigger.policy_function_identity_arguments
     OR trigger.tgenabled <> trigger.policy_enabled
     OR trigger.tgisinternal <> trigger.policy_is_internal
     OR trigger.tgtype <> (
       1 + 2
       + CASE WHEN trigger.policy_fires_insert THEN 4 ELSE 0 END
       + CASE WHEN trigger.policy_fires_delete THEN 8 ELSE 0 END
       + CASE WHEN trigger.policy_fires_update THEN 16 ELSE 0 END
       + CASE WHEN trigger.policy_fires_truncate THEN 32 ELSE 0 END
     )
     OR trigger.update_columns IS DISTINCT FROM trigger.policy_update_columns
     OR trigger.tgparentid <> 0
     OR trigger.tgconstraint <> 0
     OR trigger.tgconstrrelid <> 0
     OR trigger.tgconstrindid <> 0
     OR trigger.tgdeferrable
     OR trigger.tginitdeferred
     OR trigger.tgnargs <> 0
     OR trigger.tgargs IS NULL
     OR octet_length(trigger.tgargs) <> 0
     OR trigger.tgqual IS NOT NULL
     OR trigger.tgoldtable IS NOT NULL
     OR trigger.tgnewtable IS NOT NULL
), missing_policy_trigger AS (
  SELECT 1 AS oid
  FROM arenzyra_trigger_policy policy
  LEFT JOIN present_trigger trigger
    ON trigger.table_name = policy.table_name
   AND trigger.tgname = policy.trigger_name
  WHERE :'object_policy_require_complete'::boolean
    AND trigger.oid IS NULL
), unsupported_default_acl AS (
  SELECT default_acl.oid
  FROM pg_default_acl default_acl
  JOIN pg_roles owner_role ON owner_role.oid = default_acl.defaclrole
  LEFT JOIN pg_namespace namespace ON namespace.oid = default_acl.defaclnamespace
  WHERE owner_role.rolname IN (:'api_migration_role', :'studio_migration_role')
    AND NOT (
      default_acl.defaclobjtype IN ('r', 'S', 'f', 'T')
      AND (default_acl.defaclnamespace = 0
        OR namespace.nspname = :'schema_name')
    )
), ownership_mismatch AS (
  SELECT oid FROM relation_mismatch
  UNION ALL SELECT oid FROM missing_policy_relation
  UNION ALL SELECT oid FROM type_mismatch
  UNION ALL SELECT oid FROM missing_policy_type
  UNION ALL SELECT oid FROM function_mismatch
  UNION ALL SELECT oid FROM missing_policy_function
  UNION ALL SELECT oid FROM trigger_mismatch
  UNION ALL SELECT oid FROM missing_policy_trigger
  UNION ALL SELECT oid FROM unsupported_default_acl
)
SELECT 1 / CASE WHEN count(*) = 0 THEN 1 ELSE 0 END AS ownership_boundary_attested
FROM ownership_mismatch;

-- Start from no ambient grants. PostgreSQL's public CONNECT/TEMPORARY defaults
-- are removed, and database/schema CREATE are revoked explicitly.
REVOKE CREATE ON DATABASE :"database_name" FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE :"database_name" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE :"database_name" FROM :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
SELECT DISTINCT format(
  'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %s',
  database.datname,
  CASE
    WHEN privilege.grantee = 0 THEN 'PUBLIC'
    ELSE format('%I', pg_get_userbyid(privilege.grantee))
  END
)
FROM pg_database database
CROSS JOIN LATERAL aclexplode(database.datacl) privilege
WHERE database.datname = :'database_name'
  AND privilege.grantee <> database.datdba
\gexec
GRANT CONNECT ON DATABASE :"database_name" TO :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";

REVOKE CREATE ON SCHEMA :"schema_name" FROM PUBLIC;
REVOKE USAGE ON SCHEMA :"schema_name" FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA :"schema_name" FROM :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
SELECT DISTINCT format(
  'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM %s',
  namespace.nspname,
  CASE
    WHEN privilege.grantee = 0 THEN 'PUBLIC'
    ELSE format('%I', pg_get_userbyid(privilege.grantee))
  END
)
FROM pg_namespace namespace
CROSS JOIN LATERAL aclexplode(namespace.nspacl) privilege
WHERE namespace.nspname = :'schema_name'
  AND privilege.grantee <> namespace.nspowner
\gexec
GRANT USAGE ON SCHEMA :"schema_name" TO :"api_runtime_role", :"studio_runtime_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
GRANT USAGE, CREATE ON SCHEMA :"schema_name" TO :"api_migration_role", :"studio_migration_role";

-- Physical-target authentication needs one catalog function, not membership
-- in pg_monitor or another predefined monitoring role. Revoke the ambient
-- function default and grant EXECUTE only to the read-only IDP scanner, the
-- IDP compare-and-swap role, and the API migrator used by constraint validation.
SELECT 1 / CASE WHEN to_regprocedure('pg_catalog.pg_control_system()') IS NOT NULL
  THEN 1 ELSE 0 END AS physical_identity_function_attested;
SELECT format(
  'REVOKE ALL PRIVILEGES ON FUNCTION pg_catalog.pg_control_system() FROM %s',
  CASE
    WHEN privilege.grantee = 0 THEN 'PUBLIC'
    ELSE format('%I', pg_get_userbyid(privilege.grantee))
  END
)
FROM pg_proc routine
JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
CROSS JOIN LATERAL aclexplode(
  COALESCE(routine.proacl, acldefault('f', routine.proowner))
) privilege
WHERE namespace.nspname = 'pg_catalog'
  AND routine.proname = 'pg_control_system'
  AND pg_get_function_identity_arguments(routine.oid) = ''
  AND privilege.grantee <> routine.proowner
GROUP BY privilege.grantee
\gexec
REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system()
  FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system()
  TO :"api_migration_role", :"maintenance_read_role", :"idp_maintenance_role";

-- No runtime DML defaults are allowed: a broad default grant would also make a
-- newly-created migration ledger writable. Reconciliation runs after migration.
ALTER DEFAULT PRIVILEGES FOR ROLE :"api_migration_role"
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, :"api_runtime_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"api_migration_role"
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, :"api_runtime_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"api_migration_role"
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, :"api_runtime_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"api_migration_role"
  REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC, :"api_runtime_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"studio_migration_role"
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"studio_migration_role"
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"studio_migration_role"
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"studio_migration_role"
  REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"api_migration_role" IN SCHEMA :"schema_name"
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, :"api_runtime_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"api_migration_role" IN SCHEMA :"schema_name"
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, :"api_runtime_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"studio_migration_role" IN SCHEMA :"schema_name"
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"studio_migration_role" IN SCHEMA :"schema_name"
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"api_migration_role" IN SCHEMA :"schema_name"
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, :"api_runtime_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"studio_migration_role" IN SCHEMA :"schema_name"
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"api_migration_role" IN SCHEMA :"schema_name"
  REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC, :"api_runtime_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"studio_migration_role" IN SCHEMA :"schema_name"
  REVOKE ALL PRIVILEGES ON TYPES FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";

-- Remove any ambient third-party defaults owned by either migrator. Owner ACL
-- entries are inherent and are the only entries allowed to remain.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I%s REVOKE %s ON %s FROM %s',
  owner_role.rolname,
  CASE
    WHEN default_acl.defaclnamespace = 0 THEN ''
    ELSE format(' IN SCHEMA %I', namespace.nspname)
  END,
  privilege.privilege_type,
  CASE default_acl.defaclobjtype
    WHEN 'r' THEN 'TABLES'
    WHEN 'S' THEN 'SEQUENCES'
    WHEN 'f' THEN 'FUNCTIONS'
    WHEN 'T' THEN 'TYPES'
  END,
  CASE
    WHEN privilege.grantee = 0 THEN 'PUBLIC'
    ELSE format('%I', pg_get_userbyid(privilege.grantee))
  END
)
FROM pg_default_acl default_acl
JOIN pg_roles owner_role ON owner_role.oid = default_acl.defaclrole
LEFT JOIN pg_namespace namespace ON namespace.oid = default_acl.defaclnamespace
CROSS JOIN LATERAL aclexplode(default_acl.defaclacl) privilege
WHERE owner_role.rolname IN (:'api_migration_role', :'studio_migration_role')
  AND default_acl.defaclobjtype IN ('r', 'S', 'f', 'T')
  AND (default_acl.defaclnamespace = 0 OR namespace.nspname = :'schema_name')
  AND privilege.grantee <> default_acl.defaclrole
\gexec

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA :"schema_name" FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA :"schema_name" FROM PUBLIC, :"api_runtime_role", :"api_migration_role", :"studio_runtime_role", :"studio_migration_role", :"maintenance_read_role", :"idp_maintenance_role", :"youtube_maintenance_role";

SELECT DISTINCT format(
  'REVOKE ALL PRIVILEGES ON %s %I.%I FROM %s',
  CASE WHEN relation.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
  namespace.nspname,
  relation.relname,
  CASE
    WHEN privilege.grantee = 0 THEN 'PUBLIC'
    ELSE format('%I', pg_get_userbyid(privilege.grantee))
  END
)
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
CROSS JOIN LATERAL aclexplode(relation.relacl) privilege
WHERE namespace.nspname = :'schema_name'
  AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  AND privilege.grantee <> relation.relowner
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend dependency
    WHERE dependency.classid = 'pg_class'::regclass
      AND dependency.objid = relation.oid
      AND dependency.deptype = 'e'
  )
\gexec

SELECT format(
  'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE %2$I.%3$I FROM PUBLIC, %4$I, %5$I, %6$I, %7$I, %8$I, %9$I, %10$I',
  attribute.attname,
  namespace.nspname,
  relation.relname,
  :'api_runtime_role',
  :'api_migration_role',
  :'studio_runtime_role',
  :'studio_migration_role',
  :'maintenance_read_role',
  :'idp_maintenance_role',
  :'youtube_maintenance_role'
)
FROM pg_attribute attribute
JOIN pg_class relation ON relation.oid = attribute.attrelid
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = :'schema_name'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
\gexec

SELECT DISTINCT format(
  'REVOKE %s (%I) ON TABLE %I.%I FROM %s',
  privilege.privilege_type,
  attribute.attname,
  namespace.nspname,
  relation.relname,
  CASE
    WHEN privilege.grantee = 0 THEN 'PUBLIC'
    ELSE format('%I', pg_get_userbyid(privilege.grantee))
  END
)
FROM pg_attribute attribute
JOIN pg_class relation ON relation.oid = attribute.attrelid
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
CROSS JOIN LATERAL aclexplode(attribute.attacl) privilege
WHERE namespace.nspname = :'schema_name'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
  AND privilege.grantee <> relation.relowner
\gexec

-- A migration owner must retain DML on its own exact closed-policy relations.
-- Ownership permits DDL but an explicit REVOKE can still remove SELECT/INSERT/
-- UPDATE/DELETE and make data migrations or constraint validation fail. Restore
-- the complete owner ACL only for reviewed relations and only to the owner that
-- the policy already attested above; cross-migrator access remains absent.
SELECT format(
  'GRANT ALL PRIVILEGES ON TABLE %I.%I TO %I',
  namespace.nspname,
  relation.relname,
  CASE policy.owner_profile
    WHEN 'api' THEN :'api_migration_role'
    WHEN 'studio' THEN :'studio_migration_role'
  END
)
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
JOIN arenzyra_object_policy policy
  ON policy.relation_name = relation.relname
 AND policy.relation_kind = relation.relkind
WHERE namespace.nspname = :'schema_name'
  AND pg_get_userbyid(relation.relowner) = CASE policy.owner_profile
    WHEN 'api' THEN :'api_migration_role'
    WHEN 'studio' THEN :'studio_migration_role'
  END
ORDER BY policy.relation_name
\gexec

-- Enum types are closed policy objects. PostgreSQL otherwise gives PUBLIC
-- USAGE by default, so remove every non-owner ACL and regrant only the API
-- runtime identity that reads and writes the enum-backed API columns.
SELECT format(
  'REVOKE ALL PRIVILEGES ON TYPE %I.%I FROM PUBLIC, %I, %I, %I, %I, %I, %I',
  namespace.nspname,
  type.typname,
  :'api_runtime_role',
  :'studio_runtime_role',
  :'studio_migration_role',
  :'maintenance_read_role',
  :'idp_maintenance_role',
  :'youtube_maintenance_role'
)
FROM pg_type type
JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
JOIN arenzyra_enum_policy policy ON policy.type_name = type.typname
WHERE namespace.nspname = :'schema_name'
  AND type.typtype = 'e'
  AND pg_get_userbyid(type.typowner) = :'api_migration_role'
\gexec

SELECT DISTINCT format(
  'REVOKE ALL PRIVILEGES ON TYPE %I.%I FROM %s',
  namespace.nspname,
  type.typname,
  CASE
    WHEN privilege.grantee = 0 THEN 'PUBLIC'
    ELSE format('%I', pg_get_userbyid(privilege.grantee))
  END
)
FROM pg_type type
JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
JOIN arenzyra_enum_policy policy ON policy.type_name = type.typname
CROSS JOIN LATERAL aclexplode(type.typacl) privilege
WHERE namespace.nspname = :'schema_name'
  AND type.typtype = 'e'
  AND pg_get_userbyid(type.typowner) = :'api_migration_role'
  AND privilege.grantee <> type.typowner
\gexec

SELECT format(
  'GRANT USAGE ON TYPE %I.%I TO %I, %I',
  namespace.nspname,
  type.typname,
  :'api_runtime_role',
  :'api_migration_role'
)
FROM pg_type type
JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
JOIN arenzyra_enum_policy policy ON policy.type_name = type.typname
WHERE namespace.nspname = :'schema_name'
  AND type.typtype = 'e'
  AND pg_get_userbyid(type.typowner) = :'api_migration_role'
\gexec

SELECT format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, %I, %I, %I, %I, %I, %I', routine.oid::regprocedure, :'api_runtime_role', :'studio_runtime_role', :'studio_migration_role', :'maintenance_read_role', :'idp_maintenance_role', :'youtube_maintenance_role')
FROM pg_proc routine
JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
WHERE namespace.nspname = :'schema_name'
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend dependency
    WHERE dependency.classid = 'pg_proc'::regclass
      AND dependency.objid = routine.oid
      AND dependency.deptype = 'e'
  )
\gexec

SELECT DISTINCT format(
  'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %s',
  routine.oid::regprocedure,
  CASE
    WHEN privilege.grantee = 0 THEN 'PUBLIC'
    ELSE format('%I', pg_get_userbyid(privilege.grantee))
  END
)
FROM pg_proc routine
JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
CROSS JOIN LATERAL aclexplode(routine.proacl) privilege
WHERE namespace.nspname = :'schema_name'
  AND privilege.grantee <> routine.proowner
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend dependency
    WHERE dependency.classid = 'pg_proc'::regclass
      AND dependency.objid = routine.oid
      AND dependency.deptype = 'e'
  )
\gexec

SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO %I',
  routine.oid::regprocedure,
  :'api_migration_role'
)
FROM pg_proc routine
JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
JOIN arenzyra_function_policy policy
  ON policy.function_name = routine.proname
 AND policy.identity_arguments = pg_get_function_identity_arguments(routine.oid)
WHERE namespace.nspname = :'schema_name'
  AND pg_get_userbyid(routine.proowner) = :'api_migration_role'
\gexec

-- Regrant only exact manifest-classified runtime tables already owned by the
-- matching migrator. Ownership alone never makes a new relation reachable.
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO %I',
  namespace.nspname, relation.relname, :'api_runtime_role'
)
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
JOIN arenzyra_object_policy policy
  ON policy.relation_name = relation.relname
 AND policy.relation_kind = relation.relkind
WHERE namespace.nspname = :'schema_name'
  AND policy.runtime_profile = 'api'
  AND policy.owner_profile = 'api'
  AND pg_get_userbyid(relation.relowner) = :'api_migration_role'
\gexec

-- Maintenance scans share a read-only login limited to the exact columns
-- inspected by both tasks. Apply roles receive the same task-specific reads
-- plus only the columns their compare-and-swap writes mutate, including the
-- Prisma-managed concurrency timestamp. No table-wide DML is granted.
-- Conditional grants allow the empty first-deploy database; post-migration
-- reconciliation adds and verifies them once the reviewed tables exist.
WITH maintenance_grant(
  role_name,
  relation_name,
  privilege_name,
  column_list
) AS (
  VALUES
    (
      :'maintenance_read_role',
      'DiscordIdpSchedule',
      'SELECT',
      '"id", "organizationId", "sessionId", "matchNumber", "roomId", "roomPassword", "primaryMessage", "reminders", "updatedAt", "createdAt"'
    ),
    (
      :'maintenance_read_role',
      'YoutubeChannel',
      'SELECT',
      '"id", "accessTokenEnc", "refreshTokenEnc", "updatedAt"'
    ),
    (
      :'idp_maintenance_role',
      'DiscordIdpSchedule',
      'SELECT',
      '"id", "organizationId", "sessionId", "matchNumber", "roomId", "roomPassword", "primaryMessage", "reminders", "updatedAt", "createdAt"'
    ),
    (
      :'idp_maintenance_role',
      'DiscordIdpSchedule',
      'UPDATE',
      '"roomPassword", "primaryMessage", "reminders", "updatedAt"'
    ),
    (
      :'youtube_maintenance_role',
      'YoutubeChannel',
      'SELECT',
      '"id", "accessTokenEnc", "refreshTokenEnc", "updatedAt"'
    ),
    (
      :'youtube_maintenance_role',
      'YoutubeChannel',
      'UPDATE',
      '"accessTokenEnc", "refreshTokenEnc", "updatedAt"'
    )
)
SELECT format(
  'GRANT %s (%s) ON TABLE %I.%I TO %I',
  maintenance_grant.privilege_name,
  maintenance_grant.column_list,
  namespace.nspname,
  relation.relname,
  maintenance_grant.role_name
)
FROM maintenance_grant
JOIN pg_class relation
  ON relation.relname = maintenance_grant.relation_name
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
JOIN arenzyra_object_policy policy
  ON policy.relation_name = relation.relname
 AND policy.relation_kind = relation.relkind
WHERE namespace.nspname = :'schema_name'
  AND policy.runtime_profile = 'api'
  AND policy.owner_profile = 'api'
  AND pg_get_userbyid(relation.relowner) = :'api_migration_role'
\gexec

SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO %I',
  namespace.nspname, relation.relname, :'studio_runtime_role'
)
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
JOIN arenzyra_object_policy policy
  ON policy.relation_name = relation.relname
 AND policy.relation_kind = relation.relkind
WHERE namespace.nspname = :'schema_name'
  AND policy.runtime_profile = 'studio'
  AND policy.owner_profile = 'studio'
  AND pg_get_userbyid(relation.relowner) = :'studio_migration_role'
\gexec

-- Policy schemaVersion 1 deliberately permits no sequence. The ownership
-- boundary above fails on any sequence before this grant phase; support for a
-- future sequence requires an explicit table/column dependency policy first.

SELECT format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I, %I, %I, %I, %I', namespace.nspname, relation.relname, :'api_runtime_role', :'studio_runtime_role', :'maintenance_read_role', :'idp_maintenance_role', :'youtube_maintenance_role')
FROM pg_class relation
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
JOIN arenzyra_object_policy policy
  ON policy.relation_name = relation.relname
 AND policy.relation_kind = relation.relkind
WHERE namespace.nspname = :'schema_name'
  AND policy.runtime_profile = 'none'
\gexec

COMMIT;
