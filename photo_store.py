from __future__ import annotations

import base64
import os
import re
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


def _process_image(data: bytes, max_dim: int = 720) -> tuple[bytes, str]:
    """Görüntüyü tarayıcı dostu, küçük boyutlu JPEG'e çevirir.

    iPhone HEIC fotoğrafları ve büyük dosyalar tarayıcıda kart içinde
    gösterilemez; bu yüzden hepsini standart JPEG küçük resme dönüştürürüz.
    Dönüş: (yeni bytes, yeni uzantı) — başarısızsa orijinal döner.
    """
    if Image is None:
        return data, ""
    try:
        img = Image.open(BytesIO(data))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        elif img.mode == "L":
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim))
        out = BytesIO()
        img.save(out, format="JPEG", quality=82, optimize=True)
        return out.getvalue(), ".jpg"
    except Exception:
        return data, ""

# Biyometrik fotoğraflar diskte saklanır; veriyle birlikte kalıcıdır.
PHOTO_DIR = os.environ.get(
    "PAX_PHOTO_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), ".data", "photos"),
)

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"}


def _norm_key(value: object) -> str:
    """Pasaport / isim eşleştirmesi için sadeleştirir (boşluk, noktalama, büyük/küçük harf)."""
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


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


def photo_data_uri(filename: str) -> str | None:
    """Kart HTML'ine gömmek için base64 data-uri üretir."""
    if not filename:
        return None

    if db.enabled():
        result = db.load_photo(filename)
        if result is not None:
            mime, encoded = result
            return f"data:{mime};base64,{encoded}"

    path = photo_abs_path(filename)
    if not path:
        return None
    ext = os.path.splitext(path)[1]
    try:
        with open(path, "rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("ascii")
    except Exception:
        return None
    return f"data:{_mime_for_ext(ext)};base64,{encoded}"


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

    # Yolcu anahtarlarını önceden hesapla
    rows = []
    for idx, row in out.iterrows():
        rows.append(
            {
                "idx": idx,
                "passport": _norm_key(row.get("Pasaport No")),
                "full_name": _norm_key(str(row.get("Ad", "")) + str(row.get("Soyad", ""))),
                "name": _norm_key(row.get("Ad", "")),
                "surname": _norm_key(row.get("Soyad", "")),
            }
        )

    matched = 0
    unmatched: list[str] = []
    for filename, data in uploaded:
        base, ext = os.path.splitext(filename)
        full = _norm_key(base)
        info = parse_photo_filename(filename)
        ext = info["ext"] or ext
        target: int | None = None

        # 1) Pasaport numarası dosya adının herhangi bir yerinde geçiyorsa (en uzun eşleşme)
        best_len = 0
        for r in rows:
            pp = r["passport"]
            if pp and len(pp) >= 4 and pp in full and len(pp) > best_len:
                target = r["idx"]
                best_len = len(pp)

        # 2) Ad+Soyad bitişik geçiyorsa
        if target is None:
            for r in rows:
                if r["full_name"] and len(r["full_name"]) >= 4 and r["full_name"] in full:
                    target = r["idx"]
                    break

        # 3) Ad ve Soyad ayrı ayrı geçiyorsa
        if target is None:
            for r in rows:
                if r["name"] and r["surname"] and r["name"] in full and r["surname"] in full:
                    target = r["idx"]
                    break

        if target is None:
            unmatched.append(filename)
            continue

        key = _norm_key(out.at[target, "Pasaport No"]) or f"row{target}"
        processed, new_ext = _process_image(data)
        stored = save_photo_bytes(key, new_ext or ext, processed)
        out.at[target, "Foto"] = stored
        matched += 1

    return out, matched, unmatched
