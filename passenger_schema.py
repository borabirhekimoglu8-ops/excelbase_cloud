from __future__ import annotations

import pandas as pd

from gate_visa_reader import EXCEL_COLUMNS, build_gate_visa_template_xlsx
from excelbase_core import dataframe_to_xlsx

TEMPLATE_NAME = "GATE VISA PAX LIST"

# Uygulama içi standart alanlar (Excel'den dönüştürülmüş)
PASSENGER_FIELDS: list[str] = [
    "No",
    "Ad",
    "Soyad",
    "Yolcu Adı Soyadı",
    "Pasaport No",
    "Voucher",
    "Gidiş Tarihi",
    "Varış Tarihi",
    "Vize Ücreti Yetişkin",
    "Vize Ücreti Çocuk",
]

META_FIELDS: list[str] = ["Kaynak Dosya", "Sayfa", "Foto"]
ALL_COLUMNS: list[str] = PASSENGER_FIELDS + META_FIELDS

# Başlığa göre filtreleme — tüm yolcu kolonları (birleşik alan hariç)
FILTERABLE_HEADERS: list[str] = [
    "No",
    "Ad",
    "Soyad",
    "Pasaport No",
    "Voucher",
    "Gidiş Tarihi",
    "Varış Tarihi",
    "Vize Ücreti Yetişkin",
    "Vize Ücreti Çocuk",
]

CARD_TITLE_FIELD = "Yolcu Adı Soyadı"
CARD_SUBTITLE_FIELDS = ["Pasaport No", "Voucher", "Gidiş Tarihi", "Varış Tarihi"]
CARD_TAG_FIELDS = ["Gidiş Tarihi", "Varış Tarihi"]
CARD_STATUS_FIELD = ""
CARD_DATE_FIELD = "Gidiş Tarihi"

EXCEL_TO_APP: dict[str, str] = {
    "NO": "No",
    "NAME": "Ad",
    "SURNAME": "Soyad",
    "PASSPORT NUMBER": "Pasaport No",
    "VOUCHER": "Voucher",
    "DEPARTURE": "Gidiş Tarihi",
    "ARRIVAL": "Varış Tarihi",
    "ADULT": "Vize Ücreti Yetişkin",
    "CHILD": "Vize Ücreti Çocuk",
}


def excel_row_to_passenger(row: pd.Series, file_name: str, sheet_name: str) -> dict[str, str]:
    out: dict[str, str] = {field: "" for field in ALL_COLUMNS}
    for excel_col, app_col in EXCEL_TO_APP.items():
        if excel_col in row.index:
            out[app_col] = str(row.get(excel_col, "") or "").strip()

    ad = out["Ad"]
    soyad = out["Soyad"]
    out["Yolcu Adı Soyadı"] = " ".join(part for part in (ad, soyad) if part).strip()
    out["Kaynak Dosya"] = file_name
    out["Sayfa"] = sheet_name
    return out


def gate_visa_results_to_passengers(results) -> pd.DataFrame:
    rows: list[dict[str, str]] = []
    for result in results:
        if "Hata" in result.dataframe.columns:
            continue
        for _, row in result.dataframe.iterrows():
            rows.append(excel_row_to_passenger(row, result.file_name, result.sheet_name))
    if not rows:
        return pd.DataFrame(columns=ALL_COLUMNS)
    return normalize_passenger_dataframe(pd.DataFrame(rows))


def normalize_passenger_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=ALL_COLUMNS)

    out = df.copy()
    for field in ALL_COLUMNS:
        if field not in out.columns:
            out[field] = ""

    for _, row in out.iterrows():
        if not str(row.get("Yolcu Adı Soyadı", "")).strip():
            ad = str(row.get("Ad", "")).strip()
            soyad = str(row.get("Soyad", "")).strip()
            if ad or soyad:
                out.at[row.name, "Yolcu Adı Soyadı"] = f"{ad} {soyad}".strip()

    return out[ALL_COLUMNS].fillna("").reset_index(drop=True)


def make_demo_passengers() -> pd.DataFrame:
    return normalize_passenger_dataframe(
        pd.DataFrame(
            [
                excel_row_to_passenger(
                    pd.Series(
                        {
                            "NO": "1",
                            "NAME": "JOHN",
                            "SURNAME": "SMITH",
                            "PASSPORT NUMBER": "U12345678",
                            "VOUCHER": "VCH-1001",
                            "DEPARTURE": "2026-07-15",
                            "ARRIVAL": "2026-07-22",
                            "ADULT": "25",
                            "CHILD": "0",
                        }
                    ),
                    "demo-gate-visa.xlsx",
                    "PAX LIST",
                ),
                excel_row_to_passenger(
                    pd.Series(
                        {
                            "NO": "2",
                            "NAME": "ANNA",
                            "SURNAME": "MUELLER",
                            "PASSPORT NUMBER": "C01X23456",
                            "VOUCHER": "VCH-1002",
                            "DEPARTURE": "2026-07-16",
                            "ARRIVAL": "2026-07-23",
                            "ADULT": "25",
                            "CHILD": "12",
                        }
                    ),
                    "demo-gate-visa.xlsx",
                    "PAX LIST",
                ),
                excel_row_to_passenger(
                    pd.Series(
                        {
                            "NO": "3",
                            "NAME": "AYŞE",
                            "SURNAME": "YILMAZ",
                            "PASSPORT NUMBER": "T98765432",
                            "VOUCHER": "VCH-1003",
                            "DEPARTURE": "2026-07-18",
                            "ARRIVAL": "2026-07-25",
                            "ADULT": "25",
                            "CHILD": "0",
                        }
                    ),
                    "demo-gate-visa.xlsx",
                    "PAX LIST",
                ),
            ]
        )
    )


def passenger_template_xlsx() -> bytes:
    return build_gate_visa_template_xlsx()


def expected_headers_markdown() -> str:
    return """
**Satır 1:** GATE VISA PAX LIST (başlık)<br>
**Satır 3-4:** NO · NAME · SURNAME · PASSPORT NUMBER · VOUCHER · DATE (DEPARTURE / ARRIVAL) · VISA FEE (ADULT / CHILD)<br>
**Satır 5+:** Yolcu verileri — her satır = 1 kart
    """.strip()


def validate_passenger_rows(df: pd.DataFrame) -> list[str]:
    warnings: list[str] = []
    if df.empty:
        return warnings

    missing_names = df["Yolcu Adı Soyadı"].astype(str).str.strip().eq("")
    if missing_names.any():
        warnings.append(f"⚠ {int(missing_names.sum())} satırda yolcu adı/soyadı boş.")

    missing_passport = df["Pasaport No"].astype(str).str.strip().eq("")
    if missing_passport.any():
        warnings.append(f"⚠ {int(missing_passport.sum())} satırda pasaport no boş.")

    return warnings
