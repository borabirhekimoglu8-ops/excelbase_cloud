from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.import_adapter import _date, _money, _text
from app.ratelimit import SlidingWindowLimiter
from app.security import SensitiveFieldCodec, generate_fernet_key


def test_money_parses_turkish_and_english_formats():
    assert _money("60,50") == Decimal("60.50")
    assert _money("1.250,75") == Decimal("1250.75")
    assert _money("60.50") == Decimal("60.50")
    assert _money("€ 45") == Decimal("45.00")
    assert _money("") == Decimal("0.00")
    assert _money("not-a-number") == Decimal("0.00")


def test_date_parses_common_formats_and_rejects_garbage():
    assert _date("17.07.2026") == date(2026, 7, 17)
    assert _date("17/07/2026") == date(2026, 7, 17)
    assert _date("2026-07-17") == date(2026, 7, 17)
    assert _date("17-07-2026") == date(2026, 7, 17)
    assert _date("gibberish") is None
    assert _date("") is None
    assert _date(None) is None


def test_text_normalizes_nan_and_whitespace():
    assert _text("  hello ") == "hello"
    assert _text("NaN") == ""
    assert _text(None) == ""
    assert _text(42) == "42"


def test_sliding_window_limiter_blocks_after_limit():
    limiter = SlidingWindowLimiter(limit_per_minute=3)
    for _ in range(3):
        limiter.check("tenant:user")
    with pytest.raises(HTTPException) as excinfo:
        limiter.check("tenant:user")
    assert excinfo.value.status_code == 429
    assert "Retry-After" in (excinfo.value.headers or {})
    # Another key is unaffected.
    limiter.check("tenant:other-user")


def test_codec_key_rotation_reads_old_key_writes_new_key():
    old_key = generate_fernet_key()
    new_key = generate_fernet_key()
    hmac_key = "unit-test-hmac-key-that-is-longer-than-32-bytes"

    old_codec = SensitiveFieldCodec((("k1", old_key),), hmac_key)
    ciphertext_v1 = old_codec.encrypt_passport("U12345678")

    rotated = SensitiveFieldCodec((("k2", new_key), ("k1", old_key)), hmac_key)
    assert rotated.decrypt_passport(ciphertext_v1) == "U12345678"
    assert rotated.needs_rotation(ciphertext_v1) is True

    ciphertext_v2 = rotated.encrypt_passport("U12345678")
    assert ciphertext_v2.startswith("v8:k2:")
    assert rotated.needs_rotation(ciphertext_v2) is False
    assert rotated.decrypt_passport(ciphertext_v2) == "U12345678"

    # A codec that no longer has the old key must fail clearly.
    new_only = SensitiveFieldCodec((("k2", new_key),), hmac_key)
    with pytest.raises(RuntimeError):
        new_only.decrypt_passport(ciphertext_v1)


def test_codec_reads_legacy_ciphertext_without_envelope():
    key = generate_fernet_key()
    hmac_key = "unit-test-hmac-key-that-is-longer-than-32-bytes"
    codec = SensitiveFieldCodec((("k1", key),), hmac_key)
    from cryptography.fernet import Fernet

    legacy = Fernet(key.encode("ascii")).encrypt(b"U12345678").decode("ascii")
    assert codec.decrypt_passport(legacy) == "U12345678"
    assert codec.needs_rotation(legacy) is True
