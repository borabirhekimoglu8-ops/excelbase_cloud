from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


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
    issues: list[str] = Field(default_factory=list)
    duplicate: bool = False


class PassengerPage(BaseModel):
    items: list[PassengerRecord]
    total: int
    offset: int
    limit: int


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
    ready_count: int = 0
    missing_count: int = 0
    readiness_percent: int
    issue_counts: dict[str, int]
    loaded_files: list[str]
    import_history: list[dict]
    today_count: int
    can_undo: bool = False
    last_batch_id: str = ""
    unmatched_photo_count: int = 0
    persistence: str = "local-fallback"
    version: str = ""


class ImportJobView(BaseModel):
    id: str
    filename: str
    status: str
    parent_id: str = ""
    kind: str = "file"
    stage: str = ""
    imported: int = 0
    duplicates: int = 0
    invalid: int = 0
    total_files: int = 0
    processed_files: int = 0
    message: str = ""
    created_at: str = ""
    finished_at: str = ""


class ImportQueueResponse(BaseModel):
    jobs: list[ImportJobView]
    active: bool
    batch_id: str = ""


class ImportResponse(BaseModel):
    imported: int
    warnings: list[str]
    loaded_files: list[str]
    passenger_count: int
    batch_id: str = ""
    duplicate_count: int = 0
    invalid_count: int = 0


class ImportPreviewResponse(BaseModel):
    filename: str
    rows: int
    warnings: list[str]
    duplicate_count: int = 0
    invalid_count: int = 0


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
    matches: list[dict] = Field(default_factory=list)


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


class AuthSetupRequest(BaseModel):
    display_name: str
    pin: str
    bootstrap_token: str = Field(default="", max_length=512)


class AuthLoginRequest(BaseModel):
    pin: str


class AuthStatusResponse(BaseModel):
    setup_required: bool
    authenticated: bool
    user: dict | None = None


class UserCreateRequest(BaseModel):
    name: str
    pin: str
    role: str = "operator"


class UserView(BaseModel):
    id: str
    name: str
    role: str
    active: bool = True


class AuditEntry(BaseModel):
    id: str
    time: str
    actor: str
    role: str
    action: str
    path: str


class UnmatchedPhoto(BaseModel):
    id: str
    filename: str
    photo_url: str
    created_at: str


class AssignPhotoRequest(BaseModel):
    passenger_id: int


class BackupInfo(BaseModel):
    snapshot_date: str


class MailImportResponse(BaseModel):
    subject: str
    sender: str
    attachment_count: int
    imported_rows: int
    matched_photos: int
    stored_documents: int
    warnings: list[str] = Field(default_factory=list)
