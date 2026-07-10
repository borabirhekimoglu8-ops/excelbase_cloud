from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import OperationStatus, Role
from .security import normalize_passport


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OrganizationCreate(StrictModel):
    name: str = Field(min_length=2, max_length=160)
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$")


class OrganizationRead(StrictModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    created_at: datetime


class UserCreate(StrictModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=2, max_length=160)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.casefold()
        if "@" not in value:
            raise ValueError("Geçerli bir e-posta adresi girilmelidir.")
        return value


class MembershipCreate(StrictModel):
    user_id: uuid.UUID
    role: Role


class OperationCreate(StrictModel):
    code: str = Field(min_length=2, max_length=80)
    route_origin: str = Field(min_length=2, max_length=120)
    route_destination: str = Field(min_length=2, max_length=120)
    departure_date: date
    vessel_name: str = Field(default="", max_length=160)
    notes: str = Field(default="", max_length=5000)


class OperationUpdate(StrictModel):
    version: int = Field(ge=1)
    status: OperationStatus | None = None
    vessel_name: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=5000)


class OperationRead(StrictModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    organization_id: uuid.UUID
    code: str
    route_origin: str
    route_destination: str
    departure_date: date
    vessel_name: str
    status: str
    notes: str
    version: int
    created_at: datetime
    updated_at: datetime


class PassengerCreate(StrictModel):
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    passport_no: str = Field(min_length=3, max_length=32)
    voucher: str = Field(default="", max_length=160)
    arrival_date: date | None = None
    adult_fee: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    child_fee: Decimal = Field(default=Decimal("0.00"), ge=0, max_digits=12, decimal_places=2)
    currency: str = Field(default="EUR", pattern=r"^[A-Z]{3}$")
    source_file: str = Field(default="", max_length=255)
    source_row: int | None = Field(default=None, ge=1)

    @field_validator("passport_no")
    @classmethod
    def passport_is_usable(cls, value: str) -> str:
        normalized = normalize_passport(value)
        if len(normalized) < 3:
            raise ValueError("Pasaport numarası geçersiz.")
        return normalized


class PassengerUpdate(StrictModel):
    version: int = Field(ge=1)
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, min_length=1, max_length=120)
    passport_no: str | None = Field(default=None, min_length=3, max_length=32)
    voucher: str | None = Field(default=None, max_length=160)
    arrival_date: date | None = None
    adult_fee: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    child_fee: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")

    @field_validator("passport_no")
    @classmethod
    def normalize_optional_passport(cls, value: str | None) -> str | None:
        return normalize_passport(value) if value is not None else None


class PassengerRead(StrictModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    operation_id: uuid.UUID
    first_name: str
    last_name: str
    full_name: str
    passport_no: str
    voucher: str
    arrival_date: date | None
    adult_fee: Decimal
    child_fee: Decimal
    currency: str
    source_file: str
    source_row: int | None
    photo_object_key: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class AuditEventRead(StrictModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    organization_id: uuid.UUID
    actor_id: uuid.UUID
    request_id: str
    entity_type: str
    entity_id: uuid.UUID
    action: str
    chain_position: int
    before_hash: str
    after_hash: str
    previous_event_hash: str
    event_hash: str
    created_at: datetime


class HealthRead(StrictModel):
    status: str
    version: str
    database: str


class ImportBatchRead(StrictModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    organization_id: uuid.UUID
    operation_id: uuid.UUID
    filename: str
    file_sha256: str
    status: str
    total_rows: int
    valid_rows: int
    invalid_rows: int
    created_at: datetime
    updated_at: datetime


class ImportRowRead(StrictModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    row_number: int
    is_valid: bool
    errors: list[str]
    preview: dict


class ImportPreviewRead(StrictModel):
    batch: ImportBatchRead
    rows: list[ImportRowRead]
    warnings: list[str]


class ImportCommitRead(StrictModel):
    batch_id: uuid.UUID
    status: str
    created: int
    skipped_duplicates: int
    invalid_rows: int


class AuditVerifyRead(StrictModel):
    valid: bool
    event_count: int
    last_hash: str
    error: str = ""
