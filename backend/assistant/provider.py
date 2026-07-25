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


ProviderFailureKind = Literal[
    "auth",
    "permission",
    "model",
    "request",
    "rate_limit",
    "timeout",
    "network",
    "upstream",
    "response",
    "unknown",
]


@dataclass(frozen=True, slots=True)
class ProviderDiagnostic:
    """Non-secret taxonomy for one upstream failure.

    Every field is either a fixed enum value chosen by this module or a short
    opaque identifier emitted by the provider.  Prompt text, context, response
    bodies and exception reprs are deliberately absent, so a diagnostic is safe
    to log and to return to an authenticated operator.
    """

    kind: ProviderFailureKind = "unknown"
    status_code: int = 0
    error_type: str = ""
    upstream_request_id: str = ""

    def as_log_fields(self) -> str:
        return (
            f"kind={self.kind} upstream_status={self.status_code or '-'} "
            f"upstream_error_type={self.error_type or '-'} "
            f"upstream_request_id={self.upstream_request_id or '-'}"
        )


class AssistantProviderError(RuntimeError):
    """Raised for a sanitized provider or response failure."""

    def __init__(
        self,
        message: str,
        diagnostic: ProviderDiagnostic | None = None,
    ) -> None:
        super().__init__(message)
        self.diagnostic = diagnostic or ProviderDiagnostic()


class AssistantConfigurationError(AssistantProviderError):
    """Raised when the upstream rejects our own credentials or model.

    Separated from a transient outage because retrying cannot help: a deploy
    time change (API key, key scope, model id) is required.
    """


@dataclass(frozen=True, slots=True)
class ProviderProbe:
    """Result of a free, non-billable upstream reachability check."""

    ok: bool
    kind: ProviderFailureKind | Literal["ok"] = "ok"
    status_code: int = 0
    error_type: str = ""
    upstream_request_id: str = ""
    detail: str = ""


@runtime_checkable
class AssistantProvider(Protocol):
    name: str
    available: bool

    async def generate(self, request: ProviderRequest) -> ProviderResult:
        """Generate a response without mutating Excelbase state."""

    async def probe(self) -> ProviderProbe:
        """Verify credentials and model without spending output tokens."""


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

    async def probe(self) -> ProviderProbe:
        # A disabled provider must not resolve DNS or construct a client, so
        # the configured reason is the whole answer.
        return ProviderProbe(ok=False, kind="unknown", detail=self.reason)
