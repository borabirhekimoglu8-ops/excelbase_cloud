from __future__ import annotations

import base64
import html
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

APP_VERSION = "5.4.0"
PAGE_SIZE = 10

_ICONS = {
    "photo": '<path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/>',
    "passport": '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="9.5" r="2.2"/><path d="M9 15.2h6M9.6 17.6h4.8"/>',
    "ticket": '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a1.6 1.6 0 0 0 0 3.2v2A2 2 0 0 1 18 17H6a2 2 0 0 1-2-2v-2a1.6 1.6 0 0 0 0-3.2z"/><path d="M14 6v12" stroke-dasharray="2.4 2.4"/>',
    "coin": '<circle cx="12" cy="12" r="8.4"/><path d="M12 8v8M9.6 9.6h3.5a1.6 1.6 0 0 1 0 3.2H10a1.6 1.6 0 0 0 0 3.2h3.9"/>',
    "calendar": '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8 3v3.4M16 3v3.4"/>',
    "check": '<path d="M5 12.5 9.5 17 19 6.5"/>',
    "warn": '<path d="M12 4 21 19H3z"/><path d="M12 10.5v4M12 17h.01"/>',
    "flag": '<path d="M6 20V4"/><path d="M6 4h11l-2.4 3.6L17 11H6"/>',
    "moon": '<path d="M20 14.5A8.4 8.4 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z"/>',
    "sun": '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.6M12 18.9v2.6M4.2 12H1.6M22.4 12h-2.6M5.4 5.4l1.8 1.8M17.6 17.6l1.8 1.8M5.4 18.6l1.8-1.8M17.6 6.4l1.8-1.8"/>',
    "grid": '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
    "stamp": '<circle cx="12" cy="9" r="5.4"/><path d="M8.6 20.5 12 14.4l3.4 6.1M6 20.5h12"/>',
    "camera_off": '<path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><path d="M3 3l18 18" stroke-width="2.2"/>',
    "box": '<path d="M4 7.5 12 3l8 4.5M4 7.5v9L12 21l8-4.5v-9M4 7.5 12 12l8-4.5M12 12v9"/>',
    "undo": '<path d="M4 8h9a6 6 0 1 1 0 12h-2"/><path d="M8 4 4 8l4 4"/>',
    "merge": '<path d="M6 4v6a4 4 0 0 0 4 4h4"/><path d="M6 4 3.5 6.5M6 4l2.5 2.5"/><circle cx="18" cy="18" r="2.3"/>',
    "printer": '<rect x="6" y="9" width="12" height="7" rx="1.2"/><path d="M7 9V4h10v5M7 16v4h10v-4"/>',
    "eye": '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>',
    "wave": '<path d="M2 12c2 -3 4 -3 6 0s4 3 6 0 4 -3 6 0"/><path d="M2 17c2 -3 4 -3 6 0s4 3 6 0 4 -3 6 0"/>',
    "pin": '<path d="M12 21s7-6.7 7-12a7 7 0 1 0-14 0c0 5.3 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/>',
    "ferry": '<path d="M4 17 3 13h18l-1 4"/><path d="M6 13V8h5V5l3 3v5"/><path d="M2 20c1.3-1.3 2.7-1.3 4 0s2.7 1.3 4 0 2.7-1.3 4 0 2.7 1.3 4 0"/>',
}


def status_palette() -> dict:
    """Kart/rozet renk paleti — renk körlüğü modunda kırmızı/yeşil yerine
    mavi/turuncu/mor gibi ayırt edilebilirliği yüksek tonlar kullanılır."""
    if st.session_state.get("colorblind_mode"):
        return {"ok": "#0f6fb3", "warn": "#f5941e", "bad": "#7c3aed"}
    return {"ok": "#0f8a4b", "warn": "#f59e0b", "bad": "#ef4444"}


def icon(name: str, size: int = 15, extra_class: str = "") -> str:
    """Küçük, hafif SVG ikon (emoji yerine tutarlı çizgi ikon seti)."""
    body = _ICONS.get(name, "")
    if not body:
        return ""
    return (
        f'<svg class="ico {extra_class}" width="{size}" height="{size}" viewBox="0 0 24 24" '
        f'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" '
        f'stroke-linejoin="round" aria-hidden="true">{body}</svg>'
    )


def mrz_line(name: str, surname: str, passport: str, country: str = "TUR") -> str:
    """Pasaport MRZ (makine okunur bölge) görünümü — gerçek kontrol basamağı içermez,
    yalnızca kart üzerinde 'gerçek pasaport' hissi veren estetik bir satırdır."""
    import re as _re

    def clean(s: str) -> str:
        return _re.sub(r"[^A-Z]", "", (s or "").upper())

    pp = _re.sub(r"[^A-Z0-9]", "", (passport or "").upper()) or "X" * 9
    line = f"{pp}<{country}<{clean(surname)}<<{clean(name)}"
    line = (line + "<" * 44)[:38]
    return line


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
  --accent: #0f6fb3;
  --accent-dark: #0c5a91;
  --accent-soft: #e6f2fb;
  --sun: #f5941e;
  --sun-dark: #d97a0a;
  --sun-soft: #fff1de;
  --ink: #102233;
  --ink-soft: #2f4356;
  --muted: #66798c;
  --bg: #eef6fb;
  --panel: #ffffff;
  --border: #d9e7f0;
  --border-soft: #e9f2f8;
  --shadow: 0 1px 2px rgba(16, 24, 40, 0.05), 0 6px 16px rgba(16, 24, 40, 0.05);
  --shadow-strong: 0 4px 10px rgba(12, 60, 94, 0.1), 0 16px 34px rgba(12, 60, 94, 0.14);

  /* Tasarım token'ları — tüm bileşenler bu ölçeklere bağlı (tutarlılık için) */
  --radius-control: 10px;
  --radius-card: 18px;
  --radius-pill: 999px;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px;
  --fs-title: 1.02rem;
  --fs-body: 0.86rem;
  --fs-sub: 0.8rem;
  --fs-label: 0.68rem;
}

* { -webkit-tap-highlight-color: transparent; }


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
p, span, label, h1, h2, h3, .pax-name, .pax-line, .brand-word, .brand-tag {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.stApp { background: var(--bg); }
[data-testid="stAppViewContainer"] > .main { background: transparent !important; }
[data-testid="stMain"], [data-testid="stAppViewContainer"] { -webkit-overflow-scrolling: touch; }
.block-container {
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(6.4rem, env(safe-area-inset-bottom));
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
  max-width: 720px;
}

/* Sekmeler — masaüstünde sade pill, iPhone'da alt navigasyon */
.stTabs [data-baseweb="tab-list"] {
  gap: 6px;
  background: var(--panel);
  border-radius: 14px;
  padding: 5px;
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
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
.stTabs [data-baseweb="tab-panel"] { padding-top: 1rem; animation: fadeIn 0.22s ease; }
.stTabs [data-baseweb="tab-list"] { -webkit-overflow-scrolling: touch; }

@media (max-width: 760px) {
  .stTabs [data-baseweb="tab-list"] {
    position: fixed;
    left: max(12px, env(safe-area-inset-left));
    right: max(12px, env(safe-area-inset-right));
    bottom: max(10px, env(safe-area-inset-bottom));
    z-index: 999;
    display: flex !important;
    overflow-x: auto;
    scrollbar-width: none;
    border-radius: 22px;
    padding: 7px;
    box-shadow: 0 12px 34px rgba(16, 24, 40, 0.18);
  }
  .stTabs [data-baseweb="tab-list"]::-webkit-scrollbar { display: none; }
  .stTabs [data-baseweb="tab"] {
    flex: 0 0 auto;
    min-width: 86px;
    min-height: 50px;
    padding: 8px 6px !important;
    justify-content: center;
    font-size: 0.8rem;
  }
  .stTabs [data-baseweb="tab"] p {
    font-size: 0.8rem !important;
    line-height: 1.1 !important;
  }
}

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
  border-radius: var(--radius-control) !important;
  min-height: 44px;
  font-weight: 700 !important;
  color: var(--ink-soft) !important;
  background: var(--panel) !important;
  border: 1px solid var(--border) !important;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.stButton > button:hover, .stDownloadButton > button:hover {
  background: var(--accent-soft) !important;
  border-color: var(--accent) !important;
  color: var(--accent-dark) !important;
}
.stButton > button:active, .stDownloadButton > button:active {
  transform: scale(0.97);
}
.stDownloadButton > button[kind="primary"], .stButton > button[kind="primary"] {
  background: var(--accent) !important;
  color: #ffffff !important;
  border: 1px solid var(--accent) !important;
  box-shadow: 0 3px 10px rgba(15, 111, 179, 0.28) !important;
}
.stDownloadButton > button[kind="primary"]:hover, .stButton > button[kind="primary"]:hover {
  background: var(--accent-dark) !important;
  color: #ffffff !important;
}

/* Dokunma hedefleri — iOS HIG (min 44px) */
[data-testid="stCheckbox"] { min-height: 44px; display: flex; align-items: center; }
[data-testid="stCheckbox"] label { min-height: 44px; display: flex; align-items: center; gap: 8px; }

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
  border-radius: var(--radius-card);
  padding: var(--sp-4) var(--sp-4);
  margin-bottom: var(--sp-4);
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  box-shadow: var(--shadow-strong);
  transition: border-left-color 0.2s ease;
}
.app-panel-lg { box-shadow: var(--shadow-strong) !important; border-width: 1.4px !important; }
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

/* PASSPORT WALLET — dijital pasaport cüzdanı */
.pax-card {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(15, 111, 179, 0.08), transparent 42%),
    linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
  border-radius: var(--radius-card);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
  border: 1px solid #dfe6f2;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 10px 26px rgba(16, 24, 40, 0.08);
  animation: cardIn 0.28s ease both;
}
@keyframes cardIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.pax-card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 5px;
  background: linear-gradient(180deg, var(--accent), var(--sun));
  z-index: 1;
}
.pax-card.warn::before { background: #f59e0b; }
.pax-card.bad::before { background: #ef4444; }
/* Holografik şerit — pasaport bio-sayfası hissi, statik (animasyonsuz) */
.pax-card::after {
  content: "";
  position: absolute; top: -30%; right: -14%; width: 46%; height: 160%;
  background: linear-gradient(115deg, transparent 32%, rgba(255,255,255,0.65) 46%,
    rgba(245, 148, 30, 0.22) 52%, rgba(15, 111, 179, 0.15) 58%, transparent 70%);
  transform: rotate(6deg);
  pointer-events: none;
  z-index: 0;
}
.pax-card-row, .pax-stamp, .wallet-row, .pax-tags, .pax-flags, .mrz-line { position: relative; z-index: 2; }
.pax-flags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 0.45rem; }
.pax-flag {
  font-size: 0.62rem; font-weight: 800; padding: 2px 8px; border-radius: 999px;
  background: #fff4e5; color: #b45309; border: 1px solid #fde4bf;
  text-transform: uppercase; letter-spacing: 0.02em;
}
.pax-flag.bad { background: #fde8e8; color: #b91c1c; border-color: #f7c5c5; }
.pax-card-row { display: flex; gap: 0.95rem; align-items: stretch; }
.pax-card-body { flex: 1; min-width: 0; }
.pax-photo {
  width: 76px; height: 98px; border-radius: 16px; object-fit: cover;
  flex-shrink: 0;
  border: 1px solid #d9e2f1;
  background: #eef3fb;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.65);
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
  font-size: 0.62rem; font-weight: 900; padding: 3px 9px; border-radius: 999px;
  background: #ecfdf5;
  color: #047857; letter-spacing: 0.06em;
  white-space: nowrap;
  text-transform: uppercase;
}
.pax-date { font-size: 0.74rem; color: var(--muted); font-weight: 700; white-space: nowrap; }
.pax-name {
  font-size: 1.08rem; font-weight: 900; color: var(--ink); margin: 0 0 0.35rem;
  line-height: 1.25;
  letter-spacing: -0.01em;
}
.wallet-row { display: flex; align-items: center; gap: 8px; margin: 0.05rem 0 0.45rem; }
.wallet-passport {
  display: inline-flex; flex-direction: column; gap: 1px;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 13px;
  padding: 7px 10px;
  min-width: 0; max-width: min(100%, 190px); flex: 1;
  overflow: hidden;
}
.wallet-passport-no { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 480px) {
  .pax-date { display: none; }
}
.wallet-passport-label {
  font-size: 0.57rem; font-weight: 900; color: #94a3b8;
  letter-spacing: 0.11em; text-transform: uppercase;
}
.wallet-passport-no {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
  font-size: 1.08rem; font-weight: 900; color: var(--accent-dark);
  letter-spacing: 0.035em;
}
.pax-line {
  font-size: 0.82rem; color: var(--muted); line-height: 1.5; margin: 0 0 0.28rem;
  display: flex; gap: 0.5rem; align-items: baseline;
}
.pax-k { flex: 0 0 96px; font-weight: 700; color: #9aa4b4; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; }
.pax-v { flex: 1; min-width: 0; color: var(--ink-soft); font-weight: 600; }
.pax-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.pax-tag {
  font-size: 0.66rem; font-weight: 800; padding: 4px 9px 4px 13px; border-radius: 7px;
  background: #eef4ff; color: #1e40af; border: 1px solid #dbeafe;
  max-width: 100%;
  clip-path: polygon(7px 0%, 100% 0%, 100% 100%, 7px 100%, 7px 62%, 0% 50%, 7px 38%);
}
.pax-tag b { color: #64748b; font-weight: 800; }
.pax-fee {
  margin-top: 0.55rem; font-size: 0.86rem; font-weight: 800; color: var(--accent-dark);
}
.pax-meta { margin-top: 0.5rem; font-size: 0.64rem; color: #9aa4b4; letter-spacing: 0.02em; }

.app-panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--sp-4) var(--sp-4);
  margin-bottom: var(--sp-3);
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
  font-size: var(--fs-label);
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
  margin: var(--sp-4) 0 var(--sp-2);
}

.cc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); margin: var(--sp-3) 0; }
.cc-card {
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius-card);
  padding: var(--sp-4); box-shadow: var(--shadow);
}
.cc-kicker { margin: 0; font-size: 0.68rem; color: var(--muted); font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em; }
.cc-value { margin: 0.18rem 0 0; font-size: 1.38rem; color: var(--ink); font-weight: 900; line-height: 1.1; }
.cc-sub { margin: 0.25rem 0 0; font-size: 0.78rem; color: var(--muted); line-height: 1.35; }
.progress-wrap { height: 12px; background: #e9eef7; border-radius: 999px; overflow: hidden; border: 1px solid #dbe3ef; }
.progress-bar { height: 100%; background: linear-gradient(90deg, #2563eb, #06b6d4); border-radius: inherit; }
.quick-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0.8rem 0; }
.quick-action {
  border: 1px solid #dbeafe; background: #f8fbff; color: var(--accent-dark);
  padding: var(--sp-3); border-radius: var(--radius-card); font-weight: 900; font-size: 0.86rem;
  min-height: 44px; display: flex; align-items: center; justify-content: center;
}
.empty-hero {
  text-align: center; background: linear-gradient(180deg, #ffffff, #f8fbff);
  border: 1px dashed #c9d7ee; border-radius: var(--radius-card); padding: 1.35rem 1rem;
  box-shadow: var(--shadow);
}
.empty-hero .big { font-size: 2.2rem; margin: 0; }
.empty-hero h3 { margin: 0.25rem 0; color: var(--ink); }
.timeline { border-left: 3px solid #dbeafe; margin: 0.8rem 0 0 0.45rem; padding-left: 0.9rem; }
.timeline-item { position: relative; margin-bottom: 0.75rem; color: var(--ink-soft); font-size: 0.82rem; }
.timeline-item::before {
  content: ""; position: absolute; left: -1.27rem; top: 0.2rem;
  width: 10px; height: 10px; border-radius: 999px; background: var(--accent);
  box-shadow: 0 0 0 4px #eaf1ff;
}
.wizard-steps { display: flex; gap: 6px; margin: 0.7rem 0 0.2rem; }
.wizard-step {
  flex: 1; text-align: center; padding: 0.45rem 0.2rem; border-radius: 999px;
  background: #eef2f7; color: #64748b; font-size: 0.68rem; font-weight: 900;
}
.wizard-step.on { background: var(--accent); color: #fff; }
.filter-sheet {
  background: #ffffff; border: 1px solid #dbeafe; border-radius: var(--radius-card);
  padding: var(--sp-3) var(--sp-4); margin: var(--sp-3) 0; box-shadow: var(--shadow);
}
.gallery-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--sp-2); }
.gallery-card {
  background: #fff; border: 1px solid var(--border); border-radius: var(--radius-card);
  padding: var(--sp-2); box-shadow: var(--shadow); min-width: 0;
}
.gallery-card img { width: 100%; aspect-ratio: 3/4; object-fit: cover; border-radius: 10px; background: var(--bg); }
.gallery-card p { margin: 0.4rem 0 0; font-size: 0.68rem; color: var(--ink-soft); font-weight: 800; line-height: 1.25; }

@media (max-width: 420px) {
  .cc-grid, .quick-actions { grid-template-columns: 1fr 1fr; }
  .gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

div[data-testid="stExpander"] summary p { color: var(--ink) !important; font-weight: 700; }
.stDataFrame { border-radius: 14px; overflow: hidden; border: 1px solid var(--border); }

/* ============ İDO DENİZ TEMASI — canlı, mavi-turuncu ============ */
.ico { vertical-align: -3px; flex-shrink: 0; }
.stApp {
  background:
    radial-gradient(circle at 1px 1px, rgba(15, 111, 179, 0.07) 1px, transparent 1px) 0 0 / 22px 22px,
    radial-gradient(ellipse 70% 45% at 82% 0%, rgba(245, 148, 30, 0.24), transparent 65%),
    radial-gradient(ellipse 90% 60% at 10% 100%, rgba(15, 111, 179, 0.22), transparent 70%),
    linear-gradient(180deg, #eaf5fb 0%, #eef6fb 40%, #e4f0f7 100%);
  background-attachment: fixed;
}
.sea-wave {
  height: 34px; margin: -1.1rem -1.3rem 0.6rem; overflow: hidden; line-height: 0;
}
.sea-wave svg { width: 100%; height: 100%; display: block; }

/* ============ Yazdırılabilir manifest ============ */
.manifest-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.manifest-table { width: 100%; min-width: 480px; border-collapse: collapse; font-size: 0.78rem; margin-top: 0.5rem; }
.manifest-table th, .manifest-table td { border: 1px solid #ccd6e2; padding: 4px 7px; text-align: left; }
.manifest-table th { background: #f1f6fb; }
.print-btn {
  margin-top: 10px; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--accent);
  background: var(--accent); color: #fff; font-weight: 700; cursor: pointer; font-size: 0.82rem;
}
@media print {
  body * { visibility: hidden; }
  .print-manifest, .print-manifest * { visibility: visible; }
  .print-manifest { position: fixed; top: 0; left: 0; width: 100%; padding: 12px; }
  .print-btn { display: none; }
  .manifest-scroll { overflow: visible; }
  .manifest-table { min-width: 0; }
}
.brand-row { display: flex; align-items: center; gap: 10px; }
.brand-badge {
  flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, var(--sun) 0%, var(--sun-dark) 78%);
  display: flex; align-items: center; justify-content: center;
  color: #fff; box-shadow: 0 3px 8px rgba(217, 122, 10, 0.35);
}
.brand-wrap { min-width: 0; }
.brand-word {
  font-size: 1.14rem; font-weight: 900; color: var(--ink); letter-spacing: -0.02em;
  line-height: 1.15; margin: 0;
}
.brand-tag {
  font-size: 0.62rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--accent-dark); margin: 1px 0 0;
}

/* Damga (stamp) — rozet */
.pax-stamp {
  position: absolute; top: 10px; right: 10px;
  display: inline-flex; align-items: center; gap: 4px;
  border: 1.6px solid currentColor; border-radius: 8px; padding: 2px 8px;
  font-size: 0.6rem; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase;
  transform: rotate(-6deg); mix-blend-mode: multiply; opacity: 0.92;
}
.pax-stamp.ok { color: #0f8a4b; }
.pax-stamp.warn { color: #b45309; }
.pax-stamp.bad { color: #c0261e; }

/* Biyometrik foto çerçevesi (viewfinder köşeleri) */
.pax-photo-frame { position: relative; flex-shrink: 0; }
.pax-photo-frame::before, .pax-photo-frame::after {
  content: ""; position: absolute; width: 12px; height: 12px; pointer-events: none;
}
.pax-photo-frame::before { top: -3px; left: -3px; border-top: 2px solid var(--accent-dark); border-left: 2px solid var(--accent-dark); border-radius: 4px 0 0 0; }
.pax-photo-frame::after { bottom: -3px; right: -3px; border-bottom: 2px solid var(--accent-dark); border-right: 2px solid var(--accent-dark); border-radius: 0 0 4px 0; }
.pax-photo-empty { position: relative; }
.pax-photo-empty .miss-tag {
  position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%);
  font-size: 0.48rem; font-weight: 900; letter-spacing: 0.05em; color: #b91c1c;
  text-transform: uppercase; white-space: nowrap;
}

/* Mini hazırlık halkası (conic-gradient — JS/animasyon yok) */
.ring {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: conic-gradient(var(--ring-color, var(--accent)) calc(var(--pct, 0) * 1%), #e7ecf5 0);
}
.ring span {
  width: 22px; height: 22px; border-radius: 50%; background: var(--panel);
  display: flex; align-items: center; justify-content: center;
  font-size: 0.52rem; font-weight: 900; color: var(--ink-soft);
}

/* MRZ satırı (pasaport makine okunur bölgesi hissi) */
.mrz-line {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
  font-size: 0.62rem; letter-spacing: 0.03em; color: #94a3b8; margin-top: 0.35rem;
  overflow: hidden; white-space: nowrap; text-overflow: clip;
  background: #f8fafc; border-radius: 6px; padding: 3px 7px; border: 1px solid var(--border-soft);
}

/* Yoğunluk ayarları */
.pax-card.density-compact { padding: 0.62rem 0.75rem; margin-bottom: 0.55rem; }
.pax-card.density-compact::after { content: none; }
.pax-card.density-compact .pax-photo, .pax-card.density-compact .pax-photo-empty { width: 58px; height: 74px; }
.pax-card.density-compact .pax-name { font-size: 0.94rem; margin-bottom: 0.2rem; }
.pax-card.density-compact .mrz-line, .pax-card.density-compact .pax-tags { display: none; }
.pax-card.density-dense { padding: 0.42rem 0.6rem; margin-bottom: 0.34rem; border-radius: 12px; }
.pax-card.density-dense::after { content: none; }
.pax-card.density-dense .pax-photo, .pax-card.density-dense .pax-photo-empty { width: 40px; height: 52px; border-radius: 9px; }
.pax-card.density-dense .pax-name { font-size: 0.84rem; margin-bottom: 0.1rem; }
.pax-card.density-dense .mrz-line, .pax-card.density-dense .pax-tags, .pax-card.density-dense .pax-flags,
.pax-card.density-dense .wallet-passport-label, .pax-card.density-dense .pax-stamp { display: none; }
.pax-card.density-dense .wallet-passport { padding: 3px 7px; margin-bottom: 0.15rem; }
.pax-card.density-dense .wallet-passport-no { font-size: 0.86rem; }

/* Boarding-pass detay görünümü */
.boarding-pass { position: relative; }
.boarding-pass .stub-divider {
  position: relative; height: 0; border-top: 2px dashed #cbd5e1; margin: 0.9rem -1.1rem;
}
.boarding-pass .stub-divider::before, .boarding-pass .stub-divider::after {
  content: ""; position: absolute; top: -9px; width: 18px; height: 18px; border-radius: 50%;
  background: var(--bg);
}
.boarding-pass .stub-divider::before { left: -9px; }
.boarding-pass .stub-divider::after { right: -9px; }
.boarding-pass-row { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.boarding-pass-field { min-width: 90px; }
.boarding-pass-field .bp-k { font-size: 0.62rem; font-weight: 800; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }
.boarding-pass-field .bp-v { font-size: 0.92rem; font-weight: 800; color: var(--ink); }

/* Contact-sheet galeri */
.gallery-card { position: relative; border: 1px solid var(--border); background: var(--panel); }
.gallery-card img { border: 3px solid #fff; box-shadow: 0 0 0 1px var(--border); }
.gallery-card::before {
  content: ""; position: absolute; top: 6px; right: 6px; width: 7px; height: 7px;
  border-radius: 50%; background: #cbd5e1;
}

/* Eksikler ısı haritası */
.heatmap { display: grid; grid-template-columns: repeat(auto-fill, minmax(15px, 1fr)); gap: 3px; margin: 0.6rem 0; }
.heatmap-cell { height: 15px; border-radius: 3px; }
.heatmap-cell.ok { background: #34d399; }
.heatmap-cell.warn { background: #fbbf24; }
.heatmap-cell.bad { background: #f87171; }

/* Timeline ikon renkleri */
.timeline-item.t-import::before { background: #2563eb; box-shadow: 0 0 0 4px #eaf1ff; }
.timeline-item.t-status::before { background: #0f8a4b; box-shadow: 0 0 0 4px #e6f7ee; }
.timeline-item .ico { margin-right: 4px; color: var(--accent-dark); }

/* Premium paket checklist */
.package-check { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--border-soft); font-size: 0.85rem; color: var(--ink-soft); font-weight: 700; }
.package-check:last-child { border-bottom: none; }
.package-check .ico.ok { color: #0f8a4b; }
.package-check .ico.warn { color: #b45309; }

/* ============ v5.4 DEEP SEA / SPACE UI — sade, şık, lacivert holografik ============ */
:root {
  --accent: #38bdf8;
  --accent-dark: #7dd3fc;
  --accent-soft: rgba(56, 189, 248, 0.14);
  --sun: #f59e0b;
  --sun-dark: #d97706;
  --ink: #f4f8ff;
  --ink-soft: #c9d8ea;
  --muted: #8aa0b8;
  --bg: #06101d;
  --panel: rgba(10, 22, 38, 0.88);
  --border: rgba(125, 211, 252, 0.18);
  --border-soft: rgba(148, 163, 184, 0.16);
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.22), 0 12px 34px rgba(0, 0, 0, 0.28);
  --shadow-strong: 0 18px 48px rgba(0, 0, 0, 0.36);
  --holo-a: rgba(56, 189, 248, 0.24);
  --holo-b: rgba(245, 158, 11, 0.16);
  --holo-c: rgba(129, 140, 248, 0.16);
  --radius-control: 14px;
  --radius-card: 22px;
}
.stApp {
  background:
    radial-gradient(ellipse 78% 34% at 88% -10%, rgba(56, 189, 248, 0.18), transparent 64%),
    radial-gradient(ellipse 64% 30% at 6% 12%, rgba(245, 158, 11, 0.11), transparent 62%),
    radial-gradient(circle at 50% 0%, rgba(129, 140, 248, 0.10), transparent 44%),
    linear-gradient(180deg, #050b14 0%, #071526 48%, #04101d 100%) !important;
  background-attachment: fixed;
}
.block-container {
  max-width: 680px;
  padding-left: max(16px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
}
.sea-wave { display: none !important; }
.app-hero {
  position: relative;
  overflow: hidden;
  border-left: none !important;
  border-top: 0 !important;
  padding: 18px !important;
  margin-bottom: 18px !important;
  box-shadow: var(--shadow-strong) !important;
  background:
    linear-gradient(180deg, rgba(12, 26, 45, 0.94), rgba(8, 19, 34, 0.94)) padding-box,
    linear-gradient(118deg, rgba(245,158,11,0.72), rgba(56,189,248,0.56), rgba(129,140,248,0.36), rgba(255,255,255,0.10)) border-box !important;
  border: 1px solid transparent !important;
  backdrop-filter: blur(18px);
}
.app-hero::after {
  content: "";
  position: absolute;
  right: -42px; top: -58px;
  width: 170px; height: 140px;
  background: radial-gradient(circle, rgba(56,189,248,0.18), rgba(129,140,248,0.12) 44%, transparent 70%);
  pointer-events: none;
}
.brand-row { gap: 12px !important; }
.brand-badge {
  width: 42px !important; height: 42px !important;
  background: linear-gradient(145deg, var(--sun), var(--sun-dark)) !important;
  box-shadow: 0 10px 22px rgba(245, 130, 32, 0.22), inset 0 1px 0 rgba(255,255,255,0.34) !important;
}
.brand-word { font-size: 1.08rem !important; letter-spacing: -0.03em !important; }
.brand-tag { color: var(--accent-dark) !important; letter-spacing: 0.13em !important; }
.status-line {
  margin-top: 10px !important;
  color: #9eb2c8 !important;
  font-size: 0.72rem !important;
  font-weight: 800 !important;
}
.status-dot {
  width: 8px !important; height: 8px !important;
  box-shadow: none !important;
}
h1, h2, h3, .app-panel-title, .cc-value, .pax-name, .boarding-pass-field .bp-v {
  color: var(--ink) !important;
  letter-spacing: -0.025em;
}
.app-panel-title {
  font-size: 0.98rem !important;
  font-weight: 850 !important;
}
.app-panel-sub, .cc-sub, .pax-line, .pax-date {
  color: var(--muted) !important;
}
label, div[data-testid="stWidgetLabel"] p {
  color: #a8b9cc !important;
  font-size: 0.75rem !important;
  font-weight: 750 !important;
  letter-spacing: -0.01em !important;
}
.compact-label {
  margin-top: 8px !important;
  margin-bottom: 6px !important;
}
.filter-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 10px 0 14px;
}
.filter-summary span {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.10);
  color: #b9d9ef;
  border: 1px solid rgba(125, 211, 252, 0.14);
  font-size: 0.72rem;
  font-weight: 800;
}
.stMarkdown hr, hr {
  border-color: rgba(148, 163, 184, 0.18) !important;
}

.stTabs [data-baseweb="tab-list"] {
  border-radius: 18px !important;
  padding: 6px !important;
  background:
    linear-gradient(rgba(8,19,34,0.84), rgba(8,19,34,0.84)) padding-box,
    linear-gradient(120deg, rgba(245,158,11,0.22), rgba(56,189,248,0.30), rgba(255,255,255,0.08)) border-box !important;
  border: 1px solid transparent !important;
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.30) !important;
  backdrop-filter: blur(18px);
}
.stTabs [data-baseweb="tab"] {
  border-radius: 13px !important;
  min-height: 40px !important;
  padding: 8px 14px !important;
  color: #8fa4bc !important;
  font-weight: 800 !important;
}
.stTabs [data-baseweb="tab"] p {
  font-size: 0.78rem !important;
  line-height: 1.1 !important;
}
.stTabs [aria-selected="true"] {
  background: linear-gradient(180deg, rgba(56,189,248,0.20), rgba(56,189,248,0.12)) !important;
  color: var(--accent-dark) !important;
  box-shadow: inset 0 -2px 0 var(--accent), 0 7px 16px rgba(56,189,248,0.12);
}
.stTabs [data-baseweb="tab-highlight"] { display: none !important; }
.stTabs [data-baseweb="tab-list"] ~ button,
.stTabs button[aria-label*="scroll" i],
.stTabs button[title*="scroll" i] {
  display: none !important;
}

.stTextInput input,
.stSelectbox div[data-baseweb="select"] > div,
.stDateInput input,
[data-baseweb="select"] {
  border-radius: var(--radius-control) !important;
  border-color: rgba(125, 211, 252, 0.18) !important;
  background: rgba(6, 16, 29, 0.76) !important;
  color: var(--ink) !important;
  box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset !important;
}
.stButton > button, .stDownloadButton > button {
  border-radius: var(--radius-control) !important;
  border-color: rgba(125, 211, 252, 0.18) !important;
  background: rgba(10, 22, 38, 0.86) !important;
  color: var(--ink-soft) !important;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.22) !important;
}

.app-panel,
.cc-card,
.filter-sheet,
.empty-hero,
.gallery-card,
div[data-testid="stMetric"],
div[data-testid="stExpander"],
div[data-testid="stForm"] {
  border-radius: var(--radius-card) !important;
  border-color: var(--border) !important;
  background: rgba(10,22,38,0.86) !important;
  box-shadow: var(--shadow) !important;
  backdrop-filter: blur(14px);
}
.section-label {
  color: #8fa9c4 !important;
  letter-spacing: 0.16em !important;
  font-size: 0.66rem !important;
}
.progress-wrap {
  height: 9px !important;
  background: rgba(148, 163, 184, 0.20) !important;
  border: 0 !important;
}
.progress-bar { background: linear-gradient(90deg, var(--accent), #22b8cf) !important; }
.quick-action {
  background: rgba(8, 19, 34, 0.82) !important;
  color: var(--accent-dark) !important;
  border-color: var(--border) !important;
}

.pax-card {
  background:
    linear-gradient(180deg, rgba(10,22,38,0.93), rgba(7,18,32,0.93)) padding-box,
    linear-gradient(125deg, rgba(245,158,11,0.24), rgba(56,189,248,0.34), rgba(129,140,248,0.18), rgba(255,255,255,0.08)) border-box !important;
  border: 1px solid transparent !important;
  box-shadow: var(--shadow) !important;
  backdrop-filter: blur(14px);
}
.pax-card::after {
  content: "" !important;
  position: absolute !important;
  top: -42px !important;
  right: -72px !important;
  width: 180px !important;
  height: 170px !important;
  background:
    radial-gradient(circle, rgba(125,211,252,0.13), rgba(245,158,11,0.08) 42%, transparent 70%) !important;
  transform: none !important;
  opacity: 1 !important;
  pointer-events: none !important;
  z-index: 0 !important;
}
.pax-card::before {
  width: 3px !important;
  background: linear-gradient(180deg, var(--sun), var(--accent)) !important;
}
.pax-card.warn::before { background: #f59e0b !important; }
.pax-card.bad::before { background: #ef4444 !important; }
.pax-stamp {
  transform: none !important;
  mix-blend-mode: normal !important;
  opacity: 1 !important;
  border-radius: 999px !important;
  border-width: 1px !important;
  background: #fff7ed !important;
  color: #b45309 !important;
  font-size: 0.55rem !important;
}
.pax-stamp.ok { background: #ecfdf5 !important; color: #047857 !important; }
.pax-stamp.bad { background: #fef2f2 !important; color: #b91c1c !important; }
.pax-photo,
.pax-photo-lg,
.pax-photo-empty {
  border-radius: 18px !important;
  background: linear-gradient(180deg, rgba(15,32,54,0.95), rgba(10,24,42,0.95)) !important;
  border-color: rgba(125, 211, 252, 0.20) !important;
}
.pax-photo-frame::before,
.pax-photo-frame::after { display: none !important; }
.wallet-passport {
  border-radius: 14px !important;
  background: linear-gradient(180deg, rgba(7,18,32,0.94), rgba(8,23,40,0.94)) !important;
  border-color: rgba(125, 211, 252, 0.18) !important;
}
.pax-tag {
  clip-path: none !important;
  border-radius: 999px !important;
  padding: 4px 9px !important;
  background: rgba(56, 189, 248, 0.12) !important;
  color: #8bdcff !important;
  border-color: rgba(125, 211, 252, 0.18) !important;
}
.pax-tags { gap: 5px !important; }
.pax-tag b { display: none !important; }
.pax-name { font-size: 1.02rem !important; }
.wallet-passport-no { font-size: 1rem !important; }
.pax-stamp,
.mrz-line {
  display: none !important;
}
.pax-flags {
  display: flex !important;
  gap: 5px !important;
  margin-top: 6px !important;
}
.pax-flag {
  font-size: 0.52rem !important;
  padding: 2px 7px !important;
  letter-spacing: 0.04em !important;
}
.ring {
  display: flex !important;
  width: 26px !important;
  height: 26px !important;
}
.ring span {
  width: 20px !important;
  height: 20px !important;
  font-size: 0.48rem !important;
}
.pax-flag {
  border-radius: 999px !important;
  background: rgba(245, 158, 11, 0.13) !important;
  color: #fbbf24 !important;
  border-color: rgba(251, 191, 36, 0.22) !important;
}
.mrz-line {
  background: rgba(7,18,32,0.90) !important;
  border-color: rgba(125, 211, 252, 0.14) !important;
}
div[data-testid="stExpander"] summary svg,
div[data-testid="stExpander"] summary [data-testid="stIconMaterial"] {
  display: none !important;
}

@media (max-width: 760px) {
  .block-container {
    padding-top: max(14px, env(safe-area-inset-top));
    padding-bottom: max(92px, env(safe-area-inset-bottom));
  }
  .stTabs [data-baseweb="tab-list"] {
    left: max(10px, env(safe-area-inset-left)) !important;
    right: max(10px, env(safe-area-inset-right)) !important;
    bottom: max(10px, env(safe-area-inset-bottom)) !important;
    border-radius: 24px !important;
    padding: 7px !important;
  }
  .stTabs [data-baseweb="tab"] {
    min-width: 70px !important;
    min-height: 48px !important;
    padding: 7px 6px !important;
  }
  .stTabs [data-baseweb="tab"] p {
    font-size: 0.70rem !important;
  }
  .app-hero {
    padding: 16px !important;
    margin-bottom: 14px !important;
  }
  .pax-card-row { gap: 12px !important; }
  .pax-photo,
  .pax-photo-empty { width: 68px !important; height: 88px !important; }
  .pax-card { padding: 14px !important; }
}
</style>
"""

NIGHT_CSS = """
<style>
:root {
  --accent: #38bdf8;
  --accent-dark: #38bdf8;
  --accent-soft: #14304a;
  --ink: #eef2ff;
  --ink-soft: #c7d2e6;
  --muted: #8a96b0;
  --bg: #0a0f1c;
  --panel: #121a2c;
  --border: #253150;
  --border-soft: #1c2740;
  --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 10px 26px rgba(0,0,0,0.35);
}
.stApp {
  background:
    radial-gradient(circle at 1px 1px, rgba(56, 189, 248, 0.1) 1px, transparent 1px) 0 0 / 22px 22px,
    radial-gradient(ellipse 70% 45% at 82% 0%, rgba(245, 148, 30, 0.16), transparent 65%),
    radial-gradient(ellipse 90% 60% at 10% 100%, rgba(56, 189, 248, 0.16), transparent 70%),
    linear-gradient(180deg, #070c16 0%, #0a0f1c 45%, #060a13 100%) !important;
  background-attachment: fixed;
}
.sea-wave svg path:nth-child(1) { fill: #38bdf8 !important; }
.sea-wave svg path:nth-child(2) { fill: #f5941e !important; }
.pax-card { background: linear-gradient(135deg, rgba(56,189,248,0.08), transparent 42%), linear-gradient(180deg, #121a2c, #0e1526) !important; border-color: #253150 !important; }
.wallet-passport { background: #0e1526 !important; border-color: #253150 !important; }
.wallet-passport-label { color: #5b6b8c !important; }
.pax-flag { background: #2a2116 !important; color: #fbbf24 !important; border-color: #423318 !important; }
.pax-flag.bad { background: #2a1414 !important; color: #f87171 !important; border-color: #452020 !important; }
.pax-tag { background: #142033 !important; color: #7dd3fc !important; border-color: #1f3350 !important; }
.pax-no { background: #0f2a20 !important; color: #34d399 !important; }
.empty-hero { background: linear-gradient(180deg, #121a2c, #0e1526) !important; border-color: #253150 !important; }
.quick-action { background: #101c2f !important; border-color: #1f3350 !important; color: #7dd3fc !important; }
.filter-sheet { background: #121a2c !important; border-color: #1f3350 !important; }
.mrz-line { background: #0e1526 !important; color: #5b6b8c !important; border-color: #1c2740 !important; }
.ring span { background: #121a2c !important; }
.stTextInput input, .stSelectbox div[data-baseweb="select"] > div, .stDateInput input, [data-baseweb="select"] {
  background: #121a2c !important; border-color: #253150 !important; color: #eef2ff !important;
}
.stButton > button, .stDownloadButton > button { background: #121a2c !important; border-color: #253150 !important; color: #c7d2e6 !important; }
[data-testid="stFileUploader"] section { background: #121a2c !important; border-color: #253150 !important; }
div[data-testid="stExpander"], div[data-testid="stForm"] { background: #121a2c !important; border-color: #253150 !important; }
div[data-testid="stMetric"] { background: #121a2c !important; border-color: #253150 !important; }
.stTabs [data-baseweb="tab-list"] { background: #121a2c !important; border-color: #253150 !important; }
.stTabs [aria-selected="true"] { background: #14304a !important; }
.boarding-pass .stub-divider::before, .boarding-pass .stub-divider::after { background: #0a0f1c !important; }

/* v5.3 Night Holo iOS — noktalı/sert görünüm yerine sakin cam katman */
.stApp {
  background:
    radial-gradient(ellipse 70% 32% at 92% -8%, rgba(245, 130, 32, 0.14), transparent 64%),
    radial-gradient(ellipse 80% 34% at 0% 12%, rgba(56, 189, 248, 0.13), transparent 62%),
    linear-gradient(180deg, #07101d 0%, #0a1322 50%, #07101d 100%) !important;
}
.app-hero,
.pax-card,
.app-panel,
.cc-card,
.filter-sheet,
.empty-hero,
.gallery-card,
div[data-testid="stMetric"],
div[data-testid="stExpander"],
div[data-testid="stForm"] {
  background:
    linear-gradient(180deg, rgba(18,26,44,0.96), rgba(14,21,38,0.96)) padding-box,
    linear-gradient(125deg, rgba(245,130,32,0.24), rgba(56,189,248,0.28), rgba(255,255,255,0.10)) border-box !important;
  border: 1px solid transparent !important;
}
.app-hero::after,
.pax-card::after {
  background: radial-gradient(circle, rgba(56,189,248,0.12), rgba(245,130,32,0.08) 42%, transparent 70%) !important;
}
.stTabs [data-baseweb="tab-list"] {
  background:
    linear-gradient(rgba(18,26,44,0.90), rgba(18,26,44,0.90)) padding-box,
    linear-gradient(120deg, rgba(245,130,32,0.20), rgba(56,189,248,0.28), rgba(255,255,255,0.08)) border-box !important;
  border: 1px solid transparent !important;
}
.stTabs [aria-selected="true"] { background: #122a42 !important; }
</style>
"""

CB_CSS = """
<style>
.pax-stamp.ok { color: #0f6fb3 !important; }
.pax-stamp.warn { color: #f5941e !important; }
.pax-stamp.bad { color: #7c3aed !important; }
.pax-flag { background: #fff1de !important; color: #c9720a !important; border-color: #ffdcae !important; }
.pax-flag.bad { background: #f1e9fb !important; color: #6b21a8 !important; border-color: #ddc9f2 !important; }
.heatmap-cell.ok { background: #0f6fb3 !important; }
.heatmap-cell.warn { background: #f5941e !important; }
.heatmap-cell.bad { background: #7c3aed !important; }
.pax-card.warn::before { background: #f5941e !important; }
.pax-card.bad::before { background: #7c3aed !important; }
.status-dot.warn { background: #f5941e !important; }
</style>
"""

st.markdown(APP_CSS, unsafe_allow_html=True)
if st.session_state.get("night_mode"):
    st.markdown(NIGHT_CSS, unsafe_allow_html=True)
if st.session_state.get("colorblind_mode"):
    st.markdown(CB_CSS, unsafe_allow_html=True)

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
        "night_mode": False,
        "card_density": "Rahat",
        "colorblind_mode": False,
        "bulk_selected": set(),
        "undo_snapshot": None,
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


def snapshot_for_undo(label: str) -> None:
    """Yıkıcı bir işlemden (silme vb.) önce tüm tabloyu yedekler — 'Geri al' bunu kullanır."""
    st.session_state.undo_snapshot = {
        "label": label,
        "df": st.session_state.base_df.copy(deep=True),
        "ts": datetime.now().strftime("%H:%M:%S"),
    }


def render_undo_banner() -> None:
    snap = st.session_state.get("undo_snapshot")
    if not snap:
        return
    c1, c2, c3 = st.columns([3, 1, 1])
    with c1:
        st.markdown(
            f'<div class="app-panel" style="border-left:3px solid var(--sun);margin-bottom:0.6rem;padding:0.6rem 0.9rem;">'
            f'<p class="app-panel-sub" style="margin:0;">{icon("undo", 13)} <b>{html.escape(snap["label"])}</b> · {snap["ts"]}</p></div>',
            unsafe_allow_html=True,
        )
    with c2:
        if st.button("Geri al", key="undo_apply", use_container_width=True, type="primary"):
            st.session_state.base_df = normalize_passenger_dataframe(snap["df"])
            st.session_state.undo_snapshot = None
            st.session_state.selected_idx = None
            persist()
            st.toast("İşlem geri alındı", icon="↩️")
            st.rerun()
    with c3:
        if st.button("Kapat", key="undo_dismiss", use_container_width=True):
            st.session_state.undo_snapshot = None
            st.rerun()


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
    df = st.session_state.get("base_df", pd.DataFrame())
    count = len(df)
    if db.enabled():
        backend = '<span class="status-dot ok"></span>Veritabanı bağlı (kalıcı)'
    else:
        backend = '<span class="status-dot warn"></span>Geçici depolama'
    updated = st.session_state.get("updated_at", "")
    updated_html = f" · Son güncelleme {updated}" if updated else ""
    saved_html = f' · {icon("check", 11)} Kaydedildi' if updated else ""

    pal = status_palette()
    if df is None or df.empty:
        hero_color = "var(--accent)"
    else:
        m = readiness_metrics(df)
        hero_color = pal["ok"] if m["pct"] >= 90 else (pal["warn"] if m["pct"] >= 60 else pal["bad"])

    st.markdown(
        f"""
        <div class="app-hero" style="border-left-color:{hero_color};">
          <div class="brand-row">
            <span class="brand-badge">{icon('ferry', 20)}</span>
            <div class="brand-wrap">
              <p class="brand-word">Gate Visa PAX</p>
              <p class="brand-tag">Sınır Kontrol · v{APP_VERSION}</p>
            </div>
          </div>
          <div class="status-line">{icon("check", 12)} {backend} · {count} yolcu{updated_html}{saved_html}</div>
        </div>
        <div class="sea-wave">
          <svg viewBox="0 0 1200 60" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,32 C150,60 350,4 600,28 C850,52 1050,8 1200,30 L1200,60 L0,60 Z" fill="var(--accent)" opacity="0.16"></path>
            <path d="M0,42 C200,18 400,54 650,34 C900,14 1050,46 1200,26 L1200,60 L0,60 Z" fill="var(--sun)" opacity="0.14"></path>
          </svg>
        </div>
        """,
        unsafe_allow_html=True,
    )
    tb1, tb2, tb3 = st.columns([1, 1, 1])
    with tb1:
        night = st.session_state.get("night_mode", False)
        label = "Deniz laciverti" if night else "Uzay siyahı"
        if st.button(label, key="toggle_night_mode", use_container_width=True):
            st.session_state.night_mode = not night
            st.rerun()
    with tb2:
        dens_opts = ["Rahat", "Sıkı", "Mini"]
        cur = st.session_state.get("card_density", "Rahat")
        st.session_state.card_density = st.selectbox(
            "Kart yoğunluğu",
            options=dens_opts,
            index=dens_opts.index(cur) if cur in dens_opts else 0,
            key="card_density_select",
            label_visibility="collapsed",
        )
    with tb3:
        st.session_state.colorblind_mode = st.checkbox(
            "Renk körlüğü modu",
            value=st.session_state.get("colorblind_mode", False),
            key="colorblind_toggle",
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


def photo_html(row: pd.Series, css_class: str = "pax-photo", size: str = "list", framed: bool = True) -> str:
    ref = str(row.get("Foto", "") or "")
    frame_open = '<div class="pax-photo-frame">' if framed else ""
    frame_close = "</div>" if framed else ""
    if ref:
        uri = thumb_uri(ref, 96, 55) if size == "list" else thumb_uri(ref, 380, 82)
        if uri:
            return f'{frame_open}<img class="{css_class}" src="{uri}" alt="foto" loading="lazy" decoding="async" />{frame_close}'
    inner = f'<div class="{css_class} pax-photo-empty">👤<span class="miss-tag">Foto yok</span></div>'
    return f"{frame_open}{inner}{frame_close}" if framed else inner


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


def _sync_bulk_selection(key_prefix: str, idx: int) -> None:
    checked = st.session_state.get(f"bulk_{key_prefix}_{idx}", False)
    if checked:
        st.session_state.bulk_selected.add(idx)
    else:
        st.session_state.bulk_selected.discard(idx)


def render_passenger_card(idx: int, row: pd.Series, key_prefix: str = "list", selectable: bool = False) -> None:
    card = passenger_card_view(row)
    view_mode = st.session_state.get("view_mode", "Detaylı")
    name_raw = cell_text(row.get("Yolcu Adı Soyadı")) or "Yolcu"
    name = html.escape(name_raw)
    passport_raw = cell_text(row.get("Pasaport No")) or "—"
    passport = html.escape(passport_raw)
    voucher_raw = cell_text(row.get("Voucher"))
    voucher = html.escape(voucher_raw)
    fee_raw = cell_text(row.get("Vize Ücreti Yetişkin"))
    dep = html.escape(cell_text(row.get("Gidiş Tarihi")))
    arr = html.escape(cell_text(row.get("Varış Tarihi")))

    issues = card_issues(row)
    density_cls = {"Rahat": "", "Sıkı": " density-compact", "Mini": " density-dense"}.get(
        st.session_state.get("card_density", "Rahat"), ""
    )
    card_cls = "pax-card" + density_cls
    if any(sev == "bad" for _, sev in issues):
        card_cls += " bad"
        stamp = ("EKSİK", "bad")
    elif issues:
        card_cls += " warn"
        stamp = ("KONTROL", "warn")
    else:
        stamp = ("ONAYLI", "ok")
    flags_html = ""
    if issues:
        flags_html = '<div class="pax-flags">' + "".join(
            f'<span class="pax-flag {sev}">{icon("warn", 10)} {label}</span>' for label, sev in issues
        ) + "</div>"

    checks = 4 - len(set(lbl for lbl, _ in issues))
    ring_pct = round(max(0, checks) / 4 * 100)
    pal = status_palette()
    ring_color = pal["ok"] if ring_pct == 100 else (pal["warn"] if ring_pct >= 50 else pal["bad"])

    wallet_passport = (
        f'<div class="wallet-row">'
        f'<div class="wallet-passport">'
        f'<span class="wallet-passport-label">{icon("passport", 10)} Passport</span>'
        f'<span class="wallet-passport-no">{passport}</span>'
        f"</div>"
        f'<span class="pax-date">{dep or "—"}</span>'
        f'<div class="ring" style="--pct:{ring_pct};--ring-color:{ring_color};"><span>{ring_pct}</span></div>'
        f"</div>"
    )

    if view_mode == "Kompakt":
        chips = []
    else:
        chips = []
        if voucher:
            chips.append(f"<span class='pax-tag'>{icon('ticket', 10)} <b>Voucher</b> {voucher}</span>")
        if dep or arr:
            date_val = f'{dep or "—"} → {arr or "—"}'
            chips.append(f"<span class='pax-tag'>{icon('calendar', 10)} <b>Tarih</b> {date_val}</span>")
        if card["amount"]:
            chips.append(f"<span class='pax-tag'>{icon('coin', 10)} <b>Ücret</b> {html.escape(card['amount'])}</span>")
    chips_html = f'<div class="pax-tags">{"".join(chips)}</div>' if chips else ""

    show_photo = st.session_state.get("show_photos", True) and view_mode != "Fotoğrafsız"
    photo = photo_html(row) if show_photo else ""
    mrz_html = ""
    if view_mode == "Detaylı":
        mrz_html = f'<div class="mrz-line">{html.escape(mrz_line(name_raw.split(" ")[0] if name_raw else "", " ".join(name_raw.split(" ")[1:]), passport_raw))}</div>'

    st.markdown(
        f"""
        <div class="{card_cls}">
          <span class="pax-stamp {stamp[1]}">{icon("stamp", 11)} {stamp[0]}</span>
          <div class="pax-card-row">
            {photo}
            <div class="pax-card-body">
              <div class="pax-card-top">
                <span class="pax-no">{html.escape(card["status"] or "Yolcu")}</span>
              </div>
              <div class="pax-name">{name}</div>
              {wallet_passport}
              {chips_html}
              {flags_html}
              {mrz_html}
            </div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    if selectable:
        sel_col, btn_col = st.columns([1, 3])
        with sel_col:
            st.checkbox(
                "Seç", value=idx in st.session_state.get("bulk_selected", set()),
                key=f"bulk_{key_prefix}_{idx}", label_visibility="collapsed",
                on_change=_sync_bulk_selection, args=(key_prefix, idx),
            )
        with btn_col:
            if st.button("Detayı aç →", key=f"open_card_{key_prefix}_{idx}", use_container_width=True):
                st.session_state.selected_idx = idx
                st.rerun()
    else:
        if st.button("Detayı aç →", key=f"open_card_{key_prefix}_{idx}", use_container_width=True):
            st.session_state.selected_idx = idx
            st.rerun()

    with st.expander("Hızlı düzenle", expanded=False):
        qc1, qc2 = st.columns(2)
        q_voucher = qc1.text_input("Voucher", value=voucher_raw, key=f"qedit_voucher_{key_prefix}_{idx}")
        q_fee = qc2.text_input("Ücret (Yetişkin)", value=fee_raw, key=f"qedit_fee_{key_prefix}_{idx}")
        if st.button("Kaydet", key=f"qedit_save_{key_prefix}_{idx}", use_container_width=True):
            st.session_state.base_df.at[idx, "Voucher"] = q_voucher
            st.session_state.base_df.at[idx, "Vize Ücreti Yetişkin"] = q_fee
            st.session_state.base_df = normalize_passenger_dataframe(st.session_state.base_df)
            persist()
            st.toast("Kart güncellendi", icon="✅")
            st.rerun()


def render_detail_view(base_df: pd.DataFrame) -> None:
    idx = st.session_state.selected_idx
    if idx is None or idx not in base_df.index:
        st.session_state.selected_idx = None
        st.rerun()
        return

    row = base_df.loc[idx]
    card = passenger_card_view(row)
    m = readiness_metrics(pd.DataFrame([row]))
    issues = card_issues(row)
    stamp = ("ONAYLI", "ok") if not issues else (
        ("EKSİK", "bad") if any(s == "bad" for _, s in issues) else ("KONTROL", "warn")
    )
    passport_raw = cell_text(row.get("Pasaport No")) or "—"
    name_raw = cell_text(row.get("Yolcu Adı Soyadı")) or "Yolcu"
    mrz_html = html.escape(mrz_line(name_raw.split(" ")[0] if name_raw else "", " ".join(name_raw.split(" ")[1:]), passport_raw))

    if st.button("← Listeye dön"):
        st.session_state.selected_idx = None
        st.rerun()

    st.markdown(
        f"""
        <div class="app-panel boarding-pass app-panel-lg">
          <span class="pax-stamp {stamp[1]}">{icon("stamp", 11)} {stamp[0]}</span>
          <div class="pax-card-row">
            {photo_html(row, css_class="pax-photo-lg", size="detail")}
            <div class="pax-card-body">
              <p class="app-panel-title">{card["title"]}</p>
              <p class="app-panel-sub">{card["subtitle"]}</p>
              <div class="mrz-line">{mrz_html}</div>
            </div>
          </div>
          <div class="stub-divider"></div>
          <div class="boarding-pass-row">
            <div class="boarding-pass-field"><div class="bp-k">{icon("passport", 10)} Pasaport</div><div class="bp-v">{html.escape(passport_raw)}</div></div>
            <div class="boarding-pass-field"><div class="bp-k">{icon("calendar", 10)} Gidiş</div><div class="bp-v">{html.escape(cell_text(row.get("Gidiş Tarihi")) or "—")}</div></div>
            <div class="boarding-pass-field"><div class="bp-k">{icon("ticket", 10)} Voucher</div><div class="bp-v">{html.escape(cell_text(row.get("Voucher")) or "—")}</div></div>
            <div class="boarding-pass-field"><div class="bp-k">{icon("coin", 10)} Ücret</div><div class="bp-v">{html.escape(card["amount"] or "—")}</div></div>
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    dep_date = parse_date_value(row.get("Gidiş Tarihi"))
    arr_raw = cell_text(row.get("Varış Tarihi"))
    if dep_date and not arr_raw:
        suggested = (dep_date + timedelta(days=7)).isoformat()
        if st.button(f"📅 Varışı otomatik doldur → {suggested}", key=f"smart_date_{idx}", use_container_width=True):
            st.session_state.base_df.at[idx, "Varış Tarihi"] = suggested
            st.session_state.base_df = normalize_passenger_dataframe(st.session_state.base_df)
            persist()
            st.toast("Varış tarihi dolduruldu", icon="📅")
            st.rerun()

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

    import re as _re

    st.markdown('<p class="section-label">Canlı doğrulama</p>', unsafe_allow_html=True)
    lv1, lv2 = st.columns(2)
    with lv1:
        live_passport = st.text_input("Pasaport No", value=str(row.get("Pasaport No", "") or ""), key=f"live_passport_{idx}")
        pp_clean = _re.sub(r"[^A-Za-z0-9]", "", live_passport or "")
        if not live_passport:
            st.caption("⚪ Pasaport numarası boş")
        elif len(pp_clean) < 6:
            st.caption("🔴 Çok kısa görünüyor (min 6 karakter)")
        else:
            st.caption("🟢 Format uygun")
    with lv2:
        live_voucher = st.text_input("Voucher", value=str(row.get("Voucher", "") or ""), key=f"live_voucher_{idx}")
        st.caption("🟢 Voucher girildi" if live_voucher else "🟡 Voucher boş")

    with st.form("passenger_detail_form", border=True):
        updates: dict[str, str] = {}
        for field in editable_passenger_fields():
            if field == "Yolcu Adı Soyadı":
                st.text_input(field, value=str(row.get(field, "") or ""), disabled=True)
                continue
            if field in ("Pasaport No", "Voucher"):
                continue  # yukarıda canlı doğrulama alanlarıyla alınıyor
            updates[field] = st.text_input(field, value=str(row.get(field, "") or ""))

        st.divider()
        st.caption("Kaynak import")
        st.text_input("Kaynak Dosya", value=str(row.get("Kaynak Dosya", "") or ""), disabled=True)
        st.text_input("Sayfa", value=str(row.get("Sayfa", "") or ""), disabled=True)

        save_col, delete_col = st.columns(2)
        saved = save_col.form_submit_button("Kaydet", use_container_width=True, type="primary")
        delete = delete_col.form_submit_button("Sil", use_container_width=True)

    if saved:
        updates["Pasaport No"] = live_passport
        updates["Voucher"] = live_voucher
        updates["Yolcu Adı Soyadı"] = f'{updates.get("Ad", "").strip()} {updates.get("Soyad", "").strip()}'.strip()
        for field, value in updates.items():
            st.session_state.base_df.at[idx, field] = value
        st.session_state.base_df = normalize_passenger_dataframe(st.session_state.base_df)
        st.session_state.selected_idx = None
        persist()
        st.toast("Yolcu güncellendi", icon="✅")
        st.rerun()

    if delete:
        snapshot_for_undo(f"{name_raw} silindi")
        st.session_state.base_df = normalize_passenger_dataframe(
            st.session_state.base_df.drop(index=idx).reset_index(drop=True)
        )
        st.session_state.selected_idx = None
        persist()
        st.toast("Yolcu silindi", icon="🗑️")
        st.rerun()


def readiness_metrics(df: pd.DataFrame) -> dict:
    """Operasyon hazırlık yüzdesi ve eksik sayıları."""
    total = len(df)
    if total == 0:
        return {
            "pct": 0,
            "total": 0,
            "photo_missing": 0,
            "passport_missing": 0,
            "voucher_missing": 0,
            "fee_missing": 0,
            "duplicates": 0,
            "photo_ok": 0,
            "passport_ok": 0,
            "voucher_ok": 0,
            "fee_ok": 0,
        }

    photo_missing = int(df["Foto"].astype(str).str.strip().eq("").sum())
    passport_missing = int(df["Pasaport No"].astype(str).str.strip().eq("").sum())
    voucher_missing = int(df["Voucher"].astype(str).str.strip().eq("").sum())
    adult = df["Vize Ücreti Yetişkin"].astype(str).str.strip()
    child = df["Vize Ücreti Çocuk"].astype(str).str.strip()
    fee_missing = int((adult.eq("") & child.eq("")).sum())
    passport_norm = df["Pasaport No"].astype(str).map(_norm_match)
    duplicates = int(passport_norm[passport_norm.ne("") & passport_norm.duplicated(keep=False)].count())

    photo_ok = total - photo_missing
    passport_ok = total - passport_missing - duplicates
    voucher_ok = total - voucher_missing
    fee_ok = total - fee_missing
    pct = round(max(0, (photo_ok + passport_ok + voucher_ok + fee_ok) / (total * 4) * 100))
    return {
        "pct": int(pct),
        "total": total,
        "photo_missing": photo_missing,
        "passport_missing": passport_missing,
        "voucher_missing": voucher_missing,
        "fee_missing": fee_missing,
        "duplicates": duplicates,
        "photo_ok": photo_ok,
        "passport_ok": max(0, passport_ok),
        "voucher_ok": voucher_ok,
        "fee_ok": fee_ok,
    }


def set_missing_filter(choice: str) -> None:
    st.session_state.missing_filter = choice
    st.session_state.pax_page = 0


def render_smart_empty_state(
    emoji: str = "🛂",
    title: str = "Henüz operasyon yok",
    subtitle: str = "Excel yükleyerek başlayın, şablon indirin veya demo veriyle uygulamayı deneyin.",
    key_suffix: str = "",
) -> None:
    st.markdown(
        f"""
        <div class="empty-hero">
          <p class="big">{emoji}</p>
          <h3>{html.escape(title)}</h3>
          <p class="app-panel-sub">{html.escape(subtitle)}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    c1, c2 = st.columns(2)
    if c1.button("Demo veri yükle", type="primary", use_container_width=True, key=f"empty_demo{key_suffix}"):
        st.session_state.base_df = normalize_passenger_dataframe(make_demo_passengers())
        st.session_state.read_log = ["✓ Demo: 3 yolcu kartı"]
        persist()
        st.rerun()
    c2.download_button(
        "Şablon indir",
        data=passenger_template_xlsx(),
        file_name="gate-visa-pax-sablonu.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
        key=f"empty_template{key_suffix}",
    )


def render_readiness_panel(df: pd.DataFrame, prefix: str) -> dict:
    m = readiness_metrics(df)
    st.markdown(
        f"""
        <div class="app-panel app-panel-lg">
          <p class="app-panel-title">Operasyon hazırlığı: %{m['pct']}</p>
          <div class="progress-wrap"><div class="progress-bar" style="width:{m['pct']}%;"></div></div>
          <p class="app-panel-sub">{m['photo_ok']}/{m['total']} foto · {m['passport_ok']}/{m['total']} pasaport ·
          {m['voucher_ok']}/{m['total']} voucher · {m['fee_ok']}/{m['total']} ücret</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    return m


def render_today_banner(base_df: pd.DataFrame) -> None:
    if base_df is None or base_df.empty:
        return
    today = datetime.now().date()
    mask = base_df["Gidiş Tarihi"].map(lambda v: parse_date_value(v) == today)
    todays = base_df[mask]
    if todays.empty:
        return
    summ = summarize_group(todays)
    st.markdown(
        f"""
        <div class="app-panel app-panel-lg" style="border-left:3px solid var(--sun);">
          <p class="app-panel-title">{icon("pin", 13)} Bugün ({today.strftime('%d.%m.%Y')}) {summ['count']} yolcu için operasyon var</p>
          <p class="app-panel-sub">{summ['with_photo']}/{summ['count']} fotolu · toplam ücret {_fmt_amount(summ['total'])}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    if st.button("📁 Bugünün listesini Arşiv'de aç", key="today_banner_open", use_container_width=True):
        st.session_state.arch_range_choice = "Bugün"
        st.toast("Arşiv sekmesine geçin — 'Bugün' filtresi hazır", icon="📁")


def render_command_center(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        render_smart_empty_state(key_suffix="_home")
        return

    st.markdown(
        f'<p class="section-label">{icon("stamp", 12)} Operasyon Kokpiti</p>',
        unsafe_allow_html=True,
    )
    render_today_banner(base_df)
    m = render_readiness_panel(base_df, "home")
    summ = summarize_group(base_df)
    st.markdown(
        f"""
        <div class="cc-grid">
          <div class="cc-card"><p class="cc-kicker">Yolcu</p><p class="cc-value">{summ['count']}</p><p class="cc-sub">Toplam kayıt</p></div>
          <div class="cc-card"><p class="cc-kicker">Toplam ücret</p><p class="cc-value">{_fmt_amount(summ['total'])}</p><p class="cc-sub">Yetişkin + çocuk</p></div>
          <div class="cc-card"><p class="cc-kicker">Fotosuz</p><p class="cc-value">{m['photo_missing']}</p><p class="cc-sub">Düzeltilecek foto</p></div>
          <div class="cc-card"><p class="cc-kicker">Risk</p><p class="cc-value">{m['passport_missing'] + m['duplicates']}</p><p class="cc-sub">Pasaport/duplicate</p></div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.markdown('<p class="section-label">Hızlı aksiyonlar</p>', unsafe_allow_html=True)
    a1, a2 = st.columns(2)
    if a1.button("Fotosuzları göster", use_container_width=True, key="home_fotosuz"):
        set_missing_filter("Fotosuz")
        st.toast("Yolcular sekmesinde Fotosuz filtresi hazır", icon="📷")
    if a2.button("Eksikleri düzelt", use_container_width=True, key="home_fix"):
        st.session_state.quick_fix_focus = "Fotosuz"
        st.toast("Eksikler sekmesine geç", icon="⚠️")
    a3, a4 = st.columns(2)
    a3.download_button(
        "Tüm Excel",
        data=dataframe_to_xlsx(base_df),
        file_name=f"yolcular-{datetime.now().strftime('%Y%m%d-%H%M')}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
        key="home_xlsx",
    )
    if a4.button("Import'a git", use_container_width=True, key="home_import_hint"):
        st.toast("Alttaki ⬆️ Import sekmesini aç", icon="⬆️")

    render_operation_timeline(base_df, compact=True)


def issue_indexes(base_df: pd.DataFrame, category: str) -> list[int]:
    if base_df.empty:
        return []
    if category == "Fotosuz":
        return [int(i) for i in base_df[base_df["Foto"].astype(str).str.strip().eq("")].index]
    if category == "Pasaportsuz":
        return [int(i) for i in base_df[base_df["Pasaport No"].astype(str).str.strip().eq("")].index]
    if category == "Voucher eksik":
        return [int(i) for i in base_df[base_df["Voucher"].astype(str).str.strip().eq("")].index]
    if category == "Ücretsiz":
        adult = base_df["Vize Ücreti Yetişkin"].astype(str).str.strip()
        child = base_df["Vize Ücreti Çocuk"].astype(str).str.strip()
        return [int(i) for i in base_df[adult.eq("") & child.eq("")].index]
    if category == "Tekrarlı":
        dups = st.session_state.get("dup_passports", set())
        return [int(i) for i in base_df[base_df["Pasaport No"].map(lambda v: _norm_match(v) in dups and bool(_norm_match(v)))].index]
    return []


def render_quick_fix_card(idx: int, row: pd.Series, category: str) -> None:
    name = cell_text(row.get("Yolcu Adı Soyadı")) or "Yolcu"
    pp = cell_text(row.get("Pasaport No")) or "—"
    st.markdown(
        f"""
        <div class="app-panel">
          <p class="app-panel-title">{html.escape(name)}</p>
          <p class="app-panel-sub">{html.escape(pp)} · {html.escape(category)}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )
    c1, c2 = st.columns(2)
    if c1.button("Detayı aç", key=f"qf_open_{category}_{idx}", use_container_width=True):
        st.session_state.selected_idx = idx
        st.rerun()
    if c2.button("Yolcular filtresi", key=f"qf_filter_{category}_{idx}", use_container_width=True):
        set_missing_filter("Fotosuz" if category == "Voucher eksik" else category)
        st.toast("Yolcular sekmesinde filtre hazır", icon="✅")

    if category == "Fotosuz":
        quick_photo = st.file_uploader(
            "Fotoğrafı doğrudan buraya bırak", key=f"qf_photo_{idx}",
            help="Sürükle-bırak veya seç — foto anında bu yolcuya atanır.",
        )
        sig_key = f"qf_photo_sig_{idx}"
        if quick_photo is not None and st.session_state.get(sig_key) != quick_photo.name + str(getattr(quick_photo, "size", 0)):
            st.session_state[sig_key] = quick_photo.name + str(getattr(quick_photo, "size", 0))
            data = quick_photo.getvalue()
            if looks_like_image(quick_photo.name, data):
                key = cell_text(row.get("Pasaport No")) or f"row{idx}"
                stored = save_photo_bytes(_norm_match(key) or "foto", ".jpg", _resize_bytes(data))
                st.session_state.base_df.at[idx, "Foto"] = stored
                st.session_state.base_df = normalize_passenger_dataframe(st.session_state.base_df)
                thumb_uri.clear()
                persist()
                st.toast(f"{name} için fotoğraf atandı", icon="✅")
                st.rerun()
            else:
                st.error("Seçilen dosya bir görüntü değil.")


def render_readiness_heatmap(base_df: pd.DataFrame) -> None:
    cells = []
    for _, row in base_df.iterrows():
        issues = card_issues(row)
        name = html.escape(cell_text(row.get("Yolcu Adı Soyadı")) or "Yolcu")
        if any(sev == "bad" for _, sev in issues):
            cls, label = "bad", "eksik"
        elif issues:
            cls, label = "warn", "kontrol"
        else:
            cls, label = "ok", "tamam"
        cells.append(f'<div class="heatmap-cell {cls}" title="{name} · {label}"></div>')
    st.markdown(
        f'<p class="section-label">{icon("grid", 12)} Hazırlık ısı haritası ({len(base_df)} yolcu)</p>'
        f'<div class="heatmap">{"".join(cells)}</div>',
        unsafe_allow_html=True,
    )


def render_issues_center(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        render_smart_empty_state(
            emoji="🛡️",
            title="Kontrol edilecek bir şey yok",
            subtitle="Henüz yolcu eklenmedi. Eklendiğinde eksik foto/pasaport/voucher/ücret burada listelenecek.",
            key_suffix="_issues",
        )
        return

    render_readiness_heatmap(base_df)
    categories = ["Fotosuz", "Pasaportsuz", "Voucher eksik", "Ücretsiz", "Tekrarlı"]
    counts = {c: len(issue_indexes(base_df, c)) for c in categories}
    st.markdown(
        "".join(
            [
                '<div class="cc-grid">',
                *[
                    f'<div class="cc-card"><p class="cc-kicker">{html.escape(c)}</p><p class="cc-value">{counts[c]}</p>'
                    f'<p class="cc-sub">Düzelt →</p></div>'
                    for c in categories
                ],
                "</div>",
            ]
        ),
        unsafe_allow_html=True,
    )

    default = st.session_state.get("quick_fix_focus", "Fotosuz")
    category = st.selectbox(
        "Düzeltilecek kategori",
        options=categories,
        index=categories.index(default) if default in categories else 0,
        key="issues_category",
    )
    idxs = issue_indexes(base_df, category)
    if not idxs:
        st.success(f"{category} için eksik yok.")
        return
    if category == "Tekrarlı":
        render_duplicate_merge_ui(base_df)
        return
    st.markdown(f'<p class="section-label">{len(idxs)} hızlı düzeltme</p>', unsafe_allow_html=True)
    for idx in idxs[:20]:
        render_quick_fix_card(idx, base_df.loc[idx], category)


def merge_duplicate_group(passport_key: str) -> int:
    """Aynı normalize pasaporta sahip satırları birleştirir (her sütun için en dolu değeri
    tutar) ve fazlalıkları kaldırır. Kaldırılan satır sayısını döndürür."""
    df = st.session_state.base_df
    norm = df["Pasaport No"].astype(str).map(_norm_match)
    group_idx = list(df[norm == passport_key].index)
    if len(group_idx) < 2:
        return 0
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
    drop_idx = group_idx[1:]
    st.session_state.base_df = normalize_passenger_dataframe(df.drop(index=drop_idx).reset_index(drop=True))
    return len(drop_idx)


def render_duplicate_merge_ui(base_df: pd.DataFrame) -> None:
    norm = base_df["Pasaport No"].astype(str).map(_norm_match)
    dup_keys = sorted(set(norm[norm.ne("") & norm.duplicated(keep=False)]))
    if not dup_keys:
        st.success("Tekrarlı pasaport yok.")
        return
    st.markdown(f'<p class="section-label">{icon("merge", 12)} {len(dup_keys)} tekrarlı pasaport grubu</p>', unsafe_allow_html=True)
    for key in dup_keys[:15]:
        group = base_df[norm == key]
        st.markdown(
            f'<div class="app-panel"><p class="app-panel-title">{icon("passport", 12)} {html.escape(key.upper())} '
            f'<span class="filter-chip">{len(group)} kayıt</span></p></div>',
            unsafe_allow_html=True,
        )
        for _, grow in group.iterrows():
            st.caption(
                f'{cell_text(grow.get("Yolcu Adı Soyadı")) or "—"} · '
                f'Voucher: {cell_text(grow.get("Voucher")) or "—"} · '
                f'Gidiş: {cell_text(grow.get("Gidiş Tarihi")) or "—"} · '
                f'Foto: {"var" if str(grow.get("Foto", "") or "").strip() else "yok"}'
            )
        if st.button("🔗 Birleştir (en dolu satırı tut)", key=f"merge_{key}", use_container_width=True):
            snapshot_for_undo(f"{len(group)} tekrarlı kayıt birleştirildi ({key.upper()})")
            removed = merge_duplicate_group(key)
            persist()
            st.toast(f"{removed} tekrarlı kayıt birleştirildi", icon="🔗")
            st.rerun()


def render_operation_timeline(base_df: pd.DataFrame, compact: bool = False) -> None:
    history = list(st.session_state.get("import_history", []))
    meta = st.session_state.get("date_meta", {})
    items: list[tuple[str, str]] = []
    for h in history[:8]:
        items.append((
            "t-import",
            f'{icon("box", 12)} {html.escape(str(h.get("time", "")))} · {html.escape(str(h.get("files", "Import")))} · '
            f'{int(h.get("rows", 0) or 0)} yolcu',
        ))
    for date_key, info in list(meta.items())[:5]:
        items.append((
            "t-status",
            f'{icon("flag", 12)} {html.escape(str(date_key))} · Operasyon {html.escape(str(info.get("status", "Hazırlanıyor")))}',
        ))
    if not items and not base_df.empty:
        items.append(("t-import", f'{icon("check", 12)} {len(base_df)} yolcu hazırlandı'))
    if not items:
        return
    title = "Son hareketler" if compact else "Operation Timeline"
    st.markdown(f'<p class="section-label">{title}</p><div class="timeline">' + "".join(
        f'<div class="timeline-item {cls}">{item}</div>' for cls, item in items
    ) + "</div>", unsafe_allow_html=True)


def render_photo_gallery(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        render_smart_empty_state(
            emoji="📷",
            title="Galeri boş",
            subtitle="Önce yolcu ekleyin, ardından Import sekmesinden fotoğraf veya ZIP yükleyin.",
            key_suffix="_gallery",
        )
        return
    rows = [(int(i), r) for i, r in base_df.iterrows() if str(r.get("Foto", "") or "").strip()]
    pending = st.session_state.get("pending_photos", [])
    c1, c2 = st.columns(2)
    c1.metric("Eşleşmiş foto", len(rows))
    c2.metric("Eşleşmeyen", len(pending))
    if pending:
        render_unmatched_photos()
    if not rows:
        st.info("Henüz eşleşmiş fotoğraf yok. Import sekmesinden fotoğraf veya ZIP yükleyin.")
        return
    page_size = 12
    pages = max(1, (len(rows) + page_size - 1) // page_size)
    page = min(max(0, int(st.session_state.get("gallery_page", 0))), pages - 1)
    chunk = rows[page * page_size : page * page_size + page_size]
    cards = []
    for idx, row in chunk:
        uri = thumb_uri(str(row.get("Foto", "") or ""), 180, 70)
        if not uri:
            continue
        name = html.escape(cell_text(row.get("Yolcu Adı Soyadı")) or "Yolcu")
        pp = html.escape(cell_text(row.get("Pasaport No")) or "")
        cards.append(
            f'<div class="gallery-card"><img src="{uri}" loading="lazy" decoding="async">'
            f'<p>{icon("passport", 10)} {name}<br>{pp}</p></div>'
        )
    st.markdown('<div class="gallery-grid">' + "".join(cards) + "</div>", unsafe_allow_html=True)
    render_pagination("gallery_page", page, pages, "gallery")


def build_operation_package(base_df: pd.DataFrame) -> bytes:
    buf = BytesIO()
    report = {
        "version": APP_VERSION,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "summary": summarize_group(base_df),
        "readiness": readiness_metrics(base_df),
        "import_history": st.session_state.get("import_history", []),
        "date_meta": st.session_state.get("date_meta", {}),
    }
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("yolcular.xlsx", dataframe_to_xlsx(base_df))
        zf.writestr("yolcular.csv", dataframe_to_csv(base_df))
        zf.writestr("rapor.json", json.dumps(report, ensure_ascii=False, indent=2))
        photo_zip = build_date_photo_zip(base_df)
        if photo_zip:
            zf.writestr("fotograflar.zip", photo_zip)
    return buf.getvalue()


def render_package_builder(base_df: pd.DataFrame) -> None:
    if base_df.empty:
        render_smart_empty_state(
            emoji="📦",
            title="Teslim paketi hazırlanamaz",
            subtitle="Önce yolcu ekleyin, ardından operasyon dosyasını paketleyebilirsiniz.",
            key_suffix="_package",
        )
        return
    m = readiness_metrics(base_df)
    summ = summarize_group(base_df)
    pal = status_palette()
    ring_color = pal["ok"] if m["pct"] >= 90 else (pal["warn"] if m["pct"] >= 60 else pal["bad"])

    def _row(name: str, ok: bool, icon_name: str) -> str:
        cls = "ok" if ok else "warn"
        mark = icon("check", 13, cls) if ok else icon("warn", 13, cls)
        return f'<div class="package-check">{icon(icon_name, 14)} {name} <span style="margin-left:auto">{mark}</span></div>'

    st.markdown(
        f"""
        <div class="app-panel app-panel-lg">
          <div class="pax-card-row" style="align-items:center;">
            <div class="ring" style="width:52px;height:52px;--pct:{m['pct']};--ring-color:{ring_color};">
              <span style="width:40px;height:40px;font-size:0.78rem;">%{m['pct']}</span>
            </div>
            <div class="pax-card-body">
              <p class="app-panel-title">Teslim Paketi</p>
              <p class="app-panel-sub">Operasyon dosyasını sınır kontrolüne teslim etmeye hazır mı?</p>
            </div>
          </div>
          <div style="margin-top:0.6rem;">
            {_row("Yolcu Excel / CSV", True, "ticket")}
            {_row(f"Fotoğraf ZIP ({summ['with_photo']}/{summ['count']})", summ['with_photo'] == summ['count'] and summ['count'] > 0, "photo")}
            {_row(f"Ücret özeti ({_fmt_amount(summ['total'])})", summ['total'] > 0, "coin")}
            {_row(f"Hazırlık raporu (%{m['pct']})", m['pct'] >= 90, "flag")}
            {_row("Operasyon notları", bool(st.session_state.get("date_meta")), "box")}
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )
    st.download_button(
        "Teslim Paketini Oluştur (ZIP)",
        data=build_operation_package(base_df),
        file_name=f"gatevisa-operation-package-{datetime.now().strftime('%Y%m%d-%H%M')}.zip",
        mime="application/zip",
        type="primary",
        use_container_width=True,
        key="package_builder_zip",
    )

    with st.expander("🖨️ Yazdırılabilir manifest", expanded=False):
        render_printable_manifest(base_df)


def render_printable_manifest(base_df: pd.DataFrame) -> None:
    rows_html = "".join(
        f"<tr><td>{i + 1}</td><td>{html.escape(cell_text(r.get('Yolcu Adı Soyadı')) or '—')}</td>"
        f"<td>{html.escape(cell_text(r.get('Pasaport No')) or '—')}</td>"
        f"<td>{html.escape(cell_text(r.get('Voucher')) or '—')}</td>"
        f"<td>{html.escape(cell_text(r.get('Gidiş Tarihi')) or '—')}</td>"
        f"<td>{html.escape(cell_text(r.get('Varış Tarihi')) or '—')}</td>"
        f"<td>{'✓' if str(r.get('Foto', '') or '').strip() else '—'}</td></tr>"
        for i, (_, r) in enumerate(base_df.iterrows())
    )
    manifest_html = f"""
    <div class="print-manifest">
      <h3>Gate Visa PAX — Manifest ({datetime.now().strftime('%d.%m.%Y %H:%M')})</h3>
      <div class="manifest-scroll">
        <table class="manifest-table">
          <thead><tr><th>#</th><th>Ad Soyad</th><th>Pasaport</th><th>Voucher</th><th>Gidiş</th><th>Varış</th><th>Foto</th></tr></thead>
          <tbody>{rows_html}</tbody>
        </table>
      </div>
      <p style="margin-top:8px;font-size:0.75rem;color:#667;">Toplam {len(base_df)} yolcu</p>
      <button class="print-btn" onclick="window.print()">🖨️ Yazdır</button>
    </div>
    """
    st.markdown(manifest_html, unsafe_allow_html=True)


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
    step = 1
    if st.session_state.get("staging_df") is not None:
        step = 2
    elif st.session_state.get("read_log"):
        step = 4
    steps = ["1 Dosya", "2 Önizleme", "3 Onay", "4 Tamam"]
    st.markdown(
        '<div class="wizard-steps">'
        + "".join(
            f'<div class="wizard-step {"on" if i <= step else ""}">{label}</div>'
            for i, label in enumerate(steps, start=1)
        )
        + "</div>",
        unsafe_allow_html=True,
    )
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
            snapshot_for_undo(f"Tüm liste temizlendi ({len(st.session_state.base_df)} yolcu)")
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


def render_card_page(view_df: pd.DataFrame, state_key: str, key_prefix: str, selectable: bool = False) -> None:
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
        render_passenger_card(int(idx), row, key_prefix=key_prefix, selectable=selectable)
    render_pagination(state_key, page, pages, f"{key_prefix}_bot")


def apply_missing_filter(df: pd.DataFrame, choice: str) -> pd.DataFrame:
    if df.empty or choice == "Tümü":
        return df
    if choice == "Fotosuz":
        return df[df["Foto"].astype(str).str.strip().eq("")]
    if choice == "Pasaportsuz":
        return df[df["Pasaport No"].astype(str).str.strip().eq("")]
    if choice == "Voucher eksik":
        return df[df["Voucher"].astype(str).str.strip().eq("")]
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
        render_smart_empty_state(key_suffix="_pax")
        return

    search = st.text_input("Ara", placeholder="Ad, pasaport, voucher, tarih…", label_visibility="collapsed")

    st.markdown('<p class="section-label compact-label">Kontrol</p>', unsafe_allow_html=True)
    opt_c1, opt_c2, opt_c3 = st.columns([1, 1, 1])
    with opt_c1:
        miss_opts = ["Tümü", "Fotosuz", "Pasaportsuz", "Voucher eksik", "Ücretsiz", "Tekrarlı"]
        cur_miss = st.session_state.get("missing_filter", "Tümü")
        st.session_state.missing_filter = st.selectbox(
            "Durum",
            options=miss_opts,
            index=miss_opts.index(cur_miss) if cur_miss in miss_opts else 0,
            key="missing_filter_select",
        )
    with opt_c2:
        sort_opts = ["Varsayılan", "İsim", "Pasaport", "Gidiş Tarihi", "Ücret"]
        cur_sort = st.session_state.get("sort_by", "Varsayılan")
        st.session_state.sort_by = st.selectbox(
            "Sırala",
            options=sort_opts,
            index=sort_opts.index(cur_sort) if cur_sort in sort_opts else 0,
            key="sort_by_select",
        )
    with opt_c3:
        modes = ["Detaylı", "Kompakt", "Fotoğrafsız"]
        cur_mode = st.session_state.get("view_mode", "Detaylı")
        st.session_state.view_mode = st.selectbox(
            "Görünüm",
            options=modes,
            index=modes.index(cur_mode) if cur_mode in modes else 0,
            key="view_mode_select",
        )

    filter_count = total_active_filters()
    with st.expander(f"Gelişmiş filtreler{f' · {filter_count}' if filter_count else ''}", expanded=filter_count > 0):
        sizes = [6, 10, 20, 50]
        cur_size = int(st.session_state.get("page_size", PAGE_SIZE))
        st.session_state.page_size = st.selectbox(
            "Sayfa boyutu",
            options=sizes,
            index=sizes.index(cur_size) if cur_size in sizes else 1,
            key="page_size_select",
        )
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

    st.markdown(
        f"""
        <div class="filter-summary">
          <span>{len(view_df)} yolcu</span>
          <span>{len(st.session_state.loaded_files)} kaynak</span>
          <span>{total_active_filters()} aktif filtre</span>
        </div>
        """,
        unsafe_allow_html=True,
    )

    if view_df.empty:
        st.warning("Filtreye uyan yolcu bulunamadı.")
        return

    render_bulk_toolbar(base_df)
    st.markdown(f'<p class="section-label">{len(view_df)} yolcu</p>', unsafe_allow_html=True)
    render_card_page(view_df, "pax_page", "list", selectable=True)


def render_bulk_toolbar(base_df: pd.DataFrame) -> None:
    selected = st.session_state.get("bulk_selected", set())
    valid = sorted(i for i in selected if i in base_df.index)
    if valid != sorted(selected):
        st.session_state.bulk_selected = set(valid)
    if not valid:
        return

    sub = base_df.loc[valid]
    st.markdown(
        f'<div class="app-panel" style="border-left:3px solid var(--accent);">'
        f'<p class="app-panel-title">{icon("grid", 13)} {len(valid)} yolcu seçili</p></div>',
        unsafe_allow_html=True,
    )
    b1, b2, b3, b4 = st.columns(4)
    stamp_now = datetime.now().strftime("%Y%m%d-%H%M")
    b1.download_button(
        "Excel indir", data=dataframe_to_xlsx(sub), file_name=f"secili-yolcular-{stamp_now}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True, key="bulk_xlsx",
    )
    photo_zip = build_date_photo_zip(sub)
    if photo_zip:
        b2.download_button(
            "Foto ZIP", data=photo_zip, file_name=f"secili-fotolar-{stamp_now}.zip",
            mime="application/zip", use_container_width=True, key="bulk_photo_zip",
        )
    else:
        b2.button("Foto ZIP", disabled=True, use_container_width=True, key="bulk_photo_zip_disabled")
    if b3.button("Seçilenleri sil", use_container_width=True, key="bulk_delete"):
        snapshot_for_undo(f"{len(valid)} yolcu toplu silindi")
        st.session_state.base_df = normalize_passenger_dataframe(
            st.session_state.base_df.drop(index=valid).reset_index(drop=True)
        )
        st.session_state.bulk_selected = set()
        st.session_state.pax_page = 0
        persist()
        st.toast(f"{len(valid)} yolcu silindi", icon="🗑️")
        st.rerun()
    if b4.button("Seçimi temizle", use_container_width=True, key="bulk_clear"):
        st.session_state.bulk_selected = set()
        st.rerun()

    with st.expander(f"{len(valid)} seçili yolcuya toplu voucher ata", expanded=False):
        bulk_voucher = st.text_input("Voucher kodu", key="bulk_voucher_input")
        if st.button("Uygula", key="bulk_voucher_apply", use_container_width=True) and bulk_voucher:
            for i in valid:
                st.session_state.base_df.at[i, "Voucher"] = bulk_voucher
            st.session_state.base_df = normalize_passenger_dataframe(st.session_state.base_df)
            persist()
            st.toast("Voucher toplu güncellendi", icon="✅")
            st.rerun()


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
render_undo_banner()

base_df = normalize_passenger_dataframe(st.session_state.base_df.copy())
st.session_state.base_df = base_df

_pp_norm = base_df["Pasaport No"].astype(str).map(_norm_match) if not base_df.empty else pd.Series(dtype=str)
st.session_state.dup_passports = set(_pp_norm[_pp_norm.ne("") & _pp_norm.duplicated(keep=False)]) if len(_pp_norm) else set()

if st.session_state.selected_idx is not None and not base_df.empty:
    render_detail_view(st.session_state.base_df)
else:
    _issue_count = int(sum(1 for _, r in base_df.iterrows() if card_issues(r))) if not base_df.empty else 0
    _issues_label = "Eksikler" + (f" ({_issue_count})" if _issue_count else "")
    tab_home, tab_passengers, tab_issues, tab_gallery, tab_archive, tab_import, tab_package = st.tabs(
        ["Ana", "Yolcular", _issues_label, "Galeri", "Arşiv", "Import", "Paket"]
    )
    with tab_home:
        render_command_center(st.session_state.base_df)
    with tab_passengers:
        render_passengers_tab(st.session_state.base_df)
    with tab_issues:
        render_issues_center(st.session_state.base_df)
    with tab_gallery:
        render_photo_gallery(st.session_state.base_df)
    with tab_archive:
        render_archive_tab(st.session_state.base_df)
    with tab_import:
        render_import_tab()
    with tab_package:
        render_package_builder(st.session_state.base_df)

render_bottom_bar(st.session_state.base_df)
