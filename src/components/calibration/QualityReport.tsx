'use client';

/**
 * Calibration status summary.
 *
 * Every line is either a value computed from data in the profile, or an explicit
 * statement that the figure is not available. Nothing is filled in with a
 * plausible default.
 */

import type { CalibrationQualityReport, QualityLine } from '@/calibration/quality';
import type { CalibrationStatus } from '@/storage/types';
import { Badge, Banner, cx, type Tone } from '@/components/ui/primitives';

const STATUS_TONE: Record<CalibrationStatus, Tone> = {
  UNCALIBRATED: 'bad',
  'LEVEL CALIBRATED': 'warn',
  'FREQUENCY CALIBRATED': 'info',
  VALIDATED: 'good',
};

const STATUS_MEANING: Record<CalibrationStatus, string> = {
  UNCALIBRATED: 'No level calibration. Levels are shown as dBFS, not sound pressure level.',
  'LEVEL CALIBRATED':
    'A level calibration is active, so levels are shown as dB SPL. Frequency response is uncorrected.',
  'FREQUENCY CALIBRATED':
    'Level and frequency response are both calibrated. Independent validation has not been recorded.',
  VALIDATED:
    'Level and frequency response are calibrated and independent comparison measurements have been recorded.',
};

function LineRow({ line }: { line: QualityLine }) {
  const tone = line.tone ?? 'neutral';
  return (
    <div className="border-b border-line/60 py-1.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-faint">{line.label}</span>
        <span
          className={cx(
            'tnum text-right text-xs font-semibold',
            line.value === null
              ? 'text-faint'
              : tone === 'good'
                ? 'text-ok'
                : tone === 'warn'
                  ? 'text-warn'
                  : tone === 'bad'
                    ? 'text-bad'
                    : 'text-ink'
          )}
        >
          {line.value ?? 'Not available'}
        </span>
      </div>
      {line.note ? (
        <p className="mt-0.5 text-[10px] leading-snug text-faint">{line.note}</p>
      ) : null}
    </div>
  );
}

export function QualityReport({ report }: { report: CalibrationQualityReport }) {
  return (
    <div className="space-y-3">
      <div className="panel-sunken p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label label-strong">Calibration status</span>
          <Badge tone={STATUS_TONE[report.status]}>{report.status}</Badge>
          {report.referenceInstrument ? (
            <span className="text-[11px] text-faint">
              against {report.referenceInstrument}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          {STATUS_MEANING[report.status]}
        </p>
      </div>

      <div className="panel-sunken px-3 py-1">
        <LineRow line={report.levelLine} />
        <LineRow line={report.linearityLine} />
        <LineRow line={report.frequencyLine} />
        <LineRow line={report.meanErrorLine} />
        <LineRow line={report.maxErrorLine} />
        <LineRow line={report.ageLine} />
      </div>

      {report.warnings.length > 0 ? (
        <Banner tone="warn" title={`${report.warnings.length} thing${report.warnings.length === 1 ? '' : 's'} to be aware of`}>
          <ul className="space-y-1">
            {report.warnings.map((warning) => (
              <li key={warning}>&bull; {warning}</li>
            ))}
          </ul>
        </Banner>
      ) : (
        <Banner tone="good" title="No outstanding calibration concerns">
          Level and frequency calibration are present, validated by independent comparisons, and
          recent.
        </Banner>
      )}
    </div>
  );
}
