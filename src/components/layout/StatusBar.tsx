'use client';

/**
 * Instrument status bar.
 *
 * Always visible, always literal: every indicator reflects a real state rather
 * than an intention. MIC is only a tick when audio is actually flowing, CAL is
 * only a tick when a level calibration is active, and the sample rate shown is
 * the one the audio graph is really running at.
 *
 * Tapping expands the full acquisition and calibration detail.
 */

import Link from 'next/link';
import { useState } from 'react';
import { formatDuration, formatFrequency, formatLevel, NO_VALUE } from '@/lib/format';
import { TIME_WEIGHTING_LABELS } from '@/dsp/timeWeighting';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext, useMetrics } from '@/state/EngineProvider';
import { useMeasurement } from '@/state/MeasurementProvider';
import { useSettings } from '@/state/SettingsProvider';
import { Badge, Button, KeyValue, cx } from '@/components/ui/primitives';

function Chip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}) {
  const colour =
    tone === 'good'
      ? 'text-ok'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'bad'
          ? 'text-bad'
          : tone === 'accent'
            ? 'text-accent'
            : 'text-muted';
  return (
    <span className={cx('tnum inline-flex items-center gap-1 text-[11px] font-bold whitespace-nowrap', colour)}>
      {children}
    </span>
  );
}

export function StatusBar() {
  const { status, performance } = useEngineContext();
  const { settings } = useSettings();
  const { calibration, quality } = useCalibration();
  const { recording, recordingSeconds, state: measurementState } = useMeasurement();
  const metrics = useMetrics(500);
  const [expanded, setExpanded] = useState(false);

  const micLive = status.state === 'running' && (metrics?.totalSamples ?? 0) > 0;
  const micTone = status.state === 'error' ? 'bad' : micLive ? 'good' : 'warn';
  const micLabel =
    status.state === 'error'
      ? 'MIC \u2717'
      : micLive
        ? 'MIC \u2713'
        : status.state === 'suspended'
          ? 'MIC \u23f8'
          : 'MIC \u2013';

  const calTone = calibration.isCalibrated ? (quality.stale ? 'warn' : 'good') : 'warn';
  const calLabel = calibration.isCalibrated
    ? quality.stale
      ? 'CAL \u26a0'
      : 'CAL \u2713'
    : 'CAL \u2717';

  const clipping = metrics?.clipping.active ?? false;
  const dropouts = performance.silentBlocks > 0 || performance.droppedSamples > 0;

  return (
    <div className="sticky top-0 z-30 border-b border-line bg-shell/95 backdrop-blur">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label="Acquisition and calibration status. Tap for details."
        className="no-scrollbar flex w-full items-center gap-3 overflow-x-auto px-3 py-1.5 text-left"
      >
        <Chip tone={micTone}>{micLabel}</Chip>
        <Chip>{status.sampleRate ? `${(status.sampleRate / 1000).toFixed(status.sampleRate % 1000 === 0 ? 0 : 1)} kHz` : NO_VALUE}</Chip>
        <Chip tone={calTone}>{calLabel}</Chip>
        <Chip tone="accent">{settings.weighting}</Chip>
        <Chip tone="accent">{TIME_WEIGHTING_LABELS[settings.timeWeighting]}</Chip>
        {measurementState === 'measuring' ? <Chip tone="good">REC-M</Chip> : null}
        {measurementState === 'paused' ? <Chip tone="warn">PAUSED</Chip> : null}
        {recording ? (
          <Chip tone="bad">
            <span className="rec-dot">&#9679;</span> REC {formatDuration(recordingSeconds)}
          </Chip>
        ) : null}
        {clipping ? <Chip tone="bad">CLIP</Chip> : null}
        {dropouts ? <Chip tone="warn">DROP</Chip> : null}
        <span className="ml-auto shrink-0 text-[10px] text-faint">{expanded ? '\u25b2' : '\u25bc'}</span>
      </button>

      {expanded ? (
        <div className="border-t border-line bg-panel px-3 py-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="label label-strong mb-1.5">Acquisition</h3>
              <KeyValue
                entries={[
                  ['State', status.state],
                  ['Audio context', status.contextState ?? NO_VALUE],
                  ['Input', status.diagnostics?.deviceLabel ?? NO_VALUE],
                  [
                    'Graph sample rate',
                    status.sampleRate ? `${status.sampleRate} Hz` : NO_VALUE,
                  ],
                  [
                    'Device sample rate',
                    status.diagnostics?.trackSampleRate
                      ? `${status.diagnostics.trackSampleRate} Hz`
                      : 'not reported',
                  ],
                  ['Channels', status.diagnostics?.channelCount ?? NO_VALUE],
                  [
                    'Auto gain control',
                    describeFlag(status.diagnostics?.autoGainControl.actual),
                  ],
                  [
                    'Noise suppression',
                    describeFlag(status.diagnostics?.noiseSuppression.actual),
                  ],
                  [
                    'Echo cancellation',
                    describeFlag(status.diagnostics?.echoCancellation.actual),
                  ],
                  [
                    'Weighting accurate to',
                    status.weightingAccurateUpToHz
                      ? formatFrequency(status.weightingAccurateUpToHz)
                      : NO_VALUE,
                  ],
                  ['Metric rate', `${performance.metricRate}/s`],
                  ['Analysis rate', `${performance.analysisRate}/s`],
                  [
                    'Peak input',
                    metrics ? `${formatLevel(metrics.clipping.peakDb)} dBFS` : NO_VALUE,
                  ],
                ]}
              />
            </div>
            <div>
              <h3 className="label label-strong mb-1.5">Calibration</h3>
              <KeyValue
                entries={[
                  ['Status', <Badge key="s" tone={calibration.isCalibrated ? 'good' : 'warn'}>{quality.status}</Badge>],
                  ['Profile', calibration.profile?.name ?? 'None active'],
                  ['Reference', quality.referenceInstrument ?? NO_VALUE],
                  [
                    'Transform',
                    calibration.isCalibrated
                      ? `SPL = ${calibration.slope.toFixed(4)} \u00d7 dBFS ${calibration.intercept >= 0 ? '+' : '\u2212'} ${Math.abs(calibration.intercept).toFixed(2)}`
                      : 'None (levels are dBFS)',
                  ],
                  ['Age', quality.ageLine.value ?? NO_VALUE],
                  [
                    'Frequency correction',
                    calibration.frequencyCorrectionEnabled
                      ? (quality.frequencyLine.value ?? 'Active')
                      : 'Not applied',
                  ],
                  ['Mean error', quality.meanErrorLine.value ?? 'Not validated'],
                ]}
              />
              <div className="mt-2 flex gap-2">
                <Link href="/calibration">
                  <Button size="sm" variant="accent">
                    Calibration
                  </Button>
                </Link>
                <Link href="/diagnostics">
                  <Button size="sm">Diagnostics</Button>
                </Link>
              </div>
            </div>
          </div>

          {status.diagnostics?.warnings.length ? (
            <ul className="mt-3 space-y-1 border-t border-line pt-2 text-[11px] leading-relaxed text-warn">
              {status.diagnostics.warnings.map((warning) => (
                <li key={warning}>&bull; {warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function describeFlag(value: boolean | null | undefined): string {
  if (value === true) return 'ACTIVE (accuracy affected)';
  if (value === false) return 'disabled';
  return 'not reported';
}
