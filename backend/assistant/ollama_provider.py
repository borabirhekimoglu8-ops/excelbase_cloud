"""Local Ollama provider — loopback only, no cloud egress.

Talks to a user-managed Ollama daemon on 127.0.0.1. Refuses non-loopback base
URLs so a misconfiguration cannot silently ship work-folder prompts off-box.
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

from backend.config import AssistantSettings

from .provider import (
    AssistantConfigurationError,
    AssistantProviderError,
    AssistantTimeoutError,
    ProviderDiagnostic,
    ProviderProbe,
    ProviderRequest,
    ProviderResult,
    ProviderToolCall,
)


def _is_loopback(base_url: str) -> bool:
    try:
        parsed = urlparse(base_url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return host in {"127.0.0.1", "localhost", "::1"} and parsed.scheme in {"http", "https"}


def _http_json(
    method: str,
    url: str,
    payload: dict | None,
    *,
    timeout: float,
) -> tuple[int, dict[str, Any]]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            status = int(getattr(response, "status", 200) or 200)
            parsed = json.loads(body) if body else {}
            if not isinstance(parsed, dict):
                parsed = {"data": parsed}
            return status, parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}
        return int(exc.code), parsed


class OllamaProvider:
    """AssistantProvider backed by a local Ollama /api/chat endpoint."""

    name = "ollama"

    def __init__(self, settings: AssistantSettings) -> None:
        self._settings = settings
        self._base = settings.ollama_base_url.rstrip("/")
        self._model = settings.model
        self._timeout = float(settings.timeout_seconds)

    @property
    def available(self) -> bool:
        return bool(self._base and self._model and _is_loopback(self._base))

    def _messages_for(self, request: ProviderRequest) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        # Tools stay client-executed; we describe them in a short system note so
        # a local model without native tool-calling can still name them.
        if request.tools:
            tool_lines = ", ".join(tool.name for tool in request.tools[:40])
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "Excelbase yerel asistanısın. Veri dışarı çıkmaz. "
                        "Gerekirse şu araç adlarını JSON ile iste: "
                        f"{tool_lines}. Yanıtlarını kısa ve Türkçe tut."
                    ),
                }
            )
        for message in request.messages:
            if message.role == "system":
                messages.append({"role": "system", "content": message.content})
            elif message.role == "user":
                if message.tool_results:
                    chunks = [
                        f"[araç:{item.tool_use_id}] {item.content[:4000]}"
                        for item in message.tool_results
                    ]
                    messages.append({"role": "user", "content": "\n".join(chunks)})
                else:
                    messages.append({"role": "user", "content": message.content})
            elif message.role == "assistant":
                content = message.content
                if message.tool_calls:
                    names = ", ".join(call.name for call in message.tool_calls)
                    content = (content + f"\n[araç çağrıları: {names}]").strip()
                messages.append({"role": "assistant", "content": content})
        return messages

    def _parse_tool_calls(self, raw: Any) -> tuple[ProviderToolCall, ...]:
        if not isinstance(raw, list):
            return ()
        calls: list[ProviderToolCall] = []
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            function = item.get("function") if isinstance(item.get("function"), dict) else item
            name = str(function.get("name") or "").strip()
            if not name:
                continue
            arguments = function.get("arguments", {})
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    arguments = {}
            if not isinstance(arguments, dict):
                arguments = {}
            call_id = str(item.get("id") or f"local_{index}")[:80]
            calls.append(ProviderToolCall(id=call_id, name=name[:80], input=arguments))
        return tuple(calls)

    async def generate(self, request: ProviderRequest) -> ProviderResult:
        if not self.available:
            raise AssistantConfigurationError(
                "Yerel Ollama adresi yalnızca 127.0.0.1 / localhost olabilir.",
                ProviderDiagnostic(kind="permission"),
            )
        payload = {
            "model": self._model,
            "stream": False,
            "messages": self._messages_for(request),
            "options": {"num_predict": request.max_output_tokens},
        }
        # Optional native tools if the installed model supports them.
        if request.tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    },
                }
                for tool in request.tools
            ]

        url = f"{self._base}/api/chat"
        try:
            status, body = await asyncio.to_thread(
                _http_json, "POST", url, payload, timeout=self._timeout
            )
        except TimeoutError as exc:
            raise AssistantTimeoutError("Yerel model zaman aşımına uğradı.") from exc
        except Exception as exc:  # noqa: BLE001 — sanitized below
            raise AssistantProviderError(
                "Yerel modele ulaşılamadı. Ollama çalışıyor mu?",
                ProviderDiagnostic(kind="network"),
            ) from exc

        if status == 404:
            raise AssistantConfigurationError(
                "Yerel model bulunamadı. Ollama'da model adını kontrol edin.",
                ProviderDiagnostic(kind="model", status_code=404),
            )
        if status >= 400:
            raise AssistantProviderError(
                "Yerel model isteği reddetti.",
                ProviderDiagnostic(kind="upstream", status_code=status),
            )

        message = body.get("message") if isinstance(body.get("message"), dict) else {}
        text = str(message.get("content") or body.get("response") or "").strip()
        tool_calls = self._parse_tool_calls(message.get("tool_calls"))
        return ProviderResult(
            text=text,
            input_tokens=int(body.get("prompt_eval_count") or 0),
            output_tokens=int(body.get("eval_count") or 0),
            stop_reason=str(body.get("done_reason") or ""),
            request_id="",
            tool_calls=tool_calls,
        )

    async def probe(self) -> ProviderProbe:
        if not self.available:
            return ProviderProbe(
                ok=False,
                kind="permission",
                detail="Ollama tabanı loopback değil veya model boş.",
            )
        url = f"{self._base}/api/tags"
        try:
            status, body = await asyncio.to_thread(
                _http_json, "GET", url, None, timeout=min(10.0, self._timeout)
            )
        except Exception:  # noqa: BLE001
            return ProviderProbe(
                ok=False,
                kind="network",
                detail="Ollama'ya bağlanılamadı (127.0.0.1:11434).",
            )
        if status >= 400:
            return ProviderProbe(
                ok=False,
                kind="upstream",
                status_code=status,
                detail="Ollama yanıt vermedi.",
            )
        models = body.get("models") if isinstance(body.get("models"), list) else []
        names = {
            str(item.get("name") or item.get("model") or "")
            for item in models
            if isinstance(item, dict)
        }
        # Accept exact or tagless match (llama3.2 == llama3.2:latest).
        wanted = self._model
        wanted_base = wanted.split(":", 1)[0]
        if names and not any(
            name == wanted or name.startswith(wanted_base + ":") or name == wanted_base
            for name in names
        ):
            return ProviderProbe(
                ok=False,
                kind="model",
                detail=f"Yüklü modeller arasında '{wanted}' yok.",
            )
        return ProviderProbe(ok=True, kind="ok", detail="Yerel Ollama hazır.")
