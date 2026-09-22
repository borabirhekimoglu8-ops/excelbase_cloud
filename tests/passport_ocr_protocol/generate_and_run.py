"""Synthetic image protocol for the optional PP-OCRv6 installation.

Run explicitly with:
    python3 -m pytest -m engine tests/passport_ocr_protocol/generate_and_run.py

The test never substitutes a fake engine. If PaddleOCR cannot be imported or
initialized, it records NOT RUN and skips.
"""

from __future__ import annotations

import hashlib
import io
import importlib.metadata
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from PIL import Image, ImageDraw, ImageFont

from backend.config import PassportOcrSettings
from backend.passportocr.engine import EngineUnavailable
from backend.passportocr.paddle_engine import create_paddle_engine
from backend.passportocr.service import recognize_image, reset_engine_for_tests, set_engine_for_tests


pytestmark = pytest.mark.engine

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "frontend/src/lib/passport/__fixtures__/engine-runs"
SOURCE_DIR = OUTPUT_DIR / "sources"
STATUS_FILE = OUTPUT_DIR / "README.md"
RESULT_FILE = OUTPUT_DIR / "ppocrv6-synthetic.json"

UTO_LINE1 = "P<UTOYILMAZ<<ADA<<<<<<<<<<<<<<<<<<<<<<<<<<<<"
UTO_LINE2 = "U1000001<6UTO9001011F301231610000000146<<<44"
TUR_LINE1 = "P<TURYILMAZ<<ADA<<<<<<<<<<<<<<<<<<<<<<<<<<<<"
TUR_LINE2 = "U1000001<6TUR9001011F301231610000000146<<<44"


@dataclass(frozen=True)
class Variant:
    name: str
    source_filename: str
    source_kind: str
    source_bytes: bytes
    processed_image: bytes
    nationality: str
    raster: dict[str, int] | None = None


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


def _passport(
    nationality: str,
    *,
    line1: str = "",
    line2: str = "",
    native: bool = False,
) -> Image.Image:
    width, height = (2600, 1625) if native else (1600, 1000)
    if not line1:
        height = 760
    scale = width / 1600
    image = Image.new("RGB", (width, height), "#f5f1df")
    draw = ImageDraw.Draw(image)
    draw.text(
        (round(90 * scale), round(70 * scale)),
        "PASSPORT / PASAPORT",
        fill="#152a38",
        font=_font(round(52 * scale)),
    )
    fields = [
        ("Surname / Soyadı", "YILMAZ"),
        ("Given names / Adları", "ADA"),
        ("Passport No", "U1000001"),
        ("Nationality", nationality),
        ("Date of birth", "01.01.1990"),
        ("Date of expiry", "31.12.2030"),
    ]
    for index, (label, value) in enumerate(fields):
        y = round((170 + index * 82) * scale)
        draw.text((round(100 * scale), y), label, fill="#405462", font=_font(round(27 * scale)))
        draw.text((round(520 * scale), y), value, fill="#101820", font=_font(round(34 * scale)))
    if line1 and line2:
        draw.rectangle(
            (
                round(70 * scale),
                round(790 * scale),
                round(1530 * scale),
                round(950 * scale),
            ),
            outline="#273d49",
            width=max(3, round(3 * scale)),
        )
        mrz_size = max(48 if native else 28, round(28 * scale))
        draw.text(
            (round(95 * scale), round(810 * scale)),
            line1,
            fill="#101820",
            font=_font(mrz_size, mono=True),
        )
        draw.text(
            (round(95 * scale), round(870 * scale)),
            line2,
            fill="#101820",
            font=_font(mrz_size, mono=True),
        )
    return image


def _bytes(image: Image.Image, kind: str, quality: int = 90) -> bytes:
    buffer = io.BytesIO()
    if kind == "PNG":
        image.save(buffer, format=kind)
    else:
        image.save(buffer, format=kind, quality=quality)
    return buffer.getvalue()


def _variants() -> list[Variant]:
    tur_clean = _passport("TUR", line1=TUR_LINE1, line2=TUR_LINE2, native=True)
    uto = _passport("UTO", line1=UTO_LINE1, line2=UTO_LINE2)
    plus = uto.rotate(3, expand=True, fillcolor="white")
    minus = uto.rotate(-3, expand=True, fillcolor="white")

    # Native 2600x1625 source, embedded as an image-only 250 dpi PDF page.
    pdf_raster = tur_clean
    pdf_buffer = io.BytesIO()
    pdf_raster.save(pdf_buffer, format="PDF", resolution=250)
    pdf_bytes = pdf_buffer.getvalue()
    assert pdf_bytes.startswith(b"%PDF")
    assert b"/Font" not in pdf_bytes

    def image_variant(
        name: str,
        filename: str,
        source_kind: str,
        image: Image.Image,
        image_format: str,
        nationality: str,
        quality: int = 90,
    ) -> Variant:
        source = _bytes(image, image_format, quality)
        return Variant(name, filename, source_kind, source, source, nationality)

    return [
        image_variant("tur_clean_png", "tur-clean.png", "png", tur_clean, "PNG", "TUR"),
        Variant(
            "tur_image_pdf_raster_250dpi_2600_jpeg90",
            "tur-image-pdf-250dpi.pdf",
            "image_pdf",
            pdf_bytes,
            _bytes(pdf_raster, "JPEG", 90),
            "TUR",
            {
                "dpi": 250,
                "long_edge_max": 2600,
                "jpeg_quality": 90,
                "processed_width": 2600,
                "processed_height": 1625,
            },
        ),
        image_variant("uto_jpeg_q35", "uto-jpeg-q35.jpg", "jpeg", uto, "JPEG", "UTO", 35),
        image_variant("uto_skew_plus_3_png", "uto-skew-plus-3.png", "png", plus, "PNG", "UTO"),
        image_variant("uto_skew_minus_3_png", "uto-skew-minus-3.png", "png", minus, "PNG", "UTO"),
        image_variant(
            "viz_only_xxa_crop_png",
            "viz-only-xxa-crop.png",
            "png",
            _passport("XXA"),
            "PNG",
            "XXA",
        ),
    ]


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _package_version(distribution: str) -> str | None:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return None


def _compact_mrz(text: str) -> str:
    return re.sub(r"[^A-Z0-9<]", "", text.upper().replace("«", "<").replace("‹", "<"))


def _repair_td3_length(value: str) -> list[str]:
    if len(value) == 44:
        return [value]
    if len(value) == 43:
        return [f"{value}<", f"<{value}"]
    if len(value) == 45:
        return [value[:44], value[1:]]
    return []


def _check_digit(value: str) -> str:
    weights = (7, 3, 1)
    total = 0
    for index, character in enumerate(value):
        if character.isdigit():
            numeric = int(character)
        elif "A" <= character <= "Z":
            numeric = ord(character) - 55
        elif character == "<":
            numeric = 0
        else:
            return ""
        total += numeric * weights[index % len(weights)]
    return str(total % 10)


def _mrz_date(raw: str) -> str:
    if not re.fullmatch(r"\d{6}", raw):
        return ""
    year = 1900 + int(raw[:2]) if int(raw[:2]) >= 50 else 2000 + int(raw[:2])
    try:
        return datetime(year, int(raw[2:4]), int(raw[4:6]), tzinfo=UTC).date().isoformat()
    except ValueError:
        return ""


def _parse_td3(line1: str, line2: str) -> dict[str, Any] | None:
    if not re.fullmatch(r"[A-Z<]{44}", line1) or not re.fullmatch(r"[A-Z0-9<]{44}", line2):
        return None
    if not line1.startswith("P<"):
        return None
    names = line1[5:].split("<<", 1)
    checks = {
        "passport_no": _check_digit(line2[:9]) == line2[9],
        "date_of_birth": _check_digit(line2[13:19]) == line2[19],
        "date_of_expiry": _check_digit(line2[21:27]) == line2[27],
        "personal_no": _check_digit(line2[28:42]) == line2[42],
        "composite": _check_digit(line2[:10] + line2[13:20] + line2[21:43]) == line2[43],
    }
    fields = {
        "surname": names[0].replace("<", " ").strip(),
        "given_names": (names[1] if len(names) > 1 else "").replace("<", " ").strip(),
        "passport_no": line2[:9].replace("<", ""),
        "nationality": line2[10:13].replace("<", ""),
        "date_of_birth": _mrz_date(line2[13:19]),
        "date_of_expiry": _mrz_date(line2[21:27]),
    }
    return {
        "pair_found": True,
        "verified": all(checks.values()),
        "status": "verified" if all(checks.values()) else "checksum_failed",
        "fields": fields,
        "checks": checks,
    }


def _find_mrz_pair(lines: list[dict[str, Any]]) -> dict[str, Any]:
    compact = [_compact_mrz(str(line.get("text", ""))) for line in lines]
    uppers = [line for line in compact if 40 <= len(line) <= 48 and line.startswith("P<")]
    lowers = [
        line
        for line in compact
        if 40 <= len(line) <= 48
        and bool(re.fullmatch(r"[A-Z0-9<]+", line))
        and any(character.isdigit() for character in line)
        and not line.startswith(("P<", "PA", "PO"))
    ]
    fallback: dict[str, Any] | None = None
    saw_line1_charset = False
    for upper in uppers:
        for lower in lowers:
            for repaired_upper in _repair_td3_length(upper):
                for repaired_lower in _repair_td3_length(lower):
                    if not re.fullmatch(r"[A-Z<]{44}", repaired_upper):
                        saw_line1_charset = True
                        continue
                    parsed = _parse_td3(repaired_upper, repaired_lower)
                    if parsed is None:
                        continue
                    fallback = {
                        **parsed,
                        "reject_reason": None if parsed["verified"] else "checksum",
                    }
                    if parsed["verified"]:
                        return fallback
    if fallback:
        return fallback
    return {
        "pair_found": False,
        "verified": False,
        "status": "not_found",
        "reject_reason": "line1_charset" if saw_line1_charset else "not_found",
        "fields": {},
        "checks": {},
    }


def _expected_fields(nationality: str) -> dict[str, str]:
    return {
        "surname": "YILMAZ",
        "given_names": "ADA",
        "passport_no": "U1000001",
        "nationality": nationality,
        "date_of_birth": "1990-01-01",
        "date_of_birth_mrz": "900101",
        "date_of_expiry": "2030-12-31",
        "date_of_expiry_mrz": "301231",
    }


def _critical_field_scores(
    lines: list[dict[str, Any]],
    parser_result: dict[str, Any],
    expected: dict[str, str],
) -> dict[str, str]:
    raw = "".join(_compact_mrz(str(line.get("text", ""))) for line in lines)
    parsed_fields = parser_result.get("fields", {})
    scores: dict[str, str] = {}
    tokens = {
        "passport_no": (expected["passport_no"],),
        "surname": (expected["surname"],),
        "given_names": (expected["given_names"],),
        "nationality": (expected["nationality"],),
        "date_of_birth": (
            expected["date_of_birth"].replace("-", ""),
            expected["date_of_birth_mrz"],
            "01011990",
        ),
        "date_of_expiry": (
            expected["date_of_expiry"].replace("-", ""),
            expected["date_of_expiry_mrz"],
            "31122030",
        ),
    }
    for field, accepted in tokens.items():
        observed = re.sub(r"[^A-Z0-9]", "", str(parsed_fields.get(field, "")).upper())
        found = any(token.replace("-", "") in raw or token.replace("-", "") == observed for token in accepted)
        scores[field] = "correct" if found else ("wrong" if lines or observed else "empty")
    return scores


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
    package_versions = {
        "paddleocr": _package_version("paddleocr"),
        "paddlepaddle": _package_version("paddlepaddle"),
    }
    reset_engine_for_tests()
    set_engine_for_tests(engine)
    results = []
    try:
        SOURCE_DIR.mkdir(parents=True, exist_ok=True)
        for variant in _variants():
            source_path = SOURCE_DIR / variant.source_filename
            source_path.write_bytes(variant.source_bytes)
            payload = recognize_image(variant.processed_image, variant.name, settings)
            expected = _expected_fields(variant.nationality)
            parser_result = _find_mrz_pair(payload["lines"])
            results.append(
                {
                    "variant": variant.name,
                    "source_path": source_path.relative_to(ROOT).as_posix(),
                    "source_sha256": _sha256(variant.source_bytes),
                    "source_kind": variant.source_kind,
                    "processed_image_sha256": _sha256(variant.processed_image),
                    "raster": variant.raster,
                    "engine": {
                        "name": payload["engine"]["name"],
                        "version": payload["engine"]["version"],
                        "versions": list(settings.versions),
                        "lang": payload["engine"]["lang"],
                        "package_versions": package_versions,
                    },
                    "width": payload["width"],
                    "height": payload["height"],
                    "lines": payload["lines"],
                    "parser_result": parser_result,
                    "expected_fields": expected,
                    "critical_fields": _critical_field_scores(
                        payload["lines"],
                        parser_result,
                        expected,
                    ),
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
        "`ppocrv6-synthetic.json`; all persisted source images and the image-only "
        "PDF under `sources/` are synthetic.\n",
        encoding="utf-8",
    )
    assert len(results) == 6
    tur_results = [item for item in results if item["expected_fields"]["nationality"] == "TUR"]
    assert len(tur_results) == 2
    assert all(item["parser_result"]["pair_found"] for item in tur_results)
    assert all(item["parser_result"]["verified"] for item in tur_results)
