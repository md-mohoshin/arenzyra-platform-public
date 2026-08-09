#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/require-local-production-docker.sh"

required=(
  MEDIA_AI_U2NET_URL
  MEDIA_AI_U2NET_SHA256
  MEDIA_AI_ISNET_URL
  MEDIA_AI_ISNET_SHA256
)
for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    printf '[media-model-cache] required environment variable is missing: %s\n' "$name" >&2
    exit 1
  fi
done

for url in "$MEDIA_AI_U2NET_URL" "$MEDIA_AI_ISNET_URL"; do
  case "$url" in
    https://*) ;;
    *) printf '[media-model-cache] model URLs must use HTTPS\n' >&2; exit 1 ;;
  esac
done
for checksum in "$MEDIA_AI_U2NET_SHA256" "$MEDIA_AI_ISNET_SHA256"; do
  if ! [[ "$checksum" =~ ^[a-fA-F0-9]{64}$ ]]; then
    printf '[media-model-cache] model checksums must be 64 hexadecimal characters\n' >&2
    exit 1
  fi
done

volume_name="${MEDIA_AI_MODEL_VOLUME:-${COMPOSE_PROJECT_NAME:-arenzyra}_media-ai-models}"
if ! [[ "$volume_name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  printf '[media-model-cache] invalid Docker volume name: %s\n' "$volume_name" >&2
  exit 1
fi

temporary_dir="$(mktemp -d)"
cleanup() { rm -rf -- "$temporary_dir"; }
trap cleanup EXIT

curl --fail --location --proto '=https' --tlsv1.2 --retry 3 \
  --connect-timeout 15 --max-time 1800 \
  --output "$temporary_dir/u2net.onnx" "$MEDIA_AI_U2NET_URL"
curl --fail --location --proto '=https' --tlsv1.2 --retry 3 \
  --connect-timeout 15 --max-time 1800 \
  --output "$temporary_dir/isnet-general-use.onnx" "$MEDIA_AI_ISNET_URL"

printf '%s  %s\n' \
  "${MEDIA_AI_U2NET_SHA256,,}" "u2net.onnx" \
  "${MEDIA_AI_ISNET_SHA256,,}" "isnet-general-use.onnx" \
  >"$temporary_dir/manifest.sha256"
(cd "$temporary_dir" && sha256sum --check manifest.sha256)

if ! docker volume inspect "$volume_name" >/dev/null 2>&1; then
  docker volume create "$volume_name" >/dev/null
fi
volume_mount="$(docker volume inspect --format '{{.Mountpoint}}' "$volume_name")"
if [ -z "$volume_mount" ] || [ ! -d "$volume_mount" ]; then
  printf '[media-model-cache] Docker volume mount is unavailable: %s\n' "$volume_name" >&2
  exit 1
fi

stage_dir="$volume_mount/.arenzyra-model-stage-$$"
mkdir -m 0700 -- "$stage_dir"
trap 'rm -rf -- "$stage_dir"; cleanup' EXIT
install -m 0444 "$temporary_dir/u2net.onnx" "$stage_dir/u2net.onnx"
install -m 0444 "$temporary_dir/isnet-general-use.onnx" "$stage_dir/isnet-general-use.onnx"
install -m 0444 "$temporary_dir/manifest.sha256" "$stage_dir/manifest.sha256"
chown 10001:10001 "$stage_dir"/*
mv -f -- "$stage_dir/u2net.onnx" "$volume_mount/u2net.onnx"
mv -f -- "$stage_dir/isnet-general-use.onnx" "$volume_mount/isnet-general-use.onnx"
mv -f -- "$stage_dir/manifest.sha256" "$volume_mount/manifest.sha256"
rmdir -- "$stage_dir"
trap cleanup EXIT

printf '[media-model-cache] verified cache installed in Docker volume %s\n' "$volume_name"
