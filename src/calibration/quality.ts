/**
 * Calibration quality summary.
 *
 * Every figure here is computed from data actually stored in the profile. When a
 * figure cannot be computed it is reported as unavailable rather than filled in
 * with a plausible-looking number.
 */

import { describeErrors } from '@/dsp/statistics';
import type { CalibrationProfile, CalibrationStatus, ValidationExperiment } from '@/storage/types';
import { calibrationStatus } from './activeCalibration';
import { buildCorrectionCurve, describeCorrectionCurve } from './frequencyCorrection';

/** Calibrations older than this are flagged for re-checking. */
export const CALIBRATION_STALE_DAYS = 90;

export interface QualityLine {
  label: string;
  /** Formatted value, or null when the figure genuinely cannot be computed. */
  value: string | null;
  /** Short note explaining a null value or qualifying the figure. */
  note?: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface CalibrationQualityReport {
  status: CalibrationStatus;
  referenceInstrument: string | null;
  /** Overall level calibration. */
  levelLine: QualityLine;
  /** Frequency correction coverage. */
  frequencyLine: QualityLine;
  /** Mean error from validation experiments. */
  meanErrorLine: QualityLine;
  /** Worst observed error from validation experiments. */
  maxErrorLine: QualityLine;
  /** Age of the calibration. */
  ageLine: QualityLine;
  /** Linearity of the level fit. */
  linearityLine: QualityLine;
  warnings: string[];
  ageDays: number | null;
  stale: boolean;
}

function formatDb(value: number): string {
  return `${value >= 0 ? '' : ''}${value.toFixed(1)} dB`;
}

function formatHz(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz` : `${value.toFixed(value < 100 ? 1 : 0)} Hz`;
}

export function buildQualityReport(
  profile: CalibrationProfile | null | undefined
): CalibrationQualityReport {
  const status = calibrationStatus(profile);
  const warnings: string[] = [];

  if (!profile) {
    return {
      status,
      referenceInstrument: null,
      levelLine: { label: 'Overall level', value: null, note: 'No calibration profile is active.', tone: 'bad' },
      frequencyLine: { label: 'Frequency correction', value: null, note: 'Not measured.', tone: 'neutral' },
      meanErrorLine: { label: 'Mean error', value: null, note: 'No validation measurements.', tone: 'neutral' },
      maxErrorLine: { label: 'Maximum observed error', value: null, note: 'No validation measurements.', tone: 'neutral' },
      ageLine: { label: 'Calibration age', value: null, tone: 'neutral' },
      linearityLine: { label: 'Linearity', value: null, note: 'Not measured.', tone: 'neutral' },
      warnings: [
        'Levels are shown as dBFS. Perform a reference calibration to display sound pressure level.',
      ],
      ageDays: null,
      stale: false,
    };
  }

  const level = profile.level;
  const ageDays = level ? (Date.now() - level.calibratedAt) / 86400000 : null;
  const stale = ageDays !== null && ageDays > CALIBRATION_STALE_DAYS;

  const levelLine: QualityLine = level
    ? {
        label: 'Overall level',
        value:
          level.method === 'single-point'
            ? `Single point, offset ${level.intercept >= 0 ? '+' : ''}${level.intercept.toFixed(2)} dB`
            : `${level.points.length}-point fit, offset ${level.intercept >= 0 ? '+' : ''}${level.intercept.toFixed(2)} dB, slope ${level.slope.toFixed(4)}`,
        note:
          level.validatedRange
            ? `Verified from ${level.validatedRange.minDb.toFixed(0)} to ${level.validatedRange.maxDb.toFixed(0)} dB`
            : 'No verified level range: a single point cannot establish one.',
        tone: level.validatedRange ? 'good' : 'warn',
      }
    : { label: 'Overall level', value: null, note: 'Not calibrated.', tone: 'bad' };

  const curve = profile.frequency ? buildCorrectionCurve(profile.frequency.points) : null;
  const frequencyLine: QualityLine = curve
    ? (() => {
        const q = describeCorrectionCurve(curve);
        const tone: QualityLine['tone'] = q.maxGapOctaves > 1.2 ? 'warn' : 'good';
        return {
          label: 'Frequency correction',
          value: `Validated ${formatHz(q.lowHz)} to ${formatHz(q.highHz)}`,
          note: `${q.n} points, mean correction ${q.meanAbsCorrectionDb.toFixed(1)} dB, largest ${q.maxAbsCorrectionDb.toFixed(1)} dB`,
          tone,
        };
      })()
    : { label: 'Frequency correction', value: null, note: 'Not measured.', tone: 'neutral' };

  if (curve) {
    const q = describeCorrectionCurve(curve);
    if (q.maxGapOctaves > 1.2) {
      warnings.push(
        `The frequency correction has a gap of ${q.maxGapOctaves.toFixed(1)} octaves between measured points, so the interpolation there is coarse.`
      );
    }
    if (q.maxAbsCorrectionDb > 12) {
      warnings.push(
        `A correction of ${q.maxAbsCorrectionDb.toFixed(1)} dB is very large. Check the measurement geometry before trusting it.`
      );
    }
  }

  const validation = profile.validation;
  const meanErrorLine: QualityLine = validation
    ? {
        label: 'Mean error',
        value: formatDb(validation.meanErrorDb),
        note: `From ${validation.n} validation measurements, standard deviation ${validation.standardDeviationDb.toFixed(2)} dB`,
        tone: Math.abs(validation.meanErrorDb) <= 1 ? 'good' : Math.abs(validation.meanErrorDb) <= 2 ? 'warn' : 'bad',
      }
    : { label: 'Mean error', value: null, note: 'No validation measurements recorded.', tone: 'neutral' };

  const maxErrorLine: QualityLine = validation
    ? {
        label: 'Maximum observed error',
        value: formatDb(validation.maxAbsErrorDb),
        note: validation.interval95
          ? `95 % of errors between ${validation.interval95.low.toFixed(1)} and ${validation.interval95.high.toFixed(1)} dB`
          : 'At least three measurements are needed for a 95 % interval.',
        tone: validation.maxAbsErrorDb <= 2 ? 'good' : validation.maxAbsErrorDb <= 4 ? 'warn' : 'bad',
      }
    : {
        label: 'Maximum observed error',
        value: null,
        note: 'No validation measurements recorded.',
        tone: 'neutral',
      };

  const ageLine: QualityLine = {
    label: 'Calibration age',
    value:
      ageDays === null
        ? null
        : ageDays < 1
          ? 'Today'
          : `${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? '' : 's'} old`,
    note: stale ? `Older than ${CALIBRATION_STALE_DAYS} days. Re-check against the reference.` : undefined,
    tone: stale ? 'warn' : 'good',
  };
  if (stale) {
    warnings.push(
      `This calibration is ${Math.floor(ageDays!)} days old. Verify it against the reference instrument before relying on absolute levels.`
    );
  }

  const fit = level?.fit ?? null;
  const linearityLine: QualityLine = fit
    ? {
        label: 'Linearity',
        value: `slope ${fit.slope.toFixed(4)}, R\u00b2 ${fit.r2.toFixed(4)}`,
        note: `RMSE ${fit.rmse.toFixed(2)} dB, worst residual ${fit.maxAbsError.toFixed(2)} dB over ${fit.n} points`,
        tone: fit.nonLinear || fit.maxAbsError > 2 ? 'warn' : 'good',
      }
    : {
        label: 'Linearity',
        value: null,
        note: 'Only a single level was measured, so linearity is unknown.',
        tone: 'neutral',
      };

  if (fit?.nonLinear) {
    warnings.push(
      `The level response is not linear (slope ${fit.slope.toFixed(3)}). A constant offset will be wrong away from the calibration level; the fitted slope is applied instead.`
    );
  }
  if (fit && fit.maxAbsError > 2) {
    warnings.push(
      `One calibration point differs from the fit by ${fit.maxAbsError.toFixed(1)} dB. Check for a mis-typed reference reading or an unstable source.`
    );
  }
  if (level && !level.validatedRange) {
    warnings.push(
      'Only one level was measured. Absolute accuracy away from that level is unverified.'
    );
  }
  if (!curve) {
    warnings.push(
      'No frequency-response calibration. Octave and spectrum levels are uncorrected for the microphone response.'
    );
  }
  if (profile.device.processingSuspected) {
    warnings.push(
      'This profile was captured while device audio processing could not be confirmed disabled, which reduces its reliability.'
    );
  }

  return {
    status,
    referenceInstrument: profile.referenceInstrument,
    levelLine,
    frequencyLine,
    meanErrorLine,
    maxErrorLine,
    ageLine,
    linearityLine,
    warnings,
    ageDays,
    stale,
  };
}

/**
 * Aggregate validation error statistics across experiments.
 * Only comparisons where both readings exist contribute.
 */
export function summariseValidation(
  experiments: readonly ValidationExperiment[]
): {
  errors: number[];
  stats: ReturnType<typeof describeErrors>;
  experimentIds: string[];
} {
  const errors: number[] = [];
  const experimentIds: string[] = [];
  for (const experiment of experiments) {
    let used = false;
    for (const point of experiment.points) {
      if (!Number.isFinite(point.referenceDb) || !Number.isFinite(point.measuredDb)) continue;
      errors.push(point.measuredDb - point.referenceDb);
      used = true;
    }
    if (used) experimentIds.push(experiment.id);
  }
  return { errors, stats: describeErrors(errors), experimentIds };
}
