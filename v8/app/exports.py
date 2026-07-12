"""V7'deki raporlama/dışa aktarma özelliklerinin V8 karşılıkları.

Pasaport içeren tüm çıktılar (Excel/CSV/JSON, manifest, paket) audit
zincirine "disclosure" olayı olarak işlenir.
"""

from __future__ import annotations

import base64
import csv
import io
import json
import uuid
import zipfile
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .audit import emit_audit_event
from .auth import IdentityContext
from .models import Operation, Passenger
from .repositories import PASSENGER_STATUS_FILTERS, OperationRepository
from .schemas import OperationSummaryRead
from .security import get_codec
from .storage import get_storage

EXPORT_HEADERS = [
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

TEMPLATE_HEADERS = ["NO", "NAME", "SURNAME", "PASSPORT NUMBER", "VOUCHER", "DEPARTURE", "ARRIVAL", "ADULT", "CHILD"]


def _get_operation(db: Session, identity: IdentityContext, operation_id: uuid.UUID) -> Operation:
    operation = OperationRepository.get(db, identity.organization_id, operation_id)
    if operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operasyon bulunamadı.")
    return operation


def _passengers(db: Session, identity: IdentityContext, operation_id: uuid.UUID) -> list[Passenger]:
    return list(
        db.scalars(
            select(Passenger)
            .where(
                Passenger.organization_id == identity.organization_id,
                Passenger.operation_id == operation_id,
                Passenger.deleted_at.is_(None),
            )
            .order_by(Passenger.last_name, Passenger.first_name)
        )
    )


def operation_summary(db: Session, identity: IdentityContext, operation_id: uuid.UUID) -> OperationSummaryRead:
    _get_operation(db, identity, operation_id)

    def count(condition=None) -> int:
        query = (
            select(func.count())
            .select_from(Passenger)
            .where(
                Passenger.organization_id == identity.organization_id,
                Passenger.operation_id == operation_id,
                Passenger.deleted_at.is_(None),
            )
        )
        if condition is not None:
            query = query.where(condition)
        return int(db.scalar(query) or 0)

    total = count()
    ready = count(PASSENGER_STATUS_FILTERS["hazir"])
    fee_totals = db.execute(
        select(func.coalesce(func.sum(Passenger.adult_fee), 0), func.coalesce(func.sum(Passenger.child_fee), 0)).where(
            Passenger.organization_id == identity.organization_id,
            Passenger.operation_id == operation_id,
            Passenger.deleted_at.is_(None),
        )
    ).one()
    adult_total = Decimal(fee_totals[0]).quantize(Decimal("0.01"))
    child_total = Decimal(fee_totals[1]).quantize(Decimal("0.01"))
    return OperationSummaryRead(
        passenger_count=total,
        with_photo=count(PASSENGER_STATUS_FILTERS["fotografli"]),
        missing_photo=count(PASSENGER_STATUS_FILTERS["fotosuz"]),
        missing_voucher=count(PASSENGER_STATUS_FILTERS["vouchersiz"]),
        missing_fee=count(PASSENGER_STATUS_FILTERS["ucretsiz"]),
        ready=ready,
        readiness_percent=round(100 * ready / total) if total else 0,
        adult_total=adult_total,
        child_total=child_total,
        total_fee=(adult_total + child_total).quantize(Decimal("0.01")),
    )


def _export_rows(operation: Operation, passengers: list[Passenger]) -> list[dict[str, Any]]:
    codec = get_codec()
    rows: list[dict[str, Any]] = []
    for index, passenger in enumerate(passengers, start=1):
        rows.append(
            {
                "No": index,
                "Ad": passenger.first_name,
                "Soyad": passenger.last_name,
                "Pasaport No": codec.decrypt_passport(passenger.passport_ciphertext),
                "Voucher": passenger.voucher,
                "Gidiş Tarihi": operation.departure_date.strftime("%d.%m.%Y"),
                "Varış Tarihi": passenger.arrival_date.strftime("%d.%m.%Y") if passenger.arrival_date else "",
                "Vize Ücreti Yetişkin": str(passenger.adult_fee),
                "Vize Ücreti Çocuk": str(passenger.child_fee),
            }
        )
    return rows


def _emit_disclosure(
    db: Session,
    identity: IdentityContext,
    operation: Operation,
    request_id: str,
    action: str,
    detail: dict[str, Any],
) -> None:
    emit_audit_event(
        db,
        organization_id=identity.organization_id,
        actor_id=identity.user_id,
        request_id=request_id,
        entity_type="operation",
        entity_id=operation.id,
        action=action,
        metadata=detail,
    )
    db.commit()


def _xlsx_bytes(headers: list[str], rows: list[list[Any]], title: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = title[:31] or "Liste"
    sheet.append(headers)
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    for row in rows:
        sheet.append(row)
    for column_cells in sheet.columns:
        width = max((len(str(cell.value or "")) for cell in column_cells), default=8)
        sheet.column_dimensions[column_cells[0].column_letter].width = min(width + 2, 40)
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def export_operation(
    db: Session,
    identity: IdentityContext,
    operation_id: uuid.UUID,
    kind: str,
    request_id: str,
) -> tuple[bytes, str, str]:
    operation = _get_operation(db, identity, operation_id)
    passengers = _passengers(db, identity, operation_id)
    rows = _export_rows(operation, passengers)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M")
    base = f"{operation.code}-{stamp}"

    if kind == "csv":
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=EXPORT_HEADERS)
        writer.writeheader()
        writer.writerows(rows)
        payload = buffer.getvalue().encode("utf-8-sig")
        result = (payload, f"{base}.csv", "text/csv; charset=utf-8")
    elif kind == "json":
        payload = json.dumps(
            {
                "operation": operation.code,
                "departure_date": operation.departure_date.isoformat(),
                "exported_at": datetime.now(UTC).isoformat(),
                "passengers": rows,
            },
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")
        result = (payload, f"{base}.json", "application/json")
    elif kind in {"excel", "xlsx"}:
        payload = _xlsx_bytes(EXPORT_HEADERS, [[row[h] for h in EXPORT_HEADERS] for row in rows], operation.code)
        result = (
            payload,
            f"{base}.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="kind excel, csv veya json olmalıdır.")

    _emit_disclosure(
        db,
        identity,
        operation,
        request_id,
        "operation.exported",
        {"kind": kind, "passengers": len(rows)},
    )
    return result


def _photo_bytes(passenger: Passenger) -> bytes | None:
    if not passenger.photo_object_key:
        return None
    try:
        return get_storage().get(passenger.photo_object_key)
    except (FileNotFoundError, ValueError):
        return None


def build_manifest_html(
    db: Session,
    identity: IdentityContext,
    operation_id: uuid.UUID,
    request_id: str,
) -> str:
    import html

    operation = _get_operation(db, identity, operation_id)
    passengers = _passengers(db, identity, operation_id)
    codec = get_codec()

    cards: list[str] = []
    for index, passenger in enumerate(passengers, start=1):
        photo = _photo_bytes(passenger)
        photo_html = (
            f'<img src="data:image/jpeg;base64,{base64.b64encode(photo).decode("ascii")}" alt="foto" />'
            if photo
            else '<div class="nophoto">Fotoğraf yok</div>'
        )
        cards.append(
            "<div class='card'>"
            + photo_html
            + "<div class='info'>"
            + f"<strong>{index}. {html.escape(passenger.first_name)} {html.escape(passenger.last_name)}</strong>"
            + f"<span>Pasaport: {html.escape(codec.decrypt_passport(passenger.passport_ciphertext))}</span>"
            + f"<span>Voucher: {html.escape(passenger.voucher or '-')}</span>"
            + (
                f"<span>Varış: {passenger.arrival_date.strftime('%d.%m.%Y')}</span>"
                if passenger.arrival_date
                else ""
            )
            + "</div></div>"
        )

    _emit_disclosure(
        db,
        identity,
        operation,
        request_id,
        "operation.manifest_viewed",
        {"passengers": len(passengers)},
    )
    return (
        "<!doctype html><html lang='tr'><head><meta charset='utf-8' />"
        f"<title>{html.escape(operation.code)} manifest</title>"
        "<style>body{font-family:system-ui,sans-serif;margin:24px;}h1{font-size:20px;}"
        ".card{display:flex;gap:14px;align-items:center;border:1px solid #ccc;border-radius:10px;"
        "padding:10px;margin-bottom:10px;page-break-inside:avoid;}"
        ".card img,.nophoto{width:84px;height:84px;object-fit:cover;border-radius:8px;}"
        ".nophoto{display:flex;align-items:center;justify-content:center;background:#eee;color:#666;"
        "font-size:11px;text-align:center;}"
        ".info{display:grid;gap:2px;}@media print{button{display:none;}}</style></head><body>"
        f"<h1>{html.escape(operation.code)} · {operation.departure_date.strftime('%d.%m.%Y')} · "
        f"{html.escape(operation.route_origin)} → {html.escape(operation.route_destination)} · "
        f"{len(passengers)} yolcu</h1>"
        "<button onclick='window.print()'>Yazdır</button>"
        + "".join(cards)
        + "</body></html>"
    )


def build_package_zip(
    db: Session,
    identity: IdentityContext,
    operation_id: uuid.UUID,
    request_id: str,
) -> tuple[bytes, str]:
    operation = _get_operation(db, identity, operation_id)
    passengers = _passengers(db, identity, operation_id)
    rows = _export_rows(operation, passengers)
    codec = get_codec()

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            f"{operation.code}.xlsx",
            _xlsx_bytes(EXPORT_HEADERS, [[row[h] for h in EXPORT_HEADERS] for row in rows], operation.code),
        )
        photo_count = 0
        for passenger in passengers:
            photo = _photo_bytes(passenger)
            if photo is None:
                continue
            passport = codec.decrypt_passport(passenger.passport_ciphertext)
            safe = "".join(
                ch if ch.isalnum() or ch in "-_" else "_"
                for ch in f"{passenger.last_name}_{passenger.first_name}_{passport}"
            )
            archive.writestr(f"fotograflar/{safe}.jpg", photo)
            photo_count += 1

    _emit_disclosure(
        db,
        identity,
        operation,
        request_id,
        "operation.package_downloaded",
        {"passengers": len(rows), "photos": photo_count},
    )
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M")
    return buffer.getvalue(), f"{operation.code}-paket-{stamp}.zip"


def template_xlsx() -> bytes:
    example = ["1", "ADA", "LOVELACE", "U12345678", "VCH-001", "10.07.2026", "17.07.2026", "60", "0"]
    return _xlsx_bytes(TEMPLATE_HEADERS, [example], "Yolcu Listesi")
