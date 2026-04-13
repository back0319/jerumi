"""Lightweight color-space utilities for Vercel runtime paths.

These helpers replace the heavy `colour-science` dependency with
vectorized NumPy implementations for the specific conversions this
service needs:
- sRGB <-> XYZ (D65)
- XYZ <-> CIELAB (D65)
- CIEDE2000 Delta E
"""

from __future__ import annotations

import numpy as np

_D65_WHITE = np.array([0.95047, 1.0, 1.08883], dtype=np.float64)
_SRGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ],
    dtype=np.float64,
)
_XYZ_TO_SRGB = np.array(
    [
        [3.2404542, -1.5371385, -0.4985314],
        [-0.9692660, 1.8760108, 0.0415560],
        [0.0556434, -0.2040259, 1.0572252],
    ],
    dtype=np.float64,
)
_DELTA = 6 / 29
_DELTA_CUBED = _DELTA**3
_DELTA_LINEAR = 3 * (_DELTA**2)


def _reshape_color_array(values: np.ndarray) -> tuple[np.ndarray, tuple[int, ...]]:
    if values.shape[-1] != 3:
        raise ValueError("Expected a color array with a last dimension of 3")
    original_shape = values.shape
    return values.reshape(-1, 3), original_shape


def _restore_shape(values: np.ndarray, original_shape: tuple[int, ...]) -> np.ndarray:
    return values.reshape(original_shape)


def _srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    return np.where(
        rgb <= 0.04045,
        rgb / 12.92,
        ((rgb + 0.055) / 1.055) ** 2.4,
    )


def _linear_to_srgb(rgb: np.ndarray) -> np.ndarray:
    return np.where(
        rgb <= 0.0031308,
        12.92 * rgb,
        1.055 * np.power(np.clip(rgb, 0.0, None), 1 / 2.4) - 0.055,
    )


def srgb_to_xyz(rgb: np.ndarray) -> np.ndarray:
    """Convert gamma-encoded sRGB values in [0, 1] to XYZ (D65)."""
    rgb = np.asarray(rgb, dtype=np.float64)
    flat_rgb, original_shape = _reshape_color_array(rgb)
    linear_rgb = _srgb_to_linear(np.clip(flat_rgb, 0.0, 1.0))
    xyz = linear_rgb @ _SRGB_TO_XYZ.T
    return _restore_shape(xyz, original_shape)


def xyz_to_srgb(xyz: np.ndarray) -> np.ndarray:
    """Convert XYZ (D65) values to gamma-encoded sRGB in [0, 1]."""
    xyz = np.asarray(xyz, dtype=np.float64)
    flat_xyz, original_shape = _reshape_color_array(xyz)
    linear_rgb = flat_xyz @ _XYZ_TO_SRGB.T
    srgb = _linear_to_srgb(linear_rgb)
    return _restore_shape(srgb, original_shape)


def _f_lab(values: np.ndarray) -> np.ndarray:
    return np.where(
        values > _DELTA_CUBED,
        np.cbrt(values),
        values / _DELTA_LINEAR + 4 / 29,
    )


def _f_lab_inverse(values: np.ndarray) -> np.ndarray:
    return np.where(
        values > _DELTA,
        values**3,
        _DELTA_LINEAR * (values - 4 / 29),
    )


def xyz_to_lab(xyz: np.ndarray) -> np.ndarray:
    """Convert XYZ (D65) to CIELAB."""
    xyz = np.asarray(xyz, dtype=np.float64)
    flat_xyz, original_shape = _reshape_color_array(xyz)
    scaled = flat_xyz / _D65_WHITE
    fx, fy, fz = np.moveaxis(_f_lab(scaled), -1, 0)
    lab = np.stack(
        [
            116 * fy - 16,
            500 * (fx - fy),
            200 * (fy - fz),
        ],
        axis=-1,
    )
    return _restore_shape(lab, original_shape)


def lab_to_xyz(lab: np.ndarray) -> np.ndarray:
    """Convert CIELAB to XYZ (D65)."""
    lab = np.asarray(lab, dtype=np.float64)
    flat_lab, original_shape = _reshape_color_array(lab)
    l_star, a_star, b_star = np.moveaxis(flat_lab, -1, 0)
    fy = (l_star + 16) / 116
    fx = fy + a_star / 500
    fz = fy - b_star / 200
    xyz = np.stack(
        [
            _f_lab_inverse(fx) * _D65_WHITE[0],
            _f_lab_inverse(fy) * _D65_WHITE[1],
            _f_lab_inverse(fz) * _D65_WHITE[2],
        ],
        axis=-1,
    )
    return _restore_shape(xyz, original_shape)


def delta_e_ciede2000(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """Vectorized CIEDE2000 Delta E implementation."""
    left = np.asarray(lab1, dtype=np.float64)
    right = np.asarray(lab2, dtype=np.float64)

    if left.shape[-1] != 3 or right.shape[-1] != 3:
        raise ValueError("Expected LAB arrays with a last dimension of 3")

    left, right = np.broadcast_arrays(left, right)

    l1, a1, b1 = np.moveaxis(left, -1, 0)
    l2, a2, b2 = np.moveaxis(right, -1, 0)

    c1 = np.sqrt(a1**2 + b1**2)
    c2 = np.sqrt(a2**2 + b2**2)
    c_bar = (c1 + c2) / 2

    c_bar_pow7 = c_bar**7
    g = 0.5 * (1 - np.sqrt(c_bar_pow7 / (c_bar_pow7 + 25**7)))

    a1_prime = (1 + g) * a1
    a2_prime = (1 + g) * a2
    c1_prime = np.sqrt(a1_prime**2 + b1**2)
    c2_prime = np.sqrt(a2_prime**2 + b2**2)

    h1_prime = np.degrees(np.arctan2(b1, a1_prime)) % 360
    h2_prime = np.degrees(np.arctan2(b2, a2_prime)) % 360

    delta_l_prime = l2 - l1
    delta_c_prime = c2_prime - c1_prime

    h_diff = h2_prime - h1_prime
    zero_chroma = (c1_prime * c2_prime) == 0
    delta_h_prime = np.where(
        zero_chroma,
        0.0,
        np.where(
            np.abs(h_diff) <= 180,
            h_diff,
            np.where(h_diff > 180, h_diff - 360, h_diff + 360),
        ),
    )

    delta_h_term = 2 * np.sqrt(c1_prime * c2_prime) * np.sin(
        np.radians(delta_h_prime / 2)
    )

    l_bar_prime = (l1 + l2) / 2
    c_bar_prime = (c1_prime + c2_prime) / 2

    h_sum = h1_prime + h2_prime
    h_bar_prime = np.where(
        zero_chroma,
        h_sum,
        np.where(
            np.abs(h1_prime - h2_prime) <= 180,
            h_sum / 2,
            np.where(h_sum < 360, (h_sum + 360) / 2, (h_sum - 360) / 2),
        ),
    )

    t = (
        1
        - 0.17 * np.cos(np.radians(h_bar_prime - 30))
        + 0.24 * np.cos(np.radians(2 * h_bar_prime))
        + 0.32 * np.cos(np.radians(3 * h_bar_prime + 6))
        - 0.20 * np.cos(np.radians(4 * h_bar_prime - 63))
    )

    delta_theta = 30 * np.exp(-(((h_bar_prime - 275) / 25) ** 2))
    c_bar_prime_pow7 = c_bar_prime**7
    r_c = 2 * np.sqrt(c_bar_prime_pow7 / (c_bar_prime_pow7 + 25**7))

    s_l = 1 + (0.015 * (l_bar_prime - 50) ** 2) / np.sqrt(
        20 + (l_bar_prime - 50) ** 2
    )
    s_c = 1 + 0.045 * c_bar_prime
    s_h = 1 + 0.015 * c_bar_prime * t
    r_t = -np.sin(np.radians(2 * delta_theta)) * r_c

    delta_e = np.sqrt(
        (delta_l_prime / s_l) ** 2
        + (delta_c_prime / s_c) ** 2
        + (delta_h_term / s_h) ** 2
        + r_t * (delta_c_prime / s_c) * (delta_h_term / s_h)
    )

    return delta_e
