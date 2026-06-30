from __future__ import annotations

import pandas as pd

from excelbase_core import dataframe_to_xlsx

# Tek format: her Excel satırı = 1 yolcu kartı
IMPORT_MODE = "Feribot Satış"

PASSENGER_FIELDS: list[str] = [
    "Satış Tarihi",
    "Yolcu Adı Soyadı",
    "Hat",
    "Sefer Tarihi",
    "PNR / Bilet No",
    "Satış Kanalı",
    "Acente",
    "Tutar",
    "Para Birimi",
    "Durum",
]

META_FIELDS: list[str] = ["Kaynak Dosya", "Sayfa"]

ALL_COLUMNS: list[str] = PASSENGER_FIELDS + META_FIELDS

# Kart üzerinde gösterilecek sabit etiket filtreleri
FILTER_FIELDS: list[str] = ["Durum", "Hat", "Satış Kanalı", "Acente"]

CARD_TITLE_FIELD = "Yolcu Adı Soyadı"
CARD_SUBTITLE_FIELDS = ["Hat", "Sefer Tarihi", "PNR / Bilet No"]
CARD_TAG_FIELDS = ["Satış Kanalı", "Acente", "Para Birimi"]
CARD_STATUS_FIELD = "Durum"
CARD_DATE_FIELD = "Sefer Tarihi"


def empty_passenger_row() -> dict[str, str]:
    return {field: "" for field in ALL_COLUMNS}


def make_demo_passengers() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "Satış Tarihi": "2026-06-30",
                "Yolcu Adı Soyadı": "Ayşe Demir",
                "Hat": "Seferihisar - Samos",
                "Sefer Tarihi": "2026-07-04",
                "PNR / Bilet No": "PNR1001",
                "Satış Kanalı": "Çağrı Merkezi",
                "Acente": "Merkez",
                "Tutar": 55,
                "Para Birimi": "EUR",
                "Durum": "Onaylandı",
                "Kaynak Dosya": "demo.xlsx",
                "Sayfa": "Satışlar",
            },
            {
                "Satış Tarihi": "2026-06-30",
                "Yolcu Adı Soyadı": "Mehmet Kaya",
                "Hat": "Seferihisar - Samos",
                "Sefer Tarihi": "2026-07-05",
                "PNR / Bilet No": "PNR1002",
                "Satış Kanalı": "Ferryhopper",
                "Acente": "Yabancı Acente",
                "Tutar": 61,
                "Para Birimi": "EUR",
                "Durum": "Bekliyor",
                "Kaynak Dosya": "demo.xlsx",
                "Sayfa": "Satışlar",
            },
            {
                "Satış Tarihi": "2026-06-29",
                "Yolcu Adı Soyadı": "Zeynep Ak",
                "Hat": "Kuşadası - Samos",
                "Sefer Tarihi": "2026-07-06",
                "PNR / Bilet No": "PNR1003",
                "Satış Kanalı": "Web",
                "Acente": "Merkez",
                "Tutar": 48,
                "Para Birimi": "EUR",
                "Durum": "İptal",
                "Kaynak Dosya": "demo.xlsx",
                "Sayfa": "Satışlar",
            },
        ]
    )


def normalize_passenger_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=ALL_COLUMNS)

    out = df.copy()
    for field in ALL_COLUMNS:
        if field not in out.columns:
            out[field] = ""
    out = out[ALL_COLUMNS].fillna("")
    return out.reset_index(drop=True)


def passenger_template_xlsx() -> bytes:
    template = pd.DataFrame([{field: "" for field in PASSENGER_FIELDS}])
    return dataframe_to_xlsx(template)


def expected_headers_markdown() -> str:
    lines = [f"{idx}. **{field}**" for idx, field in enumerate(PASSENGER_FIELDS, start=1)]
    return "\n".join(lines)


def validate_passenger_rows(df: pd.DataFrame) -> list[str]:
    warnings: list[str] = []
    if df.empty:
        return warnings

    missing_names = df["Yolcu Adı Soyadı"].astype(str).str.strip().eq("") | df["Yolcu Adı Soyadı"].isna()
    if missing_names.any():
        warnings.append(f"⚠ {int(missing_names.sum())} satırda yolcu adı boş.")

    empty_rows = df[PASSENGER_FIELDS].astype(str).apply(lambda row: all(v.strip() in ("", "nan") for v in row), axis=1)
    if empty_rows.any():
        warnings.append(f"⚠ {int(empty_rows.sum())} tamamen boş satır atlandı.")

    return warnings
