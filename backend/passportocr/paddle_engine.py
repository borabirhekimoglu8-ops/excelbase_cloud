"""PaddleOCR / PP-OCRv6 adapter. Official API only; no invented method names."""

from __future__ import annotations

from typing import Any

from .engine import EngineUnavailable, OcrLine


def import_paddleocr():
    """Isolated so tests can force ImportError without touching sys.modules."""
    from paddleocr import PaddleOCR  # type: ignore

    return PaddleOCR


def _as_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return number


def _as_box(value: Any) -> list[list[float]]:
    if value is None:
        return []
    try:
        points = list(value)
    except TypeError:
        return []
    box: list[list[float]] = []
    for point in points:
        try:
            box.append([float(point[0]), float(point[1])])
        except (TypeError, ValueError, IndexError):
            return []
    return box


def _mapping(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return result
    nested = getattr(result, "res", None)
    if isinstance(nested, dict):
        return nested
    json_fn = getattr(result, "json", None)
    if callable(json_fn):
        try:
            payload = json_fn()
        except TypeError:
            payload = None
        if isinstance(payload, dict):
            return payload.get("res", payload) if isinstance(payload.get("res"), dict) else payload
    output: dict[str, Any] = {}
    for key in ("rec_texts", "rec_scores", "rec_polys", "dt_polys", "rec_boxes"):
        if hasattr(result, key):
            output[key] = getattr(result, key)
    return output


def lines_from_predict_result(raw: Any) -> list[OcrLine]:
    """Normalize official PaddleOCR 3.x predict() output and the older list form."""
    pages = raw if isinstance(raw, list) else [raw]
    lines: list[OcrLine] = []
    for page in pages:
        if page is None:
            continue
        mapping = _mapping(page)
        texts = mapping.get("rec_texts")
        scores = mapping.get("rec_scores") or []
        boxes = mapping.get("rec_polys") or mapping.get("dt_polys") or mapping.get("rec_boxes") or []
        if isinstance(texts, list) and texts:
            for index, text in enumerate(texts):
                if text is None:
                    continue
                score = _as_float(scores[index]) if index < len(scores) else None
                box = _as_box(boxes[index]) if index < len(boxes) else []
                lines.append(OcrLine(text=str(text), box=box, score=score))
            continue
        # Legacy 2.x shape: [[box, (text, score)], ...]
        if isinstance(page, list):
            for item in page:
                if not isinstance(item, (list, tuple)) or len(item) < 2:
                    continue
                body = item[1]
                text = body[0] if isinstance(body, (list, tuple)) else body
                score = _as_float(body[1]) if isinstance(body, (list, tuple)) and len(body) > 1 else None
                lines.append(OcrLine(text=str(text), box=_as_box(item[0]), score=score))
    return lines


class PaddleOcrEngine:
    """Official `PaddleOCR.predict` wrapper. CPU path, no visualization files."""

    name = "paddleocr"

    def __init__(self, pipeline: Any, version: str):
        self._pipeline = pipeline
        self.version = version

    def recognize(self, rgb) -> list[OcrLine]:
        result = self._pipeline.predict(rgb)
        return lines_from_predict_result(result)


def _construct(PaddleOCR: Any, version: str) -> Any:
    # Official 3.7 constructor (https://www.paddleocr.ai/latest/en/quick_start.html).
    # Orientation/rotation is allowed; document unwarping is not (can invent pixels).
    common = {
        "use_doc_orientation_classify": True,
        "use_doc_unwarping": False,
        "use_textline_orientation": True,
        "engine": "paddle",
    }
    if version and version != "PP-OCRv6":
        try:
            return PaddleOCR(ocr_version=version, **common)
        except TypeError:
            return PaddleOCR(
                text_detection_model_name=f"{version}_mobile_det",
                text_recognition_model_name=f"{version}_mobile_rec",
                **common,
            )
    return PaddleOCR(**common)


def create_paddle_engine(versions: tuple[str, ...]) -> PaddleOcrEngine:
    try:
        PaddleOCR = import_paddleocr()
    except ImportError as exc:
        raise EngineUnavailable(
            "engine_missing",
            "paddleocr kurulu değil. EXCELBASE_PASSPORT_OCR=1 ile ./run.sh yeniden çalıştırın.",
        ) from exc

    last_error: Exception | None = None
    for version in versions:
        token = version.strip()
        if not token:
            continue
        try:
            pipeline = _construct(PaddleOCR, token)
            return PaddleOcrEngine(pipeline, token)
        except EngineUnavailable:
            raise
        except Exception as exc:  # constructor rejected this version
            last_error = exc
            continue

    raise EngineUnavailable(
        "engine_missing",
        "İstenen model sürümleri desteklenmiyor: " + ", ".join(versions),
    ) from last_error
