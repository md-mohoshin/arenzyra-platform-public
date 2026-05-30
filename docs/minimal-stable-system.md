# Arenzyra Minimal Stable System

## Goal

Reduce match operations to one stable runtime model:

- one live telemetry pipeline
- one minimal lifecycle
- two accepted sources: `API`, `MANUAL`
- final results computed once at finalization

## Lifecycle

Canonical lifecycle:

- `READY`
- `LIVE`
- `FINISH_PENDING`
- `FINISHED`

Compatibility aliases are normalized at read boundaries only:

- `COUNTDOWN` -> `READY`
- `PAUSED` -> `LIVE`
- `ENDED` -> `FINISH_PENDING`
- `CONFIRMED` -> `FINISHED`

No new control flow should depend on the legacy states.

## Sources

Accepted source modes:

- `API`: launcher `ob.js` -> backend ingress
- `MANUAL`

Rejected for new writes and new setup:

- `AUTO`
- `PCOB`
- `SHADOW`
- `SIMULATOR`
- `HYBRID`

Legacy source values may still be normalized for backward compatibility, but the system should expose only `API` or `MANUAL`.

Legacy compatibility boundaries kept temporarily:

- adapter ingest under `/pcob/telemetry`
- old explicit `PCOB` producer controls only for existing legacy matches
- no new `API` match should depend on `/pcob/feed/*`, `/pcob/bind`, or socket `pcob:bind`
- legacy startup tooling is opt-in only: `ALLOW_LEGACY_SHADOW_API=1` or `ALLOW_LEGACY_PCOB_INGEST=1`

## Live Ownership

Live player state ownership is singular:

- `telemetry-engine` is the only authoritative live player-state writer
- no live player-state merge from multiple sources
- non-telemetry writers must not publish telemetry-owned live player rows during `LIVE`
- missing players are not treated as dead
- derived elimination is blocked during unstable phases

## Persistence

Runtime persistence kept:

- `Match`
- `MatchSlot`
- `MatchSlotPlayer`
- `MatchSlotResult`

Usage disabled for the stable path:

- draft-oriented runtime flows
- snapshot-driven intermediate truth
- intermediate scoring/finalization tables as authoritative live state

`MatchSlotResult` remains final-results storage, not live-runtime storage.

## Results

Results policy:

- no result writes during `LIVE`
- compute final results once at `FINISH_PENDING`
- finalize atomically to `FINISHED`

`LIVE` is telemetry-only. `RESULTS` is database-only.

## Control API

Control surfaces are split by phase:

- `/control/setup`
- `/control/live`
- `/control/results`

Intent:

- setup endpoints read and mutate DB-backed setup state only
- live endpoints operate on telemetry/live control only
- results endpoints operate on finalized results only

## Frontend

Organizer/control UI should follow strict phase ownership:

- `SETUP`: DB-only
- `LIVE`: telemetry-only
- `RESULTS`: finalized DB results only

Disabled UI patterns:

- draft-era mixed runtime views
- mixed-source displays in `LIVE`
- live/result blending in the same authority surface

## Removed Or Disabled Logic

- `PAUSED`, `CONFIRMED`, and extra lifecycle branches
- source selection beyond `API` and `MANUAL`
- hybrid or merged live-state authority
- manual player mutation commands in telemetry control
- live result editing during `LIVE`
- repeated or incremental finalization passes
- draft/snapshot/intermediate tables as runtime truth

## Stable Operating Model

1. Setup match in DB with `READY` and source `API` or `MANUAL`.
2. Enter `LIVE`.
3. If source is `API`, launcher `ob.js` feeds `telemetry-engine`, which owns live player state.
4. When live play ends, move to `FINISH_PENDING`.
5. Compute final results once.
6. Commit final result state and move to `FINISHED`.

This is the only supported steady-state architecture going forward.
