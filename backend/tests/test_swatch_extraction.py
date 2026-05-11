import unittest
from io import BytesIO
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.services.color_checker_detection import (
    COLORCHECKER_REFERENCE_LAB,
    detect_color_checker,
)
from app.services.color_analysis import rgb_pixels_to_lab
from app.services.swatch_extraction import extract_swatch_from_image
from app.utils.color_math import delta_e_ciede2000
from app.utils.color_math import lab_to_xyz, xyz_to_srgb


def delta_e_between(left: np.ndarray, right: np.ndarray) -> float:
    return float(
        np.squeeze(
            delta_e_ciede2000(
                np.array(left, dtype=np.float64).reshape(1, 1, 3),
                np.array(right, dtype=np.float64).reshape(1, 1, 3),
            )
        )
    )


def lab_to_rgb_tuple(lab: list[float]) -> tuple[int, int, int]:
    xyz = lab_to_xyz(np.array(lab, dtype=np.float64).reshape(1, 1, 3))
    rgb = xyz_to_srgb(xyz).reshape(3)
    rgb = np.clip(rgb, 0, 1)
    return tuple((rgb * 255).round().astype(int).tolist())


def make_synthetic_checker_card(width: int = 480, height: int = 300) -> Image.Image:
    card = Image.new("RGB", (width, height), (8, 8, 8))
    draw = ImageDraw.Draw(card)
    grid_left = width * 0.13
    grid_right = width * 0.87
    grid_top = height * 0.15
    grid_bottom = height * 0.85
    cell_width = (grid_right - grid_left) / 6
    cell_height = (grid_bottom - grid_top) / 4
    patch_width = cell_width * 0.64
    patch_height = cell_height * 0.64

    for index, lab in enumerate(COLORCHECKER_REFERENCE_LAB):
        row = index // 6
        col = index % 6
        center_x = grid_left + cell_width * (col + 0.5)
        center_y = grid_top + cell_height * (row + 0.5)
        draw.rectangle(
            (
                center_x - patch_width / 2,
                center_y - patch_height / 2,
                center_x + patch_width / 2,
                center_y + patch_height / 2,
            ),
            fill=lab_to_rgb_tuple(lab),
        )

    return card


class SwatchExtractionTests(unittest.TestCase):
    def test_extract_swatch_from_synthetic_image(self) -> None:
        swatch_rgb = (198, 164, 145)
        image = Image.new("RGB", (400, 300), (248, 245, 241))
        draw = ImageDraw.Draw(image)

        draw.rectangle((28, 28, 58, 58), fill=(190, 40, 30))
        draw.rectangle((64, 28, 94, 58), fill=(40, 120, 200))
        draw.rectangle((100, 28, 130, 58), fill=(240, 200, 40))
        draw.rectangle((110, 120, 300, 220), fill=swatch_rgb)

        payload = BytesIO()
        image.save(payload, format="PNG")

        result = extract_swatch_from_image(payload.getvalue())
        expected_lab = rgb_pixels_to_lab([list(swatch_rgb)])[0]
        actual_lab = np.array(
            [result["L_value"], result["a_value"], result["b_value"]],
            dtype=np.float64,
        )

        self.assertLess(delta_e_between(actual_lab, expected_lab), 4.0)
        self.assertIsNone(result["undertone"])

    def test_detect_color_checker_from_rotated_synthetic_card(self) -> None:
        image = Image.new("RGB", (720, 720), (248, 245, 241))
        checker = make_synthetic_checker_card().rotate(90, expand=True)
        image.paste(checker, (220, 60))

        detection = detect_color_checker(np.asarray(image, dtype=np.uint8))

        self.assertIsNotNone(detection)
        assert detection is not None
        self.assertEqual(len(detection.checker_patches), 24)
        self.assertLess(detection.score, 25.0)

    def test_detect_color_checker_when_card_touches_dark_region(self) -> None:
        image = Image.new("RGB", (900, 720), (248, 245, 241))
        checker = make_synthetic_checker_card(width=360, height=230).rotate(
            90,
            expand=True,
        )
        image.paste(checker, (540, 120))
        draw = ImageDraw.Draw(image)
        draw.rectangle((100, 80, 560, 680), fill=(8, 8, 8))

        detection = detect_color_checker(np.asarray(image, dtype=np.uint8))

        self.assertIsNotNone(detection)
        assert detection is not None
        self.assertEqual(len(detection.checker_patches), 24)
        self.assertLess(detection.score, 25.0)

    def test_extract_swatch_ignores_detected_color_checker(self) -> None:
        swatch_rgb = (198, 164, 145)
        image = Image.new("RGB", (900, 620), (248, 245, 241))
        checker = make_synthetic_checker_card(width=520, height=330)
        image.paste(checker, (32, 36))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((610, 370, 840, 500), radius=16, fill=swatch_rgb)

        payload = BytesIO()
        image.save(payload, format="PNG")

        result = extract_swatch_from_image(payload.getvalue())
        expected_lab = rgb_pixels_to_lab([list(swatch_rgb)])[0]
        actual_lab = np.array(
            [result["L_value"], result["a_value"], result["b_value"]],
            dtype=np.float64,
        )

        self.assertLess(delta_e_between(actual_lab, expected_lab), 4.0)
        self.assertIsNotNone(result["detection"]["color_checker"])
        self.assertIsNotNone(result["detection"]["swatch"])
        self.assertEqual(result["detection"]["color_correction_source"], "auto")

    def test_extract_swatch_on_dim_background_uses_background_contrast(self) -> None:
        swatch_rgb = (190, 160, 130)
        image = Image.new("RGB", (900, 720), (166, 168, 166))
        checker = make_synthetic_checker_card(width=520, height=330)
        image.paste(checker, (180, 350))
        draw = ImageDraw.Draw(image)
        draw.rectangle((260, 92, 640, 310), fill=swatch_rgb)

        payload = BytesIO()
        image.save(payload, format="PNG")

        result = extract_swatch_from_image(payload.getvalue())
        expected_lab = rgb_pixels_to_lab([list(swatch_rgb)])[0]
        actual_lab = np.array(
            [result["L_value"], result["a_value"], result["b_value"]],
            dtype=np.float64,
        )

        self.assertLess(delta_e_between(actual_lab, expected_lab), 5.0)
        self.assertIsNotNone(result["detection"]["swatch"])

    def test_extract_swatch_in_low_light_does_not_pick_checker_body(self) -> None:
        swatch_rgb = (118, 107, 83)
        image = Image.new("RGB", (760, 1000), (113, 114, 110))
        checker = make_synthetic_checker_card(width=620, height=390)
        checker = ImageEnhance.Brightness(checker).enhance(0.58)
        image.paste(checker, (70, 560))
        draw = ImageDraw.Draw(image)
        draw.rectangle((230, 150, 530, 360), fill=swatch_rgb)

        payload = BytesIO()
        image.save(payload, format="PNG")

        result = extract_swatch_from_image(payload.getvalue())

        self.assertIsNotNone(result["detection"]["color_checker"])
        swatch = result["detection"]["swatch"]
        self.assertIsNotNone(swatch)
        assert swatch is not None
        swatch_top = min(point["y"] for point in swatch["polygon"])
        self.assertLess(swatch_top, 430)
        self.assertGreater(result["L_value"], 35.0)


if __name__ == "__main__":
    unittest.main()
