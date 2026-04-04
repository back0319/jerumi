import json
from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings

BACKEND_DIR = Path(__file__).resolve().parents[1]


def normalize_database_url(url: str) -> str:
    normalized = url.strip()
    if normalized.startswith("postgresql+asyncpg://"):
        return normalized
    if normalized.startswith("postgres://"):
        return "postgresql+asyncpg://" + normalized.removeprefix("postgres://")
    if normalized.startswith("postgresql://"):
        return "postgresql+asyncpg://" + normalized.removeprefix("postgresql://")
    return normalized


class Settings(BaseSettings):
    PORT: int = 8000
    DATABASE_URL: str = "postgresql+asyncpg://skinmatch:skinmatch_dev@localhost:5432/skinmatch"
    DATABASE_CONNECT_TIMEOUT: float = 10.0
    AUTO_CREATE_TABLES: bool = True
    JWT_SECRET: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin1234"
    UPLOAD_DIR: str = "uploads"
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    CORS_ORIGIN_REGEX: str | None = None

    model_config = {"env_file": ".env"}

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_database_url_value(cls, value: Any) -> str:
        if not isinstance(value, str):
            return value
        return normalize_database_url(value)

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(origin).strip() for origin in value if str(origin).strip()]

        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("["):
                parsed = json.loads(raw)
                if not isinstance(parsed, list):
                    raise ValueError("CORS_ORIGINS JSON must be a list")
                return [str(origin).strip() for origin in parsed if str(origin).strip()]
            return [origin.strip() for origin in raw.split(",") if origin.strip()]

        return value

    @property
    def upload_path(self) -> Path:
        path = Path(self.UPLOAD_DIR)
        if path.is_absolute():
            return path
        return BACKEND_DIR / path


settings = Settings()
