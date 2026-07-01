from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class PassengerRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
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
    photo_url: str = ""
    issues: list[str] = []
    duplicate: bool = False


class OperationSummary(BaseModel):
    passenger_count: int
    adult_total: float
    child_total: float
    total_fee: float
    with_photo: int
    missing_photo: int
    missing_passport: int
    missing_voucher: int
    missing_fee: int
    duplicates: int
    readiness_percent: int
    issue_counts: dict[str, int]
    loaded_files: list[str]
    import_history: list[dict]
    today_count: int


class ImportResponse(BaseModel):
    imported: int
    warnings: list[str]
    loaded_files: list[str]
    passenger_count: int


class PassengerUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    passport_no: str | None = None
    voucher: str | None = None
    departure_date: str | None = None
    arrival_date: str | None = None
    adult_fee: str | None = None
    child_fee: str | None = None
    no: str | None = None


class BulkDeleteRequest(BaseModel):
    ids: list[int]


class MatchPhotosResponse(BaseModel):
    matched: int
    unmatched: list[str]
    passenger_count: int
    with_photo: int


class OperationMetaUpdate(BaseModel):
    date_key: str
    status: str = "Hazırlanıyor"
    staff: str = ""
    note: str = ""


class OperationMeta(BaseModel):
    date_key: str
    status: str
    staff: str
    note: str


class ArchiveGroup(BaseModel):
    date_key: str
    count: int
    adult_total: float
    child_total: float
    total: float
    with_photo: int
    passenger_ids: list[int]
    meta: OperationMeta | None = None


class ArchiveResponse(BaseModel):
    groups: list[ArchiveGroup]
    total_count: int


class MergeResponse(BaseModel):
    removed: int
    passenger_count: int


class SimpleResult(BaseModel):
    ok: bool
    message: str = ""
    passenger_count: int = 0
