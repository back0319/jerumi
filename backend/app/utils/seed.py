"""Seed the foundation database from shade sample images.

Usage:
    docker compose exec backend python -m app.utils.seed
    python -m app.utils.seed

Reads images from ``shade_images/{brand}/*.png``, computes representative LAB
values from each swatch, and upserts them into the ``foundations`` table.
"""

import asyncio
import sys
from pathlib import Path

import cv2
import numpy as np
from sqlalchemy import delete

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.database import Base, async_session, engine
from app.models.foundation import Foundation
from app.services.swatch_extraction import _classify_undertone


def image_to_lab(image_path: str) -> tuple[float, float, float, str]:
    """Read an image and compute its mean CIELAB values and hex color."""
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float64)
    lab[:, :, 0] = lab[:, :, 0] * 100.0 / 255.0
    lab[:, :, 1] = lab[:, :, 1] - 128.0
    lab[:, :, 2] = lab[:, :, 2] - 128.0
    lab = lab.reshape(-1, 3)

    # Trimmed mean on L (10-90%) to reduce highlight/shadow bias.
    L = lab[:, 0]
    p10, p90 = np.percentile(L, 10), np.percentile(L, 90)
    mask = (L >= p10) & (L <= p90)
    if np.sum(mask) < 10:
        mask = np.ones(len(L), dtype=bool)

    mean_lab = np.mean(lab[mask], axis=0)

    # Convert mean LAB back to RGB for a swatch hex preview.
    lab_back = np.array(
        [[[
            np.clip(round(mean_lab[0] * 255.0 / 100.0), 0, 255),
            np.clip(round(mean_lab[1] + 128.0), 0, 255),
            np.clip(round(mean_lab[2] + 128.0), 0, 255),
        ]]],
        dtype=np.uint8,
    )
    rgb_back = cv2.cvtColor(lab_back, cv2.COLOR_LAB2RGB).reshape(3).astype(int)
    r, g, b = rgb_back.tolist()
    hex_color = f"#{r:02x}{g:02x}{b:02x}"

    return float(mean_lab[0]), float(mean_lab[1]), float(mean_lab[2]), hex_color


def classify_seed_undertone(shade_name: str, a_star: float, b_star: float) -> str:
    normalized = shade_name.upper().replace(" ", "")

    if any(token in normalized for token in ("COOL", "PINK", "PETAL")):
        return "COOL"

    if any(token in normalized for token in ("WARM", "GINGER", "HONEY", "TAN")):
        return "WARM"

    return _classify_undertone(a_star, b_star)


def iter_shade_image_records(shade_dir: Path) -> list[dict]:
    records: list[dict] = []

    for brand_dir in sorted(shade_dir.iterdir()):
        if not brand_dir.is_dir():
            continue

        brand = brand_dir.name
        for img_file in sorted(brand_dir.glob("*.png")):
            shade_name = img_file.stem.replace("_avg", "").replace("_", " ").upper()

            try:
                L, a, b, hex_color = image_to_lab(str(img_file))
            except Exception as exc:
                print(f"  SKIP {img_file.name}: {exc}")
                continue

            records.append(
                {
                    "brand": brand,
                    "shade_name": shade_name,
                    "L_value": round(L, 2),
                    "a_value": round(a, 2),
                    "b_value": round(b, 2),
                    "hex_color": hex_color,
                    "undertone": classify_seed_undertone(shade_name, a, b),
                }
            )

    return records


async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    shade_dir = Path(__file__).resolve().parents[2] / "shade_images"
    if not shade_dir.exists():
        print(f"No shade_images directory found at {shade_dir}")
        return

    records = iter_shade_image_records(shade_dir)
    if not records:
        print("No shade image records found to seed.")
        return

    async with async_session() as session:
        await session.execute(delete(Foundation))

        count = 0
        for record in records:
            foundation = Foundation(
                brand=record["brand"],
                shade_name=record["shade_name"],
                L_value=record["L_value"],
                a_value=record["a_value"],
                b_value=record["b_value"],
                hex_color=record["hex_color"],
                undertone=record["undertone"],
            )
            session.add(foundation)
            count += 1
            print(
                "  "
                f"{record['brand']}/{record['shade_name']}: "
                f"L={record['L_value']:.2f} "
                f"a={record['a_value']:.2f} "
                f"b={record['b_value']:.2f} "
                f"({record['hex_color']}, {record['undertone']})"
            )

        await session.commit()
        print(f"\nSeeded {count} foundation shades.")


if __name__ == "__main__":
    asyncio.run(seed())
