#!/usr/bin/env bash
set -Eeuo pipefail
source scripts/require-local-production-docker.sh

DISK_PATH="${ARENZYRA_DEPLOY_DISK_PATH:-/}"
MIN_FREE_GIB="${ARENZYRA_DEPLOY_MIN_FREE_GIB:-30}"
COMPOSE_PROJECT="${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-}"
PUBLISH_ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
SKIP_HEALTH=0
ALLOW_STOPPED_API_MAINTENANCE=0

usage() {
  cat <<'EOF'
Usage: production-deploy-preflight.sh [--skip-health|--allow-stopped-api-maintenance]

Read-only production deployment gate. It requires at least 30 GiB free by
default and verifies existing containers in the production Compose project.
It never deletes or modifies production data.

Environment:
  ARENZYRA_DEPLOY_DISK_PATH=/        Must remain the production root filesystem.
  ARENZYRA_DEPLOY_MIN_FREE_GIB=30    Required free space; values below 30 fail.
  ARENZYRA_DEPLOY_COMPOSE_PROJECT=infra
                                      Existing Compose project to inspect.
  ARENZYRA_DEPLOY_ENV_FILE=infra/.env.publish
                                      Production environment to validate.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-health)
      SKIP_HEALTH=1
      ;;
    --allow-stopped-api-maintenance)
      ALLOW_STOPPED_API_MAINTENANCE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

block() {
  local reason="$1"
  shift
  printf '\nDEPLOYMENT BLOCKED: %s\n' "$reason" >&2
  if [ "$#" -gt 0 ]; then
    printf '%s\n' "$@" >&2
  fi
  printf 'No cleanup or deployment action was performed.\n\n' >&2
  exit 75
}

if [ "$SKIP_HEALTH" -eq 1 ] && [ "$ALLOW_STOPPED_API_MAINTENANCE" -eq 1 ]; then
  printf '%s\n' '--skip-health and --allow-stopped-api-maintenance are mutually exclusive.' >&2
  exit 2
fi

if [ ! -f "$PUBLISH_ENV_FILE" ]; then
  block "PRODUCTION ENVIRONMENT MISSING" \
    "Expected production environment: $PUBLISH_ENV_FILE"
fi
if ! command -v node >/dev/null 2>&1; then
  block "NODE UNAVAILABLE" \
    "Node.js is required to validate the production MFA and secret policy."
fi
REVIEWED_COMPOSE_PROJECT="$(
  node scripts/read-dotenv-value.cjs \
    "$PUBLISH_ENV_FILE" ARENZYRA_DEPLOY_COMPOSE_PROJECT
)"
if [ -n "$COMPOSE_PROJECT" ] && [ "$COMPOSE_PROJECT" != "$REVIEWED_COMPOSE_PROJECT" ]; then
  block "COMPOSE PROJECT OVERRIDE MISMATCH" \
    "The process override differs from the reviewed production environment."
fi
COMPOSE_PROJECT="$REVIEWED_COMPOSE_PROJECT"
if ! [[ "$COMPOSE_PROJECT" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
  block "INVALID COMPOSE PROJECT" \
    "ARENZYRA_DEPLOY_COMPOSE_PROJECT must be a safe explicit project name."
fi
if ! env_preflight="$(
  node scripts/preflight-publish.cjs \
    --env "$PUBLISH_ENV_FILE" \
    --skip-compose 2>&1
)"; then
  block "PRODUCTION ENVIRONMENT PREFLIGHT FAILED" "$env_preflight"
fi
printf '[deploy-preflight] production_environment=pass superadmin_mfa=required\n'

if [ "$DISK_PATH" != "/" ]; then
  block "INVALID DISK TARGET" \
    "Production deployment and maintenance must check the root filesystem (/)."
fi
if ! [[ "$MIN_FREE_GIB" =~ ^[1-9][0-9]*$ ]] || [ "$MIN_FREE_GIB" -lt 30 ]; then
  block "INVALID DISK REQUIREMENT" \
    "ARENZYRA_DEPLOY_MIN_FREE_GIB must be a whole number of at least 30."
fi

if ! disk_row="$(df -Pk -- "$DISK_PATH" 2>/dev/null | awk 'NR == 2 { print $4, $5, $6 }')"; then
  block "DISK CHECK FAILED" "Unable to inspect filesystem: $DISK_PATH"
fi

read -r available_kib used_percent mounted_on <<<"$disk_row"
if ! [[ "${available_kib:-}" =~ ^[0-9]+$ ]]; then
  block "DISK CHECK FAILED" "Unable to read available space for: $DISK_PATH"
fi

required_kib=$((MIN_FREE_GIB * 1024 * 1024))
available_gib="$(awk -v kib="$available_kib" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }')"

printf '[deploy-preflight] disk=%s mounted_on=%s used=%s free=%sGiB required=%sGiB\n' \
  "$DISK_PATH" "${mounted_on:-unknown}" "${used_percent:-unknown}" \
  "$available_gib" "$MIN_FREE_GIB"

if [ "$available_kib" -lt "$required_kib" ]; then
  block "LOW DISK SPACE" \
    "Available: ${available_gib} GiB" \
    "Required:  ${MIN_FREE_GIB} GiB" \
    "Free space must be reviewed safely before deployment."
fi

if ! command -v docker >/dev/null 2>&1; then
  block "DOCKER UNAVAILABLE" \
    "Docker is required to inspect the existing production services."
elif ! docker info >/dev/null 2>&1; then
  block "DOCKER DAEMON UNAVAILABLE" \
    "The Docker daemon could not be reached."
fi

if ! container_output="$(
  docker ps -a \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --format '{{.ID}}'
)"; then
  block "CONTAINER INVENTORY FAILED" \
    "Unable to enumerate the reviewed production Compose project."
fi
containers=()
while IFS= read -r container_id; do
  [ -n "$container_id" ] && containers+=("$container_id")
done <<<"$container_output"

if [ "$SKIP_HEALTH" -eq 1 ]; then
  if [ "${#containers[@]}" -ne 0 ]; then
    block "FIRST DEPLOY ASSERTION FAILED" \
      "--skip-health is allowed only when Compose project '${COMPOSE_PROJECT}' has zero managed containers." \
      "Existing managed containers: ${#containers[@]}"
  fi
  printf '[deploy-preflight] first-deploy assertion passed: no managed containers\n'
else

  if [ "${#containers[@]}" -eq 0 ]; then
    block "NO EXISTING PRODUCTION SERVICES FOUND" \
      "Compose project '${COMPOSE_PROJECT}' has no containers." \
      "Use --skip-health only for an intentional first deployment."
  fi

  unhealthy=()
  api_container_count=0
  stopped_api_count=0
  for container_id in "${containers[@]}"; do
    [ -n "$container_id" ] || continue
    if ! state="$(
      docker inspect \
        --format '{{.Name}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}' \
        "$container_id"
    )"; then
      unhealthy+=("container inventory changed during inspection")
      continue
    fi
    IFS='|' read -r name service status health <<<"$state"

    if [ "$service" = "api" ]; then
      api_container_count=$((api_container_count + 1))
    fi

    if [ "$status" != "running" ]; then
      if [ "$ALLOW_STOPPED_API_MAINTENANCE" -eq 1 ] && \
        [ "$service" = "api" ] && [ "$status" = "exited" ]; then
        stopped_api_count=$((stopped_api_count + 1))
        continue
      fi
      unhealthy+=("${name#/}: status=${status}")
      continue
    fi

    if [ "$ALLOW_STOPPED_API_MAINTENANCE" -eq 1 ] && [ "$service" = "api" ]; then
      unhealthy+=("${name#/}: maintenance_requires_status=exited actual=${status}")
      continue
    fi

    if [ "$health" = "healthy" ]; then
      continue
    fi
    case "$service" in
      proxy|postgres|redis|api|media-ai|web|discord-bot)
        unhealthy+=("${name#/}: required_health=${health}")
        ;;
      *)
        [ "$health" = "not-configured" ] || unhealthy+=("${name#/}: health=${health}")
        ;;
    esac
  done

  if [ "$ALLOW_STOPPED_API_MAINTENANCE" -eq 1 ] && \
    { [ "$api_container_count" -ne 1 ] || [ "$stopped_api_count" -ne 1 ]; }; then
    unhealthy+=("api: maintenance requires exactly one reviewed exited container")
  fi

  if [ "${#unhealthy[@]}" -gt 0 ]; then
    block "EXISTING PRODUCTION SERVICE UNHEALTHY" "${unhealthy[@]}"
  fi

  if [ "$ALLOW_STOPPED_API_MAINTENANCE" -eq 1 ]; then
    printf '[deploy-preflight] existing_services=%s health=pass maintenance_api=exited\n' "${#containers[@]}"
  else
    printf '[deploy-preflight] existing_services=%s health=pass\n' "${#containers[@]}"
  fi
fi

printf 'DEPLOYMENT PREFLIGHT PASSED\n'
