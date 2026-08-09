#!/usr/bin/env bash
set -Eeuo pipefail
source scripts/require-local-production-docker.sh

ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
test -f "$ENV_FILE"
test -f infra/production-api-migration-safety.json
test -d apps/api/prisma/migrations

for command in docker node; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'EMPTY TARGET GATE BLOCKED: required command is unavailable: %s.\n' "$command" >&2
    exit 75
  }
done

mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'EMPTY TARGET GATE BLOCKED: production database identity was not verified.\n' >&2
  exit 75
fi

if ! application_relation_count="$(
  docker exec -i "${database_binding[0]}" sh -ceu '
    database="$1"
    schema="$2"
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=30000 -c lock_timeout=5000"
    exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At
  ' sh "${database_binding[3]}" "${database_binding[4]}" <<'SQL'
SELECT count(*)
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname <> 'information_schema'
  AND namespace.nspname !~ '^pg_'
  AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');
SQL
)"; then
  printf 'EMPTY TARGET GATE BLOCKED: read-only aggregate query failed.\n' >&2
  exit 75
fi
if ! [[ "$application_relation_count" =~ ^[0-9]+$ ]]; then
  printf 'EMPTY TARGET GATE BLOCKED: invalid aggregate query result.\n' >&2
  exit 75
fi

node scripts/verify-empty-production-target.cjs \
  --application-relation-count "$application_relation_count"

# Only the successful zero-relation proof permits pending data-impact
# migrations on a writer-free first deployment. The verifier still scans every
# pending migration and fails on malformed or incomplete classification.
node scripts/verify-production-migration-safety.cjs \
  --no-old-writers \
  --verified-empty-target \
  </dev/null
