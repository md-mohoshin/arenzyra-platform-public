#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_ROOT="/opt/arenzyra"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
[ "$#" -eq 0 ] && [ "$(id -u)" -eq 0 ] && \
  [ "$(pwd -P)" = "$EXPECTED_ROOT" ] || {
  printf 'LEGACY ADMIN DIAGNOSTIC BLOCKED: exact production invocation is required.\n' >&2
  exit 75
}

source scripts/require-local-production-docker.sh
source scripts/acquire-production-deploy-lock.sh

ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
compose_project="$(
  node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT
)"
[[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || exit 75
export ARENZYRA_DEPLOY_COMPOSE_PROJECT="$compose_project"
export ARENZYRA_DEPLOY_ENV_FILE="$ENV_FILE"

bash scripts/production-deploy-preflight.sh --allow-legacy-cutover-interrupted
mapfile -t database_binding < <(
  bash scripts/verify-production-database-container.sh --allow-running-legacy-backup
)
[ "${#database_binding[@]}" -eq 5 ] || {
  printf 'LEGACY ADMIN DIAGNOSTIC BLOCKED: database target was not verified.\n' >&2
  exit 75
}

postgres_container="${database_binding[0]}"
postgres_port="${database_binding[2]}"
postgres_database="${database_binding[3]}"
schema_name="${database_binding[4]}"
postgres_admin_role="$(
  node scripts/read-dotenv-value.cjs "$ENV_FILE" POSTGRES_USER
)"
postgres_admin_password="$(
  node scripts/read-dotenv-value.cjs "$ENV_FILE" POSTGRES_PASSWORD
)"
[ -n "$postgres_admin_role" ] && [ -n "$postgres_admin_password" ] || {
  printf 'LEGACY ADMIN DIAGNOSTIC BLOCKED: reviewed administrator profile is incomplete.\n' >&2
  exit 75
}

if ! diagnostic="$({
  printf '%s\n' \
    "$postgres_admin_role" "$postgres_admin_password" \
    "$postgres_database" "$schema_name" "$postgres_port"
} | docker exec -i "$postgres_container" sh -ceu '
  IFS= read -r PGUSER
  IFS= read -r reviewed_password
  IFS= read -r PGDATABASE
  IFS= read -r expected_schema
  IFS= read -r PGPORT
  container_env_match=0
  [ "$PGUSER" = "${POSTGRES_USER:-}" ] && container_env_match=1

  tcp_reviewed_password=0
  export PGPASSWORD="$reviewed_password" PGHOST=127.0.0.1 PGCONNECT_TIMEOUT=5
  export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema"
  if psql -X -v ON_ERROR_STOP=1 -At -c "SELECT 1" >/dev/null 2>&1; then
    tcp_reviewed_password=1
  fi

  unset PGPASSWORD PGSERVICE PGSERVICEFILE reviewed_password
  export PGHOST=/var/run/postgresql PGCONNECT_TIMEOUT=5
  export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema -c arenzyra.expected_role=$PGUSER -c arenzyra.expected_database=$PGDATABASE -c arenzyra.expected_schema=$expected_schema -c arenzyra.expected_port=$PGPORT"
  if ! socket_summary="$(psql -X -v ON_ERROR_STOP=1 -At -F "|" -c "SELECT CASE WHEN current_user = session_user AND current_user::text = current_setting('"'"'arenzyra.expected_role'"'"') THEN 1 ELSE 0 END, CASE WHEN current_database() = current_setting('"'"'arenzyra.expected_database'"'"') THEN 1 ELSE 0 END, CASE WHEN COALESCE(current_schema(), '"'"''"'"') = current_setting('"'"'arenzyra.expected_schema'"'"') THEN 1 ELSE 0 END, CASE WHEN current_setting('"'"'port'"'"') = current_setting('"'"'arenzyra.expected_port'"'"') THEN 1 ELSE 0 END, CASE WHEN inet_client_addr() IS NULL THEN 1 ELSE 0 END, CASE WHEN current_setting('"'"'password_encryption'"'"') = '"'"'scram-sha-256'"'"' THEN 1 ELSE 0 END, CASE WHEN EXISTS (SELECT 1 FROM pg_authid WHERE rolname = current_user AND rolpassword LIKE '"'"'SCRAM-SHA-256$%'"'"') THEN 1 ELSE 0 END, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcanlogin AND rolsuper) THEN 1 ELSE 0 END, (SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL), (SELECT count(*) FROM pg_hba_file_rules WHERE type LIKE '"'"'host%'"'"' AND auth_method IS DISTINCT FROM '"'"'scram-sha-256'"'"')" 2>/dev/null)"; then
    printf "container_env_match=%s tcp_reviewed_password=%s socket_connection=0\n" \
      "$container_env_match" "$tcp_reviewed_password"
    exit 0
  fi
  IFS="|" read -r role_match database_match schema_match port_match \
    unix_socket scram_setting scram_hash super_login hba_errors hba_non_scram \
    <<<"$socket_summary"
  for value in "$role_match" "$database_match" "$schema_match" "$port_match" \
    "$unix_socket" "$scram_setting" "$scram_hash" "$super_login" \
    "$hba_errors" "$hba_non_scram"; do
    case "$value" in ""|*[!0-9]*) exit 75 ;; esac
  done
  printf "container_env_match=%s tcp_reviewed_password=%s socket_connection=1 role_match=%s database_match=%s schema_match=%s port_match=%s unix_socket=%s scram_setting=%s scram_hash=%s super_login=%s hba_errors=%s hba_non_scram=%s\n" \
    "$container_env_match" "$tcp_reviewed_password" "$role_match" \
    "$database_match" "$schema_match" "$port_match" "$unix_socket" \
    "$scram_setting" "$scram_hash" "$super_login" "$hba_errors" \
    "$hba_non_scram"
' 2>/dev/null)"; then
  printf 'LEGACY ADMIN DIAGNOSTIC BLOCKED: bounded diagnostic failed.\n' >&2
  exit 75
fi

case "$diagnostic" in
  container_env_match=[01]\ tcp_reviewed_password=[01]\ socket_connection=0 | \
  container_env_match=[01]\ tcp_reviewed_password=[01]\ socket_connection=1\ role_match=[01]\ database_match=[01]\ schema_match=[01]\ port_match=[01]\ unix_socket=[01]\ scram_setting=[01]\ scram_hash=[01]\ super_login=[01]\ hba_errors=[0-9]*\ hba_non_scram=[0-9]*) ;;
  *) printf 'LEGACY ADMIN DIAGNOSTIC BLOCKED: result was invalid.\n' >&2; exit 75 ;;
esac
printf 'LEGACY ADMIN DIAGNOSTIC %s\n' "$diagnostic"
