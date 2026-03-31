"""Foundation shade CRUD endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.foundation import Foundation
from app.routers.auth import get_current_admin
from app.schemas.foundation import FoundationCreate, FoundationOut, FoundationUpdate

router = APIRouter(prefix="/api/foundations", tags=["foundations"])


@router.get("", response_model=list[FoundationOut])
async def list_foundations(
    brand: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(Foundation).order_by(Foundation.brand, Foundation.shade_name)
    if brand:
        query = query.where(Foundation.brand == brand)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/brands", response_model=list[str])
async def list_brands(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Foundation.brand).distinct().order_by(Foundation.brand)
    )
    return result.scalars().all()


@router.get("/{foundation_id}", response_model=FoundationOut)
async def get_foundation(foundation_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Foundation).where(Foundation.id == foundation_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Foundation not found")
    return f


@router.post("", response_model=FoundationOut)
async def create_foundation(
    data: FoundationCreate,
    _admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    f = Foundation(**data.model_dump())
    db.add(f)
    await db.commit()
    await db.refresh(f)
    return f


@router.put("/{foundation_id}", response_model=FoundationOut)
async def update_foundation(
    foundation_id: int,
    data: FoundationUpdate,
    _admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Foundation).where(Foundation.id == foundation_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Foundation not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(f, key, value)

    await db.commit()
    await db.refresh(f)
    return f


@router.delete("/{foundation_id}")
async def delete_foundation(
    foundation_id: int,
    _admin: str = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Foundation).where(Foundation.id == foundation_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Foundation not found")
    await db.delete(f)
    await db.commit()
    return {"ok": True}
