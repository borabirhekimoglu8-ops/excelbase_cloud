from __future__ import annotations

import json
import os
import threading

import pandas as pd

import db
from passenger_schema import ALL_COLUMNS, normalize_passenger_dataframe

# Veriyi diske yazarak sayfa yenilemelerinde sıfırlanmayı önler.
# Not: Streamlit Cloud'da bu dosya container yeniden başlatılana (reboot/redeploy)
# kadar kalır ve uygulamayı açan tüm cihazlar aynı veriyi görür.
STORE_PATH = os.environ.get(
    "PAX_STORE_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".data", "passengers.json"),
)

_STORE_LOCK = threading.RLock()

_EXTRA_DEFAULTS = {
    "import_history": [],
    "date_meta": {},
    "import_batches": [],
    "audit_log": [],
    "auth": {},
    "unmatched_photos": [],
    "mail_inbox": [],
}


def _normalize_extra(extra: dict | None) -> dict:
    source = dict(extra or {})
    normalized = dict(source)
    for key, default in _EXTRA_DEFAULTS.items():
        value = source.get(key)
        if value is None:
            normalized[key] = default.copy() if hasattr(default, "copy") else default
    return normalized


def _build_payload(df: pd.DataFrame, loaded_files: list[str] | None, extra: dict | None = None) -> dict:
    safe_df = df.fillna("").astype(str) if not df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    payload = {
        "passengers": safe_df.to_dict(orient="records"),
        "loaded_files": list(loaded_files or []),
    }
    normalized_extra = _normalize_extra(extra)
    payload["extra"] = normalized_extra
    # Eski surumlerle geri uyumluluk.
    payload["import_history"] = list(normalized_extra.get("import_history", []) or [])
    payload["date_meta"] = dict(normalized_extra.get("date_meta", {}) or {})
    return payload


def _payload_to_state(payload: dict) -> tuple[pd.DataFrame, list[str], dict]:
    empty = pd.DataFrame(columns=ALL_COLUMNS)
    records = payload.get("passengers", []) if payload else []
    loaded_files = payload.get("loaded_files", []) if payload else []
    raw_extra = dict(payload.get("extra", {}) or {}) if payload else {}
    if "import_history" not in raw_extra:
        raw_extra["import_history"] = payload.get("import_history", []) if payload else []
    if "date_meta" not in raw_extra:
        raw_extra["date_meta"] = payload.get("date_meta", {}) if payload else {}
    extra = _normalize_extra(raw_extra)
    df = pd.DataFrame(records)
    if df.empty:
        return empty, list(loaded_files), extra
    return normalize_passenger_dataframe(df), list(loaded_files), extra


def save_store(df: pd.DataFrame, loaded_files: list[str] | None = None, extra: dict | None = None) -> None:
    """Yolcu tablosunu kaydeder: önce veritabanı, yoksa yerel dosya."""
    payload = _build_payload(df, loaded_files, extra)
    with _STORE_LOCK:
        if db.enabled() and db.save_state(payload):
            db.save_daily_backup(payload)
            return

        try:
            os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
            tmp_path = STORE_PATH + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False)
            os.replace(tmp_path, STORE_PATH)
        except Exception:
            # Kalıcı kayıt başarısız olsa bile uygulama çalışmaya devam etmeli.
            pass


def load_store() -> tuple[pd.DataFrame, list[str], dict]:
    """Yolcu tablosunu yükler: önce veritabanı, yoksa yerel dosya.

    Dönüş: (df, loaded_files, extra). `extra` -> import_history + date_meta.
    """
    empty = pd.DataFrame(columns=ALL_COLUMNS)
    empty_extra = _normalize_extra({})

    with _STORE_LOCK:
        if db.enabled():
            payload = db.load_state()
            if payload is not None:
                return _payload_to_state(payload)

        if not os.path.exists(STORE_PATH):
            return empty, [], empty_extra
        try:
            with open(STORE_PATH, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return _payload_to_state(payload)
        except Exception:
            return empty, [], empty_extra
