#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
EXPECTED_ROOT="/opt/arenzyra"
INCOMING_ROOT="/opt/arenzyra-backup-bootstrap-incoming"
AGE_INPUT="$INCOMING_ROOT/age"
RCLONE_INPUT="$INCOMING_ROOT/rclone"
AGE_SHA256="2e305637f2a0555305e21c17fb74446acbb39b53135d43d4b744e50c287133a5"
RCLONE_SHA256="f3f9aff817f9766029e50adf9a7963c169e475b8f10c7927823568a0d9443db7"
HELPER_IMAGE="postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777"
REMOTE_ROOT="arenzyrab2:arenzyra-prod-backup-84f2c9/arenzyra/production"
CONFIG_FILE="/etc/arenzyra-backup-rclone.env"
RUN_ROOT=""
config_temporary=""
age_recipient=""
access_key_id=""
secret_access_key=""

block() {
  printf 'PRODUCTION BACKUP CONFIGURATION BLOCKED: %s\n' "$1" >&2
  exit 75
}

cleanup() {
  access_key_id=""
  secret_access_key=""
  unset RCLONE_CONFIG_ARENZYRAB2_ACCESS_KEY_ID
  unset RCLONE_CONFIG_ARENZYRAB2_SECRET_ACCESS_KEY
  case "${config_temporary:-}" in
    /etc/.arenzyra-backup-rclone.env.*) rm -f -- "$config_temporary" ;;
  esac
  case "${RUN_ROOT:-}" in
    /run/arenzyra-backup-bootstrap.*)
      rm -f -- "$RUN_ROOT/probe.bin.age" "$RUN_ROOT/downloaded.bin.age" \
        "$RUN_ROOT/remote-inventory"
      rmdir -- "$RUN_ROOT" 2>/dev/null || true
      ;;
  esac
}
trap cleanup EXIT

[ "$#" -eq 0 ] || block "arguments are unsupported."
[ "$REPOSITORY_ROOT" = "$EXPECTED_ROOT" ] || block "repository root is not exact."
cd "$REPOSITORY_ROOT"
source scripts/require-local-production-docker.sh
# shellcheck source=scripts/acquire-production-deploy-lock.sh
source scripts/acquire-production-deploy-lock.sh
bash scripts/production-deploy-preflight.sh --allow-read-only-legacy-backup

[ "$(uname -m)" = "x86_64" ] || block "the reviewed tools require x86_64 Linux."
for command in docker find grep install mktemp openssl sha256sum stat; do
  command -v "$command" >/dev/null 2>&1 || block "required system command is unavailable: $command"
done
[ -r /proc/self/fd/3 ] || block "credential input descriptor 3 is required."
IFS= read -r age_recipient <&3 || block "age recipient input is missing."
IFS= read -r access_key_id <&3 || block "application key ID input is missing."
IFS= read -r secret_access_key <&3 || block "application key secret input is missing."
if IFS= read -r unexpected_input <&3; then
  block "credential input contains unexpected trailing data."
fi
[[ "$age_recipient" =~ ^age1[0-9a-z]{58}$ ]] || block "age recipient is invalid."
[[ "$access_key_id" =~ ^[A-Za-z0-9_-]{25}$ ]] || block "application key ID is invalid."
[[ "$secret_access_key" =~ ^[A-Za-z0-9+/=]{31}$ ]] || block "application key secret is invalid."

require_input() {
  local path="$1" expected_hash="$2" maximum_bytes="$3" identity actual_hash
  [ -f "$path" ] && [ ! -L "$path" ] || block "$path is missing or linked."
  identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$path" 2>/dev/null || true)"
  IFS=':' read -r uid gid mode links size <<<"$identity"
  if [ "$uid" != "0" ] || [ "$gid" != "0" ] || [ "$links" != "1" ] || \
    ! [[ "$mode" =~ ^[0-7]{3,4}$ ]] || (( 8#$mode & 8#022 )) || \
    ! [[ "$size" =~ ^[1-9][0-9]*$ ]] || [ "$size" -gt "$maximum_bytes" ]; then
    block "$path has unsafe identity, permissions, link count, or size."
  fi
  actual_hash="$(sha256sum -- "$path" | awk '{print $1}')"
  [ "$actual_hash" = "$expected_hash" ] || block "$path checksum differs."
}
require_input "$AGE_INPUT" "$AGE_SHA256" 16777216
require_input "$RCLONE_INPUT" "$RCLONE_SHA256" 134217728

install_tool() {
  local name="$1" input="$2" expected_hash="$3" target="/usr/local/bin/$1" actual_hash temporary
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] || block "$target is not a regular file."
    [ "$(stat -Lc '%u:%g:%a:%h' -- "$target")" = "0:0:755:1" ] || \
      block "$target identity or permissions differ."
    actual_hash="$(sha256sum -- "$target" | awk '{print $1}')"
    [ "$actual_hash" = "$expected_hash" ] || block "$target is an unreviewed binary."
    return
  fi
  temporary="/usr/local/bin/.arenzyra-${name}.$$"
  install -o 0 -g 0 -m 0755 -- "$input" "$temporary"
  [ "$(sha256sum -- "$temporary" | awk '{print $1}')" = "$expected_hash" ] || \
    block "$name installed checksum differs."
  mv -T -- "$temporary" "$target"
}
install_tool age "$AGE_INPUT" "$AGE_SHA256"
install_tool rclone "$RCLONE_INPUT" "$RCLONE_SHA256"
[ "$(age --version)" = "v1.3.1" ] || block "installed age version differs."
[ "$(rclone version | sed -n '1p')" = "rclone v1.75.0" ] || \
  block "installed rclone version differs."

config_temporary="/etc/.arenzyra-backup-rclone.env.$$"
{
  printf 'RCLONE_CONFIG_ARENZYRAB2_TYPE=s3\n'
  printf 'RCLONE_CONFIG_ARENZYRAB2_PROVIDER=Other\n'
  printf 'RCLONE_CONFIG_ARENZYRAB2_ENV_AUTH=false\n'
  printf 'RCLONE_CONFIG_ARENZYRAB2_ACCESS_KEY_ID=%s\n' "$access_key_id"
  printf 'RCLONE_CONFIG_ARENZYRAB2_SECRET_ACCESS_KEY=%s\n' "$secret_access_key"
  printf 'RCLONE_CONFIG_ARENZYRAB2_ENDPOINT=https://s3.eu-central-003.backblazeb2.com\n'
  printf 'RCLONE_CONFIG_ARENZYRAB2_ACL=private\n'
  printf 'RCLONE_CONFIG_ARENZYRAB2_NO_CHECK_BUCKET=true\n'
} >"$config_temporary"
chmod 0600 "$config_temporary"
chown 0:0 "$config_temporary"
if [ -e "$CONFIG_FILE" ] || [ -L "$CONFIG_FILE" ]; then
  [ -f "$CONFIG_FILE" ] && [ ! -L "$CONFIG_FILE" ] || block "existing credential file is unsafe."
  [ "$(stat -Lc '%u:%g:%a:%h' -- "$CONFIG_FILE")" = "0:0:600:1" ] || \
    block "existing credential file identity or permissions differ."
  cmp -s -- "$config_temporary" "$CONFIG_FILE" || \
    block "credential rotation requires a separately reviewed action."
  rm -f -- "$config_temporary"
  config_temporary=""
else
  mv -T -- "$config_temporary" "$CONFIG_FILE"
  config_temporary=""
fi

# shellcheck source=scripts/load-production-backup-rclone-env.sh
source scripts/load-production-backup-rclone-env.sh
RUN_ROOT="$(mktemp -d /run/arenzyra-backup-bootstrap.XXXXXX)"
openssl rand 64 | age --encrypt --recipient "$age_recipient" \
  --output "$RUN_ROOT/probe.bin.age"
probe_name="server-backup-bootstrap-$(date -u '+%Y%m%dT%H%M%SZ')-$(openssl rand -hex 4).bin.age"
probe_remote="$REMOTE_ROOT/probes/$probe_name"
rclone copyto "$RUN_ROOT/probe.bin.age" "$probe_remote" \
  --immutable --no-traverse --s3-no-check-bucket --log-level ERROR
rclone copyto "$probe_remote" "$RUN_ROOT/downloaded.bin.age" \
  --immutable --no-traverse --s3-no-check-bucket --log-level ERROR
[ "$(sha256sum "$RUN_ROOT/probe.bin.age" | awk '{print $1}')" = \
  "$(sha256sum "$RUN_ROOT/downloaded.bin.age" | awk '{print $1}')" ] || \
  block "off-host probe checksum differs."

if [ -e /opt/arenzyra-backups ] || [ -L /opt/arenzyra-backups ]; then
  [ -d /opt/arenzyra-backups ] && [ ! -L /opt/arenzyra-backups ] || \
    block "local backup root is not a regular directory."
  backup_root_identity="$(stat -Lc '%u:%g:%a' -- /opt/arenzyra-backups)"
  IFS=':' read -r backup_root_uid backup_root_gid backup_root_mode \
    <<<"$backup_root_identity"
  if [ "$backup_root_uid" != "0" ] || [ "$backup_root_gid" != "0" ] || \
    ! [[ "$backup_root_mode" =~ ^[0-7]{3,4}$ ]] || \
    (( 8#$backup_root_mode & 8#022 )); then
    block "local backup root identity is unsafe."
  fi
  if find /opt/arenzyra-backups -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
    block "an existing local backup prevents age recipient replacement."
  fi
fi
rclone lsf "$REMOTE_ROOT" --recursive --files-only --log-level ERROR \
  >"$RUN_ROOT/remote-inventory"
[ "$(stat -c %s -- "$RUN_ROOT/remote-inventory")" -le 65536 ] || \
  block "off-host inventory is oversized."
remote_inventory_count=0
while IFS= read -r remote_inventory_entry; do
  [ -n "$remote_inventory_entry" ] || continue
  remote_inventory_count=$((remote_inventory_count + 1))
  [ "$remote_inventory_count" -le 64 ] || block "off-host inventory has too many entries."
  case "$remote_inventory_entry" in
    probes/desktop-key-validation-*.bin.age|probes/server-backup-bootstrap-*.bin.age) ;;
    *) block "a non-probe off-host object prevents age recipient replacement." ;;
  esac
done <"$RUN_ROOT/remote-inventory"
[ "$remote_inventory_count" -ge 1 ] || block "off-host probe inventory is unexpectedly empty."

bash scripts/production-deploy-preflight.sh --allow-read-only-legacy-backup
if ! docker image inspect "$HELPER_IMAGE" >/dev/null 2>&1; then
  docker pull "$HELPER_IMAGE"
fi
docker image inspect "$HELPER_IMAGE" >/dev/null 2>&1 || \
  block "reviewed backup helper image is unavailable after pull."

node scripts/configure-production-backup-env.cjs \
  --age-recipient "$age_recipient" \
  --confirm CONFIGURE_REVIEWED_PRODUCTION_BACKUP \
  --replace-unverified-age-recipient
printf 'PRODUCTION BACKUP CONFIGURATION COMPLETE remote_probe=%s\n' \
  "arenzyra/production/probes/$probe_name"
