from typing import Annotated, Any

from pydantic import BaseModel, Field, ValidationInfo, field_validator


HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


def normalize_required_text(value: Any, field_name: str = "value") -> str:
    normalized = str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


class FoundationCreate(BaseModel):
    brand: str
    product_name: str
    shade_code: str = ""
    shade_name: str
    L_value: float
    a_value: float
    b_value: float
    hex_color: HexColor = "#000000"
    undertone: str | None = None
    swatch_image_url: str | None = None

    @field_validator("undertone", mode="before")
    @classmethod
    def normalize_undertone(cls, value: Any) -> str | None:
        return None

    @field_validator("brand", "product_name", "shade_name", mode="before")
    @classmethod
    def normalize_required_fields(cls, value: Any, info: ValidationInfo) -> str:
        return normalize_required_text(value, info.field_name)


class FoundationUpdate(BaseModel):
    brand: str | None = None
    product_name: str | None = None
    shade_code: str | None = None
    shade_name: str | None = None
    L_value: float | None = None
    a_value: float | None = None
    b_value: float | None = None
    hex_color: HexColor | None = None
    undertone: str | None = None
    swatch_image_url: str | None = None

    @field_validator("undertone", mode="before")
    @classmethod
    def normalize_undertone(cls, value: Any) -> str | None:
        return None

    @field_validator("brand", "product_name", "shade_name", mode="before")
    @classmethod
    def normalize_required_fields(
        cls, value: Any, info: ValidationInfo
    ) -> str | None:
        if value is None:
            return None
        return normalize_required_text(value, info.field_name)


class FoundationOut(BaseModel):
    id: int
    brand: str
    product_name: str
    shade_code: str
    shade_name: str
    L_value: float
    a_value: float
    b_value: float
    hex_color: HexColor
    undertone: str | None
    swatch_image_url: str | None

    model_config = {"from_attributes": True}


class FoundationDeleteResult(BaseModel):
    ok: bool
    storage_cleanup: str


class StorageCleanupRetryResult(BaseModel):
    processed: int
    completed: int
    pending: int


class DetectionPoint(BaseModel):
    x: float
    y: float


class DetectedColorCheckerPatch(BaseModel):
    patch_index: int
    measured_rgb: Annotated[list[float], Field(min_length=3, max_length=3)]
    center: DetectionPoint
    polygon: list[DetectionPoint]


class ColorCheckerFiducials(BaseModel):
    center: DetectionPoint | None = None
    corners: list[DetectionPoint]


class ColorCheckerDetectionResult(BaseModel):
    score: float
    confidence: float
    polygon: list[DetectionPoint]
    patches: list[DetectedColorCheckerPatch]
    fiducials: ColorCheckerFiducials


class SwatchDetectionResult(BaseModel):
    polygon: list[DetectionPoint]
    pixel_count: int
    raw_pixel_count: int
    sample_hex: str


class FoundationDetectionResult(BaseModel):
    color_checker: ColorCheckerDetectionResult | None = None
    swatch: SwatchDetectionResult | None = None
    color_correction_applied: bool
    color_correction_source: str | None = None


class FoundationAnalysisConfidence(BaseModel):
    score: float
    level: str
    notes: list[str]


class FoundationAnalysisResult(BaseModel):
    L_value: float
    a_value: float
    b_value: float
    hex_color: HexColor
    undertone: str | None = None
    detection: FoundationDetectionResult | None = None
    confidence: FoundationAnalysisConfidence | None = None
