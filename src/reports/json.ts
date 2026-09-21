/**
 * JSON export.
 *
 * The JSON export is the lossless one: it carries the raw dBFS values alongside
 * the calibrated levels and the full calibration transform, so a session can be
 * re-derived with a corrected calibration later without re-measuring.
 */

import { APP_NAME } from '@/lib/branding';
import { isoTimestamp } from '@/lib/format';
import type {
  CalibrationProfile,
  SessionRecord,
  SessionSeries,
  ValidationExperiment,
} from '@/storage/types';
import { DB_VERSION } from '@/storage/db';

export const SESSION_EXPORT_KIND = 'acousticlab.session';
export const VALIDATION_EXPORT_KIND = 'acousticlab.validation';
export const BACKUP_EXPORT_KIND = 'acousticlab.backup';
export const EXPORT_FORMAT_VERSION = 1;

interface ExportEnvelope {
  kind: string;
  exportVersion: number;
  schemaVersion: number;
  exportedAt: string;
  application: string;
}

function envelope(kind: string): ExportEnvelope {
  return {
    kind,
    exportVersion: EXPORT_FORMAT_VERSION,
    schemaVersion: DB_VERSION,
    exportedAt: isoTimestamp(),
    application: APP_NAME,
  };
}

function seriesToArrays(series: SessionSeries | null) {
  if (!series || series.elapsed.length === 0) return null;
  return {
    sampleIntervalMs: series.sampleIntervalMs,
    calibrated: series.calibrated,
    calibrationSlope: series.calibrationSlope,
    calibrationIntercept: series.calibrationIntercept,
    // Rounded to 0.01 dB: finer resolution than any smartphone measurement can
    // support, and it keeps the file an order of magnitude smaller.
    elapsed_s: Array.from(series.elapsed, (v) => round(v, 3)),
    LAF: Array.from(series.LAF, (v) => round(v, 2)),
    LAS: Array.from(series.LAS, (v) => round(v, 2)),
    LCF: Array.from(series.LCF, (v) => round(v, 2)),
    LZF: Array.from(series.LZF, (v) => round(v, 2)),
    LAeq: Array.from(series.LAeq, (v) => round(v, 2)),
  };
}

function round(value: number, decimals: number): number | null {
  if (!Number.isFinite(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export interface SessionExport extends ExportEnvelope {
  session: SessionRecord;
  series: ReturnType<typeof seriesToArrays>;
  units: {
    broadband: string;
    bands: string;
    raw: 'dBFS';
    note: string;
  };
}

export function buildSessionExport(
  session: SessionRecord,
  series: SessionSeries | null
): SessionExport {
  return {
    ...envelope(SESSION_EXPORT_KIND),
    session,
    series: seriesToArrays(series),
    units: {
      broadband: session.summary.unit,
      bands: session.summary.calibrated ? 'dB SPL' : 'dBFS',
      raw: 'dBFS',
      note:
        'dBFS levels are relative to digital full scale using L = 20*log10(rms) of the normalised sample stream, so a full-scale sine reads -3.01 dBFS. ' +
        'SPL = calibration.slope * dBFS + calibration.intercept.',
    },
  };
}

export interface ValidationExport extends ExportEnvelope {
  experiments: ValidationExperiment[];
  profiles: CalibrationProfile[];
  note: string;
}

export function buildValidationExport(
  experiments: readonly ValidationExperiment[],
  profiles: readonly CalibrationProfile[]
): ValidationExport {
  return {
    ...envelope(VALIDATION_EXPORT_KIND),
    experiments: [...experiments],
    profiles: [...profiles],
    note: 'error_db = sonoscope_db - reference_db for every point.',
  };
}

export interface BackupExport extends ExportEnvelope {
  profiles: CalibrationProfile[];
  experiments: ValidationExperiment[];
  sessions: Array<{ session: SessionRecord; series: ReturnType<typeof seriesToArrays> }>;
  settings: Record<string, unknown>;
  note: string;
}

/**
 * Complete data backup.
 *
 * Audio recordings are deliberately excluded: they are large binary blobs and
 * JSON is the wrong container for them. Recordings are exported individually as
 * WAV files instead, and the omission is stated in the file.
 */
export function buildBackupExport(input: {
  profiles: readonly CalibrationProfile[];
  experiments: readonly ValidationExperiment[];
  sessions: ReadonlyArray<{ session: SessionRecord; series: SessionSeries | null }>;
  settings: Record<string, unknown>;
}): BackupExport {
  return {
    ...envelope(BACKUP_EXPORT_KIND),
    profiles: [...input.profiles],
    experiments: [...input.experiments],
    sessions: input.sessions.map(({ session, series }) => ({
      session,
      series: seriesToArrays(series),
    })),
    settings: input.settings,
    note: 'Audio recordings are not included in this backup. Export them individually as WAV files from the session view.',
  };
}

export function toJsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, jsonReplacer, 2)], {
    type: 'application/json',
  });
}

export function toJsonString(value: unknown): string {
  return JSON.stringify(value, jsonReplacer, 2);
}

/**
 * Replacer that makes the export self-describing:
 *  - typed arrays become plain arrays
 *  - non-finite numbers become null instead of being silently written as `null`
 *    by JSON.stringify with no explanation
 *  - Blobs are dropped with a marker
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (value instanceof Float32Array || value instanceof Float64Array) {
    return Array.from(value, (v) => (Number.isFinite(v) ? v : null));
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return { omitted: 'binary', sizeBytes: value.size, type: value.type };
  }
  return value;
}
