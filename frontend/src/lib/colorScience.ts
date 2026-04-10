/**
 * Color science utilities: sRGB ↔ CIELAB conversion, CIEDE2000 ΔE,
 * trimmed mean, and undertone classification.
 *
 * Ported from backend/app/services/color_analysis.py (Python / colour-science).
 * sRGB primaries: IEC 61966-2-1, D65 white point.
 */

import colorDiff from "color-diff";

// ---------------------------------------------------------------------------
// sRGB → XYZ (D65)
// ---------------------------------------------------------------------------

/** Linearise a single sRGB channel value (0–1). */
function linearise(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Convert sRGB (0–255 each) to CIE XYZ D65.
 * Uses the IEC 61966-2-1 matrix.
 */
function srgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rl = linearise(r / 255);
  const gl = linearise(g / 255);
  const bl = linearise(b / 255);

  // IEC 61966-2-1 / sRGB D65 matrix
  const X = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const Y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const Z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;
  return [X, Y, Z];
}

// ---------------------------------------------------------------------------
// XYZ → CIELAB (D65 reference white)
// ---------------------------------------------------------------------------

const D65 = { X: 0.95047, Y: 1.0, Z: 1.08883 };

function f(t: number): number {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta ** 2) + 4 / 29;
}

function xyzToLab(X: number, Y: number, Z: number): [number, number, number] {
  const fx = f(X / D65.X);
  const fy = f(Y / D65.Y);
  const fz = f(Z / D65.Z);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);
  return [L, a, bVal];
}

/** Convert a single sRGB pixel (0–255 each) to CIELAB. */
export function srgbPixelToLab(
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const [X, Y, Z] = srgbToXyz(r, g, b);
  return xyzToLab(X, Y, Z);
}

// ---------------------------------------------------------------------------
// XYZ → sRGB (for LAB → hex conversion)
// ---------------------------------------------------------------------------

function delinearise(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function xyzToSrgb(X: number, Y: number, Z: number): [number, number, number] {
  const rl =  3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const gl = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
  const bl =  0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;

  const r = Math.round(Math.min(1, Math.max(0, delinearise(rl))) * 255);
  const g = Math.round(Math.min(1, Math.max(0, delinearise(gl))) * 255);
  const b = Math.round(Math.min(1, Math.max(0, delinearise(bl))) * 255);
  return [r, g, b];
}

function labToXyz(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const delta = 6 / 29;
  const X = D65.X * (fx > delta ? fx ** 3 : 3 * delta ** 2 * (fx - 4 / 29));
  const Y = D65.Y * (fy > delta ? fy ** 3 : 3 * delta ** 2 * (fy - 4 / 29));
  const Z = D65.Z * (fz > delta ? fz ** 3 : 3 * delta ** 2 * (fz - 4 / 29));
  return [X, Y, Z];
}

/** Convert CIELAB to hex color string (#rrggbb). */
export function labToHex(L: number, a: number, b: number): string {
  const [X, Y, Z] = labToXyz(L, a, b);
  const [r, g, bVal] = xyzToSrgb(X, Y, Z);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bVal.toString(16).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Batch conversion: pixel list → LAB array
// ---------------------------------------------------------------------------

export interface LabPixel {
  L: number;
  a: number;
  b: number;
}

export interface ColorCheckerPatch {
  measured_rgb: [number, number, number];
  reference_lab: [number, number, number];
}

/**
 * Build a 3×3 colour correction matrix from ColorChecker patches using
 * least-squares (measured XYZ → reference XYZ).
 * Returns null when fewer than 3 patches are provided.
 */
export function buildCorrectionMatrix(
  patches: ColorCheckerPatch[]
): number[][] | null {
  if (!patches || patches.length < 3) return null;

  const measuredXyz: number[][] = patches.map(({ measured_rgb }) => {
    const [r, g, b] = measured_rgb;
    return [...srgbToXyz(r, g, b)];
  });

  const referenceXyz: number[][] = patches.map(({ reference_lab }) => {
    const [L, a, bVal] = reference_lab;
    return [...labToXyz(L, a, bVal)];
  });

  // Least-squares: solve M such that M @ measured ≈ reference
  // Using simple 3-component linear regression per output channel.
  return leastSquares3x3(measuredXyz, referenceXyz);
}

/** Minimal 3×3 least-squares solver (Gaussian elimination / normal equations). */
function leastSquares3x3(
  measured: number[][],  // N×3
  reference: number[][]  // N×3
): number[][] {
  // Normal equations: (A^T A) x = A^T b  for each output dimension
  const n = measured.length;
  const result: number[][] = [[], [], []];

  for (let dim = 0; dim < 3; dim++) {
    // Build ATA (3×3) and ATb (3)
    const ATA = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const ATb = [0, 0, 0];

    for (let i = 0; i < n; i++) {
      const row = measured[i];
      const rhs = reference[i][dim];
      for (let j = 0; j < 3; j++) {
        ATb[j] += row[j] * rhs;
        for (let k = 0; k < 3; k++) {
          ATA[j][k] += row[j] * row[k];
        }
      }
    }

    result[dim] = solveLinear3(ATA, ATb);
  }

  // result[dim][col] → transpose to get correction[row][col]
  return [
    [result[0][0], result[0][1], result[0][2]],
    [result[1][0], result[1][1], result[1][2]],
    [result[2][0], result[2][1], result[2][2]],
  ];
}

/** Gaussian elimination for a 3×3 system. */
function solveLinear3(A: number[][], b: number[]): number[] {
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < 3; col++) {
    // Pivot
    let maxRow = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue;

    for (let row = col + 1; row < 3; row++) {
      const factor = aug[row][col] / pivot;
      for (let k = col; k <= 3; k++) {
        aug[row][k] -= factor * aug[col][k];
      }
    }
  }

  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    x[i] = aug[i][3];
    for (let j = i + 1; j < 3; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i] || 1;
  }
  return x;
}

/**
 * Apply a 3×3 correction matrix to XYZ values.
 * correction[row] × xyz vector.
 */
function applyCorrection(
  xyz: [number, number, number],
  correction: number[][]
): [number, number, number] {
  return [
    Math.max(
      0,
      correction[0][0] * xyz[0] +
        correction[0][1] * xyz[1] +
        correction[0][2] * xyz[2]
    ),
    Math.max(
      0,
      correction[1][0] * xyz[0] +
        correction[1][1] * xyz[1] +
        correction[1][2] * xyz[2]
    ),
    Math.max(
      0,
      correction[2][0] * xyz[0] +
        correction[2][1] * xyz[1] +
        correction[2][2] * xyz[2]
    ),
  ];
}

/**
 * Convert an array of RGB pixels (0–255 each channel) to CIELAB,
 * optionally applying a colour correction matrix.
 */
export function rgbPixelsToLab(
  pixelsRgb: number[][],
  correctionMatrix?: number[][] | null
): LabPixel[] {
  return pixelsRgb.map(([r, g, b]) => {
    let xyz = srgbToXyz(r, g, b);
    if (correctionMatrix) {
      xyz = applyCorrection(xyz, correctionMatrix);
    }
    const [L, a, bVal] = xyzToLab(...xyz);
    return { L, a, b: bVal };
  });
}

// ---------------------------------------------------------------------------
// Trimmed mean (10th–90th percentile of L)
// ---------------------------------------------------------------------------

/**
 * Compute the trimmed mean of LAB values.
 * Excludes pixels whose L channel falls outside the 10th–90th percentile,
 * removing specular highlights and deep shadows.
 */
export function trimmedMeanLab(pixels: LabPixel[]): LabPixel {
  if (pixels.length < 20) {
    return meanLab(pixels);
  }

  const ls = pixels.map((p) => p.L).sort((a, b) => a - b);
  const p10 = percentile(ls, 10);
  const p90 = percentile(ls, 90);

  const filtered = pixels.filter((p) => p.L >= p10 && p.L <= p90);
  if (filtered.length < 10) return meanLab(pixels);

  return meanLab(filtered);
}

function meanLab(pixels: LabPixel[]): LabPixel {
  const n = pixels.length;
  const sum = pixels.reduce(
    (acc, p) => ({ L: acc.L + p.L, a: acc.a + p.a, b: acc.b + p.b }),
    { L: 0, a: 0, b: 0 }
  );
  return { L: sum.L / n, a: sum.a / n, b: sum.b / n };
}

function percentile(sorted: number[], p: number): number {
  const idx = ((p / 100) * (sorted.length - 1));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ---------------------------------------------------------------------------
// Undertone classification
// ---------------------------------------------------------------------------

export type Undertone = "WARM" | "COOL" | "NEUTRAL";

export function classifyUndertone(a: number, b: number): Undertone {
  if (a > 2.0 && b > 5.0) return "WARM";
  if (a < -1.0 || b < 0.0) return "COOL";
  return "NEUTRAL";
}

// ---------------------------------------------------------------------------
// CIEDE2000 ΔE and recommendations
// ---------------------------------------------------------------------------

export interface DeltaECategory {
  category: string;
  range: string;
  description: string;
}

export function categorizeDeltaE(de: number): DeltaECategory {
  if (de <= 1.0)
    return {
      category: "거의 구분 어려움",
      range: "ΔE ≤ 1.0",
      description: "표준 관찰 조건에서 사람 눈으로 거의 구분하기 어려운 수준",
    };
  if (de <= 2.0)
    return {
      category: "아주 근접",
      range: "1.0 < ΔE ≤ 2.0",
      description: "가까이서 비교하면 차이를 느낄 수 있지만 매우 가까운 수준",
    };
  if (de <= 3.5)
    return {
      category: "눈에 띄는 차이",
      range: "2.0 < ΔE ≤ 3.5",
      description: "일반적인 조건에서도 차이가 보이기 시작하는 수준",
    };
  if (de <= 5.0)
    return {
      category: "뚜렷한 차이",
      range: "3.5 < ΔE ≤ 5.0",
      description: "같은 색으로 보기 어려울 만큼 차이가 분명한 수준",
    };
  return {
    category: "차이 큼",
    range: "ΔE > 5.0",
    description:
      "객관적으로 색 차이가 큰 편이라 다른 색상군으로 느껴질 수 있는 수준",
  };
}

export interface FoundationRecord {
  id: number;
  brand: string;
  product_name: string;
  shade_code: string;
  shade_name: string;
  L_value: number;
  a_value: number;
  b_value: number;
  hex_color: string;
  undertone: string | null;
  swatch_image_url?: string | null;
}

export interface RecommendationResult extends FoundationRecord {
  delta_e: number;
  delta_e_category: string;
  delta_e_range: string;
  delta_e_description: string;
}

/**
 * Compute CIEDE2000 ΔE between skin LAB and each foundation, return top N.
 * Uses the `color-diff` package which implements CIEDE2000.
 */
export function computeRecommendations(
  skinLab: LabPixel,
  foundations: FoundationRecord[],
  topN: number = 5
): RecommendationResult[] {
  const skinColor = { L: skinLab.L, a: skinLab.a, b: skinLab.b };

  const results: RecommendationResult[] = foundations.map((f) => {
    const shadeColor = { L: f.L_value, a: f.a_value, b: f.b_value };
    const de = Math.round(colorDiff.diff(skinColor, shadeColor) * 1000) / 1000;
    const { category, range, description } = categorizeDeltaE(de);
    return {
      ...f,
      delta_e: de,
      delta_e_category: category,
      delta_e_range: range,
      delta_e_description: description,
    };
  });

  results.sort((a, b) => a.delta_e - b.delta_e);
  return results.slice(0, topN);
}
