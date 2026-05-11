import type { FaceRegionPolygon, SkinRegionPixels } from "@/lib/facemesh";

export type SkinRegionKey = keyof SkinRegionPixels;
export type SkinOverlayMode = "facemesh" | "fallback";
export type SkinExtraction = {
  combinedPixels: number[][];
  skinRegions: SkinRegionPixels | null;
};
export type SkinRegionPixelCounts = Partial<Record<SkinRegionKey, number>>;
export type FallbackRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type SkinOverlayBase = {
  mode: SkinOverlayMode;
  pixelCount: number;
  polygons: FaceRegionPolygon[];
  regionPixelCounts: SkinRegionPixelCounts;
  fallbackRect?: FallbackRect;
};

export const FALLBACK_OVERLAY_FILL = "rgba(59, 130, 246, 0.18)";
export const FALLBACK_OVERLAY_STROKE = "#2563eb";
export const SKIN_REGION_OVERLAY_STYLES: Record<
  SkinRegionKey,
  { fill: string; stroke: string }
> = {
  lower_left_cheek: {
    fill: "rgba(244, 63, 94, 0.18)",
    stroke: "#e11d48",
  },
  lower_right_cheek: {
    fill: "rgba(249, 115, 22, 0.18)",
    stroke: "#ea580c",
  },
  below_lips: {
    fill: "rgba(16, 185, 129, 0.18)",
    stroke: "#059669",
  },
  chin: {
    fill: "rgba(59, 130, 246, 0.18)",
    stroke: "#2563eb",
  },
};

export function isSkinRegionKey(value: string): value is SkinRegionKey {
  return value in SKIN_REGION_OVERLAY_STYLES;
}

export function averagePixelsToHex(pixels: number[][]): string {
  if (pixels.length === 0) return "#000000";

  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;

  for (const pixel of pixels) {
    redTotal += pixel[0];
    greenTotal += pixel[1];
    blueTotal += pixel[2];
  }

  const count = pixels.length;
  const averageRed = Math.round(redTotal / count);
  const averageGreen = Math.round(greenTotal / count);
  const averageBlue = Math.round(blueTotal / count);

  return `#${averageRed.toString(16).padStart(2, "0")}${averageGreen
    .toString(16)
    .padStart(2, "0")}${averageBlue.toString(16).padStart(2, "0")}`;
}

/**
 * Approximates the backend's brightness-biased trim (p65-p98 by L*) used in
 * `_trim_lightness` so the pre-analysis preview swatch matches the post-analysis
 * "보정 전" color. Frontend can't run the full LAB pipeline, but sRGB luminance
 * is well correlated with L* — close enough for a preview.
 */
export function brightSkinPreviewHex(pixels: number[][]): string {
  if (pixels.length < 20) return averagePixelsToHex(pixels);

  const withLuminance = pixels.map((rgb) => ({
    rgb,
    y: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2],
  }));
  withLuminance.sort((a, b) => a.y - b.y);

  const lo = Math.floor(withLuminance.length * 0.65);
  const hi = Math.max(lo + 1, Math.ceil(withLuminance.length * 0.98));
  const kept = withLuminance.slice(lo, hi).map((x) => x.rgb);

  return averagePixelsToHex(kept);
}

export function downsamplePixels(
  pixels: number[][],
  maxCount: number,
): number[][] {
  if (pixels.length <= maxCount) return pixels;

  const step = Math.ceil(pixels.length / maxCount);
  return pixels.filter((_, index) => index % step === 0);
}

export function downsampleSkinRegions(
  skinRegions: SkinRegionPixels,
  maxPerRegion: number,
): SkinRegionPixels {
  return {
    lower_left_cheek: downsamplePixels(
      skinRegions.lower_left_cheek,
      maxPerRegion,
    ),
    lower_right_cheek: downsamplePixels(
      skinRegions.lower_right_cheek,
      maxPerRegion,
    ),
    below_lips: downsamplePixels(skinRegions.below_lips, maxPerRegion),
    chin: downsamplePixels(skinRegions.chin, maxPerRegion),
  };
}

export function getSkinRegionPixelCounts(
  skinRegions: SkinRegionPixels | null,
): SkinRegionPixelCounts {
  if (!skinRegions) return {};

  return {
    lower_left_cheek: skinRegions.lower_left_cheek.length,
    lower_right_cheek: skinRegions.lower_right_cheek.length,
    below_lips: skinRegions.below_lips.length,
    chin: skinRegions.chin.length,
  };
}
