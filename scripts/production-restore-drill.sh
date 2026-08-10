#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/require-local-production-docker.sh"

BACKUP_DIR=""
AGE_IDENTITY="${ARENZYRA_BACKUP_AGE_IDENTITY:-}"
POSTGRES_IMAGE="${ARENZYRA_RESTORE_POSTGRES_IMAGE:-postgres:16.14-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777}"
container=""
network=""
volume=""
container_created=0
network_created=0
volume_created=0
extraction_root=""
if ! [[ "$POSTGRES_IMAGE" =~ ^[^@[:space:]]+:[^@[:space:]]+@sha256:[a-fA-F0-9]{64}$ ]]; then
  printf 'ARENZYRA_RESTORE_POSTGRES_IMAGE must be version-and-digest pinned.\n' >&2
  exit 2
fi

usage() {
  printf 'Usage: production-restore-drill.sh --backup /opt/arenzyra-backups/<id> [--identity /secure/key.txt]\n'
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --backup) BACKUP_DIR="${2:-}"; shift ;;
    --identity) AGE_IDENTITY="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

for command in age docker find mktemp od realpath sha256sum tar tr; do
  command -v "$command" >/dev/null 2>&1 || { printf 'Missing command: %s\n' "$command" >&2; exit 2; }
done

random_hex() {
  local bytes="$1" output
  [[ "$bytes" =~ ^[1-9][0-9]*$ ]] || return 1
  output="$(od -An -N "$bytes" -tx1 /dev/urandom | tr -d '[:space:]')"
  [ "${#output}" -eq $((bytes * 2)) ] && [[ "$output" =~ ^[0-9a-f]+$ ]] || return 1
  printf '%s\n' "$output"
}
if [ -z "$BACKUP_DIR" ] || [ -z "$AGE_IDENTITY" ] || [ ! -f "$AGE_IDENTITY" ]; then
  printf 'An existing --backup directory and age --identity file are required.\n' >&2
  exit 2
fi
backup_dir="$(realpath -e -- "$BACKUP_DIR")"
case "$backup_dir" in
  /opt/arenzyra-backups/*) ;;
  *)
    if [ "${ARENZYRA_ALLOW_CUSTOM_BACKUP_ROOT:-0}" != "1" ]; then
      printf 'Refusing backup outside /opt/arenzyra-backups: %s\n' "$backup_dir" >&2
      exit 2
    fi
    ;;
esac

cleanup() {
  if [ "$container_created" -eq 1 ] && [ -n "$container" ]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  if [ "$network_created" -eq 1 ] && [ -n "$network" ]; then
    docker network rm "$network" >/dev/null 2>&1 || true
  fi
  if [ "$volume_created" -eq 1 ] && [ -n "$volume" ]; then
    docker volume rm "$volume" >/dev/null 2>&1 || true
  fi
  if [ -n "$extraction_root" ]; then
    case "$extraction_root" in
      /tmp/arenzyra-restore-drill-volumes.*)
        if [ -d "$extraction_root" ] && [ ! -L "$extraction_root" ]; then
          rm -rf -- "$extraction_root"
        fi
        ;;
    esac
  fi
}
trap cleanup EXIT

cd "$backup_dir"
age --decrypt --identity "$AGE_IDENTITY" manifest.sha256.age | sha256sum --check --strict -
age --decrypt --identity "$AGE_IDENTITY" metadata.txt.age | grep -q '^format=arenzyra-encrypted-backup-v1$'

docker image inspect "$POSTGRES_IMAGE" >/dev/null
extraction_root="$(mktemp -d /tmp/arenzyra-restore-drill-volumes.XXXXXX)"
chmod 700 "$extraction_root"
extraction_root="$(realpath -e -- "$extraction_root")"
case "$extraction_root" in
  /tmp/arenzyra-restore-drill-volumes.*) ;;
  *)
    printf 'Restore extraction root escaped the dedicated temporary namespace: %s\n' \
      "$extraction_root" >&2
    exit 1
    ;;
esac

verify_extracted_tree() {
  local target="$1"
  local archive="$2"
  local resolved_target unsafe_entry
  resolved_target="$(realpath -e -- "$target")"
  if [ "$(dirname -- "$resolved_target")" != "$extraction_root" ]; then
    printf 'Extracted volume target escaped the restore root: %s\n' "$resolved_target" >&2
    return 1
  fi
  # Restored application volumes do not require links or special files. Reject
  # them instead of relying on link-target interpretation during a real restore.
  unsafe_entry="$(find "$resolved_target" -xdev \
    \( -type l -o -type b -o -type c -o -type p -o -type s \) -print -quit)"
  if [ -n "$unsafe_entry" ]; then
    printf 'Unsafe link or special file extracted from %s: %s\n' \
      "$archive" "$unsafe_entry" >&2
    return 1
  fi
  unsafe_entry="$(find "$resolved_target" -xdev -type f -perm /6000 -print -quit)"
  if [ -n "$unsafe_entry" ]; then
    printf 'Setuid/setgid file extracted from %s: %s\n' "$archive" "$unsafe_entry" >&2
    return 1
  fi
}

extracted_volumes=0
for archive in volume-*.tar.gz.age; do
  [ -e "$archive" ] || continue
  if [ ! -f "$archive" ] || [ -L "$archive" ]; then
    printf 'Volume archive must be a regular non-symlink file: %s\n' "$archive" >&2
    exit 1
  fi
  if ! [[ "$archive" =~ ^volume-([a-z0-9][a-z0-9-]*)\.tar\.gz\.age$ ]]; then
    printf 'Unexpected volume archive name: %s\n' "$archive" >&2
    exit 1
  fi
  logical_name="${BASH_REMATCH[1]}"
  if ! age --decrypt --identity "$AGE_IDENTITY" "$archive" \
    | tar -tzf - \
    | awk '
        /^\// { bad=1 }
        /(^|\/)\.\.($|\/)/ { bad=1 }
        END { exit bad ? 1 : 0 }
      '; then
    printf 'Unsafe or corrupt volume archive: %s\n' "$archive" >&2
    exit 1
  fi

  volume_target="$extraction_root/$logical_name"
  mkdir -m 700 -- "$volume_target"
  resolved_volume_target="$(realpath -e -- "$volume_target")"
  if [ "$(dirname -- "$resolved_volume_target")" != "$extraction_root" ]; then
    printf 'Refusing unsafe volume extraction target: %s\n' "$resolved_volume_target" >&2
    exit 1
  fi
  # -o prevents an archive from restoring numeric ownership; the drill
  # validates content and containment without requiring CAP_CHOWN.
  if ! age --decrypt --identity "$AGE_IDENTITY" "$archive" \
    | docker run --rm --network none --read-only \
        --cap-drop ALL --security-opt no-new-privileges:true \
        --pids-limit 64 --memory 256m \
        --tmpfs /tmp:rw,noexec,nosuid,size=16m \
        --mount "type=bind,src=${resolved_volume_target},dst=/restore,rw" \
        --entrypoint /bin/sh "$POSTGRES_IMAGE" -ceu \
          'cd /restore; umask 077; exec tar -xozf -'; then
    printf 'Isolated extraction failed for volume archive: %s\n' "$archive" >&2
    exit 1
  fi
  verify_extracted_tree "$resolved_volume_target" "$archive"
  extracted_volumes=$((extracted_volumes + 1))
done

suffix="$(date -u '+%Y%m%d%H%M%S')-$(random_hex 8)"
container="arenzyra-restore-drill-$suffix"
network="arenzyra-restore-drill-$suffix"
volume="arenzyra-restore-drill-$suffix"

docker network create "$network" >/dev/null
network_created=1
docker volume create "$volume" >/dev/null
volume_created=1
restore_postgres_password="$(random_hex 24)"
POSTGRES_PASSWORD="$restore_postgres_password" docker run -d \
  --name "$container" --network "$network" \
  -e POSTGRES_PASSWORD \
  -e POSTGRES_DB=restore_drill \
  --mount "type=volume,src=${volume},dst=/var/lib/postgresql/data" \
  "$POSTGRES_IMAGE" >/dev/null
container_created=1
unset restore_postgres_password

ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres -d restore_drill >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  printf 'Isolated restore-drill database did not become ready.\n' >&2
  exit 1
fi

age --decrypt --identity "$AGE_IDENTITY" database.dump.age \
  | docker exec -i "$container" pg_restore -U postgres -d restore_drill \
      --exit-on-error --no-owner --no-privileges
age --decrypt --identity "$AGE_IDENTITY" database-globals.sql.age \
  | sed '/^CREATE ROLE postgres;$/d' \
  | docker exec -i "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null
table_count="$(docker exec "$container" psql -U postgres -d restore_drill -Atqc \
  "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');")"
if ! [[ "$table_count" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Restore drill completed with no application tables.\n' >&2
  exit 1
fi
docker exec "$container" psql -U postgres -d restore_drill -v ON_ERROR_STOP=1 -Atqc \
  'SELECT 1 FROM "_prisma_migrations" LIMIT 1;' >/dev/null

{
  printf 'verified_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  printf 'application_tables=%s\n' "$table_count"
  printf 'extracted_volumes=%s\n' "$extracted_volumes"
} > RESTORE_DRILL_VERIFIED

printf 'RESTORE DRILL PASSED backup=%s application_tables=%s extracted_volumes=%s\n' \
  "$backup_dir" "$table_count" "$extracted_volumes"
