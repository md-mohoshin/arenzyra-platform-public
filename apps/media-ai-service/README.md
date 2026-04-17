# Media AI Service (background removal)

Small FastAPI service used by the Arenzyra API to remove backgrounds from sponsor logo uploads.

## Endpoints
- `GET /health` â†’ `{ ok: true }`
- `POST /remove-bg` â†’ accepts `multipart/form-data` with a single `file` (PNG/JPG/JPEG/WEBP, max 5MB). Returns PNG bytes with transparent background.

## Local development
```bash
cd apps/media-ai-service
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 5055
```

The service is stateless; rembg downloads its model on first run and caches it locally.

## Behavior
- Rejects missing/empty files or files over 5MB (HTTP 413).
- Validates image types: PNG, JPG, JPEG, WEBP.
- Uses `rembg.remove()` then Pillow to guarantee an RGBA PNG response.
