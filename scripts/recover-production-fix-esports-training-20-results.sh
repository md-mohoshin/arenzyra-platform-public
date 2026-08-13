#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
EXPECTED_ROOT="/opt/arenzyra"
ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
COMPOSE_FILE="$EXPECTED_ROOT/infra/docker-compose.publish.yml"

block() {
  printf 'FIX ESPORTS RESULT RECOVERY BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 1 ] && case "$1" in
  20-check|20-apply|23-check|23-apply) true ;;
  *) false ;;
esac || block "exactly 20-check, 20-apply, 23-check, or 23-apply is required."
mode="$1"
series="${mode%%-*}"
[ "$(id -u)" -eq 0 ] || block "UID 0 is required."
[ "$(pwd -P)" = "$EXPECTED_ROOT" ] || block "production root is not exact."
source scripts/require-local-production-docker.sh
set --
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source scripts/acquire-production-deploy-lock.sh

[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || block "publish env is missing or linked."
[ -f "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] || block "publish Compose file is missing or linked."
reviewed_project="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
[[ "$reviewed_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || block "Compose project is invalid."
compose=(
  env -i "PATH=$SAFE_PATH" HOME=/root "DOCKER_HOST=$DOCKER_HOST"
  docker compose -p "$reviewed_project" --env-file "$ENV_FILE"
)
[ ! -f infra/.env.release ] || compose+=(--env-file infra/.env.release)
compose+=(-f "$COMPOSE_FILE" --profile discord-bot)

run_recovery() {
  "${compose[@]}" exec -T discord-bot \
    node dist/scripts/recover-fix-esports-training-20-results.js "--$1"
}

run_recovery "$series-check"
[[ "$mode" == *-apply ]] || exit 0

# Result writes are protected by a fresh immutable off-site recovery point.
# The backup script inherits this operation's production deployment lock.
/usr/bin/env ARENZYRA_BACKUP_REQUIRE_OFFSITE=1 \
  /bin/bash scripts/production-backup.sh
run_recovery "$mode"
