"""Request bodies for the local workstation API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class WorkstationRootRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    root: str = Field(default="", max_length=400)

    @field_validator("root")
    @classmethod
    def strip_root(cls, value: str) -> str:
        return (value or "").strip()


class WorkstationSearchRequest(WorkstationRootRequest):
    query: str = Field(..., min_length=1, max_length=200)
    kind: str = Field(default="", max_length=20)
    limit: int = Field(default=40, ge=1, le=100)

    @field_validator("query")
    @classmethod
    def strip_query(cls, value: str) -> str:
        return value.strip()

    @field_validator("kind")
    @classmethod
    def strip_kind(cls, value: str) -> str:
        return (value or "").strip().lower()


class WorkstationAdviseRequest(WorkstationRootRequest):
    question: str = Field(default="", max_length=2_000)

    @field_validator("question")
    @classmethod
    def strip_question(cls, value: str) -> str:
        return (value or "").strip()
