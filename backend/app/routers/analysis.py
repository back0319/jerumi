"""Skin tone analysis and foundation recommendation endpoint."""

import base64
import io

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, UploadFile
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.foundation import Foundation
from app.schemas.analysis import AnalysisRequest, AnalysisResponse, RecommendationItem
from app.services.color_analysis import (
    build_correction_matrix,
    compute_recommendations,
    lab_to_hex,
    rgb_pixels_to_lab,
    trimmed_mean_lab,
)

router = APIRouter(prefix="/api", tags=["analysis"])


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

    # Convert skin pixels to LAB with correction
    lab_pixels = rgb_pixels_to_lab(req.skin_pixels_rgb, correction)

    # Trimmed mean to get representative skin color
    skin_lab = trimmed_mean_lab(lab_pixels)
    skin_hex = lab_to_hex(skin_lab)

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
    ranked = compute_recommendations(skin_lab, foundation_dicts, req.top_n)

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
            undertone=r["undertone"],
        )
        for r in ranked
    ]

    return AnalysisResponse(
        skin_lab=[round(float(v), 2) for v in skin_lab],
        skin_hex=skin_hex,
        recommendations=recommendations,
    )


@router.post("/analyze-image")
async def analyze_image_with_checker(
    image: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Alternative endpoint: upload full image with color checker.

    The backend detects the color checker, calibrates, and extracts skin
    from MediaPipe landmarks. This is a fallback for clients that cannot
    run MediaPipe locally.
    """
    contents = await image.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        return {"error": "Could not decode image"}

    # For now, return a placeholder — full server-side face mesh + checker
    # detection can be added as a future enhancement.
    return {"message": "Server-side analysis not yet implemented. Use /api/analyze with pre-extracted pixels."}
