#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

ROOT_PATH="/opt/arenzyra"
INCOMING_ROOT="/opt/arenzyra-release-incoming"
STAGING_ROOT="/opt/arenzyra-release-staging"
ARCHIVE_ROOT="/opt/arenzyra-source-archives"

block() {
  printf 'REVIEWED SOURCE ACTIVATION BLOCKED: %s\n' "$1" >&2
  exit 75
}

require_clean_parent() {
  [ "$(id -u)" -eq 0 ] || block "UID 0 is required."
  [ "$(pwd -P)" = "$ROOT_PATH" ] || block "exact production working directory is required."
  [ -z "${BASH_ENV:-}${ENV:-}${NODE_OPTIONS:-}${NODE_PATH:-}" ] || \
    block "ambient shell or Node injection variables are set."
  while IFS='=' read -r name _; do
    case "$name" in GIT_*) block "ambient Git variables are set." ;; esac
  done < <(/usr/bin/env)
  for command in awk find findmnt git realpath sha256sum sort stat; do
    command -v "$command" >/dev/null 2>&1 || block "a required system tool is unavailable."
  done
}

require_commit() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || block "$2 commit is invalid."
}

require_hash() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]] || block "$2 archive hash is invalid."
}

stat_value() {
  /usr/bin/stat -c "$1" -- "$2" 2>/dev/null || true
}

require_safe_parent() {
  local path="$1" identity mode
  [ -d "$path" ] && [ ! -L "$path" ] && \
    [ "$(realpath -e -- "$path" 2>/dev/null || true)" = "$path" ] || \
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

require_incoming_transfer() {
  local release="$1" incoming names file identity size
  incoming="$INCOMING_ROOT/$release"
  require_safe_parent /opt
  require_safe_parent "$INCOMING_ROOT"
  require_safe_parent "$incoming"
  require_no_mounts "$incoming"
  names="$(/usr/bin/find "$incoming" -mindepth 1 -maxdepth 1 -printf '%f\n' | /usr/bin/sort)"
  [ "$names" = $'api.git.tar\nroot.git.tar\nweb.git.tar' ] || \
    block "incoming transfer must contain exactly the three reviewed repository archives."
  for file in "$incoming/root.git.tar" "$incoming/api.git.tar" "$incoming/web.git.tar"; do
    [ -f "$file" ] && [ ! -L "$file" ] || block "an incoming repository archive is unsafe."
    identity="$(stat_value '%u:%g:%a:%h' "$file")"
    size="$(stat_value '%s' "$file")"
    [ "$identity" = '0:0:600:1' ] && [[ "$size" =~ ^[0-9]+$ ]] && \
      [ "$size" -gt 0 ] && [ "$size" -le 1073741824 ] || \
      block "an incoming repository archive has unsafe identity, mode, links, or size."
  done
}

git_clean() {
  /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C \
    GIT_OPTIONAL_LOCKS=0 GIT_NO_REPLACE_OBJECTS=1 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"
}

verify_checkout() {
  local repository="$1" expected="$2" label="$3"
  local top head status replacements
  [ -d "$repository/.git" ] && [ ! -L "$repository" ] && [ ! -L "$repository/.git" ] && \
    [ ! -e "$repository/.git/info/grafts" ] && \
    [ ! -e "$repository/.git/objects/info/alternates" ] && \
    [ ! -e "$repository/.git/objects/info/http-alternates" ] || \
    block "$label is not a standalone repository without Git substitution metadata."
  top="$(git_clean -C "$repository" rev-parse --show-toplevel 2>/dev/null || true)"
  head="$(git_clean -C "$repository" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
  status="$(git_clean -C "$repository" status --porcelain=v1 --untracked-files=all \
    --ignore-submodules=none 2>/dev/null || printf '__git_failed__')"
  replacements="$(git_clean -C "$repository" for-each-ref --format='%(refname)' \
    refs/replace 2>/dev/null || printf '__git_failed__')"
  [ "$top" = "$repository" ] && [ "$head" = "$expected" ] && \
    [ -z "$status" ] && [ -z "$replacements" ] || \
    block "$label is not the exact clean reviewed commit."
}

verify_assembly() {
  local root="$1" root_commit="$2" api_commit="$3" web_commit="$4" label="$5"
  verify_checkout "$root" "$root_commit" "$label Root"
  verify_checkout "$root/apps/api" "$api_commit" "$label API"
  verify_checkout "$root/apps/arenzyra-web" "$web_commit" "$label Web"
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
  verify_assembly "$checkout" "$target_root" "$target_api" "$target_web" 'target'
  verify_forward_component "$checkout" "$current_root" "$target_root" Root
  verify_forward_component "$checkout/apps/api" "$current_api" "$target_api" API
  verify_forward_component "$checkout/apps/arenzyra-web" "$current_web" "$target_web" Web
  printf 'REVIEWED SOURCE FORWARD HISTORY VERIFIED root=1 api=1 web=1\n'
}

run_bootstrap() {
  local phase="$1"
  /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C \
    ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    ARENZYRA_BOOTSTRAP_RELEASE_ID="$release_id" \
    ARENZYRA_REVIEWED_ROOT_COMMIT="$target_root" \
    ARENZYRA_REVIEWED_API_COMMIT="$target_api" \
    ARENZYRA_REVIEWED_WEB_COMMIT="$target_web" \
    ARENZYRA_ROOT_REPOSITORY_SHA256="$root_hash" \
    ARENZYRA_API_REPOSITORY_SHA256="$api_hash" \
    ARENZYRA_WEB_REPOSITORY_SHA256="$web_hash" \
    /bin/bash scripts/bootstrap-production-reviewed-checkout.sh "$phase"
}

run_current_inventory() {
  /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C \
    ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    /bin/bash scripts/production-current-release-inventory.sh
}

require_clean_parent
[ "$#" -eq 7 ] || block "release ID, three target commits, and three archive hashes are required."
release_id="$1"
target_root="$2"
target_api="$3"
target_web="$4"
root_hash="$5"
api_hash="$6"
web_hash="$7"
[[ "$release_id" =~ ^[a-zA-Z0-9._-]{8,128}$ ]] || block "release ID is invalid."
require_commit "$target_root" target-Root
require_commit "$target_api" target-API
require_commit "$target_web" target-Web
require_hash "$root_hash" Root
require_hash "$api_hash" API
require_hash "$web_hash" Web

current_root="${ARENZYRA_REVIEWED_ROOT_COMMIT:-}"
current_api="${ARENZYRA_REVIEWED_API_COMMIT:-}"
current_web="${ARENZYRA_REVIEWED_WEB_COMMIT:-}"
require_commit "$current_root" current-Root
require_commit "$current_api" current-API
require_commit "$current_web" current-Web

[ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = '1' ] || \
  block "the shared production deployment lock was not inherited."
inherit_deployment_lock() {
  # Sourcing from a zero-argument function preserves this script's activation
  # arguments while satisfying the lock helper's closed argument contract.
  # shellcheck source=scripts/acquire-production-deploy-lock.sh
  source scripts/acquire-production-deploy-lock.sh
}
inherit_deployment_lock
production_verify_lock_descriptor || block "the shared production deployment lock is not verified."

verify_assembly "$ROOT_PATH" "$current_root" "$current_api" "$current_web" current
require_safe_parent "$ROOT_PATH"
require_no_mounts "$ROOT_PATH"
require_incoming_transfer "$release_id"
require_safe_optional_parent "$STAGING_ROOT"
require_safe_optional_parent "$ARCHIVE_ROOT"
[ ! -e "$STAGING_ROOT/$release_id" ] && [ ! -L "$STAGING_ROOT/$release_id" ] && \
  [ ! -e "$ARCHIVE_ROOT/$release_id" ] && [ ! -L "$ARCHIVE_ROOT/$release_id" ] || \
  block "release staging or archive already exists."
run_current_inventory

run_bootstrap prepare
production_verify_lock_descriptor || block "the shared production deployment lock identity changed after prepare."
require_safe_parent "$STAGING_ROOT"
require_safe_parent "$ARCHIVE_ROOT"
require_no_mounts "$STAGING_ROOT"
require_no_mounts "$ARCHIVE_ROOT"
require_atomic_activation_filesystem
verify_forward_assembly
verify_assembly "$ROOT_PATH" "$current_root" "$current_api" "$current_web" current
require_safe_parent "$ROOT_PATH"
require_no_mounts "$ROOT_PATH"
run_current_inventory
production_verify_lock_descriptor || block "the shared production deployment lock identity changed before activation."
require_safe_parent "$ROOT_PATH"
require_no_mounts "$ROOT_PATH"

run_bootstrap activate
cd "$ROOT_PATH"
production_verify_lock_descriptor || block "the shared production deployment lock identity changed after activation."
verify_assembly "$ROOT_PATH" "$target_root" "$target_api" "$target_web" active
run_current_inventory
/usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C \
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
  /bin/bash scripts/production-source-inventory.sh "$release_id"
production_verify_lock_descriptor || block "the shared production deployment lock identity changed after inventory."
printf 'REVIEWED SOURCE ACTIVATION COMPLETE: release=%s prior-source=%s/%s\n' \
  "$release_id" "$ARCHIVE_ROOT" "$release_id"
