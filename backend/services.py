from __future__ import annotations

import base64
import concurrent.futures
import json
import logging
import os
import re
import sys
import threading
import time
import uuid
import zipfile
from datetime import datetime
from io import BytesIO
from typing import Iterable

import pandas as pd

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import db  # noqa: E402
import persistence  # noqa: E402
from persistence import StorePersistenceError  # noqa: E402

logger = logging.getLogger(__name__)

from excelbase_core import dataframe_to_csv, dataframe_to_xlsx  # noqa: E402
from gate_visa_reader import read_gate_visa_file_bytes  # noqa: E402
from operation_helpers import (  # noqa: E402
    apply_filters,
    cell_text,
    parse_date_value,
    summarize_group,
)
from passenger_schema import (  # noqa: E402
    ALL_COLUMNS,
    gate_visa_results_to_passengers,
    make_demo_passengers,
    normalize_passenger_dataframe,
    passenger_template_xlsx,
    validate_passenger_rows,
)
from photo_store import (  # noqa: E402
    _norm_key,
    _process_image,
    extract_images_from_zip,
    is_zip,
    looks_like_image,
    match_photos_with_details,
    photo_data_uri,
    photo_raw_bytes,
    save_photo_bytes,
)

from .models import (
    ArchiveGroup,
    ArchiveResponse,
    OperationMeta,
    OperationSummary,
    PassengerRecord,
)
from .state import (
    APP_VERSION,
    locked_mutation,
    duplicate_passport_keys,
    issue_counts,
    load_state,
    passenger_identity_key,
    passenger_identity_keys,
    quick_range_bounds,
    readiness_metrics,
    row_issues,
    save_state,
    today_departures,
)
from .config import (
    ALLOWED_IMPORT_EXTENSIONS,
    MAX_AUDIT_EVENTS,
    MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES,
    MAX_IMPORT_SNAPSHOTS,
    MAX_UPLOAD_BYTES,
)
from .mail_ingest import parse_eml

_UPDATE_FIELDS = {
    "no": "No",
    "first_name": "Ad",
    "last_name": "Soyad",
    "passport_no": "Pasaport No",
    "voucher": "Voucher",
    "departure_date": "Gidiş Tarihi",
    "arrival_date": "Varış Tarihi",
    "adult_fee": "Vize Ücreti Yetişkin",
    "child_fee": "Vize Ücreti Çocuk",
}

_AUDIT_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=2,
    thread_name_prefix="gatevisa-audit",
)


def _text(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "nan" else text


def _record(idx: int, row: pd.Series, dup_keys: set[str], with_key: str = "") -> PassengerRecord:
    photo = _text(row.get("Foto"))
    photo_url = ""
    if photo:
        photo_url = f"/api/photo/{photo}"
        if with_key:
            photo_url += f"?k={with_key}"
    issues = row_issues(row, dup_keys)
    return PassengerRecord(
        id=int(idx),
        no=_text(row.get("No")),
        first_name=_text(row.get("Ad")),
        last_name=_text(row.get("Soyad")),
        full_name=_text(row.get("Yolcu Adı Soyadı")),
        passport_no=_text(row.get("Pasaport No")),
        voucher=_text(row.get("Voucher")),
        departure_date=_text(row.get("Gidiş Tarihi")),
        arrival_date=_text(row.get("Varış Tarihi")),
        adult_fee=_text(row.get("Vize Ücreti Yetişkin")),
        child_fee=_text(row.get("Vize Ücreti Çocuk")),
        source_file=_text(row.get("Kaynak Dosya")),
        sheet=_text(row.get("Sayfa")),
        photo=photo,
        photo_url=photo_url,
        issues=issues,
        duplicate="Tekrarlı" in issues,
    )


def dataframe_to_records(
    df: pd.DataFrame,
    with_key: str = "",
    duplicate_keys: set[str] | None = None,
) -> list[PassengerRecord]:
    if df.empty:
        return []
    dup_keys = duplicate_passport_keys(df) if duplicate_keys is None else duplicate_keys
    return [_record(int(i), row, dup_keys, with_key) for i, row in df.iterrows()]


def _status_mask(
    df: pd.DataFrame,
    status: str,
    duplicate_keys: set[str] | None = None,
) -> pd.Series:
    dup = duplicate_passport_keys(df) if duplicate_keys is None else duplicate_keys
    if status == "Fotosuz":
        return df["Foto"].astype(str).str.strip().eq("")
    if status == "Pasaportsuz":
        return df["Pasaport No"].astype(str).str.strip().eq("")
    if status == "Voucher eksik":
        return df["Voucher"].astype(str).str.strip().eq("")
    if status == "Ücretsiz":
        adult = df["Vize Ücreti Yetişkin"].astype(str).str.strip()
        child = df["Vize Ücreti Çocuk"].astype(str).str.strip()
        return adult.eq("") & child.eq("")
    if status == "Tekrarlı":
        return passenger_identity_keys(df).isin(dup)
    if status == "İsim eksik":
        return df["Yolcu Adı Soyadı"].astype(str).str.strip().eq("")
    if status == "Tarih hatası":
        return df.apply(
            lambda row: bool(
                parse_date_value(row.get("Gidiş Tarihi"))
                and parse_date_value(row.get("Varış Tarihi"))
                and parse_date_value(row.get("Varış Tarihi")) < parse_date_value(row.get("Gidiş Tarihi"))
            ),
            axis=1,
        )
    if status == "Eksik":
        dup_keys = dup
        return df.apply(lambda r: bool(row_issues(r, dup_keys)), axis=1)
    if status == "Hazır":
        dup_keys = dup
        return df.apply(lambda r: not row_issues(r, dup_keys), axis=1)
    return pd.Series([True] * len(df), index=df.index)


def _sort_df(df: pd.DataFrame, sort: str) -> pd.DataFrame:
    if df.empty or not sort:
        return df
    if sort == "name":
        return df.sort_values("Yolcu Adı Soyadı", key=lambda s: s.astype(str).str.casefold(), kind="stable")
    if sort == "departure":
        return df.sort_values(
            "Gidiş Tarihi",
            key=lambda s: s.map(lambda v: parse_date_value(v) or pd.Timestamp.max.date()),
            kind="stable",
        )
    if sort == "passport":
        return df.sort_values("Pasaport No", key=lambda s: s.astype(str).str.casefold(), kind="stable")
    return df


def get_passengers(
    search: str = "",
    status: str = "",
    sort: str = "",
    with_key: str = "",
    range_choice: str = "Tümü",
    start: str = "",
    end: str = "",
) -> list[PassengerRecord]:
    df, dup_keys = _filtered_passengers(search, status, sort, range_choice, start, end)
    return dataframe_to_records(df, with_key, dup_keys)


def _filtered_passengers(
    search: str = "",
    status: str = "",
    sort: str = "",
    range_choice: str = "Tümü",
    start: str = "",
    end: str = "",
) -> tuple[pd.DataFrame, set[str]]:
    df, _, _ = load_state()
    if df.empty:
        return df, set()
    df = _scoped_df(df, range_choice, start, end)
    # Duplicate state belongs to the whole selected date scope, not merely the
    # current search result or 20-row page. Otherwise matching copies split
    # across pages appear clean even though the status filter selected them as
    # duplicates.
    dup_keys = duplicate_passport_keys(df)
    if search:
        df = apply_filters(df, search, {})
    if status:
        df = df[_status_mask(df, status, dup_keys)]
    df = _sort_df(df, sort)
    return df, dup_keys


def get_passenger_page(
    search: str = "",
    status: str = "",
    sort: str = "",
    with_key: str = "",
    offset: int = 0,
    limit: int = 20,
    range_choice: str = "Tümü",
    start: str = "",
    end: str = "",
) -> tuple[list[PassengerRecord], int]:
    """Return only the visible rows while preserving stable dataframe IDs."""
    df, dup_keys = _filtered_passengers(search, status, sort, range_choice, start, end)
    total = len(df)
    start_at = max(0, int(offset))
    page_size = max(1, min(int(limit), 100))
    return (
        dataframe_to_records(
            df.iloc[start_at : start_at + page_size],
            with_key,
            dup_keys,
        ),
        total,
    )


def get_summary(range_choice: str = "Tümü", start: str = "", end: str = "") -> OperationSummary:
    df, loaded_files, extra = load_state()
    df = _scoped_df(df, range_choice, start, end)
    summary = summarize_group(df)
    metrics = readiness_metrics(df)
    missing_count = int(_status_mask(df, "Eksik").sum()) if not df.empty else 0
    active_batches = [b for b in extra.get("import_batches", []) if b.get("status") == "active"]
    last_batch = active_batches[0] if active_batches else None
    return OperationSummary(
        passenger_count=int(summary["count"]),
        adult_total=float(summary["adult_total"]),
        child_total=float(summary["child_total"]),
        total_fee=float(summary["total"]),
        with_photo=int(summary["with_photo"]),
        missing_photo=metrics["photo_missing"],
        missing_passport=metrics["passport_missing"],
        missing_voucher=metrics["voucher_missing"],
        missing_fee=metrics["fee_missing"],
        duplicates=metrics["duplicates"],
        ready_count=max(0, len(df) - missing_count),
        missing_count=missing_count,
        readiness_percent=metrics["pct"],
        issue_counts=issue_counts(df),
        loaded_files=list(loaded_files),
        import_history=list(extra.get("import_history", []))[:12],
        today_count=today_departures(df),
        can_undo=bool(last_batch),
        last_batch_id=str(last_batch.get("id", "")) if last_batch else "",
        unmatched_photo_count=len(extra.get("unmatched_photos", [])),
        persistence="database" if db.enabled() else "local-fallback",
        version=APP_VERSION,
    )


def _parse_import_files(files: Iterable[tuple[str, bytes]]) -> tuple[pd.DataFrame, list[str], list[str]]:
    all_results = []
    loaded_names: list[str] = []
    for filename, data in files:
        loaded_names.append(filename)
        all_results.extend(read_gate_visa_file_bytes(filename, data))
    imported_df = gate_visa_results_to_passengers(all_results)
    if imported_df.empty:
        errors: list[str] = []
        for result in all_results:
            if "Hata" not in result.dataframe.columns:
                continue
            errors.extend(
                str(value).strip()
                for value in result.dataframe["Hata"].tolist()
                if str(value).strip()
            )
        detail = errors[0] if errors else "Dosyada aktarılabilir yolcu satırı bulunamadı."
        raise ValueError(detail)
    return imported_df, loaded_names, validate_passenger_rows(imported_df)


PARSE_IMPORT_TIMEOUT_SECONDS = 120


def _parse_import_files_with_timeout(
    files: Iterable[tuple[str, bytes]],
    timeout: float = PARSE_IMPORT_TIMEOUT_SECONDS,
) -> tuple[pd.DataFrame, list[str], list[str]]:
    """Dosya ayrıştırmayı ayrı bir iş parçacığında sınırlı sürede çalıştırır.

    Bozuk/aşırı büyük bir dosya openpyxl/pandas içinde asılı kalırsa bu
    çağrı yine de zaman aşımıyla döner; ayrıştırma MUTATION_LOCK dışında
    çalıştığı için diğer yazma işlemlerini bloklamaz.
    """
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(_parse_import_files, files)
        try:
            result = future.result(timeout=timeout)
        except concurrent.futures.TimeoutError as exc:
            raise TimeoutError(
                "Dosya işlenemedi: ayrıştırma zaman aşımına uğradı. "
                "Dosya çok büyük veya bozuk olabilir; daha küçük bir dosyayla tekrar deneyin."
            ) from exc
    finally:
        pool.shutdown(wait=False)
    return result


def _critical_import_count(df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    count = 0
    for _, row in df.iterrows():
        passport = _norm_key(row.get("Pasaport No"))
        departure = parse_date_value(row.get("Gidiş Tarihi"))
        arrival = parse_date_value(row.get("Varış Tarihi"))
        if (
            not cell_text(row.get("Yolcu Adı Soyadı"))
            or not passport
            or len(passport) < 6
            or (departure and arrival and arrival < departure)
        ):
            count += 1
    return count


def preview_gate_visa_files(files: Iterable[tuple[str, bytes]]) -> tuple[str, int, list[str], int, int]:
    imported_df, loaded_names, warnings = _parse_import_files(files)
    current_df, _, _ = load_state()
    existing = set(passenger_identity_keys(current_df)) - {""}
    imported_keys = passenger_identity_keys(imported_df)
    seen = set(existing)
    duplicate_count = 0
    for key in imported_keys:
        if key and key in seen:
            duplicate_count += 1
        elif key:
            seen.add(key)
    return (
        loaded_names[0] if loaded_names else "dosya",
        len(imported_df),
        warnings,
        duplicate_count,
        _critical_import_count(imported_df),
    )


def _ensure_import_batch(
    extra: dict,
    batch_id: str,
    current_df: pd.DataFrame,
    current_loaded: list[str],
    mode: str,
) -> dict:
    batches = list(extra.get("import_batches", []))
    for batch in batches:
        if batch.get("id") == batch_id and batch.get("status") == "active":
            return batch
    safe = current_df.fillna("").astype(str) if not current_df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    batch = {
        "id": batch_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "status": "active",
        "mode": mode,
        "replace_requested": mode == "Değiştir",
        "replace_consumed": False,
        "files": [],
        "rows": 0,
        "before_passengers": safe.to_dict(orient="records"),
        "before_loaded_files": list(current_loaded),
        "before_date_meta": dict(extra.get("date_meta", {})),
    }
    batches.insert(0, batch)
    extra["import_batches"] = batches[:MAX_IMPORT_SNAPSHOTS]
    return batch


def _update_import_history(extra: dict, batch: dict) -> None:
    history = list(extra.get("import_history", []))
    item = next((entry for entry in history if entry.get("batch_id") == batch["id"]), None)
    filenames = list(batch.get("files", []))
    files_text = ", ".join(filenames[:3])
    if len(filenames) > 3:
        files_text += f" +{len(filenames) - 3} dosya"
    payload = {
        "batch_id": batch["id"],
        "time": datetime.now().strftime("%d.%m.%Y %H:%M"),
        "files": files_text or "—",
        "file_count": len(filenames),
        "rows": int(batch.get("rows", 0)),
        "mode": batch.get("mode", "Ekle"),
        "undone": False,
    }
    if item is None:
        history.insert(0, payload)
    else:
        item.update(payload)
    extra["import_history"] = history[:50]


def import_gate_visa_files(
    files: Iterable[tuple[str, bytes]],
    replace: bool = False,
    dup_strategy: str = "add",
    batch_id: str = "",
    job_id: str = "",
) -> tuple[int, list[str], list[str], int, str, int, int]:
    # Ayrıştırma (yavaş, dosya içeriğine bağlı) kilit DIŞINDA çalışır; böylece
    # bozuk/büyük tek bir dosya tüm uygulamanın yazma işlemlerini kilitlemez.
    imported_df, loaded_names, warnings = _parse_import_files_with_timeout(files)
    return _merge_and_save_import(
        imported_df,
        loaded_names,
        warnings,
        replace,
        dup_strategy,
        batch_id,
        job_id,
    )


@locked_mutation
def _merge_and_save_import(
    imported_df: pd.DataFrame,
    loaded_names: list[str],
    warnings: list[str],
    replace: bool = False,
    dup_strategy: str = "add",
    batch_id: str = "",
    job_id: str = "",
) -> tuple[int, list[str], list[str], int, str, int, int]:
    current_df, current_loaded, extra = load_state()
    batch_id = batch_id.strip() or str(uuid.uuid4())
    mode = "Değiştir" if (replace or current_df.empty) else f"Ekle ({dup_strategy})"
    batch = _ensure_import_batch(extra, batch_id, current_df, current_loaded, mode)
    prior_results = dict(batch.get("job_results", {}) or {})
    if job_id and job_id in prior_results:
        prior = dict(prior_results[job_id] or {})
        return (
            int(prior.get("imported", 0) or 0),
            list(prior.get("warnings", []) or []),
            list(current_loaded),
            len(current_df),
            batch_id,
            int(prior.get("duplicates", 0) or 0),
            int(prior.get("invalid", 0) or 0),
        )
    if replace:
        batch["replace_requested"] = True
    # `replace` artık "bu batch listeyi değiştirmek istiyor" niyetidir.
    # Ayrıştırma bu fonksiyondan önce tamamlandığı için bozuk dosya buraya hiç
    # ulaşmaz ve hakkı tüketmez. Kilit altında ilk başarılı dosya tüketir;
    # aynı batch'in sonraki sağlam dosyaları normal ekleme olarak devam eder.
    effective_replace = bool(batch.get("replace_requested")) and not bool(batch.get("replace_consumed"))
    if effective_replace:
        batch["replace_consumed"] = True
        batch["mode"] = "Değiştir"
    existing_keys = set(passenger_identity_keys(current_df)) - {""}
    imported_keys = passenger_identity_keys(imported_df)
    seen_for_count = set(existing_keys)
    duplicate_count = 0
    for key in imported_keys:
        if key and key in seen_for_count:
            duplicate_count += 1
        elif key:
            seen_for_count.add(key)
    invalid_count = _critical_import_count(imported_df)
    accepted_count = len(imported_df)

    if effective_replace or current_df.empty:
        next_df = imported_df
        next_loaded = loaded_names
    elif dup_strategy == "skip":
        seen = set(existing_keys)
        keep: list[bool] = []
        for key in imported_keys:
            accepted = not (key and key in seen)
            keep.append(accepted)
            if accepted and key:
                seen.add(key)
        next_df = normalize_passenger_dataframe(pd.concat([current_df, imported_df[keep]], ignore_index=True))
        next_loaded = list(dict.fromkeys([*current_loaded, *loaded_names]))
        accepted_count = int(sum(keep))
    elif dup_strategy == "overwrite":
        result = current_df.copy().reset_index(drop=True)
        ex = {key: i for i, key in enumerate(passenger_identity_keys(result)) if key}
        new_rows_by_key: dict[str, pd.Series] = {}
        unkeyed_rows: list[pd.Series] = []
        for _, row in imported_df.iterrows():
            key = passenger_identity_key(row.get("Pasaport No"), row.get("Gidiş Tarihi"))
            if key and key in ex:
                tgt = ex[key]
                for col in ALL_COLUMNS:
                    val = str(row.get(col, "") or "")
                    if col == "Foto" and not val:
                        continue
                    result.at[tgt, col] = val
            elif key:
                new_rows_by_key[key] = row
            else:
                unkeyed_rows.append(row)
        new_rows = [*new_rows_by_key.values(), *unkeyed_rows]
        if new_rows:
            result = pd.concat([result, pd.DataFrame(new_rows)], ignore_index=True).fillna("")
        next_df = normalize_passenger_dataframe(result)
        next_loaded = list(dict.fromkeys([*current_loaded, *loaded_names]))
    else:
        next_df = normalize_passenger_dataframe(pd.concat([current_df, imported_df], ignore_index=True))
        next_loaded = list(dict.fromkeys([*current_loaded, *loaded_names]))

    batch["files"] = list(dict.fromkeys([*batch.get("files", []), *loaded_names]))
    batch["rows"] = int(batch.get("rows", 0)) + int(accepted_count)
    if job_id:
        prior_results[job_id] = {
            "imported": int(accepted_count),
            "duplicates": int(duplicate_count),
            "invalid": int(invalid_count),
            "warnings": list(warnings[:10]),
        }
        batch["job_results"] = prior_results
    _update_import_history(extra, batch)

    saved = save_state(next_df, next_loaded, extra)
    return (
        int(accepted_count),
        warnings,
        list(next_loaded),
        len(saved),
        batch_id,
        duplicate_count,
        invalid_count,
    )


@locked_mutation
def undo_import(batch_id: str = "") -> tuple[bool, str, int]:
    df, loaded_files, extra = load_state()
    active = [batch for batch in extra.get("import_batches", []) if batch.get("status") == "active"]
    if not active:
        return False, "Geri alinabilecek bir aktarim yok.", len(df)
    batch = active[0]
    if batch_id and batch.get("id") != batch_id:
        return False, "Yalnizca son aktarim geri alinabilir.", len(df)
    restored = pd.DataFrame(batch.get("before_passengers", []))
    restored = normalize_passenger_dataframe(restored) if not restored.empty else pd.DataFrame(columns=ALL_COLUMNS)
    batch["status"] = "undone"
    batch["undone_at"] = datetime.now().isoformat(timespec="seconds")
    extra["date_meta"] = dict(batch.get("before_date_meta", {}))
    for item in extra.get("import_history", []):
        if item.get("batch_id") == batch.get("id"):
            item["undone"] = True
            item["mode"] = f"{item.get('mode', 'Aktarim')} · geri alindi"
    saved = save_state(restored, list(batch.get("before_loaded_files", [])), extra)
    return True, "Son toplu aktarim geri alindi.", len(saved)


def record_audit(actor_name: str, role: str, action: str, path: str) -> None:
    """Audit'i yolcu blob'undan ayrı yazar; aktarım kuyruğuyla kilit yarışmaz."""
    event_id = str(uuid.uuid4())
    occurred_at = datetime.now().isoformat(timespec="seconds")
    if db.enabled() and hasattr(db, "insert_audit_event"):
        db.insert_audit_event(
            actor_name,
            role,
            action,
            path,
            event_id=event_id,
            occurred_at=occurred_at,
        )
        return
    audit_path = os.path.join(os.path.dirname(persistence.STORE_PATH), "audit.json")
    with _LOCAL_QUEUE_LOCK:
        try:
            with open(audit_path, "r", encoding="utf-8") as handle:
                events = list(json.load(handle))
        except (FileNotFoundError, ValueError, OSError):
            events = []
        events.insert(
            0,
            {
                "id": event_id,
                "time": occurred_at,
                "actor": actor_name,
                "role": role,
                "action": action,
                "path": path,
            },
        )
        os.makedirs(os.path.dirname(audit_path), exist_ok=True)
        tmp = audit_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(events[:MAX_AUDIT_EVENTS], handle, ensure_ascii=False)
        os.replace(tmp, audit_path)


def get_audit(limit: int = 100) -> list[dict]:
    resolved = max(1, min(limit, 500))
    if db.enabled() and hasattr(db, "list_audit_events"):
        return list(db.list_audit_events(resolved) or [])
    audit_path = os.path.join(os.path.dirname(persistence.STORE_PATH), "audit.json")
    try:
        with open(audit_path, "r", encoding="utf-8") as handle:
            return list(json.load(handle))[:resolved]
    except (FileNotFoundError, ValueError, OSError):
        # Bir sürüm boyunca eski audit kayıtlarını okunabilir tut; yeni kayıtlar
        # artık yolcu state'ine yazılmaz.
        _, _, extra = load_state()
        return list(extra.get("audit_log", []))[:resolved]


def record_audit_async(actor_name: str, role: str, action: str, path: str) -> None:
    """Sınırlı executor, yoğun mutasyonlarda sınırsız daemon thread oluşmasını önler."""
    try:
        _AUDIT_EXECUTOR.submit(record_audit, actor_name, role, action, path)
    except RuntimeError:
        logger.warning("Audit executor kapalı; olay yazılamadı path=%s", path)


@locked_mutation
def update_passenger(passenger_id: int, updates: dict[str, str | None]) -> bool:
    df, loaded_files, extra = load_state()
    if passenger_id < 0 or passenger_id >= len(df):
        return False
    idx = df.index[passenger_id]
    for field, value in updates.items():
        col = _UPDATE_FIELDS.get(field)
        if col is not None and value is not None:
            df.at[idx, col] = value
    ad = str(df.at[idx, "Ad"] or "").strip()
    soyad = str(df.at[idx, "Soyad"] or "").strip()
    df.at[idx, "Yolcu Adı Soyadı"] = f"{ad} {soyad}".strip()
    save_state(df, loaded_files, extra)
    return True


@locked_mutation
def delete_passenger(passenger_id: int) -> int:
    df, loaded_files, extra = load_state()
    if passenger_id < 0 or passenger_id >= len(df):
        return -1
    idx = df.index[passenger_id]
    df = df.drop(index=idx).reset_index(drop=True)
    saved = save_state(df, loaded_files, extra)
    return len(saved)


@locked_mutation
def bulk_delete(ids: list[int]) -> int:
    df, loaded_files, extra = load_state()
    if df.empty:
        return 0
    valid = sorted({i for i in ids if 0 <= i < len(df)})
    if not valid:
        return len(df)
    labels = [df.index[i] for i in valid]
    df = df.drop(index=labels).reset_index(drop=True)
    saved = save_state(df, loaded_files, extra)
    return len(saved)


@locked_mutation
def clear_all() -> int:
    _, _, extra = load_state()
    save_state(pd.DataFrame(columns=ALL_COLUMNS), [], extra)
    return 0


@locked_mutation
def load_demo() -> int:
    _, _, extra = load_state()
    saved = save_state(make_demo_passengers(), ["demo-gate-visa.xlsx"], extra)
    return len(saved)


@locked_mutation
def set_passenger_photo(passenger_id: int, filename: str, data: bytes) -> bool:
    df, loaded_files, extra = load_state()
    if passenger_id < 0 or passenger_id >= len(df):
        return False
    if not looks_like_image(filename, data):
        raise ValueError("Seçilen dosya bir görüntü değil.")
    idx = df.index[passenger_id]
    key = _norm_key(df.at[idx, "Pasaport No"]) or f"row{passenger_id}"
    processed, new_ext = _process_image(data)
    stored = save_photo_bytes(key, new_ext or ".jpg", processed)
    df.at[idx, "Foto"] = stored
    save_state(df, loaded_files, extra)
    return True


@locked_mutation
def remove_passenger_photo(passenger_id: int) -> bool:
    df, loaded_files, extra = load_state()
    if passenger_id < 0 or passenger_id >= len(df):
        return False
    idx = df.index[passenger_id]
    df.at[idx, "Foto"] = ""
    save_state(df, loaded_files, extra)
    return True


@locked_mutation
def match_photos(files: Iterable[tuple[str, bytes]]) -> tuple[int, list[str], int, int, list[dict]]:
    df, loaded_files, extra = load_state()
    if df.empty:
        return 0, [name for name, _ in files], 0, 0, []
    uploaded: list[tuple[str, bytes]] = []
    skipped: list[str] = []
    for filename, data in files:
        if is_zip(filename, data):
            images = extract_images_from_zip(data)
            if images:
                uploaded.extend(images)
            else:
                skipped.append(filename)
        elif looks_like_image(filename, data):
            uploaded.append((filename, data))
        else:
            skipped.append(filename)
    updated, matches, unmatched_payload = match_photos_with_details(df, uploaded)
    unmatched_items = list(extra.get("unmatched_photos", []))
    unmatched_names: list[str] = []
    for filename, data in unmatched_payload:
        item_id = str(uuid.uuid4())
        processed, new_ext = _process_image(data)
        _, original_ext = os.path.splitext(filename)
        ref = save_photo_bytes(f"unmatched_{item_id}", new_ext or original_ext, processed)
        unmatched_items.insert(
            0,
            {
                "id": item_id,
                "filename": filename,
                "ref": ref,
                "created_at": datetime.now().isoformat(timespec="seconds"),
            },
        )
        unmatched_names.append(filename)
    extra["unmatched_photos"] = unmatched_items[:500]
    saved = save_state(updated, loaded_files, extra)
    with_photo = int(saved["Foto"].astype(str).str.strip().ne("").sum()) if not saved.empty else 0
    return len(matches), [*unmatched_names, *skipped], len(saved), with_photo, matches


def get_unmatched_photos(with_key: str = "") -> list[dict]:
    _, _, extra = load_state()
    items = []
    for item in extra.get("unmatched_photos", []):
        path = f"/api/photo/{item.get('ref', '')}"
        if with_key:
            path += f"?k={with_key}"
        items.append(
            {
                "id": str(item.get("id", "")),
                "filename": str(item.get("filename", "")),
                "photo_url": path,
                "created_at": str(item.get("created_at", "")),
            }
        )
    return items


@locked_mutation
def assign_unmatched_photo(item_id: str, passenger_id: int) -> tuple[bool, str]:
    df, loaded_files, extra = load_state()
    if passenger_id < 0 or passenger_id >= len(df):
        return False, "Yolcu bulunamadi."
    items = list(extra.get("unmatched_photos", []))
    item = next((entry for entry in items if str(entry.get("id")) == item_id), None)
    if item is None:
        return False, "Fotograf bulunamadi."
    idx = df.index[passenger_id]
    df.at[idx, "Foto"] = str(item.get("ref", ""))
    extra["unmatched_photos"] = [entry for entry in items if str(entry.get("id")) != item_id]
    save_state(df, loaded_files, extra)
    return True, "Fotograf yolcuya atandi."


@locked_mutation
def delete_unmatched_photo(item_id: str) -> bool:
    df, loaded_files, extra = load_state()
    items = list(extra.get("unmatched_photos", []))
    remaining = [entry for entry in items if str(entry.get("id")) != item_id]
    if len(remaining) == len(items):
        return False
    extra["unmatched_photos"] = remaining
    save_state(df, loaded_files, extra)
    return True


@locked_mutation
def merge_duplicates(passport_key: str | None = None) -> tuple[int, int]:
    df, loaded_files, extra = load_state()
    if df.empty:
        return 0, 0
    identities = passenger_identity_keys(df)
    dup_keys = sorted(set(identities[identities.ne("") & identities.duplicated(keep=False)]))
    targets = [key for key in dup_keys if not passport_key or key.startswith(f"{passport_key}|")]
    removed = 0
    for key in targets:
        if not key:
            continue
        identities = passenger_identity_keys(df)
        group_idx = list(df[identities == key].index)
        if len(group_idx) < 2:
            continue
        merged: dict[str, str] = {}
        for col in ALL_COLUMNS:
            merged[col] = ""
            for i in group_idx:
                val = str(df.at[i, col] or "").strip()
                if val:
                    merged[col] = val
                    break
        keep_idx = group_idx[0]
        for col, val in merged.items():
            df.at[keep_idx, col] = val
        df = df.drop(index=group_idx[1:]).reset_index(drop=True)
        removed += len(group_idx) - 1
    saved = save_state(df, loaded_files, extra)
    return removed, len(saved)


def _scoped_df(df: pd.DataFrame, range_choice: str, start: str = "", end: str = "") -> pd.DataFrame:
    bounds = quick_range_bounds(range_choice) if range_choice not in ("", "Tümü", "Aralık") else None
    if range_choice == "Aralık" and (start or end):
        s = parse_date_value(start) if start else None
        e = parse_date_value(end) if end else None
        bounds = (s or e, e or s) if (s or e) else None
    if bounds is None:
        return df
    lo, hi = bounds

    def _in(value) -> bool:
        d = parse_date_value(value)
        return d is not None and lo <= d <= hi

    return df[df["Gidiş Tarihi"].map(_in)]


def get_archive(range_choice: str = "Tümü", start: str = "", end: str = "") -> ArchiveResponse:
    df, _, extra = load_state()
    if df.empty:
        return ArchiveResponse(groups=[], total_count=0)
    scoped = _scoped_df(df, range_choice, start, end)
    date_meta = extra.get("date_meta", {})
    groups: dict[str, list[int]] = {}
    for pos, (_, value) in enumerate(scoped["Gidiş Tarihi"].astype(str).str.strip().items()):
        key = value if value else "Tarihsiz"
        groups.setdefault(key, []).append(pos)

    positions = {idx_label: pos for pos, idx_label in enumerate(df.index)}

    def sort_key(item: str) -> tuple[int, str]:
        return (1, "") if item == "Tarihsiz" else (0, item)

    out: list[ArchiveGroup] = []
    for date_key in sorted(groups.keys(), key=sort_key):
        labels = [scoped.index[p] for p in groups[date_key]]
        sub = scoped.loc[labels]
        summ = summarize_group(sub)
        meta_raw = date_meta.get(date_key)
        meta = None
        if meta_raw:
            meta = OperationMeta(
                date_key=date_key,
                status=str(meta_raw.get("status", "Hazırlanıyor")),
                staff=str(meta_raw.get("staff", "")),
                note=str(meta_raw.get("note", "")),
            )
        out.append(ArchiveGroup(
            date_key=date_key,
            count=int(summ["count"]),
            adult_total=float(summ["adult_total"]),
            child_total=float(summ["child_total"]),
            total=float(summ["total"]),
            with_photo=int(summ["with_photo"]),
            passenger_ids=[positions[lbl] for lbl in labels],
            meta=meta,
        ))
    return ArchiveResponse(groups=out, total_count=int(len(scoped)))


@locked_mutation
def save_operation_meta(date_key: str, status: str, staff: str, note: str) -> None:
    df, loaded_files, extra = load_state()
    meta = dict(extra.get("date_meta", {}))
    meta[date_key] = {"status": status, "staff": staff, "note": note}
    extra["date_meta"] = meta
    save_state(df, loaded_files, extra)


def _subset_by_ids(df: pd.DataFrame, ids: list[int] | None) -> pd.DataFrame:
    if not ids:
        return df
    valid = [i for i in ids if 0 <= i < len(df)]
    labels = [df.index[i] for i in valid]
    return df.loc[labels]


def export_bytes(
    kind: str,
    ids: list[int] | None = None,
    range_choice: str = "Tümü",
    start: str = "",
    end: str = "",
) -> tuple[bytes, str, str]:
    df, _, _ = load_state()
    sub = _scoped_df(df, range_choice, start, end)
    sub = _subset_by_ids(sub, ids)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    if kind == "csv":
        return dataframe_to_csv(sub), f"yolcular-{stamp}.csv", "text/csv"
    return (
        dataframe_to_xlsx(sub),
        f"yolcular-{stamp}.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


def build_date_photo_zip(df: pd.DataFrame) -> bytes | None:
    rows = [r for _, r in df.iterrows() if str(r.get("Foto", "") or "").strip()]
    if not rows:
        return None
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        used: set[str] = set()
        for row in rows:
            uri = photo_data_uri(str(row.get("Foto", "") or ""))
            if not uri or "," not in uri:
                continue
            try:
                data = base64.b64decode(uri.split(",", 1)[1])
            except Exception:
                continue
            base = cell_text(row.get("Pasaport No")) or cell_text(row.get("Yolcu Adı Soyadı")) or "foto"
            base = "".join(c if c.isalnum() or c in "-_" else "_" for c in base)
            name = f"{base}.jpg"
            n = 1
            while name in used:
                name = f"{base}_{n}.jpg"
                n += 1
            used.add(name)
            zf.writestr(name, data)
    return buf.getvalue()


def build_operation_package(
    range_choice: str = "Tümü",
    start: str = "",
    end: str = "",
    ids: list[int] | None = None,
) -> tuple[bytes, str]:
    df, loaded_files, extra = load_state()
    df = _scoped_df(df, range_choice, start, end)
    df = _subset_by_ids(df, ids)
    report = {
        "version": APP_VERSION,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "summary": summarize_group(df),
        "readiness": readiness_metrics(df),
        "import_history": extra.get("import_history", []),
        "date_meta": extra.get("date_meta", {}),
    }
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("yolcular.xlsx", dataframe_to_xlsx(df))
        zf.writestr("yolcular.csv", dataframe_to_csv(df))
        zf.writestr("rapor.json", json.dumps(report, ensure_ascii=False, indent=2))
        photo_zip = build_date_photo_zip(df)
        if photo_zip:
            zf.writestr("fotograflar.zip", photo_zip)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    label = "secili" if ids else ("tum" if range_choice == "Tümü" else (start or range_choice).replace(" ", "-").lower())
    return buf.getvalue(), f"gatevisa-{label}-{stamp}.zip"


def date_photo_zip_by_range(range_choice: str, start: str, end: str) -> tuple[bytes | None, str]:
    df, _, _ = load_state()
    scoped = _scoped_df(df, range_choice, start, end)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return build_date_photo_zip(scoped), f"fotograflar-{stamp}.zip"


def build_backup() -> tuple[bytes, str]:
    df, loaded_files, extra = load_state()
    safe = df.fillna("").astype(str) if not df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    payload = {
        "version": APP_VERSION,
        "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "passengers": safe.to_dict(orient="records"),
        "loaded_files": list(loaded_files),
        "import_history": extra.get("import_history", []),
        "date_meta": extra.get("date_meta", {}),
    }
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"), f"gatevisa-yedek-{stamp}.json"


@locked_mutation
def restore_backup(data: bytes) -> tuple[bool, str, int]:
    try:
        payload = json.loads(data.decode("utf-8"))
    except Exception:
        return False, "Geçersiz JSON dosyası.", 0
    records = payload.get("passengers")
    if records is None:
        return False, "Yedekte 'passengers' alanı yok.", 0
    df = pd.DataFrame(records)
    df = normalize_passenger_dataframe(df) if not df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    extra = {
        "import_history": list(payload.get("import_history", []) or []),
        "date_meta": dict(payload.get("date_meta", {}) or {}),
    }
    saved = save_state(df, list(payload.get("loaded_files", []) or []), extra)
    return True, f"{len(saved)} yolcu geri yüklendi.", len(saved)


def get_photo(ref: str) -> tuple[str, bytes] | None:
    return photo_raw_bytes(ref)


def build_manifest_html(range_choice: str = "Tümü", start: str = "", end: str = "") -> str:
    df, _, _ = load_state()
    df = _scoped_df(df, range_choice, start, end)
    import html as _html

    rows_html = "".join(
        f"<tr><td>{i + 1}</td><td>{_html.escape(cell_text(r.get('Yolcu Adı Soyadı')) or '—')}</td>"
        f"<td>{_html.escape(cell_text(r.get('Pasaport No')) or '—')}</td>"
        f"<td>{_html.escape(cell_text(r.get('Voucher')) or '—')}</td>"
        f"<td>{_html.escape(cell_text(r.get('Gidiş Tarihi')) or '—')}</td>"
        f"<td>{_html.escape(cell_text(r.get('Varış Tarihi')) or '—')}</td>"
        f"<td>{'✓' if str(r.get('Foto', '') or '').strip() else '—'}</td></tr>"
        for i, (_, r) in enumerate(df.iterrows())
    )
    now = datetime.now().strftime("%d.%m.%Y %H:%M")
    return f"""<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gate Visa Operations — Manifest</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 24px; color: #0f172a; }}
  h3 {{ margin: 0 0 4px; }}
  .sub {{ color: #64748b; font-size: 13px; margin-bottom: 16px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  th, td {{ border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; }}
  th {{ background: #f1f5f9; }}
  .print-btn {{ margin-top: 16px; padding: 10px 16px; border: 0; border-radius: 8px;
    background: #102a43; color: #fff; font-weight: 700; cursor: pointer; }}
  @media print {{ .print-btn {{ display: none; }} }}
</style></head><body>
<h3>Gate Visa Operations — Manifest</h3>
<div class="sub">{now} · Toplam {len(df)} yolcu</div>
<table><thead><tr><th>#</th><th>Ad Soyad</th><th>Pasaport</th><th>Voucher</th><th>Gidiş</th><th>Varış</th><th>Foto</th></tr></thead>
<tbody>{rows_html}</tbody></table>
<button class="print-btn" onclick="window.print()">Yazdır</button>
</body></html>"""


def get_template() -> bytes:
    return passenger_template_xlsx()


def list_daily_backups() -> list[str]:
    return db.list_daily_backups()


@locked_mutation
def restore_daily_backup(snapshot_date: str) -> tuple[bool, str, int]:
    payload = db.load_daily_backup(snapshot_date)
    if payload is None:
        return False, "Yedek bulunamadi veya sifresi acilamadi.", 0
    from persistence import _payload_to_state

    df, loaded_files, backup_extra = _payload_to_state(payload)
    _, _, current_extra = load_state()
    # Erisim ayarlari ve audit kaydi mevcut sistemden korunur.
    backup_extra["auth"] = current_extra.get("auth", {})
    backup_extra["audit_log"] = current_extra.get("audit_log", [])
    saved = save_state(df, loaded_files, backup_extra)
    return True, f"{snapshot_date} tarihli yedek geri yuklendi.", len(saved)


@locked_mutation
def ingest_eml(filename: str, data: bytes, batch_id: str = "") -> dict:
    parsed = parse_eml(data)
    excel_files: list[tuple[str, bytes]] = []
    image_files: list[tuple[str, bytes]] = []
    documents: list[dict] = []
    for attachment in parsed["attachments"]:
        attachment_name = str(attachment["filename"])
        extension = os.path.splitext(attachment_name)[1].lower()
        if extension in {".xlsx", ".xls", ".xlsm", ".ods", ".csv"}:
            excel_files.append((attachment_name, attachment["data"]))
        elif looks_like_image(attachment_name, attachment["data"]):
            image_files.append((attachment_name, attachment["data"]))
        else:
            documents.append(attachment)

    imported_rows = 0
    matched_photos = 0
    warnings: list[str] = []
    if excel_files:
        result = import_gate_visa_files(
            excel_files,
            replace=False,
            dup_strategy="skip",
            batch_id=batch_id or str(uuid.uuid4()),
        )
        imported_rows = result[0]
        warnings.extend(result[1])
    if image_files:
        photo_result = match_photos(image_files)
        matched_photos = photo_result[0]
        warnings.extend([f"Eşleşmeyen fotoğraf: {name}" for name in photo_result[1]])

    df, loaded_files, extra = load_state()
    inbox = list(extra.get("mail_inbox", []))
    stored_documents = 0
    document_items = []
    for attachment in documents:
        ref = f"mail_{uuid.uuid4()}"
        if db.save_document(ref, str(attachment["filename"]), str(attachment["mime"]), attachment["data"]):
            stored_documents += 1
            document_items.append(
                {"ref": ref, "filename": str(attachment["filename"]), "mime": str(attachment["mime"])}
            )
    inbox.insert(
        0,
        {
            "id": str(uuid.uuid4()),
            "source_file": filename,
            "subject": parsed["subject"],
            "sender": parsed["sender"],
            "received_at": parsed["date"],
            "processed_at": datetime.now().isoformat(timespec="seconds"),
            "attachment_count": len(parsed["attachments"]),
            "imported_rows": imported_rows,
            "matched_photos": matched_photos,
            "documents": document_items,
        },
    )
    extra["mail_inbox"] = inbox[:200]
    save_state(df, loaded_files, extra)
    return {
        "subject": parsed["subject"],
        "sender": parsed["sender"],
        "attachment_count": len(parsed["attachments"]),
        "imported_rows": imported_rows,
        "matched_photos": matched_photos,
        "stored_documents": stored_documents,
        "warnings": warnings,
    }


def expand_import_upload(filename: str, data: bytes) -> list[tuple[str, bytes]]:
    """ZIP içindeki yolcu listelerini diske çıkarmadan güvenle bellekte açar."""
    if not filename.lower().endswith(".zip"):
        return [(filename, data)]

    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except (zipfile.BadZipFile, OSError) as exc:
        raise ValueError(f"{filename}: geçerli bir ZIP arşivi değil.") from exc

    expanded: list[tuple[str, bytes]] = []
    total_uncompressed = 0
    used_names: dict[str, int] = {}
    try:
        for info in archive.infolist():
            raw_name = info.filename.replace("\\", "/")
            parts = [part for part in raw_name.split("/") if part not in ("", ".")]
            if info.is_dir() or not parts or "__MACOSX" in parts or parts[-1].startswith("."):
                continue
            if raw_name.startswith("/") or any(part == ".." for part in parts):
                raise ValueError(f"{filename}: ZIP içinde güvensiz dosya yolu var.")
            if info.flag_bits & 0x1:
                raise ValueError(f"{filename}: şifreli ZIP dosyaları desteklenmiyor.")

            basename = parts[-1]
            extension = os.path.splitext(basename)[1].lower()
            if extension not in ALLOWED_IMPORT_EXTENSIONS:
                continue
            if info.file_size > MAX_UPLOAD_BYTES:
                raise ValueError(
                    f"{basename}: arşiv içindeki dosya limiti "
                    f"{MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
                )
            total_uncompressed += int(info.file_size)
            if total_uncompressed > MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES:
                raise ValueError(
                    f"{filename}: açılmış ZIP toplamı "
                    f"{MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES // (1024 * 1024)} MB sınırını aşıyor."
                )

            with archive.open(info) as source:
                payload = source.read(MAX_UPLOAD_BYTES + 1)
            if not payload:
                raise ValueError(f"{basename}: arşiv içindeki dosya boş.")
            if len(payload) > MAX_UPLOAD_BYTES:
                raise ValueError(
                    f"{basename}: arşiv içindeki dosya limiti "
                    f"{MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
                )

            key = basename.casefold()
            occurrence = used_names.get(key, 0) + 1
            used_names[key] = occurrence
            if occurrence > 1:
                stem, extension = os.path.splitext(basename)
                basename = f"{stem} ({occurrence}){extension}"
            expanded.append((basename, payload))
    except (RuntimeError, zipfile.BadZipFile, OSError) as exc:
        raise ValueError(f"{filename}: ZIP içeriği okunamadı.") from exc
    finally:
        archive.close()

    if not expanded:
        raise ValueError(
            f"{filename}: ZIP içinde XLSX, XLS, XLSM, ODS veya CSV yolcu listesi bulunamadı."
        )
    return expanded


# ------------------------------------------------- dayanıklı arka plan aktarım kuyruğu
# İstek yolu yalnızca TOP-LEVEL yüklemeyi kalıcı kuyruğa yazar. ZIP açma,
# Excel ayrıştırma ve yolcu durumunu güncelleme yanıt döndükten sonra tek bir
# işleyicide yapılır. Kuyruk yolcu JSON blob'undan tamamen ayrıdır; bu sayede
# her dosya tesliminde binlerce yolcu yeniden okunup/yazılmaz.

MAX_IMPORT_JOBS = 5000
# Parser timeout'u 120 sn; büyük passenger state merge/yedek gecikmesi için
# geniş pay bırakılır. Üretim Dockerfile tek uvicorn worker çalıştırır.
IMPORT_JOB_LEASE_SECONDS = 30 * 60
_ACTIVE_JOB_STATUSES = {"pending", "processing", "waiting"}
_IMPORT_WORKER_LOCK = threading.Lock()
_LOCAL_QUEUE_LOCK = threading.RLock()
_import_worker_alive = False
_IMPORT_WORKER_ID = f"{os.getpid()}-{uuid.uuid4()}"
_SAFE_UPLOAD_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


def _queue_uses_database() -> bool:
    """Configured DB geçici kapalıyken sessiz yerel kuyruğa düşmeyi engeller."""
    available = db.enabled()
    configured = db.database_configured() if hasattr(db, "database_configured") else bool(
        os.environ.get("DATABASE_URL", "").strip()
    )
    if not available and configured:
        raise StorePersistenceError(
            "Kalıcı veritabanına şu anda ulaşılamıyor; dosya yerel/geçici kuyruğa "
            "alınmadı. Lütfen bağlantı düzeldikten sonra yeniden deneyin."
        )
    return available


def _local_queue_dir() -> str:
    return os.path.join(os.path.dirname(persistence.STORE_PATH), "import-queue")


def _local_jobs_path() -> str:
    return os.path.join(_local_queue_dir(), "jobs.json")


def _local_job_path(job_id: str) -> str:
    safe_id = (
        job_id
        if re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", job_id)
        else str(uuid.uuid5(uuid.NAMESPACE_URL, f"excelbase-local-payload:{job_id}"))
    )
    return os.path.join(_local_queue_dir(), f"{safe_id}.bin")


def _read_local_jobs() -> list[dict]:
    try:
        with open(_local_jobs_path(), "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return list(payload) if isinstance(payload, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        logger.exception("Yerel aktarım kuyruğu okunamadı")
        return []


def _write_local_jobs(jobs: list[dict]) -> None:
    os.makedirs(_local_queue_dir(), exist_ok=True)
    path = _local_jobs_path()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(jobs, handle, ensure_ascii=False)
    os.replace(tmp, path)


def _created_at() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _local_enqueue_job(
    filename: str,
    payload: bytes,
    *,
    job_id: str,
    parent_id: str = "",
    kind: str = "file",
    mime: str = "",
    batch_id: str = "",
    ordinal: int = 0,
    replace: bool = False,
    dup_strategy: str = "skip",
    message: str = "Sırada — sunucu arka planda işleyecek.",
) -> dict:
    with _LOCAL_QUEUE_LOCK:
        jobs = _read_local_jobs()
        existing = next((j for j in jobs if str(j.get("id")) == job_id), None)
        if existing is not None:
            return dict(existing)
        if payload:
            os.makedirs(_local_queue_dir(), exist_ok=True)
            path = _local_job_path(job_id)
            tmp = path + ".tmp"
            with open(tmp, "wb") as handle:
                handle.write(payload)
            os.replace(tmp, path)
        job = {
            "id": job_id,
            "parent_id": parent_id,
            "kind": kind,
            "filename": filename,
            "mime": mime,
            "status": "pending",
            "batch_id": batch_id,
            "ordinal": ordinal,
            "replace": bool(replace),
            "dup_strategy": dup_strategy,
            "imported": 0,
            "duplicates": 0,
            "invalid": 0,
            "message": message,
            "created_at": _created_at(),
            "finished_at": "",
            "attempts": 0,
        }
        jobs.append(job)
        _write_local_jobs(jobs)
        return dict(job)


def _queue_enqueue_job(filename: str, payload: bytes, **options) -> dict:
    if _queue_uses_database():
        row = db.enqueue_import_job(filename, payload, **options)
        if row is None:
            raise StorePersistenceError(
                f"{filename}: dosya kalıcı aktarım kuyruğuna kaydedilemedi. "
                "Veritabanı bağlantısını kontrol edip yeniden deneyin."
            )
        return dict(row)
    return _local_enqueue_job(filename, payload, **options)


def _queue_list(parent_id: str | None = None) -> list[dict]:
    if _queue_uses_database():
        rows = db.list_import_jobs(
            limit=None if parent_id is not None else MAX_IMPORT_JOBS,
            parent_id=parent_id,
        )
        if rows is None:
            raise StorePersistenceError("Aktarım kuyruğu veritabanından okunamadı; lütfen yeniden deneyin.")
        jobs = list(rows)
        if parent_id is None:
            # Çok büyük arşivlerde child'lar sorgu limitini doldursa bile parent
            # ilerleme kartı kaybolmasın.
            known = {str(job.get("id")) for job in jobs}
            missing_parents = {
                str(job.get("parent_id")) for job in jobs
                if job.get("parent_id") and str(job.get("parent_id")) not in known
            }
            for missing_id in missing_parents:
                parent = db.get_import_job(missing_id)
                if parent:
                    jobs.append(dict(parent))
        return jobs
    with _LOCAL_QUEUE_LOCK:
        jobs = _read_local_jobs()
        if parent_id is not None:
            jobs = [j for j in jobs if str(j.get("parent_id", "")) == parent_id]
            return [dict(j) for j in jobs]
        return [dict(j) for j in jobs[-MAX_IMPORT_JOBS:]]


def _queue_get(job_id: str, include_payload: bool = False) -> dict | None:
    if _queue_uses_database():
        row = db.get_import_job(job_id, include_payload=include_payload)
        return dict(row) if row else None
    with _LOCAL_QUEUE_LOCK:
        job = next((j for j in _read_local_jobs() if str(j.get("id")) == job_id), None)
        if job is None:
            return None
        result = dict(job)
        if include_payload:
            result["payload"] = _queue_load_payload(job_id)
        return result


def _queue_load_payload(job_id: str) -> bytes | None:
    if _queue_uses_database():
        return db.load_import_job_payload(job_id)
    try:
        with open(_local_job_path(job_id), "rb") as handle:
            return handle.read()
    except (FileNotFoundError, OSError):
        return None


def _queue_delete_payload(job_id: str) -> None:
    if _queue_uses_database():
        db.delete_import_job_payload(job_id)
        return
    try:
        os.remove(_local_job_path(job_id))
    except FileNotFoundError:
        pass


def _queue_finish(
    job_id: str,
    status: str,
    *,
    message: str = "",
    imported: int = 0,
    duplicates: int = 0,
    invalid: int = 0,
    delete_payload: bool = False,
) -> bool:
    if _queue_uses_database():
        return bool(
            db.finish_import_job(
                job_id,
                status,
                message=message,
                imported=imported,
                duplicates=duplicates,
                invalid=invalid,
                worker_id=_IMPORT_WORKER_ID,
                delete_payload=delete_payload,
            )
        )
    with _LOCAL_QUEUE_LOCK:
        jobs = _read_local_jobs()
        found = False
        for job in jobs:
            if str(job.get("id")) != job_id:
                continue
            job.update(
                status=status,
                message=message,
                imported=int(imported),
                duplicates=int(duplicates),
                invalid=int(invalid),
            )
            if status in {"done", "error", "cancelled"}:
                job["finished_at"] = _created_at()
            found = True
            break
        if found:
            _write_local_jobs(jobs)
        if delete_payload:
            _queue_delete_payload(job_id)
        return found


def _queue_claim() -> dict | None:
    if _queue_uses_database():
        row = db.claim_next_import_job(_IMPORT_WORKER_ID, lease_seconds=IMPORT_JOB_LEASE_SECONDS)
        return dict(row) if row else None
    with _LOCAL_QUEUE_LOCK:
        jobs = _read_local_jobs()
        for job in jobs:
            if job.get("status") != "pending":
                continue
            job["status"] = "processing"
            job["message"] = "İşleniyor…"
            job["attempts"] = int(job.get("attempts", 0) or 0) + 1
            job["worker_id"] = _IMPORT_WORKER_ID
            _write_local_jobs(jobs)
            result = dict(job)
            result["payload"] = _queue_load_payload(str(job.get("id", "")))
            return result
    return None


def _queue_has_pending() -> bool:
    if _queue_uses_database():
        pending = db.has_pending_import_jobs()
        if pending is None:
            raise StorePersistenceError("Aktarım kuyruğu durumu veritabanından okunamadı.")
        return bool(pending)
    return any(j.get("status") == "pending" for j in _queue_list())


def _queue_recover(force: bool = False) -> int:
    if _queue_uses_database():
        return int(db.recover_expired_import_jobs(force=force) or 0)
    with _LOCAL_QUEUE_LOCK:
        jobs = _read_local_jobs()
        recovered = 0
        for job in jobs:
            if job.get("status") == "processing":
                job["status"] = "pending"
                job["message"] = "Sunucu yeniden başladı; iş kuyruğa iade edildi."
                job["worker_id"] = ""
                recovered += 1
        if recovered:
            _write_local_jobs(jobs)
        return recovered


def _queue_retry(job_id: str) -> bool:
    if _queue_uses_database():
        return bool(db.retry_import_job(job_id))
    with _LOCAL_QUEUE_LOCK:
        jobs = _read_local_jobs()
        for job in jobs:
            if str(job.get("id")) == job_id and job.get("status") == "error":
                if _queue_load_payload(job_id) is None:
                    return False
                job.update(status="pending", message="Yeniden sırada.", finished_at="")
                _write_local_jobs(jobs)
                return True
    return False


def _queue_delete(job_id: str) -> bool:
    if _queue_uses_database():
        target = db.get_import_job(job_id)
        if target and target.get("status") in {"processing", "waiting"}:
            return False
        return bool(db.delete_import_job(job_id, include_children=True))
    with _LOCAL_QUEUE_LOCK:
        jobs = _read_local_jobs()
        target = next((j for j in jobs if str(j.get("id")) == job_id), None)
        if target is None or target.get("status") in {"processing", "waiting"}:
            return False
        ids = {
            str(j.get("id"))
            for j in jobs
            if str(j.get("id")) == job_id or str(j.get("parent_id", "")) == job_id
        }
        if any(j.get("status") == "processing" and str(j.get("id")) in ids for j in jobs):
            return False
        _write_local_jobs([j for j in jobs if str(j.get("id")) not in ids])
        for item_id in ids:
            _queue_delete_payload(item_id)
        return True


def _cleanup_local_import_jobs(max_finished: int = 200) -> int:
    """Yerel fallback'te eski terminal parentları ve orphan payloadları siler."""
    with _LOCAL_QUEUE_LOCK:
        jobs = _read_local_jobs()
        terminal_parents = [
            job for job in jobs
            if not job.get("parent_id") and job.get("status") not in _ACTIVE_JOB_STATUSES
        ]
        terminal_parents.sort(key=lambda item: str(item.get("finished_at") or item.get("created_at") or ""), reverse=True)
        dropped_parent_ids = {
            str(job.get("id")) for job in terminal_parents[max(0, int(max_finished)):]
        }
        live_parent_ids = {
            str(job.get("id")) for job in jobs if not job.get("parent_id")
        }
        dropped_ids = {
            str(job.get("id"))
            for job in jobs
            if str(job.get("id")) in dropped_parent_ids
            or str(job.get("parent_id", "")) in dropped_parent_ids
            or (job.get("parent_id") and str(job.get("parent_id")) not in live_parent_ids)
        }
        if dropped_ids:
            _write_local_jobs([job for job in jobs if str(job.get("id")) not in dropped_ids])
        for item_id in dropped_ids:
            _queue_delete_payload(item_id)

        live_payload_names = {
            os.path.basename(_local_job_path(str(job.get("id"))))
            for job in jobs if str(job.get("id")) not in dropped_ids
        }
        try:
            for name in os.listdir(_local_queue_dir()):
                if name.endswith(".bin") and name not in live_payload_names:
                    os.remove(os.path.join(_local_queue_dir(), name))
        except OSError:
            pass
        return len(dropped_ids)


def _job_stage(job: dict) -> str:
    status = str(job.get("status", "pending"))
    if status == "pending":
        return "queued"
    if status == "waiting":
        return "processing_files"
    if status == "processing":
        return "expanding_zip" if job.get("kind") == "upload" and str(job.get("filename", "")).lower().endswith(".zip") else "parsing_file"
    return status


def _public_jobs(jobs: list[dict]) -> list[dict]:
    children_by_parent: dict[str, list[dict]] = {}
    for item in jobs:
        parent = str(item.get("parent_id", ""))
        if parent:
            children_by_parent.setdefault(parent, []).append(item)
    result: list[dict] = []
    for job in jobs:
        children = children_by_parent.get(str(job.get("id", "")), [])
        is_parent = str(job.get("kind", "file")) == "upload"
        processed = sum(j.get("status") in {"done", "error", "cancelled"} for j in children)
        result.append(
            {
                "id": str(job.get("id", "")),
                "parent_id": str(job.get("parent_id", "") or ""),
                "kind": str(job.get("kind", "file") or "file"),
                "filename": str(job.get("filename", "")),
                "status": str(job.get("status", "pending")),
                "stage": _job_stage(job),
                "imported": int(job.get("imported", 0) or 0),
                "duplicates": int(job.get("duplicates", 0) or 0),
                "invalid": int(job.get("invalid", 0) or 0),
                "total_files": (
                    int(job.get("total_items", 0) or 0) or len(children)
                ) if is_parent else 0,
                "processed_files": (
                    int(job.get("processed_items", 0) or 0) or int(processed)
                ) if is_parent else 0,
                "message": str(job.get("message", "")),
                "created_at": str(job.get("created_at", "")),
                "finished_at": str(job.get("finished_at", "") or ""),
            }
        )
    return result


def _resolved_upload_job_id(upload_id: str, index: int, total: int, filename: str) -> str:
    upload_id = upload_id.strip()
    if upload_id and not _SAFE_UPLOAD_ID.fullmatch(upload_id):
        raise ValueError("Geçersiz upload_id; en fazla 128 harf, rakam, nokta, tire veya alt çizgi kullanın.")
    if not upload_id:
        return str(uuid.uuid4())
    if total == 1:
        return upload_id
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"excelbase-upload:{upload_id}:{index}:{filename}"))


def enqueue_import_uploads(
    files: list[tuple[str, bytes, str]],
    *,
    replace: bool = False,
    dup_strategy: str = "skip",
    batch_id: str = "",
    upload_id: str = "",
    upload_index: int = 0,
) -> tuple[list[dict], str]:
    """Top-level dosyaları genişletmeden, idempotent biçimde kalıcılaştırır."""
    batch_id = batch_id.strip() or str(uuid.uuid4())
    total = len(files)
    job_ids = [
        _resolved_upload_job_id(upload_id, index, total, filename)
        for index, (filename, _, _) in enumerate(files)
    ]
    if _queue_uses_database():
        rows = db.enqueue_import_jobs(
            [(filename, data) for filename, data, _ in files],
            job_ids=job_ids,
            parent_id=None,
            kind="upload",
            mime="application/octet-stream",
            batch_id=batch_id,
            replace=replace,
            dup_strategy=dup_strategy,
            start_ordinal=max(0, int(upload_index)),
            message="Sunucuya teslim edildi; arka planda işlenecek.",
        )
        if rows is None:
            raise StorePersistenceError(
                "Dosyalar kalıcı aktarım kuyruğuna kaydedilemedi. "
                "Veritabanı bağlantısını kontrol edip yeniden deneyin."
            )
        created = [dict(row) for row in rows]
        if created and upload_id:
            batch_id = str(created[0].get("batch_id") or batch_id)
        return _public_jobs(created), batch_id

    created: list[dict] = []
    for index, (filename, data, mime) in enumerate(files):
        created.append(
            _queue_enqueue_job(
                filename,
                data,
                job_id=job_ids[index],
                parent_id=None,
                kind="upload",
                mime=mime,
                batch_id=batch_id,
                ordinal=max(0, int(upload_index)) + index,
                replace=bool(replace),
                dup_strategy=dup_strategy,
                message="Sunucuya teslim edildi; arka planda işlenecek.",
            )
        )
    if created and upload_id:
        batch_id = str(created[0].get("batch_id") or batch_id)
    return _public_jobs(created), batch_id


# Geriye dönük servis adı: yeni kod top-level semantiğiyle kullanır.
def enqueue_import_files(
    files: list[tuple[str, bytes]],
    replace: bool = False,
    dup_strategy: str = "skip",
    batch_id: str = "",
    upload_id: str = "",
    upload_index: int = 0,
) -> tuple[list[dict], str]:
    return enqueue_import_uploads(
        [(name, data, "application/octet-stream") for name, data in files],
        replace=replace,
        dup_strategy=dup_strategy,
        batch_id=batch_id,
        upload_id=upload_id,
        upload_index=upload_index,
    )


def get_import_jobs() -> tuple[list[dict], bool]:
    jobs = _public_jobs(_queue_list())
    active = any(j["status"] in _ACTIVE_JOB_STATUSES for j in jobs)
    if _queue_uses_database() and hasattr(db, "has_active_import_jobs"):
        db_active = db.has_active_import_jobs()
        if db_active is None:
            raise StorePersistenceError("Aktarım kuyruğu durumu veritabanından okunamadı.")
        active = bool(db_active)
    elif not active:
        active = _queue_has_pending()
    return jobs, active


def retry_import_job(job_id: str) -> bool:
    return _queue_retry(job_id)


def delete_import_job(job_id: str) -> bool:
    return _queue_delete(job_id)


def recover_stale_import_jobs(force: bool = False) -> int:
    """Runtime'da süresi dolmuş, startup'ta önceki process'e ait lease'leri geri alır."""
    return _queue_recover(force=force)


def _child_job_id(parent_id: str, ordinal: int, raw_name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"excelbase-child:{parent_id}:{ordinal}:{raw_name}"))


def _enqueue_archive_child(
    parent: dict,
    *,
    ordinal: int,
    raw_name: str,
    filename: str,
    payload: bytes,
    replace: bool,
) -> dict:
    return _queue_enqueue_job(
        filename,
        payload,
        job_id=_child_job_id(str(parent.get("id", "")), ordinal, raw_name),
        parent_id=str(parent.get("id", "")),
        kind="file",
        mime="application/octet-stream",
        batch_id=str(parent.get("batch_id", "")),
        ordinal=ordinal,
        # Her child batch'in replace niyetini taşır; gerçek tüketim yalnız
        # başarılı parse sonrasında `_merge_and_save_import` kilidinde olur.
        replace=bool(parent.get("replace")),
        dup_strategy=str(parent.get("dup_strategy") or "skip"),
        message="ZIP içinden çıkarıldı; sırada.",
    )


_ARCHIVE_CHILD_CHUNK_FILES = 16
_ARCHIVE_CHILD_CHUNK_BYTES = 32 * 1024 * 1024


def _enqueue_archive_children_chunk(
    parent: dict,
    members: list[tuple[int, str, str, bytes]],
) -> list[dict]:
    """Persist consecutive valid ZIP members in one durable transaction.

    IDs are derived from the parent, source ordinal and original archive name,
    so retrying an interrupted expansion cannot duplicate child jobs.  Bad
    members are flushed as barriers by the caller; consequently every chunk's
    ordinals are consecutive and ``start_ordinal`` preserves archive order.
    """
    if not members:
        return []
    parent_id = str(parent.get("id", ""))
    first_ordinal = int(members[0][0])
    if any(int(item[0]) != first_ordinal + index for index, item in enumerate(members)):
        raise ValueError("ZIP child chunk ordinals must be consecutive.")

    if _queue_uses_database():
        rows = db.enqueue_import_jobs(
            [(display_name, payload) for _, _, display_name, payload in members],
            job_ids=[
                _child_job_id(parent_id, int(ordinal), raw_name)
                for ordinal, raw_name, _, _ in members
            ],
            parent_id=parent_id,
            kind="file",
            mime="application/octet-stream",
            batch_id=str(parent.get("batch_id", "")),
            replace=bool(parent.get("replace")),
            dup_strategy=str(parent.get("dup_strategy") or "skip"),
            start_ordinal=first_ordinal,
            message="ZIP içinden çıkarıldı; sırada.",
        )
        if rows is None:
            raise StorePersistenceError(
                "ZIP üyeleri kalıcı aktarım kuyruğuna kaydedilemedi. "
                "Veritabanı bağlantısını kontrol edip yeniden deneyin."
            )
        return [dict(row) for row in rows]

    return [
        _enqueue_archive_child(
            parent,
            ordinal=ordinal,
            raw_name=raw_name,
            filename=display_name,
            payload=payload,
            replace=bool(parent.get("replace")),
        )
        for ordinal, raw_name, display_name, payload in members
    ]


def _process_archive_children_chunk(
    parent: dict,
    members: list[tuple[int, str, str, bytes]],
) -> None:
    """Parse and persist a bounded archive chunk with one passenger-state write.

    In the database inline path child rows do not exist while parsing.  Once
    the deterministic passenger-state marker is durable, every fresh child is
    inserted directly in its final state in one transaction.  Consequently a
    second worker can never lease a transient ``pending`` row from this path.

    Children left pending by an older deployment are intentionally excluded
    here and remain available to the ordinary queue worker.  Terminal rows are
    also left untouched on replay.
    """
    if not members:
        return
    parent_id = str(parent.get("id", ""))
    child_meta = [
        {
            "id": _child_job_id(parent_id, int(ordinal), raw_name),
            "ordinal": int(ordinal),
            "filename": display_name,
            "payload": payload,
        }
        for ordinal, raw_name, display_name, payload in members
    ]
    existing = db.get_import_jobs_by_ids([str(item["id"]) for item in child_meta])
    if existing is None:
        raise StorePersistenceError(
            "ZIP alt işlerinin durumu okunamadı. Veritabanı bağlantısını kontrol edip yeniden deneyin."
        )
    fresh = [
        (member, child)
        for member, child in zip(members, child_meta, strict=True)
        if str(child["id"]) not in existing
    ]
    if not fresh:
        return

    parsed: list[tuple[dict, pd.DataFrame, list[str], list[str]]] = []
    results: list[dict] = []
    for member, child in fresh:
        _, _, display_name, payload = member
        try:
            imported_df, loaded_names, warnings = _parse_import_files_with_timeout(
                [(display_name, payload)]
            )
        except (ValueError, TimeoutError) as exc:
            results.append(
                {
                    "id": str(child.get("id", "")),
                    "ordinal": int(child.get("ordinal", 0)),
                    "filename": str(child.get("filename", display_name)),
                    "status": "error",
                    "message": str(exc),
                    # Hatalı payload manuel yeniden deneme için korunur.
                    "payload": payload,
                }
            )
        except Exception as exc:
            logger.exception("ZIP üyesi ayrıştırılamadı: %s", display_name)
            results.append(
                {
                    "id": str(child.get("id", "")),
                    "ordinal": int(child.get("ordinal", 0)),
                    "filename": str(child.get("filename", display_name)),
                    "status": "error",
                    "message": str(exc) or "Dosya işlenemedi; yeniden deneyin.",
                    "payload": payload,
                }
            )
        else:
            parsed.append((child, imported_df, loaded_names, warnings))

    if parsed:
        combined_df = pd.concat([item[1] for item in parsed], ignore_index=True)
        combined_names = [name for item in parsed for name in item[2]]
        combined_warnings = [warning for item in parsed for warning in item[3]]
        first_ordinal = int(fresh[0][0][0])
        last_ordinal = int(fresh[-1][0][0])
        marker = f"archive-chunk:{parent_id}:{first_ordinal}:{last_ordinal}"
        imported, _, _, _, _, duplicates, _ = _merge_and_save_import(
            combined_df,
            combined_names,
            combined_warnings,
            replace=bool(parent.get("replace")),
            dup_strategy=str(parent.get("dup_strategy") or "skip"),
            batch_id=str(parent.get("batch_id") or ""),
            job_id=marker,
        )
        remaining_imported = int(imported)
        for index, (child, imported_df, _, warnings) in enumerate(parsed):
            row_count = len(imported_df)
            accepted = min(row_count, max(0, remaining_imported))
            remaining_imported -= accepted
            invalid = _critical_import_count(imported_df)
            message_parts = [f"{accepted} yolcu aktarıldı"]
            # Combined duplicate count belongs to the whole deterministic
            # chunk.  Store it once so the parent aggregate remains exact.
            child_duplicates = int(duplicates) if index == 0 else 0
            if child_duplicates:
                message_parts.append(f"{child_duplicates} tekrar")
            if invalid:
                message_parts.append(f"{invalid} kritik kontrol")
            if warnings:
                message_parts.append(warnings[0])
            results.append(
                {
                    "id": str(child.get("id", "")),
                    "ordinal": int(child.get("ordinal", 0)),
                    "filename": str(child.get("filename", "dosya")),
                    "status": "done",
                    "message": " · ".join(message_parts) + ".",
                    "imported": accepted,
                    "duplicates": child_duplicates,
                    "invalid": invalid,
                    "payload": None,
                }
            )

    if results:
        try:
            stored = db.store_finished_import_children(parent_id, results)
        except db.DatabaseUnavailableError as exc:
            raise StorePersistenceError(str(exc)) from exc
        if stored is None:
            raise StorePersistenceError("ZIP alt işleri kalıcı olarak kaydedilemedi.")
        expected = {str(item.get("id", "")) for item in results}
        terminal = {
            str(item.get("id", ""))
            for item in stored
            if str(item.get("status", "")) in {"done", "error", "cancelled"}
        }
        if not expected.issubset(terminal):
            raise StorePersistenceError(
                "ZIP alt işlerinin terminal durumu doğrulanamadı; aktarım güvenle yeniden denenecek."
            )


def _refresh_parent(parent_id: str) -> None:
    # PostgreSQL/SQLite durable backend child finish transaction'ında sınırsız
    # SQL aggregate ile parentı atomik günceller. Buradaki Python aggregate
    # yalnız yerel fallback içindir.
    if _queue_uses_database():
        return
    parent = _queue_get(parent_id)
    if parent is None:
        return
    children = _queue_list(parent_id=parent_id)
    if not children:
        return
    terminal = [j for j in children if j.get("status") in {"done", "error", "cancelled"}]
    imported = sum(int(j.get("imported", 0) or 0) for j in children)
    duplicates = sum(int(j.get("duplicates", 0) or 0) for j in children)
    invalid = sum(int(j.get("invalid", 0) or 0) for j in children)
    if len(terminal) < len(children):
        _queue_finish(
            parent_id,
            "waiting",
            message=f"{len(terminal)}/{len(children)} dosya işlendi.",
            imported=imported,
            duplicates=duplicates,
            invalid=invalid,
        )
        return
    successes = sum(j.get("status") == "done" for j in children)
    errors = sum(j.get("status") == "error" for j in children)
    status = "done" if successes else "error"
    _queue_finish(
        parent_id,
        status,
        message=f"{successes}/{len(children)} dosya işlendi" + (f" · {errors} hata." if errors else "."),
        imported=imported,
        duplicates=duplicates,
        invalid=invalid,
        delete_payload=True,
    )


def _mark_bad_archive_child(
    parent: dict,
    ordinal: int,
    raw_name: str,
    filename: str,
    message: str,
    replace: bool,
    *,
    process_inline: bool = False,
    payload: bytes = b"",
) -> None:
    if process_inline and _queue_uses_database():
        parent_id = str(parent.get("id", ""))
        child_id = _child_job_id(parent_id, ordinal, raw_name)
        existing = db.get_import_jobs_by_ids([child_id])
        if existing is None:
            raise StorePersistenceError("ZIP alt işinin durumu okunamadı.")
        # Pending children from an older release stay on the ordinary queue;
        # terminal rows are immutable replay results.
        if child_id in existing:
            return
        try:
            stored = db.store_finished_import_children(
                parent_id,
                [
                    {
                        "id": child_id,
                        "ordinal": ordinal,
                        "filename": filename,
                        "status": "error",
                        "message": message,
                        "payload": payload,
                    }
                ],
            )
        except db.DatabaseUnavailableError as exc:
            raise StorePersistenceError(str(exc)) from exc
        if not stored or str(stored[0].get("status")) != "error":
            raise StorePersistenceError("ZIP alt işi hata durumunda kaydedilemedi.")
        return
    child = _enqueue_archive_child(
        parent,
        ordinal=ordinal,
        raw_name=raw_name,
        filename=filename,
        payload=b"",
        replace=replace,
    )
    if child.get("status") == "pending":
        _queue_finish(str(child.get("id")), "error", message=message)


def _expand_archive_job(parent: dict, data: bytes, *, process_children: bool = False) -> None:
    """Bir ZIP'i üye üye kalıcı child işlere çevirir.

    Tek bir bozuk/boş/şifreli üye yalnız kendi child işini hataya düşürür;
    daha önce veya sonra gelen sağlam listeler işlenmeye devam eder.
    """
    parent_id = str(parent.get("id", ""))
    filename = str(parent.get("filename") or "listeler.zip")
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except (zipfile.BadZipFile, OSError) as exc:
        _queue_finish(parent_id, "error", message=f"{filename}: geçerli bir ZIP arşivi değil.")
        return

    supported = 0
    total_uncompressed = 0
    used_names: dict[str, int] = {}
    limit_hit = False
    pending_members: list[tuple[int, str, str, bytes]] = []
    pending_bytes = 0
    process_children_now = bool(process_children and _queue_uses_database())

    def flush_pending() -> None:
        nonlocal pending_bytes
        if not pending_members:
            return
        if process_children_now:
            _process_archive_children_chunk(parent, pending_members)
        else:
            _enqueue_archive_children_chunk(parent, pending_members)
        pending_members.clear()
        pending_bytes = 0

    try:
        for source_ordinal, info in enumerate(archive.infolist()):
            raw_name = info.filename.replace("\\", "/")
            parts = [part for part in raw_name.split("/") if part not in ("", ".")]
            if info.is_dir() or not parts or "__MACOSX" in parts or parts[-1].startswith("."):
                continue
            basename = parts[-1]
            extension = os.path.splitext(basename)[1].lower()
            if extension not in ALLOWED_IMPORT_EXTENSIONS:
                continue
            ordinal = supported
            supported += 1
            key = basename.casefold()
            occurrence = used_names.get(key, 0) + 1
            used_names[key] = occurrence
            display_name = basename
            if occurrence > 1:
                stem, suffix = os.path.splitext(basename)
                display_name = f"{stem} ({occurrence}){suffix}"
            if raw_name.startswith("/") or any(part == ".." for part in parts):
                flush_pending()
                _mark_bad_archive_child(
                    parent, ordinal, raw_name, display_name,
                    "ZIP içinde güvensiz dosya yolu; bu üye atlandı.", False,
                    process_inline=process_children_now,
                )
                continue
            if info.flag_bits & 0x1:
                flush_pending()
                _mark_bad_archive_child(
                    parent, ordinal, raw_name, display_name,
                    "Şifreli ZIP üyesi desteklenmiyor; bu dosya atlandı.", False,
                    process_inline=process_children_now,
                )
                continue
            if info.file_size <= 0:
                flush_pending()
                _mark_bad_archive_child(
                    parent, ordinal, raw_name, display_name,
                    "Arşiv içindeki dosya boş.", False,
                    process_inline=process_children_now,
                )
                continue
            if info.file_size > MAX_UPLOAD_BYTES:
                flush_pending()
                _mark_bad_archive_child(
                    parent, ordinal, raw_name, display_name,
                    f"Arşiv içindeki dosya {MAX_UPLOAD_BYTES // (1024 * 1024)} MB sınırını aşıyor.",
                    False,
                    process_inline=process_children_now,
                )
                continue
            total_uncompressed += int(info.file_size)
            if total_uncompressed > MAX_IMPORT_ARCHIVE_UNCOMPRESSED_BYTES:
                flush_pending()
                _mark_bad_archive_child(
                    parent, ordinal, raw_name, display_name,
                    "ZIP açılmış toplam boyut güvenlik sınırını aştı; kalan üyeler okunmadı.",
                    False,
                    process_inline=process_children_now,
                )
                limit_hit = True
                break
            try:
                with archive.open(info) as source:
                    member_data = source.read(MAX_UPLOAD_BYTES + 1)
                if not member_data:
                    raise ValueError("Arşiv içindeki dosya boş.")
                if len(member_data) > MAX_UPLOAD_BYTES:
                    raise ValueError(f"Dosya {MAX_UPLOAD_BYTES // (1024 * 1024)} MB sınırını aşıyor.")
                if pending_members and pending_bytes + len(member_data) > _ARCHIVE_CHILD_CHUNK_BYTES:
                    flush_pending()
                pending_members.append((ordinal, raw_name, display_name, member_data))
                pending_bytes += len(member_data)
                if (
                    len(pending_members) >= _ARCHIVE_CHILD_CHUNK_FILES
                    or pending_bytes >= _ARCHIVE_CHILD_CHUNK_BYTES
                ):
                    flush_pending()
            except StorePersistenceError:
                raise
            except (ValueError, RuntimeError, zipfile.BadZipFile, OSError) as exc:
                flush_pending()
                _mark_bad_archive_child(
                    parent, ordinal, raw_name, display_name,
                    str(exc) or "ZIP üyesi okunamadı; diğer dosyalara devam edildi.",
                    False,
                    process_inline=process_children_now,
                )
        flush_pending()
    except StorePersistenceError:
        raise
    except (RuntimeError, zipfile.BadZipFile, OSError) as exc:
        # Preserve valid members decoded before a later corrupt central entry.
        # The chunk insert is atomic and deterministic, so a worker retry is
        # safe even if this flush succeeds immediately before a process crash.
        flush_pending()
        logger.warning("ZIP kısmen okunabildi parent=%s error=%s", parent_id, exc)
    finally:
        archive.close()

    if supported == 0:
        _queue_finish(
            parent_id,
            "error",
            message=f"{filename}: ZIP içinde desteklenen yolcu listesi bulunamadı.",
        )
        return
    message = f"{supported} liste bulundu; sırayla işleniyor."
    if limit_hit:
        message += " Boyut sınırı sonrası kalan üyeler atlandı."
    _queue_finish(parent_id, "waiting", message=message, delete_payload=True)
    _refresh_parent(parent_id)


def _process_file_job(job: dict, data: bytes) -> None:
    job_id = str(job.get("id", ""))
    parent_id = str(job.get("parent_id", "") or "")
    try:
        imported, warnings, _, _, _, duplicates, invalid = import_gate_visa_files(
            [(str(job.get("filename", "dosya.xlsx")), data)],
            replace=bool(job.get("replace")),
            dup_strategy=str(job.get("dup_strategy") or "skip"),
            batch_id=str(job.get("batch_id") or ""),
            job_id=job_id,
        )
    except (ValueError, TimeoutError) as exc:
        _queue_finish(job_id, "error", message=str(exc))
    except Exception as exc:  # Kalıcı hata dahil: payload retry için korunur.
        logger.exception("Aktarım işi başarısız: %s", job.get("filename"))
        _queue_finish(job_id, "error", message=str(exc) or "Dosya işlenemedi; yeniden deneyin.")
    else:
        parts = [f"{imported} yolcu aktarıldı"]
        if duplicates:
            parts.append(f"{duplicates} tekrar")
        if invalid:
            parts.append(f"{invalid} kritik kontrol")
        if warnings:
            parts.append(warnings[0])
        _queue_finish(
            job_id,
            "done",
            message=" · ".join(parts) + ".",
            imported=imported,
            duplicates=duplicates,
            invalid=invalid,
            delete_payload=True,
        )
    finally:
        if parent_id:
            _refresh_parent(parent_id)


def _process_import_job(job: dict) -> None:
    job_id = str(job.get("id", ""))
    data = job.pop("payload", None)
    if data is None:
        data = _queue_load_payload(job_id)
    if not data:
        _queue_finish(job_id, "error", message="Dosya içeriği sunucuda bulunamadı; dosyayı yeniden seçin.")
        if job.get("parent_id"):
            _refresh_parent(str(job.get("parent_id")))
        return
    started = time.monotonic()
    try:
        if str(job.get("kind")) == "upload" and str(job.get("filename", "")).lower().endswith(".zip"):
            _expand_archive_job(job, data, process_children=True)
        else:
            _process_file_job(job, data)
    finally:
        logger.info(
            "import worker stage complete job_id=%s kind=%s filename=%r duration_ms=%d",
            job_id,
            job.get("kind"),
            job.get("filename"),
            round((time.monotonic() - started) * 1000),
        )
        del data


def _import_worker_loop() -> None:
    global _import_worker_alive
    read_failures = 0
    while True:
        try:
            job = _queue_claim()
            read_failures = 0
        except Exception:
            read_failures += 1
            delay = min(30.0, float(2 ** min(read_failures, 5)))
            logger.exception(
                "Aktarım kuyruğu okunamadı; işleyici %.0f sn sonra yeniden deneyecek",
                delay,
            )
            time.sleep(delay)
            continue
        if job is None:
            with _IMPORT_WORKER_LOCK:
                _import_worker_alive = False
            try:
                if _queue_has_pending():
                    ensure_import_worker()
            except Exception:
                pass
            return
        try:
            _process_import_job(job)
        except Exception:
            logger.exception("Aktarım işi beklenmedik şekilde çöktü: %s", job.get("id"))
            try:
                _queue_finish(str(job.get("id", "")), "error", message="Beklenmedik sunucu hatası; yeniden deneyin.")
                if job.get("parent_id"):
                    _refresh_parent(str(job.get("parent_id")))
            except Exception:
                pass


@locked_mutation
def migrate_legacy_import_queue() -> int:
    """Eski yolcu-state içindeki queue metadata'sını bir kez yeni kuyruğa taşır.

    Yolcu kayıtları ve app_state blob'u değiştirilmez. Yalnız payload'ı kesin
    olarak okunan işler taşınır; kayıp/eski metadata veri kaybı riskiyle
    topluca silinmez.
    """
    _, _, extra = load_state()
    if "import_jobs" not in extra or not extra.get("import_jobs"):
        return 0
    legacy = list(extra.get("import_jobs", []))
    migrated = 0
    for old in legacy:
        old_id = str(old.get("id") or uuid.uuid4())
        payload = None
        if _queue_uses_database():
            payload = db.load_document(f"import-job://{old_id}")
        else:
            try:
                with open(_local_job_path(old_id), "rb") as handle:
                    payload = handle.read()
            except OSError:
                payload = None
        if not payload:
            continue
        row = _queue_enqueue_job(
            str(old.get("filename") or "dosya.xlsx"),
            payload,
            job_id=old_id,
            parent_id=None,
            kind="upload",
            mime="application/octet-stream",
            batch_id=str(old.get("batch_id") or uuid.uuid4()),
            ordinal=0,
            replace=bool(old.get("replace")),
            dup_strategy=str(old.get("dup_strategy") or "skip"),
            message="Eski kuyruktan güvenle taşındı.",
        )
        if row:
            migrated += 1
            # Yeni import_jobs satırı payload'ı kendi transaction'ında güvenle
            # aldıktan sonra yalnız o eski document ref'i silinir. Payload'ı
            # okunamayan bir legacy iş yüzünden metadata veya diğer belgeler
            # topluca silinmez. Passenger app_state migration için rewrite
            # edilmez; boş/eskimiş metadata artık sadece okunmadan bırakılır.
            if _queue_uses_database():
                db.delete_document(f"import-job://{old_id}")
    return migrated


def ensure_import_worker() -> None:
    """Bekleyen işleri tek işleyicide, lease korumasıyla sırayla işler."""
    global _import_worker_alive
    # Önce süresi dolmuş processing kayıtlarını pending yap. Bu kontrol
    # pending sorgusundan sonra olursa yalnız stale işi olan kuyruk hiç açılmaz.
    recovered = recover_stale_import_jobs(force=False)
    if recovered:
        logger.warning("%d lease süresi dolmuş aktarım işi kuyruğa iade edildi", recovered)
    with _IMPORT_WORKER_LOCK:
        if _import_worker_alive:
            return
        if not _queue_has_pending():
            return
        _import_worker_alive = True
    try:
        if _queue_uses_database():
            db.cleanup_import_jobs(older_than_days=7, max_finished=200)
        else:
            _cleanup_local_import_jobs(max_finished=200)
        threading.Thread(target=_import_worker_loop, name="gatevisa-import-worker", daemon=True).start()
    except Exception:
        with _IMPORT_WORKER_LOCK:
            _import_worker_alive = False
        raise
