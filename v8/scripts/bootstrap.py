from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.database import get_session_factory
from app.models import Membership, Organization, Role, User


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the first Excelbase V8 organization and owner.")
    parser.add_argument("--organization", required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--display-name", required=True)
    args = parser.parse_args()

    db = get_session_factory()()
    try:
        organization = db.scalar(select(Organization).where(Organization.slug == args.slug))
        if organization is None:
            organization = Organization(name=args.organization, slug=args.slug)
            db.add(organization)
            db.flush()

        email = args.email.casefold().strip()
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(email=email, display_name=args.display_name)
            db.add(user)
            db.flush()

        membership = db.scalar(
            select(Membership).where(
                Membership.organization_id == organization.id,
                Membership.user_id == user.id,
            )
        )
        if membership is None:
            membership = Membership(
                organization_id=organization.id,
                user_id=user.id,
                role=Role.OWNER.value,
            )
            db.add(membership)
        else:
            membership.role = Role.OWNER.value
            membership.is_active = True
        db.commit()
        print("Bootstrap completed.")
        print(f"organization_id={organization.id}")
        print(f"user_id={user.id}")
        print("Development headers:")
        print(f"X-Organization-ID: {organization.id}")
        print(f"X-User-ID: {user.id}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
