from __future__ import annotations

import base64
import json
import zipfile
from datetime import datetime, timedelta
from io import BytesIO

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

try:
    from PIL import Image as _PILImage
except Exception:  # Pillow yoksa küçük resim üretimi atlanır.
    _PILImage = None  # type: ignore

from excelbase_core import ReadResult, dataframe_to_csv, dataframe_to_xlsx
from gate_visa_reader import read_gate_visa_file_bytes
from operation_helpers import (
    DATE_FILTER_FIELDS,
    active_filter_count,
    apply_filters,
    cell_text,
    editable_passenger_fields,
    filterable_headers,
    parse_date_value,
    passenger_card_view,
    unique_values,
)
import db
from persistence import load_store, save_store
from photo_store import (
    extract_images_from_zip,
    is_zip,
    looks_like_image,
    match_photos_to_dataframe,
    photo_data_uri,
    save_photo_bytes,
)
from passenger_schema import (
    ALL_COLUMNS,
    TEMPLATE_NAME,
    expected_headers_markdown,
    gate_visa_results_to_passengers,
    make_demo_passengers,
    normalize_passenger_dataframe,
    passenger_template_xlsx,
    validate_passenger_rows,
)

APP_VERSION = "4.7.0"
PAGE_SIZE = 10


def parse_amount(value) -> float:
    """Ücret metnini sayıya çevirir ('25', '€30,5' → float). app.py içinde tanımlı
    tutulur ki Streamlit Cloud'da bir modül önbelleği bayatlasa bile çökmesin."""
    import re as _re

    text = str(value or "").strip()
    if not text or text.lower() == "nan":
        return 0.0
    matches = _re.findall(r"[-+]?\d*[.,]?\d+", text.replace(" ", ""))
    if not matches:
        return 0.0
    try:
        return float(matches[0].replace(",", "."))
    except ValueError:
        return 0.0


def summarize_group(df: pd.DataFrame) -> dict:
    """Bir yolcu grubunun özeti (sayı, ücret toplamları, fotolu sayısı)."""
    adult_total = sum(parse_amount(v) for v in df["Vize Ücreti Yetişkin"]) if "Vize Ücreti Yetişkin" in df else 0.0
    child_total = sum(parse_amount(v) for v in df["Vize Ücreti Çocuk"]) if "Vize Ücreti Çocuk" in df else 0.0
    with_photo = int(df["Foto"].astype(str).str.strip().ne("").sum()) if "Foto" in df else 0
    return {
        "count": int(len(df)),
        "adult_total": adult_total,
        "child_total": child_total,
        "total": adult_total + child_total,
        "with_photo": with_photo,
    }

st.set_page_config(
    page_title="Gate Visa PAX",
    page_icon="🛂",
    layout="wide",
    initial_sidebar_state="collapsed",
)

APP_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');

:root {
  --accent: #2563eb;
  --accent-dark: #1d4ed8;
  --accent-soft: #eaf1ff;
  --ink: #1b2433;
  --ink-soft: #3a465a;
  --muted: #6b7688;
  --bg: #f5f7fb;
  --panel: #ffffff;
  --border: #e4e8f0;
  --border-soft: #eef1f6;
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 6px 16px rgba(16, 24, 40, 0.05);
}

/* Manage app / deploy / üst bar — status widget hariç */
header[data-testid="stHeader"],
[data-testid="stToolbar"],
[data-testid="stToolbarActions"],
[data-testid="stHeaderActionElements"],
[data-testid="stMainMenu"],
.stAppDeployButton,
#MainMenu,
footer {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
  pointer-events: none !important;
}

html, body, [class*="css"], .stApp, .stMarkdown, p, span, label, div {
  font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

/* Uzun metinlerin üst üste binmesini engelle */
p, span, label, h1, h2, h3, .pax-name, .pax-line, .app-title, .app-sub {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.stApp { background: var(--bg); }
[data-testid="stAppViewContainer"] > .main { background: transparent !important; }
.block-container {
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(2.6rem, env(safe-area-inset-bottom));
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
  max-width: 720px;
}

/* Sekmeler — sade beyaz pill */
.stTabs [data-baseweb="tab-list"] {
  gap: 6px;
  background: var(--panel);
  border-radius: 14px;
  padding: 5px;
  border: 1px solid var(--border);
}
.stTabs [data-baseweb="tab"] {
  border-radius: 10px !important;
  background: transparent !important;
  color: var(--muted) !important;
  font-weight: 700 !important;
  padding: 9px 18px !important;
  border: none !important;
}
.stTabs [aria-selected="true"] {
  background: var(--accent-soft) !important;
  color: var(--accent-dark) !important;
}
.stTabs [data-baseweb="tab-panel"] { padding-top: 1rem; }

div[data-testid="stMetric"] {
  background: var(--panel) !important;
  border: 1px solid var(--border) !important;
  border-radius: 14px !important;
  padding: 12px 14px !important;
  box-shadow: var(--shadow);
}
div[data-testid="stMetricLabel"] {
  color: var(--muted) !important;
  font-size: 0.66rem !important;
  font-weight: 800 !important;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
div[data-testid="stMetricValue"] {
  color: var(--ink) !important; font-weight: 800 !important;
}

.stTextInput input, .stSelectbox div[data-baseweb="select"] > div,
.stDateInput input, [data-baseweb="select"] {
  background: var(--panel) !important;
  border: 1px solid var(--border) !important;
  border-radius: 10px !important;
  min-height: 44px;
  color: var(--ink) !important;
}
.stTextInput input { color: var(--ink) !important; }
.stTextInput input:focus, .stDateInput input:focus {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12) !important;
}

.stButton > button, .stDownloadButton > button {
  border-radius: 10px !important;
  min-height: 44px;
  font-weight: 700 !important;
  color: var(--ink-soft) !important;
  background: var(--panel) !important;
  border: 1px solid var(--border) !important;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.stButton > button:hover, .stDownloadButton > button:hover {
  background: var(--accent-soft) !important;
  border-color: var(--accent) !important;
  color: var(--accent-dark) !important;
}
.stDownloadButton > button[kind="primary"], .stButton > button[kind="primary"] {
  background: var(--accent) !important;
  color: #ffffff !important;
  border: 1px solid var(--accent) !important;
}
.stDownloadButton > button[kind="primary"]:hover, .stButton > button[kind="primary"]:hover {
  background: var(--accent-dark) !important;
  color: #ffffff !important;
}

[data-testid="stFileUploader"] section {
  background: var(--panel) !important;
  border: 1.5px dashed var(--border) !important;
  border-radius: 14px !important;
}

div[data-testid="stExpander"],
div[data-testid="stForm"] {
  background: var(--panel) !important;
  border: 1px solid var(--border) !important;
  border-radius: 14px !important;
  box-shadow: var(--shadow);
}

/* HERO — sade başlık kartı */
.app-hero {
  background: var(--panel);
  border-radius: 16px;
  padding: 1.25rem 1.3rem;
  margin-bottom: 1rem;
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  box-shadow: var(--shadow);
}
.app-title {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 800;
  line-height: 1.25;
  color: var(--ink);
  letter-spacing: -0.01em;
}
.app-sub {
  margin: 0.4rem 0 0;
  color: var(--muted);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 700;
  line-height: 1.4;
}
.status-line {
  margin-top: 0.55rem;
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--ink-soft);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  line-height: 1.5;
}
.status-dot {
  display: inline-block; width: 9px; height: 9px; border-radius: 50%;
  margin-right: 5px;
}
.status-dot.ok { background: #16a34a; box-shadow: 0 0 0 3px rgba(22,163,74,0.15); }
.status-dot.warn { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,0.15); }

/* YOLCU KARTI — temiz beyaz kart */
.pax-card {
  position: relative;
  background: var(--panel);
  border-radius: 14px;
  padding: 1rem 1.1rem 1rem 1.25rem;
  margin-bottom: 0.7rem;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.pax-card::before {
  content: "";
  position: absolute; left: 0; top: 12px; bottom: 12px; width: 4px;
  border-radius: 0 4px 4px 0;
  background: var(--accent);
}
.pax-card.warn::before { background: #f59e0b; }
.pax-card.bad::before { background: #ef4444; }
.pax-flags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 0.45rem; }
.pax-flag {
  font-size: 0.62rem; font-weight: 800; padding: 2px 8px; border-radius: 999px;
  background: #fff4e5; color: #b45309; border: 1px solid #fde4bf;
  text-transform: uppercase; letter-spacing: 0.02em;
}
.pax-flag.bad { background: #fde8e8; color: #b91c1c; border-color: #f7c5c5; }
.pax-card-row { display: flex; gap: 0.9rem; align-items: flex-start; }
.pax-card-body { flex: 1; min-width: 0; }
.pax-photo {
  width: 64px; height: 82px; border-radius: 10px; object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border);
  background: var(--bg);
}
.pax-photo-empty {
  display: flex; align-items: center; justify-content: center;
  font-size: 1.8rem; color: #c2cad6;
}
.pax-photo-lg {
  width: 94px; height: 120px; border-radius: 12px; object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border);
  background: var(--bg);
  display: flex; align-items: center; justify-content: center; font-size: 2.4rem; color: #c2cad6;
}
.pax-card-top { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.45rem; }
.pax-no {
  font-size: 0.66rem; font-weight: 800; padding: 3px 10px; border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-dark); letter-spacing: 0.03em;
  white-space: nowrap;
}
.pax-date { font-size: 0.74rem; color: var(--muted); font-weight: 700; white-space: nowrap; }
.pax-name {
  font-size: 1.08rem; font-weight: 800; color: var(--ink); margin: 0 0 0.3rem;
  line-height: 1.3;
}
.pax-line {
  font-size: 0.82rem; color: var(--muted); line-height: 1.5; margin: 0 0 0.28rem;
  display: flex; gap: 0.5rem; align-items: baseline;
}
.pax-k { flex: 0 0 96px; font-weight: 700; color: #9aa4b4; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; }
.pax-v { flex: 1; min-width: 0; color: var(--ink-soft); font-weight: 600; }
.pax-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.pax-tag {
  font-size: 0.66rem; font-weight: 700; padding: 3px 9px; border-radius: 999px;
  background: var(--border-soft); color: var(--ink-soft); border: 1px solid var(--border);
}
.pax-fee {
  margin-top: 0.55rem; font-size: 0.86rem; font-weight: 800; color: var(--accent-dark);
}
.pax-meta { margin-top: 0.5rem; font-size: 0.64rem; color: #9aa4b4; letter-spacing: 0.02em; }

.app-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 1rem 1.1rem;
  margin-bottom: 0.8rem;
  box-shadow: var(--shadow);
}
.app-panel-title {
  margin: 0; font-weight: 800; color: var(--ink); font-size: 1rem; line-height: 1.35;
}
.app-panel-sub { margin: 0.3rem 0 0; font-size: 0.8rem; color: var(--muted); line-height: 1.5; }

.filter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0.5rem 0; }
.filter-chip {
  padding: 4px 11px; border-radius: 999px; font-size: 0.72rem; font-weight: 700;
  background: var(--accent-soft); color: var(--accent-dark); border: 1px solid #d4e2ff;
}

.format-box {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.75rem 0.85rem;
  font-size: 0.8rem;
  color: var(--ink-soft);
  line-height: 1.65;
  margin-top: 0.55rem;
}
.format-box code { color: var(--accent-dark); background: var(--accent-soft); padding: 1px 5px; border-radius: 5px; }
.format-box b { color: var(--ink); }

.section-label {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0.8rem 0 0.5rem;
}

div[data-testid="stExpander"] summary p { color: var(--ink) !important; font-weight: 700; }
.stDataFrame { border-radius: 14px; overflow: hidden; border: 1px solid var(--border); }
</style>
"""

st.markdown(APP_CSS, unsafe_allow_html=True)

# iPhone "Ana Ekrana Ekle" / tam ekran uygulama (PWA): manifest ve ikon etiketlerini
# ana dokümanın <head> bölümüne enjekte et (Streamlit aksi halde <body>'ye koyar).
components.html(
    """
    <script>
    (function () {
      try {
        const head = window.parent.document.head;
        if (head.querySelector('#gatevisa-pwa')) return;
        const marker = document.createElement('meta');
        marker.id = 'gatevisa-pwa';
        head.appendChild(marker);
        const add = (tag, attrs) => {
          const el = window.parent.document.createElement(tag);
          Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
          head.appendChild(el);
        };
        add('link', { rel: 'apple-touch-icon', href: '/app/static/icon-180.png' });
        add('link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/app/static/icon-180.png' });
        add('link', { rel: 'icon', type: 'image/png', href: '/app/static/icon-192.png' });
        add('meta', { name: 'apple-mobile-web-app-title', content: 'Gate Visa' });
        add('meta', { name: 'application-name', content: 'Gate Visa' });
        add('meta', { name: 'theme-color', content: '#ffffff' });
      } catch (e) {}
    })();
    </script>
    """,
    height=0,
)


def init_state() -> None:
    if "base_df" not in st.session_state:
        loaded = load_store()
        st.session_state.base_df = loaded[0]
        st.session_state.loaded_files = loaded[1] if len(loaded) > 1 else []
        extra = loaded[2] if len(loaded) > 2 else {}
        st.session_state.import_history = list(extra.get("import_history", []) or [])
        st.session_state.date_meta = dict(extra.get("date_meta", {}) or {})
    defaults = {
        "base_df": pd.DataFrame(columns=ALL_COLUMNS),
        "last_signature": "",
        "read_log": [],
        "errors": [],
        "warnings": [],
        "loaded_files": [],
        "selected_idx": None,
        "column_filters": {},
        "date_filters": {},
        "photo_log": [],
        "photo_signature": "",
        "pax_page": 0,
        "arch_page": 0,
        "pending_photos": [],
        "page_size": PAGE_SIZE,
        "show_photos": True,
        "updated_at": "",
        "import_history": [],
        "date_meta": {},
        "staging_df": None,
        "view_mode": "Detaylı",
        "missing_filter": "Tümü",
        "sort_by": "Varsayılan",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    if "tag_filters" in st.session_state and not st.session_state.get("column_filters"):
        st.session_state.column_filters = st.session_state.pop("tag_filters", {})


def persist() -> None:
    st.session_state.updated_at = datetime.now().strftime("%d.%m.%Y %H:%M")
    extra = {
        "import_history": st.session_state.get("import_history", []),
        "date_meta": st.session_state.get("date_meta", {}),
    }
    try:
        save_store(st.session_state.base_df, st.session_state.get("loaded_files", []), extra=extra)
    except TypeError:
        # Eski/stale persistence modülü ile uyumluluk
        save_store(st.session_state.base_df, st.session_state.get("loaded_files", []))


def uploaded_signature(files) -> str:
    if not files:
        return "empty"
    parts = [f"{f.name}:{getattr(f, 'size', 0)}" for f in files]
    return "|".join(parts)


def stage_uploads(files) -> None:
    """Excel'i okuyup hazırlık (staging) tablosuna alır — henüz listeye işlemez."""
    results: list[ReadResult] = []
    log: list[str] = []
    errors: list[str] = []

    for file in files or []:
        try:
            raw = file.getvalue()
            file_results = read_gate_visa_file_bytes(file.name, raw)
            for r in file_results:
                results.append(r)
                log.append(f"✓ {r.file_name} / {r.sheet_name} → {r.rows} yolcu")
        except Exception as exc:
            errors.append(f"✕ {file.name}: {exc}")

    merged = gate_visa_results_to_passengers(results)

    if files and merged.empty and not errors:
        errors.append(
            "Dosya okundu ancak yolcu satırı bulunamadı. NAME / SURNAME / PASSPORT NUMBER "
            "sütunlarının dolu olduğundan emin olun."
        )

    st.session_state.staging_df = merged
    st.session_state.staging_files = [f.name for f in files or []]
    st.session_state.read_log = log
    st.session_state.errors = errors
    st.session_state.warnings = validate_passenger_rows(merged)


def _passport_index(df: pd.DataFrame) -> dict[str, int]:
    out: dict[str, int] = {}
    if df.empty or "Pasaport No" not in df.columns:
        return out
    for idx, pp in df["Pasaport No"].astype(str).items():
        key = _norm_match(pp)
        if key:
            out[key] = int(idx)
    return out


def staging_duplicate_count() -> int:
    staging = st.session_state.get("staging_df")
    if staging is None or staging.empty:
        return 0
    existing = _passport_index(st.session_state.base_df)
    if not existing:
        return 0
    count = 0
    for pp in staging["Pasaport No"].astype(str):
        if _norm_match(pp) and _norm_match(pp) in existing:
            count += 1
    return count


def commit_staging(mode: str, dup_strategy: str) -> None:
    """Staging tablosunu listeye işler. mode: ekle/değiştir. dup_strategy: atla/üzerine/ekle."""
    merged = st.session_state.get("staging_df")
    if merged is None:
        return
    merged = merged.copy()
    existing = st.session_state.base_df
    dup_count = staging_duplicate_count()

    if mode == "replace" or existing.empty:
        result = merged
    elif dup_strategy == "skip":
        ex = _passport_index(existing)
        keep = [not (_norm_match(pp) and _norm_match(pp) in ex) for pp in merged["Pasaport No"].astype(str)]
        result = pd.concat([existing, merged[keep]], ignore_index=True).fillna("")
    elif dup_strategy == "overwrite":
        result = existing.copy().reset_index(drop=True)
        ex = _passport_index(result)
        new_rows = []
        for _, row in merged.iterrows():
            key = _norm_match(str(row.get("Pasaport No", "")))
            if key and key in ex:
                tgt = ex[key]
                for col in ALL_COLUMNS:
                    val = str(row.get(col, "") or "")
                    # Mevcut fotoğrafı, yeni veride foto yoksa koru
                    if col == "Foto" and not val:
                        continue
                    result.at[tgt, col] = val
            else:
                new_rows.append(row)
        if new_rows:
            result = pd.concat([result, pd.DataFrame(new_rows)], ignore_index=True).fillna("")
    else:  # add all
        result = pd.concat([existing, merged], ignore_index=True).fillna("")

    st.session_state.base_df = normalize_passenger_dataframe(result)
    st.session_state.loaded_files = st.session_state.get("staging_files", [])
    st.session_state.selected_idx = None
    st.session_state.column_filters = {}
    st.session_state.pax_page = 0

    history = list(st.session_state.get("import_history", []))
    history.insert(0, {
        "time": datetime.now().strftime("%d.%m.%Y %H:%M"),
        "files": ", ".join(st.session_state.get("staging_files", [])) or "—",
        "rows": int(len(merged)),
        "duplicates": int(dup_count),
        "errors": int(len(st.session_state.get("errors", []))),
        "mode": "Değiştir" if (mode == "replace" or existing.empty) else f"Ekle ({dup_strategy})",
    })
    st.session_state.import_history = history[:30]

    st.session_state.staging_df = None
    st.session_state.staging_files = []
    st.session_state.warnings = validate_passenger_rows(st.session_state.base_df)
    persist()


def process_photos(photo_files) -> None:
    if st.session_state.base_df.empty:
        st.session_state.photo_log = ["⚠ Önce yolcu Excel'i yükleyin, sonra fotoğrafları ekleyin."]
        return

    uploaded: list[tuple[str, bytes]] = []
    skipped: list[str] = []
    zip_count = 0
    for f in photo_files or []:
        data = f.getvalue()
        if is_zip(f.name, data):
            images = extract_images_from_zip(data)
            if images:
                uploaded.extend(images)
                zip_count += 1
            else:
                skipped.append(f"{f.name} (ZIP içinde görüntü yok)")
        elif looks_like_image(f.name, data):
            uploaded.append((f.name, data))
        else:
            skipped.append(f.name)

    updated, matched, unmatched = match_photos_to_dataframe(st.session_state.base_df, uploaded)
    st.session_state.base_df = normalize_passenger_dataframe(updated)

    total_with_photo = int(
        st.session_state.base_df["Foto"].astype(str).str.strip().ne("").sum()
    )

    # Eşleşmeyenleri manuel eşleştirme için sakla (küçültülmüş baytlarla)
    unmatched_set = set(unmatched)
    pending = list(st.session_state.get("pending_photos", []))
    existing = {p["name"] for p in pending}
    reason_counts: dict[str, int] = {}
    for name, data in uploaded:
        if name in unmatched_set and name not in existing:
            reason = _unmatched_reason(name, st.session_state.base_df)
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
            pending.append({"name": name, "data": _resize_bytes(data), "reason": reason})
            existing.add(name)
    st.session_state.pending_photos = pending[:80]

    zip_note = f" ({zip_count} ZIP açıldı, {len(uploaded)} görüntü)" if zip_count else ""
    log: list[str] = [
        f"✓ {matched} fotoğraf eşleşti{zip_note} · toplam {total_with_photo} yolcuda foto var."
    ]
    if unmatched:
        detail = " · ".join(f"{k}: {v}" for k, v in reason_counts.items())
        log.append(f"✕ {len(unmatched)} fotoğraf eşleşmedi" + (f" ({detail})" if detail else ""))
        log.append("Eşleşmeyenleri aşağıdaki **Eşleşmeyen fotoğraflar** bölümünden elle atayabilirsin.")
    if skipped:
        log.append("⚠ Görüntü olmayan/atlanan dosya: " + ", ".join(skipped[:6]) + (" …" if len(skipped) > 6 else ""))
    st.session_state.photo_log = log
    thumb_uri.clear()
    persist()


def assign_pending_photo(pending_index: int, target_idx: int) -> None:
    """Eşleşmeyen bir fotoğrafı seçilen yolcuya elle atar."""
    pending = list(st.session_state.get("pending_photos", []))
    if pending_index < 0 or pending_index >= len(pending):
        return
    item = pending[pending_index]
    key = cell_text(st.session_state.base_df.at[target_idx, "Pasaport No"]) or f"row{target_idx}"
    stored = save_photo_bytes(_norm_match(key) or "foto", ".jpg", item["data"])
    st.session_state.base_df.at[target_idx, "Foto"] = stored
    st.session_state.base_df = normalize_passenger_dataframe(st.session_state.base_df)
    pending.pop(pending_index)
    st.session_state.pending_photos = pending
    thumb_uri.clear()
    persist()


def render_unmatched_photos() -> None:
    pending = st.session_state.get("pending_photos", [])
    if not pending:
        return
    base_df = st.session_state.base_df
    if base_df.empty:
        return

    st.markdown(
        f"""
        <div class="app-panel">
          <p class="app-panel-title">Eşleşmeyen fotoğraflar ({len(pending)})</p>
          <p class="app-panel-sub">Aşağıdaki fotoğrafları doğru yolcuya elle atayabilirsin</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    options: list[tuple[str, int]] = []
    for idx, row in base_df.iterrows():
        label = f'{cell_text(row.get("Yolcu Adı Soyadı")) or "Yolcu"} — {cell_text(row.get("Pasaport No")) or "?"}'
        options.append((label, int(idx)))
    labels = [o[0] for o in options]

    pc1, pc2 = st.columns(2)
    zip_buf = BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in pending:
            name = item["name"]
            if not name.lower().endswith((".jpg", ".jpeg", ".png")):
                name = name.rsplit(".", 1)[0] + ".jpg"
            zf.writestr(name, item["data"])
    pc1.download_button(
        "Eşleşmeyenleri ZIP indir",
        data=zip_buf.getvalue(),
        file_name=f"eslesmeyen-fotograflar-{datetime.now().strftime('%Y%m%d-%H%M')}.zip",
        mime="application/zip",
        use_container_width=True,
        key="export_unmatched_zip",
    )
    if pc2.button("Tüm eşleşmeyenleri temizle", key="clear_pending", use_container_width=True):
        st.session_state.pending_photos = []
        st.rerun()

    for i, item in enumerate(list(pending)):
        pc, sc = st.columns([1, 3])
        with pc:
            st.image(item["data"], width=84)
        with sc:
            st.caption(f'{item["name"]}  ·  {item.get("reason", "")}')
            choice = st.selectbox(
                "Yolcu seç",
                options=labels,
                key=f"pending_pick_{i}",
                label_visibility="collapsed",
            )
            if st.button("Bu yolcuya ata", key=f"pending_assign_{i}", use_container_width=True):
                target = options[labels.index(choice)][1]
                assign_pending_photo(i, target)
                st.toast("Fotoğraf atandı", icon="✅")
                st.rerun()


def render_topbar() -> None:
    count = len(st.session_state.get("base_df", pd.DataFrame()))
    if db.enabled():
        backend = '<span class="status-dot ok"></span>Veritabanı bağlı (kalıcı)'
    else:
        backend = '<span class="status-dot warn"></span>Geçici depolama'
    updated = st.session_state.get("updated_at", "")
    updated_html = f" · Son güncelleme {updated}" if updated else ""
    st.markdown(
        f"""
        <div class="app-hero">
          <p class="app-title">Gate Visa PAX</p>
          <p class="app-sub">{TEMPLATE_NAME} · Yolcu kartları · v{APP_VERSION}</p>
          <div class="status-line">{backend} · {count} yolcu{updated_html}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_active_filter_chips(filters: dict[str, str | None]) -> None:
    active = [(field, value) for field, value in filters.items() if value]
    if not active:
        return
    chips = "".join(f'<span class="filter-chip">{field}: {value}</span>' for field, value in active)
    st.markdown(f'<div class="filter-chips">{chips}</div>', unsafe_allow_html=True)


def total_active_filters() -> int:
    cols = sum(1 for v in st.session_state.column_filters.values() if v)
    dates = sum(1 for v in st.session_state.get("date_filters", {}).values() if v)
    return cols + dates


def render_header_filters(base_df: pd.DataFrame) -> None:
    headers = filterable_headers(base_df)
    if not headers:
        st.caption("Filtrelenecek alan bulunamadı.")
        return

    render_active_filter_chips(st.session_state.column_filters)

    date_fields = [h for h in headers if h in DATE_FILTER_FIELDS]
    other_fields = [h for h in headers if h not in DATE_FILTER_FIELDS]

    # Takvim ile tarih aralığı filtreleri
    for field in date_fields:
        parsed = [parse_date_value(v) for v in base_df[field].tolist()]
        parsed = [d for d in parsed if d is not None]
        date_kwargs = {}
        if parsed:
            date_kwargs["min_value"] = min(parsed)
            date_kwargs["max_value"] = max(parsed)
        current = st.session_state.date_filters.get(field)
        default_value = current if current else ()
        picked = st.date_input(
            f"{field} (takvimden seç)",
            value=default_value,
            key=f"date_{field}",
            format="YYYY-MM-DD",
            **date_kwargs,
        )
        if isinstance(picked, (list, tuple)):
            if len(picked) == 2:
                st.session_state.date_filters[field] = (picked[0], picked[1])
            elif len(picked) == 1:
                st.session_state.date_filters[field] = (picked[0], picked[0])
            else:
                st.session_state.date_filters[field] = None
        elif picked:
            st.session_state.date_filters[field] = (picked, picked)
        else:
            st.session_state.date_filters[field] = None

    # Diğer alanlar — açılır menü
    cols = st.columns(2)
    for idx, field in enumerate(other_fields):
        options = ["Tümü"] + unique_values(base_df, field)
        current = st.session_state.column_filters.get(field) or "Tümü"
        with cols[idx % 2]:
            choice = st.selectbox(
                field,
                options=options,
                index=options.index(current) if current in options else 0,
                key=f"filter_{field}",
            )
            st.session_state.column_filters[field] = None if choice in (None, "Tümü") else choice

    if st.button("Filtreleri temizle", use_container_width=True):
        st.session_state.column_filters = {}
        st.session_state.date_filters = {}
        st.rerun()


@st.cache_data(show_spinner=False, max_entries=1024)
def thumb_uri(ref: str, max_dim: int, quality: int) -> str | None:
    """Foto referansından küçük, önbelleğe alınmış JPEG data-uri üretir.

    Listede her kart için tam boy base64 foto gömmek iPhone'da sayfayı
    kilitliyordu. Burada küçük bir küçük resim üretip önbelleğe alıyoruz;
    böylece HTML yükü çok küçük kalıyor ve resize işlemi foto başına bir kez yapılıyor.
    """
    uri = photo_data_uri(ref)
    if not uri or "," not in uri:
        return uri
    if _PILImage is None:
        return uri
    try:
        data = base64.b64decode(uri.split(",", 1)[1])
        img = _PILImage.open(BytesIO(data))
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim))
        out = BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        encoded = base64.b64encode(out.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"
    except Exception:
        return uri


def _resize_bytes(data: bytes, max_dim: int = 480, quality: int = 75) -> bytes:
    """Görüntüyü küçültür; başarısızsa orijinali döndürür (bellek için)."""
    if _PILImage is None:
        return data
    try:
        img = _PILImage.open(BytesIO(data))
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim))
        out = BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue()
    except Exception:
        return data


def _norm_match(value: str) -> str:
    import re as _re

    return _re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _passport_from_filename(filename: str) -> str:
    base = filename.rsplit(".", 1)[0]
    parts = [p for p in base.split("_") if p.strip()]
    return parts[-1] if parts else ""


def _unmatched_reason(filename: str, base_df: pd.DataFrame) -> str:
    full = _norm_match(filename.rsplit(".", 1)[0])
    hits = 0
    for pp in base_df.get("Pasaport No", pd.Series(dtype=str)).astype(str).tolist():
        npp = _norm_match(pp)
        if npp and len(npp) >= 4 and npp in full:
            hits += 1
    if hits == 0:
        return "Pasaport bulunamadı"
    if hits > 1:
        return "Birden fazla aynı pasaport"
    return "Eşleşmedi"


def photo_html(row: pd.Series, css_class: str = "pax-photo", size: str = "list") -> str:
    ref = str(row.get("Foto", "") or "")
    if ref:
        uri = thumb_uri(ref, 96, 55) if size == "list" else thumb_uri(ref, 380, 82)
        if uri:
            return f'<img class="{css_class}" src="{uri}" alt="foto" loading="lazy" decoding="async" />'
    return f'<div class="{css_class} pax-photo-empty">👤</div>'


def card_issues(row: pd.Series) -> list[tuple[str, str]]:
    """Kart durumu: (etiket, önem) listesi. önem: 'bad' veya 'warn'."""
    issues: list[tuple[str, str]] = []
    if not cell_text(row.get("Pasaport No")):
        issues.append(("Pasaport yok", "bad"))
    if not str(row.get("Foto", "") or "").strip():
        issues.append(("Foto yok", "warn"))
    if not cell_text(row.get("Vize Ücreti Yetişkin")) and not cell_text(row.get("Vize Ücreti Çocuk")):
        issues.append(("Ücret yok", "warn"))
    pp = _norm_match(row.get("Pasaport No"))
    if pp and pp in st.session_state.get("dup_passports", set()):
        issues.append(("Tekrarlı", "warn"))
    return issues


def render_passenger_card(idx: int, row: pd.Series, key_prefix: str = "list") -> None:
    card = passenger_card_view(row)
    view_mode = st.session_state.get("view_mode", "Detaylı")
    name = cell_text(row.get("Yolcu Adı Soyadı")) or "Yolcu"
    passport = cell_text(row.get("Pasaport No")) or "—"
    voucher = cell_text(row.get("Voucher"))
    dep = cell_text(row.get("Gidiş Tarihi"))
    arr = cell_text(row.get("Varış Tarihi"))

    issues = card_issues(row)
    card_cls = "pax-card"
    if any(sev == "bad" for _, sev in issues):
        card_cls += " bad"
    elif issues:
        card_cls += " warn"
    flags_html = ""
    if issues:
        flags_html = '<div class="pax-flags">' + "".join(
            f'<span class="pax-flag {sev}">{label}</span>' for label, sev in issues
        ) + "</div>"

    if view_mode == "Kompakt":
        lines_html = f'<div class="pax-line"><span class="pax-k">Pasaport</span><span class="pax-v">{passport}</span></div>'
        fee_html = ""
    else:
        lines = [f'<div class="pax-line"><span class="pax-k">Pasaport</span><span class="pax-v">{passport}</span></div>']
        if voucher:
            lines.append(f'<div class="pax-line"><span class="pax-k">Voucher</span><span class="pax-v">{voucher}</span></div>')
        if dep or arr:
            date_val = f'{dep or "—"} → {arr or "—"}'
            lines.append(f'<div class="pax-line"><span class="pax-k">Gidiş → Varış</span><span class="pax-v">{date_val}</span></div>')
        lines_html = "".join(lines)
        fee_html = f'<div class="pax-fee">Ücret: {card["amount"]}</div>' if card["amount"] else ""

    show_photo = st.session_state.get("show_photos", True) and view_mode != "Fotoğrafsız"
    photo = photo_html(row) if show_photo else ""

    st.markdown(
        f"""
        <div class="{card_cls}">
          <div class="pax-card-row">
            {photo}
            <div class="pax-card-body">
              <div class="pax-card-top">
                <span class="pax-no">{card["status"] or "Yolcu"}</span>
                <span class="pax-date">{dep or "—"}</span>
              </div>
              <div class="pax-name">{name}</div>
              {lines_html}
              {fee_html}
              {flags_html}
            </div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    if st.button("Detayı aç →", key=f"open_card_{key_prefix}_{idx}", use_container_width=True):
        st.session_state.selected_idx = idx
        st.rerun()


def render_detail_view(base_df: pd.DataFrame) -> None:
    idx = st.session_state.selected_idx
    if idx is None or idx not in base_df.index:
        st.session_state.selected_idx = None
        st.rerun()
        return

    row = base_df.loc[idx]
    card = passenger_card_view(row)

    if st.button("← Listeye dön"):
        st.session_state.selected_idx = None
        st.rerun()

    st.markdown(
        f"""
        <div class="app-panel">
          <div class="pax-card-row">
            {photo_html(row, css_class="pax-photo-lg", size="detail")}
            <div class="pax-card-body">
              <p class="app-panel-title">{card["title"]}</p>
              <p class="app-panel-sub">{card["subtitle"]}</p>
            </div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    with st.expander("Fotoğraf", expanded=False):
        has_photo = bool(str(row.get("Foto", "") or "").strip())
        new_photo = st.file_uploader("Fotoğraf değiştir / ekle", key=f"detail_photo_{idx}")
        if new_photo is not None and st.session_state.get(f"detail_photo_sig_{idx}") != new_photo.name + str(getattr(new_photo, "size", 0)):
            st.session_state[f"detail_photo_sig_{idx}"] = new_photo.name + str(getattr(new_photo, "size", 0))
            data = new_photo.getvalue()
            if looks_like_image(new_photo.name, data):
                key = cell_text(row.get("Pasaport No")) or f"row{idx}"
                stored = save_photo_bytes(_norm_match(key) or "foto", ".jpg", _resize_bytes(data))
                st.session_state.base_df.at[idx, "Foto"] = stored
                st.session_state.base_df = normalize_passenger_dataframe(st.session_state.base_df)
                thumb_uri.clear()
                persist()
                st.toast("Fotoğraf güncellendi", icon="✅")
                st.rerun()
            else:
                st.error("Seçilen dosya bir görüntü değil.")
        if has_photo and st.button("Fotoğrafı sil", key=f"detail_photo_del_{idx}"):
            st.session_state.base_df.at[idx, "Foto"] = ""
            st.session_state.base_df = normalize_passenger_dataframe(st.session_state.base_df)
            thumb_uri.clear()
            persist()
            st.toast("Fotoğraf silindi", icon="🗑️")
            st.rerun()

    with st.form("passenger_detail_form", border=True):
        updates: dict[str, str] = {}
        for field in editable_passenger_fields():
            if field == "Yolcu Adı Soyadı":
                st.text_input(field, value=str(row.get(field, "") or ""), disabled=True)
                continue
            updates[field] = st.text_input(field, value=str(row.get(field, "") or ""))

        st.divider()
        st.caption("Kaynak import")
        st.text_input("Kaynak Dosya", value=str(row.get("Kaynak Dosya", "") or ""), disabled=True)
        st.text_input("Sayfa", value=str(row.get("Sayfa", "") or ""), disabled=True)

        save_col, delete_col = st.columns(2)
        saved = save_col.form_submit_button("Kaydet", use_container_width=True, type="primary")
        delete = delete_col.form_submit_button("Sil", use_container_width=True)

    if saved:
        updates["Yolcu Adı Soyadı"] = f'{updates.get("Ad", "").strip()} {updates.get("Soyad", "").strip()}'.strip()
        for field, value in updates.items():
            st.session_state.base_df.at[idx, field] = value
        st.session_state.base_df = normalize_passenger_dataframe(st.session_state.base_df)
        st.session_state.selected_idx = None
        persist()
        st.toast("Yolcu güncellendi", icon="✅")
        st.rerun()

    if delete:
        st.session_state.base_df = normalize_passenger_dataframe(
            st.session_state.base_df.drop(index=idx).reset_index(drop=True)
        )
        st.session_state.selected_idx = None
        persist()
        st.toast("Yolcu silindi", icon="🗑️")
        st.rerun()


def build_backup_json() -> bytes:
    df = st.session_state.base_df.fillna("").astype(str) if not st.session_state.base_df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    payload = {
        "version": APP_VERSION,
        "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "passengers": df.to_dict(orient="records"),
        "loaded_files": st.session_state.get("loaded_files", []),
        "import_history": st.session_state.get("import_history", []),
        "date_meta": st.session_state.get("date_meta", {}),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def restore_backup_json(data: bytes) -> tuple[bool, str]:
    try:
        payload = json.loads(data.decode("utf-8"))
    except Exception:
        return False, "Geçersiz JSON dosyası."
    records = payload.get("passengers")
    if records is None:
        return False, "Yedekte 'passengers' alanı yok."
    df = pd.DataFrame(records)
    st.session_state.base_df = normalize_passenger_dataframe(df) if not df.empty else pd.DataFrame(columns=ALL_COLUMNS)
    st.session_state.loaded_files = list(payload.get("loaded_files", []) or [])
    st.session_state.import_history = list(payload.get("import_history", []) or [])
    st.session_state.date_meta = dict(payload.get("date_meta", {}) or {})
    st.session_state.selected_idx = None
    st.session_state.pax_page = 0
    thumb_uri.clear()
    persist()
    return True, f"{len(st.session_state.base_df)} yolcu geri yüklendi."


def render_backup_section() -> None:
    with st.expander("Yedekleme / geri yükleme", expanded=False):
        st.caption("Tüm yolcu verisini JSON olarak indir veya bir yedekten geri yükle. (Fotoğraflar dahil değildir.)")
        st.download_button(
            "Yedek indir (JSON)",
            data=build_backup_json(),
            file_name=f"gatevisa-yedek-{datetime.now().strftime('%Y%m%d-%H%M')}.json",
            mime="application/json",
            use_container_width=True,
            key="backup_download",
        )
        restore = st.file_uploader("Yedekten geri yükle (JSON)", type=["json"], key="backup_restore")
        if restore is not None and st.session_state.get("restore_sig") != restore.name + str(getattr(restore, "size", 0)):
            ok, msg = restore_backup_json(restore.getvalue())
            st.session_state.restore_sig = restore.name + str(getattr(restore, "size", 0))
            if ok:
                st.success(msg)
            else:
                st.error(msg)


def render_import_staging() -> None:
    staging = st.session_state.get("staging_df")
    if staging is None:
        return

    if staging.empty:
        st.warning("Yüklenen dosyada içeri alınacak yolcu bulunamadı.")
        if st.button("Kapat", key="staging_close_empty"):
            st.session_state.staging_df = None
            st.rerun()
        return

    dup_count = staging_duplicate_count()
    missing_pp = int(staging["Pasaport No"].astype(str).str.strip().eq("").sum())
    missing_name = int(staging["Yolcu Adı Soyadı"].astype(str).str.strip().eq("").sum())

    st.markdown(
        f"""
        <div class="app-panel">
          <p class="app-panel-title">Önizleme — {len(staging)} yolcu</p>
          <p class="app-panel-sub">Onaylamadan önce kontrol et. Tekrarlanan pasaport: {dup_count} ·
          Pasaport boş: {missing_pp} · Ad-soyad boş: {missing_name}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.dataframe(
        staging[["No", "Ad", "Soyad", "Pasaport No", "Voucher", "Gidiş Tarihi", "Varış Tarihi"]],
        use_container_width=True,
        hide_index=True,
    )

    mode_label = st.radio(
        "İçeri alma şekli",
        options=["Mevcut listeye ekle", "Listeyi tamamen değiştir"],
        horizontal=True,
        key="staging_mode",
    )
    mode = "append" if mode_label == "Mevcut listeye ekle" else "replace"

    dup_strategy = "add"
    if mode == "append" and dup_count > 0:
        strat_label = st.radio(
            f"Tekrarlanan {dup_count} pasaport için",
            options=["Tekrarları atla", "Üzerine yaz", "Hepsini ekle"],
            key="staging_dup",
        )
        dup_strategy = {"Tekrarları atla": "skip", "Üzerine yaz": "overwrite", "Hepsini ekle": "add"}[strat_label]

    ca, cb = st.columns(2)
    if ca.button("Onayla ve içeri al", type="primary", use_container_width=True, key="staging_confirm"):
        commit_staging(mode, dup_strategy)
        st.session_state.last_signature = ""
        st.toast("İçeri alındı", icon="✅")
        st.rerun()
    if cb.button("İptal", use_container_width=True, key="staging_cancel"):
        st.session_state.staging_df = None
        st.session_state.last_signature = ""
        st.rerun()


def render_import_history() -> None:
    history = st.session_state.get("import_history", [])
    if not history:
        return
    with st.expander(f"Import geçmişi ({len(history)})", expanded=False):
        for h in history[:15]:
            st.caption(
                f'🕒 {h.get("time","")} · {h.get("files","")} · {h.get("rows",0)} yolcu · '
                f'{h.get("mode","")} · tekrar {h.get("duplicates",0)} · hata {h.get("errors",0)}'
            )


def render_import_tab() -> None:
    st.markdown(
        f"""
        <div class="app-panel">
          <p class="app-panel-title">Import</p>
          <p class="app-panel-sub">{TEMPLATE_NAME} şablonu</p>
          <div class="format-box">{expected_headers_markdown()}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    if db.enabled():
        st.success("🟢 Veritabanı bağlı — veriler ve fotoğraflar kalıcı olarak saklanıyor.")
    else:
        st.info(
            "🟡 Veritabanı bağlı değil — veriler yerel olarak tutuluyor (uygulama yeniden "
            "başlayınca silinebilir). Kalıcı saklama için `DATABASE_URL` secret'ı ekleyin."
        )

    files = st.file_uploader("Excel / CSV yükle", type=["xlsx", "xls", "xlsm", "ods", "csv"], accept_multiple_files=True)

    sig = uploaded_signature(files)
    if files and sig != st.session_state.last_signature:
        stage_uploads(files)
        st.session_state.last_signature = sig
        st.rerun()

    render_import_staging()

    t1, t2, t3 = st.columns(3)
    with t1:
        st.download_button(
            "Şablon indir",
            data=passenger_template_xlsx(),
            file_name="gate-visa-pax-sablonu.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            type="primary",
        )
    with t2:
        if st.button("Demo yolcular", use_container_width=True):
            st.session_state.base_df = normalize_passenger_dataframe(make_demo_passengers())
            st.session_state.read_log = ["✓ Demo: 3 yolcu kartı"]
            st.session_state.errors = []
            st.session_state.warnings = []
            st.session_state.loaded_files = ["demo.xlsx"]
            st.session_state.selected_idx = None
            st.session_state.pax_page = 0
            st.session_state.arch_page = 0
            persist()
            st.rerun()
    with t3:
        if st.button("Temizle", use_container_width=True):
            st.session_state.confirm_clear = True

    if st.session_state.get("confirm_clear"):
        st.warning("Tüm yolcular ve fotoğraf eşleştirmeleri silinecek. Emin misin?")
        cc1, cc2 = st.columns(2)
        if cc1.button("Evet, hepsini sil", type="primary", use_container_width=True, key="confirm_clear_yes"):
            st.session_state.base_df = pd.DataFrame(columns=ALL_COLUMNS)
            st.session_state.last_signature = ""
            st.session_state.read_log = []
            st.session_state.errors = []
            st.session_state.warnings = []
            st.session_state.loaded_files = []
            st.session_state.selected_idx = None
            st.session_state.column_filters = {}
            st.session_state.date_filters = {}
            st.session_state.pax_page = 0
            st.session_state.arch_page = 0
            st.session_state.pending_photos = []
            st.session_state.staging_df = None
            st.session_state.confirm_clear = False
            thumb_uri.clear()
            persist()
            st.rerun()
        if cc2.button("Vazgeç", use_container_width=True, key="confirm_clear_no"):
            st.session_state.confirm_clear = False
            st.rerun()

    render_backup_section()
    render_import_history()

    for item in st.session_state.read_log[:10]:
        st.success(item)
    for item in st.session_state.warnings:
        st.warning(item)
    if st.session_state.errors:
        for item in st.session_state.errors:
            st.error(item)
        st.info(
            "**İpucu:** Yüklenen dosya Gate Visa PAX LIST şablonuna uymuyorsa da yolcu "
            "verisi tespit edilmeye çalışılır. Dosyanın NAME / SURNAME / PASSPORT NUMBER "
            "sütunları içerdiğinden emin olun. **Şablon indir** ile doğru formatı indirebilirsiniz."
        )

    # Biyometrik fotoğraf toplu import
    st.markdown(
        """
        <div class="app-panel">
          <p class="app-panel-title">Biyometrik fotoğraflar</p>
          <p class="app-panel-sub">Tek tek veya ZIP ile toplu yükle — dosya adı kartla otomatik eşleşir</p>
          <div class="format-box">Dosya adı: <b>TARİH_İSİM_SOYİSİM_PASAPORT</b><br>
          Örn: <code>2026-07-01_JOHN_DOE_AB123456.jpg</code><br>
          Eşleşme pasaport numarasına göre yapılır.<br><br>
          <b>iPhone'da yükleme:</b><br>
          • <b>Fotoğraf Kitaplığı</b>'ndan fotoğrafları çoklu seç, ya da<br>
          • Tüm fotoğrafları <b>tek bir .zip</b> yap ve onu seç<br>
          <b>Klasör seçme</b> — iOS bunu desteklemez ("özellik desteklenmiyor" hatası).</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    photo_files = st.file_uploader(
        "Fotoğraf veya ZIP yükle",
        accept_multiple_files=True,
        key="photo_uploader",
        help="iPhone: yükleyiciye dokun → Fotoğraf Kitaplığı'ndan çoklu seç. VEYA tüm fotoğrafları bir .zip yapıp Dosyalar'dan o zip'i seç. Klasör seçilemez (iOS kısıtı).",
    )
    photo_sig = uploaded_signature(photo_files)
    if photo_files and photo_sig != st.session_state.photo_signature:
        process_photos(photo_files)
        st.session_state.photo_signature = photo_sig
        st.rerun()

    for item in st.session_state.photo_log:
        if item.startswith("✓"):
            st.success(item)
        elif item.startswith("✕") or item.startswith("⚠"):
            st.warning(item)
        else:
            st.caption(item)

    render_unmatched_photos()

    # Yüklenen veriyi hemen burada göster — kullanıcı sekme değiştirmeden görsün
    preview_df = st.session_state.base_df
    if not preview_df.empty:
        st.success(f"✅ {len(preview_df)} yolcu yüklendi. **Yolcu Kartları** sekmesinden görebilirsin.")
        st.markdown('<p class="section-label">Yüklenen yolcular (önizleme)</p>', unsafe_allow_html=True)
        st.dataframe(
            preview_df[["No", "Ad", "Soyad", "Pasaport No", "Voucher", "Gidiş Tarihi", "Varış Tarihi"]],
            use_container_width=True,
            hide_index=True,
        )


def render_pagination(state_key: str, page: int, pages: int, nav_prefix: str) -> None:
    if pages <= 1:
        return
    prev_c, mid_c, next_c = st.columns([1, 1.4, 1])
    if prev_c.button("‹ Önceki", key=f"{nav_prefix}_prev", use_container_width=True, disabled=page <= 0):
        st.session_state[state_key] = page - 1
        st.rerun()
    mid_c.markdown(
        f'<p style="text-align:center;margin:0;padding-top:0.55rem;font-weight:700;color:#6b7688;">'
        f"Sayfa {page + 1} / {pages}</p>",
        unsafe_allow_html=True,
    )
    if next_c.button("Sonraki ›", key=f"{nav_prefix}_next", use_container_width=True, disabled=page >= pages - 1):
        st.session_state[state_key] = page + 1
        st.rerun()


def render_card_page(view_df: pd.DataFrame, state_key: str, key_prefix: str) -> None:
    """Kartları sayfalayarak gösterir; iPhone'da tek seferde çok kart yüklenmesini engeller."""
    page_size = int(st.session_state.get("page_size", PAGE_SIZE))
    total = len(view_df)
    pages = max(1, (total + page_size - 1) // page_size)
    page = min(max(0, int(st.session_state.get(state_key, 0))), pages - 1)
    st.session_state[state_key] = page

    start = page * page_size
    chunk = view_df.iloc[start : start + page_size]

    render_pagination(state_key, page, pages, f"{key_prefix}_top")
    for idx, row in chunk.iterrows():
        render_passenger_card(int(idx), row, key_prefix=key_prefix)
    render_pagination(state_key, page, pages, f"{key_prefix}_bot")


def apply_missing_filter(df: pd.DataFrame, choice: str) -> pd.DataFrame:
    if df.empty or choice == "Tümü":
        return df
    if choice == "Fotosuz":
        return df[df["Foto"].astype(str).str.strip().eq("")]
    if choice == "Pasaportsuz":
        return df[df["Pasaport No"].astype(str).str.strip().eq("")]
    if choice == "Ücretsiz":
        adult = df["Vize Ücreti Yetişkin"].astype(str).str.strip()
        child = df["Vize Ücreti Çocuk"].astype(str).str.strip()
        return df[adult.eq("") & child.eq("")]
    if choice == "Tekrarlı":
        dups = st.session_state.get("dup_passports", set())
        return df[df["Pasaport No"].map(lambda v: _norm_match(v) in dups and bool(_norm_match(v)))]
    return df


def apply_sort(df: pd.DataFrame, choice: str) -> pd.DataFrame:
    if df.empty or choice == "Varsayılan":
        return df
    work = df.copy()
    if choice == "İsim":
        work["_k"] = work["Yolcu Adı Soyadı"].astype(str).str.casefold()
        return work.sort_values("_k").drop(columns="_k")
    if choice == "Pasaport":
        work["_k"] = work["Pasaport No"].astype(str).str.casefold()
        return work.sort_values("_k").drop(columns="_k")
    if choice == "Gidiş Tarihi":
        work["_k"] = work["Gidiş Tarihi"].map(lambda v: parse_date_value(v) or pd.Timestamp.max.date())
        return work.sort_values("_k").drop(columns="_k")
    if choice == "Ücret":
        work["_k"] = work.apply(lambda r: parse_amount(r.get("Vize Ücreti Yetişkin")) + parse_amount(r.get("Vize Ücreti Çocuk")), axis=1)
        return work.sort_values("_k", ascending=False).drop(columns="_k")
    return df


def render_passengers_tab(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        st.info("Henüz yolcu yok. **Import** sekmesinden Excel yükle.")
        return

    search = st.text_input("Ara", placeholder="Ad, pasaport, voucher, tarih…", label_visibility="collapsed")

    opt_c1, opt_c2 = st.columns([1, 1])
    with opt_c1:
        sizes = [6, 10, 20, 50]
        cur_size = int(st.session_state.get("page_size", PAGE_SIZE))
        st.session_state.page_size = st.selectbox(
            "Sayfa başına kart",
            options=sizes,
            index=sizes.index(cur_size) if cur_size in sizes else 1,
            key="page_size_select",
        )
    with opt_c2:
        modes = ["Detaylı", "Kompakt", "Fotoğrafsız"]
        cur_mode = st.session_state.get("view_mode", "Detaylı")
        st.session_state.view_mode = st.selectbox(
            "Görünüm",
            options=modes,
            index=modes.index(cur_mode) if cur_mode in modes else 0,
            key="view_mode_select",
        )

    opt_c3, opt_c4 = st.columns([1, 1])
    with opt_c3:
        miss_opts = ["Tümü", "Fotosuz", "Pasaportsuz", "Ücretsiz", "Tekrarlı"]
        cur_miss = st.session_state.get("missing_filter", "Tümü")
        st.session_state.missing_filter = st.selectbox(
            "Hızlı filtre",
            options=miss_opts,
            index=miss_opts.index(cur_miss) if cur_miss in miss_opts else 0,
            key="missing_filter_select",
        )
    with opt_c4:
        sort_opts = ["Varsayılan", "İsim", "Pasaport", "Gidiş Tarihi", "Ücret"]
        cur_sort = st.session_state.get("sort_by", "Varsayılan")
        st.session_state.sort_by = st.selectbox(
            "Sırala",
            options=sort_opts,
            index=sort_opts.index(cur_sort) if cur_sort in sort_opts else 0,
            key="sort_by_select",
        )

    filter_count = total_active_filters()
    with st.expander("Başlıklara göre filtrele", expanded=filter_count > 0):
        render_header_filters(base_df)

    active = {k: v for k, v in st.session_state.column_filters.items() if v}
    active_dates = {k: v for k, v in st.session_state.date_filters.items() if v}
    view_df = apply_filters(base_df, search, active, active_dates)
    view_df = apply_missing_filter(view_df, st.session_state.missing_filter)
    view_df = apply_sort(view_df, st.session_state.sort_by)

    # Arama/filtre değişince sayfayı başa al
    sig = f"{search}|{sorted(active.items())}|{sorted(active_dates.keys())}|{st.session_state.missing_filter}|{st.session_state.sort_by}"
    if st.session_state.get("pax_filter_sig") != sig:
        st.session_state.pax_filter_sig = sig
        st.session_state.pax_page = 0

    c1, c2, c3 = st.columns(3)
    c1.metric("Yolcu", len(view_df))
    c2.metric("Kaynak", len(st.session_state.loaded_files))
    c3.metric("Filtre", total_active_filters())

    if view_df.empty:
        st.warning("Filtreye uyan yolcu bulunamadı.")
        return

    st.markdown(f'<p class="section-label">{len(view_df)} yolcu</p>', unsafe_allow_html=True)
    render_card_page(view_df, "pax_page", "list")


def _fmt_amount(value: float) -> str:
    if value == 0:
        return "0"
    if abs(value - round(value)) < 0.005:
        return f"{int(round(value))}"
    return f"{value:.2f}"


def _quick_range_bounds(choice: str):
    today = datetime.now().date()
    if choice == "Bugün":
        return today, today
    if choice == "Bu hafta":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if choice == "Bu ay":
        start = today.replace(day=1)
        nxt = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
        return start, nxt - timedelta(days=1)
    return None


def render_archive_tab(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        st.info("Henüz yolcu yok. **Import** sekmesinden Excel yükle.")
        return

    date_field = "Gidiş Tarihi"

    choice = st.radio(
        "Hızlı tarih",
        options=["Tümü", "Bugün", "Bu hafta", "Bu ay", "Aralık"],
        horizontal=True,
        key="arch_range_choice",
    )
    bounds = _quick_range_bounds(choice)
    if choice == "Aralık":
        picked = st.date_input("Tarih aralığı", value=(), key="arch_custom_range", format="YYYY-MM-DD")
        if isinstance(picked, (list, tuple)) and len(picked) == 2:
            bounds = (picked[0], picked[1])
        elif isinstance(picked, (list, tuple)) and len(picked) == 1:
            bounds = (picked[0], picked[0])
        else:
            bounds = None

    if bounds is not None:
        start, end = bounds

        def _in_bounds(value) -> bool:
            d = parse_date_value(value)
            return d is not None and start <= d <= end

        scoped = base_df[base_df[date_field].map(_in_bounds)]
    else:
        scoped = base_df

    summ = summarize_group(scoped)
    c1, c2, c3 = st.columns(3)
    c1.metric("Yolcu", summ["count"])
    c2.metric("Toplam ücret", _fmt_amount(summ["total"]))
    c3.metric("Fotolu", summ["with_photo"])

    if scoped.empty:
        st.warning("Seçilen tarih aralığında yolcu yok.")
        return

    groups: dict[str, list[int]] = {}
    for idx, value in scoped[date_field].astype(str).str.strip().items():
        key = value if value else "Tarihsiz"
        groups.setdefault(key, []).append(int(idx))

    def sort_key(item: str) -> tuple[int, str]:
        return (1, "") if item == "Tarihsiz" else (0, item)

    ordered = sorted(groups.keys(), key=sort_key)

    st.markdown('<p class="section-label">Tarihe göre arşiv</p>', unsafe_allow_html=True)
    labels = [f"{d}  ·  {len(groups[d])} yolcu" for d in ordered]
    selected = st.selectbox("Tarih seç", options=labels, key="archive_date_pick")
    date_key = ordered[labels.index(selected)] if selected in labels else ordered[0]

    if st.session_state.get("arch_sig") != f"{choice}|{date_key}":
        st.session_state.arch_sig = f"{choice}|{date_key}"
        st.session_state.arch_page = 0

    sub_df = scoped.loc[groups[date_key]]
    sub_summ = summarize_group(sub_df)
    m1, m2, m3 = st.columns(3)
    m1.metric("Bu tarih", sub_summ["count"])
    m2.metric("Yetişkin ücret", _fmt_amount(sub_summ["adult_total"]))
    m3.metric("Çocuk ücret", _fmt_amount(sub_summ["child_total"]))

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    e1, e2 = st.columns(2)
    safe_date = date_key.replace("/", "-").replace(".", "-").replace(" ", "")
    e1.download_button(
        "Bu tarihi indir (Excel)",
        data=dataframe_to_xlsx(sub_df),
        file_name=f"yolcular-{safe_date}-{stamp}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
        type="primary",
        key="arch_date_xlsx",
    )
    e2.download_button(
        "Seçili aralığı indir",
        data=dataframe_to_xlsx(scoped),
        file_name=f"yolcular-aralik-{stamp}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
        key="arch_range_xlsx",
    )

    photo_zip = build_date_photo_zip(sub_df)
    if photo_zip is not None:
        st.download_button(
            "Bu tarihin fotoğraflarını ZIP indir",
            data=photo_zip,
            file_name=f"fotograflar-{safe_date}-{stamp}.zip",
            mime="application/zip",
            use_container_width=True,
            key="arch_photo_zip",
        )

    render_operation_panel(date_key, sub_df)
    render_card_page(sub_df, "arch_page", "arch")


def build_date_photo_zip(df: pd.DataFrame) -> bytes | None:
    """Verilen yolcuların fotoğraflarını ZIP olarak paketler."""
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
            base = (cell_text(row.get("Pasaport No")) or cell_text(row.get("Yolcu Adı Soyadı")) or "foto")
            base = "".join(c if c.isalnum() or c in "-_" else "_" for c in base)
            name = f"{base}.jpg"
            n = 1
            while name in used:
                name = f"{base}_{n}.jpg"
                n += 1
            used.add(name)
            zf.writestr(name, data)
    return buf.getvalue()


def render_operation_panel(date_key: str, sub_df: pd.DataFrame) -> None:
    meta = dict(st.session_state.get("date_meta", {}).get(date_key, {}))

    # Otomatik kontrol listesi
    summ = summarize_group(sub_df)
    total = summ["count"]
    photo_ok = summ["with_photo"] == total and total > 0
    pp_ok = sub_df["Pasaport No"].astype(str).str.strip().ne("").all()
    fee_ok = sub_df.apply(lambda r: bool(cell_text(r.get("Vize Ücreti Yetişkin")) or cell_text(r.get("Vize Ücreti Çocuk"))), axis=1).all()
    voucher_ok = sub_df["Voucher"].astype(str).str.strip().ne("").all()

    def mark(ok: bool) -> str:
        return "✅" if ok else "⚠️"

    with st.expander(f"Operasyon — {date_key}", expanded=False):
        st.markdown(
            f"""
            <div class="format-box">
            {mark(photo_ok)} Fotoğraflar ({summ['with_photo']}/{total})<br>
            {mark(pp_ok)} Pasaport bilgileri<br>
            {mark(fee_ok)} Ücret bilgileri<br>
            {mark(voucher_ok)} Voucher bilgileri
            </div>
            """,
            unsafe_allow_html=True,
        )
        status_opts = ["Hazırlanıyor", "Foto kontrol", "Evrak kontrol", "Tamamlandı"]
        cur_status = meta.get("status", "Hazırlanıyor")
        status = st.selectbox(
            "Durum",
            options=status_opts,
            index=status_opts.index(cur_status) if cur_status in status_opts else 0,
            key=f"op_status_{date_key}",
        )
        staff = st.text_input("Görevli", value=meta.get("staff", ""), key=f"op_staff_{date_key}")
        note = st.text_area("Not", value=meta.get("note", ""), key=f"op_note_{date_key}")
        if st.button("Operasyon bilgisini kaydet", key=f"op_save_{date_key}", use_container_width=True):
            dm = dict(st.session_state.get("date_meta", {}))
            dm[date_key] = {"status": status, "staff": staff, "note": note}
            st.session_state.date_meta = dm
            persist()
            st.toast("Operasyon bilgisi kaydedildi", icon="✅")
            st.rerun()


def render_bottom_bar(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        return
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    st.divider()
    c1, c2 = st.columns(2)
    with c1:
        st.download_button(
            "Excel indir",
            data=dataframe_to_xlsx(base_df),
            file_name=f"yolcular-{stamp}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            type="primary",
            key="bottom_xlsx",
        )
    with c2:
        st.download_button(
            "CSV indir",
            data=dataframe_to_csv(base_df),
            file_name=f"yolcular-{stamp}.csv",
            mime="text/csv",
            use_container_width=True,
            key="bottom_csv",
        )


init_state()
render_topbar()

base_df = normalize_passenger_dataframe(st.session_state.base_df.copy())
st.session_state.base_df = base_df

_pp_norm = base_df["Pasaport No"].astype(str).map(_norm_match) if not base_df.empty else pd.Series(dtype=str)
st.session_state.dup_passports = set(_pp_norm[_pp_norm.ne("") & _pp_norm.duplicated(keep=False)]) if len(_pp_norm) else set()

if st.session_state.selected_idx is not None and not base_df.empty:
    render_detail_view(st.session_state.base_df)
else:
    tab_passengers, tab_archive, tab_import = st.tabs(["Yolcu Kartları", "Arşiv", "Import"])
    with tab_passengers:
        render_passengers_tab(st.session_state.base_df)
    with tab_archive:
        render_archive_tab(st.session_state.base_df)
    with tab_import:
        render_import_tab()

render_bottom_bar(st.session_state.base_df)
