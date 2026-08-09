import asyncio
import hashlib
import os
import warnings
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from io import BytesIO
from PIL import Image, UnidentifiedImageError
from rembg import new_session, remove

app = FastAPI(title="Arenzyra Media AI Service", version="0.1.0")

ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
}

MAX_FILE_BYTES = 8 * 1024 * 1024  # 8 MB
MAX_REQUEST_BYTES = MAX_FILE_BYTES + 1024 * 1024
MAX_IMAGE_PIXELS = int(os.getenv("MEDIA_AI_MAX_IMAGE_PIXELS", "25000000"))
MAX_CONCURRENT_JOBS = int(os.getenv("MEDIA_AI_MAX_CONCURRENT_JOBS", "2"))
MAX_QUEUED_JOBS = int(os.getenv("MEDIA_AI_MAX_QUEUED_JOBS", "4"))
JOB_TIMEOUT_SECONDS = float(os.getenv("MEDIA_AI_JOB_TIMEOUT_SECONDS", "45"))
QUEUE_TIMEOUT_SECONDS = float(os.getenv("MEDIA_AI_QUEUE_TIMEOUT_SECONDS", "5"))
ADMISSION_TIMEOUT_SECONDS = float(
    os.getenv("MEDIA_AI_ADMISSION_TIMEOUT_SECONDS", "0.05")
)
if (
    MAX_IMAGE_PIXELS <= 0
    or MAX_CONCURRENT_JOBS <= 0
    or MAX_QUEUED_JOBS < 0
    or JOB_TIMEOUT_SECONDS <= 0
    or QUEUE_TIMEOUT_SECONDS <= 0
    or ADMISSION_TIMEOUT_SECONDS <= 0
):
    raise RuntimeError("Media AI resource limits must be positive")

inference_slots = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
admission_slots = asyncio.Semaphore(MAX_CONCURRENT_JOBS + MAX_QUEUED_JOBS)
model_ready = False
model_cache_verified = False
model_error = None

MODEL_HOME = Path(os.getenv("U2NET_HOME", "/models"))
MODEL_MANIFEST_PATH = Path(
    os.getenv("MEDIA_AI_MODEL_MANIFEST_PATH", str(MODEL_HOME / "manifest.sha256"))
)
REQUIRE_PRELOADED_MODELS = os.getenv(
    "MEDIA_AI_REQUIRE_PRELOADED_MODELS", "false"
).strip().lower() in {"1", "true", "yes", "on"}
REQUIRED_MODEL_FILES = {
    "u2net": "u2net.onnx",
    "isnet-general-use": "isnet-general-use.onnx",
}

MODEL_ALIASES = {
    "general": "u2net",
    "logo": "u2net",
    # Player images need a more detailed mask than the legacy U2Net human
    # segmenter provides. ISNet General is processed locally by rembg and keeps
    # the existing service's memory and response time within production limits.
    "person": "isnet-general-use",
    "human": "isnet-general-use",
    "player": "isnet-general-use",
}


@app.get("/health")
async def health():
    payload = {
        "ok": model_ready,
        "modelReady": model_ready,
        "modelCacheVerified": model_cache_verified,
        "modelError": model_error,
        "maxConcurrentJobs": MAX_CONCURRENT_JOBS,
        "maxQueuedJobs": MAX_QUEUED_JOBS,
    }
    if not model_ready:
        return JSONResponse(status_code=503, content=payload)
    return payload


@app.get("/health/live")
async def health_live():
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready():
    return await health()


@app.middleware("http")
async def reject_oversized_declared_requests(request, call_next):
    if request.url.path == "/remove-bg":
        raw_length = request.headers.get("content-length")
        if raw_length:
            try:
                if int(raw_length) > MAX_REQUEST_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Request body is too large."},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Invalid Content-Length header."},
                )
    return await call_next(request)


@app.on_event("startup")
async def warm_player_model():
    """Load the player model before the service reports healthy.

    This makes the one-time model download/load part of deployment rather than
    leaving the first organizer upload waiting for it.
    """
    global model_ready, model_cache_verified, model_error
    model_ready = False
    model_cache_verified = False
    model_error = None
    try:
        if REQUIRE_PRELOADED_MODELS:
            await run_in_threadpool(
                _verify_model_cache, MODEL_HOME, MODEL_MANIFEST_PATH
            )
            model_cache_verified = True
        for model_name in sorted(set(MODEL_ALIASES.values())):
            await run_in_threadpool(_session, model_name)
        model_ready = True
    except Exception as exc:
        # Keep liveness available for diagnostics, but never accept jobs when
        # the verified cache or model warmup is unavailable.
        model_error = str(exc).replace("\n", " ")[:300]


def _sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_model_cache(
    model_home: Path = MODEL_HOME,
    manifest_path: Path = MODEL_MANIFEST_PATH,
) -> None:
    resolved_home = model_home.resolve()
    resolved_manifest = manifest_path.resolve()
    if not resolved_manifest.is_file():
        raise RuntimeError("Required media model checksum manifest is missing")
    if resolved_manifest.parent != resolved_home:
        raise RuntimeError("Media model checksum manifest must be inside U2NET_HOME")

    expected_hashes = {}
    for raw_line in resolved_manifest.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 2 or not all(c in "0123456789abcdefABCDEF" for c in parts[0]) or len(parts[0]) != 64:
            raise RuntimeError("Media model checksum manifest is malformed")
        file_name = parts[1].lstrip("*")
        if Path(file_name).name != file_name:
            raise RuntimeError("Media model checksum manifest contains an unsafe path")
        expected_hashes[file_name] = parts[0].lower()

    for model_name, file_name in REQUIRED_MODEL_FILES.items():
        expected_hash = expected_hashes.get(file_name)
        model_path = resolved_home / file_name
        if (
            not expected_hash
            or not model_path.is_file()
            or model_path.resolve().parent != resolved_home
        ):
            raise RuntimeError(f"Required media model is missing: {model_name}")
        if _sha256_file(model_path) != expected_hash:
            raise RuntimeError(f"Required media model checksum failed: {model_name}")


def _to_rgba_png(image_bytes: bytes) -> bytes:
    """Convert raw image bytes to PNG with RGBA channel."""
    with Image.open(BytesIO(image_bytes)) as img:
        rgba = img.convert("RGBA")
        buf = BytesIO()
        rgba.save(buf, format="PNG")
        return buf.getvalue()


def _resolve_model(model: str | None) -> str:
    key = (model or "general").strip().lower()
    if key not in MODEL_ALIASES:
        raise HTTPException(
            status_code=400,
            detail="model must be one of: general, logo, person, human, player.",
        )
    return MODEL_ALIASES[key]


@lru_cache(maxsize=4)
def _session(model_name: str):
    return new_session(model_name)


def _remove_background(image_bytes: bytes, model_name: str) -> bytes:
    return remove(image_bytes, session=_session(model_name))


def _validate_input_image(image_bytes: bytes, max_pixels: int = MAX_IMAGE_PIXELS) -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(BytesIO(image_bytes)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"}:
                raise UnidentifiedImageError("Unsupported image format")
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > max_pixels:
                raise Image.DecompressionBombError(
                    f"Image dimensions exceed {max_pixels} pixels"
                )
            image.verify()


def _process_image(image_bytes: bytes, model_name: str) -> bytes:
    _validate_input_image(image_bytes)
    return _to_rgba_png(_remove_background(image_bytes, model_name))


async def _run_bounded_inference(image_bytes: bytes, model_name: str) -> bytes:
    try:
        await asyncio.wait_for(
            admission_slots.acquire(), timeout=ADMISSION_TIMEOUT_SECONDS
        )
    except TimeoutError as exc:
        raise HTTPException(
            status_code=429,
            detail="Background removal capacity is full. Try again shortly.",
            headers={"Retry-After": "1"},
        ) from exc

    try:
        await asyncio.wait_for(
            inference_slots.acquire(), timeout=QUEUE_TIMEOUT_SECONDS
        )
    except TimeoutError as exc:
        admission_slots.release()
        raise HTTPException(
            status_code=503,
            detail="Background removal queue wait exceeded its limit.",
            headers={"Retry-After": "1"},
        ) from exc

    task = asyncio.create_task(
        run_in_threadpool(_process_image, image_bytes, model_name)
    )

    def release_slot(completed_task: asyncio.Task) -> None:
        inference_slots.release()
        admission_slots.release()
        # Retrieve failures after a caller timeout so asyncio does not report an
        # unhandled task exception. A normal awaiting caller still receives it.
        if not completed_task.cancelled():
            completed_task.exception()

    task.add_done_callback(release_slot)
    try:
        return await asyncio.wait_for(
            asyncio.shield(task), timeout=JOB_TIMEOUT_SECONDS
        )
    except TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail="Background removal exceeded the processing time limit.",
        ) from exc


@app.post("/remove-bg", response_class=Response, responses={200: {"content": {"image/png": {}}}})
async def remove_bg(
    file: UploadFile = File(...),
    model: str = Form("general"),
):
    if not model_ready:
        raise HTTPException(
            status_code=503,
            detail="Media AI models are not ready.",
            headers={"Retry-After": "5"},
        )
    if not file:
        raise HTTPException(status_code=400, detail="File is required")

    model_name = _resolve_model(model)

    try:
        content_type = (file.content_type or "").lower()
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=400,
                detail="Only PNG, JPG, JPEG, or WEBP images are allowed.",
            )
        # Read at most one byte beyond the accepted limit; never materialize an
        # arbitrarily large upload in process memory.
        data = await file.read(MAX_FILE_BYTES + 1)
    finally:
        await file.close()

    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="File too large. Max size is 8MB.",
        )

    try:
        output_bytes = await _run_bounded_inference(data, model_name)
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError) as exc:
        raise HTTPException(
            status_code=422,
            detail="Uploaded file is not a safe supported image.",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail="Background removal failed."
        ) from exc

    return Response(content=output_bytes, media_type="image/png")
