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
  printf 'REVIEWED CHECKOUT BOOTSTRAP BLOCKED: %s\n' "$1" >&2
  exit 75
}

require_clean_parent() {
  [ "$(id -u)" -eq 0 ] || block "UID 0 is required."
  [ -z "${BASH_ENV:-}${ENV:-}${NODE_OPTIONS:-}${NODE_PATH:-}" ] || \
    block "ambient shell or Node injection variables are set."
  while IFS='=' read -r name _; do
    case "$name" in GIT_*) block "ambient Git variables are set." ;; esac
  done < <(/usr/bin/env)
  [ -x /usr/bin/flock ] && [ -x /usr/bin/git ] && [ -x /usr/bin/sha256sum ] && \
    [ -x /usr/bin/tar ] || \
    block "reviewed system tools are unavailable."
}

require_inherited_deployment_lock() {
  local lock_file='/run/arenzyra-production-deploy.lock'
  local target owner mode file_identity descriptor_identity
  [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = '1' ] || \
    block "the shared production deployment lock was not inherited."
  [ -f "$lock_file" ] && [ ! -L "$lock_file" ] || \
    block "the shared production deployment lock path is unsafe."
  target="$(readlink -f /proc/$$/fd/8 2>/dev/null || true)"
  owner="$(stat -Lc %u /proc/$$/fd/8 2>/dev/null || true)"
  mode="$(stat -Lc %a /proc/$$/fd/8 2>/dev/null || true)"
  file_identity="$(stat -Lc '%d:%i:%h' "$lock_file" 2>/dev/null || true)"
  descriptor_identity="$(stat -Lc '%d:%i:%h' /proc/$$/fd/8 2>/dev/null || true)"
  [ "$target" = "$lock_file" ] && [ "$owner" = '0' ] && \
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 )) && \
    [ "$file_identity" = "$descriptor_identity" ] && \
    [ "${file_identity##*:}" = '1' ] && /usr/bin/flock -n 8 || \
    block "the inherited production deployment lock could not be verified."
}

require_release_inputs() {
  [[ "${ARENZYRA_BOOTSTRAP_RELEASE_ID:-}" =~ ^[a-zA-Z0-9._-]{8,128}$ ]] || \
    block "release ID is missing or invalid."
  for variable in \
    ARENZYRA_REVIEWED_ROOT_COMMIT ARENZYRA_REVIEWED_API_COMMIT \
    ARENZYRA_REVIEWED_WEB_COMMIT ARENZYRA_ROOT_REPOSITORY_SHA256 \
    ARENZYRA_API_REPOSITORY_SHA256 ARENZYRA_WEB_REPOSITORY_SHA256; do
    [[ "${!variable:-}" =~ ^[0-9a-f]{40}$|^[0-9a-f]{64}$ ]] || \
      block "$variable is missing or invalid."
  done
  [[ "$ARENZYRA_REVIEWED_ROOT_COMMIT" =~ ^[0-9a-f]{40}$ ]] || block "Root commit is invalid."
  [[ "$ARENZYRA_REVIEWED_API_COMMIT" =~ ^[0-9a-f]{40}$ ]] || block "API commit is invalid."
  [[ "$ARENZYRA_REVIEWED_WEB_COMMIT" =~ ^[0-9a-f]{40}$ ]] || block "Web commit is invalid."
  [[ "$ARENZYRA_ROOT_REPOSITORY_SHA256" =~ ^[0-9a-f]{64}$ ]] || block "Root archive hash is invalid."
  [[ "$ARENZYRA_API_REPOSITORY_SHA256" =~ ^[0-9a-f]{64}$ ]] || block "API archive hash is invalid."
  [[ "$ARENZYRA_WEB_REPOSITORY_SHA256" =~ ^[0-9a-f]{64}$ ]] || block "Web archive hash is invalid."
}

stat_value() {
  /usr/bin/stat -c "$1" -- "$2" 2>/dev/null || true
}

require_regular_single_link_root_file() {
  local path="$1" maximum_bytes="$2" mode uid gid links size
  [ -f "$path" ] && [ ! -L "$path" ] || block "$path is not a regular file."
  mode="$(stat_value '%a' "$path")"
  uid="$(stat_value '%u' "$path")"
  gid="$(stat_value '%g' "$path")"
  links="$(stat_value '%h' "$path")"
  size="$(stat_value '%s' "$path")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && [[ "$uid" = 0 ]] && [[ "$gid" = 0 ]] && \
    [[ "$links" = 1 ]] && [[ "$size" =~ ^[0-9]+$ ]] && \
    [ "$size" -gt 0 ] && [ "$size" -le "$maximum_bytes" ] || \
    block "$path has unsafe identity, permissions, link count, or size."
  (( (8#$mode & 8#022) == 0 )) || block "$path is group/world writable."
}

git_clean() {
  /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C \
    GIT_OPTIONAL_LOCKS=0 GIT_NO_REPLACE_OBJECTS=1 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"
}

verify_checkout() {
  local repository="$1" expected="$2" top head status replacements
  [ -d "$repository/.git" ] && [ ! -L "$repository" ] && [ ! -L "$repository/.git" ] || \
    block "$repository is not a standalone Git checkout."
  top="$(git_clean -C "$repository" rev-parse --show-toplevel 2>/dev/null || true)"
  head="$(git_clean -C "$repository" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
  status="$(git_clean -C "$repository" status --porcelain=v1 --untracked-files=all 2>/dev/null || printf '__git_failed__')"
  replacements="$(git_clean -C "$repository" for-each-ref --format='%(refname)' refs/replace 2>/dev/null || printf '__git_failed__')"
  [ "$top" = "$repository" ] && [ "$head" = "$expected" ] && \
    [ -z "$status" ] && [ -z "$replacements" ] || \
    block "$repository is not the exact clean reviewed commit."
}

verify_assembly() {
  local checkout="$1"
  verify_checkout "$checkout" "$ARENZYRA_REVIEWED_ROOT_COMMIT"
  verify_checkout "$checkout/apps/api" "$ARENZYRA_REVIEWED_API_COMMIT"
  verify_checkout "$checkout/apps/arenzyra-web" "$ARENZYRA_REVIEWED_WEB_COMMIT"
  require_regular_single_link_root_file "$checkout/infra/.env.publish" 1048576
}

prepare() {
  local release="$ARENZYRA_BOOTSTRAP_RELEASE_ID" incoming work checkout env_source
  incoming="$INCOMING_ROOT/$release"
  work="$STAGING_ROOT/$release"
  checkout="$work/checkout"
  env_source="$ROOT_PATH/infra/.env.publish"
  [ -d "$ROOT_PATH" ] && [ ! -L "$ROOT_PATH" ] || block "current production root is unsafe."
  require_regular_single_link_root_file "$env_source" 1048576
  [ ! -e "$work" ] && [ ! -e "$ARCHIVE_ROOT/$release" ] || block "release staging or archive already exists."
  for name in root api web; do
    require_regular_single_link_root_file "$incoming/$name.git.tar" 1073741824
  done
  printf '%s  %s\n' "$ARENZYRA_ROOT_REPOSITORY_SHA256" "$incoming/root.git.tar" |
    /usr/bin/sha256sum -c - >/dev/null || block "Root repository archive hash mismatch."
  printf '%s  %s\n' "$ARENZYRA_API_REPOSITORY_SHA256" "$incoming/api.git.tar" |
    /usr/bin/sha256sum -c - >/dev/null || block "API repository archive hash mismatch."
  printf '%s  %s\n' "$ARENZYRA_WEB_REPOSITORY_SHA256" "$incoming/web.git.tar" |
    /usr/bin/sha256sum -c - >/dev/null || block "Web repository archive hash mismatch."

  /usr/bin/install -d -m 0700 "$STAGING_ROOT" "$ARCHIVE_ROOT" "$work" "$work/repositories"
  for name in root api web; do
    /usr/bin/install -d -m 0700 "$work/repositories/$name.git"
    /usr/bin/tar --no-same-owner --no-same-permissions -xf "$incoming/$name.git.tar" \
      -C "$work/repositories/$name.git"
  done
  git_clean clone --no-local "$work/repositories/root.git" "$checkout" >/dev/null
  git_clean -C "$checkout" checkout --detach "$ARENZYRA_REVIEWED_ROOT_COMMIT" >/dev/null
  [ ! -e "$checkout/apps/api" ] && [ ! -e "$checkout/apps/arenzyra-web" ] || \
    block "Root checkout unexpectedly contains nested repositories."
  /usr/bin/install -d -m 0755 "$checkout/apps"
  git_clean clone --no-local "$work/repositories/api.git" "$checkout/apps/api" >/dev/null
  git_clean -C "$checkout/apps/api" checkout --detach "$ARENZYRA_REVIEWED_API_COMMIT" >/dev/null
  git_clean clone --no-local "$work/repositories/web.git" "$checkout/apps/arenzyra-web" >/dev/null
  git_clean -C "$checkout/apps/arenzyra-web" checkout --detach "$ARENZYRA_REVIEWED_WEB_COMMIT" >/dev/null
  /usr/bin/install -m 0600 "$env_source" "$checkout/infra/.env.publish"
  verify_assembly "$checkout"
  printf 'REVIEWED CHECKOUT PREPARED: %s\n' "$checkout"
}

activate() {
  local release="$ARENZYRA_BOOTSTRAP_RELEASE_ID" work checkout archive root_device staging_device
  work="$STAGING_ROOT/$release"
  checkout="$work/checkout"
  archive="$ARCHIVE_ROOT/$release"
  verify_assembly "$checkout"
  [ -d "$ROOT_PATH" ] && [ ! -L "$ROOT_PATH" ] && [ ! -e "$archive" ] || \
    block "activation source or archive target is unsafe."
  root_device="$(stat_value '%d' "$ROOT_PATH")"
  staging_device="$(stat_value '%d' "$checkout")"
  [ -n "$root_device" ] && [ "$root_device" = "$staging_device" ] || \
    block "activation is not an atomic same-filesystem move."
  /usr/bin/mv -- "$ROOT_PATH" "$archive"
  if ! /usr/bin/mv -- "$checkout" "$ROOT_PATH"; then
    /usr/bin/mv -- "$archive" "$ROOT_PATH" || true
    block "activation failed; the prior source was restored if possible."
  fi
  verify_assembly "$ROOT_PATH"
  printf 'REVIEWED CHECKOUT ACTIVATED: %s; prior source preserved at %s\n' "$ROOT_PATH" "$archive"
}

require_clean_parent
require_release_inputs
require_inherited_deployment_lock
case "${1:-}" in
  prepare) [ "$#" -eq 1 ] || block "prepare accepts no extra arguments."; prepare ;;
  activate) [ "$#" -eq 1 ] || block "activate accepts no extra arguments."; activate ;;
  *) block "expected prepare or activate." ;;
esac
