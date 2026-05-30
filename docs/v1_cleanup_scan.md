# Arenzyra V1 Prisma Model Usage Scan (2026-02-28)

Legend: (A) runtime critical Â· (B) legacy/unused Â· (C) tests only

## MatchRound
- Category: B â€” no runtime/test references; only definitions and archived builds.
- Files: apps/api/prisma/schema.prisma; apps/api/prisma/migrations/20260227202015_init_clean/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260115_results_system/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260116_restore_domain/migration.sql; apps/api/__graveyard/dist/modules/results/results-approval.service.{js,d.ts}; apps/api/__graveyard/dist_backup_20260204025007/modules/results/results-approval.service.{js,d.ts}; docs/cleanup-v1-report.md.

## TeamRoundResult
- Category: A in `results.compute.service.ts`; B elsewhere (definitions/archives). No C-only references found.
- Runtime: apps/api/src/modules/results/results.compute.service.ts (imports the Prisma type to calculate auto/manual round points for results ingestion).
- Definitions/archives (B): apps/api/prisma/schema.prisma; apps/api/prisma/migrations/20260227202015_init_clean/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260115_results_system/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260116_restore_domain/migration.sql; apps/api/__graveyard/dist*/modules/results/results.* and results-manual/compute services; docs/cleanup-v1-report.md.

## RoundPlayerResult
- Category: B â€” only present in schema/migrations, no runtime or test usage located.
- Files: apps/api/prisma/schema.prisma; apps/api/prisma/migrations/20260227202015_init_clean/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260115_results_system/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260116_restore_domain/migration.sql; docs/cleanup-v1-report.md.

## ResultApproval
- Category: B â€” model defined but unused in current code; only historical migrations/docs.
- Files: apps/api/prisma/schema.prisma; apps/api/prisma/migrations/20260227202015_init_clean/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260115_results_system/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260116_restore_domain/migration.sql; docs/cleanup-v1-report.md.

## MatchStanding
- Category: B â€” no direct Prisma usage; string only appears inside method names (`computeMatchStandings`) plus schema/migrations.
- Files: apps/api/prisma/schema.prisma; apps/api/prisma/migrations/20260227202015_init_clean/migration.sql; apps/api/src/modules/standings/standings.service.ts (method naming only); apps/api/src/modules/standings/standings.controller.ts (route naming only); apps/api/src/modules/standings/standings.service.spec.ts (naming); docs/cleanup-v1-report.md.

## StandingsSnapshot
- Category: A for live/scoring/widget flows; no Prisma calls, all in-memory payloads. Definitions remain in schema/migrations (B). No test-only references found.
- Runtime: apps/api/src/modules/scoring/scoring.plugin.ts (payload type); apps/api/src/modules/scoring/pubgm.scoring.ts (builds snapshot payloads); apps/api/src/modules/scoring/scoring.service.ts (sets latest standings payload); apps/api/src/modules/live/standings-snapshots.service.ts (in-memory snapshot store); apps/api/src/modules/live/standings.controller.ts and apps/api/src/modules/live/live.controller.ts (snapshot endpoints); apps/api/src/modules/live/live.module.ts (providers/exports); apps/api/src/modules/widgets/widgets.controller.ts (serves snapshots to widgets/overlays).
- Definitions/archives (B): apps/api/prisma/schema.prisma; apps/api/prisma/migrations/20260227202015_init_clean/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260115_results_system/migration.sql; apps/api/__graveyard/prisma/migrations_archive/20260116_restore_domain/migration.sql; archive/arenzyra-web-restored/.../standings/page.tsx and other archive files; docs/cleanup-v1-report.md.
