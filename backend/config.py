from __future__ import annotations

import os


def allowed_origins() -> list[str]:
    raw = os.environ.get("GATEVISA_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    return [item.strip() for item in raw.split(",") if item.strip()]


def api_key() -> str:
    return os.environ.get("GATEVISA_API_KEY", "").strip()


# Kullaniciya gorunen dosya adedi siniri yoktur. Kaynak tuketimini dosya adedi
# yerine dosya basina boyut ve istemci tarafindaki sirali kuyruk kontrol eder.
# Pozitif bir deger ancak acil durum operasyonel freni olarak kullanilabilir.
MAX_UPLOAD_FILES = int(os.environ.get("GATEVISA_MAX_UPLOAD_FILES", "0"))
MAX_UPLOAD_BYTES = int(os.environ.get("GATEVISA_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
ALLOWED_IMPORT_EXTENSIONS = {".xlsx", ".xls", ".xlsm", ".ods", ".csv"}

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
