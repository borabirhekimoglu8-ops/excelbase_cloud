from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditEvent, AuditHead


def canonical_hash(value: dict[str, Any] | None) -> str:
    if not value:
        return ""
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _locked_head(db: Session, organization_id: uuid.UUID) -> AuditHead:
    head = db.scalar(
        select(AuditHead).where(AuditHead.organization_id == organization_id).with_for_update()
    )
    if head is None:
        head = AuditHead(organization_id=organization_id, sequence=0, last_hash="")
        db.add(head)
        db.flush()
    return head


def emit_audit_event(
    db: Session,
    *,
    organization_id: uuid.UUID,
    actor_id: uuid.UUID,
    request_id: str,
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    head = _locked_head(db, organization_id)
    chain_position = head.sequence + 1
    before_hash = canonical_hash(before)
    after_hash = canonical_hash(after)
    metadata_json = json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    envelope = {
        "organization_id": str(organization_id),
        "actor_id": str(actor_id),
        "request_id": request_id,
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "action": action,
        "chain_position": chain_position,
        "before_hash": before_hash,
        "after_hash": after_hash,
        "metadata_json": metadata_json,
        "previous_event_hash": head.last_hash,
    }
    event_hash = canonical_hash(envelope)
    now = datetime.now(UTC)
    event = AuditEvent(
        organization_id=organization_id,
        actor_id=actor_id,
        request_id=request_id,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        chain_position=chain_position,
        before_hash=before_hash,
        after_hash=after_hash,
        metadata_json=metadata_json,
        previous_event_hash=head.last_hash,
        event_hash=event_hash,
        created_at=now,
    )
    db.add(event)
    head.sequence = chain_position
    head.last_hash = event_hash
    head.updated_at = now
    db.flush()
    return event
