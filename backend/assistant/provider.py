from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable


ProviderRole = Literal["system", "user", "assistant"]


@dataclass(frozen=True, slots=True)
class ProviderMessage:
    role: ProviderRole
    content: str


@dataclass(frozen=True, slots=True)
class ProviderRequest:
    messages: tuple[ProviderMessage, ...]
    max_output_tokens: int
    allowed_capabilities: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ProviderResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    stop_reason: str = ""
    request_id: str = ""


class AssistantUnavailableError(RuntimeError):
    """Raised when no billable assistant provider is active."""


class AssistantRateLimitError(RuntimeError):
    """Raised when the upstream provider asks the caller to slow down."""

    def __init__(self, retry_after: int = 30) -> None:
        super().__init__("Assistant provider rate limit reached.")
        self.retry_after = max(1, min(300, int(retry_after)))


class AssistantTimeoutError(RuntimeError):
    """Raised when the provider does not answer within the configured timeout."""


class AssistantProviderError(RuntimeError):
    """Raised for a sanitized provider or response failure."""


@runtime_checkable
class AssistantProvider(Protocol):
    name: str
    available: bool

    async def generate(self, request: ProviderRequest) -> ProviderResult:
        """Generate a response without mutating Excelbase state."""


@dataclass(frozen=True, slots=True)
class DisabledProvider:
    """Fail-closed provider used until a concrete server adapter is installed."""

    reason: str = "Excelbase Assistant henüz yapılandırılmadı."
    name: str = "disabled"
    available: bool = False

    async def generate(self, request: ProviderRequest) -> ProviderResult:
        # Deliberately do not inspect the prompt, initialize a client, resolve
        # DNS, or perform any other operation that could leak local context.
        del request
        raise AssistantUnavailableError(self.reason)
