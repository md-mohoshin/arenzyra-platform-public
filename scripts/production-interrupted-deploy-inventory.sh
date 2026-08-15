#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
EXPECTED_ROOT="/opt/arenzyra"
RELEASE_ROOT="/opt/arenzyra-release-metadata"
PUBLISH_ENV="$EXPECTED_ROOT/infra/.env.publish"
EXPECTED_PREVIOUS_ROOT="5e04ae1791ebb31261feaf460a484f182b4db6d4"
EXPECTED_API="88efdad94d65c09c6d3bd73e4b874db915629859"
EXPECTED_WEB="3d2cca1dd4267a7cb0e8b54a98ae4fbbee1289d4"
EXPECTED_CURRENT_RELEASE="git-20260814-192205642-e04672c95be2"
EXPECTED_CANDIDATE_ROOT="d6390f2abb37"
EXPECTED_CANDIDATE_API="88efdad94d65"
EXPECTED_CANDIDATE_WEB="3d2cca1dd426"
CANDIDATE_WINDOW_START="2026-08-15T13:00:00.000Z"
CANDIDATE_WINDOW_END="2026-08-15T14:00:00.000Z"
MAX_ARCHIVED_RELEASE_ENVS=4096
MAX_WINDOW_RELEASES=32
MAX_EXACT_CANDIDATES=8
EXPECTED_RUNTIME_API_IMAGE="sha256:518ce5d035c9f6ebbd100ff570981cffa822484fa1971ec8649f808134095d9c"
EXPECTED_RUNTIME_MEDIA_IMAGE="sha256:9863f4cfa9defef7cfe7caf018c83bc277712df3c41fcc8baead1af2cbc0ec5f"
EXPECTED_RUNTIME_WEB_IMAGE="sha256:23cfef8c359a60379d18d6736d2067c7c2a9a2bc82e08e1c37a6e53ac4745923"
EXPECTED_RUNTIME_DISCORD_IMAGE="sha256:e2db68104d3cf5a4f3ce543853b81725135b14a0f40f0246179b8e59bc88b0df"

block() {
  printf 'INTERRUPTED DEPLOY INVENTORY BLOCKED: %s No production mutation was attempted.\n' "$1" >&2
  exit 75
}

[ "$#" -eq 0 ] || block "no arguments are accepted."
[ "$(id -u)" -eq 0 ] && [ "$(pwd -P)" = "$EXPECTED_ROOT" ] || \
  block "exact production invocation is required."
[ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" = "1" ] || \
  block "the shared deployment lock was not inherited."

source scripts/acquire-production-deploy-lock.sh || \
  block "the shared deployment lock helper is unavailable."
production_verify_lock_descriptor || block "the shared deployment lock is not verified."
source scripts/require-local-production-docker.sh || \
  block "the production Docker target is not reviewed."

for required_command in cmp df docker id node realpath sha256sum stat; do
  command -v "$required_command" >/dev/null 2>&1 || \
    block "a required read-only command is unavailable."
done
[ -x /usr/bin/git ] || block "the reviewed Git executable is unavailable."

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

LAST_FILE_IDENTITY=""
LAST_FILE_HASH=""
LAST_MANIFEST_PRESENT=0
LAST_MANIFEST_READY=0

verify_source_assembly() {
  local root_head root_parent api_head web_head root_status api_status web_status
  if ! root_head="$("${reviewed_git[@]}" -C "$EXPECTED_ROOT" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || \
    ! root_parent="$("${reviewed_git[@]}" -C "$EXPECTED_ROOT" rev-parse --verify 'HEAD^1^{commit}' 2>/dev/null)" || \
    ! api_head="$("${reviewed_git[@]}" -C "$EXPECTED_ROOT/apps/api" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || \
    ! web_head="$("${reviewed_git[@]}" -C "$EXPECTED_ROOT/apps/arenzyra-web" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)"; then
    block "the reviewed source assembly identity could not be read."
  fi
  if ! root_status="$("${reviewed_git[@]}" -C "$EXPECTED_ROOT" status --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>/dev/null)" || \
    ! api_status="$("${reviewed_git[@]}" -C "$EXPECTED_ROOT/apps/api" status --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>/dev/null)" || \
    ! web_status="$("${reviewed_git[@]}" -C "$EXPECTED_ROOT/apps/arenzyra-web" status --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>/dev/null)"; then
    block "the reviewed source assembly status could not be read."
  fi
  [[ "$root_head" =~ ^[0-9a-f]{40}$ ]] && \
    [ "$root_head" != "$EXPECTED_PREVIOUS_ROOT" ] && \
    [ "$root_parent" = "$EXPECTED_PREVIOUS_ROOT" ] && \
    [ "$api_head" = "$EXPECTED_API" ] && [ "$web_head" = "$EXPECTED_WEB" ] && \
    [ -z "$root_status" ] && [ -z "$api_status" ] && [ -z "$web_status" ] || \
    block "the source assembly is not the exact clean direct successor."
  printf 'SOURCE root=%s api=%s web=%s\n' "$root_head" "$api_head" "$web_head"
}

verify_archive_root() {
  local opt_mode opt_owner opt_resolved release_identity release_resolved
  if ! opt_resolved="$(realpath -e -- /opt 2>/dev/null)" || \
    ! opt_owner="$(stat -c '%u:%g' -- /opt 2>/dev/null)" || \
    ! opt_mode="$(stat -c %a -- /opt 2>/dev/null)"; then
    block "the release metadata parent identity could not be captured."
  fi
  [ -d /opt ] && [ ! -L /opt ] && [ "$opt_resolved" = /opt ] && \
    [ "$opt_owner" = '0:0' ] || \
    block "the release metadata parent is unsafe."
  [[ "$opt_mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$opt_mode & 8#022) == 0 )) || \
    block "the release metadata parent mode is unsafe."
  if ! release_resolved="$(realpath -e -- "$RELEASE_ROOT" 2>/dev/null)" || \
    ! release_identity="$(stat -c '%u:%g:%a' -- "$RELEASE_ROOT" 2>/dev/null)"; then
    block "the release metadata root identity could not be captured."
  fi
  [ -d "$RELEASE_ROOT" ] && [ ! -L "$RELEASE_ROOT" ] && \
    [ "$release_resolved" = "$RELEASE_ROOT" ] && \
    [ "$release_identity" = '0:0:700' ] || \
    block "the release metadata root is unsafe."
}

verify_archive_file() {
  local file="$1" expected_name="$2" resolved identity_before identity_after hash_line hash extra
  [ -f "$file" ] && [ ! -L "$file" ] || block "an archived evidence file is unsafe."
  if ! resolved="$(realpath -e -- "$file" 2>/dev/null)" || \
    ! identity_before="$(stat -c '%d:%i:%u:%g:%a:%h:%s:%Y' -- "$file" 2>/dev/null)" || \
    ! hash_line="$(sha256sum -- "$file" 2>/dev/null)" || \
    ! identity_after="$(stat -c '%d:%i:%u:%g:%a:%h:%s:%Y' -- "$file" 2>/dev/null)"; then
    block "an archived evidence fingerprint could not be captured."
  fi
  read -r hash extra <<<"$hash_line"
  [ "$resolved" = "$file" ] && [ "${file##*/}" = "$expected_name" ] && \
    [ "$identity_before" = "$identity_after" ] && \
    [[ "$identity_before" =~ ^[0-9]+:[0-9]+:0:0:600:1:[1-9][0-9]*:[0-9]+$ ]] && \
    [[ "$hash" =~ ^[0-9a-f]{64}$ ]] && [ "$extra" = "$file" ] || \
    block "an archived evidence fingerprint is invalid."
  LAST_FILE_IDENTITY="$identity_before"
  LAST_FILE_HASH="$hash"
}

verify_release_environment() {
  local release_id file
  release_id="$1"
  file="$RELEASE_ROOT/$release_id.env"
  verify_archive_file "$file" "$release_id.env"
  "${sanitized[@]}" node scripts/validate-publish-release-env.cjs \
    --file "$file" --expected-release "$release_id" >/dev/null 2>&1 || \
    block "an archived release environment is invalid."
}

read_release_value() {
  local release_id="$1" key="$2" value
  if ! value="$("${sanitized[@]}" node scripts/read-dotenv-value.cjs \
    "$RELEASE_ROOT/$release_id.env" "$key" 2>/dev/null)"; then
    block "an archived release provenance field could not be read."
  fi
  printf '%s' "$value"
}

pointer_snapshot() {
  local name expected_release pointer
  local pointer_identity pointer_hash release_id env_identity env_hash
  local -a lines=()
  name="$1"
  expected_release="${2:-}"
  pointer="$RELEASE_ROOT/$name"
  if [ ! -e "$pointer" ] && [ ! -L "$pointer" ]; then
    [ "$name" = PREVIOUS ] || block "the CURRENT pointer is missing."
    printf 'POINTER name=PREVIOUS state=absent\n'
    return
  fi
  verify_archive_file "$pointer" "$name"
  pointer_identity="$LAST_FILE_IDENTITY"
  pointer_hash="$LAST_FILE_HASH"
  if ! mapfile -t lines < "$pointer"; then
    block "a release pointer could not be read."
  fi
  [ "${#lines[@]}" -eq 1 ] && \
    [[ "${lines[0]}" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || \
    block "a release pointer is invalid."
  release_id="${lines[0]}"
  if [ -n "$expected_release" ] && [ "$release_id" != "$expected_release" ]; then
    block "CURRENT changed after the interrupted deployment."
  fi
  verify_release_environment "$release_id"
  env_identity="$LAST_FILE_IDENTITY"
  env_hash="$LAST_FILE_HASH"
  printf 'POINTER name=%s state=present release=%s identity=%s sha256=%s env-identity=%s env-sha256=%s\n' \
    "$name" "$release_id" "$pointer_identity" "$pointer_hash" "$env_identity" "$env_hash"
}

verify_publish_environment() {
  local identity_before identity_after hash_before hash_after policy_identity policy_resolved
  if ! policy_resolved="$(realpath -e -- "$PUBLISH_ENV" 2>/dev/null)" || \
    ! policy_identity="$(stat -c '%u:%g:%a:%h' -- "$PUBLISH_ENV" 2>/dev/null)"; then
    block "the production environment identity could not be captured."
  fi
  [ -f "$PUBLISH_ENV" ] && [ ! -L "$PUBLISH_ENV" ] && \
    [ "$policy_resolved" = "$PUBLISH_ENV" ] && [ "$policy_identity" = '0:0:600:1' ] || \
    block "the production environment identity is unsafe."
  verify_archive_file "$PUBLISH_ENV" .env.publish
  identity_before="$LAST_FILE_IDENTITY"
  hash_before="$LAST_FILE_HASH"
  "${sanitized[@]}" node scripts/preflight-publish.cjs \
    --env "$PUBLISH_ENV" --skip-compose >/dev/null 2>&1 || \
    block "the production environment policy is invalid."
  verify_archive_file "$PUBLISH_ENV" .env.publish
  identity_after="$LAST_FILE_IDENTITY"
  hash_after="$LAST_FILE_HASH"
  [ "$identity_before" = "$identity_after" ] && [ "$hash_before" = "$hash_after" ] || \
    block "the production environment changed during inspection."
  printf 'PUBLISH_ENV identity=%s sha256=%s\n' "$identity_after" "$hash_after"
}

manifest_snapshot() {
  local release_id service env_file manifest
  local identity_before identity_after hash_before hash_after image_id image_available=0
  release_id="$1"
  service="$2"
  env_file="$RELEASE_ROOT/$release_id.env"
  manifest="$RELEASE_ROOT/$release_id.${service}-image.json"
  LAST_MANIFEST_PRESENT=0
  LAST_MANIFEST_READY=0
  if [ ! -e "$manifest" ] && [ ! -L "$manifest" ]; then
    printf 'CANDIDATE_MANIFEST release=%s service=%s state=absent\n' "$release_id" "$service"
    return
  fi
  verify_archive_file "$manifest" "$release_id.${service}-image.json"
  identity_before="$LAST_FILE_IDENTITY"
  hash_before="$LAST_FILE_HASH"
  if ! image_id="$("${sanitized[@]}" node scripts/validate-release-image-manifest.cjs \
    --file "$manifest" --release-env "$env_file" --expected-release "$release_id" \
    --service "$service" --print-image-id 2>/dev/null)"; then
    block "a candidate image manifest is invalid."
  fi
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || block "a candidate image ID is invalid."
  if docker image inspect "$image_id" >/dev/null 2>&1; then
    image_available=1
    if ! docker image inspect "$image_id" 2>/dev/null | \
      "${sanitized[@]}" node scripts/validate-release-image-manifest.cjs \
        --release-env "$env_file" --expected-release "$release_id" \
        --service "$service" --from-docker-inspect 2>/dev/null | \
      cmp -s - "$manifest"; then
      block "an available candidate image differs from its immutable manifest."
    fi
  fi
  verify_archive_file "$manifest" "$release_id.${service}-image.json"
  identity_after="$LAST_FILE_IDENTITY"
  hash_after="$LAST_FILE_HASH"
  [ "$identity_before" = "$identity_after" ] && [ "$hash_before" = "$hash_after" ] || \
    block "a candidate image manifest changed during inspection."
  LAST_MANIFEST_PRESENT=1
  LAST_MANIFEST_READY="$image_available"
  printf 'CANDIDATE_MANIFEST release=%s service=%s state=present identity=%s sha256=%s image=%s available=%s regenerated=%s\n' \
    "$release_id" "$service" "$identity_after" "$hash_after" "$image_id" \
    "$image_available" "$image_available"
}

candidate_evidence() {
  local release_id="$1" env_identity_before env_identity_after env_hash_before env_hash_after
  local root_commit api_commit web_commit manifest_count=0 ready_count=0 readiness
  local service
  verify_release_environment "$release_id"
  env_identity_before="$LAST_FILE_IDENTITY"
  env_hash_before="$LAST_FILE_HASH"
  if ! root_commit="$(read_release_value "$release_id" ARENZYRA_ROOT_GIT_COMMIT)" || \
    ! api_commit="$(read_release_value "$release_id" ARENZYRA_API_GIT_COMMIT)" || \
    ! web_commit="$(read_release_value "$release_id" ARENZYRA_WEB_GIT_COMMIT)"; then
    block "candidate provenance could not be captured."
  fi
  [ "$root_commit" = "$EXPECTED_CANDIDATE_ROOT" ] && \
    [ "$api_commit" = "$EXPECTED_CANDIDATE_API" ] && \
    [ "$web_commit" = "$EXPECTED_CANDIDATE_WEB" ] || \
    block "candidate evidence escaped the interrupted deployment provenance."
  verify_release_environment "$release_id"
  env_identity_after="$LAST_FILE_IDENTITY"
  env_hash_after="$LAST_FILE_HASH"
  [ "$env_identity_before" = "$env_identity_after" ] && \
    [ "$env_hash_before" = "$env_hash_after" ] || \
    block "a candidate release environment changed during inspection."
  printf 'CANDIDATE release=%s env-identity=%s env-sha256=%s\n' \
    "$release_id" "$env_identity_after" "$env_hash_after"
  for service in api web media-ai; do
    manifest_snapshot "$release_id" "$service"
    manifest_count=$((manifest_count + LAST_MANIFEST_PRESENT))
    ready_count=$((ready_count + LAST_MANIFEST_READY))
  done
  if [ "$ready_count" -eq 3 ]; then
    readiness=immutable-build-complete
  elif [ "$manifest_count" -eq 0 ]; then
    readiness=metadata-only
  else
    readiness=incomplete
  fi
  printf 'CANDIDATE_READINESS release=%s manifests=%s ready-images=%s state=%s\n' \
    "$release_id" "$manifest_count" "$ready_count" "$readiness"
}

candidate_snapshot() {
  local file name release_id root_commit api_commit web_commit index
  local window_count=0 other_count=0
  local -a all_envs=() exact_candidates=()
  shopt -s nullglob
  all_envs=("$RELEASE_ROOT"/git-*.env)
  [ "${#all_envs[@]}" -le "$MAX_ARCHIVED_RELEASE_ENVS" ] || \
    block "the archived release environment inventory is unbounded."
  for file in "${all_envs[@]}"; do
    name="${file##*/}"
    [[ "$name" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}\.env$ ]] || \
      block "an archived release environment name is invalid."
    release_id="${name%.env}"
    [[ "$release_id" =~ ^git-20260815-13[0-5][0-9][0-5][0-9][0-9]{3}-[a-f0-9]{12}$ ]] || continue
    window_count=$((window_count + 1))
    [ "$window_count" -le "$MAX_WINDOW_RELEASES" ] || \
      block "the interrupted deployment time window is unbounded."
    verify_release_environment "$release_id"
    if ! root_commit="$(read_release_value "$release_id" ARENZYRA_ROOT_GIT_COMMIT)" || \
      ! api_commit="$(read_release_value "$release_id" ARENZYRA_API_GIT_COMMIT)" || \
      ! web_commit="$(read_release_value "$release_id" ARENZYRA_WEB_GIT_COMMIT)"; then
      block "release provenance in the interrupted window could not be captured."
    fi
    if [ "$root_commit" = "$EXPECTED_CANDIDATE_ROOT" ] && \
      [ "$api_commit" = "$EXPECTED_CANDIDATE_API" ] && \
      [ "$web_commit" = "$EXPECTED_CANDIDATE_WEB" ]; then
      exact_candidates+=("$release_id")
      [ "${#exact_candidates[@]}" -le "$MAX_EXACT_CANDIDATES" ] || \
        block "the exact interrupted candidate inventory is unbounded."
    else
      other_count=$((other_count + 1))
    fi
  done
  printf 'CANDIDATE_WINDOW start=%s end=%s matching=%s other=%s\n' \
    "$CANDIDATE_WINDOW_START" "$CANDIDATE_WINDOW_END" \
    "${#exact_candidates[@]}" "$other_count"
  for ((index=${#exact_candidates[@]} - 1; index >= 0; index--)); do
    candidate_evidence "${exact_candidates[$index]}"
  done
}

capture_runtime() {
  local compose_project="$1" container_output container_id row runtime_rows="" runtime
  local -a container_ids=()
  if ! container_output="$(docker ps -aq --no-trunc \
    --filter "label=com.docker.compose.project=${compose_project}" 2>/dev/null)"; then
    block "production container enumeration failed."
  fi
  while IFS= read -r container_id; do
    [ -n "$container_id" ] && container_ids+=("$container_id")
  done <<<"$container_output"
  [ "${#container_ids[@]}" -eq 7 ] || block "production does not contain exactly seven containers."
  for container_id in "${container_ids[@]}"; do
    [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || block "a runtime container ID is invalid."
    if ! row="$(docker inspect --format \
      '{{.Id}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.oneoff"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}|{{.State.Restarting}}|{{.RestartCount}}|{{.HostConfig.RestartPolicy.Name}}|{{if index .Config.Labels "com.arenzyra.release-id"}}{{index .Config.Labels "com.arenzyra.release-id"}}{{end}}' \
      "$container_id" 2>/dev/null)"; then
      block "a runtime container inspection failed."
    fi
    [ -n "$row" ] || block "the runtime changed during inspection."
    runtime_rows+="$row"$'\n'
  done
  if ! runtime="$(printf '%s' "$runtime_rows" | \
    "${sanitized[@]}" node scripts/verify-production-builder-cache-runtime.cjs \
      --compose-project "$compose_project" \
      --api-image-id "$EXPECTED_RUNTIME_API_IMAGE" \
      --media-ai-image-id "$EXPECTED_RUNTIME_MEDIA_IMAGE" \
      --web-image-id "$EXPECTED_RUNTIME_WEB_IMAGE" \
      --discord-bot-image-id "$EXPECTED_RUNTIME_DISCORD_IMAGE" 2>/dev/null)"; then
    block "the exact healthy seven-service runtime verifier failed."
  fi
  [ -n "$runtime" ] || block "the runtime inventory is empty."
  printf '%s\n' "$runtime"
}

read_root_free_kib() {
  local output filesystem blocks used available capacity mounted extra
  local -a lines=()
  if ! output="$(df -Pk -- / 2>/dev/null)"; then
    block "root free-space inspection failed."
  fi
  if ! mapfile -t lines <<<"$output"; then
    block "root free-space output could not be parsed."
  fi
  [ "${#lines[@]}" -eq 2 ] || block "root free-space output is not exact."
  read -r filesystem blocks used available capacity mounted extra <<<"${lines[1]}"
  [[ "$blocks" =~ ^[0-9]+$ ]] && [[ "$used" =~ ^[0-9]+$ ]] && \
    [[ "$available" =~ ^[0-9]+$ ]] && [[ "$capacity" =~ ^[0-9]+%$ ]] && \
    [ "$mounted" = / ] && [ -z "$extra" ] || block "root free-space output is invalid."
  printf '%s' "$available"
}

evidence_snapshot() {
  local source current previous publish candidates
  if ! source="$(verify_source_assembly)" || \
    ! current="$(pointer_snapshot CURRENT "$EXPECTED_CURRENT_RELEASE")" || \
    ! previous="$(pointer_snapshot PREVIOUS)" || \
    ! publish="$(verify_publish_environment)" || \
    ! candidates="$(candidate_snapshot)"; then
    block "the interrupted deployment evidence snapshot failed."
  fi
  [ -n "$source" ] && [ -n "$current" ] && [ -n "$previous" ] && \
    [ -n "$publish" ] && [ -n "$candidates" ] || \
    block "an interrupted deployment evidence section is empty."
  printf '%s\n%s\n%s\n%s\n%s\n' "$source" "$current" "$previous" "$publish" "$candidates"
}

verify_archive_root
production_verify_lock_descriptor || block "the shared deployment lock identity changed."
if ! free_before="$(read_root_free_kib)" || \
  ! evidence_before="$(evidence_snapshot)"; then
  block "the initial locked interrupted deployment evidence failed."
fi
if ! compose_project="$("${sanitized[@]}" node scripts/read-dotenv-value.cjs \
  "$PUBLISH_ENV" ARENZYRA_DEPLOY_COMPOSE_PROJECT 2>/dev/null)"; then
  block "the production Compose project could not be read."
fi
[[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || \
  block "the production Compose project is invalid."
if ! runtime_before="$(capture_runtime "$compose_project")" || \
  ! evidence_after="$(evidence_snapshot)" || \
  ! runtime_after="$(capture_runtime "$compose_project")" || \
  ! free_after="$(read_root_free_kib)"; then
  block "the locked interrupted deployment inventory failed."
fi
[[ "$free_before" =~ ^[0-9]+$ ]] && [[ "$free_after" =~ ^[0-9]+$ ]] || \
  block "a root free-space result is invalid."
[ "$evidence_before" = "$evidence_after" ] || \
  block "release evidence changed during the locked inventory."
[ "$runtime_before" = "$runtime_after" ] || \
  block "the production runtime changed during the locked inventory."
production_verify_lock_descriptor || block "the shared deployment lock identity changed."

printf 'INTERRUPTED_DEPLOY_INVENTORY root-free-kib-before=%s root-free-kib-after=%s\n' \
  "$free_before" "$free_after"
printf '%s\n' "$evidence_after"
while IFS= read -r runtime_line; do
  [ -n "$runtime_line" ] || continue
  printf 'RUNTIME %s health=healthy restarting=false restart-policy=unless-stopped\n' "$runtime_line"
done <<<"$runtime_after"
printf 'INTERRUPTED_DEPLOY_INVENTORY_COMPLETE mutation=none\n'
