import unittest
from io import BytesIO
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.services.color_analysis import rgb_pixels_to_lab
from app.services.swatch_extraction import extract_swatch_from_image
from app.utils.color_math import delta_e_ciede2000


def delta_e_between(left: np.ndarray, right: np.ndarray) -> float:
    return float(
        np.squeeze(
            delta_e_ciede2000(
                np.array(left, dtype=np.float64).reshape(1, 1, 3),
                np.array(right, dtype=np.float64).reshape(1, 1, 3),
            )
        )
    )


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
        self.assertEqual(result["undertone"], "WARM")


if __name__ == "__main__":
    unittest.main()
