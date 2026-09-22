"""Local passport OCR: loopback gate, no PII in logs, fail-closed engine."""

from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.auth import Actor
from backend.config import PassportOcrSettings, passport_ocr_settings
from backend.main import app
from backend.passportocr.engine import EngineUnavailable, OcrLine
from backend.passportocr.paddle_engine import lines_from_predict_result
from backend.passportocr.security import local_ocr_gate_state, require_local_ocr_session
from backend.passportocr.service import recognize_image, reset_engine_for_tests, set_engine_for_tests


SYNTHETIC_LINE = "P<TURYILMAZ<<ADA<<<<<<<<<<<<<<<<<<<<<<<<<<<"


class FakeEngine:
    name = "fake"
    version = "test"

    def recognize(self, rgb):
        assert rgb is not None
        return [OcrLine(text=SYNTHETIC_LINE, box=[[0.0, 0.0], [10.0, 0.0], [10.0, 4.0], [0.0, 4.0]], score=0.91)]


def _png_bytes(width: int = 32, height: int = 24) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), (240, 240, 240)).save(buffer, format="PNG")
    return buffer.getvalue()


def _settings(**overrides) -> PassportOcrSettings:
    base = {
        "enabled": True,
        "closed_deployment": True,
        "versions": ("PP-OCRv6",),
        "lang": "en",
        "max_image_bytes": 12 * 1024 * 1024,
        "max_pixels": 25_000_000,
        "max_concurrency": 1,
    }
    base.update(overrides)
    return PassportOcrSettings(**base)


@pytest.fixture(autouse=True)
def _reset_engine():
    reset_engine_for_tests()
    yield
    reset_engine_for_tests()
    app.dependency_overrides.pop(require_local_ocr_session, None)


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("EXCELBASE_PASSPORT_OCR", raising=False)
    settings = passport_ocr_settings()
    assert settings.enabled is False
    assert settings.versions == ("PP-OCRv6",)


def test_gate_blocked_open_network():
    client = TestClient(app)
    request = client.build_request("GET", "/api/passport-ocr/v1/status")
    # Starlette TestClient request is not a FastAPI Request; use gate via settings only.
    blocked = local_ocr_gate_state(
        type("R", (), {"client": type("C", (), {"host": "127.0.0.1"})(), "headers": {"host": "127.0.0.1:8000", "origin": ""}})(),
        _settings(closed_deployment=False),
    )
    assert blocked is not None
    assert blocked[0] == "blocked_open_network"


def test_gate_blocked_not_loopback_client():
    request = type(
        "R",
        (),
        {
            "client": type("C", (), {"host": "10.0.0.5"})(),
            "headers": {"host": "127.0.0.1:8000", "origin": ""},
        },
    )()
    blocked = local_ocr_gate_state(request, _settings())
    assert blocked is not None
    assert blocked[0] == "blocked_not_loopback"


def test_gate_blocked_not_loopback_host():
    request = type(
        "R",
        (),
        {
            "client": type("C", (), {"host": "127.0.0.1"})(),
            "headers": {"host": "192.168.1.10:8000", "origin": ""},
        },
    )()
    blocked = local_ocr_gate_state(request, _settings())
    assert blocked is not None
    assert blocked[0] == "blocked_not_loopback"


def test_gate_blocked_not_loopback_origin():
    request = type(
        "R",
        (),
        {
            "client": type("C", (), {"host": "127.0.0.1"})(),
            "headers": {"host": "127.0.0.1:8000", "origin": "https://excelbase.onrender.com"},
        },
    )()
    blocked = local_ocr_gate_state(request, _settings())
    assert blocked is not None
    assert blocked[0] == "blocked_not_loopback"


def test_status_requires_session_when_enabled(monkeypatch):
    monkeypatch.setenv("EXCELBASE_PASSPORT_OCR", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "0")
    client = TestClient(app)
    response = client.get("/api/passport-ocr/v1/status", headers={"Host": "127.0.0.1:8000"})
    assert response.status_code in {401, 403}


def test_recognize_fake_engine_does_not_log_text(monkeypatch, caplog):
    monkeypatch.setenv("EXCELBASE_PASSPORT_OCR", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "0")
    set_engine_for_tests(FakeEngine())
    app.dependency_overrides[require_local_ocr_session] = lambda: Actor(id="local", name="Ada", role="admin")
    client = TestClient(app)
    with caplog.at_level("INFO"):
        response = client.post(
            "/api/passport-ocr/v1/recognize",
            files={"image": ("page.png", _png_bytes(), "image/png")},
            data={"page_id": "page-1"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["page_id"] == "page-1"
    assert body["engine"]["name"] == "fake"
    assert len(body["lines"]) == 1
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert SYNTHETIC_LINE not in logged
    assert "YILMAZ" not in logged
    assert "ADA" not in logged
    assert "page.png" not in logged


def test_recognize_rejects_unsupported_and_oversize(monkeypatch):
    monkeypatch.setenv("EXCELBASE_PASSPORT_OCR", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "0")
    set_engine_for_tests(FakeEngine())
    app.dependency_overrides[require_local_ocr_session] = lambda: Actor(id="local", name="Ada", role="admin")
    client = TestClient(app)
    unsupported = client.post(
        "/api/passport-ocr/v1/recognize",
        files={"image": ("note.txt", b"not-an-image", "text/plain")},
    )
    assert unsupported.status_code == 415
    assert "YILMAZ" not in unsupported.text

    with pytest.raises(ValueError, match="too_large"):
        recognize_image(_png_bytes(), "p1", _settings(max_image_bytes=32))


def test_engine_missing_when_import_fails(monkeypatch):
    from backend.passportocr import paddle_engine

    def boom():
        raise ImportError("no paddleocr")

    monkeypatch.setattr(paddle_engine, "import_paddleocr", boom)
    with pytest.raises(EngineUnavailable) as excinfo:
        paddle_engine.create_paddle_engine(("PP-OCRv6",))
    assert excinfo.value.state == "engine_missing"

    set_engine_for_tests(FakeEngine(), state="engine_missing", detail="paddleocr kurulu değil")
    app.dependency_overrides[require_local_ocr_session] = lambda: Actor(id="local", name="Ada", role="admin")
    monkeypatch.setenv("EXCELBASE_PASSPORT_OCR", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "0")
    client = TestClient(app)
    response = client.post(
        "/api/passport-ocr/v1/recognize",
        files={"image": ("page.png", _png_bytes(), "image/png")},
    )
    assert response.status_code == 503
    assert response.json()["state"] == "engine_missing"
    assert response.json().get("lines") in (None, [])


def test_lines_from_official_predict_shape():
    lines = lines_from_predict_result(
        {
            "rec_texts": ["ABC", "DEF"],
            "rec_scores": [0.8, 0.7],
            "rec_polys": [[[0, 0], [1, 0], [1, 1], [0, 1]], [[2, 2], [3, 2], [3, 3], [2, 3]]],
        }
    )
    assert [line.text for line in lines] == ["ABC", "DEF"]
    assert lines[0].score == 0.8


def test_recognize_image_in_memory_only():
    set_engine_for_tests(FakeEngine())
    result = recognize_image(_png_bytes(), "p1", _settings())
    assert result["page_id"] == "p1"
    assert result["lines"][0]["text"] == SYNTHETIC_LINE
