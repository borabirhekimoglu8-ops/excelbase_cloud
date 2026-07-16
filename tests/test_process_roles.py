from __future__ import annotations

import threading
import time

import pytest


def test_process_role_defaults_to_combined_and_validates(monkeypatch):
    from backend import config

    monkeypatch.delenv("EXCELBASE_PROCESS_ROLE", raising=False)
    assert config.process_role() == "combined"
    assert config.embedded_import_worker_enabled() is True

    monkeypatch.setenv("EXCELBASE_PROCESS_ROLE", "web")
    assert config.process_role() == "web"
    assert config.embedded_import_worker_enabled() is False

    monkeypatch.setenv("EXCELBASE_PROCESS_ROLE", "invalid")
    with pytest.raises(RuntimeError, match="EXCELBASE_PROCESS_ROLE"):
        config.process_role()


def test_web_role_never_starts_embedded_worker(monkeypatch):
    from backend import services

    monkeypatch.setenv("EXCELBASE_PROCESS_ROLE", "web")
    monkeypatch.setattr(
        services,
        "recover_stale_import_jobs",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("web recovered leases")),
    )
    services.ensure_import_worker()


def test_split_roles_reject_non_postgres_storage(monkeypatch):
    from types import SimpleNamespace
    from backend import services

    monkeypatch.setattr(services.db, "database_configured", lambda: True)
    monkeypatch.setattr(
        services.db,
        "get_engine",
        lambda: SimpleNamespace(dialect=SimpleNamespace(name="sqlite")),
    )
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        services.require_postgres_for_split_roles()


def test_foreground_worker_waits_for_jobs_and_stays_alive(monkeypatch):
    from backend import services

    stop = threading.Event()
    calls = {"claims": 0}
    processed: list[str] = []

    monkeypatch.setattr(services, "migrate_legacy_import_queue", lambda: 0)
    monkeypatch.setattr(services, "recover_stale_import_jobs", lambda force=False: 0)
    monkeypatch.setattr(services, "_queue_uses_database", lambda: False)
    monkeypatch.setattr(services, "_cleanup_local_import_jobs", lambda **_kwargs: 0)
    monkeypatch.setattr(services, "import_worker_poll_seconds", lambda: 0.001)

    def claim():
        calls["claims"] += 1
        if calls["claims"] == 1:
            return None
        if calls["claims"] == 2:
            return {"id": "late-job", "filename": "late.csv"}
        stop.set()
        return None

    monkeypatch.setattr(services, "_queue_claim", claim)
    monkeypatch.setattr(
        services,
        "_process_claimed_import_job",
        lambda job: processed.append(str(job["id"])),
    )

    services.run_import_worker_forever(stop)

    assert calls["claims"] >= 3
    assert processed == ["late-job"]


def test_claimed_job_stops_lease_heartbeat(monkeypatch):
    from backend import services

    stopped = threading.Event()

    class FakeThread:
        def join(self, timeout=None):
            assert timeout is not None
            assert stopped.is_set()

    def start(_job_id):
        return stopped, threading.Event(), FakeThread()

    monkeypatch.setattr(services, "_start_import_lease_heartbeat", start)
    monkeypatch.setattr(services, "_process_import_job", lambda _job: None)

    services._process_claimed_import_job({"id": "owned-job"})
    assert stopped.is_set()


def test_lost_lease_fences_passenger_merge(monkeypatch):
    from backend import services

    stop = threading.Event()
    lost = threading.Event()
    lost.set()
    monkeypatch.setattr(
        services,
        "_start_import_lease_heartbeat",
        lambda _job_id: (stop, lost, None),
    )
    monkeypatch.setattr(
        services,
        "_process_import_job",
        lambda _job: services._assert_current_import_lease_owned(),
    )

    with pytest.raises(services.ImportLeaseLostError):
        services._process_claimed_import_job({"id": "reclaimed-job"})
    assert stop.is_set()


def test_worker_health_heartbeat_creates_fresh_marker(monkeypatch, tmp_path):
    from backend import worker

    marker = tmp_path / "worker.health"
    stop = threading.Event()
    monkeypatch.setenv("EXCELBASE_WORKER_HEALTH_FILE", str(marker))
    monkeypatch.setenv("EXCELBASE_WORKER_HEALTH_SECONDS", "1")

    thread = worker._start_health_heartbeat(stop)
    assert thread is not None and marker.exists()
    first = marker.stat().st_mtime_ns
    time.sleep(1.1)
    assert marker.stat().st_mtime_ns >= first
    stop.set()
    thread.join(timeout=2)
    assert not thread.is_alive()
