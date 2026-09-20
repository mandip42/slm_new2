'use client';

import { useEffect, useState } from 'react';
import { formatBytes, formatFrequency, formatLevel, formatNumber, formatPercent, NO_VALUE } from '@/lib/format';
import { detectBrowser, detectDeviceModel, detectPlatform } from '@/lib/device';
import { useIsHydrated } from '@/lib/useIsHydrated';
import { storageUsage, type StorageUsage } from '@/storage/db';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext, useMetrics } from '@/state/EngineProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { InputGate } from '@/components/meter/InputGate';
import {
  Badge,
  Banner,
  Button,
  KeyValue,
  Metric,
  Panel,
  PanelHeader,
  Select,
  cx,
} from '@/components/ui/primitives';

function screenDescription(): string {
  if (typeof window === 'undefined' || !window.screen) return NO_VALUE;
  return `${window.screen.width}\u00d7${window.screen.height} @${(window.devicePixelRatio || 1).toFixed(2)}x`;
}

export default function DiagnosticsPage() {
  const { status, performance, devices, refreshDevices, start, stop, starting, permission } =
    useEngineContext();
  const { calibration } = useCalibration();
  const metrics = useMetrics(300);
  const hydrated = useIsHydrated();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [selectedDevice, setSelectedDevice] = useState('default');

  useEffect(() => {
    void refreshDevices();
    void storageUsage().then(setUsage).catch(() => undefined);
  }, [refreshDevices]);

  const diagnostics = status.diagnostics;
  const inputLive = status.state === 'running' || status.state === 'suspended';

  const flagRow = (
    label: string,
    flag: { requested: boolean; actual: boolean | null; supported: boolean } | undefined
  ): [string, React.ReactNode] => {
    if (!flag) return [label, NO_VALUE];
    const tone = flag.actual === true ? 'bad' : flag.actual === false ? 'good' : 'warn';
    const text =
      flag.actual === true
        ? 'ACTIVE'
        : flag.actual === false
          ? 'disabled'
          : 'not reported';
    return [
      label,
      <span key={label} className="inline-flex items-center gap-1.5">
        <Badge tone={tone}>{text}</Badge>
        <span className="text-[10px] text-faint">
          requested {flag.requested ? 'on' : 'off'}
          {flag.supported ? '' : ', not controllable'}
        </span>
      </span>,
    ];
  };

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="Input diagnostics"
        subtitle="What the browser actually delivered, not what was requested."
      />

      <InputGate />

      {diagnostics?.warnings.length ? (
        <Banner tone="warn" title="Measurement accuracy may be affected">
          <ul className="space-y-1">
            {diagnostics.warnings.map((warning) => (
              <li key={warning}>&bull; {warning}</li>
            ))}
          </ul>
        </Banner>
      ) : inputLive ? (
        <Banner tone="good" title="No acquisition concerns detected">
          The browser reported the requested measurement configuration.
        </Banner>
      ) : null}

      <Panel>
        <PanelHeader title="Audio input" />
        <KeyValue
          entries={[
            ['Engine state', status.state],
            ['Audio context state', status.contextState ?? NO_VALUE],
            ['Permission', permission],
            ['Device label', diagnostics?.deviceLabel ?? NO_VALUE],
            ['Device id', diagnostics?.deviceId ?? NO_VALUE],
            ['Source kind', diagnostics?.sourceKind ?? NO_VALUE],
            [
              'AudioContext sample rate',
              status.sampleRate ? `${status.sampleRate} Hz` : NO_VALUE,
            ],
            [
              'Track sample rate',
              diagnostics?.trackSampleRate ? `${diagnostics.trackSampleRate} Hz` : 'not reported',
            ],
            ['Channel count', diagnostics?.channelCount ?? NO_VALUE],
            [
              'Track latency',
              diagnostics?.latencySeconds !== null && diagnostics?.latencySeconds !== undefined
                ? `${(diagnostics.latencySeconds * 1000).toFixed(1)} ms`
                : 'not reported',
            ],
            [
              'Track state',
              diagnostics?.trackState
                ? `${diagnostics.trackState.readyState}, ${diagnostics.trackState.muted ? 'muted' : 'unmuted'}, ${diagnostics.trackState.enabled ? 'enabled' : 'disabled'}`
                : NO_VALUE,
            ],
            flagRow('Automatic gain control', diagnostics?.autoGainControl),
            flagRow('Echo cancellation', diagnostics?.echoCancellation),
            flagRow('Noise suppression', diagnostics?.noiseSuppression),
          ]}
        />
      </Panel>

      <Panel>
        <PanelHeader
          title="Input device"
          hint="Selecting a different device restarts acquisition. A USB measurement microphone will appear here when connected."
        />
        {devices.length === 0 ? (
          <p className="text-[11px] text-faint">
            Device labels are only available after microphone permission has been granted. Open the
            microphone, then reload this list.
          </p>
        ) : (
          <div className="space-y-2">
            <Select
              value={selectedDevice}
              onChange={setSelectedDevice}
              ariaLabel="Audio input device"
              options={[
                { value: 'default', label: 'System default' },
                ...devices.map((device) => ({
                  value: device.deviceId,
                  label: `${device.label}${device.kind === 'external' ? ' (external)' : ''}`,
                })),
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="accent"
                disabled={starting}
                onClick={() =>
                  void (async () => {
                    await stop();
                    await start(selectedDevice === 'default' ? undefined : selectedDevice);
                  })()
                }
              >
                {starting ? 'Switching\u2026' : 'Use this device'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void refreshDevices()}>
                Refresh list
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Signal" />
        <div className="grid grid-cols-3 gap-2">
          <Metric
            label="Peak input"
            value={metrics ? formatLevel(metrics.clipping.peakDb) : NO_VALUE}
            unit="dBFS"
            tone={
              metrics && metrics.clipping.peakDb > -1
                ? 'bad'
                : metrics && metrics.clipping.peakDb > -6
                  ? 'warn'
                  : 'neutral'
            }
            size="sm"
          />
          <Metric
            label="DC offset"
            value={metrics ? formatNumber(metrics.dcOffset, 5) : NO_VALUE}
            hint="after the blocker"
            size="sm"
          />
          <Metric
            label="Clip events"
            value={metrics ? String(metrics.clipping.events) : NO_VALUE}
            tone={metrics && metrics.clipping.events > 0 ? 'bad' : 'good'}
            size="sm"
          />
          <Metric
            label="Clipped samples"
            value={metrics ? metrics.clipping.clippedSamples.toLocaleString() : NO_VALUE}
            size="sm"
          />
          <Metric
            label="Warm-up"
            value={metrics ? (metrics.warmingUp ? 'settling' : 'complete') : NO_VALUE}
            tone={metrics?.warmingUp ? 'warn' : 'good'}
            size="sm"
          />
          <Metric
            label="Samples seen"
            value={metrics ? metrics.totalSamples.toLocaleString() : NO_VALUE}
            size="sm"
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Real-time performance"
          hint="Processing load is DSP time divided by real time. Above 1.0 the device cannot keep up."
        />
        <div className="grid grid-cols-3 gap-2">
          <Metric
            label="Meter load"
            value={
              performance.meterLoad === null ? 'n/a' : formatPercent(performance.meterLoad * 100, 1)
            }
            tone={
              performance.meterLoad === null
                ? 'neutral'
                : performance.meterLoad > 0.7
                  ? 'bad'
                  : performance.meterLoad > 0.4
                    ? 'warn'
                    : 'good'
            }
            hint="audio thread"
            size="sm"
          />
          <Metric
            label="Analysis load"
            value={formatPercent(performance.analysisLoad * 100, 1)}
            tone={
              performance.analysisLoad > 0.8
                ? 'bad'
                : performance.analysisLoad > 0.5
                  ? 'warn'
                  : 'good'
            }
            hint="worker thread"
            size="sm"
          />
          <Metric
            label="Dropped samples"
            value={performance.droppedSamples.toLocaleString()}
            tone={performance.droppedSamples > 0 ? 'bad' : 'good'}
            size="sm"
          />
          <Metric label="Metric rate" value={`${performance.metricRate}/s`} size="sm" />
          <Metric label="Analysis rate" value={`${performance.analysisRate}/s`} size="sm" />
          <Metric
            label="Empty blocks"
            value={performance.silentBlocks.toLocaleString()}
            tone={performance.silentBlocks > 0 ? 'warn' : 'good'}
            hint="no input delivered"
            size="sm"
          />
        </div>
        <KeyValue
          entries={[
            [
              'Base latency',
              performance.baseLatencySeconds !== null
                ? `${(performance.baseLatencySeconds * 1000).toFixed(1)} ms`
                : NO_VALUE,
            ],
            [
              'Output latency',
              performance.outputLatencySeconds !== null
                ? `${(performance.outputLatencySeconds * 1000).toFixed(1)} ms`
                : NO_VALUE,
            ],
          ]}
        />
        {performance.droppedSamples > 0 ? (
          <Banner tone="bad">
            The analysis worker had to discard {performance.droppedSamples} samples to keep up. Band
            levels for that period are incomplete. Reduce the FFT size, switch to 1/1-octave
            resolution, or close other applications.
          </Banner>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title="DSP configuration" />
        <KeyValue
          entries={[
            [
              'Weighting accurate to',
              status.weightingAccurateUpToHz
                ? formatFrequency(status.weightingAccurateUpToHz)
                : NO_VALUE,
            ],
            [
              'A weighting HF pole',
              status.aWeightingHfPoleHz ? formatFrequency(status.aWeightingHfPoleHz) : NO_VALUE,
            ],
            [
              'A weighting worst fit error',
              status.aWeightingMaxFitErrorDb !== null
                ? `${formatNumber(status.aWeightingMaxFitErrorDb, 3)} dB`
                : NO_VALUE,
            ],
            [
              '1/3-octave bands',
              status.bandLayout
                ? `${status.bandLayout.thirdOctave.filter((b) => b.available).length} of ${status.bandLayout.thirdOctave.length} measurable`
                : NO_VALUE,
            ],
            [
              'Octave bands',
              status.bandLayout
                ? `${status.bandLayout.octave.filter((b) => b.available).length} of ${status.bandLayout.octave.length} measurable`
                : NO_VALUE,
            ],
            [
              'Unstable band filters',
              status.bandLayout ? String(status.bandLayout.unstableBands.length) : NO_VALUE,
            ],
            ['Calibration status', calibration.status],
          ]}
        />
      </Panel>

      <Panel>
        <PanelHeader title="Environment" />
        {/*
          Everything here comes from `navigator`, which does not exist while the
          page is being prerendered. The values are withheld until after hydration
          so the first client render matches the server output exactly.
        */}
        <KeyValue
          entries={
            hydrated
              ? [
                  ['Device model', detectDeviceModel()],
                  ['Browser', detectBrowser()],
                  ['Platform', detectPlatform()],
                  ['Screen', screenDescription()],
                  ['Secure context', window.isSecureContext ? 'yes' : 'no'],
                  [
                    'AudioWorklet support',
                    typeof AudioContext !== 'undefined' && 'audioWorklet' in AudioContext.prototype
                      ? 'yes'
                      : 'no',
                  ],
                  [
                    'Service worker',
                    'serviceWorker' in navigator ? 'supported' : 'not supported',
                  ],
                  ['User agent', navigator.userAgent],
                ]
              : [['Environment', 'Reading\u2026']]
          }
        />
      </Panel>

      <Panel>
        <PanelHeader title="Local storage" />
        <KeyValue
          entries={[
            ['Estimated usage', usage ? formatBytes(usage.usageBytes) : NO_VALUE],
            ['Quota', usage ? formatBytes(usage.quotaBytes) : NO_VALUE],
            [
              'Persistent',
              usage?.persisted === null ? 'unknown' : usage?.persisted ? 'yes' : 'no (may be evicted)',
            ],
            ['Sessions', usage ? String(usage.counts.sessions) : NO_VALUE],
            ['Calibration profiles', usage ? String(usage.counts.calibrationProfiles) : NO_VALUE],
            ['Validation experiments', usage ? String(usage.counts.validationExperiments) : NO_VALUE],
            ['Audio recordings', usage ? String(usage.counts.recordings) : NO_VALUE],
          ]}
        />
        <div className={cx('mt-2')}>
          <Button size="sm" variant="ghost" onClick={() => void storageUsage().then(setUsage)}>
            Refresh
          </Button>
        </div>
      </Panel>
    </div>
  );
}
