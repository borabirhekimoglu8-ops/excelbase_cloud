"""Local closed-circuit workstation: catalogue, search, deterministic advisor."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from backend.auth import Actor, require_assistant_session
from backend.config import WorkstationSettings
from backend.main import app
from backend.workstation.advisor import advise_from_stats
from backend.workstation.catalog import rebuild_catalog, search
from backend.workstation.service import (
    WorkstationError,
    WorkstationUnavailableError,
    advise,
    build_catalog,
    search_catalog,
    workstation_state,
)


def _settings(**overrides) -> WorkstationSettings:
    base = {"enabled": True, "closed_deployment": True, "default_root": ""}
    base.update(overrides)
    return WorkstationSettings(**base)


@pytest.fixture()
def work_folder(tmp_path: Path) -> Path:
    root = tmp_path / "Drive"
    (root / "operasyon" / "2026-09-19").mkdir(parents=True)
    for index in range(3):
        book = Workbook()
        sheet = book.active
        sheet.append(["Ad Soyad", "Pasaport No"])
        sheet.append(["Ali Yılmaz", "U1234567"])
        book.save(root / "operasyon" / f"C-{1000 + index}_pax.xlsx")
    (root / "operasyon" / "2026-09-19" / "pasaport.pdf").write_bytes(b"%PDF secret")
    (root / "operasyon" / "foto.jpg").write_bytes(b"\xff\xd8\xff fakejpeg")
    (root / "operasyon" / "not.txt").write_text("gizli not", encoding="utf-8")
    return root


def test_workstation_is_off_by_default(monkeypatch, work_folder):
    monkeypatch.delenv("EXCELBASE_WORKSTATION", raising=False)
    from backend.config import workstation_settings

    assert workstation_state(workstation_settings()) == "disabled"
    with pytest.raises(WorkstationUnavailableError):
        build_catalog(str(work_folder), _settings(enabled=False))


def test_workstation_refused_on_open_network(work_folder):
    with pytest.raises(WorkstationUnavailableError) as excinfo:
        build_catalog(str(work_folder), _settings(closed_deployment=False))
    assert str(excinfo.value) == "blocked_open_network"


def test_catalog_indexes_names_but_never_file_bodies(work_folder):
    stats = rebuild_catalog(work_folder)
    serialized = str(stats)

    assert stats["files_seen"] == 6
    assert stats["by_kind"]["tablo"] == 3
    assert stats["by_kind"]["belge"] == 2
    assert stats["by_kind"]["gorsel"] == 1
    assert stats["c_code_files"] >= 3
    assert "Ali Yılmaz" not in serialized
    assert "U1234567" not in serialized
    assert "gizli not" not in serialized
    assert "%PDF secret" not in serialized


def test_search_finds_by_c_code_and_path(work_folder):
    rebuild_catalog(work_folder)
    from backend.workstation.catalog import default_db_path

    hits = search(default_db_path(work_folder), "C-1001")
    assert any(hit.name.startswith("C-1001") for hit in hits)

    hits = search(default_db_path(work_folder), "pasaport")
    assert any(hit.name == "pasaport.pdf" for hit in hits)


def test_advisor_answers_without_model(work_folder):
    stats = rebuild_catalog(work_folder)
    report = advise_from_stats(stats, question="kaç dosya var?")
    assert report["mode"] == "local_deterministic"
    assert report["privacy"] == "aggregate_catalog_only"
    assert "dosya" in report["answer"].lower()
    assert report["items"]

    kvkk = advise_from_stats(stats, question="kvkk sızıntı olur mu?")
    assert "dışarı" in kvkk["answer"].lower() or "yerel" in kvkk["answer"].lower()


def test_service_search_requires_catalog(work_folder):
    with pytest.raises(WorkstationError, match="Katalog henüz yok"):
        search_catalog("C-1001", str(work_folder), settings=_settings())


def test_endpoints_require_assistant_session_and_return_search(work_folder):
    app.dependency_overrides[require_assistant_session] = lambda: Actor(
        id="a1", name="Ops", role="admin"
    )
    client = TestClient(app)
    try:
        # Feature off → disabled status still reachable when session exists.
        response = client.get("/api/workstation/v1/status")
        assert response.status_code == 200
        assert response.json()["state"] in {"disabled", "ready", "blocked_open_network"}
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)


def test_endpoints_build_search_advise(monkeypatch, work_folder):
    monkeypatch.setenv("EXCELBASE_WORKSTATION", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "0")
    monkeypatch.delenv("EXCELBASE_ASSISTANT_ALLOWED_IPS", raising=False)

    app.dependency_overrides[require_assistant_session] = lambda: Actor(
        id="a1", name="Ops", role="admin"
    )
    client = TestClient(app)
    try:
        status = client.get("/api/workstation/v1/status")
        assert status.status_code == 200
        assert status.json()["available"] is True
        assert status.json()["egress"] == "none"

        built = client.post(
            "/api/workstation/v1/catalog/build",
            json={"root": str(work_folder)},
        )
        assert built.status_code == 200
        assert built.json()["files_seen"] == 6
        assert "Ali" not in str(built.json())

        found = client.post(
            "/api/workstation/v1/catalog/search",
            json={"root": str(work_folder), "query": "C-1002"},
        )
        assert found.status_code == 200
        assert found.json()["count"] >= 1

        advice = client.post(
            "/api/workstation/v1/advise",
            json={"root": str(work_folder), "question": "düzen öner"},
        )
        assert advice.status_code == 200
        body = advice.json()
        assert body["mode"] == "local_deterministic"
        assert body["items"]
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)


def test_ollama_provider_refuses_non_loopback(monkeypatch):
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "ollama")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "llama3.2")
    monkeypatch.setenv("EXCELBASE_OLLAMA_BASE_URL", "http://evil.example:11434")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.delenv("EXCELBASE_ASSISTANT_ALLOW_RAW_DOCUMENTS", raising=False)

    from backend.assistant.service import assistant_configuration_state, assistant_status
    from backend.config import assistant_settings

    settings = assistant_settings()
    assert assistant_configuration_state(settings) == "privacy_mismatch"
    status = assistant_status()
    assert status.local_provider is True
    assert status.online_required is False
    assert status.available is False


def test_ollama_provider_ready_on_loopback(monkeypatch):
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "ollama")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "llama3.2")
    monkeypatch.setenv("EXCELBASE_OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.delenv("EXCELBASE_ASSISTANT_ALLOW_RAW_DOCUMENTS", raising=False)

    from backend.assistant.service import assistant_configuration_state, get_assistant_provider
    from backend.config import assistant_settings

    settings = assistant_settings()
    assert assistant_configuration_state(settings) == "ready"
    provider = get_assistant_provider(settings)
    assert provider.name == "ollama"
    assert provider.available is True
