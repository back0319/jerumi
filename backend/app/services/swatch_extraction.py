"""Foundation swatch extraction from photos with optional ColorChecker calibration.

This runtime path intentionally avoids OpenCV to keep the Vercel Python bundle
smaller. The workflow is:
1. Decode the uploaded image with Pillow.
2. Downscale for mask detection and isolate the largest non-white component.
3. Upscale the component mask to the original image and extract swatch pixels.
4. Optionally apply ColorChecker correction, then compute representative LAB.
"""

from __future__ import annotations

from io import BytesIO

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.schemas.analysis import ColorCheckerPatch
from app.services.color_analysis import (
    build_correction_matrix,
    lab_to_hex,
    rgb_pixels_to_lab,
    trimmed_mean_lab,
)
from app.utils.color_math import srgb_to_xyz, xyz_to_lab

try:
    _RESAMPLING = Image.Resampling
except AttributeError:  # Pillow < 9.1
    _RESAMPLING = Image

_MASK_MAX_DIMENSION = 384


def _rgb_image_to_lab(image_rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(image_rgb, dtype=np.float64) / 255.0
    return xyz_to_lab(srgb_to_xyz(rgb))


def _rgb_pixels_to_lab_array(pixels_rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(pixels_rgb, dtype=np.float64) / 255.0
    return xyz_to_lab(srgb_to_xyz(rgb))


def _build_non_white_mask(lab: np.ndarray) -> np.ndarray:
    lightness = lab[..., 0]
    a_star = lab[..., 1]
    b_star = lab[..., 2]
    chroma = np.sqrt(a_star**2 + b_star**2)
    return (lightness < 82) | (chroma > 15)


def _binary_dilation(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    current = mask.astype(bool)
    for _ in range(iterations):
        padded = np.pad(current, 1, constant_values=False)
        neighbors = [
            padded[row : row + current.shape[0], col : col + current.shape[1]]
            for row in range(3)
            for col in range(3)
        ]
        current = np.any(np.stack(neighbors, axis=0), axis=0)
    return current


def _binary_erosion(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    current = mask.astype(bool)
    for _ in range(iterations):
        padded = np.pad(current, 1, constant_values=False)
        neighbors = [
            padded[row : row + current.shape[0], col : col + current.shape[1]]
            for row in range(3)
            for col in range(3)
        ]
        current = np.all(np.stack(neighbors, axis=0), axis=0)
    return current


def _refine_mask(mask: np.ndarray) -> np.ndarray:
    closed = _binary_erosion(_binary_dilation(mask, iterations=2), iterations=2)
    opened = _binary_dilation(_binary_erosion(closed, iterations=1), iterations=1)
    return opened


def _largest_component_mask(mask: np.ndarray) -> np.ndarray | None:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    best_component: np.ndarray | None = None
    best_area = 0

    for start_y, start_x in np.argwhere(mask):
        if visited[start_y, start_x]:
            continue

        stack = [(int(start_y), int(start_x))]
        visited[start_y, start_x] = True
        component_pixels: list[tuple[int, int]] = []

        while stack:
            current_y, current_x = stack.pop()
            component_pixels.append((current_y, current_x))

            for next_y in range(max(0, current_y - 1), min(height, current_y + 2)):
                for next_x in range(max(0, current_x - 1), min(width, current_x + 2)):
                    if visited[next_y, next_x] or not mask[next_y, next_x]:
                        continue
                    visited[next_y, next_x] = True
                    stack.append((next_y, next_x))

        area = len(component_pixels)
        if area <= best_area:
            continue

        component_mask = np.zeros_like(mask, dtype=bool)
        ys, xs = zip(*component_pixels)
        component_mask[np.array(ys), np.array(xs)] = True
        best_component = component_mask
        best_area = area

    return best_component


def _decode_image(image_bytes: bytes) -> np.ndarray:
    try:
        image = ImageOps.exif_transpose(Image.open(BytesIO(image_bytes))).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Cannot decode image") from exc

    return np.asarray(image, dtype=np.uint8)


def _downscaled_component_mask(image_rgb: np.ndarray) -> np.ndarray:
    original_height, original_width = image_rgb.shape[:2]
    longest_side = max(original_height, original_width)

    if longest_side <= _MASK_MAX_DIMENSION:
        working_rgb = image_rgb
    else:
        scale = _MASK_MAX_DIMENSION / longest_side
        resized_width = max(1, int(round(original_width * scale)))
        resized_height = max(1, int(round(original_height * scale)))
        working_image = Image.fromarray(image_rgb).resize(
            (resized_width, resized_height),
            resample=_RESAMPLING.LANCZOS,
        )
        working_rgb = np.asarray(working_image, dtype=np.uint8)

    working_lab = _rgb_image_to_lab(working_rgb)
    working_mask = _refine_mask(_build_non_white_mask(working_lab))

    component_mask = _largest_component_mask(working_mask)
    if component_mask is None:
        return np.zeros(working_mask.shape, dtype=bool)

    return component_mask


def _extract_swatch_pixels(image_rgb: np.ndarray) -> np.ndarray:
    small_component_mask = _downscaled_component_mask(image_rgb)
    if not np.any(small_component_mask):
        return np.empty((0, 3), dtype=np.uint8)

    original_height, original_width = image_rgb.shape[:2]
    mask_image = Image.fromarray((small_component_mask.astype(np.uint8) * 255))
    full_mask = np.asarray(
        mask_image.resize((original_width, original_height), resample=_RESAMPLING.NEAREST),
        dtype=np.uint8,
    ) > 0

    candidate_pixels = image_rgb[full_mask]
    if len(candidate_pixels) == 0:
        return np.empty((0, 3), dtype=np.uint8)

    candidate_lab = _rgb_pixels_to_lab_array(candidate_pixels)
    filtered_pixels = candidate_pixels[_build_non_white_mask(candidate_lab)]
    return filtered_pixels.astype(np.uint8)


def _classify_undertone(a_star: float, b_star: float) -> str:
    """Classify undertone from CIELAB a* and b* values."""
    if a_star > 2.0 and b_star > 5.0:
        return "WARM"
    if a_star < -1.0 or b_star < 0.0:
        return "COOL"
    return "NEUTRAL"


def extract_swatch_from_image(
    image_bytes: bytes,
    checker_patches: list[ColorCheckerPatch] | None = None,
) -> dict:
    """Extract foundation color from a photo of a swatch on white paper."""
    image_rgb = _decode_image(image_bytes)
    swatch_pixels_rgb = _extract_swatch_pixels(image_rgb)

    if len(swatch_pixels_rgb) < 50:
        raise ValueError(
            "Could not detect a foundation swatch in the image. "
            "Ensure the foundation is applied on white paper with sufficient contrast."
        )

    if len(swatch_pixels_rgb) > 20000:
        indices = np.random.default_rng(42).choice(
            len(swatch_pixels_rgb), 20000, replace=False
        )
        swatch_pixels_rgb = swatch_pixels_rgb[indices]

    correction = None
    if checker_patches and len(checker_patches) >= 3:
        correction = build_correction_matrix(checker_patches)

    lab_array = rgb_pixels_to_lab(swatch_pixels_rgb.tolist(), correction)
    mean_lab = trimmed_mean_lab(lab_array)
    l_value, a_value, b_value = (
        float(mean_lab[0]),
        float(mean_lab[1]),
        float(mean_lab[2]),
    )

    return {
        "L_value": round(l_value, 2),
        "a_value": round(a_value, 2),
        "b_value": round(b_value, 2),
        "hex_color": lab_to_hex(mean_lab),
        "undertone": _classify_undertone(a_value, b_value),
    }
