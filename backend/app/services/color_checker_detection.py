"""Automatic ColorChecker Classic detection.

The detector intentionally uses only Pillow and NumPy so the server bundle stays
small. It looks for the black card body, samples the expected 6x4 patch grid,
then chooses the grid orientation whose measured colors best fit the known
ColorChecker reference after an affine RGB correction.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

import numpy as np
from PIL import Image, ImageDraw

from app.schemas.analysis import ColorCheckerPatch
from app.utils.color_math import lab_to_xyz, xyz_to_srgb

try:
    _RESAMPLING = Image.Resampling
except AttributeError:  # Pillow < 9.1
    _RESAMPLING = Image

COLORCHECKER_REFERENCE_LAB: list[list[float]] = [
    [37.99, 13.56, 14.06],
    [65.71, 18.13, 17.81],
    [49.93, -4.88, -21.93],
    [43.14, -13.10, 21.91],
    [55.11, 8.84, -25.40],
    [70.72, -33.40, -0.20],
    [62.66, 36.07, 57.10],
    [40.02, 10.41, -45.96],
    [51.12, 48.24, 16.25],
    [30.33, 22.98, -21.59],
    [72.53, -23.71, 57.26],
    [71.94, 19.36, 67.86],
    [28.78, 14.18, -50.30],
    [55.26, -38.34, 31.37],
    [42.10, 53.38, 28.19],
    [81.73, 4.04, 79.82],
    [51.94, 49.99, -14.57],
    [51.04, -28.63, -28.64],
    [96.54, -0.43, 1.19],
    [81.26, -0.64, -0.34],
    [66.77, -0.73, -0.50],
    [50.87, -0.15, -0.27],
    [35.66, -0.42, -1.23],
    [20.46, -0.08, -0.97],
]

_MAX_DETECTION_DIMENSION = 640
_MAX_CANDIDATES = 10
_MAX_ACCEPTED_SCORE = 70.0
_MIN_COMPONENT_AREA_RATIO = 0.001
_MIN_CARD_LONG_SIDE = 72
_MIN_CARD_SHORT_SIDE = 36

# Patch grid bounds inside the black card body. These match the Calibrite /
# X-Rite Classic card layout with side label/ruler margins.
_GRID_U_START = 0.13
_GRID_U_END = 0.87
_GRID_V_START = 0.15
_GRID_V_END = 0.85
_EDGE_BIN_COUNT = 36
_EDGE_BIN_START = 0.04
_EDGE_BIN_END = 0.96
_EDGE_EXTREME_POINTS_PER_BIN = 5
_MIN_EDGE_POINTS = 8
_MIN_PATCH_COMPONENTS = 10
_MIN_PATCH_GRID_PAIRS = 10
_MAX_PATCH_GRID_CANDIDATES = 60
_PATCH_U_STEP_RANGE = (0.09, 0.17)
_PATCH_V_STEP_RANGE = (0.16, 0.27)


@dataclass(frozen=True)
class DetectionPoint:
    x: float
    y: float

    def to_dict(self) -> dict[str, float]:
        return {"x": round(self.x, 2), "y": round(self.y, 2)}


@dataclass(frozen=True)
class DetectedCheckerPatch:
    patch_index: int
    measured_rgb: list[float]
    center: DetectionPoint
    polygon: list[DetectionPoint]

    def to_dict(self) -> dict:
        return {
            "patch_index": self.patch_index,
            "measured_rgb": [round(float(value), 2) for value in self.measured_rgb],
            "center": self.center.to_dict(),
            "polygon": [point.to_dict() for point in self.polygon],
        }


@dataclass(frozen=True)
class ColorCheckerFiducials:
    center: DetectionPoint | None
    corners: list[DetectionPoint]

    def to_dict(self) -> dict:
        return {
            "center": None if self.center is None else self.center.to_dict(),
            "corners": [corner.to_dict() for corner in self.corners],
        }


@dataclass(frozen=True)
class ColorCheckerDetection:
    score: float
    confidence: float
    polygon: list[DetectionPoint]
    patches: list[DetectedCheckerPatch]
    checker_patches: list[ColorCheckerPatch]
    flip_rows: bool
    flip_cols: bool
    fiducials: ColorCheckerFiducials

    def to_dict(self) -> dict:
        return {
            "score": round(self.score, 2),
            "confidence": round(self.confidence, 2),
            "polygon": [point.to_dict() for point in self.polygon],
            "patches": [patch.to_dict() for patch in self.patches],
            "fiducials": self.fiducials.to_dict(),
        }


@dataclass(frozen=True)
class _ComponentGeometry:
    center: np.ndarray
    u_axis: np.ndarray
    v_axis: np.ndarray
    min_u: float
    max_u: float
    min_v: float
    max_v: float
    area: int
    fill_ratio: float


@dataclass(frozen=True)
class _PatchGridModel:
    u_centers: list[float]
    v_centers: list[float]
    half_u: float
    half_v: float


@dataclass(frozen=True)
class _PatchGridCandidate:
    center: np.ndarray
    width: float
    height: float
    area: int
    fill_ratio: float


@dataclass(frozen=True)
class _PatchGridFit:
    u_axis: np.ndarray
    v_axis: np.ndarray
    u_centers: list[float]
    v_centers: list[float]
    pair_count: int
    residual_mean: float


_REFERENCE_RGB = (
    xyz_to_srgb(
        lab_to_xyz(np.array(COLORCHECKER_REFERENCE_LAB, dtype=np.float64).reshape(-1, 1, 3))
    )
    .reshape(-1, 3)
    .clip(0, 1)
    * 255.0
)


def _resize_for_detection(image_rgb: np.ndarray) -> tuple[np.ndarray, float]:
    height, width = image_rgb.shape[:2]
    longest_side = max(height, width)

    if longest_side <= _MAX_DETECTION_DIMENSION:
        return image_rgb, 1.0

    scale = _MAX_DETECTION_DIMENSION / longest_side
    resized = Image.fromarray(image_rgb).resize(
        (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
        resample=_RESAMPLING.LANCZOS,
    )
    return np.asarray(resized, dtype=np.uint8), scale


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


def _build_dark_card_mask(image_rgb: np.ndarray) -> np.ndarray:
    rgb = image_rgb.astype(np.float64)
    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    channel_spread = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    scene_median = float(np.percentile(luma, 50))
    if scene_median < 115:
        dark_threshold = max(18.0, min(85.0, scene_median - 22.0))
    else:
        dark_threshold = 85.0

    neutral_threshold = min(
        125.0,
        max(dark_threshold + 8.0, float(np.percentile(luma, 25)) - 8.0),
    )
    dark = (luma < dark_threshold) | (
        (luma < neutral_threshold) & (channel_spread < 35)
    )
    return _binary_erosion(_binary_dilation(dark, iterations=2), iterations=1)


def _connected_components(mask: np.ndarray) -> list[np.ndarray]:
    min_area = max(120, int(mask.shape[0] * mask.shape[1] * _MIN_COMPONENT_AREA_RATIO))
    return _connected_components_with_min_area(mask, min_area)


def _connected_components_with_min_area(mask: np.ndarray, min_area: int) -> list[np.ndarray]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    components: list[np.ndarray] = []

    for start_y, start_x in np.argwhere(mask):
        if visited[start_y, start_x]:
            continue

        stack = [(int(start_y), int(start_x))]
        visited[start_y, start_x] = True
        pixels: list[tuple[int, int]] = []

        while stack:
            current_y, current_x = stack.pop()
            pixels.append((current_y, current_x))

            for next_y in range(max(0, current_y - 1), min(height, current_y + 2)):
                for next_x in range(max(0, current_x - 1), min(width, current_x + 2)):
                    if visited[next_y, next_x] or not mask[next_y, next_x]:
                        continue
                    visited[next_y, next_x] = True
                    stack.append((next_y, next_x))

        if len(pixels) >= min_area:
            components.append(np.array([(x, y) for y, x in pixels], dtype=np.float64))

    components.sort(key=len, reverse=True)
    return components


def _component_geometry(points_xy: np.ndarray) -> _ComponentGeometry | None:
    if len(points_xy) < 3:
        return None

    center = np.mean(points_xy, axis=0)
    centered = points_xy - center
    covariance = centered.T @ centered / len(points_xy)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    order = np.argsort(eigenvalues)[::-1]
    u_axis = eigenvectors[:, order[0]]
    v_axis = eigenvectors[:, order[1]]

    projected_u = centered @ u_axis
    projected_v = centered @ v_axis
    min_u, max_u = float(np.min(projected_u)), float(np.max(projected_u))
    min_v, max_v = float(np.min(projected_v)), float(np.max(projected_v))
    width = max_u - min_u
    height = max_v - min_v

    if width < _MIN_CARD_LONG_SIDE or height < _MIN_CARD_SHORT_SIDE:
        return None

    aspect = width / max(height, 1e-6)
    if aspect < 1.15 or aspect > 2.35:
        return None

    fill_ratio = len(points_xy) / max(width * height, 1.0)
    if fill_ratio < 0.12:
        return None

    return _ComponentGeometry(
        center=center,
        u_axis=u_axis,
        v_axis=v_axis,
        min_u=min_u,
        max_u=max_u,
        min_v=min_v,
        max_v=max_v,
        area=len(points_xy),
        fill_ratio=float(fill_ratio),
    )


def _card_interior_mask(
    component_points_xy: np.ndarray,
    shape: tuple[int, int],
) -> np.ndarray:
    height, width = shape
    interior = np.zeros((height, width), dtype=bool)
    rows = component_points_xy[:, 1].astype(int)
    cols = component_points_xy[:, 0].astype(int)

    for row in np.unique(rows):
        row_cols = cols[rows == row]
        if len(row_cols) < 2:
            continue
        interior[row, max(0, np.min(row_cols)) : min(width, np.max(row_cols) + 1)] = True

    return interior


def _normalized_card_coordinates(
    points_xy: np.ndarray,
    geometry: _ComponentGeometry,
) -> tuple[np.ndarray, np.ndarray]:
    centered = points_xy - geometry.center
    projected_u = centered @ geometry.u_axis
    projected_v = centered @ geometry.v_axis
    normalized_u = (projected_u - geometry.min_u) / (geometry.max_u - geometry.min_u)
    normalized_v = (projected_v - geometry.min_v) / (geometry.max_v - geometry.min_v)
    return normalized_u, normalized_v


def _detect_fiducial_points(
    image_rgb: np.ndarray,
    component_points_xy: np.ndarray,
    geometry: _ComponentGeometry,
) -> ColorCheckerFiducials:
    interior_mask = _card_interior_mask(component_points_xy, image_rgb.shape[:2])
    rgb = image_rgb.astype(np.float64)
    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    spread = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    bright = (luma > 135) & (spread < 95) & interior_mask
    ys, xs = np.where(bright)

    if len(xs) == 0:
        return ColorCheckerFiducials(center=None, corners=[])

    bright_points = np.stack([xs, ys], axis=1).astype(np.float64)
    normalized_u, normalized_v = _normalized_card_coordinates(bright_points, geometry)
    inside = (
        (normalized_u >= 0)
        & (normalized_u <= 1)
        & (normalized_v >= 0)
        & (normalized_v <= 1)
    )

    bright_points = bright_points[inside]
    normalized_u = normalized_u[inside]
    normalized_v = normalized_v[inside]
    if len(bright_points) == 0:
        return ColorCheckerFiducials(center=None, corners=[])

    center = _robust_fiducial_center(
        bright_points,
        normalized_u,
        normalized_v,
        (0.47, 0.53),
        (0.47, 0.53),
        min_points=2,
    )
    if center is None:
        center = _detect_center_fiducial_relaxed(
            image_rgb,
            interior_mask,
            geometry,
        )

    corner_windows = [
        ((0.00, 0.16), (0.00, 0.16)),
        ((0.84, 1.00), (0.00, 0.16)),
        ((0.84, 1.00), (0.84, 1.00)),
        ((0.00, 0.16), (0.84, 1.00)),
    ]
    corners: list[DetectionPoint] = []

    for u_window, v_window in corner_windows:
        corner = _robust_fiducial_center(
            bright_points,
            normalized_u,
            normalized_v,
            u_window,
            v_window,
            min_points=8,
        )
        if corner is not None:
            corners.append(corner)

    return ColorCheckerFiducials(center=center, corners=corners)


def _detect_center_fiducial_relaxed(
    image_rgb: np.ndarray,
    interior_mask: np.ndarray,
    geometry: _ComponentGeometry,
) -> DetectionPoint | None:
    rgb = image_rgb.astype(np.float64)
    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    spread = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    relaxed = (luma > 95) & (spread < 135) & interior_mask
    ys, xs = np.where(relaxed)

    if len(xs) == 0:
        return None

    points = np.stack([xs, ys], axis=1).astype(np.float64)
    normalized_u, normalized_v = _normalized_card_coordinates(points, geometry)
    return _robust_fiducial_center(
        points,
        normalized_u,
        normalized_v,
        (0.45, 0.55),
        (0.45, 0.55),
        min_points=4,
    )


def _robust_fiducial_center(
    points_xy: np.ndarray,
    normalized_u: np.ndarray,
    normalized_v: np.ndarray,
    u_window: tuple[float, float],
    v_window: tuple[float, float],
    *,
    min_points: int,
) -> DetectionPoint | None:
    mask = (
        (normalized_u >= u_window[0])
        & (normalized_u <= u_window[1])
        & (normalized_v >= v_window[0])
        & (normalized_v <= v_window[1])
    )
    if np.sum(mask) < min_points:
        return None

    selected_points = points_xy[mask]
    return DetectionPoint(
        float(np.median(selected_points[:, 0])),
        float(np.median(selected_points[:, 1])),
    )


def _scale_geometry(geometry: _ComponentGeometry, scale: float) -> _ComponentGeometry:
    if scale == 1.0:
        return geometry

    return _ComponentGeometry(
        center=geometry.center / scale,
        u_axis=geometry.u_axis,
        v_axis=geometry.v_axis,
        min_u=geometry.min_u / scale,
        max_u=geometry.max_u / scale,
        min_v=geometry.min_v / scale,
        max_v=geometry.max_v / scale,
        area=geometry.area,
        fill_ratio=geometry.fill_ratio,
    )


def _scale_fiducials(
    fiducials: ColorCheckerFiducials,
    scale: float,
) -> ColorCheckerFiducials:
    if scale == 1.0:
        return fiducials

    return ColorCheckerFiducials(
        center=(
            None
            if fiducials.center is None
            else DetectionPoint(fiducials.center.x / scale, fiducials.center.y / scale)
        ),
        corners=[
            DetectionPoint(corner.x / scale, corner.y / scale)
            for corner in fiducials.corners
        ],
    )


def _local_point(geometry: _ComponentGeometry, u_fraction: float, v_fraction: float) -> np.ndarray:
    u_value = geometry.min_u + u_fraction * (geometry.max_u - geometry.min_u)
    v_value = geometry.min_v + v_fraction * (geometry.max_v - geometry.min_v)
    return geometry.center + geometry.u_axis * u_value + geometry.v_axis * v_value


def _point_to_detection(point: np.ndarray) -> DetectionPoint:
    return DetectionPoint(float(point[0]), float(point[1]))


def _projected_card_coordinates(
    points_xy: np.ndarray,
    geometry: _ComponentGeometry,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    centered = points_xy - geometry.center
    projected_u = centered @ geometry.u_axis
    projected_v = centered @ geometry.v_axis
    normalized_u = (projected_u - geometry.min_u) / (geometry.max_u - geometry.min_u)
    normalized_v = (projected_v - geometry.min_v) / (geometry.max_v - geometry.min_v)
    return normalized_u, normalized_v, projected_u, projected_v


def _edge_extreme_points(
    component_points_xy: np.ndarray,
    geometry: _ComponentGeometry,
    side: str,
) -> np.ndarray | None:
    normalized_u, normalized_v, projected_u, projected_v = _projected_card_coordinates(
        component_points_xy,
        geometry,
    )
    edge_points: list[np.ndarray] = []
    bin_width = (_EDGE_BIN_END - _EDGE_BIN_START) / _EDGE_BIN_COUNT

    if side in ("top", "bottom"):
        bin_coordinate = normalized_u
        extreme_coordinate = projected_v
        choose_low_extreme = side == "top"
        valid = (
            (normalized_u >= _EDGE_BIN_START)
            & (normalized_u <= _EDGE_BIN_END)
            & (normalized_v >= -0.05)
            & (normalized_v <= 1.05)
        )
    else:
        bin_coordinate = normalized_v
        extreme_coordinate = projected_u
        choose_low_extreme = side == "left"
        valid = (
            (normalized_v >= _EDGE_BIN_START)
            & (normalized_v <= _EDGE_BIN_END)
            & (normalized_u >= -0.05)
            & (normalized_u <= 1.05)
        )

    for bin_index in range(_EDGE_BIN_COUNT):
        low = _EDGE_BIN_START + bin_width * bin_index
        high = low + bin_width
        mask = valid & (bin_coordinate >= low) & (bin_coordinate < high)
        indexes = np.where(mask)[0]
        if len(indexes) == 0:
            continue

        values = extreme_coordinate[indexes]
        order = np.argsort(values)
        if not choose_low_extreme:
            order = order[::-1]
        selected = indexes[order[:_EDGE_EXTREME_POINTS_PER_BIN]]
        edge_points.append(np.median(component_points_xy[selected], axis=0))

    if len(edge_points) < _MIN_EDGE_POINTS:
        return None
    return np.array(edge_points, dtype=np.float64)


def _fit_line(points_xy: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    if len(points_xy) < 2:
        return None

    center = np.mean(points_xy, axis=0)
    centered = points_xy - center
    covariance = centered.T @ centered / len(points_xy)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    direction = eigenvectors[:, int(np.argmax(eigenvalues))]
    norm = np.linalg.norm(direction)
    if norm < 1e-8:
        return None
    return center, direction / norm


def _intersect_lines(
    first: tuple[np.ndarray, np.ndarray],
    second: tuple[np.ndarray, np.ndarray],
) -> np.ndarray | None:
    first_point, first_direction = first
    second_point, second_direction = second
    matrix = np.array(
        [
            [first_direction[0], -second_direction[0]],
            [first_direction[1], -second_direction[1]],
        ],
        dtype=np.float64,
    )
    if abs(np.linalg.det(matrix)) < 1e-8:
        return None

    distance = second_point - first_point
    first_scale, _ = np.linalg.solve(matrix, distance)
    return first_point + first_direction * first_scale


def _detect_card_corners(
    component_points_xy: np.ndarray,
    geometry: _ComponentGeometry,
) -> list[DetectionPoint] | None:
    lines: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for side in ("top", "right", "bottom", "left"):
        edge_points = _edge_extreme_points(component_points_xy, geometry, side)
        if edge_points is None:
            return None
        line = _fit_line(edge_points)
        if line is None:
            return None
        lines[side] = line

    intersections = [
        _intersect_lines(lines["top"], lines["left"]),
        _intersect_lines(lines["top"], lines["right"]),
        _intersect_lines(lines["bottom"], lines["right"]),
        _intersect_lines(lines["bottom"], lines["left"]),
    ]
    if any(point is None for point in intersections):
        return None

    return [_point_to_detection(point) for point in intersections if point is not None]


def _cross(
    origin: tuple[float, float],
    first: tuple[float, float],
    second: tuple[float, float],
) -> float:
    return (first[0] - origin[0]) * (second[1] - origin[1]) - (
        first[1] - origin[1]
    ) * (second[0] - origin[0])


def _convex_hull_polygon(points_xy: np.ndarray) -> list[DetectionPoint]:
    unique_points = sorted(
        {
            (float(point[0]), float(point[1]))
            for point in points_xy
        }
    )
    if len(unique_points) <= 1:
        return [DetectionPoint(x, y) for x, y in unique_points]

    lower: list[tuple[float, float]] = []
    for point in unique_points:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper: list[tuple[float, float]] = []
    for point in reversed(unique_points):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    hull = lower[:-1] + upper[:-1]
    return [DetectionPoint(x, y) for x, y in hull]


def _scale_points(points: list[DetectionPoint], scale: float) -> list[DetectionPoint]:
    if scale == 1.0:
        return points

    return [DetectionPoint(point.x / scale, point.y / scale) for point in points]


def _homography_from_correspondences(
    source_points: list[tuple[float, float]],
    target_points: list[DetectionPoint],
) -> np.ndarray | None:
    if len(source_points) != len(target_points) or len(source_points) < 4:
        return None

    rows: list[list[float]] = []
    for (u, v), target in zip(source_points, target_points):
        x = target.x
        y = target.y
        rows.append([u, v, 1.0, 0.0, 0.0, 0.0, -x * u, -x * v, -x])
        rows.append([0.0, 0.0, 0.0, u, v, 1.0, -y * u, -y * v, -y])

    _, _, vh = np.linalg.svd(np.array(rows, dtype=np.float64))
    homography = vh[-1].reshape(3, 3)
    if abs(homography[2, 2]) < 1e-8:
        return None

    return homography / homography[2, 2]


def _project_point(homography: np.ndarray, point: tuple[float, float]) -> np.ndarray:
    projected = homography @ np.array([point[0], point[1], 1.0], dtype=np.float64)
    if abs(projected[2]) < 1e-8:
        return projected[:2]
    return projected[:2] / projected[2]


def _points_to_card_coordinates(homography: np.ndarray, points_xy: np.ndarray) -> np.ndarray:
    try:
        inverse = np.linalg.inv(homography)
    except np.linalg.LinAlgError:
        return np.empty((0, 2), dtype=np.float64)

    homogeneous_points = np.column_stack(
        [points_xy[:, 0], points_xy[:, 1], np.ones(len(points_xy), dtype=np.float64)]
    )
    projected = homogeneous_points @ inverse.T
    valid = np.abs(projected[:, 2]) > 1e-8
    if not np.any(valid):
        return np.empty((0, 2), dtype=np.float64)

    coordinates = projected[valid, :2] / projected[valid, 2:3]
    finite = np.isfinite(coordinates).all(axis=1)
    return coordinates[finite]


def _card_corner_homography(card_corners: list[DetectionPoint]) -> np.ndarray | None:
    if len(card_corners) != 4:
        return None

    return _homography_from_correspondences(
        [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
        card_corners,
    )


def _projected_card_polygon(homography: np.ndarray) -> list[DetectionPoint]:
    return [
        _point_to_detection(_project_point(homography, point))
        for point in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    ]


def _polygon_area(polygon: list[DetectionPoint]) -> float:
    if len(polygon) < 3:
        return 0.0

    total = 0.0
    for index, point in enumerate(polygon):
        next_point = polygon[(index + 1) % len(polygon)]
        total += point.x * next_point.y - next_point.x * point.y
    return abs(total) * 0.5


def _projective_geometry_is_reasonable(
    projective_polygon: list[DetectionPoint],
    geometry_polygon: list[DetectionPoint],
) -> bool:
    geometry_area = _polygon_area(geometry_polygon)
    projective_area = _polygon_area(projective_polygon)
    if geometry_area <= 1e-6 or projective_area <= 1e-6:
        return False

    area_ratio = projective_area / geometry_area
    return 0.8 <= area_ratio <= 1.2


def _center_alignment_is_reasonable(
    homography: np.ndarray,
    center: DetectionPoint | None,
    card_polygon: list[DetectionPoint],
) -> bool:
    if center is None:
        return True

    projected_center = _project_point(homography, (0.5, 0.5))
    center_point = np.array([center.x, center.y], dtype=np.float64)
    distance = float(np.linalg.norm(projected_center - center_point))
    side_lengths = [
        float(
            np.linalg.norm(
                np.array([card_polygon[(index + 1) % 4].x, card_polygon[(index + 1) % 4].y])
                - np.array([card_polygon[index].x, card_polygon[index].y])
            )
        )
        for index in range(4)
    ]
    threshold = max(12.0, float(np.median(side_lengths)) * 0.15)
    return distance <= threshold


def _geometry_polygon(geometry: _ComponentGeometry) -> list[DetectionPoint]:
    corners = [
        geometry.center + geometry.u_axis * geometry.min_u + geometry.v_axis * geometry.min_v,
        geometry.center + geometry.u_axis * geometry.max_u + geometry.v_axis * geometry.min_v,
        geometry.center + geometry.u_axis * geometry.max_u + geometry.v_axis * geometry.max_v,
        geometry.center + geometry.u_axis * geometry.min_u + geometry.v_axis * geometry.max_v,
    ]
    return [_point_to_detection(corner) for corner in corners]


def _fit_grid_axis(
    values: list[float],
    count: int,
    step_range: tuple[float, float],
) -> list[float] | None:
    if len(values) < count:
        return None

    axis_values = np.array(values, dtype=np.float64)
    step_candidates: list[float] = []
    min_step, max_step = step_range

    for left_index in range(len(axis_values)):
        for right_index in range(left_index + 1, len(axis_values)):
            distance = abs(axis_values[right_index] - axis_values[left_index])
            for gap in range(1, count):
                step = distance / gap
                if min_step <= step <= max_step:
                    step_candidates.append(float(step))

    if step_candidates:
        quantiles = np.quantile(step_candidates, np.linspace(0, 1, 21)).tolist()
        step_candidates = sorted(set(step_candidates + [float(value) for value in quantiles]))
    else:
        step_candidates = np.linspace(min_step, max_step, 25).tolist()

    best: tuple[tuple[int, float, float], float, float, np.ndarray, np.ndarray, np.ndarray] | None = None
    for step in step_candidates:
        offsets = [
            float(value - step * index)
            for value in axis_values
            for index in range(count)
        ]
        for offset in offsets:
            centers = offset + step * np.arange(count, dtype=np.float64)
            labels = np.argmin(np.abs(axis_values[:, None] - centers[None, :]), axis=1)
            residuals = np.abs(axis_values - centers[labels])
            accepted = residuals < step * 0.32
            if not np.any(accepted):
                continue

            assigned_count = len(set(labels[accepted].tolist()))
            score = (
                -assigned_count,
                float(np.mean(residuals[accepted] ** 2)),
                abs(float((centers[0] + centers[-1]) * 0.5 - 0.5)),
            )
            if best is None or score < best[0]:
                best = (score, step, offset, labels, residuals, accepted)

    if best is None:
        return None

    _, step, offset, labels, _, accepted = best
    centers = offset + step * np.arange(count, dtype=np.float64)
    assigned = np.zeros(count, dtype=bool)
    for index in range(count):
        index_values = axis_values[accepted & (labels == index)]
        if len(index_values) > 0:
            centers[index] = float(np.median(index_values))
            assigned[index] = True

    if int(np.sum(assigned)) >= 2:
        assigned_indexes = np.where(assigned)[0]
        slope, intercept = np.polyfit(assigned_indexes, centers[assigned], 1)
        fitted = slope * np.arange(count, dtype=np.float64) + intercept
        centers[~assigned] = fitted[~assigned]

    centers = np.sort(centers)
    if np.any(np.diff(centers) <= 0):
        return None
    if centers[0] < -0.05 or centers[-1] > 1.05:
        return None

    return centers.astype(float).tolist()


def _fit_grid_axis_absolute(
    values: np.ndarray,
    count: int,
    step_range: tuple[float, float],
) -> list[float] | None:
    if len(values) < count:
        return None

    axis_values = np.array(values, dtype=np.float64)
    step_candidates: list[float] = []
    min_step, max_step = step_range

    for left_index in range(len(axis_values)):
        for right_index in range(left_index + 1, len(axis_values)):
            distance = abs(axis_values[right_index] - axis_values[left_index])
            for gap in range(1, count):
                step = distance / gap
                if min_step <= step <= max_step:
                    step_candidates.append(float(step))

    if step_candidates:
        quantiles = np.quantile(step_candidates, np.linspace(0, 1, 21)).tolist()
        step_candidates = sorted(set(step_candidates + [float(value) for value in quantiles]))
    else:
        step_candidates = np.linspace(min_step, max_step, 25).tolist()

    best: tuple[tuple[int, float, float], float, float, np.ndarray, np.ndarray] | None = None
    for step in step_candidates:
        offsets = [
            float(value - step * index)
            for value in axis_values
            for index in range(count)
        ]
        for offset in offsets:
            centers = offset + step * np.arange(count, dtype=np.float64)
            labels = np.argmin(np.abs(axis_values[:, None] - centers[None, :]), axis=1)
            residuals = np.abs(axis_values - centers[labels])
            accepted = residuals < step * 0.32
            if not np.any(accepted):
                continue

            assigned_count = len(set(labels[accepted].tolist()))
            center_distance = abs(float((centers[0] + centers[-1]) * 0.5 - np.median(axis_values)))
            score = (
                -assigned_count,
                float(np.mean(residuals[accepted] ** 2)),
                center_distance,
            )
            if best is None or score < best[0]:
                best = (score, step, offset, labels, accepted)

    if best is None:
        return None

    _, step, offset, labels, accepted = best
    centers = offset + step * np.arange(count, dtype=np.float64)
    assigned = np.zeros(count, dtype=bool)
    for index in range(count):
        index_values = axis_values[accepted & (labels == index)]
        if len(index_values) > 0:
            centers[index] = float(np.median(index_values))
            assigned[index] = True

    if int(np.sum(assigned)) >= 2:
        assigned_indexes = np.where(assigned)[0]
        slope, intercept = np.polyfit(assigned_indexes, centers[assigned], 1)
        fitted = slope * np.arange(count, dtype=np.float64) + intercept
        centers[~assigned] = fitted[~assigned]

    centers = np.sort(centers)
    if np.any(np.diff(centers) <= 0):
        return None

    return centers.astype(float).tolist()


def _cluster_axis_values(
    values: np.ndarray,
    cluster_gap: float,
) -> tuple[np.ndarray, np.ndarray]:
    if len(values) == 0:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64)

    sorted_values = np.sort(np.array(values, dtype=np.float64))
    groups: list[list[float]] = [[float(sorted_values[0])]]
    for value in sorted_values[1:]:
        if abs(float(value) - groups[-1][-1]) > cluster_gap:
            groups.append([float(value)])
        else:
            groups[-1].append(float(value))

    centers = np.array([float(np.median(group)) for group in groups], dtype=np.float64)
    weights = np.array([float(len(group)) for group in groups], dtype=np.float64)
    return centers, weights


def _fit_grid_axis_clustered(
    values: np.ndarray,
    count: int,
    step_range: tuple[float, float],
    cluster_gap: float,
) -> list[float] | None:
    """Fit an evenly spaced grid axis while tolerating one missing edge line.

    Real face photos often expose only three ColorChecker columns as saturated
    patch components because the neutral edge column blends into the card/body.
    The regular absolute fitter then treats a near-duplicate component as the
    missing column and warps the card. This fitter clusters observed patch
    centers first, rejects non-uniform adjacent gaps, and extrapolates a missing
    edge line when the remaining centers are evenly spaced.
    """
    clustered_centers, clustered_weights = _cluster_axis_values(values, cluster_gap)
    if len(clustered_centers) < 2:
        return None

    if len(clustered_centers) > 12:
        keep_indexes = np.argsort(clustered_weights)[-12:]
        keep_indexes = np.sort(keep_indexes)
        clustered_centers = clustered_centers[keep_indexes]
        clustered_weights = clustered_weights[keep_indexes]

    min_assignments = max(3, count - 2)
    if len(clustered_centers) < min_assignments:
        return None

    min_step, max_step = step_range
    best: tuple[tuple[float, float, int, int], np.ndarray] | None = None
    max_subset_size = min(count, len(clustered_centers))

    for subset_size in range(max_subset_size, min_assignments - 1, -1):
        for cluster_indexes in combinations(range(len(clustered_centers)), subset_size):
            observed = clustered_centers[list(cluster_indexes)]
            weights = clustered_weights[list(cluster_indexes)]
            if len(observed) < 2:
                continue

            for axis_indexes in combinations(range(count), subset_size):
                x = np.array(axis_indexes, dtype=np.float64)
                coefficients = np.polyfit(x, observed, 1, w=np.sqrt(weights))
                step = float(coefficients[0])
                intercept = float(coefficients[1])
                if step <= 0:
                    continue
                if not (min_step * 0.75 <= step <= max_step * 1.35):
                    continue

                observed_diffs = np.diff(observed)
                if len(observed_diffs) > 0 and (
                    np.min(observed_diffs) < step * 0.65
                    or np.max(observed_diffs) > step * 1.45
                ):
                    continue

                centers = intercept + step * np.arange(count, dtype=np.float64)
                if np.any(np.diff(centers) <= 0):
                    continue

                predicted = intercept + step * x
                residual = float(np.average((observed - predicted) ** 2, weights=weights))
                normalized_residual = residual / max(step * step, 1e-6)
                missing = set(range(count)) - set(axis_indexes)
                edge_missing = int(0 in missing) + int((count - 1) in missing)
                interior_missing = len(missing) - edge_missing
                score = (
                    normalized_residual + interior_missing * 12.0 + edge_missing * 1.5,
                    -float(np.sum(weights)),
                    interior_missing,
                    edge_missing,
                )
                if best is None or score < best[0]:
                    best = (score, centers)

    if best is None:
        return None

    return best[1].astype(float).tolist()


def _detect_patch_grid_candidates(image_rgb: np.ndarray) -> list[_PatchGridCandidate]:
    rgb = image_rgb.astype(np.float64)
    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    spread = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    candidate_mask = (spread > 40) & (luma > 30) & (luma < 245)
    candidate_mask = _binary_dilation(_binary_erosion(candidate_mask, iterations=1), iterations=1)
    min_area = max(12, int(image_rgb.shape[0] * image_rgb.shape[1] * 0.00003))
    components = _connected_components_with_min_area(candidate_mask, min_area)

    candidates: list[_PatchGridCandidate] = []
    max_component_side = max(28, min(image_rgb.shape[:2]) * 0.16)
    for component in components:
        xs = component[:, 0]
        ys = component[:, 1]
        width = float(np.max(xs) - np.min(xs) + 1)
        height = float(np.max(ys) - np.min(ys) + 1)
        min_side = min(width, height)
        max_side = max(width, height)
        fill_ratio = len(component) / max(width * height, 1.0)

        if not (6 <= min_side <= max_component_side):
            continue
        if not (8 <= max_side <= max_component_side * 1.35):
            continue
        if fill_ratio < 0.45:
            continue
        if max_side / max(min_side, 1.0) > 3.0:
            continue

        candidates.append(
            _PatchGridCandidate(
                center=np.array([float(np.mean(xs)), float(np.mean(ys))], dtype=np.float64),
                width=width,
                height=height,
                area=len(component),
                fill_ratio=float(fill_ratio),
            )
        )

    candidates.sort(key=lambda candidate: candidate.area, reverse=True)
    return candidates[:_MAX_PATCH_GRID_CANDIDATES]


def _fit_patch_grid_from_candidates(
    candidates: list[_PatchGridCandidate],
) -> _PatchGridFit | None:
    if len(candidates) < _MIN_PATCH_GRID_PAIRS:
        return None

    centers = np.array([candidate.center for candidate in candidates], dtype=np.float64)
    patch_sides = np.array(
        [min(candidate.width, candidate.height) for candidate in candidates],
        dtype=np.float64,
    )
    median_patch_side = float(np.median(patch_sides))
    if median_patch_side <= 0:
        return None

    step_range = (max(5.0, median_patch_side * 0.75), median_patch_side * 2.7)
    cluster_gap = max(3.0, median_patch_side * 0.45)
    best_fit: _PatchGridFit | None = None
    best_score: tuple[int, float] | None = None
    seen_neighborhoods: set[tuple[int, ...]] = set()

    for seed in centers:
        distances = np.linalg.norm(centers - seed, axis=1)
        neighborhood_indexes = tuple(np.where(distances < median_patch_side * 8.0)[0].tolist())
        if len(neighborhood_indexes) < _MIN_PATCH_GRID_PAIRS:
            continue
        if neighborhood_indexes in seen_neighborhoods:
            continue
        seen_neighborhoods.add(neighborhood_indexes)

        neighborhood = centers[list(neighborhood_indexes)]

        center = np.mean(neighborhood, axis=0)
        centered = neighborhood - center
        covariance = centered.T @ centered / len(neighborhood)
        eigenvalues, eigenvectors = np.linalg.eigh(covariance)
        order = np.argsort(eigenvalues)[::-1]
        axes = [eigenvectors[:, order[0]], eigenvectors[:, order[1]]]

        for swap_axes in (False, True):
            u_axis = axes[1] if swap_axes else axes[0]
            v_axis = axes[0] if swap_axes else axes[1]
            projected_u = centers @ u_axis
            projected_v = centers @ v_axis
            u_centers = _fit_grid_axis_clustered(
                projected_u,
                6,
                step_range,
                cluster_gap,
            )
            v_centers = _fit_grid_axis_clustered(
                projected_v,
                4,
                step_range,
                cluster_gap,
            )
            if u_centers is None or v_centers is None:
                continue

            u_array = np.array(u_centers, dtype=np.float64)
            v_array = np.array(v_centers, dtype=np.float64)
            u_labels = np.argmin(np.abs(projected_u[:, None] - u_array[None, :]), axis=1)
            v_labels = np.argmin(np.abs(projected_v[:, None] - v_array[None, :]), axis=1)
            u_residuals = np.abs(projected_u - u_array[u_labels])
            v_residuals = np.abs(projected_v - v_array[v_labels])
            u_step = float(np.median(np.diff(u_array)))
            v_step = float(np.median(np.diff(v_array)))
            accepted = (u_residuals < u_step * 0.35) & (v_residuals < v_step * 0.35)
            pairs = set(zip(u_labels[accepted].tolist(), v_labels[accepted].tolist()))
            pair_count = len(pairs)
            if pair_count < _MIN_PATCH_GRID_PAIRS:
                continue

            residual_mean = float(np.mean(u_residuals[accepted] ** 2 + v_residuals[accepted] ** 2))
            score = (pair_count, -residual_mean)
            if best_score is None or score > best_score:
                best_score = score
                best_fit = _PatchGridFit(
                    u_axis=u_axis,
                    v_axis=v_axis,
                    u_centers=u_centers,
                    v_centers=v_centers,
                    pair_count=pair_count,
                    residual_mean=residual_mean,
                )

    return best_fit


def _card_corners_from_patch_grid_fit(fit: _PatchGridFit) -> list[DetectionPoint] | None:
    canonical_u_centers = np.array(
        [
            _GRID_U_START + (_GRID_U_END - _GRID_U_START) / 6 * (index + 0.5)
            for index in range(6)
        ],
        dtype=np.float64,
    )
    canonical_v_centers = np.array(
        [
            _GRID_V_START + (_GRID_V_END - _GRID_V_START) / 4 * (index + 0.5)
            for index in range(4)
        ],
        dtype=np.float64,
    )

    u_slope, u_intercept = np.polyfit(
        canonical_u_centers,
        np.array(fit.u_centers, dtype=np.float64),
        1,
    )
    v_slope, v_intercept = np.polyfit(
        canonical_v_centers,
        np.array(fit.v_centers, dtype=np.float64),
        1,
    )

    corners: list[DetectionPoint] = []
    for u_fraction, v_fraction in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]:
        point = (
            fit.u_axis * (u_slope * u_fraction + u_intercept)
            + fit.v_axis * (v_slope * v_fraction + v_intercept)
        )
        if not np.all(np.isfinite(point)):
            return None
        corners.append(_point_to_detection(point))

    return corners


def _shift_patch_grid_fit(
    fit: _PatchGridFit,
    *,
    u_steps: int,
    v_steps: int,
) -> _PatchGridFit:
    u_step = float(np.median(np.diff(np.array(fit.u_centers, dtype=np.float64))))
    v_step = float(np.median(np.diff(np.array(fit.v_centers, dtype=np.float64))))
    return _PatchGridFit(
        u_axis=fit.u_axis,
        v_axis=fit.v_axis,
        u_centers=[float(value + u_steps * u_step) for value in fit.u_centers],
        v_centers=[float(value + v_steps * v_step) for value in fit.v_centers],
        pair_count=fit.pair_count,
        residual_mean=fit.residual_mean,
    )


def _detect_color_checker_from_patch_grid(
    image_rgb: np.ndarray,
    scale: float,
) -> ColorCheckerDetection | None:
    working_rgb, _ = _resize_for_detection(image_rgb)
    candidates = _detect_patch_grid_candidates(working_rgb)
    fit = _fit_patch_grid_from_candidates(candidates)
    if fit is None:
        return None

    best_detection: ColorCheckerDetection | None = None
    for u_steps in range(-2, 3):
        for v_steps in range(-1, 2):
            shifted_fit = _shift_patch_grid_fit(fit, u_steps=u_steps, v_steps=v_steps)
            working_corners = _card_corners_from_patch_grid_fit(shifted_fit)
            if working_corners is None:
                continue

            original_corners = _scale_points(working_corners, scale)
            homography = _card_corner_homography(original_corners)
            if homography is None:
                continue

            measured_grid, centers, patch_polygons = _sample_checker_grid_projective(
                image_rgb,
                homography,
            )
            score, flip_rows, flip_cols, oriented_samples = _best_orientation(measured_grid)
            if score > _MAX_ACCEPTED_SCORE:
                continue

            center = _point_to_detection(_project_point(homography, (0.5, 0.5)))
            detection = _build_detection(
                image_rgb,
                original_corners,
                score,
                flip_rows,
                flip_cols,
                oriented_samples,
                centers,
                patch_polygons,
                ColorCheckerFiducials(center=center, corners=original_corners),
            )
            if best_detection is None or detection.score < best_detection.score:
                best_detection = detection

    return best_detection


def _detect_patch_grid_model(
    image_rgb: np.ndarray,
    component_points_xy: np.ndarray,
    homography: np.ndarray,
) -> _PatchGridModel | None:
    interior_mask = _card_interior_mask(component_points_xy, image_rgb.shape[:2])
    rgb = image_rgb.astype(np.float64)
    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    spread = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    candidate_mask = interior_mask & (luma > 42) & ((spread > 14) | (luma > 82))
    candidate_mask = _binary_dilation(_binary_erosion(candidate_mask, iterations=1), iterations=1)

    min_area = max(8, int(np.sum(interior_mask) * 0.00025))
    components = _connected_components_with_min_area(candidate_mask, min_area)
    patch_candidates: list[tuple[float, float, float, float]] = []

    for component in components:
        local_points = _points_to_card_coordinates(homography, component)
        if len(local_points) == 0:
            continue

        u_values = local_points[:, 0]
        v_values = local_points[:, 1]
        center_u = float(np.median(u_values))
        center_v = float(np.median(v_values))
        width = float(np.quantile(u_values, 0.9) - np.quantile(u_values, 0.1))
        height = float(np.quantile(v_values, 0.9) - np.quantile(v_values, 0.1))
        aspect = width / max(height, 1e-6)

        if not (0.06 <= center_u <= 0.94 and 0.08 <= center_v <= 0.92):
            continue
        if not (0.025 <= width <= 0.16 and 0.025 <= height <= 0.22):
            continue
        if not (0.28 <= aspect <= 2.4):
            continue

        patch_candidates.append((center_u, center_v, width, height))

    if len(patch_candidates) < _MIN_PATCH_COMPONENTS:
        return None

    u_centers = _fit_grid_axis(
        [candidate[0] for candidate in patch_candidates],
        6,
        _PATCH_U_STEP_RANGE,
    )
    v_centers = _fit_grid_axis(
        [candidate[1] for candidate in patch_candidates],
        4,
        _PATCH_V_STEP_RANGE,
    )
    if u_centers is None or v_centers is None:
        return None

    u_step = float(np.median(np.diff(u_centers)))
    v_step = float(np.median(np.diff(v_centers)))
    median_width = float(np.median([candidate[2] for candidate in patch_candidates]))
    median_height = float(np.median([candidate[3] for candidate in patch_candidates]))
    half_u = float(np.clip(median_width * 0.45, u_step * 0.22, u_step * 0.34))
    half_v = float(np.clip(median_height * 0.45, v_step * 0.22, v_step * 0.34))

    return _PatchGridModel(
        u_centers=[float(value) for value in u_centers],
        v_centers=[float(value) for value in v_centers],
        half_u=half_u,
        half_v=half_v,
    )


def _sample_patch_rgb(
    image_rgb: np.ndarray,
    center: np.ndarray,
    radius: int,
) -> list[float]:
    height, width = image_rgb.shape[:2]
    center_x, center_y = int(round(center[0])), int(round(center[1]))
    x0 = max(0, center_x - radius)
    x1 = min(width, center_x + radius + 1)
    y0 = max(0, center_y - radius)
    y1 = min(height, center_y + radius + 1)

    if x0 >= x1 or y0 >= y1:
        return [0.0, 0.0, 0.0]

    sample = image_rgb[y0:y1, x0:x1].reshape(-1, 3).astype(np.float64)
    return np.mean(sample, axis=0).tolist()


def _sample_checker_grid(
    image_rgb: np.ndarray,
    geometry: _ComponentGeometry,
) -> tuple[np.ndarray, list[np.ndarray], list[list[DetectionPoint]]]:
    grid_width = (geometry.max_u - geometry.min_u) * (_GRID_U_END - _GRID_U_START)
    grid_height = (geometry.max_v - geometry.min_v) * (_GRID_V_END - _GRID_V_START)
    cell_size = min(grid_width / 6, grid_height / 4)
    sample_radius = max(3, int(round(cell_size * 0.22)))
    half_u = (grid_width / 6) * 0.32
    half_v = (grid_height / 4) * 0.32

    measured: list[list[float]] = []
    centers: list[np.ndarray] = []
    patch_polygons: list[list[DetectionPoint]] = []

    for row in range(4):
        v_fraction = _GRID_V_START + (_GRID_V_END - _GRID_V_START) * ((row + 0.5) / 4)
        for col in range(6):
            u_fraction = _GRID_U_START + (_GRID_U_END - _GRID_U_START) * ((col + 0.5) / 6)
            center = _local_point(geometry, u_fraction, v_fraction)
            centers.append(center)
            measured.append(_sample_patch_rgb(image_rgb, center, sample_radius))

            u_center = geometry.min_u + u_fraction * (geometry.max_u - geometry.min_u)
            v_center = geometry.min_v + v_fraction * (geometry.max_v - geometry.min_v)
            corners = [
                geometry.center
                + geometry.u_axis * (u_center - half_u)
                + geometry.v_axis * (v_center - half_v),
                geometry.center
                + geometry.u_axis * (u_center + half_u)
                + geometry.v_axis * (v_center - half_v),
                geometry.center
                + geometry.u_axis * (u_center + half_u)
                + geometry.v_axis * (v_center + half_v),
                geometry.center
                + geometry.u_axis * (u_center - half_u)
                + geometry.v_axis * (v_center + half_v),
            ]
            patch_polygons.append([_point_to_detection(corner) for corner in corners])

    return np.array(measured, dtype=np.float64), centers, patch_polygons


def _sample_checker_grid_projective(
    image_rgb: np.ndarray,
    homography: np.ndarray,
    grid_model: _PatchGridModel | None = None,
) -> tuple[np.ndarray, list[np.ndarray], list[list[DetectionPoint]]]:
    if grid_model is None:
        grid_width = _GRID_U_END - _GRID_U_START
        grid_height = _GRID_V_END - _GRID_V_START
        cell_u = grid_width / 6
        cell_v = grid_height / 4
        u_centers = [_GRID_U_START + cell_u * (col + 0.5) for col in range(6)]
        v_centers = [_GRID_V_START + cell_v * (row + 0.5) for row in range(4)]
        half_u = cell_u * 0.32
        half_v = cell_v * 0.32
    else:
        u_centers = grid_model.u_centers
        v_centers = grid_model.v_centers
        half_u = grid_model.half_u
        half_v = grid_model.half_v

    projected_centers: list[np.ndarray] = []
    for v_fraction in v_centers:
        for u_fraction in u_centers:
            projected_centers.append(_project_point(homography, (u_fraction, v_fraction)))

    adjacent_distances: list[float] = []
    for row in range(4):
        for col in range(5):
            adjacent_distances.append(
                float(
                    np.linalg.norm(
                        projected_centers[row * 6 + col + 1]
                        - projected_centers[row * 6 + col]
                    )
                )
            )
    for row in range(3):
        for col in range(6):
            adjacent_distances.append(
                float(
                    np.linalg.norm(
                        projected_centers[(row + 1) * 6 + col]
                        - projected_centers[row * 6 + col]
                    )
                )
            )
    sample_radius = max(3, int(round(np.median(adjacent_distances) * 0.22)))

    measured: list[list[float]] = []
    patch_polygons: list[list[DetectionPoint]] = []

    for v_fraction in v_centers:
        for u_fraction in u_centers:
            center = _project_point(homography, (u_fraction, v_fraction))
            measured.append(_sample_patch_rgb(image_rgb, center, sample_radius))

            corners = [
                (u_fraction - half_u, v_fraction - half_v),
                (u_fraction + half_u, v_fraction - half_v),
                (u_fraction + half_u, v_fraction + half_v),
                (u_fraction - half_u, v_fraction + half_v),
            ]
            patch_polygons.append(
                [_point_to_detection(_project_point(homography, corner)) for corner in corners]
            )

    return np.array(measured, dtype=np.float64), projected_centers, patch_polygons


def _oriented_samples(
    measured_grid: np.ndarray,
    *,
    flip_rows: bool,
    flip_cols: bool,
) -> np.ndarray:
    oriented: list[np.ndarray] = []

    for row in range(4):
        for col in range(6):
            measured_row = 3 - row if flip_rows else row
            measured_col = 5 - col if flip_cols else col
            oriented.append(measured_grid[measured_row * 6 + measured_col])

    return np.array(oriented, dtype=np.float64)


def _orientation_score(measured_reference_order: np.ndarray) -> float:
    measured = np.clip(measured_reference_order / 255.0, 0, 1)
    reference = np.clip(_REFERENCE_RGB / 255.0, 0, 1)
    measured_with_bias = np.concatenate(
        [measured, np.ones((len(measured), 1), dtype=np.float64)],
        axis=1,
    )
    coefficients, _, _, _ = np.linalg.lstsq(measured_with_bias, reference, rcond=None)
    predicted = np.clip(measured_with_bias @ coefficients, 0, 1)
    residual = np.sqrt(np.sum((predicted - reference) ** 2, axis=1))
    return float(np.mean(residual) * 255.0)


def _best_orientation(measured_grid: np.ndarray) -> tuple[float, bool, bool, np.ndarray]:
    best_score = float("inf")
    best_flip_rows = False
    best_flip_cols = False
    best_samples = measured_grid

    for flip_rows in (False, True):
        for flip_cols in (False, True):
            oriented = _oriented_samples(
                measured_grid,
                flip_rows=flip_rows,
                flip_cols=flip_cols,
            )
            score = _orientation_score(oriented)
            if score < best_score:
                best_score = score
                best_flip_rows = flip_rows
                best_flip_cols = flip_cols
                best_samples = oriented

    return best_score, best_flip_rows, best_flip_cols, best_samples


def _local_index_for_reference(
    patch_index: int,
    *,
    flip_rows: bool,
    flip_cols: bool,
) -> int:
    row = patch_index // 6
    col = patch_index % 6
    measured_row = 3 - row if flip_rows else row
    measured_col = 5 - col if flip_cols else col
    return measured_row * 6 + measured_col


def _build_detection(
    image_rgb: np.ndarray,
    card_polygon: list[DetectionPoint],
    score: float,
    flip_rows: bool,
    flip_cols: bool,
    oriented_samples: np.ndarray,
    centers: list[np.ndarray],
    patch_polygons: list[list[DetectionPoint]],
    fiducials: ColorCheckerFiducials,
) -> ColorCheckerDetection:
    patches: list[DetectedCheckerPatch] = []
    checker_patches: list[ColorCheckerPatch] = []

    for patch_index, measured_rgb in enumerate(oriented_samples):
        local_index = _local_index_for_reference(
            patch_index,
            flip_rows=flip_rows,
            flip_cols=flip_cols,
        )
        patches.append(
            DetectedCheckerPatch(
                patch_index=patch_index,
                measured_rgb=measured_rgb.tolist(),
                center=_point_to_detection(centers[local_index]),
                polygon=patch_polygons[local_index],
            )
        )
        checker_patches.append(
            ColorCheckerPatch(
                reference_lab=COLORCHECKER_REFERENCE_LAB[patch_index],
                measured_rgb=measured_rgb.tolist(),
            )
        )

    confidence = float(np.clip(1.0 - (score / _MAX_ACCEPTED_SCORE) * 0.75, 0.0, 1.0))
    return ColorCheckerDetection(
        score=score,
        confidence=confidence,
        polygon=card_polygon,
        patches=patches,
        checker_patches=checker_patches,
        flip_rows=flip_rows,
        flip_cols=flip_cols,
        fiducials=fiducials,
    )


def detect_color_checker(image_rgb: np.ndarray) -> ColorCheckerDetection | None:
    """Detect a ColorChecker Classic card and return measured reference patches."""
    working_rgb, scale = _resize_for_detection(image_rgb)
    mask = _build_dark_card_mask(working_rgb)
    components = _connected_components(mask)[:_MAX_CANDIDATES]

    best_detection: ColorCheckerDetection | None = None

    for component in components:
        geometry = _component_geometry(component)
        if geometry is None:
            continue

        detected_fiducials = _detect_fiducial_points(working_rgb, component, geometry)
        card_corners = _detect_card_corners(component, geometry)
        working_fiducials = ColorCheckerFiducials(
            center=detected_fiducials.center,
            corners=[] if card_corners is None else card_corners,
        )
        working_card_corner_homography = _card_corner_homography(working_fiducials.corners)
        original_fiducials = _scale_fiducials(working_fiducials, scale)
        card_corner_homography = _card_corner_homography(original_fiducials.corners)
        original_geometry = _scale_geometry(geometry, scale)
        geometry_polygon = _geometry_polygon(original_geometry)
        contour_polygon = _scale_points(_convex_hull_polygon(component), scale)
        projective_polygon = (
            None
            if card_corner_homography is None
            else _projected_card_polygon(card_corner_homography)
        )

        use_projective_geometry = (
            card_corner_homography is not None
            and projective_polygon is not None
            and _projective_geometry_is_reasonable(projective_polygon, geometry_polygon)
            and _center_alignment_is_reasonable(
                card_corner_homography,
                original_fiducials.center,
                projective_polygon,
            )
        )

        if use_projective_geometry:
            grid_model = (
                None
                if working_card_corner_homography is None
                else _detect_patch_grid_model(
                    working_rgb,
                    component,
                    working_card_corner_homography,
                )
            )
            measured_grid, centers, patch_polygons = _sample_checker_grid_projective(
                image_rgb,
                card_corner_homography,
                grid_model,
            )
            card_polygon = contour_polygon
            score, flip_rows, flip_cols, oriented_samples = _best_orientation(measured_grid)
            if score > _MAX_ACCEPTED_SCORE:
                use_projective_geometry = False

        if not use_projective_geometry:
            measured_grid, centers, patch_polygons = _sample_checker_grid(
                image_rgb,
                original_geometry,
            )
            card_polygon = geometry_polygon
            score, flip_rows, flip_cols, oriented_samples = _best_orientation(measured_grid)

        if score > _MAX_ACCEPTED_SCORE:
            continue

        detection = _build_detection(
            image_rgb,
            card_polygon,
            score,
            flip_rows,
            flip_cols,
            oriented_samples,
            centers,
            patch_polygons,
            original_fiducials,
        )
        if best_detection is None or detection.score < best_detection.score:
            best_detection = detection

    if best_detection is None:
        return _detect_color_checker_from_patch_grid(image_rgb, scale)

    return best_detection


def polygon_mask(
    size: tuple[int, int],
    polygon: list[DetectionPoint],
    *,
    scale: float = 1.0,
    padding: int = 0,
) -> np.ndarray:
    """Return a boolean mask for a detection polygon on a width/height canvas."""
    width, height = size
    image = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(image)
    points = [(point.x * scale, point.y * scale) for point in polygon]
    draw.polygon(points, fill=255)

    mask = np.asarray(image, dtype=np.uint8) > 0
    if padding > 0:
        mask = _binary_dilation(mask, iterations=padding)
    return mask
