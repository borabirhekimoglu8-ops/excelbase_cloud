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
    assert response.json()["passport_no"] == "U12345678"

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
