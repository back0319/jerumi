from pydantic import BaseModel


class FoundationCreate(BaseModel):
    brand: str
    product_name: str = ""
    shade_code: str = ""
    shade_name: str
    L_value: float
    a_value: float
    b_value: float
    hex_color: str = "#000000"
    undertone: str = "NEUTRAL"
    swatch_image_url: str | None = None


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
    undertone: str
    swatch_image_url: str | None

    model_config = {"from_attributes": True}


class FoundationAnalysisResult(BaseModel):
    L_value: float
    a_value: float
    b_value: float
    hex_color: str
    undertone: str
