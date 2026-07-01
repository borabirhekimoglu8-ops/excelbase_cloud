from __future__ import annotations

import os


def allowed_origins() -> list[str]:
    raw = os.environ.get("GATEVISA_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return [item.strip() for item in raw.split(",") if item.strip()]


def api_key() -> str:
    return os.environ.get("GATEVISA_API_KEY", "").strip()


MAX_UPLOAD_FILES = int(os.environ.get("GATEVISA_MAX_UPLOAD_FILES", "5"))
MAX_UPLOAD_BYTES = int(os.environ.get("GATEVISA_MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))
ALLOWED_IMPORT_EXTENSIONS = {".xlsx", ".xls", ".xlsm", ".ods", ".csv"}
