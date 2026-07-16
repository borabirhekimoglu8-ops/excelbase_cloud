"""Foreground Excel import worker entrypoint.

Run with ``EXCELBASE_PROCESS_ROLE=worker python -m backend.worker``.  The web
container uses the same immutable image but never starts an import thread.
"""

from __future__ import annotations

import logging
import os
import signal
import threading
from pathlib import Path

from .config import process_role
from .services import require_postgres_for_split_roles, run_import_worker_forever


logger = logging.getLogger(__name__)


def _start_health_heartbeat(stop: threading.Event) -> threading.Thread | None:
    """Keep a local freshness marker for the container health check."""

    raw_path = os.environ.get("EXCELBASE_WORKER_HEALTH_FILE", "").strip()
    if not raw_path:
        return None
    path = Path(raw_path)
    try:
        interval = max(
            1.0,
            float(os.environ.get("EXCELBASE_WORKER_HEALTH_SECONDS", "5")),
        )
    except ValueError as exc:
        raise RuntimeError("EXCELBASE_WORKER_HEALTH_SECONDS must be numeric.") from exc

    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch()

    def heartbeat() -> None:
        while not stop.wait(interval):
            try:
                path.touch()
            except OSError:
                logger.exception("Worker sağlık işareti güncellenemedi: %s", path)

    thread = threading.Thread(
        target=heartbeat,
        name="excelbase-worker-health",
        daemon=True,
    )
    thread.start()
    return thread


def main() -> None:
    role = process_role()
    if role != "worker":
        raise RuntimeError(
            "backend.worker requires EXCELBASE_PROCESS_ROLE=worker "
            f"(current role: {role!r})."
        )
    require_postgres_for_split_roles()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    stop = threading.Event()

    def request_stop(signum: int, _frame) -> None:
        logger.info("Aktarım işleyicisi durduruluyor signal=%s", signum)
        stop.set()

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    health_heartbeat = _start_health_heartbeat(stop)
    logger.info("Kalıcı aktarım işleyicisi başlatıldı")
    try:
        run_import_worker_forever(stop)
    finally:
        stop.set()
        if health_heartbeat is not None:
            health_heartbeat.join(timeout=2)
    logger.info("Kalıcı aktarım işleyicisi durdu")


if __name__ == "__main__":
    main()
