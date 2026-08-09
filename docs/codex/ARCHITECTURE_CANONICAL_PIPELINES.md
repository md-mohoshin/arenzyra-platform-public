# Arenzyra Canonical Architecture and Pipelines

## Purpose

This document defines the supported production architecture for Arenzyra. It is
the decision record for service ownership, tenant boundaries, live-match
authority, final results, public broadcast access, Discord automation, and
legacy compatibility.

If implementation and this document disagree, the implementation must be
treated as drift and corrected deliberately. Compatibility code may translate
old inputs at an edge, but it must not create a second source of truth.

## Non-negotiable invariants

1. Every tenant-owned request is scoped from an authenticated actor or a
   high-entropy credential whose claims include the organization and permitted
   resource. A submitted `organizationId` is never authorization.
2. The API is authoritative for organization, tournament, match, live
   aggregate, entitlement, and final-result state.
3. Live player state has one writer: the telemetry engine for `API` matches.
   Manual matches use explicit authenticated control operations.
4. `LIVE` state is telemetry state. Official results are database state. Live
   transport payloads never write official result rows directly.
5. Final results materialize once through the canonical match-conclusion and
   results services, transactionally, after human review where required.
6. Web pages, Next.js routes, desktop widgets, and Discord consumers render or
   transport canonical API contracts; they do not invent lifecycle, scoring,
   elimination, or ranking truth.
7. Public read access is explicit and revocable. OBS/browser-source reads use a
   scoped broadcast token. All mutations require authenticated operator
   permission or a separate scoped control capability.
8. Entitlements deny by default. A missing feature, expired trial, expired paid
   period, disabled add-on, or unknown plan never grants access.
9. Production changes come from a reproducible reviewed artifact, run the
   production preflight immediately before mutation, and are verified after
   deployment. Persistent data always has a tested recovery path.

## Runtime topology

```text
Public users / organizers / OBS
               |
            Caddy
          /       \
       Web         API
        |       /   |   \
        |   Postgres Redis Media AI
        |          |
        +------ canonical contracts
                   |
        Desktop observer / Discord bot
```

- Caddy is the only public production edge.
- PostgreSQL is the durable system of record.
- Redis is transport/cache/coordination infrastructure, never the sole durable
  owner of official results or entitlement state.
- The web service may use its own narrowly scoped persistence only when the
  data has an explicit owner and migration path. It must not receive broad
  production database credentials or create API-owned tables at runtime.
- Media AI is an internal bounded worker. It does not accept public traffic or
  own user/media metadata.
- Exactly one production Discord gateway bot is active.

## Identity and trust boundaries

| Caller | Credential | Required scope | Permitted use |
| --- | --- | --- | --- |
| Browser organizer | Short-lived access session plus secure refresh session | User, role, organization | Organizer UI and authorized mutations |
| Super admin | Strong session with MFA | Platform administration; audited impersonation | Explicit platform operations |
| Desktop producer | Rotatable producer credential | Organization, match, source, seat/device | Telemetry ingress for one authorized match |
| OBS/browser source | Revocable broadcast token | Organization, widget, optional match/tournament, read-only | Render canonical widget payloads |
| Widget controller | Authenticated operator or separate control capability | Organization, widget, allowed actions | Play/hide/replay/override operations |
| Discord bot | Rotatable per-organization/guild service credential | Organization and Discord guild | Approved automation and publishing |
| Internal worker | Workload credential | Named queue/job/resource | Bounded background processing |

Credentials are never accepted from a query/body organization identifier
without validating the credential's own scope. Service identities are stable;
their organization ownership is not mutated per request.

## Canonical customer pipeline

```text
Application
  -> approval
  -> expiring account invitation
  -> organization + entitlement
  -> Discord connection
  -> event/tournament setup
  -> teams and slots
  -> matches
  -> reviewed result input
  -> official standings
  -> Discord and OBS publication
  -> renewal
```

- Rejected or pending applicants do not need an active credential.
- Password setup happens through an expiring, single-use invitation after
  approval.
- Activation milestones are recorded without storing unnecessary personal or
  match payload data in analytics.

## Match setup and lifecycle

The only supported lifecycle is:

```text
READY -> LIVE -> FINISH_PENDING -> FINISHED
```

Legacy states are normalized at read/compatibility boundaries only. New
control flow must not branch on legacy states.

Supported source modes are:

- `API`: a scoped desktop/producer credential sends telemetry to the API.
- `MANUAL`: an authenticated operator enters reviewed match facts/results.

Legacy `PCOB`, `SHADOW`, `AUTO`, `SIMULATOR`, and `HYBRID` values may be read for
old records, but must not be offered for new setup or become independent live
authorities.

## Live telemetry pipeline

```text
Authorized desktop producer
  -> authenticated, match-bound ingress
  -> schema and size validation
  -> raw-event retention/deduplication
  -> telemetry engine
  -> canonical live aggregate DTO
  -> realtime fan-out / bounded cache
  -> web, desktop, OBS, Discord consumers
```

Rules:

- The ingress credential is bound to organization, match, producer/source, and
  an expiry or revocation record.
- A socket cannot replace its bound match from an event envelope.
- Missing or delayed packets never mean eliminated.
- The API alone derives alive teams, active/knocked/eliminated players,
  placement, kill feed, WWCD, match points, and live standings.
- Repair/recovery code may restore the canonical DTO from authoritative event
  history; it may not apply a competing scoring or elimination algorithm.
- Native WebSocket and Socket.IO transports enforce the same authentication,
  organization isolation, payload limits, connection limits, and audit rules.

## Result and finalization pipeline

```text
Telemetry terminal evidence OR reviewed OCR/manual input
  -> FINISH_PENDING
  -> validation and human correction where required
  -> MatchConclusionService
  -> ResultsService transaction
  -> MatchSlotResult / player result rows
  -> FINISHED
  -> standings + publication outbox
```

- No official result writes occur while the match is `LIVE`.
- Raw provider payloads and frontend routes never write final result rows.
- Finalization is idempotent and runs once for a match version.
- Side effects such as Discord posts, webhooks, renders, and notifications use
  an outbox/retry mechanism after the result transaction. A failed side effect
  does not roll back or silently recompute official results.
- Every authoritative transition records actor/workload, organization, match,
  previous state, new state, correlation ID, and outcome.

## Widget and broadcast pipeline

```text
Canonical API live/results DTO
  -> widget projection service
  -> scoped read-only broadcast endpoint/realtime room
  -> OBS/browser renderer
```

- Widget projections may format, filter, or add branding. They do not derive an
  alternate leaderboard, elimination, lifecycle, or scoring result.
- Public widget URLs contain a high-entropy revocable token, not a bare
  organization slug/ID as the authorization mechanism.
- Read and control capabilities are separate. A read token cannot trigger,
  override, finalize, reset, or rebind a widget.
- Direct observer routes are compatibility transports only and must converge
  on the canonical API projection. Production defaults disable raw/debug
  exposure and direct upstream access.

## Discord pipeline

```text
Discord interaction
  -> central interaction authorization
  -> linked guild + organization + actor role + entitlement
  -> API command
  -> durable operation/audit state
  -> idempotent Discord reconciliation or publication
```

- Every command, button, select, and modal passes the same central policy.
- Discord default permissions improve discoverability but are not the security
  boundary.
- Destructive, result-changing, state-creating, and paid/AI operations require
  explicit staff permission.
- Session/creator ownership is durable and survives bot restarts.
- HTTP calls have cancellation, bounded timeouts, idempotent retry rules, and
  rate-limit-aware backoff.

## Tenant data ownership

- Every tenant-owned durable model is present in a generated or verified
  scoping registry.
- Services derive organization scope from the actor/workload context.
- Writes reject a conflicting organization identifier instead of overwriting
  or accepting it.
- Cross-record relationships validate common organization ownership.
- Critical tenant tables use database constraints and, where practical,
  PostgreSQL row-level security as defense in depth.
- Background jobs, WebSockets, public-token reads, raw SQL, nested writes, and
  administrative impersonation have explicit tenant tests.

## Entitlements and billing

- Plan, add-on, trial, paid-through date, cancellation, and access overrides
  have one canonical backend decision function.
- Missing or disabled flags remain disabled.
- Billing transitions are idempotent and audited.
- Manual payment is supported through confirmed payment instructions (and any
  invoice issued separately outside the application), private proof upload,
  admin processing queue, status, and the in-app final-seven-days renewal
  reminder. The application is not an invoice generator or payment verifier.
- A future payment provider feeds the same entitlement ledger through verified
  idempotent webhooks; it does not create a second access model.

## Media and AI processing

- Uploads are private by default and owned by an organization/resource.
- File signatures and decoded content must match the accepted format. Active
  formats are rejected, sanitized, or rasterized; filenames are random.
- Images are decoded with byte, dimension, and pixel limits before expensive
  processing, then re-encoded into a safe output format.
- Remote fetches are limited to approved HTTPS storage origins with DNS/IP and
  redirect controls. Local, private, link-local, and metadata addresses are
  rejected.
- AI/OCR use is rate-, concurrency-, and budget-limited per organization. The
  UI and privacy policy disclose external processing and retention.

## Health, observability, and recovery

- `/health/live` answers whether the process can serve.
- `/health/ready` verifies required database, migration, Redis/queue, and
  internal dependency state without depending on optional external providers.
- Logs are structured and include request/correlation ID, service, operation,
  organization/resource identifiers where appropriate, and a redacted error.
- Alerts cover ingest lag, dropped/rejected telemetry, websocket churn,
  finalization failures/latency, Discord rate limits, OCR failures/cost,
  database pool pressure, volume capacity, and backup age.
- PostgreSQL and user uploads/storage have encrypted off-host backups,
  monitored retention, a pre-migration recovery point, documented RPO/RTO,
  and scheduled restore drills.

## Deployment contract

Production deployment is one guarded workflow:

```text
clean reviewed source/artifact
  -> configuration validation
  -> production-deploy-preflight.sh
  -> release metadata/digest
  -> migration recovery point
  -> guarded Compose update
  -> container readiness
  -> public HTTPS and release-version verification
  -> documented rollback decision
```

No production deployment starts unless the required preflight exits `0` in
the same session. Production volumes are never pruned.

## Legacy and deprecation register

The following surfaces are compatibility candidates, not new feature homes:

- legacy realtime module beside the canonical realtime transport;
- `match-state-service`;
- `shadow_api`;
- older system launcher;
- standalone overlay server and duplicated root runtime proxies;
- direct observer web logic that re-derives live aggregates;
- legacy PCOB/shadow setup and control paths.

For each candidate, record current callers, production usage evidence, data it
owns, replacement, removal gate, and rollback plan. Quarantine or remove only
after clean-clone tests and runtime telemetry prove it is unused.

## Change checklist

Any change touching authentication, tenant scope, telemetry, lifecycle,
results, widgets, billing, Discord automation, media, migrations, or deployment
must include:

1. The authoritative owner and contract affected.
2. Tenant and credential boundary analysis.
3. Happy-path, unauthorized, cross-tenant, stale/replay, and failure tests.
4. Structured logs/metrics for the authoritative transition.
5. Migration, compatibility, and rollback notes.
6. Verification from a clean checkout or isolated build context.
