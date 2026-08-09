# Historical production Prisma ledger snapshot — 2026-08-09

> **Historical evidence only.** This is not current production state, a release authorization, or permission to repair or apply migrations.

The sanitized evidence is in
[`PRODUCTION_PRISMA_LEDGER_HISTORICAL_SNAPSHOT_20260809.json`](./PRODUCTION_PRISMA_LEDGER_HISTORICAL_SNAPSHOT_20260809.json).
Every retained ledger row has exactly these five fields:
`migration_name`, `checksum`, `finished_at`, `rolled_back_at`, and
`applied_steps_count`. Database row IDs, logs, start times, application rows,
raw SQL, credentials, and other backup contents were not retained.

## Verified source and result

- Backup ID: `20260809T083232Z-bd709276`.
- Backup completion: `2026-08-09T09:09:57Z`; prior restore drill completion:
  `2026-08-09T10:46:29Z`.
- Encrypted database payload SHA-256:
  `c4050175cc9a3ae1a0221d1d290cf617570977bf70c480f223e14ee29d8a601d`.
- The encrypted manifest, stream sidecar, age recipient/identity, authenticated
  plaintext size and digest, and pinned age 1.3.1/PostgreSQL 16.14 binaries
  were independently verified before extraction.
- Exactly one `_prisma_migrations` TABLE DATA TOC item was selected with an
  exact one-entry `pg_restore --use-list`. No network, database service,
  Docker, or production endpoint was used. No full plaintext database archive
  was written to disk.
- Aggregate: **107 total, 102 successful, 5 rolled back, 0 active unfinished**.
  There are no duplicate successful names, conflicting states, exact duplicate
  sanitized rows, or orphaned rollback attempts.
- The five rollback attempts concern four names; each name later has exactly
  one successful row. `20260520043000_result_backups` has two rollback
  attempts. All five retry-attempt checksums differ from their later successful
  checksum, so this is historical retry drift rather than successful-ledger
  duplication.

## Exact source comparison

Comparisons use ASCII lexical `migration_name` order, matching Git path order.
The archive's physical COPY order is not treated as migration order. Historical
`finished_at` order differs from lexical order at 24 positions.

| Source boundary                                                                | Count | Exact historical matches | Historical-only / source-only      | Checksum drift | Prefix conclusion                                                 |
| ------------------------------------------------------------------------------ | ----: | -----------------------: | ---------------------------------- | -------------: | ----------------------------------------------------------------- |
| Canonical API lineage `d4cf1abf9c90dd1f922aa13e50fc544dfac696de`               |   100 |                       97 | 2 historical-only / 0 source-only  |              3 | Names-only source prefix: yes; exact name+checksum prefix: no     |
| Dirty API candidate at HEAD `54dd78c91ac15747c3ded2d1e5c99fd31c8d9b8a`         |   115 |                      102 | 0 historical-only / 13 source-only |              0 | Exact historical set is present, but it is not a sequence prefix  |
| Existing d708 archive/branch commit `d708f9beae8fa43d65ea5cb22630514f9e2c4186` |   105 |                       99 | 0 historical-only / 3 source-only  |              3 | Historical names-only prefix: yes; exact name+checksum prefix: no |

The canonical comparison is bound to migration-tree Git object
`ee04cf9bc2ebc6a4f84baf82152647103a14452c`. That tree was unchanged when the
canonical head advanced from the initial comparison commit `ec4f325` to the
recorded exact-current commit `d4cf1ab`.

The canonical 100 migration names are exactly the first 100 names in the
historical successful ledger's lexical order. The historical ledger then
continues, in this exact order, with:

1. `20260801190000_pcob_raw_payload_bytes`
2. `20260803110000_add_pubg_match_maps`

Therefore the canonical **names-only** sequence is a prefix of the historical
names. It is **not** an exact name+checksum prefix. The first exact-prefix break
is the fifth lexical entry, and these three shared names have different source
and historical checksums:

- `20260303_matchslot_elimination`
- `20260306_final_results_persistence`
- `20260521195500_event_branding`

The dirty candidate contains exact name/checksum copies of all 102 historical
successes, plus 13 source-only candidate migrations listed in the JSON. This is
recovery evidence, not approval of that dirty worktree or of its pending
migrations. The d708 commit contains three source-only migrations and repeats
the same three checksum mismatches, so d708 is not an exact ledger archive.

## Cleanup and external evidence

At `2026-08-09T16:49:08.1829008Z`, the exact temporary SQL output, TOC catalog,
and one-entry TOC selector were revalidated by contained path, regular-file
identity, size, SHA-256, and non-reparse status, then deleted. Both the random
temporary directory and its dedicated parent were verified absent. A second
bounded scan found zero residual exact temporary names and zero matching age or
`pg_restore` processes. Pathname/process removal is proven; storage-layer
overwrite is not claimed.

The only external artifact retained is a hash-verified copy of the sanitized
JSON at:

`C:\Arenzyra-safety-snapshots\migration-ledger\20260809-production-full-20260809T083232Z-bd709276\PRODUCTION_PRISMA_LEDGER_HISTORICAL_SNAPSHOT_20260809.json`

Copy size: `39,240` bytes. Copy SHA-256:
`c984ebb334ad1aa0054672ec08ad8fdc6a9e8fc063e088115da6e35cb436161e`.
