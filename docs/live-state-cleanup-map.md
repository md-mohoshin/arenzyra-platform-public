# Live State Cleanup Map

Last updated: 2026-05-31

## Current Shape

The live broadcast path has too many places that can interpret or repair match state:

- `apps/api/src/modules/telemetry/telemetry-engine.service.ts`
  ingests telemetry and derives live player/team state.
- `apps/api/src/modules/telemetry/telemetry-broadcast.service.ts`
  prepares live payloads for realtime consumers.
- `apps/api/src/modules/match-control/live-state-mirror.service.ts`
  mirrors live state into match-control state.
- `apps/api/src/modules/matches/live-state-repair.service.ts`
  repairs/canonicalizes live state after drift.
- `apps/api/src/modules/observer/observer-widget-state.service.ts`
  builds observer widget state and caches live snapshots.
- `apps/arenzyra-web/app/api/widgets/observer-direct/leaderboard/route.ts`
  reshapes API live state for widgets and applies additional guards.
- `apps/arenzyra-web/src/components/widgets/live-widgets.tsx`
  renders widgets and applies more stability/dedupe behavior in the browser.

That means leaderboard rows, alive counts, elimination notifications, and overall ranking can be changed by backend telemetry, backend repair, web route fallback, and frontend stabilization. This is why a match-start/drop-phase signal can look like a real elimination or a leaderboard reset when one layer treats an incomplete payload as authoritative.

## Cleanup Invariants

- The API must be the only authority for live aggregate facts: alive teams, active players, knocked players, placement, WWCD, match points, total points, and elimination events.
- Early match/drop-phase telemetry must not emit team eliminations or wipe leaderboard rows just because player positions or alive flags are incomplete.
- A fallback, stale cache, or missing upstream response must never delete existing live teams in a widget payload.
- The observer-direct web routes should normalize transport and branding only; they should not invent alternate match ranking, overall ranking, or elimination rules.
- Frontend widgets should render the payload and dedupe visual notifications only. They should not be the source of truth for match state.
- Overall live ranking must use cumulative standings for the selected event/group, not the current-match leaderboard.
- Post-match standings must include placement points, WWCD count, kill points, and total points from the same scoring contract used by official results.

## Highest Risk Files

- `apps/arenzyra-web/src/components/widgets/live-widgets.tsx`
  is too large and mixes many widget contracts in one component surface.
- `apps/api/src/modules/telemetry/telemetry-engine.service.ts`
  is too large and mixes telemetry ingestion, interpretation, and derived state.
- `apps/api/src/modules/match-control/match-control.service.ts`
  is a large state transition owner and should not duplicate telemetry-derived facts.
- `apps/arenzyra-web/app/api/widgets/observer-direct/leaderboard/route.ts`
  contains route code, payload normalization, ranking logic, and fallback behavior together.
- `apps/api/src/modules/observer/observer-widget-state.service.ts`
  is the right place to centralize widget DTO production, but it needs smaller helper modules and stronger tests.

## Safe Refactor Order

1. Extract pure ranking and payload-normalization helpers behind the existing observer/widget contracts.
2. Add regression tests for match start, drop phase, first valid player position, real team elimination, reconnect, and API fallback.
3. Move elimination-event gating into one backend helper used by telemetry broadcast and observer widget state.
4. Move leaderboard and overall ranking DTO creation into one backend service.
5. Reduce the web observer-direct leaderboard route to validation, fetch, and pass-through normalization.
6. Split `live-widgets.tsx` by widget family after the server contract is stable.

## Checkpoints

- Top-level local baseline commit: `aaccb32`.
- API local safety branch: `local-safety-baseline-20260531-014446` at `27fd20d`.
- Web local safety branch: `local-safety-baseline-20260531-014500` at `bd3ac7e`.
- Source-only filesystem backup: `.codex-backups/system-cleanup-20260531-013902`.
