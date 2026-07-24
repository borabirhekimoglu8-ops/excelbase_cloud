"""Provider-neutral, read-only foundation for the Excelbase assistant.

The live assistant is deliberately disabled until a server-side identity flow
and a concrete provider adapter are configured.  Importing this package must
never initialize an SDK or perform network I/O.
"""

from .provider import (
    AssistantProvider,
    AssistantUnavailableError,
    DisabledProvider,
    ProviderMessage,
    ProviderRequest,
    ProviderResult,
)
from .schemas import READ_ONLY_CAPABILITIES, AssistantStatusResponse
from .service import assistant_status, get_assistant_provider

__all__ = [
    "AssistantProvider",
    "AssistantStatusResponse",
    "AssistantUnavailableError",
    "DisabledProvider",
    "ProviderMessage",
    "ProviderRequest",
    "ProviderResult",
    "READ_ONLY_CAPABILITIES",
    "assistant_status",
    "get_assistant_provider",
]
