"""Opaque encrypted-vault blob store.

The server never sees a PIN, recovery key or data-encryption key. A random
sync token is hashed and used as the filename; the body is the same
`.excelbase-backup` package the device already produces.
"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

MAX_VAULT_BYTES = 80 * 1024 * 1024
_TOKEN_RE = re.compile(r"^[A-Za-z0-9]{16,64}$")


def _root() -> Path:
    raw = os.environ.get("VAULT_SYNC_DIR") or os.path.join(os.getcwd(), ".data", "vault-sync")
    path = Path(raw)
    path.mkdir(parents=True, exist_ok=True)
    return path


def normalize_token(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", value or "").upper()


def _path_for(token: str) -> Path:
    compact = normalize_token(token)
    if not _TOKEN_RE.match(compact):
        raise ValueError("Eşleme kodu geçersiz.")
    digest = hashlib.sha256(compact.encode("utf-8")).hexdigest()
    return _root() / f"{digest}.bin"


def put_blob(token: str, body: bytes) -> dict[str, int | bool]:
    if not body:
        raise ValueError("Boş yedek kabul edilmez.")
    if len(body) > MAX_VAULT_BYTES:
        raise ValueError("Yedek 80 MB sınırını aşıyor.")
    target = _path_for(token)
    target.write_bytes(body)
    return {"ok": True, "bytes": len(body)}


def get_blob(token: str) -> bytes | None:
    target = _path_for(token)
    if not target.exists():
        return None
    return target.read_bytes()
