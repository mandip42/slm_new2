/**
 * Persisted record shapes.
 *
 * Every record carries `schemaVersion` so that a future migration can adapt it
 * without guessing. Levels are stored with an explicit unit suffix in the field
 * name (`Dbfs` or `Db` for SPL) because mixing the two silently is the single
 * easiest way to produce a wrong measurement.
 */

import type { PercentileSet } from '@/dsp/statistics';
import type { TimeWeightingId } from '@/dsp/timeWeighting';
import type { WeightingId } from '@/dsp/weighting/reference';
import type { ExposureSchemeId } from '@/dsp/exposure';
import type { BandLayoutEntry } from '@/audio/messages';

export const RECORD_SCHEMA_VERSION = 1;

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  /** Best-effort device model parsed from the user agent. */
  model: string;
  browser: string;
  screen: string;
  deviceLabel: string;
  sampleRate: number;
  /** Whether the browser confirmed that device audio processing was disabled. */
  processingSuspected: boolean;
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export interface LevelCalibrationPoint {
  id: string;
  at: number;
  /** Level read from the reference instrument, dB SPL. */
  referenceDb: number;
  /** Level measured by AcousticLab at the same moment, dBFS. */
  phoneDbfs: number;
  weighting: WeightingId;
  timeWeighting: TimeWeightingId;
  /** Frequency of the reference signal, when it was a tone. */
  frequencyHz: number | null;
  notes: string;
}

export interface LinearFitResult {
  slope: number;
  intercept: number;
  /** Coefficient of determination. */
  r2: number;
  rmse: number;
  maxAbsError: number;
  meanAbsError: number;
  residuals: number[];
  n: number;
  /** True when the slope departs from 1 by more than the warning threshold. */
  nonLinear: boolean;
}

export interface LevelCalibration {
  method: 'single-point' | 'linearity-fit';
  /** SPL = slope * dBFS + intercept. slope is 1 for a single-point offset. */
  slope: number;
  intercept: number;
  points: LevelCalibrationPoint[];
  fit: LinearFitResult | null;
  /** Range of reference levels the calibration was actually verified over. */
  validatedRange: { minDb: number; maxDb: number } | null;
  calibratedAt: number;
  weighting: WeightingId;
  referenceFrequencyHz: number | null;
}

export interface FrequencyCalibrationPoint {
  id: string;
  at: number;
  frequencyHz: number;
  /** Reference instrument level, dB SPL. */
  referenceDb: number;
  /** AcousticLab level at the same moment, dB SPL (after level calibration). */
  phoneDb: number;
  /** referenceDb - phoneDb. */
  correctionDb: number;
  notes: string;
}

export interface FrequencyCalibration {
  points: FrequencyCalibrationPoint[];
  /** Lowest and highest frequency actually measured. */
  validatedRange: { lowHz: number; highHz: number };
  calibratedAt: number;
  weighting: WeightingId;
}

export interface CalibrationValidationSummary {
  experimentIds: string[];
  n: number;
  meanErrorDb: number;
  standardDeviationDb: number;
  rmseDb: number;
  maxAbsErrorDb: number;
  interval95: { low: number; high: number } | null;
  updatedAt: number;
}

export type CalibrationStatus =
  | 'UNCALIBRATED'
  | 'LEVEL CALIBRATED'
  | 'FREQUENCY CALIBRATED'
  | 'VALIDATED';

export interface CalibrationProfile {
  id: string;
  schemaVersion: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  device: DeviceInfo;
  sampleRate: number;
  referenceInstrument: string;
  referenceSerial: string;
  notes: string;
  level: LevelCalibration | null;
  frequency: FrequencyCalibration | null;
  validation: CalibrationValidationSummary | null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface MeasurementSettingsSnapshot {
  weighting: WeightingId;
  timeWeighting: TimeWeightingId;
  bankWeighting: WeightingId;
  dcBlock: boolean;
  fftSize: number;
  fftWindow: string;
  statisticsWeighting: WeightingId;
  exposureScheme: ExposureSchemeId;
  frequencyCorrectionEnabled: boolean;
}

/** Snapshot of the calibration that was active during a measurement. */
export interface CalibrationSnapshot {
  profileId: string | null;
  profileName: string | null;
  status: CalibrationStatus;
  slope: number;
  intercept: number;
  calibratedAt: number | null;
  referenceInstrument: string | null;
  frequencyCorrectionApplied: boolean;
  frequencyValidatedRange: { lowHz: number; highHz: number } | null;
  levelValidatedRange: { minDb: number; maxDb: number } | null;
}

export interface SessionSummary {
  /** True when the levels below are calibrated SPL rather than dBFS. */
  calibrated: boolean;
  unit: 'dB SPL' | 'dBFS';
  durationSeconds: number;
  LAeq: number;
  LCeq: number;
  LZeq: number;
  LAE: number;
  LAFmax: number;
  LAFmin: number;
  LASmax: number;
  LASmin: number;
  LAImax: number;
  LCFmax: number;
  LZFmax: number;
  LZFmin: number;
  LApeak: number;
  LCpeak: number;
  LZpeak: number;
  percentiles: PercentileSet | null;
  /** Raw uncalibrated equivalents, always stored so a session can be recalibrated. */
  rawDbfs: {
    LAeq: number;
    LCeq: number;
    LZeq: number;
    LAFmax: number;
    LAFmin: number;
    LCpeak: number;
    LZpeak: number;
  };
}

export interface SessionBandResults {
  bands: BandLayoutEntry[];
  weighting: WeightingId;
  leq: number[];
  max: number[];
  current: number[];
  /** True when the values are calibrated SPL. */
  calibrated: boolean;
}

export interface SessionExposureResults {
  scheme: ExposureSchemeId;
  criterionLevelDb: number;
  exchangeRateDb: number;
  thresholdDb: number | null;
  dosePercent: number;
  twaDb: number;
  projectedDosePercent: number;
  projected8hDb: number;
  remainingSeconds: number;
  belowThreshold: boolean;
}

export interface SessionClipping {
  events: number;
  clippedSamples: number;
  clippedFraction: number;
  peakDbfs: number;
  nearOverload: boolean;
  /** Elapsed seconds of each recorded clipping event. */
  eventTimes: number[];
}

export interface SessionRecord {
  id: string;
  schemaVersion: number;
  name: string;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number;
  sampleRate: number;
  device: DeviceInfo;
  calibration: CalibrationSnapshot;
  settings: MeasurementSettingsSnapshot;
  summary: SessionSummary;
  octave: SessionBandResults | null;
  thirdOctave: SessionBandResults | null;
  exposure: SessionExposureResults | null;
  clipping: SessionClipping;
  /** Serialised level histogram, in the dBFS domain. */
  histogram: { minDb: number; binWidth: number; first: number; counts: number[] } | null;
  /** Pauses that occurred during the measurement. */
  pauses: Array<{ atSeconds: number; durationSeconds: number }>;
  notes: string;
  recordingId: string | null;
  /**
   * True when the session was recovered after a reload rather than stopped
   * normally. Such sessions are clearly marked everywhere they appear.
   */
  incomplete: boolean;
  /** True when any part of the measurement was affected by clipping. */
  clippingAffected: boolean;
}

/**
 * Time series for a session, stored separately so the session list stays light.
 * Typed arrays survive structured clone, so they are stored as-is.
 */
export interface SessionSeries {
  sessionId: string;
  schemaVersion: number;
  /** Nominal spacing between samples, milliseconds. */
  sampleIntervalMs: number;
  /** Elapsed time of each sample, seconds. */
  elapsed: Float32Array;
  LAF: Float32Array;
  LAS: Float32Array;
  LCF: Float32Array;
  LZF: Float32Array;
  LAeq: Float32Array;
  /** True when the stored traces are calibrated SPL. */
  calibrated: boolean;
  /** Offset that was added to the raw dBFS values, so they can be recovered. */
  calibrationIntercept: number;
  calibrationSlope: number;
}

// ---------------------------------------------------------------------------
// Validation experiments
// ---------------------------------------------------------------------------

export type ValidationExperimentKind =
  | 'broadband-level'
  | 'frequency-response'
  | 'a-weighting'
  | 'c-weighting'
  | 'time-response'
  | 'octave-bands'
  | 'custom';

export interface ValidationPoint {
  id: string;
  at: number;
  description: string;
  /** Reference instrument reading, dB. */
  referenceDb: number;
  /** AcousticLab reading, dB (same weighting and time weighting). */
  measuredDb: number;
  weighting: WeightingId;
  timeWeighting: TimeWeightingId;
  frequencyHz: number | null;
  durationSeconds: number | null
  notes: string;
}

export interface ValidationSetup {
  source: string;
  distanceMetres: number | null;
  phoneOrientation: string;
  referenceOrientation: string;
  environment: string;
  notes: string;
}

export interface ValidationExperiment {
  id: string;
  schemaVersion: number;
  name: string;
  kind: ValidationExperimentKind;
  createdAt: number;
  updatedAt: number;
  profileId: string | null;
  referenceInstrument: string;
  setup: ValidationSetup;
  points: ValidationPoint[];
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

export interface RecordingRecord {
  id: string;
  schemaVersion: number;
  sessionId: string | null;
  createdAt: number;
  durationSeconds: number;
  sampleRate: number;
  bitDepth: number;
  sizeBytes: number;
  name: string;
  blob: Blob;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SettingsRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}
