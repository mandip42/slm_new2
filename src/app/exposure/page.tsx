'use client';

import { useMemo } from 'react';
import {
  EXPOSURE_SCHEMES,
  allowedExposureHours,
  computeExposure,
  lex8h,
  type ExposureSchemeId,
} from '@/dsp/exposure';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import { formatDuration, formatDurationWords, formatLevel, NO_VALUE } from '@/lib/format';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext, useMetrics } from '@/state/EngineProvider';
import { useMeasurement } from '@/state/MeasurementProvider';
import { useSettings } from '@/state/SettingsProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { InputGate } from '@/components/meter/InputGate';
import {
  Banner,
  ControlRow,
  KeyValue,
  Metric,
  Panel,
  PanelHeader,
  SegmentedControl,
  cx,
} from '@/components/ui/primitives';

export default function ExposurePage() {
  const { settings, update } = useSettings();
  const { calibration } = useCalibration();
  const { status } = useEngineContext();
  const { state, elapsedSeconds } = useMeasurement();
  const snapshot = useMetrics(500);

  const inputLive = status.state === 'running' || status.state === 'suspended';
  const scheme = EXPOSURE_SCHEMES[settings.exposureScheme];

  const laeq = useMemo(() => {
    const raw = snapshot?.LAeq;
    if (raw === undefined || !Number.isFinite(raw) || raw <= LEVEL_FLOOR_DB) return null;
    if (!calibration.isCalibrated) return null;
    return calibration.toDisplay(raw);
  }, [snapshot?.LAeq, calibration]);

  const result = useMemo(() => {
    if (laeq === null || elapsedSeconds <= 0) return null;
    return computeExposure(scheme, laeq, elapsedSeconds);
  }, [scheme, laeq, elapsedSeconds]);

  const doseTone =
    result === null
      ? 'neutral'
      : result.dosePercent >= 100
        ? 'bad'
        : result.dosePercent >= 50
          ? 'warn'
          : 'good';

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="Noise exposure"
        subtitle="Educational dose indicators computed from the measured LAeq. Not a certified dosimeter and not medical advice."
      />

      <InputGate />

      {inputLive ? (
        <>
          <Panel>
            <PanelHeader title="Scheme" />
            <ControlRow>
              <SegmentedControl
                label="Exposure scheme"
                value={settings.exposureScheme}
                onChange={(value) => update({ exposureScheme: value as ExposureSchemeId })}
                options={[
                  { value: 'niosh', label: 'NIOSH-style' },
                  { value: 'osha', label: 'OSHA-style' },
                ]}
              />
            </ControlRow>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">{scheme.description}</p>
            <div className="mt-2">
              <KeyValue
                entries={[
                  ['Criterion level', `${scheme.criterionLevelDb} dBA for ${scheme.criterionHours} h`],
                  ['Exchange rate', `${scheme.exchangeRateDb} dB per doubling of allowed time`],
                  [
                    'Threshold',
                    scheme.thresholdDb === null
                      ? 'None applied'
                      : `${scheme.thresholdDb} dBA`,
                  ],
                  ['Threshold handling', scheme.thresholdNote],
                  ['Reference', scheme.reference],
                ]}
              />
            </div>
          </Panel>

          {!calibration.isCalibrated ? (
            <Banner tone="warn" title="Exposure needs a calibration">
              Dose is measured against an absolute criterion level in dBA, so it cannot be computed
              from a digital full-scale level. Calibrate against your reference instrument and the
              numbers below will appear. Nothing is estimated in the meantime.
            </Banner>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Metric
                  label="Dose"
                  value={result ? result.dosePercent.toFixed(1) : NO_VALUE}
                  unit="%"
                  tone={doseTone}
                  size="lg"
                  hint={`of the ${scheme.criterionHours} h allowance`}
                />
                <Metric
                  label="Current LAeq"
                  value={laeq !== null ? formatLevel(laeq) : NO_VALUE}
                  unit="dBA"
                  size="lg"
                  hint="running energy average"
                />
                <Metric
                  label="Elapsed"
                  value={formatDuration(elapsedSeconds)}
                  hint={state === 'measuring' ? 'measuring' : state === 'paused' ? 'paused' : 'not started'}
                />
                <Metric
                  label="Time-weighted average"
                  value={result && Number.isFinite(result.twaDb) ? formatLevel(result.twaDb) : NO_VALUE}
                  unit="dBA"
                  hint={`over ${scheme.criterionHours} h`}
                />
                <Metric
                  label="Remaining allowed"
                  value={
                    result
                      ? Number.isFinite(result.remainingSeconds)
                        ? formatDurationWords(result.remainingSeconds)
                        : 'unlimited'
                      : NO_VALUE
                  }
                  tone={result && result.remainingSeconds === 0 ? 'bad' : 'neutral'}
                  hint="at the current level"
                />
                <Metric
                  label="Projected 8 h level"
                  value={
                    result && Number.isFinite(result.projected8hDb)
                      ? formatLevel(result.projected8hDb)
                      : NO_VALUE
                  }
                  unit="dBA"
                  hint="LEX,8h from the measurement so far"
                />
              </div>

              <Panel>
                <PanelHeader title="Dose progress" />
                <div className="h-3 w-full overflow-hidden rounded-full bg-panel-sunken">
                  <div
                    className={cx(
                      'h-full rounded-full transition-[width]',
                      doseTone === 'bad' ? 'bg-bad' : doseTone === 'warn' ? 'bg-warn' : 'bg-ok'
                    )}
                    style={{ width: `${Math.min(100, result?.dosePercent ?? 0)}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-faint">
                  <span>0 %</span>
                  <span>100 % = full daily allowance</span>
                </div>
                {result && result.dosePercent > 100 ? (
                  <p className="mt-2 text-[11px] font-semibold text-bad">
                    The measured dose has exceeded 100 % of the {scheme.name.toLowerCase()} daily
                    allowance for this measurement period.
                  </p>
                ) : null}
              </Panel>

              <Panel>
                <PanelHeader
                  title="If this level continued"
                  hint="Extrapolation from the current LAeq, not a measurement."
                />
                <KeyValue
                  entries={[
                    [
                      'Allowed time at this level',
                      result && Number.isFinite(result.allowedSeconds)
                        ? formatDurationWords(result.allowedSeconds)
                        : 'unlimited',
                    ],
                    [
                      'Full-shift dose',
                      result ? `${result.projectedDosePercent.toFixed(0)} %` : NO_VALUE,
                    ],
                    [
                      'LEX,8h if sustained',
                      laeq !== null ? `${formatLevel(laeq)} dBA` : NO_VALUE,
                    ],
                    [
                      'LEX,8h from this measurement',
                      elapsedSeconds > 0 && laeq !== null
                        ? `${formatLevel(lex8h(laeq, elapsedSeconds))} dBA`
                        : NO_VALUE,
                    ],
                    [
                      result?.belowThreshold ? 'Below threshold' : 'Threshold',
                      result?.belowThreshold
                        ? `Level is below the ${scheme.thresholdDb} dBA threshold, so no dose accrues`
                        : scheme.thresholdDb === null
                          ? 'No threshold in this scheme'
                          : `${scheme.thresholdDb} dBA`,
                    ],
                  ]}
                />
              </Panel>

              <Panel>
                <PanelHeader title="Allowed exposure time by level" />
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="py-1 text-left font-semibold text-faint">LAeq (dBA)</th>
                        <th className="py-1 text-right font-semibold text-faint">Allowed time</th>
                      </tr>
                    </thead>
                    <tbody className="tnum">
                      {[80, 85, 88, 90, 91, 94, 95, 100, 105].map((level) => {
                        const hours = allowedExposureHours(scheme, level);
                        const belowThreshold =
                          scheme.thresholdDb !== null && level < scheme.thresholdDb;
                        return (
                          <tr key={level} className="border-b border-line/50">
                            <td className="py-1 text-ink">{level}</td>
                            <td className="py-1 text-right text-muted">
                              {belowThreshold
                                ? 'below threshold'
                                : formatDurationWords(hours * 3600)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          <Banner tone="info" title="What these numbers are and are not">
            The dose is computed from the measured LAeq over the elapsed measurement time using the
            criterion level, exchange rate and threshold shown above. AcousticLab is not a certified
            dosimeter, has not been type-approved, and nothing here is medical advice. For decisions
            about hearing protection or regulatory compliance, use appropriate certified
            instrumentation and qualified advice.
          </Banner>
        </>
      ) : null}
    </div>
  );
}
