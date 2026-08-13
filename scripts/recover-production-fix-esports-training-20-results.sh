#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
EXPECTED_ROOT="/opt/arenzyra"
ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
COMPOSE_FILE="$EXPECTED_ROOT/infra/docker-compose.publish.yml"

block() {
  printf 'FIX ESPORTS RESULT RECOVERY BLOCKED: %s\n' "$1" >&2
  exit 75
}

reuse_verified_backup_id=''
if [ "$#" -eq 1 ]; then
  case "$1" in
    20-check|20-apply|23-check|23-apply) ;;
    *) block "exactly 20-check, 20-apply, 23-check, or 23-apply is required." ;;
  esac
  mode="$1"
elif [ "$#" -eq 2 ] && [ "$1" = 'both-apply-verified-backup' ] && \
  [[ "$2" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]]; then
  mode="$1"
  reuse_verified_backup_id="$2"
else
  block "expected one recovery mode or both-apply-verified-backup with one backup ID."
fi
series="${mode%%-*}"
[ "$(id -u)" -eq 0 ] || block "UID 0 is required."
[ "$(pwd -P)" = "$EXPECTED_ROOT" ] || block "production root is not exact."
source scripts/require-local-production-docker.sh
set --
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source scripts/acquire-production-deploy-lock.sh

[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || block "publish env is missing or linked."
[ -f "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] || block "publish Compose file is missing or linked."
reviewed_project="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
[[ "$reviewed_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || block "Compose project is invalid."
compose=(
  env -i "PATH=$SAFE_PATH" HOME=/root "DOCKER_HOST=$DOCKER_HOST"
  docker compose -p "$reviewed_project" --env-file "$ENV_FILE"
)
[ ! -f infra/.env.release ] || compose+=(--env-file infra/.env.release)
compose+=(-f "$COMPOSE_FILE" --profile discord-bot)

run_recovery() {
  "${compose[@]}" exec -T discord-bot \
    node dist/scripts/recover-fix-esports-training-20-results.js "--$1"
}

verify_reused_backup() {
  local backup_id="$1" backup_root backup_dir backup_remote artifact artifact_path
  local artifact_identity now_epoch marker marker_epoch
  backup_root="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_ROOT)"
  [ -n "$backup_root" ] || backup_root="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_BACKUP_ROOT)"
  backup_root="$(realpath -e -- "${backup_root:-/opt/arenzyra-backups}")"
  backup_dir="$(realpath -e -- "$backup_root/$backup_id")"
  [ "$(dirname -- "$backup_dir")" = "$backup_root" ] && \
    [ "$(basename -- "$backup_dir")" = "$backup_id" ] && \
    [ "$(stat -Lc '%u:%g:%a' -- "$backup_dir" 2>/dev/null || true)" = '0:0:700' ] || \
    block "verified backup path or permissions differ."
  required_artifacts=(
    BACKUP_COMPLETE OFFSITE_VERIFIED database.dump.age database-globals.sql.age
    metadata.txt.age manifest.sha256.age volume-api-storage.tar.gz.age
    volume-api-uploads.tar.gz.age
  )
  for artifact in "${required_artifacts[@]}"; do
    artifact_identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$backup_dir/$artifact" 2>/dev/null || true)"
    [ -f "$backup_dir/$artifact" ] && [ ! -L "$backup_dir/$artifact" ] && \
      [[ "$artifact_identity" =~ ^0:0:600:1:[1-9][0-9]*$ ]] || \
      block "verified backup artifact is unsafe or missing."
  done
  shopt -s nullglob dotglob
  backup_children=("$backup_dir"/*)
  shopt -u dotglob nullglob
  for artifact_path in "${backup_children[@]}"; do
    artifact="${artifact_path##*/}"
    case "$artifact" in
      BACKUP_COMPLETE|OFFSITE_VERIFIED|database.dump.age|database-globals.sql.age|manifest.sha256.age|metadata.txt.age|volume-api-storage.tar.gz.age|volume-api-uploads.tar.gz.age|volume-redis-data.tar.gz.age|volume-caddy-data.tar.gz.age|volume-caddy-config.tar.gz.age|volume-discord-bot-state.tar.gz.age) ;;
      *) block "verified backup contains an unsupported artifact." ;;
    esac
  done
  [ "$(wc -l < "$backup_dir/BACKUP_COMPLETE")" -eq 3 ] && \
    [ "$(grep -Fxc -- "backup_id=$backup_id" "$backup_dir/BACKUP_COMPLETE")" -eq 1 ] && \
    [ "$(grep -Ec '^created_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$backup_dir/BACKUP_COMPLETE")" -eq 1 ] && \
    [ "$(grep -Fxc -- 'reason=scheduled' "$backup_dir/BACKUP_COMPLETE")" -eq 1 ] || \
    block "verified backup completion marker is invalid."
  backup_remote="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_RCLONE_REMOTE)"
  [ -n "$backup_remote" ] || backup_remote="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_BACKUP_RCLONE_REMOTE)"
  [ -n "$backup_remote" ] && [ "$(wc -l < "$backup_dir/OFFSITE_VERIFIED")" -eq 2 ] && \
    [ "$(grep -Ec '^verified_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$backup_dir/OFFSITE_VERIFIED")" -eq 1 ] && \
    [ "$(grep -Fxc -- "remote=${backup_remote%/}/$backup_id" "$backup_dir/OFFSITE_VERIFIED")" -eq 1 ] || \
    block "verified backup off-site marker is invalid."
  now_epoch="$(date +%s)"
  for marker in BACKUP_COMPLETE OFFSITE_VERIFIED; do
    marker_epoch="$(stat -c %Y -- "$backup_dir/$marker")"
    [[ "$marker_epoch" =~ ^[0-9]+$ ]] && [ "$marker_epoch" -le "$now_epoch" ] && \
      [ $(( now_epoch - marker_epoch )) -le 7200 ] || \
      block "verified backup marker is older than two hours."
  done
  printf 'FIX ESPORTS RESULT RECOVERY BACKUP REUSE VERIFIED id=%s\n' "$backup_id"
}

if [ "$mode" = 'both-apply-verified-backup' ]; then
  run_recovery 20-check
  run_recovery 23-check
  verify_reused_backup "$reuse_verified_backup_id"
  /bin/bash scripts/production-deploy-preflight.sh
  run_recovery 20-apply
  /bin/bash scripts/production-deploy-preflight.sh
  run_recovery 23-apply
  exit 0
fi

run_recovery "$series-check"
[[ "$mode" == *-apply ]] || exit 0

# Result writes are protected by a fresh immutable off-site recovery point.
# The backup script inherits this operation's production deployment lock.
/usr/bin/env ARENZYRA_BACKUP_REQUIRE_OFFSITE=1 \
  /bin/bash scripts/production-backup.sh
# The backup itself consumes local disk. Re-run the ordinary production gate
# immediately before the recovery write phase in this same locked session.
/bin/bash scripts/production-deploy-preflight.sh
run_recovery "$mode"
