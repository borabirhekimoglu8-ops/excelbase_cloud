from __future__ import annotations

import asyncio
import json
import logging

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

import db
from backend.assistant.provider import ProviderResult
from backend.assistant.schemas import AssistantChatRequest
from backend.assistant.service import (
    AssistantDuplicateRequestError,
    generate_assistant_reply,
    reset_assistant_runtime,
)
from backend.auth import Actor, require_assistant_session
from backend.main import app


def _payload(message: str = "Durumu özetle") -> dict:
    return {
        "message": message,
        "history": [],
        "context": {"version": 1, "metrics": {"passenger_count": 2}},
        "privacy_acknowledged": True,
    }


def test_persistent_quota_is_global_actor_scoped_and_idempotent(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    db._create_tables(engine)
    monkeypatch.setattr(db, "get_engine", lambda: engine)
    day = "2026-07-24"

    assert db.reserve_assistant_request(
        "request-1", "actor-1", day, actor_limit=1, global_limit=2
    ) == "reserved"
    assert db.reserve_assistant_request(
        "request-1", "actor-1", day, actor_limit=1, global_limit=2
    ) == "duplicate"
    assert db.reserve_assistant_request(
        "request-2", "actor-1", day, actor_limit=1, global_limit=2
    ) == "actor_quota"
    assert db.reserve_assistant_request(
        "request-3", "actor-2", day, actor_limit=1, global_limit=2
    ) == "reserved"
    assert db.reserve_assistant_request(
        "request-4", "actor-3", day, actor_limit=1, global_limit=2
    ) == "global_quota"

    assert db.settle_assistant_request(
        "request-1", status="completed", input_tokens=17, output_tokens=5
    )
    assert not db.settle_assistant_request(
        "request-1", status="completed", input_tokens=17, output_tokens=5
    )
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT scope, subject, request_count, input_tokens, output_tokens "
                "FROM v7_assistant_usage_daily WHERE usage_day = :day"
            ),
            {"day": day},
        ).fetchall()
    usage = {(row[0], row[1]): tuple(row[2:]) for row in rows}
    assert usage[("global", "*")] == (2, 17, 5)
    assert usage[("actor", "actor-1")] == (1, 17, 5)
    assert usage[("actor", "actor-2")] == (1, 0, 0)


def test_assistant_logs_never_include_prompt_response_or_api_key(
    monkeypatch,
    caplog,
):
    prompt_secret = "PASAPORT-U12345678"
    response_secret = "YANITTA-GIZLI-METIN"
    api_secret = "sk-ant-api-gizli"

    class FakeProvider:
        name = "fake"
        available = True

        async def generate(self, request):
            return ProviderResult(
                text=response_secret,
                input_tokens=7,
                output_tokens=3,
                request_id="upstream-safe-id",
            )

    monkeypatch.setenv("ANTHROPIC_API_KEY", api_secret)
    monkeypatch.setattr("backend.assistant.service.get_assistant_provider", FakeProvider)
    monkeypatch.setattr(db, "enabled", lambda: False)
    monkeypatch.setattr(db, "database_configured", lambda: False)
    reset_assistant_runtime()
    caplog.set_level(logging.INFO)

    payload = AssistantChatRequest.model_validate(_payload(prompt_secret))
    result = asyncio.run(
        generate_assistant_reply(payload, actor_id="actor-1", request_id="request-safe-id")
    )

    assert result.message == response_secret
    combined = "\n".join(record.getMessage() for record in caplog.records)
    assert "request-safe-id" in combined
    assert prompt_secret not in combined
    assert response_secret not in combined
    assert api_secret not in combined


def test_chat_body_limit_rejects_before_authentication():
    auth_called = False

    def fake_actor() -> Actor:
        nonlocal auth_called
        auth_called = True
        return Actor(id="actor-1", name="Operasyon", role="admin")

    app.dependency_overrides[require_assistant_session] = fake_actor
    try:
        oversized = json.dumps(_payload("x" * 70_000))
        with TestClient(app) as client:
            response = client.post(
                "/api/assistant/v1/chat",
                content=oversized,
                headers={"Content-Type": "application/json"},
            )
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)

    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"
    assert auth_called is False


def test_duplicate_chat_request_returns_conflict(monkeypatch):
    async def duplicate(*args, **kwargs):
        raise AssistantDuplicateRequestError

    monkeypatch.setattr("backend.main.generate_assistant_reply", duplicate)
    app.dependency_overrides[require_assistant_session] = lambda: Actor(
        id="actor-1", name="Operasyon", role="admin"
    )
    try:
        with TestClient(app) as client:
            response = client.post("/api/assistant/v1/chat", json=_payload())
    finally:
        app.dependency_overrides.pop(require_assistant_session, None)

    assert response.status_code == 409
