#!/usr/bin/env bash

BACKUP_RCLONE_ENV_FILE="/etc/arenzyra-backup-rclone.env"
backup_rclone_block() {
  printf 'PRODUCTION BACKUP RCLONE CONFIG BLOCKED: %s\n' "$1" >&2
  return 75
}

[ "$#" -eq 0 ] || backup_rclone_block "arguments are unsupported."
[ -f "$BACKUP_RCLONE_ENV_FILE" ] && [ ! -L "$BACKUP_RCLONE_ENV_FILE" ] || \
  backup_rclone_block "the fixed credential file is missing or linked."
backup_rclone_identity="$(stat -Lc '%u:%g:%a:%h:%s' -- "$BACKUP_RCLONE_ENV_FILE" 2>/dev/null || true)"
IFS=':' read -r backup_rclone_uid backup_rclone_gid backup_rclone_mode \
  backup_rclone_links backup_rclone_size <<<"$backup_rclone_identity"
if [ "$backup_rclone_uid" != "0" ] || [ "$backup_rclone_gid" != "0" ] || \
  [ "$backup_rclone_mode" != "600" ] || [ "$backup_rclone_links" != "1" ] || \
  ! [[ "$backup_rclone_size" =~ ^[1-9][0-9]*$ ]] || [ "$backup_rclone_size" -gt 8192 ]; then
  backup_rclone_block "credential identity, permissions, link count, or size is unsafe."
fi

backup_rclone_expected_keys=(
  RCLONE_CONFIG_ARENZYRAB2_TYPE
  RCLONE_CONFIG_ARENZYRAB2_PROVIDER
  RCLONE_CONFIG_ARENZYRAB2_ENV_AUTH
  RCLONE_CONFIG_ARENZYRAB2_ACCESS_KEY_ID
  RCLONE_CONFIG_ARENZYRAB2_SECRET_ACCESS_KEY
  RCLONE_CONFIG_ARENZYRAB2_ENDPOINT
  RCLONE_CONFIG_ARENZYRAB2_ACL
  RCLONE_CONFIG_ARENZYRAB2_NO_CHECK_BUCKET
)
mapfile -t backup_rclone_actual_keys < <(
  awk -F= '
    /^[A-Z][A-Z0-9_]*=/ { print $1; next }
    { exit 64 }
  ' "$BACKUP_RCLONE_ENV_FILE"
)
if [ "$(wc -l <"$BACKUP_RCLONE_ENV_FILE")" -ne "${#backup_rclone_expected_keys[@]}" ] || \
  [ "${#backup_rclone_actual_keys[@]}" -ne "${#backup_rclone_expected_keys[@]}" ]; then
  backup_rclone_block "credential keys are incomplete or unexpected."
fi
for backup_rclone_index in "${!backup_rclone_expected_keys[@]}"; do
  if [ "${backup_rclone_actual_keys[$backup_rclone_index]}" != \
    "${backup_rclone_expected_keys[$backup_rclone_index]}" ]; then
    backup_rclone_block "credential key order or allowlist differs."
  fi
done

backup_rclone_read() {
  node "$SCRIPT_DIR/read-dotenv-value.cjs" "$BACKUP_RCLONE_ENV_FILE" "$1"
}
RCLONE_CONFIG_ARENZYRAB2_TYPE="$(backup_rclone_read RCLONE_CONFIG_ARENZYRAB2_TYPE)"
RCLONE_CONFIG_ARENZYRAB2_PROVIDER="$(backup_rclone_read RCLONE_CONFIG_ARENZYRAB2_PROVIDER)"
RCLONE_CONFIG_ARENZYRAB2_ENV_AUTH="$(backup_rclone_read RCLONE_CONFIG_ARENZYRAB2_ENV_AUTH)"
RCLONE_CONFIG_ARENZYRAB2_ACCESS_KEY_ID="$(backup_rclone_read RCLONE_CONFIG_ARENZYRAB2_ACCESS_KEY_ID)"
RCLONE_CONFIG_ARENZYRAB2_SECRET_ACCESS_KEY="$(backup_rclone_read RCLONE_CONFIG_ARENZYRAB2_SECRET_ACCESS_KEY)"
RCLONE_CONFIG_ARENZYRAB2_ENDPOINT="$(backup_rclone_read RCLONE_CONFIG_ARENZYRAB2_ENDPOINT)"
RCLONE_CONFIG_ARENZYRAB2_ACL="$(backup_rclone_read RCLONE_CONFIG_ARENZYRAB2_ACL)"
RCLONE_CONFIG_ARENZYRAB2_NO_CHECK_BUCKET="$(backup_rclone_read RCLONE_CONFIG_ARENZYRAB2_NO_CHECK_BUCKET)"

[ "$RCLONE_CONFIG_ARENZYRAB2_TYPE" = "s3" ] && \
  [ "$RCLONE_CONFIG_ARENZYRAB2_PROVIDER" = "Other" ] && \
  [ "$RCLONE_CONFIG_ARENZYRAB2_ENV_AUTH" = "false" ] && \
  [ "$RCLONE_CONFIG_ARENZYRAB2_ENDPOINT" = "https://s3.eu-central-003.backblazeb2.com" ] && \
  [ "$RCLONE_CONFIG_ARENZYRAB2_ACL" = "private" ] && \
  [ "$RCLONE_CONFIG_ARENZYRAB2_NO_CHECK_BUCKET" = "true" ] || \
  backup_rclone_block "the fixed private EU endpoint policy differs."
[[ "$RCLONE_CONFIG_ARENZYRAB2_ACCESS_KEY_ID" =~ ^[A-Za-z0-9_-]{25}$ ]] || \
  backup_rclone_block "application key ID is invalid."
[[ "$RCLONE_CONFIG_ARENZYRAB2_SECRET_ACCESS_KEY" =~ ^[A-Za-z0-9+/=]{31}$ ]] || \
  backup_rclone_block "application key secret is invalid."

export RCLONE_CONFIG_ARENZYRAB2_TYPE RCLONE_CONFIG_ARENZYRAB2_PROVIDER
export RCLONE_CONFIG_ARENZYRAB2_ENV_AUTH RCLONE_CONFIG_ARENZYRAB2_ACCESS_KEY_ID
export RCLONE_CONFIG_ARENZYRAB2_SECRET_ACCESS_KEY RCLONE_CONFIG_ARENZYRAB2_ENDPOINT
export RCLONE_CONFIG_ARENZYRAB2_ACL RCLONE_CONFIG_ARENZYRAB2_NO_CHECK_BUCKET
unset backup_rclone_uid backup_rclone_gid backup_rclone_mode backup_rclone_links
unset backup_rclone_size backup_rclone_identity backup_rclone_actual_keys
unset backup_rclone_expected_keys backup_rclone_index
