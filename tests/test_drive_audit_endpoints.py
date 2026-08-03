"""Tests for who may scan a folder, and what a scan is allowed to return.

The scanner reads whatever folder it is pointed at, so the interesting
assertions are about refusal: off by default, refused on a reachable
deployment, and never returning a cell's contents.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from backend.auth import Actor, require_assistant_session
from backend.config import DriveAuditSettings, drive_audit_settings
from backend.driveaudit.service import (
    DriveAuditError,
    DriveAuditUnavailableError,
    drive_audit_state,
    run_scan,
)
from backend.main import app


def _settings(**overrides) -> DriveAuditSettings:
    base = {"enabled": True, "closed_deployment": True, "default_root": ""}
    base.update(overrides)
    return DriveAuditSettings(**base)


@pytest.fixture()
def work_folder(tmp_path: Path) -> Path:
    root = tmp_path / "Drive"
    (root / "operasyon").mkdir(parents=True)
    for index in range(4):
        book = Workbook()
        sheet = book.active
        sheet.append(["Ad Soyad", "Pasaport No", "Acente", "Komisyon"])
        # A real passenger row, to prove it never reaches the report.
        sheet.append(["Ali Yılmaz", "U1234567", "Mavi Tur", "150"])
        book.save(root / "operasyon" / f"pax-{index}.xlsx")
    (root / "operasyon" / "pasaport.pdf").write_bytes(b"%PDF gizli")
    return root


def test_scanning_is_off_until_it_is_switched_on(monkeypatch, work_folder):
    monkeypatch.delenv("EXCELBASE_DRIVE_AUDIT", raising=False)
    assert drive_audit_state(drive_audit_settings()) == "disabled"

    with pytest.raises(DriveAuditUnavailableError):
        run_scan(str(work_folder), _settings(enabled=False))


def test_scanning_is_refused_on_a_deployment_the_internet_can_reach(work_folder):
    """Reading any folder on the server is file disclosure once someone else
    can reach it, whatever the feature is called."""
    with pytest.raises(DriveAuditUnavailableError) as excinfo:
        run_scan(str(work_folder), _settings(closed_deployment=False))

    assert str(excinfo.value) == "blocked_open_network"


def test_a_missing_folder_is_reported_rather_than_crashing(tmp_path):
    with pytest.raises(DriveAuditError, match="bulunamadı"):
        run_scan(str(tmp_path / "yok"), _settings())


def test_a_file_is_not_a_folder(work_folder):
    target = work_folder / "operasyon" / "pasaport.pdf"
    with pytest.raises(DriveAuditError, match="klasör değil"):
        run_scan(str(target), _settings())


def test_an_empty_path_falls_back_to_the_configured_root(work_folder):
    report = run_scan("", _settings(default_root=str(work_folder)))
    assert report.files_seen == 5


def test_a_scan_returns_headers_and_counts_but_never_a_cell(work_folder):
    """The whole privacy argument rests on this: header names and numbers
    leave the scanner, passenger rows do not."""
    report = run_scan(str(work_folder), _settings())
    serialized = str(report.as_dict())

    assert "Pasaport No" in serialized
    assert "Ali Yılmaz" not in serialized
    assert "U1234567" not in serialized
    assert "Mavi Tur" not in serialized


def test_a_scan_names_the_record_type_and_what_the_app_lacks(work_folder):
    report = run_scan(str(work_folder), _settings())

    assert report.by_kind["tablo"] == 4
    assert report.by_kind["belge"] == 1
    entity = report.entities[0]
    assert entity.files == 4
    assert set(entity.missing) == {"Acente", "Komisyon"}


def test_the_endpoints_require_a_session():
    with TestClient(app) as client:
        assert client.get("/api/drive-audit/v1/status").status_code == 401
        assert client.post("/api/drive-audit/v1/scan", json={"root": "/tmp"}).status_code == 401


def test_the_scan_endpoint_reports_a_bad_folder_as_a_request_error(monkeypatch, tmp_path):
    monkeypatch.setenv("EXCELBASE_DRIVE_AUDIT", "1")
    monkeypatch.delenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", raising=False)
    app.dependency_overrides[require_assistant_session] = lambda: Actor(
        id="actor-1", name="Operasyon", role="admin",
    )
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/drive-audit/v1/scan", json={"root": str(tmp_path / "yok")},
            )
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)

    assert response.status_code == 400
    assert "bulunamadı" in response.json()["detail"]


def test_the_scan_endpoint_rejects_options_it_does_not_implement(monkeypatch):
    """Silently ignoring an unknown field would let a caller believe they had
    constrained a scan they had not."""
    app.dependency_overrides[require_assistant_session] = lambda: Actor(
        id="actor-1", name="Operasyon", role="admin",
    )
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/drive-audit/v1/scan",
                json={"root": "/tmp", "follow_symlinks": True},
            )
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)

    assert response.status_code == 422
