from __future__ import annotations

import mimetypes
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, unquote
from uuid import uuid4

from supabase import Client, create_client

from app.config import settings


class StorageConfigError(RuntimeError):
    pass


class StorageOperationError(RuntimeError):
    pass


@dataclass(frozen=True)
class UploadResult:
    object_path: str
    public_url: str


def _require_storage_config() -> tuple[str, str, str]:
    if not settings.SUPABASE_URL:
        raise StorageConfigError("SUPABASE_URL is not configured.")
    if not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise StorageConfigError("SUPABASE_SERVICE_ROLE_KEY is not configured.")
    if not settings.SUPABASE_STORAGE_BUCKET:
        raise StorageConfigError("SUPABASE_STORAGE_BUCKET is not configured.")

    return (
        settings.SUPABASE_URL.rstrip("/"),
        settings.SUPABASE_SERVICE_ROLE_KEY,
        settings.SUPABASE_STORAGE_BUCKET,
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


def _extract_object_path(public_url: str) -> str | None:
    supabase_url, _service_role_key, bucket = _require_storage_config()
    prefix = f"{supabase_url}/storage/v1/object/public/{bucket}/"
    if not public_url.startswith(prefix):
        return None

    return unquote(public_url.removeprefix(prefix))


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
        object_path=object_path,
        public_url=_build_public_url(object_path),
    )


def delete_public_asset(public_url: str) -> None:
    object_path = _extract_object_path(public_url)
    if not object_path:
        return

    _supabase_url, _service_role_key, bucket = _require_storage_config()
    client = get_storage_client()

    try:
        client.storage.from_(bucket).remove([object_path])
    except Exception as exc:
        raise StorageOperationError(f"Failed to delete swatch image: {exc}") from exc
