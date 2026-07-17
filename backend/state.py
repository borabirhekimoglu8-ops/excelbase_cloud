from __future__ import annotations

import functools
import os
import sys
import threading
from datetime import datetime, timedelta

import pandas as pd

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from operation_helpers import (  # noqa: E402
    cell_text,
    parse_amount,
    parse_date_value,
    summarize_group,
)
from passenger_schema import (  # noqa: E402
    ALL_COLUMNS,
    normalize_passenger_dataframe,
)
from persistence import load_store, save_store  # noqa: E402
from photo_store import _norm_key  # noqa: E402

APP_VERSION = "7.4.0"

# Durum tek JSON blob olarak yükle-değiştir-kaydet döngüsüyle güncellenir.
# Arka plan aktarım işleyicisi eklendiğinden bu döngüler artık gerçekten
# eşzamanlı çalışabilir; kilit olmadan iki eşzamanlı kayıt birbirinin
# değişikliğini (örn. içeri alınmış yolcuları) sessizce silebilir.
MUTATION_LOCK = threading.RLock()


def locked_mutation(fn):
    """Yükle-değiştir-kaydet yapan fonksiyonları tek küresel kilitle sıralar."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with MUTATION_LOCK:
            return fn(*args, **kwargs)

    return wrapper


def load_state() -> tuple[pd.DataFrame, list[str], dict]:
    """Kalıcı durumu yükler (df, loaded_files, extra)."""
    df, loaded_files, extra = load_store()
    df = normalize_passenger_dataframe(df) if not df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    if "import_history" not in extra:
        extra["import_history"] = []
    if "date_meta" not in extra:
        extra["date_meta"] = {}
    return df, list(loaded_files), extra


def save_state(df: pd.DataFrame, loaded_files: list[str], extra: dict) -> pd.DataFrame:
    normalized = normalize_passenger_dataframe(df) if not df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    save_store(normalized, loaded_files, extra=extra)
    return normalized


def passenger_identity_key(passport: object, departure_date: object) -> str:
    """Ayni yolcuyu ayni sefer gununde tanimlayan kararlı anahtar."""
    passport_key = _norm_key(passport)
    if not passport_key:
        return ""
    parsed = parse_date_value(departure_date)
    date_key = parsed.isoformat() if parsed else cell_text(departure_date)
    return f"{passport_key}|{date_key}"


def passenger_identity_keys(df: pd.DataFrame) -> pd.Series:
    if df.empty:
        return pd.Series(dtype="object")
    return df.apply(
        lambda row: passenger_identity_key(row.get("Pasaport No"), row.get("Gidiş Tarihi")),
        axis=1,
    )


def duplicate_passport_keys(df: pd.DataFrame) -> set[str]:
    if df.empty or "Pasaport No" not in df.columns:
        return set()
    identities = passenger_identity_keys(df)
    return set(identities[identities.ne("") & identities.duplicated(keep=False)])


def row_issues(row: pd.Series, dup_keys: set[str]) -> list[str]:
    issues: list[str] = []
    if not cell_text(row.get("Foto")):
        issues.append("Foto yok")
    if not cell_text(row.get("Pasaport No")):
        issues.append("Pasaport yok")
    if not cell_text(row.get("Voucher")):
        issues.append("Voucher yok")
    if not cell_text(row.get("Vize Ücreti Yetişkin")) and not cell_text(row.get("Vize Ücreti Çocuk")):
        issues.append("Ücret yok")
    identity = passenger_identity_key(row.get("Pasaport No"), row.get("Gidiş Tarihi"))
    if identity and identity in dup_keys:
        issues.append("Tekrarlı")
    if not cell_text(row.get("Yolcu Adı Soyadı")):
        issues.append("İsim yok")
    departure = parse_date_value(row.get("Gidiş Tarihi"))
    arrival = parse_date_value(row.get("Varış Tarihi"))
    if departure and arrival and arrival < departure:
        issues.append("Tarih hatalı")
    passport = _norm_key(row.get("Pasaport No"))
    if passport and len(passport) < 6:
        issues.append("Pasaport formatı")
    return issues


def readiness_metrics(df: pd.DataFrame) -> dict:
    total = len(df)
    if total == 0:
        return {
            "pct": 0,
            "total": 0,
            "photo_missing": 0,
            "passport_missing": 0,
            "voucher_missing": 0,
            "fee_missing": 0,
            "duplicates": 0,
        }
    photo_missing = int(df["Foto"].astype(str).str.strip().eq("").sum())
    passport_missing = int(df["Pasaport No"].astype(str).str.strip().eq("").sum())
    voucher_missing = int(df["Voucher"].astype(str).str.strip().eq("").sum())
    adult = df["Vize Ücreti Yetişkin"].astype(str).str.strip()
    child = df["Vize Ücreti Çocuk"].astype(str).str.strip()
    fee_missing = int((adult.eq("") & child.eq("")).sum())
    identities = passenger_identity_keys(df)
    duplicates = int(identities[identities.ne("") & identities.duplicated(keep=False)].count())

    photo_ok = total - photo_missing
    passport_ok = total - passport_missing - duplicates
    voucher_ok = total - voucher_missing
    fee_ok = total - fee_missing
    pct = round(max(0, (photo_ok + max(0, passport_ok) + voucher_ok + fee_ok) / (total * 4) * 100))
    return {
        "pct": int(pct),
        "total": total,
        "photo_missing": photo_missing,
        "passport_missing": passport_missing,
        "voucher_missing": voucher_missing,
        "fee_missing": fee_missing,
        "duplicates": duplicates,
    }


def issue_counts(df: pd.DataFrame) -> dict[str, int]:
    if df.empty:
        return {
            "Fotosuz": 0,
            "Pasaportsuz": 0,
            "Voucher eksik": 0,
            "Ücretsiz": 0,
            "Tekrarlı": 0,
            "İsim eksik": 0,
            "Tarih hatası": 0,
        }
    dup = duplicate_passport_keys(df)
    adult = df["Vize Ücreti Yetişkin"].astype(str).str.strip()
    child = df["Vize Ücreti Çocuk"].astype(str).str.strip()
    return {
        "Fotosuz": int(df["Foto"].astype(str).str.strip().eq("").sum()),
        "Pasaportsuz": int(df["Pasaport No"].astype(str).str.strip().eq("").sum()),
        "Voucher eksik": int(df["Voucher"].astype(str).str.strip().eq("").sum()),
        "Ücretsiz": int((adult.eq("") & child.eq("")).sum()),
        "Tekrarlı": int(passenger_identity_keys(df).isin(dup).sum()),
        "İsim eksik": int(df["Yolcu Adı Soyadı"].astype(str).str.strip().eq("").sum()),
        "Tarih hatası": int(
            df.apply(
                lambda row: bool(
                    parse_date_value(row.get("Gidiş Tarihi"))
                    and parse_date_value(row.get("Varış Tarihi"))
                    and parse_date_value(row.get("Varış Tarihi"))
                    < parse_date_value(row.get("Gidiş Tarihi"))
                ),
                axis=1,
            ).sum()
        ),
    }


def today_departures(df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    today = datetime.now().date()
    return int(df["Gidiş Tarihi"].map(lambda v: parse_date_value(v) == today).sum())


def quick_range_bounds(choice: str):
    today = datetime.now().date()
    if choice == "Bugün":
        return today, today
    if choice == "Bu hafta":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if choice == "Bu ay":
        start = today.replace(day=1)
        if start.month == 12:
            nxt = start.replace(year=start.year + 1, month=1)
        else:
            nxt = start.replace(month=start.month + 1)
        return start, nxt - timedelta(days=1)
    return None
