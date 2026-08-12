#!/usr/bin/env bash

# Sourced only after deploy-production.sh has established exact reviewed source
# provenance. The database identity verifier selects the sole reviewed local
# PostgreSQL container before this helper opens a persistent psql session.

PRODUCTION_DEPLOYMENT_ACTIVATION_LOCK_NAME='arenzyra.production.activation.v1'
production_activation_lock_dir=''
production_activation_lock_pid=''
production_activation_lock_writer_open=0
production_activation_lock_reader_open=0
production_activation_lock_active=0

read_production_activation_lock_marker() {
  local expected_marker="$1"
  local line=''
  local attempt
  for attempt in {1..8}; do
    if ! IFS= read -r -t 20 line <&12; then
      return 1
    fi
    if [ "$line" = "$expected_marker" ]; then
      return 0
    fi
  done
  return 1
}

close_production_activation_lock_session() {
  local wait_status=0
  if [ "$production_activation_lock_writer_open" -eq 1 ]; then
    printf '\\q\n' >&11 2>/dev/null || true
    exec 11>&- 2>/dev/null || true
    production_activation_lock_writer_open=0
  fi
  if [ "$production_activation_lock_reader_open" -eq 1 ]; then
    exec 12<&- 2>/dev/null || true
    production_activation_lock_reader_open=0
  fi
  if [ -n "$production_activation_lock_pid" ]; then
    wait "$production_activation_lock_pid" 2>/dev/null || wait_status=$?
    production_activation_lock_pid=''
  fi
  if [ -n "$production_activation_lock_dir" ]; then
    case "$production_activation_lock_dir" in
      /run/arenzyra-live-match-lock.*)
        rm -f -- \
          "$production_activation_lock_dir/input" \
          "$production_activation_lock_dir/output" \
          "$production_activation_lock_dir/error"
        rmdir -- "$production_activation_lock_dir" 2>/dev/null || true
        ;;
    esac
    production_activation_lock_dir=''
  fi
  production_activation_lock_active=0
  return "$wait_status"
}

acquire_production_activation_lock() {
  local database_binding_output=''
  local container_id=''
  local database=''
  local schema=''
  local -a database_binding=()

  if [ "$production_activation_lock_active" -ne 0 ] || \
    [ -n "$production_activation_lock_dir" ]; then
    printf 'LIVE MATCH ACTIVATION LOCK BLOCKED: a lock session already exists.\n' >&2
    return 75
  fi
  if ! database_binding_output="$(
    bash scripts/verify-production-database-container.sh
  )"; then
    printf 'LIVE MATCH ACTIVATION LOCK BLOCKED: production database identity was not verified.\n' >&2
    return 75
  fi
  mapfile -t database_binding <<<"$database_binding_output"
  if [ "${#database_binding[@]}" -ne 5 ]; then
    printf 'LIVE MATCH ACTIVATION LOCK BLOCKED: production database binding is invalid.\n' >&2
    return 75
  fi
  container_id="${database_binding[0]}"
  database="${database_binding[3]}"
  schema="${database_binding[4]}"

  production_activation_lock_dir="$(mktemp -d /run/arenzyra-live-match-lock.XXXXXX)"
  case "$production_activation_lock_dir" in
    /run/arenzyra-live-match-lock.*) ;;
    *)
      printf 'LIVE MATCH ACTIVATION LOCK BLOCKED: temporary session path escaped /run.\n' >&2
      production_activation_lock_dir=''
      return 75
      ;;
  esac
  chmod 700 -- "$production_activation_lock_dir"
  mkfifo -m 600 -- \
    "$production_activation_lock_dir/input" \
    "$production_activation_lock_dir/output"
  : >"$production_activation_lock_dir/error"
  chmod 600 -- "$production_activation_lock_dir/error"

  docker exec -i "$container_id" sh -ceu '
    database="$1"
    schema="$2"
    [ "${POSTGRES_DB:-}" = "$database" ]
    export PGCONNECT_TIMEOUT=10
    export PGOPTIONS="-c default_transaction_read_only=on -c search_path=$schema -c statement_timeout=20000 -c lock_timeout=15000 -c idle_session_timeout=0"
    exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$database" -At
  ' sh "$database" "$schema" \
    <"$production_activation_lock_dir/input" \
    >"$production_activation_lock_dir/output" \
    2>"$production_activation_lock_dir/error" &
  production_activation_lock_pid=$!

  exec 11>"$production_activation_lock_dir/input"
  production_activation_lock_writer_open=1
  exec 12<"$production_activation_lock_dir/output"
  production_activation_lock_reader_open=1

  printf '%s\n' \
    "SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended('$PRODUCTION_DEPLOYMENT_ACTIVATION_LOCK_NAME', 0));" \
    "SELECT 'ARENZYRA_PRODUCTION_ACTIVATION_LOCKED';" >&11
  if ! read_production_activation_lock_marker \
    'ARENZYRA_PRODUCTION_ACTIVATION_LOCKED'; then
    printf 'LIVE MATCH ACTIVATION LOCK BLOCKED: the exclusive database lock was not acquired.\n' >&2
    close_production_activation_lock_session || true
    return 75
  fi
  production_activation_lock_active=1
  verify_production_activation_lock
  printf 'LIVE MATCH ACTIVATION LOCK ACQUIRED. New countdown/live transitions are temporarily blocked.\n'
}

verify_production_activation_lock() {
  if [ "$production_activation_lock_active" -ne 1 ] || \
    [ "$production_activation_lock_writer_open" -ne 1 ] || \
    [ "$production_activation_lock_reader_open" -ne 1 ] || \
    [ -z "$production_activation_lock_pid" ] || \
    ! kill -0 "$production_activation_lock_pid" 2>/dev/null; then
    printf 'LIVE MATCH ACTIVATION LOCK BLOCKED: the database lock session is not alive.\n' >&2
    return 75
  fi

  printf '%s\n' \
    "SELECT CASE WHEN count(*) = 1 THEN 'ARENZYRA_PRODUCTION_ACTIVATION_LOCK_HELD' ELSE 'ARENZYRA_PRODUCTION_ACTIVATION_LOCK_NOT_HELD' END FROM pg_catalog.pg_locks WHERE pid = pg_catalog.pg_backend_pid() AND locktype = 'advisory' AND mode = 'ExclusiveLock' AND granted;" >&11
  if ! read_production_activation_lock_marker \
    'ARENZYRA_PRODUCTION_ACTIVATION_LOCK_HELD'; then
    printf 'LIVE MATCH ACTIVATION LOCK BLOCKED: the exclusive database lock is not held.\n' >&2
    return 75
  fi
}

release_production_activation_lock() {
  local release_status=0
  if [ "$production_activation_lock_active" -eq 1 ] && \
    [ "$production_activation_lock_writer_open" -eq 1 ] && \
    [ "$production_activation_lock_reader_open" -eq 1 ]; then
    printf '%s\n' \
      "SELECT CASE WHEN pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('$PRODUCTION_DEPLOYMENT_ACTIVATION_LOCK_NAME', 0)) THEN 'ARENZYRA_PRODUCTION_ACTIVATION_LOCK_RELEASED' ELSE 'ARENZYRA_PRODUCTION_ACTIVATION_LOCK_NOT_HELD' END;" >&11 || release_status=1
    if [ "$release_status" -eq 0 ] && \
      ! read_production_activation_lock_marker \
        'ARENZYRA_PRODUCTION_ACTIVATION_LOCK_RELEASED'; then
      release_status=1
    fi
  fi
  production_activation_lock_active=0
  close_production_activation_lock_session || release_status=1
  if [ "$release_status" -ne 0 ]; then
    printf 'LIVE MATCH ACTIVATION LOCK RELEASE WARNING: the session closed without a release acknowledgement.\n' >&2
    return 1
  fi
  printf 'LIVE MATCH ACTIVATION LOCK RELEASED.\n'
}
