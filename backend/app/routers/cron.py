"""Authenticated maintenance endpoints invoked by Vercel Cron."""

import logging
import secrets
from typing import Annotated

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.models.foundation import Foundation

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/cron", tags=["cron"])


async def _query_foundation_id() -> None:
    async with async_session() as session:
        await session.execute(select(Foundation.id).limit(1))


@router.get("/supabase-keepalive", include_in_schema=False)
async def supabase_keepalive(
    authorization: Annotated[str | None, Header()] = None,
) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    cron_secret = settings.CRON_SECRET
    expected_authorization = f"Bearer {cron_secret}"

    if (
        not cron_secret
        or not authorization
        or not secrets.compare_digest(authorization, expected_authorization)
    ):
        return JSONResponse({"ok": False}, status_code=401, headers=headers)

    try:
        await _query_foundation_id()
    except Exception:
        logger.error("Supabase keepalive query failed.")
        return JSONResponse({"ok": False}, status_code=503, headers=headers)

    return JSONResponse({"ok": True}, headers=headers)
