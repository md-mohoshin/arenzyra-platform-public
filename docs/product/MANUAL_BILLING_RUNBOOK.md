# Manual billing runbook

## Scope

Arenzyra manual billing stores a private payment-proof image and a durable,
auditable review record. It is not an invoice generator, card processor, or
automatic bank-payment verifier. A successful upload means **pending review**;
it never activates access by itself.

The application also does not automatically match the submitted amount or
currency to the selected plan price. A reviewer must reconcile the payment,
currency, fees, customer, and intended paid-through date against the external
payment record before approval.

The recommended USD pilot offer remains PUBG Production at **$29.99/month**
with a seven-day trial that starts after setup approval when the owner completes
account setup. Discord Bot Pro at $18.99/month is the down-sell, and Auto
Launcher at $59.99/month is available only for supported, approved telemetry
sources as a request-only private software pilot;
custom integration and live-event work require a separate written quote.
Validate these prices with real organizers before adding payment-provider
automation or annual discounts.

## Organizer workflow

1. While authenticated to an entitled workspace, an ADMIN or ORGANIZER opens
   Client Portal and uploads exactly one PNG, JPEG, or WebP proof. The configured
   maximum is 1-12 MiB and defaults to 8 MiB.
2. The browser sends a UUID v4 idempotency key. A retry must use the same key
   and identical fields/file. Reusing it for different content or from another
   user is rejected.
3. The portal shows the durable PENDING/CLAIMED/APPROVED/REJECTED/CANCELLED
   history. An ORGANIZER sees only their own submissions; an ADMIN sees the
   tenant's submissions.
4. A still-PENDING row can be cancelled with its current version. Once it has
   been claimed, the organizer must contact support.

ADMIN and ORGANIZER are the customer roles for this workflow. A real
SUPER_ADMIN may also use the organizer endpoint as a platform operator, but
that does not replace the non-impersonation, fresh-MFA, claim, and audit rules
for review actions.

Expired users cannot enter the authenticated portal to upload a new proof.
Public and expired-state copy must direct them to Arenzyra billing/support and
must not promise an upload path that authentication will deny.

During the final seven days of a current paid-through period, the client portal
shows an in-app renewal warning and directs the organizer to request confirmed
instructions and upload proof before expiry. This is the pilot renewal reminder;
it is not a claim that email, SMS, or automatic collection has been configured.

## Reviewer workflow

Only a real, non-impersonated SUPER_ADMIN satisfying the platform MFA policy
can use the review queue.

1. Open `/super-admin/billing` and select the oldest pending submission.
2. Claim the current version before viewing or acting on its private details.
3. Inspect the authenticated proof image and reconcile the payment outside the
   application.
4. Confirm that the proof is still available and unexpired. An expired or
   unavailable proof cannot be approved; reject it with a useful reason and
   request a new submission.
5. Approve only with a reason and a `paidUntil` strictly in the future and no
   more than 366 days away. The entered value is the absolute replacement
   paid-through date, not a duration added to the current boundary, and it must
   strictly extend any later existing `paidUntil`. Approval atomically records
   the review, marks the proof reviewed, activates the organization, clears
   trial dates, sets that absolute paid-through date, invalidates stale
   authentication, and writes an audit entry.
6. Otherwise reject with a useful reason. Release an owned claim when handing
   it back. Another reviewer may release it only after the configured stale
   claim lease; audit history retains the previous and new claim ownership and
   timestamps.

Every reviewer action uses optimistic version matching. On a conflict, reload
the detail instead of repeating an action against stale data. Direct
subscription correction on the organization page is a secondary recovery
tool, not the normal payment-proof workflow.

## Entitlement invariant

- `ACTIVE` grants access only when `paidUntil` is present and in the future;
  `trialEndsAt` must be null.
- `TRIALING` grants access only when `trialEndsAt` is present and in the future;
  `paidUntil` must be null.
- Every other status, missing boundary, or elapsed boundary fails closed.

The deployment gate checks the stored shape, not whether a clock is still in
the future: `ACTIVE` must have only `paidUntil`, `TRIALING` must have only
`trialEndsAt`, and `EXPIRED` must have neither. This keeps natural expiry
fail-closed at runtime without requiring an automatic status write or causing a
deployment to fail solely because a timestamp elapsed mid-release. A reviewed
manual change to `EXPIRED` clears both clocks.

Widget and broadcast capability resolution and delivery must re-check the same
invariant. Widget delivery must also re-check organization widget approval when
approval enforcement is enabled, so revocation takes effect without waiting
for an issued capability to expire.

## Notification and recovery behavior

The submission and its notification outbox row commit in the same database
transaction before SMTP is attempted. SMTP outages never roll back or hide a
submission. The bounded background worker claims due rows, retries with
backoff, recovers stale claims, and stops waiting after the configured graceful
shutdown timeout.

Notification email contains only submission ID, organization ID/name,
submission time, and the authenticated admin review link. It must never contain
the amount, payment reference, organizer message, proof bytes, or private asset
path.

Use the authenticated super-admin notification-delivery endpoint for a bounded
manual retry. Use the bounded reservation-cleanup endpoint for old FAILED or
abandoned reservations. Do not delete billing rows, proofs, audit logs, or
storage files directly to resolve a queue problem.

## Required configuration

At minimum, configure SMTP and `ARENZYRA_BILLING_REVIEW_EMAIL`. The checked-in
environment examples also document proof retention, reservation lock/cleanup,
review-claim lease, outbox claim/interval/batch/shutdown, and SMTP connection,
greeting, and socket timeouts. Production publish preflight verifies the
compose wiring and requires the review address; it does **not** establish an
SMTP connection or prove delivery. Before customer use, send and receive a
non-sensitive test notification through the configured provider and retain the
delivery evidence.

Payment proofs use private-asset storage and the configured
`PAYMENT_PROOF_RETENTION_DAYS` (default 90). They are served only through the
authenticated private-asset endpoint; never copy their storage key or create a
public URL.

## Production release checklist

Before any production build, pull, recreate, restart, or compose operation,
run the required deployment preflight in `/opt/arenzyra` and stop if it does not
exit 0. Apply the additive billing migration only through the approved release
process. Do not backfill existing subscription rows, prune Docker volumes, or
delete production data to make room.

A routine full deploy runs the read-only entitlement invariant gate before
release metadata, builds, backup, migration, or service replacement. Its single
aggregate query covers only non-deleted organizations and emits counts without
IDs or other row data. It blocks on a query or parse failure, unknown status, or
any non-canonical `ACTIVE`, `TRIALING`, or `EXPIRED` stored shape. Deployment never
changes rows to make the gate pass. A first deploy may skip this query only
after Postgres is healthy and a separate read-only catalog query proves that
the target has zero application relations; `--first-deploy` by itself is not an
empty-database guarantee.

If the gate blocks, use a reviewed writer-stopped reconciliation with a fresh
verified off-host backup, audited target selection, and recorded before/after
counts. Keep identifiers and private billing details out of gate output. Rerun
the read-only gate and require zero inconsistent counts before continuing the
standard release. Do not add an automatic migration or deployment backfill.

The reviewed argument-free one-time `legacy-cutover` is the only shipped
exception to the routine block. It accepts only the aggregate legacy shape in
which every inconsistent `ACTIVE` row already has `paidUntil` and differs solely
because `trialEndsAt` is still present. Missing paid clocks and every other
status/shape remain blocked. The cutover records aggregate before/updated/after
counts without identifiers and, only after its fresh verified off-host backup,
stopped writers, target-database attestation, and durable login fence, clears
that stale field in the same serializable transaction as the exact historical
migration-ledger reconciliation. It does not change status, `paidUntil`,
`updatedAt`, deleted organizations, billing proofs, or audit rows. A normal
deploy has no entitlement exception.

After release, verify API/container health and the public HTTPS endpoint, then
exercise one non-sensitive test submission through the UI and confirm:

- one submission and one outbox row exist;
- the queue list is redacted while authenticated detail can load the proof;
- claim/release version conflicts fail closed;
- an SMTP failure leaves the submission durable and retryable; and
- a subsequent successful SMTP retry reaches the configured review inbox;
- approval produces a future paid-through entitlement and invalidates stale
  access.
