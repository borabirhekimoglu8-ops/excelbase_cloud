from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import HTTPException, status


class SlidingWindowLimiter:
    """In-memory, per-process sliding-window limiter.

    Suitable for a single-instance deployment; swap for a Redis-backed
    implementation when the API is scaled horizontally.
    """

    def __init__(self, limit_per_minute: int) -> None:
        self._limit = limit_per_minute
        self._window_seconds = 60.0
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            cutoff = now - self._window_seconds
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= self._limit:
                retry_after = max(1, int(hits[0] + self._window_seconds - now) + 1)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="İstek limiti aşıldı; lütfen bekleyip yeniden deneyin.",
                    headers={"Retry-After": str(retry_after)},
                )
            hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
