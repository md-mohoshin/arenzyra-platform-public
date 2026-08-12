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
  legacy-cutover)
    [ "$#" -eq 0 ] || block "legacy-cutover accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh --legacy-cutover
    ;;
  legacy-cutover-resume)
    [ "$#" -eq 0 ] || block "legacy-cutover-resume accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh --legacy-cutover-resume
    ;;
  legacy-cutover-resume-interrupted)
    [ "$#" -eq 0 ] || \
      block "legacy-cutover-resume-interrupted accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh \
      --legacy-cutover-resume-interrupted
    ;;
  legacy-cutover-resume-interrupted-verified-backup)
    [ "$#" -eq 1 ] && [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || \
      block "legacy-cutover-resume-interrupted-verified-backup requires one backup ID."
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh \
      --legacy-cutover-resume-interrupted --reuse-verified-backup "$1"
    ;;
  legacy-cutover-resume-interrupted-candidate)
    [ "$#" -eq 2 ] && \
      [[ "$1" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] && \
      [[ "$2" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || \
      block "legacy-cutover-resume-interrupted-candidate requires one release ID and one backup ID."
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh \
      --legacy-cutover-resume-interrupted \
      --reuse-verified-backup "$2" --reuse-candidate-release "$1"
    ;;
  legacy-cutover-resume-transition-candidate)
    [ "$#" -eq 2 ] && \
      [[ "$1" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] && \
      [[ "$2" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || \
      block "legacy-cutover-resume-transition-candidate requires one release ID and one backup ID."
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh \
      --legacy-cutover-resume-transition \
      --reuse-verified-backup "$2" --reuse-candidate-release "$1"
    ;;
  failed-candidate-remove)
    [ "$#" -eq 1 ] || block "failed-candidate-remove requires one release ID."
    require_nested_assembly
    exec bash scripts/recover-production-failed-candidate.sh "$1"
    ;;
  redis-capacity-transition)
    [ "$#" -eq 0 ] || block "redis-capacity-transition accepts no arguments."
    require_nested_assembly
    exec bash scripts/recover-production-redis-capacity.sh
    ;;
  proxy-address-transition)
    [ "$#" -eq 1 ] || block "proxy-address-transition requires one release ID."
    require_nested_assembly
    exec bash scripts/recover-production-proxy-address.sh "$1"
    ;;
  legacy-cutover-resume-transition-rebuild)
    [ "$#" -eq 0 ] || block "legacy-cutover-resume-transition-rebuild accepts no arguments."
    require_nested_assembly
    exec bash scripts/deploy-production.sh \
      --legacy-cutover-resume-transition-rebuild
    ;;
  legacy-cutover-resume-transition-candidate-fresh-backup)
    [ "$#" -eq 1 ] && \
      [[ "$1" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || \
      block "legacy-cutover-resume-transition-candidate-fresh-backup requires one release ID."
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh \
      --legacy-cutover-resume-transition --reuse-candidate-release "$1"
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
  deploy-web-candidate)
    [ "$#" -eq 1 ] && \
      [[ "$1" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || \
      block "deploy-web-candidate requires one immutable release ID."
    require_nested_assembly
    exec /bin/bash scripts/deploy-production.sh \
      --web-candidate --reuse-candidate-release "$1"
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
    exec /usr/bin/env ARENZYRA_BACKUP_REQUIRE_OFFSITE=1 \
      /bin/bash scripts/production-backup.sh
    ;;
  backup-configure)
    [ "$#" -eq 0 ] || block "backup-configure accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/configure-production-backup.sh
    ;;
  backup-inventory)
    [ "$#" -eq 0 ] || block "backup-inventory accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/production-backup-inventory.sh
    ;;
  backup-inventory-current)
    [ "$#" -eq 0 ] || block "backup-inventory-current accepts no arguments."
    require_nested_assembly
    exec /usr/bin/env ARENZYRA_BACKUP_INVENTORY_PROFILE=current \
      /bin/bash scripts/production-backup-inventory.sh
    ;;
  backup-export)
    [ "$#" -eq 1 ] || block "backup-export requires one backup ID."
    require_nested_assembly
    exec /bin/bash scripts/export-production-backup.sh "$1"
    ;;
  backup-local-release)
    [ "$#" -eq 2 ] || \
      block "backup-local-release requires superseded and replacement backup IDs."
    require_nested_assembly
    exec /bin/bash scripts/release-local-production-backup.sh "$1" "$2"
    ;;
  backup-local-release-current)
    [ "$#" -eq 2 ] || \
      block "backup-local-release-current requires superseded and replacement backup IDs."
    require_nested_assembly
    exec /usr/bin/env ARENZYRA_BACKUP_RELEASE_PROFILE=current \
      /bin/bash scripts/release-local-production-backup.sh "$1" "$2"
    ;;
  source-retention)
    if [ "${1:-}" = "--nested" ]; then
      [ "$#" -ge 9 ] && [ "$#" -le 37 ] && [ $(( ($# - 1) % 4 )) -eq 0 ] || \
        block "source-retention --nested requires retained and superseded release/Root/API/Web groups."
    else
      [ "$#" -ge 4 ] && [ "$#" -le 18 ] && [ $(( $# % 2 )) -eq 0 ] || \
        block "source-retention requires a retained release/commit pair and one to eight superseded release/commit pairs."
    fi
    require_nested_assembly
    exec /bin/bash scripts/release-production-source-archives.sh "$@"
    ;;
  backup-legacy)
    [ "$#" -eq 0 ] || block "backup-legacy accepts no arguments."
    require_nested_assembly
    exec /usr/bin/env ARENZYRA_BACKUP_REQUIRE_OFFSITE=1 \
      /bin/bash scripts/production-backup.sh --allow-running-legacy-backup
    ;;
  backup-resume)
    [ "$#" -eq 1 ] || block "backup-resume requires one backup ID."
    require_nested_assembly
    exec /bin/bash scripts/resume-production-backup-offsite.sh "$1"
    ;;
  backup-resume-legacy)
    [ "$#" -eq 1 ] || block "backup-resume-legacy requires one backup ID."
    require_nested_assembly
    exec /bin/bash scripts/resume-production-backup-offsite.sh \
      --allow-running-legacy-backup "$1"
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
  legacy-admin-diagnose)
    [ "$#" -eq 0 ] || block "legacy-admin-diagnose accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/diagnose-production-legacy-database-admin.sh
    ;;
  legacy-transition-admin-diagnose)
    [ "$#" -eq 0 ] || block "legacy-transition-admin-diagnose accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/diagnose-production-legacy-database-admin.sh \
      --cutover-transition
    ;;
  legacy-auxiliary-acl-close)
    [ "$#" -eq 1 ] || block "legacy-auxiliary-acl-close requires one backup ID."
    [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || block "legacy-auxiliary-acl-close backup ID is invalid."
    require_nested_assembly
    exec /usr/bin/env ARENZYRA_DEPLOY_VERIFIED_BACKUP_ID="$1" \
      /bin/bash scripts/provision-production-database-roles.sh \
        --env /opt/arenzyra/infra/.env.publish --apply \
        --adopt-reviewed-ownership --writers-stopped \
        --confirm=ADOPT_REVIEWED_DATABASE_OWNERSHIP \
        --legacy-cutover-partial --legacy-cutover-interrupted \
        --legacy-auxiliary-acl-only
    ;;
  legacy-cutover-database-reopen)
    [ "$#" -eq 1 ] || block "legacy-cutover-database-reopen requires one immutable release ID."
    [[ "$1" =~ ^git-[0-9]{8}-[0-9]{9}-[a-f0-9]{12}$ ]] || \
      block "legacy-cutover-database-reopen release ID is invalid."
    require_nested_assembly
    recovery_release_id="$1"
    shift
    source scripts/acquire-production-deploy-lock.sh
    exec /bin/bash scripts/production-database-writer-fence.sh \
      --recover-closed --release-id "$recovery_release_id"
    ;;
  host-maintenance)
    if [ "$#" -eq 0 ]; then
      exec /bin/bash scripts/production-maintenance.sh
    elif [ "$#" -eq 1 ] && [ "$1" = "--check-only" ]; then
      exec /bin/bash scripts/production-maintenance.sh --check-only
    elif [ "$#" -eq 1 ] && [ "$1" = "--builder-cache" ]; then
      exec /bin/bash scripts/production-maintenance.sh --builder-cache
    elif [ "$#" -eq 1 ] && [ "$1" = "--unused-images" ]; then
      exec /bin/bash scripts/production-maintenance.sh --unused-images
    fi
    block "host-maintenance accepts only optional --check-only, --builder-cache, or --unused-images."
    ;;
  observe)
    [ "$#" -eq 1 ] && { [ "$1" = "ps" ] || [ "$1" = "logs" ] || [ "$1" = "network" ]; } || \
      block "observe accepts exactly ps, logs, or network."
    exec /bin/bash scripts/production-compose-observe.sh "$1"
    ;;
  protected-match-organizations)
    [ "$#" -eq 0 ] || block "protected-match-organizations accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/inspect-production-protected-match-organizations.sh
    ;;
  end-stale-global-control-matches)
    [ "$#" -eq 0 ] || block "end-stale-global-control-matches accepts no arguments."
    require_nested_assembly
    exec /bin/bash scripts/end-production-stale-global-control-matches.sh
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
