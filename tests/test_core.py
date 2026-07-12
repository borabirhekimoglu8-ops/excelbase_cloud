"""Çekirdek mantık testleri — Excel parser yardımcıları, foto eşleştirme,
tarih/ücret ayrıştırma, filtreler ve doğrulama uyarıları.

Çalıştırma:
    python -m pytest tests/test_core.py
    veya
    python tests/test_core.py
"""
from __future__ import annotations

import os
import sys
from datetime import date

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from operation_helpers import (  # noqa: E402
    apply_filters,
    parse_amount,
    parse_date_value,
    summarize_group,
)
from passenger_schema import (  # noqa: E402
    make_demo_passengers,
    normalize_passenger_dataframe,
    validate_passenger_rows,
)
from photo_store import (  # noqa: E402
    is_zip,
    looks_like_image,
    make_thumb,
    match_photos_to_dataframe,
    parse_photo_filename,
)


def _png_bytes() -> bytes:
    from io import BytesIO

    from PIL import Image

    img = Image.new("RGB", (300, 400), (10, 120, 200))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_parse_amount():
    assert parse_amount("25") == 25.0
    assert parse_amount("€30,5") == 30.5
    assert parse_amount("") == 0.0
    assert parse_amount("abc") == 0.0
    assert parse_amount(None) == 0.0


def test_parse_date_value():
    assert parse_date_value("2026-07-10") == date(2026, 7, 10)
    assert parse_date_value("15.08.2026") == date(2026, 8, 15)
    assert parse_date_value("01/09/2026") == date(2026, 9, 1)
    assert parse_date_value("") is None
    assert parse_date_value("nan") is None


def test_summarize_group():
    df = make_demo_passengers()
    s = summarize_group(df)
    assert s["count"] == 3
    assert s["adult_total"] == 75.0
    assert s["child_total"] == 12.0
    assert s["total"] == 87.0
    assert s["with_photo"] == 0


def test_apply_filters_date_range():
    df = pd.DataFrame(
        {
            "Ad": ["A", "B", "C", "D"],
            "Gidiş Tarihi": ["2026-07-10", "2026-07-15", "2026-07-20", "15.08.2026"],
            "Pasaport No": ["P1", "P2", "P3", "P4"],
        }
    )
    r = apply_filters(df, "", {}, {"Gidiş Tarihi": (date(2026, 7, 12), date(2026, 7, 18))})
    assert r["Ad"].tolist() == ["B"]
    r2 = apply_filters(df, "", {}, {"Gidiş Tarihi": (date(2026, 8, 1), None)})
    assert r2["Ad"].tolist() == ["D"]


def test_apply_filters_search_and_column():
    df = make_demo_passengers()
    assert len(apply_filters(df, "JOHN", {})) == 1
    assert len(apply_filters(df, "", {"Soyad": "YILMAZ"})) == 1


def test_validate_duplicate_and_missing():
    df = make_demo_passengers()
    df.loc[1, "Pasaport No"] = df.loc[0, "Pasaport No"]
    df.loc[1, "Gidiş Tarihi"] = df.loc[0, "Gidiş Tarihi"]  # same passenger + same travel day
    df["Voucher"] = ""  # missing column
    warnings = validate_passenger_rows(df)
    text = " ".join(warnings)
    assert "tekrarlanan pasaport" in text.lower()
    assert "Voucher" in text


def test_same_passport_on_another_date_is_not_duplicate():
    df = make_demo_passengers()
    df.loc[1, "Pasaport No"] = df.loc[0, "Pasaport No"]
    warnings = " ".join(validate_passenger_rows(df))
    assert "tekrarlanan pasaport" not in warnings.lower()


def test_parse_photo_filename():
    info = parse_photo_filename("2026-07-01_JOHN_DOE_AB123456.jpg")
    assert info["date"] == "2026-07-01"
    assert info["passport"] == "AB123456"
    assert info["name"] == "JOHN"
    assert info["surname"] == "DOE"


def test_match_photos_by_passport():
    df = make_demo_passengers()
    png = _png_bytes()
    uploaded = [("2026-07-15_JOHN_SMITH_U12345678.png", png)]
    out, matched, unmatched = match_photos_to_dataframe(df, uploaded)
    assert matched == 1
    assert unmatched == []
    assert out.loc[0, "Foto"]


def test_match_photos_unmatched():
    df = make_demo_passengers()
    png = _png_bytes()
    uploaded = [("2026-07-15_NOBODY_NOONE_ZZ999.png", png)]
    out, matched, unmatched = match_photos_to_dataframe(df, uploaded)
    assert matched == 0
    assert len(unmatched) == 1


def test_is_zip_and_image_detection():
    assert is_zip("x.zip", b"PK\x03\x04rest")
    assert not is_zip("x.jpg", b"\xff\xd8\xff")
    assert looks_like_image("a.jpg", b"\xff\xd8\xff\xe0")
    assert not looks_like_image("a.txt", b"hello world not an image")


def test_make_thumb():
    png = _png_bytes()
    thumb = make_thumb(png, 96, 55)
    assert thumb is not None
    assert len(thumb) < len(png)


def test_normalize_roundtrip():
    df = make_demo_passengers()
    norm = normalize_passenger_dataframe(df)
    assert list(norm.columns)
    assert len(norm) == 3


def _run_all():
    funcs = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in funcs:
        fn()
        passed += 1
        print(f"PASS {fn.__name__}")
    print(f"\n{passed}/{len(funcs)} test geçti")


if __name__ == "__main__":
    _run_all()
