# widget-reader-migration

## Purpose

Move widgets away from legacy sources.

## Rules

- do not read pcobState
- do not read raw MatchTelemetry directly if canonical broadcast exists
- define one canonical payload shape
- update widgets, maps, rankings, and feed readers to that shape
