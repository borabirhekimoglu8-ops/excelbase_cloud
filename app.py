from __future__ import annotations

from datetime import datetime

import pandas as pd
import streamlit as st

from excelbase_core import (
    DEFAULT_PRESET,
    PRESETS,
    ReadResult,
    dataframe_to_csv,
    dataframe_to_xlsx,
    merge_results,
    read_file_bytes,
)

st.set_page_config(page_title="ExcelBase", page_icon="📊", layout="wide", initial_sidebar_state="expanded")

st.markdown(
    """
    <style>
    :root { --card:#ffffff; --line:#e7eaf0; --muted:#667085; --ink:#101828; --brand:#2563eb; }
    .block-container { padding-top: 1.3rem; padding-bottom: 2rem; max-width: 1420px; }
    [data-testid="stSidebar"] { background: #f8fafc; border-right: 1px solid #e5e7eb; }
    .app-title { font-size: 2.05rem; font-weight: 800; letter-spacing: -0.04em; margin: 0; color: var(--ink); }
    .app-subtitle { color: var(--muted); margin-top: .25rem; margin-bottom: 1rem; }
    .card { background: var(--card); border:1px solid var(--line); border-radius:18px; padding:16px 18px; box-shadow:0 8px 28px rgba(16,24,40,.05); margin-bottom: 12px; }
    .small-muted { color: var(--muted); font-size:.92rem; }
    .ok-pill { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:#ecfdf3; color:#027a48; font-weight:650; font-size:.86rem; }
    .warn-pill { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:999px; background:#fffaeb; color:#b54708; font-weight:650; font-size:.86rem; }
    div[data-testid="stMetric"] { background: #fff; border:1px solid #e7eaf0; border-radius:16px; padding: 12px 14px; box-shadow:0 4px 18px rgba(16,24,40,.04); }
    div[data-testid="stDataFrame"] { border-radius: 16px; overflow: hidden; }
    .stButton>button, .stDownloadButton>button { border-radius: 12px; font-weight: 700; }
    </style>
    """,
    unsafe_allow_html=True,
)


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


init_state()

st.markdown('<p class="app-title">ExcelBase</p>', unsafe_allow_html=True)
st.markdown('<p class="app-subtitle">Excel yükle · tek tabloya çevir · telefonda düzenle · Excel olarak indir</p>', unsafe_allow_html=True)

with st.sidebar:
    st.markdown("### Yükleme")
    mode = st.selectbox("Tablo modu", list(PRESETS.keys()), index=0)
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
    if st.button("Demo tabloyu aç", use_container_width=True):
        st.session_state.base_df = make_demo()
        st.session_state.read_log = ["✓ Demo tablo açıldı: 2 satır, 12 kolon"]
        st.session_state.errors = []
        st.rerun()

    if st.button("Tabloyu sıfırla", use_container_width=True):
        st.session_state.base_df = pd.DataFrame()
        st.session_state.last_signature = ""
        st.session_state.read_log = []
        st.session_state.errors = []
        st.session_state.loaded_files = []
        st.rerun()

    st.divider()
    st.markdown("### Mantık")
    st.caption("Varsayılan mod Excel başlıklarını aynen alır. Kapı Vizesi / Feribot modları kolonları otomatik eşleştirir.")

log_col, action_col = st.columns([1.2, 1])
with log_col:
    st.markdown('<div class="card"><b>Durum</b><br><span class="small-muted">Yükleme sonucu ve hata kaydı burada görünür.</span></div>', unsafe_allow_html=True)
    if st.session_state.read_log:
        for item in st.session_state.read_log[:8]:
            st.success(item)
        if len(st.session_state.read_log) > 8:
            st.info(f"+ {len(st.session_state.read_log) - 8} sayfa daha okundu.")
    elif st.session_state.base_df.empty:
        st.info("Henüz dosya yüklenmedi. Soldan Excel/CSV seç veya demo tabloyu aç.")
    if st.session_state.errors:
        for item in st.session_state.errors:
            st.error(item)

with action_col:
    st.markdown('<div class="card"><b>Çıktı</b><br><span class="small-muted">Düzenledikten sonra Excel veya CSV indir.</span></div>', unsafe_allow_html=True)
    if not st.session_state.base_df.empty:
        stamp = datetime.now().strftime("%Y%m%d-%H%M")
        st.download_button(
            "Excel indir",
            data=dataframe_to_xlsx(st.session_state.base_df),
            file_name=f"excelbase-{stamp}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
        )
        st.download_button(
            "CSV indir",
            data=dataframe_to_csv(st.session_state.base_df),
            file_name=f"excelbase-{stamp}.csv",
            mime="text/csv",
            use_container_width=True,
        )
    else:
        st.button("Excel indir", disabled=True, use_container_width=True)
        st.button("CSV indir", disabled=True, use_container_width=True)

base_df = st.session_state.base_df.copy()

m1, m2, m3, m4 = st.columns(4)
m1.metric("Satır", len(base_df))
m2.metric("Kolon", len(base_df.columns))
m3.metric("Yüklenen dosya", len(st.session_state.loaded_files))
m4.metric("Hata", len(st.session_state.errors))

if not base_df.empty:
    st.markdown("### Base")
    tools = st.columns([2, 1, 1, 1])
    search = tools[0].text_input("Ara", placeholder="İsim, hat, acente, PNR…")
    if tools[1].button("Tekrarlı satırları sil", use_container_width=True):
        st.session_state.base_df = st.session_state.base_df.drop_duplicates().reset_index(drop=True)
        st.rerun()
    if tools[2].button("Boş satırları sil", use_container_width=True):
        st.session_state.base_df = st.session_state.base_df.replace("", pd.NA).dropna(how="all").fillna("").reset_index(drop=True)
        st.rerun()
    if tools[3].button("Bir boş satır ekle", use_container_width=True):
        empty = pd.DataFrame([{c: "" for c in st.session_state.base_df.columns}])
        st.session_state.base_df = pd.concat([st.session_state.base_df, empty], ignore_index=True)
        st.rerun()

    view_df = base_df
    if search:
        mask = view_df.apply(lambda row: row.astype(str).str.contains(search, case=False, na=False).any(), axis=1)
        view_df = view_df.loc[mask]
        st.caption(f"Arama görünümü: {len(view_df)} satır. Aramayı temizleyince tüm tablo düzenlenir.")

    # Avoid losing hidden rows while filtered. Full-table editing updates base; filtered editing is read-only.
    if search:
        st.dataframe(view_df, use_container_width=True, height=560, hide_index=True)
    else:
        edited = st.data_editor(
            base_df,
            use_container_width=True,
            height=620,
            num_rows="dynamic",
            hide_index=True,
            key="main_editor",
        )
        st.session_state.base_df = edited
else:
    st.markdown("### Base")
    st.warning("Tablo yok. Sol menüden dosya yükle veya demo tabloyu aç.")
