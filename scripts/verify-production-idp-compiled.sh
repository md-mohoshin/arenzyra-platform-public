#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
COMPOSE_FILE="$EXPECTED_ROOT/infra/docker-compose.publish.yml"
LOCK_FILE="/run/arenzyra-production-deploy.lock"
OVERRIDE_FD=10

block() {
  printf 'IDP COMPILED VERIFICATION BLOCKED: %s\n' "$1" >&2
  exit 75
}

[ "$#" -eq 0 ] || block "this internal helper accepts no arguments."
[ "$REPOSITORY_ROOT" = "$EXPECTED_ROOT" ] && [ "$(id -u)" -eq 0 ] || \
  block "exact production root and UID 0 are required."
cd "$REPOSITORY_ROOT"
# The caller must start the original entrypoint with the documented env -i
# parent. This guard rejects ambient process and Docker target overrides.
# shellcheck source=scripts/require-local-production-docker.sh
source scripts/require-local-production-docker.sh

for command in bash docker flock getent id node readlink realpath stat; do
  command -v "$command" >/dev/null 2>&1 || \
    block "a required verification command is unavailable."
done
for file in \
  "$ENV_FILE" "$COMPOSE_FILE" \
  scripts/production-database-target.cjs \
  scripts/production-pinned-image-override.cjs \
  scripts/validate-publish-release-env.cjs \
  scripts/validate-release-image-manifest.cjs \
  scripts/verify-idp-maintenance-summary.cjs \
  scripts/verify-production-database-container.sh \
  scripts/verify-production-release-source.cjs; do
  [ -f "$file" ] && [ ! -L "$file" ] || \
    block "a reviewed verification input is missing or linked."
done

if [ "${ARENZYRA_DEPLOY_LOCK_INHERITED:-0}" != "1" ] || \
  [ ! -e "/proc/$$/fd/8" ] || [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ]; then
  block "the shared deployment lock was not inherited."
fi
lock_descriptor_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- "/proc/$$/fd/8" 2>/dev/null || true)"
lock_path_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- "$LOCK_FILE" 2>/dev/null || true)"
IFS=: read -r _ _ lock_owner lock_group lock_mode lock_links \
  <<<"$lock_descriptor_identity"
if [ "$lock_descriptor_identity" != "$lock_path_identity" ] || \
  [ "$lock_owner" != "0" ] || [ "$lock_group" != "0" ] || \
  [ "$lock_links" != "1" ] || ! [[ "$lock_mode" =~ ^[0-7]{3,4}$ ]] || \
  (( (8#$lock_mode & 8#022) != 0 )) || ! flock -n 8; then
  block "the inherited deployment lock identity is unsafe."
fi

api_image_id="${ARENZYRA_IDP_API_IMAGE_ID:-}"
release_env_input="${ARENZYRA_IDP_RELEASE_ENV_FILE:-}"
manifest_input="${ARENZYRA_IDP_API_IMAGE_MANIFEST:-}"
expected_database="${ARENZYRA_EXPECTED_DATABASE_NAME:-}"
expected_database_oid="${ARENZYRA_EXPECTED_DATABASE_OID:-}"
expected_system_identifier="${ARENZYRA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER:-}"
reviewed_project="${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-}"
if ! [[ "$api_image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || \
  ! [[ "$expected_database" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$ ]] || \
  ! [[ "$expected_database_oid" =~ ^[1-9][0-9]{0,9}$ ]] || \
  ! [[ "$expected_system_identifier" =~ ^[0-9]{10,24}$ ]] || \
  ! [[ "$reviewed_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  block "inherited image or database identity is invalid."
fi
configured_project="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
[ "$reviewed_project" = "$configured_project" ] || \
  block "the inherited Compose project is not reviewed."

release_env="$(realpath -e -- "$release_env_input" 2>/dev/null || true)"
manifest_file="$(realpath -e -- "$manifest_input" 2>/dev/null || true)"
[ "$release_env_input" = "$release_env" ] && [ "$manifest_input" = "$manifest_file" ] || \
  block "release evidence paths are not canonical."
for file in "$release_env" "$manifest_file"; do
  case "$file" in
    /opt/arenzyra-release-metadata/*) ;;
    *) block "release evidence escaped the immutable archive." ;;
  esac
  [ ! -L "$file" ] && [ -f "$file" ] && \
    [ "$(stat -c '%u:%g:%a:%h' -- "$file" 2>/dev/null || true)" = "0:0:600:1" ] || \
    block "release evidence ownership or identity is unsafe."
done
node scripts/validate-publish-release-env.cjs --file "$release_env" >/dev/null || \
  block "release environment validation failed."
release_id="$(node scripts/read-dotenv-value.cjs "$release_env" ARENZYRA_RELEASE_ID)"
if ! [[ "$release_id" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || \
  [ "$release_env" != "/opt/arenzyra-release-metadata/$release_id.env" ] || \
  [ "$manifest_file" != "/opt/arenzyra-release-metadata/$release_id.api-image.json" ]; then
  block "release evidence is not the exact immutable Git archive."
fi
manifest_image_id="$(
  node scripts/validate-release-image-manifest.cjs \
    --file "$manifest_file" --release-env "$release_env" \
    --expected-release "$release_id" --service api --print-image-id
)" || block "API image manifest validation failed."
[ "$manifest_image_id" = "$api_image_id" ] || \
  block "inherited API image differs from archived evidence."
node scripts/verify-production-release-source.cjs --release-env "$release_env" >/dev/null || \
  block "release source does not match the complete cryptographic manifest."

override_path="$(readlink -f "/proc/$$/fd/$OVERRIDE_FD" 2>/dev/null || true)"
case "$override_path" in
  "/run/arenzyra-idp-verification.$release_id."*) ;;
  *) block "the inherited IDP image override path is not exact." ;;
esac
override_descriptor_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- "/proc/$$/fd/$OVERRIDE_FD" 2>/dev/null || true)"
override_path_identity="$(stat -Lc '%d:%i:%u:%g:%a:%h' -- "$override_path" 2>/dev/null || true)"
if [ "$override_descriptor_identity" != "$override_path_identity" ] || \
  [ "${override_descriptor_identity##*:}" != "1" ] || \
  [ "${override_descriptor_identity#*:*:}" != "0:0:600:1" ]; then
  block "the inherited IDP image override identity is unsafe."
fi
node scripts/production-pinned-image-override.cjs \
  --mode idp-maintenance --api-image-id "$api_image_id" \
  --validate-stdin <"/proc/$$/fd/$OVERRIDE_FD" >/dev/null || \
  block "the inherited IDP image override is not canonical."

image_runtime="$(docker image inspect --format '{{.Id}}|{{.Config.User}}|{{json .Config.Cmd}}' "$api_image_id" 2>/dev/null || true)"
[ "$image_runtime" = "$api_image_id|node|[\"node\",\"dist/main\"]" ] || \
  block "the immutable API image runtime boundary is not reviewed."

mapfile -t database_binding < <(bash scripts/verify-production-database-container.sh)
if [ "${#database_binding[@]}" -ne 5 ] || \
  [ "${database_binding[3]}" != "$expected_database" ]; then
  block "the physical database container was not reattested."
fi
actual_physical_identity="$(
  docker exec "${database_binding[0]}" sh -ceu '
    database="$1"
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000"
    exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At -F " " -c \
      "SELECT database_record.datname, database_record.oid, control_record.system_identifier
         FROM pg_catalog.pg_database AS database_record
         CROSS JOIN pg_catalog.pg_control_system() AS control_record
        WHERE database_record.datname = current_database();"
  ' sh "$expected_database"
)" || block "physical database identity query failed."
[ "$actual_physical_identity" = "$expected_database $expected_database_oid $expected_system_identifier" ] || \
  block "physical database identity changed."

account_record="$(getent passwd 0 2>/dev/null || true)"
IFS=: read -r _ _ _ _ _ account_home _ <<<"$account_record"
safe_home="$(realpath -e -- "${account_home:-/root}" 2>/dev/null || true)"
[ -n "$safe_home" ] && [ -d "$safe_home" ] || \
  block "safe root HOME is unavailable."
clean=(
  env -i
  "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  "HOME=$safe_home"
  "DOCKER_HOST=unix:///var/run/docker.sock"
  "ARENZYRA_EXPECTED_DATABASE_NAME=$expected_database"
  "ARENZYRA_EXPECTED_DATABASE_OID=$expected_database_oid"
  "ARENZYRA_EXPECTED_DATABASE_SYSTEM_IDENTIFIER=$expected_system_identifier"
)
compose=(
  "${clean[@]}" docker compose -p "$reviewed_project"
  --env-file "$ENV_FILE" --env-file "$release_env"
  -f "$COMPOSE_FILE" -f "/proc/$$/fd/$OVERRIDE_FD"
)
if ! "${compose[@]}" --profile migration --profile maintenance config --format json \
  | "${clean[@]}" node scripts/production-database-target.cjs \
      --env "$ENV_FILE" --assert-compose-json; then
  block "resolved maintenance database bindings are not exact."
fi
if ! "${compose[@]}" --profile maintenance run --rm --no-deps --pull never -T \
    api-maintenance-idp-dry-run \
    | "${clean[@]}" node scripts/verify-idp-maintenance-summary.cjs \
        --require-clean; then
  block "compiled authenticated storage evidence was rejected."
fi

printf 'IDP COMPILED VERIFICATION PASSED release=%s\n' "$release_id"
