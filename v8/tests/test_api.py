from __future__ import annotations

from sqlalchemy import select

from app.database import get_session_factory
from app.models import AuditEvent, Passenger


def operation_payload(code: str = "KUS-SAM-20260710") -> dict:
    return {
        "code": code,
        "route_origin": "Kuşadası",
        "route_destination": "Samos Vathy",
        "departure_date": "2026-07-10",
        "vessel_name": "Aegean Star",
        "notes": "V8 acceptance test",
    }


def passenger_payload(passport: str = "U12345678") -> dict:
    return {
        "first_name": "Bora",
        "last_name": "Birhekimoğlu",
        "passport_no": passport,
        "voucher": "VCH-001",
        "arrival_date": "2026-07-17",
        "adult_fee": "60.00",
        "child_fee": "0.00",
        "currency": "EUR",
        "source_file": "gate-visa.xlsx",
        "source_row": 4,
    }


def test_health(client):
    response = client.get("/api/v8/health")
    assert response.status_code == 200
    assert response.json()["database"] == "ok"
    assert response.headers["cache-control"] == "private, no-store"


def test_passport_is_encrypted_and_mutations_are_audited(client, seeded):
    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    response = client.post(
        f"/api/v8/operations/{operation['id']}/passengers",
        headers=seeded["headers_a"],
        json=passenger_payload(),
    )
    assert response.status_code == 201
    assert response.json()["passport_masked"] == "*****5678"
    assert "U12345678" not in response.text

    db = get_session_factory()()
    stored = db.scalar(select(Passenger))
    assert stored is not None
    assert stored.passport_ciphertext != "U12345678"
    assert "U12345678" not in stored.passport_ciphertext
    events = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at)).all()
    assert [event.action for event in events] == ["operation.created", "passenger.created"]
    assert events[1].previous_event_hash == events[0].event_hash
    db.close()


def test_tenant_isolation_returns_not_found(client, seeded):
    created = client.post("/api/v8/operations", headers=seeded["headers_b"], json=operation_payload("ORG-B-001"))
    assert created.status_code == 201
    operation_id = created.json()["id"]

    leaked = client.get(f"/api/v8/operations/{operation_id}", headers=seeded["headers_a"])
    assert leaked.status_code == 404


def test_optimistic_lock_rejects_stale_passenger_update(client, seeded):
    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    passenger = client.post(
        f"/api/v8/operations/{operation['id']}/passengers",
        headers=seeded["headers_a"],
        json=passenger_payload(),
    ).json()

    first = client.patch(
        f"/api/v8/passengers/{passenger['id']}",
        headers=seeded["headers_a"],
        json={"version": passenger["version"], "voucher": "VCH-UPDATED"},
    )
    assert first.status_code == 200
    assert first.json()["version"] == passenger["version"] + 1

    stale = client.patch(
        f"/api/v8/passengers/{passenger['id']}",
        headers=seeded["headers_a"],
        json={"version": passenger["version"], "voucher": "STALE"},
    )
    assert stale.status_code == 409


def test_duplicate_passport_is_blocked_per_operation(client, seeded):
    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    first = client.post(
        f"/api/v8/operations/{operation['id']}/passengers",
        headers=seeded["headers_a"],
        json=passenger_payload("U 123-45678"),
    )
    assert first.status_code == 201
    duplicate = client.post(
        f"/api/v8/operations/{operation['id']}/passengers",
        headers=seeded["headers_a"],
        json=passenger_payload("u12345678"),
    )
    assert duplicate.status_code == 409


def test_invalid_operation_transition_is_blocked(client, seeded):
    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    response = client.patch(
        f"/api/v8/operations/{operation['id']}",
        headers=seeded["headers_a"],
        json={"version": operation["version"], "status": "SUBMITTED"},
    )
    assert response.status_code == 409


def test_staged_import_redacts_passports_and_commits_atomically(client, seeded, monkeypatch):
    from datetime import date
    from decimal import Decimal
    import json

    from app.import_adapter import ParsedImportRow
    from app.models import ImportRow
    from app import services

    def fake_parse(filename: str, data: bytes):
        assert filename == "sample.xlsx"
        assert data == b"excel-bytes"
        return (
            [
                ParsedImportRow(
                    row_number=7,
                    first_name="Ada",
                    last_name="Lovelace",
                    passport_no="P99887766",
                    voucher="V-77",
                    arrival_date=date(2026, 7, 20),
                    adult_fee=Decimal("60.00"),
                    child_fee=Decimal("0.00"),
                    currency="EUR",
                    source_file="sample.xlsx",
                    errors=(),
                    raw_redacted={"Ad": "Ada", "Soyad": "Lovelace", "Pasaport No": "[REDACTED]"},
                )
            ],
            ["fixture warning"],
        )

    monkeypatch.setattr(services.import_adapter, "parse_gate_visa_file", fake_parse)
    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    staged = client.post(
        f"/api/v8/operations/{operation['id']}/imports",
        headers=seeded["headers_a"],
        files={"file": ("sample.xlsx", b"excel-bytes", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert staged.status_code == 201
    preview = staged.json()
    assert preview["batch"]["valid_rows"] == 1
    assert preview["rows"][0]["preview"]["passport_masked"].endswith("7766")
    assert "P99887766" not in staged.text

    db = get_session_factory()()
    staged_row = db.scalar(select(ImportRow))
    assert staged_row is not None
    assert "P99887766" not in staged_row.raw_json
    assert "P99887766" not in staged_row.normalized_json
    normalized = json.loads(staged_row.normalized_json)
    assert normalized["passport_ciphertext"]
    db.close()

    committed = client.post(
        f"/api/v8/imports/{preview['batch']['id']}/commit",
        headers=seeded["headers_a"],
    )
    assert committed.status_code == 200
    assert committed.json()["created"] == 1

    db = get_session_factory()()
    events = db.scalars(select(AuditEvent).order_by(AuditEvent.chain_position)).all()
    assert [event.chain_position for event in events] == list(range(1, len(events) + 1))
    assert events[-1].action == "import.committed"
    db.close()


def test_audit_chain_verification_endpoint(client, seeded):
    client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload())
    response = client.get("/api/v8/audit/verify", headers=seeded["headers_a"])
    assert response.status_code == 200
    assert response.json()["valid"] is True
    assert response.json()["event_count"] == 1
    assert response.json()["checkpoint_position"] == 1


def test_audit_checkpoint_advances_incrementally(client, seeded):
    client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload("OP-1"))
    first = client.get("/api/v8/audit/verify", headers=seeded["headers_a"]).json()
    assert first["checkpoint_position"] == 1

    client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload("OP-2"))
    second = client.get("/api/v8/audit/verify", headers=seeded["headers_a"]).json()
    assert second["valid"] is True
    assert second["checkpoint_position"] == 2
    assert second["event_count"] == 2


def test_pagination_envelope(client, seeded):
    for index in range(3):
        created = client.post(
            "/api/v8/operations", headers=seeded["headers_a"], json=operation_payload(f"PAGE-{index}")
        )
        assert created.status_code == 201
    page = client.get("/api/v8/operations?limit=2&offset=0", headers=seeded["headers_a"]).json()
    assert page["total"] == 3
    assert len(page["items"]) == 2
    assert page["next_offset"] == 2
    tail = client.get("/api/v8/operations?limit=2&offset=2", headers=seeded["headers_a"]).json()
    assert len(tail["items"]) == 1
    assert tail["next_offset"] is None


def test_passport_reveal_requires_role_and_is_audited(client, seeded):
    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    passenger = client.post(
        f"/api/v8/operations/{operation['id']}/passengers",
        headers=seeded["headers_a"],
        json=passenger_payload(),
    ).json()

    listed = client.get(
        f"/api/v8/operations/{operation['id']}/passengers", headers=seeded["headers_a"]
    ).json()
    assert listed["items"][0]["passport_masked"] == "*****5678"
    assert "U12345678" not in str(listed)

    revealed = client.post(
        f"/api/v8/passengers/{passenger['id']}/passport/reveal", headers=seeded["headers_a"]
    )
    assert revealed.status_code == 200
    assert revealed.json()["passport_no"] == "U12345678"

    db = get_session_factory()()
    actions = [event.action for event in db.scalars(select(AuditEvent).order_by(AuditEvent.chain_position)).all()]
    assert actions[-1] == "passenger.passport_revealed"
    db.close()

    forbidden = client.post(
        f"/api/v8/passengers/{passenger['id']}/passport/reveal", headers=seeded["headers_viewer"]
    )
    assert forbidden.status_code == 403


def test_jwt_bearer_authentication(client, seeded):
    import jwt as pyjwt
    from datetime import UTC, datetime, timedelta

    from app.config import get_settings

    settings = get_settings()
    now = datetime.now(UTC)
    token = pyjwt.encode(
        {
            "sub": str(seeded["user_a"].id),
            "org": str(seeded["org_a"].id),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    response = client.get("/api/v8/operations", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200

    bad = client.get("/api/v8/operations", headers={"Authorization": "Bearer not-a-token"})
    assert bad.status_code == 401

    expired = pyjwt.encode(
        {
            "sub": str(seeded["user_a"].id),
            "org": str(seeded["org_a"].id),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(hours=1),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    stale = client.get("/api/v8/operations", headers={"Authorization": f"Bearer {expired}"})
    assert stale.status_code == 401


def test_photo_upload_download_delete_cycle(client, seeded):
    png = b"\x89PNG\r\n\x1a\n" + b"fake-image-bytes"
    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    passenger = client.post(
        f"/api/v8/operations/{operation['id']}/passengers",
        headers=seeded["headers_a"],
        json=passenger_payload(),
    ).json()

    uploaded = client.post(
        f"/api/v8/passengers/{passenger['id']}/photo",
        headers=seeded["headers_a"],
        files={"file": ("photo.png", png, "image/png")},
    )
    assert uploaded.status_code == 201
    assert uploaded.json()["mime_type"] == "image/png"

    fetched = client.get(f"/api/v8/passengers/{passenger['id']}/photo", headers=seeded["headers_a"])
    assert fetched.status_code == 200
    assert fetched.content == png
    assert fetched.headers["content-type"].startswith("image/png")

    leaked = client.get(f"/api/v8/passengers/{passenger['id']}/photo", headers=seeded["headers_b"])
    assert leaked.status_code == 404

    rejected = client.post(
        f"/api/v8/passengers/{passenger['id']}/photo",
        headers=seeded["headers_a"],
        files={"file": ("malware.exe", b"MZ", "application/octet-stream")},
    )
    assert rejected.status_code == 400

    deleted = client.delete(f"/api/v8/passengers/{passenger['id']}/photo", headers=seeded["headers_a"])
    assert deleted.status_code == 204
    missing = client.get(f"/api/v8/passengers/{passenger['id']}/photo", headers=seeded["headers_a"])
    assert missing.status_code == 404

    db = get_session_factory()()
    actions = [event.action for event in db.scalars(select(AuditEvent).order_by(AuditEvent.chain_position)).all()]
    assert "passenger.photo_uploaded" in actions
    assert "passenger.photo_deleted" in actions
    db.close()


def test_database_unique_index_blocks_duplicate_race(client, seeded):
    """Even if the application-level duplicate check is bypassed, the partial
    unique index on active passengers must reject the second insert."""
    import uuid

    from sqlalchemy.exc import IntegrityError

    from app.models import Passenger
    from app.security import get_codec

    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    client.post(
        f"/api/v8/operations/{operation['id']}/passengers",
        headers=seeded["headers_a"],
        json=passenger_payload(),
    )

    codec = get_codec()
    db = get_session_factory()()
    db.add(
        Passenger(
            organization_id=seeded["org_a"].id,
            operation_id=uuid.UUID(operation["id"]),
            first_name="Race",
            last_name="Condition",
            passport_ciphertext=codec.encrypt_passport("U12345678"),
            passport_hash=codec.passport_hash("U12345678"),
        )
    )
    try:
        import pytest

        with pytest.raises(IntegrityError):
            db.commit()
    finally:
        db.rollback()
        db.close()


def test_committed_import_cannot_be_committed_twice(client, seeded, monkeypatch):
    from datetime import date
    from decimal import Decimal

    from app.import_adapter import ParsedImportRow
    from app import services

    def fake_parse(filename: str, data: bytes):
        return (
            [
                ParsedImportRow(
                    row_number=1,
                    first_name="Grace",
                    last_name="Hopper",
                    passport_no="G11223344",
                    voucher="",
                    arrival_date=date(2026, 7, 20),
                    adult_fee=Decimal("60.00"),
                    child_fee=Decimal("0.00"),
                    currency="EUR",
                    source_file="twice.xlsx",
                    errors=(),
                    raw_redacted={"Pasaport No": "[REDACTED]"},
                )
            ],
            [],
        )

    monkeypatch.setattr(services.import_adapter, "parse_gate_visa_file", fake_parse)
    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    staged = client.post(
        f"/api/v8/operations/{operation['id']}/imports",
        headers=seeded["headers_a"],
        files={"file": ("twice.xlsx", b"bytes", "application/octet-stream")},
    ).json()
    batch_id = staged["batch"]["id"]

    first = client.post(f"/api/v8/imports/{batch_id}/commit", headers=seeded["headers_a"])
    assert first.status_code == 200
    second = client.post(f"/api/v8/imports/{batch_id}/commit", headers=seeded["headers_a"])
    assert second.status_code == 409


def test_import_rejects_unsupported_extension_and_oversize(client, seeded):
    operation = client.post("/api/v8/operations", headers=seeded["headers_a"], json=operation_payload()).json()
    bad_type = client.post(
        f"/api/v8/operations/{operation['id']}/imports",
        headers=seeded["headers_a"],
        files={"file": ("payload.pdf", b"%PDF", "application/pdf")},
    )
    assert bad_type.status_code == 400

    from app.config import get_settings

    oversized = b"0" * (get_settings().max_import_bytes + 1)
    too_big = client.post(
        f"/api/v8/operations/{operation['id']}/imports",
        headers=seeded["headers_a"],
        files={"file": ("big.xlsx", oversized, "application/octet-stream")},
    )
    assert too_big.status_code == 413
