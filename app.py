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

APP_VERSION = "3.5.1"

st.set_page_config(
    page_title="Gate Visa PAX",
    page_icon="🛂",
    layout="wide",
    initial_sidebar_state="collapsed",
)

APP_CSS = """
<style>
:root {
  --blue: #0d5eaf;
  --blue-dark: #0a3d7a;
  --blue-soft: #e0f2fe;
  --surface: #ffffff;
  --muted: #64748b;
  --border: #dbeafe;
  --shadow: 0 10px 30px rgba(10, 61, 122, 0.10);
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

html, body, [class*="css"] {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

.stApp {
  background: linear-gradient(165deg, #dbeafe 0%, #7dd3fc 38%, #0284c7 100%);
}

.block-container {
  padding-top: 0.75rem;
  padding-bottom: 2.5rem;
  max-width: 720px;
}

[data-testid="stAppViewContainer"] > .main {
  background: transparent !important;
}

/* Sekmeler — pill stil */
.stTabs [data-baseweb="tab-list"] {
  gap: 6px;
  background: rgba(255,255,255,0.55);
  border-radius: 14px;
  padding: 4px;
  border: 1px solid rgba(255,255,255,0.8);
}
.stTabs [data-baseweb="tab"] {
  border-radius: 10px !important;
  background: transparent !important;
  color: var(--blue-dark) !important;
  font-weight: 700 !important;
  padding: 8px 16px !important;
  border: none !important;
}
.stTabs [aria-selected="true"] {
  background: #fff !important;
  color: var(--blue) !important;
  box-shadow: 0 2px 8px rgba(13, 94, 175, 0.12) !important;
}
.stTabs [data-baseweb="tab-panel"] { padding-top: 0.85rem; }

div[data-testid="stMetric"] {
  background: var(--surface) !important;
  border: 1px solid var(--border) !important;
  border-radius: 14px !important;
  padding: 10px 12px !important;
  box-shadow: var(--shadow);
}
div[data-testid="stMetricLabel"] {
  color: var(--muted) !important;
  font-size: 0.7rem !important;
  font-weight: 700 !important;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
div[data-testid="stMetricValue"] { color: var(--blue-dark) !important; font-weight: 800 !important; }

.stTextInput input, .stSelectbox div[data-baseweb="select"] > div {
  background: #fff !important;
  border: 1px solid var(--border) !important;
  border-radius: 12px !important;
  min-height: 46px;
  box-shadow: 0 2px 6px rgba(13, 94, 175, 0.04);
}
.stTextInput input:focus {
  border-color: var(--blue) !important;
  box-shadow: 0 0 0 3px rgba(13, 94, 175, 0.12) !important;
}

.stButton > button {
  border-radius: 12px !important;
  min-height: 46px;
  font-weight: 700 !important;
  border: 1px solid var(--border) !important;
}
.stDownloadButton > button[kind="primary"], .stButton > button[kind="primary"] {
  background: var(--blue) !important;
  color: #fff !important;
  border: none !important;
  box-shadow: 0 4px 14px rgba(13, 94, 175, 0.28) !important;
}

[data-testid="stFileUploader"] section {
  background: #fff !important;
  border: 2px dashed #93c5fd !important;
  border-radius: 14px !important;
}

div[data-testid="stExpander"],
div[data-testid="stForm"] {
  background: #fff !important;
  border: 1px solid var(--border) !important;
  border-radius: 14px !important;
  box-shadow: var(--shadow);
}

.app-hero {
  background: #fff;
  border-radius: 18px;
  padding: 1.1rem 1.15rem;
  margin-bottom: 0.85rem;
  box-shadow: var(--shadow);
  border: 1px solid #fff;
}
.app-title {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 800;
  color: var(--blue-dark);
  letter-spacing: -0.02em;
}
.app-sub {
  margin: 0.3rem 0 0;
  color: var(--muted);
  font-size: 0.86rem;
}

.pax-card {
  background: #fff;
  border-radius: 16px;
  padding: 0.95rem 1rem;
  margin-bottom: 0.6rem;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}
.pax-card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
.pax-no {
  font-size: 0.7rem; font-weight: 800; padding: 3px 9px; border-radius: 999px;
  background: var(--blue-soft); color: var(--blue);
}
.pax-date { font-size: 0.76rem; color: var(--muted); font-weight: 600; }
.pax-name { font-size: 1.02rem; font-weight: 800; color: var(--blue-dark); margin-bottom: 0.15rem; }
.pax-line { font-size: 0.82rem; color: var(--muted); line-height: 1.4; margin-bottom: 0.45rem; }
.pax-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.pax-tag {
  font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 999px;
  background: #f0f9ff; color: var(--blue);
}
.pax-fee { margin-top: 0.35rem; font-size: 0.84rem; font-weight: 700; color: var(--blue); }
.pax-meta { margin-top: 0.35rem; font-size: 0.65rem; color: #94a3b8; }

.app-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 0.9rem 1rem;
  margin-bottom: 0.75rem;
  box-shadow: var(--shadow);
}
.app-panel-title { margin: 0; font-weight: 800; color: var(--blue-dark); font-size: 0.95rem; }
.app-panel-sub { margin: 0.2rem 0 0; font-size: 0.8rem; color: var(--muted); }

.filter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0.5rem 0; }
.filter-chip {
  padding: 4px 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 700;
  background: var(--blue-soft); color: var(--blue-dark);
}

.format-box {
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.65rem 0.75rem;
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.5;
  margin-top: 0.5rem;
}

.section-label {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0.5rem 0 0.35rem;
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


def render_passenger_card(idx: int, row: pd.Series) -> None:
    card = passenger_card_view(row)
    tags_html = "".join(f'<span class="pax-tag">{t["label"]}: {t["value"]}</span>' for t in card["tags"])
    meta = " · ".join(x for x in [card["source"], card["sheet"]] if x)

    st.markdown(
        f"""
        <div class="pax-card">
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
        """,
        unsafe_allow_html=True,
    )
    if st.button("Detay", key=f"open_card_{idx}", use_container_width=True):
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
          <p class="app-panel-title">{card["title"]}</p>
          <p class="app-panel-sub">{card["subtitle"]}</p>
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
        <div class="app-panel">
          <p class="app-panel-title">Import</p>
          <p class="app-panel-sub">{TEMPLATE_NAME} şablonu</p>
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
    tab_passengers, tab_import = st.tabs(["Yolcu Kartları", "Import"])
    with tab_passengers:
        render_passengers_tab(st.session_state.base_df)
    with tab_import:
        render_import_tab()

render_bottom_bar(st.session_state.base_df)
