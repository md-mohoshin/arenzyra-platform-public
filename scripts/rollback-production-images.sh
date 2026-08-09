#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_COMMAND_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_COMMAND_PATH"

PRODUCTION_ROOT="${ARENZYRA_PRODUCTION_ROOT:-/opt/arenzyra}"
EXPECTED_ROOT="/opt/arenzyra"
EXPECTED_RELEASE_ARCHIVE_ROOT="/opt/arenzyra-release-metadata"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
RELEASE_ARCHIVE_ROOT="${ARENZYRA_RELEASE_ARCHIVE_ROOT:-$EXPECTED_RELEASE_ARCHIVE_ROOT}"
LOCK_TIMEOUT_SECONDS="${ARENZYRA_DEPLOY_LOCK_TIMEOUT_SECONDS:-10}"
HEALTH_TIMEOUT_SECONDS="${ARENZYRA_DEPLOY_HEALTH_TIMEOUT_SECONDS:-240}"
RELEASE_ID=""
MODE="full"
pinned_override_path=""
pinned_override_digest=""
pinned_override_fd_open=0
pinned_override_validator_args=()

cleanup_runtime_files() {
  if [ "$pinned_override_fd_open" -eq 1 ]; then
    exec 9<&- 2>/dev/null || true
    pinned_override_fd_open=0
  fi
  if [ -n "$pinned_override_path" ]; then
    case "$pinned_override_path" in
      /run/arenzyra-pinned-compose.*) rm -f -- "$pinned_override_path" ;;
    esac
    pinned_override_path=""
  fi
}
trap cleanup_runtime_files EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release) RELEASE_ID="${2:-}"; shift ;;
    --discord-bot) MODE="discord-bot" ;;
    -h|--help)
      printf 'Usage: rollback-production-images.sh --release <immutable-release-id> --discord-bot\n'
      printf 'Full application image-only rollback is intentionally unsupported.\n'
      exit 0
      ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

if ! [[ "$RELEASE_ID" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  printf 'A valid --release ID is required.\n' >&2
  exit 2
fi
if [ "$MODE" != "discord-bot" ]; then
  printf 'ROLLBACK BLOCKED: full application image-only rollback has no database-schema compatibility proof.\n' >&2
  printf 'No image inspection, preflight, Compose, service, database, or release-pointer mutation was performed.\n' >&2
  printf 'Use a reviewed forward recovery or coordinated database-and-application restore; see infra/BACKUP_RESTORE.md.\n' >&2
  exit 75
fi
resolved_root="$(realpath -e -- "$PRODUCTION_ROOT" 2>/dev/null || true)"
if [ -z "$resolved_root" ] || [ "$resolved_root" != "$EXPECTED_ROOT" ]; then
  printf 'ROLLBACK BLOCKED: production root must be /opt/arenzyra.\n' >&2
  exit 75
fi
if [ "$RELEASE_ARCHIVE_ROOT" != "$EXPECTED_RELEASE_ARCHIVE_ROOT" ]; then
  printf 'ROLLBACK BLOCKED: release archive root is not reviewed.\n' >&2
  exit 75
fi
if [ "$(id -u)" -ne 0 ]; then
  printf 'ROLLBACK BLOCKED: production rollback must run as root.\n' >&2
  exit 75
fi
account_record="$(getent passwd 0 2>/dev/null || true)"
IFS=: read -r _ _ _ _ _ account_home _ <<<"$account_record"
safe_account_home="$(realpath -e -- "${account_home:-/root}" 2>/dev/null || true)"
ambient_account_home="$(realpath -e -- "${HOME:-$safe_account_home}" 2>/dev/null || true)"
if [ -z "$safe_account_home" ] || [ ! -d "$safe_account_home" ] || \
  [ "$ambient_account_home" != "$safe_account_home" ]; then
  printf 'ROLLBACK BLOCKED: HOME does not match the root account.\n' >&2
  exit 75
fi
if ! [[ "$LOCK_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [ "$LOCK_TIMEOUT_SECONDS" -gt 300 ]; then
  printf 'ROLLBACK BLOCKED: lock timeout must be 0-300.\n' >&2
  exit 75
fi
if ! [[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || \
  [ "$HEALTH_TIMEOUT_SECONDS" -lt 30 ] || \
  [ "$HEALTH_TIMEOUT_SECONDS" -gt 1800 ]; then
  printf 'ROLLBACK BLOCKED: health timeout must be 30-1800.\n' >&2
  exit 75
fi
cd "$resolved_root"
# Rollback uses the current reviewed Root wrapper but never builds API/Web. The
# target Discord image remains independently bound to archived release evidence.
# Require that current wrapper checkout before sourcing any repository code.
if [ ! -x /usr/bin/env ] || [ ! -x /usr/bin/git ]; then
  printf 'ROLLBACK BLOCKED: reviewed system env/git tools are unavailable.\n' >&2
  exit 75
fi
reviewed_root_commit="${ARENZYRA_REVIEWED_ROOT_COMMIT:-}"
if ! [[ "$reviewed_root_commit" =~ ^[0-9a-f]{40}$ ]] || \
  [ -L "$resolved_root/.git" ] || [ ! -d "$resolved_root/.git" ]; then
  printf 'ROLLBACK BLOCKED: reviewed current Root commit/worktree is invalid.\n' >&2
  exit 75
fi
bootstrap_git=(
  /usr/bin/env -i
  "PATH=$SAFE_COMMAND_PATH"
  "HOME=$safe_account_home"
  "LC_ALL=C"
  "GIT_OPTIONAL_LOCKS=0"
  "GIT_NO_REPLACE_OBJECTS=1"
  "GIT_CONFIG_NOSYSTEM=1"
  "GIT_CONFIG_GLOBAL=/dev/null"
  /usr/bin/git
  -c core.fsmonitor=false
  -c core.hooksPath=/dev/null
)
root_top="$("${bootstrap_git[@]}" -C "$resolved_root" rev-parse --show-toplevel 2>/dev/null || true)"
root_head="$("${bootstrap_git[@]}" -C "$resolved_root" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
root_replace_refs="$("${bootstrap_git[@]}" -C "$resolved_root" \
  for-each-ref --format='%(refname)' refs/replace 2>/dev/null || true)"
root_status="$("${bootstrap_git[@]}" -C "$resolved_root" status \
  --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>/dev/null || printf '__git_failed__')"
if [ "$root_top" != "$resolved_root" ] || \
  [ "$root_head" != "$reviewed_root_commit" ] || \
  [ -n "$root_replace_refs" ] || [ -n "$root_status" ] || \
  [ -e "$resolved_root/.git/info/grafts" ] || \
  [ -L "$resolved_root/.git/info/grafts" ] || \
  [ -e "$resolved_root/.git/objects/info/alternates" ] || \
  [ -L "$resolved_root/.git/objects/info/alternates" ] || \
  [ -e "$resolved_root/.git/objects/info/http-alternates" ] || \
  [ -L "$resolved_root/.git/objects/info/http-alternates" ]; then
  printf 'ROLLBACK BLOCKED: current Root wrapper checkout is not the exact clean reviewed commit.\n' >&2
  exit 75
fi
unset bootstrap_git root_top root_head root_replace_refs root_status reviewed_root_commit

source scripts/require-local-production-docker.sh
sanitized_environment=(
  env -i
  "PATH=$SAFE_COMMAND_PATH"
  "HOME=$safe_account_home"
)
test -f scripts/verify-production-release-source.cjs
"${sanitized_environment[@]}" \
  node scripts/verify-production-release-source.cjs --check-checkout-only
reviewed_env_file="$resolved_root/infra/.env.publish"
test -f "$reviewed_env_file"
test -f scripts/validate-publish-release-env.cjs
test -f scripts/validate-release-image-manifest.cjs
test -f scripts/production-pinned-image-override.cjs
if [ -n "${ARENZYRA_DEPLOY_ENV_FILE:-}" ]; then
  process_env_file="$(realpath -e -- "$ARENZYRA_DEPLOY_ENV_FILE" 2>/dev/null || true)"
  if [ "$process_env_file" != "$reviewed_env_file" ]; then
    printf 'ROLLBACK BLOCKED: process environment file differs from reviewed infra/.env.publish.\n' >&2
    exit 75
  fi
fi
export ARENZYRA_DEPLOY_ENV_FILE="$reviewed_env_file"

verify_release_archive_root() {
  local archive_parent_mode
  if [ -L /opt ] || [ ! -d /opt ] || \
    [ "$(realpath -e -- /opt 2>/dev/null || true)" != "/opt" ] || \
    [ "$(stat -c '%u:%g' -- /opt 2>/dev/null || true)" != "0:0" ]; then
    printf 'ROLLBACK BLOCKED: release archive parent is not reviewed.\n' >&2
    return 75
  fi
  archive_parent_mode="$(stat -c %a -- /opt)"
  if ! [[ "$archive_parent_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$archive_parent_mode & 8#022) != 0 )); then
    printf 'ROLLBACK BLOCKED: release archive parent mode is unsafe.\n' >&2
    return 75
  fi
  if [ -L "$RELEASE_ARCHIVE_ROOT" ] || [ ! -d "$RELEASE_ARCHIVE_ROOT" ] || \
    [ "$(realpath -e -- "$RELEASE_ARCHIVE_ROOT" 2>/dev/null || true)" != "$EXPECTED_RELEASE_ARCHIVE_ROOT" ] || \
    [ "$(stat -c '%u:%g:%a' -- "$RELEASE_ARCHIVE_ROOT" 2>/dev/null || true)" != "0:0:700" ]; then
    printf 'ROLLBACK BLOCKED: release archive identity, owner, or mode is not reviewed.\n' >&2
    return 75
  fi
}

verify_archived_release_file() {
  local archived_file="$1"
  local expected_release="$2"
  verify_release_archive_root || return $?
  if [ -L "$archived_file" ] || [ ! -f "$archived_file" ] || \
    [ "$(dirname -- "$(realpath -e -- "$archived_file" 2>/dev/null || true)")" != "$RELEASE_ARCHIVE_ROOT" ] || \
    [ "$(basename -- "$archived_file")" != "$expected_release.env" ] || \
    [ "$(stat -c '%u:%g:%a:%h' -- "$archived_file" 2>/dev/null || true)" != "0:0:600:1" ]; then
    printf 'ROLLBACK BLOCKED: archived release file is not reviewed.\n' >&2
    return 75
  fi
  "${sanitized_environment[@]}" \
    node scripts/validate-publish-release-env.cjs \
      --file "$archived_file" --expected-release "$expected_release" >/dev/null
}

verify_archived_discord_image_manifest() {
  local manifest_file="$1"
  local release_environment="$2"
  local expected_release="$3"
  local expected_manifest="$RELEASE_ARCHIVE_ROOT/$expected_release.discord-bot-image.json"
  verify_release_archive_root || return $?
  if [ "$release_environment" != "$RELEASE_ARCHIVE_ROOT/$expected_release.env" ] || \
    [ "$manifest_file" != "$expected_manifest" ] || \
    [ -L "$manifest_file" ] || [ ! -f "$manifest_file" ] || \
    [ "$(dirname -- "$(realpath -e -- "$manifest_file" 2>/dev/null || true)")" != "$RELEASE_ARCHIVE_ROOT" ] || \
    [ "$(basename -- "$manifest_file")" != "$expected_release.discord-bot-image.json" ] || \
    [ "$(stat -c '%u:%g:%a:%h' -- "$manifest_file" 2>/dev/null || true)" != "0:0:600:1" ]; then
    printf 'ROLLBACK BLOCKED: archived Discord image manifest is not reviewed.\n' >&2
    return 75
  fi
  verify_archived_release_file "$release_environment" "$expected_release" || return $?
  "${sanitized_environment[@]}" \
    node scripts/validate-release-image-manifest.cjs \
      --file "$manifest_file" \
      --release-env "$release_environment" \
      --expected-release "$expected_release" \
      --service discord-bot \
      --print-image-id
}

read_release_pointer() {
  local pointer_name="$1"
  local pointer_file="$RELEASE_ARCHIVE_ROOT/$pointer_name"
  local -a pointer_lines
  verify_release_archive_root || return $?
  if [ -L "$pointer_file" ] || [ ! -f "$pointer_file" ] || \
    [ "$(stat -c '%u:%g:%a:%h' -- "$pointer_file" 2>/dev/null || true)" != "0:0:600:1" ]; then
    printf 'ROLLBACK BLOCKED: release pointer is not reviewed.\n' >&2
    return 75
  fi
  mapfile -t pointer_lines < "$pointer_file"
  if [ "${#pointer_lines[@]}" -ne 1 ] || \
    ! [[ "${pointer_lines[0]}" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]]; then
    printf 'ROLLBACK BLOCKED: release pointer content is invalid.\n' >&2
    return 75
  fi
  verify_archived_release_file \
    "$RELEASE_ARCHIVE_ROOT/${pointer_lines[0]}.env" "${pointer_lines[0]}"
  printf '%s\n' "${pointer_lines[0]}"
}

write_release_pointer() {
  local pointer_name="$1"
  local release_id="$2"
  local temporary_pointer
  [[ "$pointer_name" =~ ^(CURRENT|PREVIOUS)$ ]] || return 75
  verify_release_archive_root || return $?
  verify_archived_release_file "$RELEASE_ARCHIVE_ROOT/$release_id.env" "$release_id"
  temporary_pointer="$(mktemp -- "$RELEASE_ARCHIVE_ROOT/.${pointer_name}.XXXXXX")"
  printf '%s\n' "$release_id" > "$temporary_pointer"
  chmod 600 -- "$temporary_pointer"
  chown root:root -- "$temporary_pointer"
  mv -T -- "$temporary_pointer" "$RELEASE_ARCHIVE_ROOT/$pointer_name"
}

verify_lock_directory_safety() {
  local lock_directory lock_directory_mode lock_directory_owner resolved_lock_directory
  lock_directory="$(dirname -- "$LOCK_FILE")"
  if [ -L "$lock_directory" ] || [ ! -d "$lock_directory" ]; then
    printf 'ROLLBACK BLOCKED: production deployment lock directory is unsafe.\n' >&2
    return 75
  fi
  resolved_lock_directory="$(realpath -e -- "$lock_directory" 2>/dev/null || true)"
  lock_directory_owner="$(stat -c %u -- "$lock_directory")"
  lock_directory_mode="$(stat -c %a -- "$lock_directory")"
  if [ "$resolved_lock_directory" != "/run" ] || \
    [ "$lock_directory_owner" != "0" ] || \
    ! [[ "$lock_directory_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$lock_directory_mode & 8#022) != 0 )); then
    printf 'ROLLBACK BLOCKED: production deployment lock directory ownership or mode is unsafe.\n' >&2
    return 75
  fi
}

verify_lock_file_safety() {
  local descriptor_identity lock_identity lock_mode lock_owner lock_target
  if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ]; then
    printf 'ROLLBACK BLOCKED: production deployment lock path is not a regular non-symlink file.\n' >&2
    return 75
  fi
  lock_target="$(readlink -f "/proc/$$/fd/8" 2>/dev/null || true)"
  lock_owner="$(stat -Lc %u -- "/proc/$$/fd/8")"
  lock_mode="$(stat -Lc %a -- "/proc/$$/fd/8")"
  lock_identity="$(stat -Lc '%d:%i:%h' -- "$LOCK_FILE")"
  descriptor_identity="$(stat -Lc '%d:%i:%h' -- "/proc/$$/fd/8")"
  if [ "$lock_target" != "$LOCK_FILE" ] || \
    [ "$lock_owner" != "0" ] || \
    ! [[ "$lock_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$lock_mode & 8#022) != 0 )) || \
    [ "$lock_identity" != "$descriptor_identity" ] || \
    [ "${lock_identity##*:}" != "1" ]; then
    printf 'ROLLBACK BLOCKED: production deployment lock file ownership, mode, or identity is unsafe.\n' >&2
    return 75
  fi
}

verify_lock_directory_safety
if [ -e "$LOCK_FILE" ] || [ -L "$LOCK_FILE" ]; then
  if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ] || \
    [ "$(stat -c '%u:%h' -- "$LOCK_FILE" 2>/dev/null || true)" != "0:1" ]; then
    printf 'ROLLBACK BLOCKED: production deployment lock path identity or ownership is unsafe.\n' >&2
    exit 75
  fi
  existing_lock_mode="$(stat -c %a -- "$LOCK_FILE")"
  if ! [[ "$existing_lock_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$existing_lock_mode & 8#022) != 0 )); then
    printf 'ROLLBACK BLOCKED: production deployment lock path mode is unsafe.\n' >&2
    exit 75
  fi
fi
exec 8>"$LOCK_FILE"
verify_lock_file_safety
flock -w "$LOCK_TIMEOUT_SECONDS" 8 || {
  printf 'Another production deployment holds the deployment lock.\n' >&2
  exit 75
}
verify_lock_file_safety

verify_release_archive_root
release_env="$RELEASE_ARCHIVE_ROOT/$RELEASE_ID.env"
verify_archived_release_file "$release_env" "$RELEASE_ID"
current=""
if [ -e "$RELEASE_ARCHIVE_ROOT/CURRENT" ] || [ -L "$RELEASE_ARCHIVE_ROOT/CURRENT" ]; then
  current="$(read_release_pointer CURRENT)"
fi
reviewed_compose_project="$(
  "${sanitized_environment[@]}" \
    node scripts/read-dotenv-value.cjs \
      infra/.env.publish ARENZYRA_DEPLOY_COMPOSE_PROJECT
)"
compose_project="${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-$reviewed_compose_project}"
if [ "$compose_project" != "$reviewed_compose_project" ]; then
  printf 'Process Compose project differs from the reviewed production environment.\n' >&2
  exit 2
fi
if ! [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  printf 'Invalid production Compose project.\n' >&2
  exit 2
fi
export ARENZYRA_DEPLOY_COMPOSE_PROJECT="$compose_project"

discord_image_manifest="$RELEASE_ARCHIVE_ROOT/$RELEASE_ID.discord-bot-image.json"
if ! expected_discord_image_id="$(
  verify_archived_discord_image_manifest \
    "$discord_image_manifest" "$release_env" "$RELEASE_ID"
)"; then
  printf 'ROLLBACK BLOCKED: archived Discord image manifest validation failed.\n' >&2
  exit 75
fi
if ! [[ "$expected_discord_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  printf 'ROLLBACK BLOCKED: archived Discord image ID is invalid.\n' >&2
  exit 75
fi

node scripts/preflight-publish.cjs --env infra/.env.publish
compose=(
  "${sanitized_environment[@]}"
  "DOCKER_HOST=$DOCKER_HOST"
  docker compose
  -p "$compose_project"
  --env-file infra/.env.publish
  --env-file "$release_env"
  -f infra/docker-compose.publish.yml
)

attest_pinned_compose_override() {
  local current_digest descriptor_identity descriptor_target path_identity
  if [ "$pinned_override_fd_open" -ne 1 ] || \
    [ -z "$pinned_override_path" ] || \
    [ -z "$pinned_override_digest" ] || \
    [ -L "$pinned_override_path" ] || [ ! -f "$pinned_override_path" ] || \
    [ "$(dirname -- "$(realpath -e -- "$pinned_override_path" 2>/dev/null || true)")" != "/run" ] || \
    [ "$(stat -c '%u:%g:%a:%h' -- "$pinned_override_path" 2>/dev/null || true)" != "0:0:600:1" ]; then
    printf 'ROLLBACK BLOCKED: pinned Compose override path, owner, mode, or link count is unsafe.\n' >&2
    return 75
  fi
  case "$pinned_override_path" in
    "/run/arenzyra-pinned-compose.$RELEASE_ID.discord-bot."*) ;;
    *)
      printf 'ROLLBACK BLOCKED: pinned Compose override path is not bound to this release.\n' >&2
      return 75
      ;;
  esac
  descriptor_target="$(readlink -f "/proc/$$/fd/9" 2>/dev/null || true)"
  path_identity="$(stat -Lc '%d:%i:%h' -- "$pinned_override_path" 2>/dev/null || true)"
  descriptor_identity="$(stat -Lc '%d:%i:%h' -- "/proc/$$/fd/9" 2>/dev/null || true)"
  if [ "$descriptor_target" != "$pinned_override_path" ] || \
    [ "$path_identity" != "$descriptor_identity" ] || \
    [ "${descriptor_identity##*:}" != "1" ]; then
    printf 'ROLLBACK BLOCKED: pinned Compose override descriptor identity is unsafe.\n' >&2
    return 75
  fi
  current_digest="$(
    "${sanitized_environment[@]}" \
      node scripts/production-pinned-image-override.cjs \
        "${pinned_override_validator_args[@]}" \
        --validate-stdin --print-sha256 < "/proc/$$/fd/9"
  )"
  if ! [[ "$current_digest" =~ ^[a-f0-9]{64}$ ]] || \
    [ "$current_digest" != "$pinned_override_digest" ] || \
    [ "$(stat -Lc '%d:%i:%h' -- "$pinned_override_path" 2>/dev/null || true)" != "$descriptor_identity" ]; then
    printf 'ROLLBACK BLOCKED: pinned Compose override content or identity changed.\n' >&2
    return 75
  fi
}

create_pinned_discord_override() {
  pinned_override_validator_args=(
    --mode discord-bot
    --discord-bot-image-id "$expected_discord_image_id"
  )
  pinned_override_path="$(
    mktemp -- "/run/arenzyra-pinned-compose.$RELEASE_ID.discord-bot.XXXXXX"
  )"
  case "$pinned_override_path" in
    "/run/arenzyra-pinned-compose.$RELEASE_ID.discord-bot."*) ;;
    *)
      printf 'ROLLBACK BLOCKED: pinned Compose override escaped /run.\n' >&2
      return 75
      ;;
  esac
  if ! "${sanitized_environment[@]}" \
    node scripts/production-pinned-image-override.cjs \
      "${pinned_override_validator_args[@]}" --create > "$pinned_override_path" || \
    ! chmod 600 -- "$pinned_override_path" || \
    ! chown root:root -- "$pinned_override_path"; then
    printf 'ROLLBACK BLOCKED: unable to create the pinned Compose override.\n' >&2
    return 75
  fi
  pinned_override_digest="$(
    "${sanitized_environment[@]}" \
      node scripts/production-pinned-image-override.cjs \
        "${pinned_override_validator_args[@]}" \
        --validate-stdin --print-sha256 < "$pinned_override_path"
  )"
  if ! [[ "$pinned_override_digest" =~ ^[a-f0-9]{64}$ ]]; then
    printf 'ROLLBACK BLOCKED: pinned Compose override digest is invalid.\n' >&2
    return 75
  fi
  exec 9<"$pinned_override_path"
  pinned_override_fd_open=1
  attest_pinned_compose_override
  compose+=( -f "/proc/$$/fd/9" )
}

"${compose[@]}" --profile discord-bot config --format json |
  "${sanitized_environment[@]}" \
    node scripts/validate-publish-release-env.cjs \
      --file "$release_env" \
      --expected-release "$RELEASE_ID" \
      --assert-discord-compose-json >/dev/null

expected_discord_source_digest="$(
  "${sanitized_environment[@]}" \
    node scripts/read-dotenv-value.cjs "$release_env" ARENZYRA_SOURCE_DIGEST
)"
expected_discord_git_commit="$(
  "${sanitized_environment[@]}" \
    node scripts/read-dotenv-value.cjs "$release_env" ARENZYRA_GIT_COMMIT
)"
expected_discord_build_at="$(
  "${sanitized_environment[@]}" \
    node scripts/read-dotenv-value.cjs "$release_env" ARENZYRA_BUILD_AT
)"
expected_discord_build_source="$(
  "${sanitized_environment[@]}" \
    node scripts/read-dotenv-value.cjs "$release_env" ARENZYRA_BUILD_SOURCE
)"

if ! discord_image_identity="$(
  docker image inspect \
    --format '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "com.arenzyra.source-digest"}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "org.opencontainers.image.created"}}|{{index .Config.Labels "com.arenzyra.release-source"}}|arenzyra-image-identity-v1' \
    "$expected_discord_image_id"
)"; then
  printf 'ROLLBACK BLOCKED: requested Discord bot image is unavailable.\n' >&2
  exit 75
fi
IFS='|' read -r \
  preflight_discord_image_id \
  discord_image_release_id \
  discord_image_source_digest \
  discord_image_git_commit \
  discord_image_build_at \
  discord_image_build_source \
  discord_image_identity_sentinel \
  discord_image_identity_extra <<<"$discord_image_identity"
if ! [[ "$preflight_discord_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || \
  [ "$preflight_discord_image_id" != "$expected_discord_image_id" ] || \
  [ "$discord_image_release_id" != "$RELEASE_ID" ] || \
  [ "$discord_image_source_digest" != "$expected_discord_source_digest" ] || \
  [ "$discord_image_git_commit" != "$expected_discord_git_commit" ] || \
  [ "$discord_image_build_at" != "$expected_discord_build_at" ] || \
  [ "$discord_image_build_source" != "$expected_discord_build_source" ] || \
  [ "$discord_image_identity_sentinel" != "arenzyra-image-identity-v1" ] || \
  [ -n "${discord_image_identity_extra:-}" ]; then
  printf 'ROLLBACK BLOCKED: Discord bot image identity differs from the archived release.\n' >&2
  exit 75
fi
create_pinned_discord_override

verify_running_discord_image() {
  local container_id running_image_id
  attest_pinned_compose_override
  container_id="$("${compose[@]}" --profile discord-bot ps -q discord-bot)"
  if ! [[ "$container_id" =~ ^[a-f0-9]{12,64}$ ]]; then
    printf 'ROLLBACK BLOCKED: Discord bot container identity is missing or ambiguous after startup.\n' >&2
    return 75
  fi
  if ! running_image_id="$(docker inspect --format '{{.Image}}' "$container_id")"; then
    printf 'ROLLBACK BLOCKED: Discord bot container image cannot be inspected.\n' >&2
    return 75
  fi
  if [ "$running_image_id" != "$expected_discord_image_id" ]; then
    printf 'ROLLBACK BLOCKED: Discord bot container did not start the inspected image.\n' >&2
    return 75
  fi
}

bash scripts/production-deploy-preflight.sh
attest_pinned_compose_override
"${compose[@]}" --profile discord-bot up --no-build -d --pull never --no-deps discord-bot
verify_running_discord_image
services=(discord-bot)

deadline=$((SECONDS + 10#$HEALTH_TIMEOUT_SECONDS))
while true; do
  pending=()
  for service in "${services[@]}"; do
    container_id="$("${compose[@]}" --profile discord-bot ps -q "$service")"
    if [ -z "$container_id" ]; then
      pending+=("${service}:missing")
      continue
    fi
    state="$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' "$container_id")"
    IFS='|' read -r status health <<<"$state"
    if [ "$status" != "running" ] || [ "$health" != "healthy" ]; then
      pending+=("${service}:${status}/${health}")
    fi
  done
  [ "${#pending[@]}" -eq 0 ] && break
  if [ "$SECONDS" -ge "$deadline" ]; then
    printf 'Rollback health convergence failed: %s\n' "${pending[*]}" >&2
    exit 1
  fi
  sleep 5
done

verify_running_discord_image
node scripts/verify-publish.cjs --env infra/.env.publish
if [[ "$current" =~ ^[a-zA-Z0-9._-]+$ ]] && [ "$current" != "$RELEASE_ID" ]; then
  write_release_pointer PREVIOUS "$current"
fi
write_release_pointer CURRENT "$RELEASE_ID"

printf 'DISCORD BOT IMAGE ROLLBACK VERIFIED release=%s mode=%s\n' "$RELEASE_ID" "$MODE"
