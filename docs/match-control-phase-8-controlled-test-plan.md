# Arenzyra Match Control Phase 8

> Historical evidence only. The legacy `/realtime` access-JWT transport is
> quarantined in the current candidate because it did not persistently enforce
> token expiry, revocation, account state, tenant scope, and entitlement after
> the handshake. Do not use the socket-binding steps below as a current test
> plan. A replacement producer/reader transport needs rotatable credentials and
> bounded, persistent-session authorization before this scenario is rewritten
> and rerun.

## Controlled Real-Match Test Plan

### Scope
- Verify real operator workflow behavior against the running Nest application and realtime socket path.
- Record any remaining blockers precisely enough for a go/no-go decision.

### Execution Summary
- `pnpm --dir apps/api build`
  - Result: PASS
- `pnpm --dir apps/api test -- --runInBand src/modules/results/results.service.spec.ts src/modules/results/results.lock.spec.ts src/modules/telemetry/telemetry-engine.service.spec.ts src/modules/matches/matches.service.results.spec.ts src/modules/match-control/match-control.service.spec.ts`
  - Result: PASS
  - Evidence: 5 suites passed, 44 tests passed
- `pnpm --dir apps/api test:e2e -- test/match-control.phase8.e2e-spec.ts --runInBand --detectOpenHandles --forceExit --verbose`
  - Result: FAIL
  - Evidence: app booted, auth succeeded, fixture created, realtime socket bound, `READY -> COUNTDOWN` executed, then live transition failed before telemetry verification could proceed

### Exact Scenario Execution
- Executed end-to-end path in [match-control.phase8.e2e-spec.ts](../apps/api/test/match-control.phase8.e2e-spec.ts)
  - Create organization, organizer user, tournament, stage, group, teams, match, slots, control state
  - Login through `/auth/login`
  - Bind `/realtime` socket to the match
  - Read initial `READY` control state
  - `POST /api/matches/:matchId/control/start`
  - Verify `COUNTDOWN`
  - `POST /api/matches/:matchId/control/mark-live`
  - Attempt to verify `LIVE`
  - Execution stopped here because the match never surfaced a stable `LIVE` control summary

### Scenario Checklist

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Match start lifecycle (`READY -> COUNTDOWN -> LIVE`) | FAIL | `READY -> COUNTDOWN` passed. `COUNTDOWN -> LIVE` failed: `Timed out waiting for LIVE control summary` in [match-control.phase8.e2e-spec.ts](../apps/api/test/match-control.phase8.e2e-spec.ts#L786) |
| 2 | Live telemetry flow | FAIL | Blocked by scenario 1. No stable `LIVE` window was available for the first telemetry packet in the committed e2e path |
| 3 | Manual correction flow | FAIL | Blocked by scenario 1 |
| 4 | Refresh persistence | FAIL | Blocked by scenario 1 |
| 5 | Manual ownership protection | FAIL | Blocked by scenario 1 |
| 6 | Override release | FAIL | Blocked by scenario 1 |
| 7 | Match end workflow | FAIL | Blocked by scenario 1 |
| 8 | Reconnect / stale update handling | FAIL | Blocked by scenario 1 |
| 9 | Slot workflow consistency | FAIL | Blocked by scenario 1 |
| 10 | Audit visibility | FAIL | Blocked by scenario 1 |

### Defect Log

#### MC-001
- Severity: Critical
- Title: `COUNTDOWN -> LIVE` control transition does not stabilize in the real app
- Blocker: Yes
- Repro:
  1. Start the API app
  2. Create an AUTO/telemetry-backed match in `READY`
  3. `POST /api/matches/:matchId/control/start`
  4. Confirm control state reaches `COUNTDOWN`
  5. `POST /api/matches/:matchId/control/mark-live`
  6. Poll `/org/me/matches/:matchId/control`
- Observed:
  - The control summary never reaches `lifecycleStatus === "LIVE"` within 10 seconds
  - The e2e run fails with `Timed out waiting for LIVE control summary`
- Likely files/functions:
  - [match-state.service.ts](../apps/api/src/modules/match-control/match-state.service.ts)
  - [match-admin.controller.ts](../apps/api/src/modules/match-control/match-admin.controller.ts)
  - [match-control.service.ts](../apps/api/src/modules/match-control/match-control.service.ts)

#### MC-002
- Severity: Critical
- Title: Alternate LIVE path rejected first telemetry packet as already ended
- Blocker: Yes
- Repro:
  1. Create the same fixture
  2. Use `/org/me/matches/:matchId/set-status` with `LIVE` instead of `mark-live`
  3. Immediately `POST /api/observer/telemetry`
- Observed:
  - Observer ingest returned `ignored: true`
  - `reason: "MATCH_ENDED"`
  - `matchStatus: "FINISHED"`
- Notes:
  - This was observed during Phase 8 execution while isolating the live-transition path
  - It is likely the same root lifecycle defect surfacing through the telemetry ingress path
- Likely files/functions:
  - [observer.controller.ts](../apps/api/src/modules/observer/observer.controller.ts)
  - [match-state.service.ts](../apps/api/src/modules/match-control/match-state.service.ts)
  - [match-control.service.ts](../apps/api/src/modules/match-control/match-control.service.ts)

### Hardening Performed During Verification
- Added a dedicated AppModule-backed Phase 8 e2e workflow in [match-control.phase8.e2e-spec.ts](../apps/api/test/match-control.phase8.e2e-spec.ts)
- Fixed runtime circular DI issues that previously prevented the Nest app from booting in e2e:
  - [observer.module.ts](../apps/api/src/modules/observer/observer.module.ts)
  - [telemetry.module.ts](../apps/api/src/modules/telemetry/telemetry.module.ts)
  - [telemetry-persistence.service.ts](../apps/api/src/modules/telemetry/telemetry-persistence.service.ts)
  - [telemetry-engine.service.ts](../apps/api/src/modules/telemetry/telemetry-engine.service.ts)
  - [match-engine.service.ts](../apps/api/src/modules/telemetry/match-engine.service.ts)
  - [matches.service.ts](../apps/api/src/modules/matches/matches.service.ts)
  - [match-state.service.ts](../apps/api/src/modules/match-control/match-state.service.ts)
  - [match-control.service.ts](../apps/api/src/modules/match-control/match-control.service.ts)
  - [ingest.service.ts](../apps/api/src/modules/ingest/ingest.service.ts)
  - [telemetry-poller.service.ts](../apps/api/src/modules/shadow/telemetry-poller.service.ts)

### Verdict
- Not ready
- Exact blockers:
  - MC-001: the primary operator lifecycle path does not hold a stable `LIVE` state in the real application
  - MC-002: an alternate LIVE transition path can reject the first telemetry packet as already finalized

### Go / No-Go
- Final verdict: Not ready, with exact blockers above
