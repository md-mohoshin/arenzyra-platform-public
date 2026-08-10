#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
EXPECTED_ROOT="/opt/arenzyra"

block() {
  printf 'PRODUCTION ENTRYPOINT BLOCKED: %s No production action was attempted.\n' "$1" >&2
  exit 75
}

[ "$(id -u)" -eq 0 ] || block "UID 0 is required."
[ -x /usr/bin/env ] && [ -x /usr/bin/git ] || block "reviewed system env/git are unavailable."
[ -d /root ] || block "reviewed root HOME is unavailable."
cd "$EXPECTED_ROOT" 2>/dev/null || block "production root is unavailable."
[ "$(pwd -P)" = "$EXPECTED_ROOT" ] || block "production root is not exact."

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

verify_repository() {
  local label="$1" repository="$2" expected_variable="$3"
  local expected="${!expected_variable:-}" top="" head="" replacements="" status=""
  [[ "$expected" =~ ^[0-9a-f]{40}$ ]] || block "$label reviewed commit is missing or invalid."
  [ ! -L "$repository" ] && [ -d "$repository" ] && \
    [ ! -L "$repository/.git" ] && [ -d "$repository/.git" ] || \
    block "$label is not a standalone Git worktree."
  [ ! -e "$repository/.git/info/grafts" ] && \
    [ ! -L "$repository/.git/info/grafts" ] && \
    [ ! -e "$repository/.git/objects/info/alternates" ] && \
    [ ! -L "$repository/.git/objects/info/alternates" ] && \
    [ ! -e "$repository/.git/objects/info/http-alternates" ] && \
    [ ! -L "$repository/.git/objects/info/http-alternates" ] || \
    block "$label Git object substitution metadata exists."
  top="$("${bootstrap_git[@]}" -C "$repository" rev-parse --show-toplevel 2>/dev/null || true)"
  head="$("${bootstrap_git[@]}" -C "$repository" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
  replacements="$("${bootstrap_git[@]}" -C "$repository" \
    for-each-ref --format='%(refname)' refs/replace 2>/dev/null || printf '__git_failed__')"
  status="$("${bootstrap_git[@]}" -C "$repository" status \
    --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>/dev/null || printf '__git_failed__')"
  [ "$top" = "$repository" ] && [ "$head" = "$expected" ] && \
    [ -z "$replacements" ] && [ -z "$status" ] || \
    block "$label is not the exact clean reviewed commit."
}

verify_repository ROOT "$EXPECTED_ROOT" ARENZYRA_REVIEWED_ROOT_COMMIT

require_nested_assembly() {
  verify_repository API "$EXPECTED_ROOT/apps/api" ARENZYRA_REVIEWED_API_COMMIT
  verify_repository WEB "$EXPECTED_ROOT/apps/arenzyra-web" ARENZYRA_REVIEWED_WEB_COMMIT
}

command_id="${1:-}"
[ -n "$command_id" ] || block "an allowlisted command ID is required."
shift

case "$command_id" in
  deploy)
    [ "$#" -eq 0 ] || block "deploy accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh
    ;;
  deploy-discord)
    if [ "$#" -eq 0 ]; then
      first_deploy=()
    elif [ "$#" -eq 1 ] && [ "$1" = "--first-deploy" ]; then
      first_deploy=(--first-deploy)
    else
      block "deploy-discord accepts only optional --first-deploy."
    fi
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh --discord-bot "${first_deploy[@]}"
    ;;
  rollback-discord)
    [ "$#" -eq 1 ] && [[ "$1" =~ ^[a-zA-Z0-9._-]+$ ]] || \
      block "rollback-discord requires one immutable release ID."
    exec /bin/bash scripts/rollback-production-images.sh --release "$1" --discord-bot
    ;;
  recover-web)
    [ "$#" -eq 0 ] || block "recover-web accepts no arguments."
    exec /bin/bash scripts/recover-production-web.sh
    ;;
  idp-dry-run)
    [ "$#" -eq 0 ] || block "idp-dry-run accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/production-api-maintenance.sh idp-credentials dry-run
    ;;
  backup)
    [ "$#" -eq 0 ] || block "backup accepts no arguments."
    exec /bin/bash scripts/production-backup.sh
    ;;
  restore-drill)
    [ "$#" -eq 1 ] || block "restore-drill requires one backup directory."
    case "$1" in /opt/arenzyra-backups/*) ;; *) block "restore-drill backup path is outside the reviewed root." ;; esac
    exec /bin/bash scripts/production-restore-drill.sh --backup "$1"
    ;;
  roles-dry-run)
    [ "$#" -eq 0 ] || block "roles-dry-run accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/provision-production-database-roles.sh \
      --env /opt/arenzyra/infra/.env.publish --dry-run
    ;;
  host-maintenance)
    if [ "$#" -eq 0 ]; then
      exec /bin/bash scripts/production-maintenance.sh
    elif [ "$#" -eq 1 ] && [ "$1" = "--check-only" ]; then
      exec /bin/bash scripts/production-maintenance.sh --check-only
    fi
    block "host-maintenance accepts only optional --check-only."
    ;;
  observe)
    [ "$#" -eq 1 ] && { [ "$1" = "ps" ] || [ "$1" = "logs" ]; } || \
      block "observe accepts exactly ps or logs."
    exec /bin/bash scripts/production-compose-observe.sh "$1"
    ;;
  verify)
    [ "$#" -eq 0 ] || block "verify accepts no arguments."
    require_nested_assembly
    exec /usr/bin/env node scripts/verify-publish.cjs --env infra/.env.publish
    ;;
  studio-qa)
    [ "$#" -eq 0 ] || block "studio-qa accepts no arguments."
    require_nested_assembly
    exec /usr/bin/env node scripts/live-studio-qa.cjs
    ;;
  *)
    block "command ID is not allowlisted."
    ;;
esac
