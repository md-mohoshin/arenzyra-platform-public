#!/usr/bin/env bash
set -Eeuo pipefail
set -o pipefail
umask 077

SAFE_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH="$SAFE_PATH"
EXPECTED_ROOT="/opt/arenzyra"
ENV_FILE="$EXPECTED_ROOT/infra/.env.publish"
COMPOSE_FILE="$EXPECTED_ROOT/infra/docker-compose.publish.yml"
temporary=""
original=""
launcher_json=""
env_updated=0

block() {
  printf 'PRODUCTION LAUNCHER RELEASE CONFIGURATION BLOCKED: %s\n' "$1" >&2
  exit 75
}

cleanup() {
  launcher_json=""
  case "${temporary:-}" in
    /opt/arenzyra/infra/.env.publish.launcher-release.*)
      rm -f -- "$temporary"
      ;;
  esac
  case "${original:-}" in
    /opt/arenzyra/infra/.env.publish.launcher-release-original.*)
      if [ "$env_updated" = "1" ] && [ -f "$original" ] && [ ! -L "$original" ]; then
        mv -T -- "$original" "$ENV_FILE" ||
          printf 'CRITICAL: failed to restore the original publish environment.\n' >&2
      else
        rm -f -- "$original"
      fi
      ;;
  esac
}
trap cleanup EXIT

[ "$#" -eq 0 ] || block "arguments are unsupported."
[ "$(id -u)" -eq 0 ] || block "UID 0 is required."
[ "$(pwd -P)" = "$EXPECTED_ROOT" ] || block "production root is not exact."
source scripts/require-local-production-docker.sh
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source scripts/acquire-production-deploy-lock.sh

for command in chmod chown grep install mv node rm sha256sum stat; do
  command -v "$command" >/dev/null 2>&1 || block "required command is unavailable: $command"
done
[ -r /proc/self/fd/3 ] || block "release metadata input descriptor 3 is required."
IFS= read -r launcher_json <&3 || block "release metadata input is missing."
launcher_json="${launcher_json%$'\r'}"
if IFS= read -r unexpected_input <&3; then
  block "release metadata contains unexpected trailing data."
fi

validation_summary="$(
  printf '%s' "$launcher_json" |
    node scripts/validate-launcher-release-runtime-config.cjs
)" || block "release metadata failed the reviewed schema."

[ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ] || block "publish env is missing or linked."
[ -f "$COMPOSE_FILE" ] && [ ! -L "$COMPOSE_FILE" ] || block "publish Compose file is missing or linked."
env_identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$ENV_FILE" 2>/dev/null || true)"
IFS=':' read -r env_uid env_gid env_mode env_links env_size <<<"$env_identity"
if [ "$env_uid" != "0" ] || [ "$env_gid" != "0" ] || [ "$env_links" != "1" ] ||
  ! [[ "$env_mode" =~ ^[0-7]{3,4}$ ]] || (( 8#$env_mode & 8#022 )) ||
  ! [[ "$env_size" =~ ^[1-9][0-9]*$ ]] || [ "$env_size" -gt 1048576 ]; then
  block "publish env identity, permissions, link count, or size is unsafe."
fi

key_count="$(grep -Ec '^ARENZYRA_LAUNCHER_RELEASE_JSON=' "$ENV_FILE" || true)"
[[ "$key_count" =~ ^[01]$ ]] ||
  block "publish env contains more than one active launcher release entry."
read -r original_non_launcher_sha256 _ < <(
  grep -v '^ARENZYRA_LAUNCHER_RELEASE_JSON=' "$ENV_FILE" | sha256sum
)
[[ "$original_non_launcher_sha256" =~ ^[0-9a-f]{64}$ ]] ||
  block "publish env non-launcher boundary could not be hashed."

# This gate runs under the deployment lock before the only production write.
bash scripts/production-deploy-preflight.sh

original="$EXPECTED_ROOT/infra/.env.publish.launcher-release-original.$$"
[ ! -e "$original" ] && [ ! -L "$original" ] || block "original env backup path already exists."
install -m "$env_mode" -o 0 -g 0 -- "$ENV_FILE" "$original"
[ "$(stat -Lc '%u:%g:%a:%h' -- "$original")" = "0:0:${env_mode}:1" ] ||
  block "original publish env backup identity differs."

temporary="$EXPECTED_ROOT/infra/.env.publish.launcher-release.$$"
[ ! -e "$temporary" ] && [ ! -L "$temporary" ] || block "temporary env path already exists."
while IFS= read -r line || [ -n "$line" ]; do
  if [[ "$line" == ARENZYRA_LAUNCHER_RELEASE_JSON=* ]]; then
    printf "ARENZYRA_LAUNCHER_RELEASE_JSON='%s'\n" "$launcher_json"
  else
    printf '%s\n' "$line"
  fi
done <"$ENV_FILE" >"$temporary"
[ "$key_count" = "1" ] ||
  printf "ARENZYRA_LAUNCHER_RELEASE_JSON='%s'\n" "$launcher_json" >>"$temporary"
chmod "$env_mode" "$temporary"
chown 0:0 "$temporary"
[ "$(stat -Lc '%u:%g:%a:%h' -- "$temporary")" = "0:0:${env_mode}:1" ] ||
  block "temporary publish env identity differs."
read -r candidate_non_launcher_sha256 _ < <(
  grep -v '^ARENZYRA_LAUNCHER_RELEASE_JSON=' "$temporary" | sha256sum
)
[ "$candidate_non_launcher_sha256" = "$original_non_launcher_sha256" ] ||
  block "candidate publish env changed a non-launcher byte boundary."
[ "$(node scripts/read-dotenv-value.cjs "$temporary" ARENZYRA_LAUNCHER_RELEASE_JSON)" = "$launcher_json" ] ||
  block "candidate publish env did not preserve the exact launcher metadata."

# Validate the complete candidate environment and Compose interpolation before
# it can replace the live file.
node scripts/preflight-publish.cjs --env "$temporary"
mv -T -- "$temporary" "$ENV_FILE"
temporary=""
env_updated=1

# Repeat the standard gate against the installed value. The EXIT trap restores
# the original byte copy if this check fails.
bash scripts/production-deploy-preflight.sh

rm -f -- "$original"
original=""
env_updated=0
launcher_json=""
printf 'PRODUCTION LAUNCHER RELEASE CONFIGURED %s\n' "$validation_summary"
