#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_ROOT="/opt/arenzyra"
INCOMING_ROOT="/opt/arenzyra-release-incoming"
STAGING_ROOT="/opt/arenzyra-release-staging"
ARCHIVE_ROOT="/opt/arenzyra-source-archives"
SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

block() {
  printf 'PRODUCTION SOURCE INVENTORY BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$(id -u)" -eq 0 ] && [ "$(pwd -P)" = "$EXPECTED_ROOT" ] || \
  block "exact production invocation is required."
[ "$#" -ge 1 ] && [ "$#" -le 8 ] || \
  block "one to eight explicit source release IDs are required."

git_clean() {
  /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C \
    GIT_OPTIONAL_LOCKS=0 GIT_NO_REPLACE_OBJECTS=1 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"
}

verify_parent() {
  local path="$1" mode
  [ -d "$path" ] && [ ! -L "$path" ] && \
    [ "$(realpath -e -- "$path")" = "$path" ] && \
    [ "$(stat -c '%u:%g' -- "$path")" = "0:0" ] || \
    block "a source-inventory parent is unsafe."
  mode="$(stat -c %a -- "$path")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 )) || \
    block "a source-inventory parent is writable by an untrusted identity."
}

verify_no_mounts() {
  local path="$1"
  if findmnt -rn -o TARGET | awk -v path="$path" \
    '$0 == path || index($0, path "/") == 1 { found=1 } END { exit !found }'; then
    block "a source-inventory target contains a mounted filesystem."
  fi
}

checkout_commit() {
  local repository="$1" top head status replacements
  [ ! -L "$repository" ] && [ -d "$repository/.git" ] && \
    [ ! -L "$repository/.git" ] && \
    [ ! -e "$repository/.git/info/grafts" ] && \
    [ ! -L "$repository/.git/info/grafts" ] && \
    [ ! -e "$repository/.git/objects/info/alternates" ] && \
    [ ! -L "$repository/.git/objects/info/alternates" ] && \
    [ ! -e "$repository/.git/objects/info/http-alternates" ] && \
    [ ! -L "$repository/.git/objects/info/http-alternates" ] || \
    block "a source archive is not a standalone checkout."
  top="$(git_clean -C "$repository" rev-parse --show-toplevel 2>/dev/null || true)"
  head="$(git_clean -C "$repository" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
  status="$(git_clean -C "$repository" status --porcelain=v1 --untracked-files=all 2>/dev/null || printf __failed__)"
  replacements="$(git_clean -C "$repository" for-each-ref --format='%(refname)' refs/replace 2>/dev/null || printf __failed__)"
  [ "$top" = "$repository" ] && [[ "$head" =~ ^[0-9a-f]{40}$ ]] && \
    [ -z "$status" ] && [ -z "$replacements" ] || \
    block "a source archive is not an exact clean checkout."
  printf '%s' "$head"
}

transfer_state() {
  local release="$1" incoming staging incoming_names staging_names repository_names file path
  incoming="$INCOMING_ROOT/$release"
  staging="$STAGING_ROOT/$release"
  if [ ! -e "$incoming" ] && [ ! -e "$staging" ]; then
    printf 'absent'
    return
  fi
  [ ! -L "$incoming" ] && [ -d "$incoming" ] && \
    [ "$(realpath -e -- "$incoming")" = "$incoming" ] && \
    [ "$(stat -c '%u:%g' -- "$incoming")" = "0:0" ] && \
    [ ! -L "$staging" ] && [ -d "$staging" ] && \
    [ "$(realpath -e -- "$staging")" = "$staging" ] && \
    [ "$(stat -c '%u:%g' -- "$staging")" = "0:0" ] || \
    block "a source-transfer target is incomplete or unsafe."
  verify_no_mounts "$incoming"
  verify_no_mounts "$staging"
  incoming_names="$(find "$incoming" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
  [ "$incoming_names" = $'api.git.tar\nroot.git.tar\nweb.git.tar' ] || \
    block "an incoming source transfer contains unexpected entries."
  for file in "$incoming/api.git.tar" "$incoming/root.git.tar" "$incoming/web.git.tar"; do
    [ -f "$file" ] && [ ! -L "$file" ] && \
      [ "$(stat -c '%u:%g:%h' -- "$file")" = "0:0:1" ] || \
      block "an incoming source archive is unsafe."
  done
  staging_names="$(find "$staging" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
  [ "$staging_names" = repositories ] || \
    block "a completed source staging directory contains unexpected entries."
  [ ! -L "$staging/repositories" ] && [ -d "$staging/repositories" ] || \
    block "a source repository staging boundary is unsafe."
  repository_names="$(find "$staging/repositories" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
  [ "$repository_names" = $'api.git\nroot.git\nweb.git' ] || \
    block "a source repository staging directory contains unexpected entries."
  for path in "$staging/repositories/root.git" \
    "$staging/repositories/api.git" "$staging/repositories/web.git"; do
    [ ! -L "$path" ] && [ -d "$path" ] || \
      block "a staged source repository is unsafe."
  done
  printf 'present'
}

verify_parent "$INCOMING_ROOT"
verify_parent "$STAGING_ROOT"
verify_parent "$ARCHIVE_ROOT"

declare -a seen=()
for release in "$@"; do
  [[ "$release" =~ ^[a-zA-Z0-9._-]{8,128}$ ]] || \
    block "a source release ID is invalid."
  for prior in "${seen[@]:-}"; do
    [ "$release" != "$prior" ] || block "a source release ID is duplicated."
  done
  seen+=("$release")
  archive="$ARCHIVE_ROOT/$release"
  [ ! -L "$archive" ] && [ -d "$archive" ] && \
    [ "$(realpath -e -- "$archive")" = "$archive" ] && \
    [ "$(dirname -- "$archive")" = "$ARCHIVE_ROOT" ] && \
    [ "$(stat -c '%u:%g' -- "$archive")" = "0:0" ] || \
    block "a source archive target is unsafe or absent."
  verify_no_mounts "$archive"
  root_commit="$(checkout_commit "$archive")"
  api_commit="$(checkout_commit "$archive/apps/api")"
  web_commit="$(checkout_commit "$archive/apps/arenzyra-web")"
  archive_kib="$(du -sk -- "$archive" | awk '{ print $1 }')"
  [[ "$archive_kib" =~ ^[0-9]+$ ]] || block "a source archive size is invalid."
  transfer="$(transfer_state "$release")"
  printf 'SOURCE_INVENTORY release=%s root=%s api=%s web=%s archive_mib=%s transfer=%s\n' \
    "$release" "$root_commit" "$api_commit" "$web_commit" \
    "$((archive_kib / 1024))" "$transfer"
done
