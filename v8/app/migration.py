"""V7 kayıtlarını ve Excel dosyalarını V8 ilişkisel şemasına taşır.

Kayıtlar "Gidiş Tarihi" alanına göre tarih kodlu operasyonlara gruplanır;
tarihi okunamayanlar <PREFIX>-TARIHSIZ operasyonunda toplanır. Taşıma tekrar
çalıştırılabilir: var olan operasyonlar ve pasaportlar atlanır.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, UTC
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .audit import emit_audit_event
from .auth import IdentityContext
from .import_adapter import _date, _load_v7_parser, _money, _text
from .models import Operation, OperationStatus, Passenger
from .schemas import V7MigrationPhotoLink, V7MigrationRead
from .security import get_codec


def _names(record: dict[str, Any]) -> tuple[str, str]:
    first = _text(record.get("Ad"))
    last = _text(record.get("Soyad"))
    if first or last:
        return first or "Bilinmiyor", last or "Bilinmiyor"
    full = _text(record.get("Yolcu Adı Soyadı"))
    parts = full.split()
    if len(parts) >= 2:
        return " ".join(parts[:-1]), parts[-1]
    return full or "Bilinmiyor", "Bilinmiyor"


def records_from_excel(filename: str, data: bytes) -> list[dict[str, Any]]:
    """Parses a Gate Visa Excel/CSV file into V7-style record dicts."""
    reader, to_passengers, _ = _load_v7_parser()
    frame = to_passengers(reader(filename, data))
    return frame.to_dict(orient="records")


def _get_or_create_operation(
    db: Session,
    organization_id: uuid.UUID,
    code: str,
    departure: date,
    origin: str,
    destination: str,
) -> tuple[Operation, bool]:
    operation = db.scalar(
        select(Operation).where(
            Operation.organization_id == organization_id,
            Operation.code == code,
            Operation.deleted_at.is_(None),
        )
    )
    if operation is not None:
        return operation, False
    operation = Operation(
        organization_id=organization_id,
        code=code,
        route_origin=origin,
        route_destination=destination,
        departure_date=departure,
        status=OperationStatus.DRAFT.value,
        notes="Otomatik içe aktarma ile oluşturuldu.",
    )
    db.add(operation)
    db.flush()
    return operation, True


def migrate_records(
    db: Session,
    identity: IdentityContext,
    records: list[dict[str, Any]],
    request_id: str,
    *,
    origin: str = "Kuşadası",
    destination: str = "Samos",
    code_prefix: str = "V7",
    action: str = "v7.migrated",
    source_label: str = "v7-migration",
) -> V7MigrationRead:
    if not records:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Taşınacak yolcu kaydı yok.",
        )

    grouped: dict[date | None, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[_date(record.get("Gidiş Tarihi"))].append(record)

    codec = get_codec()
    created_operations = 0
    created_passengers = 0
    duplicate_passengers = 0
    skipped_without_passport = 0
    invalid_passports = 0
    photo_links: list[V7MigrationPhotoLink] = []

    try:
        for departure in sorted(grouped, key=lambda d: (d is None, d or date.min)):
            rows = grouped[departure]
            code = f"{code_prefix}-{departure:%Y%m%d}" if departure else f"{code_prefix}-TARIHSIZ"
            operation, created = _get_or_create_operation(
                db,
                identity.organization_id,
                code,
                departure or datetime.now(UTC).date(),
                origin,
                destination,
            )
            created_operations += int(created)

            for row_number, record in enumerate(rows, start=1):
                passport = _text(record.get("Pasaport No"))
                photo_ref = _text(record.get("Foto"))
                if not passport:
                    skipped_without_passport += 1
                    continue
                try:
                    ciphertext = codec.encrypt_passport(passport)
                    passport_hash = codec.passport_hash(passport)
                except ValueError:
                    invalid_passports += 1
                    continue
                first_name, last_name = _names(record)

                existing = db.scalar(
                    select(Passenger).where(
                        Passenger.organization_id == identity.organization_id,
                        Passenger.operation_id == operation.id,
                        Passenger.passport_hash == passport_hash,
                        Passenger.deleted_at.is_(None),
                    )
                )
                if existing is not None:
                    duplicate_passengers += 1
                    # Yeniden çalıştırmada eksik kalan fotoğraflar tamamlanabilsin.
                    if photo_ref and not existing.photo_object_key:
                        photo_links.append(
                            V7MigrationPhotoLink(
                                passenger_id=existing.id,
                                photo_ref=photo_ref,
                                passenger_name=f"{existing.first_name} {existing.last_name}".strip(),
                            )
                        )
                    continue

                passenger = Passenger(
                    organization_id=identity.organization_id,
                    operation_id=operation.id,
                    first_name=first_name,
                    last_name=last_name,
                    passport_ciphertext=ciphertext,
                    passport_hash=passport_hash,
                    voucher=_text(record.get("Voucher")),
                    arrival_date=_date(record.get("Varış Tarihi")),
                    adult_fee=_money(record.get("Vize Ücreti Yetişkin")),
                    child_fee=_money(record.get("Vize Ücreti Çocuk")),
                    currency="EUR",
                    source_file=_text(record.get("Kaynak Dosya")) or source_label,
                    source_row=row_number,
                )
                db.add(passenger)
                db.flush()
                created_passengers += 1
                if photo_ref:
                    photo_links.append(
                        V7MigrationPhotoLink(
                            passenger_id=passenger.id,
                            photo_ref=photo_ref,
                            passenger_name=f"{first_name} {last_name}".strip(),
                        )
                    )

        migration_id = uuid.uuid4()
        emit_audit_event(
            db,
            organization_id=identity.organization_id,
            actor_id=identity.user_id,
            request_id=request_id,
            entity_type="migration",
            entity_id=migration_id,
            action=action,
            after={
                "source": source_label,
                "records": len(records),
                "created_operations": created_operations,
                "created_passengers": created_passengers,
                "duplicate_passengers": duplicate_passengers,
                "skipped_without_passport": skipped_without_passport,
                "invalid_passports": invalid_passports,
                "photo_links": len(photo_links),
            },
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Eşzamanlı bir taşıma çakıştı; lütfen yeniden deneyin.",
        ) from exc

    return V7MigrationRead(
        created_operations=created_operations,
        created_passengers=created_passengers,
        duplicate_passengers=duplicate_passengers,
        skipped_without_passport=skipped_without_passport,
        invalid_passports=invalid_passports,
        photo_links=photo_links,
    )


def import_excel_auto(
    db: Session,
    identity: IdentityContext,
    filename: str,
    data: bytes,
    request_id: str,
) -> V7MigrationRead:
    """Excel dosyasını tek adımda içeri alır: gidiş tarihlerine göre
    operasyonlar oluşturur ve yolcuları yerleştirir; hiçbir onay adımı yoktur."""
    try:
        records = records_from_excel(filename, data)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Excel dosyası okunamadı veya desteklenmeyen format.",
        ) from exc
    if not records:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{filename}: dosyada yolcu satırı bulunamadı.",
        )
    return migrate_records(
        db,
        identity,
        records,
        request_id,
        code_prefix="OP",
        action="import.auto",
        source_label=filename,
    )
