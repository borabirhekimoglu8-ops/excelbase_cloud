from __future__ import annotations

import pytest
from fastapi import HTTPException, Request


def _request(query: bytes = b"") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/photo/example",
            "headers": [],
            "query_string": query,
            "server": ("testserver", 80),
            "client": ("127.0.0.1", 1234),
            "scheme": "http",
        }
    )


def test_service_api_key_is_header_only_and_query_value_is_ignored(monkeypatch):
    from backend import auth

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("GATEVISA_REQUIRE_AUTH", "1")
    monkeypatch.setenv("GATEVISA_API_KEY", "server-only-secret")

    with pytest.raises(HTTPException) as rejected:
        auth.require_api_key_flexible(_request(b"k=server-only-secret"), x_api_key=None)
    assert rejected.value.status_code == 401

    actor = auth.require_api_key_flexible(
        _request(),
        x_api_key="server-only-secret",
    )
    assert actor.role == "admin" and actor.id == "service"
