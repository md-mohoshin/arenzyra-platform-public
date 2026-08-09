# Arenzyra Security and Reliability Release Gates

This checklist is the minimum evidence required before the current remediation
work is considered ready for a controlled customer pilot. It does not authorize
a production deployment.

Every box intentionally remains unchecked while the workspace lacks an
immutable reviewed revision, exact retained output, reviewer, and verification
date. An unchecked box does not necessarily mean candidate source is absent;
it means the compound release evidence is incomplete.

## Source and artifact provenance

- [ ] A reviewed commit or immutable source artifact contains every required
      runtime and packaging input.
- [ ] API and web embedded-repository revisions are recorded with the root
      release metadata.
- [ ] A clean checkout can install, generate Prisma, type-check, test, build,
      and package the supported services.
- [ ] Every built service has an immutable, root-owned image manifest bound to
      the validated release environment, exact image ID, and reviewed OCI/Arenzyra
      labels; startup rechecks the running container image ID.
- [ ] Secrets, local databases, uploads, recordings, logs, generated builds,
      and temporary files are absent from the artifact.

## HTTP and native realtime authorization

- [ ] Every state-changing HTTP route has an authenticated actor/workload and
      an explicit role/capability decision.
- [ ] Public routes are covered by an allowlist test; a new `@Public` route
      fails review unless its data-publication contract is documented.
- [ ] Widget read tokens cannot create, bind, trigger, override, finalize,
      reset, hide, or replay widget state.
- [ ] Production WebSocket registration matches the reviewed exact allowlist;
      every retired transport remains free of gateway/subscription metadata.
- [ ] Any re-enabled native telemetry socket authenticates with a rotatable
      producer credential, binds once to an allowed organization/match/source, and
      rejects a different envelope match.
- [ ] Native widget sockets authenticate with a read-only broadcast token and
      cannot subscribe across tenants.
- [ ] Long-lived sockets enforce bounded token/capability expiry and re-check
      revocation, account state, tenant scope, and entitlement after connection.
- [ ] WebSocket origin, connection, message-rate, idle-timeout, and payload-size
      limits have positive and negative tests.

## Tenant isolation

- [ ] Every Prisma model containing tenant ownership is present in the verified
      scoping registry or explicitly documented as global.
- [ ] Submitted tenant identifiers that conflict with actor scope are rejected.
- [ ] Cross-tenant create/read/update/delete tests cover direct, nested, job,
      WebSocket, public-token, and administrative paths.
- [ ] Service credentials are stable, rotatable, audit logged, and bound to
      allowed organization/guild/resource claims.
- [ ] Impersonation preserves the real actor in audit logs and follows an
      explicit privilege policy.

## Authentication and account lifecycle

- [ ] Login, refresh, application, password-reset, invite, and other anonymous
      submissions have bounded DTOs and distributed or production-safe throttles.
- [ ] Deleted, banned, and inactive users cannot log in, refresh, or use an
      access token.
- [ ] Refresh rotation is atomic and detects/revokes token-family reuse.
- [ ] Password-reset and account-invite tokens are random, hashed at rest,
      expiring, single-use, and return enumeration-safe responses.
- [ ] Browser refresh authentication uses a Secure, HttpOnly, SameSite cookie;
      privileged tokens are not persisted in Web Storage.
- [ ] Platform administrators use MFA and seed/startup logs never print
      credentials.

## Discord automation

- [ ] Every command, component, select, and modal passes the central guild,
      organization, actor-role, and entitlement policy.
- [ ] Destructive, official-result, state-creating, and paid/AI operations have
      explicit staff permissions and audit records.
- [ ] Session ownership and authorization survive bot restarts.
- [ ] API calls have cancellation, bounded timeouts, safe idempotent retries,
      and Discord rate-limit-aware backoff.
- [ ] Readiness checks cover Discord shards, API authentication/reachability,
      and scheduler/reconciler freshness.

## Uploads, remote fetches, and AI

- [ ] Accepted files pass byte, magic-signature, decoded-format, dimension, and
      pixel limits before storage or inference.
- [ ] Active formats are rejected/sanitized/rasterized and safe responses use
      `nosniff` plus appropriate disposition/origin isolation.
- [ ] Uploads are private, randomly named, tenant-owned, quota-limited, and
      covered by retention/deletion behavior.
- [ ] Remote fetches allow only approved HTTPS storage origins and reject
      redirects/DNS resolution to loopback, private, link-local, or metadata IPs.
- [ ] OCR/AI requests have organization rate, concurrency, timeout, and budget
      limits and disclose external processing.

## Entitlements and billing

- [ ] Missing/unknown/disabled feature flags deny access.
- [ ] Trial and paid-through expiry are enforced by one canonical decision.
- [ ] Manual billing includes instructions, private proof upload, processing
      status, audit history, the current in-app final-seven-days renewal reminder,
      and denial after expiry.
- [ ] Upgrade and add-on actions change no access until an audited billing
      transition succeeds.

## Desktop and local services

- [ ] Packaged builds accept only HTTPS official API hosts; arbitrary endpoints
      require an explicit development build policy.
- [ ] Local widget HTTP/WebSocket reads use a per-launch capability and strict
      Host/Origin/CORS policy; mutations use authenticated non-GET operations.
- [ ] The launcher tracks owned child processes and never kills an unknown port
      listener.
- [ ] Desktop artifacts are minimal, signed, and verified against a trusted
      release manifest before installation/update.

## Recovery, deployment, and operations

- [ ] PostgreSQL plus uploads/storage have encrypted off-host backups,
      monitored age, documented RPO/RTO, and a successful isolated restore drill.
- [ ] A pre-migration recovery point exists before production migrations.
- [ ] Pending contract/destructive migrations are classified in the release
      manifest and cannot run beside an incompatible old writer; contract work uses
      reviewed expand/contract or controlled maintenance.
- [ ] Legacy IDP plaintext schedule count is verified as zero after the manual,
      writer-stopped backfill; deployment never runs that backfill implicitly.
- [ ] A read-only production entitlement inventory reports zero inconsistent
      non-deleted organizations after individual reconciliation against real
      billing records; no blanket status or paid-through backfill is accepted.
- [ ] The default-unpublished migration has current affected counts and a
      reviewed selective republish plan for intended public tournaments/matches.
- [ ] Pending-invite expiry and widget/broadcast 180-day capability cutovers
      have current counts, customer notices, and explicit reissue/rotation owners.
- [ ] The lossy legacy OCR source-link scrub has a repeated affected-row count,
      explicit evidence-purge approval, and a verified restore point.
- [ ] Existing platform super administrators have an MFA enrollment,
      recovery-code, refresh-session invalidation, and audited break-glass plan.
- [ ] Restore drills extract volume archives into isolated contained targets and
      reject links, special files, and traversal instead of only listing tar entries.
- [ ] The deploy command chains configuration validation, the required disk and
      service preflight, immutable release metadata, update, readiness, public HTTPS
      verification, and release-version confirmation.
- [ ] The production launcher starts from a clean parent environment so
      `BASH_ENV`, `ENV`, `NODE_OPTIONS`, `NODE_PATH`, and ambient `GIT_*` overrides
      cannot run before release validation.
- [ ] A fresh production disk/service preflight runs after the potentially
      space-consuming pre-migration backup and immediately before API migration.
- [ ] The production PostgreSQL image, exclusive data-volume attachment,
      unpublished-port policy, network, database/schema/port/version, and durable
      cluster `system_identifier` all match reviewed release inputs.
- [ ] App roles are confined to the reviewed database by exact HBA/database ACL
      policy; implicit `PUBLIC CONNECT`/`TEMPORARY` on other databases is absent.
- [ ] A reviewed cluster allowlist rejects unexpected login/privileged roles and
      configured-role authority through system-schema ACLs/ownership, large objects,
      tablespaces, parameter ACLs, or FDW/server/user mappings.
- [ ] Existing object ownership is migrated only with an explicit
      writer-stopped, session-zero command sheet; no blanket `REASSIGN OWNED`,
      `\gexec`, or superuser service URL is used.
- [ ] Database-writing maintenance jobs use task-specific least-privilege roles
      or have an explicitly approved, time-bounded exception for broader authority.
- [ ] API and Studio relations, ledgers, sequences, enum types, functions, and
      trigger wirings match a committed fail-on-unclassified object policy rather
      than automatically trusting every migrator-owned future object.
- [ ] RLS is either absent and fail-closed by the database-role gate, or every
      policy is present in a reviewed manifest with adversarial tenant-isolation
      tests.
- [ ] Cleanup is scoped to Arenzyra-labelled resources and cannot prune volumes
      or unrelated projects.
- [ ] `/health/live` and `/health/ready` have separate semantics.
- [ ] Structured logs, correlation IDs, metrics, alerts, and audit records cover
      authentication, authorization failures, telemetry lag/rejection,
      finalization, Discord automation, OCR/AI, database pressure, disk, and backup
      freshness.

## Product and privacy

- [ ] Homepage, plan entitlements, application, approval, trial, billing, and
      launcher messaging describe the same offer.
- [ ] The first-run path measures privacy-safe activation milestones through
      first approved/published result and renewal.
- [ ] Protected, invite, review, runtime, API, and design-preview routes have
      correct `noindex`/robots/canonical behavior.
- [ ] Terms/privacy identify the actual legal entity and jurisdiction and cover
      retention, subprocessors, external AI processing, cancellation, deletion,
      minors, and complaint/contact procedures after professional review.

## Verification record

For each checked item, link the implementation, test command/output, reviewer,
artifact/source revision, and verification date. A skipped test must record the
reason and residual risk. Production deployment remains subject to the
repository `AGENTS.md` preflight and post-deployment verification rules.
