from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class Settings:
    app_env: str
    database_url: str
    allow_dev_identity: bool
    auto_create_schema: bool
    field_encryption_key: str
    passport_hmac_key: str
    allowed_origins: tuple[str, ...]
    max_import_bytes: int

    @property
    def production(self) -> bool:
        return self.app_env.lower() == "production"


def _load_settings() -> Settings:
    origins = tuple(
        item.strip()
        for item in os.getenv("V8_ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8080").split(",")
        if item.strip()
    )
    settings = Settings(
        app_env=os.getenv("V8_APP_ENV", "development"),
        database_url=os.getenv("V8_DATABASE_URL", "sqlite:///./excelbase_v8.db"),
        allow_dev_identity=_bool("V8_ALLOW_DEV_IDENTITY", False),
        auto_create_schema=_bool("V8_AUTO_CREATE_SCHEMA", False),
        field_encryption_key=os.getenv("V8_FIELD_ENCRYPTION_KEY", ""),
        passport_hmac_key=os.getenv("V8_PASSPORT_HMAC_KEY", ""),
        allowed_origins=origins,
        max_import_bytes=int(os.getenv("V8_MAX_IMPORT_BYTES", str(20 * 1024 * 1024))),
    )
    if settings.production:
        if settings.allow_dev_identity:
            raise RuntimeError("V8_ALLOW_DEV_IDENTITY production ortamında açılamaz.")
        if settings.auto_create_schema:
            raise RuntimeError("Production şeması yalnızca Alembic ile yönetilmelidir.")
    return settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return _load_settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
