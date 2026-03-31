"""Seed the foundation database from shade sample images.

Usage:
    docker compose exec backend python -m app.utils.seed

Reads images from shade_images/{brand}/*.png, computes average LAB,
and inserts into the foundations table.
"""

import asyncio
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from colour import XYZ_to_Lab, XYZ_to_sRGB, sRGB_to_XYZ

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.database import async_session, engine, Base
from app.models.foundation import Foundation


def image_to_lab(image_path: str) -> tuple[float, float, float, str]:
    """Read an image and compute its mean CIELAB values and hex color."""
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    # BGR → RGB, normalize to 0-1
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float64) / 255.0

    # Flatten to pixel array
    pixels = rgb.reshape(-1, 3)

    # sRGB → XYZ → LAB
    xyz = sRGB_to_XYZ(pixels.reshape(-1, 1, 3)).reshape(-1, 3)
    lab = XYZ_to_Lab(xyz.reshape(-1, 1, 3)).reshape(-1, 3)

    # Trimmed mean on L (10-90%)
    L = lab[:, 0]
    p10, p90 = np.percentile(L, 10), np.percentile(L, 90)
    mask = (L >= p10) & (L <= p90)
    if np.sum(mask) < 10:
        mask = np.ones(len(L), dtype=bool)

    mean_lab = np.mean(lab[mask], axis=0)

    # Lab to hex
    xyz_mean = np.array([[mean_lab]])
    from colour import Lab_to_XYZ
    xyz_back = Lab_to_XYZ(xyz_mean)
    rgb_back = XYZ_to_sRGB(xyz_back).reshape(3)
    rgb_back = np.clip(rgb_back, 0, 1)
    r, g, b = (rgb_back * 255).astype(int)
    hex_color = f"#{r:02x}{g:02x}{b:02x}"

    return float(mean_lab[0]), float(mean_lab[1]), float(mean_lab[2]), hex_color


async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    shade_dir = Path(__file__).resolve().parents[1] / "shade_images"
    if not shade_dir.exists():
        print(f"No shade_images directory found at {shade_dir}")
        return

    async with async_session() as session:
        count = 0
        for brand_dir in sorted(shade_dir.iterdir()):
            if not brand_dir.is_dir():
                continue
            brand = brand_dir.name

            for img_file in sorted(brand_dir.glob("*.png")):
                shade_name = img_file.stem.replace("_avg", "").replace("_", " ").upper()

                try:
                    L, a, b, hex_color = image_to_lab(str(img_file))
                except Exception as e:
                    print(f"  SKIP {img_file.name}: {e}")
                    continue

                f = Foundation(
                    brand=brand,
                    shade_name=shade_name,
                    L_value=round(L, 2),
                    a_value=round(a, 2),
                    b_value=round(b, 2),
                    hex_color=hex_color,
                )
                session.add(f)
                count += 1
                print(f"  {brand}/{shade_name}: L={L:.2f} a={a:.2f} b={b:.2f} ({hex_color})")

        await session.commit()
        print(f"\nSeeded {count} foundation shades.")


if __name__ == "__main__":
    asyncio.run(seed())
