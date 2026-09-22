"""Synthetic image protocol for the optional PP-OCRv6 installation.

Run explicitly with:
    python3 -m pytest -m engine tests/passport_ocr_protocol/generate_and_run.py

The test never substitutes a fake engine. If PaddleOCR cannot be imported or
initialized, it records NOT RUN and skips.
"""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from backend.config import PassportOcrSettings
from backend.passportocr.engine import EngineUnavailable
from backend.passportocr.paddle_engine import create_paddle_engine
from backend.passportocr.service import recognize_image, reset_engine_for_tests, set_engine_for_tests


pytestmark = pytest.mark.engine

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "frontend/src/lib/passport/__fixtures__/engine-runs"
STATUS_FILE = OUTPUT_DIR / "README.md"
RESULT_FILE = OUTPUT_DIR / "ppocrv6-synthetic.json"

LINE1 = "P<UTOYILMAZ<<ADA<<<<<<<<<<<<<<<<<<<<<<<<<<<<"
LINE2 = "U1000001<6UTO9001011F301231610000000146<<<44"


def _font(size: int, mono: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = (
        ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
        if mono
        else ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    )
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _passport(viz_only: bool = False) -> Image.Image:
    image = Image.new("RGB", (1600, 1000 if not viz_only else 520), "#f5f1df")
    draw = ImageDraw.Draw(image)
    draw.text((90, 70), "PASSPORT / PASAPORT", fill="#152a38", font=_font(52))
    fields = [
        ("Surname / Soyadı", "YILMAZ"),
        ("Given names / Adları", "ADA"),
        ("Passport No", "U1000001"),
        ("Nationality", "XXA" if viz_only else "UTO"),
        ("Date of birth", "01.01.1990"),
        ("Date of expiry", "31.12.2030"),
    ]
    for index, (label, value) in enumerate(fields):
        y = 170 + index * 82
        draw.text((100, y), label, fill="#405462", font=_font(27))
        draw.text((520, y), value, fill="#101820", font=_font(34))
    if not viz_only:
        draw.rectangle((70, 790, 1530, 950), outline="#273d49", width=3)
        draw.text((95, 810), LINE1, fill="#101820", font=_font(28, mono=True))
        draw.text((95, 870), LINE2, fill="#101820", font=_font(28, mono=True))
    return image


def _bytes(image: Image.Image, kind: str, quality: int = 90) -> bytes:
    buffer = io.BytesIO()
    if kind == "PNG":
        image.save(buffer, format=kind)
    else:
        image.save(buffer, format=kind, quality=quality)
    return buffer.getvalue()


def _variants() -> dict[str, bytes]:
    clean = _passport()
    plus = clean.rotate(3, expand=True, fillcolor="white")
    minus = clean.rotate(-3, expand=True, fillcolor="white")

    # Equivalent to the browser contract: 250 dpi, long edge <=2600, JPEG 0.9.
    pdf_source = clean.resize((2600, 1625), Image.Resampling.LANCZOS)
    pdf_buffer = io.BytesIO()
    pdf_source.save(pdf_buffer, format="PDF", resolution=250)
    assert pdf_buffer.getvalue().startswith(b"%PDF")

    return {
        "clean_png": _bytes(clean, "PNG"),
        "jpeg_q35": _bytes(clean, "JPEG", 35),
        "skew_plus_3_png": _bytes(plus, "PNG"),
        "skew_minus_3_png": _bytes(minus, "PNG"),
        "image_pdf_raster_250dpi_2600_jpeg90": _bytes(pdf_source, "JPEG", 90),
        "viz_only_xxa_crop_png": _bytes(_passport(viz_only=True), "PNG"),
    }


def _settings() -> PassportOcrSettings:
    return PassportOcrSettings(
        enabled=True,
        closed_deployment=True,
        versions=("PP-OCRv6",),
        lang="en",
        max_image_bytes=20 * 1024 * 1024,
        max_pixels=25_000_000,
        max_concurrency=1,
    )


def _not_run(reason: str) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_FILE.unlink(missing_ok=True)
    STATUS_FILE.write_text(
        "# PP-OCRv6 synthetic image protocol\n\n"
        "**NOT RUN.** No image-engine evidence is committed.\n\n"
        f"Reason category: `{reason}`. Run the marked pytest protocol on an "
        "office-PC environment with the optional OCR requirements installed.\n",
        encoding="utf-8",
    )


def test_generate_and_run_ppocrv6_image_protocol() -> None:
    try:
        import paddleocr  # noqa: F401
    except ImportError:
        _not_run("paddleocr_not_installed")
        pytest.skip("paddleocr is not installed; protocol NOT RUN")

    try:
        engine = create_paddle_engine(("PP-OCRv6",))
    except EngineUnavailable:
        _not_run("engine_unavailable")
        pytest.skip("PP-OCRv6 could not initialize; protocol NOT RUN")
    except Exception:
        _not_run("engine_initialization_failed")
        pytest.skip("PP-OCRv6 could not initialize; protocol NOT RUN")

    settings = _settings()
    reset_engine_for_tests()
    set_engine_for_tests(engine)
    results = []
    try:
        for name, image in _variants().items():
            payload = recognize_image(image, name, settings)
            results.append(
                {
                    "variant": name,
                    "engine": payload["engine"],
                    "width": payload["width"],
                    "height": payload["height"],
                    "lines": payload["lines"],
                    "duration_ms": payload["duration_ms"],
                }
            )
    finally:
        reset_engine_for_tests()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_FILE.write_text(
        json.dumps(
            {
                "evidence": "actual_ppocrv6_synthetic_image_run",
                "generated_at": datetime.now(UTC).isoformat(),
                "synthetic_only": True,
                "variants": results,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    STATUS_FILE.write_text(
        "# PP-OCRv6 synthetic image protocol\n\n"
        "RUN with the optional PaddleOCR engine. Evidence is in "
        "`ppocrv6-synthetic.json`; all source images are synthetic.\n",
        encoding="utf-8",
    )
    assert len(results) == 6
