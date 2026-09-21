'use client';

/**
 * Frequency-response calibration.
 *
 * At each frequency the user exposes both instruments to the same stable source
 * and records the pair. The correction is
 *
 *     Correction(f) = Reference(f) - Sonoscope(f)
 *
 * Sonoscope's own reading is the **calibrated** level, so this wizard requires
 * a level calibration to exist first: without one, the phone value is a digital
 * level and the difference would be meaningless.
 *
 * Corrections are interpolated in log-frequency and never extrapolated beyond the
 * measured range.
 */

import { useMemo, useState } from 'react';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import { SUGGESTED_CALIBRATION_FREQUENCIES, buildCorrectionCurve, describeCorrectionCurve } from '@/calibration/frequencyCorrection';
import { createId } from '@/lib/id';
import { formatFrequency, formatLevel, formatNumber, formatSigned } from '@/lib/format';
import { applyFrequencyPoints } from '@/storage/calibrationStore';
import type { CalibrationProfile, FrequencyCalibrationPoint } from '@/storage/types';
import { CorrectionCurveChart } from '@/components/charts/CorrectionCurveChart';
import { ResidualChart } from '@/components/charts/AgreementChart';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  KeyValue,
  NumberInput,
  Panel,
  PanelHeader,
  cx,
} from '@/components/ui/primitives';
import { CapturePad } from './CapturePad';
import { useLevelCapture } from './useLevelCapture';
import { ActiveCalibration } from '@/calibration/activeCalibration';

export function FrequencyWizard({
  profile,
  onSave,
  onCancel,
}: {
  profile: CalibrationProfile;
  onSave: (profile: CalibrationProfile) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [windowSeconds, setWindowSeconds] = useState(10);
  const [frequencyText, setFrequencyText] = useState('1000');
  const [referenceText, setReferenceText] = useState('');
  const [points, setPoints] = useState<FrequencyCalibrationPoint[]>(
    () => profile.frequency?.points.slice() ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Band levels vary within a band, so a tone is measured with Z weighting
  // (flat) and Slow time weighting; the weighting curve must not be part of the
  // comparison.
  const capture = useLevelCapture('Z', 'S');

  // The phone value must be a calibrated SPL for the difference to be a
  // frequency-response correction rather than a mixture of offset and response.
  const levelCalibration = useMemo(
    () => ActiveCalibration.from(profile, { frequencyCorrection: false }),
    [profile]
  );

  const frequency = Number.parseFloat(frequencyText);
  const frequencyValid = Number.isFinite(frequency) && frequency >= 10 && frequency <= 24000;
  const reference = Number.parseFloat(referenceText);
  const referenceValid = Number.isFinite(reference) && reference > -20 && reference < 200;
  const captured = capture.result;

  const phoneSpl =
    captured && Number.isFinite(captured.levelDbfs) && captured.levelDbfs > LEVEL_FLOOR_DB
      ? levelCalibration.toDisplay(captured.levelDbfs)
      : null;

  const curve = useMemo(() => buildCorrectionCurve(points), [points]);
  const quality = useMemo(() => (curve ? describeCorrectionCurve(curve) : null), [curve]);

  const addPoint = () => {
    if (phoneSpl === null || !frequencyValid || !referenceValid || !captured) return;
    setPoints((current) => {
      const next = current.filter((p) => Math.abs(p.frequencyHz - frequency) > 0.5);
      return [
        ...next,
        {
          id: createId('fpt'),
          at: captured.at,
          frequencyHz: frequency,
          referenceDb: reference,
          phoneDb: phoneSpl,
          correctionDb: reference - phoneSpl,
          notes: captured.stable ? '' : `capture range ${captured.rangeDb.toFixed(1)} dB`,
        },
      ].sort((a, b) => a.frequencyHz - b.frequencyHz);
    });
    setReferenceText('');
    capture.clear();
  };

  const removePoint = (id: string) => {
    setPoints((current) => current.filter((point) => point.id !== id));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(applyFrequencyPoints(profile, points));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The correction could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const measured = new Set(points.map((p) => Math.round(p.frequencyHz)));

  if (!profile.level) {
    return (
      <div className="space-y-3">
        <Banner tone="warn" title="A level calibration is needed first">
          The frequency correction is the difference between the reference reading and{' '}
          <em>Sonoscope&rsquo;s calibrated level</em> at each frequency. Without a level
          calibration the phone value is a digital full-scale level, so the difference would mix the
          missing offset into every correction point and the curve would be wrong.
        </Banner>
        <Button variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader
          title="Frequency-response calibration"
          hint="Corrects the microphone response band by band."
        />
        <ol className="ml-4 list-decimal space-y-1 text-[11px] leading-relaxed text-muted">
          <li>
            Use a stable single-frequency source with the phone and reference microphones close
            together and the geometry fixed. Do not move anything between the pair of readings.
          </li>
          <li>
            Choose a level well above the noise floor and well below overload &mdash; 70 to 85 dB is
            usually comfortable.
          </li>
          <li>
            Set the reference instrument to Z (flat) weighting so the comparison is of response, not
            of weighting curves.
          </li>
          <li>Capture, enter the reference level, and add the point. Repeat per frequency.</li>
        </ol>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTED_CALIBRATION_FREQUENCIES.map((f) => {
            const done = [...measured].some((m) => Math.abs(m - f) / f < 0.05);
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFrequencyText(String(f))}
                className={cx(
                  'rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase',
                  done
                    ? 'border-ok/40 bg-ok/10 text-ok'
                    : 'border-line bg-panel-raised text-muted'
                )}
              >
                {formatFrequency(f)} {done ? '\u2713' : ''}
              </button>
            );
          })}
        </div>
      </Panel>

      <CapturePad
        capture={capture}
        weighting="Z"
        timeWeighting="S"
        windowSeconds={windowSeconds}
        onWindowChange={setWindowSeconds}
      />

      <Panel>
        <PanelHeader title="Add a frequency point" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Frequency"
            required
            error={
              frequencyText.length > 0 && !frequencyValid
                ? 'Enter a frequency between 10 and 24000 Hz.'
                : null
            }
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
            label={`${profile.referenceInstrument} level (Z weighted)`}
            required
            error={
              referenceText.length > 0 && !referenceValid ? 'Enter a level between -20 and 200 dB.' : null
            }
          >
            <NumberInput
              value={referenceText}
              onChange={setReferenceText}
              step={0.1}
              suffix="dBZ"
              ariaLabel="Reference level"
            />
          </Field>
        </div>

        {phoneSpl !== null ? (
          <div className="mt-3">
            <KeyValue
              entries={[
                ['Sonoscope calibrated level', `${formatLevel(phoneSpl)} dB SPL`],
                [
                  'Correction at this frequency',
                  referenceValid ? `${formatSigned(reference - phoneSpl, 2)} dB` : '\u2014',
                ],
              ]}
            />
          </div>
        ) : null}

        <div className="mt-3">
          <Button
            variant="accent"
            disabled={phoneSpl === null || !frequencyValid || !referenceValid}
            onClick={addPoint}
          >
            Add point at {frequencyValid ? formatFrequency(frequency) : 'this frequency'}
          </Button>
          {measured.has(Math.round(frequency)) ? (
            <p className="mt-1.5 text-[11px] text-warn">
              A point already exists at this frequency; adding will replace it.
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title={`Correction points (${points.length})`} />
        {points.length === 0 ? (
          <EmptyState title="No frequency points yet">
            At least two points are needed to build a curve. Working through the suggested
            frequencies from 63 Hz to 8 kHz gives a useful correction for most phones.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-1 font-semibold text-faint">Frequency</th>
                  <th className="py-1 font-semibold text-faint">Reference</th>
                  <th className="py-1 font-semibold text-faint">Sonoscope</th>
                  <th className="py-1 text-right font-semibold text-faint">Correction</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="tnum">
                {points.map((point) => (
                  <tr key={point.id} className="border-b border-line/50">
                    <td className="py-1 text-ink">{formatFrequency(point.frequencyHz)}</td>
                    <td className="py-1 text-muted">{formatLevel(point.referenceDb)}</td>
                    <td className="py-1 text-muted">{formatLevel(point.phoneDb)}</td>
                    <td
                      className={cx(
                        'py-1 text-right font-semibold',
                        Math.abs(point.correctionDb) > 10
                          ? 'text-bad'
                          : Math.abs(point.correctionDb) > 5
                            ? 'text-warn'
                            : 'text-ok'
                      )}
                    >
                      {formatSigned(point.correctionDb, 2)}
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        onClick={() => removePoint(point.id)}
                        className="text-faint underline"
                        aria-label={`Remove the ${formatFrequency(point.frequencyHz)} point`}
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {curve && quality ? (
        <>
          <Panel>
            <PanelHeader title="Correction curve" />
            <CorrectionCurveChart curve={curve} />
          </Panel>

          <Panel>
            <PanelHeader title="Response error before correction" />
            <ResidualChart
              points={points.map((p) => ({ x: p.frequencyHz, errorDb: -p.correctionDb }))}
              xLabel="Frequency (Hz)"
              logX
            />
          </Panel>

          <Panel>
            <PanelHeader title="Curve quality" />
            <KeyValue
              entries={[
                ['Points', String(quality.n)],
                [
                  'Validated range',
                  `${formatFrequency(quality.lowHz)} to ${formatFrequency(quality.highHz)}`,
                ],
                ['Mean absolute correction', `${formatNumber(quality.meanAbsCorrectionDb, 2)} dB`],
                ['Largest correction', `${formatNumber(quality.maxAbsCorrectionDb, 2)} dB`],
                ['Largest step between points', `${formatNumber(quality.maxAdjacentStepDb, 2)} dB`],
                ['Largest gap', `${formatNumber(quality.maxGapOctaves, 2)} octaves`],
              ]}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={quality.n >= 6 ? 'good' : 'warn'}>{quality.n} points</Badge>
              <Badge tone={quality.maxGapOctaves <= 1.2 ? 'good' : 'warn'}>
                {quality.maxGapOctaves <= 1.2 ? 'well spaced' : 'coarse spacing'}
              </Badge>
              <Badge tone={quality.maxAbsCorrectionDb <= 12 ? 'good' : 'warn'}>
                {quality.maxAbsCorrectionDb <= 12 ? 'plausible magnitude' : 'very large correction'}
              </Badge>
            </div>
          </Panel>

          {quality.maxGapOctaves > 1.2 ? (
            <Banner tone="warn">
              The largest gap between measured points is {quality.maxGapOctaves.toFixed(1)} octaves.
              The correction there is a straight line in log-frequency between two measurements, which
              may miss real structure in the microphone response. Add points inside the gap.
            </Banner>
          ) : null}

          {quality.maxAbsCorrectionDb > 12 ? (
            <Banner tone="warn">
              A correction of {quality.maxAbsCorrectionDb.toFixed(1)} dB is unusually large for a
              phone microphone in the mid band. Before trusting it, check that neither microphone was
              shadowed, that the source was steady, and that the reference instrument was set to Z
              weighting.
            </Banner>
          ) : null}
        </>
      ) : null}

      {error ? <Banner tone="bad">{error}</Banner> : null}

      <div className="flex gap-2">
        <Button variant="primary" disabled={points.length < 2 || saving} onClick={() => void save()}>
          {saving ? 'Saving\u2026' : `Save correction (${points.length} points)`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
