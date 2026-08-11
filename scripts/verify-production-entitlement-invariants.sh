#!/usr/bin/env bash
set -Eeuo pipefail
source scripts/require-local-production-docker.sh

ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
database_identity_args=()
entitlement_policy_args=()
if [ "${1:-}" = "--allow-running-legacy-cutover" ] && [ "$#" -eq 1 ]; then
  database_identity_args+=(--allow-running-legacy-backup)
  entitlement_policy_args+=(--allow-legacy-active-stale-trial)
elif [ "${1:-}" = "--allow-cutover-transition" ] && [ "$#" -eq 1 ]; then
  # PostgreSQL has already crossed to the reviewed target profile, while the
  # narrowly reconcilable legacy entitlement remains unchanged until fencing.
  entitlement_policy_args+=(--allow-legacy-active-stale-trial)
elif [ "$#" -ne 0 ]; then
  printf 'ENTITLEMENT INVARIANT GATE BLOCKED: unsupported argument.\n' >&2
  exit 75
fi
test -f "$ENV_FILE"

for command in docker node; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'ENTITLEMENT INVARIANT GATE BLOCKED: required command is unavailable: %s.\n' "$command" >&2
    exit 75
  }
done

mapfile -t database_binding < <(
  bash scripts/verify-production-database-container.sh "${database_identity_args[@]}"
)
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'ENTITLEMENT INVARIANT GATE BLOCKED: production database identity was not verified.\n' >&2
  exit 75
fi

if ! entitlement_counts="$(
  docker exec -i "${database_binding[0]}" sh -ceu '
    database="$1"
    schema="$2"
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=30000 -c lock_timeout=5000"
    exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At -F " "
  ' sh "${database_binding[3]}" "${database_binding[4]}" <<'SQL'
WITH non_deleted AS (
  SELECT
    "subscriptionStatus"::text AS status,
    "paidUntil",
    "trialEndsAt"
  FROM "Organization"
  WHERE "deletedAt" IS NULL
)
SELECT
  count(*),
  count(*) FILTER (WHERE status = 'ACTIVE'),
  count(*) FILTER (
    WHERE status = 'ACTIVE'
      AND (
        "paidUntil" IS NULL
        OR "trialEndsAt" IS NOT NULL
      )
  ),
  count(*) FILTER (
    WHERE status = 'ACTIVE' AND "paidUntil" IS NULL
  ),
  count(*) FILTER (
    WHERE status = 'ACTIVE' AND "trialEndsAt" IS NOT NULL
  ),
  count(*) FILTER (WHERE status = 'TRIALING'),
  count(*) FILTER (
    WHERE status = 'TRIALING'
      AND (
        "trialEndsAt" IS NULL
        OR "paidUntil" IS NOT NULL
      )
  ),
  count(*) FILTER (WHERE status = 'EXPIRED'),
  count(*) FILTER (
    WHERE status = 'EXPIRED'
      AND (
        "paidUntil" IS NOT NULL
        OR "trialEndsAt" IS NOT NULL
      )
  ),
  count(*) FILTER (WHERE status NOT IN ('ACTIVE', 'TRIALING', 'EXPIRED'))
FROM non_deleted;
SQL
)"; then
  printf 'ENTITLEMENT INVARIANT GATE BLOCKED: read-only aggregate query failed.\n' >&2
  exit 75
fi

if ! [[ "$entitlement_counts" =~ ^[0-9]+[[:space:]][0-9]+[[:space:]][0-9]+[[:space:]][0-9]+[[:space:]][0-9]+[[:space:]][0-9]+[[:space:]][0-9]+[[:space:]][0-9]+[[:space:]][0-9]+[[:space:]][0-9]+$ ]]; then
  printf 'ENTITLEMENT INVARIANT GATE BLOCKED: invalid aggregate query result.\n' >&2
  exit 75
fi
read -r organization_count active_count active_inconsistent_count \
  active_missing_paid_count active_trial_present_count \
  trialing_count trialing_inconsistent_count expired_count \
  expired_inconsistent_count unknown_status_count <<<"$entitlement_counts"

node scripts/verify-production-entitlement-invariants.cjs \
  --organization-count "$organization_count" \
  --active-count "$active_count" \
  --active-inconsistent-count "$active_inconsistent_count" \
  --active-missing-paid-count "$active_missing_paid_count" \
  --active-trial-present-count "$active_trial_present_count" \
  --trialing-count "$trialing_count" \
  --trialing-inconsistent-count "$trialing_inconsistent_count" \
  --expired-count "$expired_count" \
  --expired-inconsistent-count "$expired_inconsistent_count" \
  --unknown-status-count "$unknown_status_count" \
  "${entitlement_policy_args[@]}"

# Runtime access is strictly clock-bounded, while deployment authorization uses
# the stable stored-shape gate above. Reuse the aggregate-only inventory and its
# bounded sanitizer as operational evidence; natural clock expiry must neither
# mutate customer dates nor turn an otherwise safe release into an outage.
INVENTORY_SQL="infra/sql/production-entitlement-inventory.sql"
if [ ! -f "$INVENTORY_SQL" ] || [ -L "$INVENTORY_SQL" ]; then
  printf 'ENTITLEMENT DEPLOYMENT GATE BLOCKED: reviewed inventory SQL is unavailable.\n' >&2
  exit 75
fi
if ! sanitized_inventory="$(
  docker exec -i "${database_binding[0]}" sh -ceu '
    database="$1"
    schema="$2"
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=30000 -c lock_timeout=5000"
    exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At
  ' sh "${database_binding[3]}" "${database_binding[4]}" \
    <"$INVENTORY_SQL" \
    | node scripts/parse-production-entitlement-inventory.cjs
)"; then
  printf 'ENTITLEMENT DEPLOYMENT GATE BLOCKED: aggregate inventory could not be verified. No customer state was changed.\n' >&2
  exit 75
fi
printf '%s\n' "$sanitized_inventory" \
  | node scripts/verify-production-entitlement-deployment.cjs
