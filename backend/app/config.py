from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://skinmatch:skinmatch_dev@localhost:5432/skinmatch"
    JWT_SECRET: str = "dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin1234"

    model_config = {"env_file": ".env"}


settings = Settings()
