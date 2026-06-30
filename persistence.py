from __future__ import annotations

import json
import os

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


def _build_payload(df: pd.DataFrame, loaded_files: list[str] | None) -> dict:
    safe_df = df.fillna("").astype(str) if not df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    return {
        "passengers": safe_df.to_dict(orient="records"),
        "loaded_files": list(loaded_files or []),
    }


def _payload_to_state(payload: dict) -> tuple[pd.DataFrame, list[str]]:
    empty = pd.DataFrame(columns=ALL_COLUMNS)
    records = payload.get("passengers", []) if payload else []
    loaded_files = payload.get("loaded_files", []) if payload else []
    df = pd.DataFrame(records)
    if df.empty:
        return empty, list(loaded_files)
    return normalize_passenger_dataframe(df), list(loaded_files)


def save_store(df: pd.DataFrame, loaded_files: list[str] | None = None) -> None:
    """Yolcu tablosunu kaydeder: önce veritabanı, yoksa yerel dosya."""
    payload = _build_payload(df, loaded_files)

    if db.enabled() and db.save_state(payload):
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


def load_store() -> tuple[pd.DataFrame, list[str]]:
    """Yolcu tablosunu yükler: önce veritabanı, yoksa yerel dosya."""
    empty = pd.DataFrame(columns=ALL_COLUMNS)

    if db.enabled():
        payload = db.load_state()
        if payload is not None:
            return _payload_to_state(payload)

    if not os.path.exists(STORE_PATH):
        return empty, []
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return _payload_to_state(payload)
    except Exception:
        return empty, []
