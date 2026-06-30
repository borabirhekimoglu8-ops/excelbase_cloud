from __future__ import annotations

import base64
import os
import re

import pandas as pd

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


def save_photo_bytes(key: str, ext: str, data: bytes) -> str:
    """Fotoğrafı diske kaydeder ve kayıtlı dosya adını döndürür."""
    os.makedirs(PHOTO_DIR, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", key) or "foto"
    ext = ext.lower()
    if ext not in ALLOWED_EXT:
        ext = ".jpg"
    filename = f"{safe}{ext}"
    with open(os.path.join(PHOTO_DIR, filename), "wb") as handle:
        handle.write(data)
    return filename


def photo_abs_path(filename: str) -> str | None:
    if not filename:
        return None
    path = os.path.join(PHOTO_DIR, filename)
    return path if os.path.exists(path) else None


def photo_data_uri(filename: str) -> str | None:
    """Kart HTML'ine gömmek için base64 data-uri üretir."""
    path = photo_abs_path(filename)
    if not path:
        return None
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    mime = "image/jpeg" if ext in ("jpg", "jpeg") else f"image/{ext or 'jpeg'}"
    try:
        with open(path, "rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("ascii")
    except Exception:
        return None
    return f"data:{mime};base64,{encoded}"


def match_photos_to_dataframe(
    df: pd.DataFrame, uploaded: list[tuple[str, bytes]]
) -> tuple[pd.DataFrame, int, list[str]]:
    """Yüklenen fotoğrafları pasaport/isim eşleştirmesiyle yolculara bağlar.

    Dönüş: (güncellenmiş df, eşleşen sayısı, eşleşmeyen dosya adları)
    """
    if df.empty or not uploaded:
        return df, 0, [name for name, _ in uploaded]

    out = df.copy()
    if "Foto" not in out.columns:
        out["Foto"] = ""

    passport_map: dict[str, int] = {}
    name_map: dict[str, int] = {}
    for idx, row in out.iterrows():
        pkey = _norm_key(row.get("Pasaport No"))
        if pkey:
            passport_map[pkey] = idx
        nkey = _norm_key(str(row.get("Ad", "")) + str(row.get("Soyad", "")))
        if nkey:
            name_map.setdefault(nkey, idx)

    matched = 0
    unmatched: list[str] = []
    for filename, data in uploaded:
        info = parse_photo_filename(filename)
        target: int | None = None

        pkey = _norm_key(info["passport"])
        if pkey and pkey in passport_map:
            target = passport_map[pkey]

        if target is None and (info["name"] or info["surname"]):
            nkey = _norm_key(info["name"] + info["surname"])
            if nkey in name_map:
                target = name_map[nkey]

        if target is None:
            unmatched.append(filename)
            continue

        key = pkey or _norm_key(str(out.at[target, "Pasaport No"])) or f"row{target}"
        stored = save_photo_bytes(key, info["ext"], data)
        out.at[target, "Foto"] = stored
        matched += 1

    return out, matched, unmatched
