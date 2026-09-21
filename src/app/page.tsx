'use client';

/**
 * Sound level meter dashboard.
 *
 * Layout, top to bottom, matching how a measurement is actually read:
 *   main level -> validity -> session metrics -> controls -> live history ->
 *   compact octave spectrum
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { HISTORY_TRACES } from '@/measurement/levelHistory';
import { APP_NAME, APP_TAGLINE, AUTHOR_CREDIT, AUTHOR_EMAIL } from '@/lib/branding';
import { formatLevel, NO_VALUE } from '@/lib/format';
import { useCalibration } from '@/state/CalibrationProvider';
import { useAnalysis, useEngineContext, useMetrics } from '@/state/EngineProvider';
import { useMeasurement } from '@/state/MeasurementProvider';
import { useSettings } from '@/state/SettingsProvider';
import { BigLevel, selectLevel } from '@/components/meter/BigLevel';
import { InputGate } from '@/components/meter/InputGate';
import { MeasurementControls } from '@/components/meter/MeasurementControls';
import { SecondaryMetrics } from '@/components/meter/SecondaryMetrics';
import { ValidityIndicator, assessValidity } from '@/components/meter/ValidityIndicator';
import { BandBars } from '@/components/charts/BandBars';
import { HistoryPlot } from '@/components/charts/HistoryPlot';
import { Badge, Banner, Button, Panel, PanelHeader } from '@/components/ui/primitives';

export default function MeterPage() {
  const { settings } = useSettings();
  const { calibration, quality } = useCalibration();
  const { status } = useEngineContext();
  const { history, historyVersion, state, savedSession, lastResult, discardResult } =
    useMeasurement();
  const snapshot = useMetrics(250);
  const analysis = useAnalysis(200);

  const displayLevel = useMemo(() => {
    const raw = selectLevel(snapshot, settings.weighting, settings.timeWeighting);
    return Number.isFinite(raw) ? calibration.toDisplay(raw) : NaN;
  }, [snapshot, settings.weighting, settings.timeWeighting, calibration]);

  const assessment = useMemo(
    () => assessValidity({ snapshot, status, calibration, quality, displayLevel }),
    [snapshot, status, calibration, quality, displayLevel]
  );

  const octaveBands = status.bandLayout?.octave ?? [];
  const inputLive = status.state === 'running' || status.state === 'suspended';

  return (
    <div className="space-y-3">
      <header className="flex items-start justify-between gap-3 px-1">
        <div>
          <h1 className="text-base leading-tight font-semibold tracking-tight text-ink">
            {APP_NAME}
          </h1>
          {!inputLive ? (
            <p className="mt-0.5 text-[11px] leading-snug text-faint">{APP_TAGLINE}</p>
          ) : null}
        </div>
        <Link href="/about" className="shrink-0">
          <Button size="sm" variant="ghost">
            About
          </Button>
        </Link>
      </header>

      <InputGate />

      {snapshot?.clipping.active ? (
        <Banner tone="bad" title="Clipping">
          The input is at or beyond digital full scale. Levels are being underestimated while this
          continues, and the affected periods are recorded in the session and marked in exports. Move
          further from the source or reduce the level.
        </Banner>
      ) : null}

      {savedSession ? (
        <Banner
          tone="good"
          title="Measurement saved"
          action={
            <div className="flex flex-wrap gap-2">
              <Link href={`/sessions?id=${encodeURIComponent(savedSession.id)}`}>
                <Button size="sm" variant="accent">
                  Open report
                </Button>
              </Link>
              <Button size="sm" variant="ghost" onClick={discardResult}>
                Dismiss
              </Button>
            </div>
          }
        >
          {savedSession.name} &middot; LAeq {formatLevel(savedSession.summary.LAeq)}{' '}
          {savedSession.summary.calibrated ? 'dB' : 'dBFS'} over{' '}
          {savedSession.durationSeconds.toFixed(1)} s.
        </Banner>
      ) : lastResult && !savedSession ? (
        <Banner tone="warn" title="Measurement finished but not saved">
          The results are still on screen. Check the storage section on the settings screen.
        </Banner>
      ) : null}

      {inputLive ? (
        <>
          <Panel>
            <BigLevel />
          </Panel>

          <ValidityIndicator assessment={assessment} />

          <SecondaryMetrics />

          <Panel>
            <MeasurementControls />
          </Panel>

          <Panel>
            <PanelHeader
              title="Level history"
              hint={`${settings.historyWindowSeconds >= 60 ? `${Math.round(settings.historyWindowSeconds / 60)} min` : `${settings.historyWindowSeconds} s`} window, ${history.intervalMs} ms resolution`}
              action={
                <Link href="/history">
                  <Button size="sm" variant="ghost">
                    Full view
                  </Button>
                </Link>
              }
            />
            <HistoryPlot
              history={history}
              version={historyVersion}
              calibration={calibration}
              traces={['LAF', 'LAeq']}
              windowSeconds={settings.historyWindowSeconds}
              height={140}
              compact
              showExtremes={false}
              showCursor={false}
            />
            <div className="mt-1 flex gap-3 px-1 text-[10px]">
              {HISTORY_TRACES.filter((t) => t.id === 'LAF' || t.id === 'LAeq').map((trace) => (
                <span key={trace.id} className="inline-flex items-center gap-1 text-faint">
                  <span className="h-2 w-2 rounded-sm" style={{ background: trace.colour }} />
                  {trace.label}
                </span>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Octave spectrum"
              hint={
                analysis
                  ? `${analysis.bankWeighting}-weighted band signal, order-6 Butterworth filter bank`
                  : 'Waiting for the analyser'
              }
              action={
                <Link href="/octave">
                  <Button size="sm" variant="ghost">
                    Full view
                  </Button>
                </Link>
              }
            />
            <BandBars
              bands={octaveBands}
              current={analysis?.octaveCurrent ?? null}
              leq={analysis?.octaveLeq ?? null}
              max={analysis?.octaveMax ?? null}
              calibration={calibration}
              mode="current"
              height={150}
              compact
            />
          </Panel>

          <Panel>
            <PanelHeader title="Statistical levels" hint="A-weighted Fast, sampled at 20 per second" />
            <div className="grid grid-cols-3 gap-2 text-center">
              {(['L10', 'L50', 'L90'] as const).map((key) => {
                const value = snapshot?.percentiles?.[key];
                return (
                  <div key={key} className="panel-sunken px-2 py-2">
                    <div className="label">{key}</div>
                    <div className="readout mt-0.5 text-xl font-semibold text-ink">
                      {value !== undefined && Number.isFinite(value)
                        ? formatLevel(calibration.toDisplay(value))
                        : NO_VALUE}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-faint">
              Ln is the level exceeded n % of the measurement time, so L90 is the background and L10
              the busier moments. Available after one second of measurement.
            </p>
          </Panel>

          {state === 'idle' && !calibration.isCalibrated ? (
            <Banner
              tone="info"
              title="Calibrate to measure sound pressure level"
              action={
                <Link href="/calibration">
                  <Button size="sm" variant="accent">
                    Set up calibration
                  </Button>
                </Link>
              }
            >
              A single simultaneous reading against your NTi XL2 is enough to start showing dB SPL.
              Until then every level on every screen is labelled dBFS.
            </Banner>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge tone={calibration.isCalibrated ? 'good' : 'warn'}>{quality.status}</Badge>
            <span className="text-[10px] text-faint">
              Sonoscope is a calibrated smartphone measurement tool, not an IEC 61672 classified
              sound level meter.
            </span>
          </div>
        </>
      ) : null}

      <footer className="border-t border-line pt-2 text-center text-[10px] leading-relaxed text-faint">
        {APP_NAME} &middot; {AUTHOR_CREDIT}{' '}
        <a href={`mailto:${AUTHOR_EMAIL}`} className="underline underline-offset-2">
          {AUTHOR_EMAIL}
        </a>
      </footer>
    </div>
  );
}
