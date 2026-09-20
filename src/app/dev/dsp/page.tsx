'use client';

/**
 * DSP developer lab.
 *
 * Runs generated signals through the **same** MeterEngine, filter bank and FFT
 * that microphone audio goes through, and compares the result against the value
 * that can be derived analytically. That is what makes it a validation tool
 * rather than a demo: if the number here is wrong, the number on the meter is
 * wrong in the same way.
 *
 * Deliberately not linked from the main navigation flow beyond the More screen
 * and the About page.
 */

import { useMemo, useState } from 'react';
import { MeterEngine, WARM_UP_SECONDS } from '@/dsp/engine';
import { dominantFrequency } from '@/dsp/fft';
import { blockLevelDb, blockPeakDb, dbToAmplitude, LEVEL_FLOOR_DB } from '@/dsp/levels';
import { broadbandFromBands } from '@/dsp/octave';
import { createBandPlan, createThirdOctaveBank } from '@/dsp/thirdOctave';
import { SIGNAL_LABELS, SIGNAL_TYPES, generateSignal, type SignalType } from '@/dsp/signals';
import { aWeightingDb, cWeightingDb } from '@/dsp/weighting/reference';
import { aWeightingDesign, cWeightingDesign } from '@/dsp/weighting/design';
import { formatFrequency, formatLevel, formatNumber, formatSigned, NO_VALUE } from '@/lib/format';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { BandBars } from '@/components/charts/BandBars';
import { ActiveCalibration } from '@/calibration/activeCalibration';
import {
  Banner,
  Button,
  ControlRow,
  Field,
  KeyValue,
  Metric,
  NumberInput,
  Panel,
  PanelHeader,
  SegmentedControl,
  Select,
  Slider,
  cx,
} from '@/components/ui/primitives';

const SAMPLE_RATES = [44100, 48000] as const;
const BLOCK_SIZE = 128;

interface LabResult {
  signalRms: number;
  signalPeak: number;
  dominantHz: number;
  LAF: number;
  LAS: number;
  LAI: number;
  LCF: number;
  LZF: number;
  LAeq: number;
  LCeq: number;
  LZeq: number;
  LAFmax: number;
  LAFmin: number;
  LZpeak: number;
  LAE: number;
  durationSeconds: number;
  clipEvents: number;
  bandLeq: Float32Array;
  bandCurrent: Float32Array;
  bandMax: Float32Array;
  bandSum: number;
  elapsedMs: number;
}

export default function DspLabPage() {
  const [sampleRate, setSampleRate] = useState<number>(48000);
  const [signalType, setSignalType] = useState<SignalType>('sine');
  const [frequencyText, setFrequencyText] = useState('1000');
  const [levelText, setLevelText] = useState('-20');
  const [duration, setDuration] = useState(3);
  const [result, setResult] = useState<LabResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frequency = Number.parseFloat(frequencyText);
  const level = Number.parseFloat(levelText);
  const frequencyValid = Number.isFinite(frequency) && frequency > 0 && frequency < sampleRate / 2;
  const levelValid = Number.isFinite(level) && level <= 0 && level > -140;

  const plan = useMemo(() => createBandPlan(sampleRate), [sampleRate]);
  const uncalibrated = useMemo(() => ActiveCalibration.uncalibrated(), []);

  const expected = useMemo(() => {
    if (!levelValid) return null;
    const isTone = signalType === 'sine' || signalType === 'square';
    const aCorrection = frequencyValid && isTone ? aWeightingDb(frequency) : null;
    const cCorrection = frequencyValid && isTone ? cWeightingDb(frequency) : null;
    return {
      z: level,
      a: aCorrection === null ? null : level + aCorrection,
      c: cCorrection === null ? null : level + cCorrection,
      aCorrection,
      cCorrection,
    };
  }, [level, levelValid, signalType, frequency, frequencyValid]);

  const run = () => {
    setRunning(true);
    setError(null);
    try {
      const started = performance.now();
      // The signal is generated WARM_UP_SECONDS longer than the measurement so
      // the engine's warm-up is covered by continuous signal rather than by a
      // spliced buffer, which would inject a broadband discontinuity.
      const total = duration + WARM_UP_SECONDS + 0.1;
      const signal = generateSignal({
        type: signalType,
        frequency: frequencyValid ? frequency : 1000,
        amplitude: dbToAmplitude(levelValid ? level : -20),
        durationSeconds: total,
        sampleRate,
        seed: 12345,
      });

      const engine = new MeterEngine({ sampleRate, dcBlock: false });
      const bank = createThirdOctaveBank(sampleRate);
      const warmSamples = Math.round((WARM_UP_SECONDS + 0.1) * sampleRate);

      for (let i = 0; i < signal.length; i += BLOCK_SIZE) {
        const block = signal.subarray(i, Math.min(i + BLOCK_SIZE, signal.length));
        engine.process(block);
        bank.processBlock(block);
        if (i < warmSamples && i + BLOCK_SIZE >= warmSamples) bank.enableStatistics();
      }

      const snapshot = engine.snapshot();
      const bands = bank.results();
      const availability = bank.bands.map((b) => b.available);
      const measured = signal.subarray(warmSamples);

      setResult({
        signalRms: blockLevelDb(measured),
        signalPeak: blockPeakDb(measured),
        dominantHz:
          signalType === 'silence' || signalType === 'impulse'
            ? NaN
            : dominantFrequency(measured, sampleRate, 16384),
        LAF: snapshot.LAF,
        LAS: snapshot.LAS,
        LAI: snapshot.LAI,
        LCF: snapshot.LCF,
        LZF: snapshot.LZF,
        LAeq: snapshot.LAeq,
        LCeq: snapshot.LCeq,
        LZeq: snapshot.LZeq,
        LAFmax: snapshot.LAFmax,
        LAFmin: snapshot.LAFmin,
        LZpeak: snapshot.LZpeak,
        LAE: snapshot.LAE,
        durationSeconds: snapshot.durationSeconds,
        clipEvents: snapshot.clipping.events,
        bandLeq: Float32Array.from(bands.leq),
        bandCurrent: Float32Array.from(bands.current),
        bandMax: Float32Array.from(bands.max),
        bandSum: broadbandFromBands(bands.leq, availability),
        elapsedMs: performance.now() - started,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  const aDesign = useMemo(() => aWeightingDesign(sampleRate), [sampleRate]);
  const cDesign = useMemo(() => cWeightingDesign(sampleRate), [sampleRate]);

  const check = (measured: number, target: number | null, tolerance: number) => {
    if (target === null || !Number.isFinite(measured) || measured <= LEVEL_FLOOR_DB) {
      return { text: NO_VALUE, tone: 'neutral' as const };
    }
    const delta = measured - target;
    return {
      text: formatSigned(delta, 3),
      tone: Math.abs(delta) <= tolerance ? ('good' as const) : ('bad' as const),
    };
  };

  const zCheck = result ? check(result.LZeq, expected?.z ?? null, 0.05) : null;
  const aCheck = result ? check(result.LAeq, expected?.a ?? null, 0.6) : null;
  const cCheck = result ? check(result.LCeq, expected?.c ?? null, 0.6) : null;

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="DSP developer lab"
        subtitle="Deterministic validation: generated signals through the production DSP chain, with no microphone involved."
      />

      <Banner tone="info" title="Same code as the microphone path">
        The signal below is processed by the identical MeterEngine and one-third-octave filter bank
        that the AudioWorklet runs on live audio. Nothing here is a separate implementation, so a
        result that agrees with the analytic expectation is evidence about the real measurement path.
      </Banner>

      <Panel>
        <PanelHeader title="Signal" />
        <div className="space-y-3">
          <ControlRow>
            <SegmentedControl
              label="Sample rate"
              value={String(sampleRate)}
              onChange={(value) => setSampleRate(Number(value))}
              options={SAMPLE_RATES.map((rate) => ({ value: String(rate), label: `${rate} Hz` }))}
            />
          </ControlRow>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Signal type">
              <Select
                value={signalType}
                onChange={(value) => setSignalType(value as SignalType)}
                options={SIGNAL_TYPES.map((type) => ({ value: type, label: SIGNAL_LABELS[type] }))}
                ariaLabel="Signal type"
              />
            </Field>
            <Field
              label="Frequency"
              hint="Used by tone, square, burst and sweep."
              error={frequencyText.length > 0 && !frequencyValid ? 'Must be above 0 and below Nyquist.' : null}
            >
              <NumberInput
                value={frequencyText}
                onChange={setFrequencyText}
                step={1}
                suffix="Hz"
                ariaLabel="Frequency"
              />
            </Field>
            <Field
              label="Level"
              hint="RMS for continuous signals, peak for the impulse."
              error={levelText.length > 0 && !levelValid ? 'Must be between -140 and 0 dBFS.' : null}
            >
              <NumberInput
                value={levelText}
                onChange={setLevelText}
                step={1}
                suffix="dBFS"
                ariaLabel="Level"
              />
            </Field>
            <Slider
              label="Measurement duration"
              min={1}
              max={20}
              step={1}
              value={duration}
              onChange={setDuration}
              format={(value) => `${value} s`}
            />
          </div>

          <Button variant="primary" disabled={running || !levelValid} onClick={run}>
            {running ? 'Processing\u2026' : 'Run through the DSP chain'}
          </Button>
          <p className="text-[11px] text-faint">
            {duration + WARM_UP_SECONDS + 0.1} s of signal is generated and processed in{' '}
            {BLOCK_SIZE}-sample blocks, matching the Web Audio render quantum. The first{' '}
            {WARM_UP_SECONDS + 0.1} s covers the acquisition warm-up and is not integrated.
          </p>
        </div>
      </Panel>

      {error ? <Banner tone="bad">{error}</Banner> : null}

      {result ? (
        <>
          <Panel>
            <PanelHeader
              title="Verification against the analytic expectation"
              hint="Difference between what the engine measured and what theory predicts."
            />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="py-1 font-semibold text-faint">Quantity</th>
                    <th className="py-1 text-right font-semibold text-faint">Expected</th>
                    <th className="py-1 text-right font-semibold text-faint">Measured</th>
                    <th className="py-1 text-right font-semibold text-faint">Difference</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  <Row
                    label="LZeq (unweighted)"
                    expected={expected?.z ?? null}
                    measured={result.LZeq}
                    check={zCheck}
                  />
                  <Row
                    label="LAeq"
                    expected={expected?.a ?? null}
                    measured={result.LAeq}
                    check={aCheck}
                    note={
                      expected?.aCorrection !== null && expected?.aCorrection !== undefined
                        ? `A weighting at ${formatFrequency(frequency)} = ${formatSigned(expected.aCorrection, 2)} dB`
                        : 'Only predictable for a single tone'
                    }
                  />
                  <Row
                    label="LCeq"
                    expected={expected?.c ?? null}
                    measured={result.LCeq}
                    check={cCheck}
                    note={
                      expected?.cCorrection !== null && expected?.cCorrection !== undefined
                        ? `C weighting at ${formatFrequency(frequency)} = ${formatSigned(expected.cCorrection, 2)} dB`
                        : 'Only predictable for a single tone'
                    }
                  />
                  <Row
                    label="Direct RMS of the signal"
                    expected={expected?.z ?? null}
                    measured={result.signalRms}
                    check={result ? check(result.signalRms, expected?.z ?? null, 0.05) : null}
                    note="Independent computation, not through the engine"
                  />
                  <Row
                    label="Sum of 1/3-octave band Leq"
                    expected={expected?.z ?? null}
                    measured={result.bandSum}
                    check={result ? check(result.bandSum, expected?.z ?? null, 0.5) : null}
                    note="Energy sum of the filter bank; band skirts overlap slightly"
                  />
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="All engine outputs" />
            <div className="grid grid-cols-3 gap-2">
              <Metric label="LAF" value={formatLevel(result.LAF, 2)} unit="dBFS" size="sm" />
              <Metric label="LAS" value={formatLevel(result.LAS, 2)} unit="dBFS" size="sm" />
              <Metric label="LAI" value={formatLevel(result.LAI, 2)} unit="dBFS" size="sm" />
              <Metric label="LCF" value={formatLevel(result.LCF, 2)} unit="dBFS" size="sm" />
              <Metric label="LZF" value={formatLevel(result.LZF, 2)} unit="dBFS" size="sm" />
              <Metric label="LAeq" value={formatLevel(result.LAeq, 2)} unit="dBFS" size="sm" />
              <Metric label="LAFmax" value={formatLevel(result.LAFmax, 2)} unit="dBFS" size="sm" />
              <Metric label="LAFmin" value={formatLevel(result.LAFmin, 2)} unit="dBFS" size="sm" />
              <Metric label="LZpeak" value={formatLevel(result.LZpeak, 2)} unit="dBFS" size="sm" />
            </div>
            <KeyValue
              entries={[
                ['Integrated duration', `${formatNumber(result.durationSeconds, 3)} s`],
                ['LAE (SEL)', `${formatLevel(result.LAE, 2)} dBFS`],
                ['Signal peak', `${formatLevel(result.signalPeak, 2)} dBFS`],
                [
                  'Crest factor',
                  `${formatNumber(result.signalPeak - result.signalRms, 2)} dB`,
                ],
                [
                  'Dominant frequency (FFT)',
                  Number.isFinite(result.dominantHz) ? formatFrequency(result.dominantHz) : NO_VALUE,
                ],
                ['Clipping events', String(result.clipEvents)],
                ['Processing time', `${formatNumber(result.elapsedMs, 1)} ms`],
                [
                  'Real-time factor',
                  `${formatNumber((duration * 1000) / Math.max(0.001, result.elapsedMs), 1)}\u00d7`,
                ],
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader title="One-third-octave band Leq" />
            <BandBars
              bands={plan.thirdBands}
              current={result.bandCurrent}
              leq={result.bandLeq}
              max={result.bandMax}
              calibration={uncalibrated}
              mode="leq"
              height={230}
            />
          </Panel>
        </>
      ) : null}

      <Panel>
        <PanelHeader title="Weighting filter design at this sample rate" />
        <KeyValue
          entries={[
            ['A weighting sections', String(aDesign.sections.length)],
            ['A weighting HF pole', formatFrequency(aDesign.hfPoleHz)],
            ['A weighting placement', aDesign.placement],
            ['A worst fit error', `${formatNumber(aDesign.maxFitErrorDb, 4)} dB`],
            [
              'A fit range',
              `${formatFrequency(aDesign.fitRange.lowHz)} to ${formatFrequency(aDesign.fitRange.highHz)}`,
            ],
            ['C weighting sections', String(cDesign.sections.length)],
            ['C weighting HF pole', formatFrequency(cDesign.hfPoleHz)],
            ['C worst fit error', `${formatNumber(cDesign.maxFitErrorDb, 4)} dB`],
            [
              'Measurable 1/3-octave bands',
              `${plan.thirdBands.filter((b) => b.available).length} of ${plan.thirdBands.length}`,
            ],
          ]}
        />
      </Panel>

      <Panel>
        <PanelHeader title="Automated test suite" />
        <p className="text-xs leading-relaxed text-muted">
          This screen is for interactive exploration. The authoritative validation is the automated
          suite, which runs the same DSP against analytically known signals and fails the build if any
          result drifts:
        </p>
        <pre className="mt-2 overflow-x-auto rounded border border-line bg-panel-sunken p-2 text-[11px] text-accent">
          npm test
        </pre>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          It covers RMS and decibel conversion, A/C/Z weighting frequency response against the exact
          analog prototypes at 31.5 Hz to 16 kHz, time-weighting step and decay behaviour, energy
          averaging, sound exposure level, FFT peak identification, band allocation and energy
          conservation in the filter bank, percentile calculation, and the exposure schemes.
        </p>
      </Panel>
    </div>
  );
}

function Row({
  label,
  expected,
  measured,
  check,
  note,
}: {
  label: string;
  expected: number | null;
  measured: number;
  check: { text: string; tone: 'good' | 'bad' | 'neutral' } | null;
  note?: string;
}) {
  return (
    <tr className="border-b border-line/50">
      <td className="py-1.5 pr-2 text-ink">
        {label}
        {note ? <span className="block text-[10px] text-faint">{note}</span> : null}
      </td>
      <td className="py-1.5 text-right text-muted">
        {expected === null ? NO_VALUE : formatLevel(expected, 2)}
      </td>
      <td className="py-1.5 text-right text-muted">{formatLevel(measured, 2)}</td>
      <td className="py-1.5 text-right">
        {check ? (
          <span
            className={cx(
              'font-semibold',
              check.tone === 'good' ? 'text-ok' : check.tone === 'bad' ? 'text-bad' : 'text-faint'
            )}
          >
            {check.text}
          </span>
        ) : (
          NO_VALUE
        )}
      </td>
    </tr>
  );
}

export const dynamic = 'force-static';
