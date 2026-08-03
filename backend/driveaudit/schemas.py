from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DriveScanRequest(BaseModel):
    """Which folder to scan.

    ``extra="forbid"`` so a request carrying options we do not implement --
    a depth, a file filter, a follow-symlinks flag -- is rejected rather than
    silently ignored. Quietly dropping a constraint on a scan would let the
    caller believe they had limited something they had not.
    """

    model_config = ConfigDict(extra="forbid")

    #: Empty falls back to EXCELBASE_DRIVE_AUDIT_ROOT.
    root: str = Field(default="", max_length=400)
