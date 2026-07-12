from __future__ import annotations

import base64
import os
import re
import zipfile
from io import BytesIO

import pandas as pd

import db

try:
    from PIL import Image

    try:
        import pillow_heif  # iPhone HEIC/HEIF desteği

        pillow_heif.register_heif_opener()
    except Exception:
        pass
except Exception:  # Pillow yoksa görüntü işleme atlanır.
    Image = None  # type: ignore


def _process_image(data: bytes, max_dim: int = 480) -> tuple[bytes, str]:
    """Görüntüyü tarayıcı dostu, küçük boyutlu JPEG'e çevirir.

    iPhone HEIC fotoğrafları ve büyük dosyalar tarayıcıda kart içinde
    gösterilemez; bu yüzden hepsini standart JPEG küçük resme dönüştürürüz.
    Dönüş: (yeni bytes, yeni uzantı) — başarısızsa orijinal döner.
    """
    if Image is None:
        return data, ""
    try:
        img = Image.open(BytesIO(data))
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim))
        out = BytesIO()
        img.save(out, format="JPEG", quality=80, optimize=True)
        return out.getvalue(), ".jpg"
    except Exception:
        return data, ""


def make_thumb(data: bytes, max_dim: int, quality: int) -> bytes | None:
    """Verilen görüntü baytlarından küçük bir JPEG küçük resim üretir."""
    if Image is None:
        return None
    try:
        img = Image.open(BytesIO(data))
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim))
        out = BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue()
    except Exception:
        return None

# Biyometrik fotoğraflar diskte saklanır; veriyle birlikte kalıcıdır.
PHOTO_DIR = os.environ.get(
    "PAX_PHOTO_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".data", "photos"),
)

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"}
MAX_ZIP_IMAGE_BYTES = 25 * 1024 * 1024
MAX_ZIP_TOTAL_BYTES = 250 * 1024 * 1024
MAX_ZIP_IMAGES = 2000


def _norm_key(value: object) -> str:
    """Pasaport / isim eşleştirmesi için sadeleştirir (boşluk, noktalama, büyük/küçük harf)."""
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def is_zip(filename: str, data: bytes) -> bool:
    if filename.lower().endswith(".zip"):
        return True
    return len(data) >= 4 and data[:4] == b"PK\x03\x04"


def extract_images_from_zip(data: bytes) -> list[tuple[str, bytes]]:
    """ZIP içindeki tüm görüntüleri (alt klasörler dahil) çıkarır."""
    out: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(BytesIO(data)) as zf:
            total_bytes = 0
            for info in zf.infolist():
                if len(out) >= MAX_ZIP_IMAGES:
                    break
                if info.is_dir():
                    continue
                name = info.filename
                if "__MACOSX" in name:
                    continue
                base = os.path.basename(name)
                if not base or base.startswith("._") or base.startswith("."):
                    continue
                if info.file_size > MAX_ZIP_IMAGE_BYTES or total_bytes + info.file_size > MAX_ZIP_TOTAL_BYTES:
                    continue
                try:
                    content = zf.read(info)
                except Exception:
                    continue
                if looks_like_image(base, content):
                    out.append((base, content))
                    total_bytes += len(content)
    except Exception:
        pass
    return out


def looks_like_image(filename: str, data: bytes) -> bool:
    """Dosyanın bir görüntü olup olmadığını uzantı veya içerikten anlar.

    iOS bazen uzantısız/farklı uzantıyla yüklediği için içerik kontrolü de yapılır.
    """
    ext = os.path.splitext(filename)[1].lower()
    if ext in ALLOWED_EXT:
        return True
    # İçerik imzaları (JPEG/PNG/GIF/BMP/WEBP/HEIC)
    if len(data) >= 12:
        head = data[:12]
        if head[:3] == b"\xff\xd8\xff":  # JPEG
            return True
        if head[:8] == b"\x89PNG\r\n\x1a\n":  # PNG
            return True
        if head[:6] in (b"GIF87a", b"GIF89a"):  # GIF
            return True
        if head[:2] == b"BM":  # BMP
            return True
        if head[:4] == b"RIFF" and data[8:12] == b"WEBP":  # WEBP
            return True
        if head[4:12] in (b"ftypheic", b"ftypheix", b"ftyphevc", b"ftypmif1", b"ftypmsf1"):  # HEIC/HEIF
            return True
    # Son çare: Pillow ile açmayı dene
    if Image is not None:
        try:
            Image.open(BytesIO(data)).verify()
            return True
        except Exception:
            return False
    return False


def parse_photo_filename(filename: str) -> dict[str, str]:
    """Dosya adını TARİH_İSİM_SOYİSİM_PASAPORT formatına göre ayrıştırır."""
    base, ext = os.path.splitext(filename)
    parts = [p.strip() for p in base.split("_") if p.strip()]
    info = {"date": "", "name": "", "surname": "", "passport": "", "ext": ext.lower()}
    if not parts:
        return info
    info["date"] = parts[0]
    if len(parts) >= 2:
        info["passport"] = parts[-1]
    if len(parts) >= 3:
        info["name"] = parts[1]
    if len(parts) >= 4:
        info["surname"] = parts[2]
    return info


def _mime_for_ext(ext: str) -> str:
    ext = ext.lower().lstrip(".")
    if ext in ("jpg", "jpeg"):
        return "image/jpeg"
    return f"image/{ext or 'jpeg'}"


def save_photo_bytes(key: str, ext: str, data: bytes) -> str:
    """Fotoğrafı kaydeder (önce veritabanı, yoksa disk) ve referansı döndürür."""
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", key) or "foto"
    ext = ext.lower()
    if ext not in ALLOWED_EXT:
        ext = ".jpg"
    ref = f"{safe}{ext}"

    if db.enabled() and db.save_photo(ref, _mime_for_ext(ext), data):
        return ref

    os.makedirs(PHOTO_DIR, exist_ok=True)
    with open(os.path.join(PHOTO_DIR, ref), "wb") as handle:
        handle.write(data)
    return ref


def photo_abs_path(filename: str) -> str | None:
    if not filename:
        return None
    path = os.path.join(PHOTO_DIR, filename)
    return path if os.path.exists(path) else None


def photo_raw_bytes(filename: str) -> tuple[str, bytes] | None:
    """Kayıtlı fotoğrafın ham baytlarını (mime, data) döndürür (DB veya disk)."""
    if not filename:
        return None

    if db.enabled():
        result = db.load_photo(filename)
        if result is not None:
            mime, encoded = result
            try:
                return mime, base64.b64decode(encoded)
            except Exception:
                return None

    path = photo_abs_path(filename)
    if not path:
        return None
    try:
        with open(path, "rb") as handle:
            return _mime_for_ext(os.path.splitext(path)[1]), handle.read()
    except Exception:
        return None


def photo_data_uri(filename: str) -> str | None:
    """Kart HTML'ine gömmek için base64 data-uri üretir."""
    raw = photo_raw_bytes(filename)
    if raw is None:
        return None
    mime, data = raw
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def match_photos_to_dataframe(
    df: pd.DataFrame, uploaded: list[tuple[str, bytes]]
) -> tuple[pd.DataFrame, int, list[str]]:
    """Yüklenen fotoğrafları yolculara bağlar.

    Eşleştirme konumdan bağımsızdır: dosya adının tamamı sadeleştirilip
    (boşluk/noktalama/Türkçe karakterler atılarak) içinde pasaport numarası
    veya ad+soyad geçen yolcu bulunur. Böylece TARİH_İSİM_SOYİSİM_PASAPORT
    sırası bozulsa bile eşleşir.

    Dönüş: (güncellenmiş df, eşleşen sayısı, eşleşmeyen dosya adları)
    """
    if df.empty or not uploaded:
        return df, 0, [name for name, _ in uploaded]

    out = df.copy()
    if "Foto" not in out.columns:
        out["Foto"] = ""

    matched = 0
    unmatched: list[str] = []
    for filename, data in uploaded:
        target, _, _ = find_photo_target(out, filename)
        _, ext = os.path.splitext(filename)
        info = parse_photo_filename(filename)
        ext = info["ext"] or ext

        if target is None:
            unmatched.append(filename)
            continue

        key = _norm_key(out.at[target, "Pasaport No"]) or f"row{target}"
        processed, new_ext = _process_image(data)
        stored = save_photo_bytes(key, new_ext or ext, processed)
        out.at[target, "Foto"] = stored
        matched += 1

    return out, matched, unmatched


def find_photo_target(df: pd.DataFrame, filename: str) -> tuple[int | None, str, int]:
    """Dosya adi icin en guvenli yolcu eslesmesini ve guven puanini dondurur."""
    if df.empty:
        return None, "", 0
    base, _ = os.path.splitext(filename)
    full = _norm_key(base)
    rows = []
    for idx, row in df.iterrows():
        rows.append(
            {
                "idx": int(idx),
                "passport": _norm_key(row.get("Pasaport No")),
                "full_name": _norm_key(str(row.get("Ad", "")) + str(row.get("Soyad", ""))),
                "name": _norm_key(row.get("Ad", "")),
                "surname": _norm_key(row.get("Soyad", "")),
            }
        )

    target: int | None = None
    best_len = 0
    for row in rows:
        passport = row["passport"]
        if passport and len(passport) >= 4 and passport in full and len(passport) > best_len:
            target = row["idx"]
            best_len = len(passport)
    if target is not None:
        return target, "passport", 100

    for row in rows:
        if row["full_name"] and len(row["full_name"]) >= 4 and row["full_name"] in full:
            return row["idx"], "full_name", 90

    for row in rows:
        if row["name"] and row["surname"] and row["name"] in full and row["surname"] in full:
            return row["idx"], "name_parts", 75
    return None, "", 0


def match_photos_with_details(
    df: pd.DataFrame,
    uploaded: list[tuple[str, bytes]],
) -> tuple[pd.DataFrame, list[dict], list[tuple[str, bytes]]]:
    out = df.copy()
    matches: list[dict] = []
    unmatched: list[tuple[str, bytes]] = []
    for filename, data in uploaded:
        target, method, confidence = find_photo_target(out, filename)
        if target is None:
            unmatched.append((filename, data))
            continue
        processed, new_ext = _process_image(data)
        _, original_ext = os.path.splitext(filename)
        key = _norm_key(out.at[target, "Pasaport No"]) or f"row{target}"
        stored = save_photo_bytes(key, new_ext or original_ext, processed)
        out.at[target, "Foto"] = stored
        matches.append(
            {
                "filename": filename,
                "passenger_id": int(target),
                "passenger_name": str(out.at[target, "Yolcu Adı Soyadı"] or "Yolcu"),
                "method": method,
                "confidence": confidence,
            }
        )
    return out, matches, unmatched
