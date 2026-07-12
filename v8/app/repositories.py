from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from .models import AuditEvent, ImportBatch, ImportRow, Operation, Passenger

_NO_FEE = and_(Passenger.adult_fee == 0, Passenger.child_fee == 0)
_NO_VOUCHER = func.trim(Passenger.voucher) == ""

# V7'deki durum filtrelerinin V8 karşılıkları. Pasaport V8'de zorunlu ve
# operasyon içinde tekil olduğundan "Pasaportsuz"/"Tekrarlı" filtrelerine
# gerek kalmaz.
PASSENGER_STATUS_FILTERS = {
    "fotosuz": Passenger.photo_object_key.is_(None),
    "fotografli": Passenger.photo_object_key.is_not(None),
    "vouchersiz": _NO_VOUCHER,
    "ucretsiz": _NO_FEE,
    "eksik": or_(Passenger.photo_object_key.is_(None), _NO_VOUCHER, _NO_FEE),
    "hazir": and_(
        Passenger.photo_object_key.is_not(None),
        func.trim(Passenger.voucher) != "",
        or_(Passenger.adult_fee > 0, Passenger.child_fee > 0),
    ),
}


def _passenger_conditions(
    organization_id: uuid.UUID,
    operation_id: uuid.UUID,
    search: str = "",
    passport_hash: str | None = None,
    status: str = "",
) -> list:
    conditions = [
        Passenger.organization_id == organization_id,
        Passenger.operation_id == operation_id,
        Passenger.deleted_at.is_(None),
    ]
    if search:
        needle = f"%{search.casefold()}%"
        text_match = or_(
            func.lower(Passenger.first_name).like(needle),
            func.lower(Passenger.last_name).like(needle),
            func.lower(Passenger.first_name + " " + Passenger.last_name).like(needle),
            func.lower(Passenger.voucher).like(needle),
        )
        if passport_hash:
            text_match = or_(text_match, Passenger.passport_hash == passport_hash)
        conditions.append(text_match)
    status_condition = PASSENGER_STATUS_FILTERS.get(status)
    if status_condition is not None:
        conditions.append(status_condition)
    return conditions


def _passenger_order(sort: str) -> tuple:
    if sort == "arrival":
        return (Passenger.arrival_date.asc().nulls_last(), Passenger.last_name, Passenger.first_name)
    if sort == "recent":
        return (Passenger.created_at.desc(),)
    return (Passenger.last_name, Passenger.first_name, Passenger.created_at)


class OperationRepository:
    @staticmethod
    def get(db: Session, organization_id: uuid.UUID, operation_id: uuid.UUID) -> Operation | None:
        return db.scalar(
            select(Operation).where(
                Operation.id == operation_id,
                Operation.organization_id == organization_id,
                Operation.deleted_at.is_(None),
            )
        )

    @staticmethod
    def list(db: Session, organization_id: uuid.UUID, limit: int = 100, offset: int = 0) -> Sequence[Operation]:
        return db.scalars(
            select(Operation)
            .where(Operation.organization_id == organization_id, Operation.deleted_at.is_(None))
            .order_by(Operation.departure_date.desc(), Operation.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).all()

    @staticmethod
    def count(db: Session, organization_id: uuid.UUID) -> int:
        return int(
            db.scalar(
                select(func.count())
                .select_from(Operation)
                .where(Operation.organization_id == organization_id, Operation.deleted_at.is_(None))
            )
            or 0
        )


class PassengerRepository:
    @staticmethod
    def get(db: Session, organization_id: uuid.UUID, passenger_id: uuid.UUID) -> Passenger | None:
        return db.scalar(
            select(Passenger).where(
                Passenger.id == passenger_id,
                Passenger.organization_id == organization_id,
                Passenger.deleted_at.is_(None),
            )
        )

    @staticmethod
    def list_for_operation(
        db: Session,
        organization_id: uuid.UUID,
        operation_id: uuid.UUID,
        limit: int = 500,
        offset: int = 0,
        search: str = "",
        passport_hash: str | None = None,
        status: str = "",
        sort: str = "",
    ) -> Sequence[Passenger]:
        return db.scalars(
            select(Passenger)
            .where(*_passenger_conditions(organization_id, operation_id, search, passport_hash, status))
            .order_by(*_passenger_order(sort))
            .limit(limit)
            .offset(offset)
        ).all()

    @staticmethod
    def count_for_operation(
        db: Session,
        organization_id: uuid.UUID,
        operation_id: uuid.UUID,
        search: str = "",
        passport_hash: str | None = None,
        status: str = "",
    ) -> int:
        return int(
            db.scalar(
                select(func.count())
                .select_from(Passenger)
                .where(*_passenger_conditions(organization_id, operation_id, search, passport_hash, status))
            )
            or 0
        )

    @staticmethod
    def duplicate_exists(
        db: Session,
        organization_id: uuid.UUID,
        operation_id: uuid.UUID,
        passport_hash: str,
        exclude_id: uuid.UUID | None = None,
    ) -> bool:
        query = select(Passenger.id).where(
            Passenger.organization_id == organization_id,
            Passenger.operation_id == operation_id,
            Passenger.passport_hash == passport_hash,
            Passenger.deleted_at.is_(None),
        )
        if exclude_id:
            query = query.where(Passenger.id != exclude_id)
        return db.scalar(query.limit(1)) is not None


class AuditRepository:
    @staticmethod
    def list(db: Session, organization_id: uuid.UUID, limit: int = 100) -> Sequence[AuditEvent]:
        return db.scalars(
            select(AuditEvent)
            .where(AuditEvent.organization_id == organization_id)
            .order_by(AuditEvent.chain_position.desc())
            .limit(limit)
        ).all()

    @staticmethod
    def events_after(
        db: Session, organization_id: uuid.UUID, position: int, limit: int = 5000
    ) -> Sequence[AuditEvent]:
        return db.scalars(
            select(AuditEvent)
            .where(
                AuditEvent.organization_id == organization_id,
                AuditEvent.chain_position > position,
            )
            .order_by(AuditEvent.chain_position.asc())
            .limit(limit)
        ).all()

    @staticmethod
    def count(db: Session, organization_id: uuid.UUID) -> int:
        return int(
            db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(AuditEvent.organization_id == organization_id)
            )
            or 0
        )


class ImportRepository:
    @staticmethod
    def get_batch(db: Session, organization_id: uuid.UUID, batch_id: uuid.UUID) -> ImportBatch | None:
        return db.scalar(
            select(ImportBatch).where(
                ImportBatch.id == batch_id,
                ImportBatch.organization_id == organization_id,
            )
        )

    @staticmethod
    def get_batch_locked(db: Session, organization_id: uuid.UUID, batch_id: uuid.UUID) -> ImportBatch | None:
        return db.scalar(
            select(ImportBatch)
            .where(
                ImportBatch.id == batch_id,
                ImportBatch.organization_id == organization_id,
            )
            .with_for_update()
        )

    @staticmethod
    def find_by_hash(db: Session, organization_id: uuid.UUID, file_sha256: str) -> ImportBatch | None:
        return db.scalar(
            select(ImportBatch).where(
                ImportBatch.organization_id == organization_id,
                ImportBatch.file_sha256 == file_sha256,
            )
        )

    @staticmethod
    def rows(db: Session, organization_id: uuid.UUID, batch_id: uuid.UUID) -> Sequence[ImportRow]:
        return db.scalars(
            select(ImportRow)
            .where(ImportRow.organization_id == organization_id, ImportRow.batch_id == batch_id)
            .order_by(ImportRow.row_number)
        ).all()
