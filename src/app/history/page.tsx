'use client';

import { useMemo, useState } from 'react';
import {
  HISTORY_TRACES,
  HISTORY_WINDOWS,
  type HistoryTraceId,
} from '@/measurement/levelHistory';
import { formatDurationWords, formatLevel, NO_VALUE } from '@/lib/format';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext } from '@/state/EngineProvider';
import { useMeasurement } from '@/state/MeasurementProvider';
import { useSettings } from '@/state/SettingsProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { HistoryPlot } from '@/components/charts/HistoryPlot';
import { InputGate } from '@/components/meter/InputGate';
import {
  Banner,
  ControlRow,
  KeyValue,
  Panel,
  PanelHeader,
  Toggle,
  cx,
} from '@/components/ui/primitives';

export default function HistoryPage() {
  const { settings, update } = useSettings();
  const { calibration } = useCalibration();
  const { status } = useEngineContext();
  const { history, historyVersion, state } = useMeasurement();
  const [traces, setTraces] = useState<HistoryTraceId[]>(['LAF', 'LAeq']);
  const [showEnvelope, setShowEnvelope] = useState(true);

  const inputLive = status.state === 'running' || status.state === 'suspended';
  const unit = calibration.isCalibrated ? 'dB' : 'dBFS';

  const windowSeconds = settings.historyWindowSeconds;

  const stats = useMemo(() => {
    const from = history.windowStartIndex(windowSeconds);
    const primary: HistoryTraceId = traces.includes('LAF') ? 'LAF' : (traces[0] ?? 'LAF');
    const extremes = history.extremes(primary, from);
    // historyVersion is returned rather than merely listed as a dependency: the
    // history buffer is mutable, so the version counter is the only thing that
    // tells React the contents changed.
    return { primary, extremes, samples: history.length - from, version: historyVersion };
  }, [history, windowSeconds, traces, historyVersion]);

  const toggleTrace = (id: HistoryTraceId) => {
    setTraces((current) =>
      current.includes(id)
        ? current.length > 1
          ? current.filter((t) => t !== id)
          : current
        : [...current, id]
    );
  };

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="Level history"
        subtitle="Drag on the plot for a cursor. The buffer holds unlimited duration by halving its time resolution as it fills."
      />

      <InputGate />

      {inputLive ? (
        <>
          <Panel>
            <HistoryPlot
              history={history}
              version={historyVersion}
              calibration={calibration}
              traces={traces}
              windowSeconds={windowSeconds}
              height={260}
              showEnvelope={showEnvelope}
            />
          </Panel>

          <Panel>
            <PanelHeader title="Traces" />
            <div className="flex flex-wrap gap-2">
              {HISTORY_TRACES.map((trace) => {
                const active = traces.includes(trace.id);
                return (
                  <button
                    key={trace.id}
                    type="button"
                    onClick={() => toggleTrace(trace.id)}
                    aria-pressed={active}
                    title={trace.description}
                    className={cx(
                      'touch inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                      active
                        ? 'border-line-strong bg-panel-raised text-ink'
                        : 'border-line bg-panel text-faint'
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: active ? trace.colour : 'transparent', border: `1px solid ${trace.colour}` }}
                    />
                    {trace.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 border-t border-line pt-1">
              <Toggle
                label="Min/max envelope"
                description="Shades the range of LAF within each plotted point, so peaks lost to time decimation are still visible."
                checked={showEnvelope}
                onChange={setShowEnvelope}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Time window" />
            <ControlRow>
              {HISTORY_WINDOWS.map((window) => {
                const active = window.seconds === windowSeconds;
                return (
                  <button
                    key={window.label}
                    type="button"
                    onClick={() => update({ historyWindowSeconds: window.seconds })}
                    aria-pressed={active}
                    className={cx(
                      'touch shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                      active
                        ? 'border-accent/60 bg-accent/20 text-accent'
                        : 'border-line bg-panel text-muted'
                    )}
                  >
                    {window.label}
                  </button>
                );
              })}
            </ControlRow>
          </Panel>

          <Panel>
            <PanelHeader title="Window statistics" />
            <KeyValue
              entries={[
                ['Trace', stats.primary],
                [
                  'Maximum',
                  stats.extremes
                    ? `${formatLevel(calibration.toDisplay(stats.extremes.max))} ${unit}`
                    : NO_VALUE,
                ],
                [
                  'Minimum',
                  stats.extremes
                    ? `${formatLevel(calibration.toDisplay(stats.extremes.min))} ${unit}`
                    : NO_VALUE,
                ],
                [
                  'Range',
                  stats.extremes
                    ? `${(stats.extremes.max - stats.extremes.min).toFixed(1)} dB`
                    : NO_VALUE,
                ],
                ['Points in window', stats.samples > 0 ? stats.samples.toLocaleString() : NO_VALUE],
                ['Time resolution', `${history.intervalMs} ms`],
                ['Session length', formatDurationWords(history.durationSeconds)],
              ]}
            />
            {history.decimated ? (
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                The buffer has reduced its resolution to {history.intervalMs} ms to keep memory
                bounded. Points are energy averages of the merged intervals and the min/max envelope
                preserves the extremes, so no peak has been discarded.
              </p>
            ) : null}
          </Panel>

          {state === 'idle' ? (
            <Banner tone="info">
              The history fills while a measurement is running. Press START on the meter screen to
              begin.
            </Banner>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
