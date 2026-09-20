'use client';

import { useState } from 'react';
import { FFT_SIZES } from '@/dsp/fft';
import { WINDOW_IDS, WINDOW_LABELS, type WindowId } from '@/dsp/window';
import { WEIGHTING_IDS } from '@/dsp/weighting/reference';
import { useCalibration } from '@/state/CalibrationProvider';
import { useAnalysis, useEngineContext } from '@/state/EngineProvider';
import { useSettings } from '@/state/SettingsProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { SpectrumPlot } from '@/components/charts/SpectrumPlot';
import { InputGate } from '@/components/meter/InputGate';
import {
  Banner,
  Button,
  ControlRow,
  Panel,
  PanelHeader,
  SegmentedControl,
  Select,
  Slider,
  Toggle,
} from '@/components/ui/primitives';

export default function SpectrumPage() {
  const { settings, update } = useSettings();
  const { calibration } = useCalibration();
  const { status, engine } = useEngineContext();
  const frame = useAnalysis(60);
  const [axis, setAxis] = useState<'log' | 'linear'>('log');
  const [displayWeighting, setDisplayWeighting] = useState<'A' | 'C' | 'Z'>('Z');
  const [dynamicRange, setDynamicRange] = useState(90);

  const inputLive = status.state === 'running' || status.state === 'suspended';

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="FFT spectrum"
        subtitle="Spectral level of the windowed frame, using the same full-scale reference as the meter."
      />

      <InputGate />

      {inputLive ? (
        <>
          <Panel>
            <SpectrumPlot
              frame={frame}
              calibration={calibration}
              axis={axis}
              weighting={displayWeighting}
              dynamicRangeDb={dynamicRange}
              height={280}
            />
          </Panel>

          <Panel>
            <PanelHeader title="Display" />
            <ControlRow className="mb-3">
              <SegmentedControl
                label="Frequency axis"
                value={axis}
                onChange={setAxis}
                options={[
                  { value: 'log', label: 'Log f' },
                  { value: 'linear', label: 'Linear f' },
                ]}
              />
              <SegmentedControl
                label="Display weighting"
                value={displayWeighting}
                onChange={setDisplayWeighting}
                options={WEIGHTING_IDS.map((id) => ({
                  value: id,
                  label: id,
                  title:
                    id === 'Z'
                      ? 'Unweighted spectrum as measured'
                      : `${id} weighting applied to the displayed spectrum for reference`,
                }))}
              />
            </ControlRow>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label label-strong">FFT size</span>
                <div className="mt-1">
                  <Select
                    ariaLabel="FFT size"
                    value={String(settings.fftSize)}
                    onChange={(value) => update({ fftSize: Number(value) })}
                    options={FFT_SIZES.map((size) => ({
                      value: String(size),
                      label: `${size} points (${(size / (status.sampleRate ?? 48000)).toFixed(3)} s, ${((status.sampleRate ?? 48000) / size).toFixed(1)} Hz/bin)`,
                    }))}
                  />
                </div>
              </label>

              <label className="block">
                <span className="label label-strong">Window</span>
                <div className="mt-1">
                  <Select
                    ariaLabel="Analysis window"
                    value={settings.fftWindow}
                    onChange={(value) => update({ fftWindow: value as WindowId })}
                    options={WINDOW_IDS.map((id) => ({ value: id, label: WINDOW_LABELS[id] }))}
                  />
                </div>
              </label>

              <Slider
                label="Smoothing"
                min={0}
                max={0.9}
                step={0.05}
                value={settings.spectrumSmoothing}
                onChange={(value) => update({ spectrumSmoothing: value })}
                format={(value) => (value === 0 ? 'off' : value.toFixed(2))}
              />

              <Slider
                label="Dynamic range"
                min={40}
                max={140}
                step={10}
                value={dynamicRange}
                onChange={setDynamicRange}
                format={(value) => `${value} dB`}
              />
            </div>

            <div className="mt-1 border-t border-line pt-1">
              <Toggle
                label="Peak hold"
                description="Keeps the highest level seen in each bin. Shown as the amber trace."
                checked={settings.spectrumPeakHold}
                onChange={(checked) => update({ spectrumPeakHold: checked })}
              />
              {settings.spectrumPeakHold ? (
                <Button size="sm" variant="ghost" onClick={() => engine.clearPeakHold()}>
                  Clear peak hold
                </Button>
              ) : null}
            </div>
          </Panel>

          <Banner tone="info" title="Spectrum levels are not band levels">
            A bin shows the level of a tone landing in it. Broadband noise is spread over many bins,
            so each bin reads well below the total level &mdash; that is correct for a spectrum. For
            sound pressure level per band, use the octave analyser, which integrates energy across
            each band&rsquo;s full width with a Butterworth filter bank.
          </Banner>

          {settings.fftWindow === 'rectangular' ? (
            <Banner tone="warn">
              The rectangular window gives the narrowest main lobe but very high spectral leakage.
              Any tone not exactly on a bin centre will smear across the spectrum. Hann is the
              sensible default.
            </Banner>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
