"""Skin tone analysis and foundation recommendation endpoint."""

from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.foundation import Foundation
from app.schemas.analysis import (
    AnalysisConfidence,
    AnalysisMeta,
    AnalysisRequest,
    AnalysisResponse,
    RecommendationRequest,
    RecommendationItem,
)

router = APIRouter(tags=["analysis"])


@lru_cache(maxsize=1)
def get_color_analysis_service():
    from app.services import color_analysis

    return color_analysis


@router.get("/analysis-ready", include_in_schema=False)
async def warm_analysis_dependencies(db: AsyncSession = Depends(get_db)):
    """Warm heavy analysis imports and the first foundation query for scan flow."""
    get_color_analysis_service()
    await db.execute(select(Foundation.id).limit(1))
    return {"status": "ready"}


async def _load_foundations(
    db: AsyncSession,
    brands: list[str] | None = None,
    product_names: list[str] | None = None,
) -> list[Foundation]:
    query = select(Foundation)
    if brands:
        query = query.where(Foundation.brand.in_(brands))
    if product_names:
        query = query.where(Foundation.product_name.in_(product_names))
    result = await db.execute(query)
    return list(result.scalars().all())


def _foundation_to_recommendation_input(foundation: Foundation) -> dict:
    return {
        "id": foundation.id,
        "brand": foundation.brand,
        "product_name": foundation.product_name,
        "shade_code": foundation.shade_code,
        "shade_name": foundation.shade_name,
        "L_value": foundation.L_value,
        "a_value": foundation.a_value,
        "b_value": foundation.b_value,
        "hex_color": foundation.hex_color,
        "undertone": foundation.undertone,
    }


def _ranked_to_recommendation_item(ranked: dict) -> RecommendationItem:
    return RecommendationItem(
        id=ranked["id"],
        brand=ranked["brand"],
        product_name=ranked["product_name"],
        shade_code=ranked["shade_code"],
        shade_name=ranked["shade_name"],
        lab=[ranked["L_value"], ranked["a_value"], ranked["b_value"]],
        hex_color=ranked["hex_color"],
        delta_e=ranked["delta_e"],
        delta_e_category=ranked["delta_e_category"],
        delta_e_range=ranked["delta_e_range"],
        delta_e_description=ranked["delta_e_description"],
        undertone=ranked["undertone"],
    )


async def _recommend_foundations(
    *,
    db: AsyncSession,
    skin_lab: list[float],
    brands: list[str] | None,
    product_names: list[str] | None,
    top_n: int,
) -> list[RecommendationItem]:
    color_analysis = get_color_analysis_service()
    foundations = await _load_foundations(db, brands, product_names)
    ranked = color_analysis.compute_recommendations(
        skin_lab,
        [_foundation_to_recommendation_input(f) for f in foundations],
        top_n,
    )
    return [_ranked_to_recommendation_item(r) for r in ranked]


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_skin(req: AnalysisRequest, db: AsyncSession = Depends(get_db)):
    """Analyze skin pixels and recommend foundations.

    Accepts pre-extracted skin ROI pixels (RGB 0-255) from the frontend,
    along with optional color checker patches for calibration.
    """
    color_analysis = get_color_analysis_service()

    # Build color correction matrix from checker patches
    correction = None
    if req.checker_patches:
        correction = color_analysis.build_skin_correction_matrix(req.checker_patches)

    region_payload = None
    if req.skin_regions_rgb is not None:
        region_payload = {
            "lower_left_cheek": req.skin_regions_rgb.lower_left_cheek,
            "lower_right_cheek": req.skin_regions_rgb.lower_right_cheek,
            "below_lips": req.skin_regions_rgb.below_lips,
            "chin": req.skin_regions_rgb.chin,
        }

    try:
        analysis = color_analysis.analyze_representative_skin_color(
            skin_pixels_rgb=req.skin_pixels_rgb,
            skin_regions_rgb=region_payload,
            correction_matrix=correction,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    skin_hex = color_analysis.lab_to_hex(analysis.skin_lab)

    if correction is not None:
        try:
            analysis_raw = color_analysis.analyze_representative_skin_color(
                skin_pixels_rgb=req.skin_pixels_rgb,
                skin_regions_rgb=region_payload,
                correction_matrix=None,
            )
            skin_lab_raw = analysis_raw.skin_lab
            skin_hex_raw = color_analysis.lab_to_hex(skin_lab_raw)
        except ValueError:
            skin_lab_raw = analysis.skin_lab
            skin_hex_raw = skin_hex
    else:
        skin_lab_raw = analysis.skin_lab
        skin_hex_raw = skin_hex

    recommendations = await _recommend_foundations(
        db=db,
        skin_lab=list(analysis.skin_lab),
        brands=req.brands,
        product_names=req.product_names,
        top_n=req.top_n,
    )

    return AnalysisResponse(
        skin_lab=[round(float(v), 2) for v in analysis.skin_lab],
        skin_hex=skin_hex,
        skin_lab_raw=[round(float(v), 2) for v in skin_lab_raw],
        skin_hex_raw=skin_hex_raw,
        correction_applied=correction is not None,
        recommendations=recommendations,
        analysis_meta=AnalysisMeta(
            method=analysis.method,
            fallback_used=analysis.fallback_used,
            total_pixel_count=analysis.total_pixel_count,
            valid_region_count=analysis.valid_region_count,
            region_pixel_counts=analysis.region_pixel_counts,
            max_region_delta_e=(
                None
                if analysis.max_region_delta_e is None
                else round(float(analysis.max_region_delta_e), 2)
            ),
            confidence=AnalysisConfidence(
                score=analysis.confidence.score,
                level=analysis.confidence.level,
                notes=analysis.confidence.notes,
            ),
        ),
    )


@router.post("/recommendations", response_model=list[RecommendationItem])
async def recommend_from_skin_lab(
    req: RecommendationRequest,
    db: AsyncSession = Depends(get_db),
):
    """Recommend foundations for an already computed skin LAB value."""
    return await _recommend_foundations(
        db=db,
        skin_lab=req.skin_lab,
        brands=req.brands,
        product_names=req.product_names,
        top_n=req.top_n,
    )
