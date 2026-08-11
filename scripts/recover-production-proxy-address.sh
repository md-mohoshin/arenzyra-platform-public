#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
source scripts/require-local-production-docker.sh

EXPECTED_ROOT="/opt/arenzyra"
ARCHIVE_ROOT="/opt/arenzyra-release-metadata"
LOCK_FILE="/run/arenzyra-production-deploy.lock"

block() {
  printf 'PROXY ADDRESS RECOVERY BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 1 ] || block "one candidate release ID is required"
release_id="$1"
[[ "$release_id" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || block "candidate release ID is invalid"
[ "$(id -u)" -eq 0 ] || block "root is required"
[ "$(realpath -e -- . 2>/dev/null || true)" = "$EXPECTED_ROOT" ] || block "production root identity differs"

exec 8>"$LOCK_FILE"
flock -w 10 8 || block "another production deployment holds the lock"

compose_project="$(node scripts/read-dotenv-value.cjs infra/.env.publish ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
[[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || block "compose project is invalid"
mapfile -t managed_containers < <(
  docker ps -a --filter "label=com.docker.compose.project=$compose_project" --format '{{.ID}}'
)

if [ "${#managed_containers[@]}" -eq 6 ]; then
  bash scripts/production-deploy-preflight.sh --allow-cutover-proxy-collision
  [ -d "$ARCHIVE_ROOT" ] && [ ! -L "$ARCHIVE_ROOT" ] && \
    [ "$(stat -c '%u:%g:%a' -- "$ARCHIVE_ROOT" 2>/dev/null || true)" = "0:0:700" ] || \
    block "release archive identity differs"
  release_env="$ARCHIVE_ROOT/$release_id.env"
  [ -f "$release_env" ] && [ ! -L "$release_env" ] && \
    [ "$(stat -c '%u:%g:%a:%h' -- "$release_env" 2>/dev/null || true)" = "0:0:600:1" ] || \
    block "candidate release metadata is unsafe"
  node scripts/validate-publish-release-env.cjs --file "$release_env" --expected-release "$release_id" >/dev/null

  running_containers=()
  removable_containers=()
  for service in api media-ai web; do
    manifest="$ARCHIVE_ROOT/$release_id.${service}-image.json"
    [ -f "$manifest" ] && [ ! -L "$manifest" ] && \
      [ "$(stat -c '%u:%g:%a:%h' -- "$manifest" 2>/dev/null || true)" = "0:0:600:1" ] || \
      block "$service image manifest is unsafe"
    expected_image="$(node scripts/validate-release-image-manifest.cjs --file "$manifest" --release-env "$release_env" --expected-release "$release_id" --service "$service" --print-image-id)"
    mapfile -t service_containers < <(
      docker ps -a --filter "label=com.docker.compose.project=$compose_project" \
        --filter "label=com.docker.compose.service=$service" --format '{{.ID}}'
    )
    [ "${#service_containers[@]}" -eq 1 ] || block "$service container count differs"
    [ "$(docker inspect --format '{{.Image}}' "${service_containers[0]}")" = "$expected_image" ] || \
      block "$service container is not the reviewed candidate"
    running_containers+=("${service_containers[0]}")
    removable_containers+=("${service_containers[0]}")
  done

  mapfile -t proxy_containers < <(
    docker ps -a --filter "label=com.docker.compose.project=$compose_project" \
      --filter "label=com.docker.compose.service=proxy" --format '{{.ID}}'
  )
  [ "${#proxy_containers[@]}" -eq 1 ] || block "proxy container count differs"
  expected_proxy_image="caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"
  [ "$(docker inspect --format '{{.Config.Image}}' "${proxy_containers[0]}")" = "$expected_proxy_image" ] || \
    block "proxy container is not the reviewed pinned dependency"
  removable_containers+=("${proxy_containers[0]}")

  expected_networks=(postgres:172.30.50.2 redis:172.30.50.3 media-ai:172.30.50.4 api:172.30.50.5 web:172.30.50.6)
  for expected_network in "${expected_networks[@]}"; do
    service="${expected_network%%:*}"
    expected_ip="${expected_network#*:}"
    mapfile -t service_containers < <(
      docker ps -a --filter "label=com.docker.compose.project=$compose_project" \
        --filter "label=com.docker.compose.service=$service" --format '{{.ID}}'
    )
    [ "${#service_containers[@]}" -eq 1 ] || block "$service network container count differs"
    actual_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${service_containers[0]}")"
    [ "$actual_ip" = "$expected_ip" ] || block "$service network address differs from the attested collision topology"
  done

  # Repeat the mandatory gate immediately before stopping/removing only the
  # attested application shells. Named volumes are never selected.
  bash scripts/production-deploy-preflight.sh --allow-cutover-proxy-collision
  docker stop --time 60 "${running_containers[@]}" >/dev/null
  docker rm "${removable_containers[@]}" >/dev/null
  bash scripts/production-deploy-preflight.sh --allow-cutover-dependency-recovery
elif [ "${#managed_containers[@]}" -eq 2 ]; then
  # Idempotent continuation if transport stopped after shell removal.
  bash scripts/production-deploy-preflight.sh --allow-cutover-dependency-recovery
else
  block "managed container topology differs from the reviewed collision or dependency state"
fi

node scripts/set-production-proxy-address.cjs --env /opt/arenzyra/infra/.env.publish
node scripts/preflight-publish.cjs --env infra/.env.publish
bash scripts/production-deploy-preflight.sh --allow-cutover-dependency-recovery
printf 'PROXY ADDRESS RECOVERY PREPARED address=172.30.50.7 containers=4 volumes=preserved\n'
