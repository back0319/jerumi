from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import Base, engine
from app.routers import analysis, auth, foundations


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # Ensure upload directories exist
    Path(settings.UPLOAD_DIR, "swatches").mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="SkinMatch API",
    description="CIELAB-based skin tone analysis and foundation recommendation",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=settings.UPLOAD_DIR), name="static")

app.include_router(auth.router)
app.include_router(analysis.router)
app.include_router(foundations.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
