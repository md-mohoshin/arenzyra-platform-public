# Production read-only audit — 2026-08-05

Initial audit window: 2026-08-05 00:10–01:11 UTC; final read-only recheck:
2026-08-05 03:52 UTC.

This audit used only HTTPS requests, `docker inspect`, aggregated `docker logs`,
and read-only PostgreSQL `SELECT` statements against `/opt/arenzyra`. It did not
build, pull, recreate, restart, migrate, backfill, invoke a Discord command, or
run Compose. No customer identity, payment proof, room credential, token, or
other row-level private data was selected.

The production deployment preflight was not required because no production
mutation or deployment command was started.

## Live service evidence

- `infra-api-1`: running, healthy, zero restarts; started
  `2026-08-03T09:01:42Z`.
- `infra-discord-bot-1`: running, healthy, zero restarts; started
  `2026-08-03T09:10:19Z`.
- `infra-postgres-1`: running, healthy, zero restarts.
- `https://api.arenzyra.com/health`: HTTP 200.
- `https://arenzyra.com/`: HTTP 200.
- `https://api.arenzyra.com/health/live`: HTTP 404.

The API, Discord bot, PostgreSQL, API health endpoint, and web homepage were
rechecked at the end of the audit window with the same healthy/running,
zero-restart, and HTTP 200 results.

The missing candidate liveness route and the pending migration inventory prove
that the live services are the prior release, not the reviewed candidate. The
archived `CURRENT` release pointer is absent. The non-secret deployment file
identifies the live artifact only as
`source-digest-20260801-050716822-3412d0c938fd`.

## Candidate migration state

All 12 candidate migrations from the current remediation window are pending in
production:

- `20260804120000_auth_password_actions`
- `20260804123000_application_attribution`
- `20260804230000_match_publication_boundary`
- `20260805010000_harden_tournament_invite_lifecycle`
- `20260805020000_refresh_token_families`
- `20260805021000_idp_encrypted_credential_storage`
- `20260805030000_broadcast_capability_lifecycle`
- `20260805030000_conditional_ban_enrollments`
- `20260805040000_platform_superadmin_mfa`
- `20260805050000_private_assets_and_screenshot_evidence`
- `20260805060000_durable_manual_billing`
- `20260805070000_widget_capability_lifecycle`

This was an inventory only. No migration was applied.

## Entitlement cutover inventory

The final gate-shaped aggregate query ran with PostgreSQL transaction-default
read-only mode and returned eight counts only. Among 10 non-deleted
organizations:

- 8 are `ACTIVE`;
- 2 are `TRIALING`;
- 0 are `EXPIRED`; and
- 0 use an unknown status.

The earlier time-bound aggregate classified 7 `ACTIVE` and 1 `TRIALING` row as
inconsistent, but that predicate incorrectly made natural clock expiry a deploy
failure and is superseded. At `2026-08-05 02:04 UTC`, the corrected
aggregate-only storage-shape gate found 4 of 8 `ACTIVE` rows inconsistent
(`paidUntil` missing or `trialEndsAt` populated), 0 of 2 `TRIALING` rows
inconsistent, and no `EXPIRED`/unknown-status inconsistency. Exactly 4 rows must
therefore be reconciled individually against real
billing records before the candidate API can replace the live API. There must
be no blanket paid-through backfill or automatic activation.

## Customer-visible migration inventory

- 17 non-deleted tournaments and 598 non-deleted matches will receive the new
  fail-closed unpublished default. An organizer must explicitly review and
  publish the intended public surfaces; never publish everything by default.
- 0 pending tournament invites currently face the seven-day expiry cutover.
- The refresh-family migration will backfill and index 10,365 existing refresh
  token rows. Its lock duration must be measured on a restored production copy
  and included in the maintenance window.
- 10 legacy organization broadcast keys require the reviewed capability
  migration and a rotation/reissue notice before their 180-day migration
  expiry.
- 37 legacy widget keys require the same reviewed rotation/reissue plan.
- 701 match-control rows exist, but 0 currently contain the legacy OCR
  `sourceImages` or `sourceImageUrl` evidence fields targeted by the lossy
  scrub. The affected count must be repeated immediately before controlled
  maintenance because production can change.
- 12 IDP schedule rows still use the legacy plaintext storage shape; none is
  upcoming. They still require the documented writer-stopped encryption
  backfill and a verified plaintext count of zero. They were not deleted or
  changed by this audit.
- 4 active platform super-administrator accounts currently have 5 unexpired,
  unrevoked refresh tokens. The candidate MFA migration gives existing refresh
  rows no verified-MFA timestamp, so the rollout needs an enrollment,
  recovery-code, session-revocation, and audited break-glass plan before the
  candidate login gate is enabled.

## Discord bot log evidence

The last 24-hour sample contained 41,427 log lines and no `fatal`, `unhandled`,
`uncaught`, or `panic` pattern. A broad warning/error-token scan found 388
lines, including 157 successful summaries containing `failed=0`. Material
recurring categories were:

- 192 saved-team-logo backfill download failures;
- 18 team-cleanup business-rule rejections;
- 2 button-action business-rule failures; and
- 3 batch summaries with a non-zero failed count.

Container health is therefore good, but the old release is not operationally
noise-free. The saved-logo failures need a separate, privacy-safe stale-source
inventory and remediation plan; this audit did not retry, delete, or rewrite
any Discord or database state.

### Final read-only recheck — 2026-08-05 03:52 UTC

The production-only observation was repeated from `/opt/arenzyra` after the
candidate verification work. It used `docker ps`, `docker inspect`, a bounded
server-side aggregate over `docker logs`, and HTTPS requests only. It did not
run Compose, a build, a package test, a Discord command, a restart, a migration,
or any database query/write.

- The single `infra` API, Discord bot, and PostgreSQL containers were running,
  healthy, and still at zero restarts.
- The live PostgreSQL container still records the mutable
  `postgres:16-alpine` image reference. The candidate physical-target gate
  requires its reviewed 16.14 digest, so this observation is not candidate
  database-identity evidence.
- API `/health` and the web homepage returned 200; candidate `/health/live`
  still returned 404. The API had no release-version label and the bot retained
  its prior `map-catalog-discord-20260803T080439Z` label, confirming that this
  was observation of the old deployment rather than candidate validation.
- The bounded 24-hour/50,000-line bot-log pass saw 41,506 lines and zero
  `fatal`/`unhandled`/`uncaught`/`panic` patterns. It counted 248 recurring
  saved-team-logo failures, 18 team-cleanup rejections, 2 button-action
  failures, 3 summaries with a nonzero failed count, and 156 successful
  `failed=0` summaries. Only aggregate counts were returned; no log line,
  customer identifier, token, room credential, or message content was exposed.

## Decision

Do not deploy the current working tree. Before controlled maintenance, freeze a
reviewed clean artifact, rerun these aggregate queries, approve every migration
impact, create and verify the required encrypted off-host recovery point, and
close the entitlement, publication, capability, OCR-evidence, and IDP cutover
plans. Every production build, restart, migration, or Compose operation remains
subject to the required `/opt/arenzyra` preflight in the same working session.
