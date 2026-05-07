"""Foundation shade CRUD endpoints."""

import json
import logging
from functools import lru_cache

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.foundation import Foundation
from app.routers.auth import get_current_admin
from app.schemas.analysis import ColorCheckerPatch
from app.schemas.foundation import (
    FoundationAnalysisResult,
    FoundationCreate,
    FoundationOut,
    FoundationUpdate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/foundations", tags=["foundations"])


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


@router.post("/analyze-swatch", response_model=FoundationAnalysisResult)
async def analyze_swatch(
    image: UploadFile = File(...),
    checker_patches: str | None = Form(None),
    _admin: str = Depends(get_current_admin),
):
    """Analyze a foundation swatch photo and return extracted color values.

    Upload a photo of foundation applied on white paper, optionally with
    ColorChecker patches for calibration. Returns LAB values, hex color,
    and undertone classification without saving to the database.
    """
    contents = await image.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 20MB)")

    return _analyze_swatch_image(contents, checker_patches)


@router.post("/from-photo", response_model=FoundationOut)
async def create_foundation_from_photo(
    image: UploadFile = File(...),
    brand: str = Form(...),
    product_name: str = Form(""),
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

    result = _parse_analysis_result(analysis_result)
    if result is None:
        result = _analyze_swatch_image(contents, checker_patches)

    try:
        upload_result = get_storage_service().upload_swatch_image(
            image_bytes=contents,
            brand=brand,
            shade_name=shade_name,
            content_type=image.content_type,
            original_filename=image.filename,
        )
    except get_storage_service().StorageConfigError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except get_storage_service().StorageOperationError as e:
        raise HTTPException(status_code=502, detail=str(e))

    f = Foundation(
        brand=brand,
        product_name=product_name,
        shade_code=shade_code,
        shade_name=shade_name,
        L_value=result.L_value,
        a_value=result.a_value,
        b_value=result.b_value,
        hex_color=result.hex_color,
        undertone=result.undertone,
        swatch_image_url=upload_result.public_url,
    )
    db.add(f)

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            get_storage_service().delete_public_asset(upload_result.public_url)
        except Exception as cleanup_exc:
            logger.warning("Failed to clean up uploaded swatch image: %s", cleanup_exc)
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


@router.delete("/{foundation_id}")
async def delete_foundation(
    foundation_id: int,
    _admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Foundation).where(Foundation.id == foundation_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Foundation not found")

    if f.swatch_image_url:
        try:
            get_storage_service().delete_public_asset(f.swatch_image_url)
        except get_storage_service().StorageConfigError as e:
            raise HTTPException(status_code=500, detail=str(e))
        except get_storage_service().StorageOperationError as e:
            raise HTTPException(status_code=502, detail=str(e))

    await db.delete(f)
    await db.commit()
    return {"ok": True}
