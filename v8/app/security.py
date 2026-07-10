from __future__ import annotations

import base64
import hashlib
import hmac
import re
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings


_NORMALIZE_RE = re.compile(r"[^A-Z0-9]")

# Ciphertexts are stored as "v8:<key_id>:<fernet_token>" so keys can be rotated:
# new writes always use the first configured key, reads resolve the key by its id.
_CIPHERTEXT_PREFIX = "v8"


def normalize_passport(value: str) -> str:
    return _NORMALIZE_RE.sub("", value.upper().strip())


def _fernet_from_secret(key_id: str, secret: str) -> Fernet:
    """Accepts either a proper Fernet key or any high-entropy secret.

    Secret managers (e.g. Render generateValue) produce random strings that are
    not Fernet-formatted; those are deterministically stretched with SHA-256 so
    the same secret always yields the same key.
    """
    try:
        return Fernet(secret.encode("ascii"))
    except (ValueError, TypeError):
        pass
    if len(secret.encode("utf-8")) < 32:
        raise RuntimeError(
            f"'{key_id}' şifreleme anahtarı geçersiz: Fernet anahtarı ya da en az 32 karakterlik bir gizli değer olmalıdır."
        )
    derived = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(derived)


class SensitiveFieldCodec:
    def __init__(self, encryption_keys: tuple[tuple[str, str], ...], hmac_key: str) -> None:
        if not encryption_keys:
            raise RuntimeError("V8_FIELD_ENCRYPTION_KEY veya V8_FIELD_ENCRYPTION_KEYS yapılandırılmamış.")
        if len(hmac_key.encode("utf-8")) < 32:
            raise RuntimeError("V8_PASSPORT_HMAC_KEY en az 32 byte olmalıdır.")
        self._fernets: dict[str, Fernet] = {}
        for key_id, key in encryption_keys:
            if ":" in key_id:
                raise RuntimeError("Şifreleme anahtarı kimliği ':' içeremez.")
            self._fernets[key_id] = _fernet_from_secret(key_id, key)
        self._active_key_id = encryption_keys[0][0]
        self._hmac_key = hmac_key.encode("utf-8")

    @property
    def active_key_id(self) -> str:
        return self._active_key_id

    def encrypt_passport(self, passport_no: str) -> str:
        normalized = normalize_passport(passport_no)
        if not normalized:
            raise ValueError("Pasaport numarası boş olamaz.")
        token = self._fernets[self._active_key_id].encrypt(normalized.encode("utf-8")).decode("ascii")
        return f"{_CIPHERTEXT_PREFIX}:{self._active_key_id}:{token}"

    def decrypt_passport(self, ciphertext: str) -> str:
        prefix, _, remainder = ciphertext.partition(":")
        if prefix == _CIPHERTEXT_PREFIX and remainder:
            key_id, _, token = remainder.partition(":")
            fernet = self._fernets.get(key_id)
            if fernet is None:
                raise RuntimeError(f"Şifreli alan '{key_id}' anahtarıyla yazılmış; anahtar yapılandırmada yok.")
            try:
                return fernet.decrypt(token.encode("ascii")).decode("utf-8")
            except (InvalidToken, ValueError) as exc:
                raise RuntimeError("Şifreli pasaport alanı çözülemedi.") from exc
        # Legacy ciphertext without a key-id envelope: try every configured key.
        for fernet in self._fernets.values():
            try:
                return fernet.decrypt(ciphertext.encode("ascii")).decode("utf-8")
            except (InvalidToken, ValueError):
                continue
        raise RuntimeError("Şifreli pasaport alanı çözülemedi.")

    def needs_rotation(self, ciphertext: str) -> bool:
        prefix, _, remainder = ciphertext.partition(":")
        if prefix != _CIPHERTEXT_PREFIX or not remainder:
            return True
        key_id, _, _ = remainder.partition(":")
        return key_id != self._active_key_id

    def passport_hash(self, passport_no: str) -> str:
        normalized = normalize_passport(passport_no)
        if not normalized:
            raise ValueError("Pasaport numarası boş olamaz.")
        return hmac.new(self._hmac_key, normalized.encode("utf-8"), hashlib.sha256).hexdigest()


@lru_cache(maxsize=1)
def get_codec() -> SensitiveFieldCodec:
    settings = get_settings()
    return SensitiveFieldCodec(settings.field_encryption_keys, settings.passport_hmac_key)


def reset_codec_cache() -> None:
    get_codec.cache_clear()


def generate_fernet_key() -> str:
    return Fernet.generate_key().decode("ascii")


def generate_hmac_key() -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(Fernet.generate_key()).digest()).decode("ascii")
