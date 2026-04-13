import unittest
from pathlib import Path
import sys

import numpy as np

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.services.color_analysis import (
    analyze_representative_skin_color,
    compute_recommendations,
    representative_skin_lab_from_regions,
    rgb_pixels_to_lab,
    summarize_skin_regions,
    trimmed_mean_lab,
)
from app.utils.color_math import delta_e_ciede2000


def make_pixels(rgb: list[int], count: int, jitter: int = 0) -> list[list[float]]:
    pixels: list[list[float]] = []
    for index in range(count):
        offset = (index % (jitter * 2 + 1)) - jitter if jitter else 0
        pixels.append(
            [
                max(0, min(255, rgb[0] + offset)),
                max(0, min(255, rgb[1] + offset)),
                max(0, min(255, rgb[2] + offset)),
            ]
        )
    return pixels


def delta_e_between(left: np.ndarray, right: np.ndarray) -> float:
    return float(
        np.squeeze(
            delta_e_ciede2000(
                np.array(left, dtype=np.float64).reshape(1, 1, 3),
                np.array(right, dtype=np.float64).reshape(1, 1, 3),
            )
        )
    )


class ColorAnalysisRegressionTests(unittest.TestCase):
    def test_trimmed_mean_lab_resists_redness_and_lightness_outliers(self) -> None:
        base_rgb = [198, 164, 146]
        pixels = (
            make_pixels(base_rgb, 220, jitter=4)
            + make_pixels([236, 128, 126], 24, jitter=3)
            + make_pixels([244, 232, 224], 24, jitter=2)
            + make_pixels([76, 61, 56], 24, jitter=2)
        )

        representative = trimmed_mean_lab(rgb_pixels_to_lab(pixels))
        base_lab = rgb_pixels_to_lab([base_rgb])[0]
        red_lab = rgb_pixels_to_lab([[236, 128, 126]])[0]

        self.assertLess(delta_e_between(representative, base_lab), 3.5)
        self.assertLess(
            delta_e_between(representative, base_lab),
            delta_e_between(representative, red_lab),
        )

    def test_region_summary_prefers_cluster_medoid(self) -> None:
        regions = {
            "lower_left_cheek": make_pixels([200, 170, 150], 120, jitter=4),
            "lower_right_cheek": make_pixels([202, 171, 151], 118, jitter=4),
            "below_lips": make_pixels([199, 168, 149], 126, jitter=4),
            "chin": make_pixels([222, 170, 154], 124, jitter=4),
        }

        summary = summarize_skin_regions(regions)
        expected_cluster_lab = rgb_pixels_to_lab([[200, 170, 150]])[0]
        outlier_lab = rgb_pixels_to_lab([[222, 170, 154]])[0]

        self.assertEqual(len(summary.valid_region_names), 4)
        self.assertIsNotNone(summary.final_lab)
        self.assertIsNotNone(summary.max_region_delta_e)
        self.assertLess(delta_e_between(summary.final_lab, expected_cluster_lab), 4.0)
        self.assertLess(
            delta_e_between(summary.final_lab, expected_cluster_lab),
            delta_e_between(summary.final_lab, outlier_lab),
        )

    def test_region_path_returns_single_valid_region_when_others_too_small(self) -> None:
        regions = {
            "lower_left_cheek": make_pixels([196, 162, 143], 140, jitter=3),
            "lower_right_cheek": make_pixels([210, 176, 160], 20, jitter=2),
            "below_lips": make_pixels([208, 173, 158], 12, jitter=2),
            "chin": make_pixels([205, 170, 154], 8, jitter=2),
        }

        representative = representative_skin_lab_from_regions(regions)
        expected_lab = rgb_pixels_to_lab([[196, 162, 143]])[0]

        self.assertIsNotNone(representative)
        self.assertLess(delta_e_between(representative, expected_lab), 3.5)

    def test_analyze_representative_skin_color_supports_region_and_legacy_paths(self) -> None:
        region_payload = {
            "lower_left_cheek": make_pixels([198, 164, 145], 120, jitter=4),
            "lower_right_cheek": make_pixels([199, 165, 146], 118, jitter=4),
            "below_lips": make_pixels([196, 163, 144], 122, jitter=4),
            "chin": make_pixels([197, 164, 145], 115, jitter=4),
        }
        flat_pixels = make_pixels([198, 164, 145], 360, jitter=5)

        region_analysis = analyze_representative_skin_color(
            skin_pixels_rgb=flat_pixels,
            skin_regions_rgb=region_payload,
        )
        legacy_analysis = analyze_representative_skin_color(
            skin_pixels_rgb=flat_pixels,
            skin_regions_rgb=None,
        )

        self.assertEqual(region_analysis.method, "region-medoid")
        self.assertFalse(region_analysis.fallback_used)
        self.assertEqual(region_analysis.valid_region_count, 4)
        self.assertEqual(legacy_analysis.method, "flat-pixels")
        self.assertFalse(legacy_analysis.fallback_used)
        self.assertGreater(region_analysis.confidence.score, legacy_analysis.confidence.score)

    def test_confidence_drops_with_single_valid_region(self) -> None:
        weak_regions = {
            "lower_left_cheek": make_pixels([198, 165, 146], 140, jitter=4),
            "lower_right_cheek": make_pixels([214, 157, 145], 24, jitter=3),
            "below_lips": make_pixels([184, 150, 133], 18, jitter=3),
            "chin": make_pixels([170, 136, 119], 16, jitter=3),
        }
        flat_pixels = make_pixels([198, 165, 146], 180, jitter=4)

        analysis = analyze_representative_skin_color(
            skin_pixels_rgb=flat_pixels,
            skin_regions_rgb=weak_regions,
        )

        self.assertEqual(analysis.method, "region-medoid")
        self.assertFalse(analysis.fallback_used)
        self.assertEqual(analysis.valid_region_count, 1)
        self.assertLessEqual(analysis.confidence.score, 0.65)
        self.assertIn("유효한 ROI가 1개뿐", " ".join(analysis.confidence.notes))

    def test_fallback_is_used_when_no_region_meets_threshold(self) -> None:
        invalid_regions = {
            "lower_left_cheek": make_pixels([198, 165, 146], 24, jitter=3),
            "lower_right_cheek": make_pixels([200, 167, 148], 18, jitter=3),
            "below_lips": make_pixels([194, 160, 141], 16, jitter=3),
            "chin": make_pixels([192, 158, 139], 12, jitter=3),
        }
        flat_pixels = make_pixels([198, 165, 146], 180, jitter=4)

        analysis = analyze_representative_skin_color(
            skin_pixels_rgb=flat_pixels,
            skin_regions_rgb=invalid_regions,
        )

        self.assertEqual(analysis.method, "flat-fallback")
        self.assertTrue(analysis.fallback_used)
        self.assertEqual(analysis.valid_region_count, 0)
        self.assertIn("fallback 평면 경로", " ".join(analysis.confidence.notes))

    def test_compute_recommendations_handles_scalar_delta_e(self) -> None:
        skin_lab = rgb_pixels_to_lab([[198, 164, 145]])[0]
        foundations = [
            {
                "id": 1,
                "brand": "Smoke",
                "product_name": "",
                "shade_code": "A",
                "shade_name": "Near",
                "L_value": 78.0,
                "a_value": 5.0,
                "b_value": 12.0,
                "hex_color": "#d8b79f",
                "undertone": None,
            },
            {
                "id": 2,
                "brand": "Smoke",
                "product_name": "",
                "shade_code": "B",
                "shade_name": "Far",
                "L_value": 65.0,
                "a_value": 15.0,
                "b_value": 25.0,
                "hex_color": "#b07f5d",
                "undertone": None,
            },
        ]

        recommendations = compute_recommendations(skin_lab, foundations, top_n=2)

        self.assertEqual(len(recommendations), 2)
        self.assertLess(recommendations[0]["delta_e"], recommendations[1]["delta_e"])
        expected_first = min(
            foundations,
            key=lambda foundation: delta_e_between(
                skin_lab,
                np.array(
                    [
                        foundation["L_value"],
                        foundation["a_value"],
                        foundation["b_value"],
                    ],
                    dtype=np.float64,
                ),
            ),
        )
        self.assertEqual(recommendations[0]["shade_name"], expected_first["shade_name"])

    def test_delta_e_ciede2000_matches_reference_pair(self) -> None:
        left = np.array([50.0, 2.6772, -79.7751], dtype=np.float64)
        right = np.array([50.0, 0.0, -82.7485], dtype=np.float64)

        self.assertAlmostEqual(delta_e_between(left, right), 2.0425, places=4)


if __name__ == "__main__":
    unittest.main()
