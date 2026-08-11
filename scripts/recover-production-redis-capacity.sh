#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"

source scripts/require-local-production-docker.sh

EXPECTED_ROOT="/opt/arenzyra"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
OLD_MAX_MEMORY_BYTES=805306368
NEW_MAX_MEMORY_BYTES=3221225472
MIN_HOST_MEMORY_BYTES=8589934592
MIN_AVAILABLE_MEMORY_BYTES=3221225472

block() {
  printf 'REDIS CAPACITY RECOVERY BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 0 ] || block "no arguments are accepted"
[ "$(id -u)" -eq 0 ] || block "root is required"
[ "$(realpath -e -- . 2>/dev/null || true)" = "$EXPECTED_ROOT" ] || \
  block "production root identity differs"

exec 8>"$LOCK_FILE"
flock -w 10 8 || block "another production deployment holds the lock"

# This is the required immediately preceding production gate. It accepts only
# the stopped-writer PostgreSQL/Redis dependency-transition topology.
bash scripts/production-deploy-preflight.sh --allow-cutover-dependency-recovery

compose_project="$(node scripts/read-dotenv-value.cjs infra/.env.publish ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
[[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || \
  block "compose project is invalid"
mapfile -t redis_containers < <(
  docker ps \
    --filter "label=com.docker.compose.project=$compose_project" \
    --filter "label=com.docker.compose.service=redis" \
    --format '{{.ID}}'
)
[ "${#redis_containers[@]}" -eq 1 ] || block "Redis container count differs"
redis_container="${redis_containers[0]}"
expected_redis_image="redis:7.4.10-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2"
[ "$(docker inspect --format '{{.Config.Image}}' "$redis_container")" = "$expected_redis_image" ] || \
  block "Redis is not the reviewed pinned dependency"

used_memory="$(
  docker exec "$redis_container" redis-cli --raw INFO memory |
    tr -d '\r' | sed -n 's/^used_memory:\([0-9][0-9]*\)$/\1/p'
)"
max_memory="$(docker exec "$redis_container" redis-cli --raw CONFIG GET maxmemory | tr -d '\r' | tail -n 1)"
max_memory_policy="$(docker exec "$redis_container" redis-cli --raw CONFIG GET maxmemory-policy | tr -d '\r' | tail -n 1)"
[[ "$used_memory" =~ ^[0-9]+$ ]] || block "Redis used-memory reading is invalid"
[ "$max_memory" = "$OLD_MAX_MEMORY_BYTES" ] || block "Redis maxmemory is not the reviewed 768mb profile"
[ "$max_memory_policy" = "noeviction" ] || block "Redis eviction policy differs"

# Prove the specific readiness failure: the restored persistent dataset has
# crossed the 85% safety gate, while the new fixed ceiling leaves headroom.
[ "$used_memory" -ge $((OLD_MAX_MEMORY_BYTES * 85 / 100)) ] || \
  block "Redis is not saturated at the reviewed readiness threshold"
[ "$used_memory" -lt $((NEW_MAX_MEMORY_BYTES * 85 / 100)) ] || \
  block "the reviewed 3gb ceiling would not restore safe headroom"

host_memory_kib="$(sed -n 's/^MemTotal:[[:space:]]*\([0-9][0-9]*\)[[:space:]]*kB$/\1/p' /proc/meminfo)"
available_memory_kib="$(sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\)[[:space:]]*kB$/\1/p' /proc/meminfo)"
[[ "$host_memory_kib" =~ ^[0-9]+$ ]] && [[ "$available_memory_kib" =~ ^[0-9]+$ ]] || \
  block "host memory readings are invalid"
[ $((host_memory_kib * 1024)) -ge "$MIN_HOST_MEMORY_BYTES" ] || \
  block "host memory is below the reviewed 8 GiB minimum"
[ $((available_memory_kib * 1024)) -ge "$MIN_AVAILABLE_MEMORY_BYTES" ] || \
  block "available host memory is below the reviewed 3 GiB minimum"

node scripts/set-production-redis-capacity.cjs \
  --env /opt/arenzyra/infra/.env.publish --from 768mb --to 3gb
node scripts/preflight-publish.cjs --env infra/.env.publish
bash scripts/production-deploy-preflight.sh --allow-cutover-dependency-recovery

printf 'REDIS CAPACITY RECOVERY PREPARED used_bytes=%s maxmemory=3gb policy=noeviction volumes=preserved\n' \
  "$used_memory"
