#!/usr/bin/env bash
set -Eeuo pipefail

[ "$#" -eq 0 ] || {
  printf 'RETIRED WIDGET ZERO INVENTORY BLOCKED: no arguments are accepted.\n' >&2
  exit 75
}

# The inspection validates the exact production database identity and emits a
# fixed seven-row aggregate document. Parse it again in zero-required mode so a
# malformed or nonzero snapshot fails before any candidate API mutation.
/bin/bash scripts/inspect-production-retired-widget-inventory.sh |
  /usr/bin/env node scripts/inspect-production-retired-widget-inventory.cjs \
    --require-zero
