#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_COMMAND_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_COMMAND_PATH"

EXPECTED_ROOT="/opt/arenzyra"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
LOCK_TIMEOUT_SECONDS=10
HEALTH_TIMEOUT_SECONDS=180
PUBLIC_HEALTH_TIMEOUT_SECONDS=90
web_start_attempted=0

block() {
  if [ "$web_start_attempted" -eq 0 ]; then
    printf 'PRODUCTION WEB RECOVERY BLOCKED: %s No web start was attempted.\n' "$1" >&2
  else
    printf 'PRODUCTION WEB RECOVERY FAILED: %s The existing web container start was attempted; no image, container, volume, or database was created, replaced, or removed.\n' "$1" >&2
  fi
  exit 75
}

[ "$(id -u)" -eq 0 ] || block "UID 0 is required."
cd "$EXPECTED_ROOT" 2>/dev/null || block "production root is unavailable."
[ "$(pwd -P)" = "$EXPECTED_ROOT" ] || block "production root is not exact."

source scripts/require-local-production-docker.sh

account_record="$(getent passwd 0 2>/dev/null || true)"
IFS=: read -r _ _ _ _ _ account_home _ <<<"$account_record"
safe_account_home="$(realpath -e -- "${account_home:-/root}" 2>/dev/null || true)"
ambient_account_home="$(realpath -e -- "${HOME:-$safe_account_home}" 2>/dev/null || true)"
if [ -z "$safe_account_home" ] || [ ! -d "$safe_account_home" ] || \
  [ "$ambient_account_home" != "$safe_account_home" ]; then
  block "HOME does not match the root account."
fi

test -f infra/.env.publish || block "production environment is missing."
reviewed_compose_project="$(
  node scripts/read-dotenv-value.cjs infra/.env.publish ARENZYRA_DEPLOY_COMPOSE_PROJECT
)"
compose_project="${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-$reviewed_compose_project}"
if [ -z "$reviewed_compose_project" ] || [ "$compose_project" != "$reviewed_compose_project" ]; then
  block "Compose project differs from the reviewed production environment."
fi
if ! [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  block "reviewed Compose project is invalid."
fi

public_web_origin="$(node scripts/read-dotenv-value.cjs infra/.env.publish WEB_APP_ORIGIN)"
[ "$public_web_origin" = "https://arenzyra.com" ] || \
  block "WEB_APP_ORIGIN is not the reviewed Arenzyra HTTPS origin."

verify_lock_directory_safety() {
  local lock_directory lock_directory_mode lock_directory_owner resolved_lock_directory
  lock_directory="$(dirname -- "$LOCK_FILE")"
  if [ -L "$lock_directory" ] || [ ! -d "$lock_directory" ]; then
    return 75
  fi
  resolved_lock_directory="$(realpath -e -- "$lock_directory" 2>/dev/null || true)"
  lock_directory_owner="$(stat -c %u -- "$lock_directory")"
  lock_directory_mode="$(stat -c %a -- "$lock_directory")"
  [ "$resolved_lock_directory" = "/run" ] && \
    [ "$lock_directory_owner" = "0" ] && \
    [[ "$lock_directory_mode" =~ ^[0-7]{3,4}$ ]] && \
    (( (8#$lock_directory_mode & 8#022) == 0 ))
}

verify_lock_file_safety() {
  local descriptor_identity lock_identity lock_mode lock_owner lock_target
  [ ! -L "$LOCK_FILE" ] && [ -f "$LOCK_FILE" ] || return 75
  lock_target="$(readlink -f "/proc/$$/fd/8" 2>/dev/null || true)"
  lock_owner="$(stat -Lc %u -- "/proc/$$/fd/8")"
  lock_mode="$(stat -Lc %a -- "/proc/$$/fd/8")"
  lock_identity="$(stat -Lc '%d:%i:%h' -- "$LOCK_FILE")"
  descriptor_identity="$(stat -Lc '%d:%i:%h' -- "/proc/$$/fd/8")"
  [ "$lock_target" = "$LOCK_FILE" ] && \
    [ "$lock_owner" = "0" ] && \
    [[ "$lock_mode" =~ ^[0-7]{3,4}$ ]] && \
    (( (8#$lock_mode & 8#022) == 0 )) && \
    [ "$lock_identity" = "$descriptor_identity" ] && \
    [ "${lock_identity##*:}" = "1" ]
}

verify_lock_directory_safety || block "deployment lock directory is unsafe."
if [ -e "$LOCK_FILE" ] || [ -L "$LOCK_FILE" ]; then
  if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ] || \
    [ "$(stat -c '%u:%h' -- "$LOCK_FILE" 2>/dev/null || true)" != "0:1" ]; then
    block "deployment lock path identity or ownership is unsafe."
  fi
  existing_lock_mode="$(stat -c %a -- "$LOCK_FILE")"
  if ! [[ "$existing_lock_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$existing_lock_mode & 8#022) != 0 )); then
    block "deployment lock path mode is unsafe."
  fi
fi
exec 8>"$LOCK_FILE"
verify_lock_file_safety || block "deployment lock file is unsafe."
flock -w "$LOCK_TIMEOUT_SECONDS" 8 || block "another production action holds the deployment lock."
verify_lock_file_safety || block "deployment lock identity changed."

project_fingerprint() {
  local container_id
  while IFS= read -r container_id; do
    [ -n "$container_id" ] || continue
    docker inspect --format \
      '{{.Id}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' \
      "$container_id"
  done < <(
    docker ps -a \
      --filter "label=com.docker.compose.project=${compose_project}" \
      --format '{{.ID}}' | LC_ALL=C sort
  ) | LC_ALL=C sort
}

mapfile -t web_container_ids < <(
  docker ps -a \
    --filter "label=com.docker.compose.project=${compose_project}" \
    --filter "label=com.docker.compose.service=web" \
    --format '{{.ID}}'
)
[ "${#web_container_ids[@]}" -eq 1 ] || \
  block "exactly one existing web container is required."
web_container_id="${web_container_ids[0]}"

web_identity="$(
  docker inspect --format \
    '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.oneoff"}}' \
    "$web_container_id"
)"
IFS='|' read -r web_status web_health web_image_id web_project web_service web_oneoff <<<"$web_identity"
[ "$web_status" = "exited" ] || block "existing web container is not stopped."
[ "$web_project" = "$compose_project" ] && [ "$web_service" = "web" ] || \
  block "web container labels are not bound to the reviewed project."
case "$web_oneoff" in
  False|false) ;;
  *) block "web container is a Compose one-off container." ;;
esac
[[ "$web_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || block "web image identity is invalid."
docker image inspect "$web_image_id" >/dev/null 2>&1 || block "web image is unavailable."

before_fingerprint="$(project_fingerprint)"
[ -n "$before_fingerprint" ] || block "production container inventory is empty."

ARENZYRA_DEPLOY_COMPOSE_PROJECT="$compose_project" \
  bash scripts/production-deploy-preflight.sh --allow-web-recovery

rechecked_identity="$(
  docker inspect --format '{{.State.Status}}|{{.Image}}' "$web_container_id"
)"
[ "$rechecked_identity" = "exited|$web_image_id" ] || \
  block "web container changed after preflight."
[ "$(project_fingerprint)" = "$before_fingerprint" ] || \
  block "production container inventory changed after preflight."

printf '[web-recovery] starting existing_container=%s image=%s\n' \
  "$web_container_id" "$web_image_id"
web_start_attempted=1
docker start "$web_container_id" >/dev/null || block "Docker could not start the existing web container."

health_deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
while true; do
  web_runtime="$(
    docker inspect --format \
      '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}|{{.Image}}' \
      "$web_container_id"
  )"
  IFS='|' read -r web_status web_health current_web_image_id <<<"$web_runtime"
  [ "$current_web_image_id" = "$web_image_id" ] || \
    block "web image identity changed during recovery."
  if [ "$web_status" = "running" ] && [ "$web_health" = "healthy" ]; then
    break
  fi
  case "$web_status" in
    created|running) ;;
    *) block "web container failed during health convergence (${web_status}/${web_health})." ;;
  esac
  [ "$SECONDS" -lt "$health_deadline" ] || \
    block "web container did not become healthy within ${HEALTH_TIMEOUT_SECONDS} seconds."
  sleep 2
done

[ "$(project_fingerprint)" = "$before_fingerprint" ] || \
  block "a container or image identity changed during web recovery."

ARENZYRA_DEPLOY_COMPOSE_PROJECT="$compose_project" \
  bash scripts/production-deploy-preflight.sh --allow-web-recovery

public_deadline=$((SECONDS + PUBLIC_HEALTH_TIMEOUT_SECONDS))
while ! node - "$public_web_origin" <<'NODE'
const url = process.argv[2];
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10_000);
(async () => {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "arenzyra-reviewed-web-recovery/1" },
    });
    process.exitCode = response.status >= 200 && response.status < 400 ? 0 : 1;
  } catch {
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
})();
NODE
do
  [ "$SECONDS" -lt "$public_deadline" ] || \
    block "public HTTPS did not recover within ${PUBLIC_HEALTH_TIMEOUT_SECONDS} seconds."
  sleep 3
done

printf '[web-recovery] complete container=%s health=healthy public_https=pass\n' \
  "$web_container_id"
