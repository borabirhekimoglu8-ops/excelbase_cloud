from __future__ import annotations

import base64
import json
import os
import sys
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
from .config import MAX_AUDIT_EVENTS, MAX_IMPORT_SNAPSHOTS
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


def dataframe_to_records(df: pd.DataFrame, with_key: str = "") -> list[PassengerRecord]:
    if df.empty:
        return []
    dup_keys = duplicate_passport_keys(df)
    return [_record(int(i), row, dup_keys, with_key) for i, row in df.iterrows()]


def _status_mask(df: pd.DataFrame, status: str) -> pd.Series:
    dup = duplicate_passport_keys(df)
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
    df, _, _ = load_state()
    if df.empty:
        return []
    df = _scoped_df(df, range_choice, start, end)
    if search:
        df = apply_filters(df, search, {})
    if status:
        df = df[_status_mask(df, status)]
    df = _sort_df(df, sort)
    return dataframe_to_records(df, with_key)


def get_summary(range_choice: str = "Tümü", start: str = "", end: str = "") -> OperationSummary:
    df, loaded_files, extra = load_state()
    df = _scoped_df(df, range_choice, start, end)
    summary = summarize_group(df)
    metrics = readiness_metrics(df)
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
        readiness_percent=metrics["pct"],
        issue_counts=issue_counts(df),
        loaded_files=list(loaded_files),
        import_history=list(extra.get("import_history", []))[:12],
        today_count=today_departures(df),
        can_undo=bool(last_batch),
        last_batch_id=str(last_batch.get("id", "")) if last_batch else "",
        unmatched_photo_count=len(extra.get("unmatched_photos", [])),
    )


def _parse_import_files(files: Iterable[tuple[str, bytes]]) -> tuple[pd.DataFrame, list[str], list[str]]:
    all_results = []
    loaded_names: list[str] = []
    for filename, data in files:
        loaded_names.append(filename)
        all_results.extend(read_gate_visa_file_bytes(filename, data))
    imported_df = gate_visa_results_to_passengers(all_results)
    return imported_df, loaded_names, validate_passenger_rows(imported_df)


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
) -> tuple[int, list[str], list[str], int, str, int, int]:
    imported_df, loaded_names, warnings = _parse_import_files(files)
    current_df, current_loaded, extra = load_state()
    batch_id = batch_id.strip() or str(uuid.uuid4())
    mode = "Değiştir" if (replace or current_df.empty) else f"Ekle ({dup_strategy})"
    batch = _ensure_import_batch(extra, batch_id, current_df, current_loaded, mode)
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

    if replace or current_df.empty:
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
    df, loaded_files, extra = load_state()
    events = list(extra.get("audit_log", []))
    events.insert(
        0,
        {
            "id": str(uuid.uuid4()),
            "time": datetime.now().isoformat(timespec="seconds"),
            "actor": actor_name,
            "role": role,
            "action": action,
            "path": path,
        },
    )
    extra["audit_log"] = events[:MAX_AUDIT_EVENTS]
    save_state(df, loaded_files, extra)


def get_audit(limit: int = 100) -> list[dict]:
    _, _, extra = load_state()
    return list(extra.get("audit_log", []))[: max(1, min(limit, 500))]


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


def delete_passenger(passenger_id: int) -> int:
    df, loaded_files, extra = load_state()
    if passenger_id < 0 or passenger_id >= len(df):
        return -1
    idx = df.index[passenger_id]
    df = df.drop(index=idx).reset_index(drop=True)
    saved = save_state(df, loaded_files, extra)
    return len(saved)


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


def clear_all() -> int:
    _, _, extra = load_state()
    save_state(pd.DataFrame(columns=ALL_COLUMNS), [], extra)
    return 0


def load_demo() -> int:
    _, _, extra = load_state()
    saved = save_state(make_demo_passengers(), ["demo-gate-visa.xlsx"], extra)
    return len(saved)


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


def remove_passenger_photo(passenger_id: int) -> bool:
    df, loaded_files, extra = load_state()
    if passenger_id < 0 or passenger_id >= len(df):
        return False
    idx = df.index[passenger_id]
    df.at[idx, "Foto"] = ""
    save_state(df, loaded_files, extra)
    return True


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


def delete_unmatched_photo(item_id: str) -> bool:
    df, loaded_files, extra = load_state()
    items = list(extra.get("unmatched_photos", []))
    remaining = [entry for entry in items if str(entry.get("id")) != item_id]
    if len(remaining) == len(items):
        return False
    extra["unmatched_photos"] = remaining
    save_state(df, loaded_files, extra)
    return True


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
