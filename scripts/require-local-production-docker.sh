#!/usr/bin/env bash

# Source this file before any production Docker command. Production release,
# backup, and verification scripts are intentionally bound to the host-local
# rootful daemon; an ambient context/host must never redirect them elsewhere.
production_docker_guard_source="${BASH_SOURCE[0]}"
case "$production_docker_guard_source" in
  */*) production_docker_guard_dir="${production_docker_guard_source%/*}" ;;
  *) production_docker_guard_dir="." ;;
esac
source "$production_docker_guard_dir/require-clean-production-process-env.sh" || return $?
unset production_docker_guard_dir production_docker_guard_source

expected_docker_host="unix:///var/run/docker.sock"
if [ -n "${DOCKER_HOST:-}" ] && [ "$DOCKER_HOST" != "$expected_docker_host" ]; then
  printf 'PRODUCTION DOCKER TARGET BLOCKED: DOCKER_HOST is not the reviewed local socket.\n' >&2
  return 75
fi
if [ -n "${DOCKER_CONTEXT:-}" ] && [ "$DOCKER_CONTEXT" != "default" ]; then
  printf 'PRODUCTION DOCKER TARGET BLOCKED: DOCKER_CONTEXT is not default.\n' >&2
  return 75
fi
export DOCKER_HOST="$expected_docker_host"
unset DOCKER_CONTEXT DOCKER_CERT_PATH DOCKER_TLS DOCKER_TLS_VERIFY
