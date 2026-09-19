"""Availability and orchestration for the local workstation."""

from __future__ import annotations

from pathlib import Path

from backend.config import WorkstationSettings, workstation_settings

from .advisor import advise_from_stats
from .catalog import default_db_path, load_stats, rebuild_catalog, search


class WorkstationUnavailableError(RuntimeError):
    """Raised when the deployment has not opened this door."""


class WorkstationError(RuntimeError):
    """Raised for a sanitized workstation failure."""


def workstation_state(settings: WorkstationSettings | None = None) -> str:
    resolved = settings or workstation_settings()
    if not resolved.enabled:
        return "disabled"
    if not resolved.closed_deployment:
        return "blocked_open_network"
    return "ready"


def _require_ready(settings: WorkstationSettings) -> None:
    state = workstation_state(settings)
    if state != "ready":
        raise WorkstationUnavailableError(state)


def _resolve_root(root: str, settings: WorkstationSettings) -> Path:
    candidate = (root or settings.default_root).strip()
    if not candidate:
        raise WorkstationError("İş klasörü belirtilmedi.")
    path = Path(candidate).expanduser()
    if not path.exists():
        raise WorkstationError(f"Klasör bulunamadı: {path}")
    if not path.is_dir():
        raise WorkstationError(f"Bu bir klasör değil: {path}")
    return path.resolve()


def build_catalog(root: str = "", settings: WorkstationSettings | None = None) -> dict:
    resolved = settings or workstation_settings()
    _require_ready(resolved)
    path = _resolve_root(root, resolved)
    try:
        return rebuild_catalog(path)
    except PermissionError:
        raise WorkstationError("Klasöre erişim izni yok.") from None
    except OSError as exc:
        raise WorkstationError(f"Klasör okunamadı: {exc.strerror or exc}") from None


def catalog_stats(root: str = "", settings: WorkstationSettings | None = None) -> dict:
    resolved = settings or workstation_settings()
    _require_ready(resolved)
    path = _resolve_root(root, resolved)
    stats = load_stats(default_db_path(path))
    if stats is None:
        raise WorkstationError("Katalog henüz yok. Önce indeksleyin.")
    return stats


def search_catalog(
    query: str,
    root: str = "",
    *,
    kind: str | None = None,
    limit: int = 40,
    settings: WorkstationSettings | None = None,
) -> dict:
    resolved = settings or workstation_settings()
    _require_ready(resolved)
    path = _resolve_root(root, resolved)
    db_path = default_db_path(path)
    if not db_path.exists():
        raise WorkstationError("Katalog henüz yok. Önce indeksleyin.")
    kind_filter = kind if kind in {"tablo", "belge", "gorsel", "diger"} else None
    hits = search(db_path, query, kind=kind_filter, limit=limit)
    return {
        "root": str(path),
        "query": query.strip()[:200],
        "count": len(hits),
        "results": [hit.as_dict() for hit in hits],
    }


def advise(
    question: str = "",
    root: str = "",
    settings: WorkstationSettings | None = None,
) -> dict:
    resolved = settings or workstation_settings()
    _require_ready(resolved)
    path = _resolve_root(root, resolved)
    stats = load_stats(default_db_path(path))
    if stats is None:
        raise WorkstationError("Katalog henüz yok. Önce indeksleyin.")
    return advise_from_stats(stats, question=question)
