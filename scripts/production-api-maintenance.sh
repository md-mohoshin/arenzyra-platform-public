#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PRODUCTION_ROOT="${ARENZYRA_PRODUCTION_ROOT:-/opt/arenzyra}"
EXPECTED_ROOT="/opt/arenzyra"
RELEASE_ARCHIVE_ROOT="/opt/arenzyra-release-metadata"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
LOCK_TIMEOUT_SECONDS="${ARENZYRA_DEPLOY_LOCK_TIMEOUT_SECONDS:-10}"
LOCAL_DOCKER_HOST="unix:///var/run/docker.sock"
SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
PATH="$SAFE_PATH"
runtime_temp_dir=""
runtime_config_dir=""
pinned_compose_digest=""

cleanup_runtime_files() {
  case "${runtime_temp_dir:-}" in
    /run/arenzyra-api-maintenance-backup.*)
      rm -f -- "$runtime_temp_dir/result"
      rmdir -- "$runtime_temp_dir" 2>/dev/null || true
      ;;
  esac
  case "${runtime_config_dir:-}" in
    /run/arenzyra-api-maintenance-config.*)
      rm -f -- \
        "$runtime_config_dir/resolved-compose.json" \
        "$runtime_config_dir/pinned-compose.json" \
        "$runtime_config_dir/pinned-compose.json.tmp"
      rmdir -- "$runtime_config_dir" 2>/dev/null || true
      ;;
  esac
}
trap cleanup_runtime_files EXIT

usage() {
  cat <<'EOF'
Usage:
  bash scripts/production-api-maintenance.sh idp-credentials dry-run
  bash scripts/production-api-maintenance.sh idp-credentials apply \
    --writers-stopped --confirm=BACKFILL_IDP_CREDENTIALS
  bash scripts/production-api-maintenance.sh youtube-tokens dry-run [scan options]
  bash scripts/production-api-maintenance.sh youtube-tokens scan [scan options]
  bash scripts/production-api-maintenance.sh youtube-tokens apply \
    --confirm=ROTATE_YOUTUBE_TOKEN_ENCRYPTION [scan options]

Scan options:
  --batch-size=1..500
  --max-rows=1..10000
  --start-after=<opaque safe cursor>

The command is production-only. It holds the shared deployment lock, binds the
one-off immutable API image to infra/.env.publish and its reviewed Compose
project/database target, and never places database credentials on argv or in
output. IDP apply also proves that no labelled API writer is running on the
host and no session for the reviewed API database role is active at the check
boundary.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

for command in \
  basename bash cat chmod cmp date dirname docker env flock getent id mktemp mv node \
  readlink realpath rm rmdir sha256sum stat; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Required production maintenance command is unavailable: %s.\n' "$command" >&2
    exit 2
  }
done

resolved_root="$(realpath -e -- "$PRODUCTION_ROOT" 2>/dev/null || true)"
if [ -z "$resolved_root" ]; then
  printf 'Production root does not exist.\n' >&2
  exit 2
fi
if [ "$resolved_root" != "$EXPECTED_ROOT" ]; then
  printf 'Refusing a nonstandard production root.\n' >&2
  exit 2
fi
cd "$resolved_root"

if [ "$(id -u)" -ne 0 ]; then
  printf 'Production API maintenance requires effective UID 0.\n' >&2
  exit 75
fi
if ! [[ "$LOCK_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [ "$LOCK_TIMEOUT_SECONDS" -gt 300 ]; then
  printf 'ARENZYRA_DEPLOY_LOCK_TIMEOUT_SECONDS must be 0-300.\n' >&2
  exit 2
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
    printf 'Another production deployment or maintenance command holds the shared lock.\n' >&2
    exit 75
  }
fi

ENV_FILE="$resolved_root/infra/.env.publish"
RELEASE_FILE="$resolved_root/infra/.env.release"
COMPOSE_FILE="$resolved_root/infra/docker-compose.publish.yml"
reviewed_relative_files=(
  infra/.env.publish
  infra/.env.release
  infra/docker-compose.publish.yml
  infra/production-api-migration-safety.json
  scripts/production-api-maintenance.sh
  scripts/production-api-maintenance-binding.cjs
  scripts/production-api-maintenance-plan.cjs
  scripts/production-backup.sh
  scripts/production-database-target.cjs
  scripts/production-deploy-preflight.sh
  scripts/preflight-publish.cjs
  scripts/read-dotenv-value.cjs
  scripts/read-postgres-url-field.cjs
  scripts/require-local-production-docker.sh
  scripts/validate-publish-release-env.cjs
  scripts/validate-release-image-manifest.cjs
  scripts/verify-production-database-container.sh
  scripts/verify-production-database-roles.sh
  scripts/verify-idp-credential-storage.cjs
  scripts/verify-production-idp-encryption.sh
  scripts/verify-production-migration-safety.cjs
)
reviewed_files=()
reviewed_archive_files=()

verify_reviewed_file_safety() {
  local expected_file file_mode file_owner relative_file resolved_file
  reviewed_files=()
  for relative_file in "${reviewed_relative_files[@]}"; do
    expected_file="$resolved_root/$relative_file"
    if [ -L "$expected_file" ] || [ ! -f "$expected_file" ]; then
      printf 'Required production maintenance file is missing or is a symlink.\n' >&2
      return 75
    fi
    resolved_file="$(realpath -e -- "$expected_file" 2>/dev/null || true)"
    if [ "$resolved_file" != "$expected_file" ]; then
      printf 'Required production maintenance file escaped the reviewed root.\n' >&2
      return 75
    fi
    file_owner="$(stat -c %u -- "$expected_file")"
    file_mode="$(stat -c %a -- "$expected_file")"
    if [ "$file_owner" != "0" ] || ! [[ "$file_mode" =~ ^[0-7]{3,4}$ ]] || \
      (( (8#$file_mode & 8#022) != 0 )); then
      printf 'Required production maintenance file ownership or mode is unsafe.\n' >&2
      return 75
    fi
    reviewed_files+=("$expected_file")
  done
  if [ "${#reviewed_archive_files[@]}" -gt 0 ]; then
    if [ -L "$RELEASE_ARCHIVE_ROOT" ] || [ ! -d "$RELEASE_ARCHIVE_ROOT" ] || \
      [ "$(realpath -e -- "$RELEASE_ARCHIVE_ROOT" 2>/dev/null || true)" != "$RELEASE_ARCHIVE_ROOT" ] || \
      [ "$(stat -c '%u:%g:%a' -- "$RELEASE_ARCHIVE_ROOT" 2>/dev/null || true)" != "0:0:700" ]; then
      printf 'Production release archive root is unsafe.\n' >&2
      return 75
    fi
    for expected_file in "${reviewed_archive_files[@]}"; do
      if [ -L "$expected_file" ] || [ ! -f "$expected_file" ] || \
        [ "$(dirname -- "$(realpath -e -- "$expected_file" 2>/dev/null || true)")" != "$RELEASE_ARCHIVE_ROOT" ] || \
        [ "$(stat -c '%u:%g:%a:%h' -- "$expected_file" 2>/dev/null || true)" != "0:0:600:1" ]; then
        printf 'Archived release input identity, owner, mode, or link count is unsafe.\n' >&2
        return 75
      fi
      reviewed_files+=("$expected_file")
    done
  fi
}

verify_reviewed_file_safety
reviewed_file_digest="$(sha256sum -- "${reviewed_files[@]}")"

verify_reviewed_files_unchanged() {
  local current_input_digest
  verify_reviewed_file_safety
  current_input_digest="$(sha256sum -- "${reviewed_files[@]}")"
  if [ "$current_input_digest" != "$reviewed_file_digest" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: reviewed inputs or helpers changed while the lock was held.\n' >&2
    return 75
  fi
}

# Use the same daemon boundary as deploy, backup, and verification entrypoints.
# This occurs before this wrapper invokes any Docker/Compose command.
# shellcheck source=scripts/require-local-production-docker.sh
if ! . scripts/require-local-production-docker.sh; then
  exit 75
fi
if [ "$DOCKER_HOST" != "$LOCAL_DOCKER_HOST" ] || [ -n "${DOCKER_CONTEXT:-}" ]; then
  printf 'Production Docker target normalization failed.\n' >&2
  exit 75
fi
if [ ! -S /var/run/docker.sock ]; then
  printf 'The local production Docker socket is unavailable.\n' >&2
  exit 75
fi
account_record="$(getent passwd "$(id -u)" 2>/dev/null || true)"
IFS=: read -r _ _ _ _ _ account_home _ <<<"$account_record"
safe_home="$(realpath -e -- "${account_home:-/root}" 2>/dev/null || true)"
if [ -z "$safe_home" ] || [ ! -d "$safe_home" ] || [[ "$safe_home" == *$'\n'* ]] || [[ "$safe_home" == *$'\r'* ]]; then
  printf 'A safe local HOME is required for production maintenance.\n' >&2
  exit 2
fi
sanitized_environment=(
  env -i
  "PATH=$SAFE_PATH"
  "HOME=$safe_home"
  "DOCKER_HOST=$LOCAL_DOCKER_HOST"
)

if [ -n "${ARENZYRA_DEPLOY_ENV_FILE:-}" ]; then
  process_env_file="$(realpath -e -- "$ARENZYRA_DEPLOY_ENV_FILE" 2>/dev/null || true)"
  if [ "$process_env_file" != "$ENV_FILE" ]; then
    printf 'Process environment file differs from reviewed infra/.env.publish.\n' >&2
    exit 2
  fi
fi

"${sanitized_environment[@]}" \
  node scripts/validate-publish-release-env.cjs \
    --file "$RELEASE_FILE" >/dev/null
release_id="$(
  "${sanitized_environment[@]}" \
    node scripts/read-dotenv-value.cjs "$RELEASE_FILE" ARENZYRA_RELEASE_ID
)"
if ! [[ "$release_id" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: reviewed release ID is invalid.\n' >&2
  exit 75
fi
# The first digest proves that the helpers and source release file used to
# discover the immutable archive inputs did not change during discovery.
verify_reviewed_files_unchanged
archived_release_file="$RELEASE_ARCHIVE_ROOT/$release_id.env"
archived_api_image_manifest="$RELEASE_ARCHIVE_ROOT/$release_id.api-image.json"
reviewed_archive_files=(
  "$archived_release_file"
  "$archived_api_image_manifest"
)
verify_reviewed_file_safety
reviewed_file_digest="$(sha256sum -- "${reviewed_files[@]}")"
if ! cmp -s -- "$RELEASE_FILE" "$archived_release_file"; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: reviewed release metadata differs from its immutable archive.\n' >&2
  exit 75
fi
expected_archived_image_id="$(
  "${sanitized_environment[@]}" \
    node scripts/validate-release-image-manifest.cjs \
      --file "$archived_api_image_manifest" \
      --release-env "$archived_release_file" \
      --expected-release "$release_id" \
      --service api \
      --print-image-id
)"
if ! [[ "$expected_archived_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: archived API image identity is invalid.\n' >&2
  exit 75
fi
verify_reviewed_files_unchanged

if ! maintenance_plan_output="$(
  "${sanitized_environment[@]}" \
    node scripts/production-api-maintenance-plan.cjs "$@"
)"; then
  usage >&2
  exit 2
fi
mapfile -t maintenance_plan <<<"$maintenance_plan_output"
if [ "${#maintenance_plan[@]}" -lt 4 ]; then
  printf 'Production maintenance plan is invalid.\n' >&2
  exit 2
fi
task="${maintenance_plan[0]}"
action="${maintenance_plan[1]}"
require_stopped_api="${maintenance_plan[2]}"
runner="${maintenance_plan[3]}"
runner_arguments=("${maintenance_plan[@]:4}")
case "$task:$action" in
  idp-credentials:dry-run) maintenance_service="api-maintenance-idp-read" ;;
  idp-credentials:apply) maintenance_service="api-maintenance-idp-apply" ;;
  youtube-tokens:dry-run|youtube-tokens:scan) maintenance_service="api-maintenance-youtube-read" ;;
  youtube-tokens:apply) maintenance_service="api-maintenance-youtube-apply" ;;
  *) printf 'Production maintenance task is invalid.\n' >&2; exit 2 ;;
esac
reviewed_compose_project="$(
  "${sanitized_environment[@]}" \
    node scripts/read-dotenv-value.cjs \
      "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT
)"
compose_project="${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-$reviewed_compose_project}"
if [ "$compose_project" != "$reviewed_compose_project" ]; then
  printf 'Process Compose project differs from the reviewed production environment.\n' >&2
  exit 2
fi
if ! [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  printf 'Invalid production Compose project.\n' >&2
  exit 2
fi

export ARENZYRA_DEPLOY_COMPOSE_PROJECT="$compose_project"
export ARENZYRA_DEPLOY_ENV_FILE="$ENV_FILE"
"${sanitized_environment[@]}" \
  node scripts/production-database-target.cjs --env "$ENV_FILE" --check
image_reference="arenzyra-api:$release_id"

compose=(
  "${sanitized_environment[@]}"
  docker compose
  -p "$compose_project"
  --env-file "$ENV_FILE"
  --env-file "$RELEASE_FILE"
  -f "$COMPOSE_FILE"
)
runtime_config_dir="$(mktemp -d /run/arenzyra-api-maintenance-config.XXXXXX)"
chmod 700 "$runtime_config_dir"
resolved_compose_file="$runtime_config_dir/resolved-compose.json"
"${compose[@]}" --profile migration --profile maintenance config --format json \
  > "$resolved_compose_file"
chmod 600 "$resolved_compose_file"
reviewed_compose_digest="$(sha256sum -- "$resolved_compose_file")"
"${sanitized_environment[@]}" node scripts/production-database-target.cjs \
  --env "$ENV_FILE" --assert-compose-json < "$resolved_compose_file"
"${sanitized_environment[@]}" node scripts/production-api-maintenance-binding.cjs \
    --publish-env "$ENV_FILE" \
    --release-env "$RELEASE_FILE" \
    --task "$task" \
    --action "$action" < "$resolved_compose_file"

preflight_arguments=()
if [ "$require_stopped_api" = "1" ]; then
  preflight_arguments+=(--allow-stopped-api-maintenance)
fi

run_production_preflight() {
  "${sanitized_environment[@]}" \
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$compose_project" \
    "ARENZYRA_DEPLOY_ENV_FILE=$ENV_FILE" \
    bash scripts/production-deploy-preflight.sh "${preflight_arguments[@]}"
}

verify_local_api_image() {
  local image_inspection image_id
  if ! image_inspection="$(
    "${sanitized_environment[@]}" docker image inspect "$image_reference"
  )"; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: reviewed local API image is unavailable.\n' >&2
    return 75
  fi
  if ! image_id="$(printf '%s' "$image_inspection" |
    "${sanitized_environment[@]}" node scripts/production-api-maintenance-binding.cjs \
      --release-env "$RELEASE_FILE" \
      --image-reference "$image_reference" \
      --assert-image-json --print-image-id)"; then
    return 75
  fi
  if ! [[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: immutable API image ID is invalid.\n' >&2
    return 75
  fi
  if [ "$image_id" != "$expected_archived_image_id" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: local API image differs from the immutable release archive.\n' >&2
    return 75
  fi
  verified_image_id="$image_id"
}

database_binding_output=""
database_binding=()
verify_physical_database_binding() {
  local current_binding_output
  local -a current_binding
  if ! current_binding_output="$(
    "${sanitized_environment[@]}" \
      "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$compose_project" \
      "ARENZYRA_DEPLOY_ENV_FILE=$ENV_FILE" \
      bash scripts/verify-production-database-container.sh
  )"; then
    printf 'Production database target attestation failed.\n' >&2
    return 75
  fi
  mapfile -t current_binding <<<"$current_binding_output"
  if [ "${#current_binding[@]}" -ne 5 ]; then
    printf 'Production database target attestation was incomplete.\n' >&2
    return 75
  fi
  if [ "${#database_binding[@]}" -ne 0 ] && \
    [ "$current_binding_output" != "$database_binding_output" ]; then
    printf 'Production database target changed while the maintenance lock was held.\n' >&2
    return 75
  fi
  database_binding_output="$current_binding_output"
  database_binding=("${current_binding[@]}")
}

verify_idp_writer_boundary() {
  local active_api_sessions api_runtime_role database_name
  local postgres_container_id running_api_writers
  if ! running_api_writers="$(
    "${sanitized_environment[@]}" docker ps \
      --filter 'label=com.docker.compose.service=api' \
      --filter status=running \
      --format '{{.ID}}'
  )"; then
    printf 'IDP BACKFILL BLOCKED: host-wide API writer verification failed.\n' >&2
    return 75
  fi
  if [ -n "$running_api_writers" ]; then
    printf 'IDP BACKFILL BLOCKED: a labelled API writer is still running on the host.\n' >&2
    return 75
  fi

  api_runtime_role="$(
    "${sanitized_environment[@]}" node scripts/read-postgres-url-field.cjs \
      "$ENV_FILE" DATABASE_URL username
  )"
  if ! [[ "$api_runtime_role" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
    printf 'IDP BACKFILL BLOCKED: the reviewed API database role is invalid.\n' >&2
    return 75
  fi
  postgres_container_id="${database_binding[0]}"
  database_name="${database_binding[3]}"
  if ! active_api_sessions="$(
    "${sanitized_environment[@]}" \
      docker exec "$postgres_container_id" sh -ceu '
      expected_database="$1"
      expected_role="$2"
      export PGCONNECT_TIMEOUT=10
      export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000"
      exec psql -X -v ON_ERROR_STOP=1 \
        -v "api_role=$expected_role" \
        -U "$POSTGRES_USER" -d "$expected_database" -At -c \
        "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE usename = :'\''api_role'\'' AND pid <> pg_backend_pid();"
    ' sh "$database_name" "$api_runtime_role"
  )"; then
    printf 'IDP BACKFILL BLOCKED: API database-session verification failed.\n' >&2
    return 75
  fi
  if ! [[ "$active_api_sessions" =~ ^[0-9]+$ ]] || [ "$active_api_sessions" -ne 0 ]; then
    printf 'IDP BACKFILL BLOCKED: an API-role database session is still active.\n' >&2
    return 75
  fi
}

verify_runtime_database_roles() {
  "${sanitized_environment[@]}" \
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$compose_project" \
    "ARENZYRA_DEPLOY_ENV_FILE=$ENV_FILE" \
    "ARENZYRA_DEPLOY_LOCK_INHERITED=1" \
    bash scripts/verify-production-database-roles.sh
}

verify_idp_encryption_postcondition() {
  "${sanitized_environment[@]}" \
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$compose_project" \
    "ARENZYRA_DEPLOY_ENV_FILE=$ENV_FILE" \
    "ARENZYRA_DEPLOY_LOCK_INHERITED=1" \
    bash scripts/verify-production-idp-encryption.sh
}

verify_reviewed_inputs_unchanged() {
  local current_compose_digest current_input_digest current_pinned_compose_digest
  verify_reviewed_file_safety
  current_input_digest="$(sha256sum -- "${reviewed_files[@]}")"
  if [ "$current_input_digest" != "$reviewed_file_digest" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: reviewed inputs or helpers changed while the lock was held.\n' >&2
    return 75
  fi
  current_compose_digest="$(sha256sum -- "$resolved_compose_file")"
  if [ "$current_compose_digest" != "$reviewed_compose_digest" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: resolved Compose snapshot changed.\n' >&2
    return 75
  fi
  if [ -n "$pinned_compose_digest" ]; then
    if [ ! -f "/proc/$$/fd/7" ]; then
      printf 'PRODUCTION API MAINTENANCE BLOCKED: pinned Compose descriptor is unavailable.\n' >&2
      return 75
    fi
    current_pinned_compose_digest="$(sha256sum -- "/proc/$$/fd/7")"
    current_pinned_compose_digest="${current_pinned_compose_digest%% *}"
    if [ "$current_pinned_compose_digest" != "$pinned_compose_digest" ]; then
      printf 'PRODUCTION API MAINTENANCE BLOCKED: pinned Compose payload changed.\n' >&2
      return 75
    fi
  fi
}

pin_verified_maintenance_image() {
  local pinned_compose_file="$runtime_config_dir/pinned-compose.json"
  local temporary_pinned_file="$runtime_config_dir/pinned-compose.json.tmp"
  "${sanitized_environment[@]}" \
    node scripts/production-api-maintenance-binding.cjs \
      --publish-env "$ENV_FILE" \
      --release-env "$RELEASE_FILE" \
      --task "$task" \
      --action "$action" \
      --image-id "$verified_image_id" \
      --pin-maintenance-image-json \
      < "$resolved_compose_file" > "$temporary_pinned_file"
  chmod 600 "$temporary_pinned_file"
  mv -T -- "$temporary_pinned_file" "$pinned_compose_file"
  pinned_compose_digest="$(sha256sum -- "$pinned_compose_file")"
  pinned_compose_digest="${pinned_compose_digest%% *}"
  exec 7<"$pinned_compose_file"
  rm -f -- "$pinned_compose_file"
  pinned_compose=(
    "${sanitized_environment[@]}"
    docker compose
    -p "$compose_project"
    -f -
  )
}

create_verified_apply_backup() {
  local backup_dir backup_finish_epoch backup_id backup_root backup_start_epoch
  local marker_epoch offsite_marker_epoch resolved_backup_dir result_file
  local -a backup_result

  runtime_temp_dir="$(mktemp -d /run/arenzyra-api-maintenance-backup.XXXXXX)"
  chmod 700 "$runtime_temp_dir"
  result_file="$runtime_temp_dir/result"
  backup_start_epoch="$(date +%s)"

  # Backup invokes Docker helpers, so the required production preflight is
  # immediately repeated under the same deployment lock before it begins.
  run_production_preflight
  "${sanitized_environment[@]}" \
    "ARENZYRA_BACKUP_ENV_FILE=$ENV_FILE" \
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$compose_project" \
    "ARENZYRA_DEPLOY_LOCK_INHERITED=1" \
    "ARENZYRA_BACKUP_REASON=api-maintenance:$task:$release_id" \
    "ARENZYRA_BACKUP_RESULT_FILE=$result_file" \
    "ARENZYRA_BACKUP_REQUIRE_OFFSITE=1" \
    "ARENZYRA_BACKUP_ALLOW_MISSING_APP_VOLUMES=0" \
    bash scripts/production-backup.sh

  # Catch disk/health changes caused by backup creation immediately, before
  # result processing or any database-writing maintenance command.
  run_production_preflight
  test -f "$result_file"
  mapfile -t backup_result <"$result_file"
  if [ "${#backup_result[@]}" -ne 2 ]; then
    printf 'API maintenance backup returned an invalid result.\n' >&2
    return 75
  fi
  backup_id="${backup_result[0]}"
  backup_dir="${backup_result[1]}"
  if ! [[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]]; then
    printf 'API maintenance backup returned an invalid identifier.\n' >&2
    return 75
  fi
  backup_root="$(
    "${sanitized_environment[@]}" \
      node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_BACKUP_ROOT
  )"
  backup_root="${backup_root:-/opt/arenzyra-backups}"
  backup_root="$(realpath -e -- "$backup_root")"
  resolved_backup_dir="$(realpath -e -- "$backup_dir")"
  if [ "$(dirname -- "$resolved_backup_dir")" != "$backup_root" ] || \
    [ "$(basename -- "$resolved_backup_dir")" != "$backup_id" ]; then
    printf 'API maintenance backup escaped the reviewed backup root.\n' >&2
    return 75
  fi
  for artifact in \
    BACKUP_COMPLETE \
    OFFSITE_VERIFIED \
    database.dump.age \
    database-globals.sql.age \
    metadata.txt.age \
    manifest.sha256.age; do
    if [ ! -s "$resolved_backup_dir/$artifact" ]; then
      printf 'API maintenance backup is missing a required verified artifact.\n' >&2
      return 75
    fi
  done
  marker_epoch="$(stat -c %Y -- "$resolved_backup_dir/BACKUP_COMPLETE")"
  offsite_marker_epoch="$(stat -c %Y -- "$resolved_backup_dir/OFFSITE_VERIFIED")"
  backup_finish_epoch="$(date +%s)"
  for verified_epoch in "$marker_epoch" "$offsite_marker_epoch"; do
    if ! [[ "$verified_epoch" =~ ^[0-9]+$ ]] || \
      [ "$verified_epoch" -lt "$backup_start_epoch" ] || \
      [ "$verified_epoch" -gt $((backup_finish_epoch + 5)) ]; then
      printf 'API maintenance backup verification marker is stale or invalid.\n' >&2
      return 75
    fi
  done
  printf 'API MAINTENANCE BACKUP VERIFIED id=%s offsite=yes encrypted=yes\n' "$backup_id"
  rm -f -- "$result_file"
  rmdir -- "$runtime_temp_dir"
  runtime_temp_dir=""
}

verify_local_api_image
# The physical target verifier performs a read-only service operation, so it is
# preceded by the mandated production preflight in this same locked session.
run_production_preflight
verify_physical_database_binding
if [ "$require_stopped_api" = "1" ]; then
  verify_idp_writer_boundary
fi
if [ "$action" = "apply" ]; then
  create_verified_apply_backup
fi
verify_runtime_database_roles

printf '[api-maintenance] task=%s action=%s target=verified lock=held\n' "$task" "$action"
# This pass follows any backup and is the final full disk/service health check
# before the one-off task. The final target and immutable-image attestations
# follow it so changes during preflight cannot cross the execution boundary.
run_production_preflight
if [ "$require_stopped_api" = "1" ]; then
  verify_idp_writer_boundary
fi
verify_reviewed_inputs_unchanged
verify_physical_database_binding
verify_runtime_database_roles
verify_local_api_image
pin_verified_maintenance_image
verify_reviewed_inputs_unchanged
maintenance_exit_status=0
set +e
"${pinned_compose[@]}" --profile maintenance run --rm --no-deps --pull never -T \
  "$maintenance_service" "${runner_arguments[@]}" <&7
maintenance_exit_status=$?
set -e
exec 7<&-
postcondition_exit_status=0
postcondition_role_exit_status=0
if [ "$task" = "idp-credentials" ] && [ "$action" = "apply" ]; then
  # An apply attempt may have committed before its container reports failure.
  # Always check the durable zero-plaintext postcondition, but retain the
  # original maintenance status when both the task and a postcondition fail.
  printf '[api-maintenance] idp_apply=attempted postcondition=pending\n'
  set +e
  verify_idp_encryption_postcondition
  postcondition_exit_status=$?
  verify_runtime_database_roles
  postcondition_role_exit_status=$?
  set -e
  if [ "$postcondition_exit_status" -eq 0 ] && \
    [ "$postcondition_role_exit_status" -eq 0 ]; then
    printf '[api-maintenance] idp_apply=verified legacy_plaintext_schedules=0\n'
  fi
fi
if [ "$maintenance_exit_status" -ne 0 ]; then
  exit "$maintenance_exit_status"
fi
if [ "$postcondition_exit_status" -ne 0 ]; then
  exit "$postcondition_exit_status"
fi
if [ "$postcondition_role_exit_status" -ne 0 ]; then
  exit "$postcondition_role_exit_status"
fi
