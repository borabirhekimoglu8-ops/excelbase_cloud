from __future__ import annotations

import logging
import os
import time
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

from .config import (
    ALLOWED_IMPORT_EXTENSIONS,
    MAX_IMPORT_ARCHIVE_BYTES,
    MAX_PHOTO_BYTES,
    MAX_PHOTO_FILES,
    MAX_RESTORE_BYTES,
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_FILES,
    SESSION_COOKIE,
    SESSION_DAYS,
    allowed_origins,
    api_key,
    assistant_settings,
)
from .models import (
    ArchiveResponse,
    AssignPhotoRequest,
    AuditEntry,
    AuthLoginRequest,
    AuthSetupRequest,
    AuthStatusResponse,
    BackupInfo,
    BulkDeleteRequest,
    ImportJobView,
    ImportQueueResponse,
    ImportResponse,
    ImportPreviewResponse,
    MailImportResponse,
    MatchPhotosResponse,
    MergeResponse,
    OperationMetaUpdate,
    OperationSummary,
    PassengerPage,
    PassengerRecord,
    PassengerUpdate,
    SimpleResult,
    UnmatchedPhoto,
    UserCreateRequest,
    UserView,
)
from .assistant.provider import (
    AssistantConfigurationError,
    AssistantProviderError,
    AssistantRateLimitError,
    AssistantTimeoutError,
    AssistantUnavailableError,
)
from .assistant.body_limit import AssistantBodyLimitMiddleware
from .assistant.schemas import (
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantDiagnosticsResponse,
    AssistantSessionResponse,
    AssistantStatusResponse,
)
from .assistant.service import (
    AssistantDuplicateRequestError,
    AssistantInputError,
    AssistantQuotaError,
    assistant_diagnostics,
    assistant_status,
    generate_assistant_reply,
)
from .auth import (
    ASSISTANT_SESSION_COOKIE,
    ASSISTANT_SESSION_PATH,
    LEGACY_ASSISTANT_SESSION_PATHS,
    ASSISTANT_SESSION_SECONDS,
    Actor,
    assistant_csrf_token,
    assistant_csrf_token_for_session,
    assistant_network_allowed,
    bootstrap_token_required,
    create_user,
    deactivate_user,
    issue_assistant_session,
    issue_open_assistant_session,
    issue_session,
    list_users,
    optional_actor,
    optional_assistant_actor,
    require_admin_access,
    require_api_key,
    require_api_key_flexible,
    require_assistant_session,
    require_bootstrap_token,
    require_write_access,
    setup_admin,
    setup_required,
    authenticate,
)
from .devagent.schemas import DevAgentRequest
from .devagent.runner import cancel_run, current_run, start_run
from .devagent.service import (
    DevAgentError,
    apply_run,
    dev_agent_state,
)
from . import services
from .state import APP_VERSION
from persistence import StorePersistenceError  # noqa: E402  (kök dizin yolu .state importuyla eklenir)

logger = logging.getLogger(__name__)

app = FastAPI(title="Excelbase Operations API", version=APP_VERSION)
app.add_middleware(
    AssistantBodyLimitMiddleware,
    max_bytes=assistant_settings().max_request_bytes,
)


@app.exception_handler(StorePersistenceError)
async def persistence_error_handler(request: Request, exc: StorePersistenceError) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content={"detail": str(exc)})


@app.on_event("startup")
async def resume_import_queue() -> None:
    """Sunucu yeniden başladığında yarım kalan aktarım işlerini sürdürür."""
    try:
        migrated = services.migrate_legacy_import_queue()
        if migrated:
            logger.info("Eski kuyruktan %d aktarım işi yeni kalıcı kuyruğa taşındı", migrated)
        # Bu process yeni başladığı için önceki lease owner artık yoktur.
        # Tek-worker Render deployment'ında processing kalanları hemen kurtar.
        recovered = services.recover_stale_import_jobs(force=True)
        if recovered:
            logger.info("Yeniden başlatma sonrası %d aktarım işi kuyruğa iade edildi", recovered)
        services.ensure_import_worker()
    except Exception:
        logger.exception("Aktarım kuyruğu açılışta sürdürülemedi")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["accept", "content-type", "x-api-key", "x-csrf-token", "x-request-id"],
    expose_headers=["x-request-id"],
)

ROOT_DIR = Path(__file__).resolve().parents[1]
FRONTEND_OUT = ROOT_DIR / "frontend" / "out"
NEXT_ASSETS = FRONTEND_OUT / "_next"


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    """iOS Safari, başlıksız yanıtları sezgisel olarak önbellekler: eski uygulama
    kabuğu ve bayat /api GET yanıtları 'veriler işlenmiyor' olarak görünür.
    HTML ve API yanıtları her zaman taze, parmak izli statikler kalıcı olur."""
    response = await call_next(request)
    path = request.url.path
    content_type = response.headers.get("content-type", "")
    is_frontend_asset = path.startswith("/_next/static/")
    if is_frontend_asset:
        # Next.js statik dosya adları içerik özeti taşır; aynı URL'nin içeriği
        # değişmediği için mobil istemci ve CDN güvenle uzun süre önbellekleyebilir.
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith("/api/") or "text/html" in content_type:
        response.headers["Cache-Control"] = "no-store"
    return response


@app.middleware("http")
async def request_observability(request: Request, call_next):
    """Her isteği uçtan uca izlenebilir yapar; istemcinin kimliğini korur."""
    incoming = request.headers.get("x-request-id", "").strip()
    request_id = (
        incoming
        if incoming and len(incoming) <= 128 and all(ch.isalnum() or ch in "_.:-" for ch in incoming)
        else str(uuid.uuid4())
    )
    request.state.request_id = request_id
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request failed request_id=%s method=%s path=%s duration_ms=%d",
            request_id,
            request.method,
            request.url.path,
            round((time.monotonic() - started) * 1000),
        )
        raise
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request complete request_id=%s method=%s path=%s status=%d duration_ms=%d",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        round((time.monotonic() - started) * 1000),
    )
    return response


@app.middleware("http")
async def audit_mutations(request: Request, call_next):
    response = await call_next(request)
    if (
        request.method in {"POST", "PATCH", "DELETE"}
        and request.url.path.startswith("/api/")
        and not request.url.path.startswith("/api/auth/")
        and response.status_code < 400
    ):
        actor = getattr(request.state, "actor", None)
        if actor is not None:
            # Audit, özellikle /import/queue 202 yanıtını DB gecikmesiyle
            # bloke etmemeli. Ayrı audit tablosuna daemon iş parçacığında yazılır.
            services.record_audit_async(actor.name, actor.role, request.method, request.url.path)
    return response


def _key_qs() -> str:
    """Görsel URL'lerine eklenecek anahtar (yapılandırılmışsa)."""
    return api_key()


# ---------------------------------------------------------------- health / meta
@app.get("/health")
def health() -> dict:
    db_enabled = services.db.enabled()
    return {
        "status": "ok",
        "version": APP_VERSION,
        "persistence": "database" if db_enabled else "local-fallback",
        "database_writable": services.db.probe_write() if db_enabled else False,
    }


@app.get("/api/assistant/v1/status", response_model=AssistantStatusResponse)
def assistant_public_status() -> AssistantStatusResponse:
    """Safe public discovery endpoint; never returns provider or secret data."""
    return assistant_status()


@app.get("/api/assistant/v1/session", response_model=AssistantSessionResponse)
def assistant_session(request: Request, response: Response) -> AssistantSessionResponse:
    """Return only the online Sonnet session state and its derived CSRF token.

    With open access enabled the session is issued here on first contact, so
    the workspace connects without prompting for an access code. Origin and
    CSRF checks, the per-actor burst limit and the daily spending quotas all
    still apply to every turn.
    """
    actor = optional_assistant_actor(request)
    if actor is None and assistant_settings().open_access and assistant_network_allowed(request):
        actor, token = issue_open_assistant_session()
        _set_assistant_session_cookie(response, token)
        request.state.actor = actor
        return AssistantSessionResponse(
            setup_required=False,
            bootstrap_required=False,
            authenticated=True,
            user={"id": actor.id, "name": actor.name, "role": actor.role},
            csrf_token=assistant_csrf_token_for_session(token),
        )
    needs_setup = setup_required()
    return AssistantSessionResponse(
        setup_required=needs_setup,
        bootstrap_required=needs_setup and bootstrap_token_required(),
        authenticated=actor is not None,
        user={"id": actor.id, "name": actor.name, "role": actor.role} if actor else None,
        csrf_token=assistant_csrf_token(request) if actor else "",
    )


@app.post("/api/assistant/v1/session/setup", response_model=AssistantSessionResponse)
def assistant_session_setup(
    payload: AuthSetupRequest,
    request: Request,
    response: Response,
) -> AssistantSessionResponse:
    """Create the first user and issue only a short-lived Sonnet session."""
    require_bootstrap_token(payload.bootstrap_token)
    actor = setup_admin(payload.display_name, payload.pin)
    token = issue_assistant_session(actor)
    _set_assistant_session_cookie(response, token)
    request.state.actor = actor
    return AssistantSessionResponse(
        setup_required=False,
        bootstrap_required=False,
        authenticated=True,
        user={"id": actor.id, "name": actor.name, "role": actor.role},
        csrf_token=assistant_csrf_token_for_session(token),
    )


@app.post("/api/assistant/v1/session/login", response_model=AssistantSessionResponse)
def assistant_session_login(
    payload: AuthLoginRequest,
    request: Request,
    response: Response,
) -> AssistantSessionResponse:
    """Authenticate an existing user without minting a global app session."""
    actor = authenticate(payload.pin, request.client.host if request.client else "unknown")
    token = issue_assistant_session(actor)
    _set_assistant_session_cookie(response, token)
    request.state.actor = actor
    return AssistantSessionResponse(
        setup_required=False,
        bootstrap_required=False,
        authenticated=True,
        user={"id": actor.id, "name": actor.name, "role": actor.role},
        csrf_token=assistant_csrf_token_for_session(token),
    )


@app.post("/api/assistant/v1/session/logout", response_model=SimpleResult)
def assistant_session_logout(
    response: Response,
    _actor: Actor = Depends(require_assistant_session),
) -> SimpleResult:
    response.delete_cookie(
        ASSISTANT_SESSION_COOKIE,
        path=ASSISTANT_SESSION_PATH,
        secure=os.environ.get("APP_ENV", "development").lower() == "production",
        httponly=True,
        samesite="strict",
    )
    # Otherwise logging out cannot clear a session an older build issued, and
    # "log out and back in" -- the natural way to recover -- would not work.
    _clear_legacy_assistant_session_cookies(response)
    return SimpleResult(ok=True, message="Sonnet oturumu kapatıldı.")


@app.post("/api/assistant/v1/diagnostics", response_model=AssistantDiagnosticsResponse)
async def assistant_diagnostics_check(
    request: Request,
    actor: Actor = Depends(require_assistant_session),
) -> AssistantDiagnosticsResponse:
    """Report why Claude Sonnet is not answering, without billing a turn.

    Requires the same session and CSRF proof as a chat turn, because it
    confirms whether this deployment's Anthropic credentials are accepted.
    """
    request_id = str(getattr(request.state, "request_id", ""))
    try:
        return await assistant_diagnostics(actor.id)
    except AssistantQuotaError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Çok sık denetim isteği. Kısa süre sonra tekrar deneyin.",
            headers={"Retry-After": str(getattr(exc, "retry_after", 30))},
        ) from None
    except Exception:
        logger.exception(
            "assistant diagnostics failed request_id=%s actor_id=%s",
            request_id,
            actor.id,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Asistan denetimi tamamlanamadı.",
        ) from None


@app.get("/api/dev-agent/v1/status")
def dev_agent_status_endpoint(
    _actor: Actor = Depends(require_assistant_session),
) -> dict:
    """Whether an in-app development agent is available, and why not."""
    state = dev_agent_state()
    return {"state": state, "available": state == "ready"}


@app.post("/api/dev-agent/v1/run", status_code=status.HTTP_202_ACCEPTED)
async def dev_agent_run(
    payload: DevAgentRequest,
    _actor: Actor = Depends(require_assistant_session),
) -> dict:
    """Start a development run and return at once, leaving it running.

    Deliberately not a streaming response: a run takes minutes, and holding it
    open made the work the browser's to own -- closing the panel or moving to
    another screen cancelled it. Progress is read separately, so the operator
    can go and use the application while the agent works.

    Nothing here touches the code the live process is serving: the agent works
    in a separate checkout and the operator applies the result separately.
    """
    if dev_agent_state() != "ready":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Geliştirme ajanı kullanılabilir değil.",
        )
    try:
        run = start_run(payload.instruction)
    except DevAgentError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None
    return {"id": run.id, "status": run.status}


@app.get("/api/dev-agent/v1/run")
def dev_agent_run_state(
    _actor: Actor = Depends(require_assistant_session),
) -> dict:
    """Progress of the current or most recent run, for a panel that just opened."""
    run = current_run()
    return run or {"status": "idle", "events": []}


@app.post("/api/dev-agent/v1/run/cancel")
async def dev_agent_run_cancel(
    _actor: Actor = Depends(require_assistant_session),
) -> dict:
    """Stop the run in progress. Nothing was applied, so nothing is rolled back."""
    await cancel_run()
    return {"ok": True}


@app.post("/api/dev-agent/v1/apply")
def dev_agent_apply(
    _actor: Actor = Depends(require_assistant_session),
) -> dict:
    """Take the agent's reviewed commit into the branch the operator runs."""
    if dev_agent_state() != "ready":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Geliştirme ajanı kullanılabilir değil.",
        )
    try:
        return {"ok": True, "commit": apply_run()}
    except DevAgentError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from None


@app.post("/api/assistant/v1/chat", response_model=AssistantChatResponse)
async def assistant_chat(
    payload: AssistantChatRequest,
    request: Request,
    actor: Actor = Depends(require_assistant_session),
) -> AssistantChatResponse:
    """Run one authenticated, read-only Claude Sonnet turn.

    Prompts and answers are intentionally not persisted or logged by the
    server. Only token counts and opaque request identifiers reach logs.
    """
    request_id = str(getattr(request.state, "request_id", ""))
    try:
        return await generate_assistant_reply(
            payload,
            actor_id=actor.id,
            request_id=request_id,
        )
    except AssistantInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from None
    except AssistantDuplicateRequestError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bu Sonnet isteği daha önce alındı.",
        ) from None
    except (AssistantQuotaError, AssistantRateLimitError) as exc:
        retry_after = str(getattr(exc, "retry_after", 30))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Sonnet kullanım sınırına ulaşıldı. Kısa süre sonra tekrar deneyin.",
            headers={"Retry-After": retry_after},
        ) from None
    except AssistantTimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Claude Sonnet zamanında yanıt vermedi. Tekrar deneyin.",
        ) from None
    except AssistantUnavailableError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Claude Sonnet henüz kullanıma hazır değil.",
        ) from None
    except AssistantConfigurationError as exc:
        # A rejected key, an unscoped key or an unknown model cannot be fixed
        # by retrying, so say what to correct instead of reporting an outage.
        logger.error(
            "assistant configuration failure request_id=%s actor_id=%s %s",
            request_id,
            actor.id,
            exc.diagnostic.as_log_fields(),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from None
    except AssistantProviderError as exc:
        # The taxonomy is non-secret by construction: no prompt, context or
        # upstream body ever reaches the log line.
        logger.warning(
            "assistant provider failure request_id=%s actor_id=%s %s",
            request_id,
            actor.id,
            exc.diagnostic.as_log_fields(),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Claude Sonnet hizmetine şu anda ulaşılamıyor.",
        ) from None


# ---------------------------------------------------------------- authentication
def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=os.environ.get("APP_ENV", "development").lower() == "production",
        samesite="lax",
        path="/",
    )


def _clear_legacy_assistant_session_cookies(response: Response) -> None:
    """Remove session cookies left at paths this app no longer issues under.

    Cookies are keyed by name *and* path, so a build that changes the path
    leaves the old cookie in place: it keeps being sent, it is not overwritten
    by the new one, and a delete at the new path does not match it. The result
    is two same-named cookies whose order the server cannot control.
    """
    for legacy_path in LEGACY_ASSISTANT_SESSION_PATHS:
        response.delete_cookie(
            ASSISTANT_SESSION_COOKIE,
            path=legacy_path,
            secure=os.environ.get("APP_ENV", "development").lower() == "production",
            httponly=True,
            samesite="strict",
        )


def _set_assistant_session_cookie(response: Response, token: str) -> None:
    _clear_legacy_assistant_session_cookies(response)
    response.set_cookie(
        key=ASSISTANT_SESSION_COOKIE,
        value=token,
        max_age=ASSISTANT_SESSION_SECONDS,
        httponly=True,
        secure=os.environ.get("APP_ENV", "development").lower() == "production",
        samesite="strict",
        path=ASSISTANT_SESSION_PATH,
    )


@app.get("/api/auth/status", response_model=AuthStatusResponse)
def auth_status(request: Request) -> AuthStatusResponse:
    actor = optional_actor(request)
    return AuthStatusResponse(
        setup_required=setup_required(),
        authenticated=actor is not None,
        user={"id": actor.id, "name": actor.name, "role": actor.role} if actor else None,
    )


@app.post("/api/auth/setup", response_model=AuthStatusResponse)
def auth_setup(payload: AuthSetupRequest, response: Response) -> AuthStatusResponse:
    require_bootstrap_token(payload.bootstrap_token)
    actor = setup_admin(payload.display_name, payload.pin)
    _set_session_cookie(response, issue_session(actor))
    return AuthStatusResponse(
        setup_required=False,
        authenticated=True,
        user={"id": actor.id, "name": actor.name, "role": actor.role},
    )


@app.post("/api/auth/login", response_model=AuthStatusResponse)
def auth_login(payload: AuthLoginRequest, request: Request, response: Response) -> AuthStatusResponse:
    actor = authenticate(payload.pin, request.client.host if request.client else "unknown")
    _set_session_cookie(response, issue_session(actor))
    return AuthStatusResponse(
        setup_required=False,
        authenticated=True,
        user={"id": actor.id, "name": actor.name, "role": actor.role},
    )


@app.post("/api/auth/logout", response_model=SimpleResult)
def auth_logout(response: Response) -> SimpleResult:
    response.delete_cookie(SESSION_COOKIE, path="/")
    return SimpleResult(ok=True, message="Oturum kapatildi.")


@app.get("/api/users", response_model=list[UserView], dependencies=[Depends(require_admin_access)])
def users_list() -> list[dict]:
    return list_users()


@app.post("/api/users", response_model=UserView, dependencies=[Depends(require_admin_access)])
def users_create(payload: UserCreateRequest) -> dict:
    return create_user(payload.name, payload.pin, payload.role)


@app.delete("/api/users/{user_id}", response_model=SimpleResult)
def users_delete(user_id: str, request: Request, actor=Depends(require_admin_access)) -> SimpleResult:
    deactivate_user(user_id, actor)
    return SimpleResult(ok=True, message="Kullanici devre disi birakildi.")


@app.get("/api/audit", response_model=list[AuditEntry], dependencies=[Depends(require_admin_access)])
def audit_log(limit: int = Query(default=100, ge=1, le=500)) -> list[dict]:
    return services.get_audit(limit)


@app.get("/api/summary", response_model=OperationSummary, dependencies=[Depends(require_api_key)])
def summary(
    range_choice: str = Query(default="Tümü", alias="range"),
    start: str = Query(default=""),
    end: str = Query(default=""),
) -> OperationSummary:
    return services.get_summary(range_choice, start, end)


# ------------------------------------------------------------------- passengers
@app.get("/api/passengers", response_model=list[PassengerRecord], dependencies=[Depends(require_api_key)])
def passengers(
    search: str = Query(default=""),
    status_filter: str = Query(default="", alias="status"),
    sort: str = Query(default=""),
    range_choice: str = Query(default="Tümü", alias="range"),
    start: str = Query(default=""),
    end: str = Query(default=""),
) -> list[PassengerRecord]:
    return services.get_passengers(
        search=search,
        status=status_filter,
        sort=sort,
        with_key=_key_qs(),
        range_choice=range_choice,
        start=start,
        end=end,
    )


@app.get("/api/passengers/page", response_model=PassengerPage, dependencies=[Depends(require_api_key)])
def passengers_page(
    search: str = Query(default=""),
    status_filter: str = Query(default="", alias="status"),
    sort: str = Query(default=""),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    range_choice: str = Query(default="Tümü", alias="range"),
    start: str = Query(default=""),
    end: str = Query(default=""),
) -> PassengerPage:
    items, total = services.get_passenger_page(
        search=search,
        status=status_filter,
        sort=sort,
        with_key=_key_qs(),
        offset=offset,
        limit=limit,
        range_choice=range_choice,
        start=start,
        end=end,
    )
    return PassengerPage(items=items, total=total, offset=offset, limit=limit)


@app.patch("/api/passengers/{passenger_id}", response_model=SimpleResult, dependencies=[Depends(require_write_access)])
def patch_passenger(passenger_id: int, payload: PassengerUpdate) -> SimpleResult:
    ok = services.update_passenger(passenger_id, payload.model_dump(exclude_none=True))
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu bulunamadı.")
    return SimpleResult(ok=True, message="Yolcu güncellendi.")


@app.delete("/api/passengers/{passenger_id}", response_model=SimpleResult, dependencies=[Depends(require_write_access)])
def remove_passenger(passenger_id: int) -> SimpleResult:
    count = services.delete_passenger(passenger_id)
    if count < 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu bulunamadı.")
    return SimpleResult(ok=True, message="Yolcu silindi.", passenger_count=count)


@app.post("/api/passengers/bulk-delete", response_model=SimpleResult, dependencies=[Depends(require_write_access)])
def bulk_delete(payload: BulkDeleteRequest) -> SimpleResult:
    count = services.bulk_delete(payload.ids)
    return SimpleResult(ok=True, message=f"{len(payload.ids)} kayıt silindi.", passenger_count=count)


@app.post("/api/passengers/clear", response_model=SimpleResult, dependencies=[Depends(require_admin_access)])
def clear_passengers() -> SimpleResult:
    services.clear_all()
    return SimpleResult(ok=True, message="Tüm veriler temizlendi.", passenger_count=0)


@app.post("/api/demo", response_model=SimpleResult, dependencies=[Depends(require_admin_access)])
def load_demo() -> SimpleResult:
    count = services.load_demo()
    return SimpleResult(ok=True, message="Demo veri yüklendi.", passenger_count=count)


# ----------------------------------------------------------------------- import
@app.post("/api/import/preview", response_model=ImportPreviewResponse, dependencies=[Depends(require_write_access)])
async def preview_import(file: UploadFile = File(...)) -> ImportPreviewResponse:
    filename = file.filename or "upload.xlsx"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_IMPORT_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Desteklenmeyen dosya turu.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Dosya boyut limitini asiyor.")
    try:
        name, rows, warnings, duplicates, invalid = services.preview_gate_visa_files([(filename, data)])
        return ImportPreviewResponse(
            filename=name,
            rows=rows,
            warnings=warnings,
            duplicate_count=duplicates,
            invalid_count=invalid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dosya on kontrolden gecemedi.") from exc


@app.post("/api/import", response_model=ImportResponse, dependencies=[Depends(require_write_access)])
async def import_files(
    files: list[UploadFile] = File(...),
    replace: bool = Query(default=False),
    dup_strategy: str = Query(default="add"),
    batch_id: str = Query(default=""),
) -> ImportResponse:
    if dup_strategy not in {"add", "skip", "overwrite"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Gecersiz tekrar stratejisi.")
    if MAX_UPLOAD_FILES > 0 and len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"En fazla {MAX_UPLOAD_FILES} dosya yüklenebilir.",
        )
    resolved_batch_id = batch_id
    imported_total = 0
    warning_list: list[str] = []
    loaded_files: list[str] = []
    passenger_count = 0
    duplicate_count = 0
    invalid_count = 0
    should_replace = replace
    for upload in files:
        filename = upload.filename or "upload.xlsx"
        ext = os.path.splitext(filename)[1].lower()
        if ext not in ALLOWED_IMPORT_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Desteklenen dosya türleri: .xlsx, .xls, .xlsm, .ods, .csv",
            )
        data = await upload.read(MAX_UPLOAD_BYTES + 1)
        logger.info(
            "import upload received filename=%r content_type=%r bytes=%d",
            filename,
            upload.content_type,
            len(data),
        )
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Dosya limiti {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            )
        if not data:
            logger.warning("empty import upload filename=%r content_type=%r", filename, upload.content_type)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{filename}: dosya içeriği alınamadı (0 bayt). Dosyayı yeniden seçin.",
            )
        try:
            imported, warnings, loaded_files, passenger_count, resolved_batch_id, duplicates, invalid = services.import_gate_visa_files(
                [(filename, data)],
                replace=should_replace,
                dup_strategy=dup_strategy,
                batch_id=resolved_batch_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        except StorePersistenceError:
            raise
        except Exception as exc:
            logger.exception("import failed filename=%r", filename)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{filename} okunamadi veya desteklenmeyen format.",
            ) from exc
        should_replace = False
        imported_total += imported
        warning_list.extend(warnings)
        duplicate_count += duplicates
        invalid_count += invalid
    return ImportResponse(
        imported=imported_total,
        warnings=warning_list,
        loaded_files=loaded_files,
        passenger_count=passenger_count,
        batch_id=resolved_batch_id,
        duplicate_count=duplicate_count,
        invalid_count=invalid_count,
    )


async def _read_validated_import_upload(upload: UploadFile) -> tuple[str, bytes]:
    filename = upload.filename or "upload.xlsx"
    ext = os.path.splitext(filename)[1].lower()
    is_archive = ext == ".zip"
    if ext not in ALLOWED_IMPORT_EXTENSIONS and not is_archive:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{filename}: desteklenen dosya türleri: .xlsx, .xls, .xlsm, .ods, .csv, .zip",
        )
    byte_limit = MAX_IMPORT_ARCHIVE_BYTES if is_archive else MAX_UPLOAD_BYTES
    data = await upload.read(byte_limit + 1)
    if len(data) > byte_limit:
        label = "ZIP" if is_archive else "Dosya"
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"{filename}: {label} limiti {byte_limit // (1024 * 1024)} MB.",
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{filename}: dosya içeriği alınamadı (0 bayt). Dosyayı yeniden seçin.",
        )
    return filename, data


@app.post(
    "/api/import/queue",
    response_model=ImportQueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_write_access)],
)
async def queue_import_files(
    request: Request,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    replace: bool = Query(default=False),
    dup_strategy: str = Query(default="skip"),
    batch_id: str = Query(default=""),
    upload_id: str = Query(default=""),
    upload_index: int = Query(default=0, ge=0),
) -> ImportQueueResponse:
    """Top-level yüklemeyi kaydeder ve ayrıştırmayı 202 yanıtından sonraya bırakır."""
    request_id = str(getattr(request.state, "request_id", ""))
    request_started = time.monotonic()
    if dup_strategy not in {"add", "skip", "overwrite"}:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Gecersiz tekrar stratejisi.")
    if MAX_UPLOAD_FILES > 0 and len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"En fazla {MAX_UPLOAD_FILES} dosya yüklenebilir.",
        )
    payload: list[tuple[str, bytes, str]] = []
    read_started = time.monotonic()
    for upload in files:
        filename, data = await _read_validated_import_upload(upload)
        payload.append((filename, data, upload.content_type or "application/octet-stream"))
    logger.info(
        "import intake stage request_id=%s stage=read_uploads files=%d bytes=%d duration_ms=%d",
        request_id,
        len(payload),
        sum(len(item[1]) for item in payload),
        round((time.monotonic() - read_started) * 1000),
    )
    persist_started = time.monotonic()
    try:
        jobs, resolved_batch = services.enqueue_import_uploads(
            payload,
            replace=replace,
            dup_strategy=dup_strategy,
            batch_id=batch_id,
            upload_id=upload_id,
            upload_index=upload_index,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    finally:
        # İstek kapsamındaki büyük bytes referansları worker'a taşınmaz.
        payload.clear()
    logger.info(
        "import intake stage request_id=%s stage=persist jobs=%d duration_ms=%d total_ms=%d",
        request_id,
        len(jobs),
        round((time.monotonic() - persist_started) * 1000),
        round((time.monotonic() - request_started) * 1000),
    )
    # FastAPI bu çağrıyı 202 gövdesi gönderildikten sonra çalıştırır; worker
    # açılışındaki DB lease/cleanup gecikmesi mobil yanıtı tutamaz.
    background_tasks.add_task(services.ensure_import_worker)
    return ImportQueueResponse(
        jobs=[ImportJobView(**job) for job in jobs],
        active=True,
        batch_id=resolved_batch,
    )


@app.get("/api/import/queue", response_model=ImportQueueResponse, dependencies=[Depends(require_api_key)])
def import_queue_status() -> ImportQueueResponse:
    jobs, active = services.get_import_jobs()
    if active:
        services.ensure_import_worker()
    return ImportQueueResponse(jobs=[ImportJobView(**job) for job in jobs], active=active)


@app.post(
    "/api/import/queue/{job_id}/retry",
    response_model=SimpleResult,
    dependencies=[Depends(require_write_access)],
)
def retry_import_job(job_id: str) -> SimpleResult:
    if not services.retry_import_job(job_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yeniden denenecek iş bulunamadı.")
    services.ensure_import_worker()
    return SimpleResult(ok=True, message="Dosya yeniden kuyruğa alındı.")


@app.delete(
    "/api/import/queue/{job_id}",
    response_model=SimpleResult,
    dependencies=[Depends(require_write_access)],
)
def remove_import_job(job_id: str) -> SimpleResult:
    if not services.delete_import_job(job_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="İş bulunamadı veya şu anda işleniyor; bitince kaldırabilirsiniz.",
        )
    return SimpleResult(ok=True, message="Kayıt kuyruktan kaldırıldı.")


@app.post("/api/import/undo", response_model=SimpleResult, dependencies=[Depends(require_write_access)])
def undo_import(batch_id: str = Query(default="")) -> SimpleResult:
    ok, message, count = services.undo_import(batch_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
    return SimpleResult(ok=True, message=message, passenger_count=count)


@app.post("/api/mail/import", response_model=MailImportResponse, dependencies=[Depends(require_write_access)])
async def import_mail(file: UploadFile = File(...), batch_id: str = Query(default="")) -> dict:
    filename = file.filename or "mesaj.eml"
    if not filename.lower().endswith(".eml"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yalnizca .eml e-posta dosyasi desteklenir.")
    data = await file.read(MAX_RESTORE_BYTES + 1)
    if len(data) > MAX_RESTORE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="E-posta dosyasi cok buyuk.")
    try:
        return services.ingest_eml(filename, data, batch_id)
    except StorePersistenceError:
        raise
    except Exception as exc:
        logger.exception("mail import failed filename=%r", filename)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="E-posta dosyasi islenemedi.") from exc


# ------------------------------------------------------------------------ photo
@app.post(
    "/api/passengers/{passenger_id}/photo",
    response_model=SimpleResult,
    dependencies=[Depends(require_write_access)],
)
async def upload_passenger_photo(passenger_id: int, file: UploadFile = File(...)) -> SimpleResult:
    data = await file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Fotoğraf limiti {MAX_PHOTO_BYTES // (1024 * 1024)} MB.",
        )
    try:
        ok = services.set_passenger_photo(passenger_id, file.filename or "foto.jpg", data)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu bulunamadı.")
    return SimpleResult(ok=True, message="Fotoğraf güncellendi.")


@app.delete(
    "/api/passengers/{passenger_id}/photo",
    response_model=SimpleResult,
    dependencies=[Depends(require_write_access)],
)
def delete_passenger_photo(passenger_id: int) -> SimpleResult:
    if not services.remove_passenger_photo(passenger_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Yolcu bulunamadı.")
    return SimpleResult(ok=True, message="Fotoğraf silindi.")


@app.post("/api/photos/match", response_model=MatchPhotosResponse, dependencies=[Depends(require_write_access)])
async def match_photos(files: list[UploadFile] = File(...)) -> MatchPhotosResponse:
    if len(files) > MAX_PHOTO_FILES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"En fazla {MAX_PHOTO_FILES} dosya yüklenebilir.",
        )
    payload: list[tuple[str, bytes]] = []
    for upload in files:
        data = await upload.read(MAX_PHOTO_BYTES + 1)
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Fotoğraf limiti {MAX_PHOTO_BYTES // (1024 * 1024)} MB.",
            )
        payload.append((upload.filename or "foto.jpg", data))
    matched, unmatched, total, with_photo, matches = services.match_photos(payload)
    return MatchPhotosResponse(
        matched=matched,
        unmatched=unmatched,
        passenger_count=total,
        with_photo=with_photo,
        matches=matches,
    )


@app.get("/api/photos/unmatched", response_model=list[UnmatchedPhoto], dependencies=[Depends(require_api_key)])
def unmatched_photos() -> list[dict]:
    return services.get_unmatched_photos(_key_qs())


@app.post(
    "/api/photos/unmatched/{item_id}/assign",
    response_model=SimpleResult,
    dependencies=[Depends(require_write_access)],
)
def assign_unmatched_photo(item_id: str, payload: AssignPhotoRequest) -> SimpleResult:
    ok, message = services.assign_unmatched_photo(item_id, payload.passenger_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
    return SimpleResult(ok=True, message=message)


@app.delete(
    "/api/photos/unmatched/{item_id}",
    response_model=SimpleResult,
    dependencies=[Depends(require_write_access)],
)
def remove_unmatched_photo(item_id: str) -> SimpleResult:
    if not services.delete_unmatched_photo(item_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fotograf bulunamadi.")
    return SimpleResult(ok=True, message="Eslesmeyen fotograf kaldirildi.")


@app.get("/api/photo/{ref}", dependencies=[Depends(require_api_key_flexible)])
def serve_photo(ref: str) -> Response:
    if "/" in ref or "\\" in ref or ".." in ref:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Geçersiz referans.")
    result = services.get_photo(ref)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fotoğraf bulunamadı.")
    mime, data = result
    return Response(content=data, media_type=mime, headers={"Cache-Control": "private, no-store"})


# --------------------------------------------------------------- duplicates etc
@app.post("/api/merge-duplicates", response_model=MergeResponse, dependencies=[Depends(require_write_access)])
def merge_duplicates(passport_key: str = Query(default="")) -> MergeResponse:
    removed, total = services.merge_duplicates(passport_key or None)
    return MergeResponse(removed=removed, passenger_count=total)


# ---------------------------------------------------------------------- archive
@app.get("/api/archive", response_model=ArchiveResponse, dependencies=[Depends(require_api_key)])
def archive(
    range_choice: str = Query(default="Tümü", alias="range"),
    start: str = Query(default=""),
    end: str = Query(default=""),
) -> ArchiveResponse:
    return services.get_archive(range_choice=range_choice, start=start, end=end)


@app.post("/api/operation-meta", response_model=SimpleResult, dependencies=[Depends(require_write_access)])
def operation_meta(payload: OperationMetaUpdate) -> SimpleResult:
    services.save_operation_meta(payload.date_key, payload.status, payload.staff, payload.note)
    return SimpleResult(ok=True, message="Operasyon bilgisi kaydedildi.")


# ----------------------------------------------------------------------- export
@app.get("/api/export", dependencies=[Depends(require_api_key_flexible)])
def export(
    kind: str = Query(default="excel"),
    ids: str = Query(default=""),
    range_choice: str = Query(default="Tümü", alias="range"),
    start: str = Query(default=""),
    end: str = Query(default=""),
) -> Response:
    id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()] if ids else None
    data, filename, mime = services.export_bytes(kind, id_list, range_choice, start, end)
    return Response(
        content=data,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/manifest", response_class=HTMLResponse, dependencies=[Depends(require_api_key_flexible)])
def manifest(
    range_choice: str = Query(default="Tümü", alias="range"),
    start: str = Query(default=""),
    end: str = Query(default=""),
) -> HTMLResponse:
    return HTMLResponse(content=services.build_manifest_html(range_choice, start, end))


@app.get("/api/package", dependencies=[Depends(require_api_key_flexible)])
def package(
    range_choice: str = Query(default="Tümü", alias="range"),
    start: str = Query(default=""),
    end: str = Query(default=""),
    ids: str = Query(default=""),
) -> Response:
    id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()] if ids else None
    data, filename = services.build_operation_package(range_choice, start, end, id_list)
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/photos-zip", dependencies=[Depends(require_api_key_flexible)])
def photos_zip(
    range_choice: str = Query(default="Tümü", alias="range"),
    start: str = Query(default=""),
    end: str = Query(default=""),
) -> Response:
    data, filename = services.date_photo_zip_by_range(range_choice, start, end)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bu aralıkta fotoğraf yok.")
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/template", dependencies=[Depends(require_api_key_flexible)])
def template() -> Response:
    return Response(
        content=services.get_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="gate-visa-passenger-template.xlsx"'},
    )


@app.get("/api/backup", dependencies=[Depends(require_api_key_flexible)])
def backup() -> Response:
    data, filename = services.build_backup()
    return Response(
        content=data,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/restore", response_model=SimpleResult, dependencies=[Depends(require_admin_access)])
async def restore(request: Request, file: UploadFile | None = File(default=None)) -> SimpleResult:
    if file is not None:
        data = await file.read(MAX_RESTORE_BYTES + 1)
    else:
        data = await request.body()
    if len(data) > MAX_RESTORE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Yedek limiti {MAX_RESTORE_BYTES // (1024 * 1024)} MB.",
        )
    ok, message, count = services.restore_backup(data)
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
    return SimpleResult(ok=True, message=message, passenger_count=count)


@app.get("/api/backups", response_model=list[BackupInfo], dependencies=[Depends(require_admin_access)])
def backups_list() -> list[BackupInfo]:
    return [BackupInfo(snapshot_date=item) for item in services.list_daily_backups()]


@app.post(
    "/api/backups/{snapshot_date}/restore",
    response_model=SimpleResult,
    dependencies=[Depends(require_admin_access)],
)
def backup_restore(snapshot_date: str) -> SimpleResult:
    ok, message, count = services.restore_daily_backup(snapshot_date)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
    return SimpleResult(ok=True, message=message, passenger_count=count)


# ------------------------------------------------------------- frontend / spa
@app.api_route("/api/{path:path}", methods=["GET", "POST", "PATCH", "DELETE"], include_in_schema=False)
def api_not_found(path: str):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API endpoint bulunamadı.")


if NEXT_ASSETS.exists():
    from fastapi.staticfiles import StaticFiles

    app.mount("/_next", StaticFiles(directory=str(NEXT_ASSETS)), name="next-assets")


@app.get("/{path:path}", include_in_schema=False)
def serve_frontend(path: str = ""):
    if not FRONTEND_OUT.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Frontend build bulunamadı. Önce `cd frontend && npm run build` çalıştırın.",
        )
    requested = (FRONTEND_OUT / path).resolve()
    if requested.is_file() and FRONTEND_OUT in requested.parents:
        return FileResponse(str(requested))
    # Next static export bazı rotaları route/index.html yerine route.html olarak yazabilir.
    page_file = (FRONTEND_OUT / f"{path.rstrip('/')}.html").resolve() if path else None
    if page_file and page_file.is_file() and FRONTEND_OUT in page_file.parents:
        return FileResponse(str(page_file))
    html_file = (FRONTEND_OUT / path / "index.html").resolve()
    if html_file.is_file() and FRONTEND_OUT in html_file.parents:
        return FileResponse(str(html_file))
    index_file = FRONTEND_OUT / "index.html"
    if not index_file.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Frontend index.html bulunamadı. Next export build eksik.",
        )
    return FileResponse(str(index_file))
