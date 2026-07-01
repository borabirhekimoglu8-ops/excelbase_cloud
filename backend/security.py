from __future__ import annotations

import secrets
import os

from fastapi import Header, HTTPException, status

from .config import api_key


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = api_key()
    if not expected:
        if os.environ.get("GATEVISA_ALLOW_DEV_NO_AUTH") == "1":
            return
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API anahtarı yapılandırılmamış.",
        )
    if not x_api_key or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Geçersiz veya eksik API anahtarı.",
        )
