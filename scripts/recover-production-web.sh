#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_COMMAND_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_COMMAND_PATH"

EXPECTED_ROOT="/opt/arenzyra"
SOURCE_ARCHIVE_ROOT="/opt/arenzyra-source-archives"
LAUNCHER_MOUNT_DESTINATION="/app/public/downloads/launcher"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
LOCK_TIMEOUT_SECONDS=10
HEALTH_TIMEOUT_SECONDS=180
PUBLIC_HEALTH_TIMEOUT_SECONDS=90
web_start_attempted=0
launcher_restore_completed=0

block() {
  if [ "$web_start_attempted" -eq 0 ]; then
    if [ "$launcher_restore_completed" -eq 1 ]; then
      printf 'PRODUCTION WEB RECOVERY BLOCKED: %s The preserved launcher directory was restored atomically; no web start was attempted.\n' "$1" >&2
    else
      printf 'PRODUCTION WEB RECOVERY BLOCKED: %s No launcher data was restored and no web start was attempted.\n' "$1" >&2
    fi
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

verify_root_owned_directory() {
  local directory="$1" resolved="" identity="" mode=""
  [ -d "$directory" ] && [ ! -L "$directory" ] || return 75
  resolved="$(realpath -e -- "$directory" 2>/dev/null || true)"
  identity="$(stat -c '%u:%g' -- "$directory" 2>/dev/null || true)"
  mode="$(stat -c '%a' -- "$directory" 2>/dev/null || true)"
  [ "$resolved" = "$directory" ] && [ "$identity" = "0:0" ] && \
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 ))
}

verify_launcher_tree() {
  local directory="$1" unsafe="" file_count="" total_bytes=""
  verify_root_owned_directory "$directory" || return 75
  if ! unsafe="$({
    find "$directory" -xdev \
      \( ! -user root -o ! -group root -o -perm /022 -o ! \( -type d -o -type f \) \) \
      -print -quit
    find "$directory" -xdev -type f \( -links +1 -o -size +1G \) -print -quit
  } 2>/dev/null)"; then
    return 75
  fi
  [ -z "$unsafe" ] || return 75
  file_count="$(find "$directory" -xdev -type f -printf '.' 2>/dev/null | wc -c)" || return 75
  total_bytes="$(du -sb -- "$directory" 2>/dev/null | awk '{print $1}')" || return 75
  [[ "$file_count" =~ ^[0-9]+$ ]] && [ "$file_count" -ge 1 ] && \
    [ "$file_count" -le 32 ] && [[ "$total_bytes" =~ ^[0-9]+$ ]] && \
    [ "$total_bytes" -gt 0 ] && [ "$total_bytes" -le 1073741824 ]
}

launcher_tree_digest() {
  local directory="$1"
  (
    cd "$directory"
    while IFS= read -r -d '' relative_path; do
      printf '%s\0' "$relative_path"
      sha256sum -- "$relative_path"
    done < <(find . -xdev -type f -print0 | LC_ALL=C sort -z)
  ) | sha256sum | awk '{print $1}'
}

restore_missing_launcher_mount() {
  local mount_record="$1" mount_type="" mount_source="" mount_writable=""
  local release_name="" launcher_root="" candidate="" temporary=""
  local source_digest="" restored_digest=""
  local -a candidates=()

  IFS='|' read -r mount_type mount_source mount_writable <<<"$mount_record"
  [ "$mount_type" = "bind" ] && [ "$mount_writable" = "false" ] || \
    block "launcher download mount is not the expected read-only bind mount."
  launcher_root="$EXPECTED_ROOT/.launcher-releases"
  case "$mount_source" in
    "$launcher_root"/*) ;;
    *) block "launcher download mount source is outside the reviewed runtime directory." ;;
  esac
  release_name="${mount_source#"$launcher_root"/}"
  [[ "$release_name" =~ ^[a-zA-Z0-9._-]{1,128}$ ]] || \
    block "launcher download release name is invalid."
  [ "$mount_source" = "$launcher_root/$release_name" ] || \
    block "launcher download mount source is not an exact release directory."

  if [ -e "$mount_source" ] || [ -L "$mount_source" ]; then
    verify_launcher_tree "$mount_source" || \
      block "existing launcher download mount source is unsafe."
    return
  fi

  verify_root_owned_directory "$SOURCE_ARCHIVE_ROOT" || \
    block "source archive root is unavailable or unsafe."
  while IFS= read -r -d '' candidate; do
    candidates+=("$candidate")
  done < <(
    find "$SOURCE_ARCHIVE_ROOT" -xdev -mindepth 3 -maxdepth 3 \
      -type d -path "*/.launcher-releases/$release_name" -print0
  )
  [ "${#candidates[@]}" -eq 1 ] || \
    block "exactly one preserved launcher release is required for restoration."
  candidate="${candidates[0]}"
  verify_launcher_tree "$candidate" || \
    block "preserved launcher release is unsafe."

  if [ -e "$launcher_root" ] || [ -L "$launcher_root" ]; then
    verify_root_owned_directory "$launcher_root" || \
      block "active launcher runtime directory is unsafe."
  else
    install -d -o root -g root -m 0755 -- "$launcher_root"
    verify_root_owned_directory "$launcher_root" || \
      block "active launcher runtime directory could not be created safely."
  fi
  [ ! -e "$mount_source" ] && [ ! -L "$mount_source" ] || \
    block "launcher download destination appeared during validation."

  temporary="$(mktemp -d -- "$launcher_root/.restore-${release_name}.XXXXXXXX")" || \
    block "temporary launcher restoration directory could not be created."
  cp -a --reflink=auto -- "$candidate/." "$temporary/" || \
    block "preserved launcher release could not be copied; the partial temporary copy was retained for inspection."
  chmod --reference="$candidate" -- "$temporary" || \
    block "restored launcher directory mode could not be preserved."
  verify_launcher_tree "$temporary" || \
    block "temporary restored launcher release failed safety validation."
  source_digest="$(launcher_tree_digest "$candidate")"
  restored_digest="$(launcher_tree_digest "$temporary")"
  [[ "$source_digest" =~ ^[0-9a-f]{64}$ ]] && [ "$restored_digest" = "$source_digest" ] || \
    block "restored launcher release failed byte-for-byte verification."
  [ ! -e "$mount_source" ] && [ ! -L "$mount_source" ] || \
    block "launcher download destination appeared before activation."
  mv -- "$temporary" "$mount_source" || \
    block "verified launcher release could not be activated atomically."
  verify_launcher_tree "$mount_source" || \
    block "activated launcher release failed safety validation."
  [ "$(launcher_tree_digest "$mount_source")" = "$source_digest" ] || \
    block "activated launcher release failed final byte verification."
  launcher_restore_completed=1
  printf '[web-recovery] restored launcher_release=%s source_archive=%s\n' \
    "$release_name" "$candidate"
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

launcher_mount_template="{{range .Mounts}}{{if eq .Destination \"$LAUNCHER_MOUNT_DESTINATION\"}}{{.Type}}|{{.Source}}|{{.RW}}{{println}}{{end}}{{end}}"
mapfile -t launcher_mount_records < <(
  docker inspect --format "$launcher_mount_template" "$web_container_id"
)
[ "${#launcher_mount_records[@]}" -le 1 ] || \
  block "web container has duplicate launcher download mounts."
if [ "${#launcher_mount_records[@]}" -eq 1 ]; then
  restore_missing_launcher_mount "${launcher_mount_records[0]}"
fi

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
