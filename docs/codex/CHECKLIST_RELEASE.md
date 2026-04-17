# CHECKLIST_RELEASE

## Release Gate: telemetry/lifecycle/results

- canonical path identified
- no duplicate writers
- no raw telemetry -> results writes
- explicit lifecycle logs
- diagnostics endpoint works
- final-results-written log works
- final-results-postcondition-failed absent in test match
- control panel correct after ENDED
- widgets show canonical state only
