#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
BACKUP_ROOT="/opt/arenzyra-backups"

block() {
  printf 'PRODUCTION BACKUP INVENTORY BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 0 ] || block "arguments are unsupported."
[ "$REPOSITORY_ROOT" = "$EXPECTED_ROOT" ] || block "repository root is not exact."
cd "$REPOSITORY_ROOT"
source scripts/require-local-production-docker.sh
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source scripts/acquire-production-deploy-lock.sh
bash scripts/production-deploy-preflight.sh --allow-read-only-legacy-backup

for required_command in stat; do
  command -v "$required_command" >/dev/null 2>&1 || \
    block "required inventory command is unavailable: $required_command"
done

if [ ! -e "$BACKUP_ROOT" ] && [ ! -L "$BACKUP_ROOT" ]; then
  printf '%s\n' \
    'BACKUP_INVENTORY root_exists=0 root_safe=1 top_level_entries=0' \
    'BACKUP_INVENTORY lock_present=0 lock_safe=0' \
    'BACKUP_INVENTORY completed_sets=0 incomplete_sets=0 unexpected_entries=0' \
    'BACKUP_INVENTORY complete_markers=0 offsite_markers=0 restore_markers=0 encrypted_artifacts=0 unexpected_children=0' \
    'BACKUP_INVENTORY lock_only=0'
  exit 0
fi

[ -d "$BACKUP_ROOT" ] && [ ! -L "$BACKUP_ROOT" ] || \
  block "backup root is not a regular directory."
backup_root_identity="$(stat -Lc '%u:%g:%a' -- "$BACKUP_ROOT" 2>/dev/null || true)"
IFS=':' read -r backup_root_uid backup_root_gid backup_root_mode \
  <<<"$backup_root_identity"
if [ "$backup_root_uid" != "0" ] || [ "$backup_root_gid" != "0" ] || \
  ! [[ "$backup_root_mode" =~ ^[0-7]{3,4}$ ]] || \
  (( 8#$backup_root_mode & 8#022 )); then
  block "backup root ownership or permissions are unsafe."
fi

safe_regular_file() {
  local path="$1" expected_size="${2:-}" identity uid gid mode links size
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$path" 2>/dev/null || true)"
  IFS=':' read -r uid gid mode links size <<<"$identity"
  [ "$uid" = "0" ] && [ "$gid" = "0" ] && \
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 )) && \
    [ "$links" = "1" ] && [[ "$size" =~ ^[0-9]+$ ]] || return 1
  [ -z "$expected_size" ] || [ "$size" = "$expected_size" ]
}

safe_directory() {
  local path="$1" identity uid gid mode
  [ -d "$path" ] && [ ! -L "$path" ] || return 1
  identity="$(stat -Lc '%u:%g:%a' -- "$path" 2>/dev/null || true)"
  IFS=':' read -r uid gid mode <<<"$identity"
  [ "$uid" = "0" ] && [ "$gid" = "0" ] && \
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 ))
}

lock_present=0
lock_safe=0
completed_sets=0
incomplete_sets=0
unexpected_entries=0
complete_markers=0
offsite_markers=0
restore_markers=0
encrypted_artifacts=0
unexpected_children=0

shopt -s nullglob dotglob
top_level_entries=("$BACKUP_ROOT"/*)
for entry in "${top_level_entries[@]}"; do
  entry_name="${entry##*/}"
  if [ "$entry_name" = ".backup.lock" ]; then
    lock_present=1
    if safe_regular_file "$entry" 0; then
      lock_safe=1
    else
      unexpected_entries=$((unexpected_entries + 1))
    fi
    continue
  fi
  if [[ "$entry_name" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] && \
    safe_directory "$entry"; then
    completed_sets=$((completed_sets + 1))
    set_complete=0
    set_offsite=0
    set_restore=0
    backup_children=("$entry"/*)
    for child in "${backup_children[@]}"; do
      child_name="${child##*/}"
      case "$child_name" in
        BACKUP_COMPLETE)
          if safe_regular_file "$child"; then
            set_complete=1
          else
            unexpected_children=$((unexpected_children + 1))
          fi
          ;;
        OFFSITE_VERIFIED)
          if safe_regular_file "$child"; then
            set_offsite=1
          else
            unexpected_children=$((unexpected_children + 1))
          fi
          ;;
        RESTORE_DRILL_VERIFIED)
          if safe_regular_file "$child"; then
            set_restore=1
          else
            unexpected_children=$((unexpected_children + 1))
          fi
          ;;
        *.age)
          if safe_regular_file "$child"; then
            encrypted_artifacts=$((encrypted_artifacts + 1))
          else
            unexpected_children=$((unexpected_children + 1))
          fi
          ;;
        *)
          unexpected_children=$((unexpected_children + 1))
          ;;
      esac
    done
    complete_markers=$((complete_markers + set_complete))
    offsite_markers=$((offsite_markers + set_offsite))
    restore_markers=$((restore_markers + set_restore))
    continue
  fi
  if [[ "$entry_name" =~ ^\.incomplete-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$ ]] && \
    safe_directory "$entry"; then
    incomplete_sets=$((incomplete_sets + 1))
    continue
  fi
  unexpected_entries=$((unexpected_entries + 1))
done
shopt -u dotglob nullglob

top_level_count="${#top_level_entries[@]}"
lock_only=0
if [ "$top_level_count" -eq 1 ] && [ "$lock_present" -eq 1 ] && \
  [ "$lock_safe" -eq 1 ] && [ "$unexpected_entries" -eq 0 ]; then
  lock_only=1
fi

printf 'BACKUP_INVENTORY root_exists=1 root_safe=1 top_level_entries=%s\n' \
  "$top_level_count"
printf 'BACKUP_INVENTORY lock_present=%s lock_safe=%s\n' \
  "$lock_present" "$lock_safe"
printf 'BACKUP_INVENTORY completed_sets=%s incomplete_sets=%s unexpected_entries=%s\n' \
  "$completed_sets" "$incomplete_sets" "$unexpected_entries"
printf 'BACKUP_INVENTORY complete_markers=%s offsite_markers=%s restore_markers=%s encrypted_artifacts=%s unexpected_children=%s\n' \
  "$complete_markers" "$offsite_markers" "$restore_markers" \
  "$encrypted_artifacts" "$unexpected_children"
printf 'BACKUP_INVENTORY lock_only=%s\n' "$lock_only"
