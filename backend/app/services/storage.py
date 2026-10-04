from __future__ import annotations

import mimetypes
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit
from uuid import uuid4

import boto3
from botocore.config import Config

from app.config import settings


class StorageConfigError(RuntimeError):
    pass


class StorageOperationError(RuntimeError):
    pass


@dataclass(frozen=True)
class UploadResult:
    bucket: str
    object_path: str
    public_url: str


@dataclass(frozen=True)
class ManagedAsset:
    bucket: str
    object_path: str


@dataclass(frozen=True)
class StorageConfig:
    endpoint_url: str
    access_key_id: str
    secret_access_key: str
    region: str
    bucket: str


_BUCKET_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.\-]{0,62}$")


def _normalize_config_value(value: str | None) -> str:
    if value is None:
        return ""

    return value.strip().lstrip("﻿").strip()


def _require_storage_config() -> StorageConfig:
    endpoint_url = _normalize_config_value(settings.AWS_ENDPOINT_URL_S3)
    access_key_id = _normalize_config_value(settings.AWS_ACCESS_KEY_ID)
    secret_access_key = _normalize_config_value(settings.AWS_SECRET_ACCESS_KEY)
    region = _normalize_config_value(settings.AWS_REGION)
    bucket = _normalize_config_value(settings.STORAGE_BUCKET)

    if not endpoint_url:
        raise StorageConfigError("AWS_ENDPOINT_URL_S3 is not configured.")
    if not access_key_id:
        raise StorageConfigError("AWS_ACCESS_KEY_ID is not configured.")
    if not secret_access_key:
        raise StorageConfigError("AWS_SECRET_ACCESS_KEY is not configured.")
    if not region:
        raise StorageConfigError("AWS_REGION is not configured.")
    if not bucket:
        raise StorageConfigError("STORAGE_BUCKET is not configured.")

    if not _BUCKET_NAME_PATTERN.match(bucket):
        raise StorageConfigError(
            "STORAGE_BUCKET 값이 버킷 이름 규칙을 만족하지 않습니다. "
            "1-63자, 소문자/숫자/하이픈/점만 허용되며, 공백·대문자·"
            f"언더스코어는 사용할 수 없습니다. (현재 값: {bucket!r})"
        )

    return StorageConfig(
        endpoint_url=endpoint_url.rstrip("/"),
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        region=region,
        bucket=bucket,
    )


@lru_cache(maxsize=1)
def get_storage_client() -> Any:
    config = _require_storage_config()
    return boto3.client(
        "s3",
        endpoint_url=config.endpoint_url,
        region_name=config.region,
        aws_access_key_id=config.access_key_id,
        aws_secret_access_key=config.secret_access_key,
        config=Config(s3={"addressing_style": "path"}),
    )


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "swatch"


def _guess_extension(content_type: str | None, original_filename: str | None) -> str:
    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if guessed:
            return ".jpg" if guessed == ".jpe" else guessed

    if original_filename:
        suffix = Path(original_filename).suffix.lower()
        if suffix in {".jpg", ".jpeg", ".png", ".webp"}:
            return suffix

    return ".jpg"


def _build_public_url(object_path: str) -> str:
    config = _require_storage_config()
    encoded_path = quote(object_path, safe="/")
    return f"{config.endpoint_url}/{config.bucket}/{encoded_path}"


def upload_swatch_image(
    image_bytes: bytes,
    brand: str,
    shade_name: str,
    content_type: str | None,
    original_filename: str | None,
) -> UploadResult:
    bucket = _require_storage_config().bucket
    client = get_storage_client()

    extension = _guess_extension(content_type, original_filename)
    object_path = (
        f"swatches/{_safe_slug(brand)}/{_safe_slug(shade_name)}-{uuid4().hex}{extension}"
    )
    put_kwargs: dict[str, Any] = {
        "Bucket": bucket,
        "Key": object_path,
        "Body": image_bytes,
        "CacheControl": "max-age=3600",
    }

    if content_type:
        put_kwargs["ContentType"] = content_type.split(";")[0].strip()

    try:
        client.put_object(**put_kwargs)
    except Exception as exc:
        raise StorageOperationError(f"Failed to upload swatch image: {exc}") from exc

    return UploadResult(
        bucket=bucket,
        object_path=object_path,
        public_url=_build_public_url(object_path),
    )


def resolve_public_asset(public_url: str) -> ManagedAsset | None:
    """Resolve a public URL owned by the configured object storage endpoint.

    The bucket is parsed from the URL rather than assumed from current config so
    cleanup jobs remain valid if a deployment changes bucket names later.
    External URLs are intentionally ignored.
    """
    config = _require_storage_config()
    configured = urlsplit(config.endpoint_url)
    candidate = urlsplit(public_url)
    if (candidate.scheme, candidate.netloc) != (configured.scheme, configured.netloc):
        return None

    prefix = configured.path.rstrip("/") + "/"
    if not candidate.path.startswith(prefix):
        return None

    bucket, separator, object_path = candidate.path.removeprefix(prefix).partition("/")
    bucket = unquote(bucket)
    object_path = unquote(object_path).lstrip("/")
    if not separator or not _BUCKET_NAME_PATTERN.fullmatch(bucket) or not object_path:
        return None

    return ManagedAsset(bucket=bucket, object_path=object_path)


def delete_object(bucket: str, object_path: str) -> None:
    """Delete one Storage object by stable coordinates.

    S3 DeleteObject succeeds for keys that are already gone, so repeating the
    same cleanup is safe and is the basis for outbox retries.
    """
    _require_storage_config()
    if not _BUCKET_NAME_PATTERN.fullmatch(bucket):
        raise StorageConfigError(f"Invalid Storage bucket in cleanup job: {bucket!r}")

    normalized_path = object_path.strip().lstrip("/")
    if not normalized_path:
        raise StorageConfigError("Storage cleanup object path is empty.")

    client = get_storage_client()

    try:
        client.delete_object(Bucket=bucket, Key=normalized_path)
    except Exception as exc:
        raise StorageOperationError(f"Failed to delete swatch image: {exc}") from exc


def delete_public_asset(public_url: str) -> bool:
    asset = resolve_public_asset(public_url)
    if asset is None:
        return False

    delete_object(asset.bucket, asset.object_path)
    return True
