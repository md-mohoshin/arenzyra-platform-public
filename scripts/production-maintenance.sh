#!/bin/sh
set -eu

ENV_FILE="${ARENZYRA_MAINTENANCE_ENV_FILE:-/etc/arenzyra-maintenance.env}"
if [ -f "$ENV_FILE" ]; then
  # Optional root-owned env file for server-local alert settings.
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

LOG_TAG="${ARENZYRA_MAINTENANCE_LOG_TAG:-arenzyra-maintenance}"
DISK_PATH="${ARENZYRA_DISK_PATH:-/}"
WARN_PERCENT="${ARENZYRA_DISK_WARN_PERCENT:-85}"
CRITICAL_PERCENT="${ARENZYRA_DISK_CRITICAL_PERCENT:-90}"
BACKUP_DIR="${ARENZYRA_BACKUP_DIR:-/opt/arenzyra-backups}"
BACKUP_RETENTION_DAYS="${ARENZYRA_BACKUP_RETENTION_DAYS:-30}"
DOCKER_BUILDER_KEEP_STORAGE="${ARENZYRA_DOCKER_BUILDER_KEEP_STORAGE:-15GB}"
ALERT_WEBHOOK_URL="${ARENZYRA_DISK_ALERT_WEBHOOK_URL:-${DISK_ALERT_WEBHOOK_URL:-}}"
DRY_RUN=0
CHECK_ONLY=0

usage() {
  cat <<EOF
Usage: sh scripts/production-maintenance.sh [--check-only] [--dry-run]

Environment:
  ARENZYRA_DISK_PATH=/                         Disk mount to monitor.
  ARENZYRA_DISK_WARN_PERCENT=85                Warning threshold.
  ARENZYRA_DISK_CRITICAL_PERCENT=90            Critical threshold.
  ARENZYRA_DOCKER_BUILDER_KEEP_STORAGE=15GB    Build cache target.
  ARENZYRA_BACKUP_DIR=/opt/arenzyra-backups    Backup root to prune.
  ARENZYRA_BACKUP_RETENTION_DAYS=30            Backup retention.
  ARENZYRA_DISK_ALERT_WEBHOOK_URL=...          Optional Discord/webhook URL.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-only)
      CHECK_ONLY=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
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

log() {
  message="$*"
  printf '%s [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$LOG_TAG" "$message"
  if command -v logger >/dev/null 2>&1; then
    logger -t "$LOG_TAG" "$message" || true
  fi
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

send_alert() {
  message="$1"
  if [ -z "$ALERT_WEBHOOK_URL" ]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    log "alert webhook configured but curl is unavailable"
    return 0
  fi
  escaped="$(json_escape "$message")"
  curl -fsS \
    -H "Content-Type: application/json" \
    -X POST \
    --data "{\"content\":\"$escaped\"}" \
    "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || log "alert webhook post failed"
}

disk_percent() {
  df -P "$DISK_PATH" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "dry-run: $*"
    return 0
  fi
  "$@"
}

prune_docker_builder() {
  if ! command -v docker >/dev/null 2>&1; then
    log "docker unavailable; skipped build-cache prune"
    return 0
  fi
  log "pruning Docker build cache, reserving ${DOCKER_BUILDER_KEEP_STORAGE}"
  if docker builder prune --help 2>/dev/null | grep -q -- "--reserved-space"; then
    prune_flag="--reserved-space"
  else
    prune_flag="--keep-storage"
  fi
  if run_cmd docker builder prune -af "$prune_flag" "$DOCKER_BUILDER_KEEP_STORAGE"; then
    log "Docker build-cache prune completed"
  else
    log "Docker build-cache prune failed"
  fi
}

prune_old_backups() {
  if [ ! -d "$BACKUP_DIR" ]; then
    log "backup directory not found; skipped backup retention: $BACKUP_DIR"
    return 0
  fi

  resolved_backup_dir="$(readlink -f "$BACKUP_DIR" 2>/dev/null || printf '%s' "$BACKUP_DIR")"
  case "$resolved_backup_dir" in
    /opt/arenzyra-backups|/opt/arenzyra-backups/*)
      ;;
    *)
      log "refusing to prune unexpected backup directory: $resolved_backup_dir"
      return 0
      ;;
  esac

  log "pruning backups older than ${BACKUP_RETENTION_DAYS} days from $resolved_backup_dir"
  find "$resolved_backup_dir" -mindepth 1 -maxdepth 1 -mtime +"$BACKUP_RETENTION_DAYS" -print | while IFS= read -r item; do
    case "$item" in
      "$resolved_backup_dir"/*)
        if [ "$DRY_RUN" -eq 1 ]; then
          log "dry-run: remove old backup $item"
        else
          rm -rf -- "$item"
          log "removed old backup $item"
        fi
        ;;
      *)
        log "skipped unexpected backup path: $item"
        ;;
    esac
  done
}

check_disk() {
  percent="$(disk_percent 2>/dev/null || printf '0')"
  if [ -z "$percent" ]; then
    percent=0
  fi
  log "disk usage for $DISK_PATH is ${percent}%"

  if [ "$percent" -ge "$CRITICAL_PERCENT" ]; then
    message="Arenzyra production disk CRITICAL: ${percent}% used on ${DISK_PATH}"
    log "$message"
    send_alert "$message"
    return 2
  fi

  if [ "$percent" -ge "$WARN_PERCENT" ]; then
    message="Arenzyra production disk warning: ${percent}% used on ${DISK_PATH}"
    log "$message"
    send_alert "$message"
  fi

  return 0
}

before="$(disk_percent 2>/dev/null || printf '0')"
log "maintenance started; disk before=${before}%"

if [ "$CHECK_ONLY" -eq 0 ]; then
  prune_docker_builder
  prune_old_backups
fi

if check_disk; then
  log "maintenance completed"
else
  code="$?"
  log "maintenance completed with disk alert status=$code"
  exit "$code"
fi
