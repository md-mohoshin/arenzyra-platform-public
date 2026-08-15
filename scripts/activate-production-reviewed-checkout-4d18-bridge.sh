#!/usr/bin/env bash
set -Eeuo pipefail
set -o pipefail
umask 077

# One-time compatibility bridge for the production Root that already contains
# the reviewed checkout bootstrap but predates the allowlisted source-activate
# dispatcher command. The Windows launcher transmits these committed LF bytes
# as base64 and supplies only validated non-secret identifiers.

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ROOT_PATH="/opt/arenzyra"
INCOMING_ROOT="/opt/arenzyra-release-incoming"
STAGING_ROOT="/opt/arenzyra-release-staging"
ARCHIVE_ROOT="/opt/arenzyra-source-archives"
COMPATIBLE_CURRENT_ROOT="4d18a9ad56d738e2992d0ca7564c4f8d553865a8"
COMPATIBLE_CURRENT_API="428ca9d6dd20c065314a1787f5de92bc4f9d8646"
COMPATIBLE_CURRENT_WEB="2ee104f6fcc22ef0b37a5c1f8b0b42df2ad076aa"
export PATH="$SAFE_PATH"

block() {
  printf 'REVIEWED SOURCE COMPATIBILITY ACTIVATION BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 11 ] || \
  block "release ID, current and target commits, archive hashes, and bridge hash are required."
release_id="$1"
current_root="$2"
current_api="$3"
current_web="$4"
target_root="$5"
target_api="$6"
target_web="$7"
root_hash="$8"
api_hash="$9"
web_hash="${10}"
expected_bridge_hash="${11}"

[[ "$release_id" =~ ^[a-zA-Z0-9._-]{8,128}$ ]] || block "release ID is invalid."
[ "$current_root" = "$COMPATIBLE_CURRENT_ROOT" ] || \
  block "the current Root is outside this one-time compatibility boundary."
[ "$current_api" = "$COMPATIBLE_CURRENT_API" ] || \
  block "the current API is outside this one-time compatibility boundary."
[ "$current_web" = "$COMPATIBLE_CURRENT_WEB" ] || \
  block "the current Web is outside this one-time compatibility boundary."
for commit in "$current_root" "$current_api" "$current_web" \
  "$target_root" "$target_api" "$target_web"; do
  [[ "$commit" =~ ^[0-9a-f]{40}$ ]] || block "a reviewed commit is invalid."
done
for hash in "$root_hash" "$api_hash" "$web_hash"; do
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || block "a repository archive hash is invalid."
done
[[ "$expected_bridge_hash" =~ ^[0-9a-f]{64}$ ]] || block "the compatibility bridge hash is invalid."

[ "$(id -u)" -eq 0 ] || block "UID 0 is required."
[ -z "${BASH_ENV:-}${ENV:-}${NODE_OPTIONS:-}${NODE_PATH:-}" ] || \
  block "ambient shell or Node injection variables are set."
while IFS='=' read -r name _; do
  case "$name" in GIT_*) block "ambient Git variables are set." ;; esac
done < <(/usr/bin/env)
cd "$ROOT_PATH" 2>/dev/null || block "production root is unavailable."
[ "$(pwd -P)" = "$ROOT_PATH" ] || block "production root is not exact."

git_clean() {
  /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C \
    GIT_OPTIONAL_LOCKS=0 GIT_NO_REPLACE_OBJECTS=1 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"
}

stat_value() {
  /usr/bin/stat -c "$1" -- "$2" 2>/dev/null || true
}

require_safe_parent() {
  local path="$1" identity mode
  [ -d "$path" ] && [ ! -L "$path" ] && \
    [ "$(/usr/bin/realpath -e -- "$path" 2>/dev/null || true)" = "$path" ] || \
    block "$path is not an exact directory."
  identity="$(stat_value '%u:%g' "$path")"
  mode="$(stat_value '%a' "$path")"
  [ "$identity" = '0:0' ] && [[ "$mode" =~ ^[0-7]{3,4}$ ]] && \
    (( (8#$mode & 8#022) == 0 )) || \
    block "$path has unsafe ownership or permissions."
}

require_safe_optional_parent() {
  local path="$1"
  if [ -e "$path" ] || [ -L "$path" ]; then
    require_safe_parent "$path"
  fi
}

require_no_mounts() {
  local path="$1"
  if /usr/bin/findmnt -rn -o TARGET | /usr/bin/awk -v path="$path" \
    '$0 == path || index($0, path "/") == 1 { found=1 } END { exit !found }'; then
    block "$path contains a mounted filesystem."
  fi
}

require_atomic_activation_filesystem() {
  local root_device staging_device archive_device
  root_device="$(stat_value '%d' "$ROOT_PATH")"
  staging_device="$(stat_value '%d' "$STAGING_ROOT/$release_id/checkout")"
  archive_device="$(stat_value '%d' "$ARCHIVE_ROOT")"
  [ -n "$root_device" ] && [ "$root_device" = "$staging_device" ] && \
    [ "$root_device" = "$archive_device" ] || \
    block "current, staged, and archived source are not on one atomic-move filesystem."
}

current_file() {
  git_clean -C "$ROOT_PATH" show "${current_root}:$1"
}

lock_source="$(current_file scripts/acquire-production-deploy-lock.sh)" || \
  block "the current reviewed lock helper is unavailable."
[ -n "$lock_source" ] || block "the current reviewed lock helper is empty."
load_current_lock() {
  # shellcheck source=/dev/null
  source /dev/stdin <<<"$lock_source"
}
load_current_lock
declare -F production_verify_lock_descriptor >/dev/null || \
  block "the current reviewed lock helper did not load."
production_verify_lock_descriptor || block "the shared deployment lock is not verified."

run_entrypoint() {
  local root="$1" api="$2" web="$3" source
  shift 3
  source="$(git_clean -C "$ROOT_PATH" show \
    "${root}:scripts/production-reviewed-entrypoint.sh")" || \
    block "the reviewed production dispatcher is unavailable."
  [ -n "$source" ] || block "the reviewed production dispatcher is empty."
  /usr/bin/printf '%s\n' "$source" |
    /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C \
      ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
      ARENZYRA_REVIEWED_ROOT_COMMIT="$root" \
      ARENZYRA_REVIEWED_API_COMMIT="$api" \
      ARENZYRA_REVIEWED_WEB_COMMIT="$web" \
      /bin/bash --noprofile --norc -s -- "$@"
}

run_current_bootstrap() {
  local phase="$1" source
  source="$(current_file scripts/bootstrap-production-reviewed-checkout.sh)" || \
    block "the current reviewed checkout bootstrap is unavailable."
  [ -n "$source" ] || block "the current reviewed checkout bootstrap is empty."
  /usr/bin/printf '%s\n' "$source" |
    /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C \
      ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
      ARENZYRA_BOOTSTRAP_RELEASE_ID="$release_id" \
      ARENZYRA_REVIEWED_ROOT_COMMIT="$target_root" \
      ARENZYRA_REVIEWED_API_COMMIT="$target_api" \
      ARENZYRA_REVIEWED_WEB_COMMIT="$target_web" \
      ARENZYRA_ROOT_REPOSITORY_SHA256="$root_hash" \
      ARENZYRA_API_REPOSITORY_SHA256="$api_hash" \
      ARENZYRA_WEB_REPOSITORY_SHA256="$web_hash" \
      /bin/bash --noprofile --norc -s -- "$phase"
}

verify_incoming_transfer() {
  local incoming="$INCOMING_ROOT/$release_id" names file size
  require_safe_parent /opt
  require_safe_parent "$INCOMING_ROOT"
  [ -d "$incoming" ] && [ ! -L "$incoming" ] && \
    [ "$(/usr/bin/realpath -e -- "$incoming" 2>/dev/null || true)" = "$incoming" ] && \
    [ "$(/usr/bin/stat -c '%u:%g:%a' -- "$incoming" 2>/dev/null || true)" = '0:0:700' ] || \
    block "the incoming transfer directory is unsafe."
  require_no_mounts "$incoming"
  names="$(/usr/bin/find "$incoming" -mindepth 1 -maxdepth 1 -printf '%f\n' | /usr/bin/sort)"
  [ "$names" = $'api.git.tar\nroot.git.tar\nweb.git.tar' ] || \
    block "the incoming transfer contains unexpected entries."
  for file in "$incoming/root.git.tar" "$incoming/api.git.tar" "$incoming/web.git.tar"; do
    size="$(stat_value '%s' "$file")"
    [ -f "$file" ] && [ ! -L "$file" ] && \
      [ "$(stat_value '%u:%g:%a:%h' "$file")" = '0:0:600:1' ] && \
      [[ "$size" =~ ^[0-9]+$ ]] && [ "$size" -gt 0 ] && \
      [ "$size" -le 1073741824 ] || \
      block "an incoming archive is unsafe."
  done
}

verify_forward_component() {
  local repository="$1" current="$2" target="$3" label="$4" resolved
  resolved="$(git_clean -C "$repository" rev-parse --verify "${current}^{commit}" 2>/dev/null || true)"
  [ "$resolved" = "$current" ] || block "$label target archive does not contain the current commit."
  git_clean -C "$repository" merge-base --is-ancestor "$current" "$target" >/dev/null 2>&1 || \
    block "$label target history does not contain the current production source."
}

verify_forward_assembly() {
  local checkout="$STAGING_ROOT/$release_id/checkout"
  verify_forward_component "$checkout" "$current_root" "$target_root" Root
  verify_forward_component "$checkout/apps/api" "$current_api" "$target_api" API
  verify_forward_component "$checkout/apps/arenzyra-web" "$current_web" "$target_web" Web
  printf 'REVIEWED SOURCE FORWARD HISTORY VERIFIED root=1 api=1 web=1\n'
}

verify_executed_bridge() {
  local checkout="$STAGING_ROOT/$release_id/checkout" actual
  actual="$({
    git_clean -C "$checkout" show \
      "${target_root}:scripts/activate-production-reviewed-checkout-4d18-bridge.sh" || exit 75
  } | /usr/bin/sha256sum | /usr/bin/awk '{ print $1 }')" || \
    block "the staged target compatibility bridge is unavailable."
  [ "$actual" = "$expected_bridge_hash" ] || \
    block "the executed compatibility bridge does not match the staged target commit."
  printf 'REVIEWED SOURCE COMPATIBILITY BRIDGE VERIFIED sha256=%s\n' "$actual"
}

verify_incoming_transfer
require_safe_optional_parent "$STAGING_ROOT"
require_safe_optional_parent "$ARCHIVE_ROOT"
[ ! -e "$STAGING_ROOT/$release_id" ] && [ ! -L "$STAGING_ROOT/$release_id" ] && \
  [ ! -e "$ARCHIVE_ROOT/$release_id" ] && [ ! -L "$ARCHIVE_ROOT/$release_id" ] || \
  block "release staging or archive already exists."
require_safe_parent "$ROOT_PATH"
require_no_mounts "$ROOT_PATH"

# The current dispatcher proves exact clean current Root/API/Web source while
# descriptor 8 is already held. The same inventory is repeated after prepare.
run_entrypoint "$current_root" "$current_api" "$current_web" current-release-inventory
production_verify_lock_descriptor || block "the deployment lock identity changed before prepare."
run_current_bootstrap prepare
production_verify_lock_descriptor || block "the deployment lock identity changed after prepare."
require_safe_parent "$STAGING_ROOT"
require_safe_parent "$ARCHIVE_ROOT"
require_no_mounts "$STAGING_ROOT"
require_no_mounts "$ARCHIVE_ROOT"
require_atomic_activation_filesystem
verify_executed_bridge
verify_forward_assembly
require_safe_parent "$ROOT_PATH"
require_no_mounts "$ROOT_PATH"
run_entrypoint "$current_root" "$current_api" "$current_web" current-release-inventory
production_verify_lock_descriptor || block "the deployment lock identity changed before activation."
require_safe_parent "$ROOT_PATH"
require_no_mounts "$ROOT_PATH"

run_current_bootstrap activate
cd "$ROOT_PATH"
production_verify_lock_descriptor || block "the deployment lock identity changed after activation."
run_entrypoint "$target_root" "$target_api" "$target_web" current-release-inventory
run_entrypoint "$target_root" "$target_api" "$target_web" source-inventory "$release_id"
production_verify_lock_descriptor || block "the deployment lock identity changed after final inventory."
printf 'REVIEWED SOURCE COMPATIBILITY ACTIVATION COMPLETE: release=%s prior-source=%s/%s\n' \
  "$release_id" "$ARCHIVE_ROOT" "$release_id"
