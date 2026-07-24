from __future__ import annotations

import asyncio
import json
import socket

import pytest
from fastapi.testclient import TestClient

from backend.assistant.provider import (
    AssistantUnavailableError,
    DisabledProvider,
    ProviderMessage,
    ProviderRequest,
)
from backend.assistant.schemas import READ_ONLY_CAPABILITIES
from backend.assistant.service import (
    bounded_amount,
    bounded_int,
    sanitize_context_summary,
)
from backend.config import assistant_settings
from backend.main import app


def test_public_status_is_fail_closed_and_never_leaks_provider_configuration(monkeypatch):
    secret = "anthropic-secret-must-never-leak"
    model = "private-model-selection"
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", model)
    monkeypatch.setenv("ANTHROPIC_API_KEY", secret)

    with TestClient(app) as client:
        response = client.get("/api/assistant/v1/status")

    assert response.status_code == 200
    assert response.json() == {
        "available": False,
        "online_required": True,
        "privacy_mode": "strict",
        "capabilities": list(READ_ONLY_CAPABILITIES),
    }
    serialized = response.text.lower()
    assert secret not in serialized
    assert model not in serialized
    assert "anthropic" not in serialized
    assert "api_key" not in serialized


def test_context_summary_is_structurally_allowlisted_and_pii_free():
    payload = {
        "passenger_count": 12,
        "ready_count": 7,
        "missing_count": 5,
        "readiness_percent": 58,
        "total_fee": "1250,00",  # Invalid aggregate text fails closed.
        "start": "2026-07-01",
        "end": "not-a-date",
        "passport_no": "U12345678",
        "full_name": "Ayşe Yılmaz",
        "email": "ayse@example.com",
        "phone": "+90 555 123 45 67",
        "filename": "U12345678-pasaport.pdf",
        "photo": "biometric.jpg",
        "notes": "private free text",
        "documents": [{"body": "raw PDF"}],
    }

    sanitized = sanitize_context_summary(payload)

    assert sanitized == {
        "passenger_count": 12,
        "ready_count": 7,
        "missing_count": 5,
        "readiness_percent": 58,
        "total_fee": 0.0,
        "start": "2026-07-01",
        "end": "",
    }
    serialized = json.dumps(sanitized, ensure_ascii=False)
    for pii in ("U12345678", "Ayşe", "example.com", "+90", "pasaport.pdf", "raw PDF"):
        assert pii not in serialized


def test_context_numeric_bounds_fail_closed():
    assert bounded_int(-4) == 0
    assert bounded_int(10**20) == 1_000_000
    assert bounded_int("not-a-number") == 0
    assert bounded_amount(float("nan")) == 0.0
    assert bounded_amount(float("inf")) == 0.0
    assert bounded_amount(-12) == 0.0
    assert bounded_amount(10**20) == 1_000_000_000.0


def test_capability_contract_is_read_only():
    forbidden = ("create", "update", "delete", "remove", "send", "export", "import", "restore", "reveal")
    assert READ_ONLY_CAPABILITIES
    assert len(READ_ONLY_CAPABILITIES) == len(set(READ_ONLY_CAPABILITIES))
    for capability in READ_ONLY_CAPABILITIES:
        assert not any(word in capability for word in forbidden)


def test_disabled_provider_performs_no_network(monkeypatch):
    network_attempted = False

    def fail_if_network(*args, **kwargs):
        nonlocal network_attempted
        network_attempted = True
        raise AssertionError("DisabledProvider attempted network access")

    monkeypatch.setattr(socket, "create_connection", fail_if_network)
    provider = DisabledProvider()
    request = ProviderRequest(
        messages=(ProviderMessage(role="user", content="private prompt"),),
        max_output_tokens=100,
        allowed_capabilities=READ_ONLY_CAPABILITIES,
    )

    with pytest.raises(AssistantUnavailableError):
        asyncio.run(provider.generate(request))
    assert network_attempted is False


def test_assistant_settings_clamp_values_and_hide_key_from_repr(monkeypatch):
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MAX_CONTEXT_RECORDS", "999999")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MAX_OUTPUT_TOKENS", "-1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PII_MODE", "unsafe")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "repr-secret")

    settings = assistant_settings()

    assert settings.max_context_records == 100
    assert settings.max_output_tokens == 64
    assert settings.pii_mode == "strict"
    assert settings.allow_raw_documents is False
    assert "repr-secret" not in repr(settings)
