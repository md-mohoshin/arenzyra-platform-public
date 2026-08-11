#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_ROOT="/opt/arenzyra"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
INTERRUPTED_CUTOVER=0
if [ "${1:-}" = "--legacy-cutover-interrupted" ] && [ "$#" -eq 1 ]; then
  INTERRUPTED_CUTOVER=1
  shift
fi
[ "$#" -eq 0 ] && [ "$(id -u)" -eq 0 ] && \
  [ "$(pwd -P)" = "$EXPECTED_ROOT" ] || {
  printf 'API DATA VOLUME REMEDIATION BLOCKED: exact production invocation is required.\n' >&2
  exit 75
}
source scripts/require-local-production-docker.sh
if [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" != "1" ] || \
  [ ! -e /proc/$$/fd/8 ] || [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ] || \
  ! flock -n 8; then
  printf 'API DATA VOLUME REMEDIATION BLOCKED: inherited deployment lock is not verified.\n' >&2
  exit 75
fi

reviewed_project="$(
  node scripts/read-dotenv-value.cjs infra/.env.publish ARENZYRA_DEPLOY_COMPOSE_PROJECT
)"
[[ "$reviewed_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || exit 75
export ARENZYRA_DEPLOY_COMPOSE_PROJECT="$reviewed_project"
export ARENZYRA_DEPLOY_ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
if [ "$INTERRUPTED_CUTOVER" -eq 1 ]; then
  bash scripts/production-deploy-preflight.sh --allow-legacy-cutover-interrupted
else
  bash scripts/production-deploy-preflight.sh --allow-legacy-cutover-stopped
fi

for logical_name in api-uploads api-storage; do
  volume_name="${reviewed_project}_${logical_name}"
  metadata="$(
    docker volume inspect --format \
      '{{.Driver}}|{{.Scope}}|{{len .Options}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}|{{.Mountpoint}}' \
      "$volume_name"
  )"
  IFS='|' read -r driver scope option_count label_project label_volume mountpoint \
    <<<"$metadata"
  [ "$driver" = local ] && [ "$scope" = local ] && [ "$option_count" = 0 ] && \
    [ "$label_project" = "$reviewed_project" ] && \
    [ "$label_volume" = "$logical_name" ] && \
    [ "$(realpath -e -- "$mountpoint")" = "$mountpoint" ] && \
    [ ! -L "$mountpoint" ] && [ -d "$mountpoint" ] || exit 75
  node scripts/remediate-api-data-volume-tree.cjs --root "$mountpoint"
done

bash scripts/verify-production-api-data-volumes.sh
printf 'API DATA VOLUME REMEDIATION VERIFIED owner=1000:1000 directories=0750 files=0640 content_preserved=true\n'
