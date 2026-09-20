'use client';

/**
 * Session metrics beside the main read-out.
 *
 * Only values that have actually been integrated are shown. Before START they
 * read as em dashes rather than zeros, because a zero would look like a
 * measurement.
 */

import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import { formatDuration, formatLevel, NO_VALUE } from '@/lib/format';
import { useCalibration } from '@/state/CalibrationProvider';
import { useMetrics } from '@/state/EngineProvider';
import { useMeasurement } from '@/state/MeasurementProvider';
import { useSettings } from '@/state/SettingsProvider';
import { Metric } from '@/components/ui/primitives';

function useConverted() {
  const { calibration } = useCalibration();
  return (value: number | undefined): string => {
    if (value === undefined || !Number.isFinite(value) || value <= LEVEL_FLOOR_DB) return NO_VALUE;
    return formatLevel(calibration.toDisplay(value), 1);
  };
}

export function SecondaryMetrics() {
  const snapshot = useMetrics(250);
  const { calibration } = useCalibration();
  const { settings } = useSettings();
  const { state, elapsedSeconds } = useMeasurement();
  const convert = useConverted();

  const integrating = state === 'measuring' || state === 'paused' || state === 'stopped';
  const unit = calibration.isCalibrated ? 'dB' : 'dBFS';

  return (
    <div className="grid grid-cols-3 gap-2">
      <Metric
        label="LAeq"
        value={integrating ? convert(snapshot?.LAeq) : NO_VALUE}
        unit={unit}
        hint="Energy average"
      />
      <Metric
        label="LAFmax"
        value={integrating ? convert(snapshot?.LAFmax) : NO_VALUE}
        unit={unit}
        hint="Fast maximum"
      />
      <Metric
        label="LCpeak"
        value={integrating ? convert(snapshot?.LCpeak) : NO_VALUE}
        unit={unit}
        hint="True peak, C"
      />
      <Metric
        label="Elapsed"
        value={integrating ? formatDuration(elapsedSeconds) : NO_VALUE}
        hint={state === 'paused' ? 'paused' : state === 'measuring' ? 'running' : 'not started'}
        size="sm"
      />
      <Metric
        label="LAFmin"
        value={integrating ? convert(snapshot?.LAFmin) : NO_VALUE}
        unit={unit}
        size="sm"
      />
      <Metric
        label={`L${settings.statisticsWeighting}eq 1 s`}
        value={convert(snapshot?.LAeq1s)}
        unit={unit}
        hint="Moving 1 s"
        size="sm"
      />
    </div>
  );
}

/** Wider metric grid used on the statistics and summary screens. */
export function DetailedMetrics() {
  const snapshot = useMetrics(400);
  const { calibration } = useCalibration();
  const convert = useConverted();
  const unit = calibration.isCalibrated ? 'dB' : 'dBFS';

  const entries: Array<[string, string, string]> = [
    ['LAeq', convert(snapshot?.LAeq), 'A-weighted equivalent level'],
    ['LCeq', convert(snapshot?.LCeq), 'C-weighted equivalent level'],
    ['LZeq', convert(snapshot?.LZeq), 'Unweighted equivalent level'],
    ['LAE / SEL', convert(snapshot?.LAE), 'Sound exposure level'],
    ['LAFmax', convert(snapshot?.LAFmax), 'A, Fast maximum'],
    ['LAFmin', convert(snapshot?.LAFmin), 'A, Fast minimum'],
    ['LASmax', convert(snapshot?.LASmax), 'A, Slow maximum'],
    ['LASmin', convert(snapshot?.LASmin), 'A, Slow minimum'],
    ['LAImax', convert(snapshot?.LAImax), 'A, Impulse maximum'],
    ['LCFmax', convert(snapshot?.LCFmax), 'C, Fast maximum'],
    ['LZFmax', convert(snapshot?.LZFmax), 'Z, Fast maximum'],
    ['LZFmin', convert(snapshot?.LZFmin), 'Z, Fast minimum'],
    ['LApeak', convert(snapshot?.LApeak), 'A-weighted true peak'],
    ['LCpeak', convert(snapshot?.LCpeak), 'C-weighted true peak'],
    ['LZpeak', convert(snapshot?.LZpeak), 'Unweighted true peak'],
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {entries.map(([label, value, hint]) => (
        <Metric key={label} label={label} value={value} unit={unit} hint={hint} size="sm" />
      ))}
    </div>
  );
}
