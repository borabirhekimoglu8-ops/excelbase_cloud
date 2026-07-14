from __future__ import annotations

import io
import os
import zipfile
from email.message import EmailMessage

import db
import persistence
import pytest
import photo_store


def _isolate_store(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(persistence, "STORE_PATH", str(tmp_path / "state.json"))
    monkeypatch.setattr(photo_store, "PHOTO_DIR", str(tmp_path / "photos"))
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

    with pytest.raises(ValueError, match="yolcu|şablon|format",):
        services.import_gate_visa_files([("invalid.csv", b"foo,bar\nx,y\n")], replace=True, batch_id="bad")
    assert services.get_summary().passenger_count == 2

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

        empty_upload = client.post(
            "/api/import?dup_strategy=skip&batch_id=empty-batch",
            files=[(
                "files",
                ("empty.xlsx", b"", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            )],
        )
        assert empty_upload.status_code == 400
        assert "0 bayt" in empty_upload.json()["detail"]

        photo = client.post(
            "/api/photos/match",
            files=[("files", ("P111111.jpg", b"\xff\xd8\xff\xe0synthetic", "image/jpeg"))],
        )
        assert photo.status_code == 200
        assert photo.json()["matched"] == 1
        assert client.get("/api/passengers").json()[0]["photo"]

        invalid_preview = client.post(
            "/api/import/preview",
            files={"file": ("invalid.csv", b"foo,bar\nx,y\n", "text/csv")},
        )
        assert invalid_preview.status_code == 400
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



@pytest.mark.parametrize(
    ("filename", "engine"),
    [
        ("pax.xlsx", "openpyxl"),
        ("pax.xlsm", "openpyxl"),
        ("pax.xls", "xlrd"),
        ("pax.ods", "odf"),
    ],
)
def test_excel_engine_is_selected_from_filename(filename, engine):
    from excelbase_core import excel_engine_for_filename

    assert excel_engine_for_filename(filename) == engine


def test_gate_visa_reader_passes_explicit_excel_engine(monkeypatch):
    import gate_visa_reader

    captured = {}

    class EmptyExcel:
        sheet_names = []

    def fake_excel_file(source, *, engine=None):
        captured["engine"] = engine
        return EmptyExcel()

    monkeypatch.setattr(gate_visa_reader.pd, "ExcelFile", fake_excel_file)
    with pytest.raises(ValueError, match="okunabilir yolcu verisi"):
        gate_visa_reader.read_gate_visa_file_bytes("22.05.xlsx", b"synthetic")

    assert captured["engine"] == "openpyxl"



def test_real_gate_visa_xlsx_is_parsed_with_openpyxl():
    from openpyxl import load_workbook
    from gate_visa_reader import build_gate_visa_template_xlsx, read_gate_visa_file_bytes

    workbook = load_workbook(io.BytesIO(build_gate_visa_template_xlsx()))
    sheet = workbook.active
    values = [1, "JANE", "DOE", "X1234567", "V-42", "2026-07-20", "2026-07-22", 25, 0]
    for column, value in enumerate(values, start=1):
        sheet.cell(row=5, column=column, value=value)
    payload = io.BytesIO()
    workbook.save(payload)

    results = read_gate_visa_file_bytes("22.05.xlsx", payload.getvalue())

    assert len(results) == 1
    assert results[0].rows == 1
    assert results[0].dataframe.iloc[0]["PASSPORT NUMBER"] == "X1234567"


def test_import_fails_loudly_when_db_write_fails(monkeypatch, tmp_path):
    """DB açıkken yazma başarısızsa import 'başarılı' dönmemeli (sessiz veri kaybı)."""
    _isolate_store(monkeypatch, tmp_path)
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "0")
    monkeypatch.setattr(db, "enabled", lambda: True)
    monkeypatch.setattr(db, "save_state", lambda payload: False)
    monkeypatch.setattr(db, "load_state", lambda: {})
    monkeypatch.setattr(db, "save_daily_backup", lambda payload: False)

    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app) as client:
        response = client.post(
            "/api/import?dup_strategy=skip&batch_id=db-fail",
            files=[("files", ("one.csv", _csv("P333333", "2026-07-15"), "text/csv"))],
        )
        assert response.status_code == 503
        assert "veritaban" in response.json()["detail"].lower()
        assert client.get("/api/passengers").json() == []
        assert client.get("/api/summary").json()["persistence"] == "database"


def test_summary_reports_local_fallback_persistence(monkeypatch, tmp_path):
    _isolate_store(monkeypatch, tmp_path)
    from backend import services
    from backend.state import APP_VERSION

    summary = services.get_summary()
    assert summary.persistence == "local-fallback"
    assert summary.version == APP_VERSION


def test_ui_and_backend_versions_match():
    from pathlib import Path
    from backend.state import APP_VERSION

    version_ts = (Path(__file__).parents[1] / "frontend" / "src" / "lib" / "version.ts").read_text(encoding="utf-8")
    assert f'"{APP_VERSION}"' in version_ts


def test_cache_headers_prevent_stale_shell_and_api(monkeypatch, tmp_path):
    """iOS Safari eski uygulama kabuğunu/API yanıtını önbelleklemesin."""
    _isolate_store(monkeypatch, tmp_path)
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "0")

    import backend.main as backend_main
    from fastapi.testclient import TestClient

    out_dir = tmp_path / "out"
    out_dir.mkdir()
    (out_dir / "index.html").write_text("<!doctype html><title>GV</title>", encoding="utf-8")
    monkeypatch.setattr(backend_main, "FRONTEND_OUT", out_dir)

    with TestClient(backend_main.app) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert page.headers["cache-control"] == "no-store"

        api = client.get("/api/summary")
        assert api.status_code == 200
        assert api.headers["cache-control"] == "no-store"

        health = client.get("/health")
        assert health.json()["version"]
        assert health.json()["database_writable"] is False


def _wait_queue_idle(client, timeout_seconds: float = 15.0) -> dict:
    import time as _time

    deadline = _time.monotonic() + timeout_seconds
    state = client.get("/api/import/queue").json()
    while state["active"] and _time.monotonic() < deadline:
        _time.sleep(0.1)
        state = client.get("/api/import/queue").json()
    return state


def test_background_import_queue_processes_without_client(monkeypatch, tmp_path):
    """Dosyalar teslim edildikten sonra işleme istemciden bağımsız sürmeli."""
    _isolate_store(monkeypatch, tmp_path)
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "0")

    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app) as client:
        enqueue = client.post(
            "/api/import/queue?dup_strategy=skip",
            files=[
                ("files", ("one.csv", _csv("P444444", "2026-07-15"), "text/csv")),
                ("files", ("two.csv", _csv("P555555", "2026-07-16"), "text/csv")),
                ("files", ("broken.xlsx", b"gecersiz icerik", "application/octet-stream")),
            ],
        )
        assert enqueue.status_code == 200
        assert len(enqueue.json()["jobs"]) == 3

        state = _wait_queue_idle(client)
        statuses = {job["filename"]: job["status"] for job in state["jobs"]}
        assert statuses["one.csv"] == "done"
        assert statuses["two.csv"] == "done"
        assert statuses["broken.xlsx"] == "error"
        assert state["active"] is False
        assert client.get("/api/summary").json()["passenger_count"] == 2

        # Hatalı iş yeniden kuyruğa alınabilmeli ve yine hata vermeli
        broken = next(job for job in state["jobs"] if job["filename"] == "broken.xlsx")
        retry = client.post(f"/api/import/queue/{broken['id']}/retry")
        assert retry.status_code == 200
        state = _wait_queue_idle(client)
        broken = next(job for job in state["jobs"] if job["filename"] == "broken.xlsx")
        assert broken["status"] == "error"

        # Kaldırma kuyruğu temizlemeli
        assert client.delete(f"/api/import/queue/{broken['id']}").status_code == 200
        names = [job["filename"] for job in client.get("/api/import/queue").json()["jobs"]]
        assert "broken.xlsx" not in names


def test_background_import_replace_applies_only_to_first_file(monkeypatch, tmp_path):
    _isolate_store(monkeypatch, tmp_path)
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "0")

    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app) as client:
        seeded = client.post(
            "/api/import?dup_strategy=add&batch_id=seed",
            files=[("files", ("seed.csv", _csv("P666666", "2026-07-14"), "text/csv"))],
        )
        assert seeded.status_code == 200
        assert client.get("/api/summary").json()["passenger_count"] == 1

        enqueue = client.post(
            "/api/import/queue?replace=true&dup_strategy=skip",
            files=[
                ("files", ("r1.csv", _csv("P777777", "2026-07-15"), "text/csv")),
                ("files", ("r2.csv", _csv("P888888", "2026-07-16"), "text/csv")),
            ],
        )
        assert enqueue.status_code == 200
        _wait_queue_idle(client)
        # İlk dosya listeyi değiştirdi, ikincisi eklendi: eski kayıt gitti.
        assert client.get("/api/summary").json()["passenger_count"] == 2


def test_daily_backup_is_throttled(monkeypatch, tmp_path):
    """Art arda kayıtlar tüm veriyi her seferinde yeniden yedeklemesin."""
    import pandas as pd

    calls = {"backup": 0}

    def fake_backup(payload):
        calls["backup"] += 1
        return True

    monkeypatch.setattr(db, "enabled", lambda: True)
    monkeypatch.setattr(db, "save_state", lambda payload: True)
    monkeypatch.setattr(db, "save_daily_backup", fake_backup)
    monkeypatch.setattr(persistence, "_last_backup_at", 0.0)

    df = pd.DataFrame(columns=persistence.ALL_COLUMNS)
    # Aynı süreçte yaşayan arka plan aktarım işleyicisi de save_store'u
    # çağırabilir (bkz. tests/conftest.py); kilidi burada tutmak bu testin
    # üç çağrısını dışarıdan gelecek herhangi bir araya girmeden garanti eder.
    with persistence._STORE_LOCK:
        persistence.save_store(df, [], {})
        persistence.save_store(df, [], {})
        persistence.save_store(df, [], {})
    assert calls["backup"] == 1


def test_db_engine_retries_after_transient_failure(monkeypatch, tmp_path):
    """Açılışta DB'ye ulaşılamazsa bağlantı kalıcı olarak kapanmamalı."""
    calls = {"n": 0}
    real_create_engine = db.create_engine

    def flaky_create_engine(url, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("bağlantı reddedildi")
        return real_create_engine(url, **kwargs)

    monkeypatch.setattr(db, "create_engine", flaky_create_engine)
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr(db, "_init_done", False)
    monkeypatch.setattr(db, "_init_failed", False)
    monkeypatch.setattr(db, "_retry_at", 0.0)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/retry.db")

    assert db.get_engine() is None  # ilk deneme başarısız
    assert db.get_engine() is None  # bekleme süresi dolmadan yeniden denenmez
    assert calls["n"] == 1

    monkeypatch.setattr(db, "_retry_at", 0.0)  # bekleme süresi doldu
    assert db.get_engine() is not None
    assert calls["n"] == 2
