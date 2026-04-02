"""Foundation swatch extraction from photos with ColorChecker calibration.

Given a photo of foundation swatched on white paper alongside a ColorChecker
card, this service:
1. Isolates the foundation swatch region (non-white, non-checker area)
2. Optionally calibrates colors using ColorChecker patches
3. Converts extracted pixels to calibrated CIELAB values
4. Returns the mean LAB, hex color, and undertone classification
"""

import cv2
import numpy as np

from app.schemas.analysis import ColorCheckerPatch
from app.services.color_analysis import (
    build_correction_matrix,
    lab_to_hex,
    rgb_pixels_to_lab,
    trimmed_mean_lab,
)


def _find_swatch_mask(img_bgr: np.ndarray) -> np.ndarray:
    """Create a binary mask isolating the foundation swatch on white paper.

    Strategy: convert to LAB, mark pixels that are NOT white paper
    (L* < 85 or with significant color), then find the largest blob.
    """
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    L = lab[:, :, 0].astype(np.float32) * 100.0 / 255.0  # OpenCV LAB L is 0-255

    # Non-white mask: L < 85 or significant chroma
    a = lab[:, :, 1].astype(np.float32) - 128.0
    b = lab[:, :, 2].astype(np.float32) - 128.0
    chroma = np.sqrt(a ** 2 + b ** 2)

    # Pixels that are clearly not white paper
    non_white = (L < 82) | (chroma > 15)
    mask = non_white.astype(np.uint8) * 255

    # Morphological cleanup
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=2)

    # Find largest connected component (the swatch)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num_labels <= 1:
        return mask

    # Skip background (label 0), find largest component
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest_label = 1 + np.argmax(areas)
    largest_mask = (labels == largest_label).astype(np.uint8) * 255

    return largest_mask


def _classify_undertone(a_star: float, b_star: float) -> str:
    """Classify undertone from CIELAB a* and b* values."""
    if a_star > 2.0 and b_star > 5.0:
        return "WARM"
    elif a_star < -1.0 or b_star < 0.0:
        return "COOL"
    return "NEUTRAL"


def extract_swatch_from_image(
    image_bytes: bytes,
    checker_patches: list[ColorCheckerPatch] | None = None,
) -> dict:
    """Extract foundation color from a photo of a swatch on white paper.

    Args:
        image_bytes: Raw image file bytes (JPEG/PNG).
        checker_patches: Optional ColorChecker patch measurements for calibration.

    Returns:
        dict with keys: L_value, a_value, b_value, hex_color, undertone
    """
    # Decode image
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot decode image")

    # Find the swatch region
    mask = _find_swatch_mask(img)

    # Extract swatch pixels (BGR → RGB)
    swatch_pixels_bgr = img[mask > 0]
    if len(swatch_pixels_bgr) < 50:
        raise ValueError(
            "Could not detect a foundation swatch in the image. "
            "Ensure the foundation is applied on white paper with sufficient contrast."
        )

    swatch_pixels_rgb = cv2.cvtColor(
        swatch_pixels_bgr.reshape(-1, 1, 3), cv2.COLOR_BGR2RGB
    ).reshape(-1, 3)

    # Subsample if too many pixels (performance)
    if len(swatch_pixels_rgb) > 20000:
        indices = np.random.default_rng(42).choice(
            len(swatch_pixels_rgb), 20000, replace=False
        )
        swatch_pixels_rgb = swatch_pixels_rgb[indices]

    # Build color correction matrix from ColorChecker patches
    correction = None
    if checker_patches and len(checker_patches) >= 3:
        correction = build_correction_matrix(checker_patches)

    # Convert to calibrated CIELAB
    pixels_list = swatch_pixels_rgb.tolist()
    lab_array = rgb_pixels_to_lab(pixels_list, correction)

    # Trimmed mean
    mean_lab = trimmed_mean_lab(lab_array)
    L, a, b = float(mean_lab[0]), float(mean_lab[1]), float(mean_lab[2])

    # Hex color
    hex_color = lab_to_hex(mean_lab)

    # Undertone
    undertone = _classify_undertone(a, b)

    return {
        "L_value": round(L, 2),
        "a_value": round(a, 2),
        "b_value": round(b, 2),
        "hex_color": hex_color,
        "undertone": undertone,
    }
