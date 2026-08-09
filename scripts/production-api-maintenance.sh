#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
PRODUCTION_ROOT="${ARENZYRA_PRODUCTION_ROOT:-/opt/arenzyra}"
EXPECTED_ROOT="/opt/arenzyra"
ENV_FILE="/opt/arenzyra/infra/.env.publish"
RELEASE_FILE="/opt/arenzyra/infra/.env.release"
COMPOSE_FILE="/opt/arenzyra/infra/docker-compose.publish.yml"
RELEASE_ARCHIVE_ROOT="/opt/arenzyra-release-metadata"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
LOCK_TIMEOUT_SECONDS="${ARENZYRA_DEPLOY_LOCK_TIMEOUT_SECONDS:-10}"
pinned_override_path=""
pinned_override_digest=""
pinned_override_identity=""

cleanup() {
  if [ -n "$pinned_override_path" ]; then
    case "$pinned_override_path" in
      /run/arenzyra-idp-verification.*)
        rm -f -- "$pinned_override_path"
        ;;
    esac
  fi
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Usage:
  bash scripts/production-api-maintenance.sh idp-credentials dry-run

This production-only wrapper never builds, pulls, migrates, starts, restarts, or
recreates a long-lived service. It holds the shared deployment lock, verifies
clean source and immutable release/image evidence, reattests the physical
database, and runs only the authenticated compiled IDP dry-run from the exact
maintenance image. Production apply and validate are unavailable until a
separately reviewed durable writer-credential fence exists. The compiled
mutating artifacts are shipped only for isolated private restore rehearsal.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "$#" -eq 2 ] && [ "$1" = "idp-credentials" ] && [ "$2" = "dry-run" ]; then
  action="dry-run"
else
  printf 'PRODUCTION API MAINTENANCE BLOCKED: only authenticated IDP dry-run is available; production apply/validate require a reviewed durable writer-credential fence.\n' >&2
  usage >&2
  exit 75
fi

resolved_root="$(realpath -e -- "$PRODUCTION_ROOT" 2>/dev/null || true)"
if [ "$resolved_root" != "$EXPECTED_ROOT" ] || [ "$(id -u)" -ne 0 ]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: exact root path and UID 0 are required.\n' >&2
  exit 75
fi
cd "$resolved_root"
# Before sourcing checkout code, require the exact clean nested assembly selected
# by the outer committed-script launcher documented in infra/PUBLISH.md.
if [ ! -x /usr/bin/env ] || [ ! -x /usr/bin/git ] || [ ! -d /root ]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: reviewed system trust tools are unavailable.\n' >&2
  exit 75
fi
bootstrap_git=(
  /usr/bin/env -i
  "PATH=$SAFE_PATH"
  "HOME=/root"
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
  local label="$1" repository="$2" expected_variable="$3"
  local expected_commit="${!expected_variable:-}"
  local actual_commit="" actual_top="" replace_refs="" status_output=""
  if ! [[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: %s reviewed commit is missing or invalid.\n' "$label" >&2
    exit 75
  fi
  if [ -L "$repository" ] || [ ! -d "$repository" ] || \
    [ -L "$repository/.git" ] || [ ! -d "$repository/.git" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: %s is not a standalone Git worktree.\n' "$label" >&2
    exit 75
  fi
  if ! actual_top="$("${bootstrap_git[@]}" -C "$repository" rev-parse --show-toplevel 2>/dev/null)" || \
    [ "$actual_top" != "$repository" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: %s Git root is not exact.\n' "$label" >&2
    exit 75
  fi
  if ! actual_commit="$("${bootstrap_git[@]}" -C "$repository" rev-parse --verify 'HEAD^{commit}' 2>/dev/null)" || \
    [ "$actual_commit" != "$expected_commit" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: %s HEAD does not match the reviewed commit.\n' "$label" >&2
    exit 75
  fi
  if [ -e "$repository/.git/info/grafts" ] || \
    [ -L "$repository/.git/info/grafts" ] || \
    [ -e "$repository/.git/objects/info/alternates" ] || \
    [ -L "$repository/.git/objects/info/alternates" ] || \
    [ -e "$repository/.git/objects/info/http-alternates" ] || \
    [ -L "$repository/.git/objects/info/http-alternates" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: %s Git object substitution metadata exists.\n' "$label" >&2
    exit 75
  fi
  if ! replace_refs="$("${bootstrap_git[@]}" -C "$repository" \
    for-each-ref --format='%(refname)' refs/replace 2>/dev/null)" || \
    [ -n "$replace_refs" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: %s Git replacement refs exist.\n' "$label" >&2
    exit 75
  fi
  if ! status_output="$("${bootstrap_git[@]}" -C "$repository" status \
    --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>/dev/null)" || \
    [ -n "$status_output" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: %s worktree is not clean.\n' "$label" >&2
    exit 75
  fi
}

verify_bootstrap_repository ROOT "$resolved_root" ARENZYRA_REVIEWED_ROOT_COMMIT
verify_bootstrap_repository API "$resolved_root/apps/api" ARENZYRA_REVIEWED_API_COMMIT
verify_bootstrap_repository WEB "$resolved_root/apps/arenzyra-web" ARENZYRA_REVIEWED_WEB_COMMIT
unset bootstrap_git

# This cannot undo a malicious BASH_ENV that already ran. Always invoke this
# wrapper with the documented clean-parent env -i launcher.
# shellcheck source=scripts/require-local-production-docker.sh
source scripts/require-local-production-docker.sh

for command in basename bash chmod chown cmp date dirname docker env flock getent id mktemp node realpath rm rmdir sha256sum stat; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'PRODUCTION API MAINTENANCE BLOCKED: required command is unavailable.\n' >&2
    exit 75
  }
done
if ! [[ "$LOCK_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] || [ "$LOCK_TIMEOUT_SECONDS" -gt 300 ]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: lock timeout must be 0-300 seconds.\n' >&2
  exit 75
fi

verify_lock_directory() {
  local mode
  mode="$(stat -c %a -- /run 2>/dev/null || true)"
  [ ! -L /run ] && [ -d /run ] && [ "$(realpath -e -- /run)" = "/run" ] && \
    [ "$(stat -c '%u:%g' -- /run)" = "0:0" ] && \
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#002) == 0 ))
}

verify_lock_file() {
  local descriptor_identity path_identity
  [ ! -L "$LOCK_FILE" ] && [ -f "$LOCK_FILE" ] || return 1
  descriptor_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- /proc/$$/fd/8 2>/dev/null || true)"
  path_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- "$LOCK_FILE" 2>/dev/null || true)"
  [ "$descriptor_identity" = "$path_identity" ] || return 1
  IFS=: read -r _ _ owner group mode links <<<"$descriptor_identity"
  [ "$owner" = "0" ] && [ "$group" = "0" ] && [ "$links" = "1" ] && \
    [[ "$mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$mode & 8#022) == 0 ))
}

verify_lock_directory || {
  printf 'PRODUCTION API MAINTENANCE BLOCKED: lock directory is unsafe.\n' >&2
  exit 75
}
if [ -e "$LOCK_FILE" ] || [ -L "$LOCK_FILE" ]; then
  existing_lock_mode="$(stat -c %a -- "$LOCK_FILE" 2>/dev/null || true)"
  [ ! -L "$LOCK_FILE" ] && [ -f "$LOCK_FILE" ] && \
    [ "$(stat -c '%u:%g:%h' -- "$LOCK_FILE")" = "0:0:1" ] && \
    [[ "$existing_lock_mode" =~ ^[0-7]{3,4}$ ]] && \
    (( (8#$existing_lock_mode & 8#022) == 0 )) || {
      printf 'PRODUCTION API MAINTENANCE BLOCKED: lock file is unsafe.\n' >&2
      exit 75
    }
fi
exec 8>>"$LOCK_FILE"
chmod 600 "$LOCK_FILE"
chown root:root "$LOCK_FILE"
verify_lock_file || {
  printf 'PRODUCTION API MAINTENANCE BLOCKED: lock identity changed.\n' >&2
  exit 75
}
flock -w "$LOCK_TIMEOUT_SECONDS" 8 || {
  printf 'PRODUCTION API MAINTENANCE BLOCKED: deployment lock is held.\n' >&2
  exit 75
}

account_record="$(getent passwd 0 2>/dev/null || true)"
IFS=: read -r _ _ _ _ _ account_home _ <<<"$account_record"
safe_home="$(realpath -e -- "${account_home:-/root}" 2>/dev/null || true)"
if [ -z "$safe_home" ] || [ ! -d "$safe_home" ]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: safe root HOME is unavailable.\n' >&2
  exit 75
fi
sanitized=(env -i "PATH=$SAFE_PATH" "HOME=$safe_home" "DOCKER_HOST=unix:///var/run/docker.sock")

for file in \
  "$ENV_FILE" "$RELEASE_FILE" "$COMPOSE_FILE" \
  infra/production-api-migration-safety.json \
  scripts/production-api-maintenance.sh \
  scripts/production-database-target.cjs \
  scripts/production-deploy-preflight.sh \
  scripts/production-pinned-image-override.cjs \
  scripts/validate-publish-release-env.cjs \
  scripts/validate-release-image-manifest.cjs \
  scripts/verify-idp-credential-storage.cjs \
  scripts/verify-idp-maintenance-summary.cjs \
  scripts/verify-production-api-capabilities.cjs \
  scripts/verify-production-database-container.sh \
  scripts/verify-production-database-roles.sh \
  scripts/verify-production-idp-compiled.sh \
  scripts/verify-production-release-source.cjs; do
  [ -f "$file" ] && [ ! -L "$file" ] || {
    printf 'PRODUCTION API MAINTENANCE BLOCKED: a reviewed input is missing or linked.\n' >&2
    exit 75
  }
done

# Non-Git or mixed production source remains blocked. OCI labels and
# .env.release are necessary evidence, never a substitute for this complete
# checkout/source verification.
"${sanitized[@]}" node scripts/verify-production-release-source.cjs --check-checkout-only
"${sanitized[@]}" node scripts/verify-production-api-capabilities.cjs
"${sanitized[@]}" node scripts/preflight-publish.cjs --env "$ENV_FILE" --skip-compose
"${sanitized[@]}" node scripts/validate-publish-release-env.cjs --file "$RELEASE_FILE" >/dev/null
release_id="$(
  "${sanitized[@]}" node scripts/read-dotenv-value.cjs "$RELEASE_FILE" ARENZYRA_RELEASE_ID
)"
if ! [[ "$release_id" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: immutable Git release ID is required.\n' >&2
  exit 75
fi

if [ -L "$RELEASE_ARCHIVE_ROOT" ] || [ ! -d "$RELEASE_ARCHIVE_ROOT" ] || \
  [ "$(realpath -e -- "$RELEASE_ARCHIVE_ROOT" 2>/dev/null || true)" != "$RELEASE_ARCHIVE_ROOT" ] || \
  [ "$(stat -c '%u:%g:%a' -- "$RELEASE_ARCHIVE_ROOT" 2>/dev/null || true)" != "0:0:700" ]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: release archive root is unsafe.\n' >&2
  exit 75
fi
archived_release="$RELEASE_ARCHIVE_ROOT/$release_id.env"
archived_manifest="$RELEASE_ARCHIVE_ROOT/$release_id.api-image.json"
for file in "$archived_release" "$archived_manifest"; do
  [ ! -L "$file" ] && [ -f "$file" ] && \
    [ "$(stat -c '%u:%g:%a:%h' -- "$file" 2>/dev/null || true)" = "0:0:600:1" ] || {
      printf 'PRODUCTION API MAINTENANCE BLOCKED: immutable release archive input is unsafe.\n' >&2
      exit 75
    }
done
cmp -s -- "$RELEASE_FILE" "$archived_release" || {
  printf 'PRODUCTION API MAINTENANCE BLOCKED: release metadata differs from its archive.\n' >&2
  exit 75
}
# Checkout cleanliness is only the trust bootstrap. Before any maintenance
# Compose command, recompute the complete release-file manifest and require it
# to match the exact archived release bytes.
"${sanitized[@]}" node scripts/verify-production-release-source.cjs \
  --release-env "$archived_release"
expected_image_id="$(
  "${sanitized[@]}" node scripts/validate-release-image-manifest.cjs \
    --file "$archived_manifest" --release-env "$archived_release" \
    --expected-release "$release_id" --service api --print-image-id
)"
if ! [[ "$expected_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: archived API image ID is invalid.\n' >&2
  exit 75
fi
image_reference="arenzyra-api:$release_id"

verify_immutable_image() {
  local actual_image_id runtime_contract
  actual_image_id="$(docker image inspect --format '{{.Id}}' "$image_reference" 2>/dev/null || true)"
  runtime_contract="$(docker image inspect --format '{{.Config.User}}|{{json .Config.Cmd}}' "$image_reference" 2>/dev/null || true)"
  if [ "$actual_image_id" != "$expected_image_id" ] || \
    [ "$runtime_contract" != 'node|["node","dist/main"]' ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: local nonroot API image differs from immutable release evidence.\n' >&2
    return 75
  fi
}
verify_immutable_image

reviewed_project="$(
  "${sanitized[@]}" node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT
)"
if ! [[ "$reviewed_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: Compose project is invalid.\n' >&2
  exit 75
fi

run_preflight() {
  "${sanitized[@]}" \
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$reviewed_project" \
    "ARENZYRA_DEPLOY_ENV_FILE=$ENV_FILE" \
    bash scripts/production-deploy-preflight.sh
}

run_preflight
mapfile -t database_binding < <(
  "${sanitized[@]}" \
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$reviewed_project" \
    "ARENZYRA_DEPLOY_ENV_FILE=$ENV_FILE" \
    bash scripts/verify-production-database-container.sh
)
if [ "${#database_binding[@]}" -ne 5 ]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: database target attestation is incomplete.\n' >&2
  exit 75
fi
database_name="${database_binding[3]}"
schema_name="${database_binding[4]}"
physical_identity="$(
  docker exec "${database_binding[0]}" sh -ceu '
    database="$1"
    schema="$2"
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=30000 -c lock_timeout=5000"
    exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At -F " " -c \
      "SELECT current_database(), database.oid, control.system_identifier
       FROM pg_database database CROSS JOIN pg_control_system() control
       WHERE database.datname = current_database();"
  ' sh "$database_name" "$schema_name"
)"
if ! [[ "$physical_identity" =~ ^([A-Za-z0-9_][A-Za-z0-9_.-]{0,62})[[:space:]]([1-9][0-9]{0,9})[[:space:]]([0-9]{10,24})$ ]] || \
  [ "${BASH_REMATCH[1]}" != "$database_name" ]; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: physical database identity is invalid.\n' >&2
  exit 75
fi
database_oid="${BASH_REMATCH[2]}"
system_identifier="${BASH_REMATCH[3]}"

maintenance_env=(
  "${sanitized[@]}"
  "ARENZYRA_EXPECTED_DATABASE_NAME=$database_name"
  "ARENZYRA_EXPECTED_DATABASE_OID=$database_oid"
  "ARENZYRA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER=$system_identifier"
)
pinned_override_path="$(mktemp -- "/run/arenzyra-idp-verification.$release_id.XXXXXX")"
"${sanitized[@]}" node scripts/production-pinned-image-override.cjs \
  --mode idp-maintenance --api-image-id "$expected_image_id" --create \
  >"$pinned_override_path"
chmod 600 "$pinned_override_path"
chown root:root "$pinned_override_path"
pinned_override_digest="$(
  "${sanitized[@]}" node scripts/production-pinned-image-override.cjs \
    --mode idp-maintenance --api-image-id "$expected_image_id" \
    --validate-stdin --print-sha256 <"$pinned_override_path"
)"
pinned_override_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- "$pinned_override_path")"
exec 10<"$pinned_override_path"

attest_override() {
  local current_digest descriptor_identity path_identity
  descriptor_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- /proc/$$/fd/10 2>/dev/null || true)"
  path_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- "$pinned_override_path" 2>/dev/null || true)"
  current_digest="$(
    "${sanitized[@]}" node scripts/production-pinned-image-override.cjs \
      --mode idp-maintenance --api-image-id "$expected_image_id" \
      --validate-stdin --print-sha256 </proc/$$/fd/10
  )"
  if [ "$descriptor_identity" != "$pinned_override_identity" ] || \
    [ "$path_identity" != "$pinned_override_identity" ] || \
    [ "$current_digest" != "$pinned_override_digest" ]; then
    printf 'PRODUCTION API MAINTENANCE BLOCKED: pinned image override changed.\n' >&2
    return 75
  fi
}

compose=(
  "${maintenance_env[@]}"
  docker compose -p "$reviewed_project"
  --env-file "$ENV_FILE" --env-file "$RELEASE_FILE"
  -f "$COMPOSE_FILE" -f /proc/$$/fd/10
)
attest_override
if ! "${compose[@]}" --profile migration --profile maintenance config --format json \
  | "${sanitized[@]}" node scripts/production-database-target.cjs \
      --env "$ENV_FILE" --assert-compose-json; then
  printf 'PRODUCTION API MAINTENANCE BLOCKED: resolved Compose target is not exact.\n' >&2
  exit 75
fi

verify_roles() {
  "${sanitized[@]}" \
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT=$reviewed_project" \
    "ARENZYRA_DEPLOY_ENV_FILE=$ENV_FILE" \
    "ARENZYRA_DEPLOY_LOCK_INHERITED=1" \
    bash scripts/verify-production-database-roles.sh
}

verify_roles
run_preflight
verify_immutable_image
attest_override

run_compiled_dry_run() {
  attest_override
  if "${compose[@]}" --profile maintenance run --rm --no-deps --pull never -T \
      api-maintenance-idp-dry-run \
      | "${sanitized[@]}" node scripts/verify-idp-maintenance-summary.cjs \
          --preview; then
    return 0
  fi
  {
    printf 'PRODUCTION API MAINTENANCE FAILED: compiled IDP dry-run evidence was rejected.\n' >&2
    return 75
  }
}

run_compiled_dry_run
verify_roles
printf 'PRODUCTION API MAINTENANCE VERIFIED task=idp-credentials action=%s release=%s\n' \
  "$action" "$release_id"
