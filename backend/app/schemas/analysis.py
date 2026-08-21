from typing import Annotated

from pydantic import BaseModel, Field


RgbChannel = Annotated[float, Field(ge=0, le=255)]
RgbTriplet = Annotated[list[RgbChannel], Field(min_length=3, max_length=3)]
LabTriplet = Annotated[list[float], Field(min_length=3, max_length=3)]


class ColorCheckerPatch(BaseModel):
    """Measured RGB of a known color checker patch."""
    reference_lab: LabTriplet  # known L*, a*, b*
    measured_rgb: RgbTriplet   # measured R, G, B (0-255)


class SkinRegionPixels(BaseModel):
    """Grouped facial skin pixels sampled from named ROI regions."""

    lower_left_cheek: list[RgbTriplet] = Field(default_factory=list)
    lower_right_cheek: list[RgbTriplet] = Field(default_factory=list)
    below_lips: list[RgbTriplet] = Field(default_factory=list)
    chin: list[RgbTriplet] = Field(default_factory=list)


class AnalysisRequest(BaseModel):
    """Skin analysis request with color-checker calibrated pixels."""
    skin_pixels_rgb: list[RgbTriplet] | None = None  # [[R,G,B], ...] 0-255
    skin_regions_rgb: SkinRegionPixels | None = None
    checker_patches: list[ColorCheckerPatch] | None = None
    brands: list[str] | None = None
    product_names: list[str] | None = None
    top_n: int = Field(default=5, ge=1, le=500)


class RecommendationRequest(BaseModel):
    """Recommendation-only request using an already analyzed skin LAB value."""
    skin_lab: LabTriplet
    brands: list[str] | None = None
    product_names: list[str] | None = None
    top_n: int = Field(default=200, ge=1, le=500)


class RecommendationItem(BaseModel):
    id: int
    brand: str
    product_name: str
    shade_code: str
    shade_name: str
    lab: LabTriplet
    hex_color: str
    delta_e: float
    delta_e_category: str
    delta_e_range: str
    delta_e_description: str
    undertone: str | None


class AnalysisConfidence(BaseModel):
    score: float
    level: str
    notes: list[str]


class AnalysisMeta(BaseModel):
    method: str
    fallback_used: bool
    total_pixel_count: int
    valid_region_count: int
    region_pixel_counts: dict[str, int]
    max_region_delta_e: float | None = None
    confidence: AnalysisConfidence


class AnalysisResponse(BaseModel):
    skin_lab: LabTriplet
    skin_hex: str
    skin_lab_raw: LabTriplet
    skin_hex_raw: str
    correction_applied: bool
    recommendations: list[RecommendationItem]
    analysis_meta: AnalysisMeta
