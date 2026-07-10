from __future__ import annotations

import base64
import hashlib
import hmac
import re
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings


_NORMALIZE_RE = re.compile(r"[^A-Z0-9]")


def normalize_passport(value: str) -> str:
    return _NORMALIZE_RE.sub("", value.upper().strip())


class SensitiveFieldCodec:
    def __init__(self, encryption_key: str, hmac_key: str) -> None:
        if not encryption_key:
            raise RuntimeError("V8_FIELD_ENCRYPTION_KEY yapılandırılmamış.")
        if len(hmac_key.encode("utf-8")) < 32:
            raise RuntimeError("V8_PASSPORT_HMAC_KEY en az 32 byte olmalıdır.")
        try:
            self._fernet = Fernet(encryption_key.encode("ascii"))
        except (ValueError, TypeError) as exc:
            raise RuntimeError("V8_FIELD_ENCRYPTION_KEY geçerli bir Fernet anahtarı değil.") from exc
        self._hmac_key = hmac_key.encode("utf-8")

    def encrypt_passport(self, passport_no: str) -> str:
        normalized = normalize_passport(passport_no)
        if not normalized:
            raise ValueError("Pasaport numarası boş olamaz.")
        return self._fernet.encrypt(normalized.encode("utf-8")).decode("ascii")

    def decrypt_passport(self, ciphertext: str) -> str:
        try:
            return self._fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError) as exc:
            raise RuntimeError("Şifreli pasaport alanı çözülemedi.") from exc

    def passport_hash(self, passport_no: str) -> str:
        normalized = normalize_passport(passport_no)
        if not normalized:
            raise ValueError("Pasaport numarası boş olamaz.")
        return hmac.new(self._hmac_key, normalized.encode("utf-8"), hashlib.sha256).hexdigest()


@lru_cache(maxsize=1)
def get_codec() -> SensitiveFieldCodec:
    settings = get_settings()
    return SensitiveFieldCodec(settings.field_encryption_key, settings.passport_hmac_key)


def reset_codec_cache() -> None:
    get_codec.cache_clear()


def generate_fernet_key() -> str:
    return Fernet.generate_key().decode("ascii")


def generate_hmac_key() -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(Fernet.generate_key()).digest()).decode("ascii")
