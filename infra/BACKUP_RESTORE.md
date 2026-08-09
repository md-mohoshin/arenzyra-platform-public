# Production backup and restore runbook

Backups are encrypted before they touch the backup directory. Keep the age
private identity off the production host; production needs only the public age
recipient. Configure an off-host rclone destination so loss of the host or its
disk does not also destroy recovery data.

## Configure

Install `age` and `rclone`, keep the reviewed helper image
`postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`
locally available, then set these only in the reviewed
`/opt/arenzyra/infra/.env.publish` (mode `0600`):

```text
ARENZYRA_BACKUP_AGE_RECIPIENT=age1...
ARENZYRA_BACKUP_RCLONE_REMOTE=encrypted-offsite:arenzyra/production
ARENZYRA_BACKUP_ROOT=/opt/arenzyra-backups
ARENZYRA_DEPLOY_COMPOSE_PROJECT=infra
ARENZYRA_BACKUP_HELPER_IMAGE=postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
```

Scheduled jobs should set only
`ARENZYRA_BACKUP_ENV_FILE=/opt/arenzyra/infra/.env.publish` and invoke the
checked-in script from `/opt/arenzyra`. The backup rejects process overrides of
the reviewed project, root, age recipient, rclone destination, or helper image;
do not maintain a divergent second copy of those values.

Run `bash scripts/production-backup.sh` from a systemd timer. It creates a
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
bash scripts/production-restore-drill.sh \
  --backup /opt/arenzyra-backups/20260804T120000Z-ab12cd34 \
  --identity /secure/off-host/arenzyra-backup-age.key
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
