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
  printf 'FAILED CANDIDATE RECOVERY BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 1 ] || block "one candidate release ID is required"
release_id="$1"
[[ "$release_id" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || \
  block "candidate release ID is invalid"
[ "$(id -u)" -eq 0 ] || block "root is required"
[ "$(realpath -e -- . 2>/dev/null || true)" = "$EXPECTED_ROOT" ] || \
  block "production root identity differs"

exec 8>"$LOCK_FILE"
flock -w 10 8 || block "another production deployment holds the lock"

bash scripts/production-deploy-preflight.sh --allow-cutover-failed-candidate

if [ -L "$ARCHIVE_ROOT" ] || [ ! -d "$ARCHIVE_ROOT" ] || \
  [ "$(realpath -e -- "$ARCHIVE_ROOT" 2>/dev/null || true)" != "$ARCHIVE_ROOT" ] || \
  [ "$(stat -c '%u:%g:%a' -- "$ARCHIVE_ROOT" 2>/dev/null || true)" != "0:0:700" ]; then
  block "release archive identity differs"
fi

release_env="$ARCHIVE_ROOT/$release_id.env"
if [ -L "$release_env" ] || [ ! -f "$release_env" ] || \
  [ "$(stat -c '%u:%g:%a:%h' -- "$release_env" 2>/dev/null || true)" != "0:0:600:1" ]; then
  block "candidate release metadata is unsafe"
fi
node scripts/validate-publish-release-env.cjs \
  --file "$release_env" --expected-release "$release_id" >/dev/null

compose_project="$(node scripts/read-dotenv-value.cjs infra/.env.publish ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
[[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || \
  block "compose project is invalid"

candidate_containers=()
for service in api media-ai; do
  manifest="$ARCHIVE_ROOT/$release_id.${service}-image.json"
  if [ -L "$manifest" ] || [ ! -f "$manifest" ] || \
    [ "$(stat -c '%u:%g:%a:%h' -- "$manifest" 2>/dev/null || true)" != "0:0:600:1" ]; then
    block "$service image manifest is unsafe"
  fi
  expected_image="$(
    node scripts/validate-release-image-manifest.cjs \
      --file "$manifest" --release-env "$release_env" \
      --expected-release "$release_id" --service "$service" --print-image-id
  )"
  [[ "$expected_image" =~ ^sha256:[a-f0-9]{64}$ ]] || \
    block "$service archived image ID is invalid"
  mapfile -t service_containers < <(
    docker ps -a \
      --filter "label=com.docker.compose.project=$compose_project" \
      --filter "label=com.docker.compose.service=$service" \
      --format '{{.ID}}'
  )
  [ "${#service_containers[@]}" -eq 1 ] || \
    block "$service container count differs"
  container_id="${service_containers[0]}"
  actual_image="$(docker inspect --format '{{.Image}}' "$container_id")"
  [ "$actual_image" = "$expected_image" ] || \
    block "$service container is not the reviewed failed candidate"
  candidate_containers+=("$container_id")
done

# These exact immutable candidate containers are the only application writers
# present. Volumes are neither selected nor removed by either operation.
docker stop --time 60 "${candidate_containers[@]}" >/dev/null
for container_id in "${candidate_containers[@]}"; do
  [ "$(docker inspect --format '{{.State.Status}}' "$container_id")" = "exited" ] || \
    block "candidate did not stop cleanly"
done
docker rm "${candidate_containers[@]}" >/dev/null

bash scripts/production-deploy-preflight.sh --allow-cutover-dependency-recovery
printf 'FAILED CANDIDATE SAFELY REMOVED release=%s containers=2 volumes=preserved\n' "$release_id"
