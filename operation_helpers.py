from __future__ import annotations

from typing import Any

import pandas as pd

# Standart alan önceliği — kart başlığı, alt satır, etiketler
TITLE_FIELDS = [
    "Yolcu Adı Soyadı",
    "Müşteri",
    "Pasaport No",
    "PNR / Bilet No",
]

SUBTITLE_FIELDS = [
    "Hat",
    "Hat / Ada",
    "Ürün / Hat",
    "Sefer Tarihi",
    "Gidiş Tarihi",
    "Satış Tarihi",
    "Başvuru Tarihi",
    "Tarih",
]

TAG_FIELDS = [
    "Durum",
    "Satış Kanalı",
    "Acente / Kanal",
    "Acente",
    "Kanal",
    "Para Birimi",
]

DATE_FIELDS = [
    "Satış Tarihi",
    "Sefer Tarihi",
    "Başvuru Tarihi",
    "Gidiş Tarihi",
    "Dönüş Tarihi",
    "Tarih",
]

META_FIELDS = {"Kaynak Dosya", "Sayfa"}

STATUS_TONES = {
    "onay": "ok",
    "tamam": "ok",
    "bekl": "wait",
    "iptal": "danger",
    "red": "danger",
    "hata": "danger",
}


def pick_column(columns: list[str], candidates: list[str]) -> str | None:
    for name in candidates:
        if name in columns:
            return name
    return None


def cell_text(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def status_tone(value: str) -> str:
    lowered = value.lower()
    for key, tone in STATUS_TONES.items():
        if key in lowered:
            return tone
    return "neutral"


def operation_card_view(row: pd.Series, columns: list[str]) -> dict[str, Any]:
    title_col = pick_column(columns, TITLE_FIELDS)
    subtitle_parts: list[str] = []
    for field in SUBTITLE_FIELDS:
        if field in columns:
            text = cell_text(row.get(field))
            if text and text not in subtitle_parts:
                subtitle_parts.append(text)

    tags: list[dict[str, str]] = []
    for field in TAG_FIELDS:
        if field not in columns:
            continue
        text = cell_text(row.get(field))
        if text:
            tags.append({"label": field, "value": text})

    amount_col = pick_column(columns, ["Tutar"])
    amount = cell_text(row.get(amount_col)) if amount_col else ""
    currency_col = pick_column(columns, ["Para Birimi"])
    currency = cell_text(row.get(currency_col)) if currency_col else ""

    status_col = pick_column(columns, ["Durum"])
    status = cell_text(row.get(status_col)) if status_col else ""
    date_col = pick_column(columns, DATE_FIELDS)
    date_value = cell_text(row.get(date_col)) if date_col else ""

    source = cell_text(row.get("Kaynak Dosya")) if "Kaynak Dosya" in columns else ""
    sheet = cell_text(row.get("Sayfa")) if "Sayfa" in columns else ""

    title = cell_text(row.get(title_col)) if title_col else ""
    if not title:
        for col in columns:
            if col in META_FIELDS:
                continue
            text = cell_text(row.get(col))
            if text:
                title = text
                break
    if not title:
        title = "Operasyon"

    return {
        "title": title,
        "subtitle": " · ".join(subtitle_parts[:3]),
        "status": status,
        "status_tone": status_tone(status),
        "date": date_value,
        "amount": amount,
        "currency": currency,
        "tags": tags[:4],
        "source": source,
        "sheet": sheet,
    }


def editable_fields(columns: list[str]) -> list[str]:
    return [col for col in columns if col not in META_FIELDS]


def unique_tag_values(df: pd.DataFrame, field: str, limit: int = 12) -> list[str]:
    if field not in df.columns or df.empty:
        return []
    values = []
    for raw in df[field].tolist():
        text = cell_text(raw)
        if text and text not in values:
            values.append(text)
        if len(values) >= limit:
            break
    return values


def filter_tag_fields(df: pd.DataFrame) -> list[str]:
    fields = []
    for field in TAG_FIELDS + ["Hat", "Hat / Ada", "Acente"]:
        if field in df.columns and unique_tag_values(df, field):
            fields.append(field)
    return fields[:4]


def apply_filters(
    df: pd.DataFrame,
    search: str,
    tag_filters: dict[str, str | None],
) -> pd.DataFrame:
    if df.empty:
        return df

    view = df.copy()
    if search.strip():
        mask = view.apply(
            lambda row: row.astype(str).str.contains(search.strip(), case=False, na=False).any(),
            axis=1,
        )
        view = view.loc[mask]

    for field, value in tag_filters.items():
        if value and field in view.columns:
            view = view[view[field].astype(str).str.strip() == value]

    return view
