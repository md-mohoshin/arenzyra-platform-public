# Media AI Service (background removal)

Small FastAPI service used by the Arenzyra API and Studio to remove backgrounds from sponsor logos, player photos, and uploaded Studio images.

## Endpoints

- `GET /health/live` reports process liveness.
- `GET /health/ready` (and the compatibility `GET /health`) returns HTTP 503
  until the model warmup completes.
- `POST /remove-bg` -> accepts `multipart/form-data` with a single `file` (PNG/JPG/JPEG/WEBP, max 8MB). Returns PNG bytes with transparent background.

Optional form field:

- `model=general` for logos and objects.
- `model=person` for player/person photos. This uses the local
  `isnet-general-use` model, selected for stronger cutouts while keeping
  production memory use and response time safe.

## Local Development

```bash
cd apps/media-ai-service
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 5055
```

For local development, rembg can download models into its cache. Production
requires an offline, checksum-verified cache containing `u2net.onnx`,
`isnet-general-use.onnx`, and `manifest.sha256`; the service remains unready and
refuses jobs when any file is missing or corrupt. Populate the production named
volume with `bash scripts/warm-media-ai-model-cache.sh` from the repository root,
supplying reviewed HTTPS model URLs and their SHA-256 values. Both models are
loaded before readiness succeeds.

## Behavior

- Rejects missing/empty files or files over 8MB (HTTP 413).
- Validates image types: PNG, JPG, JPEG, WEBP.
- Limits decoded pixel count, concurrent inference, and the number and wait time
  of queued requests. Configure these with `MEDIA_AI_MAX_IMAGE_PIXELS`,
  `MEDIA_AI_MAX_CONCURRENT_JOBS`, `MEDIA_AI_MAX_QUEUED_JOBS`,
  `MEDIA_AI_ADMISSION_TIMEOUT_SECONDS`, `MEDIA_AI_QUEUE_TIMEOUT_SECONDS`, and
  `MEDIA_AI_JOB_TIMEOUT_SECONDS`.
- Uses `rembg.remove()` then Pillow to guarantee an RGBA PNG response.
