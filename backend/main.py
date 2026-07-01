from __future__ import annotations

import os
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import ALLOWED_IMPORT_EXTENSIONS, MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, allowed_origins
from .models import ImportResponse, OperationSummary, PassengerRecord
from .security import require_api_key
from .services import get_passengers, get_summary, import_gate_visa_files

app = FastAPI(title="Gate Visa PAX API", version="6.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "x-api-key"],
)

ROOT_DIR = Path(__file__).resolve().parents[1]
FRONTEND_OUT = ROOT_DIR / "frontend" / "out"
NEXT_ASSETS = FRONTEND_OUT / "_next"

if NEXT_ASSETS.exists():
    app.mount("/_next", StaticFiles(directory=str(NEXT_ASSETS)), name="next-assets")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/summary", response_model=OperationSummary, dependencies=[Depends(require_api_key)])
def summary() -> OperationSummary:
    return get_summary()


@app.get("/api/passengers", response_model=list[PassengerRecord], dependencies=[Depends(require_api_key)])
def passengers(search: str = Query(default="")) -> list[PassengerRecord]:
    return get_passengers(search=search)


@app.post("/api/import", response_model=ImportResponse, dependencies=[Depends(require_api_key)])
async def import_files(
    files: list[UploadFile] = File(...),
    replace: bool = Query(default=False),
) -> ImportResponse:
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"En fazla {MAX_UPLOAD_FILES} dosya yüklenebilir.",
        )

    payload: list[tuple[str, bytes]] = []
    for upload in files:
        filename = upload.filename or "upload.xlsx"
        ext = os.path.splitext(filename)[1].lower()
        if ext not in ALLOWED_IMPORT_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Desteklenen dosya türleri: .xlsx, .xls, .xlsm, .ods, .csv",
            )
        data = await upload.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Dosya limiti {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            )
        payload.append((filename, data))
    try:
        imported, warnings, loaded_files = import_gate_visa_files(payload, replace=replace)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dosya okunamadı veya desteklenmeyen format.") from exc
    return ImportResponse(imported=imported, warnings=warnings, loaded_files=loaded_files)


@app.api_route("/api/{path:path}", methods=["GET", "POST"], include_in_schema=False)
def api_not_found(path: str):
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API endpoint bulunamadı.")


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
