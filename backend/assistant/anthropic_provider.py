from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from typing import Any

from backend.config import AssistantSettings

from .provider import (
    AssistantProviderError,
    AssistantRateLimitError,
    AssistantTimeoutError,
    ProviderRequest,
    ProviderResult,
)


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


def _retry_after(exc: Exception) -> int:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    raw = headers.get("retry-after") if headers is not None else None
    try:
        return max(1, min(300, int(float(raw))))
    except (TypeError, ValueError, OverflowError):
        return 30


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
            raise AssistantProviderError("Anthropic SDK is not installed.") from exc
        return AsyncAnthropic(
            api_key=self._settings.api_key,
            timeout=self._settings.timeout_seconds,
            max_retries=0,
        )

    async def generate(self, request: ProviderRequest) -> ProviderResult:
        system_parts: list[str] = []
        messages: list[dict[str, str]] = []
        for message in request.messages:
            if message.role == "system":
                system_parts.append(message.content)
            else:
                messages.append({"role": message.role, "content": message.content})

        if not messages:
            raise AssistantProviderError("No user message was supplied.")

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
            status_code = getattr(exc, "status_code", None)
            if status_code == 429:
                raise AssistantRateLimitError(_retry_after(exc)) from None
            if status_code in {408, 504}:
                raise AssistantTimeoutError("Claude Sonnet timed out.") from None
            # Never propagate the upstream body or exception repr: either can
            # contain request content or provider diagnostics.
            raise AssistantProviderError("Claude Sonnet request failed.") from None
        finally:
            if client is not None:
                close = getattr(client, "close", None)
                if callable(close):
                    try:
                        maybe_awaitable = close()
                        if inspect.isawaitable(maybe_awaitable):
                            await maybe_awaitable
                    except Exception:
                        # Closing a spent client must not mask the sanitized
                        # provider result or error.
                        pass

        text_parts: list[str] = []
        for block in _attr(response, "content", []) or []:
            if _attr(block, "type", "") == "text":
                text = str(_attr(block, "text", "") or "").strip()
                if text:
                    text_parts.append(text)
        text = "\n\n".join(text_parts).strip()
        if not text:
            raise AssistantProviderError("Claude Sonnet returned no text.")

        usage = _attr(response, "usage", {}) or {}
        return ProviderResult(
            text=text,
            input_tokens=_bounded_usage(_attr(usage, "input_tokens", 0)),
            output_tokens=_bounded_usage(_attr(usage, "output_tokens", 0)),
            stop_reason=str(_attr(response, "stop_reason", "") or "")[:80],
            request_id=str(_attr(response, "_request_id", "") or _attr(response, "id", "") or "")[:200],
        )
