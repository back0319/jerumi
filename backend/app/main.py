import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import Base, engine
from app.routers import analysis, auth, foundations

logger = logging.getLogger(__name__)
UPLOAD_SWATCH_DIR = settings.upload_path / "swatches"

# Ensure upload directory exists before mounting static files
UPLOAD_SWATCH_DIR.mkdir(parents=True, exist_ok=True)


async def initialize_database() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOAD_SWATCH_DIR.mkdir(parents=True, exist_ok=True)
    if settings.AUTO_CREATE_TABLES:
        try:
            await asyncio.wait_for(
                initialize_database(),
                timeout=settings.DATABASE_CONNECT_TIMEOUT,
            )
        except Exception as exc:
            logger.warning("Skipping startup database initialization: %s", exc)
    yield
    await engine.dispose()


app = FastAPI(
    title="SkinMatch API",
    description="CIELAB-based skin tone analysis and foundation recommendation",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=str(settings.upload_path)), name="static")

app.include_router(auth.router)
app.include_router(analysis.router)
app.include_router(foundations.router)


@app.get("/health", include_in_schema=False)
@app.get("/ping", include_in_schema=False)
@app.get("/api/health")
async def health():
    return {"status": "ok"}
