from __future__ import annotations

import asyncio
import json
import socket
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from backend.assistant.anthropic_provider import AnthropicProvider
from backend.assistant.provider import (
    AssistantUnavailableError,
    DisabledProvider,
    ProviderMessage,
    ProviderRequest,
    ProviderResult,
)
from backend.assistant.schemas import (
    ACTIVE_CAPABILITIES,
    READ_ONLY_CAPABILITIES,
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantUsage,
)
from backend.assistant.service import (
    AssistantQuotaError,
    bounded_amount,
    bounded_int,
    generate_assistant_reply,
    reset_assistant_runtime,
    sanitize_context_summary,
)
from backend.auth import (
    ASSISTANT_SESSION_COOKIE,
    ASSISTANT_SESSION_PATH,
    ASSISTANT_SESSION_SECONDS,
    Actor,
    assistant_csrf_token,
    issue_assistant_session,
    issue_session,
    require_assistant_session,
    require_bootstrap_token,
)
from backend.config import AssistantSettings, assistant_settings
from backend.main import app


def _chat_payload(message: str = "Durumu özetle") -> dict:
    return {
        "message": message,
        "history": [],
        "context": {
            "version": 1,
            "scope": {"range": "today", "field": "departure", "start": "", "end": ""},
            "metrics": {"passenger_count": 12, "readiness_percent": 75},
            "issues": {"missing_photo": 3},
        },
        "privacy_acknowledged": True,
    }


def test_public_status_reports_readiness_and_never_leaks_provider_configuration(monkeypatch):
    secret = "anthropic-secret-must-never-leak"
    model = "claude-sonnet-5"
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", model)
    monkeypatch.setenv("ANTHROPIC_API_KEY", secret)

    with TestClient(app) as client:
        response = client.get("/api/assistant/v1/status")

    assert response.status_code == 200
    assert response.json() == {
        "available": True,
        "configuration_state": "ready",
        "online_required": True,
        "privacy_mode": "aggregate_context_only",
        "model_family": "sonnet",
        "model_label": "Claude Sonnet",
        "capabilities": list(ACTIVE_CAPABILITIES),
    }
    serialized = response.text.lower()
    assert secret not in serialized
    assert model not in serialized
    assert "anthropic" not in serialized
    assert "api_key" not in serialized


def test_public_status_rejects_a_non_sonnet_or_unapproved_model(monkeypatch):
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "claude-opus-4-8")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-secret")

    with TestClient(app) as client:
        response = client.get("/api/assistant/v1/status")

    assert response.status_code == 200
    assert response.json()["available"] is False
    assert response.json()["configuration_state"] == "model_mismatch"
    assert response.json()["model_family"] == "sonnet"
    assert response.json()["model_label"] == "Claude Sonnet"
    assert "opus" not in response.text.lower()


def test_public_status_stays_fail_closed_without_server_key(monkeypatch):
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "claude-sonnet-5")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    with TestClient(app) as client:
        response = client.get("/api/assistant/v1/status")

    assert response.status_code == 200
    assert response.json()["available"] is False
    assert response.json()["configuration_state"] == "api_key_missing"


def test_server_key_enables_safe_sonnet_defaults_without_blueprint_flags(monkeypatch):
    for name in (
        "EXCELBASE_ASSISTANT_ENABLED",
        "EXCELBASE_ASSISTANT_PROVIDER",
        "EXCELBASE_ASSISTANT_MODEL",
        "EXCELBASE_ASSISTANT_PII_MODE",
        "EXCELBASE_ASSISTANT_ALLOW_RAW_DOCUMENTS",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-secret")

    settings = assistant_settings()
    assert settings.enabled is True
    assert settings.provider == "anthropic"
    assert settings.model == "claude-sonnet-5"
    assert settings.pii_mode == "strict"
    assert settings.allow_raw_documents is False

    with TestClient(app) as client:
        response = client.get("/api/assistant/v1/status")

    assert response.status_code == 200
    assert response.json()["available"] is True
    assert response.json()["configuration_state"] == "ready"
    assert "server-secret" not in response.text


def test_context_summary_is_structurally_allowlisted_and_pii_free():
    payload = {
        "passenger_count": 12,
        "ready_count": 7,
        "missing_count": 5,
        "readiness_percent": 58,
        "total_fee": "1250,00",  # Invalid aggregate text fails closed.
        "start": "2026-07-01",
        "end": "2026-02-30",
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


def test_anthropic_provider_uses_server_configuration_and_parses_text():
    calls: list[dict] = []

    class FakeMessages:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                id="msg_123",
                content=[SimpleNamespace(type="text", text="  Operasyon özeti hazır.  ")],
                usage=SimpleNamespace(input_tokens=44, output_tokens=9),
                stop_reason="end_turn",
            )

    class FakeClient:
        messages = FakeMessages()

        async def close(self):
            return None

    factory_arguments: list[dict] = []

    def factory(**kwargs):
        factory_arguments.append(kwargs)
        return FakeClient()

    settings = AssistantSettings(
        enabled=True,
        provider="anthropic",
        model="claude-sonnet-5",
        api_key="server-secret",
    )
    provider = AnthropicProvider(settings, client_factory=factory)
    result = asyncio.run(provider.generate(ProviderRequest(
        messages=(
            ProviderMessage(role="system", content="Kurumsal yanıt ver."),
            ProviderMessage(role="user", content="Özetle"),
        ),
        max_output_tokens=500,
    )))

    assert result.text == "Operasyon özeti hazır."
    assert result.input_tokens == 44
    assert result.output_tokens == 9
    assert factory_arguments == [{
        "api_key": "server-secret",
        "timeout": 35,
        "max_retries": 0,
    }]
    assert calls == [{
        "model": "claude-sonnet-5",
        "max_tokens": 500,
        "system": "Kurumsal yanıt ver.",
        "messages": [{"role": "user", "content": "Özetle"}],
    }]


def test_chat_schema_rejects_unknown_context_that_could_carry_pii():
    payload = _chat_payload()
    payload["context"]["metrics"]["passport_no"] = "U12345678"

    with pytest.raises(Exception):
        AssistantChatRequest.model_validate(payload)


def test_billable_chat_requires_an_online_server_session(monkeypatch):
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "1")
    with TestClient(app) as client:
        response = client.post(
            "/api/assistant/v1/chat",
            json=_chat_payload(),
            headers={"Origin": "http://testserver", "X-CSRF-Token": "missing"},
        )
    assert response.status_code == 401


def test_assistant_session_dependency_checks_origin_and_csrf(monkeypatch):
    from backend import auth

    actor = Actor(id="actor-1", name="Operasyon", role="admin")
    monkeypatch.setattr(
        auth,
        "optional_assistant_actor",
        lambda request: (
            actor
            if request.cookies.get(ASSISTANT_SESSION_COOKIE) == "signed-assistant-token"
            else None
        ),
    )
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "https",
        "path": "/api/assistant/v1/chat",
        "raw_path": b"/api/assistant/v1/chat",
        "query_string": b"",
        "headers": [
            (b"host", b"excelbase.onrender.com"),
            (b"origin", b"https://excelbase.onrender.com"),
            (
                b"cookie",
                f"{ASSISTANT_SESSION_COOKIE}=signed-assistant-token".encode("ascii"),
            ),
        ],
        "client": ("127.0.0.1", 1000),
        "server": ("excelbase.onrender.com", 443),
    }
    request = Request(scope)
    csrf = assistant_csrf_token(request)

    assert require_assistant_session(request, csrf) == actor

    with pytest.raises(HTTPException) as missing_csrf:
        require_assistant_session(request, "")
    assert missing_csrf.value.status_code == 403

    bad_scope = {**scope, "headers": [
        (b"host", b"excelbase.onrender.com"),
        (b"origin", b"https://attacker.example"),
        (
            b"cookie",
            f"{ASSISTANT_SESSION_COOKIE}=signed-assistant-token".encode("ascii"),
        ),
    ]}
    with pytest.raises(HTTPException) as bad_origin:
        require_assistant_session(Request(bad_scope), csrf)
    assert bad_origin.value.status_code == 403

    global_cookie_scope = {**scope, "headers": [
        (b"host", b"excelbase.onrender.com"),
        (b"origin", b"https://excelbase.onrender.com"),
        (b"cookie", b"gatevisa_session=signed-global-token"),
    ]}
    with pytest.raises(HTTPException) as global_cookie:
        require_assistant_session(Request(global_cookie_scope), csrf)
    assert global_cookie.value.status_code == 401


def test_authenticated_chat_returns_provider_response_without_content_logging(monkeypatch):
    async def fake_generate(payload, *, actor_id, request_id):
        assert payload.message == "Durumu özetle"
        assert actor_id == "actor-1"
        return AssistantChatResponse(
            message="12 yolcunun yüzde 75'i hazır.",
            usage=AssistantUsage(input_tokens=80, output_tokens=14),
            request_id=request_id,
        )

    from backend import main

    monkeypatch.setattr(main, "generate_assistant_reply", fake_generate)
    app.dependency_overrides[require_assistant_session] = lambda: Actor(
        id="actor-1",
        name="Operasyon",
        role="admin",
    )
    try:
        with TestClient(app) as client:
            response = client.post("/api/assistant/v1/chat", json=_chat_payload())
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)

    assert response.status_code == 200
    assert response.json()["message"].startswith("12 yolcunun")
    assert response.json()["request_id"]


def test_per_actor_minute_quota_blocks_second_provider_call(monkeypatch):
    class FakeProvider:
        name = "fake"
        available = True
        calls = 0

        async def generate(self, request):
            self.calls += 1
            return ProviderResult(text="Tamam", input_tokens=1, output_tokens=1)

    fake = FakeProvider()
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "secret")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_REQUESTS_PER_MINUTE", "1")
    monkeypatch.setattr("backend.assistant.service.get_assistant_provider", lambda: fake)
    reset_assistant_runtime()
    payload = AssistantChatRequest.model_validate(_chat_payload())

    async def exercise():
        await generate_assistant_reply(payload, actor_id="actor-1", request_id="one")
        with pytest.raises(AssistantQuotaError):
            await generate_assistant_reply(payload, actor_id="actor-1", request_id="two")

    asyncio.run(exercise())
    assert fake.calls == 1


def test_session_tokens_are_isolated_by_audience_and_assistant_ttl(monkeypatch):
    from backend import auth

    actor = Actor(id="actor-1", name="Operasyon", role="admin")
    state = SimpleNamespace(
        auth={
            "session_secret": "test-session-secret",
            "users": [
                {
                    "id": actor.id,
                    "name": actor.name,
                    "role": actor.role,
                    "active": True,
                }
            ],
        }
    )
    monkeypatch.setattr(auth, "_auth_state", lambda: state)

    before = int(auth.time.time())
    global_token = issue_session(actor)
    assistant_token = issue_assistant_session(actor)
    after = int(auth.time.time())

    assert auth._actor_from_token(global_token, audience="app") == actor
    assert auth._actor_from_token(global_token, audience="assistant") is None
    assert auth._actor_from_token(assistant_token, audience="assistant") == actor
    assert auth._actor_from_token(assistant_token, audience="app") is None

    encoded, _signature = assistant_token.split(".", 1)
    payload = json.loads(auth._unb64(encoded))
    assert payload["aud"] == "assistant"
    assert before + ASSISTANT_SESSION_SECONDS <= payload["exp"] <= after + ASSISTANT_SESSION_SECONDS


def test_production_bootstrap_token_fails_closed_and_compares_secret(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("GATEVISA_BOOTSTRAP_TOKEN", raising=False)

    with pytest.raises(HTTPException) as missing_configuration:
        require_bootstrap_token("")
    assert missing_configuration.value.status_code == 503

    monkeypatch.setenv("GATEVISA_BOOTSTRAP_TOKEN", "out-of-band-secret")
    with pytest.raises(HTTPException) as wrong_token:
        require_bootstrap_token("wrong")
    assert wrong_token.value.status_code == 403

    require_bootstrap_token("out-of-band-secret")


def test_development_setup_does_not_require_bootstrap_token(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("GATEVISA_BOOTSTRAP_TOKEN", raising=False)

    require_bootstrap_token("")


def test_assistant_login_sets_only_the_dedicated_short_lived_cookie(monkeypatch):
    from backend import main

    actor = Actor(id="actor-1", name="Operasyon", role="admin")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setattr(main, "authenticate", lambda pin, client_key: actor)
    monkeypatch.setattr(main, "issue_assistant_session", lambda current: "assistant-token")
    monkeypatch.setattr(main.services, "record_audit_async", lambda *args: None)

    with TestClient(app) as client:
        response = client.post(
            "/api/assistant/v1/session/login",
            json={"pin": "123456"},
        )

    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    assert response.json()["bootstrap_required"] is False
    assert response.json()["csrf_token"]
    cookie = response.headers["set-cookie"]
    cookie_lower = cookie.lower()
    assert cookie.startswith(f"{ASSISTANT_SESSION_COOKIE}=assistant-token")
    assert f"path={ASSISTANT_SESSION_PATH}".lower() in cookie_lower
    assert f"max-age={ASSISTANT_SESSION_SECONDS}" in cookie_lower
    assert "httponly" in cookie_lower
    assert "samesite=strict" in cookie_lower
    assert "gatevisa_session=" not in cookie_lower


def test_both_setup_endpoints_fail_closed_before_database_in_production(monkeypatch):
    from backend import main

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("GATEVISA_BOOTSTRAP_TOKEN", raising=False)

    def fail_if_setup_runs(*args, **kwargs):
        raise AssertionError("setup_admin must not run without the bootstrap secret")

    monkeypatch.setattr(main, "setup_admin", fail_if_setup_runs)
    payload = {"display_name": "Yönetici", "pin": "123456"}

    with TestClient(app) as client:
        assistant_response = client.post(
            "/api/assistant/v1/session/setup",
            json=payload,
        )
        app_response = client.post("/api/auth/setup", json=payload)

    assert assistant_response.status_code == 503
    assert app_response.status_code == 503


def test_scrypt_login_guard_rejects_excess_concurrency_before_auth_state(monkeypatch):
    from backend import auth

    class SaturatedGate:
        def acquire(self, timeout):
            assert timeout == 1.0
            return False

        def release(self):
            raise AssertionError("an unacquired gate must not be released")

    monkeypatch.setattr(auth, "_LOGIN_SCRYPT_GATE", SaturatedGate())
    monkeypatch.setattr(
        auth,
        "_auth_state",
        lambda: (_ for _ in ()).throw(AssertionError("auth state must not be loaded")),
    )

    with pytest.raises(HTTPException) as saturated:
        auth.authenticate("123456", client_key="saturated-test-client")
    assert saturated.value.status_code == 429
