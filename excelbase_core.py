from __future__ import annotations

import io
import re
from dataclasses import dataclass
from typing import Any, Iterable

import pandas as pd


DEFAULT_PRESET = "Excel başlıklarını aynen al"

PRESETS: dict[str, list[str] | None] = {
    DEFAULT_PRESET: None,
    "Kapı Vizesi": [
        "Başvuru Tarihi",
        "Yolcu Adı Soyadı",
        "Pasaport No",
        "Telefon",
        "E-posta",
        "Hat / Ada",
        "Gidiş Tarihi",
        "Dönüş Tarihi",
        "Acente / Kanal",
        "Durum",
        "Not",
        "Kaynak Dosya",
        "Sayfa",
    ],
    "Feribot Satış": [
        "Satış Tarihi",
        "Yolcu Adı Soyadı",
        "Hat",
        "Sefer Tarihi",
        "PNR / Bilet No",
        "Satış Kanalı",
        "Acente",
        "Tutar",
        "Para Birimi",
        "Durum",
        "Kaynak Dosya",
        "Sayfa",
    ],
    "CRM / Genel Liste": [
        "Tarih",
        "Müşteri",
        "Telefon",
        "E-posta",
        "Kanal",
        "Ürün / Hat",
        "Tutar",
        "Durum",
        "Not",
        "Kaynak Dosya",
        "Sayfa",
    ],
}

SYNONYMS: dict[str, list[str]] = {
    "Başvuru Tarihi": ["basvuru", "başvuru", "application date", "apply date", "created", "tarih"],
    "Satış Tarihi": ["satış tarihi", "satis tarihi", "sale date", "sales date", "booking date", "tarih"],
    "Tarih": ["date", "tarih", "created", "işlem tarihi", "islem tarihi"],
    "Yolcu Adı Soyadı": ["yolcu", "ad soyad", "adı soyadı", "adi soyadi", "passenger", "passenger name", "name", "full name", "isim", "müşteri", "musteri"],
    "Müşteri": ["müşteri", "musteri", "customer", "client", "name", "ad soyad", "yolcu"],
    "Pasaport No": ["pasaport", "passport", "passport no", "document", "doc no", "kimlik", "id no"],
    "Telefon": ["telefon", "phone", "gsm", "mobile", "cep", "tel", "contact"],
    "E-posta": ["email", "e mail", "mail", "eposta", "e-posta"],
    "Hat / Ada": ["ada", "hat", "route", "line", "destination", "destinasyon", "island", "rota"],
    "Hat": ["hat", "route", "line", "rota", "destination", "destinasyon", "sefer"],
    "Sefer Tarihi": ["sefer tarihi", "gidiş tarihi", "gidis tarihi", "departure", "departure date", "sailing", "travel date"],
    "Gidiş Tarihi": ["gidiş", "gidis", "departure", "departure date", "start date", "travel date"],
    "Dönüş Tarihi": ["dönüş", "donus", "return", "return date", "end date"],
    "PNR / Bilet No": ["pnr", "bilet", "ticket", "ticket no", "reservation", "rezervasyon", "voucher", "booking no"],
    "Satış Kanalı": ["satış kanalı", "satis kanali", "sales channel", "kanal", "channel", "source", "platform"],
    "Acente / Kanal": ["acente", "agency", "agent", "kanal", "channel", "source", "platform"],
    "Acente": ["acente", "agency", "agent", "firma"],
    "Kanal": ["kanal", "channel", "source", "platform", "lead source"],
    "Ürün / Hat": ["ürün", "urun", "product", "hat", "route", "line", "service"],
    "Tutar": ["tutar", "amount", "total", "price", "fare", "sales", "revenue", "gross", "ücret", "ucret", "bedel"],
    "Para Birimi": ["para birimi", "currency", "curr", "döviz", "doviz", "pb"],
    "Durum": ["durum", "status", "state", "stage", "sonuç", "sonuc"],
    "Not": ["not", "note", "notes", "remark", "remarks", "açıklama", "aciklama"],
}

@dataclass
class ReadResult:
    file_name: str
    sheet_name: str
    rows: int
    columns: int
    dataframe: pd.DataFrame


def normalize(value: Any) -> str:
    text = str(value if value is not None else "").lower().strip()
    table = str.maketrans("çğıöşüâîûÇĞİÖŞÜÂÎÛ", "cgiosuaiuCGIOSUAIU")
    text = text.translate(table)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def make_unique_columns(columns: Iterable[Any]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for idx, column in enumerate(columns, start=1):
        base = str(column).strip()
        if not base or base.lower() == "nan":
            base = f"Kolon {idx}"
        key = normalize(base) or f"kolon {idx}"
        seen[key] = seen.get(key, 0) + 1
        out.append(base if seen[key] == 1 else f"{base} {seen[key]}")
    return out


def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df = df.dropna(how="all")
    df = df.dropna(axis=1, how="all")
    df.columns = make_unique_columns(df.columns)
    # Convert Excel timestamps and values to stable editable strings, but keep empty values blank.
    for col in df.columns:
        df[col] = df[col].map(lambda x: "" if pd.isna(x) else x)
    return df.reset_index(drop=True)


def read_csv_bytes(raw: bytes) -> pd.DataFrame:
    # Try common encodings and delimiters. sep=None handles comma/semicolon/tab in many real files.
    encodings = ["utf-8-sig", "utf-8", "cp1254", "latin1"]
    last_error: Exception | None = None
    for enc in encodings:
        try:
            text = raw.decode(enc)
            try:
                return clean_dataframe(pd.read_csv(io.StringIO(text), sep=None, engine="python", dtype=object))
            except Exception:
                for sep in [";", ",", "\t"]:
                    try:
                        return clean_dataframe(pd.read_csv(io.StringIO(text), sep=sep, dtype=object))
                    except Exception as exc:
                        last_error = exc
        except Exception as exc:
            last_error = exc
    raise ValueError(f"CSV okunamadı: {last_error}")


def read_file_bytes(file_name: str, raw: bytes) -> list[ReadResult]:
    lower = file_name.lower()
    if lower.endswith(".csv"):
        df = read_csv_bytes(raw)
        return [ReadResult(file_name, "CSV", len(df), len(df.columns), df)]
    if not lower.endswith((".xlsx", ".xls", ".xlsm", ".ods")):
        raise ValueError("Desteklenen dosya türleri: .xlsx, .xls, .xlsm, .ods, .csv")

    try:
        excel = pd.ExcelFile(io.BytesIO(raw))
    except Exception as exc:
        raise ValueError(f"Excel dosyası açılamadı: {exc}") from exc

    results: list[ReadResult] = []
    for sheet in excel.sheet_names:
        try:
            df = pd.read_excel(excel, sheet_name=sheet, dtype=object)
            df = clean_dataframe(df)
            if len(df) > 0 and len(df.columns) > 0:
                results.append(ReadResult(file_name, str(sheet), len(df), len(df.columns), df))
        except Exception as exc:
            # Keep app usable even if one sheet is broken.
            results.append(ReadResult(file_name, str(sheet), 0, 0, pd.DataFrame({"Hata": [f"Sayfa okunamadı: {exc}"]})))
    if not results:
        raise ValueError("Dosyada okunabilir tablo bulunamadı.")
    return results


def best_header_match(target: str, headers: list[str]) -> str | None:
    target_n = normalize(target)
    candidates = [target_n] + [normalize(x) for x in SYNONYMS.get(target, [])]
    best_header = None
    best_score = 0
    for header in headers:
        h = normalize(header)
        if not h:
            continue
        if h == target_n:
            score = 100
        elif h in candidates:
            score = 95
        elif any(c and (c in h or h in c) for c in candidates):
            score = 80
        else:
            score = 20 * len(set(target_n.split()) & set(h.split()))
        if score > best_score:
            best_score = score
            best_header = header
    return best_header if best_score >= 40 else None


def apply_preset(df: pd.DataFrame, preset_columns: list[str], file_name: str, sheet_name: str) -> pd.DataFrame:
    headers = list(df.columns)
    out = pd.DataFrame(index=df.index)
    for col in preset_columns:
        if col == "Kaynak Dosya":
            out[col] = file_name
        elif col == "Sayfa":
            out[col] = sheet_name
        else:
            match = best_header_match(col, headers)
            out[col] = df[match] if match else ""
    return out.reset_index(drop=True)


def merge_results(results: list[ReadResult], mode: str) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    preset_columns = PRESETS.get(mode)
    for result in results:
        df = result.dataframe.copy()
        if preset_columns is None:
            df["Kaynak Dosya"] = result.file_name
            df["Sayfa"] = result.sheet_name
        else:
            df = apply_preset(df, preset_columns, result.file_name, result.sheet_name)
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True).fillna("")


def normalize_for_export(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.columns = make_unique_columns(out.columns)
    for col in out.columns:
        out[col] = out[col].map(lambda x: "" if pd.isna(x) else x)
    return out


def dataframe_to_xlsx(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    export_df = normalize_for_export(df)
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        export_df.to_excel(writer, index=False, sheet_name="Base")
        worksheet = writer.sheets["Base"]
        for idx, column in enumerate(export_df.columns, start=1):
            max_len = max([len(str(column))] + [len(str(v)) for v in export_df[column].head(250).tolist()])
            worksheet.column_dimensions[worksheet.cell(1, idx).column_letter].width = min(max(max_len + 2, 10), 34)
        worksheet.freeze_panes = "A2"
        worksheet.auto_filter.ref = worksheet.dimensions
    return buf.getvalue()


def dataframe_to_csv(df: pd.DataFrame) -> bytes:
    return normalize_for_export(df).to_csv(index=False, sep=";", encoding="utf-8-sig").encode("utf-8-sig")
