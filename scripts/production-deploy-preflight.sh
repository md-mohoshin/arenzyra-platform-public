#!/usr/bin/env bash
set -Eeuo pipefail
source scripts/require-local-production-docker.sh

DISK_PATH="${ARENZYRA_DEPLOY_DISK_PATH:-/}"
MIN_FREE_GIB="${ARENZYRA_DEPLOY_MIN_FREE_GIB:-30}"
COMPOSE_PROJECT="${ARENZYRA_DEPLOY_COMPOSE_PROJECT:-}"
PUBLISH_ENV_FILE="${ARENZYRA_DEPLOY_ENV_FILE:-infra/.env.publish}"
SKIP_HEALTH=0
ALLOW_WEB_RECOVERY=0
ALLOW_READ_ONLY_LEGACY_BACKUP=0
ALLOW_LEGACY_CUTOVER_STOPPED=0
ALLOW_LEGACY_CUTOVER_INTERRUPTED=0
ALLOW_CUTOVER_STOPPED=0
ALLOW_CUTOVER_INTERRUPTED=0
ALLOW_CUTOVER_TRANSITION=0
ALLOW_CUTOVER_DEPENDENCY_RECOVERY=0
ALLOW_CUTOVER_FAILED_CANDIDATE=0
ALLOW_CUTOVER_PROXY_COLLISION=0
ALLOW_LOW_DISK_BACKUP_RELEASE=0
ALLOW_LOW_DISK_BACKUP_RELEASE_CURRENT=0
ALLOW_LOW_DISK_BACKUP_INVENTORY=0
ALLOW_LOW_DISK_SOURCE_RELEASE=0

usage() {
  cat <<'EOF'
Usage: production-deploy-preflight.sh [--skip-health | --allow-web-recovery | --allow-read-only-legacy-backup | --allow-legacy-cutover-stopped | --allow-legacy-cutover-interrupted | --allow-cutover-stopped | --allow-cutover-interrupted | --allow-cutover-transition | --allow-cutover-dependency-recovery | --allow-cutover-failed-candidate | --allow-cutover-proxy-collision | --allow-low-disk-backup-release | --allow-low-disk-backup-release-current | --allow-low-disk-backup-inventory | --allow-low-disk-source-release]

Read-only production deployment gate. It requires at least 30 GiB free by
default and verifies existing containers in the production Compose project.
It never deletes or modifies production data.

--allow-web-recovery permits exactly one existing web container to be either
stopped or healthy while requiring the API, database, cache, proxy, and media
service containers to remain present and healthy. It is reserved for the
reviewed existing-container web recovery wrapper and cannot be combined with
--skip-health.

--allow-read-only-legacy-backup requires every existing service to remain
healthy while recognizing only the exact observed root-owned API volume profile.
It is reserved for the reviewed encrypted pre-remediation backup commands and
does not authorize a build, pull, recreate, restart, migration, ownership
change, or Compose operation.

The cutover modes are internal to the reviewed one-time legacy cutover. The
interrupted variants accept at most one stopped container per application
service and require at least one to be absent, while retaining exactly one
healthy legacy database and cache. They respectively attest the legacy-volume,
remediated-volume, or database/cache-only transition states and cannot be
combined with another exception.

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
    --allow-web-recovery)
      ALLOW_WEB_RECOVERY=1
      ;;
    --allow-read-only-legacy-backup)
      ALLOW_READ_ONLY_LEGACY_BACKUP=1
      ;;
    --allow-legacy-cutover-stopped)
      ALLOW_LEGACY_CUTOVER_STOPPED=1
      ;;
    --allow-legacy-cutover-interrupted)
      ALLOW_LEGACY_CUTOVER_INTERRUPTED=1
      ;;
    --allow-cutover-stopped)
      ALLOW_CUTOVER_STOPPED=1
      ;;
    --allow-cutover-interrupted)
      ALLOW_CUTOVER_INTERRUPTED=1
      ;;
    --allow-cutover-transition)
      ALLOW_CUTOVER_TRANSITION=1
      ;;
    --allow-cutover-dependency-recovery)
      ALLOW_CUTOVER_DEPENDENCY_RECOVERY=1
      ;;
    --allow-cutover-failed-candidate)
      ALLOW_CUTOVER_FAILED_CANDIDATE=1
      ;;
    --allow-cutover-proxy-collision)
      ALLOW_CUTOVER_PROXY_COLLISION=1
      ;;
    --allow-low-disk-backup-release)
      # This maintenance-only form retains the exact dependency-recovery
      # topology and data-volume checks while permitting only the operation
      # that releases one reverified, superseded local encrypted backup copy.
      ALLOW_CUTOVER_DEPENDENCY_RECOVERY=1
      ALLOW_LOW_DISK_BACKUP_RELEASE=1
      ;;
    --allow-low-disk-backup-inventory)
      # Read-only inventory still requires the ordinary healthy modern stack
      # and strict data-volume policy. It waives only the disk threshold so an
      # operator can identify a verified local duplicate to release safely.
      ALLOW_LOW_DISK_BACKUP_INVENTORY=1
      ;;
    --allow-low-disk-backup-release-current)
      # The modern-stack release path retains ordinary health and strict
      # volume checks while permitting only one reverified local duplicate to
      # be released below the deployment disk threshold.
      ALLOW_LOW_DISK_BACKUP_RELEASE_CURRENT=1
      ;;
    --allow-low-disk-source-release)
      # Source retention is confined to superseded reviewed checkout copies;
      # it preserves the active and explicitly retained prior checkout. Keep
      # the ordinary full-stack health and volume policy: this exception
      # waives only the disk threshold adjacent to that source-only deletion.
      ALLOW_LOW_DISK_SOURCE_RELEASE=1
      ;;
    --allow-stopped-idp-maintenance)
      printf '%s\n' \
        'DEPLOYMENT BLOCKED: IDP MUTATION PREFLIGHT MODE IS UNAVAILABLE' \
        'Production IDP apply/validate require a reviewed durable writer-credential fence.' \
        'No cleanup or deployment action was performed.' >&2
      exit 75
      ;;
    --allow-stopped-api-maintenance)
      printf '%s\n' \
        'DEPLOYMENT BLOCKED: LEGACY MAINTENANCE FLAG IS UNSUPPORTED' \
        'Use only the reviewed IDP closure wrapper.' \
        'No cleanup or deployment action was performed.' >&2
      exit 75
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

if [ "$SKIP_HEALTH" -eq 1 ] && [ "$ALLOW_WEB_RECOVERY" -eq 1 ]; then
  block "INCOMPATIBLE PREFLIGHT MODES" \
    "--skip-health and --allow-web-recovery cannot be combined."
fi
if { [ "$SKIP_HEALTH" -eq 1 ] || [ "$ALLOW_WEB_RECOVERY" -eq 1 ]; } && \
  [ "$ALLOW_READ_ONLY_LEGACY_BACKUP" -eq 1 ]; then
  block "INCOMPATIBLE PREFLIGHT MODES" \
    "--allow-read-only-legacy-backup cannot be combined with another exception mode."
fi
if [ "$ALLOW_LEGACY_CUTOVER_STOPPED" -eq 1 ] && \
  { [ "$SKIP_HEALTH" -eq 1 ] || [ "$ALLOW_WEB_RECOVERY" -eq 1 ] || \
    [ "$ALLOW_READ_ONLY_LEGACY_BACKUP" -eq 1 ]; }; then
  block "INCOMPATIBLE PREFLIGHT MODES" \
    "--allow-legacy-cutover-stopped cannot be combined with another exception mode."
fi
cutover_mode_count=$((
  ALLOW_LEGACY_CUTOVER_STOPPED + ALLOW_LEGACY_CUTOVER_INTERRUPTED +
  ALLOW_CUTOVER_STOPPED + ALLOW_CUTOVER_INTERRUPTED +
  ALLOW_CUTOVER_TRANSITION + ALLOW_CUTOVER_DEPENDENCY_RECOVERY +
  ALLOW_CUTOVER_FAILED_CANDIDATE + ALLOW_CUTOVER_PROXY_COLLISION
))
if [ "$ALLOW_LOW_DISK_BACKUP_INVENTORY" -eq 1 ] && \
  { [ "$SKIP_HEALTH" -eq 1 ] || [ "$ALLOW_WEB_RECOVERY" -eq 1 ] || \
    [ "$ALLOW_READ_ONLY_LEGACY_BACKUP" -eq 1 ] || [ "$cutover_mode_count" -ne 0 ] || \
    [ "$ALLOW_LOW_DISK_BACKUP_RELEASE" -eq 1 ] || \
    [ "$ALLOW_LOW_DISK_SOURCE_RELEASE" -eq 1 ]; }; then
  block "INCOMPATIBLE PREFLIGHT MODES" \
    "--allow-low-disk-backup-inventory must be the only preflight exception."
fi
if [ "$ALLOW_LOW_DISK_BACKUP_RELEASE_CURRENT" -eq 1 ] && \
  { [ "$SKIP_HEALTH" -eq 1 ] || [ "$ALLOW_WEB_RECOVERY" -eq 1 ] || \
    [ "$ALLOW_READ_ONLY_LEGACY_BACKUP" -eq 1 ] || [ "$cutover_mode_count" -ne 0 ] || \
    [ "$ALLOW_LOW_DISK_BACKUP_RELEASE" -eq 1 ] || \
    [ "$ALLOW_LOW_DISK_BACKUP_INVENTORY" -eq 1 ] || \
    [ "$ALLOW_LOW_DISK_SOURCE_RELEASE" -eq 1 ]; }; then
  block "INCOMPATIBLE PREFLIGHT MODES" \
    "--allow-low-disk-backup-release-current must be the only preflight exception."
fi
if [ "$cutover_mode_count" -gt 1 ] || \
  { [ "$cutover_mode_count" -eq 1 ] && \
    { [ "$SKIP_HEALTH" -eq 1 ] || [ "$ALLOW_WEB_RECOVERY" -eq 1 ] || \
      [ "$ALLOW_READ_ONLY_LEGACY_BACKUP" -eq 1 ]; }; }; then
  block "INCOMPATIBLE PREFLIGHT MODES" \
    "a cutover mode must be the only preflight exception."
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

if [ "$available_kib" -lt "$required_kib" ] && \
  [ "$ALLOW_LOW_DISK_BACKUP_RELEASE" -ne 1 ] && \
  [ "$ALLOW_LOW_DISK_BACKUP_RELEASE_CURRENT" -ne 1 ] && \
  [ "$ALLOW_LOW_DISK_BACKUP_INVENTORY" -ne 1 ] && \
  [ "$ALLOW_LOW_DISK_SOURCE_RELEASE" -ne 1 ]; then
  block "LOW DISK SPACE" \
    "Available: ${available_gib} GiB" \
    "Required:  ${MIN_FREE_GIB} GiB" \
    "Free space must be reviewed safely before deployment."
fi
if [ "$available_kib" -lt "$required_kib" ] && \
  [ "$ALLOW_LOW_DISK_BACKUP_RELEASE_CURRENT" -eq 1 ]; then
  printf '[deploy-preflight] low_disk_backup_release_current=pass deployment_remains_blocked=true\n'
fi
if [ "$available_kib" -lt "$required_kib" ] && \
  [ "$ALLOW_LOW_DISK_BACKUP_INVENTORY" -eq 1 ]; then
  printf '[deploy-preflight] low_disk_backup_inventory=pass deployment_remains_blocked=true\n'
fi
if [ "$available_kib" -lt "$required_kib" ] && \
  [ "$ALLOW_LOW_DISK_BACKUP_RELEASE" -eq 1 ]; then
  printf '[deploy-preflight] low_disk_backup_release=pass deployment_remains_blocked=true\n'
fi
if [ "$available_kib" -lt "$required_kib" ] && \
  [ "$ALLOW_LOW_DISK_SOURCE_RELEASE" -eq 1 ]; then
  printf '[deploy-preflight] low_disk_source_release=pass deployment_remains_blocked=true\n'
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

volume_gate_args=()
if [ "$SKIP_HEALTH" -eq 1 ] || [ "$ALLOW_CUTOVER_TRANSITION" -eq 1 ] || \
  [ "$ALLOW_CUTOVER_DEPENDENCY_RECOVERY" -eq 1 ] || \
  [ "$ALLOW_CUTOVER_FAILED_CANDIDATE" -eq 1 ] || \
  [ "$ALLOW_CUTOVER_PROXY_COLLISION" -eq 1 ]; then
  volume_gate_args+=(--allow-absent)
elif [ "$ALLOW_WEB_RECOVERY" -eq 1 ] || [ "$ALLOW_READ_ONLY_LEGACY_BACKUP" -eq 1 ]; then
  volume_gate_args+=(--allow-running-legacy-root-api)
elif [ "$ALLOW_LEGACY_CUTOVER_STOPPED" -eq 1 ] || \
  [ "$ALLOW_LEGACY_CUTOVER_INTERRUPTED" -eq 1 ]; then
  volume_gate_args+=(--allow-stopped-legacy-cutover)
fi
if ! volume_gate_output="$(
  ARENZYRA_DEPLOY_COMPOSE_PROJECT="$COMPOSE_PROJECT" \
  ARENZYRA_DEPLOY_ENV_FILE="$PUBLISH_ENV_FILE" \
    bash scripts/verify-production-api-data-volumes.sh "${volume_gate_args[@]}" 2>&1
)"; then
  block "API DATA VOLUME POLICY FAILED" "$volume_gate_output"
fi
printf '%s\n' "$volume_gate_output"

if [ "$SKIP_HEALTH" -eq 1 ]; then
  if [ "${#containers[@]}" -ne 0 ]; then
    block "FIRST DEPLOY ASSERTION FAILED" \
      "--skip-health is allowed only when Compose project '${COMPOSE_PROJECT}' has zero managed containers." \
      "Existing managed containers: ${#containers[@]}"
  fi
  printf '[deploy-preflight] first-deploy assertion passed: no managed containers\n'
elif [ "$ALLOW_CUTOVER_TRANSITION" -eq 1 ] && [ "${#containers[@]}" -eq 0 ]; then
  printf '[deploy-preflight] cutover_transition=pass managed_containers=0 data_volumes=verified\n'
else

  if [ "${#containers[@]}" -eq 0 ]; then
    block "NO EXISTING PRODUCTION SERVICES FOUND" \
      "Compose project '${COMPOSE_PROJECT}' has no containers." \
      "Use --skip-health only for an intentional first deployment."
  fi

  unhealthy=()
  proxy_count=0
  postgres_count=0
  redis_count=0
  api_count=0
  media_ai_count=0
  web_count=0
  discord_bot_count=0
  for container_id in "${containers[@]}"; do
    [ -n "$container_id" ] || continue
    if ! state="$(
      docker inspect \
        --format '{{.Name}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}}|{{.Config.User}}' \
        "$container_id"
    )"; then
      unhealthy+=("container inventory changed during inspection")
      continue
    fi
    IFS='|' read -r name service status health configured_user <<<"$state"

    case "$service" in
      proxy) proxy_count=$((proxy_count + 1)) ;;
      postgres) postgres_count=$((postgres_count + 1)) ;;
      redis) redis_count=$((redis_count + 1)) ;;
      api) api_count=$((api_count + 1)) ;;
      media-ai) media_ai_count=$((media_ai_count + 1)) ;;
      web) web_count=$((web_count + 1)) ;;
      discord-bot) discord_bot_count=$((discord_bot_count + 1)) ;;
    esac

    if [ "$ALLOW_LEGACY_CUTOVER_STOPPED" -eq 1 ] || \
      [ "$ALLOW_LEGACY_CUTOVER_INTERRUPTED" -eq 1 ] || \
      [ "$ALLOW_CUTOVER_STOPPED" -eq 1 ] || \
      [ "$ALLOW_CUTOVER_INTERRUPTED" -eq 1 ]; then
      case "$service" in
        postgres|redis)
          if [ "$status" != "running" ] || [ "$health" != "healthy" ]; then
            unhealthy+=("${name#/}: cutover database/cache must be running/healthy, observed=${status}/${health}")
          fi
          ;;
        proxy|api|media-ai|web|discord-bot)
          [ "$status" = "exited" ] || \
            unhealthy+=("${name#/}: cutover application service must be stopped, observed=${status}")
          ;;
        *)
          unhealthy+=("${name#/}: unexpected managed cutover service=${service}")
          ;;
      esac
      continue
    fi

    if [ "$ALLOW_CUTOVER_TRANSITION" -eq 1 ]; then
      case "$service" in
        postgres|redis)
          if [ "$status" != "running" ] || [ "$health" != "healthy" ]; then
            unhealthy+=("${name#/}: transition database/cache must be running/healthy, observed=${status}/${health}")
          fi
          ;;
        *) unhealthy+=("${name#/}: unexpected transition service=${service}") ;;
      esac
      continue
    fi

    if [ "$ALLOW_CUTOVER_DEPENDENCY_RECOVERY" -eq 1 ]; then
      case "$service" in
        postgres)
          if [ "$status" != "running" ] || [ "$health" != "healthy" ]; then
            unhealthy+=("${name#/}: dependency recovery database must be running/healthy, observed=${status}/${health}")
          fi
          ;;
        redis)
          case "$configured_user" in ''|0|0:0|999:1000) ;; *)
            unhealthy+=("${name#/}: dependency recovery cache user is outside the reviewed root-to-999:1000 transition")
          esac
          case "$status" in running|restarting|exited) ;; *)
            unhealthy+=("${name#/}: dependency recovery cache state is unsupported, observed=${status}/${health}")
          esac
          ;;
        *) unhealthy+=("${name#/}: unexpected dependency recovery service=${service}") ;;
      esac
      continue
    fi

    if [ "$ALLOW_CUTOVER_FAILED_CANDIDATE" -eq 1 ]; then
      case "$service" in
        postgres|redis)
          if [ "$status" != "running" ] || [ "$health" != "healthy" ]; then
            unhealthy+=("${name#/}: failed-candidate database/cache must be running/healthy, observed=${status}/${health}")
          fi
          ;;
        api)
          if [ "$status" != "running" ] || \
            { [ "$health" != "unhealthy" ] && [ "$health" != "starting" ]; }; then
            unhealthy+=("${name#/}: failed candidate must be running and non-ready, observed=${status}/${health}")
          fi
          ;;
        media-ai)
          if [ "$status" != "running" ] || \
            { [ "$health" != "healthy" ] && [ "$health" != "unhealthy" ] && [ "$health" != "starting" ]; }; then
            unhealthy+=("${name#/}: failed candidate media service must be running, observed=${status}/${health}")
          fi
          ;;
        proxy|web)
          if [ "$status" != "created" ] && [ "$status" != "exited" ]; then
            unhealthy+=("${name#/}: failed candidate dependent must never have started, observed=${status}/${health}")
          fi
          ;;
        *) unhealthy+=("${name#/}: unexpected failed-candidate service=${service}") ;;
      esac
      continue
    fi

    if [ "$ALLOW_CUTOVER_PROXY_COLLISION" -eq 1 ]; then
      case "$service" in
        postgres|redis|api|media-ai|web)
          if [ "$status" != "running" ] || [ "$health" != "healthy" ]; then
            unhealthy+=("${name#/}: proxy-collision recovery dependency must be running/healthy, observed=${status}/${health}")
          fi
          ;;
        proxy)
          if [ "$status" != "created" ] && [ "$status" != "exited" ]; then
            unhealthy+=("${name#/}: colliding proxy must never have started, observed=${status}/${health}")
          fi
          ;;
        *) unhealthy+=("${name#/}: unexpected proxy-collision service=${service}") ;;
      esac
      continue
    fi

    if [ "$ALLOW_WEB_RECOVERY" -eq 1 ] && [ "$service" = "web" ]; then
      if [ "$status" = "exited" ]; then
        continue
      fi
      if [ "$status" != "running" ] || [ "$health" != "healthy" ]; then
        unhealthy+=("${name#/}: web recovery requires status=exited or running/healthy, observed=${status}/${health}")
      fi
      continue
    fi

    if [ "$status" != "running" ]; then
      unhealthy+=("${name#/}: status=${status}")
      continue
    fi

    if [ "$health" = "healthy" ]; then
      continue
    fi
    if { [ "$ALLOW_WEB_RECOVERY" -eq 1 ] || [ "$ALLOW_READ_ONLY_LEGACY_BACKUP" -eq 1 ]; } && \
      [ "$service" = "proxy" ] && [ "$health" = "not-configured" ]; then
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

  if [ "$ALLOW_WEB_RECOVERY" -eq 1 ] || [ "$ALLOW_READ_ONLY_LEGACY_BACKUP" -eq 1 ]; then
    required_services=(proxy postgres redis api media-ai web)
    required_counts=(
      "$proxy_count"
      "$postgres_count"
      "$redis_count"
      "$api_count"
      "$media_ai_count"
      "$web_count"
    )
    for required_index in "${!required_services[@]}"; do
      required_service="${required_services[$required_index]}"
      required_count="${required_counts[$required_index]}"
      if [ "$required_count" -ne 1 ]; then
        unhealthy+=("service=${required_service}: required_container_count=1 observed=${required_count}")
      fi
    done
  fi
  if [ "$ALLOW_LEGACY_CUTOVER_STOPPED" -eq 1 ] || \
    [ "$ALLOW_CUTOVER_STOPPED" -eq 1 ]; then
    required_services=(proxy postgres redis api media-ai web discord-bot)
    required_counts=(
      "$proxy_count" "$postgres_count" "$redis_count" "$api_count"
      "$media_ai_count" "$web_count" "$discord_bot_count"
    )
    for required_index in "${!required_services[@]}"; do
      if [ "${required_counts[$required_index]}" -ne 1 ]; then
        unhealthy+=("service=${required_services[$required_index]}: required_container_count=1 observed=${required_counts[$required_index]}")
      fi
    done
  fi
  if [ "$ALLOW_LEGACY_CUTOVER_INTERRUPTED" -eq 1 ] || \
    [ "$ALLOW_CUTOVER_INTERRUPTED" -eq 1 ]; then
    [ "$postgres_count" -eq 1 ] && [ "$redis_count" -eq 1 ] || \
      unhealthy+=("interrupted cutover requires exactly one database and cache container")
    application_counts=(
      "$proxy_count" "$api_count" "$media_ai_count" "$web_count"
      "$discord_bot_count"
    )
    missing_application_count=0
    for application_count in "${application_counts[@]}"; do
      if [ "$application_count" -eq 0 ]; then
        missing_application_count=$((missing_application_count + 1))
      elif [ "$application_count" -ne 1 ]; then
        unhealthy+=("interrupted cutover application container count exceeds one")
      fi
    done
    [ "$missing_application_count" -ge 1 ] || \
      unhealthy+=("interrupted cutover requires at least one absent stopped application container")
  fi
  if [ "$ALLOW_CUTOVER_TRANSITION" -eq 1 ]; then
    if [ "$postgres_count" -ne 1 ] || [ "$redis_count" -ne 1 ] || \
      [ "${#containers[@]}" -ne 2 ]; then
      unhealthy+=("cutover transition requires exactly postgres and redis")
    fi
  fi
  if [ "$ALLOW_CUTOVER_DEPENDENCY_RECOVERY" -eq 1 ]; then
    if [ "$postgres_count" -ne 1 ] || [ "$redis_count" -ne 1 ] || \
      [ "${#containers[@]}" -ne 2 ]; then
      unhealthy+=("cutover dependency recovery requires exactly postgres and redis")
    fi
  fi
  if [ "$ALLOW_CUTOVER_FAILED_CANDIDATE" -eq 1 ]; then
    if [ "$postgres_count" -ne 1 ] || [ "$redis_count" -ne 1 ] || \
      [ "$api_count" -ne 1 ] || [ "$media_ai_count" -ne 1 ] || \
      [ "$proxy_count" -ne 1 ] || [ "$web_count" -ne 1 ] || \
      [ "$discord_bot_count" -ne 0 ] || [ "${#containers[@]}" -ne 6 ]; then
      unhealthy+=("failed-candidate recovery requires exactly postgres, redis, api, media-ai, and never-started proxy/web")
    fi
  fi
  if [ "$ALLOW_CUTOVER_PROXY_COLLISION" -eq 1 ]; then
    if [ "$postgres_count" -ne 1 ] || [ "$redis_count" -ne 1 ] || \
      [ "$api_count" -ne 1 ] || [ "$media_ai_count" -ne 1 ] || \
      [ "$proxy_count" -ne 1 ] || [ "$web_count" -ne 1 ] || \
      [ "$discord_bot_count" -ne 0 ] || [ "${#containers[@]}" -ne 6 ]; then
      unhealthy+=("proxy-collision recovery requires exactly healthy postgres, redis, api, media-ai, web and one never-started proxy")
    fi
  fi

  if [ "${#unhealthy[@]}" -gt 0 ]; then
    block "EXISTING PRODUCTION SERVICE UNHEALTHY" "${unhealthy[@]}"
  fi

  if [ "$ALLOW_WEB_RECOVERY" -eq 1 ]; then
    printf '[deploy-preflight] web_recovery=pass web_container=1 dependencies=healthy\n'
  fi
  if [ "$ALLOW_READ_ONLY_LEGACY_BACKUP" -eq 1 ]; then
    printf '[deploy-preflight] legacy_backup=pass services=healthy data_volumes=read_only\n'
  fi
  if [ "$ALLOW_LEGACY_CUTOVER_STOPPED" -eq 1 ]; then
    printf '[deploy-preflight] legacy_cutover=pass applications=stopped database_cache=healthy\n'
  fi
  if [ "$ALLOW_LEGACY_CUTOVER_INTERRUPTED" -eq 1 ]; then
    printf '[deploy-preflight] legacy_cutover_interrupted=pass applications=stopped_or_absent database_cache=healthy\n'
  fi
  if [ "$ALLOW_CUTOVER_STOPPED" -eq 1 ]; then
    printf '[deploy-preflight] cutover=pass applications=stopped database_cache=healthy data_volumes=verified\n'
  fi
  if [ "$ALLOW_CUTOVER_INTERRUPTED" -eq 1 ]; then
    printf '[deploy-preflight] cutover_interrupted=pass applications=stopped_or_absent database_cache=healthy data_volumes=verified\n'
  fi
  if [ "$ALLOW_CUTOVER_TRANSITION" -eq 1 ]; then
    printf '[deploy-preflight] cutover_transition=pass database_cache=healthy data_volumes=verified\n'
  fi
  if [ "$ALLOW_CUTOVER_DEPENDENCY_RECOVERY" -eq 1 ]; then
    printf '[deploy-preflight] cutover_dependency_recovery=pass postgres=healthy redis=recoverable data_volumes=verified\n'
  fi
  if [ "$ALLOW_CUTOVER_FAILED_CANDIDATE" -eq 1 ]; then
    printf '[deploy-preflight] cutover_failed_candidate=pass dependencies=healthy api=non_ready media=attested_running dependents=never_started data_volumes=verified\n'
  fi
  if [ "$ALLOW_CUTOVER_PROXY_COLLISION" -eq 1 ]; then
    printf '[deploy-preflight] cutover_proxy_collision=pass application=healthy proxy=never_started data_volumes=verified\n'
  fi
  printf '[deploy-preflight] existing_services=%s health=pass\n' "${#containers[@]}"
fi

printf 'DEPLOYMENT PREFLIGHT PASSED\n'
