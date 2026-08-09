import asyncio
import hashlib
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError

import main


def png_bytes(width: int = 4, height: int = 4) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), "red").save(output, format="PNG")
    return output.getvalue()


class MediaValidationTests(unittest.TestCase):
    def test_accepts_a_real_supported_image(self):
        main._validate_input_image(png_bytes())

    def test_rejects_mime_spoofed_non_image_bytes(self):
        with self.assertRaises(UnidentifiedImageError):
            main._validate_input_image(b"not-an-image")

    def test_rejects_images_over_the_pixel_budget(self):
        with self.assertRaises(Image.DecompressionBombError):
            main._validate_input_image(png_bytes(5, 5), max_pixels=24)

    def test_bounded_inference_releases_its_slot(self):
        async def run():
            with patch.object(main, "_process_image", return_value=b"png"):
                result = await main._run_bounded_inference(b"input", "model")
                self.assertEqual(result, b"png")
                await asyncio.sleep(0)
                self.assertEqual(main.inference_slots._value, main.MAX_CONCURRENT_JOBS)
                self.assertEqual(
                    main.admission_slots._value,
                    main.MAX_CONCURRENT_JOBS + main.MAX_QUEUED_JOBS,
                )

        asyncio.run(run())

    def test_health_is_unready_until_model_warmup_finishes(self):
        async def run():
            with patch.object(main, "model_ready", False):
                response = await main.health()
                self.assertIsInstance(response, JSONResponse)
                self.assertEqual(response.status_code, 503)

            with patch.object(main, "model_ready", True):
                response = await main.health_ready()
                self.assertIsInstance(response, dict)
                self.assertTrue(response["modelReady"])

        asyncio.run(run())

    def test_saturated_admission_is_rejected_without_starting_work(self):
        async def run():
            saturated = asyncio.Semaphore(0)
            with (
                patch.object(main, "admission_slots", saturated),
                patch.object(main, "ADMISSION_TIMEOUT_SECONDS", 0.001),
                patch.object(main, "_process_image") as process_image,
            ):
                with self.assertRaises(HTTPException) as raised:
                    await main._run_bounded_inference(b"input", "model")
                self.assertEqual(raised.exception.status_code, 429)
                process_image.assert_not_called()

        asyncio.run(run())

    def test_queue_wait_is_bounded_and_releases_admission(self):
        async def run():
            admission = asyncio.Semaphore(1)
            busy = asyncio.Semaphore(0)
            with (
                patch.object(main, "admission_slots", admission),
                patch.object(main, "inference_slots", busy),
                patch.object(main, "QUEUE_TIMEOUT_SECONDS", 0.001),
            ):
                with self.assertRaises(HTTPException) as raised:
                    await main._run_bounded_inference(b"input", "model")
                self.assertEqual(raised.exception.status_code, 503)
                self.assertEqual(admission._value, 1)

        asyncio.run(run())

    def test_preloaded_model_cache_requires_every_model(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            model_home = Path(temporary_dir)
            manifest = model_home / "manifest.sha256"
            manifest.write_text("", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "u2net"):
                main._verify_model_cache(model_home, manifest)

    def test_preloaded_model_cache_rejects_corruption(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            model_home = Path(temporary_dir)
            entries = []
            for file_name in main.REQUIRED_MODEL_FILES.values():
                content = f"model:{file_name}".encode()
                (model_home / file_name).write_bytes(content)
                entries.append(f"{hashlib.sha256(content).hexdigest()}  {file_name}")
            manifest = model_home / "manifest.sha256"
            manifest.write_text("\n".join(entries) + "\n", encoding="utf-8")
            main._verify_model_cache(model_home, manifest)

            (model_home / "u2net.onnx").write_bytes(b"corrupt")
            with self.assertRaisesRegex(RuntimeError, "checksum failed"):
                main._verify_model_cache(model_home, manifest)


if __name__ == "__main__":
    unittest.main()
