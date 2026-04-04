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

export function buildCheckerPatches(measured: MeasuredPatch[]) {
  return measured.map((m) => ({
    reference_lab: COLORCHECKER_REFERENCE[m.patchIndex].lab,
    measured_rgb: m.measuredRgb,
  }));
}
