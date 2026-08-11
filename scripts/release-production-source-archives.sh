#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_ROOT="/opt/arenzyra"
INCOMING_ROOT="/opt/arenzyra-release-incoming"
STAGING_ROOT="/opt/arenzyra-release-staging"
ARCHIVE_ROOT="/opt/arenzyra-source-archives"
SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

block() {
  printf 'PRODUCTION SOURCE RETENTION BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$(id -u)" -eq 0 ] && [ "$(pwd -P)" = "$EXPECTED_ROOT" ] || \
  block "exact production invocation is required."
NESTED_IDENTITIES=0
if [ "${1:-}" = "--nested" ]; then
  NESTED_IDENTITIES=1
  shift
  [ "$#" -ge 8 ] && [ "$#" -le 36 ] && [ $(( $# % 4 )) -eq 0 ] || \
    block "retained and superseded release/Root/API/Web groups are required."
else
  [ "$#" -ge 4 ] && [ "$#" -le 18 ] && [ $(( $# % 2 )) -eq 0 ] || \
    block "a retained pair and one to eight superseded pairs are required."
fi
source scripts/require-local-production-docker.sh

retained_release="$1"
retained_commit="$2"
if [ "$NESTED_IDENTITIES" -eq 1 ]; then
  retained_api_commit="$3"
  retained_web_commit="$4"
  shift 4
else
  retained_api_commit="$ARENZYRA_REVIEWED_API_COMMIT"
  retained_web_commit="$ARENZYRA_REVIEWED_WEB_COMMIT"
  shift 2
fi
[[ "$retained_release" =~ ^[a-zA-Z0-9._-]{8,128}$ ]] && \
  [[ "$retained_commit" =~ ^[0-9a-f]{40}$ ]] && \
  [[ "$retained_api_commit" =~ ^[0-9a-f]{40}$ ]] && \
  [[ "$retained_web_commit" =~ ^[0-9a-f]{40}$ ]] || \
  block "the retained source identity is invalid."
[[ "${ARENZYRA_REVIEWED_API_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] && \
  [[ "${ARENZYRA_REVIEWED_WEB_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] || \
  block "reviewed nested source identities are unavailable."

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
    block "a source-retention parent is unsafe."
  mode="$(stat -c %a -- "$path")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 )) || \
    block "a source-retention parent is writable by an untrusted identity."
}

verify_no_mounts() {
  local path="$1"
  if findmnt -rn -o TARGET | awk -v path="$path" \
    '$0 == path || index($0, path "/") == 1 { found=1 } END { exit !found }'; then
    block "a deletion target contains a mounted filesystem."
  fi
}

verify_checkout() {
  local repository="$1" expected="$2" top head status replacements
  [ -d "$repository/.git" ] && [ ! -L "$repository" ] && \
    [ ! -L "$repository/.git" ] || \
    block "a retained source is not a standalone checkout."
  top="$(git_clean -C "$repository" rev-parse --show-toplevel 2>/dev/null || true)"
  head="$(git_clean -C "$repository" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
  status="$(git_clean -C "$repository" status --porcelain=v1 --untracked-files=all 2>/dev/null || printf __failed__)"
  replacements="$(git_clean -C "$repository" for-each-ref --format='%(refname)' refs/replace 2>/dev/null || printf __failed__)"
  [ "$top" = "$repository" ] && [ "$head" = "$expected" ] && \
    [ -z "$status" ] && [ -z "$replacements" ] || \
    block "a source archive is not the exact clean expected commit."
}

verify_archive() {
  local release expected expected_api expected_web path
  release="$1"
  expected="$2"
  expected_api="$3"
  expected_web="$4"
  path="$ARCHIVE_ROOT/$release"
  [ ! -L "$path" ] && [ -d "$path" ] && \
    [ "$(realpath -e -- "$path")" = "$path" ] && \
    [ "$(dirname -- "$path")" = "$ARCHIVE_ROOT" ] && \
    [ "$(stat -c '%u:%g' -- "$path")" = "0:0" ] || \
    block "a source archive target is unsafe."
  verify_no_mounts "$path"
  verify_checkout "$path" "$expected"
  verify_checkout "$path/apps/api" "$expected_api"
  verify_checkout "$path/apps/arenzyra-web" "$expected_web"
}

verify_transfer_copy() {
  local release incoming staging
  local incoming_names staging_names repository_names file path
  release="$1"
  incoming="$INCOMING_ROOT/$release"
  staging="$STAGING_ROOT/$release"
  for path in "$incoming" "$staging"; do
    [ ! -L "$path" ] && [ -d "$path" ] && \
      [ "$(realpath -e -- "$path")" = "$path" ] && \
      [ "$(stat -c '%u:%g' -- "$path")" = "0:0" ] || \
      block "a source-transfer target is unsafe."
    verify_no_mounts "$path"
  done
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
}

verify_parent "$INCOMING_ROOT"
verify_parent "$STAGING_ROOT"
verify_parent "$ARCHIVE_ROOT"
verify_archive "$retained_release" "$retained_commit" \
  "$retained_api_commit" "$retained_web_commit"

declare -a release_ids=()
while [ "$#" -gt 0 ]; do
  release="$1"
  commit="$2"
  if [ "$NESTED_IDENTITIES" -eq 1 ]; then
    api_commit="$3"
    web_commit="$4"
    shift 4
  else
    api_commit="$ARENZYRA_REVIEWED_API_COMMIT"
    web_commit="$ARENZYRA_REVIEWED_WEB_COMMIT"
    shift 2
  fi
  [[ "$release" =~ ^[a-zA-Z0-9._-]{8,128}$ ]] && \
    [[ "$commit" =~ ^[0-9a-f]{40}$ ]] && \
    [[ "$api_commit" =~ ^[0-9a-f]{40}$ ]] && \
    [[ "$web_commit" =~ ^[0-9a-f]{40}$ ]] && \
    [ "$release" != "$retained_release" ] || \
    block "a superseded source identity is invalid."
  for seen in "${release_ids[@]:-}"; do
    [ "$release" != "$seen" ] || \
      block "a superseded source identity is duplicated."
  done
  verify_archive "$release" "$commit" "$api_commit" "$web_commit"
  verify_transfer_copy "$release"
  release_ids+=("$release")
done

# This read-only gate is intentionally adjacent to the exact source-only
# deletion and still reports the deployment as blocked until space is freed.
bash scripts/production-deploy-preflight.sh --allow-low-disk-source-release

released_kib=0
for release in "${release_ids[@]}"; do
  archive="$ARCHIVE_ROOT/$release"
  staging="$STAGING_ROOT/$release"
  incoming="$INCOMING_ROOT/$release"
  target_kib="$(du -sk -- "$archive" "$staging" "$incoming" | awk '{ total += $1 } END { print total }')"
  [[ "$target_kib" =~ ^[0-9]+$ ]] || \
    block "a source-retention size is invalid."
  rm -rf -- "$archive" "$staging" "$incoming"
  [ ! -e "$archive" ] && [ ! -e "$staging" ] && [ ! -e "$incoming" ] || \
    block "a superseded source copy could not be completely released."
  released_kib=$((released_kib + target_kib))
done

verify_archive "$retained_release" "$retained_commit" \
  "$retained_api_commit" "$retained_web_commit"
printf 'PRODUCTION SOURCE RETENTION COMPLETE released_sets=%s released_mib=%s retained=%s\n' \
  "${#release_ids[@]}" "$((released_kib / 1024))" "$retained_release"
