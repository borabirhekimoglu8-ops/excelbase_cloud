"""In-memory OCR runner. Images are never written to disk."""

from __future__ import annotations

import io
import logging
import threading
import time
from typing import Any

from PIL import Image, ImageOps

from backend.config import PassportOcrSettings, passport_ocr_settings
from .engine import EngineUnavailable, NullEngine, OcrEngine, OcrLine
from .paddle_engine import create_paddle_engine

logger = logging.getLogger("excelbase.passportocr")

JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
HEIF_BRANDS = {b"heic", b"heix", b"heif", b"mif1", b"msf1", b"avif"}

_engine_lock = threading.Lock()
_engine: OcrEngine | None = None
_engine_state = "engine_missing"
_engine_detail = "Motor henüz yüklenmedi."
_engine_version = ""
_engine_name = ""
_load_thread: threading.Thread | None = None
_semaphore: threading.BoundedSemaphore | None = None


def _limits(settings: PassportOcrSettings | None = None) -> dict[str, int]:
    resolved = settings or passport_ocr_settings()
    return {
        "max_image_bytes": resolved.max_image_bytes,
        "max_pixels": resolved.max_pixels,
        "max_concurrency": resolved.max_concurrency,
    }


def _register_heif() -> None:
    try:
        from pillow_heif import register_heif_opener
    except ImportError:
        return
    register_heif_opener()


def sniff_image(data: bytes) -> str:
    if data.startswith(JPEG_MAGIC):
        return "jpeg"
    if data.startswith(PNG_MAGIC):
        return "png"
    if len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12].lower() in HEIF_BRANDS:
        return "heif"
    return ""


def _semaphore_for(settings: PassportOcrSettings) -> threading.BoundedSemaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = threading.BoundedSemaphore(settings.max_concurrency)
    return _semaphore


def _load_engine(settings: PassportOcrSettings) -> None:
    global _engine, _engine_state, _engine_detail, _engine_version, _engine_name
    try:
        engine = create_paddle_engine(settings.versions)
    except EngineUnavailable as exc:
        with _engine_lock:
            _engine = NullEngine()
            _engine_state = exc.state
            _engine_detail = exc.detail
            _engine_version = ""
            _engine_name = ""
        logger.warning("passport-ocr engine unavailable state=%s", exc.state)
        return
    except Exception:
        with _engine_lock:
            _engine = NullEngine()
            _engine_state = "engine_error"
            _engine_detail = "OCR motoru başlatılamadı."
            _engine_version = ""
            _engine_name = ""
        logger.warning("passport-ocr engine init failed", exc_info=False)
        return
    with _engine_lock:
        _engine = engine
        _engine_state = "ready"
        _engine_detail = "Görüntüler bu bilgisayarda işlenir, diske yazılmaz."
        _engine_version = engine.version
        _engine_name = engine.name


def reset_engine_for_tests() -> None:
    global _engine, _engine_state, _engine_detail, _engine_version, _engine_name, _load_thread, _semaphore
    with _engine_lock:
        _engine = None
        _engine_state = "engine_missing"
        _engine_detail = "Motor henüz yüklenmedi."
        _engine_version = ""
        _engine_name = ""
        _load_thread = None
        _semaphore = None


def set_engine_for_tests(engine: OcrEngine, state: str = "ready", detail: str = "") -> None:
    global _engine, _engine_state, _engine_detail, _engine_version, _engine_name
    with _engine_lock:
        _engine = engine
        _engine_state = state
        _engine_detail = detail or "test"
        _engine_version = engine.version
        _engine_name = engine.name


def warmup(settings: PassportOcrSettings | None = None) -> dict[str, Any]:
    resolved = settings or passport_ocr_settings()
    global _load_thread
    with _engine_lock:
        if _engine_state == "ready" and _engine is not None:
            return ocr_state(resolved)
        if _load_thread and _load_thread.is_alive():
            _engine_state_local = "engine_loading"
        else:
            _engine_state_local = "engine_loading"
            thread = threading.Thread(
                target=_load_engine,
                args=(resolved,),
                name="passport-ocr-warmup",
                daemon=True,
            )
            _load_thread = thread
            _engine_state = "engine_loading"
            _engine_detail = "Model yükleniyor."
            thread.start()
    return {**ocr_state(resolved), "state": _engine_state_local}


def ocr_state(settings: PassportOcrSettings | None = None) -> dict[str, Any]:
    resolved = settings or passport_ocr_settings()
    with _engine_lock:
        state = _engine_state
        detail = _engine_detail
        engine = {"name": _engine_name, "version": _engine_version, "lang": resolved.lang}
    if not resolved.enabled:
        state, detail = "disabled", "Yerel pasaport OCR kapalı."
    elif not resolved.closed_deployment:
        state, detail = "blocked_open_network", "Pasaport OCR açık ağda kapalıdır."
    return {
        "state": state,
        "engine": engine,
        "detail": detail,
        "limits": _limits(resolved),
        "privacy": "in_memory_only",
        "egress": "none",
    }


def _decode_image(data: bytes, settings: PassportOcrSettings):
    kind = sniff_image(data)
    if not kind:
        raise ValueError("unsupported")
    if kind == "heif":
        _register_heif()
    previous = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = settings.max_pixels
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Image.DecompressionBombError as exc:
        raise ValueError("too_many_pixels") from exc
    except Exception as exc:
        raise ValueError("undecodable") from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous
    image = ImageOps.exif_transpose(image) or image
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width * height > settings.max_pixels:
        raise ValueError("too_many_pixels")
    return rgb, width, height


def recognize_image(data: bytes, page_id: str = "", settings: PassportOcrSettings | None = None) -> dict[str, Any]:
    resolved = settings or passport_ocr_settings()
    if len(data) > resolved.max_image_bytes:
        raise ValueError("too_large")
    rgb, width, height = _decode_image(data, resolved)
    with _engine_lock:
        engine = _engine
        state = _engine_state
        detail = _engine_detail
        engine_name = _engine_name
        engine_version = _engine_version
    if engine is None or state != "ready":
        raise EngineUnavailable(state if state != "engine_missing" else "engine_missing", detail)
    gate = _semaphore_for(resolved)
    if not gate.acquire(blocking=False):
        raise TimeoutError("busy")
    started = time.monotonic()
    try:
        try:
            import numpy as np
        except ImportError as exc:
            raise EngineUnavailable("engine_error", "numpy kurulu değil.") from exc
        array = np.asarray(rgb)
        lines: list[OcrLine] = engine.recognize(array)
    finally:
        gate.release()
        rgb.close()
    duration_ms = int((time.monotonic() - started) * 1000)
    return {
        "page_id": page_id,
        "engine": {"name": engine_name or engine.name, "version": engine_version or engine.version, "lang": resolved.lang},
        "width": width,
        "height": height,
        "lines": [{"text": line.text, "box": line.box, "score": line.score} for line in lines],
        "duration_ms": duration_ms,
    }
