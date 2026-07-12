from __future__ import annotations

import base64
import hashlib
import json
import os
from datetime import date

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


_engine: "Engine | None" = None
_init_done = False
_init_failed = False


def get_engine() -> "Engine | None":
    global _engine, _init_done, _init_failed
    if _engine is not None or _init_failed:
        return _engine
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
            _create_tables(engine)
            _init_done = True
        _engine = engine
    except Exception:
        _engine = None
        _init_failed = True
    return _engine


def enabled() -> bool:
    return get_engine() is not None


def _create_tables(engine: "Engine") -> None:
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


def save_state(payload: dict) -> bool:
    engine = get_engine()
    if engine is None:
        return False
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
        return None


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
        return False
