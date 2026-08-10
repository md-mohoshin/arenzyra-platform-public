#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/require-local-production-docker.sh"
ALLOW_RUNNING_LEGACY_BACKUP=0
if [ "${1:-}" = "--allow-running-legacy-backup" ] && [ "$#" -eq 1 ]; then
  ALLOW_RUNNING_LEGACY_BACKUP=1
  shift
elif [ "$#" -ne 0 ]; then
  printf 'Backup arguments are unsupported.\n' >&2
  exit 75
fi
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source "$SCRIPT_DIR/acquire-production-deploy-lock.sh"
BACKUP_ENV_FILE="${ARENZYRA_BACKUP_ENV_FILE:-$SCRIPT_DIR/../infra/.env.publish}"
test -f "$BACKUP_ENV_FILE" || { printf 'Backup environment file is missing: %s\n' "$BACKUP_ENV_FILE" >&2; exit 2; }
BACKUP_ENV_FILE="$(realpath -e -- "$BACKUP_ENV_FILE")"
reviewed_compose_project="$(node "$SCRIPT_DIR/read-dotenv-value.cjs" "$BACKUP_ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
if [ -n "${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-}" ] && \
  [ "$ARENZYRA_DEPLOY_COMPOSE_PROJECT" != "$reviewed_compose_project" ]; then
  printf 'Backup Compose project override differs from the reviewed environment.\n' >&2
  exit 75
fi
ARENZYRA_DEPLOY_COMPOSE_PROJECT="$reviewed_compose_project"
export ARENZYRA_DEPLOY_COMPOSE_PROJECT
bind_reviewed_backup_value() {
  local key="$1"
  local reviewed current
  reviewed="$(node "$SCRIPT_DIR/read-dotenv-value.cjs" "$BACKUP_ENV_FILE" "$key")"
  current="${!key:-}"
  if [ -n "$current" ] && [ "$current" != "$reviewed" ]; then
    printf 'Backup %s override differs from the reviewed environment.\n' "$key" >&2
    exit 75
  fi
  printf -v "$key" '%s' "$reviewed"
}
for reviewed_backup_key in \
  ARENZYRA_BACKUP_ROOT \
  ARENZYRA_BACKUP_AGE_RECIPIENT \
  ARENZYRA_BACKUP_RCLONE_REMOTE \
  ARENZYRA_BACKUP_HELPER_IMAGE; do
  bind_reviewed_backup_value "$reviewed_backup_key"
done
BACKUP_ROOT="${ARENZYRA_BACKUP_ROOT:-/opt/arenzyra-backups}"
COMPOSE_PROJECT="$ARENZYRA_DEPLOY_COMPOSE_PROJECT"
AGE_RECIPIENT="${ARENZYRA_BACKUP_AGE_RECIPIENT:-}"
RCLONE_REMOTE="${ARENZYRA_BACKUP_RCLONE_REMOTE:-}"
REQUIRE_OFFSITE="${ARENZYRA_BACKUP_REQUIRE_OFFSITE:-0}"
HELPER_IMAGE="${ARENZYRA_BACKUP_HELPER_IMAGE:-postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777}"
BACKUP_REASON="${ARENZYRA_BACKUP_REASON:-scheduled}"
RESULT_FILE="${ARENZYRA_BACKUP_RESULT_FILE:-}"
ALLOW_MISSING_APP_VOLUMES="${ARENZYRA_BACKUP_ALLOW_MISSING_APP_VOLUMES:-0}"
backup_id="$(date -u '+%Y%m%dT%H%M%SZ')-$(openssl rand -hex 4)"
if [ "$ALLOW_RUNNING_LEGACY_BACKUP" -eq 1 ]; then
  bash "$SCRIPT_DIR/production-deploy-preflight.sh" --allow-read-only-legacy-backup
  database_identity_args=(--allow-running-legacy-backup)
else
  bash "$SCRIPT_DIR/production-deploy-preflight.sh"
  database_identity_args=()
fi

for command in age docker flock openssl sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Required backup command is unavailable: %s\n' "$command" >&2
    exit 2
  }
done
database_identity_environment=(
  "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$COMPOSE_PROJECT"
)
if [ -n "$BACKUP_ENV_FILE" ]; then
  database_identity_environment+=("ARENZYRA_DEPLOY_ENV_FILE=$BACKUP_ENV_FILE")
fi
if ! mapfile -t database_binding < <(
  env "${database_identity_environment[@]}" \
    bash "$SCRIPT_DIR/verify-production-database-container.sh" "${database_identity_args[@]}"
); then
  printf 'Backup database identity verification failed.\n' >&2
  exit 75
fi
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'Backup database identity verification returned an invalid result.\n' >&2
  exit 75
fi
if [ -z "$AGE_RECIPIENT" ]; then
  printf 'ARENZYRA_BACKUP_AGE_RECIPIENT is required; plaintext backups are forbidden.\n' >&2
  exit 2
fi
if ! [[ "$HELPER_IMAGE" =~ ^[^@[:space:]]+:[^@[:space:]]+@sha256:[a-fA-F0-9]{64}$ ]]; then
  printf 'ARENZYRA_BACKUP_HELPER_IMAGE must be version-and-digest pinned.\n' >&2
  exit 2
fi
if [[ "$BACKUP_REASON" == *$'\n'* ]] || [ "${#BACKUP_REASON}" -gt 200 ]; then
  printf 'ARENZYRA_BACKUP_REASON must be one line of at most 200 characters.\n' >&2
  exit 2
fi
if [ "$ALLOW_MISSING_APP_VOLUMES" != "0" ] && [ "$ALLOW_MISSING_APP_VOLUMES" != "1" ]; then
  printf 'ARENZYRA_BACKUP_ALLOW_MISSING_APP_VOLUMES must be 0 or 1.\n' >&2
  exit 2
fi
if [ "$REQUIRE_OFFSITE" != "0" ] && [ "$REQUIRE_OFFSITE" != "1" ]; then
  printf 'ARENZYRA_BACKUP_REQUIRE_OFFSITE must be 0 or 1.\n' >&2
  exit 2
fi
if [ "$REQUIRE_OFFSITE" = "1" ] && [ -z "$RCLONE_REMOTE" ]; then
  printf 'An off-host rclone destination is mandatory for this backup.\n' >&2
  exit 2
fi
if [ -n "$RCLONE_REMOTE" ] && ! command -v rclone >/dev/null 2>&1; then
  printf 'rclone is required when ARENZYRA_BACKUP_RCLONE_REMOTE is configured.\n' >&2
  exit 2
fi
if [ -n "$RCLONE_REMOTE" ]; then
  case "$RCLONE_REMOTE" in
    arenzyrab2:arenzyra-prod-backup-84f2c9/arenzyra/production) ;;
    *)
      printf 'Reviewed off-host backup destination differs.\n' >&2
      exit 75
      ;;
  esac
  # shellcheck source=scripts/load-production-backup-rclone-env.sh
  source "$SCRIPT_DIR/load-production-backup-rclone-env.sh"
fi

mkdir -p -- "$BACKUP_ROOT"
backup_root="$(realpath -e -- "$BACKUP_ROOT")"
case "$backup_root" in
  /opt/arenzyra-backups|/opt/arenzyra-backups/*) ;;
  *)
    if [ "${ARENZYRA_ALLOW_CUSTOM_BACKUP_ROOT:-0}" != "1" ] || [ "$backup_root" = "/" ]; then
      printf 'Refusing unapproved backup root: %s\n' "$backup_root" >&2
      exit 2
    fi
    ;;
esac

exec 9>"$backup_root/.backup.lock"
flock -n 9 || { printf 'Another Arenzyra backup is already running.\n' >&2; exit 75; }

working_dir="$backup_root/.incomplete-$backup_id"
final_dir="$backup_root/$backup_id"
mkdir -m 700 -- "$working_dir"
cleanup() {
  case "${working_dir:-}" in
    "$backup_root"/.incomplete-*) rm -rf -- "$working_dir" ;;
  esac
}
trap cleanup EXIT

container_for_service() {
  local service="$1"
  local ids
  ids="$(docker ps \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "label=com.docker.compose.service=${service}" \
    --filter status=running --format '{{.ID}}')"
  if [ "$(printf '%s\n' "$ids" | sed '/^$/d' | wc -l)" -ne 1 ]; then
    printf 'Expected exactly one running %s container in project %s.\n' "$service" "$COMPOSE_PROJECT" >&2
    exit 1
  fi
  printf '%s\n' "$ids"
}

volume_for_name() {
  local logical_name="$1"
  docker volume ls -q \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "label=com.docker.compose.volume=${logical_name}" \
    | sed -n '1p'
}

encrypt_stream() {
  local output="$1"
  age --encrypt --recipient "$AGE_RECIPIENT" --output "$output"
}

postgres_container="$(container_for_service postgres)"
if [ "$postgres_container" != "${database_binding[0]}" ]; then
  printf 'Backup database container differs from the reviewed target.\n' >&2
  exit 75
fi
docker exec "$postgres_container" sh -ceu \
  'exec pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom --no-owner' \
  sh "${database_binding[3]}" \
  | encrypt_stream "$working_dir/database.dump.age"
docker exec "$postgres_container" sh -ceu \
  'exec pg_dumpall -U "$POSTGRES_USER" --globals-only --no-role-passwords' \
  | encrypt_stream "$working_dir/database-globals.sql.age"

docker image inspect "$HELPER_IMAGE" >/dev/null 2>&1 || {
  printf 'Backup helper image is not present locally: %s\n' "$HELPER_IMAGE" >&2
  exit 1
}

archived_volumes=()
missing_volumes=()
for logical_name in api-storage api-uploads redis-data caddy-data caddy-config discord-bot-state; do
  volume_name="$(volume_for_name "$logical_name")"
  if [ -z "$volume_name" ]; then
    if { [ "$logical_name" = "api-storage" ] || [ "$logical_name" = "api-uploads" ]; } && \
      [ "$ALLOW_MISSING_APP_VOLUMES" != "1" ]; then
      printf 'Required production volume is missing: %s\n' "$logical_name" >&2
      exit 1
    fi
    missing_volumes+=("$logical_name")
    continue
  fi
  docker run --rm --network none --entrypoint tar \
    --mount "type=volume,src=${volume_name},dst=/source,readonly" \
    "$HELPER_IMAGE" -C /source -czf - . \
    | encrypt_stream "$working_dir/volume-${logical_name}.tar.gz.age"
  archived_volumes+=("$logical_name")
done

{
  printf 'format=arenzyra-encrypted-backup-v1\n'
  printf 'backup_id=%s\n' "$backup_id"
  printf 'created_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'compose_project=%s\n' "$COMPOSE_PROJECT"
  printf 'database_host=%s\n' "${database_binding[1]}"
  printf 'database_port=%s\n' "${database_binding[2]}"
  printf 'database_name=%s\n' "${database_binding[3]}"
  printf 'database_schema=%s\n' "${database_binding[4]}"
  printf 'volumes=%s\n' "${archived_volumes[*]}"
  printf 'missing_volumes=%s\n' "${missing_volumes[*]}"
  printf 'source_host=%s\n' "$(hostname)"
  printf 'reason=%s\n' "$BACKUP_REASON"
} | encrypt_stream "$working_dir/metadata.txt.age"

(
  cd "$working_dir"
  find . -maxdepth 1 -type f -name '*.age' ! -name 'manifest.sha256.age' -print0 \
    | sort -z \
    | xargs -0 sha256sum
) | encrypt_stream "$working_dir/manifest.sha256.age"

mv -- "$working_dir" "$final_dir"
working_dir=""
trap - EXIT
printf 'backup_id=%s\ncreated_at=%s\nreason=%s\n' \
  "$backup_id" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$BACKUP_REASON" \
  >"$final_dir/BACKUP_COMPLETE"
chmod 600 "$final_dir/BACKUP_COMPLETE"

if [ -n "$RCLONE_REMOTE" ]; then
  remote_target="${RCLONE_REMOTE%/}/$backup_id"
  rclone copy "$final_dir" "$remote_target" --checksum --immutable
  rclone check "$final_dir" "$remote_target" --checksum --one-way
  printf 'verified_at=%s\nremote=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$remote_target" \
    > "$final_dir/OFFSITE_VERIFIED"
  rclone copyto "$final_dir/OFFSITE_VERIFIED" "$remote_target/OFFSITE_VERIFIED" --immutable
  rclone check "$final_dir" "$remote_target" --checksum --one-way
  printf 'Encrypted backup uploaded and checked: %s\n' "$remote_target"
else
  printf 'WARNING: off-host copy is not configured (ARENZYRA_BACKUP_RCLONE_REMOTE).\n' >&2
fi

if [ -n "$RESULT_FILE" ]; then
  result_parent="$(dirname -- "$RESULT_FILE")"
  test -d "$result_parent" || { printf 'Backup result directory is missing: %s\n' "$result_parent" >&2; exit 2; }
  result_tmp="${RESULT_FILE}.$$.tmp"
  printf '%s\n%s\n' "$backup_id" "$final_dir" >"$result_tmp"
  chmod 600 "$result_tmp"
  mv -- "$result_tmp" "$RESULT_FILE"
fi

printf 'Encrypted backup complete: %s\n' "$final_dir"
