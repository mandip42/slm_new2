'use client';

import { useMemo, useState } from 'react';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import { WEIGHTING_IDS } from '@/dsp/weighting/reference';
import { formatLevel, NO_VALUE } from '@/lib/format';
import { useCalibration } from '@/state/CalibrationProvider';
import { useAnalysis, useEngineContext } from '@/state/EngineProvider';
import { useSettings } from '@/state/SettingsProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { BandBars, type BandDisplayMode } from '@/components/charts/BandBars';
import { InputGate } from '@/components/meter/InputGate';
import {
  Badge,
  Banner,
  ControlRow,
  KeyValue,
  Panel,
  PanelHeader,
  SegmentedControl,
  Toggle,
} from '@/components/ui/primitives';

export default function OctavePage() {
  const { settings, update } = useSettings();
  const { calibration } = useCalibration();
  const { status } = useEngineContext();
  const frame = useAnalysis(120);
  const [mode, setMode] = useState<BandDisplayMode>('current');
  const [autoScale, setAutoScale] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  const fraction = settings.octaveFraction;
  const bands = useMemo(
    () => (fraction === 1 ? status.bandLayout?.octave : status.bandLayout?.thirdOctave) ?? [],
    [fraction, status.bandLayout]
  );

  const current = fraction === 1 ? (frame?.octaveCurrent ?? null) : (frame?.thirdCurrent ?? null);
  const leq = fraction === 1 ? (frame?.octaveLeq ?? null) : (frame?.thirdLeq ?? null);
  const max = fraction === 1 ? (frame?.octaveMax ?? null) : (frame?.thirdMax ?? null);

  const inputLive = status.state === 'running' || status.state === 'suspended';
  const unit = calibration.isCalibrated ? 'dB' : 'dBFS';

  // Broadband level reconstructed from the bands, which is also how the
  // frequency-corrected broadband level is produced.
  const broadband = useMemo(() => {
    if (!frame || bands.length === 0) return null;
    const source = fraction === 1 ? frame.octaveLeq : frame.thirdLeq;
    if (!source || source.length !== bands.length) return null;
    let energy = 0;
    let used = 0;
    for (let i = 0; i < bands.length; i++) {
      if (!bands[i].available) continue;
      const value = source[i];
      if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) continue;
      energy += Math.pow(10, value / 10);
      used++;
    }
    if (used === 0) return null;
    return { levelDb: calibration.toDisplay(10 * Math.log10(energy)), bandsUsed: used };
  }, [frame, bands, fraction, calibration]);

  const corrected = useMemo(() => {
    if (!frame || bands.length === 0) return null;
    const source = fraction === 1 ? frame.octaveLeq : frame.thirdLeq;
    if (!source) return null;
    return calibration.correctedBroadbandLevel(
      source,
      bands.map((b) => b.exact),
      bands.map((b) => b.available)
    );
  }, [frame, bands, fraction, calibration]);

  const unavailable = bands.filter((b) => !b.available);
  const partial = bands.filter((b) => b.available && b.unavailableReason);

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="Octave analyser"
        subtitle="Order-6 Butterworth filter bank running at the full sample rate. Band energy is integrated across each band's full width."
      />

      <InputGate />

      {inputLive ? (
        <>
          <Panel>
            <ControlRow className="mb-2">
              <SegmentedControl
                label="Band resolution"
                value={String(fraction)}
                onChange={(value) => update({ octaveFraction: value === '1' ? 1 : 3 })}
                options={[
                  { value: '1', label: '1/1 octave' },
                  { value: '3', label: '1/3 octave' },
                ]}
              />
              <SegmentedControl
                label="Value shown"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'current', label: 'Live' },
                  { value: 'leq', label: 'Leq' },
                  { value: 'max', label: 'Max' },
                ]}
              />
            </ControlRow>

            <BandBars
              bands={bands}
              current={current}
              leq={leq}
              max={max}
              calibration={calibration}
              mode={mode}
              height={260}
              range={autoScale ? null : { min: calibration.isCalibrated ? 20 : -100, max: calibration.isCalibrated ? 110 : 0 }}
              onSelectBand={setSelected}
              selectedIndex={selected}
            />

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
              <span className="inline-flex items-center gap-1 text-faint">
                <span className="h-2 w-3 rounded-sm bg-accent" /> {mode === 'leq' ? 'Leq' : mode === 'max' ? 'Max' : 'Live'}
              </span>
              <span className="inline-flex items-center gap-1 text-faint">
                <span className="h-0.5 w-3 bg-warn" /> Leq
              </span>
              <span className="inline-flex items-center gap-1 text-faint">
                <span className="h-0.5 w-3 border-t border-dashed border-bad" /> Max
              </span>
              <span className="inline-flex items-center gap-1 text-faint">
                <span className="h-2 w-3 rounded-sm bg-violet" /> outside calibrated range
              </span>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Scaling and weighting" />
            <ControlRow>
              <SegmentedControl
                label="Band pre-weighting"
                value={settings.bankWeighting}
                onChange={(value) => update({ bankWeighting: value })}
                options={WEIGHTING_IDS.map((id) => ({
                  value: id,
                  label: id,
                  title:
                    id === 'Z'
                      ? 'Unweighted band levels'
                      : `${id}-weighted band levels: the signal passes a real ${id} weighting filter before the filter bank`,
                }))}
              />
            </ControlRow>
            <div className="mt-1">
              <Toggle
                label="Auto scale"
                description="Fits the vertical axis to the data. Turn off for a fixed axis when comparing screens."
                checked={autoScale}
                onChange={setAutoScale}
              />
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-faint">
              Changing the pre-weighting resets the accumulated band Leq and band maxima, because
              mixing two weightings in one average would be meaningless.
            </p>
          </Panel>

          <Panel>
            <PanelHeader
              title="Broadband from bands"
              hint="Energy sum of the measured bands, which is how a frequency-corrected broadband level is produced."
            />
            <KeyValue
              entries={[
                [
                  `Sum of ${fraction === 1 ? 'octave' : 'one-third-octave'} band Leq`,
                  broadband
                    ? `${formatLevel(broadband.levelDb)} ${unit} (${broadband.bandsUsed} bands)`
                    : NO_VALUE,
                ],
                [
                  'Frequency-corrected',
                  corrected
                    ? `${formatLevel(corrected.levelDb)} ${unit} (${corrected.bandsUsed} bands, ${corrected.bandsOutsideCalibration} outside calibration)`
                    : 'Requires a frequency-response calibration',
                ],
                ['Band signal weighting', frame?.bankWeighting ?? NO_VALUE],
                [
                  'Bands integrated',
                  frame ? `${frame.bandSamples.toLocaleString()} samples` : NO_VALUE,
                ],
              ]}
            />
          </Panel>

          {unavailable.length > 0 ? (
            <Banner tone="warn" title="Bands outside the measurable range">
              {unavailable.length} band{unavailable.length === 1 ? '' : 's'} cannot be measured at{' '}
              {status.sampleRate} Hz because the upper band edge comes too close to the Nyquist
              frequency: {unavailable.map((b) => b.label).join(', ')} Hz. They are drawn hatched
              rather than shown as a low level.
              {partial.length > 0 ? (
                <span className="mt-1 block">
                  {partial.map((b) => b.label).join(', ')} Hz{' '}
                  {partial.length === 1 ? 'is a partial octave' : 'are partial octaves'}: not all
                  constituent one-third-octave bands are measurable, so the level is an
                  underestimate.
                </span>
              ) : null}
            </Banner>
          ) : null}

          {status.bandLayout?.unstableBands.length ? (
            <Banner tone="bad" title="Filter design problem">
              {status.bandLayout.unstableBands.length} band filter(s) could not be designed stably at
              this sample rate and have been disabled rather than producing wrong numbers.
            </Banner>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">IEC 61260 base-ten band definitions</Badge>
            <span className="text-[10px] text-faint">
              f&#8348; = 1000 &middot; G^(x/b) with G = 10^(3/10); edges at f&#8348; &middot;
              G^(&plusmn;1/2b)
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
