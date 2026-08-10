# Production backup and restore runbook

Backups are encrypted before they touch the backup directory. Keep the age
private identity off the production host; production needs only the public age
recipient. Configure an off-host rclone destination so loss of the host or its
disk does not also destroy recovery data.

The 2026-08-10 production inventory found no `rclone` executable and no
configured remote. Do not substitute a same-host directory or a placeholder
remote. The reviewed `production_entry backup-configure` action installs only
the SHA-256-pinned `age` 1.3.1 and `rclone` 1.75.0 Linux executables from the
fixed root-owned incoming directory, stores the bucket-restricted B2 credential
in `/etc/arenzyra-backup-rclone.env` as root `0600`, pulls only the digest-pinned
backup helper image, and proves an encrypted upload/download/SHA-256 round trip.
It cannot restart, rebuild, recreate, migrate, run Compose, or change a data
volume. Credential rotation is deliberately a separate review.
An existing different age recipient may be replaced during this initial setup
only when it is valid but unverified, the reviewed rclone destination is empty,
the new managed backup subtree contains no entry other than its exact harmless
lock file, and the bounded off-host prefix contains only the exact encrypted
probe-name forms. Pre-existing artifacts in the legacy parent directory are
never moved, changed, or deleted. Any completed backup in the managed subtree
or non-probe remote object blocks replacement so recovery material cannot be
orphaned.

## Configure

Stage these two official Linux AMD64 executables as root-owned, single-link,
non-group/world-writable files. Their executable hashes are pinned in the
reviewed configuration script:

```text
/opt/arenzyra-backup-bootstrap-incoming/age
/opt/arenzyra-backup-bootstrap-incoming/rclone
```

Provide exactly three newline-terminated values on inherited file descriptor
3: the public age recipient, B2 application key ID, and B2 application key.
The clean-parent launcher must carry descriptor 3 without placing any value in
an argument, environment variable, log, Git file, or shell history. Then run:

```bash
production_entry backup-configure
```

The action configures the reviewed helper image
`postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`
and atomically sets these only in the reviewed `/opt/arenzyra/infra/.env.publish`
(mode `0600`):

```text
ARENZYRA_BACKUP_AGE_RECIPIENT=age1...
ARENZYRA_BACKUP_RCLONE_REMOTE=arenzyrab2:arenzyra-prod-backup-84f2c9/arenzyra/production
ARENZYRA_BACKUP_ROOT=/opt/arenzyra-backups/encrypted-v1
ARENZYRA_DEPLOY_COMPOSE_PROJECT=infra
ARENZYRA_BACKUP_HELPER_IMAGE=postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
```

For the one observed pre-remediation production profile only, create the first
recovery point with `production_entry backup-legacy`. That exception still
requires all services healthy, PostgreSQL exactly 16.13 in the existing
`postgres:16-alpine` container, the exact reviewed database volume/network, and
the exact root-owned API-volume tree. It performs no service or data mutation;
it only reads database/volume state into the normal encrypted immutable backup.
After PostgreSQL and API volume ownership are remediated, use only
`production_entry backup`.

Scheduled jobs must use the exact clean-parent, reviewed-Root
`production_entry backup` launcher defined in [`PUBLISH.md`](PUBLISH.md); do not
execute a checkout script or npm alias directly. A systemd unit must pin the
reviewed 40-hex Root commit and clear ambient shell/Node/Git variables as that
launcher does. The dispatcher uses the fixed reviewed production environment
path. The backup rejects process overrides of the reviewed project, root, age recipient, rclone
destination, or helper image; do not maintain a divergent second copy of those
values.

Run `production_entry backup` from the reviewed systemd launcher. The backup
command itself reruns the production preflight before creating any backup file.
It creates a
consistent PostgreSQL custom dump, role metadata without password hashes, and
read-only archives of existing uploads/storage/Redis/Caddy/Discord state
volumes. Every artifact and its checksum manifest are age-encrypted. The
off-host copy is uploaded with immutable names and checked by checksum.

Every normal full deployment sets `ARENZYRA_BACKUP_REQUIRE_OFFSITE=1`, creates
a new encrypted backup after PostgreSQL is healthy and immediately before the
first migration, then verifies the local completion marker and the immutable
rclone checksum check. A missing age recipient, destination, upload, checksum,
or fresh artifact blocks migrations. There is no local-only deployment bypass.

File-volume archives are crash-consistent, not transactionally synchronized
with PostgreSQL. For a legally or financially critical snapshot, take a
provider filesystem snapshot immediately after this script or schedule a short
application write-maintenance window.

## Quarterly restore drill

On an isolated recovery host with the age identity:

```bash
export ARENZYRA_BACKUP_AGE_IDENTITY=/secure/off-host/arenzyra-backup-age.key
production_entry restore-drill \
  /opt/arenzyra-backups/20260804T120000Z-ab12cd34
```

The drill validates encrypted checksums and archive names, rejects absolute or
parent-traversal entries, and then actually extracts every volume archive into
its own randomized directory under a dedicated `/tmp` root. Extraction runs in
a no-network, read-only, capability-dropped helper container whose only writable
host mount is that one target. The drill verifies target containment and rejects
symlinks, devices, sockets, FIFOs, and setuid/setgid files. It then restores
PostgreSQL into randomized temporary Docker resources with no published ports,
checks application tables and Prisma migration history, and removes only the
validated temporary extraction root and randomized Docker resources. A tar
listing alone is not considered a restore drill.

Record the backup ID, extracted-volume count, output, duration, and operator in
the incident/recovery log. Run this at least quarterly and after schema or
backup-tool changes.

## Real restore

Never restore directly over production. Create a separate host/project,
decrypt and restore the database there, extract volume archives only into new
empty volumes using the same containment and special-file checks as the drill,
start the stack on non-public endpoints, and verify login,
uploads, Studio data, Discord ownership state, migration history, and a sample
tournament. Promote the recovered environment only through a reviewed DNS or
load-balancer change. Retain the old environment read-only until verification
and rollback windows close.

Full rollback cannot mean starting old application images against a newer
database. The image rollback helper intentionally supports only
`--discord-bot`. For an API/schema incident, prefer reviewed forward repair. If
forward repair is not viable, restore the database, application images, and
file volumes as one coordinated recovery point in the isolated environment,
verify it there, and promote it through the reviewed recovery procedure.

Local retention is intentionally not part of the backup command. The guarded
maintenance job may remove an old local encrypted set only when that exact set
has both `OFFSITE_VERIFIED` and `RESTORE_DRILL_VERIFIED` markers, and it always
preserves the newest verified set. Configure separate retention at the immutable
off-host destination; unverified local sets are never age-pruned.
