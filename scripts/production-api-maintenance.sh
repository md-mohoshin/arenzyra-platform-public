#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: bash scripts/production-api-maintenance.sh [--help]

Production API maintenance is intentionally unavailable in this release.
The canonical API image contains only the application runtime and the
lockfile-owned Prisma CLI used by the guarded one-shot api-migrate service; it
does not contain the former IDP-backfill or YouTube-key-rotation entrypoints.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

printf '%s\n' \
  'PRODUCTION API MAINTENANCE BLOCKED: this release has no reviewed API maintenance entrypoints.' \
  'No Docker, database, backup, migration, or service action was attempted.' >&2
exit 75
