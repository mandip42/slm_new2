/**
 * Build a persisted session from live engine state.
 *
 * Two things are stored for every level: the calibrated display value and the
 * raw dBFS value. That redundancy is deliberate — it means a session measured
 * with a calibration that later turns out to be wrong can be re-derived instead
 * of being thrown away.
 */

import type { MeterSnapshot } from '@/dsp/engine';
import type { ClipEvent } from '@/dsp/clipping';
import { computeExposure, EXPOSURE_SCHEMES, type ExposureSchemeId } from '@/dsp/exposure';
import type { PercentileSet } from '@/dsp/statistics';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import type { AnalysisFrame, BandLayout } from '@/audio/acousticEngine';
import type { InputDiagnostics } from '@/audio/diagnostics';
import type { ActiveCalibration } from '@/calibration/activeCalibration';
import { buildDeviceInfo } from '@/lib/device';
import { createId } from '@/lib/id';
import {
  RECORD_SCHEMA_VERSION,
  type MeasurementSettingsSnapshot,
  type SessionBandResults,
  type SessionClipping,
  type SessionExposureResults,
  type SessionRecord,
  type SessionSeries,
  type SessionSummary,
} from '@/storage/types';
import type { LevelHistory } from './levelHistory';

export interface BuildSessionInput {
  id?: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  snapshot: MeterSnapshot;
  calibration: ActiveCalibration;
  diagnostics: InputDiagnostics | null;
  bandLayout: BandLayout | null;
  analysis: AnalysisFrame | null;
  settings: MeasurementSettingsSnapshot;
  exposureScheme: ExposureSchemeId;
  clipEvents: readonly ClipEvent[];
  histogram: { minDb: number; binWidth: number; first: number; counts: number[] } | null;
  pauses: Array<{ atSeconds: number; durationSeconds: number }>;
  notes?: string;
  recordingId?: string | null;
  incomplete?: boolean;
}

function convert(calibration: ActiveCalibration, value: number): number {
  if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) return NaN;
  return calibration.toDisplay(value);
}

function convertPercentiles(
  calibration: ActiveCalibration,
  percentiles: PercentileSet | null
): PercentileSet | null {
  if (!percentiles) return null;
  const out = {} as PercentileSet;
  for (const [key, value] of Object.entries(percentiles) as Array<[keyof PercentileSet, number]>) {
    out[key] = Number.isFinite(value) ? calibration.toDisplay(value) : NaN;
  }
  return out;
}

function buildSummary(
  snapshot: MeterSnapshot,
  calibration: ActiveCalibration
): SessionSummary {
  const c = (v: number) => convert(calibration, v);
  return {
    calibrated: calibration.isCalibrated,
    unit: calibration.isCalibrated ? 'dB SPL' : 'dBFS',
    durationSeconds: snapshot.durationSeconds,
    LAeq: c(snapshot.LAeq),
    LCeq: c(snapshot.LCeq),
    LZeq: c(snapshot.LZeq),
    LAE: c(snapshot.LAE),
    LAFmax: c(snapshot.LAFmax),
    LAFmin: c(snapshot.LAFmin),
    LASmax: c(snapshot.LASmax),
    LASmin: c(snapshot.LASmin),
    LAImax: c(snapshot.LAImax),
    LCFmax: c(snapshot.LCFmax),
    LZFmax: c(snapshot.LZFmax),
    LZFmin: c(snapshot.LZFmin),
    LApeak: c(snapshot.LApeak),
    LCpeak: c(snapshot.LCpeak),
    LZpeak: c(snapshot.LZpeak),
    percentiles: convertPercentiles(calibration, snapshot.percentiles),
    rawDbfs: {
      LAeq: snapshot.LAeq,
      LCeq: snapshot.LCeq,
      LZeq: snapshot.LZeq,
      LAFmax: snapshot.LAFmax,
      LAFmin: snapshot.LAFmin,
      LCpeak: snapshot.LCpeak,
      LZpeak: snapshot.LZpeak,
    },
  };
}

function buildBands(
  layout: BandLayout | null,
  analysis: AnalysisFrame | null,
  calibration: ActiveCalibration,
  which: 'octave' | 'thirdOctave'
): SessionBandResults | null {
  if (!layout || !analysis) return null;
  const bands = which === 'octave' ? layout.octave : layout.thirdOctave;
  const current = which === 'octave' ? analysis.octaveCurrent : analysis.thirdCurrent;
  const leq = which === 'octave' ? analysis.octaveLeq : analysis.thirdLeq;
  const max = which === 'octave' ? analysis.octaveMax : analysis.thirdMax;
  if (!bands || bands.length === 0 || leq.length !== bands.length) return null;

  const frequencies = bands.map((b) => b.exact);
  const { corrections } = calibration.bandCorrections(frequencies);

  const apply = (values: Float32Array): number[] =>
    Array.from(values, (value, i) => {
      if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) return NaN;
      return calibration.toDisplay(value) + corrections[i];
    });

  return {
    bands: bands.map((b) => ({ ...b })),
    weighting: analysis.bankWeighting,
    leq: apply(leq),
    max: apply(max),
    current: apply(current),
    calibrated: calibration.isCalibrated,
  };
}

function buildExposure(
  snapshot: MeterSnapshot,
  calibration: ActiveCalibration,
  scheme: ExposureSchemeId
): SessionExposureResults | null {
  // Exposure is only meaningful against an absolute criterion level, so it is
  // omitted entirely when the measurement is uncalibrated rather than being
  // computed from a digital level.
  if (!calibration.isCalibrated) return null;
  if (!Number.isFinite(snapshot.LAeq) || snapshot.durationSeconds <= 0) return null;

  const definition = EXPOSURE_SCHEMES[scheme];
  const laeq = calibration.toDisplay(snapshot.LAeq);
  const result = computeExposure(definition, laeq, snapshot.durationSeconds);
  return {
    scheme,
    criterionLevelDb: definition.criterionLevelDb,
    exchangeRateDb: definition.exchangeRateDb,
    thresholdDb: definition.thresholdDb,
    dosePercent: result.dosePercent,
    twaDb: result.twaDb,
    projectedDosePercent: result.projectedDosePercent,
    projected8hDb: result.projected8hDb,
    remainingSeconds: result.remainingSeconds,
    belowThreshold: result.belowThreshold,
  };
}

function buildClipping(snapshot: MeterSnapshot, events: readonly ClipEvent[]): SessionClipping {
  return {
    events: snapshot.clipping.events,
    clippedSamples: snapshot.clipping.clippedSamples,
    clippedFraction: snapshot.clipping.clippedFraction,
    peakDbfs: snapshot.clipping.peakDb,
    nearOverload: snapshot.clipping.nearOverload,
    eventTimes: events.map((e) => e.atSeconds),
  };
}

export function buildSessionRecord(input: BuildSessionInput): SessionRecord {
  const summary = buildSummary(input.snapshot, input.calibration);
  const clipping = buildClipping(input.snapshot, input.clipEvents);
  return {
    id: input.id ?? createId('ses'),
    schemaVersion: RECORD_SCHEMA_VERSION,
    name: input.name.trim() || defaultSessionName(input.startedAt),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationSeconds: input.snapshot.durationSeconds,
    sampleRate: input.snapshot.sampleRate,
    device: buildDeviceInfo(input.snapshot.sampleRate, input.diagnostics),
    calibration: input.calibration.toSnapshot(),
    settings: input.settings,
    summary,
    octave: buildBands(input.bandLayout, input.analysis, input.calibration, 'octave'),
    thirdOctave: buildBands(input.bandLayout, input.analysis, input.calibration, 'thirdOctave'),
    exposure: buildExposure(input.snapshot, input.calibration, input.exposureScheme),
    clipping,
    histogram: input.histogram,
    pauses: input.pauses,
    notes: input.notes ?? '',
    recordingId: input.recordingId ?? null,
    incomplete: input.incomplete ?? false,
    clippingAffected: clipping.events > 0,
  };
}

export function buildSessionSeries(
  sessionId: string,
  history: LevelHistory,
  calibration: ActiveCalibration
): SessionSeries {
  const snapshot = history.snapshotSeries();
  const apply = (values: Float32Array): Float32Array => {
    if (!calibration.isCalibrated) return values;
    const out = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      out[i] = Number.isFinite(v) && v > LEVEL_FLOOR_DB ? calibration.toDisplay(v) : NaN;
    }
    return out;
  };

  return {
    sessionId,
    schemaVersion: RECORD_SCHEMA_VERSION,
    sampleIntervalMs: snapshot.intervalMs,
    elapsed: snapshot.elapsed,
    LAF: apply(snapshot.LAF),
    LAS: apply(snapshot.LAS),
    LCF: apply(snapshot.LCF),
    LZF: apply(snapshot.LZF),
    LAeq: apply(snapshot.LAeq),
    calibrated: calibration.isCalibrated,
    calibrationIntercept: calibration.intercept,
    calibrationSlope: calibration.slope,
  };
}

export function defaultSessionName(at = Date.now()): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Measurement ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
