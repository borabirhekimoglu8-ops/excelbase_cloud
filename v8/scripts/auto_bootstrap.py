"""Optional, idempotent startup bootstrap for single-tenant deployments.

When the V8_BOOTSTRAP_* environment variables are set, this script ensures the
organization, owner user and membership exist, and (if V8_JWT_SECRET is
configured) prints a login JWT to the service logs so the owner can sign in
from the /v8 page without shell access. Safe to run on every container start.
"""
from __future__ import annotations

import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> None:
    organization_name = os.getenv("V8_BOOTSTRAP_ORGANIZATION", "").strip()
    slug = os.getenv("V8_BOOTSTRAP_SLUG", "").strip()
    email = os.getenv("V8_BOOTSTRAP_EMAIL", "").strip().casefold()
    display_name = os.getenv("V8_BOOTSTRAP_DISPLAY_NAME", "").strip()
    if not (organization_name and slug and email and display_name):
        print("auto-bootstrap: V8_BOOTSTRAP_* degiskenleri tanimli degil; atlaniyor.")
        return

    from sqlalchemy import select

    from app.config import get_settings
    from app.database import get_session_factory
    from app.models import Membership, Organization, Role, User

    db = get_session_factory()()
    try:
        organization = db.scalar(select(Organization).where(Organization.slug == slug))
        if organization is None:
            organization = Organization(name=organization_name, slug=slug)
            db.add(organization)
            db.flush()

        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(email=email, display_name=display_name)
            db.add(user)
            db.flush()

        membership = db.scalar(
            select(Membership).where(
                Membership.organization_id == organization.id,
                Membership.user_id == user.id,
            )
        )
        if membership is None:
            db.add(
                Membership(
                    organization_id=organization.id,
                    user_id=user.id,
                    role=Role.OWNER.value,
                )
            )
        else:
            membership.role = Role.OWNER.value
            membership.is_active = True
        db.commit()

        print("auto-bootstrap: hazir.")
        print(f"auto-bootstrap: organization_id={organization.id}")
        print(f"auto-bootstrap: user_id={user.id}")

        settings = get_settings()
        if settings.jwt_secret:
            import jwt

            ttl_days = int(os.getenv("V8_BOOTSTRAP_TOKEN_TTL_DAYS", "90"))
            now = datetime.now(UTC)
            token = jwt.encode(
                {
                    "sub": str(user.id),
                    "org": str(organization.id),
                    "iss": settings.jwt_issuer,
                    "aud": settings.jwt_audience,
                    "iat": now,
                    "exp": now + timedelta(days=ttl_days),
                },
                settings.jwt_secret,
                algorithm="HS256",
            )
            print(f"auto-bootstrap: giris tokeni ({ttl_days} gun gecerli).")
            print("auto-bootstrap: /v8 sayfasindaki JWT alanina asagidaki degeri yapistirin:")
            print(token)
        else:
            print("auto-bootstrap: V8_JWT_SECRET tanimli degil; token uretilmedi.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
