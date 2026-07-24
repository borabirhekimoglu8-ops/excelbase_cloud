"""Authenticated, provider-neutral foundation for the Excelbase assistant.

Importing this package never initializes an SDK or performs network I/O. The
Anthropic client is created only for an authenticated, CSRF-checked chat turn
when all server-side configuration is present.
"""

from .provider import (
    AssistantProvider,
    AssistantProviderError,
    AssistantRateLimitError,
    AssistantTimeoutError,
    AssistantUnavailableError,
    DisabledProvider,
    ProviderMessage,
    ProviderRequest,
    ProviderResult,
)
from .schemas import AssistantChatRequest, AssistantChatResponse, READ_ONLY_CAPABILITIES, AssistantStatusResponse
from .service import assistant_status, generate_assistant_reply, get_assistant_provider

__all__ = [
    "AssistantProvider",
    "AssistantProviderError",
    "AssistantRateLimitError",
    "AssistantStatusResponse",
    "AssistantTimeoutError",
    "AssistantUnavailableError",
    "AssistantChatRequest",
    "AssistantChatResponse",
    "DisabledProvider",
    "ProviderMessage",
    "ProviderRequest",
    "ProviderResult",
    "READ_ONLY_CAPABILITIES",
    "assistant_status",
    "generate_assistant_reply",
    "get_assistant_provider",
]
