from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DevAgentRequest(BaseModel):
    """One development instruction, in the operator's own words.

    ``extra="forbid"`` so a request that carries fields we do not implement --
    a model name, a permission mode, a working directory -- is rejected rather
    than silently ignored. For an endpoint that runs code, quietly dropping an
    unknown field is how a caller ends up believing it constrained a run that
    was in fact unconstrained.
    """

    model_config = ConfigDict(extra="forbid")

    instruction: str = Field(min_length=1, max_length=8_000)
