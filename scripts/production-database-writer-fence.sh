#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_ROOT="/opt/arenzyra"
ARCHIVE_ROOT="/opt/arenzyra-release-metadata"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
MODE=""
RELEASE_ID=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --engage|--engage-or-verify|--release)
      [ -z "$MODE" ] || exit 2
      MODE="${1#--}"
      ;;
    --release-id)
      shift
      RELEASE_ID="${1:-}"
      ;;
    *) exit 2 ;;
  esac
  shift
done

block() {
  printf 'DATABASE WRITER FENCE BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ -n "$MODE" ] && \
  [[ "$RELEASE_ID" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] && \
  [ "$(id -u)" -eq 0 ] && [ "$(pwd -P)" = "$EXPECTED_ROOT" ] || \
  block "exact production invocation is required."
source scripts/require-local-production-docker.sh
if [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" != "1" ] || \
  [ ! -e /proc/$$/fd/8 ] || [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ] || \
  ! flock -n 8; then
  block "the inherited deployment lock is not verified."
fi

ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
reviewed_project="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
postgres_admin_role="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" POSTGRES_USER)"
postgres_admin_password="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" POSTGRES_PASSWORD)"
postgres_database="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" POSTGRES_DB)"
api_runtime_role="$(node scripts/read-postgres-url-field.cjs "$ENV_FILE" DATABASE_URL username)"
studio_runtime_role="$(node scripts/read-postgres-url-field.cjs "$ENV_FILE" STUDIO_DATABASE_URL username)"
for value in "$postgres_admin_role" "$postgres_database" "$api_runtime_role" "$studio_runtime_role"; do
  [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]] || block "a database identity is invalid."
done
[ "$api_runtime_role" != "$studio_runtime_role" ] || block "runtime roles are not distinct."

unexpected_running="$(
  docker ps --filter "label=com.docker.compose.project=$reviewed_project" \
    --format '{{.Label "com.docker.compose.service"}}' \
    | sort -u | grep -Ev '^(postgres|redis)$' || true
)"
[ -z "$unexpected_running" ] || block "an application or maintenance writer is still running."

mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
[ "${#database_binding[@]}" -eq 5 ] && \
  [ "${database_binding[3]}" = "$postgres_database" ] || \
  block "the reviewed PostgreSQL 16.14 target is not exact."
postgres_container="${database_binding[0]}"

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
released_marker="$ARCHIVE_ROOT/$RELEASE_ID.writer-fence.released"
[ -d "$ARCHIVE_ROOT" ] && [ ! -L "$ARCHIVE_ROOT" ] && \
  [ "$(stat -c '%u:%g:%a' "$ARCHIVE_ROOT")" = "0:0:700" ] || \
  block "release archive boundary is unsafe."

run_role_transition() {
  local transition="$1"
  {
    printf '%s\n' "$postgres_admin_role" "$postgres_admin_password" \
      "$postgres_database" "$api_runtime_role" "$studio_runtime_role" "$transition"
  } | docker exec -i "$postgres_container" sh -ceu '
    IFS= read -r PGUSER
    IFS= read -r PGPASSWORD
    IFS= read -r PGDATABASE
    IFS= read -r api_runtime_role
    IFS= read -r studio_runtime_role
    IFS= read -r transition
    [ "$PGUSER" = "${POSTGRES_USER:-}" ] || exit 75
    export PGUSER PGPASSWORD PGDATABASE PGHOST=127.0.0.1 PGCONNECT_TIMEOUT=5
    export PGAPPNAME=arenzyra-production-writer-fence
    export PGOPTIONS="-c statement_timeout=30000 -c lock_timeout=5000"
    if [ "$transition" = engage ]; then
      expected_login=f
      action=NOLOGIN
    elif [ "$transition" = release ]; then
      expected_login=t
      action=LOGIN
    else
      exit 75
    fi
    psql -X -v ON_ERROR_STOP=1 \
      -v api_runtime_role="$api_runtime_role" \
      -v studio_runtime_role="$studio_runtime_role" \
      -v expected_login="$expected_login" \
      -v role_action="$action" <<'"'"'SQL'"'"'
BEGIN;
SELECT CASE
  WHEN count(*) = 2 THEN true
  ELSE false
END AS runtime_roles_present
FROM pg_roles
WHERE rolname IN (:'"'"'api_runtime_role'"'"', :'"'"'studio_runtime_role'"'"')
\gset
\if :runtime_roles_present
\else
  \echo DATABASE_WRITER_FENCE_SQL_BLOCKED predicate=runtime_roles_present
  SELECT 1 / 0;
\endif
ALTER ROLE :"api_runtime_role" NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS :role_action;
ALTER ROLE :"studio_runtime_role" NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS :role_action;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename IN (:'"'"'api_runtime_role'"'"', :'"'"'studio_runtime_role'"'"')
  AND pid <> pg_backend_pid()
  AND backend_type = '"'"'client backend'"'"';
SELECT CASE
  WHEN count(*) = 2
   AND count(*) FILTER (
         WHERE rolcanlogin::text <> :'"'"'expected_login'"'"'
            OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
            OR rolreplication OR rolbypassrls
       ) = 0
   AND (SELECT count(*) FROM pg_stat_activity
        WHERE usename IN (:'"'"'api_runtime_role'"'"', :'"'"'studio_runtime_role'"'"')
          AND backend_type = '"'"'client backend'"'"') = 0
   AND (SELECT count(*) FROM pg_prepared_xacts) = 0
  THEN true ELSE false
END AS fence_verified
FROM pg_roles
WHERE rolname IN (:'"'"'api_runtime_role'"'"', :'"'"'studio_runtime_role'"'"') \gset
\if :fence_verified
\else
  \echo DATABASE_WRITER_FENCE_SQL_BLOCKED predicate=fence_verified
  SELECT 1 / 0;
\endif
COMMIT;
SQL
  '
}

write_marker_state() {
  local state="$1" temporary_marker
  [ "$state" = engaging ] || [ "$state" = engaged ] || exit 75
  temporary_marker="$(mktemp -- "$ARCHIVE_ROOT/.$RELEASE_ID.writer-fence.XXXXXX")"
  printf '%s\n' \
    'schema=arenzyra-writer-fence-v1' \
    "release=$RELEASE_ID" \
    "database=$physical_database" \
    "database_oid=$physical_oid" \
    "system_identifier=$physical_system_identifier" \
    "api_runtime_role=$api_runtime_role" \
    "studio_runtime_role=$studio_runtime_role" \
    "state=$state" >"$temporary_marker"
  chmod 600 "$temporary_marker"
  chown root:root "$temporary_marker"
  mv -T "$temporary_marker" "$marker"
}

verify_engaged_marker() {
  [ ! -L "$marker" ] && [ -f "$marker" ] && \
    [ "$(stat -c '%u:%g:%a:%h' "$marker")" = "0:0:600:1" ] && \
    [ ! -e "$released_marker" ] && [ ! -L "$released_marker" ] || \
    block "the engaged fence marker is unavailable or unsafe."
  mapfile -t marker_lines <"$marker"
  [ "${#marker_lines[@]}" -eq 8 ] && \
    [ "${marker_lines[0]}" = schema=arenzyra-writer-fence-v1 ] && \
    [ "${marker_lines[1]}" = "release=$RELEASE_ID" ] && \
    [ "${marker_lines[2]}" = "database=$physical_database" ] && \
    [ "${marker_lines[3]}" = "database_oid=$physical_oid" ] && \
    [ "${marker_lines[4]}" = "system_identifier=$physical_system_identifier" ] && \
    [ "${marker_lines[5]}" = "api_runtime_role=$api_runtime_role" ] && \
    [ "${marker_lines[6]}" = "studio_runtime_role=$studio_runtime_role" ] && \
    { [ "${marker_lines[7]}" = state=engaged ] || \
      [ "${marker_lines[7]}" = state=engaging ]; } || \
    block "the fence marker does not match this database and release."
}

if [ "$MODE" = engage ] || { [ "$MODE" = engage-or-verify ] && \
  [ ! -e "$marker" ] && [ ! -L "$marker" ]; }; then
  [ ! -e "$marker" ] && [ ! -L "$marker" ] && \
    [ ! -e "$released_marker" ] && [ ! -L "$released_marker" ] || \
    block "a fence marker already exists for this release."
  # Persist the physical target before the role transaction. If the process is
  # interrupted at any later point, the marker remains sufficient for the
  # reviewed release path to restore LOGIN only after clean postconditions.
  write_marker_state engaging
  run_role_transition engage || block "runtime roles could not be fenced."
  write_marker_state engaged
  printf 'DATABASE WRITER FENCE ENGAGED release=%s runtime_roles=2\n' "$RELEASE_ID"
elif [ "$MODE" = engage-or-verify ]; then
  verify_engaged_marker
  run_role_transition engage || block "runtime role fence could not be reverified."
  write_marker_state engaged
  printf 'DATABASE WRITER FENCE REVERIFIED release=%s runtime_roles=2\n' "$RELEASE_ID"
else
  verify_engaged_marker
  bash scripts/verify-production-idp-encryption.sh
  bash scripts/verify-production-entitlement-invariants.sh
  run_role_transition release || block "runtime role login could not be restored."
  mv -T "$marker" "$released_marker"
  printf 'DATABASE WRITER FENCE RELEASED release=%s runtime_roles=2\n' "$RELEASE_ID"
fi
