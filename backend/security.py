from __future__ import annotations

import os
import secrets

from fastapi import Header, HTTPException, Query, status

from .config import api_key


def _dev_no_auth() -> bool:
    return os.environ.get("GATEVISA_ALLOW_DEV_NO_AUTH") == "1"


def _verify(provided: str | None) -> None:
    expected = api_key()
    if not expected:
        if _dev_no_auth():
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API anahtarı yapılandırılmamış.",
        )
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Geçersiz veya eksik API anahtarı.",
        )


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    _verify(x_api_key)


def require_api_key_flexible(
    x_api_key: str | None = Header(default=None),
    k: str | None = Query(default=None),
) -> None:
    """Header veya query (`k`) üzerinden anahtar kabul eder.

    <img> etiketleri özel başlık gönderemediği için görsel servis eden
    endpoint'lerde query parametresi ile doğrulama gerekir.
    """
    _verify(x_api_key or k)
