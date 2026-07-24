from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


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


class AssistantStatusResponse(BaseModel):
    """Public capability response.

    Provider/model names and all secret/configuration values are intentionally
    absent because this endpoint is safe to expose before server login exists.
    """

    model_config = ConfigDict(extra="forbid")

    available: bool
    online_required: bool = True
    privacy_mode: Literal["strict"] = "strict"
    capabilities: list[AssistantCapability]
