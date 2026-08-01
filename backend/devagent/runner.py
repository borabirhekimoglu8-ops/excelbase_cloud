"""Keeps a development run alive after the request that started it ends.

``stream_development`` yields progress for as long as someone is iterating it.
Tying that directly to the HTTP response made the run the *browser's* to own: a
closed panel, a navigation, a backgrounded tab or a dropped connection
cancelled work that had already been paid for and might be halfway through
editing files. A development run takes minutes, so the operator was effectively
required to sit and watch it.

The run now belongs to the server. A request starts it, returns immediately,
and any later request can ask how it is going -- so the operator can go and use
the application while it works, and come back to the result.

State is in memory on purpose. This is a single-process, single-operator tool;
persisting run history would add a schema and a migration to something whose
only durable output is already a git commit. A restart loses the progress log,
not the work: the commit and the worktree survive it, and `apply` reads git.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field

from backend.config import DevAgentSettings

from .service import (
    DevAgentError,
    DevAgentUnavailableError,
    stream_development,
)

logger = logging.getLogger(__name__)

# Enough to replay a finished run in the panel without letting a pathological
# run grow memory without bound.
MAX_EVENTS = 500


@dataclass
class DevRun:
    """One development run and everything a returning operator needs to see."""

    id: str
    instruction: str
    status: str = "running"  # running | finished | error | cancelled
    events: list[dict] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    finished_at: float = 0.0
    error: str = ""

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "instruction": self.instruction,
            "status": self.status,
            "events": list(self.events),
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
        }


_current: DevRun | None = None
_task: asyncio.Task | None = None


def current_run() -> dict | None:
    """The latest run, still going or finished, or None if there never was one."""
    return _current.snapshot() if _current else None


def is_running() -> bool:
    """Whether a run is genuinely in flight.

    The status alone is not enough: if the task ever fails to be scheduled, or
    dies without running its own finally, a run stuck at "running" would refuse
    every future run for the life of the process with no way back short of a
    restart. Requiring a live task makes that state self-healing.
    """
    if _current is None or _current.status != "running":
        return False
    return _task is not None and not _task.done()


async def _drive(run: DevRun, settings: DevAgentSettings | None) -> None:
    try:
        async for event in stream_development(run.instruction, settings):
            if len(run.events) < MAX_EVENTS:
                run.events.append(event)
        run.status = "finished"
    except asyncio.CancelledError:
        run.status = "cancelled"
        run.error = "Çalışma durduruldu."
        raise
    except DevAgentUnavailableError as exc:
        run.status = "error"
        run.error = f"Geliştirme kullanılabilir değil: {exc}"
    except DevAgentError as exc:
        run.status = "error"
        run.error = str(exc)
    except Exception:
        # The instruction and the model's output are not safe to echo into an
        # error string, so the detail goes to the log and the operator gets a
        # stable message.
        logger.exception("dev agent run failed run_id=%s", run.id)
        run.status = "error"
        run.error = "Geliştirme çalışması tamamlanamadı."
    finally:
        if not run.finished_at:
            run.finished_at = time.time()


def start_run(instruction: str, settings: DevAgentSettings | None = None) -> DevRun:
    """Begin a run in the background and return it immediately.

    Refuses to start a second run while one is going: they would share one
    worktree, and the second would reset the first one's files out from under
    it mid-edit.
    """
    global _current, _task

    if is_running():
        raise DevAgentError("Zaten süren bir geliştirme çalışması var.")

    cleaned = instruction.strip()
    if not cleaned:
        raise DevAgentError("Boş istek.")

    run = DevRun(id=uuid.uuid4().hex, instruction=cleaned[:8_000])
    driver = _drive(run, settings)
    try:
        # Scheduled before the run is published, so a failure to start cannot
        # leave a run recorded as in-flight that nothing will ever finish --
        # which would block every later run behind a permanent 409.
        task = asyncio.create_task(driver)
    except RuntimeError as exc:
        # No running loop: the caller is on a worker thread rather than the
        # event loop. That is a wiring mistake, and it must not be silent.
        driver.close()
        raise DevAgentError(
            "Geliştirme çalışması başlatılamadı: olay döngüsü yok."
        ) from exc
    _current = run
    _task = task
    return run


async def cancel_run() -> None:
    """Stop the run in progress, leaving the worktree as it stands.

    The next run resets the worktree anyway, so a half-finished edit here costs
    nothing; it is never applied, because only a committed run can be.
    """
    global _task
    if _task is None or _task.done():
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    finally:
        _task = None


def reset_for_tests() -> None:
    global _current, _task
    _current = None
    _task = None
