"""Core color analysis service.

Pipeline:
1. (Optional) Color checker calibration: build a correction matrix from
   measured vs reference patches, apply to all skin pixels.
2. sRGB → linear RGB → XYZ (D65) → CIELAB conversion.
3. Trimmed mean on L channel (10th-90th percentile) to exclude specular
   highlights and deep shadows.
4. CIEDE2000 ΔE calculation against foundation DB entries.
5. Sort and return top-N matches.
"""

from dataclasses import dataclass

import numpy as np

from app.schemas.analysis import ColorCheckerPatch
from app.utils.color_math import (
    delta_e_ciede2000,
    lab_to_xyz,
    srgb_to_xyz,
    xyz_to_lab,
    xyz_to_srgb,
)


@dataclass
class RegionRepresentativeSummary:
    final_lab: np.ndarray | None
    region_pixel_counts: dict[str, int]
    valid_region_names: list[str]
    region_representatives: dict[str, np.ndarray]
    max_region_delta_e: float | None


@dataclass
class ConfidenceSummary:
    score: float
    level: str
    notes: list[str]


@dataclass
class RepresentativeSkinAnalysis:
    skin_lab: np.ndarray
    method: str
    fallback_used: bool
    total_pixel_count: int
    valid_region_count: int
    region_pixel_counts: dict[str, int]
    max_region_delta_e: float | None
    confidence: ConfidenceSummary


def categorize_delta_e(delta_e_value: float) -> tuple[str, str, str]:
    """Map a CIEDE2000 Delta E value to an objective interpretation band.

    Bands follow commonly used perceptual thresholds:
    - <= 1.0: nearly imperceptible
    - <= 2.0: only visible on close inspection
    - <= 3.5: noticeable at a glance
    - <= 5.0: clearly different
    - > 5.0: large color difference
    """
    if delta_e_value <= 1.0:
        return (
            "거의 구분 어려움",
            "ΔE ≤ 1.0",
            "표준 관찰 조건에서 사람 눈으로 거의 구분하기 어려운 수준",
        )
    if delta_e_value <= 2.0:
        return (
            "아주 근접",
            "1.0 < ΔE ≤ 2.0",
            "가까이서 비교하면 차이를 느낄 수 있지만 매우 가까운 수준",
        )
    if delta_e_value <= 3.5:
        return (
            "눈에 띄는 차이",
            "2.0 < ΔE ≤ 3.5",
            "일반적인 조건에서도 차이가 보이기 시작하는 수준",
        )
    if delta_e_value <= 5.0:
        return (
            "뚜렷한 차이",
            "3.5 < ΔE ≤ 5.0",
            "같은 색으로 보기 어려울 만큼 차이가 분명한 수준",
        )
    return (
        "차이 큼",
        "ΔE > 5.0",
        "객관적으로 색 차이가 큰 편이라 다른 색상군으로 느껴질 수 있는 수준",
    )


def build_correction_matrix(
    patches: list[ColorCheckerPatch],
) -> np.ndarray | None:
    """Build a 3x3 affine color correction matrix from color checker patches.

    Uses least-squares to find M such that M @ measured_XYZ ≈ reference_XYZ.
    This corrects for lighting/camera color cast.
    """
    if not patches or len(patches) < 3:
        return None

    measured_xyz_list = []
    reference_xyz_list = []

    for p in patches:
        rgb = np.array(p.measured_rgb) / 255.0
        rgb = np.clip(rgb, 0, 1).reshape(1, 1, 3)
        m_xyz = srgb_to_xyz(rgb).reshape(3)
        measured_xyz_list.append(m_xyz)

        ref_lab = np.array(p.reference_lab).reshape(1, 1, 3)
        r_xyz = lab_to_xyz(ref_lab).reshape(3)
        reference_xyz_list.append(r_xyz)

    M_measured = np.array(measured_xyz_list)  # (N, 3)
    M_reference = np.array(reference_xyz_list)  # (N, 3)

    # Solve: correction @ M_measured.T = M_reference.T
    # correction = M_reference.T @ pinv(M_measured.T)
    correction, _, _, _ = np.linalg.lstsq(M_measured, M_reference, rcond=None)
    return correction.T  # (3, 3)


def rgb_pixels_to_lab(
    pixels_rgb: list[list[float]],
    correction_matrix: np.ndarray | None = None,
) -> np.ndarray:
    """Convert RGB pixels (0-255) to CIELAB, optionally applying color correction."""
    arr = np.array(pixels_rgb, dtype=np.float64) / 255.0
    arr = np.clip(arr, 0, 1)

    # Convert to XYZ
    xyz = srgb_to_xyz(arr.reshape(-1, 1, 3)).reshape(-1, 3)

    # Apply color checker correction if available
    if correction_matrix is not None:
        xyz = (correction_matrix @ xyz.T).T
        xyz = np.clip(xyz, 0, None)

    # XYZ → CIELAB
    lab = xyz_to_lab(xyz.reshape(-1, 1, 3)).reshape(-1, 3)
    return lab


def _trim_lightness(lab: np.ndarray) -> np.ndarray:
    """Remove highlight and shadow extremes from a LAB sample."""
    candidates = lab
    if len(candidates) < 20:
        return candidates

    lightness = candidates[:, 0]
    p10 = np.percentile(lightness, 10)
    p90 = np.percentile(lightness, 90)
    lightness_mask = (lightness >= p10) & (lightness <= p90)

    if np.sum(lightness_mask) >= 10:
        return candidates[lightness_mask]

    return candidates


def _trim_redness(lab: np.ndarray, upper_percentile: float = 90.0) -> np.ndarray:
    """Suppress the reddest tail of a LAB sample for lower-face ROI analysis."""
    candidates = lab
    if len(candidates) < 20:
        return candidates

    redness_cutoff = np.percentile(candidates[:, 1], upper_percentile)
    redness_mask = candidates[:, 1] <= redness_cutoff

    if np.sum(redness_mask) >= max(10, len(candidates) // 2):
        return candidates[redness_mask]

    return candidates


def _mad_filter_lab(lab: np.ndarray) -> np.ndarray:
    """Remove multichannel LAB outliers with a conservative MAD filter."""
    candidates = lab
    if len(candidates) < 15:
        return candidates

    median = np.median(candidates, axis=0)
    mad = np.median(np.abs(candidates - median), axis=0)
    mad = np.where(mad < 1e-6, 1.0, mad)

    robust_z = 0.6745 * (candidates - median) / mad
    outlier_mask = np.max(np.abs(robust_z), axis=1) <= 2.5

    if np.sum(outlier_mask) >= max(8, len(candidates) // 4):
        return candidates[outlier_mask]

    return candidates


def _nearest_sample_to_centroid(lab: np.ndarray) -> np.ndarray:
    """Choose the actual sampled pixel nearest to the cleaned cluster centroid."""
    centroid = np.mean(lab, axis=0)
    distances = np.sum((lab - centroid) ** 2, axis=1)
    return lab[np.argmin(distances)]


def _representative_lab(
    lab: np.ndarray,
    *,
    trim_redness_percentile: float | None = None,
) -> np.ndarray:
    """Return a robust representative LAB sample from a cluster of pixels."""
    if len(lab) == 0:
        raise ValueError("LAB pixel array must not be empty")

    candidates = _trim_lightness(lab)

    if trim_redness_percentile is not None:
        candidates = _trim_redness(candidates, trim_redness_percentile)

    candidates = _mad_filter_lab(candidates)
    return _nearest_sample_to_centroid(candidates)


def trimmed_mean_lab(lab: np.ndarray) -> np.ndarray:
    """Compute a robust representative LAB value from a flat skin pixel sample.

    This keeps the previously introduced highlight/shadow cleanup and LAB MAD
    filtering for legacy flat ROI payloads and swatch analysis.
    """
    return _representative_lab(lab)


def representative_region_lab(lab: np.ndarray) -> np.ndarray:
    """Compute a robust LAB representative for a single named facial region.

    Compared with the legacy flat path, this adds an explicit upper-tail trim on
    the a* axis to suppress localized redness before the LAB MAD filter.
    """
    return _representative_lab(lab, trim_redness_percentile=90.0)


def select_medoid_lab(region_labs: list[np.ndarray]) -> np.ndarray:
    """Select the LAB sample with the smallest summed CIEDE2000 distance."""
    if not region_labs:
        raise ValueError("At least one region LAB value is required")

    if len(region_labs) == 1:
        return region_labs[0]

    stacked = np.array(region_labs, dtype=np.float64)
    comparisons = stacked.reshape(-1, 1, 3)
    total_distances: list[float] = []

    for index in range(len(stacked)):
        reference = np.repeat(
            stacked[index].reshape(1, 1, 3),
            len(stacked),
            axis=0,
        )
        total_distance = float(np.sum(delta_e_ciede2000(reference, comparisons)))
        total_distances.append(total_distance)

    return stacked[int(np.argmin(total_distances))]


def _max_pairwise_delta_e(region_labs: list[np.ndarray]) -> float | None:
    """Return the largest pairwise CIEDE2000 distance across region representatives."""
    if len(region_labs) < 2:
        return None

    max_distance = 0.0
    for left_index in range(len(region_labs)):
        for right_index in range(left_index + 1, len(region_labs)):
            distance = float(
                np.squeeze(
                    delta_e_ciede2000(
                        region_labs[left_index].reshape(1, 1, 3),
                        region_labs[right_index].reshape(1, 1, 3),
                    )
                )
            )
            max_distance = max(max_distance, distance)

    return max_distance


def summarize_skin_regions(
    region_pixels_rgb: dict[str, list[list[float]]],
    correction_matrix: np.ndarray | None = None,
    minimum_pixels: int = 50,
) -> RegionRepresentativeSummary:
    """Summarize grouped facial ROI pixels and choose a final representative LAB."""
    region_pixel_counts: dict[str, int] = {}
    valid_region_names: list[str] = []
    region_representatives: dict[str, np.ndarray] = {}

    for region_name, pixels in region_pixels_rgb.items():
        region_pixel_counts[region_name] = len(pixels)
        if len(pixels) < minimum_pixels:
            continue

        lab = rgb_pixels_to_lab(pixels, correction_matrix)
        region_representatives[region_name] = representative_region_lab(lab)
        valid_region_names.append(region_name)

    valid_region_labs = [
        region_representatives[region_name] for region_name in valid_region_names
    ]

    if not valid_region_labs:
        return RegionRepresentativeSummary(
            final_lab=None,
            region_pixel_counts=region_pixel_counts,
            valid_region_names=valid_region_names,
            region_representatives=region_representatives,
            max_region_delta_e=None,
        )

    if len(valid_region_labs) == 1:
        final_lab = valid_region_labs[0]
    else:
        final_lab = select_medoid_lab(valid_region_labs)

    return RegionRepresentativeSummary(
        final_lab=final_lab,
        region_pixel_counts=region_pixel_counts,
        valid_region_names=valid_region_names,
        region_representatives=region_representatives,
        max_region_delta_e=_max_pairwise_delta_e(valid_region_labs),
    )


def representative_skin_lab_from_regions(
    region_pixels_rgb: dict[str, list[list[float]]],
    correction_matrix: np.ndarray | None = None,
    minimum_pixels: int = 50,
) -> np.ndarray | None:
    """Compute a representative skin LAB value from grouped facial regions.

    Each region is summarized independently, then the final representative color
    is chosen as the CIEDE2000 medoid across valid region representatives.
    """
    return summarize_skin_regions(
        region_pixels_rgb,
        correction_matrix,
        minimum_pixels,
    ).final_lab


def build_confidence_summary(
    *,
    method: str,
    total_pixel_count: int,
    region_summary: RegionRepresentativeSummary | None = None,
    minimum_region_pixels: int = 50,
) -> ConfidenceSummary:
    """Estimate analysis confidence from ROI coverage, method, and region consistency."""
    score = 0.92 if method == "region-medoid" else 0.7
    notes: list[str] = []

    if total_pixel_count < 300:
        score -= 0.18
        notes.append("분석에 사용된 피부 픽셀이 적습니다.")
    elif total_pixel_count < 800:
        score -= 0.08
        notes.append("피부 픽셀 수가 충분하지 않아 결과 변동 가능성이 있습니다.")

    if method == "flat-pixels":
        score -= 0.08
        notes.append("다중 ROI 대신 단일 평면 픽셀 경로를 사용했습니다.")
    elif method == "flat-fallback":
        score -= 0.14
        notes.append("ROI 샘플이 부족해 fallback 평면 경로로 분석했습니다.")

    if region_summary is not None:
        valid_region_count = len(region_summary.valid_region_names)
        missing_regions = [
            region_name
            for region_name, pixel_count in region_summary.region_pixel_counts.items()
            if pixel_count < minimum_region_pixels
        ]

        if valid_region_count == 3:
            score -= 0.06
            notes.append("일부 ROI가 최소 픽셀 수를 충족하지 못했습니다.")
        elif valid_region_count == 2:
            score -= 0.14
            notes.append("유효한 ROI가 2개뿐이라 대표색 안정성이 낮아질 수 있습니다.")
        elif valid_region_count == 1:
            score -= 0.26
            notes.append("유효한 ROI가 1개뿐이라 결과가 국소 색에 치우칠 수 있습니다.")

        if missing_regions:
            notes.append(
                "제외된 ROI: " + ", ".join(missing_regions)
            )

        spread = region_summary.max_region_delta_e
        if spread is not None:
            if spread >= 8.0:
                score -= 0.22
                notes.append("ROI 간 색 차가 커서 조명 또는 피부 편차 영향이 큽니다.")
            elif spread >= 5.0:
                score -= 0.12
                notes.append("ROI 간 색 차가 다소 커서 결과 일관성이 떨어질 수 있습니다.")
            elif spread >= 3.5:
                score -= 0.05
                notes.append("ROI 간 색 차가 약간 관찰됩니다.")

    score = float(np.clip(score, 0.25, 0.99))

    if score >= 0.85:
        level = "높음"
    elif score >= 0.65:
        level = "보통"
    else:
        level = "낮음"

    return ConfidenceSummary(
        score=round(score, 2),
        level=level,
        notes=notes,
    )


def analyze_representative_skin_color(
    *,
    skin_pixels_rgb: list[list[float]] | None,
    skin_regions_rgb: dict[str, list[list[float]]] | None,
    correction_matrix: np.ndarray | None = None,
    minimum_region_pixels: int = 50,
) -> RepresentativeSkinAnalysis:
    """Resolve the representative skin color and metadata for either analysis path."""
    region_summary: RegionRepresentativeSummary | None = None

    if skin_regions_rgb is not None:
        region_summary = summarize_skin_regions(
            skin_regions_rgb,
            correction_matrix,
            minimum_region_pixels,
        )
        if region_summary.final_lab is not None:
            confidence = build_confidence_summary(
                method="region-medoid",
                total_pixel_count=sum(region_summary.region_pixel_counts.values()),
                region_summary=region_summary,
                minimum_region_pixels=minimum_region_pixels,
            )
            return RepresentativeSkinAnalysis(
                skin_lab=region_summary.final_lab,
                method="region-medoid",
                fallback_used=False,
                total_pixel_count=sum(region_summary.region_pixel_counts.values()),
                valid_region_count=len(region_summary.valid_region_names),
                region_pixel_counts=region_summary.region_pixel_counts,
                max_region_delta_e=region_summary.max_region_delta_e,
                confidence=confidence,
            )

    if not skin_pixels_rgb:
        raise ValueError("skin_pixels_rgb or skin_regions_rgb is required")

    lab_pixels = rgb_pixels_to_lab(skin_pixels_rgb, correction_matrix)
    method = "flat-fallback" if skin_regions_rgb is not None else "flat-pixels"
    confidence = build_confidence_summary(
        method=method,
        total_pixel_count=len(skin_pixels_rgb),
        region_summary=region_summary,
        minimum_region_pixels=minimum_region_pixels,
    )
    return RepresentativeSkinAnalysis(
        skin_lab=trimmed_mean_lab(lab_pixels),
        method=method,
        fallback_used=method == "flat-fallback",
        total_pixel_count=len(skin_pixels_rgb),
        valid_region_count=(
            0 if region_summary is None else len(region_summary.valid_region_names)
        ),
        region_pixel_counts=(
            {} if region_summary is None else region_summary.region_pixel_counts
        ),
        max_region_delta_e=(
            None if region_summary is None else region_summary.max_region_delta_e
        ),
        confidence=confidence,
    )


def lab_to_hex(lab: np.ndarray) -> str:
    """Convert a single LAB value to hex color string."""
    xyz = lab_to_xyz(lab.reshape(1, 1, 3))
    rgb = xyz_to_srgb(xyz).reshape(3)
    rgb = np.clip(rgb, 0, 1)
    r, g, b = (rgb * 255).astype(int)
    return f"#{r:02x}{g:02x}{b:02x}"


def compute_recommendations(
    skin_lab: np.ndarray,
    foundations: list[dict],
    top_n: int = 5,
) -> list[dict]:
    """Compute CIEDE2000 delta E between skin and each foundation, return top N."""
    results = []
    skin = skin_lab.reshape(1, 1, 3)

    for f in foundations:
        shade_lab = np.array([f["L_value"], f["a_value"], f["b_value"]]).reshape(1, 1, 3)
        de = float(np.squeeze(delta_e_ciede2000(skin, shade_lab)))
        rounded_de = round(de, 3)
        category, delta_range, description = categorize_delta_e(rounded_de)
        results.append(
            {
                **f,
                "delta_e": rounded_de,
                "delta_e_category": category,
                "delta_e_range": delta_range,
                "delta_e_description": description,
            }
        )

    results.sort(key=lambda x: x["delta_e"])
    return results[:top_n]
