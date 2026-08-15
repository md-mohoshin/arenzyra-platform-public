#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
EXPECTED_ROOT="/opt/arenzyra"
EXPECTED_CANDIDATE_RELEASE="git-20260815-131200234-84099e4622e9"
MIN_FREE_KIB=$((30 * 1024 * 1024))
mutation_attempted=0

block() {
  printf 'INTERRUPTED FULL DEPLOY RESUME BLOCKED: %s\n' "$1" >&2
  if [ "$mutation_attempted" -eq 0 ]; then
    printf 'No builder-cache or deployment mutation was attempted.\n' >&2
  else
    printf 'The one reviewed builder-cache prune was attempted; deployment was not started.\n' >&2
  fi
  exit 75
}

[ "$#" -eq 0 ] || block "no arguments are accepted."
[ "$(id -u)" -eq 0 ] || block "UID 0 is required."
cd "$EXPECTED_ROOT" 2>/dev/null || block "the production root is unavailable."
[ "$(pwd -P)" = "$EXPECTED_ROOT" ] || block "the production root is not exact."
[ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = "1" ] || \
  block "the shared deployment lock was not inherited."
[ -f /run/arenzyra-production-deploy.lock ] && \
  [ ! -L /run/arenzyra-production-deploy.lock ] || \
  block "the shared deployment lock path is unavailable."
command -v flock >/dev/null 2>&1 || block "required command is unavailable: flock."
# Prove the lock is already held before sourcing the generic helper. Calling
# flock on inherited descriptor 8 alone could acquire an unlocked descriptor
# and conceal a continuity gap.
if ( exec 7<>/run/arenzyra-production-deploy.lock || exit 74; flock -n -E 42 7 ); then
  block "the shared deployment lock was not already held continuously."
else
  lock_probe_status=$?
fi
[ "$lock_probe_status" -eq 42 ] || block "the shared deployment lock probe failed."

source scripts/acquire-production-deploy-lock.sh || \
  block "the shared deployment lock helper is unavailable."
production_verify_lock_descriptor || block "the shared deployment lock is not verified."
source scripts/require-local-production-docker.sh || \
  block "the production Docker target is not reviewed."

verify_continuous_lock() {
  local probe_status
  production_verify_lock_descriptor || return 75
  if ( exec 7<>/run/arenzyra-production-deploy.lock || exit 74; flock -n -E 42 7 ); then
    return 75
  else
    probe_status=$?
  fi
  [ "$probe_status" -eq 42 ]
}

for required_command in awk df docker id node; do
  command -v "$required_command" >/dev/null 2>&1 || \
    block "required command is unavailable: $required_command."
done

sanitized=(/usr/bin/env -i "PATH=$SAFE_PATH" HOME=/root LC_ALL=C)

read_root_free_kib() {
  local output filesystem blocks used available capacity mounted extra
  local -a lines=()
  if ! output="$(df -Pk -- / 2>/dev/null)"; then
    block "root free-space inspection failed."
  fi
  if ! mapfile -t lines <<<"$output"; then
    block "root free-space output could not be parsed."
  fi
  [ "${#lines[@]}" -eq 2 ] || block "root free-space output is not exact."
  read -r filesystem blocks used available capacity mounted extra <<<"${lines[1]}"
  [[ "$blocks" =~ ^[0-9]+$ ]] && [[ "$used" =~ ^[0-9]+$ ]] && \
    [[ "$available" =~ ^[0-9]+$ ]] && [[ "$capacity" =~ ^[0-9]+%$ ]] && \
    [ "$mounted" = / ] && [ -z "$extra" ] || block "root free-space output is invalid."
  printf '%s' "$available"
}

exact_inventory_snapshot() {
  local raw verified body
  if ! raw="$(/bin/bash scripts/production-interrupted-deploy-inventory.sh)"; then
    block "the locked interrupted-deploy inventory failed."
  fi
  [ -n "$raw" ] && [[ "$raw" == *$'\n'* ]] || \
    block "the interrupted-deploy inventory output is incomplete."
  if ! verified="$(printf '%s\n' "$raw" | \
    "${sanitized[@]}" node scripts/verify-interrupted-full-resume-inventory.cjs)"; then
    block "the interrupted-deploy inventory is not the exact resumable candidate."
  fi
  [ "$verified" = "INTERRUPTED FULL RESUME INVENTORY VERIFIED release=$EXPECTED_CANDIDATE_RELEASE" ] || \
    block "the interrupted-deploy inventory verifier output is invalid."
  body="${raw#*$'\n'}"
  [ -n "$body" ] && [ "$body" != "$raw" ] || \
    block "the interrupted-deploy inventory fingerprint is empty."
  # Free space is checked independently at every boundary. The remaining exact
  # lines bind source, pointers, environment, candidate manifests/images, and
  # every current runtime container without accepting free-space-only drift.
  printf '%s\n' "$body"
}

verify_continuous_lock || block "the shared deployment lock identity changed."
if ! /bin/bash scripts/production-deploy-preflight.sh \
  --allow-low-disk-builder-cache-release; then
  block "the low-disk ordinary environment, volume, and health preflight failed."
fi
if ! baseline_inventory="$(exact_inventory_snapshot)" || \
  ! before_free_kib="$(read_root_free_kib)"; then
  block "the initial exact resume snapshot failed."
fi
[ -n "$baseline_inventory" ] && [[ "$before_free_kib" =~ ^[0-9]+$ ]] || \
  block "the initial exact resume snapshot is invalid."
[ "$before_free_kib" -lt "$MIN_FREE_KIB" ] || \
  block "free space is not below the exact 30 GiB eligibility threshold."

if ! builder_prune_help="$(docker builder prune --help 2>/dev/null)"; then
  block "Docker builder-prune help inspection failed."
fi
if ! reserve_flag="$(printf '%s\n' "$builder_prune_help" | \
  "${sanitized[@]}" node scripts/select-production-builder-prune-reserve-flag.cjs \
  2>/dev/null)"; then
  block "Docker builder-prune reserve-flag selection failed."
fi
case "$reserve_flag" in
  --reserved-space|--keep-storage) ;;
  *) block "Docker exposes no reviewed zero-reserve builder-prune flag." ;;
esac

verify_continuous_lock || \
  block "the shared deployment lock identity changed before prune."
if ! pre_prune_inventory="$(exact_inventory_snapshot)" || \
  ! pre_prune_free_kib="$(read_root_free_kib)"; then
  block "the exact resume recheck failed before prune."
fi
[ "$pre_prune_inventory" = "$baseline_inventory" ] || \
  block "source, release evidence, candidate images, or runtime drifted before prune."
[[ "$pre_prune_free_kib" =~ ^[0-9]+$ ]] && \
  [ "$pre_prune_free_kib" -lt "$MIN_FREE_KIB" ] || \
  block "free space crossed the eligibility threshold before prune."

mutation_attempted=1
prune_status=0
docker builder prune -af "$reserve_flag" "0B" || prune_status=$?

verify_continuous_lock || \
  block "the shared deployment lock identity changed after prune."
if ! post_prune_inventory="$(exact_inventory_snapshot)" || \
  ! after_free_kib="$(read_root_free_kib)"; then
  block "the exact resume recheck failed after prune."
fi
[ "$post_prune_inventory" = "$baseline_inventory" ] || \
  block "source, release evidence, candidate images, or runtime changed after prune."
[ "$prune_status" -eq 0 ] || block "Docker reported that the reviewed builder prune failed."
[[ "$after_free_kib" =~ ^[0-9]+$ ]] && \
  [ "$after_free_kib" -ge "$MIN_FREE_KIB" ] || \
  block "builder cache was pruned but root free space remains below 30 GiB."

if ! /bin/bash scripts/production-deploy-preflight.sh; then
  block "the ordinary post-prune production preflight failed."
fi
verify_continuous_lock || \
  block "the shared deployment lock identity changed after preflight."
if ! final_inventory="$(exact_inventory_snapshot)" || \
  ! final_free_kib="$(read_root_free_kib)"; then
  block "the final exact resume snapshot failed."
fi
[ "$final_inventory" = "$baseline_inventory" ] || \
  block "source, release evidence, candidate images, or runtime drifted before deployment."
[[ "$final_free_kib" =~ ^[0-9]+$ ]] && \
  [ "$final_free_kib" -ge "$MIN_FREE_KIB" ] || \
  block "root free space fell below 30 GiB before deployment."

printf 'INTERRUPTED FULL DEPLOY RESUME PREREQUISITES COMPLETE release=%s before_kib=%s after_kib=%s reserve_flag=%s reserve=0B\n' \
  "$EXPECTED_CANDIDATE_RELEASE" "$before_free_kib" "$final_free_kib" "$reserve_flag"
verify_continuous_lock || \
  block "the shared deployment lock identity changed before deployment."
exec /bin/bash scripts/deploy-production.sh --interrupted-full-deploy-resume
