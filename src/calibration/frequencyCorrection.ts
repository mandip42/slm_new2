/**
 * Frequency-response correction.
 *
 * A correction curve is built from paired reference/phone measurements at
 * discrete frequencies:
 *
 *     Correction(f) = Reference(f) - Phone(f)
 *
 * Between measured points the correction is interpolated **linearly in
 * log-frequency**, which is the right space for acoustic response curves: it
 * makes the interpolation independent of whether the points happen to be spaced
 * per octave or per third-octave.
 *
 * Outside the measured range the correction is held flat at the nearest measured
 * value and the region is reported as extrapolated. Extrapolating a rising or
 * falling trend past the last measurement is how calibration curves invent data
 * that is not there, so it is not done.
 */

import type { FrequencyCalibrationPoint } from '@/storage/types';

export interface CorrectionCurve {
  /** Sorted measured frequencies, Hz. */
  frequencies: number[];
  /** Correction in dB at each measured frequency. */
  corrections: number[];
  lowHz: number;
  highHz: number;
}

export interface CorrectionSample {
  correctionDb: number;
  /** True when the frequency lies inside the measured range. */
  calibrated: boolean;
}

export function buildCorrectionCurve(
  points: readonly FrequencyCalibrationPoint[]
): CorrectionCurve | null {
  if (points.length === 0) return null;

  // Average duplicates at the same frequency rather than letting the last one win.
  const grouped = new Map<number, { sum: number; count: number }>();
  for (const p of points) {
    if (!(p.frequencyHz > 0) || !Number.isFinite(p.correctionDb)) continue;
    const key = Math.round(p.frequencyHz * 1000) / 1000;
    const entry = grouped.get(key) ?? { sum: 0, count: 0 };
    entry.sum += p.correctionDb;
    entry.count += 1;
    grouped.set(key, entry);
  }
  if (grouped.size === 0) return null;

  const frequencies = [...grouped.keys()].sort((a, b) => a - b);
  const corrections = frequencies.map((f) => {
    const entry = grouped.get(f)!;
    return entry.sum / entry.count;
  });

  return {
    frequencies,
    corrections,
    lowHz: frequencies[0],
    highHz: frequencies[frequencies.length - 1],
  };
}

/** Correction at one frequency, interpolated in log-frequency space. */
export function sampleCorrection(curve: CorrectionCurve, frequencyHz: number): CorrectionSample {
  const { frequencies, corrections } = curve;
  if (!(frequencyHz > 0)) return { correctionDb: 0, calibrated: false };

  if (frequencyHz <= frequencies[0]) {
    return {
      correctionDb: corrections[0],
      calibrated: Math.abs(frequencyHz - frequencies[0]) < 1e-6,
    };
  }
  const last = frequencies.length - 1;
  if (frequencyHz >= frequencies[last]) {
    return {
      correctionDb: corrections[last],
      calibrated: Math.abs(frequencyHz - frequencies[last]) < 1e-6,
    };
  }

  // Binary search for the bracketing pair.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frequencies[mid] <= frequencyHz) lo = mid;
    else hi = mid;
  }

  const x0 = Math.log10(frequencies[lo]);
  const x1 = Math.log10(frequencies[hi]);
  const t = (Math.log10(frequencyHz) - x0) / (x1 - x0);
  return {
    correctionDb: corrections[lo] + t * (corrections[hi] - corrections[lo]),
    calibrated: true,
  };
}

/** Corrections for a list of band centre frequencies. */
export function sampleCorrections(
  curve: CorrectionCurve | null,
  frequencies: readonly number[]
): { corrections: number[]; calibrated: boolean[] } {
  if (!curve) {
    return {
      corrections: frequencies.map(() => 0),
      calibrated: frequencies.map(() => false),
    };
  }
  const corrections: number[] = [];
  const calibrated: boolean[] = [];
  for (const f of frequencies) {
    // A band centre counts as calibrated when it lies within the measured span,
    // not only when it exactly equals a measured point.
    const inRange = f >= curve.lowHz && f <= curve.highHz;
    corrections.push(sampleCorrection(curve, f).correctionDb);
    calibrated.push(inRange);
  }
  return { corrections, calibrated };
}

/** Descriptive quality figures for a correction curve. */
export interface CorrectionQuality {
  n: number;
  lowHz: number;
  highHz: number;
  meanAbsCorrectionDb: number;
  maxAbsCorrectionDb: number;
  /** Largest change between adjacent measured points, a smoothness indicator. */
  maxAdjacentStepDb: number;
  /** Largest gap between adjacent points, in octaves. */
  maxGapOctaves: number;
}

export function describeCorrectionCurve(curve: CorrectionCurve): CorrectionQuality {
  const n = curve.frequencies.length;
  let sumAbs = 0;
  let maxAbs = 0;
  for (const c of curve.corrections) {
    const abs = Math.abs(c);
    sumAbs += abs;
    if (abs > maxAbs) maxAbs = abs;
  }
  let maxStep = 0;
  let maxGap = 0;
  for (let i = 1; i < n; i++) {
    const step = Math.abs(curve.corrections[i] - curve.corrections[i - 1]);
    if (step > maxStep) maxStep = step;
    const gap = Math.log2(curve.frequencies[i] / curve.frequencies[i - 1]);
    if (gap > maxGap) maxGap = gap;
  }
  return {
    n,
    lowHz: curve.lowHz,
    highHz: curve.highHz,
    meanAbsCorrectionDb: n > 0 ? sumAbs / n : 0,
    maxAbsCorrectionDb: maxAbs,
    maxAdjacentStepDb: maxStep,
    maxGapOctaves: maxGap,
  };
}

/** Standard frequencies suggested by the frequency-calibration wizard. */
export const SUGGESTED_CALIBRATION_FREQUENCIES = [
  31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;
