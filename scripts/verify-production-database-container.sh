#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
if [ "$REPOSITORY_ROOT" != "$EXPECTED_ROOT" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: repository root is not /opt/arenzyra.\n' >&2
  exit 75
fi
cd "$REPOSITORY_ROOT"
source scripts/require-local-production-docker.sh
REVIEWED_ENV_FILE="$REPOSITORY_ROOT/infra/.env.publish"
ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-$REVIEWED_ENV_FILE}"
if ! ENV_FILE="$(realpath -e -- "$ENV_FILE" 2>/dev/null)" || \
  [ "$ENV_FILE" != "$REVIEWED_ENV_FILE" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: environment is not reviewed infra/.env.publish.\n' >&2
  exit 75
fi
EXPECTED_POSTGRES_IMAGE="postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
EXPECTED_POSTGRES_VERSION_NUM="160014"
ALLOW_RUNNING_LEGACY_BACKUP=0
if [ "${1:-}" = "--allow-running-legacy-backup" ] && [ "$#" -eq 1 ]; then
  ALLOW_RUNNING_LEGACY_BACKUP=1
elif [ "$#" -ne 0 ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: unsupported argument.\n' >&2
  exit 75
fi
test -f "$ENV_FILE"

for command in docker node; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'DATABASE IDENTITY GATE BLOCKED: required command is unavailable.\n' >&2
    exit 75
  }
done

if ! mapfile -t target < <(
  node scripts/production-database-target.cjs --env "$ENV_FILE" --print api
); then
  exit 75
fi
if [ "${#target[@]}" -ne 4 ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: invalid reviewed target.\n' >&2
  exit 75
fi
host="${target[0]}"
port="${target[1]}"
database="${target[2]}"
schema="${target[3]}"

reviewed_compose_project="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT)"
compose_project="${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-$reviewed_compose_project}"
if [ "$compose_project" != "$reviewed_compose_project" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: Compose project override mismatch.\n' >&2
  exit 75
fi
if ! [[ "$compose_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: invalid Compose project.\n' >&2
  exit 75
fi
mapfile -t postgres_containers < <(
  docker ps \
    --filter "label=com.docker.compose.project=${compose_project}" \
    --filter 'label=com.docker.compose.service=postgres' \
    --filter status=running \
    --format '{{.ID}}'
)
if [ "${#postgres_containers[@]}" -ne 1 ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: expected exactly one reviewed PostgreSQL container.\n' >&2
  exit 75
fi
container_id="${postgres_containers[0]}"
expected_volume="${compose_project}_postgres-data"
expected_network="${compose_project}_default"
reviewed_subnet="$(node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DOCKER_SUBNET)"
reviewed_subnet="${reviewed_subnet:-172.30.50.0/24}"

if ! selected_container_full_id="$(docker inspect --format '{{.Id}}' "$container_id")" ||
  [ -z "$selected_container_full_id" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: selected PostgreSQL container identity could not be attested.\n' >&2
  exit 75
fi

if [ "$ALLOW_RUNNING_LEGACY_BACKUP" -eq 1 ]; then
  expected_runtime_image="postgres:16-alpine"
  expected_runtime_version_num="160013"
else
  expected_runtime_image="$EXPECTED_POSTGRES_IMAGE"
  expected_runtime_version_num="$EXPECTED_POSTGRES_VERSION_NUM"
fi
if ! container_image_reference="$(docker inspect --format '{{.Config.Image}}' "$container_id")" ||
  [ "$container_image_reference" != "$expected_runtime_image" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL container image reference is outside the selected reviewed profile.\n' >&2
  exit 75
fi
if ! container_image_id="$(docker inspect --format '{{.Image}}' "$container_id")" ||
  ! reviewed_image_id="$(docker image inspect --format '{{.Id}}' "$expected_runtime_image")" ||
  [ -z "$container_image_id" ] || [ "$container_image_id" != "$reviewed_image_id" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: running PostgreSQL image does not match the reviewed local image.\n' >&2
  exit 75
fi
if ! database_mount="$(
  docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}|{{.Name}}|{{.RW}}{{end}}{{end}}' "$container_id"
)" || [ "$database_mount" != "volume|${expected_volume}|true" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL data mount is not the reviewed Compose volume.\n' >&2
  exit 75
fi
if ! volume_container_output="$(
  docker ps -a --no-trunc \
    --filter "volume=${expected_volume}" \
    --format '{{.ID}}'
)"; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL volume attachments could not be enumerated.\n' >&2
  exit 75
fi
volume_attachment_ids=()
while IFS= read -r attachment_id; do
  [ -n "$attachment_id" ] && volume_attachment_ids+=("$attachment_id")
done <<<"$volume_container_output"
if [ "${#volume_attachment_ids[@]}" -ne 1 ] ||
  [ "${volume_attachment_ids[0]:-}" != "$selected_container_full_id" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL volume is attached to an unexpected or additional container.\n' >&2
  exit 75
fi
if ! configured_port_policy="$(
  docker inspect --format '{{.HostConfig.PublishAllPorts}}|{{len .HostConfig.PortBindings}}' "$container_id"
)" || [ "$configured_port_policy" != "false|0" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL container has published host ports.\n' >&2
  exit 75
fi
if ! runtime_published_ports="$(
  docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{if $bindings}}{{println $port}}{{end}}{{end}}' "$container_id"
)" || [ -n "$runtime_published_ports" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL container has published host ports.\n' >&2
  exit 75
fi
if ! volume_identity="$(
  docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}' "$expected_volume"
)" || [ "$volume_identity" != "${compose_project}|postgres-data" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL volume labels do not match the reviewed Compose target.\n' >&2
  exit 75
fi
if ! volume_properties="$(
  docker volume inspect --format '{{.Driver}}|{{.Scope}}|{{len .Options}}' "$expected_volume"
)" || [ "$volume_properties" != "local|local|0" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL volume driver or options are not local defaults.\n' >&2
  exit 75
fi
if ! network_identity="$(
  docker network inspect --format '{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.network"}}' "$expected_network"
)" || [ "$network_identity" != "${compose_project}|default" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL network labels do not match the reviewed Compose target.\n' >&2
  exit 75
fi
if ! network_properties="$(
  docker network inspect --format '{{.Driver}}|{{.Scope}}' "$expected_network"
)" || [ "$network_properties" != "bridge|local" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL network driver is not the reviewed local bridge.\n' >&2
  exit 75
fi
if ! network_subnets="$(
  docker network inspect --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}' "$expected_network"
)" || [ "$network_subnets" != "$reviewed_subnet" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL network subnet differs from the reviewed environment.\n' >&2
  exit 75
fi
if ! container_aliases="$(
  docker inspect --format "{{with index .NetworkSettings.Networks \"$expected_network\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}" "$container_id"
)"; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL network aliases could not be attested.\n' >&2
  exit 75
fi
postgres_alias_found=0
while IFS= read -r alias; do
  [ "$alias" = "postgres" ] && postgres_alias_found=1
done <<<"$container_aliases"
if [ "$postgres_alias_found" -ne 1 ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: reviewed PostgreSQL service alias is missing.\n' >&2
  exit 75
fi
if ! network_container_output="$(
  docker network inspect --format '{{range $id, $_ := .Containers}}{{println $id}}{{end}}' "$expected_network"
)"; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL network endpoints could not be attested.\n' >&2
  exit 75
fi
alias_endpoint_ids=()
while IFS= read -r endpoint_id; do
  [ -n "$endpoint_id" ] || continue
  if ! endpoint_aliases="$(
    docker inspect --format "{{with index .NetworkSettings.Networks \"$expected_network\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}" "$endpoint_id"
  )"; then
    printf 'DATABASE IDENTITY GATE BLOCKED: a PostgreSQL network endpoint could not be inspected.\n' >&2
    exit 75
  fi
  while IFS= read -r endpoint_alias; do
    if [ "$endpoint_alias" = "postgres" ]; then
      alias_endpoint_ids+=("$endpoint_id")
    fi
  done <<<"$endpoint_aliases"
done <<<"$network_container_output"
if [ "${#alias_endpoint_ids[@]}" -ne 1 ] ||
  [ "${alias_endpoint_ids[0]}" != "$selected_container_full_id" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: PostgreSQL DNS alias is ambiguous or points elsewhere.\n' >&2
  exit 75
fi

if ! actual_identity="$(
  docker exec "$container_id" sh -ceu '
    expected_database="$1"
    expected_schema="$2"
    expected_port="$3"
    [ "${POSTGRES_DB:-}" = "$expected_database" ]
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$expected_schema -c statement_timeout=30000 -c lock_timeout=5000"
    exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$expected_database" -At -F " " -c \
      "SELECT current_database(), COALESCE(current_schema(), '"'"''"'"'), inet_server_port(), current_setting('"'"'server_version_num'"'"');"
  ' sh "$database" "$schema" "$port"
)"; then
  printf 'DATABASE IDENTITY GATE BLOCKED: read-only target attestation failed.\n' >&2
  exit 75
fi
if [ "$actual_identity" != "$database $schema $port $expected_runtime_version_num" ]; then
  printf 'DATABASE IDENTITY GATE BLOCKED: actual target does not match the reviewed target.\n' >&2
  exit 75
fi

printf '%s\n%s\n%s\n%s\n%s\n' "$container_id" "$host" "$port" "$database" "$schema"
