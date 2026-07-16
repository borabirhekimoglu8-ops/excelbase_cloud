from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return int(raw)


def _normalize_database_url(url: str) -> str:
    """Render/Heroku style postgres:// URLs are rewritten for the bundled pg8000 driver."""
    if url.startswith("postgres://"):
        return "postgresql+pg8000://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+pg8000://" + url[len("postgresql://"):]
    return url


def _encryption_keys() -> tuple[tuple[str, str], ...]:
    """Returns ((key_id, fernet_key), ...); the first entry is the active encryption key."""
    multi = os.getenv("V8_FIELD_ENCRYPTION_KEYS", "").strip()
    if multi:
        pairs: list[tuple[str, str]] = []
        for item in multi.split(","):
            item = item.strip()
            if not item:
                continue
            key_id, sep, key = item.partition(":")
            if not sep or not key_id.strip() or not key.strip():
                raise RuntimeError("V8_FIELD_ENCRYPTION_KEYS 'keyid:fernetkey' çiftlerinden oluşmalıdır.")
            pairs.append((key_id.strip(), key.strip()))
        if not pairs:
            raise RuntimeError("V8_FIELD_ENCRYPTION_KEYS boş olamaz.")
        return tuple(pairs)
    single = os.getenv("V8_FIELD_ENCRYPTION_KEY", "").strip()
    if single:
        return (("k1", single),)
    return ()


@dataclass(frozen=True, slots=True)
class Settings:
    app_env: str
    database_url: str
    allow_dev_identity: bool
    auto_create_schema: bool
    field_encryption_keys: tuple[tuple[str, str], ...]
    passport_hmac_key: str
    allowed_origins: tuple[str, ...]
    max_import_bytes: int
    max_photo_bytes: int
    jwt_secret: str
    jwt_issuer: str
    jwt_audience: str
    storage_backend: str
    storage_local_root: str
    s3_bucket: str
    s3_region: str
    s3_endpoint_url: str
    s3_prefix: str
    rate_limit_enabled: bool
    rate_limit_import_per_minute: int
    rate_limit_reveal_per_minute: int
    ui_url: str

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
        database_url=_normalize_database_url(os.getenv("V8_DATABASE_URL", "sqlite:///./excelbase_v8.db")),
        allow_dev_identity=_bool("V8_ALLOW_DEV_IDENTITY", False),
        auto_create_schema=_bool("V8_AUTO_CREATE_SCHEMA", False),
        field_encryption_keys=_encryption_keys(),
        passport_hmac_key=os.getenv("V8_PASSPORT_HMAC_KEY", ""),
        allowed_origins=origins,
        max_import_bytes=_int("V8_MAX_IMPORT_BYTES", 20 * 1024 * 1024),
        max_photo_bytes=_int("V8_MAX_PHOTO_BYTES", 5 * 1024 * 1024),
        jwt_secret=os.getenv("V8_JWT_SECRET", ""),
        jwt_issuer=os.getenv("V8_JWT_ISSUER", "excelbase-v8"),
        jwt_audience=os.getenv("V8_JWT_AUDIENCE", "excelbase-v8"),
        storage_backend=os.getenv("V8_STORAGE_BACKEND", "local").strip().lower(),
        storage_local_root=os.getenv("V8_STORAGE_LOCAL_ROOT", "./objects"),
        s3_bucket=os.getenv("V8_S3_BUCKET", ""),
        s3_region=os.getenv("V8_S3_REGION", ""),
        s3_endpoint_url=os.getenv("V8_S3_ENDPOINT_URL", ""),
        s3_prefix=os.getenv("V8_S3_PREFIX", ""),
        rate_limit_enabled=_bool("V8_RATE_LIMIT_ENABLED", True),
        rate_limit_import_per_minute=_int("V8_RATE_LIMIT_IMPORT_PER_MINUTE", 10),
        rate_limit_reveal_per_minute=_int("V8_RATE_LIMIT_REVEAL_PER_MINUTE", 30),
        # API kökünü ziyaret eden tarayıcılar ana Excelbase arayüzüne yönlendirilir.
        # Eski /v8 istemci rotası kaldırıldığı için varsayılan hedef origin köküdür.
        ui_url=os.getenv("V8_UI_URL", "").strip() or (origins[0] if origins else ""),
    )
    if settings.production:
        if settings.allow_dev_identity:
            raise RuntimeError("V8_ALLOW_DEV_IDENTITY production ortamında açılamaz.")
        if settings.auto_create_schema:
            raise RuntimeError("Production şeması yalnızca Alembic ile yönetilmelidir.")
        if settings.storage_backend == "s3" and not settings.s3_bucket:
            raise RuntimeError("V8_STORAGE_BACKEND=s3 için V8_S3_BUCKET zorunludur.")
    if settings.storage_backend not in {"local", "s3"}:
        raise RuntimeError("V8_STORAGE_BACKEND 'local' veya 's3' olmalıdır.")
    return settings


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return _load_settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
