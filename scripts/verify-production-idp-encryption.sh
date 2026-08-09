#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

source scripts/require-local-production-docker.sh

ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
ALLOW_UNVALIDATED=0
if [ "${1:-}" = "--allow-unvalidated" ] && [ "$#" -eq 1 ]; then
  ALLOW_UNVALIDATED=1
elif [ "$#" -ne 0 ]; then
  printf 'IDP ENCRYPTION GATE BLOCKED: unsupported verification argument.\n' >&2
  exit 75
fi
test -f "$ENV_FILE"

mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'IDP ENCRYPTION GATE BLOCKED: production database identity was not verified.\n' >&2
  exit 75
fi

if ! idp_counts="$(
  docker exec "${database_binding[0]}" sh -ceu '
    database="$1"
    schema="$2"
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=30000 -c lock_timeout=5000"
    exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At -F " " -c \
      "WITH envelope_constraint AS (
         SELECT constraint_record.oid, constraint_record.convalidated
         FROM pg_catalog.pg_constraint AS constraint_record
         JOIN pg_catalog.pg_class AS relation
           ON relation.oid = constraint_record.conrelid
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid = relation.oid
          AND attribute.attname = '\''roomPassword'\''
          AND NOT attribute.attisdropped
         WHERE namespace.nspname = current_schema()
           AND relation.relname = '\''DiscordIdpSchedule'\''
           AND relation.relkind IN ('\''r'\'', '\''p'\'')
           AND constraint_record.conname = '\''DiscordIdpSchedule_roomPassword_v1_envelope_check'\''
           AND constraint_record.contype = '\''c'\''
           AND constraint_record.conislocal
           AND constraint_record.coninhcount = 0
           AND constraint_record.conparentid = 0
           AND NOT constraint_record.connoinherit
           AND constraint_record.conkey = ARRAY[attribute.attnum]::smallint[]
       )
       SELECT
         (SELECT count(*) FROM \"_prisma_migrations\"
          WHERE migration_name = '\''20260805021000_idp_encrypted_credential_storage'\''
            AND finished_at IS NOT NULL AND rolled_back_at IS NULL),
         (SELECT count(*) FROM envelope_constraint),
         (SELECT count(*) FROM envelope_constraint WHERE convalidated),
         (SELECT count(*) FROM \"DiscordIdpSchedule\"
          WHERE \"roomPassword\" IS NULL OR
            \"roomPassword\" !~ '\''^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$'\''),
         COALESCE(
           (SELECT pg_catalog.encode(
             pg_catalog.convert_to(
               pg_catalog.pg_get_constraintdef(oid, true),
               '\''UTF8'\''
             ),
             '\''hex'\''
           ) FROM envelope_constraint),
           '\''-'\''
         );"
  ' sh "${database_binding[3]}" "${database_binding[4]}"
)"; then
  printf 'IDP ENCRYPTION GATE BLOCKED: database verification query failed.\n' >&2
  exit 75
fi
if ! [[ "$idp_counts" =~ ^[0-9]+[[:space:]][0-9]+[[:space:]][0-9]+[[:space:]][0-9]+[[:space:]](-|[0-9a-f]+)$ ]]; then
  printf 'IDP ENCRYPTION GATE BLOCKED: invalid database verification result.\n' >&2
  exit 75
fi
read -r migration_applied_count constraint_count constraint_validated_count legacy_count constraint_definition_hex \
  <<<"$idp_counts"

verification_arguments=(
  --migration-applied-count "$migration_applied_count"
  --constraint-count "$constraint_count"
  --constraint-validated-count "$constraint_validated_count"
  --legacy-count "$legacy_count"
  --constraint-definition-hex "$constraint_definition_hex"
)
if [ "$ALLOW_UNVALIDATED" -eq 1 ]; then
  verification_arguments+=(--allow-unvalidated)
fi
node scripts/verify-idp-credential-storage.cjs "${verification_arguments[@]}"
