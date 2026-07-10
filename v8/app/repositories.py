from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditEvent, ImportBatch, ImportRow, Operation, Passenger


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
        db: Session, organization_id: uuid.UUID, operation_id: uuid.UUID, limit: int = 500, offset: int = 0
    ) -> Sequence[Passenger]:
        return db.scalars(
            select(Passenger)
            .where(
                Passenger.organization_id == organization_id,
                Passenger.operation_id == operation_id,
                Passenger.deleted_at.is_(None),
            )
            .order_by(Passenger.last_name, Passenger.first_name, Passenger.created_at)
            .limit(limit)
            .offset(offset)
        ).all()

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
