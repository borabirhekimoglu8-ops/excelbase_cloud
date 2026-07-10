from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .models import Membership, Organization, Role, User


@dataclass(frozen=True, slots=True)
class IdentityContext:
    user_id: uuid.UUID
    organization_id: uuid.UUID
    role: Role


DbSession = Annotated[Session, Depends(get_db)]


def get_identity(
    db: DbSession,
    x_user_id: Annotated[str | None, Header(alias="X-User-ID")] = None,
    x_organization_id: Annotated[str | None, Header(alias="X-Organization-ID")] = None,
) -> IdentityContext:
    settings = get_settings()
    if not settings.allow_dev_identity:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Production identity provider yapılandırılmadı; dev identity kapalı.",
        )
    try:
        user_id = uuid.UUID(x_user_id or "")
        organization_id = uuid.UUID(x_organization_id or "")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Kimlik başlıkları eksik veya geçersiz.") from exc

    row = db.execute(
        select(Membership, User, Organization)
        .join(User, User.id == Membership.user_id)
        .join(Organization, Organization.id == Membership.organization_id)
        .where(
            Membership.user_id == user_id,
            Membership.organization_id == organization_id,
            Membership.is_active.is_(True),
            User.is_active.is_(True),
            Organization.is_active.is_(True),
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu organizasyon için aktif üyelik bulunamadı.")
    membership = row[0]
    try:
        role = Role(membership.role)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Üyelik rolü geçersiz.") from exc
    return IdentityContext(user_id=user_id, organization_id=organization_id, role=role)


Identity = Annotated[IdentityContext, Depends(get_identity)]


def require_roles(*allowed: Role):
    allowed_set = set(allowed)

    def dependency(identity: Identity) -> IdentityContext:
        if identity.role not in allowed_set:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu işlem için yetkiniz yok.")
        return identity

    return dependency


READ_ROLES = tuple(Role)
WRITE_ROLES = (Role.OWNER, Role.MANAGER, Role.OPERATOR)
REVIEW_ROLES = (Role.OWNER, Role.MANAGER, Role.REVIEWER)
AUDIT_ROLES = (Role.OWNER, Role.MANAGER, Role.AUDITOR)
