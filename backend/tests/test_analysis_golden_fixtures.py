import json
from pathlib import Path

import numpy as np
import pytest

from app.schemas.analysis import ColorCheckerPatch
from app.services.color_analysis import (
    analyze_representative_skin_color,
    build_skin_correction_matrix,
    compute_recommendations,
    lab_to_hex,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures"


def _load_fixture(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fixture_file:
        return json.load(fixture_file)


def _expand_pixel_groups(groups: list[dict]) -> list[list[float]]:
    pixels: list[list[float]] = []
    for group in groups:
        red, green, blue = group["rgb"]
        jitter = group.get("jitter", 0)
        for index in range(group["count"]):
            offset = (index % (jitter * 2 + 1)) - jitter if jitter else 0
            pixels.append(
                [
                    max(0, min(255, red + offset)),
                    max(0, min(255, green + offset)),
                    max(0, min(255, blue + offset)),
                ]
            )
    return pixels


def _assert_recommendations(
    actual: list[dict],
    expected: list[dict],
    *,
    absolute_tolerance: float,
) -> None:
    assert [item["id"] for item in actual] == [item["id"] for item in expected]
    assert [item["delta_e_category"] for item in actual] == [
        item["category"] for item in expected
    ]
    np.testing.assert_allclose(
        [item["delta_e"] for item in actual],
        [item["delta_e"] for item in expected],
        rtol=0,
        atol=absolute_tolerance,
    )


@pytest.mark.parametrize(
    "fixture_name",
    ["flat_skin_recommendation.json"],
)
def test_flat_skin_analysis_matches_golden_fixture(fixture_name: str) -> None:
    fixture = _load_fixture(fixture_name)
    inputs = fixture["input"]
    expected = fixture["expected"]
    tolerances = fixture["tolerances"]

    analysis = analyze_representative_skin_color(
        skin_pixels_rgb=_expand_pixel_groups(inputs["skin_pixel_groups"]),
        skin_regions_rgb=None,
    )
    recommendations = compute_recommendations(
        analysis.skin_lab,
        inputs["foundations"],
        top_n=inputs["top_n"],
    )

    np.testing.assert_allclose(
        analysis.skin_lab,
        expected["skin_lab"],
        rtol=0,
        atol=tolerances["lab_absolute"],
    )
    assert lab_to_hex(analysis.skin_lab) == expected["skin_hex"]
    assert analysis.method == expected["method"]
    assert analysis.fallback_used is expected["fallback_used"]
    assert analysis.total_pixel_count == expected["total_pixel_count"]
    assert analysis.valid_region_count == expected["valid_region_count"]
    assert analysis.confidence.score == expected["confidence"]["score"]
    assert analysis.confidence.level == expected["confidence"]["level"]
    assert analysis.confidence.notes == expected["confidence"]["notes"]
    _assert_recommendations(
        recommendations,
        expected["recommendations"],
        absolute_tolerance=tolerances["delta_e_absolute"],
    )


def test_regional_colorchecker_analysis_matches_golden_fixture() -> None:
    fixture = _load_fixture("regional_colorchecker_recommendation.json")
    inputs = fixture["input"]
    expected = fixture["expected"]
    tolerances = fixture["tolerances"]

    regions = {
        name: _expand_pixel_groups(groups)
        for name, groups in inputs["skin_region_groups"].items()
    }
    patches = [ColorCheckerPatch(**patch) for patch in inputs["checker_patches"]]
    correction_matrix = build_skin_correction_matrix(patches)
    assert correction_matrix is not None

    analysis = analyze_representative_skin_color(
        skin_pixels_rgb=None,
        skin_regions_rgb=regions,
        correction_matrix=correction_matrix,
    )
    raw_analysis = analyze_representative_skin_color(
        skin_pixels_rgb=None,
        skin_regions_rgb=regions,
        correction_matrix=None,
    )
    recommendations = compute_recommendations(
        analysis.skin_lab,
        inputs["foundations"],
        top_n=inputs["top_n"],
    )

    np.testing.assert_allclose(
        correction_matrix,
        expected["correction_matrix"],
        rtol=0,
        atol=tolerances["matrix_absolute"],
    )
    np.testing.assert_allclose(
        analysis.skin_lab,
        expected["skin_lab"],
        rtol=0,
        atol=tolerances["lab_absolute"],
    )
    np.testing.assert_allclose(
        raw_analysis.skin_lab,
        expected["skin_lab_raw"],
        rtol=0,
        atol=tolerances["lab_absolute"],
    )
    assert lab_to_hex(analysis.skin_lab) == expected["skin_hex"]
    assert lab_to_hex(raw_analysis.skin_lab) == expected["skin_hex_raw"]
    assert analysis.method == expected["method"]
    assert analysis.fallback_used is expected["fallback_used"]
    assert analysis.total_pixel_count == expected["total_pixel_count"]
    assert analysis.valid_region_count == expected["valid_region_count"]
    assert analysis.region_pixel_counts == expected["region_pixel_counts"]
    assert analysis.max_region_delta_e == pytest.approx(
        expected["max_region_delta_e"],
        abs=tolerances["delta_e_absolute"],
    )
    assert analysis.confidence.score == expected["confidence"]["score"]
    assert analysis.confidence.level == expected["confidence"]["level"]
    assert analysis.confidence.notes == expected["confidence"]["notes"]
    _assert_recommendations(
        recommendations,
        expected["recommendations"],
        absolute_tolerance=tolerances["delta_e_absolute"],
    )
