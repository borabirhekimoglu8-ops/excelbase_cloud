from __future__ import annotations

import pytest

sqlalchemy = pytest.importorskip("sqlalchemy")
from sqlalchemy import create_engine  # noqa: E402

import db  # noqa: E402
from backend import auth  # noqa: E402


@pytest.fixture()
def auth_db(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'auth.sqlite'}")
    db._create_tables(engine)
    monkeypatch.setattr(db, "get_engine", lambda: engine)
    monkeypatch.setattr(db, "database_configured", lambda: True)
    monkeypatch.setattr(db, "enabled", lambda: True)
    return engine


def _stored_auth() -> dict:
    return {
        "session_secret": "test-session-secret",
        "users": [
            {
                "id": "admin-1",
                "name": "Admin",
                "role": "admin",
                "active": True,
            }
        ],
    }


def test_existing_small_auth_never_loads_passenger_state(auth_db, monkeypatch):
    assert db.save_auth_state(_stored_auth())

    def passenger_blob_must_not_be_loaded():
        raise AssertionError("passenger app_state was loaded on auth fast path")

    monkeypatch.setattr(db, "load_state", passenger_blob_must_not_be_loaded)
    monkeypatch.setattr(auth, "load_state", passenger_blob_must_not_be_loaded)

    actor = auth.Actor(id="admin-1", name="Admin", role="admin")
    token = auth.issue_session(actor)
    assert auth.setup_required() is False
    assert auth._actor_from_token(token) == actor
    assert auth.list_users() == [
        {"id": "admin-1", "name": "Admin", "role": "admin", "active": True}
    ]


def test_legacy_auth_is_migrated_once_then_uses_small_state(auth_db, monkeypatch):
    assert db.save_state(
        {
            "passengers": [{"large": "passenger-state"}],
            "loaded_files": [],
            "extra": {"auth": _stored_auth()},
        }
    )
    found, _ = db.load_auth_state()
    assert found is False

    assert auth.setup_required() is False
    found, migrated = db.load_auth_state()
    assert found is True
    assert migrated == _stored_auth()

    monkeypatch.setattr(
        db,
        "load_state",
        lambda: (_ for _ in ()).throw(AssertionError("legacy state loaded twice")),
    )
    assert auth.setup_required() is False


@pytest.mark.parametrize(
    ("configured", "environment"),
    [(True, "development"), (False, "production")],
)
def test_configured_or_production_database_outage_fails_closed(
    monkeypatch, configured, environment
):
    monkeypatch.setattr(db, "enabled", lambda: False)
    monkeypatch.setattr(db, "database_configured", lambda: configured)
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setattr(
        auth,
        "load_state",
        lambda: (_ for _ in ()).throw(AssertionError("unsafe local auth fallback")),
    )

    with pytest.raises(auth.HTTPException) as exc_info:
        auth.setup_required()
    assert exc_info.value.status_code == 503

    with pytest.raises(auth.HTTPException) as exc_info:
        auth.setup_admin("Admin", "123456")
    assert exc_info.value.status_code == 503


def test_development_without_database_keeps_local_fallback(monkeypatch):
    local_extra = {"auth": _stored_auth()}
    monkeypatch.setattr(db, "enabled", lambda: False)
    monkeypatch.setattr(db, "database_configured", lambda: False)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setattr(auth, "load_state", lambda: (object(), [], local_extra))

    assert auth.setup_required() is False
    assert auth.list_users()[0]["id"] == "admin-1"
