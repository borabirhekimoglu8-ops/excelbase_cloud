from __future__ import annotations

from datetime import datetime

import pandas as pd
import streamlit as st

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

APP_VERSION = "3.3.0"

st.set_page_config(
    page_title="Gate Visa PAX",
    page_icon="🛂",
    layout="wide",
    initial_sidebar_state="collapsed",
)

APP_CSS = """
<style>
:root {
  --holo-bg: #070b14;
  --holo-surface: rgba(15, 23, 42, 0.72);
  --holo-border: rgba(148, 163, 184, 0.18);
  --holo-text: #e2e8f0;
  --holo-muted: #94a3b8;
  --holo-cyan: #22d3ee;
  --holo-violet: #a78bfa;
  --holo-pink: #f472b6;
  --holo-blue: #60a5fa;
}

html, body, [class*="css"] {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif !important;
  color: var(--holo-text);
}

.stApp {
  background:
    radial-gradient(ellipse 120% 80% at 10% -20%, rgba(34, 211, 238, 0.18), transparent 50%),
    radial-gradient(ellipse 90% 60% at 90% 0%, rgba(167, 139, 250, 0.16), transparent 45%),
    radial-gradient(ellipse 70% 50% at 50% 100%, rgba(244, 114, 182, 0.10), transparent 40%),
    linear-gradient(180deg, #070b14 0%, #0c1222 45%, #070b14 100%);
  background-attachment: fixed;
}

.block-container {
  padding-top: 0.85rem;
  padding-bottom: 6.5rem;
  max-width: 820px;
}

[data-testid="stHeader"] {
  background: rgba(7, 11, 20, 0.75) !important;
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--holo-border);
}

/* Tabs */
.stTabs [data-baseweb="tab-list"] {
  gap: 8px;
  background: transparent;
  border-bottom: 1px solid var(--holo-border);
}
.stTabs [data-baseweb="tab"] {
  background: rgba(15, 23, 42, 0.5) !important;
  border-radius: 12px 12px 0 0 !important;
  border: 1px solid transparent !important;
  color: var(--holo-muted) !important;
  font-weight: 700 !important;
  padding: 10px 18px !important;
}
.stTabs [aria-selected="true"] {
  background: linear-gradient(135deg, rgba(34,211,238,0.15), rgba(167,139,250,0.15)) !important;
  border-color: rgba(34, 211, 238, 0.35) !important;
  color: var(--holo-cyan) !important;
  box-shadow: 0 0 20px rgba(34, 211, 238, 0.12);
}

/* Metrics */
div[data-testid="stMetric"] {
  background: var(--holo-surface) !important;
  border: 1px solid var(--holo-border) !important;
  border-radius: 16px !important;
  padding: 12px 14px !important;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255,255,255,0.04);
}
div[data-testid="stMetricLabel"] { color: var(--holo-muted) !important; font-size: 0.72rem !important; text-transform: uppercase; letter-spacing: 0.06em; }
div[data-testid="stMetricValue"] {
  background: linear-gradient(90deg, #22d3ee, #a78bfa, #f472b6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-weight: 800 !important;
}

/* Inputs */
.stTextInput input, .stSelectbox div[data-baseweb="select"] > div, textarea {
  background: rgba(15, 23, 42, 0.85) !important;
  border: 1px solid var(--holo-border) !important;
  border-radius: 14px !important;
  color: var(--holo-text) !important;
  min-height: 44px;
}
.stTextInput input:focus {
  border-color: rgba(34, 211, 238, 0.55) !important;
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12), 0 0 24px rgba(34, 211, 238, 0.08) !important;
}

.stButton > button {
  border-radius: 14px !important;
  min-height: 44px;
  font-weight: 700 !important;
  background: rgba(15, 23, 42, 0.9) !important;
  border: 1px solid var(--holo-border) !important;
  color: var(--holo-text) !important;
  transition: all 0.2s ease !important;
}
.stButton > button:hover {
  border-color: rgba(167, 139, 250, 0.5) !important;
  box-shadow: 0 0 20px rgba(167, 139, 250, 0.15) !important;
}
.stDownloadButton > button[kind="primary"], .stButton > button[kind="primary"] {
  background: linear-gradient(135deg, #0891b2 0%, #7c3aed 50%, #db2777 100%) !important;
  border: none !important;
  color: #fff !important;
  box-shadow: 0 8px 28px rgba(124, 58, 237, 0.35) !important;
}

[data-testid="stFileUploader"] section {
  background: rgba(15, 23, 42, 0.6) !important;
  border: 1.5px dashed rgba(34, 211, 238, 0.35) !important;
  border-radius: 16px !important;
}

/* Holographic components */
.holo-hero {
  position: relative;
  overflow: hidden;
  border-radius: 22px;
  padding: 1.15rem 1.2rem;
  margin-bottom: 1rem;
  background: var(--holo-surface);
  backdrop-filter: blur(20px);
  border: 1px solid transparent;
  background-clip: padding-box;
  box-shadow: 0 12px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06);
}
.holo-hero::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 22px;
  padding: 1px;
  background: linear-gradient(135deg, rgba(34,211,238,0.6), rgba(167,139,250,0.5), rgba(244,114,182,0.4), rgba(34,211,238,0.6));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  animation: holo-shift 6s ease infinite;
  background-size: 200% 200%;
}
@keyframes holo-shift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

.holo-title {
  margin: 0;
  font-size: clamp(1.45rem, 4.5vw, 1.9rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(90deg, #67e8f9, #c4b5fd, #f9a8d4, #67e8f9);
  background-size: 200% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: holo-text 4s linear infinite;
}
@keyframes holo-text {
  to { background-position: 200% center; }
}

.holo-sub { margin: 0.35rem 0 0; color: var(--holo-muted); font-size: 0.88rem; line-height: 1.5; }
.holo-badge {
  display: inline-flex;
  padding: 5px 11px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: linear-gradient(135deg, rgba(34,211,238,0.2), rgba(167,139,250,0.2));
  border: 1px solid rgba(34, 211, 238, 0.35);
  color: #67e8f9;
}

.holo-card {
  position: relative;
  border-radius: 20px;
  padding: 1rem 1.05rem;
  margin-bottom: 0.7rem;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(148, 163, 184, 0.12);
  box-shadow: 0 10px 36px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.holo-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 48px rgba(34, 211, 238, 0.08), 0 10px 36px rgba(0,0,0,0.35);
  border-color: rgba(34, 211, 238, 0.25);
}

.holo-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.holo-no {
  font-size: 0.72rem; font-weight: 800; padding: 4px 10px; border-radius: 999px;
  background: linear-gradient(135deg, rgba(96,165,250,0.25), rgba(167,139,250,0.25));
  border: 1px solid rgba(96, 165, 250, 0.4); color: #93c5fd;
}
.holo-date { font-size: 0.78rem; color: var(--holo-muted); font-weight: 600; }
.holo-name { font-size: 1.08rem; font-weight: 800; color: #f1f5f9; margin-bottom: 0.25rem; }
.holo-line { font-size: 0.84rem; color: var(--holo-muted); line-height: 1.45; margin-bottom: 0.55rem; }
.holo-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.holo-tag {
  font-size: 0.7rem; font-weight: 700; padding: 4px 10px; border-radius: 999px;
  background: rgba(34, 211, 238, 0.08); border: 1px solid rgba(34, 211, 238, 0.22); color: #a5f3fc;
}
.holo-fee {
  margin-top: 0.45rem; font-size: 0.88rem; font-weight: 700;
  background: linear-gradient(90deg, #22d3ee, #a78bfa);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
.holo-meta { margin-top: 0.45rem; font-size: 0.68rem; color: #64748b; }

.holo-panel {
  background: var(--holo-surface);
  backdrop-filter: blur(18px);
  border: 1px solid var(--holo-border);
  border-radius: 18px;
  padding: 0.85rem 0.95rem;
  margin-bottom: 0.85rem;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}
.holo-panel-title {
  margin: 0 0 0.15rem;
  font-size: 0.92rem;
  font-weight: 800;
  color: #cbd5e1;
  letter-spacing: 0.02em;
}
.holo-panel-sub { margin: 0 0 0.65rem; font-size: 0.78rem; color: var(--holo-muted); }

.holo-active-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 0.65rem; }
.holo-filter-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 700;
  background: linear-gradient(135deg, rgba(124,58,237,0.25), rgba(34,211,238,0.15));
  border: 1px solid rgba(167, 139, 250, 0.45);
  color: #e9d5ff;
}

.holo-search-wrap {
  margin-bottom: 0.75rem;
  padding: 2px;
  border-radius: 16px;
  background: linear-gradient(90deg, rgba(34,211,238,0.4), rgba(167,139,250,0.4), rgba(244,114,182,0.4));
}

.bottom-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 999;
  padding: 0.7rem 0.9rem calc(0.7rem + env(safe-area-inset-bottom));
  background: rgba(7, 11, 20, 0.92);
  backdrop-filter: blur(20px);
  border-top: 1px solid rgba(34, 211, 238, 0.15);
  box-shadow: 0 -12px 40px rgba(0,0,0,0.45);
}

.format-box {
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid var(--holo-border);
  border-radius: 14px;
  padding: 0.75rem 0.85rem;
  font-size: 0.82rem;
  color: var(--holo-muted);
  line-height: 1.55;
}

div[data-testid="stExpander"] {
  background: var(--holo-surface) !important;
  border: 1px solid var(--holo-border) !important;
  border-radius: 16px !important;
  backdrop-filter: blur(12px);
}
</style>
"""

st.markdown(APP_CSS, unsafe_allow_html=True)


def init_state() -> None:
    defaults = {
        "base_df": pd.DataFrame(columns=ALL_COLUMNS),
        "last_signature": "",
        "read_log": [],
        "errors": [],
        "warnings": [],
        "loaded_files": [],
        "selected_idx": None,
        "column_filters": {},
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value
    if "tag_filters" in st.session_state and not st.session_state.get("column_filters"):
        st.session_state.column_filters = st.session_state.pop("tag_filters", {})


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

    st.session_state.read_log = log
    st.session_state.errors = errors
    st.session_state.warnings = validate_passenger_rows(st.session_state.base_df)
    st.session_state.loaded_files = [f.name for f in files or []]
    st.session_state.selected_idx = None
    st.session_state.column_filters = {}


def render_topbar() -> None:
    st.markdown(
        f"""
        <div class="holo-hero">
          <span class="holo-badge">HOLOGRAPHIC · GATE VISA</span>
          <p class="holo-title">Gate Visa PAX</p>
          <p class="holo-sub">{TEMPLATE_NAME} · Her satır bir yolcu kartı · v{APP_VERSION}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_active_filter_chips(filters: dict[str, str | None]) -> None:
    active = [(field, value) for field, value in filters.items() if value]
    if not active:
        return
    chips = "".join(
        f'<span class="holo-filter-chip">{field}: {value}</span>' for field, value in active
    )
    st.markdown(f'<div class="holo-active-filters">{chips}</div>', unsafe_allow_html=True)


def render_header_filters(base_df: pd.DataFrame) -> None:
    headers = filterable_headers(base_df)
    if not headers:
        return

    st.markdown(
        """
        <div class="holo-panel">
          <p class="holo-panel-title">Başlıklara göre filtrele</p>
          <p class="holo-panel-sub">Excel kolon başlığı seç · değere göre daralt</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

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


def render_passenger_card(idx: int, row: pd.Series) -> None:
    card = passenger_card_view(row)
    tags_html = "".join(f'<span class="holo-tag">{t["label"]}: {t["value"]}</span>' for t in card["tags"])
    meta = " · ".join(x for x in [card["source"], card["sheet"]] if x)

    st.markdown(
        f"""
        <div class="holo-card">
          <div class="holo-card-top">
            <span class="holo-no">{card["status"] or "YOLCU"}</span>
            <span class="holo-date">{card["date"] or "—"}</span>
          </div>
          <div class="holo-name">{card["title"]}</div>
          <div class="holo-line">{card["subtitle"]}</div>
          <div class="holo-tags">{tags_html}</div>
          {"<div class='holo-fee'>" + card["amount"] + "</div>" if card["amount"] else ""}
          <div class="holo-meta">{meta}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    if st.button("✦ Yolcu detayı", key=f"open_card_{idx}", use_container_width=True):
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
        <div class="holo-panel">
          <p class="holo-title" style="font-size:1.2rem;">{card["title"]}</p>
          <p class="holo-sub">{card["subtitle"]}</p>
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
        st.toast("Yolcu güncellendi", icon="✅")
        st.rerun()

    if delete:
        st.session_state.base_df = normalize_passenger_dataframe(
            st.session_state.base_df.drop(index=idx).reset_index(drop=True)
        )
        st.session_state.selected_idx = None
        st.toast("Yolcu silindi", icon="🗑️")
        st.rerun()


def render_import_tab() -> None:
    st.markdown(
        f"""
        <div class="holo-panel">
          <p class="holo-panel-title">Kaynak Import</p>
          <p class="holo-sub">Sadece <b>{TEMPLATE_NAME}</b> şablonu</p>
          <div class="format-box">{expected_headers_markdown()}</div>
        </div>
        """,
        unsafe_allow_html=True,
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
            st.rerun()

    for item in st.session_state.read_log[:5]:
        st.success(item)
    for item in st.session_state.warnings:
        st.warning(item)
    for item in st.session_state.errors:
        st.error(item)


def render_passengers_tab(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        st.info("Henüz yolcu yok. **Kaynak Import** sekmesinden Excel yükle.")
        return

    st.markdown('<div class="holo-search-wrap">', unsafe_allow_html=True)
    search = st.text_input("Ara", placeholder="🔍  Ad, pasaport, voucher, tarih…", label_visibility="collapsed")
    st.markdown("</div>", unsafe_allow_html=True)

    with st.expander("▸ Başlıklara göre filtrele", expanded=active_filter_count(st.session_state.column_filters) > 0):
        render_header_filters(base_df)

    active = {k: v for k, v in st.session_state.column_filters.items() if v}
    view_df = apply_filters(base_df, search, active)

    c1, c2, c3 = st.columns(3)
    c1.metric("Yolcu", len(view_df))
    c2.metric("Kaynak", len(st.session_state.loaded_files))
    c3.metric("Aktif filtre", active_filter_count(st.session_state.column_filters))

    if view_df.empty:
        st.warning("Filtreye uyan yolcu bulunamadı.")
        return

    st.caption(f"✦ {len(view_df)} holografik yolcu kartı")
    for idx, row in view_df.iterrows():
        render_passenger_card(int(idx), row)


def render_bottom_bar(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        return
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    st.markdown('<div class="bottom-bar">', unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    with c1:
        st.download_button(
            "⬇ Excel",
            data=dataframe_to_xlsx(base_df),
            file_name=f"yolcular-{stamp}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            type="primary",
            key="bottom_xlsx",
        )
    with c2:
        st.download_button(
            "⬇ CSV",
            data=dataframe_to_csv(base_df),
            file_name=f"yolcular-{stamp}.csv",
            mime="text/csv",
            use_container_width=True,
            key="bottom_csv",
        )
    st.markdown("</div>", unsafe_allow_html=True)


init_state()
render_topbar()

base_df = normalize_passenger_dataframe(st.session_state.base_df.copy())
st.session_state.base_df = base_df

if st.session_state.selected_idx is not None and not base_df.empty:
    render_detail_view(st.session_state.base_df)
else:
    tab_passengers, tab_import = st.tabs(["✦ Yolcu Kartları", "◎ Kaynak Import"])
    with tab_passengers:
        render_passengers_tab(st.session_state.base_df)
    with tab_import:
        render_import_tab()

render_bottom_bar(st.session_state.base_df)
