#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
ENV_FILE="$REPOSITORY_ROOT/infra/.env.publish"
ALLOW_ABSENT=0
ALLOW_RUNNING_LEGACY_ROOT_API=0

if [ "${1:-}" = "--allow-absent" ] && [ "$#" -eq 1 ]; then
  ALLOW_ABSENT=1
elif [ "${1:-}" = "--allow-running-legacy-root-api" ] && [ "$#" -eq 1 ]; then
  ALLOW_RUNNING_LEGACY_ROOT_API=1
elif [ "$#" -ne 0 ]; then
  printf 'API DATA VOLUME GATE BLOCKED: unsupported argument.\n' >&2
  exit 75
fi

if [ "$REPOSITORY_ROOT" != "$EXPECTED_ROOT" ] || [ ! -f "$ENV_FILE" ]; then
  printf 'API DATA VOLUME GATE BLOCKED: production root or environment is not exact.\n' >&2
  exit 75
fi
cd "$REPOSITORY_ROOT"
# The caller must still start Bash from the documented clean env -i parent;
# this guard rejects ambient shell/Node/Git injection before Docker is used.
# shellcheck source=scripts/require-local-production-docker.sh
source scripts/require-local-production-docker.sh

for command in docker node realpath stat; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'API DATA VOLUME GATE BLOCKED: required inspection command is unavailable.\n' >&2
    exit 75
  }
done

reviewed_project="$(
  node scripts/read-dotenv-value.cjs "$ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT
)"
process_project="${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-$reviewed_project}"
if [ "$process_project" != "$reviewed_project" ] || \
  ! [[ "$reviewed_project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  printf 'API DATA VOLUME GATE BLOCKED: Compose project is not the reviewed value.\n' >&2
  exit 75
fi

mapfile -t api_containers < <(
  docker ps -a --no-trunc \
    --filter "label=com.docker.compose.project=${reviewed_project}" \
    --filter 'label=com.docker.compose.service=api' \
    --format '{{.ID}}'
)
if [ "${#api_containers[@]}" -gt 1 ]; then
  printf 'API DATA VOLUME GATE BLOCKED: API container identity is ambiguous.\n' >&2
  exit 75
fi
if [ "${#api_containers[@]}" -eq 0 ] && [ "$ALLOW_ABSENT" -ne 1 ]; then
  printf 'API DATA VOLUME GATE BLOCKED: reviewed API container is missing.\n' >&2
  exit 75
fi

if [ "$ALLOW_RUNNING_LEGACY_ROOT_API" -eq 1 ]; then
  [ "${#api_containers[@]}" -eq 1 ] || {
    printf 'API DATA VOLUME GATE BLOCKED: legacy web recovery requires exactly one existing API container.\n' >&2
    exit 75
  }
  legacy_api_runtime="$(
    docker inspect --format \
      '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}|{{.Config.User}}' \
      "${api_containers[0]}" 2>/dev/null || true
  )"
  IFS='|' read -r legacy_api_status legacy_api_health legacy_api_user \
    <<<"$legacy_api_runtime"
  case "$legacy_api_user" in
    ''|0|0:0) ;;
    *)
      printf 'API DATA VOLUME GATE BLOCKED: legacy web recovery API is not the exact root runtime.\n' >&2
      exit 75
      ;;
  esac
  if [ "$legacy_api_status" != "running" ] || [ "$legacy_api_health" != "healthy" ]; then
    printf 'API DATA VOLUME GATE BLOCKED: legacy web recovery API is not running and healthy.\n' >&2
    exit 75
  fi
fi

expected_uid=1000
expected_gid=1000
expected_root_mode=750
present_volume_count=0
for logical_name in api-uploads api-storage; do
  volume_name="${reviewed_project}_${logical_name}"
  if docker volume inspect "$volume_name" >/dev/null 2>&1; then
    present_volume_count=$((present_volume_count + 1))
  fi
done
if [ "${#api_containers[@]}" -eq 0 ] && [ "$ALLOW_ABSENT" -eq 1 ]; then
  if [ "$present_volume_count" -eq 0 ]; then
    printf 'API DATA VOLUME GATE PASSED first_deploy_volumes=absent\n'
    exit 0
  fi
  if [ "$present_volume_count" -ne 2 ]; then
    printf 'API DATA VOLUME GATE BLOCKED: first-deploy API volume inventory is partial.\n' >&2
    exit 75
  fi
fi

for logical_name in api-uploads api-storage; do
  volume_name="${reviewed_project}_${logical_name}"
  destination="/app/${logical_name#api-}"
  if ! volume_metadata="$(
    docker volume inspect --format \
      '{{.Driver}}|{{.Scope}}|{{len .Options}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}|{{.Mountpoint}}' \
      "$volume_name" 2>/dev/null
  )"; then
    printf 'API DATA VOLUME GATE BLOCKED: reviewed API data volume is missing.\n' >&2
    exit 75
  fi
  IFS='|' read -r driver scope option_count label_project label_volume mountpoint \
    <<<"$volume_metadata"
  if [ "$driver" != "local" ] || [ "$scope" != "local" ] || \
    [ "$option_count" != "0" ] || [ "$label_project" != "$reviewed_project" ] || \
    [ "$label_volume" != "$logical_name" ]; then
    printf 'API DATA VOLUME GATE BLOCKED: API volume driver or labels are not reviewed.\n' >&2
    exit 75
  fi
  resolved_mountpoint="$(realpath -e -- "$mountpoint" 2>/dev/null || true)"
  if [ -z "$resolved_mountpoint" ] || [ "$resolved_mountpoint" != "$mountpoint" ] || \
    [ -L "$mountpoint" ] || [ ! -d "$mountpoint" ]; then
    printf 'API DATA VOLUME GATE BLOCKED: API volume mountpoint identity is unsafe.\n' >&2
    exit 75
  fi
  root_identity="$(stat -Lc '%u:%g:%a' -- "$mountpoint" 2>/dev/null || true)"
  if [ "$ALLOW_RUNNING_LEGACY_ROOT_API" -eq 1 ]; then
    if [ "$root_identity" != "0:0:777" ]; then
      printf 'API DATA VOLUME GATE BLOCKED: legacy web recovery volume root identity changed.\n' >&2
      exit 75
    fi
    if ! node scripts/verify-api-data-volume-tree.cjs \
      --root "$mountpoint" --uid 0 --gid 0 --legacy-root-profile >/dev/null; then
      printf 'API DATA VOLUME GATE BLOCKED: legacy web recovery volume tree is outside the exact observed root-owned profile.\n' >&2
      exit 75
    fi
  else
    if [ "$root_identity" != "${expected_uid}:${expected_gid}:${expected_root_mode}" ]; then
      printf 'API DATA VOLUME GATE BLOCKED: API volume root owner or mode is incompatible with the nonroot image.\n' >&2
      exit 75
    fi
    if ! node scripts/verify-api-data-volume-tree.cjs \
      --root "$mountpoint" --uid "$expected_uid" --gid "$expected_gid" >/dev/null; then
      printf 'API DATA VOLUME GATE BLOCKED: API volume contains an unexpected owner, link, special node, multi-link file, or world-writable entry.\n' >&2
      exit 75
    fi
  fi

  if [ "${#api_containers[@]}" -eq 1 ]; then
    mount_contract="$(
      docker inspect --format \
        "{{range .Mounts}}{{if eq .Destination \"$destination\"}}{{.Type}}|{{.Name}}|{{.RW}}{{end}}{{end}}" \
        "${api_containers[0]}" 2>/dev/null || true
    )"
    if [ "$mount_contract" != "volume|${volume_name}|true" ]; then
      printf 'API DATA VOLUME GATE BLOCKED: API container volume binding is not exact.\n' >&2
      exit 75
    fi
  fi
done

if [ "$ALLOW_RUNNING_LEGACY_ROOT_API" -eq 1 ]; then
  printf 'API DATA VOLUME GATE PASSED recovery_profile=legacy-root-read-only owner=0:0 root_mode=777 api=running/healthy\n'
else
  printf 'API DATA VOLUME GATE PASSED owner=%s:%s root_mode=%s world_writable=0\n' \
    "$expected_uid" "$expected_gid" "$expected_root_mode"
fi
