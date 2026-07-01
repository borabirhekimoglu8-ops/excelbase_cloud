from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class PassengerRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    no: str
    first_name: str
    last_name: str
    full_name: str
    passport_no: str
    voucher: str
    departure_date: str
    arrival_date: str
    adult_fee: str
    child_fee: str
    source_file: str
    sheet: str
    photo: str


class OperationSummary(BaseModel):
    passenger_count: int
    adult_total: float
    child_total: float
    total_fee: float
    with_photo: int
    missing_photo: int
    missing_passport: int
    missing_voucher: int
    readiness_percent: int
    loaded_files: list[str]


class ImportResponse(BaseModel):
    imported: int
    warnings: list[str]
    loaded_files: list[str]
