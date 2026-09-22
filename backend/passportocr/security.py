"""Loopback + pairing gate for local passport OCR. No wildcard CORS."""

from __future__ import annotations

from ipaddress import ip_address
from urllib.parse import urlsplit

from fastapi import Depends, Header, HTTPException, Request, status

from backend.auth import Actor, require_assistant_session
from backend.config import PassportOcrSettings, passport_ocr_settings


LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def _hostname(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"//{raw}"
    try:
        host = (urlsplit(raw).hostname or "").strip().lower()
    except ValueError:
        return ""
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    return host


def is_loopback_host(value: str) -> bool:
    host = _hostname(value)
    if host in LOOPBACK_HOSTS:
        return True
    try:
        return bool(ip_address(host).is_loopback)
    except ValueError:
        return False


def is_loopback_client(request: Request) -> bool:
    client = request.client.host if request.client else ""
    return is_loopback_host(client)


def local_ocr_gate_state(
    request: Request,
    settings: PassportOcrSettings | None = None,
) -> tuple[str, str, int] | None:
    """Return (state, detail, status) when the request must be refused."""
    resolved = settings or passport_ocr_settings()
    if not resolved.enabled:
        return (
            "disabled",
            "Yerel pasaport OCR kapalı. .env içinde EXCELBASE_PASSPORT_OCR=1 yazın.",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if not resolved.closed_deployment:
        return (
            "blocked_open_network",
            "Pasaport OCR yalnız kapalı kurulumda açılır (açık erişim + boş IP listesi).",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if not is_loopback_client(request):
        return (
            "blocked_not_loopback",
            "Pasaport OCR yalnız bu bilgisayarın loopback adresinden çağrılır.",
            status.HTTP_403_FORBIDDEN,
        )
    if not is_loopback_host(request.headers.get("host", "")):
        return (
            "blocked_not_loopback",
            "Pasaport OCR Host başlığı loopback olmalıdır.",
            status.HTTP_403_FORBIDDEN,
        )
    origin = request.headers.get("origin", "").strip()
    if origin and not is_loopback_host(origin):
        return (
            "blocked_not_loopback",
            "Pasaport OCR Origin başlığı loopback olmalıdır.",
            status.HTTP_403_FORBIDDEN,
        )
    return None


def require_local_ocr_session(
    request: Request,
    x_csrf_token: str | None = Header(default=None),
) -> Actor:
    blocked = local_ocr_gate_state(request)
    if blocked:
        state, detail, code = blocked
        raise HTTPException(status_code=code, detail={"message": detail, "state": state})
    return require_assistant_session(request, x_csrf_token)
