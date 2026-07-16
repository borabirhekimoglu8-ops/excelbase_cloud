from __future__ import annotations

import io
import zipfile
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

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


def test_lease_renewal_and_finish_are_strictly_owner_status_and_expiry_fenced(queue_db):
    db.enqueue_import_job("one.csv", b"one", job_id="fenced-job")
    claimed = db.claim_next_import_job("worker-a", lease_seconds=30)
    assert claimed is not None
    original_deadline = claimed["lease_until"]

    assert db.renew_import_job_lease("fenced-job", "worker-b", lease_seconds=120) is False
    assert db.finish_import_job("fenced-job", "done", worker_id="worker-b") is False
    assert db.finish_import_job("fenced-job", "done") is False
    assert db.get_import_job("fenced-job")["status"] == "processing"

    assert db.renew_import_job_lease("fenced-job", "worker-a", lease_seconds=120) is True
    renewed = db.get_import_job("fenced-job")
    assert renewed is not None and renewed["lease_until"] > original_deadline

    expired = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(
        timespec="microseconds"
    )
    with queue_db.begin() as conn:
        conn.execute(
            text("UPDATE import_jobs SET lease_until = :expired WHERE id = :id"),
            {"expired": expired, "id": "fenced-job"},
        )

    assert db.renew_import_job_lease("fenced-job", "worker-a", lease_seconds=120) is False
    assert db.finish_import_job("fenced-job", "done", worker_id="worker-a") is False
    assert db.recover_expired_import_jobs() == 1

    reclaimed = db.claim_next_import_job("worker-b", lease_seconds=60)
    assert reclaimed is not None and reclaimed["id"] == "fenced-job"
    assert db.finish_import_job("fenced-job", "done", worker_id="worker-a") is False
    assert db.finish_import_job("fenced-job", "done", worker_id="worker-b") is True
    assert db.finish_import_job("fenced-job", "error", worker_id="worker-b") is False


def test_postgres_passenger_mutation_lock_wraps_the_complete_body(monkeypatch):
    events: list[str] = []

    class FakeTransaction:
        def commit(self):
            events.append("commit")

        def rollback(self):
            events.append("rollback")

    class FakeConnection:
        def begin(self):
            events.append("begin")
            return FakeTransaction()

        def execute(self, statement, params):
            events.append(str(statement))
            assert params == {"lock_key": db._PASSENGER_MUTATION_LOCK_KEY}

        def close(self):
            events.append("close")

    class FakeEngine:
        dialect = SimpleNamespace(name="postgresql")

        def connect(self):
            events.append("connect")
            return FakeConnection()

    monkeypatch.setattr(db, "get_engine", lambda: FakeEngine())

    with db.passenger_mutation_lock():
        events.append("body")

    assert events == [
        "connect",
        "begin",
        "SELECT pg_advisory_xact_lock(:lock_key)",
        "body",
        "commit",
        "close",
    ]


def test_configured_passenger_store_outage_fails_closed_before_mutation(monkeypatch):
    from backend import state

    monkeypatch.setattr(db, "database_configured", lambda: True)
    monkeypatch.setattr(db, "get_engine", lambda: None)
    called = False

    @state.locked_mutation
    def mutation():
        nonlocal called
        called = True

    with pytest.raises(state.StorePersistenceError, match="veritaban"):
        mutation()
    assert called is False

    with pytest.raises(state.StorePersistenceError, match="veritaban"):
        state.load_state()


def test_passenger_state_update_is_an_upsert_without_delete(queue_db):
    """State refresh must not delete the shared key before replacing its value."""
    with queue_db.begin() as conn:
        conn.execute(
            text(
                "CREATE TRIGGER reject_passenger_delete "
                "BEFORE DELETE ON app_state "
                "WHEN OLD.key = 'passengers' "
                "BEGIN SELECT RAISE(FAIL, 'passenger row must not be deleted'); END"
            )
        )

    assert db.save_state({"passengers": [{"passport": "FIRST"}]}) is True
    assert db.save_state({"passengers": [{"passport": "SECOND"}]}) is True
    assert db.load_state() == {"passengers": [{"passport": "SECOND"}]}


def test_readiness_probe_does_not_write_health_state(queue_db):
    assert db.probe_read() is True
    assert db.probe_write() is True
    with queue_db.connect() as conn:
        row = conn.execute(
            text("SELECT value FROM app_state WHERE key = 'health-probe'")
        ).fetchone()
    assert row is None


def test_zip_expansion_bulk_enqueues_deterministic_chunks_and_keeps_bad_member(
    queue_db, monkeypatch
):
    """Forty valid members need four bulk writes, not forty transactions.

    The empty member is an ordering barrier and remains an independent error.
    Re-expanding after a crash must select the same IDs instead of duplicating
    any child payload.
    """
    from backend import services

    parent = db.enqueue_import_job(
        "lists.zip",
        b"durable-parent-payload",
        job_id="zip-parent",
        kind="upload",
        batch_id="zip-batch",
        replace=True,
        dup_strategy="overwrite",
    )
    assert parent is not None
    claimed = db.claim_next_import_job(services._IMPORT_WORKER_ID, lease_seconds=600)
    assert claimed is not None and claimed["id"] == "zip-parent"

    archive_bytes = io.BytesIO()
    raw_names: list[str] = []
    with zipfile.ZipFile(archive_bytes, "w", zipfile.ZIP_DEFLATED) as archive:
        for index in range(20):
            name = f"{index:02d}.csv"
            raw_names.append(name)
            archive.writestr(name, f"row-{index}".encode())
        raw_names.append("20-empty.csv")
        archive.writestr("20-empty.csv", b"")
        for index in range(21, 41):
            name = f"{index:02d}.csv"
            raw_names.append(name)
            archive.writestr(name, f"row-{index}".encode())

    original_enqueue = db.enqueue_import_jobs
    calls: list[dict] = []

    def counted_enqueue(files, **kwargs):
        calls.append(
            {
                "size": len(files),
                "job_ids": list(kwargs.get("job_ids") or []),
                "start_ordinal": kwargs.get("start_ordinal"),
                "parent_id": kwargs.get("parent_id"),
                "replace": kwargs.get("replace"),
                "dup_strategy": kwargs.get("dup_strategy"),
            }
        )
        return original_enqueue(files, **kwargs)

    monkeypatch.setattr(db, "enqueue_import_jobs", counted_enqueue)

    services._expand_archive_job(claimed, archive_bytes.getvalue())

    first_pass_calls = list(calls)
    # 20 valid + one empty barrier + 20 valid => 16, 4, 1, 16, 4.
    assert [call["size"] for call in first_pass_calls] == [16, 4, 1, 16, 4]
    assert [call["start_ordinal"] for call in first_pass_calls] == [0, 16, 20, 21, 37]
    assert all(call["parent_id"] == "zip-parent" for call in first_pass_calls)
    assert all(call["replace"] is True for call in first_pass_calls)
    assert all(call["dup_strategy"] == "overwrite" for call in first_pass_calls)

    children = sorted(
        db.list_import_jobs(limit=None, parent_id="zip-parent") or [],
        key=lambda row: row["ordinal"],
    )
    assert len(children) == len(raw_names) == 41
    assert [child["ordinal"] for child in children] == list(range(41))
    assert [child["id"] for child in children] == [
        services._child_job_id("zip-parent", ordinal, raw_name)
        for ordinal, raw_name in enumerate(raw_names)
    ]
    assert children[20]["status"] == "error"
    assert "boş" in children[20]["message"].lower()
    assert all(child["replace"] is True for child in children)

    # Simulate a crash/retry after expansion. ON CONFLICT + stable IDs keeps
    # the same 41 rows and the same original payloads.
    services._expand_archive_job(claimed, archive_bytes.getvalue())
    retried_children = db.list_import_jobs(limit=None, parent_id="zip-parent") or []
    assert len(retried_children) == 41
    assert [call["size"] for call in calls[5:]] == [16, 4, 1, 16, 4]
    assert [call["job_ids"] for call in calls[5:]] == [
        call["job_ids"] for call in first_pass_calls
    ]


def test_database_zip_chunk_merges_passengers_once_and_retry_is_idempotent(
    queue_db, monkeypatch
):
    from backend import services

    def csv_payload(index: int) -> bytes:
        return (
            "NO,NAME,SURNAME,PASSPORT NUMBER,VOUCHER,DEPARTURE,ARRIVAL,ADULT,CHILD\n"
            f"1,PAX{index},DOE,CHUNK{index:04d},V{index},2026-08-01,2026-08-02,25,0\n"
        ).encode("utf-8")

    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, "w", zipfile.ZIP_DEFLATED) as archive:
        for index in range(4):
            archive.writestr(f"{index:02d}.csv", csv_payload(index))
        archive.writestr("broken.xlsx", b"not-a-workbook")

    parent = db.enqueue_import_job(
        "batch.zip",
        archive_bytes.getvalue(),
        job_id="chunk-parent",
        kind="upload",
        batch_id="chunk-batch",
        dup_strategy="skip",
    )
    assert parent is not None
    claimed = db.claim_next_import_job(services._IMPORT_WORKER_ID, lease_seconds=600)
    assert claimed is not None

    original_save = db.save_state
    save_calls = 0

    def counted_save(payload):
        nonlocal save_calls
        save_calls += 1
        return original_save(payload)

    monkeypatch.setattr(db, "save_state", counted_save)
    services._expand_archive_job(claimed, archive_bytes.getvalue(), process_children=True)

    children = db.list_import_jobs(limit=None, parent_id="chunk-parent") or []
    refreshed_parent = db.get_import_job("chunk-parent")
    state = db.load_state() or {}
    assert save_calls == 1
    assert refreshed_parent is not None and refreshed_parent["status"] == "done"
    assert refreshed_parent["imported"] == 4
    assert refreshed_parent["error_items"] == 1
    assert len(state.get("passengers", [])) == 4
    assert sum(child["status"] == "done" for child in children) == 4
    assert sum(child["status"] == "error" for child in children) == 1

    # A crash replay uses the durable chunk marker and cannot add rows again.
    services._expand_archive_job(claimed, archive_bytes.getvalue(), process_children=True)
    replayed_state = db.load_state() or {}
    assert save_calls == 1
    assert len(replayed_state.get("passengers", [])) == 4
    assert len(db.list_import_jobs(limit=None, parent_id="chunk-parent") or []) == 5


def test_inline_zip_children_are_never_claimable_and_error_payload_survives(
    queue_db, monkeypatch
):
    """The inline database fast path exposes only final child rows.

    A competing worker probes the queue during every parse.  It must never see
    an archive member, and the parent ZIP must remain durable until each
    terminal child transaction has committed.
    """
    from backend import services

    def csv_payload(index: int) -> bytes:
        return (
            "NO,NAME,SURNAME,PASSPORT NUMBER,VOUCHER,DEPARTURE,ARRIVAL,ADULT,CHILD\n"
            f"1,PAX{index},DOE,RACE{index:04d},V{index},2026-08-01,2026-08-02,25,0\n"
        ).encode("utf-8")

    archive_buffer = io.BytesIO()
    broken_payload = b"not-a-workbook"
    with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        # Seventeen valid members force two bounded terminal insert commits.
        for index in range(17):
            archive.writestr(f"{index:02d}.csv", csv_payload(index))
        archive.writestr("broken.xlsx", broken_payload)
    archive_bytes = archive_buffer.getvalue()

    parent = db.enqueue_import_job(
        "race.zip",
        archive_bytes,
        job_id="race-parent",
        kind="upload",
        batch_id="race-batch",
        dup_strategy="skip",
    )
    assert parent is not None
    claimed = db.claim_next_import_job(services._IMPORT_WORKER_ID, lease_seconds=600)
    assert claimed is not None and claimed["id"] == "race-parent"

    original_parse = services._parse_import_files_with_timeout
    parse_claims: list[dict | None] = []

    def parse_with_competing_claim(*args, **kwargs):
        parse_claims.append(db.claim_next_import_job("competing-worker", lease_seconds=60))
        return original_parse(*args, **kwargs)

    original_store = db.store_finished_import_children
    store_calls = 0

    def store_with_visibility_check(parent_id, results, *, worker_id):
        nonlocal store_calls
        store_calls += 1
        # Earlier chunks may already be terminal, but none may be pending.
        before = db.list_import_jobs(limit=None, parent_id=parent_id) or []
        assert all(item["status"] != "pending" for item in before)
        assert db.load_import_job_payload(parent_id) == archive_bytes
        stored = original_store(parent_id, results, worker_id=worker_id)
        after = db.list_import_jobs(limit=None, parent_id=parent_id) or []
        assert all(item["status"] in {"done", "error", "cancelled"} for item in after)
        assert db.load_import_job_payload(parent_id) == archive_bytes
        return stored

    monkeypatch.setattr(services, "_parse_import_files_with_timeout", parse_with_competing_claim)
    monkeypatch.setattr(db, "store_finished_import_children", store_with_visibility_check)

    services._expand_archive_job(claimed, archive_bytes, process_children=True)

    assert parse_claims and all(item is None for item in parse_claims)
    assert store_calls == 2
    children = db.list_import_jobs(limit=None, parent_id="race-parent") or []
    assert len(children) == 18
    assert sum(item["status"] == "done" for item in children) == 17
    assert sum(item["status"] == "error" for item in children) == 1
    broken = next(item for item in children if item["filename"] == "broken.xlsx")
    assert db.load_import_job_payload(broken["id"]) == broken_payload
    assert all(
        db.load_import_job_payload(item["id"]) is None
        for item in children
        if item["status"] == "done"
    )
    assert db.load_import_job_payload("race-parent") is None


def test_inline_zip_add_replays_after_state_commit_without_duplicate_or_terminal_overwrite(
    queue_db, monkeypatch
):
    """Crash between state and child commits is safe for ``dup_strategy=add``."""
    from backend import services

    duplicate_csv = (
        "NO,NAME,SURNAME,PASSPORT NUMBER,VOUCHER,DEPARTURE,ARRIVAL,ADULT,CHILD\n"
        "1,SAME,PERSON,ADD00001,V1,2026-08-01,2026-08-02,25,0\n"
    ).encode("utf-8")
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("first.csv", duplicate_csv)
        archive.writestr("second.csv", duplicate_csv)
    archive_bytes = archive_buffer.getvalue()

    parent = db.enqueue_import_job(
        "add.zip",
        archive_bytes,
        job_id="add-parent",
        kind="upload",
        batch_id="add-batch",
        dup_strategy="add",
    )
    assert parent is not None
    claimed = db.claim_next_import_job(services._IMPORT_WORKER_ID, lease_seconds=600)
    assert claimed is not None and claimed["id"] == "add-parent"

    original_save = db.save_state
    save_calls = 0

    def counted_save(payload):
        nonlocal save_calls
        save_calls += 1
        return original_save(payload)

    original_store = db.store_finished_import_children
    fail_once = True

    def crash_before_child_commit(parent_id, results, *, worker_id):
        nonlocal fail_once
        if fail_once:
            fail_once = False
            raise db.DatabaseUnavailableError("simulated crash boundary")
        return original_store(parent_id, results, worker_id=worker_id)

    monkeypatch.setattr(db, "save_state", counted_save)
    monkeypatch.setattr(db, "store_finished_import_children", crash_before_child_commit)

    with pytest.raises(services.StorePersistenceError):
        services._expand_archive_job(claimed, archive_bytes, process_children=True)

    assert save_calls == 1
    assert len((db.load_state() or {}).get("passengers", [])) == 2
    assert db.list_import_jobs(limit=None, parent_id="add-parent") == []
    assert db.load_import_job_payload("add-parent") == archive_bytes

    # The deterministic chunk marker returns the original result and avoids a
    # second append even though no child transaction survived the first run.
    services._expand_archive_job(claimed, archive_bytes, process_children=True)
    assert save_calls == 1
    assert len((db.load_state() or {}).get("passengers", [])) == 2
    children = db.list_import_jobs(limit=None, parent_id="add-parent") or []
    assert len(children) == 2
    assert all(item["status"] == "done" for item in children)
    assert sum(item["imported"] for item in children) == 2
    assert db.load_import_job_payload("add-parent") is None

    # ON CONFLICT never rewrites a prior terminal result.
    first = sorted(children, key=lambda item: item["ordinal"])[0]
    original_store(
        "add-parent",
        [
            {
                "id": first["id"],
                "ordinal": first["ordinal"],
                "filename": first["filename"],
                "status": "error",
                "message": "must not replace terminal result",
                "payload": b"overwrite-attempt",
            }
        ],
        worker_id=services._IMPORT_WORKER_ID,
    )
    unchanged = db.get_import_job(first["id"])
    assert unchanged is not None and unchanged["status"] == "done"
    assert unchanged["imported"] == first["imported"]
    assert db.load_import_job_payload(first["id"]) is None


def test_inline_zip_leaves_preexisting_pending_child_to_regular_queue(queue_db):
    """A pending row from an older release must not be merged inline again."""
    from backend import services

    csv_payload = (
        "NO,NAME,SURNAME,PASSPORT NUMBER,VOUCHER,DEPARTURE,ARRIVAL,ADULT,CHILD\n"
        "1,OLD,QUEUE,OLD00001,V1,2026-08-01,2026-08-02,25,0\n"
    ).encode("utf-8")
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("old.csv", csv_payload)
    archive_bytes = archive_buffer.getvalue()

    parent = db.enqueue_import_job(
        "old.zip",
        archive_bytes,
        job_id="old-parent",
        kind="upload",
        batch_id="old-batch",
        dup_strategy="add",
    )
    assert parent is not None
    claimed_parent = db.claim_next_import_job(services._IMPORT_WORKER_ID, lease_seconds=600)
    assert claimed_parent is not None
    child_id = services._child_job_id("old-parent", 0, "old.csv")
    old_children = db.enqueue_import_jobs(
        [("old.csv", csv_payload)],
        job_ids=[child_id],
        parent_id="old-parent",
        batch_id="old-batch",
        dup_strategy="add",
    )
    assert old_children is not None and old_children[0]["status"] == "pending"

    services._expand_archive_job(claimed_parent, archive_bytes, process_children=True)

    assert (db.load_state() or {}).get("passengers", []) == []
    pending = db.get_import_job(child_id)
    assert pending is not None and pending["status"] == "pending"
    claimed_child = db.claim_next_import_job("ordinary-worker", lease_seconds=60)
    assert claimed_child is not None and claimed_child["id"] == child_id


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
