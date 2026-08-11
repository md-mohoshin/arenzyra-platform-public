#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_COMMAND_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_COMMAND_PATH"

PRODUCTION_ROOT="${ARENZYRA_PRODUCTION_ROOT:-/opt/arenzyra}"
EXPECTED_ROOT="/opt/arenzyra"
EXPECTED_RELEASE_ARCHIVE_ROOT="/opt/arenzyra-release-metadata"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
MODE="full"
FIRST_DEPLOY=0
LOCK_TIMEOUT_SECONDS="${ARENZYRA_DEPLOY_LOCK_TIMEOUT_SECONDS:-10}"
HEALTH_TIMEOUT_SECONDS="${ARENZYRA_DEPLOY_HEALTH_TIMEOUT_SECONDS:-240}"
RELEASE_ARCHIVE_ROOT="${ARENZYRA_RELEASE_ARCHIVE_ROOT:-$EXPECTED_RELEASE_ARCHIVE_ROOT}"
prior_release_id=""
runtime_temp_dir=""
pinned_override_path=""
pinned_override_digest=""
pinned_override_mode=""
pinned_override_fd_open=0
pinned_override_validator_args=()
idp_verification_override_path=""
idp_verification_override_digest=""
idp_verification_override_identity=""
idp_verification_override_fd_open=0
idp_database_name=""
idp_database_oid=""
idp_database_system_identifier=""
api_image_id=""
web_image_id=""
media_ai_image_id=""
discord_bot_image_id=""
schema_change_possible=0

cleanup_runtime_files() {
  if [ "$idp_verification_override_fd_open" -eq 1 ]; then
    exec 10<&- 2>/dev/null || true
    idp_verification_override_fd_open=0
  fi
  if [ -n "$idp_verification_override_path" ]; then
    case "$idp_verification_override_path" in
      /run/arenzyra-idp-verification.*)
        rm -f -- "$idp_verification_override_path"
        ;;
    esac
    idp_verification_override_path=""
  fi
  if [ "$pinned_override_fd_open" -eq 1 ]; then
    exec 9<&- 2>/dev/null || true
    pinned_override_fd_open=0
  fi
  if [ -n "$pinned_override_path" ]; then
    case "$pinned_override_path" in
      /run/arenzyra-pinned-compose.*)
        rm -f -- "$pinned_override_path"
        ;;
    esac
    pinned_override_path=""
  fi
  if [ -n "$runtime_temp_dir" ]; then
    case "$runtime_temp_dir" in
      /run/arenzyra-pre-migration-backup.*)
        rm -f -- "$runtime_temp_dir/result"
        rmdir -- "$runtime_temp_dir" 2>/dev/null || true
        ;;
    esac
  fi
}
trap cleanup_runtime_files EXIT

usage() {
  cat <<'EOF'
Usage: scripts/deploy-production.sh [--discord-bot|--legacy-cutover|--legacy-cutover-resume|--legacy-cutover-resume-interrupted] [--first-deploy]

Runs the publish configuration check, fail-closed source provenance and
old-writer migration-safety gates, mandatory disk/service preflight immediately
before Compose, entitlement/data-impact safety gates, deployment, container
health convergence, IDP plaintext-zero verification, and public HTTPS
verification as one chain.

--first-deploy may bypass only the existing-container health portion of the
preflight for a Discord-bot-only bootstrap. A full first deployment is blocked:
it requires a separate reviewed empty-target bootstrap that migrates and
validates the zero-row IDP constraint before any application writer starts.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --discord-bot) MODE="discord-bot" ;;
    --legacy-cutover) MODE="legacy-cutover" ;;
    --legacy-cutover-resume) MODE="legacy-cutover-resume" ;;
    --legacy-cutover-resume-interrupted) MODE="legacy-cutover-resume-interrupted" ;;
    --first-deploy) FIRST_DEPLOY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if { [ "$MODE" = "full" ] || [ "$MODE" = "legacy-cutover" ] || \
  [ "$MODE" = "legacy-cutover-resume" ] || \
  [ "$MODE" = "legacy-cutover-resume-interrupted" ]; } && \
  [ "$FIRST_DEPLOY" -eq 1 ]; then
  printf '%s\n' \
    'DEPLOYMENT BLOCKED: FULL FIRST DEPLOY REQUIRES REVIEWED EMPTY-TARGET BOOTSTRAP' \
    'The normal deploy cannot implicitly migrate or validate the IDP contract.' \
    'No Docker, database, release, backup, or service action was attempted.' >&2
  exit 75
fi

resolved_root="$(realpath -e -- "$PRODUCTION_ROOT" 2>/dev/null || true)"
if [ -z "$resolved_root" ]; then
  printf 'Deployment root does not exist: %s\n' "$PRODUCTION_ROOT" >&2
  exit 2
fi
if [ "$resolved_root" != "$EXPECTED_ROOT" ]; then
  printf 'Refusing nonstandard production root: %s (expected %s)\n' "$resolved_root" "$EXPECTED_ROOT" >&2
  exit 2
fi
if [ "$RELEASE_ARCHIVE_ROOT" != "$EXPECTED_RELEASE_ARCHIVE_ROOT" ]; then
  printf 'Refusing nonstandard production release archive root.\n' >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  printf 'Production deployment must run as root.\n' >&2
  exit 2
fi
account_record="$(getent passwd 0 2>/dev/null || true)"
IFS=: read -r _ _ _ _ _ account_home _ <<<"$account_record"
safe_account_home="$(realpath -e -- "${account_home:-/root}" 2>/dev/null || true)"
ambient_account_home="$(realpath -e -- "${HOME:-$safe_account_home}" 2>/dev/null || true)"
if [ -z "$safe_account_home" ] || [ ! -d "$safe_account_home" ] || \
  [ "$ambient_account_home" != "$safe_account_home" ]; then
  printf 'Production deployment HOME does not match the root account.\n' >&2
  exit 2
fi

cd "$resolved_root"

# Trust bootstrap: before sourcing any checkout file or starting Node, require
# the on-disk Root/API/Web repositories to be exact clean revisions selected by
# the outer committed-script launcher documented in infra/PUBLISH.md. This
# deliberately uses only absolute system tools in a new environment; the later
# complete release-file verifier remains authoritative for source bytes.
if [ ! -x /usr/bin/env ] || [ ! -x /usr/bin/git ]; then
  printf 'DEPLOYMENT BLOCKED: reviewed system env/git tools are unavailable.\n' >&2
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

verify_bootstrap_repository() {
  local label="$1"
  local repository="$2"
  local expected_variable="$3"
  local expected_commit="${!expected_variable:-}"
  local actual_commit=""
  local actual_top=""
  local replace_refs=""
  local status_output=""

  if ! [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'DEPLOYMENT BLOCKED: %s reviewed commit is missing or invalid.\n' "$label" >&2
    exit 75
  fi
  if [ -L "$repository" ] || [ ! -d "$repository" ] || \
    [ -L "$repository/.git" ] || [ ! -d "$repository/.git" ]; then
    printf 'DEPLOYMENT BLOCKED: %s is not a standalone Git worktree.\n' "$label" >&2
    exit 75
  fi
  if ! actual_top="$("${bootstrap_git[@]}" -C "$repository" rev-parse --show-toplevel 2>/dev/null)" || \
    [ "$actual_top" != "$repository" ]; then
    printf 'DEPLOYMENT BLOCKED: %s Git root is not exact.\n' "$label" >&2
    exit 75
  fi
  if ! actual_commit="$("${bootstrap_git[@]}" -C "$repository" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || \
    [ "$actual_commit" != "$expected_commit" ]; then
    printf 'DEPLOYMENT BLOCKED: %s HEAD does not match the reviewed commit.\n' "$label" >&2
    exit 75
  fi
  if [ -e "$repository/.git/info/grafts" ] || \
    [ -L "$repository/.git/info/grafts" ] || \
    [ -e "$repository/.git/objects/info/alternates" ] || \
    [ -L "$repository/.git/objects/info/alternates" ] || \
    [ -e "$repository/.git/objects/info/http-alternates" ] || \
    [ -L "$repository/.git/objects/info/http-alternates" ]; then
    printf 'DEPLOYMENT BLOCKED: %s Git object substitution metadata exists.\n' "$label" >&2
    exit 75
  fi
  if ! replace_refs="$("${bootstrap_git[@]}" -C "$repository" \
    for-each-ref --format='%(refname)' refs/replace 2>/dev/null)" || \
    [ -n "$replace_refs" ]; then
    printf 'DEPLOYMENT BLOCKED: %s Git replacement refs exist.\n' "$label" >&2
    exit 75
  fi
  if ! status_output="$("${bootstrap_git[@]}" -C "$repository" status \
    --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>/dev/null)" || \
    [ -n "$status_output" ]; then
    printf 'DEPLOYMENT BLOCKED: %s worktree is not clean.\n' "$label" >&2
    exit 75
  fi
}

verify_bootstrap_repository ROOT "$resolved_root" ARENZYRA_REVIEWED_ROOT_COMMIT
verify_bootstrap_repository API "$resolved_root/apps/api" ARENZYRA_REVIEWED_API_COMMIT
verify_bootstrap_repository WEB "$resolved_root/apps/arenzyra-web" ARENZYRA_REVIEWED_WEB_COMMIT
unset bootstrap_git

source scripts/require-local-production-docker.sh
sanitized_environment=(
  env -i
  "PATH=$SAFE_COMMAND_PATH"
  "HOME=$safe_account_home"
)
test -f infra/.env.publish
test -f infra/docker-compose.publish.yml
test -f infra/production-api-migration-safety.json
test -f scripts/production-deploy-preflight.sh
test -f scripts/production-release-safety-gate.sh
test -f scripts/verify-production-entitlement-invariants.sh
test -f scripts/verify-production-idp-encryption.sh
test -f scripts/verify-production-idp-compiled.sh
test -f scripts/verify-idp-maintenance-summary.cjs
test -f scripts/verify-idp-maintenance-mutation-summary.cjs
test -f scripts/production-database-target.cjs
test -f scripts/verify-production-database-container.sh
test -f scripts/verify-production-database-roles.sh
test -f scripts/provision-production-database-roles.sh
test -f scripts/production-api-data-volume-remediation.sh
test -f scripts/production-database-writer-fence.sh
test -f scripts/validate-publish-release-env.cjs
test -f scripts/validate-release-image-manifest.cjs
test -f scripts/production-pinned-image-override.cjs
test -f scripts/verify-production-release-source.cjs

reviewed_env_file="$resolved_root/infra/.env.publish"
if [ -n "${ARENZYRA_DEPLOY_ENV_FILE:-}" ]; then
  process_env_file="$(realpath -e -- "$ARENZYRA_DEPLOY_ENV_FILE" 2>/dev/null || true)"
  if [ "$process_env_file" != "$reviewed_env_file" ]; then
    printf 'Process environment file differs from reviewed infra/.env.publish.\n' >&2
    exit 2
  fi
fi
export ARENZYRA_DEPLOY_ENV_FILE="$reviewed_env_file"

reviewed_compose_project="$(node scripts/read-dotenv-value.cjs infra/.env.publish ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
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
node scripts/production-database-target.cjs --env infra/.env.publish --check

if ! [[ "$LOCK_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [ "$LOCK_TIMEOUT_SECONDS" -gt 300 ]; then
  printf 'ARENZYRA_DEPLOY_LOCK_TIMEOUT_SECONDS must be 0-300.\n' >&2
  exit 2
fi
if ! [[ "$HEALTH_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || \
  [ "$HEALTH_TIMEOUT_SECONDS" -lt 30 ] || \
  [ "$HEALTH_TIMEOUT_SECONDS" -gt 1800 ]; then
  printf 'ARENZYRA_DEPLOY_HEALTH_TIMEOUT_SECONDS must be 30-1800.\n' >&2
  exit 2
fi

verify_lock_directory_safety() {
  local lock_directory lock_directory_mode lock_directory_owner resolved_lock_directory
  lock_directory="$(dirname -- "$LOCK_FILE")"
  if [ -L "$lock_directory" ] || [ ! -d "$lock_directory" ]; then
    printf 'Production deployment lock directory is unsafe.\n' >&2
    return 75
  fi
  resolved_lock_directory="$(realpath -e -- "$lock_directory" 2>/dev/null || true)"
  lock_directory_owner="$(stat -c %u -- "$lock_directory")"
  lock_directory_mode="$(stat -c %a -- "$lock_directory")"
  if [ "$resolved_lock_directory" != "/run" ] || \
    [ "$lock_directory_owner" != "0" ] || \
    ! [[ "$lock_directory_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$lock_directory_mode & 8#022) != 0 )); then
    printf 'Production deployment lock directory ownership or mode is unsafe.\n' >&2
    return 75
  fi
}

verify_lock_file_safety() {
  local descriptor_identity lock_identity lock_mode lock_owner lock_target
  if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ]; then
    printf 'Production deployment lock path is not a regular non-symlink file.\n' >&2
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
    printf 'Production deployment lock file ownership, mode, or identity is unsafe.\n' >&2
    return 75
  fi
}

verify_lock_directory_safety
if [ -e "$LOCK_FILE" ] || [ -L "$LOCK_FILE" ]; then
  if [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ] || \
    [ "$(stat -c '%u:%h' -- "$LOCK_FILE" 2>/dev/null || true)" != "0:1" ]; then
    printf 'Production deployment lock path identity or ownership is unsafe.\n' >&2
    exit 75
  fi
  existing_lock_mode="$(stat -c %a -- "$LOCK_FILE")"
  if ! [[ "$existing_lock_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$existing_lock_mode & 8#022) != 0 )); then
    printf 'Production deployment lock path mode is unsafe.\n' >&2
    exit 75
  fi
fi
exec 8>"$LOCK_FILE"
verify_lock_file_safety
if ! flock -w "$LOCK_TIMEOUT_SECONDS" 8; then
  printf 'Another full or Discord production deployment holds the deployment lock.\n' >&2
  exit 75
fi
verify_lock_file_safety

validate_release_file() {
  local source_file="$1"
  local expected_release="${2:-}"
  local arguments=(--file "$source_file")
  if [ -n "$expected_release" ]; then
    arguments+=(--expected-release "$expected_release")
  fi
  "${sanitized_environment[@]}" \
    node scripts/validate-publish-release-env.cjs "${arguments[@]}" >/dev/null
}

verify_release_archive_root() {
  local archive_parent_mode
  if [ -L /opt ] || [ ! -d /opt ] || \
    [ "$(realpath -e -- /opt 2>/dev/null || true)" != "/opt" ] || \
    [ "$(stat -c '%u:%g' -- /opt 2>/dev/null || true)" != "0:0" ]; then
    printf 'Production release archive parent is not reviewed.\n' >&2
    return 75
  fi
  archive_parent_mode="$(stat -c %a -- /opt)"
  if ! [[ "$archive_parent_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( (8#$archive_parent_mode & 8#022) != 0 )); then
    printf 'Production release archive parent mode is unsafe.\n' >&2
    return 75
  fi
  if [ ! -e "$RELEASE_ARCHIVE_ROOT" ] && [ ! -L "$RELEASE_ARCHIVE_ROOT" ]; then
    mkdir -m 700 -- "$RELEASE_ARCHIVE_ROOT"
  fi
  if [ -L "$RELEASE_ARCHIVE_ROOT" ] || [ ! -d "$RELEASE_ARCHIVE_ROOT" ] || \
    [ "$(realpath -e -- "$RELEASE_ARCHIVE_ROOT" 2>/dev/null || true)" != "$EXPECTED_RELEASE_ARCHIVE_ROOT" ] || \
    [ "$(stat -c '%u:%g:%a' -- "$RELEASE_ARCHIVE_ROOT" 2>/dev/null || true)" != "0:0:700" ]; then
    printf 'Production release archive identity, owner, or mode is not reviewed.\n' >&2
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
    printf 'Archived release file identity, owner, mode, or link count is not reviewed.\n' >&2
    return 75
  fi
  validate_release_file "$archived_file" "$expected_release"
}

archive_release_file() {
  local source_file="$1"
  local archived_file release_id temporary_release_file
  verify_release_archive_root
  validate_release_file "$source_file"
  release_id="$("${sanitized_environment[@]}" node scripts/read-dotenv-value.cjs "$source_file" ARENZYRA_RELEASE_ID)"
  if ! [[ "$release_id" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]]; then
    printf 'Invalid clean release ID in release metadata.\n' >&2
    return 75
  fi
  archived_file="$RELEASE_ARCHIVE_ROOT/$release_id.env"
  temporary_release_file="$(
    mktemp -- "$RELEASE_ARCHIVE_ROOT/.$release_id.release.XXXXXX"
  )"
  case "$temporary_release_file" in
    "$RELEASE_ARCHIVE_ROOT/.$release_id.release."*) ;;
    *)
      printf 'Temporary release metadata escaped the reviewed archive.\n' >&2
      return 75
      ;;
  esac
  if ! install -m 600 -o root -g root -- "$source_file" "$temporary_release_file" || \
    ! validate_release_file "$temporary_release_file" "$release_id"; then
    rm -f -- "$temporary_release_file"
    printf 'Unable to secure the release metadata candidate.\n' >&2
    return 75
  fi
  if [ -e "$archived_file" ] || [ -L "$archived_file" ]; then
    if ! verify_archived_release_file "$archived_file" "$release_id" || \
      ! cmp -s -- "$temporary_release_file" "$archived_file"; then
      rm -f -- "$temporary_release_file"
      printf 'Archived release metadata differs from the candidate with the same ID.\n' >&2
      return 75
    fi
  elif ! ln -- "$temporary_release_file" "$archived_file"; then
    if [ ! -e "$archived_file" ] && [ ! -L "$archived_file" ]; then
      rm -f -- "$temporary_release_file"
      printf 'Unable to archive release metadata without replacement.\n' >&2
      return 75
    fi
    if ! verify_archived_release_file "$archived_file" "$release_id" || \
      ! cmp -s -- "$temporary_release_file" "$archived_file"; then
      rm -f -- "$temporary_release_file"
      printf 'Concurrent same-ID release metadata is not byte-identical.\n' >&2
      return 75
    fi
  fi
  rm -f -- "$temporary_release_file"
  verify_archived_release_file "$archived_file" "$release_id"
  printf '%s\n' "$release_id"
}

verify_archived_release_image_manifest() {
  local manifest_file="$1"
  local release_environment="$2"
  local expected_release="$3"
  local service="$4"
  local expected_basename
  case "$service" in
    api|web|media-ai|discord-bot) ;;
    *)
      printf 'Unsupported release image-manifest service.\n' >&2
      return 75
      ;;
  esac
  expected_basename="$expected_release.${service}-image.json"
  verify_release_archive_root || return $?
  if [ "$release_environment" != "$RELEASE_ARCHIVE_ROOT/$expected_release.env" ] || \
    [ -L "$manifest_file" ] || [ ! -f "$manifest_file" ] || \
    [ "$(dirname -- "$(realpath -e -- "$manifest_file" 2>/dev/null || true)")" != "$RELEASE_ARCHIVE_ROOT" ] || \
    [ "$(basename -- "$manifest_file")" != "$expected_basename" ] || \
    [ "$(stat -c '%u:%g:%a:%h' -- "$manifest_file" 2>/dev/null || true)" != "0:0:600:1" ]; then
    printf 'Archived release image manifest identity, owner, mode, or link count is not reviewed.\n' >&2
    return 75
  fi
  verify_archived_release_file "$release_environment" "$expected_release"
  "${sanitized_environment[@]}" \
    node scripts/validate-release-image-manifest.cjs \
      --file "$manifest_file" \
      --release-env "$release_environment" \
      --expected-release "$expected_release" \
      --service "$service" >/dev/null
}

archive_built_image_manifest() {
  local service="$1"
  local image_repository image_reference archived_manifest temporary_manifest
  case "$service" in
    api) image_repository="arenzyra-api" ;;
    web) image_repository="arenzyra-web" ;;
    media-ai) image_repository="arenzyra-media-ai" ;;
    discord-bot) image_repository="arenzyra-discord-bot" ;;
    *)
      printf 'Unsupported built image-manifest service.\n' >&2
      return 75
      ;;
  esac
  verify_release_archive_root
  verify_archived_release_file "$release_env" "$new_release_id"
  image_reference="$image_repository:$new_release_id"
  archived_manifest="$RELEASE_ARCHIVE_ROOT/$new_release_id.${service}-image.json"
  temporary_manifest="$(
    mktemp -- "$RELEASE_ARCHIVE_ROOT/.$new_release_id.${service}.image.XXXXXX"
  )"
  case "$temporary_manifest" in
    "$RELEASE_ARCHIVE_ROOT/.$new_release_id.${service}.image."*) ;;
    *)
      printf 'Temporary release image manifest escaped the reviewed archive.\n' >&2
      return 75
      ;;
  esac

  if ! docker image inspect "$image_reference" |
    "${sanitized_environment[@]}" \
      node scripts/validate-release-image-manifest.cjs \
        --from-docker-inspect \
        --release-env "$release_env" \
        --expected-release "$new_release_id" \
        --service "$service" > "$temporary_manifest"; then
    rm -f -- "$temporary_manifest"
    printf 'Built image identity does not match the archived release.\n' >&2
    return 75
  fi
  if ! chmod 600 -- "$temporary_manifest" || \
    ! chown root:root -- "$temporary_manifest"; then
    rm -f -- "$temporary_manifest"
    printf 'Unable to secure the release image manifest candidate.\n' >&2
    return 75
  fi
  if ! "${sanitized_environment[@]}" \
    node scripts/validate-release-image-manifest.cjs \
      --file "$temporary_manifest" \
      --release-env "$release_env" \
      --expected-release "$new_release_id" \
      --service "$service" >/dev/null; then
    rm -f -- "$temporary_manifest"
    return 75
  fi

  if [ -e "$archived_manifest" ] || [ -L "$archived_manifest" ]; then
    if ! verify_archived_release_image_manifest \
      "$archived_manifest" "$release_env" "$new_release_id" "$service" || \
      ! cmp -s -- "$temporary_manifest" "$archived_manifest"; then
      rm -f -- "$temporary_manifest"
      printf 'Archived image manifest differs from the built image with the same release ID.\n' >&2
      return 75
    fi
  elif ! ln -- "$temporary_manifest" "$archived_manifest"; then
    # Never replace a same-ID path. A root-only concurrent creator is accepted
    # only when its completed manifest validates and is byte-for-byte identical.
    if [ ! -e "$archived_manifest" ] && [ ! -L "$archived_manifest" ]; then
      rm -f -- "$temporary_manifest"
      printf 'Unable to archive the release image manifest.\n' >&2
      return 75
    fi
    if ! verify_archived_release_image_manifest \
      "$archived_manifest" "$release_env" "$new_release_id" "$service" || \
      ! cmp -s -- "$temporary_manifest" "$archived_manifest"; then
      rm -f -- "$temporary_manifest"
      printf 'Concurrent same-ID image manifest is not byte-identical.\n' >&2
      return 75
    fi
  fi
  rm -f -- "$temporary_manifest"
  verify_archived_release_image_manifest \
    "$archived_manifest" "$release_env" "$new_release_id" "$service"
  printf 'RELEASE IMAGE MANIFEST VERIFIED service=%s release=%s path=%s\n' \
    "$service" "$new_release_id" "$archived_manifest"
}

read_archived_release_image_id() {
  local service="$1"
  local manifest_file="$RELEASE_ARCHIVE_ROOT/$new_release_id.${service}-image.json"
  verify_archived_release_image_manifest \
    "$manifest_file" "$release_env" "$new_release_id" "$service"
  "${sanitized_environment[@]}" \
    node scripts/validate-release-image-manifest.cjs \
      --file "$manifest_file" \
      --release-env "$release_env" \
      --expected-release "$new_release_id" \
      --service "$service" \
      --print-image-id
}

verify_clean_release_source() {
  verify_archived_release_file "$release_env" "$new_release_id"
  "${sanitized_environment[@]}" \
    node scripts/verify-production-release-source.cjs \
      --release-env "$release_env"
}

attest_pinned_compose_override() {
  local descriptor_identity descriptor_target current_digest path_identity
  if [ "$pinned_override_fd_open" -ne 1 ] || \
    [ -z "$pinned_override_path" ] || \
    [ -z "$pinned_override_digest" ] || \
    [ -L "$pinned_override_path" ] || [ ! -f "$pinned_override_path" ] || \
    [ "$(dirname -- "$(realpath -e -- "$pinned_override_path" 2>/dev/null || true)")" != "/run" ] || \
    [ "$(stat -c '%u:%g:%a:%h' -- "$pinned_override_path" 2>/dev/null || true)" != "0:0:600:1" ]; then
    printf 'Pinned Compose override path, owner, mode, or link count is unsafe.\n' >&2
    return 75
  fi
  case "$pinned_override_path" in
    "/run/arenzyra-pinned-compose.$new_release_id.$pinned_override_mode."*) ;;
    *)
      printf 'Pinned Compose override path is not bound to this release.\n' >&2
      return 75
      ;;
  esac
  descriptor_target="$(readlink -f "/proc/$$/fd/9" 2>/dev/null || true)"
  path_identity="$(stat -Lc '%d:%i:%h' -- "$pinned_override_path" 2>/dev/null || true)"
  descriptor_identity="$(stat -Lc '%d:%i:%h' -- "/proc/$$/fd/9" 2>/dev/null || true)"
  if [ "$descriptor_target" != "$pinned_override_path" ] || \
    [ "$path_identity" != "$descriptor_identity" ] || \
    [ "${descriptor_identity##*:}" != "1" ]; then
    printf 'Pinned Compose override descriptor identity is unsafe.\n' >&2
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
    printf 'Pinned Compose override content or identity changed.\n' >&2
    return 75
  fi
}

create_pinned_compose_override() {
  local mode="$1"
  if [ "$pinned_override_fd_open" -ne 0 ] || [ -n "$pinned_override_path" ]; then
    printf 'Pinned Compose override was already created.\n' >&2
    return 75
  fi
  pinned_override_mode="$mode"
  case "$mode" in
    full)
      pinned_override_validator_args=(
        --mode full
        --api-image-id "$api_image_id"
        --web-image-id "$web_image_id"
        --media-ai-image-id "$media_ai_image_id"
      )
      ;;
    discord-bot)
      pinned_override_validator_args=(
        --mode discord-bot
        --discord-bot-image-id "$discord_bot_image_id"
      )
      ;;
    legacy-cutover)
      pinned_override_validator_args=(
        --mode legacy-cutover
        --api-image-id "$api_image_id"
        --web-image-id "$web_image_id"
        --media-ai-image-id "$media_ai_image_id"
        --discord-bot-image-id "$discord_bot_image_id"
      )
      ;;
    *)
      printf 'Unsupported pinned Compose override mode.\n' >&2
      return 75
      ;;
  esac
  pinned_override_path="$(
    mktemp -- "/run/arenzyra-pinned-compose.$new_release_id.$mode.XXXXXX"
  )"
  case "$pinned_override_path" in
    "/run/arenzyra-pinned-compose.$new_release_id.$mode."*) ;;
    *)
      printf 'Pinned Compose override escaped /run.\n' >&2
      return 75
      ;;
  esac
  if ! "${sanitized_environment[@]}" \
    node scripts/production-pinned-image-override.cjs \
      "${pinned_override_validator_args[@]}" --create > "$pinned_override_path" || \
    ! chmod 600 -- "$pinned_override_path" || \
    ! chown root:root -- "$pinned_override_path"; then
    printf 'Unable to create the pinned Compose override.\n' >&2
    return 75
  fi
  pinned_override_digest="$(
    "${sanitized_environment[@]}" \
      node scripts/production-pinned-image-override.cjs \
        "${pinned_override_validator_args[@]}" \
        --validate-stdin --print-sha256 < "$pinned_override_path"
  )"
  if ! [[ "$pinned_override_digest" =~ ^[a-f0-9]{64}$ ]]; then
    printf 'Pinned Compose override digest is invalid.\n' >&2
    return 75
  fi
  exec 9<"$pinned_override_path"
  pinned_override_fd_open=1
  attest_pinned_compose_override
  compose+=( -f "/proc/$$/fd/9" )
}

attest_idp_verification_override() {
  local current_digest descriptor_identity descriptor_target path_identity
  if [ "$idp_verification_override_fd_open" -ne 1 ] || \
    [ -z "$idp_verification_override_path" ] || \
    [ -z "$idp_verification_override_digest" ] || \
    [ -z "$idp_verification_override_identity" ]; then
    printf 'IDP verification image override is incomplete.\n' >&2
    return 75
  fi
  case "$idp_verification_override_path" in
    "/run/arenzyra-idp-verification.$new_release_id."*) ;;
    *)
      printf 'IDP verification image override path is not bound to this release.\n' >&2
      return 75
      ;;
  esac
  descriptor_target="$(readlink -f "/proc/$$/fd/10" 2>/dev/null || true)"
  descriptor_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- "/proc/$$/fd/10" 2>/dev/null || true)"
  path_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- "$idp_verification_override_path" 2>/dev/null || true)"
  current_digest="$(
    "${sanitized_environment[@]}" \
      node scripts/production-pinned-image-override.cjs \
        --mode idp-maintenance --api-image-id "$api_image_id" \
        --validate-stdin --print-sha256 <"/proc/$$/fd/10"
  )"
  if [ "$descriptor_target" != "$idp_verification_override_path" ] || \
    [ "$descriptor_identity" != "$idp_verification_override_identity" ] || \
    [ "$path_identity" != "$idp_verification_override_identity" ] || \
    [ "$current_digest" != "$idp_verification_override_digest" ]; then
    printf 'IDP verification image override content or identity changed.\n' >&2
    return 75
  fi
}

create_idp_verification_override() {
  if { [ "$pinned_override_mode" != "full" ] && \
    [ "$pinned_override_mode" != "legacy-cutover" ]; } || \
    [ "$idp_verification_override_fd_open" -ne 0 ] || \
    [ -n "$idp_verification_override_path" ] || \
    ! [[ "$api_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    printf 'IDP verification image override prerequisites are incomplete.\n' >&2
    return 75
  fi
  idp_verification_override_path="$(
    mktemp -- "/run/arenzyra-idp-verification.$new_release_id.XXXXXX"
  )"
  case "$idp_verification_override_path" in
    "/run/arenzyra-idp-verification.$new_release_id."*) ;;
    *) return 75 ;;
  esac
  if ! "${sanitized_environment[@]}" \
    node scripts/production-pinned-image-override.cjs \
      --mode idp-maintenance --api-image-id "$api_image_id" --create \
      >"$idp_verification_override_path" || \
    ! chmod 600 -- "$idp_verification_override_path" || \
    ! chown root:root -- "$idp_verification_override_path"; then
    printf 'Unable to create the IDP verification image override.\n' >&2
    return 75
  fi
  idp_verification_override_digest="$(
    "${sanitized_environment[@]}" \
      node scripts/production-pinned-image-override.cjs \
        --mode idp-maintenance --api-image-id "$api_image_id" \
        --validate-stdin --print-sha256 <"$idp_verification_override_path"
  )"
  [[ "$idp_verification_override_digest" =~ ^[a-f0-9]{64}$ ]] || return 75
  idp_verification_override_identity="$(
    stat -Lc '%d:%i:%u:%g:%a:%h' -- "$idp_verification_override_path"
  )"
  case "$idp_verification_override_identity" in
    *:0:0:600:1) ;;
    *) return 75 ;;
  esac
  exec 10<"$idp_verification_override_path"
  idp_verification_override_fd_open=1
  attest_idp_verification_override
}

attest_idp_database_identity() {
  local physical_identity
  local -a database_binding
  mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
  [ "${#database_binding[@]}" -eq 5 ] || return 75
  physical_identity="$(
    docker exec "${database_binding[0]}" sh -ceu '
      database="$1"
      export PGCONNECT_TIMEOUT=10
      export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000"
      exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At -F " " -c \
        "SELECT database_record.datname, database_record.oid, control_record.system_identifier
           FROM pg_catalog.pg_database AS database_record
           CROSS JOIN pg_catalog.pg_control_system() AS control_record
          WHERE database_record.datname = current_database();"
    ' sh "${database_binding[3]}"
  )" || return 75
  if ! [[ "$physical_identity" =~ ^([A-Za-z0-9_][A-Za-z0-9_.-]{0,62})[[:space:]]([1-9][0-9]{0,9})[[:space:]]([0-9]{10,24})$ ]] || \
    [ "${BASH_REMATCH[1]}" != "${database_binding[3]}" ]; then
    printf 'IDP verification physical database identity is invalid.\n' >&2
    return 75
  fi
  idp_database_name="${BASH_REMATCH[1]}"
  idp_database_oid="${BASH_REMATCH[2]}"
  idp_database_system_identifier="${BASH_REMATCH[3]}"
}

verify_compiled_idp_storage() {
  attest_pinned_compose_override
  attest_idp_verification_override
  attest_idp_database_identity
  "${sanitized_environment[@]}" \
    "DOCKER_HOST=$DOCKER_HOST" \
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$compose_project" \
    "ARENZYRA_DEPLOY_ENV_FILE=$reviewed_env_file" \
    "ARENZYRA_DEPLOY_LOCK_INHERITED=1" \
    "ARENZYRA_IDP_API_IMAGE_ID=$api_image_id" \
    "ARENZYRA_IDP_RELEASE_ENV_FILE=$release_env" \
    "ARENZYRA_IDP_API_IMAGE_MANIFEST=$RELEASE_ARCHIVE_ROOT/$new_release_id.api-image.json" \
    "ARENZYRA_EXPECTED_DATABASE_NAME=$idp_database_name" \
    "ARENZYRA_EXPECTED_DATABASE_OID=$idp_database_oid" \
    "ARENZYRA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER=$idp_database_system_identifier" \
    bash scripts/verify-production-idp-compiled.sh
}

run_idp_cutover_action() {
  local action="$1" service verifier_flag
  local -a idp_compose
  case "$action" in
    dry-run)
      service=api-maintenance-idp-dry-run
      verifier_flag=--require-clean
      ;;
    apply)
      service=api-maintenance-idp-apply
      verifier_flag=--apply
      ;;
    validate)
      service=api-maintenance-idp-validate
      verifier_flag=--validate
      ;;
    *) return 75 ;;
  esac
  attest_pinned_compose_override
  attest_idp_verification_override
  attest_idp_database_identity
  idp_compose=(
    "${sanitized_environment[@]}"
    "DOCKER_HOST=$DOCKER_HOST"
    "ARENZYRA_EXPECTED_DATABASE_NAME=$idp_database_name"
    "ARENZYRA_EXPECTED_DATABASE_OID=$idp_database_oid"
    "ARENZYRA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER=$idp_database_system_identifier"
    docker compose -p "$compose_project"
    --env-file infra/.env.publish --env-file "$release_env"
    -f infra/docker-compose.publish.yml -f /proc/$$/fd/9 -f /proc/$$/fd/10
  )
  if [ "$action" = dry-run ]; then
    "${idp_compose[@]}" --profile maintenance run --rm --no-deps \
      --pull never -T "$service" \
      | "${sanitized_environment[@]}" \
          node scripts/verify-idp-maintenance-summary.cjs "$verifier_flag"
  else
    "${idp_compose[@]}" --profile maintenance run --rm --no-deps \
      --pull never -T "$service" \
      | "${sanitized_environment[@]}" \
          node scripts/verify-idp-maintenance-mutation-summary.cjs \
            "$verifier_flag"
  fi
}

verify_running_release_images() {
  local actual_image_id container_id expected_image_id service
  local -a runtime_services
  case "$pinned_override_mode" in
    full) runtime_services=(api web media-ai) ;;
    discord-bot) runtime_services=(discord-bot) ;;
    legacy-cutover) runtime_services=(api web media-ai discord-bot) ;;
    *) return 75 ;;
  esac
  attest_pinned_compose_override
  for service in "${runtime_services[@]}"; do
    case "$service" in
      api) expected_image_id="$api_image_id" ;;
      web) expected_image_id="$web_image_id" ;;
      media-ai) expected_image_id="$media_ai_image_id" ;;
      discord-bot) expected_image_id="$discord_bot_image_id" ;;
    esac
    if [ "$service" = "discord-bot" ]; then
      container_id="$("${compose[@]}" --profile discord-bot ps -q "$service")"
    else
      container_id="$("${compose[@]}" ps -q "$service")"
    fi
    if ! [[ "$container_id" =~ ^[a-f0-9]{12,64}$ ]]; then
      printf 'Running release service has ambiguous or missing container identity: %s\n' "$service" >&2
      return 75
    fi
    actual_image_id="$(docker inspect --format '{{.Image}}' "$container_id")"
    if [ "$actual_image_id" != "$expected_image_id" ]; then
      printf 'Running release service image differs from its archived image ID: %s\n' "$service" >&2
      return 75
    fi
  done
}

read_release_pointer() {
  local pointer_name="$1"
  local pointer_file="$RELEASE_ARCHIVE_ROOT/$pointer_name"
  local -a pointer_lines
  verify_release_archive_root || return $?
  if [ -L "$pointer_file" ] || [ ! -f "$pointer_file" ] || \
    [ "$(stat -c '%u:%g:%a:%h' -- "$pointer_file" 2>/dev/null || true)" != "0:0:600:1" ]; then
    printf 'Release pointer identity, owner, mode, or link count is not reviewed.\n' >&2
    return 75
  fi
  mapfile -t pointer_lines < "$pointer_file"
  if [ "${#pointer_lines[@]}" -ne 1 ] || \
    ! [[ "${pointer_lines[0]}" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]]; then
    printf 'Release pointer content is invalid.\n' >&2
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

deploy_failed() {
  local status="$?"
  printf '\nDEPLOYMENT FAILED (status=%s). Database migrations are forward-only and were not rolled back.\n' "$status" >&2
  printf 'Review infra/PUBLISH.md and infra/BACKUP_RESTORE.md before recovery.\n' >&2
  if [ "$schema_change_possible" -eq 1 ]; then
    printf 'Schema changes may have committed. Do not start an older API image or perform an image-only rollback.\n' >&2
    printf 'Keep incompatible old writers stopped and use a reviewed forward-recovery plan.\n' >&2
  elif [ "$MODE" = "discord-bot" ] && [[ "$prior_release_id" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    printf 'Discord-bot-only rollback candidate release=%q. Use the reviewed-current-Root committed rollback launcher in infra/PUBLISH.md.\n' \
      "$prior_release_id" >&2
  else
    printf 'The API schema was not entered by this run; inspect current service state before any recovery action.\n' >&2
  fi
  exit "$status"
}

"${sanitized_environment[@]}" node scripts/verify-production-api-capabilities.cjs
node scripts/preflight-publish.cjs --env infra/.env.publish
guard_args=()
if [ "$FIRST_DEPLOY" -eq 1 ]; then
  guard_args+=(--skip-health)
fi
if [ "$MODE" = "legacy-cutover" ]; then
  guard_args+=(--allow-read-only-legacy-backup)
elif [ "$MODE" = "legacy-cutover-resume" ]; then
  guard_args+=(--allow-legacy-cutover-stopped)
elif [ "$MODE" = "legacy-cutover-resume-interrupted" ]; then
  guard_args+=(--allow-legacy-cutover-interrupted)
fi
# Before release metadata, image builds, backups, migrations, or service
# changes, prove that the current database has no pending contract migration
# that an existing API writer cannot survive. The normal full-deploy path has
# no first-deploy exemption; an empty target requires a separate reviewed
# bootstrap that is intentionally outside this entrypoint. Discord-only mode
# still runs this pre-metadata guard; its first-deploy form skips only health.
bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
if [ "$MODE" = "full" ]; then
  bash scripts/production-release-safety-gate.sh
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash scripts/verify-production-database-roles.sh
  # Aggregate-only and read-only: no organization identifiers or mutable
  # reconciliation are part of a routine release. The gate also requires zero
  # unresolved clock-bounded access denials.
  bash scripts/verify-production-entitlement-invariants.sh
  # This pre-build structural prerequisite is necessary but not the final IDP
  # evidence. The immutable candidate image performs authenticated dry-runs
  # before any subsequent release mutation and again after health convergence.
  bash scripts/verify-production-idp-encryption.sh
elif [ "$MODE" = "legacy-cutover" ] || \
  [ "$MODE" = "legacy-cutover-resume" ] || \
  [ "$MODE" = "legacy-cutover-resume-interrupted" ]; then
  bash scripts/production-release-safety-gate.sh --legacy-cutover
  bash scripts/verify-production-entitlement-invariants.sh \
    --allow-running-legacy-cutover
fi

verify_release_archive_root
if [ -e "$RELEASE_ARCHIVE_ROOT/CURRENT" ] || [ -L "$RELEASE_ARCHIVE_ROOT/CURRENT" ]; then
  prior_release_id="$(read_release_pointer CURRENT)"
elif [ -f infra/.env.release ]; then
  if validate_release_file infra/.env.release >/dev/null 2>&1; then
    prior_release_id="$(archive_release_file infra/.env.release)"
  else
    printf 'Existing unverified release metadata is not eligible for rollback and was not archived.\n' >&2
  fi
fi

trap deploy_failed ERR
# This fails closed for dirty, missing, or unavailable root/API/web Git
# provenance. The emergency override is intentionally not exposed here.
"${sanitized_environment[@]}" \
  node scripts/verify-production-release-source.cjs --check-checkout-only
"${sanitized_environment[@]}" node scripts/create-publish-release-metadata.cjs
new_release_id="$(archive_release_file infra/.env.release)"
release_env="$RELEASE_ARCHIVE_ROOT/$new_release_id.env"
verify_archived_release_file "$release_env" "$new_release_id"
verify_clean_release_source

compose=(
  "${sanitized_environment[@]}"
  "DOCKER_HOST=$DOCKER_HOST"
  docker compose
  -p "$compose_project"
  --env-file infra/.env.publish
  --env-file "$release_env"
  -f infra/docker-compose.publish.yml
)
if ! "${compose[@]}" --profile migration --profile maintenance config --format json \
  | node scripts/production-database-target.cjs \
      --env infra/.env.publish --assert-compose-json; then
  printf 'DEPLOYMENT BLOCKED: resolved Compose database bindings differ from the reviewed environment.\n' >&2
  exit 75
fi
wait_for_health() {
  local services=("$@")
  local deadline=$((SECONDS + 10#$HEALTH_TIMEOUT_SECONDS))
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
    [ "${#pending[@]}" -eq 0 ] && return 0
    if [ "$SECONDS" -ge "$deadline" ]; then
      printf 'Deployment health convergence failed: %s\n' "${pending[*]}" >&2
      "${compose[@]}" --profile discord-bot ps >&2 || true
      return 1
    fi
    sleep 5
  done
}

verified_backup_id=""
verified_backup_dir=""
verified_backup_not_before_epoch=""
create_pre_migration_backup() {
  local backup_start_epoch backup_root backup_id backup_dir resolved_backup_dir
  local marker_epoch result_file
  local -a backup_result backup_environment backup_arguments

  runtime_temp_dir="$(mktemp -d /run/arenzyra-pre-migration-backup.XXXXXX)"
  chmod 700 "$runtime_temp_dir"
  result_file="$runtime_temp_dir/result"
  backup_start_epoch="$(date +%s)"
  backup_environment=(
    "ARENZYRA_BACKUP_ENV_FILE=$resolved_root/infra/.env.publish"
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$compose_project"
    "ARENZYRA_BACKUP_REASON=pre-migration:$new_release_id"
    "ARENZYRA_BACKUP_RESULT_FILE=$result_file"
    "ARENZYRA_BACKUP_REQUIRE_OFFSITE=1"
    "ARENZYRA_BACKUP_ALLOW_MISSING_APP_VOLUMES=0"
    "ARENZYRA_DEPLOY_LOCK_INHERITED=1"
  )

  backup_arguments=()
  if [ "$MODE" = "legacy-cutover" ]; then
    backup_arguments+=(--allow-running-legacy-backup)
  elif [ "$MODE" = "legacy-cutover-resume" ]; then
    backup_arguments+=(--allow-stopped-legacy-cutover)
  elif [ "$MODE" = "legacy-cutover-resume-interrupted" ]; then
    backup_arguments+=(--allow-interrupted-legacy-cutover)
  fi
  env "${backup_environment[@]}" \
    bash scripts/production-backup.sh "${backup_arguments[@]}"
  test -f "$result_file"
  mapfile -t backup_result < "$result_file"
  if [ "${#backup_result[@]}" -ne 2 ]; then
    printf 'Pre-migration backup returned an invalid result.\n' >&2
    return 1
  fi
  backup_id="${backup_result[0]}"
  backup_dir="${backup_result[1]}"
  if ! [[ "$backup_id" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]]; then
    printf 'Pre-migration backup returned an invalid backup ID: %s\n' "$backup_id" >&2
    return 1
  fi

  backup_root="$(node scripts/read-dotenv-value.cjs infra/.env.publish ARENZYRA_RECOVERY_V1_ROOT)"
  if [ -z "$backup_root" ]; then
    backup_root="$(node scripts/read-dotenv-value.cjs infra/.env.publish ARENZYRA_BACKUP_ROOT)"
  fi
  backup_root="${backup_root:-/opt/arenzyra-backups}"
  backup_root="$(realpath -e -- "$backup_root")"
  resolved_backup_dir="$(realpath -e -- "$backup_dir")"
  if [ "$(dirname -- "$resolved_backup_dir")" != "$backup_root" ] || \
    [ "$(basename -- "$resolved_backup_dir")" != "$backup_id" ]; then
    printf 'Pre-migration backup escaped its configured root: %s\n' "$resolved_backup_dir" >&2
    return 1
  fi
  for artifact in BACKUP_COMPLETE database.dump.age database-globals.sql.age metadata.txt.age manifest.sha256.age; do
    if [ ! -s "$resolved_backup_dir/$artifact" ]; then
      printf 'Pre-migration backup artifact is missing or empty: %s\n' "$artifact" >&2
      return 1
    fi
  done
  marker_epoch="$(stat -c %Y -- "$resolved_backup_dir/BACKUP_COMPLETE")"
  if ! [[ "$marker_epoch" =~ ^[0-9]+$ ]] || [ "$marker_epoch" -lt "$backup_start_epoch" ]; then
    printf 'Pre-migration backup completion marker is stale.\n' >&2
    return 1
  fi

  printf 'PRE-MIGRATION BACKUP VERIFIED id=%s path=%s\n' "$backup_id" "$resolved_backup_dir"
  verified_backup_id="$backup_id"
  verified_backup_dir="$resolved_backup_dir"
  verified_backup_not_before_epoch="$backup_start_epoch"
  rm -f -- "$result_file"
  rmdir -- "$runtime_temp_dir"
  runtime_temp_dir=""
}

if [ "$MODE" = "discord-bot" ]; then
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  "${compose[@]}" --profile discord-bot build discord-bot
  verify_clean_release_source
  archive_built_image_manifest discord-bot
  discord_bot_image_id="$(read_archived_release_image_id discord-bot)"
  create_pinned_compose_override discord-bot
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  attest_pinned_compose_override
  "${compose[@]}" --profile discord-bot up --no-build -d --pull never --no-deps discord-bot
  services=(discord-bot)
elif [ "$MODE" = "full" ]; then
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  "${compose[@]}" build api media-ai web
  verify_clean_release_source
  archive_built_image_manifest api
  archive_built_image_manifest web
  archive_built_image_manifest media-ai
  api_image_id="$(read_archived_release_image_id api)"
  web_image_id="$(read_archived_release_image_id web)"
  media_ai_image_id="$(read_archived_release_image_id media-ai)"
  create_pinned_compose_override full
  create_idp_verification_override
  # The candidate image is now immutable and archived. Before backup, schema,
  # or service mutation, authenticate every envelope and inspect persisted
  # message storage through its exact compiled read-only utility.
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  verify_compiled_idp_storage
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  create_pre_migration_backup
  # Backup creation can consume enough root-disk capacity to invalidate the
  # preceding guard, so the mandatory preflight is repeated immediately before
  # the first schema mutation.
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  bash scripts/verify-production-entitlement-invariants.sh
  # The entitlement query is read-only but can take time; repeat the required
  # disk/service preflight literally immediately before schema mutation.
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  schema_change_possible=1
  attest_pinned_compose_override
  "${compose[@]}" --profile migration run --rm --no-deps --pull never api-migrate
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  attest_pinned_compose_override
  "${compose[@]}" --profile migration run --rm --no-deps --pull never studio-migrate
  # Reconcile explicit runtime grants only after both migration owners have
  # created their objects. Ownership drift and runtime ledger access fail shut.
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    ARENZYRA_DEPLOY_VERIFIED_BACKUP_ID="$verified_backup_id" \
    ARENZYRA_DEPLOY_VERIFIED_BACKUP_DIR="$verified_backup_dir" \
    ARENZYRA_DEPLOY_VERIFIED_BACKUP_NOT_BEFORE_EPOCH="$verified_backup_not_before_epoch" \
    bash scripts/provision-production-database-roles.sh \
      --env infra/.env.publish --apply
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash scripts/verify-production-database-roles.sh
  bash scripts/verify-production-entitlement-invariants.sh
  # Preserve the literal immediate-operation guard after all grant and
  # entitlement checks.
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  attest_pinned_compose_override
  "${compose[@]}" up --no-build -d --pull never
  services=(proxy postgres redis api media-ai web)
else
  # One-time forward-only conversion of the exact reviewed legacy profile, or
  # its stopped-state resume. The initial path completes candidate images and
  # an off-site recovery point before the first writer stops. The resume keeps
  # writers stopped and creates a new recovery point before continuing. Once
  # ownership or schema work starts, failures keep writers stopped and roles
  # fenced.
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  "${compose[@]}" build api media-ai web
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  "${compose[@]}" --profile discord-bot build discord-bot
  verify_clean_release_source
  for built_service in api web media-ai discord-bot; do
    archive_built_image_manifest "$built_service"
  done
  api_image_id="$(read_archived_release_image_id api)"
  web_image_id="$(read_archived_release_image_id web)"
  media_ai_image_id="$(read_archived_release_image_id media-ai)"
  discord_bot_image_id="$(read_archived_release_image_id discord-bot)"
  create_pinned_compose_override legacy-cutover
  create_idp_verification_override

  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  attest_pinned_compose_override
  "${compose[@]}" pull postgres redis proxy
  bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
  create_pre_migration_backup

  # A resume starts only from the exact stopped legacy topology and takes a new
  # verified off-site recovery point before any credential or database change.
  # The initial path instead stops writers only after its fresh backup.
  if [ "$MODE" = "legacy-cutover" ]; then
    bash scripts/verify-production-entitlement-invariants.sh \
      --allow-running-legacy-cutover
    bash scripts/production-deploy-preflight.sh "${guard_args[@]}"
    attest_pinned_compose_override
    "${compose[@]}" --profile discord-bot stop -t 60 \
      proxy web api media-ai discord-bot
  fi
  pre_remediation_preflight=(--allow-legacy-cutover-stopped)
  partial_adoption_args=(--legacy-cutover-partial)
  volume_remediation_args=()
  post_remediation_preflight=(--allow-cutover-stopped)
  if [ "$MODE" = "legacy-cutover-resume-interrupted" ]; then
    pre_remediation_preflight=(--allow-legacy-cutover-interrupted)
    partial_adoption_args+=(--legacy-cutover-interrupted)
    volume_remediation_args+=(--legacy-cutover-interrupted)
    post_remediation_preflight=(--allow-cutover-interrupted)
  fi
  bash scripts/production-deploy-preflight.sh \
    "${pre_remediation_preflight[@]}"
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    ARENZYRA_DEPLOY_VERIFIED_BACKUP_ID="$verified_backup_id" \
    ARENZYRA_DEPLOY_VERIFIED_BACKUP_DIR="$verified_backup_dir" \
    ARENZYRA_DEPLOY_VERIFIED_BACKUP_NOT_BEFORE_EPOCH="$verified_backup_not_before_epoch" \
    bash scripts/provision-production-database-roles.sh \
      --env infra/.env.publish --apply --adopt-reviewed-ownership \
      --writers-stopped --confirm=ADOPT_REVIEWED_DATABASE_OWNERSHIP \
      "${partial_adoption_args[@]}"
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash scripts/production-api-data-volume-remediation.sh \
      "${volume_remediation_args[@]}"

  bash scripts/production-deploy-preflight.sh \
    "${post_remediation_preflight[@]}"
  attest_pinned_compose_override
  "${compose[@]}" --profile discord-bot down --remove-orphans
  bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  attest_pinned_compose_override
  "${compose[@]}" up --no-build -d --pull never postgres redis
  wait_for_health postgres redis
  bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  bash scripts/verify-production-database-container.sh >/dev/null

  # From this point a durable database-login fence or a forward schema change
  # may exist. Failure must never restart an older application writer.
  schema_change_possible=1
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash scripts/production-database-writer-fence.sh \
      --engage --release-id "$new_release_id"
  # Reconcile only the exact legacy ACTIVE stale-trial shape and the historical
  # Prisma zero-step bookkeeping field after the fresh off-site recovery point,
  # immutable candidate build, stopped writers, target upgrade, and durable
  # role fence. The transaction proves every other entitlement is canonical.
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash scripts/reconcile-production-legacy-prisma-ledger.sh \
      --release-id "$new_release_id"
  bash scripts/verify-production-entitlement-invariants.sh
  bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  attest_pinned_compose_override
  "${compose[@]}" --profile migration run --rm --no-deps --pull never api-migrate
  bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  attest_pinned_compose_override
  "${compose[@]}" --profile migration run --rm --no-deps --pull never studio-migrate

  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash scripts/provision-production-database-roles.sh \
      --env infra/.env.publish --apply --runtime-roles-fenced
  bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  run_idp_cutover_action apply
  bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  run_idp_cutover_action validate
  bash scripts/verify-production-idp-encryption.sh
  bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  run_idp_cutover_action dry-run

  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash scripts/production-database-writer-fence.sh \
      --release --release-id "$new_release_id"
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash scripts/verify-production-database-roles.sh

  bash scripts/production-deploy-preflight.sh --allow-cutover-transition
  attest_pinned_compose_override
  "${compose[@]}" up --no-build -d --pull never
  wait_for_health proxy postgres redis api media-ai web
  bash scripts/production-deploy-preflight.sh
  attest_pinned_compose_override
  "${compose[@]}" --profile discord-bot up --no-build -d --pull never \
    --no-deps discord-bot
  wait_for_health discord-bot
  services=(proxy postgres redis api media-ai web discord-bot)
fi

verify_running_release_images
wait_for_health "${services[@]}"

"${compose[@]}" --profile discord-bot ps
if [ "$MODE" = "full" ] || [ "$MODE" = "legacy-cutover" ] || \
  [ "$MODE" = "legacy-cutover-resume" ] || \
  [ "$MODE" = "legacy-cutover-resume-interrupted" ]; then
  ARENZYRA_DEPLOY_LOCK_INHERITED=1 \
    bash scripts/verify-production-database-roles.sh
  bash scripts/verify-production-entitlement-invariants.sh
  bash scripts/verify-production-idp-encryption.sh
  bash scripts/production-deploy-preflight.sh
  verify_compiled_idp_storage
fi
node scripts/verify-publish.cjs --env infra/.env.publish
verify_running_release_images
if [[ "$prior_release_id" =~ ^[a-zA-Z0-9._-]+$ ]] && [ "$prior_release_id" != "$new_release_id" ]; then
  write_release_pointer PREVIOUS "$prior_release_id"
fi
write_release_pointer CURRENT "$new_release_id"
trap - ERR
cleanup_runtime_files
trap - EXIT
printf 'DEPLOYMENT VERIFIED mode=%s release=%s\n' "$MODE" "$new_release_id"
