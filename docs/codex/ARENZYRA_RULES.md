Arenzyra GLOBAL RULES

Architecture
- Backend is authoritative.
- No frontend optimistic authority for official match/results state.
- No duplicate lifecycle authority.
- No duplicate results authority.
- Adapter layer must stay separate from scoring/results.
- Widgets read canonical backend state only.

Telemetry
- Raw provider payloads never write MatchSlotResult or MatchSlotPlayerResult directly.
- Telemetry ingest never recomputes scoring directly.
- Match end never happens because packets stop.
- Missing telemetry never means eliminated.
- knocked != eliminated.
- Team elimination only when all players are eliminated or finalization fallback explicitly applies at END.

Results
- Final results only materialize through MatchConclusionService -> ResultsService.
- Finalization runs once.
- Finished matches must not leave alive/knocked flags in finalized player rows.
- Finalization must emit verification logs.

Control/UI
- Control panel must read live state while LIVE and finalized results after ENDED.
- No legacy fallback to pcobState or raw shadow readers.
- Every authoritative transition needs structured logs.

Work style
- PLAN first for risky changes.
- Keep changes narrow.
- Add verification commands.
- Add logs or tests for any critical path change.
