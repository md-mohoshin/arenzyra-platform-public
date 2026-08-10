#!/usr/bin/env bash

PRODUCTION_DEPLOY_LOCK_FILE="/run/arenzyra-production-deploy.lock"
PRODUCTION_DEPLOY_LOCK_TIMEOUT_SECONDS="${ARENZYRA_DEPLOY_LOCK_TIMEOUT_SECONDS:-10}"

production_lock_block() {
  printf 'PRODUCTION ACTION BLOCKED: %s\n' "$1" >&2
  return 75
}

[ "$#" -eq 0 ] || production_lock_block "shared lock helper accepts no arguments."
for production_lock_command in dirname flock readlink realpath stat; do
  command -v "$production_lock_command" >/dev/null 2>&1 || \
    production_lock_block "required lock command is unavailable."
done
if ! [[ "$PRODUCTION_DEPLOY_LOCK_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || \
  [ "$PRODUCTION_DEPLOY_LOCK_TIMEOUT_SECONDS" -gt 300 ]; then
  production_lock_block "deployment lock timeout must be 0-300 seconds."
fi

production_lock_directory="$(dirname -- "$PRODUCTION_DEPLOY_LOCK_FILE")"
production_lock_directory_identity="$(
  stat -Lc '%u:%a' -- "$production_lock_directory" 2>/dev/null || true
)"
if [ -L "$production_lock_directory" ] || [ ! -d "$production_lock_directory" ] || \
  [ "$(realpath -e -- "$production_lock_directory" 2>/dev/null || true)" != "/run" ]; then
  production_lock_block "deployment lock directory is unsafe."
fi
IFS=':' read -r production_lock_directory_uid production_lock_directory_mode \
  <<<"$production_lock_directory_identity"
if [ "$production_lock_directory_uid" != "0" ] || \
  ! [[ "$production_lock_directory_mode" =~ ^[0-7]{3,4}$ ]] || \
  (( 8#$production_lock_directory_mode & 8#022 )); then
  production_lock_block "deployment lock directory ownership or mode is unsafe."
fi

production_verify_lock_descriptor() {
  local descriptor_identity file_identity mode owner target
  [ -f "$PRODUCTION_DEPLOY_LOCK_FILE" ] && [ ! -L "$PRODUCTION_DEPLOY_LOCK_FILE" ] || return 75
  target="$(readlink -f "/proc/$$/fd/8" 2>/dev/null || true)"
  owner="$(stat -Lc %u -- "/proc/$$/fd/8" 2>/dev/null || true)"
  mode="$(stat -Lc %a -- "/proc/$$/fd/8" 2>/dev/null || true)"
  file_identity="$(stat -Lc '%d:%i:%h' -- "$PRODUCTION_DEPLOY_LOCK_FILE" 2>/dev/null || true)"
  descriptor_identity="$(stat -Lc '%d:%i:%h' -- "/proc/$$/fd/8" 2>/dev/null || true)"
  [ "$target" = "$PRODUCTION_DEPLOY_LOCK_FILE" ] && [ "$owner" = "0" ] && \
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 )) && \
    [ "$file_identity" = "$descriptor_identity" ] && \
    [ "${file_identity##*:}" = "1" ]
}

if [ -e "$PRODUCTION_DEPLOY_LOCK_FILE" ] || [ -L "$PRODUCTION_DEPLOY_LOCK_FILE" ]; then
  production_existing_lock_identity="$(
    stat -Lc '%u:%a:%h' -- "$PRODUCTION_DEPLOY_LOCK_FILE" 2>/dev/null || true
  )"
  IFS=':' read -r production_existing_lock_uid production_existing_lock_mode \
    production_existing_lock_links <<<"$production_existing_lock_identity"
  if [ -L "$PRODUCTION_DEPLOY_LOCK_FILE" ] || [ ! -f "$PRODUCTION_DEPLOY_LOCK_FILE" ] || \
    [ "$production_existing_lock_uid" != "0" ] || \
    ! [[ "$production_existing_lock_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( 8#$production_existing_lock_mode & 8#022 )) || \
    [ "$production_existing_lock_links" != "1" ]; then
    production_lock_block "deployment lock path identity, ownership, or mode is unsafe."
  fi
fi

if [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = "1" ]; then
  production_verify_lock_descriptor && flock -n 8 || \
    production_lock_block "inherited deployment lock could not be verified."
else
  exec 8>"$PRODUCTION_DEPLOY_LOCK_FILE"
  production_verify_lock_descriptor || production_lock_block "deployment lock file is unsafe."
  flock -w "$PRODUCTION_DEPLOY_LOCK_TIMEOUT_SECONDS" 8 || \
    production_lock_block "another production action holds the shared lock."
  production_verify_lock_descriptor || production_lock_block "deployment lock identity changed."
fi
export ARENZYRA_DEPLOY_LOCK_INHERITED=1
unset production_lock_directory production_lock_directory_identity
unset production_lock_directory_uid production_lock_directory_mode
unset production_existing_lock_identity production_existing_lock_uid
unset production_existing_lock_mode production_existing_lock_links
unset production_lock_command
