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

APP_VERSION = "3.4.1"

st.set_page_config(
    page_title="Gate Visa PAX",
    page_icon="🛂",
    layout="wide",
    initial_sidebar_state="collapsed",
)

APP_CSS = """
<style>
:root {
  --gr-blue: #0d5eaf;
  --gr-blue-dark: #0a3d7a;
  --surface: #ffffff;
  --text: #0f172a;
  --muted: #64748b;
  --border: rgba(13, 94, 175, 0.22);
}

/* Sadece üst toolbar gizle — status/loading widget'a dokunma */
header[data-testid="stHeader"] {
  visibility: hidden !important;
  height: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  pointer-events: none !important;
  overflow: hidden !important;
}
header[data-testid="stHeader"] * {
  display: none !important;
}
footer { visibility: hidden !important; height: 0 !important; }

html, body, [class*="css"] {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif !important;
}

.stApp {
  background: linear-gradient(180deg, #bae6fd 0%, #38bdf8 30%, #0284c7 60%, #0c4a6e 100%);
}

[data-testid="stAppViewContainer"],
section.main,
.block-container {
  position: relative;
  z-index: 1;
}

.block-container {
  padding-top: 0.25rem;
  padding-bottom: 2rem;
  max-width: 820px;
}

[data-testid="stAppViewContainer"] > .main {
  background: transparent !important;
}

.stTabs [data-baseweb="tab-list"] {
  gap: 8px;
  background: transparent;
  border-bottom: 2px solid rgba(255,255,255,0.35);
}
.stTabs [data-baseweb="tab"] {
  background: rgba(255,255,255,0.3) !important;
  border-radius: 12px 12px 0 0 !important;
  color: #e0f2fe !important;
  font-weight: 700 !important;
}
.stTabs [aria-selected="true"] {
  background: #fff !important;
  color: var(--gr-blue) !important;
}

div[data-testid="stMetric"] {
  background: var(--surface) !important;
  border: 1px solid var(--border) !important;
  border-radius: 16px !important;
  padding: 12px 14px !important;
}
div[data-testid="stMetricLabel"] { color: var(--gr-blue) !important; font-weight: 700 !important; }
div[data-testid="stMetricValue"] { color: var(--gr-blue-dark) !important; font-weight: 800 !important; }

.stTextInput input, .stSelectbox div[data-baseweb="select"] > div {
  background: #fff !important;
  border: 1px solid var(--border) !important;
  border-radius: 14px !important;
  min-height: 44px;
}

.stButton > button {
  border-radius: 14px !important;
  min-height: 44px;
  font-weight: 700 !important;
}
.stDownloadButton > button[kind="primary"], .stButton > button[kind="primary"] {
  background: linear-gradient(135deg, #0d5eaf, #0284c7) !important;
  color: #fff !important;
  border: none !important;
}

[data-testid="stFileUploader"] section {
  background: #fff !important;
  border: 2px dashed rgba(13, 94, 175, 0.35) !important;
  border-radius: 16px !important;
}

.holo-hero {
  border-radius: 20px;
  padding: 1.15rem 1.2rem;
  margin-bottom: 1rem;
  background: #fff;
  border: 2px solid rgba(255,255,255,0.9);
  box-shadow: 0 12px 32px rgba(10, 61, 122, 0.15);
  border-left: 6px solid var(--gr-blue);
}
.holo-title { margin: 0; font-size: clamp(1.35rem, 4vw, 1.75rem); font-weight: 800; color: var(--gr-blue-dark); }
.holo-sub { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.88rem; }
.holo-badge {
  display: inline-flex; padding: 5px 12px; border-radius: 999px;
  font-size: 0.72rem; font-weight: 800; background: var(--gr-blue); color: #fff; margin-bottom: 0.45rem;
}

.holo-card {
  border-radius: 16px; padding: 1rem; margin-bottom: 0.65rem;
  background: #fff; border: 1px solid var(--border);
  box-shadow: 0 6px 20px rgba(10, 61, 122, 0.08);
}
.holo-card-top { display: flex; justify-content: space-between; margin-bottom: 0.45rem; }
.holo-no { font-size: 0.72rem; font-weight: 800; padding: 4px 10px; border-radius: 999px; background: #dbeafe; color: var(--gr-blue); }
.holo-date { font-size: 0.78rem; color: var(--muted); }
.holo-name { font-size: 1.05rem; font-weight: 800; color: var(--gr-blue-dark); margin-bottom: 0.2rem; }
.holo-line { font-size: 0.84rem; color: var(--muted); margin-bottom: 0.5rem; }
.holo-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.holo-tag { font-size: 0.7rem; font-weight: 700; padding: 4px 9px; border-radius: 999px; background: #eff6ff; color: var(--gr-blue); }
.holo-fee { margin-top: 0.4rem; font-weight: 700; color: var(--gr-blue); }
.holo-meta { margin-top: 0.4rem; font-size: 0.68rem; color: #94a3b8; }

.holo-panel {
  background: #fff; border: 1px solid var(--border); border-radius: 16px;
  padding: 0.85rem; margin-bottom: 0.75rem;
}
.holo-panel-title { margin: 0; font-weight: 800; color: var(--gr-blue-dark); }
.holo-panel-sub { margin: 0 0 0.5rem; font-size: 0.78rem; color: var(--muted); }
.holo-active-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 0.5rem; }
.holo-filter-chip { padding: 4px 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; background: #dbeafe; color: var(--gr-blue-dark); }

.greek-stripes {
  height: 4px; border-radius: 999px; margin-bottom: 0.6rem;
  background: repeating-linear-gradient(90deg, #0d5eaf 0 24px, #fff 24px 48px);
}

.format-box {
  background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px;
  padding: 0.7rem; font-size: 0.82rem; color: #475569;
}

div[data-testid="stExpander"] {
  background: #fff !important;
  border: 1px solid var(--border) !important;
  border-radius: 14px !important;
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
    st.markdown('<div class="greek-stripes"></div>', unsafe_allow_html=True)
    st.markdown(
        f"""
        <div class="holo-hero">
          <span class="holo-badge">🇬🇷 Yunan Devlet Vizesi · Feribot</span>
          <p class="holo-title">Gate Visa PAX</p>
          <p class="holo-sub">Ege denizi · Ada hatları · Kapı vizesi yolcu listesi · v{APP_VERSION}</p>
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

    search = st.text_input("Ara", placeholder="Ad, pasaport, voucher, tarih…", label_visibility="collapsed")

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

    st.caption(f"⛴ {len(view_df)} yolcu kartı — {TEMPLATE_NAME}")
    for idx, row in view_df.iterrows():
        render_passenger_card(int(idx), row)


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
    tab_passengers, tab_import = st.tabs(["⛴ Yolcu Kartları", "📥 Kaynak Import"])
    with tab_passengers:
        render_passengers_tab(st.session_state.base_df)
    with tab_import:
        render_import_tab()

render_bottom_bar(st.session_state.base_df)
