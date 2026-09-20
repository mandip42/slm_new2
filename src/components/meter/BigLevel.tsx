'use client';

/**
 * The main level read-out.
 *
 * Large, tabular, high contrast, and unambiguous about what it is showing: the
 * unit says `dBA` when calibrated and `dBA FS` when it is only a digital level.
 * That suffix is the single most important character on the screen.
 */

import { useMemo } from 'react';
import type { MeterSnapshot } from '@/dsp/engine';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import { TIME_WEIGHTING_LABELS, type TimeWeightingId } from '@/dsp/timeWeighting';
import type { WeightingId } from '@/dsp/weighting/reference';
import { NO_VALUE } from '@/lib/format';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext, useMetrics } from '@/state/EngineProvider';
import { useSettings } from '@/state/SettingsProvider';
import { cx } from '@/components/ui/primitives';
import { ValidityIndicator, assessValidity } from './ValidityIndicator';

/** Pick the level for the selected weighting and time weighting. */
export function selectLevel(
  snapshot: MeterSnapshot | null,
  weighting: WeightingId,
  timeWeighting: TimeWeightingId
): number {
  if (!snapshot) return NaN;
  if (timeWeighting === 'I') return weighting === 'A' ? snapshot.LAI : NaN;
  const fast = timeWeighting === 'F';
  switch (weighting) {
    case 'A':
      return fast ? snapshot.LAF : snapshot.LAS;
    case 'C':
      return fast ? snapshot.LCF : snapshot.LCS;
    case 'Z':
      return fast ? snapshot.LZF : snapshot.LZS;
  }
}

export function BigLevel() {
  const { settings } = useSettings();
  const { calibration, quality } = useCalibration();
  const { status } = useEngineContext();
  // 10 Hz: fast enough to feel live, slow enough to stay readable.
  const snapshot = useMetrics(100);

  const raw = selectLevel(snapshot, settings.weighting, settings.timeWeighting);
  const measurable = Number.isFinite(raw) && raw > LEVEL_FLOOR_DB;
  const display = measurable ? calibration.toDisplay(raw) : NaN;

  const assessment = useMemo(
    () => assessValidity({ snapshot, status, calibration, quality, displayLevel: display }),
    [snapshot, status, calibration, quality, display]
  );

  const unit = calibration.levelUnit(settings.weighting);
  const decimals = settings.levelDecimals;
  const text = measurable ? display.toFixed(decimals) : NO_VALUE;

  const tone =
    assessment.level === 'red'
      ? 'text-bad'
      : assessment.level === 'amber'
        ? 'text-ink'
        : 'text-ink';

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="label label-strong flex items-center gap-2">
          <span>
            {settings.weighting} &middot; {TIME_WEIGHTING_LABELS[settings.timeWeighting]}
          </span>
        </div>
        <ValidityIndicator assessment={assessment} compact />
      </div>

      <div className="mt-1 flex items-end justify-center gap-2 tabular-nums">
        <span
          className={cx(
            'readout font-semibold',
            tone,
            // Scale with the viewport so the number fills the width on any phone
            // without ever wrapping.
            decimals === 2 ? 'text-[19vw] sm:text-[104px]' : 'text-[23vw] sm:text-[120px]'
          )}
          aria-live="off"
        >
          {text}
        </span>
        <span className="mb-[3vw] text-lg font-medium text-muted sm:mb-3">{unit}</span>
      </div>

      {/* An explicit screen-reader announcement at a sane rate, since the visual
          read-out updates far too fast to announce. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {measurable
          ? `${display.toFixed(1)} ${unit}, ${settings.weighting} weighted, ${TIME_WEIGHTING_LABELS[settings.timeWeighting]} time weighting`
          : 'No level available'}
      </p>

      {!calibration.isCalibrated ? (
        <p className="mt-1 text-center text-[11px] leading-snug text-warn">
          Uncalibrated: this is a digital full-scale level, not sound pressure level.
        </p>
      ) : null}
    </div>
  );
}
