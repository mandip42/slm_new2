/**
 * Calibration mathematics.
 *
 * The relationship between what the phone reports and true sound pressure level
 * is modelled as an affine map:
 *
 *     L_SPL = slope * L_dBFS + intercept
 *
 * A single-point calibration fixes slope = 1 and solves for the intercept. A
 * multi-level calibration fits both by ordinary least squares and reports how
 * well the straight line actually describes the data, so a non-linear device is
 * detected rather than hidden behind an average offset.
 */

import type { LevelCalibrationPoint, LinearFitResult } from '@/storage/types';

/**
 * Slope deviation from unity above which the device is flagged as non-linear.
 *
 * A slope of 1.05 means a 20 dB change at the reference produces a 21 dB change
 * on the phone: 1 dB of error across that span. That is the point at which a
 * constant offset stops being a safe simplification.
 */
export const NONLINEAR_SLOPE_THRESHOLD = 0.05;

/** Single-point calibration: offset only. */
export function singlePointCalibration(referenceDb: number, phoneDbfs: number): {
  slope: number;
  intercept: number;
} {
  return { slope: 1, intercept: referenceDb - phoneDbfs };
}

/**
 * Ordinary least squares fit of referenceDb against phoneDbfs.
 *
 * Returns null when there are fewer than two distinct x values, since a slope is
 * not determined in that case.
 */
export function fitLinearCalibration(
  points: ReadonlyArray<{ referenceDb: number; phoneDbfs: number }>
): LinearFitResult | null {
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.phoneDbfs;
    sumY += p.referenceDb;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.phoneDbfs - meanX;
    sxx += dx * dx;
    sxy += dx * (p.referenceDb - meanY);
  }
  if (sxx === 0) return null; // every measurement at the same phone level

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  const residuals: number[] = [];
  let ssRes = 0;
  let ssTot = 0;
  let maxAbsError = 0;
  let sumAbs = 0;
  for (const p of points) {
    const predicted = slope * p.phoneDbfs + intercept;
    const residual = p.referenceDb - predicted;
    residuals.push(residual);
    ssRes += residual * residual;
    ssTot += (p.referenceDb - meanY) * (p.referenceDb - meanY);
    const abs = Math.abs(residual);
    if (abs > maxAbsError) maxAbsError = abs;
    sumAbs += abs;
  }

  return {
    slope,
    intercept,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 1,
    rmse: Math.sqrt(ssRes / n),
    maxAbsError,
    meanAbsError: sumAbs / n,
    residuals,
    n,
    nonLinear: Math.abs(slope - 1) > NONLINEAR_SLOPE_THRESHOLD,
  };
}

/** Convenience wrapper for stored calibration points. */
export function fitCalibrationPoints(points: readonly LevelCalibrationPoint[]): LinearFitResult | null {
  return fitLinearCalibration(
    points.map((p) => ({ referenceDb: p.referenceDb, phoneDbfs: p.phoneDbfs }))
  );
}

/** Range of reference levels covered by a set of points. */
export function referenceRange(
  points: ReadonlyArray<{ referenceDb: number }>
): { minDb: number; maxDb: number } | null {
  if (points.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.referenceDb < min) min = p.referenceDb;
    if (p.referenceDb > max) max = p.referenceDb;
  }
  return { minDb: min, maxDb: max };
}

/**
 * Predicted SPL for a phone reading under a given fit, plus the ideal y = x line
 * for plotting agreement.
 */
export function predictSpl(slope: number, intercept: number, phoneDbfs: number): number {
  return slope * phoneDbfs + intercept;
}
