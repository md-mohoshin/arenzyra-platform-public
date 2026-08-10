#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
EXPECTED_BACKUP_ROOT="/opt/arenzyra-backups/encrypted-v1"
ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"

block() {
  printf 'BACKUP EXPORT BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 1 ] || block "expected one backup ID."
backup_id="$1"
shift
[[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] || \
  block "backup ID is invalid."
[ "$REPOSITORY_ROOT" = "$EXPECTED_ROOT" ] || block "repository root is not exact."
cd "$REPOSITORY_ROOT"
source scripts/require-local-production-docker.sh
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source scripts/acquire-production-deploy-lock.sh
# Keep stdout binary-clean for the archive stream.
bash scripts/production-deploy-preflight.sh --allow-read-only-legacy-backup >&2

for command in flock node realpath stat tar; do
  command -v "$command" >/dev/null 2>&1 || block "required command is unavailable."
done
[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || block "reviewed environment is unsafe."
configured_root="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_ROOT)"
[ "$configured_root" = "$EXPECTED_BACKUP_ROOT" ] || block "managed backup root differs."
resolved_root="$(realpath -e -- "$configured_root" 2>/dev/null || true)"
[ "$resolved_root" = "$EXPECTED_BACKUP_ROOT" ] && [ -d "$resolved_root" ] && \
  [ ! -L "$resolved_root" ] || block "managed backup root is unsafe."

exec 9>"$resolved_root/.backup.lock"
flock -n 9 || block "another backup owns the managed backup lock."
backup_dir="$resolved_root/$backup_id"
resolved_backup="$(realpath -e -- "$backup_dir" 2>/dev/null || true)"
[ "$resolved_backup" = "$backup_dir" ] && [ -d "$resolved_backup" ] && \
  [ ! -L "$resolved_backup" ] || block "backup directory is unsafe or missing."
[ "$(stat -Lc '%u:%g:%a' -- "$resolved_backup" 2>/dev/null || true)" = "0:0:700" ] || \
  block "backup directory permissions differ."

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
  OFFSITE_VERIFIED
  database.dump.age
  database-globals.sql.age
  manifest.sha256.age
  metadata.txt.age
  volume-api-storage.tar.gz.age
  volume-api-uploads.tar.gz.age
)
for name in "${required[@]}"; do
  safe_file "$resolved_backup/$name" || block "required verified artifact is unsafe or missing."
done

shopt -s nullglob dotglob
children=("$resolved_backup"/*)
export_names=()
for child in "${children[@]}"; do
  name="${child##*/}"
  case "$name" in
    BACKUP_COMPLETE|OFFSITE_VERIFIED|database.dump.age|database-globals.sql.age|manifest.sha256.age|metadata.txt.age|volume-api-storage.tar.gz.age|volume-api-uploads.tar.gz.age|volume-redis-data.tar.gz.age|volume-caddy-data.tar.gz.age|volume-caddy-config.tar.gz.age|volume-discord-bot-state.tar.gz.age) ;;
    *) block "backup directory contains an unsupported artifact." ;;
  esac
  safe_file "$child" || block "backup artifact is unsafe."
  export_names+=("$name")
done
shopt -u dotglob nullglob
[ "${#export_names[@]}" -ge "${#required[@]}" ] || block "backup artifact count is invalid."

printf 'BACKUP EXPORT STARTED id=%s files=%s\n' "$backup_id" "${#export_names[@]}" >&2
tar -C "$resolved_backup" -cf - -- "${export_names[@]}"
printf 'BACKUP EXPORT COMPLETED id=%s files=%s\n' "$backup_id" "${#export_names[@]}" >&2
