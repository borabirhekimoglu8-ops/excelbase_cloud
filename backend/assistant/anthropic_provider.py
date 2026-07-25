from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from typing import Any, NoReturn

from backend.config import AssistantSettings

from .provider import (
    AssistantConfigurationError,
    AssistantProviderError,
    AssistantRateLimitError,
    AssistantTimeoutError,
    ProviderDiagnostic,
    ProviderFailureKind,
    ProviderProbe,
    ProviderRequest,
    ProviderResult,
)

# Anthropic returns a small, fixed vocabulary of error types
# ("authentication_error", "not_found_error", ...).  Accepting only that shape
# keeps a hostile or buggy upstream from turning the field into a log-injection
# or PII channel.
_ERROR_TYPE_MAX_LENGTH = 64
_REQUEST_ID_MAX_LENGTH = 200


def _attr(value: object, name: str, default: object = None) -> object:
    if isinstance(value, dict):
        return value.get(name, default)
    return getattr(value, name, default)


def _bounded_usage(value: object) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return 0
    return max(0, min(10_000_000, parsed))


def _response_headers(exc: Exception) -> Any:
    response = getattr(exc, "response", None)
    return getattr(response, "headers", None)


def _retry_after(exc: Exception) -> int:
    headers = _response_headers(exc)
    raw = headers.get("retry-after") if headers is not None else None
    try:
        return max(1, min(300, int(float(raw))))
    except (TypeError, ValueError, OverflowError):
        return 30


def _safe_slug(value: object, max_length: int) -> str:
    """Return a short identifier, or "" when the upstream sent anything else."""
    text = str(value or "").strip()
    if not text or len(text) > max_length:
        return ""
    if not all(character.isalnum() or character in "_.:-" for character in text):
        return ""
    return text


def _status_code(exc: Exception) -> int:
    raw = getattr(exc, "status_code", None)
    try:
        parsed = int(raw)
    except (TypeError, ValueError, OverflowError):
        return 0
    return parsed if 100 <= parsed <= 599 else 0


def _error_type(exc: Exception) -> str:
    """Read the provider's error taxonomy without touching the message body.

    The SDK exposes ``.type`` on every ``APIStatusError``; older releases only
    carry it inside ``.body["error"]["type"]``.  Both are enum-like slugs, never
    request content.
    """
    direct = _safe_slug(getattr(exc, "type", None), _ERROR_TYPE_MAX_LENGTH)
    if direct:
        return direct
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            return _safe_slug(error.get("type"), _ERROR_TYPE_MAX_LENGTH)
    return ""


def _upstream_request_id(exc: Exception) -> str:
    direct = _safe_slug(getattr(exc, "request_id", None), _REQUEST_ID_MAX_LENGTH)
    if direct:
        return direct
    headers = _response_headers(exc)
    if headers is None:
        return ""
    return _safe_slug(headers.get("request-id"), _REQUEST_ID_MAX_LENGTH)


def _failure_kind(exc: Exception, status_code: int) -> ProviderFailureKind:
    if status_code == 401:
        return "auth"
    if status_code == 403:
        return "permission"
    if status_code == 404:
        return "model"
    if status_code == 429:
        return "rate_limit"
    if status_code in {408, 504}:
        return "timeout"
    if status_code == 400:
        return "request"
    if status_code >= 500:
        return "upstream"
    if status_code:
        return "unknown"
    # No HTTP status at all means the request never reached Anthropic:
    # DNS, TLS, proxy or egress failure.
    return "network"


def _diagnose(exc: Exception) -> ProviderDiagnostic:
    status_code = _status_code(exc)
    return ProviderDiagnostic(
        kind=_failure_kind(exc, status_code),
        status_code=status_code,
        error_type=_error_type(exc),
        upstream_request_id=_upstream_request_id(exc),
    )


# Operator-facing text for a failure that retrying cannot clear.  These strings
# describe our own deployment configuration, never the user's request.
_CONFIGURATION_MESSAGES: dict[str, str] = {
    "auth": (
        "Anthropic API anahtarı reddedildi. ANTHROPIC_API_KEY değerini "
        "doğrulayıp servisi yeniden başlatın."
    ),
    "permission": (
        "Anthropic API anahtarının bu modele erişim yetkisi yok. Anahtarın "
        "workspace kapsamını ve faturalandırmasını kontrol edin."
    ),
    "model": (
        "Yapılandırılan Claude modeli Anthropic tarafından bulunamadı. "
        "EXCELBASE_ASSISTANT_MODEL değerini kontrol edin."
    ),
}

# Probe-only wording.  A probe reports every failure kind, including the ones a
# chat turn maps to a dedicated exception.
_PROBE_MESSAGES: dict[str, str] = {
    **_CONFIGURATION_MESSAGES,
    "rate_limit": "Anthropic hız sınırı uygulandı; anahtar geçerli.",
    "request": "Anthropic isteği geçersiz buldu; model yapılandırmasını kontrol edin.",
    "timeout": "Anthropic yanıt vermeden zaman aşımına uğradı.",
    "network": (
        "Anthropic API'sine ağ üzerinden ulaşılamadı. Sunucunun dış erişimini "
        "(egress) kontrol edin."
    ),
    "upstream": "Anthropic tarafında geçici bir hata var; sonra tekrar deneyin.",
}


class AnthropicProvider:
    """Small, testable adapter around Anthropic's official async SDK.

    The SDK import is deliberately lazy. A disabled or partially configured
    deployment therefore stays fail-closed and never initializes a network
    client. The API key is passed only to the server-side SDK constructor.
    """

    name = "anthropic"
    available = True

    def __init__(
        self,
        settings: AssistantSettings,
        client_factory: Callable[..., Any] | None = None,
    ) -> None:
        self._settings = settings
        self._client_factory = client_factory

    def _client(self) -> Any:
        if self._client_factory is not None:
            return self._client_factory(
                api_key=self._settings.api_key,
                timeout=self._settings.timeout_seconds,
                max_retries=0,
            )
        try:
            from anthropic import AsyncAnthropic
        except ImportError as exc:  # pragma: no cover - production dependency guard
            raise AssistantProviderError(
                "Anthropic SDK is not installed.",
                ProviderDiagnostic(kind="unknown"),
            ) from exc
        return AsyncAnthropic(
            api_key=self._settings.api_key,
            timeout=self._settings.timeout_seconds,
            max_retries=0,
        )

    @staticmethod
    async def _close(client: Any | None) -> None:
        if client is None:
            return
        close = getattr(client, "close", None)
        if not callable(close):
            return
        try:
            maybe_awaitable = close()
            if inspect.isawaitable(maybe_awaitable):
                await maybe_awaitable
        except Exception:
            # Closing a spent client must not mask the sanitized provider
            # result or error.
            pass

    def _raise_sanitized(self, exc: Exception) -> NoReturn:
        """Convert an upstream failure into a typed, content-free error."""
        diagnostic = _diagnose(exc)
        if diagnostic.kind == "rate_limit":
            raise AssistantRateLimitError(_retry_after(exc)) from None
        if diagnostic.kind == "timeout":
            raise AssistantTimeoutError("Claude Sonnet timed out.") from None
        configuration_message = _CONFIGURATION_MESSAGES.get(diagnostic.kind)
        if configuration_message is not None:
            raise AssistantConfigurationError(configuration_message, diagnostic) from None
        # Never propagate the upstream body or exception repr: either can
        # contain request content or provider diagnostics.  The taxonomy on the
        # diagnostic is what makes the failure debuggable.
        raise AssistantProviderError("Claude Sonnet request failed.", diagnostic) from None

    async def generate(self, request: ProviderRequest) -> ProviderResult:
        system_parts: list[str] = []
        messages: list[dict[str, str]] = []
        for message in request.messages:
            if message.role == "system":
                system_parts.append(message.content)
            else:
                messages.append({"role": message.role, "content": message.content})

        if not messages:
            raise AssistantProviderError(
                "No user message was supplied.",
                ProviderDiagnostic(kind="request"),
            )

        client: Any | None = None
        try:
            client = self._client()
            response = await asyncio.wait_for(
                client.messages.create(
                    model=self._settings.model,
                    max_tokens=min(request.max_output_tokens, self._settings.max_output_tokens),
                    system="\n\n".join(system_parts),
                    messages=messages,
                ),
                timeout=self._settings.timeout_seconds,
            )
        except AssistantProviderError:
            raise
        except (asyncio.TimeoutError, TimeoutError) as exc:
            raise AssistantTimeoutError("Claude Sonnet timed out.") from exc
        except Exception as exc:
            self._raise_sanitized(exc)
        finally:
            await self._close(client)

        text_parts: list[str] = []
        for block in _attr(response, "content", []) or []:
            if _attr(block, "type", "") == "text":
                text = str(_attr(block, "text", "") or "").strip()
                if text:
                    text_parts.append(text)
        text = "\n\n".join(text_parts).strip()
        if not text:
            raise AssistantProviderError(
                "Claude Sonnet returned no text.",
                ProviderDiagnostic(
                    kind="response",
                    error_type=_safe_slug(
                        _attr(response, "stop_reason", ""), _ERROR_TYPE_MAX_LENGTH
                    ),
                    upstream_request_id=_safe_slug(
                        _attr(response, "_request_id", "") or _attr(response, "id", ""),
                        _REQUEST_ID_MAX_LENGTH,
                    ),
                ),
            )

        usage = _attr(response, "usage", {}) or {}
        return ProviderResult(
            text=text,
            input_tokens=_bounded_usage(_attr(usage, "input_tokens", 0)),
            output_tokens=_bounded_usage(_attr(usage, "output_tokens", 0)),
            stop_reason=str(_attr(response, "stop_reason", "") or "")[:80],
            request_id=str(_attr(response, "_request_id", "") or _attr(response, "id", "") or "")[:200],
        )

    async def probe(self) -> ProviderProbe:
        """Check credentials, model id and egress without billing output tokens.

        ``count_tokens`` performs the same authentication and model resolution
        as a chat turn but is free, so an operator can confirm a deployment is
        wired correctly without spending the daily budget.
        """
        client: Any | None = None
        try:
            client = self._client()
            await asyncio.wait_for(
                client.messages.count_tokens(
                    model=self._settings.model,
                    messages=[{"role": "user", "content": "ping"}],
                ),
                timeout=self._settings.timeout_seconds,
            )
        except AssistantProviderError as exc:
            return ProviderProbe(
                ok=False,
                kind=exc.diagnostic.kind,
                status_code=exc.diagnostic.status_code,
                error_type=exc.diagnostic.error_type,
                upstream_request_id=exc.diagnostic.upstream_request_id,
                detail=str(exc),
            )
        except (asyncio.TimeoutError, TimeoutError):
            return ProviderProbe(
                ok=False,
                kind="timeout",
                detail="Anthropic yanıt vermeden zaman aşımına uğradı.",
            )
        except Exception as exc:
            diagnostic = _diagnose(exc)
            return ProviderProbe(
                ok=False,
                kind=diagnostic.kind,
                status_code=diagnostic.status_code,
                error_type=diagnostic.error_type,
                upstream_request_id=diagnostic.upstream_request_id,
                detail=_PROBE_MESSAGES.get(
                    diagnostic.kind,
                    "Anthropic isteği başarısız oldu.",
                ),
            )
        finally:
            await self._close(client)
        return ProviderProbe(ok=True, detail="Claude Sonnet erişilebilir.")
