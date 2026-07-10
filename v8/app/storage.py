from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from .config import get_settings


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


def _object_key(organization_id: uuid.UUID, name: str, digest: str) -> str:
    safe_suffix = Path(name).suffix.lower()[:12]
    return f"{organization_id}/{digest[:2]}/{digest}{safe_suffix}"


class LocalObjectStorage:
    """Development-only object store. Production should use the S3 adapter."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def put(self, *, organization_id: uuid.UUID, name: str, data: bytes, mime_type: str) -> StoredBlob:
        digest = hashlib.sha256(data).hexdigest()
        key = _object_key(organization_id, name, digest)
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


class S3ObjectStorage:
    """S3-compatible object store (AWS S3, Cloudflare R2, MinIO)."""

    def __init__(self, *, bucket: str, region: str = "", endpoint_url: str = "", prefix: str = "") -> None:
        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError("S3 depolama için boto3 gereklidir: pip install 'excelbase-v8[s3]'") from exc
        kwargs: dict = {}
        if region:
            kwargs["region_name"] = region
        if endpoint_url:
            kwargs["endpoint_url"] = endpoint_url
        self._client = boto3.client("s3", **kwargs)
        self._bucket = bucket
        self._prefix = prefix.strip("/")

    def _full_key(self, object_key: str) -> str:
        return f"{self._prefix}/{object_key}" if self._prefix else object_key

    def put(self, *, organization_id: uuid.UUID, name: str, data: bytes, mime_type: str) -> StoredBlob:
        digest = hashlib.sha256(data).hexdigest()
        key = _object_key(organization_id, name, digest)
        self._client.put_object(
            Bucket=self._bucket,
            Key=self._full_key(key),
            Body=data,
            ContentType=mime_type,
        )
        return StoredBlob(object_key=key, sha256=digest, size_bytes=len(data), mime_type=mime_type)

    def get(self, object_key: str) -> bytes:
        response = self._client.get_object(Bucket=self._bucket, Key=self._full_key(object_key))
        return response["Body"].read()

    def delete(self, object_key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=self._full_key(object_key))


@lru_cache(maxsize=1)
def get_storage() -> ObjectStorage:
    settings = get_settings()
    if settings.storage_backend == "s3":
        return S3ObjectStorage(
            bucket=settings.s3_bucket,
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
            prefix=settings.s3_prefix,
        )
    return LocalObjectStorage(settings.storage_local_root)


def reset_storage_cache() -> None:
    get_storage.cache_clear()
