#!/usr/bin/env bash
set -Eeuo pipefail

[ "$#" -eq 0 ] || {
  printf 'RETIRED WIDGET DEPLOY COMPATIBILITY BLOCKED: no arguments are accepted.\n' >&2
  exit 75
}

# The inspection validates the exact production database identity and emits a
# fixed seven-row aggregate document. Apply the same closed compatibility
# policy at every deployment boundary without changing customer state. This
# count gate grants nothing and does not attest capability generation; the API
# separately requires legacy UUID generation-0 provenance for grandfathering.
/bin/bash scripts/inspect-production-retired-widget-inventory.sh |
  /usr/bin/env node scripts/inspect-production-retired-widget-inventory.cjs \
    --require-deploy-compatible
