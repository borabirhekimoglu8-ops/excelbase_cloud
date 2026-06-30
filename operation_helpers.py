from __future__ import annotations

from typing import Any

import pandas as pd

from passenger_schema import (
    CARD_DATE_FIELD,
    CARD_SUBTITLE_FIELDS,
    CARD_TAG_FIELDS,
    CARD_TITLE_FIELD,
    FILTER_FIELDS,
    PASSENGER_FIELDS,
)


def cell_text(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def passenger_card_view(row: pd.Series) -> dict[str, Any]:
    title = cell_text(row.get(CARD_TITLE_FIELD)) or "Yolcu"
    subtitle_parts = [cell_text(row.get(field)) for field in CARD_SUBTITLE_FIELDS]
    subtitle = " · ".join(part for part in subtitle_parts if part)

    tags = []
    for field in CARD_TAG_FIELDS:
        text = cell_text(row.get(field))
        if text:
            short = "Gidiş" if field == "Gidiş Tarihi" else "Varış" if field == "Varış Tarihi" else field
            tags.append({"label": short, "value": text})

    adult = cell_text(row.get("Vize Ücreti Yetişkin"))
    child = cell_text(row.get("Vize Ücreti Çocuk"))
    fees = []
    if adult:
        fees.append(f"Yetişkin: {adult}")
    if child and child not in ("0", "0.0"):
        fees.append(f"Çocuk: {child}")

    return {
        "title": title,
        "subtitle": subtitle or cell_text(row.get("Pasaport No")) or "Gate Visa yolcu",
        "status": cell_text(row.get("No")) and f"#{cell_text(row.get('No'))}" or "",
        "status_tone": "neutral",
        "date": cell_text(row.get(CARD_DATE_FIELD)),
        "amount": " · ".join(fees),
        "currency": "",
        "tags": tags,
        "source": cell_text(row.get("Kaynak Dosya")),
        "sheet": cell_text(row.get("Sayfa")),
        "pnr": cell_text(row.get("Voucher")),
    }


def editable_passenger_fields() -> list[str]:
    return PASSENGER_FIELDS.copy()


def unique_tag_values(df: pd.DataFrame, field: str, limit: int = 12) -> list[str]:
    if field not in df.columns or df.empty:
        return []
    values: list[str] = []
    for raw in df[field].tolist():
        text = cell_text(raw)
        if text and text not in values:
            values.append(text)
        if len(values) >= limit:
            break
    return values


def filter_fields(df: pd.DataFrame) -> list[str]:
    return [field for field in FILTER_FIELDS if field in df.columns and unique_tag_values(df, field)]


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
