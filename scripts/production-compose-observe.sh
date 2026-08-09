#!/usr/bin/env bash
set -Eeuo pipefail

SAFE_COMMAND_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_COMMAND_PATH"

usage() {
  printf 'Usage: scripts/production-compose-observe.sh {ps|logs}\n' >&2
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi
operation="$1"
case "$operation" in
  ps|logs) ;;
  *) usage; exit 2 ;;
esac

PRODUCTION_ROOT="${ARENZYRA_PRODUCTION_ROOT:-/opt/arenzyra}"
EXPECTED_ROOT="/opt/arenzyra"
resolved_root="$(realpath -e -- "$PRODUCTION_ROOT" 2>/dev/null || true)"
if [ -z "$resolved_root" ]; then
  printf 'Production root does not exist.\n' >&2
  exit 2
fi
if [ "$resolved_root" != "$EXPECTED_ROOT" ]; then
  printf 'Refusing nonstandard production root.\n' >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  printf 'PRODUCTION OBSERVATION BLOCKED: command must run as root.\n' >&2
  exit 75
fi
account_record="$(getent passwd 0 2>/dev/null || true)"
IFS=: read -r _ _ _ _ _ account_home _ <<<"$account_record"
safe_account_home="$(realpath -e -- "${account_home:-/root}" 2>/dev/null || true)"
ambient_account_home="$(realpath -e -- "${HOME:-$safe_account_home}" 2>/dev/null || true)"
if [ -z "$safe_account_home" ] || [ ! -d "$safe_account_home" ] || \
  [ "$ambient_account_home" != "$safe_account_home" ]; then
  printf 'PRODUCTION OBSERVATION BLOCKED: HOME does not match the root account.\n' >&2
  exit 75
fi

cd "$resolved_root"
source scripts/require-local-production-docker.sh
test -f infra/.env.publish
test -f infra/docker-compose.publish.yml

reviewed_compose_project="$(node scripts/read-dotenv-value.cjs infra/.env.publish ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
compose_project="${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-$reviewed_compose_project}"
if [ -z "$reviewed_compose_project" ] || [ "$compose_project" != "$reviewed_compose_project" ]; then
  printf 'PRODUCTION OBSERVATION BLOCKED: Compose project differs from the reviewed production environment.\n' >&2
  exit 75
fi
if ! [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  printf 'PRODUCTION OBSERVATION BLOCKED: invalid reviewed Compose project.\n' >&2
  exit 75
fi

compose=(
  env -i
  "PATH=$SAFE_COMMAND_PATH"
  "HOME=$safe_account_home"
  "DOCKER_HOST=$DOCKER_HOST"
  docker compose
  -p "$compose_project"
  --env-file infra/.env.publish
)
if [ -f infra/.env.release ]; then
  compose+=(--env-file infra/.env.release)
fi
compose+=(-f infra/docker-compose.publish.yml --profile discord-bot)

if [ "$operation" = "ps" ]; then
  "${compose[@]}" ps
else
  "${compose[@]}" logs --follow
fi
