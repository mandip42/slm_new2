'use client';

import { useState } from 'react';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext } from '@/state/EngineProvider';
import { useSettings } from '@/state/SettingsProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Spectrogram } from '@/components/charts/Spectrogram';
import { InputGate } from '@/components/meter/InputGate';
import {
  Banner,
  Button,
  ControlRow,
  Panel,
  PanelHeader,
  SegmentedControl,
  Slider,
} from '@/components/ui/primitives';

export default function SpectrogramPage() {
  const { settings, update } = useSettings();
  const { calibration } = useCalibration();
  const { status } = useEngineContext();
  const [paused, setPaused] = useState(false);
  const [clearToken, setClearToken] = useState(0);
  const [axis, setAxis] = useState<'log' | 'linear'>('log');
  const [range, setRange] = useState<'20-20k' | '20-8k' | '100-20k'>('20-20k');

  const inputLive = status.state === 'running' || status.state === 'suspended';
  const nyquist = (status.sampleRate ?? 48000) / 2;

  const bounds =
    range === '20-8k'
      ? { min: 20, max: 8000 }
      : range === '100-20k'
        ? { min: 100, max: Math.min(20000, nyquist) }
        : { min: 20, max: Math.min(20000, nyquist) };

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="Spectrogram"
        subtitle="Time on the horizontal axis, frequency on the vertical, level as colour."
      />

      <InputGate />

      {inputLive ? (
        <>
          <Panel>
            <Spectrogram
              calibration={calibration}
              dynamicRangeDb={settings.spectrogramDynamicRangeDb}
              topDb={null}
              minHz={bounds.min}
              maxHz={bounds.max}
              axis={axis}
              height={320}
              paused={paused}
              clearToken={clearToken}
            />
          </Panel>

          <Panel>
            <PanelHeader title="Controls" />
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
                label="Frequency range"
                value={range}
                onChange={setRange}
                options={[
                  { value: '20-20k', label: '20 Hz - 20 kHz' },
                  { value: '20-8k', label: '20 Hz - 8 kHz' },
                  { value: '100-20k', label: '100 Hz - 20 kHz' },
                ]}
              />
            </ControlRow>

            <Slider
              label="Dynamic range"
              min={30}
              max={120}
              step={10}
              value={settings.spectrogramDynamicRangeDb}
              onChange={(value) => update({ spectrogramDynamicRangeDb: value })}
              format={(value) => `${value} dB`}
            />

            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant={paused ? 'primary' : 'default'}
                onClick={() => setPaused((value) => !value)}
              >
                {paused ? 'Resume' : 'Pause'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setClearToken((v) => v + 1)}>
                Clear
              </Button>
            </div>
          </Panel>

          <Banner tone="info">
            The colour scale tracks the observed peak in 5 dB steps so the image stays stable. Each
            output row shows the highest level among the FFT bins that fall inside it, which keeps a
            narrow tone visible instead of averaging it into the background. Colour is a perceptually
            uniform ramp, not a rainbow, so apparent brightness follows level.
          </Banner>

          {paused ? (
            <Banner tone="warn">
              The display is paused. Measurement, Leq integration and statistics all continue
              normally &mdash; only the drawing has stopped.
            </Banner>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
