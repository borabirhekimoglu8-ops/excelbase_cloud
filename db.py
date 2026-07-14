from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone

logger = logging.getLogger(__name__)


class DatabaseUnavailableError(RuntimeError):
    """A configured database could not safely serve a small-state operation."""

try:
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import Engine
except Exception:  # SQLAlchemy yoksa DB devre dışı, dosya yedeği kullanılır.
    create_engine = None  # type: ignore
    text = None  # type: ignore
    Engine = None  # type: ignore


def _read_database_url() -> str | None:
    """DATABASE_URL'i ortam değişkeninden veya Streamlit secrets'tan okur."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        try:
            import streamlit as st

            if "DATABASE_URL" in st.secrets:
                url = str(st.secrets["DATABASE_URL"])
            elif "database" in st.secrets and "url" in st.secrets["database"]:
                url = str(st.secrets["database"]["url"])
        except Exception:
            url = None
    if not url:
        return None
    # Supabase/Heroku stili "postgres://" -> SQLAlchemy "postgresql://"
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


def database_configured() -> bool:
    """Return whether a durable database was explicitly configured.

    This is intentionally separate from :func:`enabled`: a transiently
    unreachable configured database must not be mistaken for permission to
    create a second, local authentication state.
    """
    return bool(_read_database_url())


def configured() -> bool:
    """Short compatibility alias used by persistence/auth call sites."""
    return database_configured()


_engine: "Engine | None" = None
_init_done = False
_init_failed = False
# Geçici bağlantı hatasından sonra yeniden deneme zamanı (time.monotonic).
# Kalıcı _init_failed kilidinden farklı: DB açılışta ulaşılamasa bile süreç
# ömrü boyunca devre dışı kalmaz, kısa aralıklarla yeniden denenir.
_retry_at = 0.0
_RETRY_INTERVAL_SECONDS = 30.0
_ENGINE_LOCK = threading.Lock()


def get_engine() -> "Engine | None":
    global _engine, _init_done, _init_failed, _retry_at
    if _engine is not None or _init_failed:
        return _engine
    if time.monotonic() < _retry_at:
        return None
    with _ENGINE_LOCK:
        if _engine is not None or _init_failed:
            return _engine
        if time.monotonic() < _retry_at:
            return None
        if create_engine is None:
            _init_failed = True
            return None
        url = _read_database_url()
        if not url:
            _init_failed = True
            return None
        try:
            connect_args: dict = {}
            # Bare "postgresql://" -> saf-Python pg8000 sürücüsü (Streamlit Cloud'da
            # derleme gerektirmez). Kullanıcı sürücü belirtmişse (örn. +psycopg2) dokunma.
            if url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+pg8000://", 1)
            if "+pg8000" in url:
                # Supabase vb. barındırılan DB'ler için TLS gerekir. Varsayılan güvenli
                # doğrulamadır; sadece eski/özel ortamlarda açıkça gevşetilebilir.
                try:
                    import ssl

                    ctx = ssl.create_default_context()
                    if os.environ.get("APP_ENV") == "development" and os.environ.get("DATABASE_SSL_INSECURE") == "1":
                        ctx.check_hostname = False
                        ctx.verify_mode = ssl.CERT_NONE
                    connect_args = {"ssl_context": ctx}
                except Exception:
                    connect_args = {}
            elif url.startswith("sqlite:///"):
                # SQLite dosya yolu için üst klasörü oluştur.
                sqlite_path = url.replace("sqlite:///", "", 1)
                parent = os.path.dirname(sqlite_path)
                if parent:
                    os.makedirs(parent, exist_ok=True)
            engine = create_engine(url, pool_pre_ping=True, connect_args=connect_args)
            if not _init_done:
                try:
                    _create_tables(engine)
                except Exception:
                    # Render'in dahili PostgreSQL adresi TLS sonlandirmasi yapmaz.
                    # Harici adreslerde guvenli SSL'i once dener, dahili agda ise
                    # yalnizca ilk baglanti basarisizsa SSL'siz baglantiya duseriz.
                    if not connect_args or "+pg8000" not in url:
                        raise
                    engine.dispose()
                    engine = create_engine(url, pool_pre_ping=True, connect_args={})
                    _create_tables(engine)
                _init_done = True
            _engine = engine
        except Exception:
            logger.exception(
                "Veritabanı bağlantısı kurulamadı; %.0f sn sonra yeniden denenecek",
                _RETRY_INTERVAL_SECONDS,
            )
            _engine = None
            _retry_at = time.monotonic() + _RETRY_INTERVAL_SECONDS
    return _engine


def enabled() -> bool:
    return get_engine() is not None


def _create_tables(engine: "Engine") -> None:
    # The queue payload is deliberately kept out of ``app_state`` and
    # ``documents``.  Queue state changes frequently and rewriting the complete
    # passenger JSON for every status transition was both slow and prone to
    # lost updates.  PostgreSQL and SQLite use different binary type names, but
    # SQLAlchemy can bind ``bytes`` to both without an ORM model.
    binary_type = "BYTEA" if engine.dialect.name == "postgresql" else "BLOB"
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS app_state ("
                "key VARCHAR(64) PRIMARY KEY, value TEXT)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS app_backups ("
                "snapshot_date VARCHAR(10) PRIMARY KEY, data TEXT)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS documents ("
                "ref VARCHAR(256) PRIMARY KEY, filename VARCHAR(512), "
                "mime VARCHAR(128), data TEXT)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS photos ("
                "ref VARCHAR(256) PRIMARY KEY, mime VARCHAR(64), data TEXT)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS import_jobs ("
                "id VARCHAR(128) PRIMARY KEY, "
                "parent_id VARCHAR(128), "
                "batch_id VARCHAR(128) NOT NULL, "
                "kind VARCHAR(32) NOT NULL, "
                "filename VARCHAR(512) NOT NULL, "
                "mime VARCHAR(128) NOT NULL, "
                f"payload {binary_type}, "
                "payload_size BIGINT NOT NULL DEFAULT 0, "
                "status VARCHAR(32) NOT NULL, "
                "ordinal INTEGER NOT NULL DEFAULT 0, "
                "replace_existing INTEGER NOT NULL DEFAULT 0, "
                "dup_strategy VARCHAR(32) NOT NULL DEFAULT 'skip', "
                "imported INTEGER NOT NULL DEFAULT 0, "
                "duplicates INTEGER NOT NULL DEFAULT 0, "
                "invalid INTEGER NOT NULL DEFAULT 0, "
                "total_items INTEGER NOT NULL DEFAULT 0, "
                "processed_items INTEGER NOT NULL DEFAULT 0, "
                "error_items INTEGER NOT NULL DEFAULT 0, "
                "message TEXT NOT NULL, "
                "attempts INTEGER NOT NULL DEFAULT 0, "
                "lease_owner VARCHAR(128), "
                "lease_until VARCHAR(40), "
                "created_at VARCHAR(40) NOT NULL, "
                "updated_at VARCHAR(40) NOT NULL, "
                "started_at VARCHAR(40), "
                "finished_at VARCHAR(40), "
                "FOREIGN KEY(parent_id) REFERENCES import_jobs(id) ON DELETE CASCADE)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_import_jobs_claim "
                "ON import_jobs(status, lease_until, created_at, ordinal)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_import_jobs_parent "
                "ON import_jobs(parent_id, ordinal)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS audit_events ("
                "id VARCHAR(128) PRIMARY KEY, "
                "occurred_at VARCHAR(40) NOT NULL, "
                "actor VARCHAR(256) NOT NULL, "
                "role VARCHAR(64) NOT NULL, "
                "action VARCHAR(32) NOT NULL, "
                "path VARCHAR(1024) NOT NULL)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_audit_events_time "
                "ON audit_events(occurred_at DESC)"
            )
        )


def save_state(payload: dict) -> bool:
    engine = get_engine()
    if engine is None:
        return False
    value = ""
    try:
        value = json.dumps(payload, ensure_ascii=False)
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM app_state WHERE key = 'passengers'"))
            conn.execute(
                text("INSERT INTO app_state (key, value) VALUES ('passengers', :v)"),
                {"v": value},
            )
        return True
    except Exception:
        logger.exception("Yolcu durumu veritabanına yazılamadı (payload %d karakter)", len(value))
        return False


def probe_write() -> bool:
    """Veritabanına gerçekten yazılabildiğini küçük bir kayıtla doğrular."""
    engine = get_engine()
    if engine is None:
        return False
    try:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM app_state WHERE key = 'health-probe'"))
            conn.execute(
                text("INSERT INTO app_state (key, value) VALUES ('health-probe', :v)"),
                {"v": date.today().isoformat()},
            )
        return True
    except Exception:
        logger.exception("Veritabanı yazma sondası başarısız")
        return False


def load_state() -> dict | None:
    engine = get_engine()
    if engine is None:
        return None
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT value FROM app_state WHERE key = 'passengers'")
            ).fetchone()
        if not row or not row[0]:
            return {}
        return json.loads(row[0])
    except Exception:
        logger.exception("Yolcu durumu veritabanından okunamadı")
        return None


def load_auth_state() -> tuple[bool, dict]:
    """Load the small, dedicated authentication state.

    The boolean distinguishes a missing row (which needs one-time migration)
    from an existing but intentionally empty state.  Database failures raise a
    typed exception so callers can fail closed instead of silently treating an
    outage as first-run setup.
    """
    engine = get_engine()
    if engine is None:
        raise DatabaseUnavailableError("Veritabanı bağlantısı kullanılamıyor.")
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT value FROM app_state WHERE key = 'auth'")
            ).fetchone()
        if not row:
            return False, {}
        decoded = json.loads(str(row[0] or "{}"))
        if not isinstance(decoded, dict):
            raise ValueError("auth state bir JSON nesnesi değil")
        return True, dict(decoded)
    except DatabaseUnavailableError:
        raise
    except Exception as exc:
        logger.exception("Kimlik doğrulama durumu veritabanından okunamadı")
        raise DatabaseUnavailableError("Kimlik doğrulama verisi okunamadı.") from exc


def save_auth_state(payload: dict) -> bool:
    """Upsert authentication data without touching the passenger JSON blob."""
    engine = get_engine()
    if engine is None:
        raise DatabaseUnavailableError("Veritabanı bağlantısı kullanılamıyor.")
    try:
        value = json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":"))
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO app_state (key, value) VALUES ('auth', :value) "
                    "ON CONFLICT (key) DO UPDATE SET value = :value"
                ),
                {"value": value},
            )
        return True
    except Exception as exc:
        logger.exception("Kimlik doğrulama durumu veritabanına yazılamadı")
        raise DatabaseUnavailableError("Kimlik doğrulama verisi yazılamadı.") from exc


def initialize_auth_state(payload: dict) -> dict:
    """Create the small auth row once and return the authoritative value.

    Lazy migration can race with another request or worker.  ``DO NOTHING``
    prevents a late legacy read from overwriting credentials that were already
    initialized by the winner.
    """
    engine = get_engine()
    if engine is None:
        raise DatabaseUnavailableError("Veritabanı bağlantısı kullanılamıyor.")
    try:
        value = json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":"))
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO app_state (key, value) VALUES ('auth', :value) "
                    "ON CONFLICT (key) DO NOTHING"
                ),
                {"value": value},
            )
            row = conn.execute(
                text("SELECT value FROM app_state WHERE key = 'auth'")
            ).fetchone()
        decoded = json.loads(str(row[0] if row else "{}"))
        if not isinstance(decoded, dict):
            raise ValueError("auth state bir JSON nesnesi değil")
        return dict(decoded)
    except Exception as exc:
        logger.exception("Kimlik doğrulama durumu başlatılamadı")
        raise DatabaseUnavailableError("Kimlik doğrulama verisi başlatılamadı.") from exc


def compare_and_swap_auth_state(expected: dict, payload: dict) -> bool:
    """Replace auth data only if no other worker changed it since the read."""
    engine = get_engine()
    if engine is None:
        raise DatabaseUnavailableError("Veritabanı bağlantısı kullanılamıyor.")
    try:
        lock_suffix = " FOR UPDATE" if engine.dialect.name == "postgresql" else ""
        with engine.begin() as conn:
            row = conn.execute(
                text(f"SELECT value FROM app_state WHERE key = 'auth'{lock_suffix}")
            ).fetchone()
            if not row:
                return False
            current = json.loads(str(row[0] or "{}"))
            if not isinstance(current, dict) or current != dict(expected):
                return False
            value = json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":"))
            result = conn.execute(
                text("UPDATE app_state SET value = :value WHERE key = 'auth'"),
                {"value": value},
            )
        return bool(result.rowcount)
    except Exception as exc:
        logger.exception("Kimlik doğrulama durumu atomik güncellenemedi")
        raise DatabaseUnavailableError("Kimlik doğrulama verisi güncellenemedi.") from exc


def _backup_cipher():
    secret = os.environ.get("GATEVISA_DATA_SECRET", "").strip()
    if not secret:
        return None
    try:
        from cryptography.fernet import Fernet

        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
        return Fernet(key)
    except Exception:
        return None


def save_daily_backup(payload: dict) -> bool:
    """Gunun son durumunu sifreli olarak saklar ve son 30 gunu korur."""
    engine = get_engine()
    cipher = _backup_cipher()
    if engine is None or cipher is None:
        return False
    try:
        snapshot_date = date.today().isoformat()
        token = cipher.encrypt(json.dumps(payload, ensure_ascii=False).encode("utf-8")).decode("ascii")
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM app_backups WHERE snapshot_date = :d"), {"d": snapshot_date})
            conn.execute(
                text("INSERT INTO app_backups (snapshot_date, data) VALUES (:d, :v)"),
                {"d": snapshot_date, "v": token},
            )
            rows = conn.execute(
                text("SELECT snapshot_date FROM app_backups ORDER BY snapshot_date DESC")
            ).fetchall()
            for row in rows[30:]:
                conn.execute(text("DELETE FROM app_backups WHERE snapshot_date = :d"), {"d": row[0]})
        return True
    except Exception:
        logger.exception("Günlük yedek veritabanına yazılamadı")
        return False


def list_daily_backups() -> list[str]:
    engine = get_engine()
    if engine is None:
        return []
    try:
        with engine.begin() as conn:
            rows = conn.execute(
                text("SELECT snapshot_date FROM app_backups ORDER BY snapshot_date DESC")
            ).fetchall()
        return [str(row[0]) for row in rows]
    except Exception:
        return []


def load_daily_backup(snapshot_date: str) -> dict | None:
    engine = get_engine()
    cipher = _backup_cipher()
    if engine is None or cipher is None:
        return None
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT data FROM app_backups WHERE snapshot_date = :d"),
                {"d": snapshot_date},
            ).fetchone()
        if not row:
            return None
        return json.loads(cipher.decrypt(str(row[0]).encode("ascii")).decode("utf-8"))
    except Exception:
        return None


def save_photo(ref: str, mime: str, data_bytes: bytes) -> bool:
    engine = get_engine()
    if engine is None:
        return False
    try:
        encoded = base64.b64encode(data_bytes).decode("ascii")
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM photos WHERE ref = :r"), {"r": ref})
            conn.execute(
                text("INSERT INTO photos (ref, mime, data) VALUES (:r, :m, :d)"),
                {"r": ref, "m": mime, "d": encoded},
            )
        return True
    except Exception:
        return False


def load_photo(ref: str) -> tuple[str, str] | None:
    """Dönüş: (mime, base64) veya None."""
    engine = get_engine()
    if engine is None:
        return None
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT mime, data FROM photos WHERE ref = :r"), {"r": ref}
            ).fetchone()
        if not row:
            return None
        return str(row[0]), str(row[1])
    except Exception:
        return None


def save_document(ref: str, filename: str, mime: str, data_bytes: bytes) -> bool:
    engine = get_engine()
    if engine is None:
        return False
    try:
        encoded = base64.b64encode(data_bytes).decode("ascii")
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM documents WHERE ref = :r"), {"r": ref})
            conn.execute(
                text("INSERT INTO documents (ref, filename, mime, data) VALUES (:r, :f, :m, :d)"),
                {"r": ref, "f": filename, "m": mime, "d": encoded},
            )
        return True
    except Exception:
        logger.exception("Belge veritabanına yazılamadı: %s", ref)
        return False


def load_document(ref: str) -> bytes | None:
    engine = get_engine()
    if engine is None:
        return None
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT data FROM documents WHERE ref = :r"), {"r": ref}
            ).fetchone()
        if not row or not row[0]:
            return None
        return base64.b64decode(str(row[0]).encode("ascii"))
    except Exception:
        logger.exception("Belge veritabanından okunamadı: %s", ref)
        return None


def delete_document(ref: str) -> bool:
    engine = get_engine()
    if engine is None:
        return False
    try:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM documents WHERE ref = :r"), {"r": ref})
        return True
    except Exception:
        logger.exception("Belge veritabanından silinemedi: %s", ref)
        return False


# ---------------------------------------------------------------------------
# Durable import queue

_IMPORT_JOB_PUBLIC_COLUMNS = (
    "id, parent_id, batch_id, kind, filename, mime, payload_size, status, "
    "ordinal, replace_existing, dup_strategy, imported, duplicates, invalid, "
    "total_items, processed_items, error_items, message, attempts, "
    "lease_owner, lease_until, created_at, updated_at, started_at, finished_at"
)
_TERMINAL_IMPORT_STATUSES = {"done", "error", "cancelled"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _row_mapping(row) -> dict:
    if row is None:
        return {}
    mapping = getattr(row, "_mapping", None)
    if mapping is not None:
        return dict(mapping)
    return dict(row)


def _row_to_import_job(row, *, include_payload: bool = False) -> dict | None:
    values = _row_mapping(row)
    if not values:
        return None
    result = {
        "id": str(values.get("id") or ""),
        "parent_id": str(values.get("parent_id") or ""),
        "batch_id": str(values.get("batch_id") or ""),
        "kind": str(values.get("kind") or "file"),
        "filename": str(values.get("filename") or ""),
        "mime": str(values.get("mime") or ""),
        "payload_size": int(values.get("payload_size") or 0),
        "status": str(values.get("status") or "pending"),
        "ordinal": int(values.get("ordinal") or 0),
        # Preserve the key consumed by backend.services while avoiding a SQL
        # keyword-like column name.
        "replace": bool(values.get("replace_existing")),
        "dup_strategy": str(values.get("dup_strategy") or "skip"),
        "imported": int(values.get("imported") or 0),
        "duplicates": int(values.get("duplicates") or 0),
        "invalid": int(values.get("invalid") or 0),
        "total_items": int(values.get("total_items") or 0),
        "processed_items": int(values.get("processed_items") or 0),
        "error_items": int(values.get("error_items") or 0),
        "message": str(values.get("message") or ""),
        "attempts": int(values.get("attempts") or 0),
        "lease_owner": str(values.get("lease_owner") or ""),
        "lease_until": str(values.get("lease_until") or ""),
        "created_at": str(values.get("created_at") or ""),
        "updated_at": str(values.get("updated_at") or ""),
        "started_at": str(values.get("started_at") or ""),
        "finished_at": str(values.get("finished_at") or ""),
    }
    if include_payload:
        payload = values.get("payload")
        if isinstance(payload, memoryview):
            payload = payload.tobytes()
        result["payload"] = bytes(payload) if payload is not None else None
    return result


def _select_import_job(conn, job_id: str, *, include_payload: bool = False) -> dict | None:
    columns = "*" if include_payload else _IMPORT_JOB_PUBLIC_COLUMNS
    row = conn.execute(
        text(f"SELECT {columns} FROM import_jobs WHERE id = :id"),
        {"id": job_id},
    ).fetchone()
    return _row_to_import_job(row, include_payload=include_payload)


def _refresh_parent_progress(conn, parent_id: str, now: str) -> None:
    """Refresh counters and atomically finish a waiting archive parent."""
    if not parent_id:
        return
    # Serialize sibling completions around their shared parent.  Without this
    # lock, two PostgreSQL workers can both aggregate before either commits and
    # the last UPDATE may preserve a stale processed/error count indefinitely.
    lock_suffix = " FOR UPDATE" if conn.dialect.name == "postgresql" else ""
    parent = conn.execute(
        text(f"SELECT status FROM import_jobs WHERE id = :id{lock_suffix}"),
        {"id": parent_id},
    ).fetchone()
    if not parent:
        return
    row = conn.execute(
        text(
            "SELECT COUNT(*) AS total_items, "
            "SUM(CASE WHEN status IN ('done','error','cancelled') THEN 1 ELSE 0 END) AS processed_items, "
            "SUM(CASE WHEN status IN ('error','cancelled') THEN 1 ELSE 0 END) AS error_items, "
            "SUM(imported) AS imported, SUM(duplicates) AS duplicates, SUM(invalid) AS invalid "
            "FROM import_jobs WHERE parent_id = :parent_id"
        ),
        {"parent_id": parent_id},
    ).fetchone()
    values = _row_mapping(row)
    total_items = int(values.get("total_items") or 0)
    processed_items = int(values.get("processed_items") or 0)
    error_items = int(values.get("error_items") or 0)
    imported = int(values.get("imported") or 0)
    duplicates = int(values.get("duplicates") or 0)
    invalid = int(values.get("invalid") or 0)
    next_status = str(parent[0] or "")
    finished_at = None
    message: str | None = None
    if next_status == "waiting" and total_items > 0 and processed_items >= total_items:
        succeeded = total_items - error_items
        next_status = "done" if succeeded > 0 else "error"
        finished_at = now
        if error_items == 0:
            message = f"{total_items} dosyanın tamamı işlendi."
        elif succeeded > 0:
            message = f"{succeeded} dosya işlendi · {error_items} dosya hatalı."
        else:
            message = f"{error_items} dosyanın hiçbiri işlenemedi."
    conn.execute(
        text(
            "UPDATE import_jobs SET total_items = :total_items, "
            "processed_items = :processed_items, error_items = :error_items, "
            "imported = :imported, duplicates = :duplicates, invalid = :invalid, "
            "status = :status, message = COALESCE(:message, message), "
            "finished_at = COALESCE(:finished_at, finished_at), updated_at = :now "
            "WHERE id = :id"
        ),
        {
            "id": parent_id,
            "total_items": total_items,
            "processed_items": processed_items,
            "error_items": error_items,
            "imported": imported,
            "duplicates": duplicates,
            "invalid": invalid,
            "status": next_status,
            "message": message,
            "finished_at": finished_at,
            "now": now,
        },
    )


def _enqueue_import_jobs_with_conn(
    conn,
    files: list[tuple[str, bytes]],
    *,
    job_ids: list[str] | None,
    parent_id: str | None,
    kind: str,
    mime: str,
    batch_id: str,
    replace: bool,
    dup_strategy: str,
    start_ordinal: int,
    message: str,
) -> list[dict]:
    if job_ids is not None and len(job_ids) != len(files):
        raise ValueError("job_ids ve files aynı uzunlukta olmalıdır.")
    now = _utc_now()
    created: list[dict] = []
    for index, (filename, payload) in enumerate(files):
        if not isinstance(payload, (bytes, bytearray, memoryview)):
            raise TypeError("Aktarım işi payload değeri bytes olmalıdır.")
        data = bytes(payload)
        job_id = str(job_ids[index] if job_ids is not None else uuid.uuid4())
        params = {
            "id": job_id,
            "parent_id": parent_id or None,
            "batch_id": batch_id,
            "kind": kind,
            "filename": str(filename),
            "mime": mime,
            "payload": data,
            "payload_size": len(data),
            "status": "pending",
            "ordinal": start_ordinal + index,
            # Every row carries the batch's replace intent.  The passenger
            # merge transaction decides exactly once which job consumes it;
            # tying intent to ordinal zero breaks when that file is invalid.
            "replace_existing": 1 if replace else 0,
            "dup_strategy": dup_strategy,
            "message": message,
            "created_at": now,
            "updated_at": now,
        }
        # A caller-provided ID is an idempotency key.  The original payload and
        # state win if an HTTP retry follows or races with the first request.
        conn.execute(
            text(
                "INSERT INTO import_jobs ("
                "id, parent_id, batch_id, kind, filename, mime, payload, payload_size, "
                "status, ordinal, replace_existing, dup_strategy, message, created_at, updated_at"
                ") VALUES ("
                ":id, :parent_id, :batch_id, :kind, :filename, :mime, :payload, :payload_size, "
                ":status, :ordinal, :replace_existing, :dup_strategy, :message, :created_at, :updated_at"
                ") ON CONFLICT (id) DO NOTHING"
            ),
            params,
        )
        selected = _select_import_job(conn, job_id)
        if selected is None:
            raise RuntimeError(f"Aktarım işi oluşturulamadı: {job_id}")
        created.append(selected)
    if parent_id:
        _refresh_parent_progress(conn, parent_id, now)
    return created


def enqueue_import_job(
    filename: str,
    payload: bytes,
    *,
    job_id: str | None = None,
    parent_id: str | None = None,
    kind: str = "file",
    mime: str = "",
    batch_id: str = "",
    ordinal: int = 0,
    replace: bool = False,
    dup_strategy: str = "skip",
    message: str = "Sırada — sunucu arka planda işleyecek.",
) -> dict | None:
    """Persist one payload and row; ``job_id`` is an idempotency key."""
    rows = enqueue_import_jobs(
        [(filename, payload)],
        job_ids=[job_id or str(uuid.uuid4())],
        parent_id=parent_id,
        kind=kind,
        mime=mime,
        batch_id=batch_id,
        replace=replace,
        dup_strategy=dup_strategy,
        start_ordinal=ordinal,
        message=message,
    )
    return rows[0] if rows else None


def enqueue_import_jobs(
    files: list[tuple[str, bytes]],
    *,
    job_ids: list[str] | None = None,
    parent_id: str | None = None,
    kind: str = "file",
    mime: str = "",
    batch_id: str = "",
    replace: bool = False,
    dup_strategy: str = "skip",
    start_ordinal: int = 0,
    message: str = "Sırada — sunucu arka planda işleyecek.",
) -> list[dict] | None:
    """Atomically persist multiple rows; no partial batch is exposed."""
    engine = get_engine()
    if engine is None:
        return None
    if not files:
        return []
    try:
        with engine.begin() as conn:
            return _enqueue_import_jobs_with_conn(
                conn,
                files,
                job_ids=job_ids,
                parent_id=parent_id,
                kind=str(kind or "file"),
                mime=str(mime or "application/octet-stream"),
                batch_id=batch_id.strip() or str(uuid.uuid4()),
                replace=bool(replace),
                dup_strategy=str(dup_strategy or "skip"),
                start_ordinal=max(0, int(start_ordinal)),
                message=str(message),
            )
    except Exception:
        logger.exception("Aktarım işleri veritabanı kuyruğuna yazılamadı")
        return None


def create_import_child_jobs(
    parent_id: str,
    files: list[tuple[str, bytes]],
    *,
    batch_id: str = "",
    replace: bool | None = None,
    dup_strategy: str | None = None,
) -> list[dict] | None:
    """Create archive members transactionally with deterministic child IDs."""
    engine = get_engine()
    if engine is None:
        return None
    try:
        with engine.begin() as conn:
            parent = _select_import_job(conn, parent_id)
            if parent is None:
                return None
            row = conn.execute(
                text("SELECT COALESCE(MAX(ordinal), -1) FROM import_jobs WHERE parent_id = :id"),
                {"id": parent_id},
            ).fetchone()
            start_ordinal = int(row[0] if row and row[0] is not None else -1) + 1
            ids = [
                str(uuid.uuid5(uuid.NAMESPACE_URL, f"excelbase:{parent_id}:{start_ordinal + i}:{name}"))
                for i, (name, _) in enumerate(files)
            ]
            return _enqueue_import_jobs_with_conn(
                conn,
                files,
                job_ids=ids,
                parent_id=parent_id,
                kind="file",
                mime="application/octet-stream",
                batch_id=batch_id.strip() or parent["batch_id"],
                replace=parent["replace"] if replace is None else bool(replace),
                dup_strategy=dup_strategy or parent["dup_strategy"],
                start_ordinal=start_ordinal,
                message="Sırada — arşivden çıkarıldı.",
            )
    except Exception:
        logger.exception("Arşiv alt işleri veritabanı kuyruğuna yazılamadı: %s", parent_id)
        return None


def get_import_job(job_id: str, include_payload: bool = False) -> dict | None:
    engine = get_engine()
    if engine is None:
        return None
    try:
        with engine.begin() as conn:
            return _select_import_job(conn, job_id, include_payload=include_payload)
    except Exception:
        logger.exception("Aktarım işi okunamadı: %s", job_id)
        return None


def list_import_jobs(
    limit: int | None = 500,
    parent_id: str | None = None,
    include_parents: bool = True,
) -> list[dict] | None:
    engine = get_engine()
    if engine is None:
        return None
    clauses: list[str] = []
    params: dict = {}
    if parent_id is not None:
        clauses.append("parent_id = :parent_id")
        params["parent_id"] = parent_id
    elif not include_parents:
        clauses.append("parent_id IS NOT NULL")
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    limit_sql = ""
    if limit is not None and int(limit) > 0:
        params["limit"] = max(1, min(int(limit), 5000))
        limit_sql = " LIMIT :limit"
    try:
        with engine.begin() as conn:
            rows = conn.execute(
                text(
                    f"SELECT {_IMPORT_JOB_PUBLIC_COLUMNS} FROM import_jobs{where} "
                    f"ORDER BY created_at DESC, ordinal ASC, id ASC{limit_sql}"
                ),
                params,
            ).fetchall()
        return [job for row in rows if (job := _row_to_import_job(row)) is not None]
    except Exception:
        logger.exception("Aktarım kuyruğu listelenemedi")
        return None


def load_import_job_payload(job_id: str) -> bytes | None:
    job = get_import_job(job_id, include_payload=True)
    if not job:
        return None
    return job.get("payload")


def claim_next_import_job(worker_id: str, lease_seconds: int = 300) -> dict | None:
    """Atomically lease the oldest pending row to one worker.

    PostgreSQL uses ``FOR UPDATE SKIP LOCKED`` for concurrent Render workers;
    SQLite/generic engines use a conditional update as a CAS fallback.
    """
    engine = get_engine()
    if engine is None:
        raise DatabaseUnavailableError("Aktarım kuyruğu veritabanı kullanılamıyor.")
    now = _utc_now()
    lease_until = (
        datetime.now(timezone.utc) + timedelta(seconds=max(1, int(lease_seconds)))
    ).isoformat(timespec="microseconds")
    owner = str(worker_id or "worker")[:128]
    try:
        with engine.begin() as conn:
            if engine.dialect.name == "postgresql":
                row = conn.execute(
                    text(
                        "WITH candidate AS ("
                        " SELECT id FROM import_jobs"
                        " WHERE status = 'pending' AND (lease_until IS NULL OR lease_until < :now)"
                        " ORDER BY created_at ASC, ordinal ASC, id ASC"
                        " FOR UPDATE SKIP LOCKED LIMIT 1"
                        ") UPDATE import_jobs AS job SET "
                        "status = 'processing', message = :message, attempts = job.attempts + 1, "
                        "lease_owner = :owner, lease_until = :lease_until, "
                        "started_at = COALESCE(job.started_at, :now), updated_at = :now "
                        "FROM candidate WHERE job.id = candidate.id RETURNING job.*"
                    ),
                    {
                        "now": now,
                        "lease_until": lease_until,
                        "owner": owner,
                        "message": "İşleniyor…",
                    },
                ).fetchone()
                return _row_to_import_job(row, include_payload=True)

            for _ in range(3):
                candidate = conn.execute(
                    text(
                        "SELECT id FROM import_jobs WHERE status = 'pending' "
                        "AND (lease_until IS NULL OR lease_until < :now) "
                        "ORDER BY created_at ASC, ordinal ASC, id ASC LIMIT 1"
                    ),
                    {"now": now},
                ).fetchone()
                if not candidate:
                    return None
                result = conn.execute(
                    text(
                        "UPDATE import_jobs SET status = 'processing', message = :message, "
                        "attempts = attempts + 1, lease_owner = :owner, lease_until = :lease_until, "
                        "started_at = COALESCE(started_at, :now), updated_at = :now "
                        "WHERE id = :id AND status = 'pending' "
                        "AND (lease_until IS NULL OR lease_until < :now)"
                    ),
                    {
                        "id": str(candidate[0]),
                        "now": now,
                        "lease_until": lease_until,
                        "owner": owner,
                        "message": "İşleniyor…",
                    },
                )
                if result.rowcount:
                    return _select_import_job(conn, str(candidate[0]), include_payload=True)
            return None
    except DatabaseUnavailableError:
        raise
    except Exception as exc:
        logger.exception("Aktarım kuyruğundan iş alınamadı")
        raise DatabaseUnavailableError("Aktarım kuyruğundan iş alınamadı.") from exc


def has_pending_import_jobs() -> bool | None:
    engine = get_engine()
    if engine is None:
        return None
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT 1 FROM import_jobs WHERE status = 'pending' LIMIT 1")
            ).fetchone()
        return bool(row)
    except Exception:
        logger.exception("Aktarım kuyruğu bekleyen iş kontrolü başarısız")
        return None


def has_active_import_jobs() -> bool | None:
    """Check all statuses that keep an upload visible as in progress."""
    engine = get_engine()
    if engine is None:
        return None
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    "SELECT 1 FROM import_jobs "
                    "WHERE status IN ('pending','processing','waiting') LIMIT 1"
                )
            ).fetchone()
        return bool(row)
    except Exception:
        logger.exception("Aktarım kuyruğu etkin iş kontrolü başarısız")
        return None


def recover_expired_import_jobs(force: bool = False) -> int:
    """Return abandoned leases to pending.

    ``force=True`` is for single-worker process startup, where every previous
    processing owner is known to be dead. Runtime recovery keeps live leases.
    """
    engine = get_engine()
    if engine is None:
        return 0
    now = _utc_now()
    lease_clause = "" if force else " AND (lease_until IS NULL OR lease_until < :now)"
    try:
        with engine.begin() as conn:
            result = conn.execute(
                text(
                    "UPDATE import_jobs SET status = 'pending', "
                    "message = :message, lease_owner = NULL, lease_until = NULL, updated_at = :now "
                    f"WHERE status = 'processing'{lease_clause}"
                ),
                {
                    "now": now,
                    "message": "İşleyici bağlantısı kesildi; iş kuyruğa iade edildi.",
                },
            )
        return int(result.rowcount or 0)
    except Exception:
        logger.exception("Süresi dolan aktarım işleri kurtarılamadı")
        return 0


def finish_import_job(
    job_id: str,
    status: str,
    *,
    message: str = "",
    imported: int = 0,
    duplicates: int = 0,
    invalid: int = 0,
    worker_id: str | None = None,
    delete_payload: bool = False,
) -> bool:
    engine = get_engine()
    if engine is None:
        return False
    now = _utc_now()
    terminal = status in _TERMINAL_IMPORT_STATUSES
    owner_clause = " AND (lease_owner = :worker_id OR lease_owner IS NULL)" if worker_id else ""
    try:
        with engine.begin() as conn:
            current = _select_import_job(conn, job_id)
            if current is None:
                return False
            result = conn.execute(
                text(
                    "UPDATE import_jobs SET status = :status, message = :message, "
                    "imported = :imported, duplicates = :duplicates, invalid = :invalid, "
                    "lease_owner = NULL, lease_until = NULL, updated_at = :now, "
                    "finished_at = :finished_at, "
                    "payload = CASE WHEN :delete_payload = 1 THEN NULL ELSE payload END, "
                    "payload_size = CASE WHEN :delete_payload = 1 THEN 0 ELSE payload_size END "
                    f"WHERE id = :id{owner_clause}"
                ),
                {
                    "id": job_id,
                    "status": str(status),
                    "message": str(message),
                    "imported": max(0, int(imported)),
                    "duplicates": max(0, int(duplicates)),
                    "invalid": max(0, int(invalid)),
                    "now": now,
                    "finished_at": now if terminal else None,
                    "delete_payload": 1 if delete_payload else 0,
                    "worker_id": worker_id,
                },
            )
            if not result.rowcount:
                return False
            if current["parent_id"]:
                _refresh_parent_progress(conn, current["parent_id"], now)
            if status == "waiting":
                _refresh_parent_progress(conn, job_id, now)
        return True
    except Exception:
        logger.exception("Aktarım işi tamamlanamadı: %s", job_id)
        return False


def retry_import_job(job_id: str) -> bool:
    engine = get_engine()
    if engine is None:
        return False
    now = _utc_now()
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT parent_id FROM import_jobs WHERE id = :id"),
                {"id": job_id},
            ).fetchone()
            if not row:
                return False
            result = conn.execute(
                text(
                    "UPDATE import_jobs SET status = 'pending', message = :message, "
                    "imported = 0, duplicates = 0, invalid = 0, "
                    "lease_owner = NULL, lease_until = NULL, finished_at = NULL, updated_at = :now "
                    "WHERE id = :id AND status IN ('error','cancelled') AND payload IS NOT NULL"
                ),
                {"id": job_id, "now": now, "message": "Yeniden sırada."},
            )
            if result.rowcount and row[0]:
                _refresh_parent_progress(conn, str(row[0]), now)
        return bool(result.rowcount)
    except Exception:
        logger.exception("Aktarım işi yeniden sıraya alınamadı: %s", job_id)
        return False


def delete_import_job_payload(job_id: str) -> bool:
    engine = get_engine()
    if engine is None:
        return False
    try:
        with engine.begin() as conn:
            result = conn.execute(
                text("UPDATE import_jobs SET payload = NULL, payload_size = 0, updated_at = :now WHERE id = :id"),
                {"id": job_id, "now": _utc_now()},
            )
        return bool(result.rowcount)
    except Exception:
        logger.exception("Aktarım işi payload'ı silinemedi: %s", job_id)
        return False


def delete_import_job(job_id: str, include_children: bool = True) -> bool:
    engine = get_engine()
    if engine is None:
        return False
    try:
        with engine.begin() as conn:
            current = conn.execute(
                text("SELECT status, parent_id FROM import_jobs WHERE id = :id"),
                {"id": job_id},
            ).fetchone()
            if not current or str(current[0]) == "processing":
                return False
            if include_children:
                active_child = conn.execute(
                    text(
                        "SELECT 1 FROM import_jobs WHERE parent_id = :id "
                        "AND status = 'processing' LIMIT 1"
                    ),
                    {"id": job_id},
                ).fetchone()
                if active_child:
                    return False
                conn.execute(text("DELETE FROM import_jobs WHERE parent_id = :id"), {"id": job_id})
            result = conn.execute(text("DELETE FROM import_jobs WHERE id = :id"), {"id": job_id})
            if result.rowcount and current[1]:
                _refresh_parent_progress(conn, str(current[1]), _utc_now())
        return bool(result.rowcount)
    except Exception:
        logger.exception("Aktarım işi silinemedi: %s", job_id)
        return False


def cleanup_import_jobs(older_than_days: int = 7, max_finished: int = 200) -> int:
    """Delete old terminal rows and cap retained queue history."""
    engine = get_engine()
    if engine is None:
        return 0
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=max(0, int(older_than_days)))
    ).isoformat(timespec="seconds")
    keep = max(0, int(max_finished))
    try:
        with engine.begin() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, finished_at FROM import_jobs "
                    # Keep terminal children while their parent upload is still
                    # active.  Pruning those rows independently would make a
                    # long-running ZIP lose both progress and error details.
                    "WHERE parent_id IS NULL "
                    "AND status IN ('done','error','cancelled') "
                    "ORDER BY finished_at DESC, created_at DESC"
                )
            ).fetchall()
            targets = {
                str(row[0])
                for index, row in enumerate(rows)
                if index >= keep or (row[1] and str(row[1]) < cutoff)
            }
            removed = 0
            for target in targets:
                children = conn.execute(
                    text(
                        "DELETE FROM import_jobs WHERE parent_id = :id "
                        "AND status IN ('done','error','cancelled')"
                    ),
                    {"id": target},
                )
                removed += int(children.rowcount or 0)
                result = conn.execute(
                    text(
                        "DELETE FROM import_jobs WHERE id = :id "
                        "AND status IN ('done','error','cancelled')"
                    ),
                    {"id": target},
                )
                removed += int(result.rowcount or 0)
        return removed
    except Exception:
        logger.exception("Eski aktarım işleri temizlenemedi")
        return 0


def clear_legacy_import_job_documents() -> int:
    """Remove payloads written by the pre-table queue implementation."""
    engine = get_engine()
    if engine is None:
        return 0
    try:
        with engine.begin() as conn:
            result = conn.execute(text("DELETE FROM documents WHERE ref LIKE 'import-job://%'"))
        return int(result.rowcount or 0)
    except Exception:
        logger.exception("Eski aktarım işi belgeleri temizlenemedi")
        return 0


# ---------------------------------------------------------------------------
# Append-only audit events

def _row_to_audit_event(row) -> dict | None:
    values = _row_mapping(row)
    if not values:
        return None
    occurred_at = str(values.get("occurred_at") or "")
    return {
        "id": str(values.get("id") or ""),
        "time": occurred_at,
        "occurred_at": occurred_at,
        "actor": str(values.get("actor") or ""),
        "role": str(values.get("role") or ""),
        "action": str(values.get("action") or ""),
        "path": str(values.get("path") or ""),
    }


def insert_audit_event(
    actor: str,
    role: str,
    action: str,
    path: str,
    *,
    event_id: str | None = None,
    occurred_at: str | None = None,
) -> dict | None:
    engine = get_engine()
    if engine is None:
        return None
    resolved_id = str(event_id or uuid.uuid4())
    resolved_time = str(occurred_at or _utc_now())
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO audit_events (id, occurred_at, actor, role, action, path) "
                    "VALUES (:id, :occurred_at, :actor, :role, :action, :path) "
                    "ON CONFLICT (id) DO NOTHING"
                ),
                {
                    "id": resolved_id,
                    "occurred_at": resolved_time,
                    "actor": str(actor),
                    "role": str(role),
                    "action": str(action),
                    "path": str(path),
                },
            )
            row = conn.execute(
                text("SELECT * FROM audit_events WHERE id = :id"),
                {"id": resolved_id},
            ).fetchone()
        return _row_to_audit_event(row)
    except Exception:
        logger.exception("Denetim olayı yazılamadı")
        return None


def list_audit_events(limit: int = 100) -> list[dict]:
    engine = get_engine()
    if engine is None:
        return []
    bounded_limit = max(1, min(int(limit), 5000))
    try:
        with engine.begin() as conn:
            rows = conn.execute(
                text("SELECT * FROM audit_events ORDER BY occurred_at DESC, id DESC LIMIT :limit"),
                {"limit": bounded_limit},
            ).fetchall()
        return [event for row in rows if (event := _row_to_audit_event(row)) is not None]
    except Exception:
        logger.exception("Denetim olayları okunamadı")
        return []
