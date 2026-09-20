'use client';

import { useCallback, useMemo } from 'react';
import {
  PERCENTILE_LEVELS,
  STATISTICS_SAMPLE_RATE_HZ,
  type PercentileSet,
} from '@/dsp/statistics';
import { WEIGHTING_IDS } from '@/dsp/weighting/reference';
import { formatDuration, formatLevel, NO_VALUE } from '@/lib/format';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext, useMetrics } from '@/state/EngineProvider';
import { useMeasurement } from '@/state/MeasurementProvider';
import { useSettings } from '@/state/SettingsProvider';
import { rebinDistribution, useLevelDistribution } from '@/state/useLevelDistribution';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { DistributionChart } from '@/components/charts/DistributionChart';
import { InputGate } from '@/components/meter/InputGate';
import { DetailedMetrics } from '@/components/meter/SecondaryMetrics';
import {
  Banner,
  ControlRow,
  KeyValue,
  Metric,
  Panel,
  PanelHeader,
  SegmentedControl,
} from '@/components/ui/primitives';

export default function StatisticsPage() {
  const { settings, update } = useSettings();
  const { calibration } = useCalibration();
  const { status } = useEngineContext();
  const { state, elapsedSeconds } = useMeasurement();
  const snapshot = useMetrics(500);
  const histogram = useLevelDistribution(1000);

  const inputLive = status.state === 'running' || status.state === 'suspended';
  const unit = calibration.isCalibrated ? 'dB SPL' : 'dBFS';

  const toDisplay = useCallback((db: number) => calibration.toDisplay(db), [calibration]);

  const bins = useMemo(() => rebinDistribution(histogram, toDisplay, 1), [histogram, toDisplay]);

  const rawPercentiles = snapshot?.percentiles ?? null;
  const percentiles = useMemo(() => {
    if (!rawPercentiles) return null;
    const out = {} as Record<string, number>;
    for (const [key, value] of Object.entries(rawPercentiles)) {
      out[key] = Number.isFinite(value) ? toDisplay(value) : NaN;
    }
    return out as PercentileSet;
  }, [rawPercentiles, toDisplay]);

  const integrating = state === 'measuring' || state === 'paused' || state === 'stopped';

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="Statistical acoustics"
        subtitle={`Exceedance levels and the level distribution, sampled from the ${settings.statisticsWeighting}-weighted Fast level at ${STATISTICS_SAMPLE_RATE_HZ} samples per second.`}
      />

      <InputGate />

      {inputLive ? (
        <>
          <Panel>
            <PanelHeader
              title="Exceedance levels"
              hint="Ln is the level exceeded n % of the measurement time."
            />
            <div className="grid grid-cols-3 gap-2">
              {PERCENTILE_LEVELS.map((n) => {
                const key = `L${n}` as keyof NonNullable<typeof percentiles>;
                const value = percentiles?.[key];
                const emphasis = n === 10 || n === 50 || n === 90;
                return (
                  <Metric
                    key={n}
                    label={`L${n}`}
                    value={value !== undefined && Number.isFinite(value) ? formatLevel(value) : NO_VALUE}
                    unit={calibration.isCalibrated ? 'dB' : 'dBFS'}
                    size={emphasis ? 'md' : 'sm'}
                    hint={
                      n === 10
                        ? 'busier moments'
                        : n === 50
                          ? 'median'
                          : n === 90
                            ? 'background'
                            : undefined
                    }
                  />
                );
              })}
            </div>
            {!snapshot?.percentiles ? (
              <p className="mt-2 text-[11px] text-faint">
                Exceedance levels appear after one second of measurement. Press START on the meter
                screen.
              </p>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader
              title="Level distribution"
              hint={`${histogram ? histogram.sampleCount.toLocaleString() : 0} samples in 0.1 dB bins, displayed in 1 dB bins`}
            />
            <DistributionChart bins={bins} percentiles={percentiles ?? null} unit={unit} height={230} />
          </Panel>

          <Panel>
            <PanelHeader title="Statistics source" />
            <ControlRow>
              <SegmentedControl
                label="Statistics weighting"
                value={settings.statisticsWeighting}
                onChange={(value) => update({ statisticsWeighting: value })}
                options={WEIGHTING_IDS.map((id) => ({ value: id, label: id }))}
              />
            </ControlRow>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              Changing the weighting restarts the distribution, because a histogram mixing two
              weightings would be meaningless. The sampling rate is fixed at{' '}
              {STATISTICS_SAMPLE_RATE_HZ} per second and is independent of the display refresh rate.
            </p>
          </Panel>

          <Panel>
            <PanelHeader title="Methodology" />
            <KeyValue
              entries={[
                ['Statistical sample', `${settings.statisticsWeighting}-weighted, Fast time weighting`],
                ['Sampling rate', `${STATISTICS_SAMPLE_RATE_HZ} per second`],
                ['Histogram resolution', `${histogram?.binWidth ?? 0.1} dB bins`],
                ['Percentile method', 'Linear interpolation inside the containing bin'],
                ['Definition', 'Ln = the (100 - n)th percentile of the sampled distribution'],
                ['Samples collected', histogram ? histogram.sampleCount.toLocaleString() : NO_VALUE],
                ['Measurement time', integrating ? formatDuration(elapsedSeconds) : NO_VALUE],
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader title="All session metrics" />
            <DetailedMetrics />
          </Panel>

          {!calibration.isCalibrated ? (
            <Banner tone="warn">
              These are digital full-scale levels. Because a calibration offset is a constant, every
              exceedance level shifts by exactly that offset once you calibrate &mdash; the shape of
              the distribution is already correct.
            </Banner>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
