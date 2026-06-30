from __future__ import annotations

import re
from typing import Any

import pandas as pd

from passenger_schema import (
    CARD_DATE_FIELD,
    CARD_SUBTITLE_FIELDS,
    CARD_TAG_FIELDS,
    CARD_TITLE_FIELD,
    FILTERABLE_HEADERS,
    PASSENGER_FIELDS,
)


DATE_FILTER_FIELDS = ["Gidiş Tarihi", "Varış Tarihi"]


def cell_text(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def parse_date_value(value: Any):
    """Metin tarihi gerçek date nesnesine çevirir (gg.aa.yyyy ve yyyy-aa-gg destekli)."""
    text = cell_text(value)
    if not text:
        return None
    # ISO benzeri (yyyy-aa-gg / yyyy/aa/gg) ise gün-önce olmamalı; aksi halde gg.aa.yyyy varsay.
    is_iso = bool(re.match(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}", text))
    ts = pd.to_datetime(text, errors="coerce", dayfirst=not is_iso)
    if pd.isna(ts):
        return None
    return ts.date()


def parse_amount(value: Any) -> float:
    """Ücret metnini sayıya çevirir ('25', '25,5', '€30' → float)."""
    text = cell_text(value)
    if not text:
        return 0.0
    matches = re.findall(r"[-+]?\d*[.,]?\d+", text.replace(" ", ""))
    if not matches:
        return 0.0
    try:
        return float(matches[0].replace(",", "."))
    except ValueError:
        return 0.0


def summarize_group(df: pd.DataFrame) -> dict[str, Any]:
    """Bir yolcu grubunun özetini döndürür (sayı, ücret toplamları, fotolu sayısı)."""
    adult_total = sum(parse_amount(v) for v in df["Vize Ücreti Yetişkin"]) if "Vize Ücreti Yetişkin" in df else 0.0
    child_total = sum(parse_amount(v) for v in df["Vize Ücreti Çocuk"]) if "Vize Ücreti Çocuk" in df else 0.0
    with_photo = 0
    if "Foto" in df:
        with_photo = int(df["Foto"].astype(str).str.strip().ne("").sum())
    return {
        "count": int(len(df)),
        "adult_total": adult_total,
        "child_total": child_total,
        "total": adult_total + child_total,
        "with_photo": with_photo,
    }


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
        fees.append(f"Yetişkin {adult}")
    if child and child not in ("0", "0.0"):
        fees.append(f"Çocuk {child}")

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


def unique_values(df: pd.DataFrame, field: str, limit: int = 40) -> list[str]:
    if field not in df.columns or df.empty:
        return []
    values: list[str] = []
    for raw in df[field].tolist():
        text = cell_text(raw)
        if text and text not in values:
            values.append(text)
        if len(values) >= limit:
            break
    return sorted(values, key=str.casefold)


def filterable_headers(df: pd.DataFrame) -> list[str]:
    headers = []
    for field in FILTERABLE_HEADERS:
        if field in df.columns and unique_values(df, field):
            headers.append(field)
    return headers


def active_filter_count(filters: dict[str, str | None]) -> int:
    return sum(1 for value in filters.values() if value)


def apply_filters(
    df: pd.DataFrame,
    search: str,
    column_filters: dict[str, str | None],
    date_filters: dict[str, tuple] | None = None,
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

    for field, value in column_filters.items():
        if value and field in view.columns:
            view = view[view[field].astype(str).str.strip() == value]

    for field, bounds in (date_filters or {}).items():
        if not bounds or field not in view.columns:
            continue
        start, end = bounds

        def in_range(value, start=start, end=end) -> bool:
            d = parse_date_value(value)
            if d is None:
                return False
            if start is not None and d < start:
                return False
            if end is not None and d > end:
                return False
            return True

        view = view[view[field].map(in_range)]

    return view
