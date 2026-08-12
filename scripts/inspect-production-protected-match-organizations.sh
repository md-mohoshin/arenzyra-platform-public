#!/usr/bin/env bash
set -Eeuo pipefail
source scripts/require-local-production-docker.sh

ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
SQL_FILE="infra/sql/production-protected-match-organizations.sql"
[ "$#" -eq 0 ] || { printf 'PROTECTED MATCH ORGANIZATION INSPECTION BLOCKED: no arguments are accepted.\n' >&2; exit 75; }
[ -f "$ENV_FILE" ] && [ -f "$SQL_FILE" ] && [ ! -L "$SQL_FILE" ] || {
  printf 'PROTECTED MATCH ORGANIZATION INSPECTION BLOCKED: reviewed inputs are unavailable.\n' >&2
  exit 75
}

mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'PROTECTED MATCH ORGANIZATION INSPECTION BLOCKED: database identity was not verified.\n' >&2
  exit 75
fi

docker exec -i "${database_binding[0]}" sh -ceu '
  database="$1"
  schema="$2"
  export PGCONNECT_TIMEOUT=10
  export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=30000 -c lock_timeout=5000"
  exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At
' sh "${database_binding[3]}" "${database_binding[4]}" <"$SQL_FILE" |
  node scripts/inspect-production-protected-match-organizations.cjs
