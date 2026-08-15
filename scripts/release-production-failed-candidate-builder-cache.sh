#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
EXPECTED_ROOT="/opt/arenzyra"
RELEASE_ROOT="/opt/arenzyra-release-metadata"
PUBLISH_ENV="$EXPECTED_ROOT/infra/.env.publish"
MIN_FREE_KIB=$((30 * 1024 * 1024))

# This is a one-time, immutable failed-candidate envelope. It is intentionally
# not parameterized so it cannot become a general production cache command.
FAILED_CANDIDATE_RELEASE="git-20260815-113203955-8da6acb623a6"
FAILED_CANDIDATE_ROOT="38ef097f5a542fa9685cd867001e337a884c3d0f"
EXPECTED_PREVIOUS_ROOT="1f50dd5b8b40cc6e32afff5df04d9f51d174f43e"
EXPECTED_CURRENT_RELEASE="git-20260814-192205642-e04672c95be2"
EXPECTED_CURRENT_API="88efdad94d65c09c6d3bd73e4b874db915629859"
EXPECTED_CURRENT_WEB="3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4"
EXPECTED_RUNTIME_API_IMAGE="sha256:518ce5d035c9f6ebbd100ff570981cffa822484fa1971ec8649f808134095d9c"
EXPECTED_RUNTIME_MEDIA_IMAGE="sha256:9863f4cfa9defef7cfe7caf018c83bc277712df3c41fcc8baead1af2cbc0ec5f"
EXPECTED_RUNTIME_WEB_IMAGE="sha256:23cfef8c359a60379d18d6736d2067c7c2a9a2bc82e08e1c37a6e53ac4745923"
EXPECTED_RUNTIME_DISCORD_IMAGE="sha256:e2db68104d3cf5a4f3ce543853b81725135b14a0f40f0246179b8e59bc88b0df"

mutation_attempted=0

block() {
  printf 'FAILED-CANDIDATE BUILDER CACHE RELEASE BLOCKED: %s\n' "$1" >&2
  if [ "$mutation_attempted" -eq 0 ]; then
    printf 'No builder-cache mutation was attempted.\n' >&2
  else
    printf 'The one reviewed builder-cache prune was attempted; no further mutation was attempted.\n' >&2
  fi
  exit 75
}

[ "$#" -eq 0 ] || block "no arguments are accepted."
[ "$(id -u)" -eq 0 ] || block "UID 0 is required."
cd "$EXPECTED_ROOT" 2>/dev/null || block "the production root is unavailable."
[ "$(pwd -P)" = "$EXPECTED_ROOT" ] || block "the production root is not exact."
[ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = "1" ] || \
  block "the shared deployment lock was not inherited."

source scripts/acquire-production-deploy-lock.sh || \
  block "the shared deployment lock could not be verified."
production_verify_lock_descriptor || block "the shared deployment lock is not verified."
source scripts/require-local-production-docker.sh || \
  block "the production Docker target is not reviewed."

for required_command in awk cmp df dirname docker flock id node realpath sha256sum stat; do
  command -v "$required_command" >/dev/null 2>&1 || \
    block "required command is unavailable: $required_command."
done

sanitized=(/usr/bin/env -i "PATH=$SAFE_PATH" HOME=/root LC_ALL=C)
reviewed_git=(
  /usr/bin/env -i
  "PATH=$SAFE_PATH"
  HOME=/root
  LC_ALL=C
  GIT_OPTIONAL_LOCKS=0
  GIT_NO_REPLACE_OBJECTS=1
  GIT_CONFIG_NOSYSTEM=1
  GIT_CONFIG_GLOBAL=/dev/null
  /usr/bin/git
  -c core.fsmonitor=false
  -c core.hooksPath=/dev/null
)

verify_repository() {
  local label="$1" repository="$2" expected="$3"
  local head mode path_identity replacements status top tree
  [[ "$expected" =~ ^[0-9a-f]{40}$ ]] || block "$label reviewed commit is invalid."
  [ -d "$repository" ] && [ ! -L "$repository" ] && \
    [ -d "$repository/.git" ] && [ ! -L "$repository/.git" ] || \
    block "$label is not a standalone Git worktree."
  [ "$(stat -c %u -- "$repository" 2>/dev/null || true)" = "0" ] || \
    block "$label source is not root-owned."
  mode="$(stat -c %a -- "$repository" 2>/dev/null || true)"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 )) || \
    block "$label source mode is unsafe."
  [ ! -e "$repository/.git/info/grafts" ] && \
    [ ! -L "$repository/.git/info/grafts" ] && \
    [ ! -e "$repository/.git/objects/info/alternates" ] && \
    [ ! -L "$repository/.git/objects/info/alternates" ] && \
    [ ! -e "$repository/.git/objects/info/http-alternates" ] && \
    [ ! -L "$repository/.git/objects/info/http-alternates" ] || \
    block "$label Git object substitution metadata exists."
  if ! top="$("${reviewed_git[@]}" -C "$repository" rev-parse --show-toplevel 2>/dev/null)" || \
    ! head="$("${reviewed_git[@]}" -C "$repository" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || \
    ! tree="$("${reviewed_git[@]}" -C "$repository" rev-parse --verify 'HEAD^{tree}' 2>/dev/null)"; then
    block "$label Git identity could not be read."
  fi
  replacements="$("${reviewed_git[@]}" -C "$repository" \
    for-each-ref --format='%(refname)' refs/replace 2>/dev/null || printf '__git_failed__')"
  status="$("${reviewed_git[@]}" -C "$repository" status \
    --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>/dev/null || \
    printf '__git_failed__')"
  [ "$top" = "$repository" ] && [ "$head" = "$expected" ] && \
    [[ "$tree" =~ ^[0-9a-f]{40}$ ]] && [ -z "$replacements" ] && \
    [ -z "$status" ] || block "$label is not the exact clean reviewed commit."
  if ! path_identity="$(stat -c '%d:%i:%u:%g:%a' -- "$repository")"; then
    block "$label source identity could not be captured."
  fi
  [[ "$path_identity" =~ ^[0-9]+:[0-9]+:0:0:[0-7]{3,4}$ ]] || \
    block "$label source fingerprint is invalid."
  printf '%s|head=%s|tree=%s|path=%s\n' \
    "$label" "$head" "$tree" "$path_identity"
}

assembly_snapshot() {
  local root_commit="${ARENZYRA_REVIEWED_ROOT_COMMIT:-}"
  local api_commit="${ARENZYRA_REVIEWED_API_COMMIT:-}"
  local web_commit="${ARENZYRA_REVIEWED_WEB_COMMIT:-}"
  local root_parent
  [[ "$root_commit" =~ ^[0-9a-f]{40}$ ]] || block "the reviewed Root commit is missing."
  [ "$api_commit" = "$EXPECTED_CURRENT_API" ] || block "the reviewed API commit is not exact."
  [ "$web_commit" = "$EXPECTED_CURRENT_WEB" ] || block "the reviewed Web commit is not exact."
  [ "$root_commit" != "$EXPECTED_PREVIOUS_ROOT" ] || \
    block "the one-time successor Root commit is not active."
  if ! root_parent="$("${reviewed_git[@]}" -C "$EXPECTED_ROOT" \
    rev-parse --verify 'HEAD^1^{commit}' 2>/dev/null)"; then
    block "the active Root parent could not be read."
  fi
  [ "$root_parent" = "$EXPECTED_PREVIOUS_ROOT" ] || \
    block "the active Root is not the direct reviewed successor of the mixed-runtime fix source."
  verify_repository ROOT "$EXPECTED_ROOT" "$root_commit"
  verify_repository API "$EXPECTED_ROOT/apps/api" "$api_commit"
  verify_repository WEB "$EXPECTED_ROOT/apps/arenzyra-web" "$web_commit"
}

verify_archive_root() {
  local opt_mode
  [ -d /opt ] && [ ! -L /opt ] && \
    [ "$(realpath -e -- /opt 2>/dev/null || true)" = "/opt" ] && \
    [ "$(stat -c '%u:%g' -- /opt 2>/dev/null || true)" = "0:0" ] || \
    block "the release archive parent is unsafe."
  opt_mode="$(stat -c %a -- /opt 2>/dev/null || true)"
  [[ "$opt_mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$opt_mode & 8#022) == 0 )) || \
    block "the release archive parent mode is unsafe."
  [ -d "$RELEASE_ROOT" ] && [ ! -L "$RELEASE_ROOT" ] && \
    [ "$(realpath -e -- "$RELEASE_ROOT" 2>/dev/null || true)" = "$RELEASE_ROOT" ] && \
    [ "$(stat -c '%u:%g:%a' -- "$RELEASE_ROOT" 2>/dev/null || true)" = "0:0:700" ] || \
    block "the release archive root is unsafe."
}

verify_archive_file() {
  local file="$1" basename="$2"
  verify_archive_root
  [ -f "$file" ] && [ ! -L "$file" ] && \
    [ "$(dirname -- "$(realpath -e -- "$file" 2>/dev/null || true)")" = "$RELEASE_ROOT" ] && \
    [ "$(basename -- "$file")" = "$basename" ] && \
    [ "$(stat -c '%u:%g:%a:%h' -- "$file" 2>/dev/null || true)" = "0:0:600:1" ] || \
    block "archived file identity is unsafe: $basename."
}

read_release_value() {
  "${sanitized[@]}" node scripts/read-dotenv-value.cjs "$1" "$2"
}

verify_release_environment() {
  local release_id="$1" expected_root="${2:-}" expected_api="${3:-}" expected_web="${4:-}"
  local release_env="$RELEASE_ROOT/$release_id.env"
  verify_archive_file "$release_env" "$release_id.env"
  "${sanitized[@]}" node scripts/validate-publish-release-env.cjs \
    --file "$release_env" --expected-release "$release_id" >/dev/null || \
    block "release metadata is invalid: $release_id."
  if [ -n "$expected_root" ]; then
    local git_commit root_commit api_commit web_commit
    if ! git_commit="$(read_release_value "$release_env" ARENZYRA_GIT_COMMIT)" || \
      ! root_commit="$(read_release_value "$release_env" ARENZYRA_ROOT_GIT_COMMIT)" || \
      ! api_commit="$(read_release_value "$release_env" ARENZYRA_API_GIT_COMMIT)" || \
      ! web_commit="$(read_release_value "$release_env" ARENZYRA_WEB_GIT_COMMIT)"; then
      block "failed-candidate provenance could not be read."
    fi
    [ "$git_commit" = "${expected_root:0:12}" ] && \
      [ "$root_commit" = "${expected_root:0:12}" ] && \
      [ "$api_commit" = "${expected_api:0:12}" ] && \
      [ "$web_commit" = "${expected_web:0:12}" ] || \
      block "failed-candidate Root/API/Web provenance is not exact."
  fi
  printf '%s' "$release_env"
}

verify_image_manifest() {
  local release_id="$1" release_env="$2" service="$3"
  local image_id inspected_id manifest manifest_hash manifest_identity
  manifest="$RELEASE_ROOT/$release_id.${service}-image.json"
  verify_archive_file "$manifest" "$release_id.${service}-image.json"
  if ! image_id="$("${sanitized[@]}" node scripts/validate-release-image-manifest.cjs \
    --file "$manifest" --release-env "$release_env" \
    --expected-release "$release_id" --service "$service" --print-image-id 2>/dev/null)"; then
    block "archived $service image manifest could not be read for $release_id."
  fi
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || \
    block "archived $service image manifest is invalid for $release_id."
  if ! inspected_id="$(docker image inspect --format '{{.Id}}' "$image_id" 2>/dev/null)"; then
    block "$service image inspection failed for $release_id."
  fi
  [ "$inspected_id" = "$image_id" ] || \
    block "$service image ID is absent for $release_id."
  if ! docker image inspect "$image_id" 2>/dev/null | \
    "${sanitized[@]}" node scripts/validate-release-image-manifest.cjs \
      --from-docker-inspect --release-env "$release_env" \
      --expected-release "$release_id" --service "$service" | \
    cmp -s - "$manifest"; then
    block "$service image inspection differs from its immutable manifest for $release_id."
  fi
  if ! manifest_hash="$(sha256sum -- "$manifest" | awk '{print $1}')" || \
    ! manifest_identity="$(stat -c '%d:%i:%u:%g:%a:%h:%s:%Y' -- "$manifest")"; then
    block "$service manifest fingerprint could not be captured."
  fi
  [[ "$manifest_hash" =~ ^[0-9a-f]{64}$ ]] && \
    [[ "$manifest_identity" =~ ^[0-9]+:[0-9]+:0:0:600:1:[1-9][0-9]*:[0-9]+$ ]] || \
    block "$service manifest fingerprint is invalid."
  LAST_IMAGE_ID="$image_id"
  LAST_MANIFEST_HASH="$manifest_hash"
  LAST_MANIFEST_IDENTITY="$manifest_identity"
}

verify_production_environment() {
  [ -f "$PUBLISH_ENV" ] && [ ! -L "$PUBLISH_ENV" ] && \
    [ "$(realpath -e -- "$PUBLISH_ENV" 2>/dev/null || true)" = "$PUBLISH_ENV" ] && \
    [ "$(stat -c '%u:%g:%a:%h' -- "$PUBLISH_ENV" 2>/dev/null || true)" = "0:0:600:1" ] || \
    block "the production environment identity is unsafe."
  "${sanitized[@]}" node scripts/preflight-publish.cjs \
    --env "$PUBLISH_ENV" --skip-compose >/dev/null || \
    block "the production environment policy is invalid."
}

capture_runtime() {
  local compose_project="$1"
  local container_id container_output row runtime_rows="" runtime_fingerprint
  local -a container_ids=()
  if ! container_output="$(docker ps -aq --no-trunc \
    --filter "label=com.docker.compose.project=${compose_project}" 2>/dev/null)"; then
    block "the production Compose container enumeration failed."
  fi
  while IFS= read -r container_id; do
    [ -n "$container_id" ] && container_ids+=("$container_id")
  done <<<"$container_output"
  [ "${#container_ids[@]}" -eq 7 ] || \
    block "the production Compose project does not contain exactly seven containers."
  for container_id in "${container_ids[@]}"; do
    [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || block "runtime container identity is invalid."
    if ! row="$(docker inspect --format \
      '{{.Id}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.oneoff"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}|{{.State.Restarting}}|{{.RestartCount}}|{{.HostConfig.RestartPolicy.Name}}|{{if index .Config.Labels "com.arenzyra.release-id"}}{{index .Config.Labels "com.arenzyra.release-id"}}{{end}}' \
      "$container_id" 2>/dev/null)"; then
      block "runtime container inspection failed."
    fi
    [ -n "$row" ] || block "runtime inventory changed during inspection."
    runtime_rows+="$row"$'\n'
  done
  if ! runtime_fingerprint="$(printf '%s' "$runtime_rows" | \
    "${sanitized[@]}" node scripts/verify-production-builder-cache-runtime.cjs \
      --compose-project "$compose_project" \
      --api-image-id "$EXPECTED_RUNTIME_API_IMAGE" \
      --media-ai-image-id "$EXPECTED_RUNTIME_MEDIA_IMAGE" \
      --web-image-id "$EXPECTED_RUNTIME_WEB_IMAGE" \
      --discord-bot-image-id "$EXPECTED_RUNTIME_DISCORD_IMAGE" \
      2>/dev/null)"; then
    block "the seven-service runtime verifier failed."
  fi
  [ -n "$runtime_fingerprint" ] || block "the exact healthy seven-service runtime is not reviewed."
  printf '%s\n' "$runtime_fingerprint"
}

runtime_app_binding() {
  local runtime="$1" expected_service="$2"
  local row_service container_id image_id release_field restart_field extra=""
  local found=0 observed_image="" release_id=""
  case "$expected_service" in
    api|media-ai|web|discord-bot) ;;
    *) block "the requested runtime application service is invalid." ;;
  esac
  while IFS='|' read -r row_service container_id image_id release_field restart_field extra; do
    [ -n "$row_service" ] || continue
    [ -z "$extra" ] || block "the canonical runtime fingerprint schema changed."
    if [ "$row_service" = "$expected_service" ]; then
      [ "$found" -eq 0 ] || block "the runtime application service is duplicated."
      found=1
      observed_image="$image_id"
      release_id="${release_field#release=}"
      [ "$release_field" = "release=$release_id" ] || \
        block "the runtime application release field is invalid."
    fi
  done <<<"$runtime"
  [ "$found" -eq 1 ] && [[ "$observed_image" =~ ^sha256:[0-9a-f]{64}$ ]] && \
    [[ "$release_id" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || \
    block "the runtime application binding is invalid."
  printf '%s|%s' "$release_id" "$observed_image"
}

verify_running_app_evidence() {
  local service="$1" runtime="$2"
  local binding release_id observed_image extra="" release_env
  local release_env_hash release_env_identity
  if ! binding="$(runtime_app_binding "$runtime" "$service")"; then
    block "$service runtime binding could not be captured."
  fi
  IFS='|' read -r release_id observed_image extra <<<"$binding"
  [ -z "$extra" ] && [[ "$release_id" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] && \
    [[ "$observed_image" =~ ^sha256:[0-9a-f]{64}$ ]] || \
    block "$service runtime binding is not canonical."
  if ! release_env="$(verify_release_environment "$release_id")"; then
    block "$service runtime release environment could not be verified."
  fi
  [ "$release_env" = "$RELEASE_ROOT/$release_id.env" ] || \
    block "$service runtime release environment path is not exact."
  if ! release_env_hash="$(sha256sum -- "$release_env" | awk '{print $1}')" || \
    ! release_env_identity="$(stat -c '%d:%i:%u:%g:%a:%h:%s:%Y' -- "$release_env")"; then
    block "$service runtime release environment fingerprint failed."
  fi
  [[ "$release_env_hash" =~ ^[0-9a-f]{64}$ ]] && \
    [[ "$release_env_identity" =~ ^[0-9]+:[0-9]+:0:0:600:1:[1-9][0-9]*:[0-9]+$ ]] || \
    block "$service runtime release environment fingerprint is invalid."
  verify_image_manifest "$release_id" "$release_env" "$service"
  [ "$LAST_IMAGE_ID" = "$observed_image" ] || \
    block "$service runtime image differs from its exact release manifest."
  printf 'runtime-evidence|%s|release=%s|env-identity=%s|env-sha256=%s|image=%s|manifest-identity=%s|manifest-sha256=%s\n' \
    "$service" "$release_id" "$release_env_identity" "$release_env_hash" \
    "$observed_image" "$LAST_MANIFEST_IDENTITY" "$LAST_MANIFEST_HASH"
}

current_snapshot() {
  local assembly current_env current_env_hash current_release pointer pointer_hash
  local compose_project current_env_identity env_hash env_identity pointer_identity runtime runtime_after
  local api_evidence web_evidence media_evidence discord_evidence
  if ! assembly="$(assembly_snapshot)"; then
    block "the exact clean source assembly snapshot failed."
  fi
  [ -n "$assembly" ] || block "the exact clean source assembly snapshot is empty."
  verify_production_environment
  if ! env_hash="$(sha256sum -- "$PUBLISH_ENV" | awk '{print $1}')" || \
    ! env_identity="$(stat -c '%d:%i:%u:%g:%a:%h:%s:%Y' -- "$PUBLISH_ENV")"; then
    block "the production environment snapshot failed."
  fi
  [[ "$env_hash" =~ ^[0-9a-f]{64}$ ]] && \
    [[ "$env_identity" =~ ^[0-9]+:[0-9]+:0:0:600:1:[1-9][0-9]*:[0-9]+$ ]] || \
    block "the production environment fingerprint is invalid."
  pointer="$RELEASE_ROOT/CURRENT"
  verify_archive_file "$pointer" CURRENT
  mapfile -t pointer_lines < "$pointer"
  [ "${#pointer_lines[@]}" -eq 1 ] && \
    [[ "${pointer_lines[0]}" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || \
    block "the CURRENT pointer is invalid."
  current_release="${pointer_lines[0]}"
  [ "$current_release" = "$EXPECTED_CURRENT_RELEASE" ] || \
    block "CURRENT is not the exact pre-candidate production release."
  if ! current_env="$(verify_release_environment "$current_release")"; then
    block "the current release environment snapshot failed."
  fi
  [ "$current_env" = "$RELEASE_ROOT/$current_release.env" ] || \
    block "the current release environment path is not exact."
  if ! current_env_hash="$(sha256sum -- "$current_env" | awk '{print $1}')" || \
    ! pointer_hash="$(sha256sum -- "$pointer" | awk '{print $1}')" || \
    ! current_env_identity="$(stat -c '%d:%i:%u:%g:%a:%h:%s:%Y' -- "$current_env")" || \
    ! pointer_identity="$(stat -c '%d:%i:%u:%g:%a:%h:%s:%Y' -- "$pointer")"; then
    block "the current release metadata fingerprint failed."
  fi
  [[ "$current_env_hash" =~ ^[0-9a-f]{64}$ ]] && \
    [[ "$pointer_hash" =~ ^[0-9a-f]{64}$ ]] && \
    [[ "$current_env_identity" =~ ^[0-9]+:[0-9]+:0:0:600:1:[1-9][0-9]*:[0-9]+$ ]] && \
    [[ "$pointer_identity" =~ ^[0-9]+:[0-9]+:0:0:600:1:[1-9][0-9]*:[0-9]+$ ]] || \
    block "the current release metadata fingerprint is invalid."
  if ! compose_project="$("${sanitized[@]}" node scripts/read-dotenv-value.cjs \
    "$PUBLISH_ENV" ARENZYRA_DEPLOY_COMPOSE_PROJECT 2>/dev/null)"; then
    block "the production Compose project could not be read."
  fi
  [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || \
    block "the production Compose project is invalid."
  if ! runtime="$(capture_runtime "$compose_project")"; then
    block "the exact seven-service runtime snapshot failed."
  fi
  [ -n "$runtime" ] || block "the exact seven-service runtime snapshot is empty."
  if ! api_evidence="$(verify_running_app_evidence api "$runtime")"; then
    block "the API runtime evidence snapshot failed."
  fi
  if ! media_evidence="$(verify_running_app_evidence media-ai "$runtime")"; then
    block "the media runtime evidence snapshot failed."
  fi
  if ! web_evidence="$(verify_running_app_evidence web "$runtime")"; then
    block "the Web runtime evidence snapshot failed."
  fi
  if ! discord_evidence="$(verify_running_app_evidence discord-bot "$runtime")"; then
    block "the Discord runtime evidence snapshot failed."
  fi
  [ -n "$api_evidence" ] && [ -n "$media_evidence" ] && \
    [ -n "$web_evidence" ] && [ -n "$discord_evidence" ] || \
    block "an application runtime evidence snapshot is empty."
  if ! runtime_after="$(capture_runtime "$compose_project")"; then
    block "the seven-service runtime closing snapshot failed."
  fi
  [ "$runtime_after" = "$runtime" ] || \
    block "the seven-service runtime changed while its release evidence was verified."

  printf '%s\n' \
    "$assembly" \
    "publish-env|identity=$env_identity|sha256=$env_hash" \
    "current-pointer|identity=$pointer_identity|sha256=$pointer_hash|release=$current_release" \
    "current-env|identity=$current_env_identity|sha256=$current_env_hash" \
    "$api_evidence" \
    "$media_evidence" \
    "$web_evidence" \
    "$discord_evidence" \
    "$runtime_after"
}

candidate_snapshot() {
  local candidate_env candidate_env_identity env_hash api_image web_image media_image
  local api_manifest web_manifest media_manifest
  local api_manifest_identity web_manifest_identity media_manifest_identity
  if ! candidate_env="$(verify_release_environment "$FAILED_CANDIDATE_RELEASE" \
    "$FAILED_CANDIDATE_ROOT" "$EXPECTED_CURRENT_API" "$EXPECTED_CURRENT_WEB")"; then
    block "the failed-candidate release environment snapshot failed."
  fi
  [ "$candidate_env" = "$RELEASE_ROOT/$FAILED_CANDIDATE_RELEASE.env" ] || \
    block "the failed-candidate release environment path is not exact."
  if ! env_hash="$(sha256sum -- "$candidate_env" | awk '{print $1}')" || \
    ! candidate_env_identity="$(stat -c '%d:%i:%u:%g:%a:%h:%s:%Y' -- "$candidate_env")"; then
    block "the failed-candidate environment fingerprint failed."
  fi
  [[ "$env_hash" =~ ^[0-9a-f]{64}$ ]] && \
    [[ "$candidate_env_identity" =~ ^[0-9]+:[0-9]+:0:0:600:1:[1-9][0-9]*:[0-9]+$ ]] || \
    block "the failed-candidate environment fingerprint is invalid."
  verify_image_manifest "$FAILED_CANDIDATE_RELEASE" "$candidate_env" api
  api_image="$LAST_IMAGE_ID"; api_manifest="$LAST_MANIFEST_HASH"
  api_manifest_identity="$LAST_MANIFEST_IDENTITY"
  verify_image_manifest "$FAILED_CANDIDATE_RELEASE" "$candidate_env" web
  web_image="$LAST_IMAGE_ID"; web_manifest="$LAST_MANIFEST_HASH"
  web_manifest_identity="$LAST_MANIFEST_IDENTITY"
  verify_image_manifest "$FAILED_CANDIDATE_RELEASE" "$candidate_env" media-ai
  media_image="$LAST_IMAGE_ID"; media_manifest="$LAST_MANIFEST_HASH"
  media_manifest_identity="$LAST_MANIFEST_IDENTITY"
  printf '%s\n' \
    "candidate|release=$FAILED_CANDIDATE_RELEASE|root=$FAILED_CANDIDATE_ROOT|api=$EXPECTED_CURRENT_API|web=$EXPECTED_CURRENT_WEB" \
    "candidate-env|identity=$candidate_env_identity|sha256=$env_hash" \
    "candidate-image|api|$api_image|identity=$api_manifest_identity|sha256=$api_manifest" \
    "candidate-image|web|$web_image|identity=$web_manifest_identity|sha256=$web_manifest" \
    "candidate-image|media-ai|$media_image|identity=$media_manifest_identity|sha256=$media_manifest"
}

read_root_free_kib() {
  local disk_row available used mounted
  if ! disk_row="$(df -Pk -- / 2>/dev/null | awk 'NR == 2 { print $4, $5, $6 }')"; then
    block "the root-filesystem free-space command failed."
  fi
  read -r available used mounted <<<"$disk_row"
  [[ "$available" =~ ^[0-9]+$ ]] && [ "$mounted" = "/" ] || \
    block "the root-filesystem free-space reading is invalid."
  printf '%s' "$available"
}

production_verify_lock_descriptor || block "the shared deployment lock identity changed."
if ! /bin/bash scripts/production-deploy-preflight.sh \
  --allow-low-disk-builder-cache-release; then
  block "the low-disk ordinary environment, volume, and health preflight failed."
fi

if ! baseline_current="$(current_snapshot)"; then
  block "the initial current-production snapshot failed."
fi
if ! baseline_candidate="$(candidate_snapshot)"; then
  block "the initial failed-candidate snapshot failed."
fi
if ! before_free_kib="$(read_root_free_kib)"; then
  block "the initial root-filesystem free-space snapshot failed."
fi
[ -n "$baseline_current" ] && [ -n "$baseline_candidate" ] || \
  block "an initial immutable snapshot is empty."
[ "$before_free_kib" -lt "$MIN_FREE_KIB" ] || \
  block "free space is not below the exact 30 GiB eligibility threshold."

if ! builder_prune_help="$(docker builder prune --help 2>/dev/null)"; then
  block "Docker builder-prune help inspection failed."
fi
if ! reserve_flag="$(printf '%s\n' "$builder_prune_help" | \
  "${sanitized[@]}" node scripts/select-production-builder-prune-reserve-flag.cjs \
  2>/dev/null)"; then
  block "Docker builder-prune reserve-flag selection failed."
fi
case "$reserve_flag" in
  --reserved-space|--keep-storage) ;;
  *) block "Docker exposes no reviewed zero-reserve builder-prune flag." ;;
esac

production_verify_lock_descriptor || block "the shared deployment lock identity changed before prune."
if ! pre_prune_current="$(current_snapshot)"; then
  block "the current-production recheck failed before prune."
fi
[ "$pre_prune_current" = "$baseline_current" ] || \
  block "the current source, environment, release, or runtime drifted before prune."
if ! pre_prune_candidate="$(candidate_snapshot)"; then
  block "the failed-candidate recheck failed before prune."
fi
[ "$pre_prune_candidate" = "$baseline_candidate" ] || \
  block "the failed candidate evidence drifted before prune."
if ! pre_prune_free_kib="$(read_root_free_kib)"; then
  block "the root-filesystem free-space recheck failed before prune."
fi
[ "$pre_prune_free_kib" -lt "$MIN_FREE_KIB" ] || \
  block "free space crossed the eligibility threshold before prune."

mutation_attempted=1
prune_status=0
docker builder prune -af "$reserve_flag" "0B" || prune_status=$?

production_verify_lock_descriptor || block "the shared deployment lock identity changed after prune."
if ! post_prune_current="$(current_snapshot)"; then
  block "the current-production recheck failed after prune."
fi
[ "$post_prune_current" = "$baseline_current" ] || \
  block "the current source, environment, release, or runtime changed after prune."
if ! post_prune_candidate="$(candidate_snapshot)"; then
  block "the failed-candidate recheck failed after prune."
fi
[ "$post_prune_candidate" = "$baseline_candidate" ] || \
  block "the failed candidate metadata, manifests, or image IDs changed after prune."
[ "$prune_status" -eq 0 ] || block "Docker reported that the reviewed builder prune failed."
if ! after_free_kib="$(read_root_free_kib)"; then
  block "the root-filesystem free-space recheck failed after prune."
fi
[ "$after_free_kib" -ge "$MIN_FREE_KIB" ] || \
  block "builder cache was pruned but root free space remains below 30 GiB."

if ! /bin/bash scripts/production-deploy-preflight.sh; then
  block "the ordinary post-prune production preflight failed."
fi
production_verify_lock_descriptor || block "the shared deployment lock identity changed after preflight."
if ! final_current="$(current_snapshot)"; then
  block "the current-production recheck failed after final preflight."
fi
[ "$final_current" = "$baseline_current" ] || \
  block "the current source, environment, release, or runtime drifted during final preflight."
if ! final_candidate="$(candidate_snapshot)"; then
  block "the failed-candidate recheck failed after final preflight."
fi
[ "$final_candidate" = "$baseline_candidate" ] || \
  block "the failed candidate evidence drifted during final preflight."
if ! final_free_kib="$(read_root_free_kib)"; then
  block "the final root-filesystem free-space recheck failed."
fi
[ "$final_free_kib" -ge "$MIN_FREE_KIB" ] || \
  block "root free space fell below 30 GiB during final verification."

printf 'FAILED-CANDIDATE BUILDER CACHE RELEASE COMPLETE release=%s before_kib=%s after_kib=%s reserve_flag=%s reserve=0B\n' \
  "$FAILED_CANDIDATE_RELEASE" "$before_free_kib" "$final_free_kib" "$reserve_flag"
