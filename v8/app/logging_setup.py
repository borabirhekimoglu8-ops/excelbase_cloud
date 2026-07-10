from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for attr in ("request_id", "method", "path", "status_code", "duration_ms", "client"):
            value = getattr(record, attr, None)
            if value is not None:
                payload[attr] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("excelbase.v8")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


class RequestTimer:
    def __init__(self) -> None:
        self._start = time.perf_counter()

    def duration_ms(self) -> float:
        return round((time.perf_counter() - self._start) * 1000, 2)
