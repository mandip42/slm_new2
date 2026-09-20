'use client';

/**
 * Multi-level linearity validation.
 *
 * Collects paired reference/phone readings across the level range and fits
 *
 *     SPL = slope * dBFS + intercept
 *
 * by ordinary least squares, reporting slope, intercept, R^2, RMSE, the worst
 * residual and the residual trend. If the slope departs from unity by more than
 * the warning threshold the user is told that a constant offset would be wrong
 * away from the calibration level, and the fitted slope is applied instead of
 * blindly using an offset.
 */

import { useMemo, useState } from 'react';
import { TIME_WEIGHTING_LABELS, type TimeWeightingId } from '@/dsp/timeWeighting';
import { WEIGHTING_IDS, type WeightingId } from '@/dsp/weighting/reference';
import {
  NONLINEAR_SLOPE_THRESHOLD,
  fitLinearCalibration,
  predictSpl,
  referenceRange,
} from '@/calibration/fit';
import { createId } from '@/lib/id';
import { formatLevel, formatNumber, formatSigned } from '@/lib/format';
import { applyLinearityFit } from '@/storage/calibrationStore';
import type { CalibrationProfile, LevelCalibrationPoint } from '@/storage/types';
import { AgreementChart, ResidualChart } from '@/components/charts/AgreementChart';
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
  SegmentedControl,
} from '@/components/ui/primitives';
import { CapturePad } from './CapturePad';
import { useLevelCapture } from './useLevelCapture';

/** Levels the masterplan's Experiment 1 suggests. */
const SUGGESTED_LEVELS = [45, 55, 65, 75, 85, 95] as const;

export function LinearityWizard({
  profile,
  onSave,
  onCancel,
}: {
  profile: CalibrationProfile;
  onSave: (profile: CalibrationProfile) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [weighting, setWeighting] = useState<WeightingId>(profile.level?.weighting ?? 'A');
  const [timeWeighting, setTimeWeighting] = useState<Exclude<TimeWeightingId, 'I'>>('S');
  const [windowSeconds, setWindowSeconds] = useState(10);
  const [referenceText, setReferenceText] = useState('');
  const [points, setPoints] = useState<LevelCalibrationPoint[]>(
    () => profile.level?.points.slice() ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = useLevelCapture(weighting, timeWeighting);
  const reference = Number.parseFloat(referenceText);
  const referenceValid = Number.isFinite(reference) && reference > -20 && reference < 200;
  const captured = capture.result;

  const fit = useMemo(() => fitLinearCalibration(points), [points]);
  const range = useMemo(() => referenceRange(points), [points]);

  const addPoint = () => {
    if (!captured || !referenceValid) return;
    setPoints((current) => [
      ...current,
      {
        id: createId('lpt'),
        at: captured.at,
        referenceDb: reference,
        phoneDbfs: captured.levelDbfs,
        weighting,
        timeWeighting,
        frequencyHz: null,
        notes: captured.stable ? '' : `capture range ${captured.rangeDb.toFixed(1)} dB`,
      },
    ]);
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
      await onSave(applyLinearityFit(profile, points));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The calibration could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const agreementPoints = useMemo(() => {
    if (!fit) return [];
    return points.map((point) => ({
      referenceDb: point.referenceDb,
      estimateDb: predictSpl(fit.slope, fit.intercept, point.phoneDbfs),
    }));
  }, [points, fit]);

  const residualPoints = useMemo(() => {
    if (!fit) return [];
    return points.map((point, index) => ({
      x: point.referenceDb,
      // Residual is reference minus prediction; the error of the estimate is the
      // negative of that, which is what a user reads as "how far off am I".
      errorDb: -fit.residuals[index],
    }));
  }, [points, fit]);

  const covered = new Set(
    points.map((point) => SUGGESTED_LEVELS.reduce((best, level) =>
      Math.abs(level - point.referenceDb) < Math.abs(best - point.referenceDb) ? level : best
    , SUGGESTED_LEVELS[0]))
  );

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader
          title="Multi-level linearity validation"
          hint="Establishes a verified level range and detects non-linear behaviour."
        />
        <p className="text-[11px] leading-relaxed text-muted">
          Measure the same sound field with both instruments at several levels, adding a point each
          time. Aim for the levels below, as far as is practical and safe. Change the level by
          changing the source output or the distance, never by moving only one of the two
          microphones.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTED_LEVELS.map((level) => (
            <Badge key={level} tone={covered.has(level) ? 'good' : 'neutral'}>
              {level} dB {covered.has(level) ? '\u2713' : ''}
            </Badge>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Measurement settings" />
        <div className="flex flex-wrap gap-2">
          <SegmentedControl
            label="Frequency weighting"
            value={weighting}
            onChange={setWeighting}
            options={WEIGHTING_IDS.map((id) => ({ value: id, label: id }))}
          />
          <SegmentedControl
            label="Time weighting"
            value={timeWeighting}
            onChange={(value) => setTimeWeighting(value)}
            options={[
              { value: 'F', label: TIME_WEIGHTING_LABELS.F },
              { value: 'S', label: TIME_WEIGHTING_LABELS.S },
            ]}
          />
        </div>
      </Panel>

      <CapturePad
        capture={capture}
        weighting={weighting}
        timeWeighting={timeWeighting}
        windowSeconds={windowSeconds}
        onWindowChange={setWindowSeconds}
      />

      <Panel>
        <PanelHeader title="Add a point" />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field
              label={`${profile.referenceInstrument} level`}
              error={
                referenceText.length > 0 && !referenceValid ? 'Enter a level between -20 and 200 dB.' : null
              }
            >
              <NumberInput
                value={referenceText}
                onChange={setReferenceText}
                placeholder="65.0"
                step={0.1}
                suffix={`dB${weighting}`}
                ariaLabel="Reference level for this point"
              />
            </Field>
          </div>
          <Button variant="accent" disabled={!captured || !referenceValid} onClick={addPoint}>
            Add point
          </Button>
        </div>
        {!captured ? (
          <p className="mt-2 text-[11px] text-faint">Capture a level above, then add the point.</p>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title={`Points (${points.length})`} />
        {points.length === 0 ? (
          <EmptyState title="No points yet">
            Add at least two points at clearly different levels to fit a slope. With one point only
            an offset can be determined.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-1 font-semibold text-faint">Reference</th>
                  <th className="py-1 font-semibold text-faint">Phone</th>
                  <th className="py-1 text-right font-semibold text-faint">Offset</th>
                  <th className="py-1 text-right font-semibold text-faint">Residual</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="tnum">
                {points
                  .map((point, index) => ({ point, index }))
                  .sort((a, b) => a.point.referenceDb - b.point.referenceDb)
                  .map(({ point, index }) => {
                    const residual = fit ? -fit.residuals[index] : null;
                    return (
                      <tr key={point.id} className="border-b border-line/50">
                        <td className="py-1 text-ink">{formatLevel(point.referenceDb)}</td>
                        <td className="py-1 text-muted">{formatLevel(point.phoneDbfs, 2)}</td>
                        <td className="py-1 text-right text-muted">
                          {formatSigned(point.referenceDb - point.phoneDbfs, 2)}
                        </td>
                        <td
                          className={
                            residual === null
                              ? 'py-1 text-right text-faint'
                              : Math.abs(residual) > 2
                                ? 'py-1 text-right text-bad'
                                : Math.abs(residual) > 1
                                  ? 'py-1 text-right text-warn'
                                  : 'py-1 text-right text-ok'
                          }
                        >
                          {residual === null ? '\u2014' : formatSigned(residual, 2)}
                        </td>
                        <td className="py-1 text-right">
                          <button
                            type="button"
                            onClick={() => removePoint(point.id)}
                            className="text-faint underline"
                            aria-label={`Remove the ${formatLevel(point.referenceDb)} dB point`}
                          >
                            remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {fit ? (
        <>
          <Panel>
            <PanelHeader title="Fit" hint="Ordinary least squares of reference against phone level" />
            <KeyValue
              entries={[
                ['Slope', formatNumber(fit.slope, 4)],
                ['Intercept', `${formatSigned(fit.intercept, 2)} dB`],
                ['R\u00b2', formatNumber(fit.r2, 5)],
                ['RMSE', `${formatNumber(fit.rmse, 2)} dB`],
                ['Mean absolute error', `${formatNumber(fit.meanAbsError, 2)} dB`],
                ['Worst residual', `${formatNumber(fit.maxAbsError, 2)} dB`],
                ['Points', String(fit.n)],
                [
                  'Verified range',
                  range ? `${formatLevel(range.minDb, 0)} to ${formatLevel(range.maxDb, 0)} dB` : '\u2014',
                ],
              ]}
            />
          </Panel>

          <Panel>
            <PanelHeader title="Agreement" />
            <AgreementChart points={agreementPoints} />
          </Panel>

          <Panel>
            <PanelHeader title="Residual error against level" />
            <ResidualChart points={residualPoints} />
          </Panel>

          {fit.nonLinear ? (
            <Banner tone="warn" title="The response is not linear">
              The fitted slope is {formatNumber(fit.slope, 4)}, which differs from 1 by more than{' '}
              {(NONLINEAR_SLOPE_THRESHOLD * 100).toFixed(0)} %. Over a 20 dB span that is about{' '}
              {Math.abs((fit.slope - 1) * 20).toFixed(1)} dB of error, so a single constant offset
              would be wrong away from the calibration level. Saving applies the fitted slope and
              intercept rather than an offset, and the verified range is recorded so readings outside
              it are flagged.
            </Banner>
          ) : (
            <Banner tone="good" title="The response is linear over the measured range">
              The fitted slope is {formatNumber(fit.slope, 4)}, close enough to 1 that a constant
              offset describes the device well across{' '}
              {range ? `${formatLevel(range.minDb, 0)} to ${formatLevel(range.maxDb, 0)} dB` : 'the measured range'}.
            </Banner>
          )}

          {fit.maxAbsError > 2 ? (
            <Banner tone="warn">
              One point differs from the fit by {formatNumber(fit.maxAbsError, 1)} dB. Check for a
              mis-typed reference reading, a moved microphone, or a source that was not steady during
              that capture.
            </Banner>
          ) : null}
        </>
      ) : points.length === 1 ? (
        <Banner tone="info">
          With one point only an offset can be determined. Saving now stores a single-point
          calibration; add a second point at a clearly different level to fit a slope and establish a
          verified range.
        </Banner>
      ) : null}

      {error ? <Banner tone="bad">{error}</Banner> : null}

      <div className="flex gap-2">
        <Button variant="primary" disabled={points.length === 0 || saving} onClick={() => void save()}>
          {saving ? 'Saving\u2026' : `Save ${points.length}-point calibration`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
