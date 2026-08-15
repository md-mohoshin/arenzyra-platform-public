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
container is unhealthy. The only automatic cleanup is the separately bounded
old dangling build-cache preparation documented below, and it can run only
after this gate already passes. Both committed launcher modes run this check
before generating release metadata or starting a build. A full deploy also
verifies the exact PostgreSQL 16.14 target,
the API data-volume boundary, clean release source, entitlement stored shape,
and the structural IDP postcondition before it can build or mutate a release.

The read-only production audit on 2026-08-09 does **not** satisfy those gates.
`/opt/arenzyra` is a non-Git mixed release without a complete cryptographic
release-file manifest from the exact clean Root/API/Web assembly; PostgreSQL is
16.13 rather than the pinned 16.14 release; 12 IDP schedules still fail the
credential/message zero-plaintext postcondition; entitlement inventory reports
4 expired `ACTIVE` clocks and 2 invalid `TRIALING` clocks (runtime access is
denied, but these elapsed clocks are not a deployment blocker); and the
`api-uploads` and `api-storage` roots are `0:0` mode `0777`. These are current
hard blockers, not optional warnings. The routine deploy must not change
customer rows, volume contents, ownership, modes, or database state to make
them pass. The separately reviewed one-time `legacy-cutover` command below
performs only the explicit conversion steps needed for this exact legacy
profile, after a fresh immutable off-site backup.
That follow-up inventory initially found no production `rclone` executable or
configured off-host destination. The reviewed backup bootstrap now supplies
that boundary; a cutover remains blocked unless its same-session backup proves
the configured immutable off-site destination immediately before mutation.

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
reconciliation. The release fails closed if a query or bounded parser fails, or
if stored `ACTIVE`, `TRIALING`, or `EXPIRED` forms are inconsistent. Current
clock results are retained as operational inventory, while elapsed or missing
clocks remain fail-closed at every runtime access boundary. A clock naturally
elapsing during a release does not block deployment and never triggers an
automatic customer-row write.

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

### Live-match deployment warning

Routine full and Discord-only releases are allowed while matches are active.
The wrapper prints a prominent warning, but it does not run the aggregate
quiescence gate and does not take the exclusive PostgreSQL activation advisory
lock. Match countdown/live transactions therefore are not rejected with `503`
merely because a routine deployment is running.

The routine Compose activation uses `--no-deps` with the explicit `api`,
`media-ai`, `web`, and `proxy` services. It does not recreate PostgreSQL or
Redis. API and web are still single active instances, so this is not blue/green:
ordinary HTTP/WebSocket connections may reconnect during their controlled
recreate, and in-memory match work is not guaranteed to survive. This policy
change removes the deployment block; it does not make the current topology
zero-impact. True live-match blue/green requires a separate multi-instance audit
of Socket.IO fan-out, in-memory match state, background workers, and singleton
processing before a second API instance is safe.

An already-built, archived, immutable `web-candidate` remains the least
disruptive live-match activation. It recreates only the stateless Web container
with `--no-deps`, fingerprints every non-Web container before and after
activation, does not build, migrate, back up, restart the
API/media/proxy/Discord services, or advance the full-release pointer. Browser
connections may reload, but match control and telemetry writers remain
untouched.

Before a routine full or Discord build, disk use at or above 80% triggers one
reviewed proactive cleanup under the shared deployment lock. It can remove only
dangling Docker build cache older than seven days and then repeats the ordinary
preflight. It never automatically removes backups, images, containers, volumes,
logs, PostgreSQL, Redis, uploads, source archives, or customer files. The
30-GiB absolute floor remains in force; if cache cleanup is insufficient, the
deployment stops for explicit reviewed retention rather than broadening scope.

The one-time legacy database cutover remains subject to the aggregate
live-match quiescence gate because it stops writers and changes the database
topology. Stale-match recovery also retains its exact, backup-backed inventory
guards. Neither restriction is part of a routine full or Discord deployment.

Before generating new release metadata, the wrapper also proves that each
candidate Root, API, and Web commit contains the corresponding commit recorded
by the deployed `CURRENT` release. A divergent or older branch fails closed.
This forward-history rule prevents a later patch deployment from silently
dropping an earlier deployed fix; reconcile history with a reviewed merge
instead of bypassing the check.

A routine full release or non-bootstrap Discord release also requires that
verified managed baseline. If neither a valid `CURRENT` archive pointer nor the
last valid `infra/.env.release` can establish it, deployment stops. Absence of a
baseline is not treated as permission to replace unknown live code. Only the
separately reviewed legacy/adoption and recovery paths, or the zero-container Discord
`--first-deploy` exception, can begin without one; never manufacture a pointer
to make this gate pass.

The off-site backup still performs one complete immutable checksum comparison
for every encrypted artifact. After uploading `OFFSITE_VERIFIED`, its second
comparison is intentionally filtered to that newly-created marker only. This
removes the former duplicate full remote rehash without weakening verification
of either the encrypted backup or its completion evidence.

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

### Reviewed source transfer and activation from Windows

Changing the reviewed Root/API/Web commits first requires an exact clean source
assembly at `/opt/arenzyra`; a deploy cannot fetch or accept a dirty checkout.
Use [`publish-production-reviewed-source.ps1`](../scripts/publish-production-reviewed-source.ps1)
from the clean target Root checkout. It packages only the three explicit target
commits into standalone Git repositories, proves each target contains the exact
current production source commit, computes each transferred tar SHA-256, and
creates a versioned local descriptor. The bundle directory and remote incoming
directory are both no-overwrite. An interrupted transfer must use a new release
ID; do not delete or reuse its partial incoming directory during deployment.

The commands below show the reviewed direct-host profile. Replace every commit
placeholder with a full 40-hex commit and use a new release ID. The `current`
values are the exact clean Root/API/Web heads already installed under
`/opt/arenzyra`, not merely abbreviated release-pointer values. The successful
`source-20260815-widget-latency-05` activation installed Root
`1f50dd5b8b40cc6e32afff5df04d9f51d174f43e`, API
`88efdad94d65c09c6d3bd73e4b874db915629859`, and Web
`3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4`; the successor descriptor must use
those exact current values. Do not substitute the separate deployed Web release
pointer `38cca5de4670ca123a4004e9fd6dfec6ccb48bcb`; it is not the current Web
source-checkout head. No credential or application secret is accepted by this
workflow.
The failed local `source-20260815-widget-latency-01` package remains preserved
as evidence and must not be deleted or reused. The superseded
`source-20260815-widget-latency-02` incoming, staging, archive, and prior-source
copies were already verified and deleted through the reviewed source-retention
command; that retired ID must never be reused. The prior successful
`source-20260815-widget-latency-03` evidence remains preserved. The successfully activated
`source-20260815-widget-latency-04` release also remains preserved; preserve its
incoming, staging, archive, and source evidence. The successfully activated
`source-20260815-widget-latency-05` release is the current source assembly;
preserve its incoming, staging, archive, and source evidence. This reviewed
successor uses the next unique release ID below.

```powershell
$sourceRelease = 'source-20260815-widget-latency-06'
$sourceBundle = "C:\Arenzyra\deploy-artifacts\$sourceRelease"
$sourcePublisher = 'C:\Arenzyra\.codex-worktrees\root-widget-latency-release-20260815\scripts\publish-production-reviewed-source.ps1'
$targetRootRepository = 'C:\Arenzyra\.codex-worktrees\root-widget-latency-release-20260815'
$targetApiRepository = 'C:\Arenzyra\.codex-worktrees\api-live-widget-latency-release-20260815'
$targetWebRepository = 'C:\Arenzyra\.codex-worktrees\web-live-widget-latency-release-20260815'

$currentRoot = '1f50dd5b8b40cc6e32afff5df04d9f51d174f43e'
$currentApi = '88efdad94d65c09c6d3bd73e4b874db915629859'
$currentWeb = '3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4'
$targetRoot = '<40-hex-reviewed-target-root>'
$targetApi = '88efdad94d65c09c6d3bd73e4b874db915629859'
$targetWeb = '3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4'

& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned `
  -File $sourcePublisher -Action SelfTest `
  -BundleDirectory $targetRootRepository

& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned `
  -File $sourcePublisher -Action Package -BundleDirectory $sourceBundle `
  -ReleaseId $sourceRelease `
  -RootRepository $targetRootRepository `
  -ApiRepository $targetApiRepository -WebRepository $targetWebRepository `
  -CurrentRootCommit $currentRoot -CurrentApiCommit $currentApi `
  -CurrentWebCommit $currentWeb -TargetRootCommit $targetRoot `
  -TargetApiCommit $targetApi -TargetWebCommit $targetWeb
```

Review `source-transfer.json` and the three printed archive hashes. Transfer the
unchanged bundle with the explicit pinned OpenSSH identity and known-host file:

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned `
  -File $sourcePublisher -Action Transfer -BundleDirectory $sourceBundle `
  -ProductionHost 'root@188.245.47.45' `
  -IdentityFile 'C:\Users\mohos\.ssh\id_ed25519' `
  -KnownHostsFile 'C:\Users\mohos\.ssh\known_hosts'
```

Before any connection, `Transfer` repeats the descriptor's exact clean target
Root/API/Web and forward-history checks. Its committed clean-parent helper bytes
are the reviewed outer Windows launcher for this staging-only action. The
pre-existing `/opt/arenzyra-release-incoming` parent must be root-owned mode
`0700`; the helper will not create or repair that host boundary.

`Transfer` performs a read-only remote check of that parent and requires the
release path to be absent. One SFTP batch then creates exactly
`/opt/arenzyra-release-incoming/<release>/` at mode `0700`, uploads only
`root.git.tar`, `api.git.tar`, and `web.git.tar`, and sets those new root-owned
files to mode `0600`. The batch aborts if the directory already exists. A final
read-only remote payload verifies exact names, regular-file/link/mount bounds,
sizes, modes, ownership, and all three SHA-256 values. Thus no pre-activation
remote shell mutates `/opt`; only the SFTP subsystem creates the closed incoming
set. The shell transport's root-only temporary payload is confined to `/run`
and removed on exit. Legacy SCP transport and its remote-shell fallback are not
used. The helper clears the child-process environment and invokes the direct
host with `-F NUL`, `BatchMode=yes`, `CheckHostIP=yes`,
`ClearAllForwardings=yes`, `ConnectionAttempts=1`, `ConnectTimeout=10`,
`ForwardAgent=no`, `GlobalKnownHostsFile=NUL`, `IdentitiesOnly=yes`,
`PermitLocalCommand=no`, `StrictHostKeyChecking=yes`, the explicit
`UserKnownHostsFile`, and one explicit identity. SSH payload invocations also
use `-T`.

After reviewing that transfer result, activate the clean assembly separately:

```powershell
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -NoLogo -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned `
  -File $sourcePublisher -Action Activate -BundleDirectory $sourceBundle `
  -ProductionHost 'root@188.245.47.45' `
  -IdentityFile 'C:\Users\mohos\.ssh\id_ed25519' `
  -KnownHostsFile 'C:\Users\mohos\.ssh\known_hosts'
```

Never replace these invocations with `Get-Content ... | ssh`, a PowerShell
string pipeline, or a pasted here-string. Windows pipeline encoding previously
inserted hidden carriage returns into Bash arguments. The reviewed launcher
converts generated payloads to canonical LF UTF-8, base64-transports the exact
bytes, writes a root-only no-overwrite temporary file under `/run`, verifies its
SHA-256 before Bash evaluates it, and rejects any remaining CR byte.

The first activation from Root
`4d18a9ad56d738e2992d0ca7564c4f8d553865a8` uses the committed one-time
[`activate-production-reviewed-checkout-4d18-bridge.sh`](../scripts/activate-production-reviewed-checkout-4d18-bridge.sh).
That bridge rejects every other current Root/API/Web assembly (the compatible
API is `428ca9d6dd20c065314a1787f5de92bc4f9d8646` and compatible Web is
`2ee104f6fcc22ef0b37a5c1f8b0b42df2ad076aa`). It loads the current lock helper,
dispatcher, and checkout bootstrap only through absolute sanitized `git show`
of `4d18a9a...`; acquires descriptor 8 before verifying the exact current
Root/API/Web assembly; and retains that same descriptor through current-release
inventory, hash-authenticated prepare, clean forward-ancestry checks, a repeated
current inventory, atomic activation, and final inventories. After prepare, it
also hashes the bridge blob from the exact staged target Root commit and
requires it to equal the already-verified bytes being executed. Activation
also requires current, staged, and archive paths to share one filesystem before
either move, and preserves the complete prior source at
`/opt/arenzyra-source-archives/<release>` and final `source-inventory` verifies
that archive plus the completed incoming/staging pair.

Both the one-time bridge and later dispatcher path require the current
`/opt/arenzyra` directory to remain an exact root-owned, non-group/world-writable
physical directory with no mount at or below it before prepare, then repeat the
same attestation before the final current inventory and immediately before the
atomic source swap.

After that one-time bridge, the currently installed reviewed dispatcher owns
the same sequence through its closed command:

```bash
production_entry source-activate \
  <source-release-id> <target-root> <target-api> <target-web> \
  <root-tar-sha256> <api-tar-sha256> <web-tar-sha256>
```

The Windows `Activate` action selects this normal path automatically whenever
the current Root is not the one exact compatibility commit. Source activation
does not build, migrate, restart, recreate, or deploy a service. After it
completes, redefine `production_entry` with the new exact Root/API/Web commits,
then run the intended allowlisted deployment; its mandatory production
preflight and all release gates still apply.

For this widget retirement release, run the `retired-widget-inventory` command
documented below first and review its fixed aggregate output. Do not start the
service deployment unless it satisfies the exact compatibility policy below.

For a reviewed API source-only recovery with no schema change, use the narrow
API activation. It builds and recreates only the API, fingerprints every other
Compose container before and after activation, and still runs the mandatory
production preflight immediately before both build and recreate:

```bash
production_entry deploy-api-recovery
```

For a reviewed Web source-only recovery, use the symmetric narrow activation.
It builds and recreates only Web, fingerprints every other Compose container
before and after activation, and still runs the mandatory production preflight
immediately before both build and recreate. It does not pull images, run API or
Studio migrations, change database roles, touch volumes, or recreate a
dependency:

```bash
production_entry deploy-web-recovery
```

For an operator-requested view of current protected match activity, use the
separate bounded read-only summary. It returns organization names and protected
state counts only; it does not return match, player, or session identifiers and
does not change customer state:

```bash
production_entry protected-match-organizations
```

This reviewed Root source removes the obsolete remote-live mappings for five
keys that are absent from the reviewed Web release. It also removes the four
formerly exposed hotkey choices; `player-card` was not exposed there. The
candidate API enforces those retirements together with the pre-existing retired
`style.focal` and `team-status` capabilities. The existing desktop
`team-status` renderer and assets are deliberately preserved; this release does
not broaden source cleanup beyond the reviewed stale launcher mappings. Source
activation does not deploy a service or publish a desktop installer. After
activating the reviewed source, but before a service deployment or any separate
installer publication, run the fixed-key inventory:

```bash
production_entry retired-widget-inventory
```

`retired-widget-inventory` accepts no arguments and examines exactly
`style.focal`, `team-status`, `teams-alive`, `kill-feed`, `player-card`,
`map-overlay`, and `winner`. It uses the reviewed production database identity
gate and a repeatable-read, read-only transaction. Output is limited to each
fixed widget key and aggregate counts for widget-instance rows, active
widget-instance rows, approval rows, and approved rows. It does not select
organization, instance, approval, user, match, tournament, capability, or
credential identifiers.

The deployment compatibility policy is closed and count-specific:

- Strict keys `style.focal`, `teams-alive`, `player-card`, `map-overlay`, and
  `winner` require `activeWidgetInstances=0` and `approvedRows=0`.
- Grandfathered keys `team-status` and `kill-feed` permit at most one active
  widget instance each and still require `approvedRows=0`.
- Historical inactive widget-instance rows and unapproved approval rows may
  remain. Their aggregate row counts are still parsed and consistency-checked;
  they are not treated as active or approved capability authorization.

The full and narrow API-recovery deployment paths apply the same parser and
policy at every existing activation boundary, including before build and at the
final pre-recreate boundary, then again after health convergence. Unexpected
schema, keys, order, fields, unsafe counts, inconsistent subtotals, more than the
reviewed active grandfathering, or any approved retired row blocks deployment.
There is no override and the inventory and gate never change customer state.
The inventory gate itself grants or reauthorizes no capability. The reviewed
API separately grandfathers only already-existing, active legacy UUID,
generation-0 `team-status` and `kill-feed` capabilities that pass the complete
capability-access checks. The inventory is intentionally count-based: an active
generation-1-or-newer or `wgt_` capability can fit within its aggregate count
envelope, but it remains non-authorizing and the API rejects it. An explicit
`isApproved=false` row also remains non-authorizing even when organization
approval enforcement is disabled; enforcement-enabled organizations still
require an approved row. New issuance, rotation, and approval enabling
(`isApproved=true`) remain denied. Monotonic unapproval/revocation
(`isApproved=false`) remains permitted and is non-authorizing. The retired Web
routes and route aliases remain absent, and the preserved desktop `team-status`
renderer and assets remain in place. Desktop installer publication remains a
separate workflow and is not authorized by the `/opt` source activation or
service deployment.

The following one-time recovery is deliberately restricted to the exact stale
`Global Control` inventory remaining on 2026-08-12: exactly two old `COUNTDOWN`
matches, with no fresh telemetry or live round. It
takes and verifies a new encrypted off-site backup, repeats the production
preflight, locks and rechecks the inventory, and ends the stale sessions without
calculating or publishing results. Any state drift fails closed before writes:

```bash
production_entry end-stale-global-control-matches
# If the operation failed after producing its verified backup but before its
# transaction, reuse that exact recovery point for at most two hours.
production_entry end-stale-global-control-matches-verified-backup \
  <verified-backup-id>
```

The reviewed backup bootstrap and one-time pre-remediation backup are also
closed command IDs:

```bash
# backup-configure reads exactly recipient, key ID, and application key from
# inherited descriptor 3; the secret must not be an argument or environment value.
production_entry backup-configure
production_entry backup-inventory
production_entry backup-inventory-current
production_entry backup-export 20260810T205616Z-a1e31ee3 > encrypted-backup.tar
production_entry backup-legacy
# Resume an interrupted immutable upload from one already-complete encrypted
# local set; use the legacy form only before database/runtime remediation.
production_entry backup-resume 20260810T205616Z-a1e31ee3
production_entry backup-resume-legacy 20260810T205616Z-a1e31ee3
```

Screenshot OCR reads `OPENAI_API_KEY` only in the API service. Restore or rotate
that server-side credential without exposing it in arguments or logs by passing
exactly one key line on descriptor 3. The reviewed action validates the key,
runs production preflight, atomically updates the publish environment, recreates
only the API, waits for health, and runs public verification:

```bash
production_entry openai-key-configure 3<<<"$OPENAI_API_KEY"
```

The one-time Fix Esports Training Series 20:00 and 23:00 recoveries are closed
to their separately reviewed screenshot result tables. Each `check` is
read-only and requires one exact session, one match for each game number, the
expected active-team counts, and a unique roster/team mapping. Each `apply`
repeats its series check, takes a fresh immutable off-site backup, applies only
that series' four full result tables, and posts or refreshes its overall result
in the configured final-result channel:

```bash
production_entry recover-fix-esports-training-results 20-check
production_entry recover-fix-esports-training-results 20-apply
production_entry recover-fix-esports-training-results 23-check
production_entry recover-fix-esports-training-results 23-apply
# Resume both series after an interrupted recovery already produced a complete
# off-site-verified backup less than two hours ago. Both checks repeat before
# the backup is accepted, and preflight repeats before each series write.
production_entry recover-fix-esports-training-results \
  both-apply-verified-backup 20260813T065123Z-323b3730
```

If a newly completed and off-site-verified encrypted recovery set makes the
root filesystem fail the 30 GiB deployment gate, release only one older local
duplicate while retaining both its Object-Locked B2 copy and the newer local
set:

```bash
production_entry backup-local-release \
  <superseded-backup-id> <newer-replacement-backup-id>
production_entry backup-local-release-current \
  <superseded-backup-id> <newer-replacement-backup-id>
```

This maintenance command accepts only the exact low-disk dependency-recovery
topology. It locks deployment and backup activity, validates the closed local
artifact inventory and permissions for both sets, checksum-verifies both sets
against the fixed private B2 destination, repeats the topology gate, deletes
only the superseded local files and now-empty exact directory, and performs no
remote deletion. The ordinary 30 GiB gate remains mandatory before deployment
can resume.

Use `backup-local-release-current` when the complete modern application stack
is healthy. It applies the same local/remote artifact checks and exact deletion
boundary while retaining the ordinary strict service and non-root API-volume
policy. The original command remains limited to its stopped cutover dependency
topology.

`backup-configure` accepts only the fixed hash-pinned incoming `age`/`rclone`
binaries, the private EU Central B2 endpoint, bucket
`arenzyra-prod-backup-84f2c9`, and prefix `arenzyra/production`. It leaves the
age private identity off the server and proves an immutable encrypted
upload/download checksum round trip before atomically adding backup settings to
the live environment. It adds separate `ARENZYRA_RECOVERY_V1_*` settings and
does not replace any existing `ARENZYRA_BACKUP_*` configuration. Any
pre-existing artifacts under `/opt/arenzyra-backups` remain untouched; new reviewed sets use the isolated
`/opt/arenzyra-backups/encrypted-v1` subtree. `backup-legacy` is read-only with respect to application
state and accepts only the exact observed PostgreSQL 16.13 and legacy API-volume
profile. Neither command authorizes a deployment bypass; normal releases and
scheduled backups continue to require the strict current profile.

`backup-resume` and `backup-resume-legacy` accept only a syntactically valid
backup ID already present in the isolated managed subtree. They reject unsafe,
missing, or unexpected local artifacts, upload with immutable semantics, and
exclude `OFFSITE_VERIFIED` until every encrypted artifact has passed an
off-site checksum comparison. They then upload that marker and repeat the full
checksum comparison. This is the supported recovery path after an SSH or
network interruption; it never repeats `pg_dump`, archives a volume, or mutates
application data.

`backup-export` is the reviewed fallback when an off-site provider download cap
blocks an isolated restore rehearsal. It accepts only one verified managed
backup ID, validates every local encrypted artifact, keeps stdout binary-clean,
and streams a tar archive while holding the shared production and backup locks.
It does not decrypt data or invoke a database, volume, Compose, or service
mutation.

`backup-inventory` is a read-only, lock-coordinated inspection of the fixed
local backup root. It reports only aggregate counts, marker presence, and
whether the root contains exactly the verified zero-byte backup lock; it does
not print backup identifiers, file names, contents, recipients, remotes, roots,
or credentials. Backup configuration values are reported only as bounded state
labels such as `empty`, `legacy-placeholder`, `reviewed`, or `other`.
It also reports the private Docker subnet used by the database network so an
exact legacy read-only backup profile can be reviewed without changing that
network.

`backup-inventory-current` reports the same bounded inventory for the healthy
modern non-root production profile. It retains strict service and data-volume
checks and permits only the root disk threshold to be below 30 GiB so an
operator can identify the exact verified local duplicate required by the
reviewed low-disk release command. It never deletes or uploads an artifact.

When the reviewed API or Web commit changes between source activations, source
retention uses `production_entry source-retention --nested` followed by one
retained and one or more superseded `release Root API Web` groups. Each supplied
standalone checkout is verified at all three exact clean commits before only
the explicitly superseded source archive, staging copy, and incoming transfer
are released. Runtime volumes, release metadata, and backups are outside its
fixed roots.

Use `production_entry source-inventory RELEASE...` with one to eight explicit
release IDs before retention when the archived commit identities need to be
re-established. It is read-only and reports only each verified clean archived
Root/API/Web commit, bounded archive size, and whether the exact completed
incoming and staging transfer pair is present. It rejects unsafe, partial, or
mounted source sets and does not inspect or mutate services, volumes, backups,
or application data.

Use `production_entry deploy-discord` for the supported bot-only mode and append
`--first-deploy` only for its documented bot health exception. Do not use the
full first-deploy form. The outer `git show` makes the dispatcher bytes come from
the explicitly reviewed Root commit. It uses absolute sanitized Git to require
the exact clean Root head before checkout execution and exact API/Web heads for
commands that consume them. The deploy later recomputes every release input
before build. Both layers disable Git
replacement objects and reject grafts, replacement refs, and alternate object
stores, so a reviewed commit name cannot resolve to substituted tree bytes.

The existing audited legacy installation has one dedicated, argument-free
forward cutover:

```bash
production_entry legacy-cutover
```

If the one-time cutover stops the legacy application set but fails before the
database transition begins, resume only with the argument-free reviewed path:

```bash
production_entry legacy-cutover-resume
```

The resume path accepts only the exact stopped legacy topology, rebuilds and
archives immutable images from the currently reviewed commits, and creates and
verifies a new encrypted off-site backup while writers remain stopped. It then
continues the same ownership, volume, database, migration, IDP, writer-fence,
health, and public verification chain. It never reuses a stale backup or starts
the previous application writers.

If a transport interruption removes part of the already-stopped application
container inventory, use only the separate argument-free recovery path:

```bash
production_entry legacy-cutover-resume-interrupted
```

If an interrupted resume already completed its fresh encrypted off-site backup
but failed before ownership or schema work, the reviewed recovery launcher can
reuse that backup without creating another large local copy:

```bash
production_entry legacy-cutover-resume-interrupted-verified-backup \
  <backup-id>
```

This path remains limited to the exact stopped interrupted-cutover topology. It
accepts only a backup completed and off-site verified within the last two hours,
requires its archived clean-Git release to have the same reviewed API and Web
commits, requires both reviewed Root revisions to be locally available, and
permits only `scripts/`, the closed database-role bootstrap SQL, or this runbook
to differ between their exact trees. Dependency-transition recovery may also
carry its separately checked Compose correction.
Any application source change, missing/unsafe artifact, or incompatible source
tree fails closed.

If that resume already completed all four immutable candidate builds and their
archived image manifests, but stopped before ownership or schema work, it can
also reuse the candidate rather than rebuilding it:

```bash
production_entry legacy-cutover-resume-interrupted-candidate \
  <release-id> <backup-id>
```

This command requires the same verified-backup contract, an archived clean-Git
release that exactly matches the current checkout, all four root-owned immutable
image manifests, and all four images still present by their archived SHA-256
IDs. It skips only candidate creation; every stopped-writer, backup, role,
migration, IDP, health, and public HTTPS gate still runs.

If that command completed database ownership and byte-preserving API-volume
remediation, recreated exactly PostgreSQL and Redis, and then stopped before the
writer fence because the pinned Redis image could not traverse the legacy AOF
directory, use only the dependency-transition continuation:

```bash
production_entry legacy-cutover-resume-transition-candidate \
  <release-id> <backup-id>
```

This continuation accepts exactly one healthy PostgreSQL container, one
recoverable Redis container, no application containers, and the already-
verified nonroot API volume profile. It revalidates the same recent off-site
backup and all four immutable candidate images, recreates only Redis directly
as the pinned image's `999:1000` account without changing or deleting its named
volume, requires both dependencies to become healthy, and then rejoins the
ordinary writer-fence, migration, IDP, service-health, and public HTTPS chain.

If that backup is no longer within the strict two-hour reuse window, create a
fresh encrypted off-site recovery point from the same attested transition state
without rebuilding the immutable candidate:

```bash
production_entry legacy-cutover-resume-transition-candidate-fresh-backup \
  <release-id>
```

The fresh-backup form runs the same dependency-recovery preflight before the
read-only PostgreSQL dump and volume archives, requires immutable off-site
upload verification, and only then recreates Redis and rejoins the same fenced
cutover. It does not start an application writer or remove a named volume.

### One-time failed-candidate BuildKit cache release

The failed immutable candidate
`git-20260815-113203955-8da6acb623a6` was built from Root
`38ef097f5a542fa9685cd867001e337a884c3d0f`, API
`88efdad94d65c09c6d3bd73e4b874db915629859`, and Web
`3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4`. After activating the fresh
`source-20260815-widget-latency-06` source release above and redefining
`production_entry` with that new Root plus the same exact API/Web commits, the
only reviewed low-disk release for this candidate is:

```bash
production_entry failed-candidate-builder-cache-release
```

This command accepts no arguments and is not a general cache-maintenance
interface. The dispatcher acquires descriptor 8, repeats the exact clean
Root/API/Web assembly verification under that lock, and retains it through all
remaining checks. The wrapper requires the new Root to be the direct reviewed
successor of `1f50dd5...` (itself the reviewed child of `d14e120...`), with
exact API `88efdad...` and Web `3d2cca1...`.
The prior read-only inventory observed
`CURRENT=git-20260814-192205642-e04672c95be2` and a healthy seven-service
runtime after both stopped-before-recreate build attempts. That observation is
context only: the fresh under-lock manifest, label, image-ID, and topology
checks below are authoritative and fail closed on any difference. Production
is intentionally a mixed-release runtime after isolated service activations;
`CURRENT` is the latest release pointer, not a claim that every application
container was built by that release. The wrapper therefore hard-binds the four
observed application image IDs and validates each container against the release
ID in its own immutable label. A later supported full or partial activation
advances `CURRENT`; the sole no-pointer Web-candidate path necessarily changes
the hard-bound Web image. An incomplete activation that changed any application
image is likewise rejected. Those pointer and image bindings therefore disable
this one-time command after any later runtime deployment without assuming that
one mixed-runtime application was built by `CURRENT`.
The fixed runtime image bindings are API
`sha256:518ce5d035c9f6ebbd100ff570981cffa822484fa1971ec8649f808134095d9c`,
media
`sha256:9863f4cfa9defef7cfe7caf018c83bc277712df3c41fcc8baead1af2cbc0ec5f`,
Web
`sha256:23cfef8c359a60379d18d6736d2067c7c2a9a2bc82e08e1c37a6e53ac4745923`,
and Discord
`sha256:e2db68104d3cf5a4f3ce543853b81725135b14a0f40f0246179b8e59bc88b0df`.

Before any mutation, it requires root free space to be strictly below 30 GiB
while running the otherwise ordinary production environment, data-volume, and
healthy-service preflight. It then proves all of the following twice before
the cache command:

- the root-owned `0600`, single-link archived candidate metadata has the exact
  candidate ID and Root/API/Web provenance above;
- the candidate API, Web, and media manifests are root-owned `0600`,
  single-link files, their immutable image IDs still exist, and fresh Docker
  image inspection regenerates each archived manifest byte-for-byte;
- `CURRENT` and its archived release metadata remain exact;
- the production environment identity and digest are unchanged; and
- the Compose project contains exactly one healthy, running, non-restarting
  proxy, PostgreSQL, Redis, API, media, Web, and Discord container. API, media,
  Web, and Discord must retain the exact observed immutable image IDs. Each
  application label must select its own root-owned `0600`, single-link release
  environment and service manifest; fresh image inspection must regenerate
  that manifest byte-for-byte and its image ID must equal the running
  container. Dependency services remain label-free. Container IDs, dependency
  images, restart policies, restart counts, and every selected environment and
  manifest identity plus digest are included in the drift fingerprint. A
  second raw runtime inventory after evidence validation must equal the first.

The one and only mutating command is `docker builder prune -af` with an
explicit `0B` reserve. Reviewed Docker help detection selects
`--reserved-space 0B`, or the older equivalent `--keep-storage 0B`; it rejects
`--max-used-space` and every Docker version exposing neither reserve-floor
flag. It does not prune or otherwise change images, containers, volumes,
networks, backups, logs, source, release metadata, databases, or environment
files. After the command, candidate image inspection and the complete current
source/environment/release/runtime fingerprint must remain byte-for-byte
equivalent. Finally, free space must be at least 30 GiB and the ordinary
no-exception production preflight must pass. If the cache command succeeds but
30 GiB is not reached, the wrapper reports that the builder cache was already
pruned and leaves deployment blocked; it does not try a broader cleanup.

If an immutable candidate reaches the API and media startup step but the API
remains non-ready before web, proxy, or Discord starts, first remove only the
two attested candidate containers (the independent media readiness probe may
already be healthy):

```bash
production_entry failed-candidate-remove <release-id>
```

This recovery accepts exactly healthy PostgreSQL and Redis plus one running,
non-ready API, one attested running media container, and the never-started proxy/web dependents
that Compose may have created before its dependency failure. It verifies all
three application image IDs against the root-owned archived manifests and the
proxy against its exact digest, stops the two running candidates with a bounded
grace period, and removes only those four container shells. It never selects or
removes a named volume.
The command must finish by proving the exact database/cache-only dependency
transition state.

When the failed API readiness result is specifically caused by a restored Redis
dataset crossing the historical 768 MiB capacity ceiling, apply the closed,
stopped-writer capacity transition before resuming the immutable candidate:

```bash
production_entry redis-capacity-transition
production_entry legacy-cutover-resume-transition-candidate \
  <release-id> <backup-id>
```

The transition accepts only healthy PostgreSQL and Redis with no application
containers, verifies the pinned Redis image, proves the live used-memory value
has crossed the old 85% readiness threshold but remains below the reviewed
3 GiB ceiling, requires at least 8 GiB host memory and 3 GiB currently
available, and atomically changes only `REDIS_MAXMEMORY=768mb` to `3gb` in the
root-owned `0600` production environment. It does not restart a service or
select, modify, or remove a volume. The standard continuation repeats preflight
immediately before recreating Redis with the preserved persistent volume.

If all candidate services become healthy but Docker refuses the never-started
proxy because PostgreSQL received the historical static proxy address while the
proxy was absent, use the closed address transition and then resume the same
candidate:

```bash
production_entry proxy-address-transition <release-id>
production_entry legacy-cutover-resume-transition-candidate \
  <release-id> <backup-id>
```

The address transition accepts only the exact healthy five-service topology,
one attested never-started proxy, no Discord container, and the observed
`.2` through `.6` private addresses. It verifies the three immutable candidate
images and pinned proxy, then stops and removes only those four application
container shells. Named volumes remain untouched. After proving the exact
PostgreSQL/Redis transition state, it atomically changes only the proxy and
trusted-proxy address from `172.30.50.2` to the first unused address,
`172.30.50.7`. The standard continuation recreates the candidate with that
permanent non-colliding address and repeats the complete health/HTTPS gate.

When the failure needs a new application commit, continue forward with:

```bash
production_entry legacy-cutover-resume-transition-rebuild
```

The rebuild form accepts only that dependency-transition state. It rebuilds and
archives all four immutable candidate images from the currently reviewed clean
Root/API/Web commits, installs the two pinned media models only after verifying
their SHA-256 digests, creates and off-site verifies a fresh encrypted backup,
and then rejoins the ordinary writer-fence, migration, IDP, full health, and
public HTTPS verification chain. It never starts an older application image.

If an interrupted ownership-fence worker leaves the exact target database with
connections disabled, first run the narrow marker-bound recovery and then retry
the applicable transition continuation:

```bash
production_entry legacy-cutover-database-reopen <release-id>
```

This recovery requires the physical database OID and system identifier to match
the existing root-only writer-fence marker, all application writers to remain
stopped, and the target to have zero client sessions and prepared transactions.
It changes only `ALLOW_CONNECTIONS` from false to true and verifies the result.
The ownership worker also performs this reopen automatically on every later
failure, so an SQL predicate cannot leave the database inaccessible again.

It requires exactly one healthy legacy PostgreSQL and Redis container, no
running application or maintenance writer, no duplicate application container,
and at least one absent stopped application container. It also requires the
legacy API volume boundary, then rebuilds immutable images and creates a new
verified off-site backup before continuing. After volume remediation, the same
missing-container boundary is re-attested before Compose removes the remaining
stopped containers without volumes.

Use it only with the exact reviewed Root/API/Web commits in the clean-parent
launcher above. It builds and archives immutable API, web, media, and Discord
images; pins every runtime, migrator, and IDP maintenance service by image ID;
pulls the reviewed PostgreSQL, Redis, and proxy images; and completes a new
encrypted off-site backup before stopping any writer. It then stops ingress and
all application writers, adopts only present objects from the closed ownership
policy, changes only API-volume ownership and modes while hashing every regular
file before and after, and removes no volume. PostgreSQL and Redis are recreated
on the reviewed private network with the existing volumes attached.

Before either migration runs, the cutover sets both runtime database roles to
`NOLOGIN`, terminates their sessions, rejects prepared transactions, and writes
a physical-database-bound fence marker in the root-only release archive. The
fence stays engaged while API and Studio migrations run, grants are reconciled,
legacy IDP credentials are encrypted, the constraint is validated, and both
structural and compiled zero-plaintext checks pass. Runtime login is restored
only after those postconditions; application services and then exactly one
Discord bot are started and health-checked afterward. Any failure after the
ownership/schema boundary deliberately leaves incompatible writers stopped and
requires a reviewed forward-recovery action; never start an older API image or
use an image-only rollback.

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

For an urgent web-only correction whose immutable image and release manifests
were already produced by the reviewed full build, use the closed candidate
activation instead of rerunning migrations or rebuilding the application:

```bash
production_entry deploy-web-candidate \
  'git-YYYYMMDD-HHMMSSmmm-<12-hex-source-digest>'
```

The command accepts exactly one archived release ID. It repeats the normal
30-GiB/service preflight immediately before Compose, validates the archived web
manifest and exact immutable image ID, and uses `--no-deps --force-recreate`
for only the stateless `web` service. It never builds or pulls, runs no API or
Studio migration, changes no database role, and does not recreate PostgreSQL,
Redis, API, media, proxy, or Discord. Their container/image fingerprints must
remain identical through public HTTPS and browser-origin authentication
verification. Because this is deliberately a mixed full-release/web-candidate
state, it does not rewrite the full-release `CURRENT` or `PREVIOUS` recovery
pointers; the running web container label plus its archived manifest identify
the active web candidate until the next complete deployment.

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

The argument-free one-time `legacy-cutover` contains one narrower reviewed
ledger reconciliation for
`20260308132829_widget_instance_permanent_keys`. Production already records the
exact migration checksum and a finished timestamp, and the isolated restore
proves the complete renamed column/default/index postconditions, but the legacy
row records zero applied steps. The initial safety gate defers only that exact
checksum/state. After the immutable candidate and fresh verified off-site
backup exist, all old writers are stopped, PostgreSQL is on the reviewed target,
and the durable runtime-role fence is engaged, the cutover transaction repeats
the exact schema, ledger, session, prepared-transaction, and role predicates and
changes only `applied_steps_count` from `0` to `1`. Any different row, checksum,
schema, writer state, target, or fence marker remains blocked. Routine deploys
have no such exception. A forward-recovery retry accepts the same exact row
already at `1`, re-verifies every predicate, and performs no ledger write.

Migration lineage is the unique checksum-authenticated set of successfully
finished migration names. That set must equal one lexical prefix of the exact
reviewed migration directories. `_prisma_migrations.started_at` remains audit
metadata and is not lineage ordering: historical workers can record timestamps
out of lexical order even when the exact prefix was applied. Missing an earlier
migration, applying a later migration outside the prefix, duplicate active
rows, unknown names, checksum drift, unfinished rows, and impossible states all
remain deployment blockers.

The same one-time cutover can defer one exact legacy entitlement shape:
non-deleted `ACTIVE` organizations whose `paidUntil` is present but whose old
`trialEndsAt` was not cleared. The aggregate gate separately proves that no
`ACTIVE` row is missing `paidUntil`, that every active inconsistency is exactly
this stale-trial shape, and that `TRIALING`, `EXPIRED`, and unknown statuses are
canonical. Routine deploys still block any inconsistent count. After the fresh
verified off-site backup, stopped writers, reviewed PostgreSQL target, and
durable runtime-role fence, the same serializable reconciliation transaction
clears only `trialEndsAt` on that exact bounded target set. It never changes
status, `paidUntil`, `updatedAt`, deleted organizations, or identifiers, and it
requires zero inconsistent rows afterward before migrations continue.

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

Deployment authorization checks the stable stored forms above. Current clocks
are inventoried but are enforced at runtime, not as a deployment precondition:
`ACTIVE` access requires a future `paidUntil`, and `TRIALING` access requires a
complete, ordered, currently active trial. Missing or elapsed clocks fail
closed at runtime without an automatic database write. The canonical API uses
the shared predicate in authentication, launcher, Discord, and session paths.

The 2026-08-09 aggregate inventory found 11 approved active organizations:
7 `ACTIVE` (3 future and 4 expired clocks) and 4 `TRIALING` (2 valid, 1 expired,
and 1 missing dates). The inventory therefore reports six clock denials. Those
customers remain denied at runtime; the report does not block a safe deployment
or change their stored status.

Any unknown stored status, inconsistent stored form, or aggregate mismatch
still fails closed. Inventory output contains
only status and inconsistency counts; it intentionally cannot identify affected
organizations. Investigate and reconcile through an approved, audited,
writer-stopped maintenance procedure using a fresh verified off-host backup,
reviewed target selection, before/after counts, and the normal billing audit
path. Do not add an automatic deploy backfill or print identifiers from the
gate. The detailed billing semantics are in
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

During only the exact stopped interrupted-cutover boundary, the argument-free
read-only administrator diagnostic reports bounded policy flags without names,
passwords, database contents, or customer identifiers:

```bash
production_entry legacy-admin-diagnose
```

If the same bounded administrator diagnostic is required after forward schema
work while only PostgreSQL and Redis remain healthy, use the transition-specific
entrypoint. It accepts only the reviewed cutover-transition preflight and remains
read-only:

```bash
production_entry legacy-transition-admin-diagnose
```

The preview shares or verifies the deployment lock, reruns the production
preflight, binds to the reviewed database/schema/container, and reports the
closed role/ownership plan without applying it. Role creation or grant changes
occur only as an explicitly guarded step inside a reviewed full deploy after its
source, backup, database-identity, and release gates pass. Existing installations
whose tables/types are owned by a prior administrator still require a reviewed
DBA ownership migration before the dedicated DDL roles can migrate.

The normal role helper still requires the ordinary healthy-service preflight,
and its raw `--apply` mode is not an operator entrypoint. Existing legacy
ownership conversion is supported only inside `production_entry
legacy-cutover`: the dispatcher holds the deployment lock, proves the exact
stopped legacy service set, closes database connections around the reviewed
partial object policy, and later requires the complete post-migration policy
and role verifier before login is restored. Do not invoke its internal flags,
improvise `ALTER OWNER`, use blanket `REASSIGN OWNED`, or generate ad hoc
ownership SQL.

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
  configured app role with the administrator before role creation or ownership
  changes. Ordinary deploy and role paths fail safely on a stock cluster and
  report the blocking database/role/reason tuples as escaped JSON. The
  stopped-writer legacy cutover is the sole exception: after attesting its
  fresh encrypted off-site deployment backup, it atomically revokes only the
  exact stock `PUBLIC CONNECT,TEMPORARY` grants on `postgres` and `template1`,
  verifies the closed result, and rolls the transaction back if either revoke
  fails. If a deployment transport ends after its verified backup but before
  this closure, `production_entry legacy-auxiliary-acl-close <backup-id>` may
  reuse only that still-recent verified backup under the same exact stopped
  interrupted-cutover boundary; it performs no role, ownership, or row change.
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

The web container receives `WEB_APP_ORIGIN` and `FRONTEND_ORIGIN` as
server-only runtime values. Its authentication BFF accepts browser mutations
only from those normalized origins (or its direct request origin for local
operation). Public verification sends an empty login request with the real web
`Origin` header and must reach ordinary credential validation; a cross-origin
403 blocks the release.

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
production_entry observe network
production_entry current-release-inventory
production_entry verify-api-render-runtime
```

`current-release-inventory` is a lock-coordinated, read-only inspection of the
validated `CURRENT` release metadata. It reports only the release ID and the
Root/API/Web commit identifiers needed to reconcile forward history; it does
not inspect services, databases, backups, volumes, credentials, or customer
data.

`verify-api-render-runtime` launches the deployed API image's bundled Chrome
through the same isolated writable runtime helper used by result widgets,
renders a local PNG, and cleans its temporary profile. It does not read or
change match, session, team, or result data.

The bounded Fix Esports team-logo repair inventories unique exact matches from
configured Discord logo-channel history and Arenzyra-managed guild emojis before
any write. Managed emojis are linked only by the hash embedded from the exact
team ID. Apply mode repeats that check, runs the ordinary production preflight
immediately before writes, updates only missing or broken team logos, and, when
one is safely stored, refreshes only the bot-owned post in the configured `16`
result channel while preserving its text. An absent stored post is skipped so a
historical Discord message is never guessed or replaced:

```bash
production_entry repair-fix-esports-team-logos check
production_entry repair-fix-esports-team-logos apply
```

These read-only helpers resolve the reviewed Compose project from
`infra/.env.publish`. `ps` includes stopped containers, and `network` prints
only the reviewed private-network endpoint names and addresses. Do not use an unguarded `docker compose down`, restart,
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
and requires exactly one stopped Compose `web` container. If that immutable
container has one legacy read-only launcher-download bind whose active source
was omitted by an atomic source-checkout replacement, recovery may restore only
that exact missing release from preserved `/opt/arenzyra-source-archives`
candidates. Every candidate must be a bounded, root-owned `0755` directory tree
containing only single-link `0644` regular files, and every candidate must have
the same byte-for-byte digest. The copy is verified byte-for-byte and activated
by an exact atomic move. Missing, disagreeing, linked, special, oversized,
writable, or identity-changing data fails closed and is not removed.
The action then reruns preflight immediately before starting the exact existing
container by immutable container ID, without Compose dependency traversal and
without building, pulling, creating, recreating, or migrating anything. It
proves that every project container and image identity is unchanged, waits for
the existing web healthcheck, reruns preflight, and verifies the public Arenzyra
HTTPS origin. A missing, duplicate, running-unhealthy, or identity-changing web
container fails closed; use the full reviewed release workflow for those cases.

The web-only recovery preflight may recognize the already-running legacy root
API volume profile solely to prove that this unrelated service remains exactly
running/healthy and unchanged while the existing web container starts. It
requires both reviewed volume bindings, roots `0:0/0777`, only root-owned
regular files/directories, single-link files, and the exact observed
`0755/0777` directory and `0644/0666` file modes. This is read-only and does not
authorize an API recreate, restart, deployment, ownership change, or non-root
cutover. Every other production action continues to require the strict
`1000:1000`, root-mode `0750`, non-world-writable volume policy.

## Production host cleanup

Production builds can leave Docker build cache behind. Keep these safeguards
enabled on the server:

```bash
production_entry host-maintenance --check-only
production_entry host-maintenance
production_entry host-maintenance --builder-cache
```

The maintenance script defaults are conservative:

- Docker builder cache is pruned with a `15GB` reserved cache target.
- The explicit `--builder-cache` mode prunes only rebuildable Docker builder
  cache and never runs backup retention.
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
