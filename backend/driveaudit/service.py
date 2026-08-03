"""Availability rules for the folder scanner.

Kept beside the scanner rather than inside it so the analysis stays a pure
function over a path: the rules about *who may ask* belong to the deployment,
not to the arithmetic.
"""

from __future__ import annotations

from pathlib import Path

from backend.config import DriveAuditSettings, drive_audit_settings

from .scanner import ScanReport, scan_folder


class DriveAuditUnavailableError(RuntimeError):
    """Raised when the deployment has not opened this door."""


class DriveAuditError(RuntimeError):
    """Raised for a sanitized scan failure."""


def drive_audit_state(settings: DriveAuditSettings | None = None) -> str:
    """Why the scanner is or is not available, in one word."""
    resolved = settings or drive_audit_settings()
    if not resolved.enabled:
        return "disabled"
    if not resolved.closed_deployment:
        # Reading any folder on the server is a file-disclosure feature the
        # moment the server is reachable by someone else.
        return "blocked_open_network"
    return "ready"


def run_scan(root: str, settings: DriveAuditSettings | None = None) -> ScanReport:
    """Scan one folder, refusing before doing any work if it is not allowed."""
    resolved = settings or drive_audit_settings()
    state = drive_audit_state(resolved)
    if state != "ready":
        raise DriveAuditUnavailableError(state)

    candidate = (root or resolved.default_root).strip()
    if not candidate:
        raise DriveAuditError("Taranacak klasör belirtilmedi.")

    path = Path(candidate).expanduser()
    if not path.exists():
        raise DriveAuditError(f"Klasör bulunamadı: {path}")
    if not path.is_dir():
        raise DriveAuditError(f"Bu bir klasör değil: {path}")

    try:
        return scan_folder(path)
    except PermissionError:
        raise DriveAuditError("Klasöre erişim izni yok.") from None
    except OSError as exc:
        # Path and errno are safe to show; they are the operator's own machine
        # and the message is what tells them which drive is offline.
        raise DriveAuditError(f"Klasör okunamadı: {exc.strerror or exc}") from None
