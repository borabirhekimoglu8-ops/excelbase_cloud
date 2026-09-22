"""OCR HTTP payloads. Error strings must never include recognized text."""

from __future__ import annotations

from pydantic import BaseModel, Field


class OcrEngineInfo(BaseModel):
    name: str = ""
    version: str = ""
    lang: str = "en"


class OcrLimits(BaseModel):
    max_image_bytes: int
    max_pixels: int
    max_concurrency: int


class OcrStatusResponse(BaseModel):
    state: str
    engine: OcrEngineInfo
    detail: str = ""
    limits: OcrLimits
    privacy: str = "in_memory_only"
    egress: str = "none"


class OcrLineModel(BaseModel):
    text: str
    box: list[list[float]] = Field(default_factory=list)
    score: float | None = None


class OcrRecognizeResponse(BaseModel):
    page_id: str = ""
    engine: OcrEngineInfo
    width: int
    height: int
    lines: list[OcrLineModel]
    duration_ms: int
