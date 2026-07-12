from __future__ import annotations

import hashlib
import io
import json
import re
import uuid
import zipfile
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from .audit import canonical_hash, emit_audit_event
from .auth import IdentityContext
from .models import (
    AuditCheckpoint,
    ImportBatch,
    ImportRow,
    ImportStatus,
    Operation,
    OperationStatus,
    Passenger,
    StoredObject,
)
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
    Page,
    PassengerCreate,
    PassengerPhotoRead,
    PassengerRead,
    PassengerUpdate,
    PassportRevealRead,
    PhotoMatchItem,
    PhotoMatchRead,
)
from .security import get_codec, normalize_passport
from .storage import get_storage
from . import import_adapter


def _stale_write_conflict(db: Session, message: str) -> HTTPException:
    db.rollback()
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


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


def _mask_passport(passport_no: str) -> str:
    normalized = normalize_passport(passport_no)
    if len(normalized) <= 4:
        return "*" * len(normalized)
    return "*" * (len(normalized) - 4) + normalized[-4:]


def _passenger_read(passenger: Passenger) -> PassengerRead:
    codec = get_codec()
    return PassengerRead(
        id=passenger.id,
        organization_id=passenger.organization_id,
        operation_id=passenger.operation_id,
        first_name=passenger.first_name,
        last_name=passenger.last_name,
        full_name=f"{passenger.first_name} {passenger.last_name}".strip(),
        passport_masked=_mask_passport(codec.decrypt_passport(passenger.passport_ciphertext)),
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


def _page(items: list, total: int, limit: int, offset: int) -> Page:
    next_offset = offset + limit if offset + limit < total else None
    return Page(items=items, total=total, limit=limit, offset=offset, next_offset=next_offset)


def list_operations(db: Session, identity: IdentityContext, limit: int, offset: int) -> Page[OperationRead]:
    items = [
        OperationRead.model_validate(item)
        for item in OperationRepository.list(db, identity.organization_id, limit, offset)
    ]
    total = OperationRepository.count(db, identity.organization_id)
    return _page(items, total, limit, offset)


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
    try:
        db.flush()
    except StaleDataError as exc:
        raise _stale_write_conflict(db, "Operasyon başka bir kullanıcı tarafından güncellendi.") from exc
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
    try:
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
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu pasaport operasyonda zaten kayıtlı.") from exc
    db.refresh(passenger)
    return _passenger_read(passenger)


def list_passengers(
    db: Session,
    identity: IdentityContext,
    operation_id: uuid.UUID,
    limit: int,
    offset: int,
    search: str = "",
    status_filter: str = "",
    sort: str = "",
) -> Page[PassengerRead]:
    operation = OperationRepository.get(db, identity.organization_id, operation_id)
    if operation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operasyon bulunamadı.")
    search = search.strip()
    # Pasaportlar şifreli saklandığından metin araması yerine, arama terimi
    # pasaporta benziyorsa HMAC parmak iziyle tam eşleşme yapılır.
    passport_hash = None
    if search and len(normalize_passport(search)) >= 3:
        passport_hash = get_codec().passport_hash(search)
    items = [
        _passenger_read(item)
        for item in PassengerRepository.list_for_operation(
            db,
            identity.organization_id,
            operation_id,
            limit,
            offset,
            search=search,
            passport_hash=passport_hash,
            status=status_filter,
            sort=sort,
        )
    ]
    total = PassengerRepository.count_for_operation(
        db,
        identity.organization_id,
        operation_id,
        search=search,
        passport_hash=passport_hash,
        status=status_filter,
    )
    return _page(items, total, limit, offset)


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
    try:
        db.flush()
    except StaleDataError as exc:
        raise _stale_write_conflict(db, "Yolcu başka bir kullanıcı tarafından güncellendi.") from exc
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
    try:
        db.flush()
    except StaleDataError as exc:
        raise _stale_write_conflict(db, "Yolcu başka bir kullanıcı tarafından güncellendi.") from exc
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


def reveal_passport(
    db: Session,
    identity: IdentityContext,
    passenger_id: uuid.UUID,
    request_id: str,
) -> PassportRevealRead:
    passenger = PassengerRepository.get(db, identity.organization_id, passenger_id)
    if passenger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu bulunamadı.")
    codec = get_codec()
    passport_no = codec.decrypt_passport(passenger.passport_ciphertext)
    emit_audit_event(
        db,
        organization_id=identity.organization_id,
        actor_id=identity.user_id,
        request_id=request_id,
        entity_type="passenger",
        entity_id=passenger.id,
        action="passenger.passport_revealed",
        metadata={"passport_hash": passenger.passport_hash},
    )
    db.commit()
    return PassportRevealRead(passenger_id=passenger.id, passport_no=passport_no)


_ALLOWED_PHOTO_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def upload_passenger_photo(
    db: Session,
    identity: IdentityContext,
    passenger_id: uuid.UUID,
    filename: str,
    mime_type: str,
    data: bytes,
    request_id: str,
) -> PassengerPhotoRead:
    passenger = PassengerRepository.get(db, identity.organization_id, passenger_id)
    if passenger is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu bulunamadı.")
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Fotoğraf dosyası boş.")
    suffix = _ALLOWED_PHOTO_TYPES.get(mime_type)
    if suffix is None:
        # iPhone HEIC gibi formatlar tarayıcı dostu JPEG'e çevrilerek kabul edilir.
        converted = _photo_to_jpeg(data)
        if converted is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Fotoğraf okunamadı; JPEG, PNG, WebP veya HEIC yükleyin.",
            )
        data, mime_type, suffix = converted, "image/jpeg", ".jpg"
    storage = get_storage()
    name = filename if filename.lower().endswith(suffix) else f"photo{suffix}"
    blob = storage.put(organization_id=identity.organization_id, name=name, data=data, mime_type=mime_type)
    before = _passenger_snapshot(passenger)
    previous_key = passenger.photo_object_key

    existing = db.scalar(
        select(StoredObject).where(
            StoredObject.organization_id == identity.organization_id,
            StoredObject.object_key == blob.object_key,
        )
    )
    if existing is None:
        db.add(
            StoredObject(
                organization_id=identity.organization_id,
                object_key=blob.object_key,
                sha256=blob.sha256,
                mime_type=blob.mime_type,
                size_bytes=blob.size_bytes,
                purpose="passenger_photo",
                created_by=identity.user_id,
            )
        )
    elif existing.deleted_at is not None:
        existing.deleted_at = None
    passenger.photo_object_key = blob.object_key
    try:
        db.flush()
    except StaleDataError as exc:
        raise _stale_write_conflict(db, "Yolcu başka bir kullanıcı tarafından güncellendi.") from exc
    emit_audit_event(
        db,
        organization_id=identity.organization_id,
        actor_id=identity.user_id,
        request_id=request_id,
        entity_type="passenger",
        entity_id=passenger.id,
        action="passenger.photo_uploaded",
        before=before,
        after=_passenger_snapshot(passenger),
        metadata={"object_key": blob.object_key, "sha256": blob.sha256, "previous_object_key": previous_key},
    )
    db.commit()
    db.refresh(passenger)
    return PassengerPhotoRead(
        passenger_id=passenger.id,
        object_key=blob.object_key,
        sha256=blob.sha256,
        size_bytes=blob.size_bytes,
        mime_type=blob.mime_type,
        version=passenger.version,
    )


def get_passenger_photo(
    db: Session, identity: IdentityContext, passenger_id: uuid.UUID
) -> tuple[bytes, str]:
    passenger = PassengerRepository.get(db, identity.organization_id, passenger_id)
    if passenger is None or not passenger.photo_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu fotoğrafı bulunamadı.")
    metadata = db.scalar(
        select(StoredObject).where(
            StoredObject.organization_id == identity.organization_id,
            StoredObject.object_key == passenger.photo_object_key,
            StoredObject.deleted_at.is_(None),
        )
    )
    if metadata is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fotoğraf metadata kaydı bulunamadı.")
    try:
        data = get_storage().get(passenger.photo_object_key)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fotoğraf nesnesi bulunamadı.") from exc
    return data, metadata.mime_type


def delete_passenger_photo(
    db: Session,
    identity: IdentityContext,
    passenger_id: uuid.UUID,
    request_id: str,
) -> None:
    passenger = PassengerRepository.get(db, identity.organization_id, passenger_id)
    if passenger is None or not passenger.photo_object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu fotoğrafı bulunamadı.")
    before = _passenger_snapshot(passenger)
    object_key = passenger.photo_object_key
    passenger.photo_object_key = None
    # Object keys are content-addressed, so identical photos share a key within the
    # organization; only retire the metadata and blob when no other passenger uses it.
    other_reference = db.scalar(
        select(Passenger.id)
        .where(
            Passenger.organization_id == identity.organization_id,
            Passenger.photo_object_key == object_key,
            Passenger.id != passenger.id,
            Passenger.deleted_at.is_(None),
        )
        .limit(1)
    )
    if other_reference is None:
        metadata = db.scalar(
            select(StoredObject).where(
                StoredObject.organization_id == identity.organization_id,
                StoredObject.object_key == object_key,
                StoredObject.deleted_at.is_(None),
            )
        )
        if metadata is not None:
            metadata.deleted_at = datetime.now(UTC)
    try:
        db.flush()
    except StaleDataError as exc:
        raise _stale_write_conflict(db, "Yolcu başka bir kullanıcı tarafından güncellendi.") from exc
    emit_audit_event(
        db,
        organization_id=identity.organization_id,
        actor_id=identity.user_id,
        request_id=request_id,
        entity_type="passenger",
        entity_id=passenger.id,
        action="passenger.photo_deleted",
        before=before,
        after=_passenger_snapshot(passenger),
        metadata={"object_key": object_key},
    )
    db.commit()
    if other_reference is None:
        get_storage().delete(object_key)


def _norm_key(value: object) -> str:
    """Pasaport / isim eşleştirmesi için sadeleştirir (V7 ile aynı kural)."""
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _photo_to_jpeg(data: bytes) -> bytes | None:
    """Her formatı (HEIC dahil) tarayıcı dostu küçük JPEG'e çevirir."""
    try:
        from PIL import Image

        try:
            import pillow_heif

            pillow_heif.register_heif_opener()
        except Exception:
            pass
        image = Image.open(io.BytesIO(data))
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.thumbnail((960, 960))
        out = io.BytesIO()
        image.save(out, format="JPEG", quality=85, optimize=True)
        return out.getvalue()
    except Exception:
        return None


def _extract_zip_images(data: bytes) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for info in archive.infolist():
                if info.is_dir() or "__MACOSX" in info.filename:
                    continue
                base = info.filename.rsplit("/", 1)[-1]
                if not base or base.startswith("."):
                    continue
                try:
                    out.append((base, archive.read(info)))
                except Exception:
                    continue
    except Exception:
        pass
    return out


def match_passenger_photos(
    db: Session,
    identity: IdentityContext,
    files: list[tuple[str, bytes]],
    request_id: str,
) -> PhotoMatchRead:
    """Fotoğrafları dosya adına göre yolculara otomatik bağlar.

    Eşleştirme konumdan bağımsızdır: dosya adının sadeleştirilmiş hali içinde
    pasaport numarası (en uzun eşleşme) ya da ad+soyad aranır. ZIP arşivleri
    açılıp içindeki görüntüler tek tek işlenir.
    """
    expanded: list[tuple[str, bytes]] = []
    for filename, data in files:
        if filename.lower().endswith(".zip") or data[:4] == b"PK\x03\x04":
            expanded.extend(_extract_zip_images(data))
        else:
            expanded.append((filename, data))

    codec = get_codec()
    candidates: list[dict[str, Any]] = []
    for passenger in db.scalars(
        select(Passenger).where(
            Passenger.organization_id == identity.organization_id,
            Passenger.deleted_at.is_(None),
        )
    ):
        try:
            passport = _norm_key(codec.decrypt_passport(passenger.passport_ciphertext))
        except ValueError:
            continue
        candidates.append(
            {
                "passenger": passenger,
                "passport": passport,
                "full_name": _norm_key(passenger.first_name + passenger.last_name),
                "first": _norm_key(passenger.first_name),
                "last": _norm_key(passenger.last_name),
            }
        )

    matched = 0
    unmatched: list[str] = []
    attached: list[PhotoMatchItem] = []
    for filename, data in expanded:
        stem = filename.rsplit(".", 1)[0] if "." in filename else filename
        full = _norm_key(stem)
        target: Passenger | None = None

        best_len = 0
        for row in candidates:
            passport = row["passport"]
            if passport and len(passport) >= 4 and passport in full and len(passport) > best_len:
                target = row["passenger"]
                best_len = len(passport)
        if target is None:
            for row in candidates:
                if row["full_name"] and len(row["full_name"]) >= 4 and row["full_name"] in full:
                    target = row["passenger"]
                    break
        if target is None:
            for row in candidates:
                if row["first"] and row["last"] and row["first"] in full and row["last"] in full:
                    target = row["passenger"]
                    break
        if target is None:
            unmatched.append(filename)
            continue

        jpeg = _photo_to_jpeg(data)
        if jpeg is None:
            unmatched.append(f"{filename} (görüntü okunamadı)")
            continue
        upload_passenger_photo(
            db,
            identity,
            target.id,
            f"{stem}.jpg",
            "image/jpeg",
            jpeg,
            request_id,
        )
        matched += 1
        attached.append(
            PhotoMatchItem(
                passenger_id=target.id,
                passenger_name=f"{target.first_name} {target.last_name}".strip(),
                filename=filename,
            )
        )

    return PhotoMatchRead(matched=matched, unmatched=unmatched, attached=attached)


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
    # The batch row is locked so two concurrent commit requests serialize;
    # the loser then observes COMMITTED status and receives a 409.
    batch = ImportRepository.get_batch_locked(db, identity.organization_id, batch_id)
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
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Eşzamanlı bir işlem aynı pasaportları ekledi; import'u yeniden deneyin.",
        ) from exc
    return ImportCommitRead(
        batch_id=batch.id,
        status=batch.status,
        created=created,
        skipped_duplicates=skipped,
        invalid_rows=batch.invalid_rows,
    )



def setup_required(db: Session) -> bool:
    from .models import Organization

    return db.scalar(select(Organization.id).limit(1)) is None


def first_run_setup(db: Session, organization_name: str, email: str, display_name: str) -> tuple:
    """Creates the first organization and owner. Only allowed while the
    database has no organizations, so it cannot be abused after go-live."""
    from .models import Membership, Organization, Role, User

    if not setup_required(db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Kurulum zaten tamamlanmış.",
        )
    organization = Organization(name=organization_name, slug="excelbase")
    user = User(email=email, display_name=display_name)
    db.add_all([organization, user])
    try:
        db.flush()
        db.add(
            Membership(
                organization_id=organization.id,
                user_id=user.id,
                role=Role.OWNER.value,
            )
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Kurulum zaten tamamlanmış.") from exc
    return organization.id, user.id


_VERIFY_BATCH_SIZE = 5000


def verify_audit_chain(db: Session, identity: IdentityContext) -> AuditVerifyRead:
    """Verifies the chain incrementally from the last stored checkpoint.

    Only events after the checkpoint are replayed; on success the checkpoint
    advances so subsequent verifications stay cheap as the chain grows.
    """
    checkpoint = db.get(AuditCheckpoint, identity.organization_id)
    start_position = checkpoint.verified_position if checkpoint else 0
    previous_hash = checkpoint.verified_hash if checkpoint else ""
    expected_position = start_position + 1
    total_events = AuditRepository.count(db, identity.organization_id)

    def failure(message: str) -> AuditVerifyRead:
        return AuditVerifyRead(
            valid=False,
            event_count=total_events,
            last_hash=previous_hash,
            checkpoint_position=start_position,
            error=message,
        )

    while True:
        events = AuditRepository.events_after(
            db, identity.organization_id, expected_position - 1, _VERIFY_BATCH_SIZE
        )
        if not events:
            break
        for event in events:
            if event.chain_position != expected_position:
                return failure(f"Beklenen chain_position={expected_position}, bulunan={event.chain_position}")
            if event.previous_event_hash != previous_hash:
                return failure(f"Zincir bağlantısı bozuk: position={event.chain_position}")
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
            if canonical_hash(envelope) != event.event_hash:
                return failure(f"Event hash uyuşmuyor: position={event.chain_position}")
            previous_hash = event.event_hash
            expected_position += 1
        if len(events) < _VERIFY_BATCH_SIZE:
            break

    verified_position = expected_position - 1
    if checkpoint is None:
        checkpoint = AuditCheckpoint(
            organization_id=identity.organization_id,
            verified_position=verified_position,
            verified_hash=previous_hash,
        )
        db.add(checkpoint)
    else:
        checkpoint.verified_position = verified_position
        checkpoint.verified_hash = previous_hash
    db.commit()
    return AuditVerifyRead(
        valid=True,
        event_count=total_events,
        last_hash=previous_hash,
        checkpoint_position=verified_position,
    )
