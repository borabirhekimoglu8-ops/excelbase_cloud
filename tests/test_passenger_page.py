from __future__ import annotations

import time

import db
import persistence
import photo_store


def _isolate_store(monkeypatch, tmp_path) -> None:
    from backend import services

    deadline = time.monotonic() + 3
    while services._import_worker_alive and time.monotonic() < deadline:
        time.sleep(0.01)
    monkeypatch.setattr(persistence, "STORE_PATH", str(tmp_path / "state.json"))
    monkeypatch.setattr(photo_store, "PHOTO_DIR", str(tmp_path / "photos"))
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr(db, "_init_failed", True)


def _csv(passport: str, name: str) -> bytes:
    return (
        "NO,NAME,SURNAME,PASSPORT NUMBER,VOUCHER,DEPARTURE,ARRIVAL,ADULT,CHILD\n"
        f"1,{name},DOE,{passport},V1,2026-07-20,2026-07-22,25,0\n"
    ).encode("utf-8")


def test_passenger_page_returns_only_visible_rows_and_summary_counts(monkeypatch, tmp_path):
    _isolate_store(monkeypatch, tmp_path)
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "0")

    from fastapi.testclient import TestClient
    from backend import services
    from backend.main import app

    services.import_gate_visa_files(
        [
            ("one.csv", _csv("PAGE0001", "ALICE")),
            ("two.csv", _csv("PAGE0002", "BOB")),
            ("three.csv", _csv("PAGE0003", "CAROL")),
        ],
        batch_id="page-batch",
        dup_strategy="skip",
    )

    with TestClient(app) as client:
        response = client.get("/api/passengers/page?sort=name&offset=1&limit=1")
        assert response.status_code == 200
        page = response.json()
        assert page["total"] == 3
        assert page["offset"] == 1
        assert page["limit"] == 1
        assert [item["full_name"] for item in page["items"]] == ["BOB DOE"]

        summary = client.get("/api/summary").json()
        assert summary["passenger_count"] == 3
        assert summary["ready_count"] + summary["missing_count"] == 3


def test_duplicate_issue_is_preserved_when_copies_are_on_different_pages(monkeypatch, tmp_path):
    _isolate_store(monkeypatch, tmp_path)
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "0")

    from fastapi.testclient import TestClient
    from backend import services
    from backend.main import app

    services.import_gate_visa_files(
        [
            ("first.csv", _csv("DUPL0001", "ALICE")),
            ("middle.csv", _csv("UNIQ0001", "BOB")),
            ("last.csv", _csv("DUPL0001", "ZOE")),
        ],
        batch_id="duplicate-page-batch",
        dup_strategy="add",
    )

    with TestClient(app) as client:
        first = client.get("/api/passengers/page?sort=name&offset=0&limit=1").json()
        last = client.get("/api/passengers/page?sort=name&offset=2&limit=1").json()

    assert first["items"][0]["duplicate"] is True
    assert last["items"][0]["duplicate"] is True
    assert "Tekrarlı" in first["items"][0]["issues"]
    assert "Tekrarlı" in last["items"][0]["issues"]
