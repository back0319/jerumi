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


def trimmed_mean_lab(lab: np.ndarray) -> np.ndarray:
    """Compute trimmed mean of LAB values, using 10th-90th percentile of L to
    exclude highlights and shadows."""
    L = lab[:, 0]

    if len(L) < 20:
        return np.mean(lab, axis=0)

    p10 = np.percentile(L, 10)
    p90 = np.percentile(L, 90)
    mask = (L >= p10) & (L <= p90)

    if np.sum(mask) < 10:
        return np.mean(lab, axis=0)

    return np.mean(lab[mask], axis=0)


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
        results.append({**f, "delta_e": round(de, 3)})

    results.sort(key=lambda x: x["delta_e"])
    return results[:top_n]
