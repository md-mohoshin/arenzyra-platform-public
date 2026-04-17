# PROMPT_TEMPLATES

## Audit And Plan Template

Follow /docs/codex/ARENZYRA_RULES.md exactly.

GOAL:
[one sentence]

IMPORTANT:
Do not code yet.

TASKS:
1. Audit current implementation
2. Identify source-of-truth
3. Identify risks and conflicting files
4. Propose exact implementation order
5. Propose verification steps

OUTPUT:
- concise audit
- exact files
- keep/remove/replace/merge list
- step-by-step plan

## Approved Plan Implementation Template

Follow /docs/codex/ARENZYRA_RULES.md exactly.

GOAL:
[one sentence]

CONTEXT:
Use the approved plan only.

RULES:
- no extra features
- no broad refactor
- preserve compile stability
- add targeted logs/tests only where needed

TASKS:
[exact steps]

DELIVERABLES:
- files changed
- commands run
- verification notes
- remaining risks

## Root Cause Analysis Template

Follow /docs/codex/ARENZYRA_RULES.md exactly.

GOAL:
Identify the root cause of:
[bug]

IMPORTANT:
Do not fix yet.

ANALYZE THESE LAYERS:
- adapter input
- normalization
- ingress
- canonical engine
- projection/finalization
- query layer
- UI render layer

OUTPUT:
- ranked hypotheses
- one fastest verification step
- one likely fix path

## Recent Changes Audit Template

Follow /docs/codex/ARENZYRA_RULES.md exactly.

Audit the recent changes for:
- duplicate authority
- stale readers
- legacy fallbacks
- invariant violations
- missing tests/logs
- hidden write paths

Return:
- violations only
- exact file/line references
- minimal fix plan

## Narrow Backend Fix Template

Follow /docs/codex/ARENZYRA_RULES.md exactly.

GOAL:
Fix [specific backend issue].

IMPORTANT:
Do not broaden scope.
Preserve backend authority.
Do not add fallback writers.

TASKS:
1. Identify the current authority for this path
2. Remove conflicting writers/readers
3. Implement the smallest safe fix
4. Add one targeted test
5. Add one diagnostic log if the path is critical

DELIVERABLES:
- files changed
- commands run
- what remains unverified at runtime

## Frontend Rebuild Template

Follow /docs/codex/ARENZYRA_RULES.md exactly.

GOAL:
Rebuild [page/module] cleanly.

RULES:
- no optimistic authority
- no duplicate domain logic in frontend
- consume canonical APIs only
- keep dense operator-focused UI
- preserve org scoping and status visibility

TASKS:
1. Audit current page
2. Identify backend contracts already available
3. Remove dead UI state logic
4. Rebuild the page cleanly
5. Keep layout dense and production-first

## Widget Implementation Template

Follow /docs/codex/ARENZYRA_RULES.md exactly.

GOAL:
Implement/fix [widget].

RULES:
- widget reads canonical broadcast/live state only
- no raw telemetry reads
- no hardcoded fake data in production path
- respect org branding
- support broadcast-safe empty/loading/final states

DELIVERABLES:
- widget contract used
- files changed
- preview path
- runtime checklist
