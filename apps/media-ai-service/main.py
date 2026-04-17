from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from io import BytesIO
from PIL import Image, UnidentifiedImageError
from rembg import remove

app = FastAPI(title="Arenzyra Media AI Service", version="0.1.0")

ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
}

MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB


@app.get("/health")
async def health():
    return {"ok": True}


def _to_rgba_png(image_bytes: bytes) -> bytes:
    """Convert raw image bytes to PNG with RGBA channel."""
    with Image.open(BytesIO(image_bytes)) as img:
        rgba = img.convert("RGBA")
        buf = BytesIO()
        rgba.save(buf, format="PNG")
        return buf.getvalue()


@app.post("/remove-bg", response_class=Response, responses={200: {"content": {"image/png": {}}}})
async def remove_bg(file: UploadFile = File(...)):
    if not file:
        raise HTTPException(status_code=400, detail="File is required")

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only PNG, JPG, JPEG, or WEBP images are allowed.",
        )

    data = await file.read()
    await file.close()

    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="File too large. Max size is 5MB.",
        )

    try:
        cutout_bytes = await run_in_threadpool(remove, data)
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail="Background removal failed."
        ) from exc

    try:
        output_bytes = await run_in_threadpool(_to_rgba_png, cutout_bytes)
    except UnidentifiedImageError:
        raise HTTPException(
            status_code=422,
            detail="Processed image is not a valid image.",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Unexpected error while preparing output.",
        ) from exc

    return Response(content=output_bytes, media_type="image/png")
