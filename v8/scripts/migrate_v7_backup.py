from __future__ import annotations

import argparse
import json
import uuid
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.audit import emit_audit_event
from app.database import get_session_factory
from app.models import Membership, Operation, OperationStatus, Passenger
from app.repositories import PassengerRepository
from app.security import get_codec


def text(value) -> str:
    if value is None:
        return ""
    result = str(value).strip()
    return "" if result.casefold() == "nan" else result


def parse_date(value) -> date | None:
    raw = text(value)
    if not raw:
        return None
    for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    return None


def parse_money(value) -> Decimal:
    raw = text(value).replace("€", "").replace(" ", "")
    if not raw:
        return Decimal("0.00")
    if raw.count(",") == 1 and raw.count(".") == 0:
        raw = raw.replace(",", ".")
    elif raw.count(",") == 1 and raw.count(".") == 1 and raw.index(".") < raw.index(","):
        raw = raw.replace(".", "").replace(",", ".")
    try:
        return Decimal(raw).quantize(Decimal("0.01"))
    except InvalidOperation:
        return Decimal("0.00")


def names(record: dict) -> tuple[str, str]:
    first = text(record.get("Ad"))
    last = text(record.get("Soyad"))
    if first or last:
        return first or "Bilinmiyor", last or "Bilinmiyor"
    full = text(record.get("Yolcu Adı Soyadı"))
    parts = full.split()
    if len(parts) >= 2:
        return " ".join(parts[:-1]), parts[-1]
    return full or "Bilinmiyor", "Bilinmiyor"


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate a V7 JSON backup into the V8 relational schema.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--organization-id", required=True, type=uuid.UUID)
    parser.add_argument("--actor-id", required=True, type=uuid.UUID)
    parser.add_argument("--origin", default="Kuşadası")
    parser.add_argument("--destination", default="Samos")
    args = parser.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    records = list(payload.get("passengers", []))
    grouped: dict[date, list[dict]] = defaultdict(list)
    undated: list[dict] = []
    for record in records:
        departure = parse_date(record.get("Gidiş Tarihi"))
        if departure is None:
            undated.append(record)
        else:
            grouped[departure].append(record)

    db = get_session_factory()()
    codec = get_codec()
    created_operations = 0
    created_passengers = 0
    duplicate_passengers = 0
    skipped_without_passport = 0
    try:
        membership = db.scalar(
            select(Membership).where(
                Membership.organization_id == args.organization_id,
                Membership.user_id == args.actor_id,
                Membership.is_active.is_(True),
            )
        )
        if membership is None:
            raise SystemExit("Actor does not have an active membership in the target organization.")

        for departure, rows in sorted(grouped.items()):
            code = f"LEGACY-{departure:%Y%m%d}"
            operation = db.scalar(
                select(Operation).where(
                    Operation.organization_id == args.organization_id,
                    Operation.code == code,
                )
            )
            if operation is None:
                operation = Operation(
                    organization_id=args.organization_id,
                    code=code,
                    route_origin=args.origin,
                    route_destination=args.destination,
                    departure_date=departure,
                    status=OperationStatus.DRAFT.value,
                    notes="V7 JSON backup migration",
                )
                db.add(operation)
                db.flush()
                created_operations += 1

            for row_number, record in enumerate(rows, start=1):
                passport = text(record.get("Pasaport No"))
                if not passport:
                    skipped_without_passport += 1
                    continue
                passport_hash = codec.passport_hash(passport)
                if PassengerRepository.duplicate_exists(
                    db, args.organization_id, operation.id, passport_hash
                ):
                    duplicate_passengers += 1
                    continue
                first_name, last_name = names(record)
                db.add(
                    Passenger(
                        organization_id=args.organization_id,
                        operation_id=operation.id,
                        first_name=first_name,
                        last_name=last_name,
                        passport_ciphertext=codec.encrypt_passport(passport),
                        passport_hash=passport_hash,
                        voucher=text(record.get("Voucher")),
                        arrival_date=parse_date(record.get("Varış Tarihi")),
                        adult_fee=parse_money(record.get("Vize Ücreti Yetişkin")),
                        child_fee=parse_money(record.get("Vize Ücreti Çocuk")),
                        currency="EUR",
                        source_file=text(record.get("Kaynak Dosya")) or args.input.name,
                        source_row=row_number,
                    )
                )
                created_passengers += 1

        migration_id = uuid.uuid4()
        emit_audit_event(
            db,
            organization_id=args.organization_id,
            actor_id=args.actor_id,
            request_id=f"v7-migration:{migration_id}",
            entity_type="migration",
            entity_id=migration_id,
            action="v7_backup.migrated",
            after={
                "input": args.input.name,
                "operations": created_operations,
                "passengers": created_passengers,
                "duplicates": duplicate_passengers,
                "skipped_without_passport": skipped_without_passport,
                "undated_rows": len(undated),
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    print(
        json.dumps(
            {
                "created_operations": created_operations,
                "created_passengers": created_passengers,
                "duplicate_passengers": duplicate_passengers,
                "skipped_without_passport": skipped_without_passport,
                "undated_rows": len(undated),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
