#!/usr/bin/env bash
set -Eeuo pipefail
source scripts/require-local-production-docker.sh

ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
SQL_FILE="infra/sql/production-live-match-quiescence.sql"
database_identity_args=()
if [ "${1:-}" = "--allow-running-legacy-cutover" ] && [ "$#" -eq 1 ]; then
  database_identity_args+=(--allow-running-legacy-backup)
elif [ "$#" -ne 0 ]; then
  printf 'LIVE MATCH QUIESCENCE BLOCKED: unsupported argument.\n' >&2
  exit 75
fi

if [ ! -f "$ENV_FILE" ] || [ ! -f "$SQL_FILE" ] || [ -L "$SQL_FILE" ]; then
  printf 'LIVE MATCH QUIESCENCE BLOCKED: reviewed environment or aggregate SQL is unavailable.\n' >&2
  exit 75
fi

for command in docker node; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'LIVE MATCH QUIESCENCE BLOCKED: required command is unavailable: %s.\n' "$command" >&2
    exit 75
  }
done

mapfile -t database_binding < <(
  bash scripts/verify-production-database-container.sh "${database_identity_args[@]}"
)
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'LIVE MATCH QUIESCENCE BLOCKED: production database identity was not verified.\n' >&2
  exit 75
fi

if ! verified_inventory="$({
  docker exec -i "${database_binding[0]}" sh -ceu '
    database="$1"
    schema="$2"
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=30000 -c lock_timeout=5000"
    exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At
  ' sh "${database_binding[3]}" "${database_binding[4]}" <"$SQL_FILE"
} | node scripts/verify-production-live-match-quiescence.cjs)"; then
  printf 'LIVE MATCH QUIESCENCE BLOCKED: aggregate inventory could not authorize deployment. No customer state was changed.\n' >&2
  exit 75
fi

printf '%s\n' "$verified_inventory"
