from __future__ import annotations

import mimetypes
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from uuid import uuid4

from supabase import Client, create_client

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


_BUCKET_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9.\-]{0,62}$")


def _normalize_config_value(value: str | None) -> str:
    if value is None:
        return ""

    return value.strip().lstrip("\ufeff").strip()


def _require_storage_config() -> tuple[str, str, str]:
    supabase_url = _normalize_config_value(settings.SUPABASE_URL)
    service_role_key = _normalize_config_value(settings.SUPABASE_SERVICE_ROLE_KEY)
    bucket = _normalize_config_value(settings.SUPABASE_STORAGE_BUCKET)

    if not supabase_url:
        raise StorageConfigError("SUPABASE_URL is not configured.")
    if not service_role_key:
        raise StorageConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured.")
    if not bucket:
        raise StorageConfigError("SUPABASE_STORAGE_BUCKET is not configured.")

    if not _BUCKET_NAME_PATTERN.match(bucket):
        raise StorageConfigError(
            "SUPABASE_STORAGE_BUCKET 값이 Supabase 버킷 이름 규칙을 만족하지 "
            "않습니다. 1-63자, 소문자/숫자/하이픈/점만 허용되며, 공백·대문자·"
            f"언더스코어는 사용할 수 없습니다. (현재 값: {bucket!r})"
        )

    return (
        supabase_url.rstrip("/"),
        service_role_key,
        bucket,
    )


@lru_cache(maxsize=1)
def get_storage_client() -> Client:
    supabase_url, service_role_key, _bucket = _require_storage_config()
    return create_client(supabase_url, service_role_key)


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
    supabase_url, _service_role_key, bucket = _require_storage_config()
    encoded_path = quote(object_path, safe="/")
    return f"{supabase_url}/storage/v1/object/public/{bucket}/{encoded_path}"


def upload_swatch_image(
    image_bytes: bytes,
    brand: str,
    shade_name: str,
    content_type: str | None,
    original_filename: str | None,
) -> UploadResult:
    _supabase_url, _service_role_key, bucket = _require_storage_config()
    client = get_storage_client()

    extension = _guess_extension(content_type, original_filename)
    object_path = (
        f"swatches/{_safe_slug(brand)}/{_safe_slug(shade_name)}-{uuid4().hex}{extension}"
    )
    file_options = {
        "cache-control": "3600",
        "upsert": "false",
    }

    if content_type:
        file_options["content-type"] = content_type.split(";")[0].strip()

    try:
        client.storage.from_(bucket).upload(
            path=object_path,
            file=image_bytes,
            file_options=file_options,
        )
    except Exception as exc:
        raise StorageOperationError(f"Failed to upload swatch image: {exc}") from exc

    return UploadResult(
        bucket=bucket,
        object_path=object_path,
        public_url=_build_public_url(object_path),
    )


def resolve_public_asset(public_url: str) -> ManagedAsset | None:
    """Resolve a public URL owned by the configured Supabase project.

    The bucket is parsed from the URL rather than assumed from current config so
    cleanup jobs remain valid if a deployment changes bucket names later.
    External URLs are intentionally ignored.
    """
    supabase_url, _service_role_key, _configured_bucket = _require_storage_config()
    configured = urlsplit(supabase_url)
    candidate = urlsplit(public_url)
    if (candidate.scheme, candidate.netloc) != (configured.scheme, configured.netloc):
        return None

    prefix = "/storage/v1/object/public/"
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

    Supabase Storage remove is used instead of mutating storage.objects so the
    object and its metadata are removed together. Repeating the same cleanup is
    safe and is the basis for outbox retries.
    """
    _supabase_url, _service_role_key, _configured_bucket = _require_storage_config()
    if not _BUCKET_NAME_PATTERN.fullmatch(bucket):
        raise StorageConfigError(f"Invalid Storage bucket in cleanup job: {bucket!r}")

    normalized_path = object_path.strip().lstrip("/")
    if not normalized_path:
        raise StorageConfigError("Storage cleanup object path is empty.")

    client = get_storage_client()

    try:
        client.storage.from_(bucket).remove([normalized_path])
    except Exception as exc:
        raise StorageOperationError(f"Failed to delete swatch image: {exc}") from exc


def delete_public_asset(public_url: str) -> bool:
    asset = resolve_public_asset(public_url)
    if asset is None:
        return False

    delete_object(asset.bucket, asset.object_path)
    return True
