from pydantic import BaseModel


class ColorCheckerPatch(BaseModel):
    """Measured RGB of a known color checker patch."""
    reference_lab: list[float]  # known L*, a*, b*
    measured_rgb: list[float]   # measured R, G, B (0-255)


class AnalysisRequest(BaseModel):
    """Skin analysis request with color-checker calibrated pixels."""
    skin_pixels_rgb: list[list[float]]  # [[R,G,B], ...] 0-255
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
    undertone: str | None


class AnalysisResponse(BaseModel):
    skin_lab: list[float]
    skin_hex: str
    recommendations: list[RecommendationItem]
