/**
 * CSV export.
 *
 * Column names carry their unit, and the unit says whether the value is a
 * calibrated sound pressure level or a raw digital level: `LAF_dBA` versus
 * `LAF_dBA_FS`. A file that does not say which one it holds is a file that will
 * eventually be misread.
 *
 * Every export starts with a commented metadata header so a file found later can
 * still be interpreted.
 */

import { formatDurationWords, isoTimestamp } from '@/lib/format';
import type {
  CalibrationProfile,
  SessionBandResults,
  SessionRecord,
  SessionSeries,
  ValidationExperiment,
} from '@/storage/types';

const EOL = '\r\n';

function escapeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function rows(lines: Array<Array<string | number | boolean | null | undefined>>): string {
  return lines.map((line) => line.map(escapeCell).join(',')).join(EOL) + EOL;
}

function comment(text: string): string {
  return `# ${text}${EOL}`;
}

function num(value: number | null | undefined, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value.toFixed(decimals);
}

/** Metadata header shared by every session export. */
function sessionHeader(session: SessionRecord, what: string): string {
  const unit = session.summary.unit;
  return (
    comment(`AcousticLab ${what}`) +
    comment(`exported_at=${isoTimestamp()}`) +
    comment(`session_id=${session.id}`) +
    comment(`session_name=${session.name}`) +
    comment(`started_at=${isoTimestamp(session.startedAt)}`) +
    comment(`duration=${formatDurationWords(session.durationSeconds)}`) +
    comment(`sample_rate_hz=${session.sampleRate}`) +
    comment(`level_unit=${unit}`) +
    comment(
      `calibrated=${session.summary.calibrated} profile=${session.calibration.profileName ?? 'none'} status=${session.calibration.status}`
    ) +
    comment(
      `calibration_transform=SPL = ${session.calibration.slope} * dBFS + ${session.calibration.intercept}`
    ) +
    comment(`frequency_correction_applied=${session.calibration.frequencyCorrectionApplied}`) +
    comment(`device=${session.device.model} / ${session.device.browser}`) +
    comment(`device_audio_processing_suspected=${session.device.processingSuspected}`) +
    comment(
      `clipping_events=${session.clipping.events} clipping_affected=${session.clippingAffected}`
    ) +
    comment(`measurement_complete=${!session.incomplete}`)
  );
}

/** Suffix used on level column names, e.g. "dBA" or "dBA_FS". */
function levelSuffix(calibrated: boolean, weighting: 'A' | 'C' | 'Z'): string {
  return calibrated ? `dB${weighting}` : `dB${weighting}_FS`;
}

/**
 * Time-series export.
 *
 * The clipping column marks samples that fall inside a recorded clipping event,
 * so an affected part of a measurement can be excluded during analysis.
 */
export function sessionTimeSeriesCsv(session: SessionRecord, series: SessionSeries): string {
  const calibrated = session.summary.calibrated;
  const header = [
    'timestamp_ms',
    'elapsed_s',
    `LAF_${levelSuffix(calibrated, 'A')}`,
    `LAS_${levelSuffix(calibrated, 'A')}`,
    `LCF_${levelSuffix(calibrated, 'C')}`,
    `LZF_${levelSuffix(calibrated, 'Z')}`,
    `LAeq_${levelSuffix(calibrated, 'A')}`,
    'clipping',
  ];

  const clipWindows = session.clipping.eventTimes;
  const isClipped = (elapsed: number) =>
    clipWindows.some((t) => elapsed >= t - 0.1 && elapsed <= t + 1);

  const lines: Array<Array<string | number>> = [header];
  for (let i = 0; i < series.elapsed.length; i++) {
    const elapsed = series.elapsed[i];
    lines.push([
      Math.round(session.startedAt + elapsed * 1000),
      elapsed.toFixed(3),
      num(series.LAF[i], 2),
      num(series.LAS[i], 2),
      num(series.LCF[i], 2),
      num(series.LZF[i], 2),
      num(series.LAeq[i], 2),
      isClipped(elapsed) ? '1' : '0',
    ]);
  }

  return sessionHeader(session, 'measurement time series') + rows(lines);
}

/** Octave or one-third-octave band export. */
export function sessionBandCsv(
  session: SessionRecord,
  bands: SessionBandResults,
  label: string
): string {
  const suffix = bands.calibrated ? 'db_spl' : 'dbfs';
  const header = [
    'timestamp_ms',
    'nominal_frequency_hz',
    'exact_centre_frequency_hz',
    'lower_edge_hz',
    'upper_edge_hz',
    `band_level_${suffix}`,
    `band_leq_${suffix}`,
    `band_max_${suffix}`,
    'band_weighting',
    'available',
    'note',
  ];

  const lines: Array<Array<string | number>> = [header];
  for (let i = 0; i < bands.bands.length; i++) {
    const band = bands.bands[i];
    lines.push([
      session.endedAt ?? session.startedAt,
      band.nominal,
      band.exact.toFixed(3),
      band.lower.toFixed(3),
      band.upper.toFixed(3),
      num(bands.current[i], 2),
      num(bands.leq[i], 2),
      num(bands.max[i], 2),
      bands.weighting,
      band.available ? '1' : '0',
      band.unavailableReason ?? '',
    ]);
  }

  return (
    sessionHeader(session, `${label} band results`) +
    comment(`band_weighting=${bands.weighting}`) +
    rows(lines)
  );
}

/** One-row-per-metric summary, easy to paste into a report. */
export function sessionSummaryCsv(session: SessionRecord): string {
  const s = session.summary;
  const unit = s.unit;
  const lines: Array<Array<string | number>> = [
    ['metric', 'value', 'unit'],
    ['duration', s.durationSeconds.toFixed(2), 's'],
    ['LAeq', num(s.LAeq), unit],
    ['LCeq', num(s.LCeq), unit],
    ['LZeq', num(s.LZeq), unit],
    ['LAE_SEL', num(s.LAE), unit],
    ['LAFmax', num(s.LAFmax), unit],
    ['LAFmin', num(s.LAFmin), unit],
    ['LASmax', num(s.LASmax), unit],
    ['LASmin', num(s.LASmin), unit],
    ['LAImax', num(s.LAImax), unit],
    ['LCFmax', num(s.LCFmax), unit],
    ['LZFmax', num(s.LZFmax), unit],
    ['LZFmin', num(s.LZFmin), unit],
    ['LApeak', num(s.LApeak), unit],
    ['LCpeak', num(s.LCpeak), unit],
    ['LZpeak', num(s.LZpeak), unit],
  ];

  if (s.percentiles) {
    for (const [key, value] of Object.entries(s.percentiles)) {
      lines.push([key, num(value), unit]);
    }
  }

  // Raw values are always exported so a session can be recalibrated later.
  lines.push(['LAeq_raw', num(s.rawDbfs.LAeq), 'dBFS']);
  lines.push(['LCeq_raw', num(s.rawDbfs.LCeq), 'dBFS']);
  lines.push(['LZeq_raw', num(s.rawDbfs.LZeq), 'dBFS']);
  lines.push(['LAFmax_raw', num(s.rawDbfs.LAFmax), 'dBFS']);
  lines.push(['LAFmin_raw', num(s.rawDbfs.LAFmin), 'dBFS']);
  lines.push(['LCpeak_raw', num(s.rawDbfs.LCpeak), 'dBFS']);
  lines.push(['LZpeak_raw', num(s.rawDbfs.LZpeak), 'dBFS']);

  if (session.exposure) {
    const e = session.exposure;
    lines.push(['exposure_scheme', e.scheme, '']);
    lines.push(['exposure_criterion_level', num(e.criterionLevelDb, 1), 'dBA']);
    lines.push(['exposure_exchange_rate', num(e.exchangeRateDb, 1), 'dB']);
    lines.push([
      'exposure_threshold',
      e.thresholdDb === null ? 'none' : num(e.thresholdDb, 1),
      'dBA',
    ]);
    lines.push(['exposure_dose', num(e.dosePercent, 2), '%']);
    lines.push(['exposure_twa', num(e.twaDb), 'dBA']);
    lines.push(['exposure_projected_8h', num(e.projected8hDb), 'dBA']);
  }

  lines.push(['clipping_events', session.clipping.events, 'count']);
  lines.push(['clipped_samples', session.clipping.clippedSamples, 'count']);
  lines.push(['peak_raw', num(session.clipping.peakDbfs), 'dBFS']);

  return sessionHeader(session, 'measurement summary') + rows(lines);
}

/** Validation experiment export with per-point errors. */
export function validationExperimentCsv(experiment: ValidationExperiment): string {
  const header = [
    'timestamp_ms',
    'iso_time',
    'description',
    'frequency_hz',
    'reference_db',
    'acousticlab_db',
    'error_db',
    'weighting',
    'time_weighting',
    'duration_s',
    'notes',
  ];
  const lines: Array<Array<string | number>> = [header];
  for (const point of experiment.points) {
    lines.push([
      point.at,
      isoTimestamp(point.at),
      point.description,
      point.frequencyHz === null ? '' : num(point.frequencyHz, 2),
      num(point.referenceDb),
      num(point.measuredDb),
      num(point.measuredDb - point.referenceDb),
      point.weighting,
      point.timeWeighting,
      point.durationSeconds === null ? '' : num(point.durationSeconds, 1),
      point.notes,
    ]);
  }

  return (
    comment('AcousticLab XL2 validation experiment') +
    comment(`exported_at=${isoTimestamp()}`) +
    comment(`experiment_id=${experiment.id}`) +
    comment(`name=${experiment.name}`) +
    comment(`kind=${experiment.kind}`) +
    comment(`reference_instrument=${experiment.referenceInstrument}`) +
    comment(`profile_id=${experiment.profileId ?? 'none'}`) +
    comment(`source=${experiment.setup.source}`) +
    comment(
      `distance_m=${experiment.setup.distanceMetres ?? ''} phone_orientation=${experiment.setup.phoneOrientation} reference_orientation=${experiment.setup.referenceOrientation}`
    ) +
    comment(`environment=${experiment.setup.environment}`) +
    comment(`setup_notes=${experiment.setup.notes}`) +
    comment('error_db = acousticlab_db - reference_db') +
    rows(lines)
  );
}

/** Calibration data export in tabular form (JSON remains the canonical format). */
export function calibrationCsv(profile: CalibrationProfile): string {
  let out =
    comment('AcousticLab calibration profile') +
    comment(`exported_at=${isoTimestamp()}`) +
    comment(`profile_id=${profile.id}`) +
    comment(`name=${profile.name}`) +
    comment(`reference_instrument=${profile.referenceInstrument} ${profile.referenceSerial}`) +
    comment(`device=${profile.device.model} / ${profile.device.browser}`) +
    comment(`sample_rate_hz=${profile.sampleRate}`);

  if (profile.level) {
    const level = profile.level;
    out +=
      comment(`level_method=${level.method}`) +
      comment(`level_transform=SPL = ${level.slope} * dBFS + ${level.intercept}`) +
      comment(`level_calibrated_at=${isoTimestamp(level.calibratedAt)}`);
    if (level.fit) {
      out += comment(
        `fit r2=${level.fit.r2.toFixed(5)} rmse_db=${level.fit.rmse.toFixed(3)} max_abs_error_db=${level.fit.maxAbsError.toFixed(3)} n=${level.fit.n} non_linear=${level.fit.nonLinear}`
      );
    }
    const lines: Array<Array<string | number>> = [
      [
        'point_type',
        'iso_time',
        'reference_db',
        'phone_dbfs',
        'offset_db',
        'fitted_spl_db',
        'residual_db',
        'weighting',
        'time_weighting',
        'frequency_hz',
        'notes',
      ],
    ];
    level.points.forEach((point, index) => {
      const fitted = level.slope * point.phoneDbfs + level.intercept;
      lines.push([
        'level',
        isoTimestamp(point.at),
        num(point.referenceDb),
        num(point.phoneDbfs),
        num(point.referenceDb - point.phoneDbfs),
        num(fitted),
        num(level.fit ? level.fit.residuals[index] : point.referenceDb - fitted),
        point.weighting,
        point.timeWeighting,
        point.frequencyHz === null ? '' : num(point.frequencyHz, 2),
        point.notes,
      ]);
    });
    out += rows(lines);
  }

  if (profile.frequency) {
    out +=
      EOL +
      comment(
        `frequency_validated_range_hz=${profile.frequency.validatedRange.lowHz}..${profile.frequency.validatedRange.highHz}`
      ) +
      comment(`frequency_calibrated_at=${isoTimestamp(profile.frequency.calibratedAt)}`) +
      comment('correction_db = reference_db - phone_db');
    const lines: Array<Array<string | number>> = [
      ['point_type', 'iso_time', 'frequency_hz', 'reference_db', 'phone_db', 'correction_db', 'notes'],
    ];
    for (const point of profile.frequency.points) {
      lines.push([
        'frequency',
        isoTimestamp(point.at),
        num(point.frequencyHz, 2),
        num(point.referenceDb),
        num(point.phoneDb),
        num(point.correctionDb),
        point.notes,
      ]);
    }
    out += rows(lines);
  }

  return out;
}

/** Level distribution histogram export. */
export function histogramCsv(session: SessionRecord): string | null {
  const histogram = session.histogram;
  if (!histogram || histogram.counts.length === 0) return null;
  const calibrated = session.summary.calibrated;
  const offset = calibrated ? session.calibration.intercept : 0;
  const slope = calibrated ? session.calibration.slope : 1;
  const unit = session.summary.unit;

  const lines: Array<Array<string | number>> = [
    [`bin_lower_${unit.replace(/\s/g, '_').toLowerCase()}`, `bin_upper_${unit.replace(/\s/g, '_').toLowerCase()}`, 'count', 'fraction'],
  ];
  const total = histogram.counts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < histogram.counts.length; i++) {
    const rawLower = histogram.minDb + (histogram.first + i) * histogram.binWidth;
    const rawUpper = rawLower + histogram.binWidth;
    lines.push([
      num(slope * rawLower + offset, 2),
      num(slope * rawUpper + offset, 2),
      histogram.counts[i],
      total > 0 ? (histogram.counts[i] / total).toFixed(6) : '0',
    ]);
  }

  return (
    sessionHeader(session, 'level distribution') +
    comment(`statistics_weighting=${session.settings.statisticsWeighting}`) +
    comment('Sampled from the Fast time-weighted level at 20 samples per second.') +
    rows(lines)
  );
}
