# Media AI Service (background removal)

Small FastAPI service used by the Arenzyra API and Studio to remove backgrounds from sponsor logos, player photos, and uploaded Studio images.

## Endpoints

- `GET /health` -> `{ ok: true }`
- `POST /remove-bg` -> accepts `multipart/form-data` with a single `file` (PNG/JPG/JPEG/WEBP, max 8MB). Returns PNG bytes with transparent background.

Optional form field:

- `model=general` for logos and objects.
- `model=person` for player/person photos.

## Local Development

```bash
cd apps/media-ai-service
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 5055
```

The service is stateless; rembg downloads each model on first use and caches it locally.

## Behavior

- Rejects missing/empty files or files over 8MB (HTTP 413).
- Validates image types: PNG, JPG, JPEG, WEBP.
- Uses `rembg.remove()` then Pillow to guarantee an RGBA PNG response.
