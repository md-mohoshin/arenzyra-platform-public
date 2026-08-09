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
without overwriting a later billing decision. That behavior is not integrated
into the canonical API yet and must not be promised to customers.

This is a price and customer hypothesis, not an earnings promise. The operating
and 30-day validation gates are in
[`ARENZYRA_MONETIZATION_DECISION.md`](../product/ARENZYRA_MONETIZATION_DECISION.md).

## Source identity and evidence boundary

The release work uses three independent Git repositories. Root does not track
the nested Web repository as content or as a gitlink.

| Tree                                                      | Audited revision                           |                                                                                                                Status at this checkpoint |
| --------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------: |
| Root checkpoint before this production-evidence addendum  | `0a53211c989d771200b17a27f2a456e5a20bac27` | pre-commit status is exactly 25 paths: this intended document plus 24 exclusions; after this addendum is committed, 24 exclusions remain |
| Canonical API worktree (`.worktrees/api-release-lineage`) | `4edafafd28aaf684a78f678adf358b5eaed80238` |                                                   clean; one test-only standings regression was added after runtime checkpoint `a508e97` |
| Web runtime source/build checkpoint (`apps/arenzyra-web`) | `f2ca9a152e60830ed526fa0b9a784982aba1afeb` |                                                        clean; source, build, and runtime-package evidence below belongs to this revision |
| Web test-harness checkpoint (`apps/arenzyra-web`)         | `1d37d1096ce8c5323ccdb0938f800c35f6a2029c` |                                                                          clean; only two test files changed after the runtime checkpoint |

The dirty legacy `apps/api` tree at
`54dd78c91ac15747c3ded2d1e5c99fd31c8d9b8a` is not release identity. Its
moving working state must not be substituted for the canonical API revision.

The 24 Root exclusions are three unapproved brand assets (two PNGs and one SVG)
plus 21 publishing/marketing paths (19 scripts, one JSON file, and one Markdown
document). They were intentionally not committed. Some can upload or publish
externally and still contain local-machine paths. The brand assets require
provenance and visual approval.

Generated dependencies, build caches, local runtime data, uploads, recordings,
backups, and binary installers are not source identity. Before remediation, an
external recovery snapshot and Git bundles were written at
`C:\Arenzyra-safety-snapshots\arenzyra-pre-remediation-20260804-210615`.
Its manifest SHA-256 is
`A42876FA86EFEDF7D96B284A8B97C1FF0747AE8BB766AE677311BDD384EAB566`.
That is local source recovery, not a production-data backup.

## Current retained verification

| Area                    | Retained result                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical API           | At `4edafaf`, build passed; full unit run passed 154/168 suites and 1,205/1,267 tests, with 14 suites/62 tests failing; 8 e2e suites were inventoried but not run in that result |
| Web source              | At clean runtime checkpoint `f2ca9a1`, full ESLint and TypeScript passed; focused font 4/4, release-boundary 10/10, Facet Grid 2/2, and Studio TLS/migration 6/6 passed          |
| Web browser             | At test-harness checkpoint `1d37d10`, the final full single-worker Chromium run passed 150/150; the two affected tests also passed together 2/2 before that run                  |
| Web production build    | 79/79 static pages; emitted static/server output contains none of the quarantined Production Design or old-logo markers                                                          |
| Web runtime package     | Clean `f2ca9a1` modern frozen pnpm deploy passed: 18,698 regular files, 599,685,932 logical bytes, and 232 contained links; no dev/cache/source tree or escaping link            |
| Desktop                 | Exact-final full suite passed 289/289 across 38 files; 76/76 launcher-release tests and 42/42 PCOB coverage tests passed; TypeScript and full ESLint passed                      |
| Root production policy  | 31/31 production policy tests and 12/12 publish-preflight tests passed                                                                                                           |
| Pricing consistency     | Canonical-root-aware gate passed 5/6; the sole failing check is the real canonical catalog/add-on mismatch. The earlier dirty-tree 6/6 is not retained evidence                  |
| Migration checksum gate | At Root `5bd5d20`, 26/26 direct tests and 72/72 related policy tests passed; real production ledger comparison and disposable replay remain outstanding                          |

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

- Dirty candidate source contains deferred account-setup trial activation, but
  the canonical API does not; this is a planned integration, not a completed
  release control.
- Dirty candidate authentication, refresh-family reuse response, account state, service
  identities, platform-superadmin MFA, tenancy, private assets, public
  publication, manual billing, SMTP outbox, Redis throttling, and browser token
  storage received source-level fail-closed controls and regression coverage.
- Web and the opt-in Discord pricing publisher use the candidate ladder. The
  canonical API still exposes its older catalog/add-ons, so cross-service
  pricing parity is not complete.
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

These controls describe candidate source. They do not prove every candidate API
change is integrated into the canonical release. Of 2,710 candidate-delta paths,
2,288 are now exact; API reconciliation still has 149 direct overlay entries,
258 manual-review entries, and 15 migration holds.
Four manually reviewed WebSocket gateway files, including protected PCOB,
block the next access-token integration; account-security integration depends
on a held Prisma enum and migration. Do not force those overlays.

The current clean revisions are functionally incompatible for onboarding: Web
submits passwordless applications and calls `/auth/account-setup/consume`, while
the canonical API requires an application password, lacks that consume endpoint,
and starts trials at approval. Closing this needs the protected/manual auth and
super-service merge plus held password-action and billing schema work; it is not
a safe four-file copy.

## Quarantines and rights boundary

- The unproven Web Production Design package was recoverably quarantined: 42
  files, 10,353,684 bytes. Manifest SHA-256:
  `4dcb0807118e25a08dbebdbd55a32658789695cbb0660f856e248934f8c696a7`.
  Its renderer/source branches were stripped, preview/package routes fail
  closed, and release-output checks reject known residue.
- Thirteen unproven commercial desktop map rasters totaling 27,411,958 bytes
  were recoverably quarantined. Manifest SHA-256:
  `681addffc18f2354f1e5b11f19f1321bfe28dc88c6d7219fe7735a962c0ef994`.
  No commercial map raster is bundled. A neutral SVG supports preview only;
  production match preflight blocks a selected map without an approved asset.
- A mutating PCOB diagnostic was recoverably quarantined instead of committed:
  14,876 bytes, SHA-256
  `748AD33824EE125BA7D1B33B0ED6B1EB28DF9DD19FB9536697C382F3AD1C36AC`.
  Required runtime sources now contain no personal Windows profile path.

These targeted quarantines do not prove the entire repository rights-cleared.
Older tracked PUBG/scene/brand assets and the public redistribution provenance
of `ob.js` still require owner/legal review before a public release.

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

The earlier 12-migration production observation is historical. The current 15
figure means canonical reconciliation holds, not 15 migrations freshly queried
from production. Reconcile exact SQL lineage and `_prisma_migrations` checksums,
then replay the candidate sequence on disposable PostgreSQL 16 before taking a
new production inventory.

## Genuine release blockers

1. Resolve or explicitly retire the 24 excluded Root paths, confirm `ob.js`
   provenance, and reproduce all revisions from clean checkouts.
2. Complete the 149 direct and 258 manual API overlays without overwriting
   protected gateway or credential-approval changes. Resolve the passwordless
   application/account-setup/trial and catalog/billing incompatibilities.
   Reconcile all 15 schema/migration holds against release lineage and
   production checksums, then pass disposable PostgreSQL 16 replay, database
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
   production roles and secrets, super-admin MFA rollout, and IDP plaintext-zero
   proof.
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
from the exact clean-parent `env -i` launcher documented in `infra/PUBLISH.md`,
clearing at least `BASH_ENV`, `ENV`, `NODE_OPTIONS`, `NODE_PATH`, and ambient
`GIT_*` variables before the interpreter starts.

Immediately before every production build, pull, recreate, restart,
`docker compose up`, or custom/partial operation, run in the same clean session:

```bash
cd /opt/arenzyra
bash scripts/production-deploy-preflight.sh
```

Stop on any nonzero result. The default minimum is 30 GiB free on the production
root filesystem. Do not automatically delete backups, images, logs, volumes, or
other production data to make room, and never prune production volumes. After
an approved deployment, verify container health, immutable release identity,
and the public HTTPS endpoints.

Every checkbox in
[`SECURITY_AND_RELIABILITY_GATES.md`](SECURITY_AND_RELIABILITY_GATES.md)
remains unchecked until its implementation, exact output, immutable revision,
reviewer, and date are recorded.
