"""Skin tone analysis and foundation recommendation endpoint."""

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
    RecommendationItem,
)
from app.services.color_analysis import (
    analyze_representative_skin_color,
    build_correction_matrix,
    compute_recommendations,
    lab_to_hex,
)

router = APIRouter(tags=["analysis"])


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_skin(req: AnalysisRequest, db: AsyncSession = Depends(get_db)):
    """Analyze skin pixels and recommend foundations.

    Accepts pre-extracted skin ROI pixels (RGB 0-255) from the frontend,
    along with optional color checker patches for calibration.
    """
    # Build color correction matrix from checker patches
    correction = None
    if req.checker_patches:
        correction = build_correction_matrix(req.checker_patches)

    region_payload = None
    if req.skin_regions_rgb is not None:
        region_payload = {
            "lower_left_cheek": req.skin_regions_rgb.lower_left_cheek,
            "lower_right_cheek": req.skin_regions_rgb.lower_right_cheek,
            "below_lips": req.skin_regions_rgb.below_lips,
            "chin": req.skin_regions_rgb.chin,
        }

    try:
        analysis = analyze_representative_skin_color(
            skin_pixels_rgb=req.skin_pixels_rgb,
            skin_regions_rgb=region_payload,
            correction_matrix=correction,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    skin_hex = lab_to_hex(analysis.skin_lab)

    # Query foundations, optionally filtered by brand
    query = select(Foundation)
    if req.brands:
        query = query.where(Foundation.brand.in_(req.brands))
    result = await db.execute(query)
    foundations = result.scalars().all()

    # Convert to dicts for matching
    foundation_dicts = [
        {
            "id": f.id,
            "brand": f.brand,
            "product_name": f.product_name,
            "shade_code": f.shade_code,
            "shade_name": f.shade_name,
            "L_value": f.L_value,
            "a_value": f.a_value,
            "b_value": f.b_value,
            "hex_color": f.hex_color,
            "undertone": f.undertone,
        }
        for f in foundations
    ]

    # Compute CIEDE2000 and get top N
    ranked = compute_recommendations(analysis.skin_lab, foundation_dicts, req.top_n)

    recommendations = [
        RecommendationItem(
            id=r["id"],
            brand=r["brand"],
            product_name=r["product_name"],
            shade_code=r["shade_code"],
            shade_name=r["shade_name"],
            lab=[r["L_value"], r["a_value"], r["b_value"]],
            hex_color=r["hex_color"],
            delta_e=r["delta_e"],
            delta_e_category=r["delta_e_category"],
            delta_e_range=r["delta_e_range"],
            delta_e_description=r["delta_e_description"],
            undertone=r["undertone"],
        )
        for r in ranked
    ]

    return AnalysisResponse(
        skin_lab=[round(float(v), 2) for v in analysis.skin_lab],
        skin_hex=skin_hex,
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
