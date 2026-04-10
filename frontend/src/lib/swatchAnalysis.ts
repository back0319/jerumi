/**
 * Foundation swatch colour extraction from a photo.
 *
 * Replaces the OpenCV-based swatch_extraction.py from the Python backend.
 * Uses `sharp` for image decoding / pixel access.
 *
 * Algorithm (simplified from the Python version):
 * 1. Decode image → raw RGBA/RGB pixel buffer via sharp.
 * 2. Convert every pixel to CIELAB.
 * 3. Apply a threshold: keep pixels where L < 82 OR chroma > 15
 *    (identical to the Python _find_swatch_mask criterion).
 * 4. If fewer than 50 candidate pixels remain → raise an error.
 * 5. Subsample to ≤ 20 000 pixels for performance.
 * 6. Optionally apply colour-checker correction matrix.
 * 7. Compute trimmed mean LAB.
 * 8. Return L/a/b, hex colour, and undertone.
 *
 * Note: The Python version also runs morphological close/open operations and
 * connected-component filtering.  Those are not available in sharp; the simple
 * threshold approach works well for clear swatch photos on white paper.
 */

import sharp from "sharp";
import {
  ColorCheckerPatch,
  buildCorrectionMatrix,
  classifyUndertone,
  labToHex,
  rgbPixelsToLab,
  trimmedMeanLab,
} from "./colorScience";

export interface SwatchResult {
  L_value: number;
  a_value: number;
  b_value: number;
  hex_color: string;
  undertone: string;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB (Vercel function body limit)
const MAX_PIXELS = 20_000;

export async function extractSwatchFromImage(
  imageBytes: Buffer,
  checkerPatches?: ColorCheckerPatch[] | null
): Promise<SwatchResult> {
  if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("이미지 크기가 너무 큽니다 (최대 4MB)");
  }

  // Decode to raw RGB pixel buffer
  const { data, info } = await sharp(imageBytes)
    .ensureAlpha(1)         // always 4 channels (RGBA)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info; // channels === 4 (RGBA)
  const totalPixels = width * height;

  // Collect non-white swatch pixels
  const swatchRgb: number[][] = [];

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * channels;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    // alpha channel (offset + 3) is ignored

    // Convert to LAB to apply the same threshold as the Python code
    const lab = srgbToLabFast(r, g, b);
    const L = lab[0];
    const a = lab[1];
    const bVal = lab[2];
    const chroma = Math.sqrt(a * a + bVal * bVal);

    if (L < 82 || chroma > 15) {
      swatchRgb.push([r, g, b]);
    }
  }

  if (swatchRgb.length < 50) {
    throw new Error(
      "사진에서 파운데이션 스와치를 감지할 수 없습니다. " +
        "흰 종이에 충분한 대비로 파운데이션이 발려 있는지 확인해 주세요."
    );
  }

  // Subsample for performance
  let pixels = swatchRgb;
  if (pixels.length > MAX_PIXELS) {
    const step = Math.ceil(pixels.length / MAX_PIXELS);
    pixels = pixels.filter((_, idx) => idx % step === 0).slice(0, MAX_PIXELS);
  }

  // Build optional colour correction matrix
  let correction: number[][] | null = null;
  if (checkerPatches && checkerPatches.length >= 3) {
    correction = buildCorrectionMatrix(checkerPatches);
  }

  // Convert to calibrated CIELAB
  const labPixels = rgbPixelsToLab(pixels, correction);

  // Trimmed mean
  const mean = trimmedMeanLab(labPixels);
  const L = Math.round(mean.L * 100) / 100;
  const a = Math.round(mean.a * 100) / 100;
  const bOut = Math.round(mean.b * 100) / 100;

  return {
    L_value: L,
    a_value: a,
    b_value: bOut,
    hex_color: labToHex(mean.L, mean.a, mean.b),
    undertone: classifyUndertone(a, bOut),
  };
}

// ---------------------------------------------------------------------------
// Inline fast sRGB → LAB (avoid importing the full module to keep the hot path
// tight; same math as colorScience.ts).
// ---------------------------------------------------------------------------

function srgbToLabFast(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const rl = lin(r / 255);
  const gl = lin(g / 255);
  const bl = lin(b / 255);

  const X = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const Y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const Z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;

  const d65 = { X: 0.95047, Y: 1.0, Z: 1.08883 };
  const delta = 6 / 29;
  const f = (t: number) =>
    t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta ** 2) + 4 / 29;

  const fx = f(X / d65.X);
  const fy = f(Y / d65.Y);
  const fz = f(Z / d65.Z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
