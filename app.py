from __future__ import annotations

from datetime import datetime

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from excelbase_core import ReadResult, dataframe_to_csv, dataframe_to_xlsx
from gate_visa_reader import read_gate_visa_file_bytes
from operation_helpers import (
    active_filter_count,
    apply_filters,
    editable_passenger_fields,
    filterable_headers,
    passenger_card_view,
    unique_values,
)
import db
from persistence import load_store, save_store
from photo_store import match_photos_to_dataframe, photo_data_uri
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

APP_VERSION = "4.1.0"

st.set_page_config(
    page_title="Gate Visa PAX",
    page_icon="🛂",
    layout="wide",
    initial_sidebar_state="collapsed",
)

APP_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Playfair+Display:wght@700;800;900&display=swap');

:root {
  --gold: #f5c451;
  --gold-soft: #ffe2a3;
  --cyan: #38bdf8;
  --ink: #eaf0fb;
  --muted: #9fb0cf;
  --glass: rgba(255, 255, 255, 0.045);
  --glass-strong: rgba(255, 255, 255, 0.07);
  --border: rgba(255, 255, 255, 0.10);
  --shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
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

.stApp {
  background:
    radial-gradient(1200px 700px at 80% -10%, rgba(56, 189, 248, 0.18), transparent 55%),
    radial-gradient(1000px 600px at 0% 10%, rgba(245, 196, 81, 0.12), transparent 50%),
    linear-gradient(180deg, #070b16 0%, #0a1326 45%, #060a14 100%);
  background-attachment: fixed;
}

/* Sinematik hareketli ışık katmanı — tıklamayı engellemez */
.stApp::before {
  content: "";
  position: fixed;
  inset: -20%;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(600px 400px at 20% 30%, rgba(56, 189, 248, 0.10), transparent 60%),
    radial-gradient(500px 500px at 85% 70%, rgba(245, 196, 81, 0.08), transparent 60%);
  animation: aurora 16s ease-in-out infinite alternate;
}
@keyframes aurora {
  0%   { transform: translate3d(0, 0, 0) scale(1); opacity: 0.85; }
  100% { transform: translate3d(0, -3%, 0) scale(1.08); opacity: 1; }
}

[data-testid="stAppViewContainer"] > .main { background: transparent !important; }
.block-container {
  position: relative;
  z-index: 1;
  padding-top: max(0.85rem, env(safe-area-inset-top));
  padding-bottom: max(2.6rem, env(safe-area-inset-bottom));
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
  max-width: 720px;
}

/* Sekmeler — cam pill + altın parıltı */
.stTabs [data-baseweb="tab-list"] {
  gap: 6px;
  background: var(--glass);
  border-radius: 16px;
  padding: 5px;
  border: 1px solid var(--border);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.stTabs [data-baseweb="tab"] {
  border-radius: 12px !important;
  background: transparent !important;
  color: var(--muted) !important;
  font-weight: 700 !important;
  padding: 9px 18px !important;
  border: none !important;
  transition: all 0.25s ease;
}
.stTabs [aria-selected="true"] {
  background: linear-gradient(135deg, rgba(245,196,81,0.20), rgba(56,189,248,0.14)) !important;
  color: var(--gold-soft) !important;
  box-shadow: 0 0 18px rgba(245, 196, 81, 0.28), inset 0 0 0 1px rgba(245,196,81,0.35) !important;
}
.stTabs [data-baseweb="tab-panel"] { padding-top: 0.95rem; }

div[data-testid="stMetric"] {
  background: var(--glass-strong) !important;
  border: 1px solid var(--border) !important;
  border-radius: 16px !important;
  padding: 12px 14px !important;
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
div[data-testid="stMetricLabel"] {
  color: var(--muted) !important;
  font-size: 0.66rem !important;
  font-weight: 800 !important;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
div[data-testid="stMetricValue"] {
  color: var(--gold) !important; font-weight: 800 !important;
  text-shadow: 0 0 16px rgba(245, 196, 81, 0.35);
}

.stTextInput input, .stSelectbox div[data-baseweb="select"] > div,
.stToggle, [data-baseweb="select"] {
  background: rgba(255,255,255,0.06) !important;
  border: 1px solid var(--border) !important;
  border-radius: 12px !important;
  min-height: 46px;
  color: var(--ink) !important;
}
.stTextInput input { color: var(--ink) !important; }
.stTextInput input:focus {
  border-color: var(--gold) !important;
  box-shadow: 0 0 0 3px rgba(245, 196, 81, 0.18), 0 0 22px rgba(245,196,81,0.22) !important;
}

.stButton > button, .stDownloadButton > button {
  border-radius: 12px !important;
  min-height: 46px;
  font-weight: 800 !important;
  letter-spacing: 0.02em;
  color: var(--ink) !important;
  background: var(--glass-strong) !important;
  border: 1px solid var(--border) !important;
  transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
.stButton > button:hover, .stDownloadButton > button:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 26px rgba(0,0,0,0.45);
  border-color: rgba(245,196,81,0.45) !important;
}
.stDownloadButton > button[kind="primary"], .stButton > button[kind="primary"] {
  background: linear-gradient(135deg, #f5c451 0%, #f0a93a 100%) !important;
  color: #1a1304 !important;
  border: none !important;
  box-shadow: 0 6px 24px rgba(245, 196, 81, 0.38), 0 0 0 1px rgba(255,255,255,0.10) inset !important;
}
.stDownloadButton > button[kind="primary"]:hover, .stButton > button[kind="primary"]:hover {
  box-shadow: 0 10px 34px rgba(245, 196, 81, 0.55) !important;
}

[data-testid="stFileUploader"] section {
  background: var(--glass) !important;
  border: 2px dashed rgba(245, 196, 81, 0.4) !important;
  border-radius: 16px !important;
  backdrop-filter: blur(10px);
}

div[data-testid="stExpander"],
div[data-testid="stForm"] {
  background: var(--glass-strong) !important;
  border: 1px solid var(--border) !important;
  border-radius: 16px !important;
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* HERO — sinematik afiş */
.app-hero {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(245,196,81,0.10), rgba(56,189,248,0.06)),
    rgba(255,255,255,0.04);
  border-radius: 22px;
  padding: 1.5rem 1.4rem;
  margin-bottom: 1rem;
  border: 1px solid rgba(245, 196, 81, 0.22);
  box-shadow: var(--shadow), 0 0 60px rgba(56, 189, 248, 0.10) inset;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.app-hero::after {
  content: "";
  position: absolute; top: 0; left: -60%;
  width: 50%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.16), transparent);
  transform: skewX(-18deg);
  animation: sheen 6s ease-in-out infinite;
  pointer-events: none;
}
@keyframes sheen { 0%,60% { left: -60%; } 100% { left: 130%; } }
.app-title {
  margin: 0;
  font-family: 'Playfair Display', serif !important;
  font-size: 2.05rem;
  font-weight: 900;
  letter-spacing: 0.01em;
  background: linear-gradient(92deg, #ffe9b0 0%, #f5c451 35%, #38bdf8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 0 0 40px rgba(245, 196, 81, 0.25);
}
.app-sub {
  margin: 0.45rem 0 0;
  color: var(--muted);
  font-size: 0.84rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  font-weight: 700;
}

/* YOLCU KARTI — cam + altın kenar parıltısı */
.pax-card {
  position: relative;
  background: linear-gradient(160deg, rgba(255,255,255,0.075), rgba(255,255,255,0.03));
  border-radius: 18px;
  padding: 1rem 1.05rem;
  margin-bottom: 0.7rem;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.pax-card::before {
  content: "";
  position: absolute; left: 0; top: 14px; bottom: 14px; width: 3px;
  border-radius: 3px;
  background: linear-gradient(180deg, #f5c451, #38bdf8);
  box-shadow: 0 0 14px rgba(245,196,81,0.6);
}
.pax-card:hover {
  transform: translateY(-2px);
  border-color: rgba(245, 196, 81, 0.4);
  box-shadow: 0 26px 60px rgba(0,0,0,0.6), 0 0 30px rgba(245,196,81,0.12);
}
.pax-card-row { display: flex; gap: 0.85rem; align-items: flex-start; }
.pax-card-body { flex: 1; min-width: 0; }
.pax-photo {
  width: 66px; height: 84px; border-radius: 12px; object-fit: cover;
  flex-shrink: 0;
  border: 2px solid transparent;
  background:
    linear-gradient(#0b1326, #0b1326) padding-box,
    linear-gradient(135deg, #f5c451, #38bdf8) border-box;
  box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 0 16px rgba(56,189,248,0.25);
}
.pax-photo-empty {
  display: flex; align-items: center; justify-content: center;
  font-size: 1.9rem; color: rgba(245, 196, 81, 0.55);
}
.pax-photo-lg {
  width: 96px; height: 122px; border-radius: 14px; object-fit: cover;
  flex-shrink: 0;
  border: 2px solid transparent;
  background:
    linear-gradient(#0b1326, #0b1326) padding-box,
    linear-gradient(135deg, #f5c451, #38bdf8) border-box;
  box-shadow: 0 8px 26px rgba(0,0,0,0.55), 0 0 22px rgba(56,189,248,0.3);
  display: flex; align-items: center; justify-content: center; font-size: 2.6rem; color: rgba(245,196,81,0.55);
}
.pax-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
.pax-no {
  font-size: 0.68rem; font-weight: 800; padding: 3px 10px; border-radius: 999px;
  background: linear-gradient(135deg, rgba(245,196,81,0.22), rgba(245,196,81,0.10));
  color: var(--gold-soft); border: 1px solid rgba(245,196,81,0.3);
  letter-spacing: 0.04em;
}
.pax-date { font-size: 0.74rem; color: var(--muted); font-weight: 700; }
.pax-name {
  font-family: 'Playfair Display', serif !important;
  font-size: 1.2rem; font-weight: 800; color: #fff; margin-bottom: 0.2rem;
  letter-spacing: 0.01em;
}
.pax-line { font-size: 0.82rem; color: var(--muted); line-height: 1.45; margin-bottom: 0.5rem; }
.pax-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.pax-tag {
  font-size: 0.66rem; font-weight: 700; padding: 3px 9px; border-radius: 999px;
  background: rgba(56, 189, 248, 0.12); color: #bae6fd; border: 1px solid rgba(56,189,248,0.25);
}
.pax-fee {
  margin-top: 0.4rem; font-size: 0.86rem; font-weight: 800; color: var(--gold);
  text-shadow: 0 0 14px rgba(245,196,81,0.3);
}
.pax-meta { margin-top: 0.4rem; font-size: 0.64rem; color: #6b7da0; letter-spacing: 0.03em; }

.app-panel {
  background: var(--glass-strong);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1rem 1.1rem;
  margin-bottom: 0.8rem;
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.app-panel-title {
  margin: 0; font-weight: 800; color: var(--gold-soft); font-size: 1rem;
  letter-spacing: 0.02em;
}
.app-panel-sub { margin: 0.25rem 0 0; font-size: 0.8rem; color: var(--muted); }

.filter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0.5rem 0; }
.filter-chip {
  padding: 4px 11px; border-radius: 999px; font-size: 0.72rem; font-weight: 700;
  background: rgba(245, 196, 81, 0.14); color: var(--gold-soft); border: 1px solid rgba(245,196,81,0.3);
}

.format-box {
  background: rgba(0,0,0,0.25);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.7rem 0.8rem;
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.6;
  margin-top: 0.55rem;
}
.format-box code { color: var(--cyan); background: rgba(56,189,248,0.12); padding: 1px 5px; border-radius: 5px; }
.format-box b { color: var(--gold-soft); }

.section-label {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--gold);
  margin: 0.7rem 0 0.45rem;
  text-shadow: 0 0 14px rgba(245,196,81,0.25);
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
        add('link', { rel: 'manifest', href: '/app/static/manifest.json' });
        add('link', { rel: 'apple-touch-icon', href: '/app/static/icon-180.png' });
        add('link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/app/static/icon-180.png' });
        add('link', { rel: 'icon', type: 'image/png', href: '/app/static/icon-192.png' });
        add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
        add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
        add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
        add('meta', { name: 'apple-mobile-web-app-title', content: 'Gate Visa' });
        add('meta', { name: 'application-name', content: 'Gate Visa' });
        add('meta', { name: 'theme-color', content: '#0d5eaf' });
      } catch (e) {}
    })();
    </script>
    """,
    height=0,
)


def init_state() -> None:
    if "base_df" not in st.session_state:
        stored_df, stored_files = load_store()
        st.session_state.base_df = stored_df
        st.session_state.loaded_files = stored_files
    defaults = {
        "base_df": pd.DataFrame(columns=ALL_COLUMNS),
        "last_signature": "",
        "read_log": [],
        "errors": [],
        "warnings": [],
        "loaded_files": [],
        "selected_idx": None,
        "column_filters": {},
        "photo_log": [],
        "photo_signature": "",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    if "tag_filters" in st.session_state and not st.session_state.get("column_filters"):
        st.session_state.column_filters = st.session_state.pop("tag_filters", {})


def persist() -> None:
    save_store(st.session_state.base_df, st.session_state.get("loaded_files", []))


def uploaded_signature(files) -> str:
    if not files:
        return "empty"
    parts = [f"{f.name}:{getattr(f, 'size', 0)}" for f in files]
    return "|".join(parts)


def process_uploads(files, append_mode: bool) -> None:
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

    if append_mode and not st.session_state.base_df.empty and not merged.empty:
        combined = pd.concat([st.session_state.base_df, merged], ignore_index=True).fillna("")
        st.session_state.base_df = normalize_passenger_dataframe(combined)
    elif not merged.empty:
        st.session_state.base_df = merged
    elif not append_mode:
        st.session_state.base_df = pd.DataFrame(columns=ALL_COLUMNS)

    if files and merged.empty and not errors:
        errors.append(
            "Dosya okundu ancak yolcu satırı bulunamadı. NAME / SURNAME / PASSPORT NUMBER "
            "sütunlarının dolu olduğundan emin olun."
        )

    st.session_state.read_log = log
    st.session_state.errors = errors
    st.session_state.warnings = validate_passenger_rows(st.session_state.base_df)
    st.session_state.loaded_files = [f.name for f in files or []]
    st.session_state.selected_idx = None
    st.session_state.column_filters = {}
    persist()


def process_photos(photo_files) -> None:
    if st.session_state.base_df.empty:
        st.session_state.photo_log = ["⚠ Önce yolcu Excel'i yükleyin, sonra fotoğrafları ekleyin."]
        return

    uploaded = [(f.name, f.getvalue()) for f in photo_files or []]
    updated, matched, unmatched = match_photos_to_dataframe(st.session_state.base_df, uploaded)
    st.session_state.base_df = normalize_passenger_dataframe(updated)

    log: list[str] = [f"✓ {matched} fotoğraf yolcuyla eşleşti."]
    if unmatched:
        log.append("✕ Eşleşmeyen: " + ", ".join(unmatched[:8]) + (" …" if len(unmatched) > 8 else ""))
        log.append("Dosya adı **TARİH_İSİM_SOYİSİM_PASAPORT** olmalı (pasaport no kartla eşleşmeli).")
    st.session_state.photo_log = log
    persist()


def render_topbar() -> None:
    st.markdown(
        f"""
        <div class="app-hero">
          <p class="app-title">Gate Visa PAX</p>
          <p class="app-sub">{TEMPLATE_NAME} · Yolcu kartları · v{APP_VERSION}</p>
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


def render_header_filters(base_df: pd.DataFrame) -> None:
    headers = filterable_headers(base_df)
    if not headers:
        st.caption("Filtrelenecek alan bulunamadı.")
        return

    render_active_filter_chips(st.session_state.column_filters)

    cols = st.columns(2)
    for idx, field in enumerate(headers):
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
        st.rerun()


def photo_html(row: pd.Series, css_class: str = "pax-photo") -> str:
    uri = photo_data_uri(str(row.get("Foto", "") or ""))
    if uri:
        return f'<img class="{css_class}" src="{uri}" alt="foto" />'
    return f'<div class="{css_class} pax-photo-empty">👤</div>'


def render_passenger_card(idx: int, row: pd.Series, key_prefix: str = "list") -> None:
    card = passenger_card_view(row)
    tags_html = "".join(f'<span class="pax-tag">{t["label"]}: {t["value"]}</span>' for t in card["tags"])
    meta = " · ".join(x for x in [card["source"], card["sheet"]] if x)

    st.markdown(
        f"""
        <div class="pax-card">
          <div class="pax-card-row">
            {photo_html(row)}
            <div class="pax-card-body">
              <div class="pax-card-top">
                <span class="pax-no">{card["status"] or "Yolcu"}</span>
                <span class="pax-date">{card["date"] or "—"}</span>
              </div>
              <div class="pax-name">{card["title"]}</div>
              <div class="pax-line">{card["subtitle"]}</div>
              <div class="pax-tags">{tags_html}</div>
              {"<div class='pax-fee'>" + card["amount"] + "</div>" if card["amount"] else ""}
              <div class="pax-meta">{meta}</div>
            </div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    if st.button("Detay", key=f"open_card_{key_prefix}_{idx}", use_container_width=True):
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
            {photo_html(row, css_class="pax-photo-lg")}
            <div class="pax-card-body">
              <p class="app-panel-title">{card["title"]}</p>
              <p class="app-panel-sub">{card["subtitle"]}</p>
            </div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

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

    append_mode = st.toggle("Mevcut yolculara ekle", value=False)
    files = st.file_uploader("Excel / CSV yükle", type=["xlsx", "xls", "xlsm", "ods", "csv"], accept_multiple_files=True)

    sig = uploaded_signature(files)
    if files and sig != st.session_state.last_signature:
        process_uploads(files, append_mode)
        st.session_state.last_signature = sig
        st.rerun()

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
            persist()
            st.rerun()
    with t3:
        if st.button("Temizle", use_container_width=True):
            st.session_state.base_df = pd.DataFrame(columns=ALL_COLUMNS)
            st.session_state.last_signature = ""
            st.session_state.read_log = []
            st.session_state.errors = []
            st.session_state.warnings = []
            st.session_state.loaded_files = []
            st.session_state.selected_idx = None
            st.session_state.column_filters = {}
            persist()
            st.rerun()

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
          <p class="app-panel-sub">Toplu yükle — dosya adı kartla otomatik eşleşir</p>
          <div class="format-box">Dosya adı: <b>TARİH_İSİM_SOYİSİM_PASAPORT</b><br>
          Örn: <code>2026-07-01_JOHN_DOE_AB123456.jpg</code><br>
          Eşleşme pasaport numarasına göre yapılır.</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    photo_files = st.file_uploader(
        "Fotoğrafları yükle",
        type=["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif"],
        accept_multiple_files=True,
        key="photo_uploader",
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


def render_passengers_tab(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        st.info("Henüz yolcu yok. **Import** sekmesinden Excel yükle.")
        return

    search = st.text_input("Ara", placeholder="Ad, pasaport, voucher, tarih…", label_visibility="collapsed")

    with st.expander("Başlıklara göre filtrele", expanded=active_filter_count(st.session_state.column_filters) > 0):
        render_header_filters(base_df)

    active = {k: v for k, v in st.session_state.column_filters.items() if v}
    view_df = apply_filters(base_df, search, active)

    c1, c2, c3 = st.columns(3)
    c1.metric("Yolcu", len(view_df))
    c2.metric("Kaynak", len(st.session_state.loaded_files))
    c3.metric("Filtre", active_filter_count(st.session_state.column_filters))

    if view_df.empty:
        st.warning("Filtreye uyan yolcu bulunamadı.")
        return

    st.markdown(f'<p class="section-label">{len(view_df)} yolcu</p>', unsafe_allow_html=True)
    for idx, row in view_df.iterrows():
        render_passenger_card(int(idx), row)


def render_archive_tab(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        st.info("Henüz yolcu yok. **Import** sekmesinden Excel yükle.")
        return

    date_field = "Gidiş Tarihi"
    dates = base_df[date_field].astype(str).str.strip()
    groups: dict[str, list[int]] = {}
    for idx, value in dates.items():
        key = value if value else "Tarihsiz"
        groups.setdefault(key, []).append(int(idx))

    def sort_key(item: str) -> tuple[int, str]:
        return (1, "") if item == "Tarihsiz" else (0, item)

    ordered = sorted(groups.keys(), key=sort_key)

    c1, c2 = st.columns(2)
    c1.metric("Tarih", len([d for d in ordered if d != "Tarihsiz"]))
    c2.metric("Toplam yolcu", len(base_df))

    st.markdown('<p class="section-label">Tarihe göre arşiv</p>', unsafe_allow_html=True)
    for date_key in ordered:
        idxs = groups[date_key]
        with st.expander(f"📅 {date_key}  ·  {len(idxs)} yolcu", expanded=False):
            for idx in idxs:
                render_passenger_card(idx, base_df.loc[idx], key_prefix=f"arch_{date_key}")


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
