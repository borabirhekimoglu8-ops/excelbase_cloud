"""Issues a short-lived HS256 JWT for the V8 API.

Intended for operational use (staging smoke tests, initial rollout) until a
full OIDC provider is connected. The signing secret comes from V8_JWT_SECRET.
"""
from __future__ import annotations

import argparse
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import jwt

from app.config import get_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Issue a development/staging JWT for the V8 API.")
    parser.add_argument("--user-id", required=True, type=uuid.UUID)
    parser.add_argument("--organization-id", required=True, type=uuid.UUID)
    parser.add_argument("--ttl-minutes", type=int, default=60)
    args = parser.parse_args()

    settings = get_settings()
    if not settings.jwt_secret:
        raise SystemExit("V8_JWT_SECRET tanımlı değil.")

    now = datetime.now(UTC)
    token = jwt.encode(
        {
            "sub": str(args.user_id),
            "org": str(args.organization_id),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "iat": now,
            "exp": now + timedelta(minutes=args.ttl_minutes),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    print(token)


if __name__ == "__main__":
    main()
