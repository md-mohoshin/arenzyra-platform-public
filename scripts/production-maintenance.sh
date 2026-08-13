#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
ENV_FILE="${ARENZYRA_MAINTENANCE_ENV_FILE:-/etc/arenzyra-maintenance.env}"

if [ "$REPOSITORY_ROOT" != "$EXPECTED_ROOT" ]; then
  printf 'PRODUCTION MAINTENANCE BLOCKED: repository root must be /opt/arenzyra.\n' >&2
  exit 75
fi
if [ "$ENV_FILE" != "/etc/arenzyra-maintenance.env" ]; then
  printf 'PRODUCTION MAINTENANCE BLOCKED: unreviewed maintenance environment path.\n' >&2
  exit 75
fi
if [ -e "$ENV_FILE" ]; then
  if [ -L "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ] || [ "$(stat -c %u -- "$ENV_FILE")" != "0" ]; then
    printf 'PRODUCTION MAINTENANCE BLOCKED: maintenance environment must be a root-owned regular file.\n' >&2
    exit 75
  fi
  environment_mode="$(stat -c %a -- "$ENV_FILE")"
  if ! [[ "$environment_mode" =~ ^[0-7]{3,4}$ ]] || (( 8#$environment_mode & 022 )); then
    printf 'PRODUCTION MAINTENANCE BLOCKED: maintenance environment is group/world writable.\n' >&2
    exit 75
  fi
  # shellcheck disable=SC1091
  source "$ENV_FILE"
fi

cd "$REPOSITORY_ROOT"
source scripts/require-local-production-docker.sh
case "${1:-}" in
  --prune-builder-cache)
    [ "$#" -eq 1 ] || {
      printf 'PRODUCTION MAINTENANCE BLOCKED: --prune-builder-cache accepts no extra arguments.\n' >&2
      exit 75
    }
    export ARENZYRA_MAINTENANCE_ALLOW_GLOBAL_BUILDER_PRUNE=1
    exec node scripts/production-maintenance.cjs
    ;;
  *)
    exec node scripts/production-maintenance.cjs "$@"
    ;;
esac
