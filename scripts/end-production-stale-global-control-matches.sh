#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

source scripts/require-local-production-docker.sh

ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
SQL_FILE="infra/sql/production-end-stale-global-control-matches.sql"
[ "$#" -eq 0 ] || {
  printf 'STALE MATCH RECOVERY BLOCKED: no arguments are accepted.\n' >&2
  exit 75
}
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

runtime_temp_dir="$(mktemp -d /run/arenzyra-stale-match-recovery.XXXXXX)"
case "$runtime_temp_dir" in
  /run/arenzyra-stale-match-recovery.*) ;;
  *) printf 'STALE MATCH RECOVERY BLOCKED: temporary path escaped /run.\n' >&2; exit 75 ;;
esac
chmod 700 -- "$runtime_temp_dir"
result_file="$runtime_temp_dir/result"
backup_start_epoch="$(date +%s)"

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
backup_root="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_RECOVERY_V1_ROOT)"
if [ -z "$backup_root" ]; then
  backup_root="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_BACKUP_ROOT)"
fi
backup_root="$(realpath -e -- "${backup_root:-/opt/arenzyra-backups}")"
backup_dir="$(realpath -e -- "$backup_dir")"
if [ "$(dirname -- "$backup_dir")" != "$backup_root" ] || \
  [ "$(basename -- "$backup_dir")" != "$backup_id" ]; then
  printf 'STALE MATCH RECOVERY BLOCKED: backup path escaped its reviewed root.\n' >&2
  exit 75
fi
for artifact in \
  BACKUP_COMPLETE OFFSITE_VERIFIED database.dump.age database-globals.sql.age \
  metadata.txt.age manifest.sha256.age; do
  [ -s "$backup_dir/$artifact" ] || {
    printf 'STALE MATCH RECOVERY BLOCKED: verified backup artifact is missing.\n' >&2
    exit 75
  }
done
for marker in BACKUP_COMPLETE OFFSITE_VERIFIED; do
  marker_epoch="$(stat -c %Y -- "$backup_dir/$marker")"
  [[ "$marker_epoch" =~ ^[0-9]+$ ]] && [ "$marker_epoch" -ge "$backup_start_epoch" ] || {
    printf 'STALE MATCH RECOVERY BLOCKED: backup verification marker is stale.\n' >&2
    exit 75
  }
done
printf 'STALE MATCH RECOVERY BACKUP VERIFIED id=%s path=%s\n' "$backup_id" "$backup_dir"

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
