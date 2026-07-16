from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import uuid
from dataclasses import dataclass

from fastapi import Header, HTTPException, Request, status

from .config import SESSION_COOKIE, SESSION_DAYS, api_key, require_auth
from .state import load_state, save_state
import db


@dataclass(frozen=True, slots=True)
class Actor:
    id: str
    name: str
    role: str


@dataclass(slots=True)
class _AuthSnapshot:
    auth: dict
    database_backed: bool
    df: object | None = None
    loaded_files: list[str] | None = None
    extra: dict | None = None


ROLE_LABELS = {"admin": "Yonetici", "operator": "Operasyon", "viewer": "Goruntuleme"}
_LOGIN_WINDOW_SECONDS = 15 * 60
_LOGIN_MAX_FAILURES = 6
_LOGIN_FAILURES: dict[str, list[float]] = {}
_LOGIN_LOCK = threading.Lock()
_AUTH_STATE_LOCK = threading.RLock()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _pin_hash(pin: str, salt: bytes) -> str:
    value = hashlib.scrypt(pin.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return _b64(value)


def _validate_pin(pin: str) -> str:
    normalized = pin.strip()
    if len(normalized) < 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Erisim kodu en az 6 karakter olmalidir.",
        )
    return normalized


def _auth_database_required() -> bool:
    return db.database_configured() or os.environ.get("APP_ENV", "development").lower() == "production"


def _auth_service_unavailable(exc: Exception | None = None) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            "Kimlik dogrulama veritabanina su anda ulasilamiyor. "
            "Lutfen kisa sure sonra yeniden deneyin."
        ),
    )


def _database_auth_state() -> dict:
    """Read the dedicated auth blob, lazily migrating the legacy extra value."""
    try:
        found, auth = db.load_auth_state()
    except db.DatabaseUnavailableError as exc:
        raise _auth_service_unavailable(exc) from exc
    if found:
        return dict(auth)

    # One-time compatibility read.  Polling and token validation never touch
    # the passenger blob again after even an empty auth state is materialized.
    legacy = db.load_state()
    if legacy is None:
        raise _auth_service_unavailable()
    legacy_dict = legacy if isinstance(legacy, dict) else {}
    extra = dict(legacy_dict.get("extra", {}) or {})
    auth = dict(extra.get("auth", legacy_dict.get("auth", {})) or {})
    try:
        return db.initialize_auth_state(auth)
    except db.DatabaseUnavailableError as exc:
        raise _auth_service_unavailable(exc) from exc


def _auth_state() -> _AuthSnapshot:
    if db.enabled():
        return _AuthSnapshot(auth=_database_auth_state(), database_backed=True)
    # Fail closed: a transient DB outage in production must never expose a
    # local "first setup" screen or create credentials on ephemeral disk.
    if _auth_database_required():
        raise _auth_service_unavailable()
    df, loaded_files, extra = load_state()
    return _AuthSnapshot(
        auth=dict(extra.get("auth", {}) or {}),
        database_backed=False,
        df=df,
        loaded_files=list(loaded_files),
        extra=extra,
    )


def _save_auth_state(snapshot: _AuthSnapshot, auth: dict) -> None:
    if snapshot.database_backed:
        try:
            saved = db.compare_and_swap_auth_state(snapshot.auth, auth)
        except db.DatabaseUnavailableError as exc:
            raise _auth_service_unavailable(exc) from exc
        if not saved:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Erisim ayarlari baska bir islemde degisti; lutfen yeniden deneyin.",
            )
        return
    extra = dict(snapshot.extra or {})
    extra["auth"] = auth
    save_state(snapshot.df, list(snapshot.loaded_files or []), extra)


def setup_required() -> bool:
    return not bool(_auth_state().auth.get("users"))


def setup_admin(display_name: str, pin: str) -> Actor:
    with _AUTH_STATE_LOCK:
        snapshot = _auth_state()
        if snapshot.auth.get("users"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Kurulum daha once tamamlanmis.")
        pin = _validate_pin(pin)
        salt = secrets.token_bytes(16)
        actor = Actor(id=str(uuid.uuid4()), name=display_name.strip() or "Yonetici", role="admin")
        auth = {
            "session_secret": secrets.token_urlsafe(48),
            "users": [
                {
                    "id": actor.id,
                    "name": actor.name,
                    "role": actor.role,
                    "salt": _b64(salt),
                    "pin_hash": _pin_hash(pin, salt),
                    "active": True,
                    "created_at": int(time.time()),
                }
            ],
        }
        _save_auth_state(snapshot, auth)
        return actor


def authenticate(pin: str, client_key: str = "unknown") -> Actor:
    pin = _validate_pin(pin)
    now = time.monotonic()
    with _LOGIN_LOCK:
        attempts = [stamp for stamp in _LOGIN_FAILURES.get(client_key, []) if now - stamp < _LOGIN_WINDOW_SECONDS]
        _LOGIN_FAILURES[client_key] = attempts
        if len(attempts) >= _LOGIN_MAX_FAILURES:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Cok fazla hatali deneme. Lutfen daha sonra tekrar deneyin.",
            )
    auth = _auth_state().auth
    for user in auth.get("users", []):
        if not user.get("active", True):
            continue
        try:
            actual = _pin_hash(pin, _unb64(str(user["salt"])))
        except Exception:
            continue
        if hmac.compare_digest(actual, str(user.get("pin_hash", ""))):
            with _LOGIN_LOCK:
                _LOGIN_FAILURES.pop(client_key, None)
            return Actor(id=str(user["id"]), name=str(user["name"]), role=str(user["role"]))
    with _LOGIN_LOCK:
        _LOGIN_FAILURES.setdefault(client_key, []).append(now)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Erisim kodu hatali.")


def issue_session(actor: Actor) -> str:
    auth = _auth_state().auth
    secret = str(auth.get("session_secret", ""))
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Oturum anahtari bulunamadi.")
    payload = {
        "sub": actor.id,
        "exp": int(time.time()) + SESSION_DAYS * 24 * 60 * 60,
        "nonce": secrets.token_hex(8),
    }
    encoded = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = _b64(hmac.new(secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def _actor_from_token(token: str | None) -> Actor | None:
    if not token or "." not in token:
        return None
    encoded, signature = token.split(".", 1)
    auth = _auth_state().auth
    secret = str(auth.get("session_secret", ""))
    if not secret:
        return None
    expected = _b64(hmac.new(secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(_unb64(encoded))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        user_id = str(payload.get("sub", ""))
    except Exception:
        return None
    for user in auth.get("users", []):
        if str(user.get("id")) == user_id and user.get("active", True):
            return Actor(id=user_id, name=str(user.get("name", "Kullanici")), role=str(user.get("role", "viewer")))
    return None


def optional_actor(request: Request) -> Actor | None:
    return _actor_from_token(request.cookies.get(SESSION_COOKIE))


def _api_key_actor(provided: str | None) -> Actor | None:
    expected = api_key()
    if expected and provided and secrets.compare_digest(provided, expected):
        return Actor(id="service", name="API Servisi", role="admin")
    return None


def _resolve_actor(request: Request, provided: str | None = None) -> Actor | None:
    actor = _api_key_actor(provided) or optional_actor(request)
    if actor is None and not require_auth():
        actor = Actor(id="local", name="Yerel Kullanici", role="admin")
    return actor


def require_api_key(
    request: Request,
    x_api_key: str | None = Header(default=None),
) -> Actor:
    actor = _resolve_actor(request, x_api_key)
    if actor is None:
        detail = "Ilk kurulum gerekli." if setup_required() else "Oturum acmaniz gerekiyor."
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)
    request.state.actor = actor
    return actor


def require_api_key_flexible(
    request: Request,
    x_api_key: str | None = Header(default=None),
) -> Actor:
    # Administrator-equivalent service keys are accepted only in a header.
    # Query parameters leak through browser history, screenshots and proxies.
    actor = _resolve_actor(request, x_api_key)
    if actor is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Oturum acmaniz gerekiyor.")
    request.state.actor = actor
    return actor


def require_write_access(
    request: Request,
    x_api_key: str | None = Header(default=None),
) -> Actor:
    resolved = _resolve_actor(request, x_api_key)
    if resolved is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Oturum acmaniz gerekiyor.")
    if resolved.role not in {"admin", "operator"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu islem icin yazma yetkisi gerekli.")
    request.state.actor = resolved
    return resolved


def require_admin_access(
    request: Request,
    x_api_key: str | None = Header(default=None),
) -> Actor:
    actor = _resolve_actor(request, x_api_key)
    if actor is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Oturum acmaniz gerekiyor.")
    if actor.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu islem yalnizca yoneticiye acik.")
    request.state.actor = actor
    return actor


def list_users() -> list[dict[str, str | bool]]:
    auth = _auth_state().auth
    return [
        {
            "id": str(user.get("id", "")),
            "name": str(user.get("name", "")),
            "role": str(user.get("role", "viewer")),
            "active": bool(user.get("active", True)),
        }
        for user in auth.get("users", [])
    ]


def create_user(name: str, pin: str, role: str) -> dict[str, str | bool]:
    if role not in ROLE_LABELS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Gecersiz rol.")
    pin = _validate_pin(pin)
    with _AUTH_STATE_LOCK:
        snapshot = _auth_state()
        auth = copy.deepcopy(snapshot.auth)
        for user in auth.get("users", []):
            try:
                if hmac.compare_digest(_pin_hash(pin, _unb64(str(user["salt"]))), str(user.get("pin_hash", ""))):
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bu erisim kodu zaten kullaniliyor.")
            except HTTPException:
                raise
            except Exception:
                continue
        salt = secrets.token_bytes(16)
        user = {
            "id": str(uuid.uuid4()),
            "name": name.strip() or "Kullanici",
            "role": role,
            "salt": _b64(salt),
            "pin_hash": _pin_hash(pin, salt),
            "active": True,
            "created_at": int(time.time()),
        }
        auth.setdefault("users", []).append(user)
        _save_auth_state(snapshot, auth)
        return {"id": user["id"], "name": user["name"], "role": role, "active": True}


def deactivate_user(user_id: str, current_actor: Actor) -> None:
    if user_id == current_actor.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Kendi hesabinizi devre disi birakamazsiniz.")
    with _AUTH_STATE_LOCK:
        snapshot = _auth_state()
        auth = copy.deepcopy(snapshot.auth)
        for user in auth.get("users", []):
            if str(user.get("id")) == user_id:
                user["active"] = False
                _save_auth_state(snapshot, auth)
                return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanici bulunamadi.")
