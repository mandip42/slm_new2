'use client';

/**
 * Measurement validity indicator.
 *
 * Green / amber / red, and every state is derived from a condition that is
 * actually known:
 *
 *   RED    the input is clipping, the input has stopped, or the audio engine is
 *          suspended — the number on screen is wrong, not merely uncertain
 *   AMBER  the reading is valid but its accuracy is not established: no
 *          calibration, a level outside the verified range, device audio
 *          processing that could not be confirmed disabled, or a stale
 *          calibration
 *   GREEN  calibrated, inside the verified range, no clipping, no known device
 *          processing
 *
 * No numerical accuracy figure is ever invented here. When validation data
 * exists, the measured error from that data is quoted; otherwise nothing is.
 */

import type { MeterSnapshot } from '@/dsp/engine';
import type { EngineStatus } from '@/audio/acousticEngine';
import type { ActiveCalibration } from '@/calibration/activeCalibration';
import type { CalibrationQualityReport } from '@/calibration/quality';
import { cx } from '@/components/ui/primitives';

export type Validity = 'green' | 'amber' | 'red' | 'unknown';

export interface ValidityAssessment {
  level: Validity;
  headline: string;
  reasons: string[];
  /** Measured accuracy, only when validation data supports it. */
  accuracyNote: string | null;
}

export function assessValidity(input: {
  snapshot: MeterSnapshot | null;
  status: EngineStatus;
  calibration: ActiveCalibration;
  quality: CalibrationQualityReport;
  displayLevel: number;
}): ValidityAssessment {
  const { snapshot, status, calibration, quality, displayLevel } = input;
  const reasons: string[] = [];

  if (status.state === 'idle' || !snapshot) {
    return {
      level: 'unknown',
      headline: 'No input',
      reasons: ['The microphone is not running.'],
      accuracyNote: null,
    };
  }

  if (status.state === 'error') {
    return {
      level: 'red',
      headline: 'Invalid input',
      reasons: [status.error?.message ?? 'The audio input stopped.'],
      accuracyNote: null,
    };
  }

  if (status.state === 'suspended') {
    return {
      level: 'red',
      headline: 'Audio suspended',
      reasons: ['The browser suspended the audio engine, so nothing is being measured.'],
      accuracyNote: null,
    };
  }

  if (snapshot.clipping.active) {
    return {
      level: 'red',
      headline: 'Clipping',
      reasons: [
        `The input is clipping (${snapshot.clipping.events} event${snapshot.clipping.events === 1 ? '' : 's'}). Levels are underestimated while this happens.`,
      ],
      accuracyNote: null,
    };
  }

  if (snapshot.warmingUp) {
    return {
      level: 'amber',
      headline: 'Settling',
      reasons: ['The filters and detectors are still settling. Readings are not yet integrated.'],
      accuracyNote: null,
    };
  }

  let level: Validity = 'green';

  if (!calibration.isCalibrated) {
    level = 'amber';
    reasons.push(
      'No calibration is active, so the value is a digital level (dBFS) and not sound pressure level.'
    );
  } else {
    const validity = calibration.validity(displayLevel);
    if (!validity.inValidatedRange && validity.reason) {
      level = 'amber';
      reasons.push(validity.reason);
    }
    if (quality.stale) {
      level = 'amber';
      reasons.push(
        `The calibration is ${Math.floor(quality.ageDays ?? 0)} days old and has not been re-checked.`
      );
    }
    if (!calibration.correctionCurve) {
      level = 'amber';
      reasons.push(
        'No frequency-response correction exists, so the microphone response is uncorrected.'
      );
    }
  }

  if (status.diagnostics?.processingSuspected) {
    level = 'amber';
    reasons.push(
      'Device audio processing could not be confirmed disabled. Measurement accuracy may be affected.'
    );
  }

  if (snapshot.clipping.nearOverload) {
    level = 'amber';
    reasons.push(
      'The input peak is within 1 dB of full scale. The microphone front end may already be compressing.'
    );
  }

  const accuracyNote =
    calibration.profile?.validation && calibration.profile.validation.n >= 3
      ? `Measured against ${calibration.profile.referenceInstrument}: mean error ${calibration.profile.validation.meanErrorDb.toFixed(1)} dB, worst ${calibration.profile.validation.maxAbsErrorDb.toFixed(1)} dB over ${calibration.profile.validation.n} comparisons.`
      : null;

  return {
    level,
    headline:
      level === 'green'
        ? 'Calibrated and in range'
        : reasons.length > 0
          ? 'Accuracy not established'
          : 'Valid',
    reasons,
    accuracyNote,
  };
}

const DOT: Record<Validity, string> = {
  green: 'bg-ok',
  amber: 'bg-warn',
  red: 'bg-bad',
  unknown: 'bg-faint',
};

const TEXT: Record<Validity, string> = {
  green: 'text-ok',
  amber: 'text-warn',
  red: 'text-bad',
  unknown: 'text-faint',
};

export function ValidityIndicator({
  assessment,
  compact = false,
}: {
  assessment: ValidityAssessment;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1.5" title={assessment.reasons.join(' ')}>
        <span className={cx('h-2 w-2 rounded-full', DOT[assessment.level])} />
        <span className={cx('text-[10px] font-bold tracking-wide uppercase', TEXT[assessment.level])}>
          {assessment.headline}
        </span>
      </span>
    );
  }

  return (
    <div className="panel-sunken px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', DOT[assessment.level])} />
        <span className={cx('text-xs font-bold tracking-wide uppercase', TEXT[assessment.level])}>
          {assessment.headline}
        </span>
      </div>
      {assessment.reasons.length > 0 ? (
        <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted">
          {assessment.reasons.map((reason) => (
            <li key={reason}>&bull; {reason}</li>
          ))}
        </ul>
      ) : null}
      {assessment.accuracyNote ? (
        <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] leading-relaxed text-faint">
          {assessment.accuracyNote}
        </p>
      ) : null}
    </div>
  );
}
