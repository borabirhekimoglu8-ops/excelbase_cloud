from __future__ import annotations

import io
import os
import zipfile
from email.message import EmailMessage

import db
import persistence


def _isolate_store(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(persistence, "STORE_PATH", str(tmp_path / "state.json"))
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr(db, "_init_failed", True)


def _csv(passport: str, departure: str, name: str = "JOHN") -> bytes:
    return (
        "NO,NAME,SURNAME,PASSPORT NUMBER,VOUCHER,DEPARTURE,ARRIVAL,ADULT,CHILD\n"
        f"1,{name},DOE,{passport},V1,{departure},2026-07-22,25,0\n"
    ).encode("utf-8")


def test_composite_dedup_date_scope_package_and_undo(monkeypatch, tmp_path):
    _isolate_store(monkeypatch, tmp_path)
    from backend import services

    first = services.import_gate_visa_files([("first.csv", _csv("U12345678", "2026-07-15"))], batch_id="batch-1", dup_strategy="skip")
    another_day = services.import_gate_visa_files([("second.csv", _csv("U12345678", "2026-07-16"))], batch_id="batch-1", dup_strategy="skip")
    duplicate = services.import_gate_visa_files([("duplicate.csv", _csv("U12345678", "2026-07-15"))], batch_id="batch-1", dup_strategy="skip")

    assert first[0] == 1
    assert another_day[0] == 1
    assert duplicate[0] == 0
    assert duplicate[5] == 1
    assert services.get_summary().passenger_count == 2
    assert services.get_summary("Aralık", "2026-07-15", "2026-07-15").passenger_count == 1

    package, _ = services.build_operation_package(ids=[0])
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        assert {"yolcular.xlsx", "yolcular.csv", "rapor.json"}.issubset(archive.namelist())

    ok, _, count = services.undo_import("batch-1")
    assert ok is True
    assert count == 0


def test_first_run_auth_roles_and_cookie(monkeypatch, tmp_path):
    _isolate_store(monkeypatch, tmp_path)
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "1")
    monkeypatch.setenv("APP_ENV", "development")

    from fastapi.testclient import TestClient
    from backend.auth import _LOGIN_FAILURES
    from backend.main import app

    _LOGIN_FAILURES.clear()
    with TestClient(app) as client:
        assert client.get("/api/auth/status").json()["setup_required"] is True
        assert client.get("/api/summary").status_code == 401

        setup = client.post("/api/auth/setup", json={"display_name": "Test Admin", "pin": "642975"})
        assert setup.status_code == 200
        assert setup.json()["user"]["role"] == "admin"
        assert client.get("/api/summary").status_code == 200

        upload = client.post(
            "/api/import?dup_strategy=skip&batch_id=api-batch",
            files=[
                ("files", ("one.csv", _csv("P111111", "2026-07-15"), "text/csv")),
                ("files", ("two.csv", _csv("P222222", "2026-07-16"), "text/csv")),
            ],
        )
        assert upload.status_code == 200
        assert upload.json()["imported"] == 2
        assert client.post("/api/import/undo?batch_id=api-batch").json()["passenger_count"] == 0

        viewer = client.post("/api/users", json={"name": "Viewer", "pin": "319764", "role": "viewer"})
        assert viewer.status_code == 200
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/summary").status_code == 401

        assert client.post("/api/auth/login", json={"pin": "319764"}).status_code == 200
        forbidden = client.post("/api/passengers/clear")
        assert forbidden.status_code == 403


def test_eml_attachment_parser():
    from backend.mail_ingest import parse_eml

    message = EmailMessage()
    message["Subject"] = "PAX files"
    message["From"] = "ops@example.com"
    message.set_content("Attached")
    message.add_attachment(_csv("P111111", "2026-07-15"), maintype="text", subtype="csv", filename="pax.csv")

    parsed = parse_eml(message.as_bytes())
    assert parsed["subject"] == "PAX files"
    assert parsed["sender"] == "ops@example.com"
    assert parsed["attachments"][0]["filename"] == "pax.csv"


def test_bulk_list_count_limit_disabled_by_default():
    from backend.config import MAX_UPLOAD_FILES

    assert MAX_UPLOAD_FILES == int(os.environ.get("GATEVISA_MAX_UPLOAD_FILES", "0"))
