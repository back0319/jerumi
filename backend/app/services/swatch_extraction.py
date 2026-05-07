"""Foundation swatch extraction from photos with optional ColorChecker calibration.

This runtime path intentionally avoids OpenCV to keep the Vercel Python bundle
smaller. The workflow is:
1. Decode the uploaded image with Pillow.
2. Downscale for mask detection and isolate the largest non-white component.
3. Upscale the component mask to the original image and extract swatch pixels.
4. Optionally apply ColorChecker correction, then compute representative LAB.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from app.schemas.analysis import ColorCheckerPatch
from app.services.color_checker_detection import (
    ColorCheckerDetection,
    DetectionPoint,
    detect_color_checker,
    polygon_mask,
)
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


@dataclass(frozen=True)
class SwatchExtraction:
    pixels_rgb: np.ndarray
    polygon: list[DetectionPoint] | None
    raw_pixel_count: int


@dataclass(frozen=True)
class _MaskComponent:
    mask: np.ndarray
    area: int
    min_x: int
    min_y: int
    max_x: int
    max_y: int
    fill_ratio: float
    touches_border: bool


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
    components = _component_masks(mask)
    if not components:
        return None

    return max(components, key=lambda component: component.area).mask


def _component_masks(mask: np.ndarray) -> list[_MaskComponent]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    components: list[_MaskComponent] = []

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

        component_mask = np.zeros_like(mask, dtype=bool)
        ys, xs = zip(*component_pixels)
        ys_array = np.array(ys)
        xs_array = np.array(xs)
        component_mask[ys_array, xs_array] = True
        min_y = int(np.min(ys_array))
        max_y = int(np.max(ys_array))
        min_x = int(np.min(xs_array))
        max_x = int(np.max(xs_array))
        bbox_area = max(1, (max_x - min_x + 1) * (max_y - min_y + 1))
        touches_border = (
            min_x <= 2
            or min_y <= 2
            or max_x >= width - 3
            or max_y >= height - 3
        )
        components.append(
            _MaskComponent(
                mask=component_mask,
                area=len(component_pixels),
                min_x=min_x,
                min_y=min_y,
                max_x=max_x,
                max_y=max_y,
                fill_ratio=len(component_pixels) / bbox_area,
                touches_border=touches_border,
            )
        )

    return components


def _decode_image(image_bytes: bytes) -> np.ndarray:
    try:
        image = ImageOps.exif_transpose(Image.open(BytesIO(image_bytes))).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Cannot decode image") from exc

    return np.asarray(image, dtype=np.uint8)


def _border_mask(height: int, width: int) -> np.ndarray:
    margin = max(8, int(round(min(height, width) * 0.06)))
    mask = np.zeros((height, width), dtype=bool)
    mask[:margin, :] = True
    mask[-margin:, :] = True
    mask[:, :margin] = True
    mask[:, -margin:] = True
    return mask


def _background_relative_component_mask(
    working_rgb: np.ndarray,
    exclude_mask: np.ndarray,
) -> np.ndarray | None:
    height, width = working_rgb.shape[:2]
    working_lab = _rgb_image_to_lab(working_rgb)
    bg_candidates = _border_mask(height, width) & ~exclude_mask

    if np.sum(bg_candidates) < 20:
        bg_candidates = ~exclude_mask

    if np.sum(bg_candidates) < 20:
        return None

    background_lab = np.median(working_lab[bg_candidates], axis=0)
    distance_from_background = np.linalg.norm(working_lab - background_lab, axis=2)

    mask = (distance_from_background > 7.0) & ~exclude_mask
    mask[:2, :] = False
    mask[-2:, :] = False
    mask[:, :2] = False
    mask[:, -2:] = False
    mask = _binary_dilation(_binary_erosion(mask, iterations=1), iterations=1)

    min_area = max(40, int(round(height * width * 0.001)))
    max_area = int(round(height * width * 0.45))
    candidates = [
        component
        for component in _component_masks(mask)
        if component.area >= min_area
        and component.area <= max_area
        and not component.touches_border
        and component.fill_ratio >= 0.25
        and (component.max_x - component.min_x + 1) >= 8
        and (component.max_y - component.min_y + 1) >= 8
    ]

    if not candidates:
        return None

    candidates_with_lightness = [
        (component, float(np.median(working_lab[component.mask][:, 0])))
        for component in candidates
    ]
    # In dim captures the ColorChecker body can dominate the non-background mask
    # if checker detection fails. Prefer any visible swatch-like component over
    # near-black card components.
    visible_candidates = [
        item for item in candidates_with_lightness if item[1] >= 18.0
    ]
    best = max(
        visible_candidates or candidates_with_lightness,
        key=lambda item: item[0].area * min(item[0].fill_ratio, 1.0),
    )[0]
    return best.mask


def _downscaled_component_mask(
    image_rgb: np.ndarray,
    exclude_polygon: list[DetectionPoint] | None = None,
) -> np.ndarray:
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

    exclude_mask = np.zeros(working_rgb.shape[:2], dtype=bool)
    if exclude_polygon:
        exclude_mask = polygon_mask(
            (working_rgb.shape[1], working_rgb.shape[0]),
            exclude_polygon,
            scale=working_rgb.shape[1] / original_width,
            padding=2,
        )

    relative_component_mask = _background_relative_component_mask(
        working_rgb,
        exclude_mask,
    )
    if relative_component_mask is not None:
        return relative_component_mask

    working_lab = _rgb_image_to_lab(working_rgb)
    working_mask = _refine_mask(_build_non_white_mask(working_lab))
    working_mask[exclude_mask] = False

    component_mask = _largest_component_mask(working_mask)
    if component_mask is None:
        return np.zeros(working_mask.shape, dtype=bool)

    return component_mask


def _mask_bounding_polygon(mask: np.ndarray) -> list[DetectionPoint] | None:
    coordinates = np.argwhere(mask)
    if len(coordinates) == 0:
        return None

    min_y, min_x = np.min(coordinates, axis=0)
    max_y, max_x = np.max(coordinates, axis=0)
    return [
        DetectionPoint(float(min_x), float(min_y)),
        DetectionPoint(float(max_x), float(min_y)),
        DetectionPoint(float(max_x), float(max_y)),
        DetectionPoint(float(min_x), float(max_y)),
    ]


def _inset_axis_aligned_polygon(
    polygon: list[DetectionPoint] | None,
    *,
    min_pixels: float = 2.0,
    ratio: float = 0.012,
) -> list[DetectionPoint] | None:
    if polygon is None or len(polygon) != 4:
        return polygon

    xs = [point.x for point in polygon]
    ys = [point.y for point in polygon]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    inset = max(min_pixels, min(max_x - min_x, max_y - min_y) * ratio)
    if min_x + inset >= max_x - inset or min_y + inset >= max_y - inset:
        return polygon

    return [
        DetectionPoint(float(min_x + inset), float(min_y + inset)),
        DetectionPoint(float(max_x - inset), float(min_y + inset)),
        DetectionPoint(float(max_x - inset), float(max_y - inset)),
        DetectionPoint(float(min_x + inset), float(max_y - inset)),
    ]


def _extract_swatch(
    image_rgb: np.ndarray,
    checker_detection: ColorCheckerDetection | None = None,
) -> SwatchExtraction:
    small_component_mask = _downscaled_component_mask(
        image_rgb,
        checker_detection.polygon if checker_detection else None,
    )
    if not np.any(small_component_mask):
        return SwatchExtraction(
            pixels_rgb=np.empty((0, 3), dtype=np.uint8),
            polygon=None,
            raw_pixel_count=0,
        )

    original_height, original_width = image_rgb.shape[:2]
    mask_image = Image.fromarray((small_component_mask.astype(np.uint8) * 255))
    full_mask = np.asarray(
        mask_image.resize((original_width, original_height), resample=_RESAMPLING.NEAREST),
        dtype=np.uint8,
    ) > 0

    candidate_pixels = image_rgb[full_mask]
    if len(candidate_pixels) == 0:
        return SwatchExtraction(
            pixels_rgb=np.empty((0, 3), dtype=np.uint8),
            polygon=None,
            raw_pixel_count=0,
        )

    candidate_lab = _rgb_pixels_to_lab_array(candidate_pixels)
    color_pixel_mask = _build_non_white_mask(candidate_lab)
    filtered_pixels = candidate_pixels[color_pixel_mask]
    filtered_mask = np.zeros_like(full_mask, dtype=bool)
    full_mask_y, full_mask_x = np.where(full_mask)
    filtered_mask[full_mask_y[color_pixel_mask], full_mask_x[color_pixel_mask]] = True
    display_mask = _binary_erosion(filtered_mask, iterations=1)
    if np.sum(display_mask) < 50:
        display_mask = filtered_mask

    return SwatchExtraction(
        pixels_rgb=filtered_pixels.astype(np.uint8),
        polygon=_inset_axis_aligned_polygon(_mask_bounding_polygon(display_mask)),
        raw_pixel_count=int(len(candidate_pixels)),
    )


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
    checker_detection = detect_color_checker(image_rgb)
    swatch = _extract_swatch(image_rgb, checker_detection)
    swatch_pixels_rgb = swatch.pixels_rgb

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
    correction_patches = None
    correction_source = None
    if checker_patches and len(checker_patches) >= 3:
        correction_patches = checker_patches
        correction_source = "manual"
    elif checker_detection and len(checker_detection.checker_patches) >= 3:
        correction_patches = checker_detection.checker_patches
        correction_source = "auto"

    if correction_patches:
        correction = build_correction_matrix(correction_patches)

    lab_array = rgb_pixels_to_lab(swatch_pixels_rgb.tolist(), correction)
    mean_lab = trimmed_mean_lab(lab_array)
    l_value, a_value, b_value = (
        float(mean_lab[0]),
        float(mean_lab[1]),
        float(mean_lab[2]),
    )

    confidence = _build_swatch_confidence(
        checker_detection=checker_detection,
        correction_applied=correction is not None,
        correction_source=correction_source,
        swatch_pixel_count=int(len(swatch_pixels_rgb)),
        lab_array=lab_array,
    )

    return {
        "L_value": round(l_value, 2),
        "a_value": round(a_value, 2),
        "b_value": round(b_value, 2),
        "hex_color": lab_to_hex(mean_lab),
        "undertone": _classify_undertone(a_value, b_value),
        "detection": {
            "color_checker": (
                checker_detection.to_dict() if checker_detection is not None else None
            ),
            "swatch": (
                {
                    "polygon": [point.to_dict() for point in swatch.polygon],
                    "pixel_count": int(len(swatch_pixels_rgb)),
                    "raw_pixel_count": swatch.raw_pixel_count,
                    "sample_hex": lab_to_hex(mean_lab),
                }
                if swatch.polygon is not None
                else None
            ),
            "color_correction_applied": correction is not None,
            "color_correction_source": correction_source,
        },
        "confidence": confidence,
    }


def _build_swatch_confidence(
    *,
    checker_detection: ColorCheckerDetection | None,
    correction_applied: bool,
    correction_source: str | None,
    swatch_pixel_count: int,
    lab_array: np.ndarray,
) -> dict:
    """Estimate confidence in the extracted swatch color."""
    notes: list[str] = []

    if checker_detection is not None:
        checker_score = float(np.clip(checker_detection.confidence, 0.0, 1.0))
    else:
        checker_score = 0.35
        notes.append("컬러체커가 감지되지 않아 보정 없이 색을 추출했습니다.")

    if swatch_pixel_count >= 5000:
        pixel_score = 1.0
    elif swatch_pixel_count >= 2000:
        pixel_score = 0.85
    elif swatch_pixel_count >= 800:
        pixel_score = 0.65
    elif swatch_pixel_count >= 200:
        pixel_score = 0.4
        notes.append("샘플 픽셀이 적어 결과 변동 가능성이 있습니다.")
    else:
        pixel_score = 0.2
        notes.append("샘플 픽셀이 매우 적어 색이 부정확할 수 있습니다.")

    if len(lab_array) >= 20:
        lab_std = float(np.mean(np.std(lab_array, axis=0)))
        if lab_std <= 1.5:
            homogeneity_score = 1.0
        elif lab_std <= 3.0:
            homogeneity_score = 0.85
        elif lab_std <= 5.0:
            homogeneity_score = 0.6
        else:
            homogeneity_score = 0.35
            notes.append("샘플 영역의 색 편차가 커서 균일하지 않습니다.")
    else:
        homogeneity_score = 0.5

    score = float(
        np.clip(
            0.5 * checker_score + 0.3 * pixel_score + 0.2 * homogeneity_score,
            0.2,
            0.99,
        )
    )

    if correction_applied and correction_source == "manual":
        notes.append("수동 보정 패치를 사용했습니다.")
    elif correction_applied:
        notes.append("자동 검출된 컬러체커로 색 보정을 적용했습니다.")

    if score >= 0.85:
        level = "높음"
    elif score >= 0.65:
        level = "보통"
    else:
        level = "낮음"

    return {
        "score": round(score, 2),
        "level": level,
        "notes": notes,
    }
