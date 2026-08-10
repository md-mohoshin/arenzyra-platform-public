# Publish deployment

This stack is the production-oriented deployment path. It keeps Postgres and Redis private, exposes only `80/443`, and places the web app and API behind Caddy with automatic TLS.

## Files

- `infra/docker-compose.publish.yml`: public-facing stack
- `infra/.env.publish.example`: production env template
- `infra/Caddyfile`: reverse proxy and TLS config

## Before you start

- You need a server with Docker Engine and the Docker Compose plugin.
- You need DNS records for:
  - `PUBLIC_WEB_HOST` -> your server IP
  - `PUBLIC_API_HOST` -> your server IP
- Open inbound ports `80` and `443` on the server firewall.
- Copy `infra/.env.publish.example` to `infra/.env.publish` and replace every placeholder.

On a trusted local preparation checkout (not as a production-host entrypoint),
you can generate a first production env file with strong local secrets:

```bash
npm run deploy:create-env
```

Review the generated `infra/.env.publish` before deploying, especially email,
Discord, YouTube, SMTP, OpenAI, and optional Studio remove.bg values.
The generated YouTube token key is distinct from other application secrets.
For an existing database, follow
[`docs/YOUTUBE_TOKEN_KEY_ROTATION.md`](../docs/YOUTUBE_TOKEN_KEY_ROTATION.md)
before changing or removing any YouTube token key.

For a legacy production installation, do not overwrite the live env with
`deploy:create-env` and do not hand-copy individual secrets. After the reviewed
checkout bootstrap has prepared (but not activated) an exact staging checkout,
run the one-shot migration below from a clean parent. The output must still be
the byte-identical bootstrap copy of the live source env; a second invocation
is rejected so database-role passwords cannot silently rotate. The migration
copies only keys present in the reviewed template, drops development bootstrap
credentials, preserves allowlisted integrations, generates distinct
least-privilege database/MFA/IDP/service secrets, and keeps public applications
disabled.

```bash
env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root \
  /usr/bin/node <exact-staged-checkout>/scripts/migrate-production-publish-env.cjs \
  --source /opt/arenzyra/infra/.env.publish \
  --template <exact-staged-checkout>/infra/.env.publish.example \
  --out <exact-staged-checkout>/infra/.env.publish \
  --age-recipient '<reviewed-public-age-recipient>' \
  --rclone-remote '<reviewed-off-host-rclone-remote:path>' \
  --confirm MIGRATE_REVIEWED_PRODUCTION_ENV
```

Do not run that command until the off-host remote is configured and a bounded
read/write/checksum probe succeeds. An empty or invented remote deliberately
leaves preflight blocked. The private age identity must remain off the server.

## Start the publish stack

Every production deployment must enter through the committed-script launcher
below. After its pre-source Root/API/Web trust bootstrap, it runs the read-only
disk and service health gate. The raw `npm run deploy:guard` alias is
intentionally blocked; only the attested dispatcher/wrapper invokes
`production-deploy-preflight.sh`. Every build, pull, recreate, restart, or
Compose-up still requires that internal preflight immediately beforehand in the
same session.

The gate requires at least 30 GiB free on `/` by default. It exits with
`DEPLOYMENT BLOCKED` when space is below the threshold or an existing production
container is unhealthy. It never performs cleanup automatically. Both committed
launcher modes run this check before generating release metadata or
starting a build. A full deploy also verifies the exact PostgreSQL 16.14 target,
the API data-volume boundary, clean release source, entitlement clocks, and the
structural IDP postcondition before it can build or mutate a release.

The read-only production audit on 2026-08-09 does **not** satisfy those gates.
`/opt/arenzyra` is a non-Git mixed release without a complete cryptographic
release-file manifest from the exact clean Root/API/Web assembly; PostgreSQL is
16.13 rather than the pinned 16.14 release; 12 IDP schedules still fail the
credential/message zero-plaintext postcondition; strict entitlement inventory
reports 4 expired `ACTIVE` clocks and 2 invalid `TRIALING` clocks; and the
`api-uploads` and `api-storage` roots are `0:0` mode `0777`. These are current
hard blockers, not optional warnings. The deploy must not change customer rows,
volume contents, ownership, modes, or database state to make them pass.
The follow-up inventory also found no production `rclone` executable or
configured off-host destination, so environment migration and any mutating
release step remain blocked until an operator supplies and verifies that
external recovery target.

For a full API release, the guarded deploy then performs a second read-only
release-safety check. It inventories every row in `_prisma_migrations`, binds
each successfully applied migration to the exact SHA-256 of the candidate SQL,
and compares pending migrations with
[`production-api-migration-safety.json`](production-api-migration-safety.json).
The read uses PostgreSQL's transaction-level read-only default, connection,
statement, and lock timeouts, and a 4,097-row query ceiling; the verifier accepts
at most 4,096 bounded rows. Missing or malformed ledger fields, a non-first
target with no successfully applied migration, unfinished non-rolled-back rows,
multiple active rows for one migration, source-history divergence, a successful
history that is not the ordered prefix of the candidate, and checksum drift all
fail closed. Candidate migration names are bounded and must not collide when
case-folded across release filesystems. The gate also
scans pending migration SQL for contract and data-impact operations. The
scanner includes destructive schema changes, row `UPDATE`/`DELETE`/`TRUNCATE`,
column-default changes, and required columns with defaults. A classified
contract or data-impact migration requiring controlled maintenance, or an
unclassified detected impact, blocks before release metadata, image builds,
backups, migrations, or service changes. The block automatically goes away
after the reviewed workflow has recorded the migration as successfully applied;
it is not a permanent version-number exception. Proving there are no old
writers waives only old-writer compatibility. It does not accept effects on
existing data, visibility, sessions, credentials, or external access.

A checksum match is necessary evidence, not release authorization. The
version-2 safety manifest explicitly classifies the IDP credential-storage and
secure-account-setup migrations as both old-writer-incompatible and
data-impacting controlled maintenance. The Studio widget-release foundation is
an additive Studio migration and is not a routine data rewrite. The manifest is
bound to exact candidate migration names and bytes; it does not approve later
migrations. Before any forward migration is added, its contract and data
effects must be reviewed and every required classification must be added.
Unclassified destructive or data-impact SQL continues to fail closed
mechanically.

For every full deploy, the same pre-mutation phase runs read-only,
aggregate-only entitlement checks over non-deleted organizations. They report
counts, never organization identifiers or arbitrary row data, and perform no
reconciliation. The release fails closed if a query or bounded parser fails, if
stored `ACTIVE`, `TRIALING`, or `EXPIRED` forms are inconsistent, or if an
approved active organization has a missing/expired `ACTIVE` clock, an invalid
`TRIALING` clock, or a legacy/unknown subscription status. Elapsed clocks are
therefore deployment failures under the current strict policy. Use the reviewed
customer/business disposition procedure below; deployment never backfills or
edits entitlement rows.

The normal full `--first-deploy` path is intentionally unavailable and exits
`75` after the reviewed launcher attests the clean checkout but before any
Docker, database, release, backup, or service action. A first installation requires a separate,
explicitly reviewed empty-target bootstrap that migrates and validates a
zero-row IDP constraint before starting any writer. No such full bootstrap is
shipped by the normal deploy entrypoint. The flag is retained only for the
guarded Discord-bot-only exception: it still checks reviewed source, preflight,
volume inventory, and zero managed containers, then starts only the bot with
`--no-deps`. Full-application entitlement, IDP, and migration gates are outside
that dependency-isolated operation; they are not treated as passed or waived.

Canonical API source encrypts new Discord IDP credentials. Its image contains
the exact compiled dry-run plus apply/validate artifacts for isolated private
restore rehearsal only; Publish exposes only authenticated dry-run. Live production remains different:
its 12 legacy schedules still contain credential material in the legacy field
and persisted message bodies. A routine full deploy therefore fails before a
build until the structural migration exists exactly once, legacy credential
storage is zero, and the exact envelope CHECK is validated. Candidate-image
compiled dry-runs before backup and after health must also authenticate every
envelope and report `ok:true`, zero legacy credentials, zero plaintext message
schedules, and zero invalid envelopes.

The full deploy creates and verifies its encrypted off-host pre-migration
backup, then immediately repeats `production-deploy-preflight.sh` before the API
migration. This catches root-disk capacity consumed by the backup itself. A
failed repeated preflight stops before schema mutation.

Use the single reviewed production entrypoint below. Raw production npm aliases,
checkout scripts, and Compose commands execute untrusted checkout bytes before
the source gate and intentionally fail closed or are unsupported. Replace all
three values with the exact full commits from the reviewed clean assembly. The
optional secret variables are passed explicitly for only the allowlisted restore
and Studio-QA actions; leave them unset otherwise.

```bash
cd /opt/arenzyra
reviewed_root='<40-hex-reviewed-root-commit>'
reviewed_api='<40-hex-reviewed-api-commit>'
reviewed_web='<40-hex-reviewed-web-commit>'
production_entry() {
  /usr/bin/env -i \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    HOME=/root \
    ARENZYRA_REVIEWED_ROOT_COMMIT="$reviewed_root" \
    ARENZYRA_REVIEWED_API_COMMIT="$reviewed_api" \
    ARENZYRA_REVIEWED_WEB_COMMIT="$reviewed_web" \
    ARENZYRA_BACKUP_AGE_IDENTITY="${ARENZYRA_BACKUP_AGE_IDENTITY:-}" \
    STUDIO_QA_EMAIL="${STUDIO_QA_EMAIL:-}" \
    STUDIO_QA_PASSWORD="${STUDIO_QA_PASSWORD:-}" \
    STUDIO_QA_AUTH_TOKEN="${STUDIO_QA_AUTH_TOKEN:-}" \
    STUDIO_QA_SERVICE_TOKEN="${STUDIO_QA_SERVICE_TOKEN:-}" \
    STUDIO_QA_INCLUDE_WORKSPACE_WRITE="${STUDIO_QA_INCLUDE_WORKSPACE_WRITE:-}" \
    STUDIO_QA_REQUIRE_EXTERNAL_IMAGE_PROVIDER="${STUDIO_QA_REQUIRE_EXTERNAL_IMAGE_PROVIDER:-}" \
    STUDIO_QA_TEST_EXTERNAL_IMAGE_PROVIDER="${STUDIO_QA_TEST_EXTERNAL_IMAGE_PROVIDER:-}" \
    /bin/bash --noprofile --norc -ceu '
      set -o pipefail
      /usr/bin/env -i PATH="$PATH" HOME="$HOME" LC_ALL=C \
        GIT_OPTIONAL_LOCKS=0 GIT_NO_REPLACE_OBJECTS=1 \
        GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
        /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null \
        -C /opt/arenzyra show \
        "${ARENZYRA_REVIEWED_ROOT_COMMIT}:scripts/production-reviewed-entrypoint.sh" |
      /usr/bin/env -i PATH="$PATH" HOME="$HOME" \
        ARENZYRA_REVIEWED_ROOT_COMMIT="$ARENZYRA_REVIEWED_ROOT_COMMIT" \
        ARENZYRA_REVIEWED_API_COMMIT="$ARENZYRA_REVIEWED_API_COMMIT" \
        ARENZYRA_REVIEWED_WEB_COMMIT="$ARENZYRA_REVIEWED_WEB_COMMIT" \
        ARENZYRA_BACKUP_AGE_IDENTITY="$ARENZYRA_BACKUP_AGE_IDENTITY" \
        STUDIO_QA_EMAIL="$STUDIO_QA_EMAIL" STUDIO_QA_PASSWORD="$STUDIO_QA_PASSWORD" \
        STUDIO_QA_AUTH_TOKEN="$STUDIO_QA_AUTH_TOKEN" \
        STUDIO_QA_SERVICE_TOKEN="$STUDIO_QA_SERVICE_TOKEN" \
        STUDIO_QA_INCLUDE_WORKSPACE_WRITE="$STUDIO_QA_INCLUDE_WORKSPACE_WRITE" \
        STUDIO_QA_REQUIRE_EXTERNAL_IMAGE_PROVIDER="$STUDIO_QA_REQUIRE_EXTERNAL_IMAGE_PROVIDER" \
        STUDIO_QA_TEST_EXTERNAL_IMAGE_PROVIDER="$STUDIO_QA_TEST_EXTERNAL_IMAGE_PROVIDER" \
        /bin/bash -s -- "$@"
    ' arenzyra-production-entry "$@"
}

production_entry deploy
```

Use `production_entry deploy-discord` for the supported bot-only mode and append
`--first-deploy` only for its documented bot health exception. Do not use the
full first-deploy form. The outer `git show` makes the dispatcher bytes come from
the explicitly reviewed Root commit. It uses absolute sanitized Git to require
the exact clean Root head before checkout execution and exact API/Web heads for
commands that consume them. The deploy later recomputes every release input
before build. Both layers disable Git
replacement objects and reject grafts, replacement refs, and alternate object
stores, so a reviewed commit name cannot resolve to substituted tree bytes.

This matters because non-interactive Bash evaluates `BASH_ENV` before the
script body, and Node can evaluate `NODE_OPTIONS` before an application
validator starts. The scripts also reject `BASH_ENV`, `ENV`, `NODE_OPTIONS`,
`NODE_PATH`, and ambient `GIT_*` variables, but that in-script check cannot undo
code that an unsafe parent shell already executed. An automated launcher must
provide an equivalent clean environment; for systemd, also use
`UnsetEnvironment=BASH_ENV ENV NODE_OPTIONS NODE_PATH` and do not pass ambient
Git overrides.

Release evidence is archived under `/opt/arenzyra-release-metadata`. The
`CURRENT` and `PREVIOUS` files are each replaced atomically, but the pair is not
one transaction: an interruption between their two renames can leave the
recovery hints inconsistent. After an interrupted deploy or rollback, do not
infer the running release from those pointers alone. While holding the
production deployment lock, compare the running container image IDs with the
archived release manifests, then reconcile both pointer files before the next
release. The pointers are recovery hints, not authoritative transactional
state.

Use `production_entry deploy-discord` for the dependency-isolated bot mode; add
its sole reviewed optional argument, `--first-deploy`, only when the Compose
project has zero managed containers. The dispatcher and wrapper repeat preflight
immediately before each supported build or Compose-up and use `--no-deps` for
the bot. A partial action outside the dispatcher's closed command allowlist is
not authorized by a raw checkout script or preflight alone. Extend and review
the committed dispatcher and all applicable full-application gates before such
an action is supported.

## Contract and data-impact migrations

The current manifest names both
`20260805021000_idp_encrypted_credential_storage` and
`20260809203000_secure_account_setup` in its contract and data-impact lists.
Both require controlled maintenance: IDP storage immediately rejects legacy
plaintext writes while its backfill is pending, and secure onboarding introduces
inactive users, nullable legacy passwords, and deferred one-use setup tokens
that an old API does not understand. The onboarding migration also assigns the
explicit compatibility default to existing applications. These classifications
are release gates, not bypasses.

The reviewed additive Studio foundation is
`20260809200000_studio_widget_release_foundation/migration.sql`, with normalized
SQL SHA-256
`3f7a501dba9fe89661c52ec5eaad973189b155763fe65214c6b055168c09f27b`.
The database object policy binds that exact source on every Studio trigger and
trigger-function entry; a path or byte change fails repository verification.

Prefer expand/contract: add the replacement shape, deploy dual-compatible code,
backfill and verify it, then drop the legacy shape in a later release. The
generic SQL scanner remains a second line of defense and blocks unclassified
contract or data-impact operations; a clean scan does not replace human review.

Applying a pending contract or data-impact migration requires a reviewed
controlled-maintenance change plan and explicit acceptance of each manifest
entry's stated effect. There is no environment-variable or ordinary deploy-flag
bypass. The operator and reviewer must record the clean release revision,
manifest entries, successful standard production preflight in the same working
session, immutable off-host recovery point, intended outage, affected row-count
or access validation where applicable, and recovery owner. Build the exact
release before the write outage; then stop every old API writer and public API
ingress, verify the old API process and its database sessions are gone, and keep
them stopped while the dedicated migration role applies the migration. Start
only the compatible new API afterward. Do not start an older API image after a
contract migration, because image rollback does not downgrade the database.

`scripts/rollback-production-images.sh` therefore rejects full application
rollback before it inspects images or invokes Compose. Archived release metadata
does not prove that an old API understands the current schema. Only an explicit
`--discord-bot` image rollback remains supported. Full application recovery must
use reviewed forward repair or a coordinated database-and-application restore
validated in an isolated environment as described in
[`BACKUP_RESTORE.md`](BACKUP_RESTORE.md).

A Discord rollback also requires the immutable
`<release-id>.discord-bot-image.json` archive created by that release's build.
Use the generic reviewed entrypoint from above, not a raw checkout script:

```bash
target_release='<immutable-discord-release-id>'
production_entry rollback-discord "$target_release"
```

The wrapper requires that exact clean Root HEAD before it sources checkout code.
Root-only current-wrapper provenance is intentionally narrower than a deploy:
rollback never builds API/Web, and the older target bot is independently bound
to its archived release environment and immutable Discord image manifest. The
later checkout-only verifier still requires `/opt/arenzyra`, collected inputs,
the scripts tree, and Root/API/Web Git metadata to be root-owned, non-writable,
and one-link where required; that ownership check is not content provenance and
does not replace the committed outer launcher.

Before Compose can start the bot, the rollback wrapper validates the manifest's
exact archive path, root ownership, `0600` mode, non-symlink identity, closed
schema, and binding to `<release-id>.env`; the locally tagged image ID and labels
must then match the archived evidence exactly.

The controlled migration itself is deliberately not automated by
`deploy-production.sh`; its exact stop/migrate/start command sheet must be
reviewed against the production topology. Every build, restart, recreate, or
Compose-up in that sheet remains subject to `scripts/production-deploy-preflight.sh`
and the repository production rules.

The canonical API image ships the reviewed compiled IDP dry-run/apply/validate
artifacts so the full sequence can be rehearsed against an isolated private
restore. Production Publish Compose exposes only the authenticated one-shot
`api-maintenance-idp-dry-run` service. It runs as UID/GID `1000:1000`, uses the
read-only maintenance URL, has no build, ports, persistent mounts, or long-lived
restart policy, and executes only the exact compiled dry-run. There is no
production IDP apply/validate, YouTube, or other API-maintenance service.

Use only the generic committed entrypoint:

```bash
production_entry idp-dry-run
```

The production wrapper accepts no other action. It holds the shared deploy lock, binds an
archived immutable API image and complete clean source manifest to the physical
database, and rechecks the exact command/image override. Before any maintenance
Compose run it recomputes the full manifest from the clean nested checkout and
requires byte-for-byte agreement with the archived release.

Production mutation remains fail-closed because a momentary container/session
sample cannot stop an external writer from reconnecting during the backfill.
Apply and constraint validation require a separately reviewed durable writer
credential fence (for example, a controlled runtime-role credential/`NOLOGIN`
cutover with session termination and restoration), plus backup and postcondition
evidence. That fence is not implemented here. The production wrapper therefore
rejects apply/validate before Docker, database, backup, or service action. Do not
invoke the maintenance Compose service or compiled scripts directly.

The YouTube maintenance database role remains a reserved, separately confined
identity because it is part of the closed role policy. Its existence does not
authorize a YouTube maintenance command, service, or raw database write.

### Entitlement reconciliation

The routine entitlement gate enforces these canonical stored forms for
non-deleted organizations:

- `ACTIVE`: `paidUntil` is present and `trialEndsAt` is null.
- `TRIALING`: `trialEndsAt` is present and `paidUntil` is null.
- `EXPIRED`: both `paidUntil` and `trialEndsAt` are null.

Deployment authorization uses strict clocks under the current policy. `ACTIVE`
is deployable only when `paidUntil` is in the future;
`TRIALING` is deployable only when its complete, ordered trial dates describe a
currently active trial and `paidUntil` is null. A missing or elapsed clock fails
the release gate without an automatic database write. Do not infer runtime
monetization enforcement from this inventory gate: the canonical API must also
use the same shared predicate in authentication, launcher, Discord, and session
paths, with focused tests, before that enforcement can be called complete.

The 2026-08-09 aggregate inventory found 11 approved active organizations:
7 `ACTIVE` (3 future and 4 expired clocks) and 4 `TRIALING` (2 valid, 1 expired,
and 1 missing dates). The deployment gate therefore reports six clock denials
and remains blocked until an explicit reviewed customer/business disposition
and remediation artifact exists and the read-only inventory returns zero. It
has no grandfather flag or permissive default.

Any other status or aggregate mismatch also fails closed. Gate output contains
only status and inconsistency counts; it intentionally cannot identify affected
organizations. Investigate and reconcile through an approved, audited,
writer-stopped maintenance procedure using a fresh verified off-host backup,
reviewed target selection, before/after counts, and the normal billing audit
path. Do not add an automatic deploy backfill, print identifiers from the gate,
or weaken a boundary to make deployment pass. After an explicitly approved
controlled correction, rerun both read-only entitlement checks and record zero
denials before returning to the standard deployment workflow. The detailed billing semantics are in
[`MANUAL_BILLING_RUNBOOK.md`](../docs/product/MANUAL_BILLING_RUNBOOK.md).

Before deciding whether legacy `ACTIVE` access can become strictly
future-clock-bounded, run the separate aggregate-only inventory documented in
[`PRODUCTION_ENTITLEMENT_INVENTORY.md`](../docs/codex/PRODUCTION_ENTITLEMENT_INVENTORY.md).
It classifies the existing clock, organization, subscription, plan, and owner
states without emitting identifiers or arbitrary stored values and performs no
production write.

### Legacy IDP credential backfill

Canonical runtime writes use authenticated `v1` envelopes, and the reviewed
forward migration widens `DiscordIdpSchedule.roomPassword` and installs the
exact envelope CHECK as `NOT VALID`. Live production has not completed that
cutover: all 12 observed schedules still fail the compiled credential/message
zero-plaintext postcondition.

Closure requires the exact migration once, its existing controlled-maintenance
classification, a successful isolated replay, a fresh verified off-host backup,
a durable runtime-writer credential fence with session termination, the compiled
apply, and constraint validation. That production mutation workflow is not
shipped by this release and must remain blocked until separately reviewed. The
final compiled dry-run must be
authenticated with the production IDP key and report `ok:true`, zero legacy
credentials, zero plaintext message schedules, zero invalid envelopes, and zero
oversized legacy values. The structural verifier must independently report zero
non-envelope values and the exact validated CHECK. A normal deploy then repeats
the compiled dry-run after its immutable image build and again after health; no
SQL-only regex can substitute for envelope authentication or message scrubbing.

## Release provenance

Each deploy must generate a non-secret `infra/.env.release` manifest before
building. It records a release ID, build timestamp, component revisions, and a
cryptographic digest over the complete reviewed release-file set. Routine
production authorization requires clean, available Git provenance for Root and
the embedded API/Web repositories and exact recomputation of the archived
manifest bytes from `/opt/arenzyra`. A non-Git or mixed source tree is a hard
blocker. An OCI label or `.env.release` file alone is not source proof.

Generate metadata directly only for an approved controlled-maintenance command
sheet. The committed-script launcher generates and archives routine release
metadata only after its pre-build safety gates pass.

The launcher generates this metadata automatically in full and Discord-only
mode. The digest covers all selected build contexts, the complete
deployment-script tree, the database object policy, every reviewed API/Studio
migration SQL source, and the exact role-bootstrap and entitlement-inventory SQL
while excluding secrets, Docker-excluded runtime/user-data paths, and local
artifacts. Every collected release input must be tracked by its owning exact
Root, API, or Web repository; an ignored or untracked file that would otherwise
enter a build context fails closed instead of receiving reviewed-source labels.
The verifier requires secure root-owned checkout and Git metadata, one-link
release inputs, clean exact nested revisions, and byte-for-byte agreement with
the archived manifest before an image or maintenance command is trusted. Keep
the generated manifest with the deployment backup so every built service can be
traced to the same reviewed source. Do not weaken the exact migration checksum
gate to accommodate a mixed installation.

After a successful build, the deploy wrapper also archives closed-schema,
root-owned mode-`0600` image manifests beside the release environment. A full
deploy writes `<release-id>.api-image.json`, `<release-id>.web-image.json`, and
`<release-id>.media-ai-image.json`; a Discord-only deploy writes
`<release-id>.discord-bot-image.json`. An existing manifest for the same release
must validate and match byte-for-byte, so a later rebuild cannot silently
replace a recorded image identity. Runtime startup uses a root-only,
descriptor-attested Compose override containing those immutable IDs, disables
pulling, and verifies each running container ID before release pointers are
advanced.

The deploy and IDP dry-run retrieve expected image IDs only inside the reviewed
entrypoint after validating the exact archived release environment and image
manifest. There is no supported raw production-host Node command for this step.

Deploy commands do not delete files or run maintenance automatically. Host
cleanup remains separate and is invoked only as
`production_entry host-maintenance` (or `--check-only`). No database-writing API
maintenance is production-authorized in this release; authenticated IDP dry-run
is read-only, and IDP apply/validate, YouTube, and all other API maintenance
remain blocked.

This command intentionally does not start the local `discord-bot` service. The
Discord bot should have one production runtime only. If you deliberately need to
start this stack's bot, opt in explicitly:

Use `production_entry deploy-discord`; do not replace it
with a raw npm or Compose invocation.

The bot also has a startup lock: production-mode bot containers only connect to
Discord when `ARENZYRA_DISCORD_BOT_INSTANCE=production` is present in the publish
environment. Keep that flag off local machines.

Do not use `next dev` on `localhost:3001` as a production parity check. For a true comparison, use the web app's production preview so the same build metadata and `BUILD_ID` flow are exercised locally:

```bash
npm --prefix apps/arenzyra-web run preview:prod
```

Only the reverse proxy is exposed publicly:

- Web: `https://PUBLIC_WEB_HOST`
- API: `https://PUBLIC_API_HOST`

Postgres and Redis stay internal to Docker in this stack.

## Data and storage

- Postgres data is stored in the named volume `postgres-data`.
- Redis data is stored in the named volume `redis-data`.
- API uploads are stored in the named volume `api-uploads`.
- API media/storage files are stored in the named volume `api-storage`.

Before deploying the non-root API image, the volume gate requires both volumes
to have the exact reviewed local-volume identity. Their roots and every existing
entry must be UID/GID `1000:1000`, and the roots must be mode `0750`. Every
descendant must be a regular file or directory; regular files must have exactly
one hard link. Symlinks, special nodes, cross-filesystem descendants, unexpected
ownership, or any world-writable entry fail closed. A fresh image also creates
`/app/uploads` and `/app/storage` as `1000:1000` mode `0750`.
Current production roots are `0:0` mode `0777`, so deployment is blocked until a
separately reviewed, backed-up ownership/mode remediation is approved. The gate
does not mutate either volume.

Never restore an existing database directly over the live stack. Validate an
encrypted recovery point through the isolated procedure in
[`BACKUP_RESTORE.md`](BACKUP_RESTORE.md), then use a separately reviewed
database-and-application migration/cutover plan.

## Required env values

The API requires these production startup values:

- `JWT_SECRET`
- `IDP_CREDENTIAL_ENCRYPTION_KEY` (a separate random value, at least 32 bytes)
- `SUPERADMIN_MFA_REQUIRED=true`
- `SUPERADMIN_MFA_ENCRYPTION_KEY` (at least 32 bytes)
- `SUPERADMIN_MFA_RECOVERY_PEPPER` (at least 32 bytes)
- `COLLECTOR_SECRET`
- `PCOB_SECRET`
- `PUBLIC_ORGANIZATION_APPLICATIONS_ENABLED=false` (exactly; public acquisition remains invite-only)
- `DATABASE_URL` using a non-owner runtime role
- `MIGRATION_DATABASE_URL` using a dedicated DDL role
- `STUDIO_DATABASE_URL` using a distinct Studio runtime role
- `STUDIO_MIGRATION_DATABASE_URL` using a distinct Studio DDL role
- `MAINTENANCE_READ_DATABASE_URL` using the shared read-only maintenance role
- `IDP_MAINTENANCE_DATABASE_URL` using the IDP-only apply role
- `YOUTUBE_MAINTENANCE_DATABASE_URL` using the YouTube-only apply role

The two MFA secrets must be distinct from each other and from the JWT, IDP,
collector, and PCOB secrets. Rotating the encryption key without a credential
reencryption procedure will make enrolled authenticator secrets unusable.

`AUTH_DEV_BOOTSTRAP_ENABLED`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`,
`OP_EMAIL`, and `OP_PASSWORD` are development-only.
The production preflight rejects them. Provision production accounts through
an audited administrative workflow; do not keep bootstrap passwords in the
long-lived service environment.

The normal full deploy does not provision a first installation. Its
`--first-deploy` form exits `75` before external action. A separate reviewed
empty-target bootstrap must prove source and volume identity, close auxiliary
database ACLs, provision and connectivity-test the seven application URL roles,
migrate an empty target exactly once, validate the zero-row IDP CHECK, and only
then start an application writer. That bootstrap is not implemented by
`deploy-production.sh`; do not improvise it from individual helper commands.

For an existing installation, the allowlisted command below is a read-only role
provisioning preview. It does not create roles or grants:

```bash
production_entry roles-dry-run
```

The preview shares or verifies the deployment lock, reruns the production
preflight, binds to the reviewed database/schema/container, and reports the
closed role/ownership plan without applying it. Role creation or grant changes
occur only as an explicitly guarded step inside a reviewed full deploy after its
source, backup, database-identity, and release gates pass. Existing installations
whose tables/types are owned by a prior administrator still require a reviewed
DBA ownership migration before the dedicated DDL roles can migrate.

The repository does not yet contain a complete writer-stopped
ownership-adoption entrypoint. The normal role helper requires the ordinary
healthy-service preflight, while a safe ownership conversion must prove that
every API, web, Studio, bot, migration, maintenance, and other database writer
is stopped and that the target has no unreviewed sessions. Therefore do
**not** run the helper's `--apply` mode against an existing production
installation whose ownership is not already compliant, and do not improvise
`ALTER OWNER` statements on the live system.

The reviewed ownership command sheet must first tie a fresh encrypted off-host
backup and isolated restore result to the clean release. It must inventory every
table, partition, sequence, view, materialized view, type/domain, routine,
extension, and default ACL; explicitly classify each object as API- or
Studio-owned; stop ingress and every writer; and prove the session inventory is
empty. Use an explicit, reviewed `ALTER ... OWNER` list for those exact objects,
then reapply the closed-world grants and run the role verifier before any writer
returns. Never use blanket `REASSIGN OWNED`, ad hoc `\gexec`, dynamically
generated unreviewed ownership SQL, or a superuser service URL to make the
migration pass. The tracked bootstrap's closed, reviewed `\gexec` statements
for exact ACL reconciliation do not authorize operator-generated ownership SQL.

The role verifier also enforces these application, cluster, and schema
boundaries. Candidate-source object classification is closed, but the
production cluster prerequisites below remain release blockers:

- PostgreSQL databases with a null ACL retain implicit `PUBLIC CONNECT` and
  `TEMPORARY` privileges. SCRAM authentication alone does not confine an app
  role to the Arenzyra database. The role gate now tests effective privileges
  (including PUBLIC-derived grants) for all seven application identities and
  fails if any can connect to or create temporary objects in another
  connectable database. A stock cluster normally grants this access on
  `postgres` and `template1`, so complete the reviewed cross-database ACL
  closure procedure before any separate first-installation bootstrap.
  Restrictive HBA rules remain defense-in-depth but do not satisfy this ACL
  gate. The role provisioner checks PUBLIC and every already-existing
  configured app role with the administrator before backup, role creation, or
  any SQL mutation. It fails safely on a stock cluster and reports the blocking
  database/role/reason tuples as escaped JSON. The role scripts never
  auto-revoke cluster-wide ACLs; the first deployment remains blocked until
  that prerequisite is complete and the gate passes.
- The role bootstrap revokes `pg_catalog.pg_control_system()` execution from
  `PUBLIC` and every application role, then grants it only to the exact API
  migrator, maintenance-read, and IDP-maintenance roles so the immutable
  candidate and physical-database helpers can attest `system_identifier`.
  Verification requires that exact ACL. No application role receives
  `pg_monitor`, and membership in `pg_monitor` or another predefined monitoring
  role remains forbidden.
- The current schema has no reviewed row-level-security design. Any
  `relrowsecurity`/`relforcerowsecurity` flag or `pg_policy` row in the
  application schema fails the role gate instead of being silently accepted.
- The committed database object policy currently binds repository source
  digests to 131 API runtime tables, 6 Studio runtime tables, both migration
  ledgers, zero sequences, all 69 Prisma enum types with 354 ordered labels,
  exactly 2 trigger functions, and exactly 2 enabled user-trigger wirings.
  Bootstrap grants and the verifier consume that policy rather than trusting
  migrator ownership alone. Missing, extra, misowned, misgranted, or mismatched
  policy objects fail closed, as do any current sequence or RLS objects. A
  future schema change must update the reviewed manifest and source digests in
  the same release. The repository parser intentionally rejects several
  unsupported routine/trigger forms, but it remains regex-based and cannot
  prove arbitrary dynamic DDL or every sequence-producing syntax safe; exact
  PostgreSQL 16 catalog verification remains authoritative. Automatically
  generated enum array types, internal/constraint triggers, and database event
  triggers are not independently classified and must not be introduced without
  extending the policy and live-catalog tests.
- The physical target gate pins the image digest, exclusive data-volume
  attachment, network, unpublished ports, database, schema, port, and server
  version, but no durable PostgreSQL `system_identifier` is yet stored in the
  reviewed release inputs. Record and pin that cluster identity before treating
  repeated physical-target checks as proof of the same database cluster.

Set these public URLs correctly too:

- `WEB_APP_ORIGIN`
- `FRONTEND_ORIGIN`
- `NEXT_PUBLIC_API_URL`
- `API_BASE_URL`
- `API_PUBLIC_URL`

Set `ASSET_BASE_URL` if uploaded/team media should resolve from a different public host than the API.

Launcher downloads are disabled unless the optional server-only
`ARENZYRA_LAUNCHER_RELEASE_JSON` value passes the web release validator. Keep
the generated empty value until the installer is signed and the immutable
artifacts, checksums, certificate fingerprint, and manifest have been reviewed.
The schema and release checks are documented in
`apps/arenzyra-web/docs/launcher-release-downloads.md`.

Launcher publication has two separate phases, but the same-checkout npm commands
`stage:launcher-release` and `verify:launcher-release` currently fail closed.
Code loaded by Node/npm from the checkout cannot prove the trustworthiness of
its own parent environment, Git configuration, toolchain, or source directory.
A future reviewed outer Windows launcher must clear runtime and Git injection,
pin absolute trusted Node/npm/Git and packaging tools, and build a clean detached
checkout before invoking the underlying verifier or staging modules.

After that bootstrap exists, the first phase may create a no-overwrite,
versioned local bundle under
`deploy-artifacts/launcher/<releaseId>/`. This ignored directory is not part of
the web image or a public download location. The command does not upload files,
test remote reachability, create mutable aliases, or generate a usable runtime
environment value. Its `pending-runtime-config.json` deliberately uses schema
version 0 and must never be copied into the publish environment.

The staging command is intentionally blocked until all release policies are
reviewed and the verifier is complete. In particular, the tracked Authenticode
signer and timestamp-authority allowlists must be approved; commercial map
redistribution must be supported by the exact reviewed evidence bytes; and a
representative real NSIS/portable package must prove complete inventories,
inner executable signatures, dependency hashes, ASAR integrity, and a signed
immutable digest manifest. Do not weaken or mock those checks to obtain an
artifact. The current `packaged-runtime-verification.json` state is a release
blocker, not an operator acknowledgement.

Independently upload the staged artifacts and manifest to one immutable HTTPS
release prefix. Download all three remote objects again, compare sizes and
SHA-256 values with the staged manifest, re-verify Authenticode identity and
timestamp information, and confirm the exact URLs are publicly reachable. Only
after those checks may an operator construct and review the schema-version-1
server configuration described in the web launcher release documentation.

When enabling a remotely verified release, encode the independently constructed
compact JSON on one line as a single-quoted dotenv value, for example
`ARENZYRA_LAUNCHER_RELEASE_JSON='{"schemaVersion":1,...}'`. The JSON must be no
larger than 16 KiB and must contain neither a literal apostrophe nor `$`; these
restrictions keep the reviewed value literal across dotenv and Compose parsing.
Do not export it through a `NEXT_PUBLIC_` variable or add it as a Docker build
argument. The publish preflight rejects malformed, oversized, or interpolation-
capable values.

Studio requires its dedicated `STUDIO_DATABASE_URL` runtime role. The guarded
deployment requires that URL and `STUDIO_MIGRATION_DATABASE_URL` to use the same
backed-up `postgres:5432` database and schema as the API URLs; a separate Studio
database/schema is unsupported and fails preflight. The three maintenance URLs
must target that same backed-up identity while retaining three distinct logins
and secrets. `MEDIA_AI_URL` enables no-key local AI
background removal through the bundled media-ai service. Set
`STUDIO_REMOVE_BG_API_KEY` only if you want the external remove.bg provider;
without it, Studio uses media-ai when available and then the built-in
server-local remove-background, enhancer, and upscaler. Keep
`STUDIO_ALLOW_LOCAL_DEV_WORKSPACE=false` for production so unauthenticated users
cannot access the local development Studio workspace.

Set `STUDIO_REQUIRE_EXTERNAL_IMAGE_PROVIDER=true` only when deployment should
fail if production-grade background removal is not configured.

The supported public web deployment hard-disables direct observer access and
local probing. It intentionally does not inject `ARENZYRA_OBSERVER_DIRECT_SECRET`;
the authenticated desktop bridge is the production observer path. Preflight
rejects attempts to enable the direct web flags so a partial configuration
cannot silently ship.

For the Discord bot API access that does not expire, set these API service-token values:

- `ARENZYRA_API_SERVICE_TOKEN_SHA256`
- `STUDIO_QA_SERVICE_TOKEN_SHA256` (optional, for temporary live Studio QA tokens)
- `ARENZYRA_API_SERVICE_ORGANIZATION_ID`
- `ARENZYRA_API_SERVICE_USER_ID`
- `ARENZYRA_API_SERVICE_USER_EMAIL`

## Optional integrations

If you use observer/live-shadow features, set the related endpoints in `infra/.env.publish`:

- `OBSERVER_BASE_URL`
- `PCOB_BASE_URL`
- `SHADOW_API_BASE`
- `MATCH_STATE_BASE`
- `MEDIA_AI_URL`
- `OPENAI_API_KEY`
- `OPENAI_VISION_MODEL` (defaults to `gpt-4.1-mini`)
- `OPENAI_VISION_MAX_IMAGE_EDGE` (defaults to `2048`)

If those services run on the same server outside Docker, `host.docker.internal` can be used as a starting point.

## Useful commands

```bash
production_entry observe ps
production_entry observe logs
```

These read-only helpers resolve the reviewed Compose project from
`infra/.env.publish`. Do not use an unguarded `docker compose down`, restart,
recreate, or `up` on production; use the guarded deployment/recovery workflow.

### Existing web-container recovery

If an otherwise healthy host restart leaves the single existing web container
stopped, use the reviewed recovery action:

```bash
production_entry recover-web
```

This command is intentionally narrower than a deployment. It acquires the
shared production deployment lock, runs the standard environment, disk,
volume, and dependency-health preflight in the dedicated web-recovery mode,
and requires exactly one stopped Compose `web` container. It starts that exact
container by immutable container ID, without Compose dependency traversal and
without building, pulling, creating, recreating, or migrating anything. It
then proves that every project container and image identity is unchanged,
waits for the existing web healthcheck, reruns preflight, and verifies the
public Arenzyra HTTPS origin. A missing, duplicate, running-unhealthy, or
identity-changing web container fails closed; use the full reviewed release
workflow for those cases.

## Production host cleanup

Production builds can leave Docker build cache behind. Keep these safeguards
enabled on the server:

```bash
production_entry host-maintenance --check-only
production_entry host-maintenance
```

The maintenance script defaults are conservative:

- Docker builder cache is pruned with a `15GB` reserved cache target.
- Only local backup sets with both `OFFSITE_VERIFIED` and
  `RESTORE_DRILL_VERIFIED` markers are eligible for age-based deletion; every
  unverified set and the newest verified set are preserved.
- disk usage warnings start at `85%`; critical status starts at `90%`.
- only build cache and old backup entries are removed.

Do not install the checked-in cron template as a raw checkout-script entry. A
scheduled job needs a separately installed root-owned launcher that implements
the same reviewed-commit `production_entry host-maintenance` bootstrap. Until
that host-owned scheduling wrapper is reviewed, run cleanup manually through
the allowlisted entrypoint.

Optional environment overrides:

```bash
# See infra/arenzyra-maintenance.env.example.
# Put overrides in /etc/arenzyra-maintenance.env for a future reviewed scheduler.
ARENZYRA_DOCKER_BUILDER_KEEP_STORAGE=15GB
ARENZYRA_BACKUP_RETENTION_DAYS=30
ARENZYRA_DISK_WARN_PERCENT=85
ARENZYRA_DISK_CRITICAL_PERCENT=90
ARENZYRA_DISK_ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

## Verify parity after deploy

After the stack is updated, verify the live site is serving the same build as a local production preview:

```bash
npm --prefix apps/arenzyra-web run verify:live
```

That command rebuilds the local web app, starts a local production preview on `http://127.0.0.1:3011`, fetches `/api/version` from both local and live, and compares the homepage build metadata, title, and `h1`.

Then verify the deployed public stack and Studio auth gates:

```bash
production_entry verify
```

For the authenticated Studio path, run the live QA script with a real organizer
session. Prefer environment variables so secrets are not stored in shell history:

```bash
STUDIO_QA_EMAIL="organizer@example.com" \
STUDIO_QA_PASSWORD="..." \
production_entry studio-qa
```

You can also pass a current access token:

```bash
STUDIO_QA_AUTH_TOKEN="..." production_entry studio-qa
```

For automated production checks, the existing API service token can be used
without an organizer password:

```bash
STUDIO_QA_SERVICE_TOKEN="..." production_entry studio-qa
```

If you do not keep the plaintext service token, set only
`STUDIO_QA_SERVICE_TOKEN_SHA256` on the API and pass the matching plaintext token
to the QA script. This can be a temporary one-time token and does not replace the
Discord bot service token.

The script creates temporary media, published runtime, and review records, then
cleans them up. It only writes to the main Studio workspace if
`STUDIO_QA_INCLUDE_WORKSPACE_WRITE=1` or `--include-workspace-write` is set;
use that option only when no one else is actively editing the same organizer
workspace.

Use `STUDIO_QA_REQUIRE_EXTERNAL_IMAGE_PROVIDER=1` to fail QA when remove.bg is
not configured. Use `STUDIO_QA_TEST_EXTERNAL_IMAGE_PROVIDER=1` to run one real
external background-removal request; this can consume provider credits.

## Notes

- This publish stack is intentionally separate from the existing local stack in `infra/docker-compose.yml`.
- If you do not have a domain yet, keep using the direct-port stack temporarily. The publish stack here is prepared for real domain-based deployment with HTTPS.
