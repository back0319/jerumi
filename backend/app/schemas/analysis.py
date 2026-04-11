from pydantic import BaseModel, Field


class ColorCheckerPatch(BaseModel):
    """Measured RGB of a known color checker patch."""
    reference_lab: list[float]  # known L*, a*, b*
    measured_rgb: list[float]   # measured R, G, B (0-255)


class SkinRegionPixels(BaseModel):
    """Grouped facial skin pixels sampled from named ROI regions."""

    lower_left_cheek: list[list[float]] = Field(default_factory=list)
    lower_right_cheek: list[list[float]] = Field(default_factory=list)
    below_lips: list[list[float]] = Field(default_factory=list)
    chin: list[list[float]] = Field(default_factory=list)


class AnalysisRequest(BaseModel):
    """Skin analysis request with color-checker calibrated pixels."""
    skin_pixels_rgb: list[list[float]] | None = None  # [[R,G,B], ...] 0-255
    skin_regions_rgb: SkinRegionPixels | None = None
    checker_patches: list[ColorCheckerPatch] | None = None
    brands: list[str] | None = None
    top_n: int = 5


class RecommendationItem(BaseModel):
    id: int
    brand: str
    product_name: str
    shade_code: str
    shade_name: str
    lab: list[float]
    hex_color: str
    delta_e: float
    delta_e_category: str
    delta_e_range: str
    delta_e_description: str
    undertone: str | None


class AnalysisResponse(BaseModel):
    skin_lab: list[float]
    skin_hex: str
    recommendations: list[RecommendationItem]
