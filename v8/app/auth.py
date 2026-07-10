from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
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


def _resolve_membership(db: Session, user_id: uuid.UUID, organization_id: uuid.UUID) -> IdentityContext:
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


def _identity_from_bearer(db: Session, token: str) -> IdentityContext:
    settings = get_settings()
    if not settings.jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT doğrulaması yapılandırılmadı (V8_JWT_SECRET eksik).",
        )
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Geçersiz veya süresi dolmuş token.") from exc
    try:
        user_id = uuid.UUID(str(claims.get("sub", "")))
        organization_id = uuid.UUID(str(claims.get("org", "")))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token kimlik alanları geçersiz.") from exc
    return _resolve_membership(db, user_id, organization_id)


def _identity_from_dev_headers(db: Session, x_user_id: str | None, x_organization_id: str | None) -> IdentityContext:
    try:
        user_id = uuid.UUID(x_user_id or "")
        organization_id = uuid.UUID(x_organization_id or "")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Kimlik başlıkları eksik veya geçersiz.") from exc
    return _resolve_membership(db, user_id, organization_id)


def get_identity(
    db: DbSession,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    x_user_id: Annotated[str | None, Header(alias="X-User-ID")] = None,
    x_organization_id: Annotated[str | None, Header(alias="X-Organization-ID")] = None,
) -> IdentityContext:
    settings = get_settings()
    if authorization and authorization.lower().startswith("bearer "):
        return _identity_from_bearer(db, authorization[7:].strip())
    if settings.allow_dev_identity:
        return _identity_from_dev_headers(db, x_user_id, x_organization_id)
    if settings.jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization: Bearer <token> başlığı zorunludur.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Kimlik sağlayıcı yapılandırılmadı; dev identity kapalı.",
    )


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
# Full passport values are only revealed to roles with an operational need.
REVEAL_ROLES = (Role.OWNER, Role.MANAGER, Role.OPERATOR, Role.REVIEWER)
