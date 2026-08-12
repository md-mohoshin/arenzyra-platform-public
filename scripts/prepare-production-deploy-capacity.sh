#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
CLEANUP_THRESHOLD_PERCENT=80
OLD_BUILD_CACHE_AGE="168h"

block() {
  printf 'DEPLOY CAPACITY PREPARATION BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 0 ] || block "no arguments are accepted."
[ "$REPOSITORY_ROOT" = "$EXPECTED_ROOT" ] || block "repository root is not exact."
[ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = "1" ] || \
  block "the reviewed production deployment lock was not inherited."

cd "$REPOSITORY_ROOT"
source scripts/require-local-production-docker.sh
source scripts/acquire-production-deploy-lock.sh

disk_used_percent() {
  local value
  value="$(df -P -- / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')"
  [[ "$value" =~ ^[0-9]+$ ]] && [ "$value" -le 100 ] || return 1
  printf '%s\n' "$value"
}

before="$(disk_used_percent)" || block "root disk usage could not be inspected."
if [ "$before" -lt "$CLEANUP_THRESHOLD_PERCENT" ]; then
  printf 'DEPLOY CAPACITY PREPARATION SKIPPED disk=%s%% threshold=%s%%\n' \
    "$before" "$CLEANUP_THRESHOLD_PERCENT"
  exit 0
fi

# The ordinary deployment preflight must pass before this proactive cleanup.
# In particular, a deployment already below the 30-GiB floor remains blocked;
# this helper must never turn a failed preflight into authority to delete data.
bash scripts/production-deploy-preflight.sh
production_verify_lock_descriptor || block "the shared deployment lock changed."

# Only dangling build cache older than seven days is eligible. This is
# regenerable build material, not an image, container, volume, log, backup, or
# customer/runtime file. The absence of -a deliberately preserves referenced
# cache records as well as every Docker image.
docker builder prune -f --filter "until=$OLD_BUILD_CACHE_AGE"

production_verify_lock_descriptor || block "the shared deployment lock changed after cache cleanup."
bash scripts/production-deploy-preflight.sh
after="$(disk_used_percent)" || block "post-cleanup root disk usage could not be inspected."
printf 'DEPLOY CAPACITY PREPARATION COMPLETE disk_before=%s%% disk_after=%s%% threshold=%s%% scope=old-dangling-build-cache\n' \
  "$before" "$after" "$CLEANUP_THRESHOLD_PERCENT"
if [ "$after" -ge "$CLEANUP_THRESHOLD_PERCENT" ]; then
  printf 'DEPLOY CAPACITY NOTICE: disk remains at or above 80%%; no backup, image, volume, log, or customer data was automatically removed.\n' >&2
fi
