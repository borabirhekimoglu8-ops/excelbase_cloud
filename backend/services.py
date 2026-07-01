from __future__ import annotations

import base64
import json
import os
import sys
import zipfile
from datetime import datetime
from io import BytesIO
from typing import Iterable

import pandas as pd

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

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
    match_photos_to_dataframe,
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
    quick_range_bounds,
    readiness_metrics,
    row_issues,
    save_state,
    today_departures,
)

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
        return df["Pasaport No"].map(lambda v: bool(_norm_key(v)) and _norm_key(v) in dup)
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
) -> list[PassengerRecord]:
    df, _, _ = load_state()
    if df.empty:
        return []
    if search:
        df = apply_filters(df, search, {})
    if status:
        df = df[_status_mask(df, status)]
    df = _sort_df(df, sort)
    return dataframe_to_records(df, with_key)


def get_summary() -> OperationSummary:
    df, loaded_files, extra = load_state()
    summary = summarize_group(df)
    metrics = readiness_metrics(df)
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
    )


def import_gate_visa_files(
    files: Iterable[tuple[str, bytes]],
    replace: bool = False,
    dup_strategy: str = "add",
) -> tuple[int, list[str], list[str], int]:
    all_results = []
    loaded_names: list[str] = []
    for filename, data in files:
        loaded_names.append(filename)
        all_results.extend(read_gate_visa_file_bytes(filename, data))

    imported_df = gate_visa_results_to_passengers(all_results)
    warnings = validate_passenger_rows(imported_df)
    current_df, current_loaded, extra = load_state()

    if replace or current_df.empty:
        next_df = imported_df
        next_loaded = loaded_names
    elif dup_strategy == "skip":
        existing_keys = set(current_df["Pasaport No"].astype(str).map(_norm_key)) - {""}
        keep = [not (_norm_key(pp) and _norm_key(pp) in existing_keys) for pp in imported_df["Pasaport No"].astype(str)]
        next_df = normalize_passenger_dataframe(pd.concat([current_df, imported_df[keep]], ignore_index=True))
        next_loaded = list(dict.fromkeys([*current_loaded, *loaded_names]))
    elif dup_strategy == "overwrite":
        result = current_df.copy().reset_index(drop=True)
        ex = {_norm_key(v): i for i, v in enumerate(result["Pasaport No"].astype(str)) if _norm_key(v)}
        new_rows = []
        for _, row in imported_df.iterrows():
            key = _norm_key(str(row.get("Pasaport No", "")))
            if key and key in ex:
                tgt = ex[key]
                for col in ALL_COLUMNS:
                    val = str(row.get(col, "") or "")
                    if col == "Foto" and not val:
                        continue
                    result.at[tgt, col] = val
            else:
                new_rows.append(row)
        if new_rows:
            result = pd.concat([result, pd.DataFrame(new_rows)], ignore_index=True).fillna("")
        next_df = normalize_passenger_dataframe(result)
        next_loaded = list(dict.fromkeys([*current_loaded, *loaded_names]))
    else:
        next_df = normalize_passenger_dataframe(pd.concat([current_df, imported_df], ignore_index=True))
        next_loaded = list(dict.fromkeys([*current_loaded, *loaded_names]))

    history = list(extra.get("import_history", []))
    history.insert(0, {
        "time": datetime.now().strftime("%d.%m.%Y %H:%M"),
        "files": ", ".join(loaded_names) or "—",
        "rows": int(len(imported_df)),
        "mode": "Değiştir" if (replace or current_df.empty) else f"Ekle ({dup_strategy})",
    })
    extra["import_history"] = history[:30]

    saved = save_state(next_df, next_loaded, extra)
    return len(imported_df), warnings, list(next_loaded), len(saved)


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


def match_photos(files: Iterable[tuple[str, bytes]]) -> tuple[int, list[str], int, int]:
    df, loaded_files, extra = load_state()
    if df.empty:
        return 0, [name for name, _ in files], 0, 0
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
    updated, matched, unmatched = match_photos_to_dataframe(df, uploaded)
    saved = save_state(updated, loaded_files, extra)
    with_photo = int(saved["Foto"].astype(str).str.strip().ne("").sum()) if not saved.empty else 0
    return matched, [*unmatched, *skipped], len(saved), with_photo


def merge_duplicates(passport_key: str | None = None) -> tuple[int, int]:
    df, loaded_files, extra = load_state()
    if df.empty:
        return 0, 0
    norm = df["Pasaport No"].astype(str).map(_norm_key)
    dup_keys = sorted(set(norm[norm.ne("") & norm.duplicated(keep=False)]))
    targets = [passport_key] if passport_key else dup_keys
    removed = 0
    for key in targets:
        if not key:
            continue
        norm = df["Pasaport No"].astype(str).map(_norm_key)
        group_idx = list(df[norm == key].index)
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


def export_bytes(kind: str, ids: list[int] | None = None) -> tuple[bytes, str, str]:
    df, _, _ = load_state()
    sub = _subset_by_ids(df, ids)
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


def build_operation_package() -> tuple[bytes, str]:
    df, loaded_files, extra = load_state()
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
    return buf.getvalue(), f"gatevisa-operation-package-{stamp}.zip"


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


def build_manifest_html() -> str:
    df, _, _ = load_state()
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
<title>Gate Visa PAX — Manifest</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; margin: 24px; color: #0f172a; }}
  h3 {{ margin: 0 0 4px; }}
  .sub {{ color: #64748b; font-size: 13px; margin-bottom: 16px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  th, td {{ border: 1px solid #cbd5e1; padding: 7px 9px; text-align: left; }}
  th {{ background: #f1f5f9; }}
  .print-btn {{ margin-top: 16px; padding: 10px 16px; border: 0; border-radius: 10px;
    background: #0ea5e9; color: #fff; font-weight: 700; cursor: pointer; }}
  @media print {{ .print-btn {{ display: none; }} }}
</style></head><body>
<h3>Gate Visa PAX — Manifest</h3>
<div class="sub">{now} · Toplam {len(df)} yolcu</div>
<table><thead><tr><th>#</th><th>Ad Soyad</th><th>Pasaport</th><th>Voucher</th><th>Gidiş</th><th>Varış</th><th>Foto</th></tr></thead>
<tbody>{rows_html}</tbody></table>
<button class="print-btn" onclick="window.print()">Yazdır</button>
</body></html>"""


def get_template() -> bytes:
    return passenger_template_xlsx()
