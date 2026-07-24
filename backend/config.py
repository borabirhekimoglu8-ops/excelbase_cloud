from __future__ import annotations

import os
from dataclasses import dataclass, field


def allowed_origins() -> list[str]:
    raw = os.environ.get("GATEVISA_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return [item.strip() for item in raw.split(",") if item.strip()]


def api_key() -> str:
    return os.environ.get("GATEVISA_API_KEY", "").strip()


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        parsed = int(raw) if raw else default
    except ValueError:
        parsed = default
    return max(minimum, min(maximum, parsed))


@dataclass(frozen=True, slots=True)
class AssistantSettings:
    enabled: bool
    provider: str
    model: str
    api_key: str = field(repr=False)
    pii_mode: str = "strict"
    allow_raw_documents: bool = False
    max_context_records: int = 25
    max_input_chars: int = 12_000
    max_history_turns: int = 8
    max_output_tokens: int = 1_200
    timeout_seconds: int = 35
    requests_per_minute: int = 6
    requests_per_day: int = 100
    max_concurrency: int = 2


def assistant_settings() -> AssistantSettings:
    """Read assistant configuration without caching or logging secrets."""
    provider = os.environ.get("EXCELBASE_ASSISTANT_PROVIDER", "disabled").strip().lower()
    if provider not in {"disabled", "anthropic"}:
        provider = "disabled"
    pii_mode = os.environ.get("EXCELBASE_ASSISTANT_PII_MODE", "strict").strip().lower()
    if pii_mode != "strict":
        pii_mode = "strict"
    return AssistantSettings(
        enabled=_env_bool("EXCELBASE_ASSISTANT_ENABLED"),
        provider=provider,
        model=os.environ.get("EXCELBASE_ASSISTANT_MODEL", "").strip()[:200],
        api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip(),
        pii_mode=pii_mode,
        allow_raw_documents=_env_bool("EXCELBASE_ASSISTANT_ALLOW_RAW_DOCUMENTS"),
        max_context_records=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_CONTEXT_RECORDS", 25, 1, 100),
        max_input_chars=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_INPUT_CHARS", 12_000, 1_000, 100_000),
        max_history_turns=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_HISTORY_TURNS", 8, 0, 30),
        max_output_tokens=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_OUTPUT_TOKENS", 1_200, 64, 8_192),
        timeout_seconds=_bounded_env_int("EXCELBASE_ASSISTANT_TIMEOUT_SECONDS", 35, 5, 120),
        requests_per_minute=_bounded_env_int("EXCELBASE_ASSISTANT_REQUESTS_PER_MINUTE", 6, 1, 120),
        requests_per_day=_bounded_env_int("EXCELBASE_ASSISTANT_REQUESTS_PER_DAY", 100, 1, 10_000),
        max_concurrency=_bounded_env_int("EXCELBASE_ASSISTANT_MAX_CONCURRENCY", 2, 1, 20),
    )


# Kullaniciya gorunen dosya adedi siniri yoktur. Kaynak tuketimini dosya adedi
# yerine dosya basina boyut ve istemci tarafindaki sirali kuyruk kontrol eder.
# Pozitif bir deger ancak acil durum operasyonel freni olarak kullanilabilir.
MAX_UPLOAD_FILES = int(os.environ.get("GATEVISA_MAX_UPLOAD_FILES", "0"))
MAX_UPLOAD_BYTES = int(os.environ.get("GATEVISA_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
ALLOWED_IMPORT_EXTENSIONS = {".xlsx", ".xls", ".xlsm", ".ods", ".csv"}

# ZIP, iPhone'da onlarca ayrı dosya tutamacı yerine tek güvenilir aktarım
# sağlar. Adet sınırı yoktur; yalnızca sıkıştırılmış/sıkıştırılmamış toplam
# boyutlar kaynak tüketimini ve ZIP bombalarını sınırlar.
MAX_IMPORT_ARCHIVE_BYTES = int(
    os.environ.get("GATEVISA_MAX_IMPORT_ARCHIVE_BYTES", str(100 * 1024 * 1024))
)
MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES = int(
    os.environ.get("GATEVISA_MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES", str(300 * 1024 * 1024))
)

MAX_PHOTO_FILES = int(os.environ.get("GATEVISA_MAX_PHOTO_FILES", "300"))
MAX_PHOTO_BYTES = int(os.environ.get("GATEVISA_MAX_PHOTO_BYTES", str(25 * 1024 * 1024)))
MAX_RESTORE_BYTES = int(os.environ.get("GATEVISA_MAX_RESTORE_BYTES", str(30 * 1024 * 1024)))


def require_auth() -> bool:
    raw = os.environ.get("GATEVISA_REQUIRE_AUTH")
    if raw is not None:
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return os.environ.get("APP_ENV", "development").lower() == "production"


SESSION_COOKIE = os.environ.get("GATEVISA_SESSION_COOKIE", "gatevisa_session")
SESSION_DAYS = int(os.environ.get("GATEVISA_SESSION_DAYS", "14"))
MAX_AUDIT_EVENTS = int(os.environ.get("GATEVISA_MAX_AUDIT_EVENTS", "500"))
# Geri alma yalnızca SON aktarımı desteklediği için fazladan anlık görüntü saklamak
# her kayıtta tüm yolcu listesinin o kadar kopyasının veritabanına yazılması demek.
# 12 kopya, liste büyüyünce ücretsiz sunucuda kaydetmeyi yavaşlatıp şişiriyordu.
MAX_IMPORT_SNAPSHOTS = int(os.environ.get("GATEVISA_MAX_IMPORT_SNAPSHOTS", "2"))
