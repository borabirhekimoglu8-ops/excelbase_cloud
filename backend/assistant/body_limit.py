from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any


class _AssistantBodyTooLarge(RuntimeError):
    pass


class AssistantBodyLimitMiddleware:
    """Reject oversized chat JSON before FastAPI parses it into memory."""

    def __init__(
        self,
        app: Callable[..., Awaitable[None]],
        *,
        max_bytes: int = 64 * 1024,
    ) -> None:
        self.app = app
        self.max_bytes = max(1024, int(max_bytes))

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[[], Awaitable[dict[str, Any]]],
        send: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        if (
            scope.get("type") != "http"
            or scope.get("method") != "POST"
            or scope.get("path") != "/api/assistant/v1/chat"
        ):
            await self.app(scope, receive, send)
            return

        content_length = ""
        for raw_name, raw_value in scope.get("headers", []):
            if raw_name.lower() == b"content-length":
                content_length = raw_value.decode("ascii", "ignore").strip()
                break
        if content_length:
            try:
                declared = int(content_length)
            except ValueError:
                await self._reject(send)
                return
            if declared < 0 or declared > self.max_bytes:
                await self._reject(send)
                return

        received = 0

        async def limited_receive() -> dict[str, Any]:
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                body = message.get("body", b"")
                received += len(body)
                if received > self.max_bytes:
                    raise _AssistantBodyTooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _AssistantBodyTooLarge:
            await self._reject(send)

    @staticmethod
    async def _reject(send: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        payload = json.dumps(
            {"detail": "Asistan isteği izin verilen boyutu aşıyor."},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"content-length", str(len(payload)).encode("ascii")),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": payload})
