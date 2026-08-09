#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-/opt/arenzyra/infra/.env.publish}"
OBJECT_POLICY_FILE="$REPOSITORY_ROOT/infra/production-database-object-policy.json"
OBJECT_POLICY_ALLOW_EMPTY="${ARENZYRA_OBJECT_POLICY_ALLOW_EMPTY:-0}"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
LOCK_TIMEOUT_SECONDS=10
ENV_FILE="$(realpath -e -- "$ENV_FILE" 2>/dev/null)" || {
  printf 'DATABASE ROLE GATE BLOCKED: reviewed environment file is unavailable.\n' >&2
  exit 75
}
if [ "$REPOSITORY_ROOT" != "/opt/arenzyra" ] || \
   [ "$ENV_FILE" != "/opt/arenzyra/infra/.env.publish" ]; then
  printf 'DATABASE ROLE GATE BLOCKED: production root or environment binding is not exact.\n' >&2
  exit 75
fi
source "$SCRIPT_DIR/require-local-production-docker.sh"
cd "$REPOSITORY_ROOT"

if [ "$OBJECT_POLICY_ALLOW_EMPTY" != "0" ] && \
   [ "$OBJECT_POLICY_ALLOW_EMPTY" != "1" ]; then
  printf 'DATABASE ROLE GATE BLOCKED: object-policy mode is invalid.\n' >&2
  exit 75
fi

for command in dirname docker flock id node readlink realpath stat; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'DATABASE ROLE GATE BLOCKED: required command is unavailable.\n' >&2
    exit 75
  }
done

resolved_object_policy_file="$(realpath -e -- "$OBJECT_POLICY_FILE" 2>/dev/null)" || {
  printf 'DATABASE ROLE GATE BLOCKED: reviewed object policy is unavailable.\n' >&2
  exit 75
}
object_policy_owner="$(stat -c %u -- "$resolved_object_policy_file")"
object_policy_mode="$(stat -c %a -- "$resolved_object_policy_file")"
object_policy_links="$(stat -c %h -- "$resolved_object_policy_file")"
if [ "$resolved_object_policy_file" != "/opt/arenzyra/infra/production-database-object-policy.json" ] || \
   [ -L "$OBJECT_POLICY_FILE" ] || [ ! -f "$resolved_object_policy_file" ] || \
   [ "$object_policy_owner" != "0" ] || [ "$object_policy_links" != "1" ] || \
   ! [[ "$object_policy_mode" =~ ^[0-7]{3,4}$ ]] || \
   (( (8#$object_policy_mode & 8#022) != 0 )); then
  printf 'DATABASE ROLE GATE BLOCKED: object policy path, ownership, or mode is unsafe.\n' >&2
  exit 75
fi
object_policy_base64="$(
  node "$SCRIPT_DIR/production-database-object-policy.cjs" \
    --manifest "$resolved_object_policy_file" \
    --repository-root "$REPOSITORY_ROOT" \
    --print-base64
)" || {
  printf 'DATABASE ROLE GATE BLOCKED: object policy does not match the repository.\n' >&2
  exit 75
}
if [ -z "$object_policy_base64" ] || \
   [ "${#object_policy_base64}" -gt 65536 ] || \
   ! [[ "$object_policy_base64" =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
  printf 'DATABASE ROLE GATE BLOCKED: object policy encoding is invalid.\n' >&2
  exit 75
fi

read_env() {
  node "$SCRIPT_DIR/read-dotenv-value.cjs" "$ENV_FILE" "$1"
}
read_url() {
  node "$SCRIPT_DIR/read-postgres-url-field.cjs" "$ENV_FILE" "$1" "$2"
}

# Validate all routing fields before decoding any URL credential.
node "$SCRIPT_DIR/production-database-target.cjs" --env "$ENV_FILE" --check >/dev/null

compose_project="$(read_env ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
postgres_admin_role="$(read_env POSTGRES_USER)"
postgres_admin_password="$(read_env POSTGRES_PASSWORD)"
postgres_database="$(read_env POSTGRES_DB)"
api_runtime_role="$(read_url DATABASE_URL username)"
api_runtime_password="$(read_url DATABASE_URL password)"
api_migration_role="$(read_url MIGRATION_DATABASE_URL username)"
api_migration_password="$(read_url MIGRATION_DATABASE_URL password)"
studio_runtime_role="$(read_url STUDIO_DATABASE_URL username)"
studio_runtime_password="$(read_url STUDIO_DATABASE_URL password)"
studio_migration_role="$(read_url STUDIO_MIGRATION_DATABASE_URL username)"
studio_migration_password="$(read_url STUDIO_MIGRATION_DATABASE_URL password)"
maintenance_read_role="$(read_url MAINTENANCE_READ_DATABASE_URL username)"
maintenance_read_password="$(read_url MAINTENANCE_READ_DATABASE_URL password)"
idp_maintenance_role="$(read_url IDP_MAINTENANCE_DATABASE_URL username)"
idp_maintenance_password="$(read_url IDP_MAINTENANCE_DATABASE_URL password)"
youtube_maintenance_role="$(read_url YOUTUBE_MAINTENANCE_DATABASE_URL username)"
youtube_maintenance_password="$(read_url YOUTUBE_MAINTENANCE_DATABASE_URL password)"

for role in "$postgres_admin_role" "$api_runtime_role" "$api_migration_role" "$studio_runtime_role" "$studio_migration_role" "$maintenance_read_role" "$idp_maintenance_role" "$youtube_maintenance_role"; do
  [[ "$role" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || {
    printf 'DATABASE ROLE GATE BLOCKED: unsafe configured role.\n' >&2
    exit 75
  }
done
for password in "$postgres_admin_password" "$api_runtime_password" "$api_migration_password" "$studio_runtime_password" "$studio_migration_password" "$maintenance_read_password" "$idp_maintenance_password" "$youtube_maintenance_password"; do
  [ -n "$password" ] && [[ "$password" != *$'\n'* ]] && [[ "$password" != *$'\r'* ]] || {
    printf 'DATABASE ROLE GATE BLOCKED: unsafe configured credential.\n' >&2
    exit 75
  }
done
if [ "$(printf '%s\n' "$postgres_admin_role" "$api_runtime_role" "$api_migration_role" "$studio_runtime_role" "$studio_migration_role" "$maintenance_read_role" "$idp_maintenance_role" "$youtube_maintenance_role" | sort -u | wc -l)" -ne 8 ]; then
  printf 'DATABASE ROLE GATE BLOCKED: administrator and application roles must be distinct.\n' >&2
  exit 75
fi
if ! [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  printf 'DATABASE ROLE GATE BLOCKED: unsafe Compose project.\n' >&2
  exit 75
fi

if [ "$(id -u)" -ne 0 ]; then
  printf 'DATABASE ROLE GATE BLOCKED: effective UID must be 0.\n' >&2
  exit 75
fi

verify_lock_directory_safety() {
  local lock_directory lock_directory_mode lock_directory_owner resolved_lock_directory
  lock_directory="$(dirname -- "$LOCK_FILE")"
  if [ -L "$lock_directory" ] || [ ! -d "$lock_directory" ]; then
    printf 'DATABASE ROLE GATE BLOCKED: deployment lock directory is unsafe.\n' >&2
    return 75
  fi
  resolved_lock_directory="$(realpath -e -- "$lock_directory" 2>/dev/null || true)"
  lock_directory_owner="$(stat -c %u -- "$lock_directory")"
  lock_directory_mode="$(stat -c %a -- "$lock_directory")"
  if [ "$resolved_lock_directory" != "/run" ] || \
    [ "$lock_directory_owner" != "0" ] || \
    ! [[ "$lock_directory_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$lock_directory_mode & 8#022) != 0 )); then
    printf 'DATABASE ROLE GATE BLOCKED: deployment lock directory ownership or mode is unsafe.\n' >&2
    return 75
  fi
}

verify_lock_file_safety() {
  local descriptor_identity lock_identity lock_mode lock_owner lock_target
  if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ]; then
    printf 'DATABASE ROLE GATE BLOCKED: deployment lock path is not a regular non-symlink file.\n' >&2
    return 75
  fi
  lock_target="$(readlink -f "/proc/$$/fd/8" 2>/dev/null || true)"
  lock_owner="$(stat -Lc %u -- "/proc/$$/fd/8")"
  lock_mode="$(stat -Lc %a -- "/proc/$$/fd/8")"
  lock_identity="$(stat -Lc '%d:%i:%h' -- "$LOCK_FILE")"
  descriptor_identity="$(stat -Lc '%d:%i:%h' -- "/proc/$$/fd/8")"
  if [ "$lock_target" != "$LOCK_FILE" ] || \
    [ "$lock_owner" != "0" ] || \
    ! [[ "$lock_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$lock_mode & 8#022) != 0 )) || \
    [ "$lock_identity" != "$descriptor_identity" ] || \
    [ "${lock_identity##*:}" != "1" ]; then
    printf 'DATABASE ROLE GATE BLOCKED: deployment lock file ownership, mode, or identity is unsafe.\n' >&2
    return 75
  fi
}

verify_lock_directory_safety
if [ -e "$LOCK_FILE" ] || [ -L "$LOCK_FILE" ]; then
  if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ]; then
    printf 'DATABASE ROLE GATE BLOCKED: deployment lock path is unsafe.\n' >&2
    exit 75
  fi
  existing_lock_owner="$(stat -c %u -- "$LOCK_FILE")"
  existing_lock_mode="$(stat -c %a -- "$LOCK_FILE")"
  existing_lock_links="$(stat -c %h -- "$LOCK_FILE")"
  if [ "$existing_lock_owner" != "0" ] || \
    ! [[ "$existing_lock_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$existing_lock_mode & 8#022) != 0 )) || \
    [ "$existing_lock_links" != "1" ]; then
    printf 'DATABASE ROLE GATE BLOCKED: deployment lock path ownership or mode is unsafe.\n' >&2
    exit 75
  fi
fi
if [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = "1" ]; then
  if ! verify_lock_file_safety || ! flock -n 8; then
    printf 'DATABASE ROLE GATE BLOCKED: inherited deployment lock was not verified.\n' >&2
    exit 75
  fi
else
  exec 8>"$LOCK_FILE"
  verify_lock_file_safety
  flock -w "$LOCK_TIMEOUT_SECONDS" 8 || {
    printf 'DATABASE ROLE GATE BLOCKED: production deployment lock is held.\n' >&2
    exit 75
  }
fi

export ARENZYRA_DEPLOY_COMPOSE_PROJECT="$compose_project"
export ARENZYRA_DEPLOY_ENV_FILE="$ENV_FILE"
mapfile -t database_binding < <(bash "$SCRIPT_DIR/verify-production-database-container.sh")
if [ "${#database_binding[@]}" -ne 5 ] || [ "$postgres_database" != "${database_binding[3]}" ]; then
  printf 'DATABASE ROLE GATE BLOCKED: reviewed database binding was not verified.\n' >&2
  exit 75
fi
postgres_container="${database_binding[0]}"
postgres_port="${database_binding[2]}"
schema_name="${database_binding[4]}"

run_credential_attestation() {
  local profile="$1"
  local role="$2"
  local password="$3"
  local result
  if ! result="$({
    printf '%s\n' \
      "$profile" "$role" "$password" "$postgres_database" "$schema_name" "$postgres_port" \
      "$api_runtime_role" "$api_migration_role" "$studio_runtime_role" "$studio_migration_role" \
      "$maintenance_read_role" "$idp_maintenance_role" "$youtube_maintenance_role" \
      "$object_policy_base64" "$OBJECT_POLICY_ALLOW_EMPTY"
    cat <<'SQL'
WITH object_policy_document AS (
  SELECT convert_from(
    decode(:'object_policy_base64', 'base64'),
    'UTF8'
  )::jsonb AS document
), object_policy AS (
  SELECT name AS relation_name, 'r'::"char" AS relation_kind,
    'api'::text AS owner_profile, 'api'::text AS runtime_profile
  FROM object_policy_document,
    LATERAL jsonb_array_elements_text(document -> 'apiRuntimeTables') AS item(name)
  UNION ALL
  SELECT name, 'r', 'api', 'none'
  FROM object_policy_document,
    LATERAL jsonb_array_elements_text(document -> 'apiMigrationLedgers') AS item(name)
  UNION ALL
  SELECT name, 'r', 'studio', 'studio'
  FROM object_policy_document,
    LATERAL jsonb_array_elements_text(document -> 'studioRuntimeTables') AS item(name)
  UNION ALL
  SELECT name, 'r', 'studio', 'none'
  FROM object_policy_document,
    LATERAL jsonb_array_elements_text(document -> 'studioMigrationLedgers') AS item(name)
), enum_policy AS (
  SELECT
    item.name AS type_name,
    ARRAY(SELECT jsonb_array_elements_text(item.labels)) AS type_labels,
    'api'::text AS owner_profile,
    'api'::text AS runtime_profile
  FROM object_policy_document,
    LATERAL jsonb_to_recordset(document -> 'apiEnumTypes') AS item(
      name text,
      labels jsonb
    )
), function_policy AS (
  SELECT
    item.name AS function_name,
    item."ownerProfile" AS owner_profile,
    item.kind::"char" AS function_kind,
    item."identityArguments" AS identity_arguments,
    item."resultType" AS result_type,
    item.language AS language_name,
    item."securityDefiner" AS security_definer,
    item.volatility,
    item.parallel AS parallel_safety,
    item.strict AS is_strict,
    item.leakproof AS is_leakproof,
    item."returnsSet" AS returns_set,
    item."argumentDefaults" AS argument_defaults,
    item.cost AS estimated_cost,
    item.rows AS estimated_rows,
    item."sourceSha256" AS source_sha256
  FROM object_policy_document,
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
    )
), trigger_policy AS (
  SELECT
    item.name AS trigger_name,
    item."ownerProfile" AS owner_profile,
    item."tableName" AS table_name,
    item."functionName" AS function_name,
    item."functionIdentityArguments" AS function_identity_arguments,
    item.enabled::"char" AS enabled,
    item.internal AS is_internal,
    item.timing,
    item.level AS trigger_level,
    item.events ? 'INSERT' AS fires_insert,
    item.events ? 'UPDATE' AS fires_update,
    item.events ? 'DELETE' AS fires_delete,
    item.events ? 'TRUNCATE' AS fires_truncate,
    ARRAY(SELECT jsonb_array_elements_text(item."updateColumns"))
      AS update_columns
  FROM object_policy_document,
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
    )
), parameter AS (
  SELECT
    current_setting('arenzyra.role_profile') AS profile,
    current_setting('arenzyra.expected_role') AS expected_role,
    current_setting('arenzyra.expected_database') AS expected_database,
    current_setting('arenzyra.expected_schema') AS expected_schema,
    current_setting('arenzyra.expected_port')::integer AS expected_port,
    current_setting('arenzyra.api_runtime_role') AS api_runtime_role,
    current_setting('arenzyra.api_migration_role') AS api_migration_role,
    current_setting('arenzyra.studio_runtime_role') AS studio_runtime_role,
    current_setting('arenzyra.studio_migration_role') AS studio_migration_role,
    current_setting('arenzyra.maintenance_read_role') AS maintenance_read_role,
    current_setting('arenzyra.idp_maintenance_role') AS idp_maintenance_role,
    current_setting('arenzyra.youtube_maintenance_role') AS youtube_maintenance_role,
    current_setting('arenzyra.object_policy_allow_empty')::integer = 1
      AS object_policy_allow_empty
), configured_app_role AS (
  SELECT role.oid, role.rolname
  FROM pg_roles role CROSS JOIN parameter
  WHERE role.rolname IN (
    parameter.api_runtime_role,
    parameter.api_migration_role,
    parameter.studio_runtime_role,
    parameter.studio_migration_role,
    parameter.maintenance_read_role,
    parameter.idp_maintenance_role,
    parameter.youtube_maintenance_role
  )
), migration_role AS (
  SELECT role.oid, role.rolname
  FROM pg_roles role CROSS JOIN parameter
  WHERE role.rolname IN (
    parameter.api_migration_role,
    parameter.studio_migration_role
  )
), other_app_schema AS (
  SELECT namespace.oid, namespace.nspname, namespace.nspowner,
    namespace.nspacl
  FROM pg_namespace namespace CROSS JOIN parameter
  WHERE namespace.nspname <> parameter.expected_schema
    AND namespace.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    AND namespace.nspname NOT LIKE 'pg_temp_%'
    AND namespace.nspname NOT LIKE 'pg_toast_temp_%'
), app_relation AS (
  SELECT
    relation.oid,
    relation.relname,
    relation.relkind,
    relation.relowner AS owner_oid,
    relation.relacl,
    relation.relrowsecurity,
    relation.relforcerowsecurity,
    pg_get_userbyid(relation.relowner) AS owner_name,
    policy.relation_name AS policy_name,
    policy.owner_profile AS policy_owner_profile,
    policy.runtime_profile AS policy_runtime_profile,
    policy.owner_profile = 'studio' AS is_studio,
    policy.runtime_profile = 'none' AS is_ledger
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN parameter
  LEFT JOIN object_policy policy
    ON policy.relation_name = relation.relname
   AND policy.relation_kind = relation.relkind
  WHERE namespace.nspname = parameter.expected_schema
    AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_class'::regclass
        AND dependency.objid = relation.oid
        AND dependency.deptype = 'e'
    )
), app_type AS (
  SELECT
    type.oid,
    type.typname,
    type.typtype,
    type.typowner AS owner_oid,
    type.typacl,
    pg_get_userbyid(type.typowner) AS owner_name,
    policy.type_name AS policy_name,
    policy.type_labels AS policy_labels,
    policy.owner_profile AS policy_owner_profile,
    policy.runtime_profile AS policy_runtime_profile,
    ARRAY(
      SELECT enum_value.enumlabel::text
      FROM pg_enum enum_value
      WHERE enum_value.enumtypid = type.oid
      ORDER BY enum_value.enumsortorder
    ) AS type_labels
  FROM pg_type type
  JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
  CROSS JOIN parameter
  LEFT JOIN enum_policy policy ON policy.type_name = type.typname
  WHERE namespace.nspname = parameter.expected_schema
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
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_type'::regclass
        AND dependency.objid = type.oid
        AND dependency.deptype = 'e'
    )
), app_function AS (
  SELECT
    routine.oid,
    routine.proname,
    routine.prokind,
    routine.proowner AS owner_oid,
    routine.proacl,
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
    pg_get_userbyid(routine.proowner) AS owner_name,
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
  CROSS JOIN parameter
  LEFT JOIN function_policy policy
    ON policy.function_name = routine.proname
   AND policy.identity_arguments = pg_get_function_identity_arguments(routine.oid)
  WHERE namespace.nspname = parameter.expected_schema
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_proc'::regclass
        AND dependency.objid = routine.oid
        AND dependency.deptype = 'e'
    )
), app_trigger AS (
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
    policy.timing AS policy_timing,
    policy.trigger_level AS policy_trigger_level,
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
  CROSS JOIN parameter
  LEFT JOIN trigger_policy policy
    ON policy.table_name = relation.relname
   AND policy.trigger_name = trigger.tgname
  WHERE namespace.nspname = parameter.expected_schema
    AND NOT trigger.tgisinternal
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      WHERE dependency.classid = 'pg_trigger'::regclass
        AND dependency.objid = trigger.oid
        AND dependency.deptype = 'e'
    )
), violation AS (
  SELECT 1 AS violation
  FROM parameter
  WHERE current_user <> expected_role
     OR current_database() <> expected_database
     OR COALESCE(current_schema(), '') <> expected_schema
     OR inet_server_port() <> expected_port

  -- The policy document itself is closed and repository-bound by the Node
  -- validator. Recheck its database-facing invariants in the SQL session.
  UNION ALL
  SELECT 1
  FROM object_policy_document CROSS JOIN parameter
  WHERE document ->> 'schemaVersion' <> '1'
     OR document ->> 'databaseSchema' <> parameter.expected_schema
     OR jsonb_array_length(document -> 'sequences') <> 0
     OR jsonb_array_length(document -> 'apiEnumTypes') <> 69
     OR jsonb_array_length(document -> 'apiFunctions') <> 2
     OR jsonb_array_length(document -> 'apiTriggers') <> 2

  -- Every present relation must be explicitly classified. Strict checks also
  -- require every reviewed relation to exist. The only relaxed state is the
  -- separately signalled first-deploy phase, which requires zero relations.
  UNION ALL
  SELECT 1
  FROM app_relation
  WHERE policy_name IS NULL

  UNION ALL
  SELECT 1
  FROM object_policy policy CROSS JOIN parameter
  LEFT JOIN app_relation relation
    ON relation.relname = policy.relation_name
   AND relation.relkind = policy.relation_kind
  WHERE NOT parameter.object_policy_allow_empty
    AND relation.oid IS NULL

  UNION ALL
  SELECT 1
  FROM app_relation CROSS JOIN parameter
  WHERE parameter.object_policy_allow_empty

  -- Enum types are exact policy objects, including label ordering and owner.
  -- The first-deploy relaxation permits no ordinary user-created type at all.
  UNION ALL
  SELECT 1
  FROM app_type
  WHERE policy_name IS NULL
     OR policy_owner_profile <> 'api'
     OR policy_runtime_profile <> 'api'
     OR typtype <> 'e'
     OR owner_name <> (
       SELECT api_migration_role FROM parameter
     )
     OR type_labels IS DISTINCT FROM policy_labels

  UNION ALL
  SELECT 1
  FROM enum_policy policy CROSS JOIN parameter
  LEFT JOIN app_type type ON type.typname = policy.type_name
  WHERE NOT parameter.object_policy_allow_empty
    AND type.oid IS NULL

  UNION ALL
  SELECT 1
  FROM app_type CROSS JOIN parameter
  WHERE parameter.object_policy_allow_empty

  -- Ordinary functions are limited to the two reviewed invoker trigger
  -- functions. Signature, result, language, body, and every relevant default
  -- execution flag are catalog-attested rather than inferred from ownership.
  UNION ALL
  SELECT 1
  FROM app_function CROSS JOIN parameter
  WHERE policy_name IS NULL
     OR policy_owner_profile <> 'api'
     OR owner_name <> parameter.api_migration_role
     OR prokind <> policy_kind
     OR prorettype <> 'pg_catalog.trigger'::regtype
     OR result_type <> policy_result_type
     OR language_name <> policy_language_name
     OR prosecdef <> policy_security_definer
     OR proconfig IS NOT NULL
     OR provolatile <> CASE policy_volatility
       WHEN 'volatile' THEN 'v'::"char"
       ELSE '!'::"char"
     END
     OR proparallel <> CASE policy_parallel_safety
       WHEN 'unsafe' THEN 'u'::"char"
       ELSE '!'::"char"
     END
     OR proisstrict <> policy_is_strict
     OR proleakproof <> policy_is_leakproof
     OR proretset <> policy_returns_set
     OR pronargs <> 0
     OR pronargdefaults <> policy_argument_defaults
     OR provariadic <> 0
     OR prosupport <> 0
     OR proallargtypes IS NOT NULL
     OR proargmodes IS NOT NULL
     OR proargnames IS NOT NULL
     OR proargdefaults IS NOT NULL
     OR protrftypes IS NOT NULL
     OR probin IS NOT NULL
     OR prosqlbody IS NOT NULL
     OR procost <> policy_estimated_cost
     OR prorows <> policy_estimated_rows
     OR source_sha256 <> policy_source_sha256

  UNION ALL
  SELECT 1
  FROM function_policy policy CROSS JOIN parameter
  LEFT JOIN app_function routine
    ON routine.proname = policy.function_name
   AND routine.identity_arguments = policy.identity_arguments
  WHERE NOT parameter.object_policy_allow_empty
    AND routine.oid IS NULL

  UNION ALL
  SELECT 1
  FROM app_function CROSS JOIN parameter
  WHERE parameter.object_policy_allow_empty

  -- Only the two enabled, non-internal BEFORE ROW trigger wirings are allowed.
  -- Constraint/internal triggers are intentionally outside this manifest.
  UNION ALL
  SELECT 1
  FROM app_trigger CROSS JOIN parameter
  WHERE policy_name IS NULL
     OR policy_owner_profile <> 'api'
     OR policy_timing <> 'BEFORE'
     OR policy_trigger_level <> 'ROW'
     OR pg_get_userbyid(table_owner) <> parameter.api_migration_role
     OR pg_get_userbyid(function_owner) <> parameter.api_migration_role
     OR function_schema <> parameter.expected_schema
     OR function_name <> policy_function_name
     OR function_identity_arguments <> policy_function_identity_arguments
     OR tgenabled <> policy_enabled
     OR tgisinternal <> policy_is_internal
     OR tgtype <> (
       1 + 2
       + CASE WHEN policy_fires_insert THEN 4 ELSE 0 END
       + CASE WHEN policy_fires_delete THEN 8 ELSE 0 END
       + CASE WHEN policy_fires_update THEN 16 ELSE 0 END
       + CASE WHEN policy_fires_truncate THEN 32 ELSE 0 END
     )
     OR update_columns IS DISTINCT FROM policy_update_columns
     OR tgparentid <> 0
     OR tgconstraint <> 0
     OR tgconstrrelid <> 0
     OR tgconstrindid <> 0
     OR tgdeferrable
     OR tginitdeferred
     OR tgnargs <> 0
     OR tgargs IS NULL
     OR octet_length(tgargs) <> 0
     OR tgqual IS NOT NULL
     OR tgoldtable IS NOT NULL
     OR tgnewtable IS NOT NULL

  UNION ALL
  SELECT 1
  FROM trigger_policy policy CROSS JOIN parameter
  LEFT JOIN app_trigger trigger
    ON trigger.table_name = policy.table_name
   AND trigger.tgname = policy.trigger_name
  WHERE NOT parameter.object_policy_allow_empty
    AND trigger.oid IS NULL

  UNION ALL
  SELECT 1
  FROM app_trigger CROSS JOIN parameter
  WHERE parameter.object_policy_allow_empty

  UNION ALL
  SELECT 1
  FROM pg_roles role CROSS JOIN parameter
  WHERE parameter.profile <> 'administrator'
    AND role.rolname = current_user
    AND (NOT role.rolcanlogin OR role.rolsuper OR role.rolcreatedb
      OR role.rolcreaterole OR role.rolinherit OR role.rolreplication
      OR role.rolbypassrls OR role.rolconfig IS NOT NULL
      OR role.rolconnlimit <> -1 OR role.rolvaliduntil IS NOT NULL)

  UNION ALL
  SELECT 1
  FROM pg_roles role CROSS JOIN parameter
  WHERE parameter.profile = 'administrator'
    AND role.rolname = current_user
    AND (NOT role.rolcanlogin OR NOT role.rolsuper)

  UNION ALL
  SELECT 1
  FROM pg_database database CROSS JOIN parameter
  WHERE parameter.profile = 'administrator'
    AND database.datname = current_database()
    AND database.datdba <> (
      SELECT oid FROM pg_roles WHERE rolname = parameter.expected_role
    )

  UNION ALL
  SELECT 1
  FROM pg_namespace namespace CROSS JOIN parameter
  WHERE parameter.profile = 'administrator'
    AND namespace.nspname = parameter.expected_schema
    AND namespace.nspowner NOT IN (
      SELECT oid FROM pg_roles
      WHERE rolname IN (parameter.expected_role, 'pg_database_owner')
    )

  UNION ALL
  SELECT 1
  FROM pg_roles role CROSS JOIN parameter
  WHERE parameter.profile <> 'administrator' AND role.rolname = current_user
    AND EXISTS (
      SELECT 1 FROM pg_auth_members membership
      WHERE membership.member = role.oid OR membership.roleid = role.oid
    )

  -- The IDP closure authenticates the physical cluster with one narrowly
  -- granted catalog function. Its ACL is closed to the owner and the exact
  -- three reviewed roles; PUBLIC, arbitrary roles, and grant options fail.
  UNION ALL
  SELECT 1 FROM parameter
  WHERE parameter.profile <> 'administrator'
    AND has_function_privilege(
      current_user,
      'pg_catalog.pg_control_system()',
      'EXECUTE'
    ) IS DISTINCT FROM (
      parameter.profile IN ('api-migrator', 'maintenance-read', 'idp-maintenance')
    )

  UNION ALL
  SELECT 1 FROM parameter
  WHERE NOT EXISTS (
      SELECT 1
      FROM pg_proc routine
      JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      WHERE namespace.nspname = 'pg_catalog'
        AND routine.proname = 'pg_control_system'
        AND pg_get_function_identity_arguments(routine.oid) = ''
    )
     OR EXISTS (
      SELECT 1
      FROM pg_proc routine
      JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(routine.proacl, acldefault('f', routine.proowner))
      ) privilege
      WHERE namespace.nspname = 'pg_catalog'
        AND routine.proname = 'pg_control_system'
        AND pg_get_function_identity_arguments(routine.oid) = ''
        AND (
          privilege.privilege_type <> 'EXECUTE'
          OR privilege.grantee NOT IN (
            routine.proowner,
            (SELECT oid FROM pg_roles WHERE rolname = parameter.api_migration_role),
            (SELECT oid FROM pg_roles WHERE rolname = parameter.maintenance_read_role),
            (SELECT oid FROM pg_roles WHERE rolname = parameter.idp_maintenance_role)
          )
          OR (
            privilege.grantee <> routine.proowner
            AND privilege.is_grantable
          )
        )
    )
     OR 3 <> (
      SELECT count(DISTINCT privilege.grantee)
      FROM pg_proc routine
      JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(routine.proacl, acldefault('f', routine.proowner))
      ) privilege
      WHERE namespace.nspname = 'pg_catalog'
        AND routine.proname = 'pg_control_system'
        AND pg_get_function_identity_arguments(routine.oid) = ''
        AND privilege.privilege_type = 'EXECUTE'
        AND NOT privilege.is_grantable
        AND privilege.grantee IN (
          (SELECT oid FROM pg_roles WHERE rolname = parameter.api_migration_role),
          (SELECT oid FROM pg_roles WHERE rolname = parameter.maintenance_read_role),
          (SELECT oid FROM pg_roles WHERE rolname = parameter.idp_maintenance_role)
        )
    )

  -- Application identities may not own another database, appear directly in
  -- its ACL, or receive effective CONNECT/TEMPORARY through PUBLIC. This gate
  -- does not mutate cluster-wide ACLs; operators must close them deliberately.
  UNION ALL
  SELECT 1
  FROM pg_database database
  JOIN configured_app_role role ON role.oid = database.datdba
  WHERE database.datname <> current_database()

  UNION ALL
  SELECT 1
  FROM pg_database database
  CROSS JOIN LATERAL aclexplode(database.datacl) privilege
  JOIN configured_app_role role ON role.oid = privilege.grantee
  WHERE database.datname <> current_database()

  UNION ALL
  SELECT 1
  FROM pg_database database
  CROSS JOIN configured_app_role role
  WHERE database.datname <> current_database()
    AND database.datallowconn
    AND (has_database_privilege(role.oid, database.oid, 'CONNECT')
      OR has_database_privilege(role.oid, database.oid, 'TEMPORARY'))

  -- No application role may own or reach a user-created schema outside the
  -- single reviewed application schema. Effective schema checks also catch
  -- privileges inherited through PUBLIC.
  UNION ALL
  SELECT 1
  FROM other_app_schema namespace
  JOIN configured_app_role role ON role.oid = namespace.nspowner

  UNION ALL
  SELECT 1
  FROM other_app_schema namespace
  CROSS JOIN configured_app_role role
  WHERE has_schema_privilege(role.oid, namespace.oid, 'USAGE')
     OR has_schema_privilege(role.oid, namespace.oid, 'CREATE')

  UNION ALL
  SELECT 1
  FROM pg_class relation
  JOIN other_app_schema namespace ON namespace.oid = relation.relnamespace
  JOIN configured_app_role role ON role.oid = relation.relowner

  UNION ALL
  SELECT 1
  FROM pg_class relation
  JOIN other_app_schema namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL aclexplode(relation.relacl) privilege
  WHERE privilege.grantee = 0
     OR privilege.grantee IN (SELECT oid FROM configured_app_role)

  UNION ALL
  SELECT 1
  FROM pg_attribute attribute
  JOIN pg_class relation ON relation.oid = attribute.attrelid
  JOIN other_app_schema namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN LATERAL aclexplode(attribute.attacl) privilege
  WHERE attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND (privilege.grantee = 0
      OR privilege.grantee IN (SELECT oid FROM configured_app_role))

  UNION ALL
  SELECT 1
  FROM pg_proc routine
  JOIN other_app_schema namespace ON namespace.oid = routine.pronamespace
  JOIN configured_app_role role ON role.oid = routine.proowner

  UNION ALL
  SELECT 1
  FROM pg_proc routine
  JOIN other_app_schema namespace ON namespace.oid = routine.pronamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(routine.proacl, acldefault('f', routine.proowner))
  ) privilege
  WHERE privilege.grantee = 0
     OR privilege.grantee IN (SELECT oid FROM configured_app_role)

  UNION ALL
  SELECT 1
  FROM pg_type type
  JOIN other_app_schema namespace ON namespace.oid = type.typnamespace
  JOIN configured_app_role role ON role.oid = type.typowner

  UNION ALL
  SELECT 1
  FROM pg_type type
  JOIN other_app_schema namespace ON namespace.oid = type.typnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(type.typacl, acldefault('T', type.typowner))
  ) privilege
  WHERE privilege.grantee = 0
     OR privilege.grantee IN (SELECT oid FROM configured_app_role)

  UNION ALL
  SELECT 1 FROM parameter
  WHERE profile <> 'administrator'
    AND (has_database_privilege(current_user, current_database(), 'CREATE')
      OR has_database_privilege(current_user, current_database(), 'TEMPORARY')
      OR NOT has_database_privilege(current_user, current_database(), 'CONNECT'))

  UNION ALL
  SELECT 1
  FROM pg_database database
  CROSS JOIN LATERAL aclexplode(
    COALESCE(database.datacl, acldefault('d', database.datdba))
  ) privilege
  WHERE database.datname = current_database()
    AND privilege.grantee = 0
    AND privilege.privilege_type IN ('CONNECT', 'CREATE', 'TEMPORARY')

  UNION ALL
  SELECT 1
  FROM pg_database database CROSS JOIN parameter
  CROSS JOIN LATERAL aclexplode(
    COALESCE(database.datacl, acldefault('d', database.datdba))
  ) privilege
  WHERE database.datname = current_database()
    AND privilege.grantee <> database.datdba
    AND NOT (
      NOT privilege.is_grantable
      AND privilege.privilege_type = 'CONNECT'
      AND privilege.grantee IN (
        SELECT role.oid FROM pg_roles role
        WHERE role.rolname IN (
          parameter.api_runtime_role,
          parameter.api_migration_role,
          parameter.studio_runtime_role,
          parameter.studio_migration_role,
          parameter.maintenance_read_role,
          parameter.idp_maintenance_role,
          parameter.youtube_maintenance_role
        )
      )
    )

  UNION ALL
  SELECT 1
  FROM pg_namespace namespace CROSS JOIN parameter
  CROSS JOIN LATERAL aclexplode(
    COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
  ) privilege
  WHERE namespace.nspname = parameter.expected_schema
    AND privilege.grantee = 0
    AND privilege.privilege_type IN ('CREATE', 'USAGE')

  UNION ALL
  SELECT 1
  FROM pg_namespace namespace CROSS JOIN parameter
  CROSS JOIN LATERAL aclexplode(
    COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))
  ) privilege
  WHERE namespace.nspname = parameter.expected_schema
    AND privilege.grantee <> namespace.nspowner
    AND NOT (
      (
        NOT privilege.is_grantable
        AND privilege.grantee IN (
          SELECT role.oid FROM pg_roles role
          WHERE role.rolname IN (
            parameter.api_runtime_role,
            parameter.studio_runtime_role,
            parameter.maintenance_read_role,
            parameter.idp_maintenance_role,
            parameter.youtube_maintenance_role
          )
        )
        AND privilege.privilege_type = 'USAGE'
      )
      OR (
        NOT privilege.is_grantable
        AND privilege.grantee IN (
          SELECT role.oid FROM pg_roles role
          WHERE role.rolname IN (
            parameter.api_migration_role,
            parameter.studio_migration_role
          )
        )
        AND privilege.privilege_type IN ('USAGE', 'CREATE')
      )
    )

  UNION ALL
  SELECT 1
  FROM pg_default_acl default_acl
  JOIN migration_role owner_role ON owner_role.oid = default_acl.defaclrole
  CROSS JOIN parameter
  LEFT JOIN pg_namespace namespace ON namespace.oid = default_acl.defaclnamespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(
      default_acl.defaclacl,
      acldefault(
        (CASE
          WHEN default_acl.defaclobjtype = 'S' THEN 's'
          ELSE default_acl.defaclobjtype
        END)::"char",
        default_acl.defaclrole
      )
    )
  ) privilege
  WHERE default_acl.defaclobjtype IN ('r', 'S', 'f', 'T')
    AND (default_acl.defaclnamespace = 0
      OR namespace.nspname = parameter.expected_schema)
    AND privilege.grantee <> owner_role.oid

  UNION ALL
  SELECT 1
  FROM pg_default_acl default_acl
  JOIN migration_role owner_role ON owner_role.oid = default_acl.defaclrole
  CROSS JOIN parameter
  LEFT JOIN pg_namespace namespace ON namespace.oid = default_acl.defaclnamespace
  WHERE NOT (
    default_acl.defaclobjtype IN ('r', 'S', 'f', 'T')
    AND (default_acl.defaclnamespace = 0
      OR namespace.nspname = parameter.expected_schema)
  )

  UNION ALL
  SELECT 1 FROM migration_role owner_role
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_default_acl default_acl
    WHERE default_acl.defaclrole = owner_role.oid
      AND default_acl.defaclobjtype = 'f'
      AND default_acl.defaclnamespace = 0
  )

  UNION ALL
  SELECT 1 FROM migration_role owner_role
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_default_acl default_acl
    WHERE default_acl.defaclrole = owner_role.oid
      AND default_acl.defaclobjtype = 'T'
      AND default_acl.defaclnamespace = 0
  )

  UNION ALL
  SELECT 1 FROM parameter
  WHERE profile IN (
      'api-runtime',
      'studio-runtime',
      'maintenance-read',
      'idp-maintenance',
      'youtube-maintenance'
    )
    AND (has_schema_privilege(current_user, expected_schema, 'CREATE')
      OR NOT has_schema_privilege(current_user, expected_schema, 'USAGE'))

  UNION ALL
  SELECT 1 FROM parameter
  WHERE profile IN ('api-migrator', 'studio-migrator')
    AND (NOT has_schema_privilege(current_user, expected_schema, 'CREATE')
      OR NOT has_schema_privilege(current_user, expected_schema, 'USAGE'))

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE profile IN (
      'api-runtime',
      'studio-runtime',
      'maintenance-read',
      'idp-maintenance',
      'youtube-maintenance'
    ) AND owner_name = current_user
  UNION ALL
  SELECT 1 FROM app_type CROSS JOIN parameter
  WHERE profile IN (
      'api-runtime',
      'studio-runtime',
      'maintenance-read',
      'idp-maintenance',
      'youtube-maintenance'
    ) AND owner_name = current_user
  UNION ALL
  SELECT 1 FROM app_function CROSS JOIN parameter
  WHERE profile IN (
      'api-runtime',
      'studio-runtime',
      'maintenance-read',
      'idp-maintenance',
      'youtube-maintenance'
    ) AND owner_name = current_user

  UNION ALL
  SELECT 1 FROM app_function
  WHERE prokind <> 'f'

  UNION ALL
  SELECT 1 FROM app_type
  WHERE typtype NOT IN ('e', 'd')

  UNION ALL
  SELECT 1 FROM app_relation
  WHERE policy_owner_profile = 'studio'
    AND relkind <> 'r'

  -- No row-level-security policy is reviewed in the current production
  -- contract. Flags and orphaned policy catalog rows both fail closed.
  UNION ALL
  SELECT 1
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN parameter
  WHERE namespace.nspname = parameter.expected_schema
    AND (relation.relrowsecurity OR relation.relforcerowsecurity)

  UNION ALL
  SELECT 1
  FROM pg_policy policy
  JOIN pg_class relation ON relation.oid = policy.polrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  CROSS JOIN parameter
  WHERE namespace.nspname = parameter.expected_schema

  UNION ALL
  SELECT 1
  FROM app_relation relation CROSS JOIN parameter
  CROSS JOIN LATERAL aclexplode(
    COALESCE(
      relation.relacl,
      acldefault(
        (CASE WHEN relation.relkind = 'S' THEN 's' ELSE 'r' END)::"char",
        relation.owner_oid
      )
    )
  ) privilege
  WHERE privilege.grantee <> relation.owner_oid
    AND NOT (
      (
        NOT privilege.is_grantable
        AND relation.relkind IN ('r', 'p')
        AND NOT relation.is_ledger
        AND privilege.grantee = (
          SELECT role.oid FROM pg_roles role
          WHERE role.rolname = CASE
            WHEN relation.is_studio THEN parameter.studio_runtime_role
            ELSE parameter.api_runtime_role
          END
        )
        AND privilege.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      )
      OR (
        NOT privilege.is_grantable
        AND relation.relkind = 'S'
        AND privilege.grantee = (
          SELECT role.oid FROM pg_roles role
          WHERE role.rolname = CASE
            WHEN relation.is_studio THEN parameter.studio_runtime_role
            ELSE parameter.api_runtime_role
          END
        )
        AND privilege.privilege_type = 'USAGE'
      )
    )

  UNION ALL
  SELECT 1
  FROM pg_attribute attribute
  JOIN app_relation relation ON relation.oid = attribute.attrelid
  CROSS JOIN parameter
  CROSS JOIN LATERAL aclexplode(attribute.attacl) privilege
  WHERE attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND privilege.grantee <> relation.owner_oid
    AND NOT (
      NOT privilege.is_grantable
      AND relation.relkind IN ('r', 'p')
      AND (
        (
          privilege.grantee = (
            SELECT role.oid FROM pg_roles role
            WHERE role.rolname = parameter.maintenance_read_role
          )
          AND privilege.privilege_type = 'SELECT'
          AND (
            (
              relation.relname = 'DiscordIdpSchedule'
              AND attribute.attname::text = ANY (ARRAY[
                'id',
                'organizationId',
                'sessionId',
                'matchNumber',
                'roomId',
                'roomPassword',
                'primaryMessage',
                'reminders',
                'updatedAt',
                'createdAt'
              ])
            )
            OR (
              relation.relname = 'YoutubeChannel'
              AND attribute.attname::text = ANY (ARRAY[
                'id',
                'accessTokenEnc',
                'refreshTokenEnc',
                'updatedAt'
              ])
            )
          )
        )
        OR (
          privilege.grantee = (
            SELECT role.oid FROM pg_roles role
            WHERE role.rolname = parameter.idp_maintenance_role
          )
          AND relation.relname = 'DiscordIdpSchedule'
          AND (
            (
              privilege.privilege_type = 'SELECT'
              AND attribute.attname::text = ANY (ARRAY[
                'id',
                'organizationId',
                'sessionId',
                'matchNumber',
                'roomId',
                'roomPassword',
                'primaryMessage',
                'reminders',
                'updatedAt',
                'createdAt'
              ])
            )
            OR (
              privilege.privilege_type = 'UPDATE'
              AND attribute.attname::text = ANY (ARRAY[
                'roomPassword',
                'primaryMessage',
                'reminders',
                'updatedAt'
              ])
            )
          )
        )
        OR (
          privilege.grantee = (
            SELECT role.oid FROM pg_roles role
            WHERE role.rolname = parameter.youtube_maintenance_role
          )
          AND relation.relname = 'YoutubeChannel'
          AND (
            (
              privilege.privilege_type = 'SELECT'
              AND attribute.attname::text = ANY (ARRAY[
                'id',
                'accessTokenEnc',
                'refreshTokenEnc',
                'updatedAt'
              ])
            )
            OR (
              privilege.privilege_type = 'UPDATE'
              AND attribute.attname::text = ANY (ARRAY[
                'accessTokenEnc',
                'refreshTokenEnc',
                'updatedAt'
              ])
            )
          )
        )
      )
    )

  UNION ALL
  SELECT 1
  FROM app_type type CROSS JOIN parameter
  CROSS JOIN LATERAL aclexplode(
    COALESCE(type.typacl, acldefault('T', type.owner_oid))
  ) privilege
  WHERE privilege.grantee <> type.owner_oid
    AND NOT (
      NOT privilege.is_grantable
      AND privilege.privilege_type = 'USAGE'
      AND privilege.grantee = (
        SELECT role.oid FROM pg_roles role
        WHERE role.rolname = parameter.api_runtime_role
      )
    )

  UNION ALL
  SELECT 1
  FROM app_type CROSS JOIN parameter
  WHERE (profile = 'api-runtime' AND NOT has_type_privilege(oid, 'USAGE'))
     OR (profile IN (
       'studio-runtime',
       'maintenance-read',
       'idp-maintenance',
       'youtube-maintenance',
       'studio-migrator'
     ) AND has_type_privilege(oid, 'USAGE'))
     OR (profile = 'api-migrator' AND NOT has_type_privilege(oid, 'USAGE'))

  UNION ALL
  SELECT 1
  FROM app_function routine
  CROSS JOIN LATERAL aclexplode(
    COALESCE(routine.proacl, acldefault('f', routine.owner_oid))
  ) privilege
  WHERE privilege.grantee <> routine.owner_oid

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind IN ('r', 'p') AND is_ledger
    AND profile IN (
      'api-runtime',
      'studio-runtime',
      'maintenance-read',
      'idp-maintenance',
      'youtube-maintenance'
    )
    AND (has_table_privilege(oid, 'SELECT') OR has_table_privilege(oid, 'INSERT')
      OR has_table_privilege(oid, 'UPDATE')
      OR has_table_privilege(oid, 'DELETE') OR has_table_privilege(oid, 'TRUNCATE')
      OR has_table_privilege(oid, 'REFERENCES') OR has_table_privilege(oid, 'TRIGGER')
      OR has_any_column_privilege(oid, 'SELECT')
      OR has_any_column_privilege(oid, 'INSERT')
      OR has_any_column_privilege(oid, 'UPDATE')
      OR has_any_column_privilege(oid, 'REFERENCES'))

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind IN ('r', 'p') AND profile = 'api-runtime'
    AND ((is_studio AND (has_table_privilege(oid, 'SELECT')
      OR has_table_privilege(oid, 'INSERT') OR has_table_privilege(oid, 'UPDATE')
      OR has_table_privilege(oid, 'DELETE') OR has_table_privilege(oid, 'TRUNCATE')
      OR has_table_privilege(oid, 'REFERENCES') OR has_table_privilege(oid, 'TRIGGER')
      OR has_any_column_privilege(oid, 'SELECT')
      OR has_any_column_privilege(oid, 'INSERT')
      OR has_any_column_privilege(oid, 'UPDATE')
      OR has_any_column_privilege(oid, 'REFERENCES')))
      OR (NOT is_studio AND NOT is_ledger AND NOT (
        has_table_privilege(oid, 'SELECT') AND has_table_privilege(oid, 'INSERT')
        AND has_table_privilege(oid, 'UPDATE') AND has_table_privilege(oid, 'DELETE')))
      OR (NOT is_studio AND NOT is_ledger AND (
        has_table_privilege(oid, 'TRUNCATE') OR has_table_privilege(oid, 'REFERENCES')
        OR has_table_privilege(oid, 'TRIGGER'))))

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind IN ('r', 'p') AND profile = 'studio-runtime'
    AND ((NOT is_studio AND (has_table_privilege(oid, 'SELECT')
      OR has_table_privilege(oid, 'INSERT') OR has_table_privilege(oid, 'UPDATE')
      OR has_table_privilege(oid, 'DELETE') OR has_table_privilege(oid, 'TRUNCATE')
      OR has_table_privilege(oid, 'REFERENCES') OR has_table_privilege(oid, 'TRIGGER')
      OR has_any_column_privilege(oid, 'SELECT')
      OR has_any_column_privilege(oid, 'INSERT')
      OR has_any_column_privilege(oid, 'UPDATE')
      OR has_any_column_privilege(oid, 'REFERENCES')))
      OR (is_studio AND NOT is_ledger AND NOT (
        has_table_privilege(oid, 'SELECT') AND has_table_privilege(oid, 'INSERT')
        AND has_table_privilege(oid, 'UPDATE') AND has_table_privilege(oid, 'DELETE')))
      OR (is_studio AND NOT is_ledger AND (
        has_table_privilege(oid, 'TRUNCATE') OR has_table_privilege(oid, 'REFERENCES')
        OR has_table_privilege(oid, 'TRIGGER'))))

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind IN ('r', 'p')
    AND profile IN ('maintenance-read', 'idp-maintenance', 'youtube-maintenance')
    AND (has_table_privilege(oid, 'SELECT')
      OR has_table_privilege(oid, 'INSERT')
      OR has_table_privilege(oid, 'UPDATE')
      OR has_table_privilege(oid, 'DELETE')
      OR has_table_privilege(oid, 'TRUNCATE')
      OR has_table_privilege(oid, 'REFERENCES')
      OR has_table_privilege(oid, 'TRIGGER'))

  UNION ALL
  SELECT 1
  FROM app_relation relation
  CROSS JOIN parameter
  CROSS JOIN LATERAL unnest(
    CASE relation.relname
      WHEN 'DiscordIdpSchedule' THEN ARRAY[
        'id',
        'organizationId',
        'sessionId',
        'matchNumber',
        'roomId',
        'roomPassword',
        'primaryMessage',
        'reminders',
        'updatedAt',
        'createdAt'
      ]
      WHEN 'YoutubeChannel' THEN ARRAY[
        'id',
        'accessTokenEnc',
        'refreshTokenEnc',
        'updatedAt'
      ]
      ELSE ARRAY[]::text[]
    END
  ) required_column(column_name)
  WHERE relation.relkind IN ('r', 'p')
    AND parameter.profile = 'maintenance-read'
    AND NOT has_column_privilege(
      relation.oid,
      required_column.column_name,
      'SELECT'
    )

  UNION ALL
  SELECT 1
  FROM app_relation relation
  CROSS JOIN parameter
  CROSS JOIN LATERAL unnest(ARRAY[
    'id',
    'organizationId',
    'sessionId',
    'matchNumber',
    'roomId',
    'roomPassword',
    'primaryMessage',
    'reminders',
    'updatedAt',
    'createdAt'
  ]) required_column(column_name)
  WHERE relation.relkind IN ('r', 'p')
    AND relation.relname = 'DiscordIdpSchedule'
    AND parameter.profile = 'idp-maintenance'
    AND NOT has_column_privilege(
      relation.oid,
      required_column.column_name,
      'SELECT'
    )

  UNION ALL
  SELECT 1
  FROM app_relation relation
  CROSS JOIN parameter
  CROSS JOIN LATERAL unnest(ARRAY[
    'roomPassword',
    'primaryMessage',
    'reminders',
    'updatedAt'
  ]) required_column(column_name)
  WHERE relation.relkind IN ('r', 'p')
    AND relation.relname = 'DiscordIdpSchedule'
    AND parameter.profile = 'idp-maintenance'
    AND NOT has_column_privilege(
      relation.oid,
      required_column.column_name,
      'UPDATE'
    )

  UNION ALL
  SELECT 1
  FROM app_relation relation
  CROSS JOIN parameter
  CROSS JOIN LATERAL unnest(ARRAY[
    'id',
    'accessTokenEnc',
    'refreshTokenEnc',
    'updatedAt'
  ]) required_column(column_name)
  WHERE relation.relkind IN ('r', 'p')
    AND relation.relname = 'YoutubeChannel'
    AND parameter.profile = 'youtube-maintenance'
    AND NOT has_column_privilege(
      relation.oid,
      required_column.column_name,
      'SELECT'
    )

  UNION ALL
  SELECT 1
  FROM app_relation relation
  CROSS JOIN parameter
  CROSS JOIN LATERAL unnest(ARRAY[
    'accessTokenEnc',
    'refreshTokenEnc',
    'updatedAt'
  ]) required_column(column_name)
  WHERE relation.relkind IN ('r', 'p')
    AND relation.relname = 'YoutubeChannel'
    AND parameter.profile = 'youtube-maintenance'
    AND NOT has_column_privilege(
      relation.oid,
      required_column.column_name,
      'UPDATE'
    )

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind IN ('v', 'm', 'f')
    AND profile IN (
      'api-runtime',
      'studio-runtime',
      'maintenance-read',
      'idp-maintenance',
      'youtube-maintenance'
    )
    AND (has_table_privilege(oid, 'SELECT') OR has_table_privilege(oid, 'INSERT')
      OR has_table_privilege(oid, 'UPDATE') OR has_table_privilege(oid, 'DELETE')
      OR has_table_privilege(oid, 'TRUNCATE') OR has_table_privilege(oid, 'REFERENCES')
      OR has_table_privilege(oid, 'TRIGGER')
      OR has_any_column_privilege(oid, 'SELECT')
      OR has_any_column_privilege(oid, 'INSERT')
      OR has_any_column_privilege(oid, 'UPDATE')
      OR has_any_column_privilege(oid, 'REFERENCES'))

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind = 'S' AND profile = 'api-runtime'
    AND ((is_studio AND (has_sequence_privilege(oid, 'USAGE')
      OR has_sequence_privilege(oid, 'SELECT') OR has_sequence_privilege(oid, 'UPDATE')))
      OR (NOT is_studio AND (NOT has_sequence_privilege(oid, 'USAGE')
        OR has_sequence_privilege(oid, 'SELECT') OR has_sequence_privilege(oid, 'UPDATE'))))

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind = 'S' AND profile = 'studio-runtime'
    AND ((NOT is_studio AND (has_sequence_privilege(oid, 'USAGE')
      OR has_sequence_privilege(oid, 'SELECT') OR has_sequence_privilege(oid, 'UPDATE')))
      OR (is_studio AND (NOT has_sequence_privilege(oid, 'USAGE')
        OR has_sequence_privilege(oid, 'SELECT') OR has_sequence_privilege(oid, 'UPDATE'))))

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind = 'S'
    AND profile IN ('maintenance-read', 'idp-maintenance', 'youtube-maintenance')
    AND (has_sequence_privilege(oid, 'USAGE')
      OR has_sequence_privilege(oid, 'SELECT')
      OR has_sequence_privilege(oid, 'UPDATE'))

  UNION ALL
  SELECT 1 FROM app_function CROSS JOIN parameter
  WHERE profile IN (
      'api-runtime',
      'studio-runtime',
      'maintenance-read',
      'idp-maintenance',
      'youtube-maintenance'
    )
    AND has_function_privilege(oid, 'EXECUTE')

  UNION ALL
  SELECT 1 FROM app_function CROSS JOIN parameter
  WHERE profile = 'api-migrator'
    AND NOT has_function_privilege(oid, 'EXECUTE')

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE profile = 'api-migrator'
    AND ((NOT is_studio AND owner_name <> current_user)
      OR (is_studio AND owner_name = current_user))
  UNION ALL
  SELECT 1 FROM app_type CROSS JOIN parameter
  WHERE profile = 'api-migrator' AND owner_name <> current_user
  UNION ALL
  SELECT 1 FROM app_function CROSS JOIN parameter
  WHERE profile = 'api-migrator' AND owner_name <> current_user

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE profile = 'studio-migrator'
    AND ((is_studio AND owner_name <> current_user)
      OR (NOT is_studio AND owner_name = current_user))
  UNION ALL
  SELECT 1 FROM app_type CROSS JOIN parameter
  WHERE profile = 'studio-migrator' AND owner_name = current_user
  UNION ALL
  SELECT 1 FROM app_function CROSS JOIN parameter
  WHERE profile = 'studio-migrator' AND owner_name = current_user

  UNION ALL
  SELECT 1 FROM app_function CROSS JOIN parameter
  WHERE profile = 'studio-migrator'
    AND has_function_privilege(oid, 'EXECUTE')

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind = 'S'
    AND ((profile = 'api-migrator' AND is_studio)
      OR (profile = 'studio-migrator' AND NOT is_studio))
    AND (has_sequence_privilege(oid, 'USAGE')
      OR has_sequence_privilege(oid, 'SELECT')
      OR has_sequence_privilege(oid, 'UPDATE'))

  UNION ALL
  SELECT 1 FROM app_relation CROSS JOIN parameter
  WHERE relkind IN ('r', 'p', 'v', 'm', 'f')
    AND ((profile = 'api-migrator' AND is_studio)
      OR (profile = 'studio-migrator' AND NOT is_studio))
    AND (has_table_privilege(oid, 'SELECT') OR has_table_privilege(oid, 'INSERT')
      OR has_table_privilege(oid, 'UPDATE') OR has_table_privilege(oid, 'DELETE')
      OR has_table_privilege(oid, 'TRUNCATE')
      OR has_table_privilege(oid, 'REFERENCES')
      OR has_table_privilege(oid, 'TRIGGER')
      OR has_any_column_privilege(oid, 'SELECT')
      OR has_any_column_privilege(oid, 'INSERT')
      OR has_any_column_privilege(oid, 'UPDATE')
      OR has_any_column_privilege(oid, 'REFERENCES'))
)
SELECT count(*) FROM violation;
SQL
  } | docker exec -i "$postgres_container" sh -ceu '
    IFS= read -r profile
    IFS= read -r PGUSER
    IFS= read -r PGPASSWORD
    IFS= read -r PGDATABASE
    IFS= read -r expected_schema
    IFS= read -r PGPORT
    IFS= read -r api_runtime_role
    IFS= read -r api_migration_role
    IFS= read -r studio_runtime_role
    IFS= read -r studio_migration_role
    IFS= read -r maintenance_read_role
    IFS= read -r idp_maintenance_role
    IFS= read -r youtube_maintenance_role
    IFS= read -r object_policy_base64
    IFS= read -r object_policy_allow_empty
    if [ "$profile" = "administrator" ] && [ "$PGUSER" != "${POSTGRES_USER:-}" ]; then
      exit 75
    fi
    export PGUSER PGPASSWORD PGDATABASE PGPORT
    export PGHOST=127.0.0.1 PGCONNECT_TIMEOUT=5
    export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema -c arenzyra.role_profile=$profile -c arenzyra.expected_role=$PGUSER -c arenzyra.expected_database=$PGDATABASE -c arenzyra.expected_schema=$expected_schema -c arenzyra.expected_port=$PGPORT -c arenzyra.api_runtime_role=$api_runtime_role -c arenzyra.api_migration_role=$api_migration_role -c arenzyra.studio_runtime_role=$studio_runtime_role -c arenzyra.studio_migration_role=$studio_migration_role -c arenzyra.maintenance_read_role=$maintenance_read_role -c arenzyra.idp_maintenance_role=$idp_maintenance_role -c arenzyra.youtube_maintenance_role=$youtube_maintenance_role -c arenzyra.object_policy_allow_empty=$object_policy_allow_empty"
    if [ "$profile" = "administrator" ]; then
      hba_violations="$(psql -X -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL OR (type LIKE '"'"'host%'"'"' AND auth_method IS DISTINCT FROM '"'"'scram-sha-256'"'"')" 2>/dev/null)" || exit 75
      [ "$hba_violations" = "0" ] || exit 75
      scram_policy="$(psql -X -v ON_ERROR_STOP=1 -At -c "SELECT CASE WHEN current_setting('"'"'password_encryption'"'"') = '"'"'scram-sha-256'"'"' AND (SELECT count(*) FROM pg_authid WHERE rolname IN (current_user, current_setting('"'"'arenzyra.api_runtime_role'"'"'), current_setting('"'"'arenzyra.api_migration_role'"'"'), current_setting('"'"'arenzyra.studio_runtime_role'"'"'), current_setting('"'"'arenzyra.studio_migration_role'"'"'), current_setting('"'"'arenzyra.maintenance_read_role'"'"'), current_setting('"'"'arenzyra.idp_maintenance_role'"'"'), current_setting('"'"'arenzyra.youtube_maintenance_role'"'"')) AND rolpassword LIKE '"'"'SCRAM-SHA-256$%'"'"') = 8 THEN '"'"'verified'"'"' ELSE '"'"'blocked'"'"' END" 2>/dev/null)" || exit 75
      [ "$scram_policy" = "verified" ] || exit 75
      role_setting_violations="$(psql -X -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM pg_db_role_setting setting JOIN pg_roles role ON role.oid = setting.setrole WHERE role.rolname IN (current_setting('"'"'arenzyra.api_runtime_role'"'"'), current_setting('"'"'arenzyra.api_migration_role'"'"'), current_setting('"'"'arenzyra.studio_runtime_role'"'"'), current_setting('"'"'arenzyra.studio_migration_role'"'"'), current_setting('"'"'arenzyra.maintenance_read_role'"'"'), current_setting('"'"'arenzyra.idp_maintenance_role'"'"'), current_setting('"'"'arenzyra.youtube_maintenance_role'"'"'))" 2>/dev/null)" || exit 75
      [ "$role_setting_violations" = "0" ] || exit 75
      extension_policy="$(psql -X -v ON_ERROR_STOP=1 -At -c "SELECT CASE WHEN count(*) = 2 AND count(*) FILTER (WHERE (extension.extname = '"'"'plpgsql'"'"' AND extension.extversion = '"'"'1.0'"'"' AND namespace.nspname = '"'"'pg_catalog'"'"') OR (extension.extname = '"'"'pgcrypto'"'"' AND extension.extversion = '"'"'1.3'"'"' AND namespace.nspname = current_setting('"'"'arenzyra.expected_schema'"'"'))) = 2 THEN '"'"'verified'"'"' ELSE '"'"'blocked'"'"' END FROM pg_extension extension JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace" 2>/dev/null)" || exit 75
      [ "$extension_policy" = "verified" ] || exit 75
    fi
    result="$(psql -X -v ON_ERROR_STOP=1 \
      -v object_policy_base64="$object_policy_base64" \
      -At -f - 2>/dev/null)" || exit 75
    [ "$result" = "0" ] || exit 75
    printf verified
  ' 2>/dev/null)"; then
    printf 'DATABASE ROLE GATE BLOCKED: credential or policy attestation failed for %s.\n' "$profile" >&2
    return 75
  fi
  if [ "$result" != "verified" ]; then
    printf 'DATABASE ROLE GATE BLOCKED: credential or policy attestation failed for %s.\n' "$profile" >&2
    return 75
  fi
}

# Every credential travels through protected stdin and is suppressed from all
# subprocess output. The administrator check is TCP, never a local socket.
run_credential_attestation administrator "$postgres_admin_role" "$postgres_admin_password"
run_credential_attestation api-runtime "$api_runtime_role" "$api_runtime_password"
run_credential_attestation api-migrator "$api_migration_role" "$api_migration_password"
run_credential_attestation studio-runtime "$studio_runtime_role" "$studio_runtime_password"
run_credential_attestation studio-migrator "$studio_migration_role" "$studio_migration_password"
run_credential_attestation maintenance-read "$maintenance_read_role" "$maintenance_read_password"
run_credential_attestation idp-maintenance "$idp_maintenance_role" "$idp_maintenance_password"
run_credential_attestation youtube-maintenance "$youtube_maintenance_role" "$youtube_maintenance_password"

printf 'DATABASE ROLE GATE PASSED credentials=8 policy_violations=0\n'
