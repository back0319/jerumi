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

import numpy as np
from colour import (
    Lab_to_XYZ,
    XYZ_to_Lab,
    XYZ_to_sRGB,
    delta_E,
    sRGB_to_XYZ,
)

from app.schemas.analysis import ColorCheckerPatch


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
        m_xyz = sRGB_to_XYZ(rgb).reshape(3)
        measured_xyz_list.append(m_xyz)

        ref_lab = np.array(p.reference_lab).reshape(1, 1, 3)
        r_xyz = Lab_to_XYZ(ref_lab).reshape(3)
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
    xyz = sRGB_to_XYZ(arr.reshape(-1, 1, 3)).reshape(-1, 3)

    # Apply color checker correction if available
    if correction_matrix is not None:
        xyz = (correction_matrix @ xyz.T).T
        xyz = np.clip(xyz, 0, None)

    # XYZ → CIELAB
    lab = XYZ_to_Lab(xyz.reshape(-1, 1, 3)).reshape(-1, 3)
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
        total_distance = float(np.sum(delta_E(reference, comparisons, method="CIE 2000")))
        total_distances.append(total_distance)

    return stacked[int(np.argmin(total_distances))]


def representative_skin_lab_from_regions(
    region_pixels_rgb: dict[str, list[list[float]]],
    correction_matrix: np.ndarray | None = None,
    minimum_pixels: int = 50,
) -> np.ndarray | None:
    """Compute a representative skin LAB value from grouped facial regions.

    Each region is summarized independently, then the final representative color
    is chosen as the CIEDE2000 medoid across valid region representatives.
    """
    region_representatives: list[np.ndarray] = []

    for pixels in region_pixels_rgb.values():
        if len(pixels) < minimum_pixels:
            continue

        lab = rgb_pixels_to_lab(pixels, correction_matrix)
        region_representatives.append(representative_region_lab(lab))

    if not region_representatives:
        return None

    if len(region_representatives) == 1:
        return region_representatives[0]

    return select_medoid_lab(region_representatives)


def lab_to_hex(lab: np.ndarray) -> str:
    """Convert a single LAB value to hex color string."""
    xyz = Lab_to_XYZ(lab.reshape(1, 1, 3))
    rgb = XYZ_to_sRGB(xyz).reshape(3)
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
        de = float(delta_E(skin, shade_lab, method="CIE 2000"))
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
