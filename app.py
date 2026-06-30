from __future__ import annotations

from datetime import datetime

import pandas as pd
import streamlit as st

from excelbase_core import (
    PRESETS,
    ReadResult,
    dataframe_to_csv,
    dataframe_to_xlsx,
    merge_results,
    read_file_bytes,
)
from operation_helpers import (
    META_FIELDS,
    apply_filters,
    editable_fields,
    filter_tag_fields,
    operation_card_view,
    unique_tag_values,
)

APP_VERSION = "3.0.0"

st.set_page_config(
    page_title="Operasyon Merkezi",
    page_icon="⚓",
    layout="wide",
    initial_sidebar_state="collapsed",
)

APP_CSS = """
<style>
:root {
  --bg: #eef2ff;
  --surface: #ffffff;
  --line: #e2e8f0;
  --muted: #64748b;
  --ink: #0f172a;
  --brand: #4f46e5;
  --brand-soft: #eef2ff;
  --ok: #059669;
  --ok-soft: #ecfdf5;
  --wait-soft: #fffbeb;
  --wait: #b45309;
  --danger-soft: #fef2f2;
  --danger: #dc2626;
}

html, body, [class*="css"] {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
}

.stApp {
  background:
    radial-gradient(900px 380px at 0% -5%, rgba(79, 70, 229, 0.12), transparent 55%),
    radial-gradient(700px 320px at 100% 0%, rgba(14, 165, 233, 0.08), transparent 50%),
    var(--bg);
}

.block-container {
  padding-top: 0.75rem;
  padding-bottom: 6rem;
  max-width: 760px;
}

[data-testid="stHeader"] {
  background: rgba(238, 242, 255, 0.88);
  backdrop-filter: blur(10px);
}

.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 0.85rem;
}

.topbar-title {
  margin: 0;
  font-size: clamp(1.35rem, 4vw, 1.75rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: var(--ink);
}

.topbar-sub {
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: 0.88rem;
}

.version-pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: #3730a3;
  font-size: 0.75rem;
  font-weight: 800;
  white-space: nowrap;
}

.op-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 18px;
  padding: 0.95rem 1rem;
  margin-bottom: 0.65rem;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
}

.op-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 0.45rem;
}

.op-status {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.op-status.ok { background: var(--ok-soft); color: var(--ok); }
.op-status.wait { background: var(--wait-soft); color: var(--wait); }
.op-status.danger { background: var(--danger-soft); color: var(--danger); }
.op-status.neutral { background: #f1f5f9; color: #475569; }

.op-date {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 600;
}

.op-title {
  font-size: 1.02rem;
  font-weight: 800;
  color: var(--ink);
  margin-bottom: 0.2rem;
}

.op-sub {
  color: var(--muted);
  font-size: 0.86rem;
  line-height: 1.4;
  margin-bottom: 0.55rem;
}

.op-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.op-tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 9px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #334155;
  font-size: 0.72rem;
  font-weight: 700;
}

.op-meta {
  margin-top: 0.55rem;
  color: #94a3b8;
  font-size: 0.72rem;
}

.op-amount {
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--brand);
}

.import-box {
  background: linear-gradient(180deg, #ffffff 0%, #f8faff 100%);
  border: 1px dashed rgba(79, 70, 229, 0.28);
  border-radius: 18px;
  padding: 0.35rem 0.35rem 0.75rem;
}

.stTextInput input, .stSelectbox div[data-baseweb="select"] > div {
  border-radius: 12px !important;
  min-height: 44px;
}

.stButton > button, .stDownloadButton > button {
  border-radius: 12px !important;
  min-height: 44px;
  font-weight: 700 !important;
}

.stDownloadButton > button[kind="primary"] {
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%) !important;
  color: #fff !important;
  border: none !important;
}

.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  padding: 0.65rem 0.85rem calc(0.65rem + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--line);
  box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.08);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 0.75rem;
}

.detail-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--ink);
}

.field-label {
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 0.15rem;
}

@media (min-width: 900px) {
  .block-container { max-width: 980px; }
}
</style>
"""

st.markdown(APP_CSS, unsafe_allow_html=True)


def init_state() -> None:
    defaults = {
        "base_df": pd.DataFrame(),
        "last_signature": "",
        "read_log": [],
        "errors": [],
        "loaded_files": [],
        "selected_idx": None,
        "tag_filters": {},
        "active_tab": "Operasyonlar",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def uploaded_signature(files, mode: str) -> str:
    if not files:
        return f"{mode}:empty"
    parts = [f"{f.name}:{getattr(f, 'size', 0)}" for f in files]
    return mode + "|" + "|".join(parts)


def process_uploads(files, mode: str, append_mode: bool) -> None:
    results: list[ReadResult] = []
    log: list[str] = []
    errors: list[str] = []

    for file in files or []:
        try:
            raw = file.getvalue()
            file_results = read_file_bytes(file.name, raw)
            for r in file_results:
                results.append(r)
                log.append(f"✓ Kaynak: {r.file_name} / {r.sheet_name} → {r.rows} operasyon")
        except Exception as exc:
            errors.append(f"✕ {file.name}: {exc}")

    merged = merge_results(results, mode)
    if append_mode and not st.session_state.base_df.empty and not merged.empty:
        st.session_state.base_df = pd.concat([st.session_state.base_df, merged], ignore_index=True).fillna("")
    elif not merged.empty:
        st.session_state.base_df = merged
    elif not append_mode:
        st.session_state.base_df = pd.DataFrame()

    st.session_state.read_log = log
    st.session_state.errors = errors
    st.session_state.loaded_files = [f.name for f in files or []]
    st.session_state.selected_idx = None
    st.session_state.tag_filters = {}


def make_demo() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "Satış Tarihi": "2026-06-30",
                "Yolcu Adı Soyadı": "Ayşe Demir",
                "Hat": "Seferihisar - Samos",
                "Sefer Tarihi": "2026-07-04",
                "PNR / Bilet No": "PNR1001",
                "Satış Kanalı": "Çağrı Merkezi",
                "Acente": "Merkez",
                "Tutar": 55,
                "Para Birimi": "EUR",
                "Durum": "Onaylandı",
                "Kaynak Dosya": "demo.xlsx",
                "Sayfa": "Satışlar",
            },
            {
                "Satış Tarihi": "2026-06-30",
                "Yolcu Adı Soyadı": "Mehmet Kaya",
                "Hat": "Seferihisar - Samos",
                "Sefer Tarihi": "2026-07-05",
                "PNR / Bilet No": "PNR1002",
                "Satış Kanalı": "Ferryhopper",
                "Acente": "Yabancı Acente",
                "Tutar": 61,
                "Para Birimi": "EUR",
                "Durum": "Bekliyor",
                "Kaynak Dosya": "demo.xlsx",
                "Sayfa": "Satışlar",
            },
            {
                "Satış Tarihi": "2026-06-29",
                "Yolcu Adı Soyadı": "Zeynep Ak",
                "Hat": "Kuşadası - Samos",
                "Sefer Tarihi": "2026-07-06",
                "PNR / Bilet No": "PNR1003",
                "Satış Kanalı": "Web",
                "Acente": "Merkez",
                "Tutar": 48,
                "Para Birimi": "EUR",
                "Durum": "İptal",
                "Kaynak Dosya": "demo.xlsx",
                "Sayfa": "Satışlar",
            },
        ]
    )


def render_topbar() -> None:
    st.markdown(
        f"""
        <div class="topbar">
          <div>
            <p class="topbar-title">Operasyon Merkezi</p>
            <p class="topbar-sub">Excel satırı → operasyon kartı · Kaynak import → canlı tablo</p>
          </div>
          <span class="version-pill">v{APP_VERSION}</span>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_operation_card(idx: int, row: pd.Series, columns: list[str]) -> None:
    card = operation_card_view(row, columns)
    status_label = card["status"] or "Durum yok"
    status_class = card["status_tone"]
    date_label = card["date"] or "—"
    subtitle = card["subtitle"] or "Detay için karta dokun"
    amount = f'{card["amount"]} {card["currency"]}'.strip() if card["amount"] else ""

    tags_html = "".join(
        f'<span class="op-tag">{t["value"]}</span>' for t in card["tags"]
    ) or '<span class="op-tag">Etiket yok</span>'

    meta = " · ".join(x for x in [card["source"], card["sheet"]] if x)

    st.markdown(
        f"""
        <div class="op-card">
          <div class="op-card-top">
            <span class="op-status {status_class}">{status_label}</span>
            <span class="op-date">{date_label}</span>
          </div>
          <div class="op-title">{card["title"]}</div>
          <div class="op-sub">{subtitle}</div>
          <div class="op-tags">{tags_html}</div>
          <div class="op-meta">{meta}</div>
          {"<div class='op-amount'>" + amount + "</div>" if amount else ""}
        </div>
        """,
        unsafe_allow_html=True,
    )
    if st.button("Detay & düzenle", key=f"open_card_{idx}", use_container_width=True):
        st.session_state.selected_idx = idx
        st.rerun()


def render_detail_view(base_df: pd.DataFrame) -> None:
    idx = st.session_state.selected_idx
    if idx is None or idx not in base_df.index:
        st.session_state.selected_idx = None
        st.rerun()
        return

    row = base_df.loc[idx]
    columns = list(base_df.columns)
    card = operation_card_view(row, columns)

    if st.button("← Operasyonlara dön", use_container_width=False):
        st.session_state.selected_idx = None
        st.rerun()

    st.markdown(
        f"""
        <div class="detail-head">
          <div>
            <p class="detail-title">{card["title"]}</p>
            <p class="topbar-sub">{card["subtitle"] or "Standart alanları düzenle"}</p>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    with st.form("operation_detail_form", border=True):
        st.caption("Standart alanlar")
        updates: dict[str, str] = {}
        for field in editable_fields(columns):
            updates[field] = st.text_input(field, value=str(row.get(field, "") or ""), key=f"field_{idx}_{field}")

        if "Kaynak Dosya" in columns or "Sayfa" in columns:
            st.divider()
            st.caption("Kaynak bilgisi")
            if "Kaynak Dosya" in columns:
                st.text_input("Kaynak Dosya", value=str(row.get("Kaynak Dosya", "") or ""), disabled=True)
            if "Sayfa" in columns:
                st.text_input("Sayfa", value=str(row.get("Sayfa", "") or ""), disabled=True)

        save_col, delete_col = st.columns(2)
        saved = save_col.form_submit_button("Kaydet", use_container_width=True, type="primary")
        delete = delete_col.form_submit_button("Sil", use_container_width=True)

    if saved:
        for field, value in updates.items():
            st.session_state.base_df.at[idx, field] = value
        st.session_state.selected_idx = None
        st.toast("Operasyon güncellendi", icon="✅")
        st.rerun()

    if delete:
        st.session_state.base_df = st.session_state.base_df.drop(index=idx).reset_index(drop=True)
        st.session_state.selected_idx = None
        st.toast("Operasyon silindi", icon="🗑️")
        st.rerun()


def render_import_tab(mode_key: str) -> str:
    st.markdown('<div class="import-box">', unsafe_allow_html=True)
    st.subheader("Kaynak Import")
    st.caption("Excel dosyası yükle → her satır operasyon kartına dönüşür.")
    mode = st.selectbox("Standart alan şablonu", list(PRESETS.keys()), key=mode_key)
    append_mode = st.toggle("Mevcut operasyonlara ekle", value=False, key=f"{mode_key}_append")
    files = st.file_uploader(
        "Excel / CSV kaynakları",
        type=["xlsx", "xls", "xlsm", "ods", "csv"],
        accept_multiple_files=True,
        key=f"{mode_key}_files",
    )
    st.markdown("</div>", unsafe_allow_html=True)

    sig = uploaded_signature(files, mode)
    if files and sig != st.session_state.last_signature:
        process_uploads(files, mode, append_mode)
        st.session_state.last_signature = sig
        st.rerun()

    btn1, btn2 = st.columns(2)
    with btn1:
        if st.button("Demo operasyonlar", use_container_width=True):
            st.session_state.base_df = make_demo()
            st.session_state.read_log = ["✓ Demo kaynak yüklendi: 3 operasyon"]
            st.session_state.errors = []
            st.session_state.loaded_files = ["demo.xlsx"]
            st.session_state.selected_idx = None
            st.rerun()
    with btn2:
        if st.button("Tümünü temizle", use_container_width=True):
            st.session_state.base_df = pd.DataFrame()
            st.session_state.last_signature = ""
            st.session_state.read_log = []
            st.session_state.errors = []
            st.session_state.loaded_files = []
            st.session_state.selected_idx = None
            st.session_state.tag_filters = {}
            st.rerun()

    if st.session_state.read_log:
        for item in st.session_state.read_log[:5]:
            st.success(item)
    if st.session_state.errors:
        for item in st.session_state.errors:
            st.error(item)

    return mode


def render_operations_tab(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        st.info("Henüz operasyon yok. **Kaynak Import** sekmesinden Excel yükle veya Demo operasyonları aç.")
        return

    columns = list(base_df.columns)
    search = st.text_input("Ara", placeholder="İsim, hat, PNR, acente…", label_visibility="collapsed")

    tag_fields = filter_tag_fields(base_df)
    if tag_fields:
        st.caption("Modern etiket filtreleri")
        for field in tag_fields:
            options = ["Tümü"] + unique_tag_values(base_df, field)
            current = st.session_state.tag_filters.get(field) or "Tümü"
            if len(options) <= 5:
                try:
                    index = options.index(current) if current in options else 0
                except ValueError:
                    index = 0
                choice = st.segmented_control(
                    field,
                    options=options,
                    default=options[index],
                    key=f"tag_filter_{field}",
                )
            else:
                choice = st.selectbox(
                    field,
                    options=options,
                    index=options.index(current) if current in options else 0,
                    key=f"tag_filter_{field}",
                )
            st.session_state.tag_filters[field] = None if choice in (None, "Tümü") else choice

    active_filters = {k: v for k, v in st.session_state.tag_filters.items() if v}
    view_df = apply_filters(base_df, search, active_filters)

    m1, m2, m3 = st.columns(3)
    m1.metric("Operasyon", len(view_df))
    m2.metric("Kaynak", len(st.session_state.loaded_files))
    m3.metric("Filtre", len(active_filters))

    if view_df.empty:
        st.warning("Filtreye uyan operasyon bulunamadı.")
        return

    st.caption(f"{len(view_df)} operasyon kartı")

    for idx, row in view_df.iterrows():
        render_operation_card(int(idx), row, columns)


def render_bottom_bar(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        return
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    st.markdown('<div class="bottom-bar">', unsafe_allow_html=True)
    c1, c2 = st.columns(2)
    with c1:
        st.download_button(
            "Excel indir",
            data=dataframe_to_xlsx(base_df),
            file_name=f"operasyonlar-{stamp}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            type="primary",
            key="bottom_xlsx",
        )
    with c2:
        st.download_button(
            "CSV indir",
            data=dataframe_to_csv(base_df),
            file_name=f"operasyonlar-{stamp}.csv",
            mime="text/csv",
            use_container_width=True,
            key="bottom_csv",
        )
    st.markdown("</div>", unsafe_allow_html=True)


init_state()
render_topbar()

base_df = st.session_state.base_df.copy()
if not base_df.empty:
    base_df = base_df.reset_index(drop=True)
    st.session_state.base_df = base_df

if st.session_state.selected_idx is not None and not base_df.empty:
    render_detail_view(st.session_state.base_df)
else:
    tab_ops, tab_import = st.tabs(["Operasyonlar", "Kaynak Import"])
    with tab_import:
        render_import_tab("import_main")
    with tab_ops:
        render_operations_tab(st.session_state.base_df)

render_bottom_bar(st.session_state.base_df)
