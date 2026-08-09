# Arenzyra end-to-end review

Evidence refreshed: 2026-08-09

## Status

The candidate is materially safer and now has clean local Web and canonical API
revisions plus reviewable Root checkpoints. It is **not a production-ready
release artifact**. This review does not authorize a deployment, migration,
customer-state change, payment, or a claim of literal 100% correctness.

Do not build a separate generic application. The recommended commercial
hypothesis is **Arenzyra PUBG Production**, an assisted workflow from Discord or
slot-list setup through match control, reviewed results, standings, OBS output,
and Discord publication.

For new candidate offers only:

- **PUBG Production - $29.99/month** is the planned founding offer;
- **Discord Bot Pro - $18.99/month** is the intended low-touch downsell; and
- **Auto Launcher - $59.99/month** is a request-only private pilot after its
  telemetry, approved-recording, approved-map, packaging, and signing gates
  pass.

These prices do not automatically reprice legacy entitlements or separate
YouTube automation plans. The planned seven-day trial would activate only when
the approved owner's single-use secure account-setup transaction succeeds,
without overwriting a later billing decision. That behavior is integrated in
the clean candidate, but public applications remain disabled and it must not be
promised to customers before the production gates below pass.

This is a price and customer hypothesis, not an earnings promise. The operating
and 30-day validation gates are in
[`ARENZYRA_MONETIZATION_DECISION.md`](../product/ARENZYRA_MONETIZATION_DECISION.md).

## Source identity and evidence boundary

The release work uses three independent Git repositories. Root does not track
the nested Web repository as content or as a gitlink.

| Tree                                                      | Audited revision                                | Status at this checkpoint                                                        |
| --------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Root release assembly                                     | `codex/root-final-release-integration-20260809` | isolated release branch; this review travels with the selected final Root commit |
| Canonical API worktree (`apps/api`)                       | `a8e932ba3e8f52a8a086cfcf90d4a078a31ae6e3`      | clean exact detached head                                                        |
| Web runtime source/build checkpoint (`apps/arenzyra-web`) | `62cb97a`                                       | clean runtime source used by the focused setup/build evidence                    |
| Web pricing-test checkpoint (`apps/arenzyra-web`)         | `642d22d2a2b8329faf0756bd0520295cfa05f511`      | clean assertion-only descendant of `30c684a`                                     |

The dirty legacy `apps/api` tree at
`54dd78c91ac15747c3ded2d1e5c99fd31c8d9b8a` is not release identity. Its
moving working state must not be substituted for the canonical API revision.

The former 24 Root exclusions were three unapproved brand assets (two PNGs and
one SVG) plus 21 publishing/marketing paths (19 scripts, one JSON file, and one
Markdown document). They were not committed or executed. On 2026-08-09, all 24
were hash-verified into two external quarantine copies; the 21 untracked files
were moved there and the three tracked assets were restored to their committed
versions. Recovery details are in
[`ROOT_EXCLUSIONS_QUARANTINE_20260809.md`](ROOT_EXCLUSIONS_QUARANTINE_20260809.md).

Generated dependencies, build caches, local runtime data, uploads, recordings,
backups, and binary installers are not source identity. Before remediation, an
external recovery snapshot and Git bundles were written at
`C:\Arenzyra-safety-snapshots\arenzyra-pre-remediation-20260804-210615`.
Its manifest SHA-256 is
`A42876FA86EFEDF7D96B284A8B97C1FF0747AE8BB766AE677311BDD384EAB566`.
That is local source recovery, not a production-data backup.

## Current retained verification

| Area                    | Retained result                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical API           | At `a8e932b`, full Jest passed 190/190 suites and 1,481/1,481 tests; normal and maintenance builds, Prisma validate/generate, full lint/format, and the 18/18 image-boundary suite passed. Disposable database replay remains separate evidence.                                                                                                                                                                                                  |
| Web source/build        | Runtime source `62cb97a` passed the focused secure-setup suite 7/7 and production build. Pricing-test parent `30c684a` passed canonical pricing consistency 6/6 and targeted ESLint; final assertion-only head is `642d22d`.                                                                                                                                                                                                                      |
| Web browser             | The earlier full single-worker Chromium 150/150 result belongs to the earlier recorded Web checkpoint; it is historical regression evidence, not a rerun against the final Web assertion-only head.                                                                                                                                                                                                                                               |
| Web production package  | The earlier bounded runtime-package and 79-page build inventories remain historical boundary evidence; focused final build evidence is scoped to the runtime head above.                                                                                                                                                                                                                                                                          |
| Desktop                 | Exact-final full suite passed 289/289 across 38 files; 76/76 launcher-release tests and 42/42 PCOB coverage tests passed; TypeScript and full ESLint passed.                                                                                                                                                                                                                                                                                      |
| Root production policy  | The isolated release-gate suite passed all 178 executable tests across the 22 scoped files; one POSIX FIFO fixture was skipped on Windows. Bash syntax passed for all 10 changed shell files and Node syntax passed for all 31 changed/new CommonJS files. The ownership-adoption fence also passed against an isolated PostgreSQL 16.14 clone with exact 132 API-table, 7 Studio-table, 69-enum, and 2 policy-function ownership postconditions. |
| Pricing consistency     | Canonical-root-aware pricing consistency passed 6/6; canonical customer catalog parity is complete while public acquisition remains hard-disabled.                                                                                                                                                                                                                                                                                                |
| Migration checksum gate | Candidate checksum/classification policy is bound to exact migration bytes; real production-ledger comparison and disposable replay remain outstanding.                                                                                                                                                                                                                                                                                           |

The passing Chromium run still emitted recurring development-only React
script-tag diagnostics and Fast Refresh reload warnings. The likely source is
the inline `beforeInteractive` stale-chunk recovery script, not user-controlled
content. Do not blanket-suppress the warning; retain a focused built-runtime
regression for the recovery path and recheck it on the next Next/React upgrade.

No Electron build, installer, package, signing operation, or desktop runtime was
performed.

No local Discord-bot Docker, build, test, runtime, or guild interaction was
started. Current-candidate Discord verification is production-host-only under
`/opt/arenzyra`, using the clean-parent environment and required preflight, with
gateway credentials unavailable to the test process and no second bot runtime.

No local Docker or Compose image build was run. API database-writing E2E, live
SMTP/payment reconciliation, approved recording-backed PCOB validation,
installer/signature verification, and an isolated production-data restore
drill remain unproven.

## Material safety boundaries completed

- The clean canonical API and Web now share deferred single-use account setup
  and setup-time trial activation. Public acquisition remains hard-disabled;
  this completed source integration is not production authorization.
- Authentication, refresh-family reuse response, account state, service
  identities, platform-superadmin MFA, tenancy, private assets, public
  publication, manual billing, SMTP outbox, Redis throttling, and browser token
  storage received source-level fail-closed controls and regression coverage.
- Web, API, and the opt-in Discord pricing publisher use the aligned canonical
  ladder/catalog contract. Public organization applications remain disabled.
- Studio persistence uses explicit migrations rather than runtime schema DDL.
  Runtime and publish preflight reject insecure, unknown, or URL-overridden
  PostgreSQL TLS modes; explicit trusted-network no-TLS remains an affirmative
  configuration.
- Web deployment now uses a bounded npm-packlist boundary and modern injected
  pnpm workspace deploy. Docker no longer recopies source build output around
  that boundary. The verifier rejects build cache/dev output, unexpected
  top-level paths, broken or escaping links, and oversized packages.
- Production migration safety now binds every applied ledger row to the exact
  candidate SQL checksum and ordered lineage prefix before mutation. Actual
  production checksums and the held candidate lineage remain unverified.
- The desktop connector has a dedicated per-launch capability, no browser CORS
  path, bounded native loopback ingress, trusted child source/dependencies,
  sanitized environment, trusted Windows executable resolution, and atomic
  no-follow repair. UAC/temp-script repair was removed.
- Desktop production packaging is blocked in code. A separate ASAR/fused
  candidate scaffold is non-publishable and requires `--publish never`.
  Signer/TSA policy remains deliberately empty and unapproved.

Dirty-candidate overlay counts and migration holds were reconciliation aids,
not release-completion targets. They are historical and are not substituted for
the exact clean canonical API, Web, and Root assembly identified above.

Secure invite-only onboarding is integrated end to end in the canonical API and Web: approval creates an inactive account with deferred, single-use fragment-token setup, verified SMTP delivery activates the token, and account setup atomically sets the password and activates the user.
The canonical catalog/pricing contract is aligned and public organization applications remain hard-disabled.
This does not authorize production: deployment remains fail-closed on the observed mixed/non-Git source, PostgreSQL 16.13, unresolved IDP plaintext and durable writer-credential-fence cutover, six entitlement-clock denials, and 0777 API volumes, plus final migration/replay evidence.

## Quarantines and rights boundary

- The unproven Web Production Design package was recoverably quarantined: 42
  files, 10,353,684 bytes. Manifest SHA-256:
  `4dcb0807118e25a08dbebdbd55a32658789695cbb0660f856e248934f8c696a7`.
  Its renderer/source branches were stripped, preview/package routes fail
  closed, and release-output checks reject known residue.
- Thirteen unproven commercial desktop map rasters totaling 27,411,958 bytes
  were recoverably quarantined. Manifest SHA-256:
  `681addffc18f2354f1e5b11f19f1321bfe28dc88c6d7219fe7735a962c0ef994`.
- Ten additional Root source rasters totaling 25,142,675 bytes and their
  10,120-byte unused generator were double-copied outside the repository and
  quarantined. The [Root source quarantine record](ROOT_PUBGM_MAP_SOURCE_QUARANTINE_20260809.md)
  pins every path, size, and SHA-256. Release metadata now rejects either Root
  quarantine path if it returns. No commercial map raster is bundled in the
  desktop or Root release-source boundary. A neutral SVG supports preview only;
  production match preflight blocks a selected map without an approved asset.
- A mutating PCOB diagnostic was recoverably quarantined instead of committed:
  14,876 bytes, SHA-256
  `748AD33824EE125BA7D1B33B0ED6B1EB28DF9DD19FB9536697C382F3AD1C36AC`.
  Required runtime sources now contain no personal Windows profile path.

These targeted quarantines do not prove the entire repository rights-cleared.
Older tracked PUBG/scene/brand assets and the public redistribution provenance
of `ob.js` still require owner/legal review before a public release.

## Current production evidence and hard blockers

A bounded read-only clean-parent inventory on 2026-08-09 found five independent
production blockers. No production write, cleanup, build, Compose mutation,
service restart, Discord interaction, or customer-state change was performed.

- `/opt/arenzyra` and its deployed API/Web directories are not Git worktrees
  and contain a mixed release. OCI labels and `.env.release` alone are not
  complete source proof. The checkout/source gate therefore remains closed
  unless a complete cryptographic release-file manifest is generated from and
  verified against the exact clean Root/API/Web assembly; migration SQL
  checksum verification remains mandatory and separate.
- The live PostgreSQL server is 16.13, not the reviewed pinned 16.14 image and
  digest. The physical database identity gate must continue to fail.
- The aggregate-only IDP check found 12 legacy plaintext schedules. The final
  structural gate requires the exact migration, zero plaintext rows, the exact
  envelope CHECK, and a validated constraint; the authenticated compiled check
  must also report zero legacy credentials, plaintext message schedules, and
  invalid envelopes. Production apply/validate remains unavailable until a
  reviewed durable writer-credential fence and session termination workflow
  exists; no default, stopped-container sample, or placeholder passes it.
- Aggregate entitlement inventory found 11 approved/active organizations and
  six effective clock denials. Deployment stays blocked until an explicit,
  reviewed customer/business policy and remediation artifact resolves them.
  There is no automatic mutation, permissive default, or grandfather switch.
- Both API data-volume roots are owned by `0:0` with mode `0777`. The nonroot
  image cutover must remain blocked until an exact, backed-up ownership and mode
  remediation is reviewed. The read-only gate requires roots `1000:1000` mode
  `0750`, every descendant owned `1000:1000`, regular files/directories only,
  regular-file link count one, and no symlink, special node, cross-filesystem,
  or world-writable state.

These blockers are cumulative. Resolving one does not waive any other, and this
review does not claim that production is ready.

## Historical production evidence only

On 2026-08-09, a new bounded read-only check entered `/opt/arenzyra` through a
clean-parent `env -i` Bash process and listed the running containers. It did not
run SQL, a migration, Compose, a build, a restart, or a Discord interaction.
The exact migration-ledger query stopped before database access because the
deployed tree lacks the required database-identity helper scripts and the running database
uses mutable `postgres:16-alpine` rather than the reviewed pinned PostgreSQL
16.14 digest. Production checksums therefore remain unknown and fail closed.
The running API command still includes `npx prisma migrate deploy` on container
startup, so no API recreate or restart is safe until the guarded release source,
database identity, preflight, and exact-checksum lineage gate are in place.

The same point-in-time inventory observed a recently started Discord container
reporting healthy. That is not candidate verification or continuous health: no
bot process was started by this review, and no guild, gateway, or credential
interaction was attempted. Unexpected whitespace/shell-like top-level names
also remain under `/opt/arenzyra`; preserve them and review their provenance
instead of deleting them during deployment preparation.

During the 2026-08-05 audit window (00:10-01:11 UTC; final recheck 03:52 UTC),
read-only HTTPS, container inspection, aggregate logs, and count-only SQL under
`/opt/arenzyra` observed an older deployment. The observed source label was
`source-digest-20260801-050716822-3412d0c938fd`; the archived `CURRENT` pointer
was absent. A missing candidate route and pending-source evidence were
consistent with an older deployment, but did not establish immutable identity.

Those observations are not current health, continuous availability, or current
database state. The historical shell session did not attest the later required
clean-parent `env -i` launcher. Repeat all container, endpoint, migration,
entitlement, publication, refresh-token, credential, MFA/session, and log
inventories before maintenance. The detailed historical record is
[`PRODUCTION_READ_ONLY_AUDIT_20260805.md`](PRODUCTION_READ_ONLY_AUDIT_20260805.md).

Earlier migration/overlay counts are historical reconciliation notes, not a
release-completion target or fresh production inventory. Reconcile exact SQL
lineage and `_prisma_migrations` checksums, then replay the candidate sequence
on disposable PostgreSQL 16.14 before taking a new production inventory.

## Genuine release blockers

1. Keep every quarantined Root path and external recovery snapshot outside
   release input unless individually approved, confirm `ob.js` provenance, and
   reproduce all revisions from clean checkouts.
2. Bind the exact clean canonical API/Web heads and Root release commit, verify
   the complete tracked-only release-file manifest, reconcile exact production
   migration checksums, and pass disposable PostgreSQL 16.14 replay, database
   E2E, and exact role/object-policy checks.
3. Obtain exact-byte redistribution and branding evidence for every asset that
   will ship. Do not restore quarantined maps or visuals by category or name.
4. Use a trusted external Windows release runner, the exact locked toolchain,
   reviewed signer/TSA policy, and real NSIS/portable artifacts. Verify inner
   executables, complete runtime inventory, signatures, immutable manifests,
   and rollback evidence. Production packaging remains intentionally blocked.
5. Validate telemetry and map behavior with approved recordings. Then perform
   current-candidate Discord verification only under `/opt/arenzyra`, without a
   second gateway runtime or test access to live bot credentials.
6. Create a reviewed maintenance plan with fresh count-only inventories,
   customer-by-customer entitlement decisions, lock/outage estimates, distinct
   production roles and secrets, a durable IDP writer-credential fence/session
   termination cutover, super-admin MFA rollout, and authenticated IDP
   plaintext-zero proof.
7. Create and verify a real encrypted off-host recovery point and isolated
   restore drill tied to immutable release identity.
8. Complete real non-sensitive SMTP, manual-billing, approval, retry, and
   stale-session invalidation evidence, plus legal entity, privacy, retention,
   cancellation/refund, minors, subprocessors, publisher, and jurisdiction
   review.
9. Re-run clean-checkout builds/tests and then deploy only through the guarded
   production workflow. Verify image identity, container health, readiness,
   public HTTPS, and non-sensitive billing behavior after cutover.
10. Validate the $29.99 founding offer with real organizers, support-time and
    direct-contribution-margin limits, and no invented customer, uptime,
    savings, or earnings claims.

## Production continuation rule

Every production Bash or Node entrypoint, including a read-only one, must begin
through the exact reviewed-Root `git show ... production-reviewed-entrypoint.sh |
env -i bash -s -- <command-id>` launcher documented in `infra/PUBLISH.md`. It
clears at least `BASH_ENV`, `ENV`, `NODE_OPTIONS`, `NODE_PATH`, and ambient
`GIT_*` variables before the interpreter starts, then attests the exact clean
Root and, where required, API/Web heads before checkout code executes. Raw npm,
checkout scripts, and custom Compose commands are not supported production
entrypoints.

Immediately before every supported production build, pull, recreate, restart,
or `docker compose up`, the attested wrapper runs
`production-deploy-preflight.sh` internally in the same session. Operators do
not replace that invariant with a raw preflight command.

Stop on any nonzero result. The default minimum is 30 GiB free on the production
root filesystem. Do not automatically delete backups, images, logs, volumes, or
other production data to make room, and never prune production volumes. After
an approved deployment, verify container health, immutable release identity,
and the public HTTPS endpoints.

Every checkbox in
[`SECURITY_AND_RELIABILITY_GATES.md`](SECURITY_AND_RELIABILITY_GATES.md)
remains unchecked until its implementation, exact output, immutable revision,
reviewer, and date are recorded.
