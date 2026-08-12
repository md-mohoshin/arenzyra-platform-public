#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

source scripts/require-local-production-docker.sh

ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
SQL_FILE="infra/sql/production-end-stale-global-control-matches.sql"
reuse_verified_backup_id=''
if [ "$#" -eq 0 ]; then
  :
elif [ "$#" -eq 2 ] && [ "$1" = '--reuse-verified-backup' ] && \
  [[ "$2" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]]; then
  reuse_verified_backup_id="$2"
  shift 2
else
  printf 'STALE MATCH RECOVERY BLOCKED: expected no arguments or one reviewed verified-backup reuse.\n' >&2
  exit 75
fi
[ -f "$ENV_FILE" ] && [ -f "$SQL_FILE" ] && [ ! -L "$SQL_FILE" ] || {
  printf 'STALE MATCH RECOVERY BLOCKED: reviewed inputs are unavailable.\n' >&2
  exit 75
}

source scripts/acquire-production-deploy-lock.sh

runtime_temp_dir=''
production_activation_lock_active=0
cleanup() {
  if declare -F release_production_activation_lock >/dev/null 2>&1 && \
    [ "$production_activation_lock_active" -eq 1 ]; then
    release_production_activation_lock >/dev/null 2>&1 || true
  fi
  if [ -n "$runtime_temp_dir" ]; then
    case "$runtime_temp_dir" in
      /run/arenzyra-stale-match-recovery.*)
        rm -f -- "$runtime_temp_dir/result"
        rmdir -- "$runtime_temp_dir" 2>/dev/null || true
        ;;
    esac
  fi
}
trap cleanup EXIT

# First guard: nothing expensive or stateful begins on an unhealthy or low-disk
# host. production-backup.sh repeats this guard within the inherited lock.
bash scripts/production-deploy-preflight.sh

backup_start_epoch="$(date +%s)"
if [ -z "$reuse_verified_backup_id" ]; then
  runtime_temp_dir="$(mktemp -d /run/arenzyra-stale-match-recovery.XXXXXX)"
  case "$runtime_temp_dir" in
    /run/arenzyra-stale-match-recovery.*) ;;
    *) printf 'STALE MATCH RECOVERY BLOCKED: temporary path escaped /run.\n' >&2; exit 75 ;;
  esac
  chmod 700 -- "$runtime_temp_dir"
  result_file="$runtime_temp_dir/result"
  env \
    "ARENZYRA_BACKUP_ENV_FILE=$ENV_FILE" \
    "ARENZYRA_BACKUP_REASON=operator-end-stale-global-control-matches" \
    "ARENZYRA_BACKUP_RESULT_FILE=$result_file" \
    "ARENZYRA_BACKUP_REQUIRE_OFFSITE=1" \
    "ARENZYRA_BACKUP_ALLOW_MISSING_APP_VOLUMES=0" \
    "ARENZYRA_DEPLOY_LOCK_INHERITED=1" \
    bash scripts/production-backup.sh

  test -f "$result_file"
  mapfile -t backup_result <"$result_file"
  if [ "${#backup_result[@]}" -ne 2 ]; then
    printf 'STALE MATCH RECOVERY BLOCKED: backup returned an invalid result.\n' >&2
    exit 75
  fi
  backup_id="${backup_result[0]}"
  backup_dir="${backup_result[1]}"
  [[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || {
    printf 'STALE MATCH RECOVERY BLOCKED: backup ID is invalid.\n' >&2
    exit 75
  }
else
  backup_id="$reuse_verified_backup_id"
  backup_dir=''
fi
backup_root="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_ROOT)"
if [ -z "$backup_root" ]; then
  backup_root="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_BACKUP_ROOT)"
fi
backup_root="$(realpath -e -- "${backup_root:-/opt/arenzyra-backups}")"
if [ -n "$backup_dir" ]; then
  backup_dir="$(realpath -e -- "$backup_dir")"
else
  backup_dir="$(realpath -e -- "$backup_root/$backup_id")"
fi
if [ "$(dirname -- "$backup_dir")" != "$backup_root" ] || \
  [ "$(basename -- "$backup_dir")" != "$backup_id" ]; then
  printf 'STALE MATCH RECOVERY BLOCKED: backup path escaped its reviewed root.\n' >&2
  exit 75
fi
[ "$(stat -Lc '%u:%g:%a' -- "$backup_dir" 2>/dev/null || true)" = '0:0:700' ] || {
  printf 'STALE MATCH RECOVERY BLOCKED: backup directory permissions differ.\n' >&2
  exit 75
}
required_artifacts=(
  BACKUP_COMPLETE OFFSITE_VERIFIED database.dump.age database-globals.sql.age
  metadata.txt.age manifest.sha256.age volume-api-storage.tar.gz.age
  volume-api-uploads.tar.gz.age
)
for artifact in "${required_artifacts[@]}"; do
  artifact_identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$backup_dir/$artifact" 2>/dev/null || true)"
  [ -f "$backup_dir/$artifact" ] && [ ! -L "$backup_dir/$artifact" ] && \
    [[ "$artifact_identity" =~ ^0:0:600:1:[1-9][0-9]*$ ]] || {
    printf 'STALE MATCH RECOVERY BLOCKED: verified backup artifact is unsafe or missing.\n' >&2
    exit 75
  }
done
shopt -s nullglob dotglob
backup_children=("$backup_dir"/*)
shopt -u dotglob nullglob
for artifact_path in "${backup_children[@]}"; do
  artifact="${artifact_path##*/}"
  case "$artifact" in
    BACKUP_COMPLETE|OFFSITE_VERIFIED|database.dump.age|database-globals.sql.age|manifest.sha256.age|metadata.txt.age|volume-api-storage.tar.gz.age|volume-api-uploads.tar.gz.age|volume-redis-data.tar.gz.age|volume-caddy-data.tar.gz.age|volume-caddy-config.tar.gz.age|volume-discord-bot-state.tar.gz.age) ;;
    *) printf 'STALE MATCH RECOVERY BLOCKED: backup contains an unsupported artifact.\n' >&2; exit 75 ;;
  esac
  artifact_identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$artifact_path" 2>/dev/null || true)"
  [ -f "$artifact_path" ] && [ ! -L "$artifact_path" ] && \
    [[ "$artifact_identity" =~ ^0:0:600:1:[1-9][0-9]*$ ]] || {
    printf 'STALE MATCH RECOVERY BLOCKED: backup contains an unsafe artifact.\n' >&2
    exit 75
  }
done
[ "$(wc -l < "$backup_dir/BACKUP_COMPLETE")" -eq 3 ] && \
  [ "$(grep -Fxc -- "backup_id=$backup_id" "$backup_dir/BACKUP_COMPLETE")" -eq 1 ] && \
  [ "$(grep -Ec '^created_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$backup_dir/BACKUP_COMPLETE")" -eq 1 ] && \
  [ "$(grep -Fxc -- 'reason=operator-end-stale-global-control-matches' "$backup_dir/BACKUP_COMPLETE")" -eq 1 ] || {
  printf 'STALE MATCH RECOVERY BLOCKED: backup completion marker is invalid.\n' >&2
  exit 75
}
backup_remote="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_RCLONE_REMOTE)"
if [ -z "$backup_remote" ]; then
  backup_remote="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_BACKUP_RCLONE_REMOTE)"
fi
[ -n "$backup_remote" ] && \
  [ "$(wc -l < "$backup_dir/OFFSITE_VERIFIED")" -eq 2 ] && \
  [ "$(grep -Ec '^verified_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' "$backup_dir/OFFSITE_VERIFIED")" -eq 1 ] && \
  [ "$(grep -Fxc -- "remote=${backup_remote%/}/$backup_id" "$backup_dir/OFFSITE_VERIFIED")" -eq 1 ] || {
  printf 'STALE MATCH RECOVERY BLOCKED: off-site verification marker is invalid.\n' >&2
  exit 75
}
now_epoch="$(date +%s)"
for marker in BACKUP_COMPLETE OFFSITE_VERIFIED; do
  marker_epoch="$(stat -c %Y -- "$backup_dir/$marker")"
  if [ -n "$reuse_verified_backup_id" ]; then
    [[ "$marker_epoch" =~ ^[0-9]+$ ]] && [ "$marker_epoch" -le "$now_epoch" ] && \
      [ $(( now_epoch - marker_epoch )) -le 7200 ] || {
      printf 'STALE MATCH RECOVERY BLOCKED: reused backup marker is older than two hours.\n' >&2
      exit 75
    }
  elif ! [[ "$marker_epoch" =~ ^[0-9]+$ ]] || [ "$marker_epoch" -lt "$backup_start_epoch" ]; then
    printf 'STALE MATCH RECOVERY BLOCKED: backup verification marker is stale.\n' >&2
    exit 75
  fi
done
if [ -n "$reuse_verified_backup_id" ]; then
  printf 'STALE MATCH RECOVERY BACKUP REUSE VERIFIED id=%s path=%s\n' "$backup_id" "$backup_dir"
else
  printf 'STALE MATCH RECOVERY BACKUP VERIFIED id=%s path=%s\n' "$backup_id" "$backup_dir"
fi

# A backup can cross the disk threshold. Acquire the activation interlock, then
# repeat the mandatory preflight literally immediately before the write.
source scripts/production-live-match-deployment-lock.sh
acquire_production_activation_lock
bash scripts/production-deploy-preflight.sh
verify_production_activation_lock

mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'STALE MATCH RECOVERY BLOCKED: database identity was not verified.\n' >&2
  exit 75
fi

docker exec -i "${database_binding[0]}" sh -ceu '
  database="$1"
  schema="$2"
  export PGCONNECT_TIMEOUT=10
  export PGOPTIONS="-c search_path=$schema -c statement_timeout=45000 -c lock_timeout=5000"
  exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At
' sh "${database_binding[3]}" "${database_binding[4]}" <"$SQL_FILE" |
  node scripts/parse-production-stale-match-end.cjs

verify_production_activation_lock
bash scripts/verify-production-live-match-quiescence.sh
printf 'STALE MATCH RECOVERY COMPLETE: exact protected inventory is now quiescent.\n'
