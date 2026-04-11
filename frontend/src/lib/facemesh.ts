/**
 * MediaPipe Face Mesh representative skin ROI definitions.
 *
 * The extraction focuses on lower cheeks, the area below the lips, and the
 * lower chin because these regions are generally less affected by upper-cheek
 * redness than a broad cheek sample.
 */

export type FaceMeshLandmark = {
  x: number;
  y: number;
};

export type SkinRegionName =
  | "lower_left_cheek"
  | "lower_right_cheek"
  | "below_lips"
  | "chin";

export interface SkinRegionPixels {
  lower_left_cheek: number[][];
  lower_right_cheek: number[][];
  below_lips: number[][];
  chin: number[][];
}

export interface FaceRegionPoint {
  x: number;
  y: number;
}

export interface FaceRegionPolygon {
  name: string;
  points: FaceRegionPoint[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

export interface FaceRegionDefinition {
  name: SkinRegionName;
  buildPoints: (
    canvas: HTMLCanvasElement,
    landmarks: FaceMeshLandmark[],
  ) => FaceRegionPoint[];
}

const LOWER_LEFT_CHEEK = [205, 187, 123, 116, 117, 118, 119, 120, 121, 47, 205];
const LOWER_RIGHT_CHEEK = [425, 411, 352, 345, 346, 347, 348, 349, 350, 277, 425];

const CHIN_TIP = 152;
const LEFT_JAW = 172;
const RIGHT_JAW = 397;
const LOWER_LIP_LEFT = 91;
const LOWER_LIP_LEFT_INNER = 84;
const LOWER_LIP_CENTER = 17;
const LOWER_LIP_RIGHT_INNER = 314;
const LOWER_LIP_RIGHT = 321;

function createEmptySkinRegionPixels(): SkinRegionPixels {
  return {
    lower_left_cheek: [],
    lower_right_cheek: [],
    below_lips: [],
    chin: [],
  };
}

function projectLandmark(
  canvas: HTMLCanvasElement,
  landmark: FaceMeshLandmark,
): FaceRegionPoint {
  return {
    x: Math.round(landmark.x * canvas.width),
    y: Math.round(landmark.y * canvas.height),
  };
}

function interpolatePoint(
  start: FaceRegionPoint,
  end: FaceRegionPoint,
  ratio: number,
): FaceRegionPoint {
  return {
    x: Math.round(start.x + (end.x - start.x) * ratio),
    y: Math.round(start.y + (end.y - start.y) * ratio),
  };
}

function interpolateLandmark(
  canvas: HTMLCanvasElement,
  landmarks: FaceMeshLandmark[],
  startIndex: number,
  endIndex: number,
  ratio: number,
): FaceRegionPoint {
  return interpolatePoint(
    projectLandmark(canvas, landmarks[startIndex]),
    projectLandmark(canvas, landmarks[endIndex]),
    ratio,
  );
}

function pointsFromIndices(
  canvas: HTMLCanvasElement,
  landmarks: FaceMeshLandmark[],
  indices: number[],
): FaceRegionPoint[] {
  return indices.map((index) => projectLandmark(canvas, landmarks[index]));
}

function buildBounds(
  canvas: HTMLCanvasElement,
  points: FaceRegionPoint[],
): FaceRegionPolygon["bounds"] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    minX: Math.max(0, Math.min(...xs)),
    minY: Math.max(0, Math.min(...ys)),
    maxX: Math.min(canvas.width - 1, Math.max(...xs)),
    maxY: Math.min(canvas.height - 1, Math.max(...ys)),
  };
}

export const SKIN_REGIONS: FaceRegionDefinition[] = [
  {
    name: "lower_left_cheek",
    buildPoints: (canvas, landmarks) =>
      pointsFromIndices(canvas, landmarks, LOWER_LEFT_CHEEK),
  },
  {
    name: "lower_right_cheek",
    buildPoints: (canvas, landmarks) =>
      pointsFromIndices(canvas, landmarks, LOWER_RIGHT_CHEEK),
  },
  {
    name: "below_lips",
    buildPoints: (canvas, landmarks) => [
      interpolateLandmark(canvas, landmarks, LOWER_LIP_LEFT, CHIN_TIP, 0.18),
      interpolateLandmark(
        canvas,
        landmarks,
        LOWER_LIP_LEFT_INNER,
        CHIN_TIP,
        0.16,
      ),
      interpolateLandmark(canvas, landmarks, LOWER_LIP_CENTER, CHIN_TIP, 0.12),
      interpolateLandmark(
        canvas,
        landmarks,
        LOWER_LIP_RIGHT_INNER,
        CHIN_TIP,
        0.16,
      ),
      interpolateLandmark(canvas, landmarks, LOWER_LIP_RIGHT, CHIN_TIP, 0.18),
      interpolateLandmark(canvas, landmarks, LOWER_LIP_RIGHT, CHIN_TIP, 0.38),
      interpolateLandmark(canvas, landmarks, LOWER_LIP_CENTER, CHIN_TIP, 0.46),
      interpolateLandmark(canvas, landmarks, LOWER_LIP_LEFT, CHIN_TIP, 0.38),
    ],
  },
  {
    name: "chin",
    buildPoints: (canvas, landmarks) => [
      interpolateLandmark(canvas, landmarks, LEFT_JAW, CHIN_TIP, 0.38),
      interpolateLandmark(canvas, landmarks, LOWER_LIP_CENTER, CHIN_TIP, 0.58),
      interpolateLandmark(canvas, landmarks, RIGHT_JAW, CHIN_TIP, 0.38),
      interpolateLandmark(canvas, landmarks, RIGHT_JAW, CHIN_TIP, 0.18),
      projectLandmark(canvas, landmarks[CHIN_TIP]),
      interpolateLandmark(canvas, landmarks, LEFT_JAW, CHIN_TIP, 0.18),
    ],
  },
];

export function buildRegionPolygons(
  canvas: HTMLCanvasElement,
  landmarks: FaceMeshLandmark[],
  regions: FaceRegionDefinition[] = SKIN_REGIONS,
): FaceRegionPolygon[] {
  return regions.map((region) => {
    const points = region.buildPoints(canvas, landmarks);
    return {
      name: region.name,
      points,
      bounds: buildBounds(canvas, points),
    };
  });
}

export function extractSkinPixelsByRegion(
  canvas: HTMLCanvasElement,
  landmarks: FaceMeshLandmark[],
  regions: FaceRegionDefinition[] = SKIN_REGIONS,
): SkinRegionPixels {
  const ctx = canvas.getContext("2d");
  if (!ctx) return createEmptySkinRegionPixels();

  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const polygons = buildRegionPolygons(canvas, landmarks, regions);
  const regionPixels = createEmptySkinRegionPixels();

  for (const polygon of polygons) {
    const { points, bounds } = polygon;
    const pixels = regionPixels[polygon.name as SkinRegionName];

    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        if (!isPointInPolygon(x, y, points)) continue;

        const index = (y * width + x) * 4;
        pixels.push([
          imageData.data[index],
          imageData.data[index + 1],
          imageData.data[index + 2],
        ]);
      }
    }
  }

  return regionPixels;
}

export function flattenSkinRegionPixels(regionPixels: SkinRegionPixels): number[][] {
  return [
    ...regionPixels.lower_left_cheek,
    ...regionPixels.lower_right_cheek,
    ...regionPixels.below_lips,
    ...regionPixels.chin,
  ];
}

/**
 * Extract pixel RGB values from face image within the configured ROI polygons.
 */
export function extractSkinPixels(
  canvas: HTMLCanvasElement,
  landmarks: FaceMeshLandmark[],
  regions: FaceRegionDefinition[] = SKIN_REGIONS,
): number[][] {
  return flattenSkinRegionPixels(
    extractSkinPixelsByRegion(canvas, landmarks, regions),
  );
}

function isPointInPolygon(
  x: number,
  y: number,
  polygon: FaceRegionPoint[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}
