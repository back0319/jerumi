type Lab = readonly [number, number, number];

/**
 * Euclidean CIELAB distance (CIE76). The backend uses CIEDE2000 for the final
 * recommendation ranking, but for cross-photo consistency checks within the
 * same scene, ΔE76 is precise enough and avoids shipping the full CIEDE2000
 * implementation to the browser.
 */
export function deltaE76(a: Lab, b: Lab): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

export function pairwiseDeltaStats(labs: Lab[]): {
  mean: number;
  max: number;
  count: number;
} {
  if (labs.length < 2) return { mean: 0, max: 0, count: 0 };

  let sum = 0;
  let max = 0;
  let count = 0;
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const d = deltaE76(labs[i], labs[j]);
      sum += d;
      if (d > max) max = d;
      count += 1;
    }
  }
  return { mean: sum / count, max, count };
}
