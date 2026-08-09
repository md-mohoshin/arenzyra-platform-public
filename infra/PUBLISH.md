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

You can generate a first production env file with strong local secrets:

```bash
npm run deploy:create-env
```

Review the generated `infra/.env.publish` before deploying, especially email,
Discord, YouTube, SMTP, OpenAI, and optional Studio remove.bg values.
The generated YouTube token key is distinct from other application secrets.
For an existing database, follow
[`docs/YOUTUBE_TOKEN_KEY_ROTATION.md`](../docs/YOUTUBE_TOKEN_KEY_ROTATION.md)
before changing or removing any YouTube token key.

## Start the publish stack

Every production deployment must first pass the read-only disk and service
health gate:

```bash
npm run deploy:guard
```

The gate requires at least 30 GiB free on `/` by default. It exits with
`DEPLOYMENT BLOCKED` when space is below the threshold or an existing production
container is unhealthy. It never performs cleanup automatically. Both guarded
`deploy:up` commands run this check before generating release metadata or
starting a build.

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

A checksum match is necessary evidence, not release authorization. The current
15-file candidate migration set remains blocked until its existing release
lineage and current production ledger have been reconciled and reviewed. Do not
infer applied state from directory timestamps or the earlier pending-name audit.

For a non-first full deploy, the same pre-mutation phase runs a read-only,
aggregate-only entitlement query over non-deleted organizations. It reports
counts, never organization identifiers or other row data, and performs no
reconciliation. The release fails closed if the query or count parsing fails,
or if any organization violates the canonical `ACTIVE`, `TRIALING`, or
`EXPIRED` storage-shape rules. Elapsed paid/trial clocks remain safely denied by
the runtime and do not become deployment failures merely because time passes.
Use the reviewed reconciliation procedure below;
deployment never backfills or edits entitlement rows.

`--first-deploy` first proves that the Compose project has no managed containers
or old writers, but that fact is not evidence that a persistent database volume
is empty. After the guarded deploy starts only Postgres and Redis and they are
healthy, it runs a read-only aggregate catalog query. The target must contain
zero relations in every non-system schema before the entitlement gate may be
skipped and before backup or migration. Any pre-existing relation, query
failure, or malformed count blocks the first deploy. The first-deploy flag alone
never waives data-impact review for an existing database.

For a non-first full deploy, this initial read-only phase also requires the IDP
storage migration to be finished and the legacy plaintext schedule count to be
zero. A pending IDP storage migration or nonzero count therefore blocks before
release metadata, builds, backups, migrations, or replacement services and is
handled in the controlled-maintenance sequence below. The same zero-count check
runs again after the new API is healthy as defense in depth.

The full deploy creates and verifies its encrypted off-host pre-migration
backup, then immediately repeats `production-deploy-preflight.sh` before the API
migration. This catches root-disk capacity consumed by the backup itself. A
failed repeated preflight stops before schema mutation.

Then run the publish configuration preflight before starting or updating the
stack:

```bash
npm run deploy:preflight
```

That command validates `infra/.env.publish`, checks the Studio production env
wiring, and runs `docker compose config` when Docker Compose is available.

Use the guarded command; a raw `docker compose up --build` bypasses the
migration-safety ordering and is not a supported API production deployment:

```bash
cd /opt/arenzyra
env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root \
  npm run deploy:up
```

Use the same clean-environment prefix with `npm run deploy:up:discord-bot`.
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

For a custom Discord-bot-only deployment, run `npm run deploy:guard`
immediately before each build, restart, recreate, or Compose-up. A custom or
partial change that can replace the API/web writer, alter schema, or change
database-backed access must also run the migration-safety, entitlement, and IDP
plaintext-zero gates in the same pre-mutation session. If a classified
contract/data-impact migration is pending, use the separately reviewed
writer-stopped maintenance procedure below; `deploy:guard` alone is not an API
release authorization. Prefer `npm run deploy:up` or
`npm run deploy:up:discord-bot` whenever their supported topology fits.

## Contract and data-impact migrations

The current manifest classifies these migrations as incompatible with an old
API writer:

- `20260804120000_auth_password_actions`
- `20260805010000_harden_tournament_invite_lifecycle`
- `20260805020000_refresh_token_families`
- `20260805021000_idp_encrypted_credential_storage`
- `20260805030000_broadcast_capability_lifecycle`
- `20260805070000_widget_capability_lifecycle`

It also classifies these migrations as requiring explicit acceptance of their
effect on stored data, visibility, authentication, credentials, or external
access:

- `20260804230000_match_publication_boundary`: existing matches and tournaments
  become private under the fail-closed publication default.
- `20260805010000_harden_tournament_invite_lifecycle`: existing invite secrets
  are hashed and receive `createdAt + 7 days` expiry; this also contains a
  contract change.
- `20260805020000_refresh_token_families`: all refresh-token rows are backfilled
  and indexed, with authentication-session and lock impact.
- `20260805021000_idp_encrypted_credential_storage`: the schema transition must
  be followed by the separately gated, manual plaintext-to-envelope workflow.
- `20260805030000_broadcast_capability_lifecycle`: existing broadcast secrets
  are hashed and receive a fixed migration-time 180-day expiry; this also
  contains a contract change.
- `20260805040000_platform_superadmin_mfa`: existing super-admin refresh
  sessions lack MFA verification and fail closed under the required policy.
- `20260805050000_private_assets_and_screenshot_evidence`: legacy OCR source
  URLs are scrubbed from stored JSON without a reversible replacement.
- `20260805060000_durable_manual_billing`: the organization default becomes
  `EXPIRED`, and inconsistent legacy entitlement rows require reviewed manual
  reconciliation.
- `20260805070000_widget_capability_lifecycle`: existing widget secrets are
  hashed and receive a fixed migration-time 180-day expiry; this also contains
  a contract change.

The preferred future workflow is expand/contract: add the replacement shape,
deploy dual-compatible code, backfill and verify it, then drop the legacy shape
in a later release. The migrations above already contain their contract step,
so a routine zero-downtime deploy intentionally refuses to apply them.

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
Before it creates or acquires the deployment lock or reads release archives,
the rollback wrapper runs the checkout-only source gate from a sanitized
`env -i` Node process. The gate requires `/opt/arenzyra`, every collected
release input, the complete `scripts` tree, and root/API/web Git metadata to be
root-owned and not group- or other-writable; release input files must also have
one hard link. This gate deliberately does not require the current orchestration
checkout to equal the older target release: that would prevent a current,
reviewed rollback wrapper from selecting an archived older bot image. The
target image is instead bound to the archived release environment and immutable
image manifest as described below.

The rollback shell and its first sourced environment guard necessarily execute
before an in-checkout verifier can inspect that checkout. Start the entrypoint
with the clean parent `env -i` launcher above and keep `/opt/arenzyra`
root-controlled; an in-script gate cannot repair a compromised parent shell or
a verifier that was already replaced by root.

Before Compose can start the bot, the rollback wrapper validates the manifest's
exact archive path, root ownership, `0600` mode, non-symlink identity, closed
schema, and binding to `<release-id>.env`; the locally tagged image ID and labels
must then match the archived evidence exactly.

This maintenance sequence is deliberately not automated by
`deploy-production.sh`; its exact stop/migrate/start command sheet must be
reviewed against the production topology. Every build, restart, recreate, or
Compose-up in that sheet remains subject to `scripts/production-deploy-preflight.sh`
and the repository production rules.

Database-writing API utilities must not be launched by loading
`apps/api/.env` or by pointing a host-side command at production. Use
`npm run deploy:api-maintenance -- ...` from `/opt/arenzyra`. The wrapper holds
or verifies the shared production deployment lock, rejects a process env file
or Compose-project override that differs from `infra/.env.publish`, validates
the resolved Compose database bindings and physical PostgreSQL target, and runs
the mandated deployment preflight again immediately before its one-off
immutable API-image command. It also rejects remote/non-default Docker routing,
strips ambient Compose and secret interpolation from the command environment,
requires the local `/var/run/docker.sock`, and selects the already-local image
from reviewed `infra/.env.release` metadata without building or pulling. Before
the task starts, it inspects that exact local tag and requires its OCI revision,
build time, release ID, source digest, and release-source labels to match the
reviewed manifest. A controlled-maintenance command sheet may select a
pre-cutover candidate in `.env.release`; the candidate does not have to be the
currently running release, but its tag and provenance must match exactly. Each
task runs through a dedicated, network-minimized Compose service that receives
only its database URL and task-specific encryption settings. Dry-run and scan
sessions also enforce PostgreSQL transaction-default read-only mode. The
wrapper verifies the administrator and all seven application roles under the
inherited lock. IDP and YouTube dry-run/scan services receive only
`MAINTENANCE_READ_DATABASE_URL`; neither apply URL is present in those
containers. The shared read role has only database `CONNECT`, schema `USAGE`,
and column-level `SELECT` on the fields inspected in `DiscordIdpSchedule` and
`YoutubeChannel`. IDP apply receives only `IDP_MAINTENANCE_DATABASE_URL`, with
column-level `SELECT` on its identity/context/CAS fields and `UPDATE` only on
`roomPassword`, `primaryMessage`, `reminders`, and the Prisma-managed
`updatedAt`. YouTube apply receives only `YOUTUBE_MAINTENANCE_DATABASE_URL`,
with column-level `SELECT` on `id`, both token envelopes, and `updatedAt`, and
`UPDATE` only on both token envelopes and `updatedAt`. These roles have no
table-wide DML, sequence, function, ledger, other-table, schema-create,
ownership, membership, or grant-option authority.

Every `apply` action automatically creates a fresh encrypted production backup,
requires its off-host checksum verification, disallows missing required API
volumes, validates the completion markers and encrypted database artifacts, and
repeats the production preflight immediately before and after that backup.
Dry-run and scan actions remain read-only and do not create a backup. The
wrapper also adds PostgreSQL's `default_transaction_read_only=on` boundary to
those non-apply sessions. It does not stop writers, apply a schema migration,
or start replacement services; those remain explicit steps in the reviewed
command sheet.

The compiled utilities use a 10-second connection timeout, 10-second database
lock timeout, 120-second server statement timeout, and 130-second client query
timeout. A timeout exits nonzero and must be investigated; do not weaken the
limits or treat a partial apply as success. Re-run the read-only inventory and
the relevant postcondition gate before deciding whether an idempotent retry is
safe.

### Entitlement reconciliation

The routine entitlement gate enforces these canonical stored forms for
non-deleted organizations:

- `ACTIVE`: `paidUntil` is present and `trialEndsAt` is null.
- `TRIALING`: `trialEndsAt` is present and `paidUntil` is null.
- `EXPIRED`: both `paidUntil` and `trialEndsAt` are null.

This is deliberately separate from effective access. `ACTIVE` grants access
only while `paidUntil` is in the future, and `TRIALING` only while
`trialEndsAt` is in the future. An elapsed clock therefore fails closed without
requiring an automatic database write, and cannot make a release fail just by
crossing a timestamp during deployment. An audited operator may later normalize
the commercial workflow status to `EXPIRED`, which clears both clocks.

Any other status or aggregate mismatch fails closed. Gate output contains only
status and inconsistency counts; it intentionally cannot identify affected
organizations. Investigate and reconcile through an approved, audited,
writer-stopped maintenance procedure using a fresh verified off-host backup,
reviewed target selection, before/after counts, and the normal billing audit
path. Do not add an automatic deploy backfill, print identifiers from the gate,
or weaken a boundary to make deployment pass. After the controlled correction,
rerun the read-only gate and record zero inconsistent counts before returning to
the standard deployment workflow. The detailed billing semantics are in
[`MANUAL_BILLING_RUNBOOK.md`](../docs/product/MANUAL_BILLING_RUNBOOK.md).

### Legacy IDP credential backfill

The IDP storage migration widens the encrypted envelope column but does not
rewrite data. The new API can read legacy rows and always writes encrypted
credentials. The old API can still write plaintext, so never run the backfill
while an old API can execute, and never restart the old API after the backfill.

Run the read-only inventory from the production root using the reviewed
maintenance wrapper. During the approved writer-stopped window, after the IDP
storage migration is applied, run the apply form with both the wrapper's
stopped-writer acknowledgement and the utility's exact confirmation:

```bash
cd /opt/arenzyra
npm run deploy:api-maintenance -- idp-credentials dry-run
npm run deploy:api-maintenance -- idp-credentials apply \
  --writers-stopped --confirm=BACKFILL_IDP_CREDENTIALS
npm run deploy:verify-idp-encryption
```

Review the dry-run candidate count before the explicit apply. Apply fails unless
the reviewed Compose project has exactly one API container in the `exited`
state, the entire host has zero running containers labelled as the API service,
and PostgreSQL reports zero sessions for the reviewed API runtime role. The
maintenance-only preflight exception still requires every other managed
container to pass its normal health policy. This is a boundary check, not
permission to skip the command sheet's verification of every writer in the
actual topology.

After those checks, apply requires the exact NOT VALID envelope CHECK, then
re-reads and authenticates every stored envelope in a `SERIALIZABLE`
transaction. Per-row compare-and-swap updates include the prior `updatedAt`,
and a final in-transaction re-read requires zero legacy rows before commit; any
conflict or failed postcondition rolls the entire transaction back. This keeps
the apply role on exact column grants instead of table-wide UPDATE. Dry-run also
requires the reviewed encryption key and reports only aggregate invalid,
encrypted, legacy, and oversized counts—never schedule identifiers. The deploy
command never runs this backfill. After a successful apply, the wrapper
automatically reattests the physical target, requires the zero-legacy IDP
structural gate, and rechecks the database-role contract before it reports
success. The explicit `deploy:verify-idp-encryption` command above is a useful
independent recorded recheck. Routine non-first deployment checks that the
storage migration is finished and the legacy plaintext schedule count is zero
both before any release mutation and after the new API becomes healthy. Do not
describe IDP schedules as encrypted at rest until
`IDP ENCRYPTION GATE PASSED legacy_plaintext_schedules=0` is recorded.

## Release provenance

Each deploy should generate a non-secret `infra/.env.release` manifest before
building. It records a release ID, build timestamp, and content digest. When a
clean Git checkout is available it also records its revision; source bundles
without Git metadata are explicitly labelled `source-digest` rather than being
misreported as a clean Git release.

Generate metadata directly only for an approved controlled-maintenance command
sheet. Routine releases must use `npm run deploy:up`, which generates and
archives the metadata after its release-safety gates pass.

`npm run deploy:up` and `npm run deploy:up:discord-bot` generate this metadata
automatically. The digest covers the complete deployment-script tree, the
database object policy, every reviewed API/Studio migration SQL source, and the
exact role-bootstrap SQL while continuing to exclude arbitrary SQL/dumps,
secrets, and local artifacts. Keep the generated manifest with the deployment
backup so every built service can be traced to the same reviewed source.

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

From `/opt/arenzyra`, root can retrieve an expected API image ID only after
validating it against the exact archived release environment:

```bash
release_id='git-YYYYMMDD-HHMMSSmmm-xxxxxxxxxxxx'
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root \
  node scripts/validate-release-image-manifest.cjs \
  --file "/opt/arenzyra-release-metadata/${release_id}.api-image.json" \
  --release-env "/opt/arenzyra-release-metadata/${release_id}.env" \
  --expected-release "$release_id" --service api --print-image-id
```

Deploy commands do not delete files or run maintenance automatically. Scheduled
host cleanup remains separate from deployment and is invoked explicitly with
`npm run deploy:maintenance`. Reviewed database-writing API work instead uses
the separately locked `npm run deploy:api-maintenance -- ...` wrapper described
above.

This command intentionally does not start the local `discord-bot` service. The
Discord bot should have one production runtime only. If you deliberately need to
start this stack's bot, opt in explicitly:

```bash
npm run deploy:up:discord-bot
```

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

On a guarded `--first-deploy`, the deploy starts only Postgres/Redis, proves the
database has zero application relations, then provisions and connectivity-tests
the seven application URL roles under the inherited deployment lock before backup or
migration. Do not run a separate bootstrap command for that clean path.

For an existing installation, the helper can create missing roles and establish
grants only after existing object ownership already matches the reviewed API
and Studio migration-role boundary:

```bash
bash scripts/provision-production-database-roles.sh --env infra/.env.publish --dry-run
```

The script shares or verifies the deployment lock, reruns the production
preflight, binds to the reviewed database/schema/container, creates only missing
non-superuser roles, passes credentials over protected stdin, establishes
separate API/Studio/maintenance grants, and verifies the administrator plus all
seven application role connections. It
deliberately does not rotate an existing role password. Existing installations
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
returns. Never use blanket `REASSIGN OWNED`, `\gexec`, dynamically generated
unreviewed SQL, or a superuser service URL to make the migration pass.

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
  closure procedure before the first `--first-deploy` role provisioning run.
  Restrictive HBA rules remain defense-in-depth but do not satisfy this ACL
  gate. The role provisioner checks PUBLIC and every already-existing
  configured app role with the administrator before backup, role creation, or
  any SQL mutation. It fails safely on a stock cluster and reports the blocking
  database/role/reason tuples as escaped JSON. The role scripts never
  auto-revoke cluster-wide ACLs; the first deployment remains blocked until
  that prerequisite is complete and the gate passes.
- The current schema has no reviewed row-level-security design. Any
  `relrowsecurity`/`relforcerowsecurity` flag or `pg_policy` row in the
  application schema fails the role gate instead of being silently accepted.
- The committed database object policy currently binds repository source
  digests to 146 API runtime tables, 6 Studio runtime tables, both migration
  ledgers, zero sequences, all 76 Prisma enum types with 375 ordered labels,
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
npm run deploy:ps
npm run deploy:logs
```

These read-only helpers resolve the reviewed Compose project from
`infra/.env.publish`. Do not use an unguarded `docker compose down`, restart,
recreate, or `up` on production; use the guarded deployment/recovery workflow.

## Production host cleanup

Production builds can leave Docker build cache behind. Keep these safeguards
enabled on the server:

```bash
npm run deploy:maintenance
npm run deploy:maintenance:check
```

The maintenance script defaults are conservative:

- Docker builder cache is pruned with a `15GB` reserved cache target.
- Only local backup sets with both `OFFSITE_VERIFIED` and
  `RESTORE_DRILL_VERIFIED` markers are eligible for age-based deletion; every
  unverified set and the newest verified set are preserved.
- disk usage warnings start at `85%`; critical status starts at `90%`.
- only build cache and old backup entries are removed.

Install the checked-in cron template on production:

```bash
cp infra/arenzyra-maintenance.cron /etc/cron.d/arenzyra-maintenance
chmod 0644 /etc/cron.d/arenzyra-maintenance
```

Optional environment overrides:

```bash
# See infra/arenzyra-maintenance.env.example.
# Put overrides in /etc/arenzyra-maintenance.env for cron runs.
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
npm run deploy:verify
```

For the authenticated Studio path, run the live QA script with a real organizer
session. Prefer environment variables so secrets are not stored in shell history:

```bash
STUDIO_QA_EMAIL="organizer@example.com" \
STUDIO_QA_PASSWORD="..." \
npm run deploy:studio-qa
```

PowerShell:

```powershell
$env:STUDIO_QA_EMAIL = "organizer@example.com"
$env:STUDIO_QA_PASSWORD = "..."
npm run deploy:studio-qa
Remove-Item Env:\STUDIO_QA_EMAIL, Env:\STUDIO_QA_PASSWORD
```

You can also pass a current access token:

```bash
STUDIO_QA_AUTH_TOKEN="..." npm run deploy:studio-qa
```

For automated production checks, the existing API service token can be used
without an organizer password:

```bash
STUDIO_QA_SERVICE_TOKEN="..." npm run deploy:studio-qa
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
