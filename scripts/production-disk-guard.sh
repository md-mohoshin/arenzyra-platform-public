#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
if [ "$REPOSITORY_ROOT" != "/opt/arenzyra" ]; then
  printf 'PRODUCTION DISK GUARD BLOCKED: repository root must be /opt/arenzyra.\n' >&2
  exit 75
fi
if [ -n "${ARENZYRA_DISK_GUARD_ENV_FILE:-}" ]; then
  printf 'PRODUCTION DISK GUARD BLOCKED: shell-sourced environment files are unsupported.\n' >&2
  exit 75
fi
cd "$REPOSITORY_ROOT"
source "$SCRIPT_DIR/require-local-production-docker.sh"
PUBLISH_ENV_FILE="$REPOSITORY_ROOT/infra/.env.publish"
test -f "$PUBLISH_ENV_FILE"
reviewed_compose_project="$(
  node scripts/read-dotenv-value.cjs "$PUBLISH_ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT
)"
if [ -n "${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-}" ] &&
  [ "$ARENZYRA_DEPLOY_COMPOSE_PROJECT" != "$reviewed_compose_project" ]; then
  printf 'PRODUCTION DISK GUARD BLOCKED: Compose project differs from the reviewed production environment.\n' >&2
  exit 75
fi
if ! [[ "$reviewed_compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  printf 'PRODUCTION DISK GUARD BLOCKED: invalid reviewed Compose project.\n' >&2
  exit 75
fi

DISK_PATH="${ARENZYRA_DISK_PATH:-/}"
WARN_PERCENT="${ARENZYRA_DISK_WARN_PERCENT:-75}"
CLEAN_PERCENT="${ARENZYRA_DISK_CLEAN_PERCENT:-80}"
CRITICAL_PERCENT="${ARENZYRA_DISK_CRITICAL_PERCENT:-90}"
DOCKER_BUILD_CACHE_UNTIL="${ARENZYRA_DOCKER_BUILD_CACHE_UNTIL:-168h}"
DOCKER_IMAGE_UNTIL="${ARENZYRA_DOCKER_IMAGE_UNTIL:-336h}"
DOCKER_CONTAINER_UNTIL="${ARENZYRA_DOCKER_CONTAINER_UNTIL:-168h}"
DEPLOY_BACKUP_RETENTION_DAYS="${ARENZYRA_DEPLOY_BACKUP_RETENTION_DAYS:-45}"
JOURNAL_VACUUM_SIZE="${ARENZYRA_JOURNAL_VACUUM_SIZE:-1G}"
COMPOSE_PROJECT="$reviewed_compose_project"
ALLOW_GLOBAL_DOCKER_PRUNE="${ARENZYRA_DISK_GUARD_ALLOW_GLOBAL_DOCKER_PRUNE:-0}"
ALLOW_GLOBAL_JOURNAL_VACUUM="${ARENZYRA_DISK_GUARD_ALLOW_GLOBAL_JOURNAL_VACUUM:-0}"
ALLOW_DEPLOY_BACKUP_PRUNE="${ARENZYRA_DISK_GUARD_ALLOW_DEPLOY_BACKUP_PRUNE:-0}"
LOG_FILE="${ARENZYRA_DISK_GUARD_LOG_FILE:-/var/log/arenzyra-disk-guard.log}"
ALERT_WEBHOOK_URL="${ARENZYRA_DISK_ALERT_WEBHOOK_URL:-${DISK_ALERT_WEBHOOK_URL:-}}"
DRY_RUN=0
FORCE=0
CHECK_ONLY=0

usage() {
  cat <<EOF
Usage: production-disk-guard.sh [--check-only] [--dry-run] [--force]

Checks disk usage and runs safe cleanup only at or above the configured
cleanup threshold. It never deletes Docker volumes, Postgres data, uploads,
or running containers. Stopped-container cleanup is restricted to the
configured Arenzyra Compose project. Global Docker cache/image and journal
cleanup require separate explicit operator overrides.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

exec 9>/run/arenzyra-disk-guard.lock
if ! flock -n 9; then
  echo "arenzyra-disk-guard is already running"
  exit 0
fi

timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

log() {
  local message="$*"
  printf '%s [arenzyra-disk-guard] %s\n' "$(timestamp)" "$message" | tee -a "$LOG_FILE"
  logger -t arenzyra-disk-guard "$message" >/dev/null 2>&1 || true
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

send_alert() {
  local message="$1"
  if [ -z "$ALERT_WEBHOOK_URL" ] || ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  local escaped
  escaped="$(json_escape "$message")"
  curl -fsS \
    -H 'Content-Type: application/json' \
    -X POST \
    --data "{\"content\":\"$escaped\"}" \
    "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || log "alert webhook post failed"
}

disk_percent() {
  df -P "$DISK_PATH" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

disk_snapshot() {
  df -hT "$DISK_PATH" | tail -n 1
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "dry-run: $*"
    return 0
  fi
  "$@"
}

prune_docker_cache() {
  if ! command -v docker >/dev/null 2>&1; then
    log "docker not found; skipped Docker cleanup"
    return 0
  fi

  log "Arenzyra-scoped Docker cleanup started project=${COMPOSE_PROJECT}"
  run_cmd docker container prune -f \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "until=${DOCKER_CONTAINER_UNTIL}" \
    || log "Arenzyra stopped-container prune failed"

  if [ "$ALLOW_GLOBAL_DOCKER_PRUNE" = "1" ]; then
    log "explicit global Docker cache/image cleanup enabled"
    run_cmd docker builder prune -af --filter "until=${DOCKER_BUILD_CACHE_UNTIL}" || log "Docker build-cache prune failed"
    run_cmd docker image prune -af --filter "until=${DOCKER_IMAGE_UNTIL}" || log "Docker image prune failed"
  else
    log "global Docker cache/image cleanup disabled; set ARENZYRA_DISK_GUARD_ALLOW_GLOBAL_DOCKER_PRUNE=1 only after operator review"
  fi
  log "Docker cleanup completed"
}

prune_old_deploy_backups() {
  if [ "$ALLOW_DEPLOY_BACKUP_PRUNE" != "1" ]; then
    log "deploy-backup cleanup disabled; backups require separate explicit operator review"
    return 0
  fi
  local dirs=(
    /opt/arenzyra/deploy-backups
    /opt/arenzyra/.deploy-backups
    /opt/arenzyra/.deploy-safety-backups
  )

  for dir in "${dirs[@]}"; do
    [ -d "$dir" ] || continue
    local resolved
    resolved="$(readlink -f "$dir")"
    case "$resolved" in
      /opt/arenzyra/deploy-backups|/opt/arenzyra/.deploy-backups|/opt/arenzyra/.deploy-safety-backups)
        ;;
      *)
        log "refusing unexpected deploy backup path: $resolved"
        continue
        ;;
    esac

    log "pruning deploy backup entries older than ${DEPLOY_BACKUP_RETENTION_DAYS} days from $resolved"
    while IFS= read -r -d '' item; do
      case "$item" in
        "$resolved"/*)
          if [ "$DRY_RUN" -eq 1 ]; then
            log "dry-run: remove old deploy backup entry $item"
          else
            rm -rf -- "$item"
            log "removed old deploy backup entry $item"
          fi
          ;;
        *)
          log "skipped unexpected backup path: $item"
          ;;
      esac
    done < <(find "$resolved" -mindepth 1 -maxdepth 1 -mtime +"${DEPLOY_BACKUP_RETENTION_DAYS}" -print0)

  done
}

vacuum_journal() {
  if [ "$ALLOW_GLOBAL_JOURNAL_VACUUM" != "1" ]; then
    log "global journal vacuum disabled; set ARENZYRA_DISK_GUARD_ALLOW_GLOBAL_JOURNAL_VACUUM=1 only after operator review"
    return 0
  fi
  if command -v journalctl >/dev/null 2>&1; then
    log "vacuuming systemd journal to ${JOURNAL_VACUUM_SIZE}"
    run_cmd journalctl --vacuum-size="$JOURNAL_VACUUM_SIZE" || log "journal vacuum failed"
  fi
}

cleanup() {
  prune_docker_cache
  prune_old_deploy_backups
  vacuum_journal
}

if ! before="$(disk_percent 2>/dev/null)" || ! [[ "$before" =~ ^[0-9]+$ ]]; then
  log "disk inspection failed for ${DISK_PATH}; refusing cleanup"
  send_alert "Arenzyra disk inspection FAILED on ${DISK_PATH}; cleanup was not attempted"
  exit 3
fi
log "check started disk=${before}% snapshot=$(disk_snapshot 2>/dev/null || echo unavailable)"

if [ "$before" -ge "$CRITICAL_PERCENT" ]; then
  send_alert "Arenzyra disk CRITICAL before cleanup: ${before}% used on ${DISK_PATH}"
elif [ "$before" -ge "$WARN_PERCENT" ]; then
  send_alert "Arenzyra disk warning: ${before}% used on ${DISK_PATH}"
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  log "check-only completed"
  exit 0
fi

if [ "$FORCE" -eq 1 ] || [ "$before" -ge "$CLEAN_PERCENT" ]; then
  if [ "$FORCE" -eq 1 ]; then
    log "cleanup forced"
  else
    log "disk is at or above cleanup threshold ${CLEAN_PERCENT}%; cleanup starting"
  fi
  cleanup
else
  log "disk below cleanup threshold ${CLEAN_PERCENT}%; cleanup skipped"
fi

if ! after="$(disk_percent 2>/dev/null)" || ! [[ "$after" =~ ^[0-9]+$ ]]; then
  log "post-cleanup disk inspection failed for ${DISK_PATH}"
  send_alert "Arenzyra post-cleanup disk inspection FAILED on ${DISK_PATH}"
  exit 3
fi
log "check completed disk=${after}% snapshot=$(disk_snapshot 2>/dev/null || echo unavailable)"

if [ "$after" -ge "$CRITICAL_PERCENT" ]; then
  send_alert "Arenzyra disk still CRITICAL after cleanup: ${after}% used on ${DISK_PATH}"
  exit 2
fi

if [ "$after" -ge "$WARN_PERCENT" ]; then
  send_alert "Arenzyra disk still high after disk guard: ${after}% used on ${DISK_PATH}"
fi
