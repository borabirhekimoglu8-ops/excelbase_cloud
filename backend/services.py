from __future__ import annotations

import os
import sys
from typing import Iterable

import pandas as pd

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from gate_visa_reader import read_gate_visa_file_bytes  # noqa: E402
from operation_helpers import apply_filters, summarize_group  # noqa: E402
from passenger_schema import (  # noqa: E402
    ALL_COLUMNS,
    gate_visa_results_to_passengers,
    normalize_passenger_dataframe,
    validate_passenger_rows,
)
from persistence import load_store, save_store  # noqa: E402

from .models import OperationSummary, PassengerRecord


def _text(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def dataframe_to_records(df: pd.DataFrame) -> list[PassengerRecord]:
    normalized = normalize_passenger_dataframe(df) if not df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    records: list[PassengerRecord] = []
    for _, row in normalized.iterrows():
        records.append(
            PassengerRecord(
                no=_text(row.get("No")),
                first_name=_text(row.get("Ad")),
                last_name=_text(row.get("Soyad")),
                full_name=_text(row.get("Yolcu Adı Soyadı")),
                passport_no=_text(row.get("Pasaport No")),
                voucher=_text(row.get("Voucher")),
                departure_date=_text(row.get("Gidiş Tarihi")),
                arrival_date=_text(row.get("Varış Tarihi")),
                adult_fee=_text(row.get("Vize Ücreti Yetişkin")),
                child_fee=_text(row.get("Vize Ücreti Çocuk")),
                source_file=_text(row.get("Kaynak Dosya")),
                sheet=_text(row.get("Sayfa")),
                photo=_text(row.get("Foto")),
            )
        )
    return records


def load_state() -> tuple[pd.DataFrame, list[str], dict]:
    return load_store()


def get_passengers(search: str = "") -> list[PassengerRecord]:
    df, _, _ = load_state()
    if search:
        df = apply_filters(df, search, {})
    return dataframe_to_records(df)


def get_summary() -> OperationSummary:
    df, loaded_files, _ = load_state()
    summary = summarize_group(df)
    total = int(summary["count"])
    with_photo = int(summary["with_photo"])
    missing_photo = int(df["Foto"].astype(str).str.strip().eq("").sum()) if "Foto" in df else total
    missing_passport = int(df["Pasaport No"].astype(str).str.strip().eq("").sum()) if "Pasaport No" in df else total
    missing_voucher = int(df["Voucher"].astype(str).str.strip().eq("").sum()) if "Voucher" in df else total
    readiness_units = max(total * 3, 1)
    completed_units = (total - missing_photo) + (total - missing_passport) + (total - missing_voucher)
    readiness = int(round((completed_units / readiness_units) * 100)) if total else 0
    return OperationSummary(
        passenger_count=total,
        adult_total=float(summary["adult_total"]),
        child_total=float(summary["child_total"]),
        total_fee=float(summary["total"]),
        with_photo=with_photo,
        missing_photo=missing_photo,
        missing_passport=missing_passport,
        missing_voucher=missing_voucher,
        readiness_percent=readiness,
        loaded_files=list(loaded_files),
    )


def import_gate_visa_files(files: Iterable[tuple[str, bytes]], replace: bool = False) -> tuple[int, list[str], list[str]]:
    all_results = []
    loaded_names: list[str] = []
    for filename, data in files:
        loaded_names.append(filename)
        results = read_gate_visa_file_bytes(filename, data)
        all_results.extend(results)

    imported_df = gate_visa_results_to_passengers(all_results)
    warnings = validate_passenger_rows(imported_df)
    current_df, current_loaded, extra = load_state()

    if replace or current_df.empty:
        next_df = imported_df
        next_loaded = loaded_names
    else:
        next_df = normalize_passenger_dataframe(pd.concat([current_df, imported_df], ignore_index=True))
        next_loaded = list(dict.fromkeys([*current_loaded, *loaded_names]))

    save_store(next_df, next_loaded, extra=extra)
    return len(imported_df), warnings, next_loaded
