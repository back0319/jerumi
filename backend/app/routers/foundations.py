"""Foundation shade CRUD endpoints."""

import json
import logging
from datetime import datetime, timezone
from functools import lru_cache

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.foundation import Foundation
from app.models.storage_cleanup import StorageCleanupJob
from app.routers.auth import get_current_admin
from app.schemas.analysis import ColorCheckerPatch
from app.schemas.foundation import (
    FoundationAnalysisResult,
    FoundationCreate,
    FoundationDeleteResult,
    FoundationOut,
    FoundationUpdate,
    StorageCleanupRetryResult,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/foundations", tags=["foundations"])
_CLEANUP_RETRY_LIMIT = 50


@lru_cache(maxsize=1)
def get_swatch_extraction_service():
    from app.services import swatch_extraction

    return swatch_extraction


@lru_cache(maxsize=1)
def get_storage_service():
    from app.services import storage

    return storage


def _parse_checker_patches(
    checker_patches: str | None,
) -> list[ColorCheckerPatch] | None:
    if not checker_patches:
        return None

    try:
        raw = json.loads(checker_patches)
        return [ColorCheckerPatch(**patch) for patch in raw]
    except (json.JSONDecodeError, ValidationError, TypeError) as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid checker_patches JSON: {exc}",
        ) from exc


def _parse_analysis_result(
    analysis_result: str | None,
) -> FoundationAnalysisResult | None:
    if not analysis_result:
        return None

    try:
        return FoundationAnalysisResult.model_validate_json(analysis_result)
    except ValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid analysis_result JSON: {exc}",
        ) from exc


def _analyze_swatch_image(
    contents: bytes,
    checker_patches: str | None,
) -> FoundationAnalysisResult:
    patches = _parse_checker_patches(checker_patches)
    try:
        result = get_swatch_extraction_service().extract_swatch_from_image(
            contents,
            patches,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return FoundationAnalysisResult(**result)


def _queue_storage_cleanup(
    db: AsyncSession,
    *,
    bucket: str,
    object_path: str,
    reason: str,
) -> StorageCleanupJob:
    job = StorageCleanupJob(
        bucket=bucket,
        object_path=object_path,
        reason=reason,
    )
    db.add(job)
    return job


async def _attempt_storage_cleanup(
    db: AsyncSession,
    job: StorageCleanupJob,
) -> bool:
    job.attempts += 1
    try:
        get_storage_service().delete_object(job.bucket, job.object_path)
    except Exception as exc:
        job.last_error = str(exc)[:2000]
        logger.warning(
            "Storage cleanup pending for %s/%s after attempt %s: %s",
            job.bucket,
            job.object_path,
            job.attempts,
            exc,
        )
        try:
            await db.commit()
        except Exception as commit_exc:
            await db.rollback()
            logger.error(
                "Could not persist failed Storage cleanup attempt for job %s: %s",
                job.id,
                commit_exc,
            )
        return False

    job.last_error = None
    job.completed_at = datetime.now(timezone.utc)
    try:
        await db.commit()
        return True
    except Exception as exc:
        await db.rollback()
        logger.error(
            "Storage object was deleted but cleanup job %s could not be completed: %s",
            job.id,
            exc,
        )
        return False


async def _record_failed_immediate_cleanup(
    db: AsyncSession,
    *,
    bucket: str,
    object_path: str,
) -> None:
    """Best-effort outbox fallback after upload compensation also fails."""
    try:
        _queue_storage_cleanup(
            db,
            bucket=bucket,
            object_path=object_path,
            reason="create-rollback",
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.error(
            "Could not persist Storage cleanup job for %s/%s: %s",
            bucket,
            object_path,
            exc,
        )


@router.post("/analyze-swatch", response_model=FoundationAnalysisResult)
async def analyze_swatch(
    image: UploadFile = File(...),
    checker_patches: str | None = Form(None),
    _admin: str = Depends(get_current_admin),
):
    """Analyze a foundation swatch photo and return extracted color values.

    Upload a photo of foundation applied on white paper, optionally with
    ColorChecker patches for calibration. Returns LAB values, hex color,
    without saving to the database.
    """
    contents = await image.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 20MB)")

    return _analyze_swatch_image(contents, checker_patches)


@router.post("/from-photo", response_model=FoundationOut)
async def create_foundation_from_photo(
    image: UploadFile = File(...),
    brand: str = Form(...),
    product_name: str = Form(...),
    shade_name: str = Form(...),
    shade_code: str = Form(""),
    checker_patches: str | None = Form(None),
    analysis_result: str | None = Form(None),
    _admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Analyze a foundation swatch photo and save the result to the database.

    Same analysis as analyze-swatch, but also creates a Foundation record
    and stores the uploaded image.
    """
    contents = await image.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 20MB)")

    product_name = product_name.strip()
    if not product_name:
        raise HTTPException(status_code=422, detail="product_name is required")

    result = _parse_analysis_result(analysis_result)
    if result is None:
        result = _analyze_swatch_image(contents, checker_patches)

    try:
        foundation_data = FoundationCreate(
            brand=brand,
            product_name=product_name,
            shade_code=shade_code,
            shade_name=shade_name,
            L_value=result.L_value,
            a_value=result.a_value,
            b_value=result.b_value,
            hex_color=result.hex_color,
            undertone=None,
            swatch_image_url=None,
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail="브랜드, 제품명, 색상명과 분석 결과를 확인해주세요.",
        ) from exc

    try:
        upload_result = get_storage_service().upload_swatch_image(
            image_bytes=contents,
            brand=foundation_data.brand,
            shade_name=foundation_data.shade_name,
            content_type=image.content_type,
            original_filename=image.filename,
        )
    except get_storage_service().StorageConfigError as exc:
        logger.error("Storage configuration error while uploading swatch: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="이미지 저장소 설정을 확인해주세요.",
        ) from exc
    except get_storage_service().StorageOperationError as exc:
        logger.warning("Storage upload failed: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="이미지를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.",
        ) from exc

    f = Foundation(
        **foundation_data.model_copy(
            update={"swatch_image_url": upload_result.public_url}
        ).model_dump()
    )
    db.add(f)

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            get_storage_service().delete_object(
                upload_result.bucket,
                upload_result.object_path,
            )
        except Exception as cleanup_exc:
            logger.warning("Failed to clean up uploaded swatch image: %s", cleanup_exc)
            await _record_failed_immediate_cleanup(
                db,
                bucket=upload_result.bucket,
                object_path=upload_result.object_path,
            )
        raise

    await db.refresh(f)
    return f


@router.get("", response_model=list[FoundationOut])
async def list_foundations(
    brand: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Foundation).order_by(Foundation.brand, Foundation.shade_name)
    if brand:
        query = query.where(Foundation.brand == brand)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/brands", response_model=list[str])
async def list_brands(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Foundation.brand).distinct().order_by(Foundation.brand)
    )
    return result.scalars().all()


@router.get("/{foundation_id}", response_model=FoundationOut)
async def get_foundation(foundation_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Foundation).where(Foundation.id == foundation_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Foundation not found")
    return f


@router.post("", response_model=FoundationOut)
async def create_foundation(
    data: FoundationCreate,
    _admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    f = Foundation(**data.model_dump())
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return f


@router.put("/{foundation_id}", response_model=FoundationOut)
async def update_foundation(
    foundation_id: int,
    data: FoundationUpdate,
    _admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Foundation).where(Foundation.id == foundation_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Foundation not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(f, key, value)

    await db.commit()
    await db.refresh(f)
    return f


@router.post(
    "/storage-cleanups/retry",
    response_model=StorageCleanupRetryResult,
)
async def retry_storage_cleanups(
    _admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StorageCleanupJob)
        .where(StorageCleanupJob.completed_at.is_(None))
        .order_by(StorageCleanupJob.created_at, StorageCleanupJob.id)
        .limit(_CLEANUP_RETRY_LIMIT)
    )
    jobs = list(result.scalars().all())
    completed = 0
    for job in jobs:
        if await _attempt_storage_cleanup(db, job):
            completed += 1

    return {
        "processed": len(jobs),
        "completed": completed,
        "pending": len(jobs) - completed,
    }


@router.delete("/{foundation_id}", response_model=FoundationDeleteResult)
async def delete_foundation(
    foundation_id: int,
    _admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Foundation).where(Foundation.id == foundation_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Foundation not found")

    cleanup_job = None
    if f.swatch_image_url:
        asset = get_storage_service().resolve_public_asset(f.swatch_image_url)
        if asset is not None:
            cleanup_job = _queue_storage_cleanup(
                db,
                bucket=asset.bucket,
                object_path=asset.object_path,
                reason="foundation-delete",
            )
        else:
            logger.warning(
                "Skipping unmanaged swatch URL while deleting foundation %s: %s",
                foundation_id,
                f.swatch_image_url,
            )

    await db.delete(f)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    cleanup_completed = True
    if cleanup_job is not None:
        cleanup_completed = await _attempt_storage_cleanup(db, cleanup_job)

    return {
        "ok": True,
        "storage_cleanup": "completed" if cleanup_completed else "pending",
    }
