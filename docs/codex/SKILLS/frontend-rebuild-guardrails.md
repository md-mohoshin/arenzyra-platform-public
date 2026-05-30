# frontend-rebuild-guardrails

## Purpose

Rebuild frontend without breaking backend authority.

## Rules

- UI cannot own official state
- UI must read canonical APIs only
- no duplicate data model in frontend
- preserve routing and org scoping
- rebuild page by page, not all at once
