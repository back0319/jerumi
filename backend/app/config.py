import json
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings

def normalize_database_url(url: str) -> str:
    normalized = url.strip()
    if normalized.startswith("postgres://"):
        normalized = "postgresql+asyncpg://" + normalized.removeprefix("postgres://")
    elif normalized.startswith("postgresql://"):
        normalized = "postgresql+asyncpg://" + normalized.removeprefix("postgresql://")

    if not normalized.startswith("postgresql+asyncpg://"):
        return normalized

    parts = urlsplit(normalized)
    query_items = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key == "sslmode":
            query_items.append(("ssl", value))
        else:
            query_items.append((key, value))

    return urlunsplit(parts._replace(query=urlencode(query_items)))


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
    SUPABASE_URL: str | None = None
    SUPABASE_SERVICE_ROLE_KEY: str | None = None
    SUPABASE_STORAGE_BUCKET: str | None = None
    CORS_ORIGINS: str = (
        "http://localhost:3000,"
        "http://127.0.0.1:3000,"
        "http://localhost:5173,"
        "http://127.0.0.1:5173"
    )
    CORS_ORIGIN_REGEX: str | None = None

    model_config = {"env_file": ".env"}

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_database_url_value(cls, value: Any) -> str:
        if not isinstance(value, str):
            return value
        return normalize_database_url(value)

    @property
    def cors_origins(self) -> list[str]:
        raw = self.CORS_ORIGINS.strip()
        if not raw:
            return []
        if raw.startswith("["):
            parsed = json.loads(raw)
            if not isinstance(parsed, list):
                raise ValueError("CORS_ORIGINS JSON must be a list")
            return [str(origin).strip() for origin in parsed if str(origin).strip()]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


settings = Settings()
