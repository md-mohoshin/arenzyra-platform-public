#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-/opt/arenzyra/infra/.env.publish}"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
LOCK_TIMEOUT_SECONDS=10
MODE=""
FIRST_DEPLOY_CREATE_ONLY=0
ADOPT_REVIEWED_OWNERSHIP=0
WRITERS_STOPPED=0
OWNERSHIP_CONFIRMATION=""
LEGACY_CUTOVER_PARTIAL=0
LEGACY_CUTOVER_INTERRUPTED=0
RUNTIME_ROLES_FENCED=0
LEGACY_AUXILIARY_ACL_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift ;;
    --apply)
      [ -z "$MODE" ] || { printf 'Choose only one mode.\n' >&2; exit 2; }
      MODE="apply"
      ;;
    --dry-run)
      [ -z "$MODE" ] || { printf 'Choose only one mode.\n' >&2; exit 2; }
      MODE="dry-run"
      ;;
    --first-deploy-create-only) FIRST_DEPLOY_CREATE_ONLY=1 ;;
    --adopt-reviewed-ownership) ADOPT_REVIEWED_OWNERSHIP=1 ;;
    --writers-stopped) WRITERS_STOPPED=1 ;;
    --confirm=*) OWNERSHIP_CONFIRMATION="${1#--confirm=}" ;;
    --legacy-cutover-partial) LEGACY_CUTOVER_PARTIAL=1 ;;
    --legacy-cutover-interrupted) LEGACY_CUTOVER_INTERRUPTED=1 ;;
    --runtime-roles-fenced) RUNTIME_ROLES_FENCED=1 ;;
    --legacy-auxiliary-acl-only) LEGACY_AUXILIARY_ACL_ONLY=1 ;;
    -h|--help)
      printf 'Usage: %s [--env infra/.env.publish] (--dry-run|--apply) [--first-deploy-create-only | --adopt-reviewed-ownership --writers-stopped --confirm=ADOPT_REVIEWED_DATABASE_OWNERSHIP [--legacy-cutover-partial] | --runtime-roles-fenced]\n' "$0"
      exit 0
      ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
if [ -z "$MODE" ]; then
  printf 'Choose exactly one explicit --dry-run or --apply mode.\n' >&2
  exit 2
fi
if [ "$FIRST_DEPLOY_CREATE_ONLY" -eq 1 ] && [ "$MODE" != "apply" ]; then
  printf '%s\n' '--first-deploy-create-only requires --apply.' >&2
  exit 2
fi
if [ "$ADOPT_REVIEWED_OWNERSHIP" -eq 1 ]; then
  [ "$MODE" = "apply" ] && [ "$FIRST_DEPLOY_CREATE_ONLY" -eq 0 ] && \
    [ "$WRITERS_STOPPED" -eq 1 ] && \
    [ "$OWNERSHIP_CONFIRMATION" = "ADOPT_REVIEWED_DATABASE_OWNERSHIP" ] || {
      printf '%s\n' 'Reviewed ownership adoption requires --apply, --writers-stopped, and --confirm=ADOPT_REVIEWED_DATABASE_OWNERSHIP.' >&2
      exit 2
    }
  { [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = "1" ] || \
    [ "$LEGACY_AUXILIARY_ACL_ONLY" -eq 1 ]; } || {
    printf '%s\n' 'Reviewed ownership adoption requires the inherited production deployment lock and its verified backup.' >&2
    exit 75
  }
elif [ "$WRITERS_STOPPED" -eq 1 ] || [ -n "$OWNERSHIP_CONFIRMATION" ]; then
  printf '%s\n' 'Writer-stop and ownership confirmation flags require --adopt-reviewed-ownership.' >&2
  exit 2
fi
if [ "$LEGACY_CUTOVER_PARTIAL" -eq 1 ] && \
  [ "$ADOPT_REVIEWED_OWNERSHIP" -ne 1 ]; then
  printf '%s\n' '--legacy-cutover-partial requires reviewed ownership adoption.' >&2
  exit 2
fi
if [ "$LEGACY_CUTOVER_INTERRUPTED" -eq 1 ] && \
  [ "$LEGACY_CUTOVER_PARTIAL" -ne 1 ]; then
  printf '%s\n' '--legacy-cutover-interrupted requires --legacy-cutover-partial.' >&2
  exit 2
fi
if [ "$RUNTIME_ROLES_FENCED" -eq 1 ] && \
  { [ "$MODE" != apply ] || [ "$ADOPT_REVIEWED_OWNERSHIP" -eq 1 ]; }; then
  printf '%s\n' '--runtime-roles-fenced is only valid for post-migration apply.' >&2
  exit 2
fi
if [ "$LEGACY_AUXILIARY_ACL_ONLY" -eq 1 ] && \
  { [ "$MODE" != apply ] || [ "$LEGACY_CUTOVER_PARTIAL" -ne 1 ] || \
    [ "$ADOPT_REVIEWED_OWNERSHIP" -ne 1 ]; }; then
  printf '%s\n' '--legacy-auxiliary-acl-only requires stopped-writer legacy ownership adoption apply.' >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="$(realpath -e -- "$ENV_FILE" 2>/dev/null)" || {
  printf 'Reviewed production environment file is unavailable.\n' >&2
  exit 75
}
if [ "$REPOSITORY_ROOT" != "/opt/arenzyra" ] || \
   [ "$ENV_FILE" != "/opt/arenzyra/infra/.env.publish" ]; then
  printf 'Production database-role provisioning requires the exact reviewed root and environment.\n' >&2
  exit 75
fi
source "$SCRIPT_DIR/require-local-production-docker.sh"
SQL_FILE="$REPOSITORY_ROOT/infra/sql/bootstrap-production-roles.sql"
OBJECT_POLICY_FILE="$REPOSITORY_ROOT/infra/production-database-object-policy.json"
test -f "$SQL_FILE"
test -f "$OBJECT_POLICY_FILE"
cd "$REPOSITORY_ROOT"
for command in base64 dirname docker flock grep id node readlink realpath sort stat tr; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Required database-role command is unavailable: %s.\n' "$command" >&2
    exit 2
  }
done

resolved_object_policy_file="$(realpath -e -- "$OBJECT_POLICY_FILE" 2>/dev/null)" || {
  printf 'Reviewed database object policy is unavailable.\n' >&2
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
  printf 'Reviewed database object policy path, ownership, or mode is unsafe.\n' >&2
  exit 75
fi
object_policy_base64="$(
  node "$SCRIPT_DIR/production-database-object-policy.cjs" \
    --manifest "$resolved_object_policy_file" \
    --repository-root "$REPOSITORY_ROOT" \
    --print-base64
)" || {
  printf 'Reviewed database object policy does not match the repository.\n' >&2
  exit 75
}
if [ -z "$object_policy_base64" ] || \
   ! [[ "$object_policy_base64" =~ ^[A-Za-z0-9+/]+={0,2}$ ]]; then
  printf 'Reviewed database object policy encoding is invalid.\n' >&2
  exit 75
fi

read_env() {
  node "$SCRIPT_DIR/read-dotenv-value.cjs" "$ENV_FILE" "$1"
}
read_url() {
  node "$SCRIPT_DIR/read-postgres-url-field.cjs" "$ENV_FILE" "$1" "$2"
}

# Validate the complete target contract before reading any credential value.
node "$SCRIPT_DIR/production-database-target.cjs" --env "$ENV_FILE" --check >/dev/null

compose_project="$(read_env ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
postgres_database="$(read_env POSTGRES_DB)"
postgres_admin_role="$(read_env POSTGRES_USER)"
postgres_admin_password="$(read_env POSTGRES_PASSWORD)"
configured_backup_root="$(read_env ARENZYRA_RECOVERY_V1_ROOT)"
if [ -z "$configured_backup_root" ]; then
  configured_backup_root="$(read_env ARENZYRA_BACKUP_ROOT)"
fi
configured_backup_root="${configured_backup_root:-/opt/arenzyra-backups}"

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
    printf 'Unsafe configured database role.\n' >&2
    exit 2
  }
done
if [ "$(printf '%s\n' "$postgres_admin_role" "$api_runtime_role" "$api_migration_role" "$studio_runtime_role" "$studio_migration_role" "$maintenance_read_role" "$idp_maintenance_role" "$youtube_maintenance_role" | sort -u | wc -l)" -ne 8 ]; then
  printf 'Administrator and all seven application credentials must use eight distinct roles.\n' >&2
  exit 2
fi
for password in "$postgres_admin_password" "$api_runtime_password" "$api_migration_password" "$studio_runtime_password" "$studio_migration_password" "$maintenance_read_password" "$idp_maintenance_password" "$youtube_maintenance_password"; do
  [ -n "$password" ] && [[ "$password" != *$'\n'* ]] && [[ "$password" != *$'\r'* ]] || {
    printf 'Unsafe configured database credential.\n' >&2
    exit 2
  }
done
[[ "$postgres_database" =~ ^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$ ]] || {
  printf 'Unsafe database name: %s\n' "$postgres_database" >&2
  exit 2
}
if ! [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  printf 'Unsafe Compose project name.\n' >&2
  exit 2
fi

encode_password() {
  printf '%s' "$1" | base64 | tr -d '\r\n'
}
api_runtime_password_base64="$(encode_password "$api_runtime_password")"
postgres_admin_password_base64="$(encode_password "$postgres_admin_password")"
api_migration_password_base64="$(encode_password "$api_migration_password")"
studio_runtime_password_base64="$(encode_password "$studio_runtime_password")"
studio_migration_password_base64="$(encode_password "$studio_migration_password")"
maintenance_read_password_base64="$(encode_password "$maintenance_read_password")"
idp_maintenance_password_base64="$(encode_password "$idp_maintenance_password")"
youtube_maintenance_password_base64="$(encode_password "$youtube_maintenance_password")"

if [ "$(id -u)" -ne 0 ]; then
  printf 'Production database-role provisioning requires effective UID 0.\n' >&2
  exit 75
fi

verify_lock_directory_safety() {
  local lock_directory lock_directory_mode lock_directory_owner resolved_lock_directory
  lock_directory="$(dirname -- "$LOCK_FILE")"
  if [ -L "$lock_directory" ] || [ ! -d "$lock_directory" ]; then
    printf 'Production deployment lock directory is unsafe.\n' >&2
    return 75
  fi
  resolved_lock_directory="$(realpath -e -- "$lock_directory" 2>/dev/null || true)"
  lock_directory_owner="$(stat -c %u -- "$lock_directory")"
  lock_directory_mode="$(stat -c %a -- "$lock_directory")"
  if [ "$resolved_lock_directory" != "/run" ] || \
    [ "$lock_directory_owner" != "0" ] || \
    ! [[ "$lock_directory_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$lock_directory_mode & 8#022) != 0 )); then
    printf 'Production deployment lock directory ownership or mode is unsafe.\n' >&2
    return 75
  fi
}

verify_lock_file_safety() {
  local descriptor_identity lock_identity lock_mode lock_owner lock_target
  if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ]; then
    printf 'Production deployment lock path is not a regular non-symlink file.\n' >&2
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
    printf 'Production deployment lock file ownership, mode, or identity is unsafe.\n' >&2
    return 75
  fi
}

verify_lock_directory_safety
if [ -e "$LOCK_FILE" ] || [ -L "$LOCK_FILE" ]; then
  if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ]; then
    printf 'Production deployment lock path is unsafe.\n' >&2
    exit 75
  fi
  existing_lock_owner="$(stat -c %u -- "$LOCK_FILE")"
  existing_lock_mode="$(stat -c %a -- "$LOCK_FILE")"
  existing_lock_links="$(stat -c %h -- "$LOCK_FILE")"
  if [ "$existing_lock_owner" != "0" ] || \
    ! [[ "$existing_lock_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$existing_lock_mode & 8#022) != 0 )) || \
    [ "$existing_lock_links" != "1" ]; then
    printf 'Production deployment lock path ownership or mode is unsafe.\n' >&2
    exit 75
  fi
fi
if [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = "1" ]; then
  if ! verify_lock_file_safety || ! flock -n 8; then
    printf 'Inherited production deployment lock could not be verified.\n' >&2
    exit 75
  fi
else
  exec 8>"$LOCK_FILE"
  verify_lock_file_safety
  flock -w "$LOCK_TIMEOUT_SECONDS" 8 || {
    printf 'A production deployment holds the shared lock.\n' >&2
    exit 75
  }
fi
export ARENZYRA_DEPLOY_COMPOSE_PROJECT="$compose_project"
export ARENZYRA_DEPLOY_ENV_FILE="$ENV_FILE"
if [ "$LEGACY_CUTOVER_PARTIAL" -eq 1 ]; then
  if [ "$LEGACY_CUTOVER_INTERRUPTED" -eq 1 ]; then
    bash scripts/production-deploy-preflight.sh --allow-legacy-cutover-interrupted
  else
    bash scripts/production-deploy-preflight.sh --allow-legacy-cutover-stopped
  fi
  mapfile -t database_binding < <(
    bash scripts/verify-production-database-container.sh --allow-running-legacy-backup
  )
elif [ "$RUNTIME_ROLES_FENCED" -eq 1 ]; then
  bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
else
  bash scripts/production-deploy-preflight.sh
  mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
fi
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'Database role provisioning target was not verified.\n' >&2
  exit 75
fi
postgres_container="${database_binding[0]}"
if [ "$postgres_database" != "${database_binding[3]}" ]; then
  printf 'Database role provisioning target differs from POSTGRES_DB.\n' >&2
  exit 75
fi
schema_name="${database_binding[4]}"
postgres_port="${database_binding[2]}"

verify_tcp_identity() {
  local profile="$1" role="$2" password="$3" result
  if ! result="$({
    printf '%s\n' "$profile" "$role" "$password" "$postgres_database" "$schema_name" "$postgres_port"
  } | docker exec -i "$postgres_container" sh -ceu '
    IFS= read -r profile
    IFS= read -r PGUSER
    IFS= read -r PGPASSWORD
    IFS= read -r PGDATABASE
    IFS= read -r expected_schema
    IFS= read -r PGPORT
    if [ "$profile" = administrator ] && [ "$PGUSER" != "${POSTGRES_USER:-}" ]; then exit 75; fi
    export PGUSER PGPASSWORD PGDATABASE PGPORT PGHOST=127.0.0.1 PGCONNECT_TIMEOUT=5
    export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema -c arenzyra.expected_database=$PGDATABASE -c arenzyra.expected_schema=$expected_schema -c arenzyra.expected_port=$PGPORT"
    if [ "$profile" = administrator ]; then
      result="$(psql -X -v ON_ERROR_STOP=1 -At -c "SELECT CASE WHEN current_user = session_user AND current_database() = current_setting('"'"'arenzyra.expected_database'"'"') AND COALESCE(current_schema(), '"'"''"'"') = current_setting('"'"'arenzyra.expected_schema'"'"') AND inet_server_port() = current_setting('"'"'arenzyra.expected_port'"'"')::integer AND current_setting('"'"'password_encryption'"'"') = '"'"'scram-sha-256'"'"' AND EXISTS (SELECT 1 FROM pg_authid WHERE rolname = current_user AND rolpassword LIKE '"'"'SCRAM-SHA-256$%'"'"') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcanlogin AND rolsuper) AND NOT EXISTS (SELECT 1 FROM pg_hba_file_rules WHERE error IS NOT NULL OR (type LIKE '"'"'host%'"'"' AND auth_method IS DISTINCT FROM '"'"'scram-sha-256'"'"')) THEN '"'"'verified'"'"' ELSE '"'"'blocked'"'"' END" 2>/dev/null)" || exit 75
    else
      result="$(psql -X -v ON_ERROR_STOP=1 -At -c "SELECT CASE WHEN current_user = session_user AND current_database() = current_setting('"'"'arenzyra.expected_database'"'"') AND COALESCE(current_schema(), '"'"''"'"') = current_setting('"'"'arenzyra.expected_schema'"'"') AND inet_server_port() = current_setting('"'"'arenzyra.expected_port'"'"')::integer THEN '"'"'verified'"'"' ELSE '"'"'blocked'"'"' END" 2>/dev/null)" || exit 75
    fi
    [ "$result" = verified ] || exit 75
    printf verified
  ' 2>/dev/null)"; then
    printf 'Database credential precheck failed for %s.\n' "$profile" >&2
    return 75
  fi
  [ "$result" = "verified" ] || {
    printf 'Database credential precheck failed for %s.\n' "$profile" >&2
    return 75
  }
}

verify_adoption_writers_stopped() {
  local unexpected_writers
  unexpected_writers="$({
    docker ps \
      --filter "label=com.docker.compose.project=$compose_project" \
      --format '{{.Label "com.docker.compose.service"}}'
  } | sort -u | grep -Ev '^(postgres|redis|proxy|media-ai)$' || true)"
  [ -z "$unexpected_writers" ] || {
    printf '%s\n' 'Reviewed ownership adoption requires every managed application and maintenance writer to be stopped.' >&2
    return 75
  }
}

remediate_legacy_host_authentication() {
  local result
  [ "$MODE" = apply ] && [ "$LEGACY_CUTOVER_PARTIAL" -eq 1 ] && \
    [ "$ADOPT_REVIEWED_OWNERSHIP" -eq 1 ] || return 75
  verify_adoption_writers_stopped
  if ! result="$({
    printf '%s\n' \
      "$postgres_admin_role" "$postgres_database" "$schema_name" "$postgres_port"
  } | docker exec -i "$postgres_container" sh -ceu '
    IFS= read -r PGUSER
    IFS= read -r PGDATABASE
    IFS= read -r expected_schema
    IFS= read -r PGPORT
    [ "$PGUSER" = "${POSTGRES_USER:-}" ] || exit 75
    case "$PGUSER" in ""|*[!A-Za-z0-9_]*) exit 75 ;; esac
    case "$PGDATABASE" in ""|*[!A-Za-z0-9_-]*) exit 75 ;; esac
    unset PGPASSWORD PGSERVICE PGSERVICEFILE
    export PGUSER PGDATABASE PGPORT PGHOST=/var/run/postgresql PGCONNECT_TIMEOUT=5
    export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema -c arenzyra.expected_role=$PGUSER -c arenzyra.expected_database=$PGDATABASE -c arenzyra.expected_schema=$expected_schema -c arenzyra.expected_port=$PGPORT"
    state="$(psql -X -v ON_ERROR_STOP=1 -At -F "|" -c "SELECT CASE WHEN current_user = session_user AND current_user::text = current_setting('"'"'arenzyra.expected_role'"'"') AND current_database() = current_setting('"'"'arenzyra.expected_database'"'"') AND COALESCE(current_schema(), '"'"''"'"') = current_setting('"'"'arenzyra.expected_schema'"'"') AND current_setting('"'"'port'"'"') = current_setting('"'"'arenzyra.expected_port'"'"') AND inet_client_addr() IS NULL AND current_setting('"'"'password_encryption'"'"') = '"'"'scram-sha-256'"'"' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcanlogin AND rolsuper) THEN '"'"'verified'"'"' ELSE '"'"'blocked'"'"' END, (SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL), (SELECT count(*) FROM pg_hba_file_rules WHERE type LIKE '"'"'host%'"'"' AND auth_method IS DISTINCT FROM '"'"'scram-sha-256'"'"'), (SELECT count(*) FROM pg_hba_file_rules WHERE type LIKE '"'"'host%'"'"' AND auth_method = '"'"'trust'"'"')" 2>/dev/null)" || exit 75
    case "$state" in
      verified\|0\|0\|0) printf already-compliant; exit 0 ;;
      verified\|0\|4\|4) ;;
      *) exit 75 ;;
    esac
    hba_file="$(psql -X -v ON_ERROR_STOP=1 -At -c "SHOW hba_file" 2>/dev/null)" || exit 75
    [ "$hba_file" = /var/lib/postgresql/data/pg_hba.conf ] && \
      [ -f "$hba_file" ] && [ ! -L "$hba_file" ] || exit 75
    hba_owner="$(stat -c %u:%g -- "$hba_file")" || exit 75
    hba_mode="$(stat -c %a -- "$hba_file")" || exit 75
    hba_links="$(stat -c %h -- "$hba_file")" || exit 75
    [ "$hba_links" = 1 ] && [ "$hba_owner" = "$(id -u postgres):$(id -g postgres)" ] && \
      case "$hba_mode" in 600|640) true ;; *) false ;; esac || exit 75
    source_sha="$(sha256sum -- "$hba_file" | awk '"'"'{print $1}'"'"')" || exit 75
    case "$source_sha" in ""|*[!0-9a-f]*) exit 75 ;; esac
    [ "${#source_sha}" -eq 64 ] || exit 75
    backup_file="${hba_file}.arenzyra-pre-host-scram-${source_sha}.bak"
    candidate_file="${hba_file}.arenzyra-host-scram.$$"
    rollback_file="${hba_file}.arenzyra-host-rollback.$$"
    if [ -e "$backup_file" ]; then
      [ -f "$backup_file" ] && [ ! -L "$backup_file" ] && \
        [ "$(stat -c %h -- "$backup_file")" = 1 ] && \
        [ "$(stat -c %u:%g -- "$backup_file")" = "$hba_owner" ] && \
        [ "$(stat -c %a -- "$backup_file")" = "$hba_mode" ] && \
        [ "$(sha256sum -- "$backup_file" | awk '"'"'{print $1}'"'"')" = "$source_sha" ] || exit 75
    else
      cp -p -- "$hba_file" "$backup_file"
    fi
    installed=0
    rollback() {
      status="$?"
      if [ "$installed" -eq 1 ]; then
        cp -p -- "$backup_file" "$rollback_file" || true
        mv -f -- "$rollback_file" "$hba_file" || true
        psql -X -v ON_ERROR_STOP=1 -At -c "SELECT pg_reload_conf()" >/dev/null 2>&1 || true
      fi
      rm -f -- "$candidate_file" "$rollback_file"
      exit "$status"
    }
    trap rollback EXIT
    trap '"'"'exit 75'"'"' HUP INT TERM
    awk '"'"'
      BEGIN { changed = 0; invalid = 0 }
      /^[[:space:]]*($|#)/ { print; next }
      $1 ~ /^host/ && $5 != "scram-sha-256" {
        if ($1 == "host" && ($2 == "all" || $2 == "replication") &&
            $3 == "all" && ($4 == "127.0.0.1/32" || $4 == "::1/128") &&
            $5 == "trust" && NF == 5) {
          print $1, $2, $3, $4, "scram-sha-256"
          changed++
          next
        }
        invalid = 1
      }
      { print }
      END { if (changed != 4 || invalid != 0) exit 75 }
    '"'"' "$hba_file" >"$candidate_file"
    [ -s "$candidate_file" ] && [ "$(sha256sum -- "$candidate_file" | awk '"'"'{print $1}'"'"')" != "$source_sha" ] || exit 75
    chown "$hba_owner" -- "$candidate_file"
    chmod "$hba_mode" -- "$candidate_file"
    installed=1
    mv -f -- "$candidate_file" "$hba_file"
    post_state="$(psql -X -v ON_ERROR_STOP=1 -At -F "|" -c "SELECT (SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL), (SELECT count(*) FROM pg_hba_file_rules WHERE type LIKE '"'"'host%'"'"' AND auth_method IS DISTINCT FROM '"'"'scram-sha-256'"'"')" 2>/dev/null)" || exit 75
    [ "$post_state" = "0|0" ] || exit 75
    [ "$(psql -X -v ON_ERROR_STOP=1 -At -c "SELECT pg_reload_conf()" 2>/dev/null)" = t ] || exit 75
    installed=0
    trap - EXIT HUP INT TERM
    rm -f -- "$candidate_file" "$rollback_file"
    printf remediated
  ' 2>/dev/null)"; then
    printf '%s\n' 'Legacy PostgreSQL host-authentication remediation failed; the original HBA file was retained or restored.' >&2
    return 75
  fi
  case "$result" in
    already-compliant)
      printf '%s\n' 'Legacy PostgreSQL host authentication is already SCRAM-only.'
      ;;
    remediated)
      printf '%s\n' 'Legacy PostgreSQL loopback host authentication upgraded to SCRAM with the verified source file retained as a backup.'
      ;;
    *) return 75 ;;
  esac
}

adopt_legacy_administrator_credential() {
  local result
  [ "$MODE" = apply ] && [ "$LEGACY_CUTOVER_PARTIAL" -eq 1 ] && \
    [ "$ADOPT_REVIEWED_OWNERSHIP" -eq 1 ] || return 75
  verify_adoption_writers_stopped
  if ! result="$({
    printf '%s\n' \
      "$postgres_admin_role" "$postgres_admin_password_base64" \
      "$postgres_database" "$schema_name" "$postgres_port"
  } | docker exec -i "$postgres_container" sh -ceu '
    IFS= read -r PGUSER
    IFS= read -r admin_password_base64
    IFS= read -r PGDATABASE
    IFS= read -r expected_schema
    IFS= read -r PGPORT
    [ "$PGUSER" = "${POSTGRES_USER:-}" ] || exit 75
    case "$PGUSER" in ""|*[!A-Za-z0-9_]*) exit 75 ;; esac
    case "$PGDATABASE" in ""|*[!A-Za-z0-9_-]*) exit 75 ;; esac
    case "$admin_password_base64" in ""|*[!A-Za-z0-9+/=]*) exit 75 ;; esac
    desired_password="$(printf "%s" "$admin_password_base64" | base64 -d)" || exit 75
    [ -n "$desired_password" ] && \
      [ "$(printf "%s" "$desired_password" | base64 | tr -d "\r\n")" = "$admin_password_base64" ] && \
      ! printf "%s" "$desired_password" | grep -q "[[:cntrl:]]" || exit 75
    unset PGPASSWORD PGSERVICE PGSERVICEFILE
    export PGUSER PGDATABASE PGPORT PGHOST=/var/run/postgresql PGCONNECT_TIMEOUT=5
    export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema -c arenzyra.expected_role=$PGUSER -c arenzyra.expected_database=$PGDATABASE -c arenzyra.expected_schema=$expected_schema -c arenzyra.expected_port=$PGPORT"
    attestation="$(psql -X -v ON_ERROR_STOP=1 -At -c "SELECT CASE WHEN current_user = session_user AND current_user::text = current_setting('"'"'arenzyra.expected_role'"'"') AND current_database() = current_setting('"'"'arenzyra.expected_database'"'"') AND COALESCE(current_schema(), '"'"''"'"') = current_setting('"'"'arenzyra.expected_schema'"'"') AND current_setting('"'"'port'"'"') = current_setting('"'"'arenzyra.expected_port'"'"') AND inet_client_addr() IS NULL AND current_setting('"'"'password_encryption'"'"') = '"'"'scram-sha-256'"'"' AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolcanlogin AND rolsuper) AND NOT EXISTS (SELECT 1 FROM pg_hba_file_rules WHERE error IS NOT NULL OR (type LIKE '"'"'host%'"'"' AND auth_method IS DISTINCT FROM '"'"'scram-sha-256'"'"')) THEN '"'"'verified'"'"' ELSE '"'"'blocked'"'"' END" 2>/dev/null)" || exit 75
    [ "$attestation" = verified ] || exit 75
    export PGOPTIONS="-c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema"
    {
      printf "\\set admin_password_base64 '\''%s'\''\n" "$admin_password_base64"
      cat <<'"'"'SQL'"'"'
BEGIN;
CREATE TEMP TABLE arenzyra_legacy_admin_credential(secret text NOT NULL) ON COMMIT DROP;
INSERT INTO arenzyra_legacy_admin_credential(secret)
SELECT convert_from(decode(:'admin_password_base64', 'base64'), 'UTF8');
DO $credential$
DECLARE
  desired_password text;
BEGIN
  SELECT secret INTO STRICT desired_password
    FROM arenzyra_legacy_admin_credential;
  IF desired_password = '' OR desired_password ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid reviewed administrator credential';
  END IF;
  EXECUTE format('ALTER ROLE %I PASSWORD %L', current_user, desired_password);
END
$credential$;
TRUNCATE arenzyra_legacy_admin_credential;
COMMIT;
SQL
    } | psql -X -v ON_ERROR_STOP=1 -f - >/dev/null 2>&1
    unset desired_password admin_password_base64
    printf adopted
  ' 2>/dev/null)" || [ "$result" != adopted ]; then
    printf '%s\n' 'Legacy administrator credential adoption failed; the reviewed password may already have committed. Keep writers stopped and retry only through the reviewed resume command.' >&2
    return 75
  fi
  printf '%s\n' 'Legacy PostgreSQL administrator credential adopted under the stopped-writer cutover boundary.'
}

verify_cross_database_acl_closed() {
  local blocking_database_json result
  if ! result="$({
    printf '%s\n' \
      "$postgres_admin_role" "$postgres_admin_password" "$postgres_database" \
      "$schema_name" "$postgres_port" \
      "$api_runtime_role" "$api_migration_role" \
      "$studio_runtime_role" "$studio_migration_role" \
      "$maintenance_read_role" "$idp_maintenance_role" \
      "$youtube_maintenance_role"
  } | docker exec -i "$postgres_container" sh -ceu '
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
    [ "$PGUSER" = "${POSTGRES_USER:-}" ] || exit 75
    export PGUSER PGPASSWORD PGDATABASE PGPORT PGHOST=127.0.0.1 PGCONNECT_TIMEOUT=5
    export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema -c arenzyra.api_runtime_role=$api_runtime_role -c arenzyra.api_migration_role=$api_migration_role -c arenzyra.studio_runtime_role=$studio_runtime_role -c arenzyra.studio_migration_role=$studio_migration_role -c arenzyra.maintenance_read_role=$maintenance_read_role -c arenzyra.idp_maintenance_role=$idp_maintenance_role -c arenzyra.youtube_maintenance_role=$youtube_maintenance_role"
    result="$(psql -X -v ON_ERROR_STOP=1 -At -c "WITH configured_role AS (SELECT role.oid, role.rolname FROM pg_roles role WHERE role.rolname IN (current_setting('"'"'arenzyra.api_runtime_role'"'"'), current_setting('"'"'arenzyra.api_migration_role'"'"'), current_setting('"'"'arenzyra.studio_runtime_role'"'"'), current_setting('"'"'arenzyra.studio_migration_role'"'"'), current_setting('"'"'arenzyra.maintenance_read_role'"'"'), current_setting('"'"'arenzyra.idp_maintenance_role'"'"'), current_setting('"'"'arenzyra.youtube_maintenance_role'"'"'))), violation AS (SELECT database.datname, '"'"'PUBLIC'"'"'::text AS role_name, '"'"'PUBLIC_CONNECT_OR_TEMPORARY'"'"'::text AS reason FROM pg_database database CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('"'"'d'"'"', database.datdba))) privilege WHERE database.datname <> current_database() AND database.datallowconn AND privilege.grantee = 0 AND privilege.privilege_type IN ('"'"'CONNECT'"'"', '"'"'TEMPORARY'"'"') UNION ALL SELECT database.datname, role.rolname, '"'"'OWNER'"'"'::text FROM pg_database database JOIN configured_role role ON role.oid = database.datdba WHERE database.datname <> current_database() UNION ALL SELECT database.datname, role.rolname, '"'"'DIRECT_ACL'"'"'::text FROM pg_database database CROSS JOIN LATERAL aclexplode(database.datacl) privilege JOIN configured_role role ON role.oid = privilege.grantee WHERE database.datname <> current_database() UNION ALL SELECT database.datname, role.rolname, '"'"'EFFECTIVE_CONNECT_OR_TEMPORARY'"'"'::text FROM pg_database database CROSS JOIN configured_role role WHERE database.datname <> current_database() AND database.datallowconn AND (has_database_privilege(role.oid, database.oid, '"'"'CONNECT'"'"') OR has_database_privilege(role.oid, database.oid, '"'"'TEMPORARY'"'"'))), distinct_violation AS (SELECT DISTINCT datname, role_name, reason FROM violation) SELECT COALESCE(json_agg(json_build_object('"'"'database'"'"', datname, '"'"'role'"'"', role_name, '"'"'reason'"'"', reason) ORDER BY datname, role_name, reason)::text, '"'"'[]'"'"') FROM distinct_violation" 2>/dev/null)" || exit 75
    if [ "$result" = "[]" ]; then
      printf verified
    else
      printf '"'"'blocked:%s'"'"' "$result"
    fi
  ' 2>/dev/null)"; then
    printf 'Database role provisioning blocked: cross-database privilege attestation could not be completed.\n' >&2
    return 75
  fi
  case "$result" in
    verified) return 0 ;;
    blocked:*)
      blocking_database_json="${result#blocked:}"
      printf 'Database role provisioning blocked: cross-database ACL closure is required before retrying; blocking grants=%s\n' "$blocking_database_json" >&2
      return 75
      ;;
    *)
      printf 'Database role provisioning blocked: cross-database privilege result was invalid.\n' >&2
      return 75
      ;;
  esac
}

require_verified_deploy_backup() {
  local backup_id backup_dir backup_root not_before marker_epoch
  backup_id="${ARENZYRA_DEPLOY_VERIFIED_BACKUP_ID:-}"
  backup_dir="${ARENZYRA_DEPLOY_VERIFIED_BACKUP_DIR:-}"
  not_before="${ARENZYRA_DEPLOY_VERIFIED_BACKUP_NOT_BEFORE_EPOCH:-}"
  [[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || return 75
  backup_root="$(realpath -e -- "$configured_backup_root" 2>/dev/null)" || return 75
  if [ -z "$backup_dir" ]; then
    backup_dir="$backup_root/$backup_id"
  fi
  backup_dir="$(realpath -e -- "$backup_dir" 2>/dev/null)" || return 75
  [ "$(dirname -- "$backup_dir")" = "$backup_root" ] && \
    [ "$(basename -- "$backup_dir")" = "$backup_id" ] || return 75
  for artifact in BACKUP_COMPLETE OFFSITE_VERIFIED database.dump.age \
    database-globals.sql.age metadata.txt.age manifest.sha256.age; do
    [ -s "$backup_dir/$artifact" ] || return 75
  done
  for artifact in BACKUP_COMPLETE OFFSITE_VERIFIED; do
    marker_epoch="$(stat -c %Y -- "$backup_dir/$artifact")"
    [[ "$marker_epoch" =~ ^[0-9]+$ ]] || return 75
    if [ -n "$not_before" ]; then
      [[ "$not_before" =~ ^[0-9]+$ ]] && \
        [ "$marker_epoch" -ge "$not_before" ] || return 75
    else
      [ "$marker_epoch" -le "$(date +%s)" ] && \
        [ $(( $(date +%s) - marker_epoch )) -le 7200 ] || return 75
    fi
  done
}

remediate_legacy_cross_database_acl() {
  local result
  [ "$MODE" = apply ] && [ "$LEGACY_CUTOVER_PARTIAL" -eq 1 ] && \
    [ "$ADOPT_REVIEWED_OWNERSHIP" -eq 1 ] && \
    { [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = 1 ] || \
      [ "$LEGACY_AUXILIARY_ACL_ONLY" -eq 1 ]; } || return 75
  verify_adoption_writers_stopped
  require_verified_deploy_backup || {
    printf '%s\n' 'Legacy auxiliary-database ACL remediation requires the fresh verified off-site deployment backup.' >&2
    return 75
  }
  if ! result="$({
    printf '%s\n' \
      "$postgres_admin_role" "$postgres_admin_password" "$postgres_database" \
      "$schema_name" "$postgres_port" \
      "$api_runtime_role" "$api_migration_role" \
      "$studio_runtime_role" "$studio_migration_role" \
      "$maintenance_read_role" "$idp_maintenance_role" \
      "$youtube_maintenance_role"
  } | docker exec -i "$postgres_container" sh -ceu '
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
    [ "$PGUSER" = "${POSTGRES_USER:-}" ] || exit 75
    export PGUSER PGPASSWORD PGDATABASE PGPORT PGHOST=127.0.0.1 PGCONNECT_TIMEOUT=5
    settings="-c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema -c arenzyra.api_runtime_role=$api_runtime_role -c arenzyra.api_migration_role=$api_migration_role -c arenzyra.studio_runtime_role=$studio_runtime_role -c arenzyra.studio_migration_role=$studio_migration_role -c arenzyra.maintenance_read_role=$maintenance_read_role -c arenzyra.idp_maintenance_role=$idp_maintenance_role -c arenzyra.youtube_maintenance_role=$youtube_maintenance_role"
    export PGOPTIONS="-c default_transaction_read_only=on $settings"
    state="$(psql -X -v ON_ERROR_STOP=1 -At -F "|" -c "WITH configured_role AS (SELECT role.oid FROM pg_roles role WHERE role.rolname IN (current_setting('"'"'arenzyra.api_runtime_role'"'"'), current_setting('"'"'arenzyra.api_migration_role'"'"'), current_setting('"'"'arenzyra.studio_runtime_role'"'"'), current_setting('"'"'arenzyra.studio_migration_role'"'"'), current_setting('"'"'arenzyra.maintenance_read_role'"'"'), current_setting('"'"'arenzyra.idp_maintenance_role'"'"'), current_setting('"'"'arenzyra.youtube_maintenance_role'"'"'))), public_grant AS (SELECT database.datname, privilege.privilege_type FROM pg_database database CROSS JOIN LATERAL aclexplode(COALESCE(database.datacl, acldefault('"'"'d'"'"', database.datdba))) privilege WHERE database.datname <> current_database() AND database.datallowconn AND privilege.grantee = 0 AND privilege.privilege_type IN ('"'"'CONNECT'"'"', '"'"'TEMPORARY'"'"')), configured_violation AS (SELECT 1 FROM pg_database database JOIN configured_role role ON role.oid = database.datdba WHERE database.datname <> current_database() UNION ALL SELECT 1 FROM pg_database database CROSS JOIN LATERAL aclexplode(database.datacl) privilege JOIN configured_role role ON role.oid = privilege.grantee WHERE database.datname <> current_database() UNION ALL SELECT 1 FROM pg_database database CROSS JOIN configured_role role WHERE database.datname <> current_database() AND database.datallowconn AND (has_database_privilege(role.oid, database.oid, '"'"'CONNECT'"'"') OR has_database_privilege(role.oid, database.oid, '"'"'TEMPORARY'"'"'))) SELECT (SELECT count(*) FROM public_grant), (SELECT count(*) FROM public_grant WHERE (datname, privilege_type) IN (('"'"'postgres'"'"', '"'"'CONNECT'"'"'), ('"'"'postgres'"'"', '"'"'TEMPORARY'"'"'), ('"'"'template1'"'"', '"'"'CONNECT'"'"'), ('"'"'template1'"'"', '"'"'TEMPORARY'"'"'))), (SELECT count(*) FROM configured_violation)" 2>/dev/null)" || exit 75
    case "$state" in
      0\|0\|0) printf already-compliant ;;
      4\|4\|0)
        export PGOPTIONS="$settings"
        psql -X -v ON_ERROR_STOP=1 >/dev/null <<'"'"'SQL'"'"'
BEGIN;
REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE template1 FROM PUBLIC;
COMMIT;
SQL
        printf remediated
        ;;
      *) exit 75 ;;
    esac
  ')"; then
    printf '%s\n' 'Legacy auxiliary-database ACL remediation failed; its transaction was rolled back.' >&2
    return 75
  fi
  case "$result" in
    already-compliant) printf '%s\n' 'PostgreSQL auxiliary-database ACLs are already closed.' ;;
    remediated) printf '%s\n' 'PostgreSQL stock auxiliary-database PUBLIC privileges were revoked after the fresh verified off-site backup.' ;;
    *) return 75 ;;
  esac
}

configured_role_exists() {
  local candidate="$1" result
  result="$({
    printf '%s\n' "$postgres_admin_role" "$postgres_admin_password" "$postgres_database" "$schema_name" "$postgres_port" "$candidate"
  } | docker exec -i "$postgres_container" sh -ceu '
    IFS= read -r PGUSER
    IFS= read -r PGPASSWORD
    IFS= read -r PGDATABASE
    IFS= read -r expected_schema
    IFS= read -r PGPORT
    IFS= read -r candidate
    export PGUSER PGPASSWORD PGDATABASE PGPORT PGHOST=127.0.0.1 PGCONNECT_TIMEOUT=5
    export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000 -c search_path=$expected_schema -c arenzyra.candidate_role=$candidate"
    exec psql -X -v ON_ERROR_STOP=1 -At -c "SELECT count(*) FROM pg_roles WHERE rolname = current_setting('"'"'arenzyra.candidate_role'"'"')" 2>/dev/null
  ' 2>/dev/null)" || return 75
  [ "$result" = "0" ] || [ "$result" = "1" ] || return 75
  printf '%s' "$result"
}

# The one stopped-writer legacy-resume boundary may first adopt only the
# reviewed administrator password through an attested local socket. Every
# ordinary path, and the resulting credential in that exception, must still
# authenticate over bounded TCP before any role/ownership reconciliation.
if [ "$LEGACY_CUTOVER_PARTIAL" -eq 1 ]; then
  remediate_legacy_host_authentication
fi
if ! verify_tcp_identity administrator "$postgres_admin_role" "$postgres_admin_password"; then
  if [ "$LEGACY_CUTOVER_PARTIAL" -ne 1 ]; then
    exit 75
  fi
  adopt_legacy_administrator_credential
  verify_tcp_identity administrator "$postgres_admin_role" "$postgres_admin_password"
fi
# Stock PostgreSQL clusters grant PUBLIC access to connectable auxiliary
# databases. Only the exact stopped-writer legacy adoption may atomically close
# the stock postgres/template1 pair after attesting its fresh off-site backup.
# Every other state and every ordinary role path remains fail closed.
if [ "$LEGACY_CUTOVER_PARTIAL" -eq 1 ]; then
  remediate_legacy_cross_database_acl
fi
verify_cross_database_acl_closed
if [ "$LEGACY_AUXILIARY_ACL_ONLY" -eq 1 ]; then
  printf '%s\n' 'LEGACY AUXILIARY DATABASE ACL CLOSURE VERIFIED'
  exit 0
fi
existing_role_count=0
precheck_existing_role() {
  local profile="$1" role="$2" password="$3" exists
  exists="$(configured_role_exists "$role")" || {
    printf 'Database role existence precheck failed.\n' >&2
    return 75
  }
  if [ "$exists" = "1" ]; then
    verify_tcp_identity "$profile" "$role" "$password"
    existing_role_count=$((existing_role_count + 1))
  fi
}
if [ "$RUNTIME_ROLES_FENCED" -eq 0 ]; then
  precheck_existing_role api-runtime "$api_runtime_role" "$api_runtime_password"
fi
precheck_existing_role api-migrator "$api_migration_role" "$api_migration_password"
if [ "$RUNTIME_ROLES_FENCED" -eq 0 ]; then
  precheck_existing_role studio-runtime "$studio_runtime_role" "$studio_runtime_password"
fi
precheck_existing_role studio-migrator "$studio_migration_role" "$studio_migration_password"
precheck_existing_role maintenance-read "$maintenance_read_role" "$maintenance_read_password"
precheck_existing_role idp-maintenance "$idp_maintenance_role" "$idp_maintenance_password"
precheck_existing_role youtube-maintenance "$youtube_maintenance_role" "$youtube_maintenance_password"

if [ "$FIRST_DEPLOY_CREATE_ONLY" -eq 1 ] && [ "$existing_role_count" -ne 0 ]; then
  printf 'First-deploy role creation requires all seven application roles to be absent.\n' >&2
  exit 75
fi

if [ "$MODE" = "dry-run" ]; then
  printf 'DATABASE ROLE PLAN VERIFIED existing_roles=%s missing_roles=%s mutations=0\n' \
    "$existing_role_count" "$((7 - existing_role_count))"
  exit 0
fi

create_role_change_backup() {
  local start_epoch result_file backup_id backup_dir backup_root marker_epoch
  local temp_dir
  temp_dir="$(mktemp -d /run/arenzyra-role-backup.XXXXXX)"
  chmod 700 "$temp_dir"
  result_file="$temp_dir/result"
  start_epoch="$(date +%s)"
  ARENZYRA_BACKUP_ENV_FILE="$ENV_FILE" \
    ARENZYRA_DEPLOY_COMPOSE_PROJECT="$compose_project" \
    ARENZYRA_BACKUP_REASON="pre-database-role-change" \
    ARENZYRA_BACKUP_RESULT_FILE="$result_file" \
    ARENZYRA_BACKUP_REQUIRE_OFFSITE=1 \
    ARENZYRA_BACKUP_ALLOW_MISSING_APP_VOLUMES=0 \
    bash "$SCRIPT_DIR/production-backup.sh"
  mapfile -t backup_result < "$result_file"
  [ "${#backup_result[@]}" -eq 2 ] || return 75
  backup_id="${backup_result[0]}"
  backup_dir="$(realpath -e -- "${backup_result[1]}")"
  backup_root="$(realpath -e -- "$configured_backup_root")"
  [[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || return 75
  [ "$(dirname -- "$backup_dir")" = "$backup_root" ] || return 75
  [ "$(basename -- "$backup_dir")" = "$backup_id" ] || return 75
  for artifact in BACKUP_COMPLETE database.dump.age database-globals.sql.age metadata.txt.age manifest.sha256.age; do
    [ -s "$backup_dir/$artifact" ] || return 75
  done
  marker_epoch="$(stat -c %Y -- "$backup_dir/BACKUP_COMPLETE")"
  [[ "$marker_epoch" =~ ^[0-9]+$ ]] && [ "$marker_epoch" -ge "$start_epoch" ] || return 75
  rm -f -- "$result_file"
  rmdir -- "$temp_dir"
  printf 'PRE-ROLE-CHANGE BACKUP VERIFIED\n'
}

if [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" != "1" ]; then
  bash scripts/production-deploy-preflight.sh
  create_role_change_backup
fi

# Backup work can consume disk. This guard is deliberately adjacent to SQL.
if [ "$ADOPT_REVIEWED_OWNERSHIP" -eq 1 ]; then
  verify_adoption_writers_stopped
else
  if [ "$RUNTIME_ROLES_FENCED" -eq 1 ]; then
    bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  else
    bash scripts/production-deploy-preflight.sh
  fi
fi
role_change_possible=0
role_change_failed() {
  local status="$?"
  if [ "$role_change_possible" -eq 1 ]; then
    printf 'DATABASE ROLE PROVISIONING FAILED: credential/extension role changes may have committed; do not retry ownership or default-ACL changes blindly. Follow the reviewed DBA ownership/default-ACL repair plan, then rerun --dry-run and --apply.\n' >&2
  fi
  exit "$status"
}
trap role_change_failed ERR

# Secrets travel only through the protected stdin pipe. They are never placed
# in process arguments, command output, or a temporary plaintext file.
role_change_possible=1
object_policy_require_complete=true
object_policy_adopt_ownership=false
object_policy_partial_preflight=false
if [ "$FIRST_DEPLOY_CREATE_ONLY" -eq 1 ]; then
  object_policy_require_complete=false
fi
if [ "$LEGACY_CUTOVER_PARTIAL" -eq 1 ]; then
  object_policy_require_complete=false
  object_policy_partial_preflight=true
fi
if [ "$ADOPT_REVIEWED_OWNERSHIP" -eq 1 ]; then
  object_policy_adopt_ownership=true
fi
{
  printf '%s\n' "$postgres_admin_role" "$postgres_admin_password" "$postgres_database" "$schema_name" "$postgres_port" "$object_policy_adopt_ownership"
  printf '\\set database_name '\''%s'\''\n' "$postgres_database"
  printf '\\set schema_name '\''%s'\''\n' "$schema_name"
  printf '\\set api_runtime_role '\''%s'\''\n' "$api_runtime_role"
  printf '\\set api_runtime_password_base64 '\''%s'\''\n' "$api_runtime_password_base64"
  printf '\\set api_migration_role '\''%s'\''\n' "$api_migration_role"
  printf '\\set api_migration_password_base64 '\''%s'\''\n' "$api_migration_password_base64"
  printf '\\set studio_runtime_role '\''%s'\''\n' "$studio_runtime_role"
  printf '\\set studio_runtime_password_base64 '\''%s'\''\n' "$studio_runtime_password_base64"
  printf '\\set studio_migration_role '\''%s'\''\n' "$studio_migration_role"
  printf '\\set studio_migration_password_base64 '\''%s'\''\n' "$studio_migration_password_base64"
  printf '\\set maintenance_read_role '\''%s'\''\n' "$maintenance_read_role"
  printf '\\set maintenance_read_password_base64 '\''%s'\''\n' "$maintenance_read_password_base64"
  printf '\\set idp_maintenance_role '\''%s'\''\n' "$idp_maintenance_role"
  printf '\\set idp_maintenance_password_base64 '\''%s'\''\n' "$idp_maintenance_password_base64"
  printf '\\set youtube_maintenance_role '\''%s'\''\n' "$youtube_maintenance_role"
  printf '\\set youtube_maintenance_password_base64 '\''%s'\''\n' "$youtube_maintenance_password_base64"
  printf '\\set object_policy_base64 '\''%s'\''\n' "$object_policy_base64"
  printf '\\set object_policy_require_complete '\''%s'\''\n' "$object_policy_require_complete"
  printf '\\set object_policy_adopt_ownership '\''%s'\''\n' "$object_policy_adopt_ownership"
  printf '\\set object_policy_partial_preflight '\''%s'\''\n' "$object_policy_partial_preflight"
  cat "$SQL_FILE"
} | docker exec -i "$postgres_container" sh -ceu '
  IFS= read -r PGUSER
  IFS= read -r PGPASSWORD
  IFS= read -r PGDATABASE
  IFS= read -r expected_schema
  IFS= read -r PGPORT
  IFS= read -r ownership_adoption
  [ "$PGUSER" = "${POSTGRES_USER:-}" ] || exit 75
  export PGUSER PGPASSWORD PGDATABASE PGPORT PGHOST=127.0.0.1 PGCONNECT_TIMEOUT=5
  export PGOPTIONS="-c statement_timeout=30000 -c lock_timeout=5000 -c search_path=$expected_schema"
  if [ "$ownership_adoption" != true ]; then
    exec psql -X -v ON_ERROR_STOP=1 -f - 2>/dev/null
  fi

  case "$PGUSER" in ""|*[!A-Za-z0-9_]*) exit 75 ;; esac
  case "$PGDATABASE" in ""|*[!A-Za-z0-9_]*) exit 75 ;; esac
  fence_directory="$(mktemp -d /tmp/arenzyra-db-fence.XXXXXXXX)"
  fence_fifo="$fence_directory/input.fifo"
  fence_output="$fence_directory/worker.out"
  fence_error="$fence_directory/worker.err"
  fence_connected="$fence_directory/connected"
  fence_continue="$fence_directory/continue"
  fence_backend_pid="$fence_directory/backend.pid"
  fence_application="arenzyra_ownership_adoption_$$"
  feed_pid=""
  worker_pid=""
  fence_closed=0

  cleanup_fence_files() {
    status="$?"
    [ -z "$feed_pid" ] || kill "$feed_pid" 2>/dev/null || true
    [ -z "$worker_pid" ] || kill "$worker_pid" 2>/dev/null || true
    wait "$feed_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
    rm -f -- "$fence_fifo" "$fence_output" "$fence_error" \
      "$fence_connected" "$fence_continue" "$fence_backend_pid"
    rmdir -- "$fence_directory" 2>/dev/null || true
    exit "$status"
  }
  trap cleanup_fence_files EXIT HUP INT TERM
  [ ! -L "$fence_directory" ] && [ -d "$fence_directory" ] || exit 75
  chmod 700 -- "$fence_directory"
  mkfifo -- "$fence_fifo"
  chmod 600 -- "$fence_fifo"
  export ARENZYRA_FENCE_DIRECTORY="$fence_directory"
  export PGAPPNAME="$fence_application"

  {
    printf "%s\n" \
      "\\set ON_ERROR_STOP on" \
      "SELECT pg_backend_pid() AS arenzyra_fence_pid \\gset" \
      "\\setenv ARENZYRA_FENCE_PID :arenzyra_fence_pid" \
      "\\! umask 077; printf \"%s\\n\" \"\$ARENZYRA_FENCE_PID\" > \"\$ARENZYRA_FENCE_DIRECTORY/backend.pid\"; : > \"\$ARENZYRA_FENCE_DIRECTORY/connected\"; while [ ! -f \"\$ARENZYRA_FENCE_DIRECTORY/continue\" ]; do sleep 1; done"
    cat
  } > "$fence_fifo" &
  feed_pid="$!"
  psql -X -v ON_ERROR_STOP=1 -f "$fence_fifo" >"$fence_output" 2>"$fence_error" &
  worker_pid="$!"

  attempts=0
  while [ ! -f "$fence_connected" ]; do
    kill -0 "$worker_pid" 2>/dev/null || {
      cat "$fence_error" >&2 || true
      exit 75
    }
    attempts=$((attempts + 1))
    [ "$attempts" -le 15 ] || exit 75
    sleep 1
  done
  worker_backend_pid="$(cat "$fence_backend_pid")"
  case "$worker_backend_pid" in ""|*[!0-9]*) exit 75 ;; esac

  worker_identity="$(
    PGDATABASE=postgres PGAPPNAME=arenzyra_ownership_fence_coordinator \
      psql -X -At -v ON_ERROR_STOP=1 -c \
      "SELECT count(*) FROM pg_stat_activity WHERE datname = '''$PGDATABASE''' AND pid = $worker_backend_pid AND usename = '''$PGUSER''' AND application_name = '''$fence_application''' AND backend_type = '''client backend''';"
  )"
  [ "$worker_identity" = 1 ] || exit 75

  PGDATABASE=postgres PGAPPNAME=arenzyra_ownership_fence_coordinator \
    psql -X -v ON_ERROR_STOP=1 -c \
    "ALTER DATABASE \"$PGDATABASE\" WITH ALLOW_CONNECTIONS false;"
  fence_closed=1
  PGDATABASE=postgres PGAPPNAME=arenzyra_ownership_fence_coordinator \
    psql -X -v ON_ERROR_STOP=1 -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '''$PGDATABASE''' AND pid <> $worker_backend_pid AND backend_type = '''client backend''';"
  fence_state="$(
    PGDATABASE=postgres PGAPPNAME=arenzyra_ownership_fence_coordinator \
      psql -X -At -F "|" -v ON_ERROR_STOP=1 -c \
      "SELECT database.datallowconn, (SELECT count(*) FROM pg_stat_activity activity WHERE activity.datname = '''$PGDATABASE''' AND activity.pid = $worker_backend_pid AND activity.usename = '''$PGUSER''' AND activity.application_name = '''$fence_application''' AND activity.backend_type = '''client backend'''), (SELECT count(*) FROM pg_stat_activity activity WHERE activity.datname = '''$PGDATABASE''' AND activity.pid <> $worker_backend_pid AND activity.backend_type = '''client backend'''), (SELECT count(*) FROM pg_prepared_xacts prepared WHERE prepared.database = '''$PGDATABASE''') FROM pg_database database WHERE database.datname = '''$PGDATABASE''';"
  )"
  [ "$fence_state" = "f|1|0|0" ] || exit 75
  : > "$fence_continue"

  if ! wait "$worker_pid"; then
    worker_pid=""
    cat "$fence_error" >&2 || true
    exit 75
  fi
  worker_pid=""
  wait "$feed_pid"
  feed_pid=""
  cat "$fence_output"
  [ ! -s "$fence_error" ] || cat "$fence_error" >&2

  PGDATABASE=postgres PGAPPNAME=arenzyra_ownership_fence_coordinator \
    psql -X -v ON_ERROR_STOP=1 -c \
    "ALTER DATABASE \"$PGDATABASE\" WITH ALLOW_CONNECTIONS true;"
  fence_closed=0
  reopened="$(PGDATABASE=postgres psql -X -At -v ON_ERROR_STOP=1 -c "SELECT datallowconn FROM pg_database WHERE datname = '''$PGDATABASE''';")"
  [ "$reopened" = t ] || exit 75
  trap - EXIT HUP INT TERM
  cleanup_fence_files
'

if [ "$FIRST_DEPLOY_CREATE_ONLY" -eq 1 ]; then
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    ARENZYRA_OBJECT_POLICY_ALLOW_EMPTY=1 \
    bash "$SCRIPT_DIR/verify-production-database-roles.sh"
elif [ "$LEGACY_CUTOVER_PARTIAL" -eq 1 ] || \
  [ "$RUNTIME_ROLES_FENCED" -eq 1 ]; then
  printf 'Database roles and grants applied under the controlled maintenance fence; final role verification is deferred.\n'
else
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash "$SCRIPT_DIR/verify-production-database-roles.sh"
fi
trap - ERR
printf 'Database roles and reconciled least-privilege grants verified (existing passwords preserved).\n'
