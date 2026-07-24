from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


AssistantCapability = Literal[
    "dashboard_summary",
    "search_work_files",
    "get_work_file",
    "search_c_codes",
    "search_passengers",
    "get_passenger_checklist",
    "list_document_metadata",
    "passenger_statistics",
    "search_petitions",
    "list_archive_folders",
    "list_tasks",
    "list_templates",
]

# These names are a contract, not executable functions.  A future provider
# adapter may only request tools from this allowlist; mutation tools belong to
# a separate user-approved proposal flow.
READ_ONLY_CAPABILITIES: tuple[AssistantCapability, ...] = (
    "dashboard_summary",
    "search_work_files",
    "get_work_file",
    "search_c_codes",
    "search_passengers",
    "get_passenger_checklist",
    "list_document_metadata",
    "passenger_statistics",
    "search_petitions",
    "list_archive_folders",
    "list_tasks",
    "list_templates",
)

# Only this capability is active today. The remaining names above are a
# reviewed allowlist for a future client-mediated tool loop; advertising them
# before handlers exist would overstate what Sonnet can actually inspect.
ACTIVE_CAPABILITIES: tuple[AssistantCapability, ...] = ("dashboard_summary",)


class AssistantStatusResponse(BaseModel):
    """Public capability response.

    Provider/model names and all secret/configuration values are intentionally
    absent because this endpoint is safe to expose before server login exists.
    """

    model_config = ConfigDict(extra="forbid")

    available: bool
    online_required: bool = True
    privacy_mode: Literal["aggregate_context_only"] = "aggregate_context_only"
    model_family: Literal["sonnet"] = "sonnet"
    model_label: Literal["Claude Sonnet"] = "Claude Sonnet"
    capabilities: list[AssistantCapability]


class AssistantSessionResponse(BaseModel):
    """Same-origin online session state used only by the Sonnet workspace."""

    model_config = ConfigDict(extra="forbid")

    setup_required: bool
    bootstrap_required: bool = False
    authenticated: bool
    user: dict[str, str] | None = None
    csrf_token: str = ""


class AssistantContextScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    range: Literal["all", "today", "week", "month", "custom"] = "all"
    field: Literal["departure", "created"] = "departure"
    start: str = Field(default="", max_length=10)
    end: str = Field(default="", max_length=10)

    @field_validator("start", "end")
    @classmethod
    def validate_date(cls, value: str) -> str:
        if not value:
            return value
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("Date must use a valid YYYY-MM-DD value.") from exc
        if parsed.isoformat() != value:
            raise ValueError("Date must use a valid YYYY-MM-DD value.")
        return value


class AssistantContextMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passenger_count: int = Field(default=0, ge=0, le=1_000_000)
    ready_count: int = Field(default=0, ge=0, le=1_000_000)
    missing_count: int = Field(default=0, ge=0, le=1_000_000)
    with_photo: int = Field(default=0, ge=0, le=1_000_000)
    missing_photo: int = Field(default=0, ge=0, le=1_000_000)
    missing_passport: int = Field(default=0, ge=0, le=1_000_000)
    missing_voucher: int = Field(default=0, ge=0, le=1_000_000)
    missing_fee: int = Field(default=0, ge=0, le=1_000_000)
    duplicates: int = Field(default=0, ge=0, le=1_000_000)
    today_count: int = Field(default=0, ge=0, le=1_000_000)
    readiness_percent: int = Field(default=0, ge=0, le=100)
    adult_total: float = Field(default=0, ge=0, le=1_000_000_000)
    child_total: float = Field(default=0, ge=0, le=1_000_000_000)
    total_fee: float = Field(default=0, ge=0, le=1_000_000_000)


class AssistantContextIssues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    missing_photo: int = Field(default=0, ge=0, le=1_000_000)
    missing_passport: int = Field(default=0, ge=0, le=1_000_000)
    missing_voucher: int = Field(default=0, ge=0, le=1_000_000)
    missing_fee: int = Field(default=0, ge=0, le=1_000_000)
    duplicate: int = Field(default=0, ge=0, le=1_000_000)
    missing_name: int = Field(default=0, ge=0, le=1_000_000)
    invalid_date: int = Field(default=0, ge=0, le=1_000_000)


class AssistantSafeContext(BaseModel):
    """The complete automatic context contract.

    Because every nested model forbids extras, passenger names, passport
    numbers, filenames, document bodies and notes cannot be smuggled into the
    provider request under an unknown key.
    """

    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    scope: AssistantContextScope = Field(default_factory=AssistantContextScope)
    metrics: AssistantContextMetrics = Field(default_factory=AssistantContextMetrics)
    issues: AssistantContextIssues = Field(default_factory=AssistantContextIssues)


class AssistantChatTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=12_000)


class AssistantChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=12_000)
    history: list[AssistantChatTurn] = Field(default_factory=list, max_length=60)
    context: AssistantSafeContext = Field(default_factory=AssistantSafeContext)
    privacy_acknowledged: Literal[True]


class AssistantUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)


class AssistantChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str
    usage: AssistantUsage
    request_id: str
