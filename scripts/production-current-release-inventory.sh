#!/usr/bin/env bash
set -Eeuo pipefail

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EXPECTED_ROOT="/opt/arenzyra"
RELEASE_ROOT="/opt/arenzyra-release-metadata"

block() {
  printf 'PRODUCTION CURRENT RELEASE INVENTORY BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 0 ] || block "no arguments are accepted."
[ "$(id -u)" -eq 0 ] && [ "$(pwd -P)" = "$EXPECTED_ROOT" ] || \
  block "exact production invocation is required."
[ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = '1' ] || \
  block "the shared deployment lock was not inherited."

source scripts/acquire-production-deploy-lock.sh
production_verify_lock_descriptor || block "the shared deployment lock is not verified."

[ -d /opt ] && [ ! -L /opt ] && \
  [ "$(realpath -e -- /opt 2>/dev/null || true)" = /opt ] && \
  [ "$(stat -c '%u:%g' -- /opt 2>/dev/null || true)" = '0:0' ] || \
  block "the release metadata parent is unsafe."
opt_mode="$(stat -c %a -- /opt 2>/dev/null || true)"
[[ "$opt_mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$opt_mode & 8#022) == 0 )) || \
  block "the release metadata parent mode is unsafe."

[ -d "$RELEASE_ROOT" ] && [ ! -L "$RELEASE_ROOT" ] && \
  [ "$(realpath -e -- "$RELEASE_ROOT" 2>/dev/null || true)" = "$RELEASE_ROOT" ] && \
  [ "$(stat -c '%u:%g:%a' -- "$RELEASE_ROOT" 2>/dev/null || true)" = '0:0:700' ] || \
  block "the release metadata root is unsafe."

pointer="$RELEASE_ROOT/CURRENT"
[ -f "$pointer" ] && [ ! -L "$pointer" ] && \
  [ "$(stat -c '%u:%g:%a:%h' -- "$pointer" 2>/dev/null || true)" = '0:0:600:1' ] || \
  block "the CURRENT pointer is unsafe."
mapfile -t pointer_lines < "$pointer"
[ "${#pointer_lines[@]}" -eq 1 ] && \
  [[ "${pointer_lines[0]}" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || \
  block "the CURRENT pointer is invalid."
release_id="${pointer_lines[0]}"

release_file="$RELEASE_ROOT/$release_id.env"
[ -f "$release_file" ] && [ ! -L "$release_file" ] && \
  [ "$(dirname -- "$(realpath -e -- "$release_file" 2>/dev/null || true)")" = "$RELEASE_ROOT" ] && \
  [ "$(basename -- "$release_file")" = "$release_id.env" ] && \
  [ "$(stat -c '%u:%g:%a:%h' -- "$release_file" 2>/dev/null || true)" = '0:0:600:1' ] || \
  block "the archived current release file is unsafe."

sanitized=(/usr/bin/env -i PATH="$SAFE_PATH" HOME=/root LC_ALL=C)
"${sanitized[@]}" node scripts/validate-publish-release-env.cjs \
  --file "$release_file" --expected-release "$release_id" >/dev/null || \
  block "the archived current release metadata is invalid."

read_release_value() {
  "${sanitized[@]}" node scripts/read-dotenv-value.cjs "$release_file" "$1"
}

root_commit="$(read_release_value ARENZYRA_ROOT_GIT_COMMIT)"
api_commit="$(read_release_value ARENZYRA_API_GIT_COMMIT)"
web_commit="$(read_release_value ARENZYRA_WEB_GIT_COMMIT)"
[[ "$root_commit" =~ ^[0-9a-f]{12}$ ]] && \
  [[ "$api_commit" =~ ^[0-9a-f]{12}$ ]] && \
  [[ "$web_commit" =~ ^[0-9a-f]{12}$ ]] || \
  block "the archived current release commits are invalid."

production_verify_lock_descriptor || block "the shared deployment lock identity changed."
printf 'CURRENT_RELEASE_INVENTORY release=%s root=%s api=%s web=%s\n' \
  "$release_id" "$root_commit" "$api_commit" "$web_commit"
