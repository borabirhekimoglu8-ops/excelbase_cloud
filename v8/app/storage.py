from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True, slots=True)
class StoredBlob:
    object_key: str
    sha256: str
    size_bytes: int
    mime_type: str


class ObjectStorage(Protocol):
    def put(self, *, organization_id: uuid.UUID, name: str, data: bytes, mime_type: str) -> StoredBlob: ...
    def get(self, object_key: str) -> bytes: ...
    def delete(self, object_key: str) -> None: ...


class LocalObjectStorage:
    """Development-only object store. Production should bind an S3/R2 adapter."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, *, organization_id: uuid.UUID, name: str, data: bytes, mime_type: str) -> StoredBlob:
        digest = hashlib.sha256(data).hexdigest()
        safe_suffix = Path(name).suffix.lower()[:12]
        key = f"{organization_id}/{digest[:2]}/{digest}{safe_suffix}"
        target = (self.root / key).resolve()
        if self.root not in target.parents:
            raise ValueError("Geçersiz object key.")
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix(target.suffix + ".tmp")
        temp.write_bytes(data)
        os.replace(temp, target)
        return StoredBlob(object_key=key, sha256=digest, size_bytes=len(data), mime_type=mime_type)

    def get(self, object_key: str) -> bytes:
        target = (self.root / object_key).resolve()
        if self.root not in target.parents:
            raise ValueError("Geçersiz object key.")
        return target.read_bytes()

    def delete(self, object_key: str) -> None:
        target = (self.root / object_key).resolve()
        if self.root not in target.parents:
            raise ValueError("Geçersiz object key.")
        target.unlink(missing_ok=True)
