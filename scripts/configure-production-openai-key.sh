#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
EXPECTED_ROOT="/opt/arenzyra"
ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
COMPOSE_FILE="$EXPECTED_ROOT/infra/docker-compose.publish.yml"
temporary=""
original=""
openai_key=""
env_updated=0
recreate_started=0

block() {
  printf 'PRODUCTION OPENAI KEY CONFIGURATION BLOCKED: %s\n' "$1" >&2
  exit 75
}

cleanup() {
  openai_key=""
  case "${temporary:-}" in
    /opt/arenzyra/infra/.env.publish.openai-key.*)
      rm -f -- "$temporary"
      ;;
  esac
  case "${original:-}" in
    /opt/arenzyra/infra/.env.publish.openai-key-original.*)
      if [ "$env_updated" = "1" ] && [ "$recreate_started" = "0" ] && \
        [ -f "$original" ] && [ ! -L "$original" ]; then
        mv -T -- "$original" "$ENV_FILE" || \
          printf 'CRITICAL: failed to restore the original publish environment.\n' >&2
      else
        rm -f -- "$original"
      fi
      ;;
  esac
}
trap cleanup EXIT

[ "$#" -eq 0 ] || block "arguments are unsupported."
[ "$(id -u)" -eq 0 ] || block "UID 0 is required."
[ "$(pwd -P)" = "$EXPECTED_ROOT" ] || block "production root is not exact."
source scripts/require-local-production-docker.sh
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source scripts/acquire-production-deploy-lock.sh

for command in curl docker grep install mv node seq sleep stat; do
  command -v "$command" >/dev/null 2>&1 || block "required command is unavailable: $command"
done
[ -r /proc/self/fd/3 ] || block "credential input descriptor 3 is required."
IFS= read -r openai_key <&3 || block "OpenAI key input is missing."
openai_key="${openai_key%$'\r'}"
if IFS= read -r unexpected_input <&3; then
  block "credential input contains unexpected trailing data."
fi
[[ "$openai_key" =~ ^sk-[A-Za-z0-9_-]{20,240}$ ]] || block "OpenAI key format is invalid."

[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || block "publish env is missing or linked."
[ -f "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] || block "publish Compose file is missing or linked."
env_identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$ENV_FILE" 2>/dev/null || true)"
IFS=':' read -r env_uid env_gid env_mode env_links env_size <<<"$env_identity"
if [ "$env_uid" != "0" ] || [ "$env_gid" != "0" ] || [ "$env_links" != "1" ] || \
  ! [[ "$env_mode" =~ ^[0-7]{3,4}$ ]] || (( 8#$env_mode & 8#022 )) || \
  ! [[ "$env_size" =~ ^[1-9][0-9]*$ ]] || [ "$env_size" -gt 1048576 ]; then
  block "publish env identity, permissions, link count, or size is unsafe."
fi

key_count="$(grep -Ec '^OPENAI_API_KEY=' "$ENV_FILE" || true)"
[[ "$key_count" =~ ^[01]$ ]] || \
  block "publish env contains more than one active OPENAI_API_KEY entry."

http_status="$({
  printf 'header = "Authorization: Bearer %s"\n' "$openai_key"
  printf 'silent\nshow-error\noutput = "/dev/null"\nwrite-out = "%%{http_code}"\n'
} | curl --disable --config - --ipv4 --request GET --max-time 20 \
  https://api.openai.com/v1/models 2>/dev/null || true)"
case "$http_status" in
  200) ;;
  ''|000) block "OpenAI validation endpoint could not be reached." ;;
  *) block "OpenAI rejected the supplied key with HTTP $http_status." ;;
esac

# The first guard validates capacity and the current environment. The second
# guard below runs after the atomic credential write, immediately before the
# only service recreation.
bash scripts/production-deploy-preflight.sh

original="$EXPECTED_ROOT/infra/.env.publish.openai-key-original.$$"
install -m "$env_mode" -o 0 -g 0 -- "$ENV_FILE" "$original"
[ "$(stat -Lc '%u:%g:%a:%h' -- "$original")" = "0:0:${env_mode}:1" ] || \
  block "original publish env backup identity differs."

temporary="$EXPECTED_ROOT/infra/.env.publish.openai-key.$$"
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" == OPENAI_API_KEY=* ]]; then
    printf 'OPENAI_API_KEY=%s\n' "$openai_key"
  else
    printf '%s\n' "$line"
  fi
done <"$ENV_FILE" >"$temporary"
[ "$key_count" = "1" ] || printf 'OPENAI_API_KEY=%s\n' "$openai_key" >>"$temporary"
chmod "$env_mode" "$temporary"
chown 0:0 "$temporary"
[ "$(stat -Lc '%u:%g:%a:%h' -- "$temporary")" = "0:0:${env_mode}:1" ] || \
  block "temporary publish env identity differs."
mv -T -- "$temporary" "$ENV_FILE"
temporary=""
env_updated=1

reviewed_project="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
[[ "$reviewed_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || block "Compose project is invalid."
compose=(
  env -i "PATH=$SAFE_PATH" HOME=/root "DOCKER_HOST=$DOCKER_HOST"
  docker compose -p "$reviewed_project" --env-file "$ENV_FILE"
)
[ ! -f infra/.env.release ] || compose+=(--env-file infra/.env.release)
compose+=(-f "$COMPOSE_FILE" --profile discord-bot)
"${compose[@]}" config --quiet

bash scripts/production-deploy-preflight.sh
printf 'PRODUCTION WARNING: recreating only the API container; connected clients may briefly reconnect.\n'
recreate_started=1
"${compose[@]}" up -d --no-deps --force-recreate api

api_container_id="$("${compose[@]}" ps -q api)"
[ -n "$api_container_id" ] || block "API container is missing after recreation."
api_health=""
for _ in $(seq 1 60); do
  api_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_container_id" 2>/dev/null || true)"
  [ "$api_health" = "healthy" ] && break
  [ "$api_health" != "unhealthy" ] || block "API container became unhealthy."
  sleep 2
done
[ "$api_health" = "healthy" ] || block "API container did not become healthy in time."

openai_key=""
rm -f -- "$original"
original=""
env_updated=0
exec /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root \
  node scripts/verify-publish.cjs --env infra/.env.publish
