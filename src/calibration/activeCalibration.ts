/**
 * The single place where dBFS becomes dB SPL.
 *
 * Nothing else in the application is allowed to add a calibration offset. That
 * rule is what keeps the distinction between an uncalibrated digital level and a
 * calibrated sound pressure level from blurring.
 *
 * An `ActiveCalibration` is derived from a stored profile and answers three
 * questions:
 *   - what is the SPL for this dBFS reading?
 *   - is that number actually calibrated, or is it a raw digital level?
 *   - is this reading inside the range the calibration was verified over?
 */

import { LEVEL_FLOOR_DB, meanSquareToDb } from '@/dsp/levels';
import type { CalibrationProfile, CalibrationSnapshot, CalibrationStatus } from '@/storage/types';
import {
  type CorrectionCurve,
  buildCorrectionCurve,
  sampleCorrection,
  sampleCorrections,
} from './frequencyCorrection';

export interface CalibrationValidity {
  /** Whether the value can be presented as sound pressure level at all. */
  calibrated: boolean;
  /** Whether the value falls inside the verified level range. */
  inValidatedRange: boolean;
  reason: string | null;
}

export class ActiveCalibration {
  readonly profile: CalibrationProfile | null;
  readonly slope: number;
  readonly intercept: number;
  readonly status: CalibrationStatus;
  readonly correctionCurve: CorrectionCurve | null;
  readonly frequencyCorrectionEnabled: boolean;

  private constructor(
    profile: CalibrationProfile | null,
    frequencyCorrectionEnabled: boolean
  ) {
    this.profile = profile;
    this.slope = profile?.level?.slope ?? 1;
    this.intercept = profile?.level?.intercept ?? 0;
    this.correctionCurve = profile?.frequency
      ? buildCorrectionCurve(profile.frequency.points)
      : null;
    this.frequencyCorrectionEnabled = frequencyCorrectionEnabled && this.correctionCurve !== null;
    this.status = calibrationStatus(profile);
  }

  static from(
    profile: CalibrationProfile | null | undefined,
    options: { frequencyCorrection?: boolean } = {}
  ): ActiveCalibration {
    return new ActiveCalibration(profile ?? null, options.frequencyCorrection ?? true);
  }

  /** An explicitly uncalibrated calibration: dBFS passes through unchanged. */
  static uncalibrated(): ActiveCalibration {
    return new ActiveCalibration(null, false);
  }

  get isCalibrated(): boolean {
    return this.profile?.level != null;
  }

  /** Unit label for displayed broadband levels. */
  get unit(): 'dB SPL' | 'dBFS' {
    return this.isCalibrated ? 'dB SPL' : 'dBFS';
  }

  /** Suffix for a weighted level, e.g. "dBA" or "dBA FS". */
  levelUnit(weighting: 'A' | 'C' | 'Z'): string {
    return this.isCalibrated ? `dB${weighting}` : `dB${weighting} FS`;
  }

  /**
   * Convert a level. When uncalibrated the value is returned unchanged so the UI
   * shows the honest dBFS figure rather than a fabricated SPL.
   */
  toDisplay(levelDbfs: number): number {
    if (!Number.isFinite(levelDbfs) || levelDbfs <= LEVEL_FLOOR_DB) return levelDbfs;
    if (!this.isCalibrated) return levelDbfs;
    return this.slope * levelDbfs + this.intercept;
  }

  /** Inverse of {@link toDisplay}, used when re-deriving raw values. */
  toDbfs(displayDb: number): number {
    if (!this.isCalibrated) return displayDb;
    return (displayDb - this.intercept) / this.slope;
  }

  /**
   * Convert a band level, optionally applying the frequency-response correction.
   * Returns the corrected level and whether that band is inside the calibrated
   * frequency range.
   */
  toBandDisplay(levelDbfs: number, centreFrequencyHz: number): { levelDb: number; calibrated: boolean } {
    const base = this.toDisplay(levelDbfs);
    if (!this.frequencyCorrectionEnabled || !this.correctionCurve) {
      return { levelDb: base, calibrated: this.isCalibrated };
    }
    const inRange =
      centreFrequencyHz >= this.correctionCurve.lowHz &&
      centreFrequencyHz <= this.correctionCurve.highHz;
    const sample = sampleCorrection(this.correctionCurve, centreFrequencyHz);
    return { levelDb: base + sample.correctionDb, calibrated: this.isCalibrated && inRange };
  }

  /** Corrections for a whole set of band centres, for the octave displays. */
  bandCorrections(frequencies: readonly number[]): { corrections: number[]; calibrated: boolean[] } {
    if (!this.frequencyCorrectionEnabled) {
      return {
        corrections: frequencies.map(() => 0),
        calibrated: frequencies.map(() => this.isCalibrated),
      };
    }
    const result = sampleCorrections(this.correctionCurve, frequencies);
    return {
      corrections: result.corrections,
      calibrated: result.calibrated.map((c) => c && this.isCalibrated),
    };
  }

  /**
   * Frequency-corrected broadband level, reconstructed by energy summation of the
   * corrected band levels.
   *
   * A frequency correction cannot meaningfully be applied to a single broadband
   * number — the correction depends on where the energy actually is. Summing the
   * corrected bands is the defensible way to do it, and it is only offered when a
   * frequency calibration exists.
   */
  correctedBroadbandLevel(
    bandLevelsDbfs: Float32Array | readonly number[],
    centreFrequencies: readonly number[],
    available: readonly boolean[]
  ): { levelDb: number; bandsUsed: number; bandsOutsideCalibration: number } | null {
    if (!this.frequencyCorrectionEnabled || !this.correctionCurve) return null;
    let energy = 0;
    let used = 0;
    let outside = 0;
    for (let i = 0; i < centreFrequencies.length; i++) {
      if (!available[i]) continue;
      const raw = bandLevelsDbfs[i];
      if (!Number.isFinite(raw) || raw <= LEVEL_FLOOR_DB) continue;
      const f = centreFrequencies[i];
      const inRange = f >= this.correctionCurve.lowHz && f <= this.correctionCurve.highHz;
      if (!inRange) outside++;
      const correction = sampleCorrection(this.correctionCurve, f).correctionDb;
      energy += Math.pow(10, (raw + correction) / 10);
      used++;
    }
    if (used === 0) return null;
    return {
      levelDb: this.toDisplay(meanSquareToDb(energy)),
      bandsUsed: used,
      bandsOutsideCalibration: outside,
    };
  }

  /** Whether a displayed level sits inside the verified calibration range. */
  validity(displayDb: number): CalibrationValidity {
    if (!this.isCalibrated) {
      return {
        calibrated: false,
        inValidatedRange: false,
        reason: 'No calibration is active. Levels are shown as digital full-scale (dBFS), not sound pressure level.',
      };
    }
    const range = this.profile?.level?.validatedRange ?? null;
    if (!range) {
      return {
        calibrated: true,
        inValidatedRange: false,
        reason: 'Calibrated from a single point, so no verified level range exists.',
      };
    }
    if (!Number.isFinite(displayDb)) {
      return { calibrated: true, inValidatedRange: false, reason: 'No level available.' };
    }
    // A small margin beyond the measured extremes is treated as still verified;
    // beyond that the reading is an extrapolation and is flagged as such.
    const margin = 5;
    if (displayDb < range.minDb - margin || displayDb > range.maxDb + margin) {
      return {
        calibrated: true,
        inValidatedRange: false,
        reason: `Level is outside the verified range of ${range.minDb.toFixed(0)} to ${range.maxDb.toFixed(0)} dB.`,
      };
    }
    return { calibrated: true, inValidatedRange: true, reason: null };
  }

  /** Age of the calibration in days, or null when uncalibrated. */
  get ageDays(): number | null {
    const at = this.profile?.level?.calibratedAt;
    if (!at) return null;
    return (Date.now() - at) / 86400000;
  }

  /** Snapshot embedded into a saved session. */
  toSnapshot(): CalibrationSnapshot {
    return {
      profileId: this.profile?.id ?? null,
      profileName: this.profile?.name ?? null,
      status: this.status,
      slope: this.slope,
      intercept: this.intercept,
      calibratedAt: this.profile?.level?.calibratedAt ?? null,
      referenceInstrument: this.profile?.referenceInstrument ?? null,
      frequencyCorrectionApplied: this.frequencyCorrectionEnabled,
      frequencyValidatedRange: this.profile?.frequency?.validatedRange ?? null,
      levelValidatedRange: this.profile?.level?.validatedRange ?? null,
    };
  }
}

/**
 * Calibration status category.
 *
 * The categories are cumulative and every one of them is earned from data that
 * actually exists in the profile:
 *   UNCALIBRATED         no level calibration
 *   LEVEL CALIBRATED     a level calibration exists
 *   FREQUENCY CALIBRATED a frequency correction curve also exists
 *   VALIDATED            independent validation measurements have been recorded
 */
export function calibrationStatus(profile: CalibrationProfile | null | undefined): CalibrationStatus {
  if (!profile?.level) return 'UNCALIBRATED';
  const hasFrequency = (profile.frequency?.points.length ?? 0) >= 2;
  const validation = profile.validation;
  if (hasFrequency && validation && validation.n >= 3) return 'VALIDATED';
  if (hasFrequency) return 'FREQUENCY CALIBRATED';
  if (validation && validation.n >= 3) return 'VALIDATED';
  return 'LEVEL CALIBRATED';
}

export const CALIBRATION_STATUS_ORDER: readonly CalibrationStatus[] = [
  'UNCALIBRATED',
  'LEVEL CALIBRATED',
  'FREQUENCY CALIBRATED',
  'VALIDATED',
];
