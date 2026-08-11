#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_ROOT="/opt/arenzyra"
ARCHIVE_ROOT="/opt/arenzyra-release-metadata"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
EXPECTED_MIGRATION="20260308132829_widget_instance_permanent_keys"
EXPECTED_CHECKSUM="c573af92b312df565eaf1d490dfafa3d6cc8a20220c87f39d659a62826628163"
RELEASE_ID=""

block() {
  printf 'LEGACY PRISMA LEDGER RECONCILIATION BLOCKED: %s\n' "$1" >&2
  exit 75
}

if [ "${1:-}" = "--release-id" ] && [ "$#" -eq 2 ]; then
  RELEASE_ID="$2"
else
  block "exact release identity is required."
fi

[[ "$RELEASE_ID" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] && \
  [ "$(id -u)" -eq 0 ] && [ "$(pwd -P)" = "$EXPECTED_ROOT" ] || \
  block "exact production invocation is required."
source scripts/require-local-production-docker.sh
if [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" != "1" ] || \
  [ ! -e /proc/$$/fd/8 ] || [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ] || \
  ! flock -n 8; then
  block "the inherited deployment lock is not verified."
fi
for command in awk docker flock grep node sha256sum sort stat; do
  command -v "$command" >/dev/null 2>&1 || block "required command is unavailable."
done

migration_sql="apps/api/prisma/migrations/$EXPECTED_MIGRATION/migration.sql"
[ -f "$migration_sql" ] && [ ! -L "$migration_sql" ] || \
  block "the exact migration source is unavailable."
actual_checksum="$(sha256sum -- "$migration_sql" | awk '{print $1}')"
[ "$actual_checksum" = "$EXPECTED_CHECKSUM" ] || \
  block "the exact migration source checksum differs."

ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
reviewed_project="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
postgres_admin_role="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" POSTGRES_USER)"
postgres_admin_password="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" POSTGRES_PASSWORD)"
postgres_database="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" POSTGRES_DB)"
api_runtime_role="$(node scripts/read-postgres-url-field.cjs "$ENV_FILE" DATABASE_URL username)"
studio_runtime_role="$(node scripts/read-postgres-url-field.cjs "$ENV_FILE" STUDIO_DATABASE_URL username)"
[[ "$reviewed_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || \
  block "the reviewed Compose project is invalid."
for value in "$postgres_admin_role" "$postgres_database" "$api_runtime_role" \
  "$studio_runtime_role"; do
  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || \
    block "a reviewed database identity is invalid."
done
[ "$api_runtime_role" != "$studio_runtime_role" ] || \
  block "runtime roles are not distinct."

unexpected_running="$(
  docker ps --filter "label=com.docker.compose.project=$reviewed_project" \
    --format '{{.Label "com.docker.compose.service"}}' \
    | sort -u | grep -Ev '^(postgres|redis)$' || true
)"
[ -z "$unexpected_running" ] || \
  block "an application or maintenance writer is still running."

mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
[ "${#database_binding[@]}" -eq 5 ] && \
  [ "${database_binding[3]}" = "$postgres_database" ] || \
  block "the reviewed PostgreSQL target is not exact."
postgres_container="${database_binding[0]}"
postgres_schema="${database_binding[4]}"
[ "$postgres_schema" = "public" ] || \
  block "the reviewed PostgreSQL schema is not exact."

physical_identity="$(
  docker exec "$postgres_container" sh -ceu '
    database="$1"
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000"
    exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At -F "|" -c \
      "SELECT database_record.datname, database_record.oid, control_record.system_identifier
         FROM pg_database database_record CROSS JOIN pg_control_system() control_record
        WHERE database_record.datname = current_database();"
  ' sh "$postgres_database"
)" || block "physical database identity could not be read."
IFS='|' read -r physical_database physical_oid physical_system_identifier \
  <<<"$physical_identity"
[ "$physical_database" = "$postgres_database" ] && \
  [[ "$physical_oid" =~ ^[1-9][0-9]{0,9}$ ]] && \
  [[ "$physical_system_identifier" =~ ^[0-9]{10,24}$ ]] || \
  block "physical database identity is invalid."

marker="$ARCHIVE_ROOT/$RELEASE_ID.writer-fence"
[ ! -L "$marker" ] && [ -f "$marker" ] && \
  [ "$(stat -c '%u:%g:%a:%h' "$marker")" = "0:0:600:1" ] || \
  block "the durable writer-fence marker is unsafe or missing."
mapfile -t marker_lines < "$marker"
[ "${#marker_lines[@]}" -eq 8 ] || block "the writer-fence marker schema differs."
expected_marker_lines=(
  'schema=arenzyra-writer-fence-v1'
  "release=$RELEASE_ID"
  "database=$physical_database"
  "database_oid=$physical_oid"
  "system_identifier=$physical_system_identifier"
  "api_runtime_role=$api_runtime_role"
  "studio_runtime_role=$studio_runtime_role"
  'state=engaged'
)
for expected_line in "${expected_marker_lines[@]}"; do
  marker_match_count=0
  for actual_line in "${marker_lines[@]}"; do
    [ "$actual_line" = "$expected_line" ] && \
      marker_match_count=$((marker_match_count + 1))
  done
  [ "$marker_match_count" -eq 1 ] || block "the writer-fence marker does not match the target."
done

# This is the literal operation-adjacent preflight. The SQL transaction below
# repeats every schema, ledger, and fence predicate while holding the ledger
# table lock, and updates only the one exact historical bookkeeping field.
bash scripts/production-deploy-preflight.sh --allow-cutover-transition

{
  printf '%s\n' "$postgres_admin_role" "$postgres_admin_password" \
    "$postgres_database" "$postgres_schema" "$api_runtime_role" \
    "$studio_runtime_role" "$EXPECTED_MIGRATION" "$EXPECTED_CHECKSUM"
  cat <<'SQL'
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
LOCK TABLE "_prisma_migrations" IN SHARE ROW EXCLUSIVE MODE;

SELECT CASE
  WHEN count(*) = 2
   AND bool_and(NOT rolcanlogin)
  THEN true ELSE false
END AS fence_roles_present
FROM pg_roles
WHERE rolname IN (:'api_runtime_role', :'studio_runtime_role') \gset
SELECT CASE
  WHEN (SELECT count(*) FROM pg_stat_activity
        WHERE usename IN (:'api_runtime_role', :'studio_runtime_role')
          AND backend_type = 'client backend') = 0
   AND (SELECT count(*) FROM pg_prepared_xacts) = 0
  THEN true ELSE false
END AS fence_sessions_clear \gset
\if :fence_roles_present
\else
  SELECT 1 / 0;
\endif
\if :fence_sessions_clear
\else
  SELECT 1 / 0;
\endif

WITH target_table AS (
  SELECT relation.oid
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = :'expected_schema'
    AND relation.relname = 'WidgetInstance'
    AND relation.relkind IN ('r', 'p')
), columns AS (
  SELECT attribute.attname,
         format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
         attribute.attnotnull,
         attribute.atthasdef
  FROM target_table
  JOIN pg_attribute attribute ON attribute.attrelid = target_table.oid
  WHERE attribute.attnum > 0 AND NOT attribute.attisdropped
), indexes AS (
  SELECT index_relation.relname AS index_name,
         index_record.indisunique,
         index_record.indisvalid,
         index_record.indisready,
         index_record.indnkeyatts,
         index_record.indnatts,
         index_record.indpred IS NULL AS no_predicate,
         index_record.indexprs IS NULL AS no_expression,
         access_method.amname,
         pg_get_indexdef(index_record.indexrelid, 1, true) AS key_1,
         CASE WHEN index_record.indnkeyatts >= 2
              THEN pg_get_indexdef(index_record.indexrelid, 2, true)
              ELSE NULL END AS key_2
  FROM target_table
  JOIN pg_index index_record ON index_record.indrelid = target_table.oid
  JOIN pg_class index_relation ON index_relation.oid = index_record.indexrelid
  JOIN pg_am access_method ON access_method.oid = index_relation.relam
)
SELECT CASE
  WHEN (SELECT count(*) FROM target_table) = 1
   AND (SELECT count(*) FROM columns
        WHERE attname = 'widgetKey' AND data_type = 'text'
          AND attnotnull AND NOT atthasdef) = 1
   AND (SELECT count(*) FROM columns WHERE attname = 'widgetType') = 0
   AND (SELECT count(*) FROM columns
        WHERE attname = 'updatedAt'
          AND data_type = 'timestamp(3) without time zone'
          AND attnotnull AND NOT atthasdef) = 1
   AND (SELECT count(*) FROM indexes
        WHERE index_name = 'WidgetInstance_widgetKey_idx'
          AND NOT indisunique AND indisvalid AND indisready
          AND indnkeyatts = 1 AND indnatts = 1
          AND no_predicate AND no_expression AND amname = 'btree'
          AND key_1 = '"widgetKey"') = 1
   AND (SELECT count(*) FROM indexes
        WHERE index_name = 'WidgetInstance_organizationId_widgetKey_key'
          AND indisunique AND indisvalid AND indisready
          AND indnkeyatts = 2 AND indnatts = 2
          AND no_predicate AND no_expression AND amname = 'btree'
          AND key_1 = '"organizationId"' AND key_2 = '"widgetKey"') = 1
   AND (SELECT count(*) FROM indexes
        WHERE index_name = 'WidgetInstance_widgetType_idx') = 0
  THEN true ELSE false
END AS schema_ready \gset
\if :schema_ready
\else
  SELECT 1 / 0;
\endif

SELECT CASE
  WHEN count(*) = 1
   AND bool_and(checksum = :'expected_checksum')
   AND bool_and(finished_at IS NOT NULL)
   AND bool_and(rolled_back_at IS NULL)
   AND bool_and(applied_steps_count IN (0, 1))
   AND (SELECT count(*) FROM "_prisma_migrations"
        WHERE ((finished_at IS NULL AND rolled_back_at IS NULL)
           OR (finished_at IS NOT NULL AND rolled_back_at IS NULL
               AND applied_steps_count = 0))
          AND migration_name <> :'expected_migration') = 0
  THEN true ELSE false
END AS ledger_ready
FROM "_prisma_migrations"
WHERE migration_name = :'expected_migration' \gset
\if :ledger_ready
\else
  SELECT 1 / 0;
\endif

WITH updated AS (
  UPDATE "_prisma_migrations"
     SET applied_steps_count = 1
   WHERE migration_name = :'expected_migration'
     AND checksum = :'expected_checksum'
     AND finished_at IS NOT NULL
     AND rolled_back_at IS NULL
     AND applied_steps_count = 0
  RETURNING 1
)
SELECT count(*) <= 1 AS ledger_updated FROM updated \gset
\if :ledger_updated
\else
  SELECT 1 / 0;
\endif

SELECT CASE
  WHEN count(*) = 1
   AND bool_and(checksum = :'expected_checksum')
   AND bool_and(finished_at IS NOT NULL)
   AND bool_and(rolled_back_at IS NULL)
   AND bool_and(applied_steps_count = 1)
   AND (SELECT count(*) FROM "_prisma_migrations"
        WHERE (finished_at IS NULL AND rolled_back_at IS NULL)
           OR (finished_at IS NOT NULL AND rolled_back_at IS NULL
               AND applied_steps_count = 0)) = 0
   AND (SELECT count(*) FROM pg_stat_activity
        WHERE usename IN (:'api_runtime_role', :'studio_runtime_role')
          AND backend_type = 'client backend') = 0
   AND (SELECT count(*) FROM pg_prepared_xacts) = 0
  THEN true ELSE false
END AS postcondition
FROM "_prisma_migrations"
WHERE migration_name = :'expected_migration' \gset
\if :postcondition
\else
  SELECT 1 / 0;
\endif
COMMIT;
SQL
} | docker exec -i "$postgres_container" sh -ceu '
  IFS= read -r PGUSER
  IFS= read -r PGPASSWORD
  IFS= read -r PGDATABASE
  IFS= read -r expected_schema
  IFS= read -r api_runtime_role
  IFS= read -r studio_runtime_role
  IFS= read -r expected_migration
  IFS= read -r expected_checksum
  [ "$PGUSER" = "${POSTGRES_USER:-}" ] || exit 75
  export PGUSER PGPASSWORD PGDATABASE PGHOST=127.0.0.1 PGCONNECT_TIMEOUT=5
  export PGAPPNAME=arenzyra-production-legacy-ledger-reconcile
  export PGOPTIONS="-c statement_timeout=30000 -c lock_timeout=5000 -c search_path=$expected_schema"
  exec psql -X -q -v ON_ERROR_STOP=1 \
    -v expected_schema="$expected_schema" \
    -v api_runtime_role="$api_runtime_role" \
    -v studio_runtime_role="$studio_runtime_role" \
    -v expected_migration="$expected_migration" \
    -v expected_checksum="$expected_checksum"
'

printf 'LEGACY PRISMA LEDGER RECONCILED migration=%s applied_steps=1\n' \
  "$EXPECTED_MIGRATION"
