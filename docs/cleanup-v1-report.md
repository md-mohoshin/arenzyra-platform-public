# Cleanup V1 Results – Phase A Inventory (2026-02-27)

## Symbols overview
- `MatchRound` — Runtime heavy (A). Used by results ingestion/approval/service, standings service, and widgets snapshot; Prisma CRUD throughout.
- `TeamRoundResult` — Runtime heavy (A). Used by results service/compute/manual flows and standings service.
- `RoundPlayerResult` — Runtime (A). Used by standings service and widgets snapshot.
- `ResultApproval` — Runtime (A). Used by results approval + results service locks.
- `MatchStanding` — Runtime (A). Used only by standings service for persisted standings.
- `StandingsSnapshot` — Runtime heavy (A) + tests. Used by live/production/results widgets/scoring/tournaments flows; tests in `tournaments.service.spec.ts`.

## Detailed usage by symbol

### MatchRound
- Runtime:  
  - `apps/api/src/modules/results/results.service.ts` (ensure/create/list rounds, locks).  
  - `apps/api/src/modules/results/results-ingest.service.ts` (resolve/create round per match).  
  - `apps/api/src/modules/results/results-approval.service.ts` (approval + unlock).  
  - `apps/api/src/modules/standings/standings.service.ts` (compute standings, latest round).  
  - `apps/api/src/modules/widgets/widgets.snapshot.ts` (derive alive teams fallback).  
- Prisma calls: `prisma.matchRound.findFirst/findUnique/findMany/create/upsert` in the files above.  
- Non-runtime: migrations + __graveyard/dist backups.  
- Recommendation: keep for now; requires refactor to slot-based flow before removal.

### TeamRoundResult
- Runtime:  
  - `apps/api/src/modules/results/results.service.ts` (updateTeamResultById).  
  - `apps/api/src/modules/results/results.compute.service.ts` (applyFinals helper).  
  - `apps/api/src/modules/results/results-manual.service.ts` (audits).  
  - `apps/api/src/modules/standings/standings.service.ts` (TeamRoundResultLite aggregation).  
- Prisma calls: `prisma.teamRoundResult.findFirst/update/upsert` in results & standings services.  
- Recommendation: keep for now; migrate computations to `MatchSlotResult` then remove.

### RoundPlayerResult
- Runtime:  
  - `apps/api/src/modules/standings/standings.service.ts` (latest round player stats).  
  - `apps/api/src/modules/widgets/widgets.snapshot.ts` (alive team count).  
- Prisma calls: `prisma.roundPlayerResult.findMany`.  
- Recommendation: keep until standings/widgets switch to slot-player results.

### ResultApproval
- Runtime:  
  - `apps/api/src/modules/results/results-approval.service.ts` (approve/unlock).  
  - `apps/api/src/modules/results/results.service.ts` (locks during edits).  
- Prisma calls: `prisma.resultApproval.findUnique/findFirst/upsert/update`.  
- Recommendation: keep until approval/lock logic is reworked on slot results.

### MatchStanding
- Runtime:  
  - `apps/api/src/modules/standings/standings.service.ts` (computeMatchStandings, upsert, clear, publish).  
- Prisma calls: `prisma.matchStanding.findFirst/findMany/updateMany/upsert/deleteMany`.  
- Recommendation: keep; replace with slot-result derived standings then drop.

### StandingsSnapshot
- Runtime:  
  - `apps/api/src/modules/live/standings-snapshots.service.ts` (create/activate/fetch).  
  - `apps/api/src/modules/live/live.controller.ts` + `live.module.ts` (exposes snapshot API).  
  - `apps/api/src/modules/widgets/widgets.controller.ts` (widget snapshot endpoint).  
  - `apps/api/src/modules/widgets/widgets.snapshot.ts` (prefers persisted snapshot).  
  - `apps/api/src/modules/scoring/scoring.service.ts` & `scoring.plugin.ts` types; `pubgm.scoring.ts` writes snapshots.  
  - `apps/api/src/modules/results/match-conclusion.service.ts` (persist snapshot on finalize).  
  - `apps/api/src/modules/production/production.service.ts` (snapshot creation).  
  - `apps/api/src/modules/tournaments/tournaments.service.ts` (cleanup on delete).  
- Tests: `apps/api/src/modules/tournaments/tournaments.service.spec.ts` mocks snapshot deletion.  
- Prisma calls: `prisma.standingsSnapshot.findFirst/findMany/findUnique/create/update/updateMany/deleteMany`.  
- Recommendation: heavy runtime usage; needs replacement with slot-result snapshots before removal.

## Prisma client reference summary
- `matchRound`: results.service.ts, results-ingest.service.ts, standings.service.ts, widgets.snapshot.ts.  
- `teamRoundResult`: results.service.ts, standings.service.ts.  
- `roundPlayerResult`: standings.service.ts, widgets.snapshot.ts.  
- `resultApproval`: results-approval.service.ts, results.service.ts.  
- `matchStanding`: standings.service.ts.  
- `standingsSnapshot`: standings-snapshots.service.ts, live.controller.ts, widgets.controller.ts, widgets.snapshot.ts, scoring.pubgm.ts, match-conclusion.service.ts, production.service.ts, tournaments.service.ts, tournaments.service.spec.ts.

## Notes / next steps
- Heavy runtime dependency on all six models; cannot drop schema yet.  
- Proceed to Phase B: refactor standings, results, widgets, scoring, and snapshot flows to use `MatchSlotResult` / `MatchSlotPlayerResult` as the sole source, then revisit approvals/locks.  
- Preserve SAFE MODE: no destructive schema changes until code paths stop using the round/standing tables.

## Phase B progress (slot-only refactor)
- Results/standings/widgets/scoring now read & write exclusively via `MatchSlotResult`/`MatchSlotPlayerResult`; all `matchRound`, `teamRoundResult`, `roundPlayerResult`, `resultApproval`, `matchStanding`, and `standingsSnapshot` runtime touches removed.
- Standings snapshots replaced with in-memory snapshots (live service) and match-control metadata; scoreboard snapshot builder now computes directly from slot results.
- Match approvals now lock slot results + control-state meta instead of round approvals.
- Ingest pipeline writes API/live payloads into slot results only; round creation removed.
- Scoreboard service + widgets no longer rely on match rounds/standings; they derive rows from slot results.
- Added slot-based tests: `apps/api/src/modules/standings/standings.service.spec.ts`, `apps/api/src/modules/results/results.service.spec.ts`.
- Auth wiring: `JwtAuthGuard` registered as APP_GUARD (no more PlayersModule resolution errors); global guard setup simplified in `main.ts`.
