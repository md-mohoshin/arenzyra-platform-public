#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
EXPECTED_BACKUP_ROOT="/opt/arenzyra-backups/encrypted-v1"
EXPECTED_REMOTE="arenzyrab2:arenzyra-prod-backup-84f2c9/arenzyra/production"
ALLOW_RUNNING_LEGACY_BACKUP=0

block() {
  printf 'BACKUP RESUME BLOCKED: %s\n' "$1" >&2
  exit 75
}

if [ "${1:-}" = "--allow-running-legacy-backup" ] && [ "$#" -eq 2 ]; then
  ALLOW_RUNNING_LEGACY_BACKUP=1
  shift
elif [ "$#" -ne 1 ]; then
  block "expected one backup ID."
fi
backup_id="$1"
shift
[[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || \
  block "backup ID is invalid."
[ "$REPOSITORY_ROOT" = "$EXPECTED_ROOT" ] || block "repository root is not exact."
cd "$REPOSITORY_ROOT"
source scripts/require-local-production-docker.sh
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source scripts/acquire-production-deploy-lock.sh
if [ "$ALLOW_RUNNING_LEGACY_BACKUP" -eq 1 ]; then
  bash scripts/production-deploy-preflight.sh --allow-read-only-legacy-backup
  database_identity_args=(--allow-running-legacy-backup)
else
  bash scripts/production-deploy-preflight.sh
  database_identity_args=()
fi

for command in flock node rclone realpath stat; do
  command -v "$command" >/dev/null 2>&1 || block "required command is unavailable."
done
[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || block "reviewed environment is unsafe."
backup_root="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_ROOT)"
remote="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_RCLONE_REMOTE)"
[ "$backup_root" = "$EXPECTED_BACKUP_ROOT" ] || block "managed backup root differs."
[ "$remote" = "$EXPECTED_REMOTE" ] || block "managed off-site destination differs."

compose_project="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
[[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || \
  block "reviewed Compose project is invalid."
database_environment=(
  "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$compose_project"
  "ARENZYRA_DEPLOY_ENV_FILE=$ENV_FILE"
)
if ! env "${database_environment[@]}" \
  bash scripts/verify-production-database-container.sh "${database_identity_args[@]}" \
  >/dev/null; then
  block "database identity verification failed."
fi

# shellcheck source=scripts/load-production-backup-rclone-env.sh
source scripts/load-production-backup-rclone-env.sh
resolved_root="$(realpath -e -- "$backup_root" 2>/dev/null || true)"
[ "$resolved_root" = "$EXPECTED_BACKUP_ROOT" ] && [ -d "$resolved_root" ] && \
  [ ! -L "$resolved_root" ] || block "managed backup root is unsafe."
root_identity="$(stat -Lc '%u:%g:%a' -- "$resolved_root" 2>/dev/null || true)"
IFS=':' read -r root_uid root_gid root_mode <<<"$root_identity"
[ "$root_uid" = "0" ] && [ "$root_gid" = "0" ] && \
  [[ "$root_mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$root_mode & 8#022) == 0 )) || \
  block "managed backup root permissions are unsafe."

exec 9>"$resolved_root/.backup.lock"
flock -n 9 || block "another backup owns the managed backup lock."
backup_dir="$resolved_root/$backup_id"
resolved_backup="$(realpath -e -- "$backup_dir" 2>/dev/null || true)"
[ "$resolved_backup" = "$backup_dir" ] && [ -d "$resolved_backup" ] && \
  [ ! -L "$resolved_backup" ] || block "backup directory is unsafe or missing."
backup_identity="$(stat -Lc '%u:%g:%a' -- "$resolved_backup" 2>/dev/null || true)"
[ "$backup_identity" = "0:0:700" ] || block "backup directory permissions differ."

safe_file() {
  local path="$1" identity uid gid mode links size
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$path" 2>/dev/null || true)"
  IFS=':' read -r uid gid mode links size <<<"$identity"
  [ "$uid" = "0" ] && [ "$gid" = "0" ] && [ "$mode" = "600" ] && \
    [ "$links" = "1" ] && [[ "$size" =~ ^[1-9][0-9]*$ ]]
}

required=(
  BACKUP_COMPLETE
  database.dump.age
  database-globals.sql.age
  manifest.sha256.age
  metadata.txt.age
  volume-api-storage.tar.gz.age
  volume-api-uploads.tar.gz.age
)
for name in "${required[@]}"; do
  safe_file "$resolved_backup/$name" || block "required encrypted artifact is unsafe or missing."
done

shopt -s nullglob dotglob
children=("$resolved_backup"/*)
[ "${#children[@]}" -ge "${#required[@]}" ] || block "backup artifact count is invalid."
for child in "${children[@]}"; do
  name="${child##*/}"
  case "$name" in
    BACKUP_COMPLETE|OFFSITE_VERIFIED|database.dump.age|database-globals.sql.age|manifest.sha256.age|metadata.txt.age|volume-api-storage.tar.gz.age|volume-api-uploads.tar.gz.age|volume-redis-data.tar.gz.age|volume-caddy-data.tar.gz.age|volume-caddy-config.tar.gz.age|volume-discord-bot-state.tar.gz.age) ;;
    *) block "backup directory contains an unsupported artifact." ;;
  esac
  safe_file "$child" || block "backup artifact is unsafe."
done
shopt -u dotglob nullglob

remote_target="${remote%/}/$backup_id"
# OFFSITE_VERIFIED is deliberately excluded until every encrypted artifact and
# BACKUP_COMPLETE have been uploaded and compared successfully.
rclone copy "$resolved_backup" "$remote_target" \
  --exclude OFFSITE_VERIFIED --checksum --immutable
rclone check "$resolved_backup" "$remote_target" \
  --exclude OFFSITE_VERIFIED --checksum --one-way
if [ ! -e "$resolved_backup/OFFSITE_VERIFIED" ]; then
  marker_tmp="$resolved_backup/.OFFSITE_VERIFIED.$$.tmp"
  printf 'verified_at=%s\nremote=%s\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$remote_target" >"$marker_tmp"
  chmod 600 "$marker_tmp"
  mv -- "$marker_tmp" "$resolved_backup/OFFSITE_VERIFIED"
else
  safe_file "$resolved_backup/OFFSITE_VERIFIED" || \
    block "existing off-site marker is unsafe."
fi
rclone copyto "$resolved_backup/OFFSITE_VERIFIED" \
  "$remote_target/OFFSITE_VERIFIED" --immutable
rclone check "$resolved_backup" "$remote_target" --checksum --one-way
printf 'Encrypted backup upload resumed and verified: %s\n' "$remote_target"
