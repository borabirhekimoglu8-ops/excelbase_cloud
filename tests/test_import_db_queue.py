from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

sqlalchemy = pytest.importorskip("sqlalchemy")
from sqlalchemy import create_engine, text  # noqa: E402

import db  # noqa: E402


@pytest.fixture()
def queue_db(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'queue.sqlite'}")
    db._create_tables(engine)
    monkeypatch.setattr(db, "get_engine", lambda: engine)
    return engine


def test_enqueue_is_idempotent_and_claim_is_leased(queue_db):
    first = db.enqueue_import_job(
        "lists.zip",
        b"first-payload",
        job_id="upload-id-1",
        kind="archive",
        batch_id="batch-1",
        replace=True,
    )
    retried = db.enqueue_import_job(
        "different.zip",
        b"must-not-overwrite",
        job_id="upload-id-1",
        kind="archive",
        batch_id="batch-2",
    )

    assert first is not None
    assert retried is not None
    assert retried["filename"] == "lists.zip"
    assert retried["batch_id"] == "batch-1"
    assert db.load_import_job_payload("upload-id-1") == b"first-payload"

    claimed = db.claim_next_import_job("worker-a", lease_seconds=60)
    assert claimed is not None
    assert claimed["id"] == "upload-id-1"
    assert claimed["status"] == "processing"
    assert claimed["attempts"] == 1
    assert claimed["lease_owner"] == "worker-a"
    assert claimed["payload"] == b"first-payload"
    assert db.claim_next_import_job("worker-b", lease_seconds=60) is None


def test_archive_children_finish_independently_and_aggregate_parent(queue_db):
    parent = db.enqueue_import_job(
        "lists.zip", b"zip", job_id="parent", kind="archive", batch_id="batch"
    )
    assert parent is not None
    assert db.claim_next_import_job("worker") ["id"] == "parent"

    children = db.create_import_child_jobs(
        "parent", [("good.csv", b"good"), ("bad.xlsx", b"bad")]
    )
    assert children is not None and len(children) == 2
    assert all(child["replace"] is False for child in children)
    assert db.has_active_import_jobs() is True
    assert db.finish_import_job(
        "parent", "waiting", message="Arşiv açıldı.", worker_id="worker", delete_payload=True
    )

    good = db.claim_next_import_job("worker")
    assert good is not None
    assert db.finish_import_job(
        good["id"], "done", message="1 yolcu aktarıldı.", imported=1, worker_id="worker", delete_payload=True
    )
    bad = db.claim_next_import_job("worker")
    assert bad is not None
    assert db.finish_import_job(
        bad["id"], "error", message="Excel dosyası boş.", worker_id="worker"
    )

    result = db.get_import_job("parent")
    assert result is not None
    assert result["status"] == "done"  # partial success is still a completed upload
    assert result["total_items"] == 2
    assert result["processed_items"] == 2
    assert result["error_items"] == 1
    assert result["imported"] == 1
    assert "1 dosya hatalı" in result["message"]
    assert db.load_import_job_payload(bad["id"]) == b"bad"  # retry remains possible
    assert db.has_active_import_jobs() is False


def test_expired_lease_recovery_delete_and_append_only_audit(queue_db):
    db.enqueue_import_job("one.csv", b"one", job_id="one")
    assert db.claim_next_import_job("dead-worker", lease_seconds=60)
    expired = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(timespec="seconds")
    with queue_db.begin() as conn:
        conn.execute(
            text("UPDATE import_jobs SET lease_until = :expired WHERE id = 'one'"),
            {"expired": expired},
        )
        conn.execute(
            text(
                "INSERT INTO documents (ref, filename, mime, data) "
                "VALUES ('import-job://old', 'old.csv', 'text/csv', 'eA==')"
            )
        )

    assert db.recover_expired_import_jobs() == 1
    reclaimed = db.claim_next_import_job("new-worker")
    assert reclaimed is not None and reclaimed["attempts"] == 2
    assert db.finish_import_job(reclaimed["id"], "done", worker_id="new-worker")
    assert db.delete_import_job("one") is True
    assert db.get_import_job("one") is None
    assert db.clear_legacy_import_job_documents() == 1

    event = db.insert_audit_event(
        "Admin", "admin", "POST", "/api/import/queue", event_id="event-1"
    )
    duplicate = db.insert_audit_event(
        "Other", "viewer", "DELETE", "/wrong", event_id="event-1"
    )
    assert event is not None
    assert duplicate == event
    assert db.list_audit_events(10) == [event]


def test_v7_bootstrap_does_not_collide_with_existing_v8_audit_table(monkeypatch, tmp_path):
    """V7 and V8 share Render PostgreSQL but own different audit schemas."""
    engine = create_engine(f"sqlite:///{tmp_path / 'shared.sqlite'}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE audit_events ("
                "id VARCHAR(128) PRIMARY KEY, organization_id VARCHAR(128) NOT NULL, "
                "request_id VARCHAR(80) NOT NULL, created_at VARCHAR(40) NOT NULL)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO audit_events (id, organization_id, request_id, created_at) "
                "VALUES ('v8-event', 'org-1', 'request-1', '2026-07-14')"
            )
        )

    db._create_tables(engine)
    monkeypatch.setattr(db, "get_engine", lambda: engine)
    event = db.insert_audit_event(
        "Admin", "admin", "POST", "/api/import/queue", event_id="v7-event"
    )

    with engine.begin() as conn:
        v8_columns = {
            str(row[1]) for row in conn.execute(text("PRAGMA table_info(audit_events)"))
        }
        v7_columns = {
            str(row[1]) for row in conn.execute(text("PRAGMA table_info(v7_audit_events)"))
        }
        v8_row_count = conn.execute(text("SELECT COUNT(*) FROM audit_events")).scalar_one()
        v7_row_count = conn.execute(text("SELECT COUNT(*) FROM v7_audit_events")).scalar_one()

    assert v8_columns == {"id", "organization_id", "request_id", "created_at"}
    assert v8_row_count == 1
    assert {"id", "occurred_at", "actor", "role", "action", "path"} <= v7_columns
    assert v7_row_count == 1
    assert event is not None
    assert db.list_audit_events(10) == [event]


def test_replace_intent_is_carried_by_every_row_and_force_recovery(queue_db):
    rows = db.enqueue_import_jobs(
        [("bad-first.xlsx", b"bad"), ("good-second.csv", b"good")],
        job_ids=["first", "second"],
        batch_id="replace-batch",
        replace=True,
    )
    assert rows is not None
    assert [row["replace"] for row in rows] == [True, True]

    claimed = db.claim_next_import_job("old-process", lease_seconds=3600)
    assert claimed is not None
    assert db.recover_expired_import_jobs() == 0
    assert db.recover_expired_import_jobs(force=True) == 1
    assert db.get_import_job(claimed["id"])["status"] == "pending"
