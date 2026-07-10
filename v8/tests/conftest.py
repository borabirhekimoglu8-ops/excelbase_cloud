from __future__ import annotations

import os
from pathlib import Path

from cryptography.fernet import Fernet

TEST_DB = Path(__file__).parent / "test_v8.db"
TEST_OBJECTS = Path(__file__).parent / "test_objects"
os.environ["V8_APP_ENV"] = "test"
os.environ.setdefault("V8_DATABASE_URL", f"sqlite:///{TEST_DB}")
os.environ["V8_ALLOW_DEV_IDENTITY"] = "1"
os.environ["V8_AUTO_CREATE_SCHEMA"] = "0"
os.environ["V8_FIELD_ENCRYPTION_KEY"] = Fernet.generate_key().decode("ascii")
os.environ["V8_PASSPORT_HMAC_KEY"] = "test-passport-hmac-key-that-is-longer-than-32-bytes"
os.environ.setdefault("V8_JWT_SECRET", "test-jwt-secret-used-only-in-tests")
os.environ["V8_STORAGE_BACKEND"] = "local"
os.environ["V8_STORAGE_LOCAL_ROOT"] = str(TEST_OBJECTS)

import shutil

import pytest
from fastapi.testclient import TestClient

from app.database import Base, get_engine, get_session_factory
from app.main import app
from app.models import Membership, Organization, Role, User


@pytest.fixture(autouse=True)
def clean_database():
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    shutil.rmtree(TEST_OBJECTS, ignore_errors=True)


@pytest.fixture
def seeded():
    db = get_session_factory()()
    org_a = Organization(name="Aegean Ops", slug="aegean-ops")
    org_b = Organization(name="Island Partner", slug="island-partner")
    user_a = User(email="owner-a@example.com", display_name="Owner A")
    user_b = User(email="owner-b@example.com", display_name="Owner B")
    user_viewer = User(email="viewer-a@example.com", display_name="Viewer A")
    db.add_all([org_a, org_b, user_a, user_b, user_viewer])
    db.flush()
    db.add_all(
        [
            Membership(organization_id=org_a.id, user_id=user_a.id, role=Role.OWNER.value),
            Membership(organization_id=org_b.id, user_id=user_b.id, role=Role.OWNER.value),
            Membership(organization_id=org_a.id, user_id=user_viewer.id, role=Role.VIEWER.value),
        ]
    )
    db.commit()
    result = {
        "org_a": org_a,
        "org_b": org_b,
        "user_a": user_a,
        "user_b": user_b,
        "user_viewer": user_viewer,
        "headers_a": {"X-User-ID": str(user_a.id), "X-Organization-ID": str(org_a.id)},
        "headers_b": {"X-User-ID": str(user_b.id), "X-Organization-ID": str(org_b.id)},
        "headers_viewer": {"X-User-ID": str(user_viewer.id), "X-Organization-ID": str(org_a.id)},
    }
    db.close()
    return result


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
