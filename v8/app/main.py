from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models  # noqa: F401
from .auth import (
    AUDIT_ROLES,
    READ_ROLES,
    REVEAL_ROLES,
    WRITE_ROLES,
    IdentityContext,
    require_roles,
)
from .config import get_settings
from .database import Base, get_db, get_engine
from .logging_setup import RequestTimer, configure_logging
from .ratelimit import SlidingWindowLimiter
from .schemas import (
    AuditEventRead,
    AuditVerifyRead,
    ImportCommitRead,
    ImportPreviewRead,
    HealthRead,
    OperationCreate,
    OperationRead,
    OperationUpdate,
    Page,
    PassengerCreate,
    PassengerPhotoRead,
    PassengerRead,
    PassengerUpdate,
    PassportRevealRead,
    PhotoMatchRead,
    SetupCreate,
    SetupRead,
    SetupStatusRead,
    V7MigrationCreate,
    V7MigrationRead,
)
from . import migration, services

logger = configure_logging()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.auto_create_schema:
        Base.metadata.create_all(bind=get_engine())
    yield


settings = get_settings()
app = FastAPI(
    title="Excelbase V8 API",
    version="8.0.0-alpha.2",
    docs_url="/api/v8/docs",
    openapi_url="/api/v8/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["authorization", "content-type", "x-user-id", "x-organization-id", "x-request-id"],
)

DbSession = Annotated[Session, Depends(get_db)]
ReadIdentity = Annotated[IdentityContext, Depends(require_roles(*READ_ROLES))]
WriteIdentity = Annotated[IdentityContext, Depends(require_roles(*WRITE_ROLES))]
AuditIdentity = Annotated[IdentityContext, Depends(require_roles(*AUDIT_ROLES))]
RevealIdentity = Annotated[IdentityContext, Depends(require_roles(*REVEAL_ROLES))]

import_limiter = SlidingWindowLimiter(settings.rate_limit_import_per_minute)
reveal_limiter = SlidingWindowLimiter(settings.rate_limit_reveal_per_minute)


def _rate_limit_key(request: Request, identity: IdentityContext) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{identity.organization_id}:{identity.user_id}:{client}"


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    timer = RequestTimer()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/v8"):
        response.headers["Cache-Control"] = "private, no-store"
        logger.info(
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": timer.duration_ms(),
                "client": request.client.host if request.client else None,
            },
        )
    return response


@app.get("/", include_in_schema=False)
def root():
    """Tarayıcıyla API köküne gelen kullanıcı doğrudan uygulama arayüzüne gönderilir."""
    if settings.ui_url:
        return RedirectResponse(url=settings.ui_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)
    return {
        "service": "Excelbase V8 API",
        "message": "Bu adres yalnızca API sunucusudur. Uygulama arayüzü için excelbase servisinin /v8 sayfasını açın.",
        "docs": "/api/v8/docs",
        "health": "/api/v8/health",
    }


@app.get("/api/v8/health", response_model=HealthRead)
def health(db: DbSession) -> HealthRead:
    db.execute(text("SELECT 1"))
    return HealthRead(status="ok", version="8.0.0-alpha.2", database="ok")


@app.get("/api/v8/setup", response_model=SetupStatusRead)
def setup_status(db: DbSession) -> SetupStatusRead:
    return SetupStatusRead(setup_required=services.setup_required(db))


@app.post("/api/v8/setup", response_model=SetupRead, status_code=status.HTTP_201_CREATED)
def first_run_setup(payload: SetupCreate, db: DbSession) -> SetupRead:
    """One-time setup: creates the first organization + owner and returns a
    login JWT. Rejected with 409 once any organization exists."""
    from .auth import issue_jwt

    organization_id, user_id = services.first_run_setup(
        db, payload.organization, payload.email, payload.display_name
    )
    return SetupRead(
        token=issue_jwt(user_id, organization_id),
        organization_id=organization_id,
        user_id=user_id,
    )


@app.post("/api/v8/operations", response_model=OperationRead, status_code=status.HTTP_201_CREATED)
def create_operation(
    request: Request,
    payload: OperationCreate,
    db: DbSession,
    identity: WriteIdentity,
) -> OperationRead:
    return services.create_operation(db, identity, payload, request.state.request_id)


@app.get("/api/v8/operations", response_model=Page[OperationRead])
def list_operations(
    db: DbSession,
    identity: ReadIdentity,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> Page[OperationRead]:
    return services.list_operations(db, identity, limit, offset)


@app.get("/api/v8/operations/{operation_id}", response_model=OperationRead)
def get_operation(operation_id: uuid.UUID, db: DbSession, identity: ReadIdentity) -> OperationRead:
    return services.get_operation(db, identity, operation_id)


@app.patch("/api/v8/operations/{operation_id}", response_model=OperationRead)
def update_operation(
    operation_id: uuid.UUID,
    request: Request,
    payload: OperationUpdate,
    db: DbSession,
    identity: WriteIdentity,
) -> OperationRead:
    return services.update_operation(db, identity, operation_id, payload, request.state.request_id)


@app.post(
    "/api/v8/operations/{operation_id}/passengers",
    response_model=PassengerRead,
    status_code=status.HTTP_201_CREATED,
)
def create_passenger(
    operation_id: uuid.UUID,
    request: Request,
    payload: PassengerCreate,
    db: DbSession,
    identity: WriteIdentity,
) -> PassengerRead:
    return services.create_passenger(db, identity, operation_id, payload, request.state.request_id)


@app.get("/api/v8/operations/{operation_id}/passengers", response_model=Page[PassengerRead])
def list_passengers(
    operation_id: uuid.UUID,
    db: DbSession,
    identity: ReadIdentity,
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    search: str = Query(default="", max_length=160),
    status_filter: str = Query(default="", alias="status", max_length=40),
    sort: str = Query(default="", max_length=40),
) -> Page[PassengerRead]:
    return services.list_passengers(
        db, identity, operation_id, limit, offset, search=search, status_filter=status_filter, sort=sort
    )


@app.get("/api/v8/passengers/{passenger_id}", response_model=PassengerRead)
def get_passenger(passenger_id: uuid.UUID, db: DbSession, identity: ReadIdentity) -> PassengerRead:
    return services.get_passenger(db, identity, passenger_id)


@app.patch("/api/v8/passengers/{passenger_id}", response_model=PassengerRead)
def update_passenger(
    passenger_id: uuid.UUID,
    request: Request,
    payload: PassengerUpdate,
    db: DbSession,
    identity: WriteIdentity,
) -> PassengerRead:
    return services.update_passenger(db, identity, passenger_id, payload, request.state.request_id)


@app.delete("/api/v8/passengers/{passenger_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_passenger(
    passenger_id: uuid.UUID,
    request: Request,
    db: DbSession,
    identity: WriteIdentity,
    version: int = Query(ge=1),
) -> Response:
    services.delete_passenger(db, identity, passenger_id, version, request.state.request_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/api/v8/passengers/{passenger_id}/passport/reveal", response_model=PassportRevealRead)
def reveal_passport(
    passenger_id: uuid.UUID,
    request: Request,
    db: DbSession,
    identity: RevealIdentity,
) -> PassportRevealRead:
    if settings.rate_limit_enabled:
        reveal_limiter.check(_rate_limit_key(request, identity))
    return services.reveal_passport(db, identity, passenger_id, request.state.request_id)


@app.post(
    "/api/v8/passengers/{passenger_id}/photo",
    response_model=PassengerPhotoRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_passenger_photo(
    passenger_id: uuid.UUID,
    request: Request,
    db: DbSession,
    identity: WriteIdentity,
    file: UploadFile = File(...),
) -> PassengerPhotoRead:
    data = await file.read(settings.max_photo_bytes + 1)
    if len(data) > settings.max_photo_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Fotoğraf boyut limitini aşıyor.",
        )
    return services.upload_passenger_photo(
        db,
        identity,
        passenger_id,
        file.filename or "photo",
        file.content_type or "application/octet-stream",
        data,
        request.state.request_id,
    )


@app.get("/api/v8/passengers/{passenger_id}/photo")
def get_passenger_photo(passenger_id: uuid.UUID, db: DbSession, identity: ReadIdentity) -> Response:
    data, mime_type = services.get_passenger_photo(db, identity, passenger_id)
    return Response(content=data, media_type=mime_type)


@app.delete("/api/v8/passengers/{passenger_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def delete_passenger_photo(
    passenger_id: uuid.UUID,
    request: Request,
    db: DbSession,
    identity: WriteIdentity,
) -> Response:
    services.delete_passenger_photo(db, identity, passenger_id, request.state.request_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post(
    "/api/v8/operations/{operation_id}/imports",
    response_model=ImportPreviewRead,
    status_code=status.HTTP_201_CREATED,
)
async def stage_import(
    operation_id: uuid.UUID,
    request: Request,
    db: DbSession,
    identity: WriteIdentity,
    file: UploadFile = File(...),
) -> ImportPreviewRead:
    if settings.rate_limit_enabled:
        import_limiter.check(_rate_limit_key(request, identity))
    filename = file.filename or "gate-visa.xlsx"
    extension = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if extension not in {"xlsx", "xls", "xlsm", "ods", "csv"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Desteklenmeyen import dosya türü.")
    data = await file.read(settings.max_import_bytes + 1)
    if len(data) > settings.max_import_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Import dosyası boyut limitini aşıyor.")
    return services.stage_import(db, identity, operation_id, filename, data, request.state.request_id)


@app.get("/api/v8/imports/{batch_id}", response_model=ImportPreviewRead)
def import_preview(batch_id: uuid.UUID, db: DbSession, identity: ReadIdentity) -> ImportPreviewRead:
    return services.get_import_preview(db, identity, batch_id)


@app.post("/api/v8/imports/{batch_id}/commit", response_model=ImportCommitRead)
def commit_import(
    batch_id: uuid.UUID,
    request: Request,
    db: DbSession,
    identity: WriteIdentity,
) -> ImportCommitRead:
    return services.commit_import(db, identity, batch_id, request.state.request_id)


@app.post("/api/v8/migrations/v7", response_model=V7MigrationRead, status_code=status.HTTP_201_CREATED)
def migrate_v7(
    request: Request,
    payload: V7MigrationCreate,
    db: DbSession,
    identity: WriteIdentity,
) -> V7MigrationRead:
    if settings.rate_limit_enabled:
        import_limiter.check(_rate_limit_key(request, identity))
    return migration.migrate_records(
        db,
        identity,
        payload.passengers,
        request.state.request_id,
        origin=payload.origin,
        destination=payload.destination,
    )


@app.post("/api/v8/imports/auto", response_model=V7MigrationRead, status_code=status.HTTP_201_CREATED)
async def auto_import_excel(
    request: Request,
    db: DbSession,
    identity: WriteIdentity,
    file: UploadFile = File(...),
) -> V7MigrationRead:
    """Tek adımlı Excel içe aktarma: onay adımı olmadan gidiş tarihlerine göre
    operasyonlar oluşturur ve yolcuları yerleştirir; tekrar yüklemek güvenlidir."""
    if settings.rate_limit_enabled:
        import_limiter.check(_rate_limit_key(request, identity))
    filename = file.filename or "gate-visa.xlsx"
    extension = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if extension not in {"xlsx", "xls", "xlsm", "ods", "csv"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Desteklenmeyen import dosya türü.")
    data = await file.read(settings.max_import_bytes + 1)
    if len(data) > settings.max_import_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Import dosyası boyut limitini aşıyor.")
    return migration.import_excel_auto(db, identity, filename, data, request.state.request_id)


@app.post("/api/v8/photos/match", response_model=PhotoMatchRead)
async def match_photos(
    request: Request,
    db: DbSession,
    identity: WriteIdentity,
    files: list[UploadFile] = File(...),
) -> PhotoMatchRead:
    """Toplu fotoğraf yükleme: dosya adındaki pasaport numarası veya ad-soyada
    göre yolcular otomatik bulunur; ZIP arşivleri de desteklenir."""
    if settings.rate_limit_enabled:
        import_limiter.check(_rate_limit_key(request, identity))
    if len(files) > 300:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="En fazla 300 dosya yüklenebilir.")
    payload: list[tuple[str, bytes]] = []
    for upload in files:
        data = await upload.read(settings.max_photo_bytes + 1)
        if len(data) > settings.max_photo_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"{upload.filename}: fotoğraf boyut limitini aşıyor.",
            )
        payload.append((upload.filename or "foto.jpg", data))
    return services.match_passenger_photos(db, identity, payload, request.state.request_id)


@app.get("/api/v8/audit/verify", response_model=AuditVerifyRead)
def verify_audit(db: DbSession, identity: AuditIdentity) -> AuditVerifyRead:
    return services.verify_audit_chain(db, identity)


@app.get("/api/v8/audit", response_model=list[AuditEventRead])
def list_audit(
    db: DbSession,
    identity: AuditIdentity,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[AuditEventRead]:
    return [AuditEventRead.model_validate(item) for item in services.list_audit_events(db, identity, limit)]
