from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any

from backend.config import assistant_settings

from .provider import AssistantProvider, DisabledProvider
from .schemas import READ_ONLY_CAPABILITIES, AssistantStatusResponse

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_COUNT_FIELDS = frozenset(
    {
        "passenger_count",
        "ready_count",
        "missing_count",
        "with_photo",
        "missing_photo",
        "missing_passport",
        "missing_voucher",
        "missing_fee",
        "duplicates",
        "today_count",
        "document_count",
        "task_count",
        "work_file_count",
    }
)
_PERCENT_FIELDS = frozenset({"readiness_percent"})
_AMOUNT_FIELDS = frozenset({"adult_total", "child_total", "total_fee"})
_DATE_FIELDS = frozenset({"start", "end"})


def bounded_int(value: object, minimum: int = 0, maximum: int = 1_000_000) -> int:
    """Return a finite integer within the explicit assistant context bounds."""
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return minimum
    return max(minimum, min(maximum, parsed))


def bounded_amount(value: object, maximum: float = 1_000_000_000.0) -> float:
    """Return a non-negative aggregate amount without carrying raw cell text."""
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    if not math.isfinite(parsed):
        return 0.0
    return round(max(0.0, min(maximum, parsed)), 2)


def safe_iso_date(value: object) -> str:
    """Accept only a canonical date string; arbitrary free text is discarded."""
    text = str(value or "").strip()
    return text if _DATE_RE.fullmatch(text) else ""


def sanitize_context_summary(payload: Mapping[str, Any]) -> dict[str, int | float | str]:
    """Structurally allowlist aggregate context.

    Passenger names, passport numbers, e-mail addresses, phone numbers,
    filenames, document bodies and notes have no accepted key and therefore
    cannot cross the provider boundary through this helper.
    """
    sanitized: dict[str, int | float | str] = {}
    for key in _COUNT_FIELDS:
        if key in payload:
            sanitized[key] = bounded_int(payload[key])
    for key in _PERCENT_FIELDS:
        if key in payload:
            sanitized[key] = bounded_int(payload[key], maximum=100)
    for key in _AMOUNT_FIELDS:
        if key in payload:
            sanitized[key] = bounded_amount(payload[key])
    for key in _DATE_FIELDS:
        if key in payload:
            sanitized[key] = safe_iso_date(payload[key])
    return sanitized


def get_assistant_provider() -> AssistantProvider:
    """Resolve the active provider.

    The keyless scaffold intentionally has no network-capable adapter.  Merely
    setting environment variables cannot accidentally turn on a billable call;
    a reviewed provider implementation must replace this fail-closed resolver.
    """
    settings = assistant_settings()
    if not settings.enabled:
        return DisabledProvider()
    return DisabledProvider("Yapılandırma bulundu ancak güvenli sağlayıcı adaptörü henüz kurulmadı.")


def assistant_status() -> AssistantStatusResponse:
    provider = get_assistant_provider()
    return AssistantStatusResponse(
        available=provider.available,
        online_required=True,
        privacy_mode="strict",
        capabilities=list(READ_ONLY_CAPABILITIES),
    )
