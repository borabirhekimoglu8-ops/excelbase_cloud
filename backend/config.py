from __future__ import annotations

import os


_PROCESS_ROLES = {"combined", "web", "worker"}


def process_role() -> str:
    """Return the responsibility of this process.

    ``combined`` preserves the historical single-container Render deployment.
    OCI runs ``web`` and ``worker`` as separate containers built from the same
    image.  Keeping the default backwards compatible gives us a clean rollback
    path while the new deployment is being verified.
    """

    role = os.environ.get("EXCELBASE_PROCESS_ROLE", "combined").strip().lower()
    if role not in _PROCESS_ROLES:
        expected = ", ".join(sorted(_PROCESS_ROLES))
        raise RuntimeError(
            f"EXCELBASE_PROCESS_ROLE must be one of: {expected}; got {role!r}."
        )
    return role


def embedded_import_worker_enabled() -> bool:
    """Whether this API process is allowed to start the legacy worker thread."""

    return process_role() == "combined"


def import_worker_poll_seconds() -> float:
    """Polling delay for the foreground worker when the durable queue is empty."""

    try:
        return max(0.25, float(os.environ.get("EXCELBASE_WORKER_POLL_SECONDS", "1")))
    except ValueError as exc:
        raise RuntimeError("EXCELBASE_WORKER_POLL_SECONDS must be numeric.") from exc


def import_job_lease_seconds() -> int:
    """Lease duration; a heartbeat renews it while a job is being processed."""

    try:
        return max(60, int(os.environ.get("EXCELBASE_IMPORT_LEASE_SECONDS", "180")))
    except ValueError as exc:
        raise RuntimeError("EXCELBASE_IMPORT_LEASE_SECONDS must be an integer.") from exc


def import_job_heartbeat_seconds() -> float:
    """Heartbeat interval, capped below half of the configured lease."""

    try:
        configured = max(
            5.0,
            float(os.environ.get("EXCELBASE_IMPORT_HEARTBEAT_SECONDS", "30")),
        )
    except ValueError as exc:
        raise RuntimeError("EXCELBASE_IMPORT_HEARTBEAT_SECONDS must be numeric.") from exc
    return min(configured, max(5.0, import_job_lease_seconds() / 2.0))


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
