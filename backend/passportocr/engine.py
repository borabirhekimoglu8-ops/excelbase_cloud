"""Model-version-independent OCR adapter. The rest of the app never imports paddleocr."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class EngineUnavailable(Exception):
    """The configured local engine cannot be constructed or used."""

    def __init__(self, state: str, detail: str):
        super().__init__(detail)
        self.state = state
        self.detail = detail


@dataclass(frozen=True, slots=True)
class OcrLine:
    text: str
    box: list[list[float]]
    score: float | None


class OcrEngine(Protocol):
    name: str
    version: str

    def recognize(self, rgb) -> list[OcrLine]:
        """Return lines from an RGB ndarray. Must not write files or log text."""


class NullEngine:
    """Fail-closed placeholder. Never invents lines."""

    name = "none"
    version = ""

    def recognize(self, rgb) -> list[OcrLine]:
        raise EngineUnavailable("engine_missing", "Yerel OCR motoru kurulu değil.")
