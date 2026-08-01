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
    AssistantConfigurationError,
    AssistantProviderError,
    AssistantUnavailableError,
    DisabledProvider,
    ProviderMessage,
    ProviderRequest,
    ProviderResult,
    ProviderToolCall,
)
from backend.assistant.schemas import (
    ACTIVE_CAPABILITIES,
    READ_ONLY_CAPABILITIES,
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantUsage,
)
from backend.assistant.service import (
    SUPPORTED_SONNET_MODELS,
    AssistantInputError,
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
    LEGACY_ASSISTANT_SESSION_PATHS,
    ASSISTANT_SESSION_SECONDS,
    Actor,
    assistant_csrf_token,
    issue_assistant_session,
    issue_session,
    require_assistant_session,
    require_bootstrap_token,
)
from backend.config import (
    ANTHROPIC_API_KEY_ALIASES,
    AssistantSettings,
    assistant_settings,
)
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
        "open_access": False,
        "autonomy": "read_only",
        "network_scoped": False,
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


def test_assistant_session_dependency_accepts_a_get_with_no_origin_header(monkeypatch):
    """A same-origin GET (e.g. the dev-agent status poll) never carries an
    Origin header under the Fetch standard -- only non-GET/HEAD requests do.
    Requiring one here would reject every legitimate GET in production; the
    session cookie's SameSite=strict already stops a cross-site request from
    presenting it at all, forged Origin or not."""
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
        "method": "GET",
        "scheme": "https",
        "path": "/api/dev-agent/v1/status",
        "raw_path": b"/api/dev-agent/v1/status",
        "query_string": b"",
        "headers": [
            (b"host", b"excelbase.onrender.com"),
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


def test_assistant_session_dependency_still_checks_origin_for_a_post_with_none(monkeypatch):
    """The GET exemption must not widen to state-changing methods: a POST
    with a missing or forged Origin is still rejected in production."""
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
    monkeypatch.setenv("APP_ENV", "production")
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

    with pytest.raises(HTTPException) as missing_origin:
        require_assistant_session(request, csrf)
    assert missing_origin.value.status_code == 403


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
    # More than one Set-Cookie is expected: the session itself, plus the
    # tombstones that clear any cookie left at a path an older build used.
    headers = response.headers.get_list("set-cookie")
    issued = [
        header for header in headers
        if header.startswith(f"{ASSISTANT_SESSION_COOKIE}=assistant-token")
    ]
    assert len(issued) == 1
    cookie_lower = issued[0].lower()
    assert f"path={ASSISTANT_SESSION_PATH}".lower() in cookie_lower
    assert f"max-age={ASSISTANT_SESSION_SECONDS}" in cookie_lower
    assert "httponly" in cookie_lower
    assert "samesite=strict" in cookie_lower
    assert not any("gatevisa_session=" in header.lower() for header in headers)


def test_login_and_logout_clear_a_session_cookie_left_at_an_older_path(monkeypatch):
    """Cookies are keyed by name *and* path, so changing the path does not
    replace the old cookie -- it adds a second one the browser keeps sending
    and delete_cookie at the new path never matches. A user upgrading across
    that change would keep sending a stale cookie forever, with two same-named
    cookies racing to be the one the server reads, and could not recover by
    logging out. Both responses must explicitly clear the legacy paths."""
    from backend import main

    actor = Actor(id="actor-1", name="Operasyon", role="admin")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setattr(main, "authenticate", lambda pin, client_key: actor)
    monkeypatch.setattr(main, "issue_assistant_session", lambda current: "assistant-token")
    monkeypatch.setattr(main.services, "record_audit_async", lambda *args: None)
    monkeypatch.setattr(main, "require_assistant_session", lambda: actor)
    app.dependency_overrides[require_assistant_session] = lambda: actor
    try:
        with TestClient(app) as client:
            login = client.post("/api/assistant/v1/session/login", json={"pin": "123456"})
            logout = client.post("/api/assistant/v1/session/logout")
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)

    for response, label in ((login, "login"), (logout, "logout")):
        headers = response.headers.get_list("set-cookie")
        for legacy_path in LEGACY_ASSISTANT_SESSION_PATHS:
            expiring = [
                header for header in headers
                if f"path={legacy_path}".lower() in header.lower()
                and f"{ASSISTANT_SESSION_COOKIE}=" in header
                and ("max-age=0" in header.lower() or "expires=" in header.lower())
            ]
            assert expiring, f"{label} did not clear the cookie at {legacy_path}"


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


class _UpstreamStatusError(Exception):
    """Minimal stand-in for anthropic.APIStatusError.

    Carries the same public surface the adapter is allowed to read: a status
    code, the provider's error-type slug, an opaque request id and a message
    that must never reach the client or the logs.
    """

    def __init__(self, status_code: int, error_type: str) -> None:
        super().__init__("upstream detail with prompt echo: Durumu özetle")
        self.status_code = status_code
        self.type = error_type
        self.request_id = "req_upstream_123"


def _failing_provider(exc: Exception, *, model: str = "claude-sonnet-5") -> AnthropicProvider:
    class FakeMessages:
        async def create(self, **kwargs):
            raise exc

        async def count_tokens(self, **kwargs):
            raise exc

    class FakeClient:
        messages = FakeMessages()

        async def close(self):
            return None

    settings = AssistantSettings(
        enabled=True,
        provider="anthropic",
        model=model,
        api_key="server-secret",
    )
    return AnthropicProvider(settings, client_factory=lambda **kwargs: FakeClient())


def _generate(provider: AnthropicProvider):
    return provider.generate(ProviderRequest(
        messages=(
            ProviderMessage(role="system", content="Kurumsal yanıt ver."),
            ProviderMessage(role="user", content="Durumu özetle"),
        ),
        max_output_tokens=500,
    ))


@pytest.mark.parametrize(
    ("status_code", "error_type", "expected_kind"),
    [
        (401, "authentication_error", "auth"),
        (403, "permission_error", "permission"),
        (404, "not_found_error", "model"),
    ],
)
def test_rejected_credentials_raise_an_actionable_configuration_error(
    status_code,
    error_type,
    expected_kind,
):
    provider = _failing_provider(_UpstreamStatusError(status_code, error_type))

    with pytest.raises(AssistantConfigurationError) as failure:
        asyncio.run(_generate(provider))

    diagnostic = failure.value.diagnostic
    assert diagnostic.kind == expected_kind
    assert diagnostic.status_code == status_code
    assert diagnostic.error_type == error_type
    assert diagnostic.upstream_request_id == "req_upstream_123"
    # The operator gets a fix, not a retry prompt, and never the upstream body.
    assert "Durumu özetle" not in str(failure.value)
    assert "prompt echo" not in diagnostic.as_log_fields()


def test_upstream_outage_stays_generic_but_still_carries_a_diagnostic():
    provider = _failing_provider(_UpstreamStatusError(500, "api_error"))

    with pytest.raises(AssistantProviderError) as failure:
        asyncio.run(_generate(provider))

    assert not isinstance(failure.value, AssistantConfigurationError)
    assert str(failure.value) == "Claude Sonnet request failed."
    assert failure.value.diagnostic.kind == "upstream"
    assert failure.value.diagnostic.status_code == 500


def test_unreachable_provider_is_classified_as_a_network_failure():
    provider = _failing_provider(OSError("dns lookup failed"))

    with pytest.raises(AssistantProviderError) as failure:
        asyncio.run(_generate(provider))

    assert failure.value.diagnostic.kind == "network"
    assert failure.value.diagnostic.status_code == 0
    assert "dns lookup failed" not in str(failure.value)


def test_hostile_upstream_error_fields_are_rejected_before_logging():
    hostile = _UpstreamStatusError(500, "api_error\ninjected log line")
    hostile.request_id = "x" * 400
    provider = _failing_provider(hostile)

    with pytest.raises(AssistantProviderError) as failure:
        asyncio.run(_generate(provider))

    assert failure.value.diagnostic.error_type == ""
    assert failure.value.diagnostic.upstream_request_id == ""


def test_probe_verifies_credentials_without_spending_output_tokens():
    counted: list[dict] = []

    class FakeMessages:
        async def create(self, **kwargs):
            raise AssertionError("a probe must never bill a completion")

        async def count_tokens(self, **kwargs):
            counted.append(kwargs)
            return SimpleNamespace(input_tokens=7)

    class FakeClient:
        messages = FakeMessages()

        async def close(self):
            return None

    settings = AssistantSettings(
        enabled=True,
        provider="anthropic",
        model="claude-sonnet-5",
        api_key="server-secret",
    )
    provider = AnthropicProvider(settings, client_factory=lambda **kwargs: FakeClient())

    probe = asyncio.run(provider.probe())

    assert probe.ok is True
    assert probe.kind == "ok"
    assert counted == [{
        "model": "claude-sonnet-5",
        "messages": [{"role": "user", "content": "ping"}],
    }]


def test_probe_reports_a_rejected_key_instead_of_an_outage():
    provider = _failing_provider(_UpstreamStatusError(401, "authentication_error"))

    probe = asyncio.run(provider.probe())

    assert probe.ok is False
    assert probe.kind == "auth"
    assert probe.status_code == 401
    assert probe.error_type == "authentication_error"
    assert "ANTHROPIC_API_KEY" in probe.detail


def test_diagnostics_endpoint_reports_configuration_gaps_without_calling_out(monkeypatch):
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "claude-sonnet-5")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    reset_assistant_runtime()

    app.dependency_overrides[require_assistant_session] = lambda: Actor(
        id="actor-1",
        name="Operasyon",
        role="admin",
    )
    try:
        with TestClient(app) as client:
            response = client.post("/api/assistant/v1/diagnostics")
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)

    assert response.status_code == 200
    body = response.json()
    assert body["configuration_state"] == "api_key_missing"
    assert body["reachable"] is False
    assert body["reason"] == "not_configured"
    assert "ANTHROPIC_API_KEY" in body["detail"]


def test_diagnostics_endpoint_surfaces_a_rejected_key_and_hides_the_secret(monkeypatch):
    secret = "anthropic-secret-must-never-leak"
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "claude-sonnet-5")
    monkeypatch.setenv("ANTHROPIC_API_KEY", secret)
    reset_assistant_runtime()

    provider = _failing_provider(_UpstreamStatusError(401, "authentication_error"))
    monkeypatch.setattr(
        "backend.assistant.service.get_assistant_provider",
        lambda settings=None: provider,
    )

    app.dependency_overrides[require_assistant_session] = lambda: Actor(
        id="actor-1",
        name="Operasyon",
        role="admin",
    )
    try:
        with TestClient(app) as client:
            response = client.post("/api/assistant/v1/diagnostics")
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)

    assert response.status_code == 200
    body = response.json()
    assert body["configuration_state"] == "ready"
    assert body["reachable"] is False
    assert body["reason"] == "auth"
    assert body["upstream_status"] == 401
    assert body["upstream_error_type"] == "authentication_error"
    assert secret not in response.text
    assert "claude-sonnet-5" not in response.text


def test_supported_sonnet_models_cover_the_served_family_and_exclude_other_tiers():
    assert "claude-sonnet-5" in SUPPORTED_SONNET_MODELS
    assert "claude-sonnet-4-6" in SUPPORTED_SONNET_MODELS
    assert not any(
        model.startswith(("claude-opus", "claude-haiku"))
        for model in SUPPORTED_SONNET_MODELS
    )


def test_quoted_api_key_paste_is_repaired_instead_of_failing_upstream(monkeypatch):
    """Render keeps surrounding quotes verbatim, which upstream rejects as 401."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", '"sk-ant-quoted-value"')
    assert assistant_settings().api_key == "sk-ant-quoted-value"

    monkeypatch.setenv("ANTHROPIC_API_KEY", "  sk-ant-padded-value\n")
    assert assistant_settings().api_key == "sk-ant-padded-value"


def test_key_under_a_wrong_variable_name_is_reported_as_a_rename(monkeypatch):
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "claude-sonnet-5")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("CLAUDE_API_KEY", "sk-ant-misplaced")

    with TestClient(app) as client:
        response = client.get("/api/assistant/v1/status")

    assert response.status_code == 200
    assert response.json()["available"] is False
    assert response.json()["configuration_state"] == "api_key_misnamed"
    # The public endpoint states the misconfiguration, never the secret.
    assert "sk-ant-misplaced" not in response.text


def test_no_key_anywhere_still_reports_the_plain_missing_state(monkeypatch):
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "claude-sonnet-5")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    for alias in ANTHROPIC_API_KEY_ALIASES:
        monkeypatch.delenv(alias, raising=False)

    with TestClient(app) as client:
        response = client.get("/api/assistant/v1/status")

    assert response.json()["configuration_state"] == "api_key_missing"


def test_misnamed_key_diagnostics_name_the_variable_without_its_value(monkeypatch):
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "claude-sonnet-5")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("ANTROPIC_API_KEY", "sk-ant-typo-name")
    reset_assistant_runtime()

    app.dependency_overrides[require_assistant_session] = lambda: Actor(
        id="actor-1",
        name="Operasyon",
        role="admin",
    )
    try:
        with TestClient(app) as client:
            response = client.post("/api/assistant/v1/diagnostics")
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)

    body = response.json()
    assert body["configuration_state"] == "api_key_misnamed"
    assert body["reason"] == "not_configured"
    assert "ANTROPIC_API_KEY" in body["detail"]
    assert "ANTHROPIC_API_KEY" in body["detail"]
    assert "sk-ant-typo-name" not in response.text


def test_wrong_access_code_is_rejected_with_a_reason_the_form_can_show(monkeypatch):
    """The pairing form renders the server detail verbatim, so it must be exact."""
    from backend import auth

    monkeypatch.setattr(
        auth,
        "_auth_state",
        lambda: SimpleNamespace(auth={"session_secret": "s", "users": []}, database_backed=False),
    )

    with pytest.raises(HTTPException) as rejected:
        auth.authenticate("123456", client_key="wrong-code-test")

    assert rejected.value.status_code == 401
    assert rejected.value.detail == "Erişim kodu hatalı."


def test_short_access_code_is_rejected_before_any_hashing(monkeypatch):
    from backend import auth

    monkeypatch.setattr(
        auth,
        "_auth_state",
        lambda: (_ for _ in ()).throw(AssertionError("auth state must not be loaded")),
    )

    with pytest.raises(HTTPException) as rejected:
        auth.authenticate("123", client_key="short-code-test")

    assert rejected.value.status_code == 422
    assert rejected.value.detail == "Erişim kodu en az 6 karakter olmalıdır."


def _open_access_env(monkeypatch) -> None:
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "claude-sonnet-5")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-secret")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "1")


def test_open_access_connects_sonnet_without_an_access_code(monkeypatch):
    _open_access_env(monkeypatch)
    reset_assistant_runtime()

    with TestClient(app) as client:
        session = client.get("/api/assistant/v1/session")

    assert session.status_code == 200
    body = session.json()
    # The workspace renders the pairing form only while this is false.
    assert body["authenticated"] is True
    assert body["setup_required"] is False
    assert body["csrf_token"]
    assert ASSISTANT_SESSION_COOKIE in session.cookies

    with TestClient(app) as client:
        status_body = client.get("/api/assistant/v1/status").json()
    assert status_body["open_access"] is True


def test_assistant_cookie_reaches_dev_agent_routes_not_just_assistant_ones(monkeypatch):
    """The session cookie's Path is a browser-enforced allowlist: a request
    outside it is sent with no cookie at all, which the server cannot tell
    apart from "never logged in". A cookie scoped to /api/assistant/ would
    leave every /api/dev-agent/ call looking like a fresh, unauthenticated
    browser -- exactly what shipped once, diagnosed as a 401 on the dev-agent
    status endpoint by a real browser's own cookie jar. This uses a real
    signed cookie via TestClient's own cookie jar (not a hand-built header),
    so a Path regression fails here instead of only in someone's browser."""
    _open_access_env(monkeypatch)
    reset_assistant_runtime()

    with TestClient(app) as client:
        session = client.get("/api/assistant/v1/session").json()

        response = client.get(
            "/api/dev-agent/v1/status",
            headers={"X-CSRF-Token": session["csrf_token"]},
        )

    assert response.status_code == 200


def test_open_access_session_still_proves_csrf_and_origin(monkeypatch):
    """Dropping the access code must not drop the remaining request checks."""
    _open_access_env(monkeypatch)
    reset_assistant_runtime()

    with TestClient(app, base_url="https://excelbase.test") as client:
        session = client.get("/api/assistant/v1/session").json()

        without_csrf = client.post(
            "/api/assistant/v1/chat",
            json=_chat_payload(),
            headers={"Origin": "https://excelbase.test"},
        )
        foreign_origin = client.post(
            "/api/assistant/v1/chat",
            json=_chat_payload(),
            headers={
                "Origin": "https://attacker.example",
                "X-CSRF-Token": session["csrf_token"],
            },
        )

    assert without_csrf.status_code == 403
    assert foreign_origin.status_code == 403


def test_turning_open_access_off_revokes_tokens_already_issued(monkeypatch):
    _open_access_env(monkeypatch)
    reset_assistant_runtime()

    with TestClient(app) as client:
        opened = client.get("/api/assistant/v1/session")
        assert opened.json()["authenticated"] is True
        token = opened.cookies[ASSISTANT_SESSION_COOKIE]

    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "0")

    with TestClient(app) as client:
        client.cookies.set(ASSISTANT_SESSION_COOKIE, token, path=ASSISTANT_SESSION_PATH)
        closed = client.get("/api/assistant/v1/session")

    assert closed.json()["authenticated"] is False


def test_open_access_actor_cannot_authorize_the_legacy_application_api(monkeypatch):
    """The shared identity is Sonnet-only; it must not unlock passenger data."""
    _open_access_env(monkeypatch)
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "1")

    from backend import auth

    with TestClient(app) as client:
        session = client.get("/api/assistant/v1/session")
        token = session.cookies[ASSISTANT_SESSION_COOKIE]

    # The same token under the application audience resolves to nobody.
    assert auth._actor_from_token(token, audience="app") is None
    assert auth._actor_from_token(token, audience="assistant") == auth.OPEN_ACCESS_ACTOR


def test_open_access_shares_one_quota_bucket_across_visitors(monkeypatch):
    """A shared identity caps total spend instead of resetting per visitor."""
    _open_access_env(monkeypatch)
    monkeypatch.setenv("EXCELBASE_ASSISTANT_REQUESTS_PER_MINUTE", "1")
    reset_assistant_runtime()

    class FakeProvider:
        name = "fake"
        available = True
        calls = 0

        async def generate(self, request):
            type(self).calls += 1
            return ProviderResult(text="Tamam", input_tokens=1, output_tokens=1)

    monkeypatch.setattr(
        "backend.assistant.service.get_assistant_provider",
        lambda settings=None: FakeProvider(),
    )
    payload = AssistantChatRequest.model_validate(_chat_payload())
    from backend.auth import OPEN_ACCESS_ACTOR

    async def exercise():
        await generate_assistant_reply(
            payload, actor_id=OPEN_ACCESS_ACTOR.id, request_id="open-one"
        )
        # A second browser presents the same actor id, so the burst limit holds.
        with pytest.raises(AssistantQuotaError):
            await generate_assistant_reply(
                payload, actor_id=OPEN_ACCESS_ACTOR.id, request_id="open-two"
            )

    asyncio.run(exercise())
    assert FakeProvider.calls == 1


def test_open_access_browser_flow_reaches_sonnet_with_no_login_step(monkeypatch):
    """The whole sequence a freshly loaded workspace performs, end to end."""
    _open_access_env(monkeypatch)
    reset_assistant_runtime()

    class FakeProvider:
        name = "fake"
        available = True

        async def generate(self, request):
            return ProviderResult(text="12 yolcunun %75'i hazır.", input_tokens=80, output_tokens=14)

    monkeypatch.setattr(
        "backend.assistant.service.get_assistant_provider",
        lambda settings=None: FakeProvider(),
    )

    with TestClient(app, base_url="https://excelbase.test") as client:
        status_body = client.get("/api/assistant/v1/status").json()
        session = client.get("/api/assistant/v1/session").json()
        reply = client.post(
            "/api/assistant/v1/chat",
            json=_chat_payload(),
            headers={
                "Origin": "https://excelbase.test",
                "X-CSRF-Token": session["csrf_token"],
            },
        )

    assert status_body["available"] is True
    assert session["authenticated"] is True
    assert reply.status_code == 200
    assert reply.json()["message"] == "12 yolcunun %75'i hazır."


# --------------------------------------------------------------- tool loop
def _tool_settings(allow_writes: bool = True) -> AssistantSettings:
    return AssistantSettings(
        enabled=True,
        provider="anthropic",
        model="claude-sonnet-5",
        api_key="server-secret",
        allow_writes=allow_writes,
    )


def test_tool_catalogue_is_pseudonymous_and_marks_destructive_work():
    from backend.assistant.tools import ASSISTANT_TOOLS, CONFIRM_TOOL_NAMES

    # Fields that would carry a person's identity. Booleans such as
    # "has_passport" are document-presence flags, not identifying values, so the
    # check is on property names and on which of them accept free text.
    identifying = {
        "name", "full_name", "surname", "given_name", "ad", "soyad", "isim",
        "passport", "passport_no", "passport_number", "email", "phone", "tckn",
    }

    def walk(schema: dict, tool_name: str) -> None:
        for prop, definition in (schema.get("properties") or {}).items():
            assert prop not in identifying, f"{tool_name} identifying field: {prop}"
            if isinstance(definition, dict):
                walk(definition, tool_name)

    for tool in ASSISTANT_TOOLS:
        walk(tool.input_schema, tool.name)
        # Every free-text field must be bounded, so none can smuggle a record.
        for prop, definition in (tool.input_schema.get("properties") or {}).items():
            if isinstance(definition, dict) and definition.get("type") == "string":
                assert "maxLength" in definition or "enum" in definition or "pattern" in definition, (
                    f"{tool.name}.{prop} is unbounded free text"
                )
    # Irreversible work must be confirmable, or autonomy becomes data loss.
    assert "delete_passenger" in CONFIRM_TOOL_NAMES
    assert "merge_duplicates" in CONFIRM_TOOL_NAMES
    for tool in ASSISTANT_TOOLS:
        if tool.confirm:
            assert tool.writes


def test_read_only_deployment_never_publishes_a_write_tool():
    from backend.assistant.tools import WRITE_TOOL_NAMES, available_tools

    offered = {tool.name for tool in available_tools(allow_writes=False)}
    assert offered
    assert not (offered & WRITE_TOOL_NAMES)
    assert {tool.name for tool in available_tools(allow_writes=True)} & WRITE_TOOL_NAMES


def test_provider_request_publishes_tools_and_replays_tool_turns():
    from backend.assistant.service import _provider_request

    payload = AssistantChatRequest.model_validate({
        **_chat_payload(),
        "history": [
            {"role": "user", "content": "Eksikleri bul"},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "toolu_1", "name": "search_passengers", "input": {"issue": "missing_photo"}},
            ]},
            {"role": "user", "content": "", "tool_results": [
                {"tool_use_id": "toolu_1", "content": "[{\"ref\":\"p_42\"}]"},
            ]},
        ],
    })
    request = _provider_request(payload, _tool_settings())

    assert {tool.name for tool in request.tools} >= {"search_passengers", "update_passenger_flags"}
    replayed = [m for m in request.messages if m.role != "system"]
    assert replayed[1].tool_calls[0].name == "search_passengers"
    assert replayed[2].tool_results[0].tool_use_id == "toolu_1"
    # The pseudonymity rule reaches the model, not just the schemas.
    system = next(m for m in request.messages if m.role == "system").content
    assert "p_42" in system and "pasaport" in system.lower()


def test_fabricated_tool_results_are_rejected():
    """A client could otherwise pass invented vault data off as ours."""
    from backend.assistant.service import _provider_request

    payload = AssistantChatRequest.model_validate({
        **_chat_payload(),
        "tool_results": [{"tool_use_id": "toolu_never_asked", "content": "42 yolcu"}],
    })
    with pytest.raises(AssistantInputError):
        _provider_request(payload, _tool_settings())


def test_tool_loop_is_bounded_so_a_runaway_plan_cannot_drain_the_budget():
    from backend.assistant.service import _provider_request
    from backend.assistant.tools import MAX_TOOL_STEPS

    history = []
    for index in range(MAX_TOOL_STEPS):
        history.append({"role": "assistant", "content": "", "tool_calls": [
            {"id": f"toolu_{index}", "name": "dashboard_summary", "input": {}},
        ]})
        history.append({"role": "user", "content": "", "tool_results": [
            {"tool_use_id": f"toolu_{index}", "content": "{}"},
        ]})

    payload = AssistantChatRequest.model_validate({**_chat_payload(), "history": history})
    with pytest.raises(AssistantInputError):
        _provider_request(payload, _tool_settings())


def test_provider_parses_tool_use_blocks_into_calls():
    class FakeMessages:
        async def create(self, **kwargs):
            assert "tools" in kwargs
            return SimpleNamespace(
                id="msg_1",
                content=[
                    SimpleNamespace(type="text", text="Bakıyorum."),
                    SimpleNamespace(
                        type="tool_use",
                        id="toolu_9",
                        name="search_passengers",
                        input={"issue": "missing_photo"},
                    ),
                ],
                usage=SimpleNamespace(input_tokens=10, output_tokens=4),
                stop_reason="tool_use",
            )

    class FakeClient:
        messages = FakeMessages()

        async def close(self):
            return None

    from backend.assistant.tools import ASSISTANT_TOOLS

    provider = AnthropicProvider(_tool_settings(), client_factory=lambda **kw: FakeClient())
    result = asyncio.run(provider.generate(ProviderRequest(
        messages=(
            ProviderMessage(role="system", content="s"),
            ProviderMessage(role="user", content="Eksikleri bul"),
        ),
        max_output_tokens=500,
        tools=ASSISTANT_TOOLS,
    )))

    assert result.stop_reason == "tool_use"
    assert result.tool_calls[0].name == "search_passengers"
    assert result.tool_calls[0].input == {"issue": "missing_photo"}


def test_write_flags_come_from_the_catalogue_not_the_model(monkeypatch):
    """A crafted response must not be able to present a delete as a safe read."""
    from backend.assistant.service import _sanitize_tool_calls

    calls = (
        ProviderToolCall(id="t1", name="delete_passenger", input={"ref": "p_1"}),
        ProviderToolCall(id="t2", name="dashboard_summary", input={}),
        ProviderToolCall(id="t3", name="rm_-rf", input={}),
    )
    sanitized = _sanitize_tool_calls(calls, _tool_settings())

    names = [call.name for call in sanitized]
    assert names == ["delete_passenger", "dashboard_summary"]  # unknown tool dropped
    assert sanitized[0].writes is True and sanitized[0].confirm is True
    assert sanitized[1].writes is False and sanitized[1].confirm is False


def test_read_only_deployment_drops_a_write_call_the_model_still_attempts():
    from backend.assistant.service import _sanitize_tool_calls

    calls = (ProviderToolCall(id="t1", name="delete_passenger", input={"ref": "p_1"}),)
    assert _sanitize_tool_calls(calls, _tool_settings(allow_writes=False)) == []


def test_tool_continuation_does_not_charge_the_daily_budget_again(monkeypatch):
    """An 8-step answer must not cost 8x a one-shot answer."""
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "secret")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_REQUESTS_PER_DAY", "1")
    reset_assistant_runtime()

    class FakeProvider:
        name = "fake"
        available = True

        async def generate(self, request):
            return ProviderResult(text="Tamam", input_tokens=1, output_tokens=1)

    monkeypatch.setattr(
        "backend.assistant.service.get_assistant_provider",
        lambda settings=None: FakeProvider(),
    )

    opening = AssistantChatRequest.model_validate(_chat_payload())
    continuation = AssistantChatRequest.model_validate({
        **_chat_payload(),
        "history": [
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "toolu_1", "name": "dashboard_summary", "input": {}},
            ]},
        ],
        "tool_results": [{"tool_use_id": "toolu_1", "content": "{}"}],
    })

    async def exercise():
        await generate_assistant_reply(opening, actor_id="a", request_id="r1")
        # Daily budget is exhausted, yet the same question may finish its loop.
        await generate_assistant_reply(continuation, actor_id="a", request_id="r2")
        with pytest.raises(AssistantQuotaError):
            await generate_assistant_reply(opening, actor_id="a", request_id="r3")

    asyncio.run(exercise())


# ----------------------------------------------------- closed (scoped) server
def _closed_env(monkeypatch, allowed="203.0.113.5") -> None:
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_MODEL", "claude-sonnet-5")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "server-secret")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ALLOWED_IPS", allowed)
    reset_assistant_runtime()


def test_allowlist_admits_the_office_and_refuses_everyone_else(monkeypatch):
    _closed_env(monkeypatch, allowed="203.0.113.5, 10.0.0.0/8")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "1")

    app.dependency_overrides.pop(require_assistant_session, None)
    with TestClient(app, base_url="https://excelbase.test") as client:
        inside = client.get(
            "/api/assistant/v1/session", headers={"X-Forwarded-For": "203.0.113.5"}
        ).json()
        in_subnet = client.get(
            "/api/assistant/v1/session", headers={"X-Forwarded-For": "10.4.4.4"}
        ).json()
    assert inside["authenticated"] is True
    assert in_subnet["authenticated"] is True

    with TestClient(app, base_url="https://excelbase.test") as outsider:
        blocked = outsider.get(
            "/api/assistant/v1/session", headers={"X-Forwarded-For": "198.51.100.9"}
        ).json()
        chat = outsider.post(
            "/api/assistant/v1/chat",
            json=_chat_payload(),
            headers={"X-Forwarded-For": "198.51.100.9", "Origin": "https://excelbase.test"},
        )
    # Off-network callers get no session and cannot reach the billable endpoint.
    assert blocked["authenticated"] is False
    assert chat.status_code == 403


def test_forwarded_for_cannot_be_spoofed_past_the_allowlist(monkeypatch):
    """A caller prepending its own X-Forwarded-For must not get in."""
    _closed_env(monkeypatch, allowed="203.0.113.5")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "1")

    with TestClient(app, base_url="https://excelbase.test") as client:
        # Render appends the real address on the right; the forged entry is left.
        spoofed = client.get(
            "/api/assistant/v1/session",
            headers={"X-Forwarded-For": "203.0.113.5, 198.51.100.9"},
        ).json()
        genuine = client.get(
            "/api/assistant/v1/session",
            headers={"X-Forwarded-For": "198.51.100.9, 203.0.113.5"},
        ).json()

    assert spoofed["authenticated"] is False
    assert genuine["authenticated"] is True


def test_full_autonomy_is_withheld_while_the_deployment_is_open_and_unscoped(monkeypatch):
    from backend.assistant.service import autonomy_state, writes_enabled
    from backend.assistant.tools import WRITE_TOOL_NAMES, available_tools

    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "secret")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ALLOW_WRITES", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "1")
    monkeypatch.delenv("EXCELBASE_ASSISTANT_ALLOWED_IPS", raising=False)

    settings = assistant_settings()
    assert settings.allow_writes is True  # configured...
    assert writes_enabled(settings) is False  # ...but withheld
    assert autonomy_state(settings) == "blocked_open_network"
    offered = {tool.name for tool in available_tools(allow_writes=writes_enabled(settings))}
    assert not (offered & WRITE_TOOL_NAMES)


def test_scoping_the_network_unlocks_full_autonomy(monkeypatch):
    """The closed server is exactly what makes full authority safe to grant."""
    from backend.assistant.service import autonomy_state, writes_enabled
    from backend.assistant.tools import WRITE_TOOL_NAMES, available_tools

    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "secret")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ALLOW_WRITES", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ALLOWED_IPS", "203.0.113.5")

    settings = assistant_settings()
    assert writes_enabled(settings) is True
    assert autonomy_state(settings) == "full"
    offered = {tool.name for tool in available_tools(allow_writes=writes_enabled(settings))}
    assert offered >= WRITE_TOOL_NAMES

    with TestClient(app) as client:
        status_body = client.get("/api/assistant/v1/status").json()
    assert status_body["autonomy"] == "full"
    assert status_body["network_scoped"] is True


def test_closing_open_access_also_unlocks_autonomy_without_an_allowlist(monkeypatch):
    """Requiring the access code is the other way to close the deployment."""
    from backend.assistant.service import writes_enabled

    monkeypatch.setenv("EXCELBASE_ASSISTANT_ENABLED", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "secret")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_ALLOW_WRITES", "1")
    monkeypatch.setenv("EXCELBASE_ASSISTANT_OPEN_ACCESS", "0")
    monkeypatch.delenv("EXCELBASE_ASSISTANT_ALLOWED_IPS", raising=False)

    assert writes_enabled(assistant_settings()) is True


def test_a_malformed_allowlist_entry_does_not_widen_access(monkeypatch):
    from backend.config import assistant_allowed_networks

    monkeypatch.setenv("EXCELBASE_ASSISTANT_ALLOWED_IPS", "203.0.113.5, not-an-ip, ")
    networks = assistant_allowed_networks()
    assert len(networks) == 1
    assert str(networks[0]) == "203.0.113.5/32"


def test_continuation_orders_tool_results_directly_after_their_tool_use():
    """Anthropic rejects a tool_result that does not follow its tool_use.

    The question is replayed on every round, so the in-flight turns must land
    after it -- putting them in `history` would interleave the question between
    the call and its result.
    """
    from backend.assistant.service import _provider_request

    payload = AssistantChatRequest.model_validate({
        **_chat_payload("Fotoğrafı eksik olanlara görev aç"),
        "steps": [
            {"role": "assistant", "content": "Bakıyorum.", "tool_calls": [
                {"id": "toolu_1", "name": "search_passengers", "input": {"issue": "missing_photo"}},
            ]},
            {"role": "user", "content": "", "tool_results": [
                {"tool_use_id": "toolu_1", "content": "[{\"ref\":\"p_42\"}]"},
            ]},
            {"role": "assistant", "content": "", "tool_calls": [
                {"id": "toolu_2", "name": "create_task", "input": {"title": "p_42 fotoğrafı"}},
            ]},
        ],
        "tool_results": [{"tool_use_id": "toolu_2", "content": "{\"ok\":true}"}],
    })
    request = _provider_request(payload, _tool_settings())
    turns = [m for m in request.messages if m.role != "system"]

    shape = [
        (
            turn.role,
            "call" if turn.tool_calls else "result" if turn.tool_results else "text",
        )
        for turn in turns
    ]
    assert shape == [
        ("user", "text"),      # the question comes first
        ("assistant", "call"),
        ("user", "result"),
        ("assistant", "call"),
        ("user", "result"),
    ]
    # Each result immediately follows the call it answers.
    assert turns[2].tool_results[0].tool_use_id == turns[1].tool_calls[0].id
    assert turns[4].tool_results[0].tool_use_id == turns[3].tool_calls[0].id


# ------------------------------------------------------------------- memory
def test_memory_is_replayed_in_its_own_block_not_as_an_attested_metric():
    """Free text must not sit inside the numbers the app vouches for."""
    from backend.assistant.service import _provider_request

    payload = AssistantChatRequest.model_validate({
        **_chat_payload(),
        "context": {
            **_chat_payload()["context"],
            "memory": ["Cuma seferlerinde fotoğraf eksikleri artıyor."],
        },
    })
    request = _provider_request(payload, _tool_settings())
    system = next(m for m in request.messages if m.role == "system").content

    assert "<hatirladiklarin>" in system
    assert "Cuma seferlerinde" in system
    # The operational JSON stays purely numeric. The tag name also appears in
    # the rules above, so the last segment is the actual data block.
    context_json = system.split("<operasyon_baglamı>")[-1]
    assert "Cuma seferlerinde" not in context_json


def test_memory_entries_are_bounded_and_blank_ones_dropped():
    from backend.assistant.schemas import AssistantSafeContext

    context = AssistantSafeContext.model_validate({
        "memory": ["  ", "geçerli not", "x" * 900],
    })
    assert context.memory[0] == "geçerli not"
    assert len(context.memory[1]) == 400
    assert len(context.memory) == 2

    with pytest.raises(Exception):
        AssistantSafeContext.model_validate({"memory": ["not"] * 41})


def test_memory_tools_survive_a_read_only_deployment():
    """Remembering how an operation works changes nothing about it."""
    from backend.assistant.tools import (
        MEMORY_TOOL_NAMES,
        WRITE_TOOL_NAMES,
        available_tools,
    )

    read_only = {tool.name for tool in available_tools(allow_writes=False)}
    assert read_only >= MEMORY_TOOL_NAMES
    assert not (read_only & WRITE_TOOL_NAMES)
    # And a memory tool can never be a destructive one.
    assert not (MEMORY_TOOL_NAMES & CONFIRM_NAMES())


def CONFIRM_NAMES():
    from backend.assistant.tools import CONFIRM_TOOL_NAMES

    return CONFIRM_TOOL_NAMES
