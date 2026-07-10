from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class ParsedImportRow:
    row_number: int
    first_name: str
    last_name: str
    passport_no: str
    voucher: str
    arrival_date: date | None
    adult_fee: Decimal
    child_fee: Decimal
    currency: str
    source_file: str
    errors: tuple[str, ...]
    raw_redacted: dict[str, Any]


def _text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.casefold() == "nan" else text


def _date(value: Any) -> date | None:
    if value is None or _text(value) == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _text(value)
    for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def _money(value: Any) -> Decimal:
    text = _text(value).replace("€", "").replace(" ", "")
    if not text:
        return Decimal("0.00")
    if text.count(",") == 1 and text.count(".") == 0:
        text = text.replace(",", ".")
    elif text.count(",") == 1 and text.count(".") == 1 and text.index(".") < text.index(","):
        text = text.replace(".", "").replace(",", ".")
    try:
        return Decimal(text).quantize(Decimal("0.01"))
    except InvalidOperation:
        return Decimal("0.00")


def _load_v7_parser():
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    try:
        from gate_visa_reader import read_gate_visa_file_bytes
        from passenger_schema import gate_visa_results_to_passengers, validate_passenger_rows
    except ImportError as exc:
        raise RuntimeError(
            "V7 Excel parser modülleri bulunamadı. V8 klasörü excelbase_cloud repo köküne uygulanmalıdır."
        ) from exc
    return read_gate_visa_file_bytes, gate_visa_results_to_passengers, validate_passenger_rows


def parse_gate_visa_file(filename: str, data: bytes) -> tuple[list[ParsedImportRow], list[str]]:
    reader, to_passengers, validate = _load_v7_parser()
    results = reader(filename, data)
    frame = to_passengers(results)
    warnings = [str(item) for item in validate(frame)]
    rows: list[ParsedImportRow] = []
    for position, (_, source) in enumerate(frame.iterrows(), start=1):
        first_name = _text(source.get("Ad"))
        last_name = _text(source.get("Soyad"))
        passport_no = _text(source.get("Pasaport No"))
        errors: list[str] = []
        if not first_name:
            errors.append("Ad eksik")
        if not last_name:
            errors.append("Soyad eksik")
        if not passport_no:
            errors.append("Pasaport eksik")
        arrival_raw = source.get("Varış Tarihi")
        arrival = _date(arrival_raw)
        if _text(arrival_raw) and arrival is None:
            errors.append("Varış tarihi okunamadı")
        raw_redacted = {
            "Ad": first_name,
            "Soyad": last_name,
            "Pasaport No": "[REDACTED]" if passport_no else "",
            "Voucher": _text(source.get("Voucher")),
            "Varış Tarihi": _text(arrival_raw),
            "Kaynak Dosya": _text(source.get("Kaynak Dosya")) or filename,
            "Sayfa": _text(source.get("Sayfa")),
        }
        # Ensure this structure is JSON serializable before the DB transaction starts.
        json.dumps(raw_redacted, ensure_ascii=False)
        rows.append(
            ParsedImportRow(
                row_number=position,
                first_name=first_name,
                last_name=last_name,
                passport_no=passport_no,
                voucher=_text(source.get("Voucher")),
                arrival_date=arrival,
                adult_fee=_money(source.get("Vize Ücreti Yetişkin")),
                child_fee=_money(source.get("Vize Ücreti Çocuk")),
                currency="EUR",
                source_file=_text(source.get("Kaynak Dosya")) or filename,
                errors=tuple(errors),
                raw_redacted=raw_redacted,
            )
        )
    return rows, warnings
