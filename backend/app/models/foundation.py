from datetime import datetime

from sqlalchemy import DateTime, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Foundation(Base):
    __tablename__ = "foundations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    brand: Mapped[str] = mapped_column(String(100), index=True)
    product_name: Mapped[str] = mapped_column(String(200), default="")
    shade_code: Mapped[str] = mapped_column(String(50), default="")
    shade_name: Mapped[str] = mapped_column(String(100))
    L_value: Mapped[float] = mapped_column(Float)
    a_value: Mapped[float] = mapped_column(Float)
    b_value: Mapped[float] = mapped_column(Float)
    hex_color: Mapped[str] = mapped_column(String(7), default="#000000")
    undertone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    swatch_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
