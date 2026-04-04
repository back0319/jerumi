from typing import Any

from pydantic import BaseModel, field_validator


class FoundationCreate(BaseModel):
    brand: str
    product_name: str = ""
    shade_code: str = ""
    shade_name: str
    L_value: float
    a_value: float
    b_value: float
    hex_color: str = "#000000"
    undertone: str | None = None
    swatch_image_url: str | None = None

    @field_validator("undertone", mode="before")
    @classmethod
    def normalize_undertone(cls, value: Any) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip().upper()
        return normalized or None


class FoundationUpdate(BaseModel):
    brand: str | None = None
    product_name: str | None = None
    shade_code: str | None = None
    shade_name: str | None = None
    L_value: float | None = None
    a_value: float | None = None
    b_value: float | None = None
    hex_color: str | None = None
    undertone: str | None = None
    swatch_image_url: str | None = None

    @field_validator("undertone", mode="before")
    @classmethod
    def normalize_undertone(cls, value: Any) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip().upper()
        return normalized or None


class FoundationOut(BaseModel):
    id: int
    brand: str
    product_name: str
    shade_code: str
    shade_name: str
    L_value: float
    a_value: float
    b_value: float
    hex_color: str
    undertone: str | None
    swatch_image_url: str | None

    model_config = {"from_attributes": True}


class FoundationAnalysisResult(BaseModel):
    L_value: float
    a_value: float
    b_value: float
    hex_color: str
    undertone: str
