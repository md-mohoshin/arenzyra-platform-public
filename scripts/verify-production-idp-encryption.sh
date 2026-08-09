#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

printf '%s\n' \
  'IDP ENCRYPTION GATE BLOCKED: the canonical API release still stores Discord IDP room passwords as plaintext.' \
  'Integrate and replay a reviewed forward encryption migration, encrypted runtime writes, a writer-stopped backfill, and a zero-plaintext postcondition before any production deployment.' \
  'No Docker, database, backup, migration, or service action was attempted.' >&2
exit 75
