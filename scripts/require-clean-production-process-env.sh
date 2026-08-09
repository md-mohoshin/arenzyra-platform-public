#!/usr/bin/env bash

# Source this guard before any production Node.js or Git provenance command.
# Values are never printed because they may contain credentials or executable
# configuration. Reject every ambient Git variable so future Git overrides
# fail closed without requiring this list to be kept in sync with Git itself.
production_process_environment_violations=()

for production_process_environment_name in \
  BASH_ENV \
  ENV \
  NODE_OPTIONS \
  NODE_PATH \
  "${!GIT_@}"; do
  if [[ -v "$production_process_environment_name" ]]; then
    production_process_environment_violations+=(
      "$production_process_environment_name"
    )
  fi
done

if [ "${#production_process_environment_violations[@]}" -ne 0 ]; then
  printf '%s\n' \
    'PRODUCTION PROCESS ENVIRONMENT BLOCKED: shell, Node.js, or Git overrides are present.' >&2
  printf 'Unset before retrying: %s\n' \
    "${production_process_environment_violations[*]}" >&2
  unset production_process_environment_name
  unset production_process_environment_violations
  return 75
fi

unset production_process_environment_name
unset production_process_environment_violations
