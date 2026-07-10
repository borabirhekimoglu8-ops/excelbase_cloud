from __future__ import annotations

import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.security import generate_fernet_key


if __name__ == "__main__":
    print(f"V8_FIELD_ENCRYPTION_KEY={generate_fernet_key()}")
    print(f"V8_PASSPORT_HMAC_KEY={secrets.token_urlsafe(48)}")
