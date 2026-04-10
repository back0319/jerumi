"""Foundation shade CRUD endpoints."""

import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
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
from app.services.storage import (
    StorageConfigError,
    StorageOperationError,
    delete_public_asset,
    upload_swatch_image,
)
from app.services.swatch_extraction import extract_swatch_from_image

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/foundations", tags=["foundations"])


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

    patches = None
    if checker_patches:
        try:
            raw = json.loads(checker_patches)
            patches = [ColorCheckerPatch(**p) for p in raw]
        except (json.JSONDecodeError, Exception) as e:
            raise HTTPException(status_code=400, detail=f"Invalid checker_patches JSON: {e}")

    try:
        result = extract_swatch_from_image(contents, patches)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return FoundationAnalysisResult(**result)


@router.post("/from-photo", response_model=FoundationOut)
async def create_foundation_from_photo(
    image: UploadFile = File(...),
    brand: str = Form(...),
    product_name: str = Form(""),
    shade_name: str = Form(...),
    shade_code: str = Form(""),
    checker_patches: str | None = Form(None),
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

    patches = None
    if checker_patches:
        try:
            raw = json.loads(checker_patches)
            patches = [ColorCheckerPatch(**p) for p in raw]
        except (json.JSONDecodeError, Exception) as e:
            raise HTTPException(status_code=400, detail=f"Invalid checker_patches JSON: {e}")

    try:
        result = extract_swatch_from_image(contents, patches)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        upload_result = upload_swatch_image(
            image_bytes=contents,
            brand=brand,
            shade_name=shade_name,
            content_type=image.content_type,
            original_filename=image.filename,
        )
    except StorageConfigError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except StorageOperationError as e:
        raise HTTPException(status_code=502, detail=str(e))

    f = Foundation(
        brand=brand,
        product_name=product_name,
        shade_code=shade_code,
        shade_name=shade_name,
        L_value=result["L_value"],
        a_value=result["a_value"],
        b_value=result["b_value"],
        hex_color=result["hex_color"],
        undertone=result["undertone"],
        swatch_image_url=upload_result.public_url,
    )
    db.add(f)

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            delete_public_asset(upload_result.public_url)
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
            delete_public_asset(f.swatch_image_url)
        except StorageConfigError as e:
            raise HTTPException(status_code=500, detail=str(e))
        except StorageOperationError as e:
            raise HTTPException(status_code=502, detail=str(e))

    await db.delete(f)
    await db.commit()
    return {"ok": True}
