# Production entitlement inventory

This is a point-in-time, read-only decision gate for the canonical
`Organization` billing and access fields. It does not authorize a deployment,
an entitlement update, or a blanket backfill. The query returns one JSON object
containing aggregate counts only. It cannot return organization/user IDs,
names, email addresses, plan strings, tokens, credentials, connection strings,
or any row-level value.

The reviewed inputs are:

- `infra/sql/production-entitlement-inventory.sql`: one repeatable-read,
  transaction-read-only query with 15-second statement, 2-second lock, and
  20-second idle-in-transaction timeouts;
- `scripts/parse-production-entitlement-inventory.cjs`: a bounded parser that
  accepts only the exact version-1 aggregate shape, verifies every partition,
  and emits stable sanitized JSON; and
- `scripts/production-entitlement-inventory.test.cjs`: parser fixtures and
  static SQL/output-boundary checks.

Verify those boundaries locally without Docker or network access:

```bash
node --test scripts/production-entitlement-inventory.test.cjs
```

The clock used for every `future`/`expired` classification is PostgreSQL's one
`transaction_timestamp() AT TIME ZONE 'UTC'` value. That timestamp is
deliberately not emitted.
The operator should record the UTC observation time and clean release revision
in access-controlled release evidence, separate from the sanitized JSON.

## Exact fileless production invocation

Do not run this from a dirty or unreviewed checkout. First replace the four
angle-bracketed values below with the reviewed operator home, pinned known-hosts
file, dedicated SSH identity, and production SSH target. Keep the SQL and parser
from the same clean release revision. This invocation starts both local and
remote Bash/Node processes from empty parent environments, pins SSH host-key
verification, disables forwarding and agent authentication, reuses the
repository's production database identity attestation, and streams the SQL
through `ssh` and `docker exec`. It creates no file on the production host or
inside the PostgreSQL container.

```bash
env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME='<absolute-reviewed-operator-home>' \
  bash --noprofile --norc <<'ARENZYRA_ENTITLEMENT_INVENTORY'
set -Eeuo pipefail

readonly operator_home='<absolute-reviewed-operator-home>'
readonly known_hosts='<absolute-path-to-pinned-production-known-hosts>'
readonly identity_file='<absolute-path-to-dedicated-production-ssh-key>'
readonly ssh_target='<reviewed-user@reviewed-production-host>'
readonly inventory_sql='infra/sql/production-entitlement-inventory.sql'
readonly inventory_parser='scripts/parse-production-entitlement-inventory.cjs'

test -f "$known_hosts"
test -f "$identity_file"
test -f "$inventory_sql"
test -f "$inventory_parser"

env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME="$operator_home" \
  ssh -T \
    -o BatchMode=yes \
    -o CheckHostIP=yes \
    -o ClearAllForwardings=yes \
    -o ConnectionAttempts=1 \
    -o ConnectTimeout=10 \
    -o ForwardAgent=no \
    -o GlobalKnownHostsFile=/dev/null \
    -o IdentitiesOnly=yes \
    -o PermitLocalCommand=no \
    -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$known_hosts" \
    -i "$identity_file" \
    "$ssh_target" \
    'env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root bash --noprofile --norc -ceu '"'"'
cd /opt/arenzyra
if [ -n "$(git --no-optional-locks status --porcelain=v1 --untracked-files=all)" ]; then
  printf "ENTITLEMENT INVENTORY BLOCKED: production Root checkout is dirty.\n" >&2
  exit 75
fi
node scripts/verify-production-release-source.cjs --check-checkout-only >/dev/null
mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf "ENTITLEMENT INVENTORY BLOCKED: production database identity was not verified.\n" >&2
  exit 75
fi
exec docker exec -i "${database_binding[0]}" sh -ceu '"'"'
database="$1"
schema="$2"
export PGCONNECT_TIMEOUT=10
export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=15000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=20000"
exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At
'"'"' sh "${database_binding[3]}" "${database_binding[4]}"
'"'"'' \
  < "$inventory_sql" \
  | env -i \
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
      HOME="$operator_home" \
      node "$inventory_parser"
ARENZYRA_ENTITLEMENT_INVENTORY
```

This is read-only observation, so it does not call Compose, start a service, or
require the deployment preflight. If any build, pull, recreate, restart, or
Compose-up is later proposed, stop and follow the separate preflight and
guarded deployment rules in `AGENTS.md` and `infra/PUBLISH.md`.

## Interpreting the sanitized counts

All billing, plan, owner, and access classifications except `deleted` are over
non-deleted organizations. `approvedAndActive` means exactly
`status = APPROVED AND isActive = true`.

- `activeState` partitions every non-deleted `ACTIVE` subscription into null,
  future, or expired `paidUntil` buckets. The null and expired buckets are
  the decisive evidence for whether changing `ACTIVE` to require a future
  clock would remove access.
- `trialingState.valid` requires null `paidUntil`, both trial dates, an ordered
  trial already started, and a future `trialEndsAt`. Its other deterministic
  buckets cover expired, missing, paid-clock-contaminated, and invalid/future
  trial dates.
- `expiredState.paidUntilFuture` exposes the specific `EXPIRED` plus future paid
  clock contradiction. The other paid/trial clock buckets make the state shape
  auditable without identifiers.
- `clockBoundedAccessCandidate` intersects billing state with the approved and
  active organization boundary. In particular,
  `activePaidUntilNull + activePaidUntilExpired` is the aggregate number of
  otherwise access-ready `ACTIVE` organizations that a strict future-clock rule
  would deny at this snapshot.
- `nonDeletedPlans` emits null/non-null counts and only the six reviewed
  canonical plan buckets (`discord-basic`, `discord-ops`, `production`,
  `sports-production`, `multi-game-production`, and `pubg-auto-launcher`). Any
  other non-null value contributes only to `legacyOrUnknown`; its value is never
  returned.
- `ownerReferences` is a complete reference partition. `ownerAnomalies` contains
  identifier-free counts for deleted, non-active, or organization-mismatched
  linked owners. Those anomaly counts may overlap and must not be added together.

Any nonzero anomaly is investigation evidence, not permission to infer a paid
term. Reconcile affected customers individually against real billing records
through the audited billing workflow. Never print identifiers from this gate or
automatically invent a `paidUntil` value to make a release pass.
