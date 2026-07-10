from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .audit import canonical_hash, emit_audit_event
from .auth import IdentityContext
from .models import ImportBatch, ImportRow, ImportStatus, Operation, OperationStatus, Passenger
from .repositories import AuditRepository, ImportRepository, OperationRepository, PassengerRepository
from .schemas import (
    ImportBatchRead,
    ImportCommitRead,
    ImportPreviewRead,
    ImportRowRead,
    AuditVerifyRead,
    OperationCreate,
    OperationRead,
    OperationUpdate,
    PassengerCreate,
    PassengerRead,
    PassengerUpdate,
)
from .security import get_codec, normalize_passport
from . import import_adapter


_ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    OperationStatus.DRAFT.value: {OperationStatus.DOCUMENT_COLLECTION.value, OperationStatus.ARCHIVED.value},
    OperationStatus.DOCUMENT_COLLECTION.value: {
        OperationStatus.PHYSICAL_CONTROL.value,
        OperationStatus.ARCHIVED.value,
    },
    OperationStatus.PHYSICAL_CONTROL.value: {
        OperationStatus.READY_FOR_SUBMISSION.value,
        OperationStatus.DOCUMENT_COLLECTION.value,
    },
    OperationStatus.READY_FOR_SUBMISSION.value: {
        OperationStatus.SUBMITTED.value,
        OperationStatus.PHYSICAL_CONTROL.value,
    },
    OperationStatus.SUBMITTED.value: {OperationStatus.APPROVED.value, OperationStatus.PHYSICAL_CONTROL.value},
    OperationStatus.APPROVED.value: {OperationStatus.COMPLETED.value},
    OperationStatus.COMPLETED.value: {OperationStatus.ARCHIVED.value},
    OperationStatus.ARCHIVED.value: set(),
}


def _operation_snapshot(operation: Operation) -> dict[str, Any]:
    return {
        "id": str(operation.id),
        "organization_id": str(operation.organization_id),
        "code": operation.code,
        "route_origin": operation.route_origin,
        "route_destination": operation.route_destination,
        "departure_date": operation.departure_date.isoformat(),
        "vessel_name": operation.vessel_name,
        "status": operation.status,
        "notes": operation.notes,
        "version": operation.version,
        "deleted_at": operation.deleted_at.isoformat() if operation.deleted_at else None,
    }


def _passenger_snapshot(passenger: Passenger) -> dict[str, Any]:
    return {
        "id": str(passenger.id),
        "organization_id": str(passenger.organization_id),
        "operation_id": str(passenger.operation_id),
        "first_name": passenger.first_name,
        "last_name": passenger.last_name,
        "passport_hash": passenger.passport_hash,
        "voucher": passenger.voucher,
        "arrival_date": passenger.arrival_date.isoformat() if passenger.arrival_date else None,
        "adult_fee": str(passenger.adult_fee),
        "child_fee": str(passenger.child_fee),
        "currency": passenger.currency,
        "source_file": passenger.source_file,
        "source_row": passenger.source_row,
        "photo_object_key": passenger.photo_object_key,
        "version": passenger.version,
        "deleted_at": passenger.deleted_at.isoformat() if passenger.deleted_at else None,
    }


def _passenger_read(passenger: Passenger) -> PassengerRead:
    codec = get_codec()
    return PassengerRead(
        id=passenger.id,
        organization_id=passenger.organization_id,
        operation_id=passenger.operation_id,
        first_name=passenger.first_name,
        last_name=passenger.last_name,
        full_name=f"{passenger.first_name} {passenger.last_name}".strip(),
        passport_no=codec.decrypt_passport(passenger.passport_ciphertext),
        voucher=passenger.voucher,
        arrival_date=passenger.arrival_date,
        adult_fee=passenger.adult_fee,
        child_fee=passenger.child_fee,
        currency=passenger.currency,
        source_file=passenger.source_file,
        source_row=passenger.source_row,
        photo_object_key=passenger.photo_object_key,
        version=passenger.version,
        created_at=passenger.created_at,
        updated_at=passenger.updated_at,
    )


def create_operation(
    db: Session, identity: IdentityContext, payload: OperationCreate, request_id: str
) -> OperationRead:
    operation = Operation(
        organization_id=identity.organization_id,
        code=payload.code,
        route_origin=payload.route_origin,
        route_destination=payload.route_destination,
        departure_date=payload.departure_date,
        vessel_name=payload.vessel_name,
        notes=payload.notes,
        status=OperationStatus.DRAFT.value,
    )
    db.add(operation)
    try:
        db.flush()
        emit_audit_event(
            db,
            organization_id=identity.organization_id,
            actor_id=identity.user_id,
            request_id=request_id,
            entity_type="operation",
            entity_id=operation.id,
            action="operation.created",
            after=_operation_snapshot(operation),
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu operasyon kodu zaten kullanılıyor.") from exc
    db.refresh(operation)
    return OperationRead.model_validate(operation)


def list_operations(db: Session, identity: IdentityContext, limit: int, offset: int) -> list[OperationRead]:
    return [OperationRead.model_validate(item) for item in OperationRepository.list(db, identity.organization_id, limit, offset)]


def get_operation(db: Session, identity: IdentityContext, operation_id: uuid.UUID) -> OperationRead:
    operation = OperationRepository.get(db, identity.organization_id, operation_id)
    if operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operasyon bulunamadı.")
    return OperationRead.model_validate(operation)


def update_operation(
    db: Session,
    identity: IdentityContext,
    operation_id: uuid.UUID,
    payload: OperationUpdate,
    request_id: str,
) -> OperationRead:
    operation = OperationRepository.get(db, identity.organization_id, operation_id)
    if operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operasyon bulunamadı.")
    if operation.version != payload.version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Operasyon başka bir kullanıcı tarafından güncellendi.")
    before = _operation_snapshot(operation)
    if payload.status is not None:
        target = payload.status.value
        if target != operation.status and target not in _ALLOWED_TRANSITIONS.get(operation.status, set()):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Geçersiz durum geçişi: {operation.status} → {target}",
            )
        operation.status = target
    if payload.vessel_name is not None:
        operation.vessel_name = payload.vessel_name
    if payload.notes is not None:
        operation.notes = payload.notes
    db.flush()
    emit_audit_event(
        db,
        organization_id=identity.organization_id,
        actor_id=identity.user_id,
        request_id=request_id,
        entity_type="operation",
        entity_id=operation.id,
        action="operation.updated",
        before=before,
        after=_operation_snapshot(operation),
    )
    db.commit()
    db.refresh(operation)
    return OperationRead.model_validate(operation)


def create_passenger(
    db: Session,
    identity: IdentityContext,
    operation_id: uuid.UUID,
    payload: PassengerCreate,
    request_id: str,
) -> PassengerRead:
    operation = OperationRepository.get(db, identity.organization_id, operation_id)
    if operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operasyon bulunamadı.")
    codec = get_codec()
    passport_hash = codec.passport_hash(payload.passport_no)
    if PassengerRepository.duplicate_exists(db, identity.organization_id, operation_id, passport_hash):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu pasaport operasyonda zaten kayıtlı.")
    passenger = Passenger(
        organization_id=identity.organization_id,
        operation_id=operation_id,
        first_name=payload.first_name,
        last_name=payload.last_name,
        passport_ciphertext=codec.encrypt_passport(payload.passport_no),
        passport_hash=passport_hash,
        voucher=payload.voucher,
        arrival_date=payload.arrival_date,
        adult_fee=payload.adult_fee,
        child_fee=payload.child_fee,
        currency=payload.currency,
        source_file=payload.source_file,
        source_row=payload.source_row,
    )
    db.add(passenger)
    db.flush()
    emit_audit_event(
        db,
        organization_id=identity.organization_id,
        actor_id=identity.user_id,
        request_id=request_id,
        entity_type="passenger",
        entity_id=passenger.id,
        action="passenger.created",
        after=_passenger_snapshot(passenger),
    )
    db.commit()
    db.refresh(passenger)
    return _passenger_read(passenger)


def list_passengers(
    db: Session, identity: IdentityContext, operation_id: uuid.UUID, limit: int, offset: int
) -> list[PassengerRead]:
    operation = OperationRepository.get(db, identity.organization_id, operation_id)
    if operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operasyon bulunamadı.")
    return [
        _passenger_read(item)
        for item in PassengerRepository.list_for_operation(db, identity.organization_id, operation_id, limit, offset)
    ]


def get_passenger(db: Session, identity: IdentityContext, passenger_id: uuid.UUID) -> PassengerRead:
    passenger = PassengerRepository.get(db, identity.organization_id, passenger_id)
    if passenger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu bulunamadı.")
    return _passenger_read(passenger)


def update_passenger(
    db: Session,
    identity: IdentityContext,
    passenger_id: uuid.UUID,
    payload: PassengerUpdate,
    request_id: str,
) -> PassengerRead:
    passenger = PassengerRepository.get(db, identity.organization_id, passenger_id)
    if passenger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu bulunamadı.")
    if passenger.version != payload.version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Yolcu başka bir kullanıcı tarafından güncellendi.")
    before = _passenger_snapshot(passenger)
    values = payload.model_dump(exclude={"version"}, exclude_unset=True)
    passport_no = values.pop("passport_no", None)
    if passport_no is not None:
        codec = get_codec()
        passport_hash = codec.passport_hash(passport_no)
        if PassengerRepository.duplicate_exists(
            db,
            identity.organization_id,
            passenger.operation_id,
            passport_hash,
            exclude_id=passenger.id,
        ):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu pasaport operasyonda zaten kayıtlı.")
        passenger.passport_ciphertext = codec.encrypt_passport(passport_no)
        passenger.passport_hash = passport_hash
    for field, value in values.items():
        setattr(passenger, field, value)
    db.flush()
    emit_audit_event(
        db,
        organization_id=identity.organization_id,
        actor_id=identity.user_id,
        request_id=request_id,
        entity_type="passenger",
        entity_id=passenger.id,
        action="passenger.updated",
        before=before,
        after=_passenger_snapshot(passenger),
    )
    db.commit()
    db.refresh(passenger)
    return _passenger_read(passenger)


def delete_passenger(
    db: Session,
    identity: IdentityContext,
    passenger_id: uuid.UUID,
    expected_version: int,
    request_id: str,
) -> None:
    passenger = PassengerRepository.get(db, identity.organization_id, passenger_id)
    if passenger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu bulunamadı.")
    if passenger.version != expected_version:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Yolcu başka bir kullanıcı tarafından güncellendi.")
    before = _passenger_snapshot(passenger)
    passenger.deleted_at = datetime.now(UTC)
    db.flush()
    emit_audit_event(
        db,
        organization_id=identity.organization_id,
        actor_id=identity.user_id,
        request_id=request_id,
        entity_type="passenger",
        entity_id=passenger.id,
        action="passenger.deleted",
        before=before,
        after=_passenger_snapshot(passenger),
    )
    db.commit()


def list_audit_events(db: Session, identity: IdentityContext, limit: int):
    return list(AuditRepository.list(db, identity.organization_id, limit))



def _import_batch_read(batch: ImportBatch) -> ImportBatchRead:
    return ImportBatchRead.model_validate(batch)


def _import_row_read(row: ImportRow) -> ImportRowRead:
    normalized = json.loads(row.normalized_json or "{}")
    preview = {
        "first_name": normalized.get("first_name", ""),
        "last_name": normalized.get("last_name", ""),
        "passport_masked": normalized.get("passport_masked", ""),
        "voucher": normalized.get("voucher", ""),
        "arrival_date": normalized.get("arrival_date"),
        "adult_fee": normalized.get("adult_fee", "0.00"),
        "child_fee": normalized.get("child_fee", "0.00"),
        "currency": normalized.get("currency", "EUR"),
        "source_file": normalized.get("source_file", ""),
    }
    return ImportRowRead(
        id=row.id,
        row_number=row.row_number,
        is_valid=row.is_valid,
        errors=list(json.loads(row.errors_json or "[]")),
        preview=preview,
    )


def _mask_passport(passport_no: str) -> str:
    normalized = normalize_passport(passport_no)
    if len(normalized) <= 4:
        return "*" * len(normalized)
    return "*" * (len(normalized) - 4) + normalized[-4:]


def stage_import(
    db: Session,
    identity: IdentityContext,
    operation_id: uuid.UUID,
    filename: str,
    data: bytes,
    request_id: str,
) -> ImportPreviewRead:
    operation = OperationRepository.get(db, identity.organization_id, operation_id)
    if operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operasyon bulunamadı.")
    digest = hashlib.sha256(data).hexdigest()
    existing = ImportRepository.find_by_hash(db, identity.organization_id, digest)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Bu dosya daha önce yüklendi. batch_id={existing.id}",
        )
    try:
        parsed_rows, warnings = import_adapter.parse_gate_visa_file(filename, data)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Excel dosyası ayrıştırılamadı.") from exc

    batch = ImportBatch(
        organization_id=identity.organization_id,
        operation_id=operation_id,
        uploaded_by=identity.user_id,
        filename=filename,
        file_sha256=digest,
        status=ImportStatus.VALIDATING.value,
        report_json=json.dumps({"warnings": warnings}, ensure_ascii=False),
    )
    db.add(batch)
    try:
        db.flush()
        codec = get_codec()
        valid = 0
        invalid = 0
        for parsed in parsed_rows:
            errors = list(parsed.errors)
            ciphertext = ""
            passport_hash = ""
            if parsed.passport_no:
                try:
                    ciphertext = codec.encrypt_passport(parsed.passport_no)
                    passport_hash = codec.passport_hash(parsed.passport_no)
                except ValueError as exc:
                    errors.append(str(exc))
            normalized = {
                "first_name": parsed.first_name,
                "last_name": parsed.last_name,
                "passport_ciphertext": ciphertext,
                "passport_hash": passport_hash,
                "passport_masked": _mask_passport(parsed.passport_no),
                "voucher": parsed.voucher,
                "arrival_date": parsed.arrival_date.isoformat() if parsed.arrival_date else None,
                "adult_fee": str(parsed.adult_fee),
                "child_fee": str(parsed.child_fee),
                "currency": parsed.currency,
                "source_file": parsed.source_file,
                "source_row": parsed.row_number,
            }
            is_valid = not errors
            valid += int(is_valid)
            invalid += int(not is_valid)
            db.add(
                ImportRow(
                    organization_id=identity.organization_id,
                    batch_id=batch.id,
                    row_number=parsed.row_number,
                    raw_json=json.dumps(parsed.raw_redacted, ensure_ascii=False, sort_keys=True),
                    normalized_json=json.dumps(normalized, ensure_ascii=False, sort_keys=True),
                    errors_json=json.dumps(errors, ensure_ascii=False),
                    is_valid=is_valid,
                )
            )
        batch.total_rows = len(parsed_rows)
        batch.valid_rows = valid
        batch.invalid_rows = invalid
        batch.status = ImportStatus.REVIEW_REQUIRED.value
        batch.report_json = json.dumps(
            {"warnings": warnings, "valid_rows": valid, "invalid_rows": invalid},
            ensure_ascii=False,
            sort_keys=True,
        )
        db.flush()
        emit_audit_event(
            db,
            organization_id=identity.organization_id,
            actor_id=identity.user_id,
            request_id=request_id,
            entity_type="import_batch",
            entity_id=batch.id,
            action="import.staged",
            after={
                "operation_id": str(operation_id),
                "filename": filename,
                "file_sha256": digest,
                "total_rows": batch.total_rows,
                "valid_rows": valid,
                "invalid_rows": invalid,
            },
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import dosyası daha önce işlendi.") from exc
    return get_import_preview(db, identity, batch.id)


def get_import_preview(
    db: Session, identity: IdentityContext, batch_id: uuid.UUID
) -> ImportPreviewRead:
    batch = ImportRepository.get_batch(db, identity.organization_id, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch bulunamadı.")
    rows = ImportRepository.rows(db, identity.organization_id, batch_id)
    report = json.loads(batch.report_json or "{}")
    return ImportPreviewRead(
        batch=_import_batch_read(batch),
        rows=[_import_row_read(row) for row in rows],
        warnings=list(report.get("warnings", [])),
    )


def commit_import(
    db: Session,
    identity: IdentityContext,
    batch_id: uuid.UUID,
    request_id: str,
) -> ImportCommitRead:
    batch = ImportRepository.get_batch(db, identity.organization_id, batch_id)
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch bulunamadı.")
    if batch.status == ImportStatus.COMMITTED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import batch zaten commit edildi.")
    if batch.status != ImportStatus.REVIEW_REQUIRED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import batch commit edilmeye hazır değil.")
    operation = OperationRepository.get(db, identity.organization_id, batch.operation_id)
    if operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import operasyonu bulunamadı.")

    rows = ImportRepository.rows(db, identity.organization_id, batch_id)
    created = 0
    skipped = 0
    for row in rows:
        if not row.is_valid:
            continue
        normalized = json.loads(row.normalized_json)
        passport_hash = str(normalized["passport_hash"])
        if PassengerRepository.duplicate_exists(
            db, identity.organization_id, operation.id, passport_hash
        ):
            skipped += 1
            continue
        passenger = Passenger(
            organization_id=identity.organization_id,
            operation_id=operation.id,
            first_name=str(normalized["first_name"]),
            last_name=str(normalized["last_name"]),
            passport_ciphertext=str(normalized["passport_ciphertext"]),
            passport_hash=passport_hash,
            voucher=str(normalized.get("voucher", "")),
            arrival_date=(
                datetime.fromisoformat(normalized["arrival_date"]).date()
                if normalized.get("arrival_date")
                else None
            ),
            adult_fee=normalized.get("adult_fee", "0.00"),
            child_fee=normalized.get("child_fee", "0.00"),
            currency=str(normalized.get("currency", "EUR")),
            source_file=str(normalized.get("source_file", batch.filename)),
            source_row=int(normalized.get("source_row") or row.row_number),
        )
        db.add(passenger)
        db.flush()
        emit_audit_event(
            db,
            organization_id=identity.organization_id,
            actor_id=identity.user_id,
            request_id=request_id,
            entity_type="passenger",
            entity_id=passenger.id,
            action="passenger.imported",
            after=_passenger_snapshot(passenger),
            metadata={"import_batch_id": str(batch.id), "source_row": row.row_number},
        )
        created += 1

    batch.status = ImportStatus.COMMITTED.value
    report = json.loads(batch.report_json or "{}")
    report["commit"] = {"created": created, "skipped_duplicates": skipped}
    batch.report_json = json.dumps(report, ensure_ascii=False, sort_keys=True)
    emit_audit_event(
        db,
        organization_id=identity.organization_id,
        actor_id=identity.user_id,
        request_id=request_id,
        entity_type="import_batch",
        entity_id=batch.id,
        action="import.committed",
        before={"status": ImportStatus.REVIEW_REQUIRED.value},
        after={"status": ImportStatus.COMMITTED.value, "created": created, "skipped_duplicates": skipped},
    )
    db.commit()
    return ImportCommitRead(
        batch_id=batch.id,
        status=batch.status,
        created=created,
        skipped_duplicates=skipped,
        invalid_rows=batch.invalid_rows,
    )



def verify_audit_chain(db: Session, identity: IdentityContext) -> AuditVerifyRead:
    events = list(reversed(AuditRepository.list(db, identity.organization_id, 100000)))
    previous_hash = ""
    expected_position = 1
    for event in events:
        if event.chain_position != expected_position:
            return AuditVerifyRead(
                valid=False,
                event_count=len(events),
                last_hash=previous_hash,
                error=f"Beklenen chain_position={expected_position}, bulunan={event.chain_position}",
            )
        if event.previous_event_hash != previous_hash:
            return AuditVerifyRead(
                valid=False,
                event_count=len(events),
                last_hash=previous_hash,
                error=f"Zincir bağlantısı bozuk: position={event.chain_position}",
            )
        envelope = {
            "organization_id": str(event.organization_id),
            "actor_id": str(event.actor_id),
            "request_id": event.request_id,
            "entity_type": event.entity_type,
            "entity_id": str(event.entity_id),
            "action": event.action,
            "chain_position": event.chain_position,
            "before_hash": event.before_hash,
            "after_hash": event.after_hash,
            "metadata_json": event.metadata_json,
            "previous_event_hash": event.previous_event_hash,
        }
        calculated = canonical_hash(envelope)
        if calculated != event.event_hash:
            return AuditVerifyRead(
                valid=False,
                event_count=len(events),
                last_hash=previous_hash,
                error=f"Event hash uyuşmuyor: position={event.chain_position}",
            )
        previous_hash = event.event_hash
        expected_position += 1
    return AuditVerifyRead(valid=True, event_count=len(events), last_hash=previous_hash)
