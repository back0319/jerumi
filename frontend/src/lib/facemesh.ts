/**
 * MediaPipe Face Mesh landmark indices for skin ROI regions.
 *
 * These define polygon regions on the face for:
 * - Left cheek
 * - Right cheek
 * - Forehead
 * - Chin
 *
 * Eyes, eyebrows, lips, and nose shadow are excluded.
 */

// Left cheek region (landmarks forming a polygon)
export const LEFT_CHEEK = [50, 101, 36, 205, 187, 123, 116, 117, 118, 119, 120, 121, 47, 50];

// Right cheek region
export const RIGHT_CHEEK = [280, 330, 266, 425, 411, 352, 345, 346, 347, 348, 349, 350, 277, 280];

// Forehead center region
export const FOREHEAD = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];

// Chin region
export const CHIN = [152, 148, 176, 149, 150, 136, 172, 58, 215, 138, 135, 169, 170, 140, 171, 175, 396, 369, 395, 394, 364, 367, 435, 288, 361, 323, 454, 356, 389, 251, 284, 332, 297, 338, 10];

// All skin ROI regions combined
export const SKIN_REGIONS = [LEFT_CHEEK, RIGHT_CHEEK];

export interface FaceRegionPoint {
  x: number;
  y: number;
}

export interface FaceRegionPolygon {
  points: FaceRegionPoint[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

export function buildRegionPolygons(
  canvas: HTMLCanvasElement,
  landmarks: { x: number; y: number }[],
  regions: number[][] = SKIN_REGIONS
): FaceRegionPolygon[] {
  const w = canvas.width;
  const h = canvas.height;

  return regions.map((region) => {
    const points = region.map((idx) => ({
      x: Math.round(landmarks[idx].x * w),
      y: Math.round(landmarks[idx].y * h),
    }));

    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);

    return {
      points,
      bounds: {
        minX: Math.max(0, Math.min(...xs)),
        minY: Math.max(0, Math.min(...ys)),
        maxX: Math.min(w - 1, Math.max(...xs)),
        maxY: Math.min(h - 1, Math.max(...ys)),
      },
    };
  });
}

/**
 * Extract pixel RGB values from face image within the given landmark polygons.
 */
export function extractSkinPixels(
  canvas: HTMLCanvasElement,
  landmarks: { x: number; y: number }[],
  regions: number[][] = SKIN_REGIONS
): number[][] {
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const w = canvas.width;
  const h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels: number[][] = [];
  const polygons = buildRegionPolygons(canvas, landmarks, regions);

  for (const polygon of polygons) {
    const { points, bounds } = polygon;

    // Check each pixel in bounding box
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (isPointInPolygon(x, y, points)) {
          const idx = (y * w + x) * 4;
          pixels.push([
            imageData.data[idx],
            imageData.data[idx + 1],
            imageData.data[idx + 2],
          ]);
        }
      }
    }
  }

  return pixels;
}

function isPointInPolygon(
  x: number,
  y: number,
  polygon: { x: number; y: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x,
      yi = polygon[i].y;
    const xj = polygon[j].x,
      yj = polygon[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
