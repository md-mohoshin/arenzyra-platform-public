#!/usr/bin/env bash
set -Eeuo pipefail
source scripts/require-local-production-docker.sh

ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
FIRST_DEPLOY=0

if [ "${1:-}" = "--first-deploy" ]; then
  FIRST_DEPLOY=1
  shift
fi
if [ "$#" -ne 0 ]; then
  printf 'Usage: production-release-safety-gate.sh [--first-deploy]\n' >&2
  exit 2
fi

test -f "$ENV_FILE"
test -f infra/production-api-migration-safety.json
test -d apps/api/prisma/migrations

command -v node >/dev/null 2>&1 || {
  printf 'Release-safety gate requires node.\n' >&2
  exit 2
}
node scripts/production-database-target.cjs --env "$ENV_FILE" --check >/dev/null

if [ "$FIRST_DEPLOY" -eq 1 ]; then
  # The caller must first run production-deploy-preflight.sh --skip-health,
  # which proves this Compose project has no managed containers or old writers.
  # Data-impact migrations are only classified here. They are not waived: the
  # deploy must prove the newly-started target has zero application relations
  # before any backup or migration is allowed.
  node scripts/verify-production-migration-safety.cjs \
    --no-old-writers \
    --defer-data-impact \
    </dev/null
  exit 0
fi

for command in docker node; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Release-safety gate requires %s.\n' "$command" >&2
    exit 2
  }
done

mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'DEPLOYMENT BLOCKED: production database identity was not verified.\n' >&2
  exit 75
fi

docker exec "${database_binding[0]}" sh -ceu '
  database="$1"
  schema="$2"
  export PGCONNECT_TIMEOUT=10
  export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=30000 -c lock_timeout=5000"
  exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -Atc \
    "SELECT row_to_json(ledger_row)::text
       FROM (
         SELECT migration_name AS \"migrationName\",
                checksum,
                finished_at IS NOT NULL AS finished,
                rolled_back_at IS NOT NULL AS \"rolledBack\",
                applied_steps_count AS \"appliedStepsCount\"
           FROM \"_prisma_migrations\"
          ORDER BY migration_name, started_at, id
       ) AS ledger_row;"
' sh "${database_binding[3]}" "${database_binding[4]}" \
  | node scripts/verify-production-migration-safety.cjs
