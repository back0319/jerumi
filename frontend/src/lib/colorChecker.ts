/**
 * Color Checker calibration utilities.
 *
 * Standard 24-patch X-Rite ColorChecker Classic reference LAB values
 * (under D65 illuminant). The user holds the checker in the photo,
 * and we match measured RGB patches to these known LAB values.
 */

// X-Rite ColorChecker Classic - first 6 patches (most useful for skin)
// Full 24-patch can be added later
export const COLORCHECKER_REFERENCE: {
  name: string;
  lab: [number, number, number];
}[] = [
  { name: "Dark Skin", lab: [37.99, 13.56, 14.06] },
  { name: "Light Skin", lab: [65.71, 18.13, 17.81] },
  { name: "Blue Sky", lab: [49.93, -4.88, -21.93] },
  { name: "Foliage", lab: [43.14, -13.10, 21.91] },
  { name: "Blue Flower", lab: [55.11, 8.84, -25.40] },
  { name: "Bluish Green", lab: [70.72, -33.40, -0.20] },
  { name: "Orange", lab: [62.66, 36.07, 57.10] },
  { name: "Purplish Blue", lab: [40.02, 10.41, -45.96] },
  { name: "Moderate Red", lab: [51.12, 48.24, 16.25] },
  { name: "Purple", lab: [30.33, 22.98, -21.59] },
  { name: "Yellow Green", lab: [72.53, -23.71, 57.26] },
  { name: "Orange Yellow", lab: [71.94, 19.36, 67.86] },
  { name: "Blue", lab: [28.78, 14.18, -50.30] },
  { name: "Green", lab: [55.26, -38.34, 31.37] },
  { name: "Red", lab: [42.10, 53.38, 28.19] },
  { name: "Yellow", lab: [81.73, 4.04, 79.82] },
  { name: "Magenta", lab: [51.94, 49.99, -14.57] },
  { name: "Cyan", lab: [51.04, -28.63, -28.64] },
  { name: "White", lab: [96.54, -0.43, 1.19] },
  { name: "Neutral 8", lab: [81.26, -0.64, -0.34] },
  { name: "Neutral 6.5", lab: [66.77, -0.73, -0.50] },
  { name: "Neutral 5", lab: [50.87, -0.15, -0.27] },
  { name: "Neutral 3.5", lab: [35.66, -0.42, -1.23] },
  { name: "Black", lab: [20.46, -0.08, -0.97] },
];

function labPivotToXyz(value: number): number {
  const cube = value ** 3;
  return cube > 0.008856 ? cube : (value - 16 / 116) / 7.787;
}

function xyzChannelToSrgb(value: number): number {
  const linear =
    value <= 0.0031308
      ? 12.92 * value
      : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(linear * 255)));
}

export function labToRgb([l, a, b]: [number, number, number]): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = 95.047 * labPivotToXyz(fx);
  const y = 100.0 * labPivotToXyz(fy);
  const z = 108.883 * labPivotToXyz(fz);

  const normalizedX = x / 100;
  const normalizedY = y / 100;
  const normalizedZ = z / 100;

  const r =
    normalizedX * 3.2406 +
    normalizedY * -1.5372 +
    normalizedZ * -0.4986;
  const g =
    normalizedX * -0.9689 +
    normalizedY * 1.8758 +
    normalizedZ * 0.0415;
  const blue =
    normalizedX * 0.0557 +
    normalizedY * -0.204 +
    normalizedZ * 1.057;

  return [
    xyzChannelToSrgb(r),
    xyzChannelToSrgb(g),
    xyzChannelToSrgb(blue),
  ];
}

export function labToHex(lab: [number, number, number]): string {
  const [r, g, b] = labToRgb(lab);
  return `#${r.toString(16).padStart(2, "0")}${g
    .toString(16)
    .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Let the user click on color checker patches in the image to identify
 * measured RGB values for calibration.
 */
export interface MeasuredPatch {
  patchIndex: number; // index into COLORCHECKER_REFERENCE
  measuredRgb: [number, number, number];
}

export type DetectionPoint = {
  x: number;
  y: number;
};

export type DetectedColorCheckerPatch = {
  patchIndex: number;
  measuredRgb: [number, number, number];
  center: DetectionPoint;
  polygon: DetectionPoint[];
};

export type ColorCheckerFiducials = {
  center: DetectionPoint | null;
  corners: DetectionPoint[];
};

export type ColorCheckerDetection = {
  score: number;
  confidence: number;
  polygon: DetectionPoint[];
  patches: DetectedColorCheckerPatch[];
  fiducials: ColorCheckerFiducials;
};

type CandidateGeometry = {
  centerX: number;
  centerY: number;
  uX: number;
  uY: number;
  vX: number;
  vY: number;
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  area: number;
  fillRatio: number;
};

type LocalPatchSample = {
  measuredRgb: [number, number, number];
  center: DetectionPoint;
  polygon: DetectionPoint[];
};

type Homography = number[][];

type PatchGridModel = {
  uCenters: number[];
  vCenters: number[];
  halfU: number;
  halfV: number;
};

type PatchGridCandidate = {
  center: DetectionPoint;
  width: number;
  height: number;
  area: number;
  fillRatio: number;
};

type PatchGridFit = {
  uAxis: DetectionPoint;
  vAxis: DetectionPoint;
  uCenters: number[];
  vCenters: number[];
  pairCount: number;
  residualMean: number;
};

const DETECTION_MAX_DIMENSION = 640;
const MAX_CANDIDATES = 10;
const MAX_ACCEPTED_SCORE = 70;
const GRID_U_START = 0.13;
const GRID_U_END = 0.87;
const GRID_V_START = 0.15;
const GRID_V_END = 0.85;
const EDGE_BIN_COUNT = 36;
const EDGE_BIN_START = 0.04;
const EDGE_BIN_END = 0.96;
const EDGE_EXTREME_POINTS_PER_BIN = 5;
const MIN_EDGE_POINTS = 8;
const MIN_PATCH_COMPONENTS = 10;
const MIN_PATCH_GRID_PAIRS = 10;
const MAX_PATCH_GRID_CANDIDATES = 60;
const PATCH_U_STEP_RANGE: [number, number] = [0.09, 0.17];
const PATCH_V_STEP_RANGE: [number, number] = [0.16, 0.27];

const REFERENCE_RGB = COLORCHECKER_REFERENCE.map((patch) =>
  labToRgb(patch.lab),
);

function getPixelIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function dilateMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const next = new Uint8Array(mask.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let dy = -1; dy <= 1 && value === 0; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (mask[yy * width + xx]) {
            value = 1;
            break;
          }
        }
      }
      next[y * width + x] = value;
    }
  }

  return next;
}

function erodeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const next = new Uint8Array(mask.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 1;
      for (let dy = -1; dy <= 1 && value === 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) {
          value = 0;
          break;
        }
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || !mask[yy * width + xx]) {
            value = 0;
            break;
          }
        }
      }
      next[y * width + x] = value;
    }
  }

  return next;
}

function buildDarkCardMask(data: Uint8ClampedArray, width: number, height: number) {
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = getPixelIndex(x, y, width);
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const channelSpread =
        Math.max(red, green, blue) - Math.min(red, green, blue);
      mask[y * width + x] =
        luma < 85 || (luma < 125 && channelSpread < 35) ? 1 : 0;
    }
  }

  const dilatedOnce = dilateMask(mask, width, height);
  const dilatedTwice = dilateMask(dilatedOnce, width, height);
  return erodeMask(dilatedTwice, width, height);
}

function findConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): DetectionPoint[][] {
  const minArea = Math.max(120, Math.round(width * height * 0.001));
  return findConnectedComponentsWithMinArea(mask, width, height, minArea);
}

function findConnectedComponentsWithMinArea(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): DetectionPoint[][] {
  const visited = new Uint8Array(mask.length);
  const components: DetectionPoint[][] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;

    const stack = [start];
    visited[start] = 1;
    const points: DetectionPoint[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      points.push({ x, y });

      for (
        let yy = Math.max(0, y - 1);
        yy <= Math.min(height - 1, y + 1);
        yy++
      ) {
        for (
          let xx = Math.max(0, x - 1);
          xx <= Math.min(width - 1, x + 1);
          xx++
        ) {
          const next = yy * width + xx;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          stack.push(next);
        }
      }
    }

    if (points.length >= minArea) {
      components.push(points);
    }
  }

  return components.sort((left, right) => right.length - left.length);
}

function geometryFromComponent(points: DetectionPoint[]): CandidateGeometry | null {
  if (points.length < 3) return null;

  let meanX = 0;
  let meanY = 0;
  for (const point of points) {
    meanX += point.x;
    meanY += point.y;
  }
  meanX /= points.length;
  meanY /= points.length;

  let covXX = 0;
  let covXY = 0;
  let covYY = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    covXX += dx * dx;
    covXY += dx * dy;
    covYY += dy * dy;
  }
  covXX /= points.length;
  covXY /= points.length;
  covYY /= points.length;

  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const uX = Math.cos(angle);
  const uY = Math.sin(angle);
  const vX = -uY;
  const vY = uX;

  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    const projectedU = dx * uX + dy * uY;
    const projectedV = dx * vX + dy * vY;
    minU = Math.min(minU, projectedU);
    maxU = Math.max(maxU, projectedU);
    minV = Math.min(minV, projectedV);
    maxV = Math.max(maxV, projectedV);
  }

  let width = maxU - minU;
  let height = maxV - minV;
  let finalUX = uX;
  let finalUY = uY;
  let finalVX = vX;
  let finalVY = vY;
  let finalMinU = minU;
  let finalMaxU = maxU;
  let finalMinV = minV;
  let finalMaxV = maxV;

  if (height > width) {
    finalUX = vX;
    finalUY = vY;
    finalVX = uX;
    finalVY = uY;
    finalMinU = minV;
    finalMaxU = maxV;
    finalMinV = minU;
    finalMaxV = maxU;
    width = finalMaxU - finalMinU;
    height = finalMaxV - finalMinV;
  }

  if (width < 72 || height < 36) return null;
  const aspect = width / Math.max(height, 1);
  if (aspect < 1.15 || aspect > 2.35) return null;

  const fillRatio = points.length / Math.max(width * height, 1);
  if (fillRatio < 0.12) return null;

  return {
    centerX: meanX,
    centerY: meanY,
    uX: finalUX,
    uY: finalUY,
    vX: finalVX,
    vY: finalVY,
    minU: finalMinU,
    maxU: finalMaxU,
    minV: finalMinV,
    maxV: finalMaxV,
    area: points.length,
    fillRatio,
  };
}

function scaleGeometry(geometry: CandidateGeometry, scale: number): CandidateGeometry {
  if (scale === 1) return geometry;

  return {
    ...geometry,
    centerX: geometry.centerX / scale,
    centerY: geometry.centerY / scale,
    minU: geometry.minU / scale,
    maxU: geometry.maxU / scale,
    minV: geometry.minV / scale,
    maxV: geometry.maxV / scale,
  };
}

function cardInteriorMask(
  component: DetectionPoint[],
  width: number,
  height: number,
): Uint8Array {
  const rowMin = Array(height).fill(Number.POSITIVE_INFINITY);
  const rowMax = Array(height).fill(Number.NEGATIVE_INFINITY);
  const mask = new Uint8Array(width * height);

  for (const point of component) {
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    rowMin[y] = Math.min(rowMin[y], x);
    rowMax[y] = Math.max(rowMax[y], x);
  }

  for (let y = 0; y < height; y++) {
    if (!Number.isFinite(rowMin[y]) || !Number.isFinite(rowMax[y])) continue;
    for (let x = rowMin[y]; x <= rowMax[y]; x++) {
      mask[y * width + x] = 1;
    }
  }

  return mask;
}

function normalizedCardCoordinate(
  point: DetectionPoint,
  geometry: CandidateGeometry,
) {
  const dx = point.x - geometry.centerX;
  const dy = point.y - geometry.centerY;
  const projectedU = dx * geometry.uX + dy * geometry.uY;
  const projectedV = dx * geometry.vX + dy * geometry.vY;
  return {
    u: (projectedU - geometry.minU) / (geometry.maxU - geometry.minU),
    v: (projectedV - geometry.minV) / (geometry.maxV - geometry.minV),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function quantile(values: number[], amount: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * amount;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];

  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function robustFiducialCenter(
  points: DetectionPoint[],
  normalized: { u: number; v: number }[],
  uRange: [number, number],
  vRange: [number, number],
  minPoints: number,
): DetectionPoint | null {
  const xs: number[] = [];
  const ys: number[] = [];

  for (let index = 0; index < points.length; index++) {
    const { u, v } = normalized[index];
    if (u < uRange[0] || u > uRange[1] || v < vRange[0] || v > vRange[1]) {
      continue;
    }
    xs.push(points[index].x);
    ys.push(points[index].y);
  }

  if (xs.length < minPoints) return null;
  return { x: median(xs), y: median(ys) };
}

function detectFiducialPoints(
  imageData: ImageData,
  component: DetectionPoint[],
  geometry: CandidateGeometry,
): ColorCheckerFiducials {
  const interior = cardInteriorMask(component, imageData.width, imageData.height);
  const brightPoints: DetectionPoint[] = [];
  const normalized: { u: number; v: number }[] = [];

  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      if (!interior[y * imageData.width + x]) continue;
      const index = getPixelIndex(x, y, imageData.width);
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const spread =
        Math.max(red, green, blue) - Math.min(red, green, blue);

      if (luma <= 135 || spread >= 95) continue;
      const point = { x, y };
      const cardCoordinate = normalizedCardCoordinate(point, geometry);
      if (
        cardCoordinate.u < 0 ||
        cardCoordinate.u > 1 ||
        cardCoordinate.v < 0 ||
        cardCoordinate.v > 1
      ) {
        continue;
      }
      brightPoints.push(point);
      normalized.push(cardCoordinate);
    }
  }

  if (brightPoints.length === 0) {
    return { center: null, corners: [] };
  }

  const center = robustFiducialCenter(
    brightPoints,
    normalized,
    [0.47, 0.53],
    [0.47, 0.53],
    2,
  ) ?? detectCenterFiducialRelaxed(imageData, interior, geometry);
  const cornerWindows: Array<[[number, number], [number, number]]> = [
    [
      [0, 0.16],
      [0, 0.16],
    ],
    [
      [0.84, 1],
      [0, 0.16],
    ],
    [
      [0.84, 1],
      [0.84, 1],
    ],
    [
      [0, 0.16],
      [0.84, 1],
    ],
  ];
  const corners = cornerWindows
    .map(([uRange, vRange]) =>
      robustFiducialCenter(brightPoints, normalized, uRange, vRange, 8),
    )
    .filter((point): point is DetectionPoint => point !== null);

  return { center, corners };
}

function detectCenterFiducialRelaxed(
  imageData: ImageData,
  interior: Uint8Array,
  geometry: CandidateGeometry,
): DetectionPoint | null {
  const points: DetectionPoint[] = [];
  const normalized: { u: number; v: number }[] = [];

  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      if (!interior[y * imageData.width + x]) continue;

      const index = getPixelIndex(x, y, imageData.width);
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const spread =
        Math.max(red, green, blue) - Math.min(red, green, blue);

      if (luma <= 95 || spread >= 135) continue;
      const point = { x, y };
      points.push(point);
      normalized.push(normalizedCardCoordinate(point, geometry));
    }
  }

  return robustFiducialCenter(
    points,
    normalized,
    [0.45, 0.55],
    [0.45, 0.55],
    4,
  );
}

function scaleFiducials(
  fiducials: ColorCheckerFiducials,
  scale: number,
): ColorCheckerFiducials {
  if (scale === 1) return fiducials;

  return {
    center: fiducials.center
      ? {
          x: fiducials.center.x / scale,
          y: fiducials.center.y / scale,
        }
      : null,
    corners: fiducials.corners.map((corner) => ({
      x: corner.x / scale,
      y: corner.y / scale,
    })),
  };
}

function pointFromLocal(
  geometry: CandidateGeometry,
  uFraction: number,
  vFraction: number,
): DetectionPoint {
  const u = geometry.minU + uFraction * (geometry.maxU - geometry.minU);
  const v = geometry.minV + vFraction * (geometry.maxV - geometry.minV);
  return {
    x: geometry.centerX + geometry.uX * u + geometry.vX * v,
    y: geometry.centerY + geometry.uY * u + geometry.vY * v,
  };
}

function polygonFromGeometry(geometry: CandidateGeometry): DetectionPoint[] {
  return [
    { u: geometry.minU, v: geometry.minV },
    { u: geometry.maxU, v: geometry.minV },
    { u: geometry.maxU, v: geometry.maxV },
    { u: geometry.minU, v: geometry.maxV },
  ].map(({ u, v }) => ({
    x: geometry.centerX + geometry.uX * u + geometry.vX * v,
    y: geometry.centerY + geometry.uY * u + geometry.vY * v,
  }));
}

type CardCoordinate = {
  point: DetectionPoint;
  normalizedU: number;
  normalizedV: number;
  projectedU: number;
  projectedV: number;
};

type FittedLine = {
  point: DetectionPoint;
  directionX: number;
  directionY: number;
};

type CardSide = "top" | "right" | "bottom" | "left";

function projectedCardCoordinate(
  point: DetectionPoint,
  geometry: CandidateGeometry,
): CardCoordinate {
  const dx = point.x - geometry.centerX;
  const dy = point.y - geometry.centerY;
  const projectedU = dx * geometry.uX + dy * geometry.uY;
  const projectedV = dx * geometry.vX + dy * geometry.vY;
  return {
    point,
    projectedU,
    projectedV,
    normalizedU: (projectedU - geometry.minU) / (geometry.maxU - geometry.minU),
    normalizedV: (projectedV - geometry.minV) / (geometry.maxV - geometry.minV),
  };
}

function edgeExtremePoints(
  coordinates: CardCoordinate[],
  side: CardSide,
): DetectionPoint[] | null {
  const points: DetectionPoint[] = [];
  const binWidth = (EDGE_BIN_END - EDGE_BIN_START) / EDGE_BIN_COUNT;
  const horizontalSide = side === "top" || side === "bottom";
  const chooseLowExtreme = side === "top" || side === "left";

  for (let binIndex = 0; binIndex < EDGE_BIN_COUNT; binIndex++) {
    const low = EDGE_BIN_START + binWidth * binIndex;
    const high = low + binWidth;
    const candidates = coordinates.filter((coordinate) => {
      if (horizontalSide) {
        return (
          coordinate.normalizedU >= low &&
          coordinate.normalizedU < high &&
          coordinate.normalizedV >= -0.05 &&
          coordinate.normalizedV <= 1.05
        );
      }
      return (
        coordinate.normalizedV >= low &&
        coordinate.normalizedV < high &&
        coordinate.normalizedU >= -0.05 &&
        coordinate.normalizedU <= 1.05
      );
    });

    if (candidates.length === 0) continue;
    candidates.sort((left, right) => {
      const leftValue = horizontalSide ? left.projectedV : left.projectedU;
      const rightValue = horizontalSide ? right.projectedV : right.projectedU;
      return chooseLowExtreme ? leftValue - rightValue : rightValue - leftValue;
    });

    const selected = candidates.slice(0, EDGE_EXTREME_POINTS_PER_BIN);
    points.push({
      x: median(selected.map((coordinate) => coordinate.point.x)),
      y: median(selected.map((coordinate) => coordinate.point.y)),
    });
  }

  return points.length >= MIN_EDGE_POINTS ? points : null;
}

function fitLine(points: DetectionPoint[]): FittedLine | null {
  if (points.length < 2) return null;

  const center = {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  };
  let covXX = 0;
  let covXY = 0;
  let covYY = 0;

  for (const point of points) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    covXX += dx * dx;
    covXY += dx * dy;
    covYY += dy * dy;
  }

  covXX /= points.length;
  covXY /= points.length;
  covYY /= points.length;

  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const length = Math.hypot(directionX, directionY);
  if (length < 1e-8) return null;

  return {
    point: center,
    directionX: directionX / length,
    directionY: directionY / length,
  };
}

function intersectLines(first: FittedLine, second: FittedLine): DetectionPoint | null {
  const determinant =
    first.directionY * second.directionX -
    first.directionX * second.directionY;
  if (Math.abs(determinant) < 1e-8) return null;

  const dx = second.point.x - first.point.x;
  const dy = second.point.y - first.point.y;
  const scale = (second.directionX * dy - second.directionY * dx) / determinant;
  return {
    x: first.point.x + first.directionX * scale,
    y: first.point.y + first.directionY * scale,
  };
}

function detectCardCorners(
  component: DetectionPoint[],
  geometry: CandidateGeometry,
): DetectionPoint[] | null {
  const coordinates = component.map((point) =>
    projectedCardCoordinate(point, geometry),
  );
  const sides: CardSide[] = ["top", "right", "bottom", "left"];
  const lines = new Map<CardSide, FittedLine>();

  for (const side of sides) {
    const edgePoints = edgeExtremePoints(coordinates, side);
    if (!edgePoints) return null;
    const line = fitLine(edgePoints);
    if (!line) return null;
    lines.set(side, line);
  }

  const top = lines.get("top");
  const right = lines.get("right");
  const bottom = lines.get("bottom");
  const left = lines.get("left");
  if (!top || !right || !bottom || !left) return null;

  const intersections = [
    intersectLines(top, left),
    intersectLines(top, right),
    intersectLines(bottom, right),
    intersectLines(bottom, left),
  ];
  if (intersections.some((point) => point === null)) return null;

  return intersections.filter((point): point is DetectionPoint => point !== null);
}

function cross(
  origin: DetectionPoint,
  first: DetectionPoint,
  second: DetectionPoint,
): number {
  return (
    (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x)
  );
}

function convexHullPolygon(points: DetectionPoint[]): DetectionPoint[] {
  const uniquePoints = Array.from(
    new Map(
      points.map((point) => [
        `${point.x},${point.y}`,
        { x: point.x, y: point.y },
      ]),
    ).values(),
  ).sort((left, right) => left.x - right.x || left.y - right.y);

  if (uniquePoints.length <= 1) return uniquePoints;

  const lower: DetectionPoint[] = [];
  for (const point of uniquePoints) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: DetectionPoint[] = [];
  for (const point of [...uniquePoints].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function scalePoints(points: DetectionPoint[], scale: number): DetectionPoint[] {
  if (scale === 1) return points;
  return points.map((point) => ({
    x: point.x / scale,
    y: point.y / scale,
  }));
}

function homographyFromCorrespondences(
  sourcePoints: Array<[number, number]>,
  targetPoints: DetectionPoint[],
): Homography | null {
  if (sourcePoints.length !== targetPoints.length || sourcePoints.length < 4) {
    return null;
  }

  const normalMatrix = Array.from({ length: 8 }, () => Array(8).fill(0));
  const normalVector = Array(8).fill(0);

  sourcePoints.forEach(([u, v], index) => {
    const { x, y } = targetPoints[index];
    const rows = [
      [u, v, 1, 0, 0, 0, -x * u, -x * v],
      [0, 0, 0, u, v, 1, -y * u, -y * v],
    ];
    const values = [x, y];

    rows.forEach((row, rowIndex) => {
      for (let i = 0; i < 8; i++) {
        normalVector[i] += row[i] * values[rowIndex];
        for (let j = 0; j < 8; j++) {
          normalMatrix[i][j] += row[i] * row[j];
        }
      }
    });
  });

  const solution = solveLinearSystem(normalMatrix, normalVector);
  if (!solution) return null;

  return [
    [solution[0], solution[1], solution[2]],
    [solution[3], solution[4], solution[5]],
    [solution[6], solution[7], 1],
  ];
}

function projectPoint(homography: Homography, [u, v]: [number, number]): DetectionPoint {
  const denominator = homography[2][0] * u + homography[2][1] * v + homography[2][2];
  const safeDenominator = Math.abs(denominator) < 1e-8 ? 1e-8 : denominator;
  return {
    x: (homography[0][0] * u + homography[0][1] * v + homography[0][2]) /
      safeDenominator,
    y: (homography[1][0] * u + homography[1][1] * v + homography[1][2]) /
      safeDenominator,
  };
}

function invertHomography(homography: Homography): Homography | null {
  const [
    [a, b, c],
    [d, e, f],
    [g, h, i],
  ] = homography;
  const determinant =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);

  if (Math.abs(determinant) < 1e-8) return null;

  return [
    [
      (e * i - f * h) / determinant,
      (c * h - b * i) / determinant,
      (b * f - c * e) / determinant,
    ],
    [
      (f * g - d * i) / determinant,
      (a * i - c * g) / determinant,
      (c * d - a * f) / determinant,
    ],
    [
      (d * h - e * g) / determinant,
      (b * g - a * h) / determinant,
      (a * e - b * d) / determinant,
    ],
  ];
}

function pointsToCardCoordinates(
  homography: Homography,
  points: DetectionPoint[],
): DetectionPoint[] {
  const inverse = invertHomography(homography);
  if (!inverse) return [];

  return points
    .map((point) => projectPoint(inverse, [point.x, point.y]))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function cardCornerHomography(cardCorners: DetectionPoint[]): Homography | null {
  if (cardCorners.length !== 4) return null;

  return homographyFromCorrespondences(
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    cardCorners,
  );
}

function projectedCardPolygon(homography: Homography): DetectionPoint[] {
  const points: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  return points.map((point) => projectPoint(homography, point));
}

function polygonArea(polygon: DetectionPoint[]): number {
  if (polygon.length < 3) return 0;

  let total = 0;
  for (let index = 0; index < polygon.length; index++) {
    const point = polygon[index];
    const nextPoint = polygon[(index + 1) % polygon.length];
    total += point.x * nextPoint.y - nextPoint.x * point.y;
  }
  return Math.abs(total) * 0.5;
}

function projectiveGeometryIsReasonable(
  projectivePolygon: DetectionPoint[],
  geometryPolygon: DetectionPoint[],
): boolean {
  const geometryArea = polygonArea(geometryPolygon);
  const projectiveArea = polygonArea(projectivePolygon);
  if (geometryArea <= 1e-6 || projectiveArea <= 1e-6) return false;

  const areaRatio = projectiveArea / geometryArea;
  return areaRatio >= 0.8 && areaRatio <= 1.2;
}

function centerAlignmentIsReasonable(
  homography: Homography,
  center: DetectionPoint | null,
  cardPolygon: DetectionPoint[],
): boolean {
  if (!center) return true;

  const projectedCenter = projectPoint(homography, [0.5, 0.5]);
  const distance = Math.hypot(
    projectedCenter.x - center.x,
    projectedCenter.y - center.y,
  );
  const sideLengths = cardPolygon.map((point, index) => {
    const nextPoint = cardPolygon[(index + 1) % cardPolygon.length];
    return Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y);
  });
  const threshold = Math.max(12, median(sideLengths) * 0.15);
  return distance <= threshold;
}

function fitGridAxis(
  values: number[],
  count: number,
  [minStep, maxStep]: [number, number],
): number[] | null {
  if (values.length < count) return null;

  let stepCandidates: number[] = [];
  for (let leftIndex = 0; leftIndex < values.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex++) {
      const distance = Math.abs(values[rightIndex] - values[leftIndex]);
      for (let gap = 1; gap < count; gap++) {
        const step = distance / gap;
        if (step >= minStep && step <= maxStep) {
          stepCandidates.push(step);
        }
      }
    }
  }

  if (stepCandidates.length > 0) {
    const quantileCandidates = Array.from({ length: 21 }, (_, index) =>
      quantile(stepCandidates, index / 20),
    );
    stepCandidates = Array.from(new Set([...stepCandidates, ...quantileCandidates]));
  } else {
    stepCandidates = Array.from({ length: 25 }, (_, index) =>
      minStep + ((maxStep - minStep) * index) / 24,
    );
  }

  let best:
    | {
        assignedCount: number;
        residualMean: number;
        centerDistance: number;
        step: number;
        offset: number;
        labels: number[];
        accepted: boolean[];
      }
    | null = null;

  for (const step of stepCandidates) {
    const offsets = values.flatMap((value) =>
      Array.from({ length: count }, (_, index) => value - step * index),
    );

    for (const offset of offsets) {
      const centers = Array.from({ length: count }, (_, index) => offset + step * index);
      const labels = values.map((value) => {
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        centers.forEach((center, index) => {
          const distance = Math.abs(value - center);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
          }
        });
        return bestIndex;
      });
      const residuals = values.map((value, index) =>
        Math.abs(value - centers[labels[index]]),
      );
      const accepted = residuals.map((residual) => residual < step * 0.32);
      const acceptedIndexes = labels.filter((_, index) => accepted[index]);
      if (acceptedIndexes.length === 0) continue;

      const assignedCount = new Set(acceptedIndexes).size;
      const residualMean =
        residuals
          .filter((_, index) => accepted[index])
          .reduce((total, residual) => total + residual * residual, 0) /
        acceptedIndexes.length;
      const centerDistance = Math.abs((centers[0] + centers[count - 1]) * 0.5 - 0.5);

      if (
        !best ||
        assignedCount > best.assignedCount ||
        (assignedCount === best.assignedCount &&
          (residualMean < best.residualMean ||
            (residualMean === best.residualMean &&
              centerDistance < best.centerDistance)))
      ) {
        best = {
          assignedCount,
          residualMean,
          centerDistance,
          step,
          offset,
          labels,
          accepted,
        };
      }
    }
  }

  if (!best) return null;

  const centers = Array.from(
    { length: count },
    (_, index) => best!.offset + best!.step * index,
  );
  const assigned = Array(count).fill(false);
  for (let index = 0; index < count; index++) {
    const assignedValues = values.filter(
      (_, valueIndex) => best!.accepted[valueIndex] && best!.labels[valueIndex] === index,
    );
    if (assignedValues.length > 0) {
      centers[index] = median(assignedValues);
      assigned[index] = true;
    }
  }

  const assignedIndexes = assigned
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);
  if (assignedIndexes.length >= 2) {
    const meanIndex =
      assignedIndexes.reduce((total, index) => total + index, 0) /
      assignedIndexes.length;
    const meanCenter =
      assignedIndexes.reduce((total, index) => total + centers[index], 0) /
      assignedIndexes.length;
    const variance = assignedIndexes.reduce(
      (total, index) => total + (index - meanIndex) ** 2,
      0,
    );
    if (variance > 1e-8) {
      const covariance = assignedIndexes.reduce(
        (total, index) =>
          total + (index - meanIndex) * (centers[index] - meanCenter),
        0,
      );
      const slope = covariance / variance;
      const intercept = meanCenter - slope * meanIndex;
      assigned.forEach((value, index) => {
        if (!value) centers[index] = intercept + slope * index;
      });
    }
  }

  centers.sort((left, right) => left - right);
  if (centers.some((center) => center < -0.05 || center > 1.05)) return null;
  for (let index = 1; index < centers.length; index++) {
    if (centers[index] <= centers[index - 1]) return null;
  }

  return centers;
}

function fitGridAxisAbsolute(
  values: number[],
  count: number,
  [minStep, maxStep]: [number, number],
): number[] | null {
  if (values.length < count) return null;

  let stepCandidates: number[] = [];
  for (let leftIndex = 0; leftIndex < values.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex++) {
      const distance = Math.abs(values[rightIndex] - values[leftIndex]);
      for (let gap = 1; gap < count; gap++) {
        const step = distance / gap;
        if (step >= minStep && step <= maxStep) {
          stepCandidates.push(step);
        }
      }
    }
  }

  if (stepCandidates.length > 0) {
    const quantileCandidates = Array.from({ length: 21 }, (_, index) =>
      quantile(stepCandidates, index / 20),
    );
    stepCandidates = Array.from(new Set([...stepCandidates, ...quantileCandidates]));
  } else {
    stepCandidates = Array.from({ length: 25 }, (_, index) =>
      minStep + ((maxStep - minStep) * index) / 24,
    );
  }

  let best:
    | {
        assignedCount: number;
        residualMean: number;
        centerDistance: number;
        step: number;
        offset: number;
        labels: number[];
        accepted: boolean[];
      }
    | null = null;

  for (const step of stepCandidates) {
    const offsets = values.flatMap((value) =>
      Array.from({ length: count }, (_, index) => value - step * index),
    );

    for (const offset of offsets) {
      const centers = Array.from({ length: count }, (_, index) => offset + step * index);
      const labels = values.map((value) => {
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        centers.forEach((center, index) => {
          const distance = Math.abs(value - center);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
          }
        });
        return bestIndex;
      });
      const residuals = values.map((value, index) =>
        Math.abs(value - centers[labels[index]]),
      );
      const accepted = residuals.map((residual) => residual < step * 0.32);
      const acceptedIndexes = labels.filter((_, index) => accepted[index]);
      if (acceptedIndexes.length === 0) continue;

      const assignedCount = new Set(acceptedIndexes).size;
      const residualMean =
        residuals
          .filter((_, index) => accepted[index])
          .reduce((total, residual) => total + residual * residual, 0) /
        acceptedIndexes.length;
      const centerDistance = Math.abs(
        (centers[0] + centers[count - 1]) * 0.5 - median(values),
      );

      if (
        !best ||
        assignedCount > best.assignedCount ||
        (assignedCount === best.assignedCount &&
          (residualMean < best.residualMean ||
            (residualMean === best.residualMean &&
              centerDistance < best.centerDistance)))
      ) {
        best = {
          assignedCount,
          residualMean,
          centerDistance,
          step,
          offset,
          labels,
          accepted,
        };
      }
    }
  }

  if (!best) return null;

  const centers = Array.from(
    { length: count },
    (_, index) => best!.offset + best!.step * index,
  );
  const assigned = Array(count).fill(false);
  for (let index = 0; index < count; index++) {
    const assignedValues = values.filter(
      (_, valueIndex) => best!.accepted[valueIndex] && best!.labels[valueIndex] === index,
    );
    if (assignedValues.length > 0) {
      centers[index] = median(assignedValues);
      assigned[index] = true;
    }
  }

  const assignedIndexes = assigned
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);
  if (assignedIndexes.length >= 2) {
    const meanIndex =
      assignedIndexes.reduce((total, index) => total + index, 0) /
      assignedIndexes.length;
    const meanCenter =
      assignedIndexes.reduce((total, index) => total + centers[index], 0) /
      assignedIndexes.length;
    const variance = assignedIndexes.reduce(
      (total, index) => total + (index - meanIndex) ** 2,
      0,
    );
    if (variance > 1e-8) {
      const covariance = assignedIndexes.reduce(
        (total, index) =>
          total + (index - meanIndex) * (centers[index] - meanCenter),
        0,
      );
      const slope = covariance / variance;
      const intercept = meanCenter - slope * meanIndex;
      assigned.forEach((value, index) => {
        if (!value) centers[index] = intercept + slope * index;
      });
    }
  }

  centers.sort((left, right) => left - right);
  for (let index = 1; index < centers.length; index++) {
    if (centers[index] <= centers[index - 1]) return null;
  }

  return centers;
}

function clusterAxisValues(
  values: number[],
  clusterGap: number,
): { centers: number[]; weights: number[] } {
  if (values.length === 0) return { centers: [], weights: [] };

  const sorted = [...values].sort((left, right) => left - right);
  const groups: number[][] = [[sorted[0]]];
  for (const value of sorted.slice(1)) {
    const current = groups[groups.length - 1];
    if (Math.abs(value - current[current.length - 1]) > clusterGap) {
      groups.push([value]);
    } else {
      current.push(value);
    }
  }

  return {
    centers: groups.map((group) => median(group)),
    weights: groups.map((group) => group.length),
  };
}

function combinationIndexes(length: number, size: number): number[][] {
  const results: number[][] = [];
  const current: number[] = [];

  function visit(start: number): void {
    if (current.length === size) {
      results.push([...current]);
      return;
    }
    for (let index = start; index <= length - (size - current.length); index++) {
      current.push(index);
      visit(index + 1);
      current.pop();
    }
  }

  visit(0);
  return results;
}

function weightedLineFit(
  xs: number[],
  ys: number[],
  weights: number[],
): { slope: number; intercept: number } | null {
  const weightTotal = weights.reduce((total, value) => total + value, 0);
  if (weightTotal <= 0) return null;

  const meanX =
    xs.reduce((total, value, index) => total + value * weights[index], 0) /
    weightTotal;
  const meanY =
    ys.reduce((total, value, index) => total + value * weights[index], 0) /
    weightTotal;
  const variance = xs.reduce(
    (total, value, index) => total + weights[index] * (value - meanX) ** 2,
    0,
  );
  if (variance <= 1e-8) return null;

  const covariance = xs.reduce(
    (total, value, index) =>
      total + weights[index] * (value - meanX) * (ys[index] - meanY),
    0,
  );
  const slope = covariance / variance;
  return { slope, intercept: meanY - slope * meanX };
}

function compareTuple(left: number[], right: number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return left.length - right.length;
}

function fitGridAxisClustered(
  values: number[],
  count: number,
  [minStep, maxStep]: [number, number],
  clusterGap: number,
): number[] | null {
  const clustered = clusterAxisValues(values, clusterGap);
  let clusteredCenters = clustered.centers;
  let clusteredWeights = clustered.weights;

  if (clusteredCenters.length > 12) {
    const keepIndexes = clusteredWeights
      .map((weight, index) => ({ weight, index }))
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 12)
      .map(({ index }) => index)
      .sort((left, right) => left - right);
    clusteredCenters = keepIndexes.map((index) => clusteredCenters[index]);
    clusteredWeights = keepIndexes.map((index) => clusteredWeights[index]);
  }

  const minimumAssignments = Math.max(3, count - 2);
  if (clusteredCenters.length < minimumAssignments) return null;

  let bestScore: [number, number, number, number] | null = null;
  let bestCenters: number[] | null = null;
  const maxSubsetSize = Math.min(count, clusteredCenters.length);

  for (let subsetSize = maxSubsetSize; subsetSize >= minimumAssignments; subsetSize--) {
    for (const clusterIndexes of combinationIndexes(clusteredCenters.length, subsetSize)) {
      const observed = clusterIndexes.map((index) => clusteredCenters[index]);
      const weights = clusterIndexes.map((index) => clusteredWeights[index]);
      if (observed.length < 2) continue;

      for (const axisIndexes of combinationIndexes(count, subsetSize)) {
        const fit = weightedLineFit(axisIndexes, observed, weights);
        if (!fit || fit.slope <= 0) continue;
        if (fit.slope < minStep * 0.75 || fit.slope > maxStep * 1.35) continue;

        const observedDiffs = observed
          .slice(1)
          .map((value, index) => value - observed[index]);
        if (
          observedDiffs.length > 0 &&
          (Math.min(...observedDiffs) < fit.slope * 0.65 ||
            Math.max(...observedDiffs) > fit.slope * 1.45)
        ) {
          continue;
        }

        const centers = Array.from(
          { length: count },
          (_, index) => fit.intercept + fit.slope * index,
        );
        if (centers.some((center, index) => index > 0 && center <= centers[index - 1])) {
          continue;
        }

        const weightTotal = weights.reduce((total, value) => total + value, 0);
        const residual =
          observed.reduce((total, value, index) => {
            const predicted = fit.intercept + fit.slope * axisIndexes[index];
            return total + weights[index] * (value - predicted) ** 2;
          }, 0) / weightTotal;
        const normalizedResidual = residual / Math.max(fit.slope * fit.slope, 1e-6);
        const assignedIndexes = new Set(axisIndexes);
        const missing = Array.from({ length: count }, (_, index) => index).filter(
          (index) => !assignedIndexes.has(index),
        );
        const edgeMissing =
          (missing.includes(0) ? 1 : 0) + (missing.includes(count - 1) ? 1 : 0);
        const interiorMissing = missing.length - edgeMissing;
        const score: [number, number, number, number] = [
          normalizedResidual + interiorMissing * 12 + edgeMissing * 1.5,
          -weightTotal,
          interiorMissing,
          edgeMissing,
        ];

        if (!bestScore || compareTuple(score, bestScore) < 0) {
          bestScore = score;
          bestCenters = centers;
        }
      }
    }
  }

  return bestCenters;
}

function detectPatchGridCandidates(imageData: ImageData): PatchGridCandidate[] {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dataIndex = getPixelIndex(x, y, width);
      const red = data[dataIndex];
      const green = data[dataIndex + 1];
      const blue = data[dataIndex + 2];
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
      mask[y * width + x] = spread > 40 && luma > 30 && luma < 245 ? 1 : 0;
    }
  }

  const refinedMask = dilateMask(erodeMask(mask, width, height), width, height);
  const minArea = Math.max(12, Math.round(width * height * 0.00003));
  const components = findConnectedComponentsWithMinArea(
    refinedMask,
    width,
    height,
    minArea,
  );
  const candidates: PatchGridCandidate[] = [];
  const maxComponentSide = Math.max(28, Math.min(width, height) * 0.16);

  for (const component of components) {
    const xs = component.map((point) => point.x);
    const ys = component.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const minSide = Math.min(componentWidth, componentHeight);
    const maxSide = Math.max(componentWidth, componentHeight);
    const fillRatio = component.length / Math.max(componentWidth * componentHeight, 1);

    if (minSide < 6 || minSide > maxComponentSide) continue;
    if (maxSide < 8 || maxSide > maxComponentSide * 1.35) continue;
    if (fillRatio < 0.45) continue;
    if (maxSide / Math.max(minSide, 1) > 3) continue;

    candidates.push({
      center: {
        x: xs.reduce((total, value) => total + value, 0) / xs.length,
        y: ys.reduce((total, value) => total + value, 0) / ys.length,
      },
      width: componentWidth,
      height: componentHeight,
      area: component.length,
      fillRatio,
    });
  }

  return candidates
    .sort((left, right) => right.area - left.area)
    .slice(0, MAX_PATCH_GRID_CANDIDATES);
}

function principalAxes(points: DetectionPoint[]): [DetectionPoint, DetectionPoint] | null {
  if (points.length < 2) return null;

  const meanX = points.reduce((total, point) => total + point.x, 0) / points.length;
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
  let covXX = 0;
  let covXY = 0;
  let covYY = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    covXX += dx * dx;
    covXY += dx * dy;
    covYY += dy * dy;
  }
  covXX /= points.length;
  covXY /= points.length;
  covYY /= points.length;

  const angle = 0.5 * Math.atan2(2 * covXY, covXX - covYY);
  const first = { x: Math.cos(angle), y: Math.sin(angle) };
  const second = { x: -first.y, y: first.x };
  return [first, second];
}

function dotPoint(point: DetectionPoint, axis: DetectionPoint): number {
  return point.x * axis.x + point.y * axis.y;
}

function fitPatchGridFromCandidates(
  candidates: PatchGridCandidate[],
): PatchGridFit | null {
  if (candidates.length < MIN_PATCH_GRID_PAIRS) return null;

  const centers = candidates.map((candidate) => candidate.center);
  const patchSides = candidates.map((candidate) =>
    Math.min(candidate.width, candidate.height),
  );
  const medianPatchSide = median(patchSides);
  if (medianPatchSide <= 0) return null;

  const stepRange: [number, number] = [
    Math.max(5, medianPatchSide * 0.75),
    medianPatchSide * 2.7,
  ];
  const clusterGap = Math.max(3, medianPatchSide * 0.45);
  let bestFit: PatchGridFit | null = null;
  let bestPairCount = 0;
  let bestResidual = Number.POSITIVE_INFINITY;
  const seenNeighborhoods = new Set<string>();

  for (const seed of centers) {
    const neighborhoodIndexes = centers
      .map((center, index) =>
        Math.hypot(center.x - seed.x, center.y - seed.y) < medianPatchSide * 8
          ? index
          : -1,
      )
      .filter((index) => index >= 0);
    if (neighborhoodIndexes.length < MIN_PATCH_GRID_PAIRS) continue;

    const neighborhoodKey = neighborhoodIndexes.join(",");
    if (seenNeighborhoods.has(neighborhoodKey)) continue;
    seenNeighborhoods.add(neighborhoodKey);

    const neighborhood = neighborhoodIndexes.map((index) => centers[index]);

    const axes = principalAxes(neighborhood);
    if (!axes) continue;

    for (const swapAxes of [false, true]) {
      const uAxis = swapAxes ? axes[1] : axes[0];
      const vAxis = swapAxes ? axes[0] : axes[1];
      const projectedU = centers.map((center) => dotPoint(center, uAxis));
      const projectedV = centers.map((center) => dotPoint(center, vAxis));
      const uCenters = fitGridAxisClustered(projectedU, 6, stepRange, clusterGap);
      const vCenters = fitGridAxisClustered(projectedV, 4, stepRange, clusterGap);
      if (!uCenters || !vCenters) continue;

      const uStep = median(
        uCenters.slice(1).map((center, index) => center - uCenters[index]),
      );
      const vStep = median(
        vCenters.slice(1).map((center, index) => center - vCenters[index]),
      );
      const acceptedPairs = new Set<string>();
      let residualTotal = 0;
      let acceptedCount = 0;

      for (let index = 0; index < centers.length; index++) {
        const uLabel = closestIndex(projectedU[index], uCenters);
        const vLabel = closestIndex(projectedV[index], vCenters);
        const uResidual = Math.abs(projectedU[index] - uCenters[uLabel]);
        const vResidual = Math.abs(projectedV[index] - vCenters[vLabel]);
        if (uResidual >= uStep * 0.35 || vResidual >= vStep * 0.35) {
          continue;
        }

        acceptedPairs.add(`${uLabel}:${vLabel}`);
        residualTotal += uResidual * uResidual + vResidual * vResidual;
        acceptedCount++;
      }

      const pairCount = acceptedPairs.size;
      if (pairCount < MIN_PATCH_GRID_PAIRS || acceptedCount === 0) continue;

      const residualMean = residualTotal / acceptedCount;
      if (
        pairCount > bestPairCount ||
        (pairCount === bestPairCount && residualMean < bestResidual)
      ) {
        bestPairCount = pairCount;
        bestResidual = residualMean;
        bestFit = {
          uAxis,
          vAxis,
          uCenters,
          vCenters,
          pairCount,
          residualMean,
        };
      }
    }
  }

  return bestFit;
}

function closestIndex(value: number, centers: number[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  centers.forEach((center, index) => {
    const distance = Math.abs(value - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const meanX = xs.reduce((total, value) => total + value, 0) / xs.length;
  const meanY = ys.reduce((total, value) => total + value, 0) / ys.length;
  const variance = xs.reduce((total, value) => total + (value - meanX) ** 2, 0);
  if (variance <= 1e-8) return { slope: 0, intercept: meanY };
  const covariance = xs.reduce(
    (total, value, index) => total + (value - meanX) * (ys[index] - meanY),
    0,
  );
  const slope = covariance / variance;
  return { slope, intercept: meanY - slope * meanX };
}

function cardCornersFromPatchGridFit(fit: PatchGridFit): DetectionPoint[] {
  const canonicalUCenters = Array.from(
    { length: 6 },
    (_, index) => GRID_U_START + ((GRID_U_END - GRID_U_START) / 6) * (index + 0.5),
  );
  const canonicalVCenters = Array.from(
    { length: 4 },
    (_, index) => GRID_V_START + ((GRID_V_END - GRID_V_START) / 4) * (index + 0.5),
  );
  const uFit = linearFit(canonicalUCenters, fit.uCenters);
  const vFit = linearFit(canonicalVCenters, fit.vCenters);

  return [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([uFraction, vFraction]) => {
    const projectedU = uFit.slope * uFraction + uFit.intercept;
    const projectedV = vFit.slope * vFraction + vFit.intercept;
    return {
      x: fit.uAxis.x * projectedU + fit.vAxis.x * projectedV,
      y: fit.uAxis.y * projectedU + fit.vAxis.y * projectedV,
    };
  });
}

function shiftPatchGridFit(
  fit: PatchGridFit,
  uSteps: number,
  vSteps: number,
): PatchGridFit {
  const uStep = median(
    fit.uCenters.slice(1).map((center, index) => center - fit.uCenters[index]),
  );
  const vStep = median(
    fit.vCenters.slice(1).map((center, index) => center - fit.vCenters[index]),
  );
  return {
    ...fit,
    uCenters: fit.uCenters.map((center) => center + uSteps * uStep),
    vCenters: fit.vCenters.map((center) => center + vSteps * vStep),
  };
}

function detectPatchGridModel(
  imageData: ImageData,
  component: DetectionPoint[],
  homography: Homography,
): PatchGridModel | null {
  const interior = cardInteriorMask(component, imageData.width, imageData.height);
  const candidate = new Uint8Array(imageData.width * imageData.height);

  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const pixelIndex = y * imageData.width + x;
      if (!interior[pixelIndex]) continue;

      const dataIndex = getPixelIndex(x, y, imageData.width);
      const red = imageData.data[dataIndex];
      const green = imageData.data[dataIndex + 1];
      const blue = imageData.data[dataIndex + 2];
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const spread =
        Math.max(red, green, blue) - Math.min(red, green, blue);
      candidate[pixelIndex] = luma > 42 && (spread > 14 || luma > 82) ? 1 : 0;
    }
  }

  const candidateMask = dilateMask(
    erodeMask(candidate, imageData.width, imageData.height),
    imageData.width,
    imageData.height,
  );
  const minArea = Math.max(
    8,
    Math.round(
      interior.reduce((total, value) => total + value, 0) * 0.00025,
    ),
  );
  const components = findConnectedComponentsWithMinArea(
    candidateMask,
    imageData.width,
    imageData.height,
    minArea,
  );
  const patchCandidates: Array<{
    centerU: number;
    centerV: number;
    width: number;
    height: number;
  }> = [];

  for (const candidateComponent of components) {
    const localPoints = pointsToCardCoordinates(homography, candidateComponent);
    if (localPoints.length === 0) continue;

    const uValues = localPoints.map((point) => point.x);
    const vValues = localPoints.map((point) => point.y);
    const centerU = median(uValues);
    const centerV = median(vValues);
    const width = quantile(uValues, 0.9) - quantile(uValues, 0.1);
    const height = quantile(vValues, 0.9) - quantile(vValues, 0.1);
    const aspect = width / Math.max(height, 1e-6);

    if (centerU < 0.06 || centerU > 0.94 || centerV < 0.08 || centerV > 0.92) {
      continue;
    }
    if (width < 0.025 || width > 0.16 || height < 0.025 || height > 0.22) {
      continue;
    }
    if (aspect < 0.28 || aspect > 2.4) continue;

    patchCandidates.push({ centerU, centerV, width, height });
  }

  if (patchCandidates.length < MIN_PATCH_COMPONENTS) return null;

  const uCenters = fitGridAxis(
    patchCandidates.map((candidatePatch) => candidatePatch.centerU),
    6,
    PATCH_U_STEP_RANGE,
  );
  const vCenters = fitGridAxis(
    patchCandidates.map((candidatePatch) => candidatePatch.centerV),
    4,
    PATCH_V_STEP_RANGE,
  );
  if (!uCenters || !vCenters) return null;

  const uStep = median(
    uCenters.slice(1).map((center, index) => center - uCenters[index]),
  );
  const vStep = median(
    vCenters.slice(1).map((center, index) => center - vCenters[index]),
  );
  const medianWidth = median(patchCandidates.map((candidatePatch) => candidatePatch.width));
  const medianHeight = median(patchCandidates.map((candidatePatch) => candidatePatch.height));

  return {
    uCenters,
    vCenters,
    halfU: Math.max(uStep * 0.22, Math.min(medianWidth * 0.45, uStep * 0.34)),
    halfV: Math.max(vStep * 0.22, Math.min(medianHeight * 0.45, vStep * 0.34)),
  };
}

function sampleRgb(
  imageData: ImageData,
  center: DetectionPoint,
  radius: number,
): [number, number, number] {
  const { width, height, data } = imageData;
  const centerX = Math.round(center.x);
  const centerY = Math.round(center.y);
  const x0 = Math.max(0, centerX - radius);
  const x1 = Math.min(width - 1, centerX + radius);
  const y0 = Math.max(0, centerY - radius);
  const y1 = Math.min(height - 1, centerY + radius);
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let count = 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const index = getPixelIndex(x, y, width);
      redTotal += data[index];
      greenTotal += data[index + 1];
      blueTotal += data[index + 2];
      count++;
    }
  }

  if (count === 0) return [0, 0, 0];
  return [
    Math.round(redTotal / count),
    Math.round(greenTotal / count),
    Math.round(blueTotal / count),
  ];
}

function sampleCheckerGrid(
  imageData: ImageData,
  geometry: CandidateGeometry,
): LocalPatchSample[] {
  const gridWidth =
    (geometry.maxU - geometry.minU) * (GRID_U_END - GRID_U_START);
  const gridHeight =
    (geometry.maxV - geometry.minV) * (GRID_V_END - GRID_V_START);
  const cellSize = Math.min(gridWidth / 6, gridHeight / 4);
  const sampleRadius = Math.max(3, Math.round(cellSize * 0.22));
  const halfU = (gridWidth / 6) * 0.32;
  const halfV = (gridHeight / 4) * 0.32;
  const samples: LocalPatchSample[] = [];

  for (let row = 0; row < 4; row++) {
    const vFraction =
      GRID_V_START + (GRID_V_END - GRID_V_START) * ((row + 0.5) / 4);
    for (let col = 0; col < 6; col++) {
      const uFraction =
        GRID_U_START + (GRID_U_END - GRID_U_START) * ((col + 0.5) / 6);
      const center = pointFromLocal(geometry, uFraction, vFraction);
      const uCenter = geometry.minU + uFraction * (geometry.maxU - geometry.minU);
      const vCenter = geometry.minV + vFraction * (geometry.maxV - geometry.minV);
      const polygon = [
        { u: uCenter - halfU, v: vCenter - halfV },
        { u: uCenter + halfU, v: vCenter - halfV },
        { u: uCenter + halfU, v: vCenter + halfV },
        { u: uCenter - halfU, v: vCenter + halfV },
      ].map(({ u, v }) => ({
        x: geometry.centerX + geometry.uX * u + geometry.vX * v,
        y: geometry.centerY + geometry.uY * u + geometry.vY * v,
      }));

      samples.push({
        measuredRgb: sampleRgb(imageData, center, sampleRadius),
        center,
        polygon,
      });
    }
  }

  return samples;
}

function sampleCheckerGridProjective(
  imageData: ImageData,
  homography: Homography,
  gridModel?: PatchGridModel | null,
): LocalPatchSample[] {
  const gridWidth = GRID_U_END - GRID_U_START;
  const gridHeight = GRID_V_END - GRID_V_START;
  const cellU = gridWidth / 6;
  const cellV = gridHeight / 4;
  const uCenters =
    gridModel?.uCenters ??
    Array.from({ length: 6 }, (_, col) => GRID_U_START + cellU * (col + 0.5));
  const vCenters =
    gridModel?.vCenters ??
    Array.from({ length: 4 }, (_, row) => GRID_V_START + cellV * (row + 0.5));
  const halfU = gridModel?.halfU ?? cellU * 0.32;
  const halfV = gridModel?.halfV ?? cellV * 0.32;
  const centers: DetectionPoint[] = [];

  for (const vFraction of vCenters) {
    for (const uFraction of uCenters) {
      centers.push(projectPoint(homography, [uFraction, vFraction]));
    }
  }

  const adjacentDistances: number[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      const left = centers[row * 6 + col];
      const right = centers[row * 6 + col + 1];
      adjacentDistances.push(Math.hypot(right.x - left.x, right.y - left.y));
    }
  }
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const top = centers[row * 6 + col];
      const bottom = centers[(row + 1) * 6 + col];
      adjacentDistances.push(Math.hypot(bottom.x - top.x, bottom.y - top.y));
    }
  }

  const sampleRadius = Math.max(3, Math.round(median(adjacentDistances) * 0.22));
  const samples: LocalPatchSample[] = [];

  for (let row = 0; row < vCenters.length; row++) {
    const vFraction = vCenters[row];
    for (let col = 0; col < uCenters.length; col++) {
      const uFraction = uCenters[col];
      const center = centers[row * 6 + col];
      const polygonPoints: Array<[number, number]> = [
        [uFraction - halfU, vFraction - halfV],
        [uFraction + halfU, vFraction - halfV],
        [uFraction + halfU, vFraction + halfV],
        [uFraction - halfU, vFraction + halfV],
      ];
      const polygon = polygonPoints.map((point) => projectPoint(homography, point));

      samples.push({
        measuredRgb: sampleRgb(imageData, center, sampleRadius),
        center,
        polygon,
      });
    }
  }

  return samples;
}

function localIndexForReference(
  patchIndex: number,
  flipRows: boolean,
  flipCols: boolean,
): number {
  const row = Math.floor(patchIndex / 6);
  const col = patchIndex % 6;
  const measuredRow = flipRows ? 3 - row : row;
  const measuredCol = flipCols ? 5 - col : col;
  return measuredRow * 6 + measuredCol;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let pivot = 0; pivot < size; pivot++) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < size; row++) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row;
      }
    }

    if (Math.abs(augmented[maxRow][pivot]) < 1e-8) return null;
    [augmented[pivot], augmented[maxRow]] = [
      augmented[maxRow],
      augmented[pivot],
    ];

    const pivotValue = augmented[pivot][pivot];
    for (let col = pivot; col <= size; col++) {
      augmented[pivot][col] /= pivotValue;
    }

    for (let row = 0; row < size; row++) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let col = pivot; col <= size; col++) {
        augmented[row][col] -= factor * augmented[pivot][col];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function affineResidualScore(samples: LocalPatchSample[]): number {
  const features = samples.map((sample) => [
    sample.measuredRgb[0] / 255,
    sample.measuredRgb[1] / 255,
    sample.measuredRgb[2] / 255,
    1,
  ]);
  const references = REFERENCE_RGB.map((rgb) => [
    rgb[0] / 255,
    rgb[1] / 255,
    rgb[2] / 255,
  ]);

  const normalMatrix = Array.from({ length: 4 }, () => Array(4).fill(0));
  const normalVectors = Array.from({ length: 3 }, () => Array(4).fill(0));

  for (let row = 0; row < features.length; row++) {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        normalMatrix[i][j] += features[row][i] * features[row][j];
      }
      for (let channel = 0; channel < 3; channel++) {
        normalVectors[channel][i] +=
          features[row][i] * references[row][channel];
      }
    }
  }

  const coefficients = normalVectors.map((normalVector) =>
    solveLinearSystem(normalMatrix, normalVector),
  );
  if (coefficients.some((value) => value === null)) {
    return Number.POSITIVE_INFINITY;
  }

  let totalResidual = 0;
  for (let row = 0; row < features.length; row++) {
    let channelResidual = 0;
    for (let channel = 0; channel < 3; channel++) {
      const coefficient = coefficients[channel]!;
      const predicted = Math.max(
        0,
        Math.min(
          1,
          features[row][0] * coefficient[0] +
            features[row][1] * coefficient[1] +
            features[row][2] * coefficient[2] +
            coefficient[3],
        ),
      );
      const delta = predicted - references[row][channel];
      channelResidual += delta * delta;
    }
    totalResidual += Math.sqrt(channelResidual);
  }

  return (totalResidual / features.length) * 255;
}

function orientSamples(
  localSamples: LocalPatchSample[],
  flipRows: boolean,
  flipCols: boolean,
): LocalPatchSample[] {
  return COLORCHECKER_REFERENCE.map((_, patchIndex) => {
    const localIndex = localIndexForReference(patchIndex, flipRows, flipCols);
    return localSamples[localIndex];
  });
}

function bestOrientedSamples(localSamples: LocalPatchSample[]) {
  let bestScore = Number.POSITIVE_INFINITY;
  let bestSamples = localSamples;

  for (const flipRows of [false, true]) {
    for (const flipCols of [false, true]) {
      const samples = orientSamples(localSamples, flipRows, flipCols);
      const score = affineResidualScore(samples);
      if (score < bestScore) {
        bestScore = score;
        bestSamples = samples;
      }
    }
  }

  return { score: bestScore, samples: bestSamples };
}

function detectionFromSamples(
  score: number,
  polygon: DetectionPoint[],
  fiducials: ColorCheckerFiducials,
  samples: LocalPatchSample[],
): ColorCheckerDetection {
  return {
    score: Math.round(score * 100) / 100,
    confidence:
      Math.round(
        Math.max(0, Math.min(1, 1 - (score / MAX_ACCEPTED_SCORE) * 0.75)) *
          100,
      ) / 100,
    polygon,
    fiducials,
    patches: samples.map((sample, patchIndex) => ({
      patchIndex,
      measuredRgb: sample.measuredRgb,
      center: sample.center,
      polygon: sample.polygon,
    })),
  };
}

function detectColorCheckerFromPatchGrid(
  scaledImageData: ImageData,
  fullImageData: ImageData,
  scale: number,
): ColorCheckerDetection | null {
  const candidates = detectPatchGridCandidates(scaledImageData);
  const fit = fitPatchGridFromCandidates(candidates);
  if (!fit) return null;

  let bestDetection: ColorCheckerDetection | null = null;
  for (let uSteps = -2; uSteps <= 2; uSteps++) {
    for (let vSteps = -1; vSteps <= 1; vSteps++) {
      const shiftedFit = shiftPatchGridFit(fit, uSteps, vSteps);
      const workingCorners = cardCornersFromPatchGridFit(shiftedFit);
      if (
        workingCorners.some(
          (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
        )
      ) {
        continue;
      }

      const originalCorners = scalePoints(workingCorners, scale);
      const homography = cardCornerHomography(originalCorners);
      if (!homography) continue;

      const localSamples = sampleCheckerGridProjective(fullImageData, homography);
      const oriented = bestOrientedSamples(localSamples);
      if (oriented.score > MAX_ACCEPTED_SCORE) continue;

      const detection = detectionFromSamples(
        oriented.score,
        originalCorners,
        {
          center: projectPoint(homography, [0.5, 0.5]),
          corners: originalCorners,
        },
        oriented.samples,
      );
      if (!bestDetection || detection.score < bestDetection.score) {
        bestDetection = detection;
      }
    }
  }

  return bestDetection;
}

function createScaledImageData(canvas: HTMLCanvasElement) {
  const maxSide = Math.max(canvas.width, canvas.height);
  const scale =
    maxSide > DETECTION_MAX_DIMENSION ? DETECTION_MAX_DIMENSION / maxSide : 1;

  if (scale === 1) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return ctx
      ? {
          imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
          scale,
        }
      : null;
  }

  const workingCanvas = document.createElement("canvas");
  workingCanvas.width = Math.max(1, Math.round(canvas.width * scale));
  workingCanvas.height = Math.max(1, Math.round(canvas.height * scale));
  const workingContext = workingCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!workingContext) return null;
  workingContext.drawImage(canvas, 0, 0, workingCanvas.width, workingCanvas.height);
  return {
    imageData: workingContext.getImageData(
      0,
      0,
      workingCanvas.width,
      workingCanvas.height,
    ),
    scale,
  };
}

export function detectColorCheckerFromCanvas(
  canvas: HTMLCanvasElement,
): ColorCheckerDetection | null {
  const scaled = createScaledImageData(canvas);
  const sourceContext = canvas.getContext("2d", { willReadFrequently: true });
  if (!scaled || !sourceContext) return null;

  const { imageData: scaledImageData, scale } = scaled;
  const fullImageData = sourceContext.getImageData(0, 0, canvas.width, canvas.height);
  const mask = buildDarkCardMask(
    scaledImageData.data,
    scaledImageData.width,
    scaledImageData.height,
  );
  const components = findConnectedComponents(
    mask,
    scaledImageData.width,
    scaledImageData.height,
  ).slice(0, MAX_CANDIDATES);

  let bestDetection: ColorCheckerDetection | null = null;

  for (const component of components) {
    const geometry = geometryFromComponent(component);
    if (!geometry) continue;

    const detectedFiducials = detectFiducialPoints(
      scaledImageData,
      component,
      geometry,
    );
    const cardCorners = detectCardCorners(component, geometry);
    const originalGeometry = scaleGeometry(geometry, scale);
    const originalFiducials = scaleFiducials(
      {
        center: detectedFiducials.center,
        corners: cardCorners ?? [],
      },
      scale,
    );
    const workingHomography = cardCorners ? cardCornerHomography(cardCorners) : null;
    const homography = cardCornerHomography(originalFiducials.corners);
    const geometryPolygon = polygonFromGeometry(originalGeometry);
    const contourPolygon = scalePoints(convexHullPolygon(component), scale);
    const projectivePolygon = homography ? projectedCardPolygon(homography) : null;
    let useProjective =
      homography !== null &&
      projectivePolygon !== null &&
      projectiveGeometryIsReasonable(projectivePolygon, geometryPolygon) &&
      centerAlignmentIsReasonable(
        homography,
        originalFiducials.center,
        projectivePolygon,
    );
    let localSamples: LocalPatchSample[];
    let polygon: DetectionPoint[];
    let oriented: ReturnType<typeof bestOrientedSamples> | null = null;

    if (useProjective && homography && projectivePolygon) {
      const gridModel = workingHomography
        ? detectPatchGridModel(scaledImageData, component, workingHomography)
        : null;
      localSamples = sampleCheckerGridProjective(fullImageData, homography, gridModel);
      oriented = bestOrientedSamples(localSamples);
      if (oriented.score > MAX_ACCEPTED_SCORE) {
        useProjective = false;
      }
    }

    if (useProjective && projectivePolygon) {
      polygon = contourPolygon;
    } else {
      localSamples = sampleCheckerGrid(fullImageData, originalGeometry);
      oriented = bestOrientedSamples(localSamples);
      polygon = geometryPolygon;
    }

    if (!oriented) continue;
    const { score, samples } = oriented;
    if (score > MAX_ACCEPTED_SCORE) continue;

    const detection = detectionFromSamples(score, polygon, originalFiducials, samples);

    if (!bestDetection || detection.score < bestDetection.score) {
      bestDetection = detection;
    }
  }

  if (!bestDetection) {
    return detectColorCheckerFromPatchGrid(scaledImageData, fullImageData, scale);
  }

  return bestDetection;
}

export function buildCheckerPatchesFromDetection(
  detection: ColorCheckerDetection | null,
) {
  if (!detection) return null;

  return detection.patches.map((patch) => ({
    reference_lab: COLORCHECKER_REFERENCE[patch.patchIndex].lab,
    measured_rgb: patch.measuredRgb,
  }));
}

export function buildCheckerPatches(measured: MeasuredPatch[]) {
  return measured.map((m) => ({
    reference_lab: COLORCHECKER_REFERENCE[m.patchIndex].lab,
    measured_rgb: m.measuredRgb,
  }));
}
