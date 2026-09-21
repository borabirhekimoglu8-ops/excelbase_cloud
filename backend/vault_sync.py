"""Opaque encrypted-vault blob store.

The server never sees a PIN, recovery key or data-encryption key. A random
sync token is hashed and used as the filename; the body is the same
`.excelbase-backup` package the device already produces.

Auth is deliberately token-only (no session): anyone who knows the token can
read or overwrite the ciphertext. An in-process per-IP rate limit slows
token guessing without changing the sync contract for legitimate clients.
"""

from __future__ import annotations

import hashlib
import os
import re
import time
from collections import defaultdict, deque
from pathlib import Path

MAX_VAULT_BYTES = 80 * 1024 * 1024
_TOKEN_RE = re.compile(r"^[A-Za-z0-9]{16,64}$")

# Soft ceiling: enough for retries, too low for a dictionary sweep.
_RATE_WINDOW_SECONDS = 60.0
_RATE_MAX_HITS = 30
_rate_hits: dict[str, deque[float]] = defaultdict(deque)


class VaultSyncRateLimitError(RuntimeError):
    """Raised when one client IP exceeds the vault-sync request budget."""


def check_rate_limit(client_key: str) -> None:
    """Refuse when ``client_key`` has exceeded the rolling window budget."""
    key = (client_key or "unknown").strip()[:200] or "unknown"
    now = time.monotonic()
    bucket = _rate_hits[key]
    while bucket and now - bucket[0] > _RATE_WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= _RATE_MAX_HITS:
        raise VaultSyncRateLimitError("Çok fazla eşleme isteği; bir dakika sonra yeniden deneyin.")
    bucket.append(now)


def reset_rate_limits() -> None:
    """Test helper."""
    _rate_hits.clear()


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
