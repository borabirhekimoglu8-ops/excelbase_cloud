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

APP_VERSION = "2.1.0"

st.set_page_config(
    page_title="ExcelBase",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="collapsed",
)

APP_CSS = """
<style>
:root {
  --bg: #f4f6fb;
  --surface: #ffffff;
  --surface-soft: #f8fafc;
  --line: #e2e8f0;
  --muted: #64748b;
  --ink: #0f172a;
  --brand: #4f46e5;
  --brand-soft: #eef2ff;
  --brand-dark: #3730a3;
  --ok: #059669;
  --ok-soft: #ecfdf5;
  --warn: #d97706;
  --warn-soft: #fffbeb;
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.05);
  --shadow-md: 0 8px 24px rgba(15, 23, 42, 0.07);
  --shadow-lg: 0 18px 40px rgba(15, 23, 42, 0.08);
  --radius: 18px;
  --radius-sm: 12px;
}

html, body, [class*="css"] {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif !important;
}

.stApp {
  background:
    radial-gradient(900px 420px at 0% -10%, rgba(79, 70, 229, 0.10), transparent 55%),
    radial-gradient(700px 360px at 100% 0%, rgba(14, 165, 233, 0.08), transparent 50%),
    var(--bg);
}

.block-container {
  padding-top: 1rem;
  padding-bottom: 5.5rem;
  max-width: 1280px;
}

[data-testid="stSidebar"] {
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-right: 1px solid var(--line);
  box-shadow: 8px 0 24px rgba(15, 23, 42, 0.04);
}

[data-testid="stSidebar"] .block-container {
  padding-top: 1.25rem;
}

[data-testid="stHeader"] {
  background: rgba(244, 246, 251, 0.82);
  backdrop-filter: blur(10px);
}

.hero {
  background: linear-gradient(135deg, #ffffff 0%, #f8faff 52%, #eef2ff 100%);
  border: 1px solid rgba(79, 70, 229, 0.12);
  border-radius: 24px;
  padding: 1.25rem 1.35rem 1.15rem;
  box-shadow: var(--shadow-md);
  margin-bottom: 1rem;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin-bottom: 0.55rem;
}

.app-title {
  font-size: clamp(1.65rem, 4vw, 2.15rem);
  font-weight: 800;
  letter-spacing: -0.045em;
  margin: 0;
  color: var(--ink);
  line-height: 1.1;
}

.app-subtitle {
  color: var(--muted);
  margin: 0.45rem 0 0;
  font-size: clamp(0.92rem, 2.5vw, 1rem);
  line-height: 1.5;
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.1rem;
  box-shadow: var(--shadow-sm);
  margin-bottom: 0.75rem;
}

.card-title {
  font-size: 0.98rem;
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 0.2rem;
}

.card-desc {
  color: var(--muted);
  font-size: 0.88rem;
  margin: 0;
  line-height: 1.45;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0.35rem 0 0.85rem;
}

.section-title {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--ink);
  margin: 0;
  letter-spacing: -0.02em;
}

.section-hint {
  color: var(--muted);
  font-size: 0.82rem;
  margin: 0;
}

.metric-grid [data-testid="stMetric"] {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 0.85rem 0.95rem;
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.metric-grid [data-testid="stMetric"]:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.metric-grid [data-testid="stMetricLabel"] {
  color: var(--muted) !important;
  font-size: 0.78rem !important;
  font-weight: 600 !important;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.metric-grid [data-testid="stMetricValue"] {
  color: var(--ink) !important;
  font-weight: 800 !important;
  font-size: 1.45rem !important;
}

.table-shell {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 0.35rem;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.table-shell-caption {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0.55rem 0.75rem 0.35rem;
  color: var(--muted);
  font-size: 0.82rem;
}

.table-scroll-hint {
  display: none;
  margin: 0 0 0.65rem;
  padding: 0.55rem 0.75rem;
  border-radius: 12px;
  background: var(--brand-soft);
  color: var(--brand-dark);
  font-size: 0.82rem;
  font-weight: 600;
}

div[data-testid="stDataFrame"],
div[data-testid="stDataEditor"] {
  border-radius: 16px !important;
  overflow: hidden;
}

div[data-testid="stDataFrame"] > div,
div[data-testid="stDataEditor"] > div {
  border-radius: 16px !important;
}

.stTextInput input {
  border-radius: 12px !important;
  border: 1px solid var(--line) !important;
  min-height: 44px;
  background: var(--surface-soft) !important;
}

.stTextInput input:focus {
  border-color: rgba(79, 70, 229, 0.45) !important;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12) !important;
}

.stButton > button,
.stDownloadButton > button {
  border-radius: 12px !important;
  font-weight: 700 !important;
  min-height: 44px;
  border: 1px solid var(--line) !important;
  background: var(--surface) !important;
  color: var(--ink) !important;
  transition: all 0.15s ease !important;
}

.stDownloadButton > button {
  background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%) !important;
  color: #fff !important;
  border: none !important;
  box-shadow: 0 8px 18px rgba(79, 70, 229, 0.25) !important;
}

.stDownloadButton > button:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px rgba(79, 70, 229, 0.28) !important;
}

.stButton > button:hover {
  border-color: rgba(79, 70, 229, 0.25) !important;
  background: #fafbff !important;
}

[data-testid="stFileUploader"] section {
  border-radius: 16px !important;
  border: 1.5px dashed rgba(79, 70, 229, 0.28) !important;
  background: #fafbff !important;
  padding: 0.35rem !important;
}

[data-testid="stFileUploader"] section:hover {
  border-color: rgba(79, 70, 229, 0.55) !important;
  background: #f5f7ff !important;
}

.log-item-ok,
.log-item-info {
  border-radius: 12px;
  padding: 0.55rem 0.75rem;
  margin-bottom: 0.45rem;
  font-size: 0.88rem;
  font-weight: 600;
}

.log-item-ok {
  background: var(--ok-soft);
  color: #047857;
  border: 1px solid rgba(5, 150, 105, 0.15);
}

.log-item-info {
  background: var(--brand-soft);
  color: var(--brand-dark);
  border: 1px solid rgba(79, 70, 229, 0.12);
}

.empty-state {
  text-align: center;
  padding: 2.2rem 1rem 2rem;
  border-radius: 20px;
  border: 1px dashed rgba(100, 116, 139, 0.35);
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}

.empty-icon {
  font-size: 2.2rem;
  margin-bottom: 0.35rem;
}

.empty-title {
  font-size: 1rem;
  font-weight: 800;
  color: var(--ink);
  margin: 0;
}

.empty-desc {
  color: var(--muted);
  font-size: 0.9rem;
  margin: 0.35rem 0 0;
}

.mobile-actions {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  padding: 0.65rem 0.85rem calc(0.65rem + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--line);
  box-shadow: 0 -8px 24px rgba(15, 23, 42, 0.08);
}

.sidebar-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 0.35rem;
}

@media (max-width: 768px) {
  .block-container {
    padding-top: 0.65rem;
    padding-left: 0.85rem;
    padding-right: 0.85rem;
  }

  .hero {
    border-radius: 18px;
    padding: 1rem;
  }

  .table-scroll-hint {
    display: block;
  }

  .mobile-actions {
    display: block;
  }

  .desktop-actions {
    display: none;
  }

  div[data-testid="column"] {
    min-width: 0 !important;
  }

  .metric-grid [data-testid="stMetricValue"] {
    font-size: 1.2rem !important;
  }
}

@media (min-width: 769px) {
  .mobile-actions {
    display: none !important;
  }
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
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def uploaded_signature(files, mode: str) -> str:
    if not files:
        return f"{mode}:empty"
    parts = []
    for f in files:
        parts.append(f"{f.name}:{getattr(f, 'size', 0)}")
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
                log.append(f"✓ {r.file_name} / {r.sheet_name}: {r.rows} satır, {r.columns} kolon")
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
        ]
    )


def render_hero() -> None:
    with st.container(border=True):
        badge_cols = st.columns([1, 3])
        with badge_cols[0]:
            st.markdown(f"**v{APP_VERSION}**")
        with badge_cols[1]:
            st.caption("Mobil uyumlu · Excel & CSV")
        st.title("ExcelBase")
        st.markdown(
            "Excel yükle, tek tabloda birleştir, telefondan düzenle ve indir. "
            "Sol üstteki **☰** menüsünden dosya seç."
        )


def render_log_item(text: str, kind: str = "ok") -> None:
    css_class = "log-item-info" if kind == "info" else "log-item-ok"
    st.markdown(f'<div class="{css_class}">{text}</div>', unsafe_allow_html=True)


init_state()
render_hero()

with st.sidebar:
    st.markdown(f"### ExcelBase `{APP_VERSION}`")
    st.markdown('<p class="sidebar-label">Yükleme</p>', unsafe_allow_html=True)
    mode = st.selectbox("Tablo modu", list(PRESETS.keys()), index=0, label_visibility="collapsed")
    append_mode = st.toggle("Yeni yüklemeleri mevcut tabloya ekle", value=False)
    files = st.file_uploader(
        "Excel / CSV seç",
        type=["xlsx", "xls", "xlsm", "ods", "csv"],
        accept_multiple_files=True,
        help="Birden fazla dosya seçebilirsin. Her sayfa okunur ve tek tabloya eklenir.",
    )

    sig = uploaded_signature(files, mode)
    if files and sig != st.session_state.last_signature:
        process_uploads(files, mode, append_mode)
        st.session_state.last_signature = sig
        st.rerun()

    st.divider()
    btn_a, btn_b = st.columns(2)
    with btn_a:
        if st.button("Demo", use_container_width=True, help="Örnek tabloyu aç"):
            st.session_state.base_df = make_demo()
            st.session_state.read_log = ["✓ Demo tablo açıldı: 2 satır, 12 kolon"]
            st.session_state.errors = []
            st.rerun()
    with btn_b:
        if st.button("Sıfırla", use_container_width=True, help="Tabloyu temizle"):
            st.session_state.base_df = pd.DataFrame()
            st.session_state.last_signature = ""
            st.session_state.read_log = []
            st.session_state.errors = []
            st.session_state.loaded_files = []
            st.rerun()

    st.divider()
    st.caption("Varsayılan mod Excel başlıklarını aynen alır. Diğer modlar kolonları otomatik eşleştirir.")

log_col, action_col = st.columns([1.15, 0.85])
with log_col:
    with st.container(border=True):
        st.subheader("Durum")
        st.caption("Yükleme sonucu ve hata kaydı.")
        if st.session_state.read_log:
            for item in st.session_state.read_log[:6]:
                render_log_item(item)
            if len(st.session_state.read_log) > 6:
                render_log_item(f"+ {len(st.session_state.read_log) - 6} sayfa daha okundu.", kind="info")
        elif st.session_state.base_df.empty:
            st.info("Henüz dosya yok. ☰ menüsünden Excel/CSV yükle veya Demo’ya bas.")
        if st.session_state.errors:
            for item in st.session_state.errors:
                st.error(item)

with action_col:
    st.markdown('<div class="desktop-actions">', unsafe_allow_html=True)
    with st.container(border=True):
        st.subheader("Çıktı")
        st.caption("Düzenledikten sonra indir.")
        if not st.session_state.base_df.empty:
            stamp = datetime.now().strftime("%Y%m%d-%H%M")
            st.download_button(
                "⬇ Excel indir",
                data=dataframe_to_xlsx(st.session_state.base_df),
                file_name=f"excelbase-{stamp}.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True,
            )
            st.download_button(
                "⬇ CSV indir",
                data=dataframe_to_csv(st.session_state.base_df),
                file_name=f"excelbase-{stamp}.csv",
                mime="text/csv",
                use_container_width=True,
                type="secondary",
            )
        else:
            st.button("⬇ Excel indir", disabled=True, use_container_width=True)
            st.button("⬇ CSV indir", disabled=True, use_container_width=True)
    st.markdown("</div>", unsafe_allow_html=True)

base_df = st.session_state.base_df.copy()

st.markdown('<div class="metric-grid">', unsafe_allow_html=True)
with st.container(border=True):
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Satır", len(base_df))
    m2.metric("Kolon", len(base_df.columns))
    m3.metric("Dosya", len(st.session_state.loaded_files))
    m4.metric("Hata", len(st.session_state.errors))
st.markdown("</div>", unsafe_allow_html=True)

if not base_df.empty:
    with st.container(border=True):
        st.subheader("Tablo")
        st.caption("Hücrelere dokunarak düzenle · Mobilde yatay kaydır")

        search = st.text_input("Ara", placeholder="İsim, hat, acente, PNR…", label_visibility="collapsed")

        tool_a, tool_b = st.columns(2)
        with tool_a:
            if st.button("Tekrarlı satırları sil", use_container_width=True):
                st.session_state.base_df = st.session_state.base_df.drop_duplicates().reset_index(drop=True)
                st.rerun()
            if st.button("Boş satırları sil", use_container_width=True):
                st.session_state.base_df = (
                    st.session_state.base_df.replace("", pd.NA).dropna(how="all").fillna("").reset_index(drop=True)
                )
                st.rerun()
        with tool_b:
            if st.button("Boş satır ekle", use_container_width=True):
                empty = pd.DataFrame([{c: "" for c in st.session_state.base_df.columns}])
                st.session_state.base_df = pd.concat([st.session_state.base_df, empty], ignore_index=True)
                st.rerun()

        view_df = base_df
        if search:
            mask = view_df.apply(lambda row: row.astype(str).str.contains(search, case=False, na=False).any(), axis=1)
            view_df = view_df.loc[mask]
            st.caption(f"Arama: {len(view_df)} satır gösteriliyor. Aramayı temizleyince tüm tablo düzenlenir.")

        st.markdown(
            '<p class="table-scroll-hint">↔ Mobilde tabloyu yatay kaydırabilirsin.</p>',
            unsafe_allow_html=True,
        )
        st.markdown('<div class="table-shell">', unsafe_allow_html=True)

        table_height = 520 if len(base_df) > 8 else 380

        if search:
            st.dataframe(view_df, use_container_width=True, height=table_height, hide_index=True)
        else:
            edited = st.data_editor(
                base_df,
                use_container_width=True,
                height=table_height,
                num_rows="dynamic",
                hide_index=True,
                key="main_editor",
            )
            st.session_state.base_df = edited

        st.markdown("</div>", unsafe_allow_html=True)

    if not st.session_state.base_df.empty:
        stamp = datetime.now().strftime("%Y%m%d-%H%M")
        st.markdown('<div class="mobile-actions">', unsafe_allow_html=True)
        dl1, dl2 = st.columns(2)
        with dl1:
            st.download_button(
                "Excel",
                data=dataframe_to_xlsx(st.session_state.base_df),
                file_name=f"excelbase-{stamp}.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True,
                key="mobile_xlsx",
            )
        with dl2:
            st.download_button(
                "CSV",
                data=dataframe_to_csv(st.session_state.base_df),
                file_name=f"excelbase-{stamp}.csv",
                mime="text/csv",
                use_container_width=True,
                key="mobile_csv",
            )
        st.markdown("</div>", unsafe_allow_html=True)
else:
    with st.container(border=True):
        st.subheader("Henüz tablo yok")
        st.markdown("Sol üstteki **☰** menüsünden Excel/CSV yükle veya sidebar’daki **Demo** ile başla.")
