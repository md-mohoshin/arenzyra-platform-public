#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
EXPECTED_BACKUP_ROOT="/opt/arenzyra-backups/encrypted-v1"
EXPECTED_REMOTE="arenzyrab2:arenzyra-prod-backup-84f2c9/arenzyra/production"
ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"

block() {
  printf 'LOCAL BACKUP RELEASE BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 2 ] || block "expected superseded and replacement backup IDs."
superseded_id="$1"
replacement_id="$2"
shift 2
for backup_id in "$superseded_id" "$replacement_id"; do
  [[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || \
    block "a backup ID is invalid."
done
[ "$superseded_id" != "$replacement_id" ] && \
  [[ "$replacement_id" > "$superseded_id" ]] || \
  block "replacement backup must be a newer distinct set."
[ "$REPOSITORY_ROOT" = "$EXPECTED_ROOT" ] || block "repository root is not exact."
cd "$REPOSITORY_ROOT"
source scripts/require-local-production-docker.sh
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source scripts/acquire-production-deploy-lock.sh
bash scripts/production-deploy-preflight.sh --allow-low-disk-backup-release

for command in find flock grep node rclone realpath rmdir stat; do
  command -v "$command" >/dev/null 2>&1 || block "a required command is unavailable."
done
[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || block "reviewed environment is unsafe."
configured_root="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_ROOT)"
configured_remote="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_RCLONE_REMOTE)"
[ "$configured_root" = "$EXPECTED_BACKUP_ROOT" ] || block "managed backup root differs."
[ "$configured_remote" = "$EXPECTED_REMOTE" ] || block "managed backup remote differs."
resolved_root="$(realpath -e -- "$configured_root" 2>/dev/null || true)"
[ "$resolved_root" = "$EXPECTED_BACKUP_ROOT" ] && [ -d "$resolved_root" ] && \
  [ ! -L "$resolved_root" ] || block "managed backup root is unsafe."

exec 9>"$resolved_root/.backup.lock"
flock -n 9 || block "another backup owns the managed backup lock."

safe_file() {
  local path="$1" identity uid gid mode links size
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$path" 2>/dev/null || true)"
  IFS=':' read -r uid gid mode links size <<<"$identity"
  [ "$uid" = "0" ] && [ "$gid" = "0" ] && [ "$mode" = "600" ] && \
    [ "$links" = "1" ] && [[ "$size" =~ ^[1-9][0-9]*$ ]]
}

verify_set() {
  local backup_id="$1" backup_dir resolved_backup child name
  local -a required children
  backup_dir="$resolved_root/$backup_id"
  resolved_backup="$(realpath -e -- "$backup_dir" 2>/dev/null || true)"
  [ "$resolved_backup" = "$backup_dir" ] && [ -d "$resolved_backup" ] && \
    [ ! -L "$resolved_backup" ] || block "backup directory is unsafe or missing."
  [ "$(stat -Lc '%u:%g:%a' -- "$resolved_backup" 2>/dev/null || true)" = "0:0:700" ] || \
    block "backup directory permissions differ."
  required=(
    BACKUP_COMPLETE OFFSITE_VERIFIED database.dump.age
    database-globals.sql.age manifest.sha256.age metadata.txt.age
    volume-api-storage.tar.gz.age volume-api-uploads.tar.gz.age
  )
  for name in "${required[@]}"; do
    safe_file "$resolved_backup/$name" || block "a required verified artifact is unsafe or missing."
  done
  shopt -s nullglob dotglob
  children=("$resolved_backup"/*)
  [ "${#children[@]}" -ge "${#required[@]}" ] && \
    [ "${#children[@]}" -le 12 ] || block "backup artifact count is invalid."
  for child in "${children[@]}"; do
    name="${child##*/}"
    case "$name" in
      BACKUP_COMPLETE|OFFSITE_VERIFIED|database.dump.age|database-globals.sql.age|manifest.sha256.age|metadata.txt.age|volume-api-storage.tar.gz.age|volume-api-uploads.tar.gz.age|volume-redis-data.tar.gz.age|volume-caddy-data.tar.gz.age|volume-caddy-config.tar.gz.age|volume-discord-bot-state.tar.gz.age) ;;
      *) block "backup directory contains an unsupported artifact." ;;
    esac
    safe_file "$child" || block "a backup artifact is unsafe."
  done
  shopt -u dotglob nullglob
  grep -Fxq "remote=${EXPECTED_REMOTE}/${backup_id}" "$resolved_backup/OFFSITE_VERIFIED" || \
    block "off-site marker does not bind the expected remote."
  printf '%s\n' "$resolved_backup"
}

superseded_dir="$(verify_set "$superseded_id")"
replacement_dir="$(verify_set "$replacement_id")"

# shellcheck source=scripts/load-production-backup-rclone-env.sh
source scripts/load-production-backup-rclone-env.sh
rclone check "$superseded_dir" "$EXPECTED_REMOTE/$superseded_id" --checksum --one-way || \
  block "superseded backup failed its off-site checksum re-verification."
rclone check "$replacement_dir" "$EXPECTED_REMOTE/$replacement_id" --checksum --one-way || \
  block "replacement backup failed its off-site checksum re-verification."

# Repeat the exact topology/disk-maintenance guard immediately before releasing
# only the superseded local encrypted duplicate. Remote Object Lock data is not
# modified, and the newer verified local recovery set remains present.
bash scripts/production-deploy-preflight.sh --allow-low-disk-backup-release
find "$superseded_dir" -mindepth 1 -maxdepth 1 -type f -delete
rmdir -- "$superseded_dir"
printf 'LOCAL BACKUP COPY RELEASED id=%s replacement_local=%s remote_preserved=true\n' \
  "$superseded_id" "$replacement_id"
