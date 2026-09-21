/**
 * Calibration profile persistence.
 *
 * Profiles are the most valuable data in the application: a profile represents
 * real measurement work done with a reference instrument. They are therefore
 * exportable and importable as plain JSON so they survive a lost device.
 */

import { APP_NAME } from '@/lib/branding';
import { createId } from '@/lib/id';
import { buildDeviceInfo } from '@/lib/device';
import type { InputDiagnostics } from '@/audio/diagnostics';
import { fitCalibrationPoints, referenceRange, singlePointCalibration } from '@/calibration/fit';
import { summariseValidation } from '@/calibration/quality';
import { STORES, get, getAll, put, remove } from './db';
import {
  RECORD_SCHEMA_VERSION,
  type CalibrationProfile,
  type FrequencyCalibrationPoint,
  type LevelCalibrationPoint,
  type ValidationExperiment,
} from './types';

export const DEFAULT_REFERENCE_INSTRUMENT = 'NTi Audio XL2';

export interface CreateProfileInput {
  name: string;
  sampleRate: number;
  diagnostics: InputDiagnostics | null;
  referenceInstrument?: string;
  referenceSerial?: string;
  notes?: string;
}

export function createProfile(input: CreateProfileInput): CalibrationProfile {
  const now = Date.now();
  return {
    id: createId('cal'),
    schemaVersion: RECORD_SCHEMA_VERSION,
    name: input.name.trim() || 'Untitled profile',
    createdAt: now,
    updatedAt: now,
    device: buildDeviceInfo(input.sampleRate, input.diagnostics),
    sampleRate: input.sampleRate,
    referenceInstrument: input.referenceInstrument?.trim() || DEFAULT_REFERENCE_INSTRUMENT,
    referenceSerial: input.referenceSerial?.trim() ?? '',
    notes: input.notes ?? '',
    level: null,
    frequency: null,
    validation: null,
  };
}

export async function saveProfile(profile: CalibrationProfile): Promise<CalibrationProfile> {
  const next = { ...profile, updatedAt: Date.now() };
  await put(STORES.calibrationProfiles, next);
  return next;
}

export function loadProfile(id: string): Promise<CalibrationProfile | undefined> {
  return get<CalibrationProfile>(STORES.calibrationProfiles, id);
}

export async function listProfiles(): Promise<CalibrationProfile[]> {
  const profiles = await getAll<CalibrationProfile>(STORES.calibrationProfiles);
  return profiles.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProfile(id: string): Promise<void> {
  await remove(STORES.calibrationProfiles, id);
}

export async function duplicateProfile(
  profile: CalibrationProfile,
  name?: string
): Promise<CalibrationProfile> {
  const now = Date.now();
  const copy: CalibrationProfile = {
    ...structuredCloneSafe(profile),
    id: createId('cal'),
    name: name?.trim() || `${profile.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  await put(STORES.calibrationProfiles, copy);
  return copy;
}

export async function renameProfile(id: string, name: string): Promise<CalibrationProfile | null> {
  const profile = await loadProfile(id);
  if (!profile) return null;
  return saveProfile({ ...profile, name: name.trim() || profile.name });
}

// ---------------------------------------------------------------------------
// Level calibration
// ---------------------------------------------------------------------------

/**
 * Apply a single-point calibration.
 *
 * The point is appended to the profile's history so that a later multi-level fit
 * can reuse it; the active transform is a pure offset.
 */
export function applySinglePoint(
  profile: CalibrationProfile,
  point: LevelCalibrationPoint
): CalibrationProfile {
  const { slope, intercept } = singlePointCalibration(point.referenceDb, point.phoneDbfs);
  return {
    ...profile,
    level: {
      method: 'single-point',
      slope,
      intercept,
      points: [point],
      fit: null,
      validatedRange: null,
      calibratedAt: point.at,
      weighting: point.weighting,
      referenceFrequencyHz: point.frequencyHz,
    },
    updatedAt: Date.now(),
  };
}

/**
 * Apply a multi-level linearity calibration.
 *
 * With two or more distinct levels both slope and intercept are fitted and the
 * verified range is recorded. With fewer, this falls back to a single-point
 * offset rather than pretending a fit exists.
 */
export function applyLinearityFit(
  profile: CalibrationProfile,
  points: readonly LevelCalibrationPoint[]
): CalibrationProfile {
  if (points.length === 0) return { ...profile, level: null, updatedAt: Date.now() };
  if (points.length === 1) return applySinglePoint(profile, points[0]);

  const fit = fitCalibrationPoints(points);
  if (!fit) {
    // Every point landed at the same phone level: a slope is undetermined, so
    // average the offsets instead of fabricating one.
    const offsets = points.map((p) => p.referenceDb - p.phoneDbfs);
    const intercept = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    return {
      ...profile,
      level: {
        method: 'single-point',
        slope: 1,
        intercept,
        points: [...points],
        fit: null,
        validatedRange: referenceRange(points),
        calibratedAt: Date.now(),
        weighting: points[0].weighting,
        referenceFrequencyHz: points[0].frequencyHz,
      },
      updatedAt: Date.now(),
    };
  }

  return {
    ...profile,
    level: {
      method: 'linearity-fit',
      slope: fit.slope,
      intercept: fit.intercept,
      points: [...points],
      fit,
      validatedRange: referenceRange(points),
      calibratedAt: Date.now(),
      weighting: points[0].weighting,
      referenceFrequencyHz: points[0].frequencyHz,
    },
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Frequency calibration
// ---------------------------------------------------------------------------

export function applyFrequencyPoints(
  profile: CalibrationProfile,
  points: readonly FrequencyCalibrationPoint[]
): CalibrationProfile {
  const usable = points.filter((p) => p.frequencyHz > 0 && Number.isFinite(p.correctionDb));
  if (usable.length === 0) {
    return { ...profile, frequency: null, updatedAt: Date.now() };
  }
  const frequencies = usable.map((p) => p.frequencyHz);
  return {
    ...profile,
    frequency: {
      points: [...usable].sort((a, b) => a.frequencyHz - b.frequencyHz),
      validatedRange: {
        lowHz: Math.min(...frequencies),
        highHz: Math.max(...frequencies),
      },
      calibratedAt: Date.now(),
      weighting: profile.level?.weighting ?? 'Z',
    },
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Validation linkage
// ---------------------------------------------------------------------------

/** Recompute the profile's validation summary from its linked experiments. */
export function applyValidationSummary(
  profile: CalibrationProfile,
  experiments: readonly ValidationExperiment[]
): CalibrationProfile {
  const linked = experiments.filter((e) => e.profileId === profile.id);
  const { stats, experimentIds } = summariseValidation(linked);
  if (stats.n === 0) {
    return { ...profile, validation: null, updatedAt: Date.now() };
  }
  return {
    ...profile,
    validation: {
      experimentIds,
      n: stats.n,
      meanErrorDb: stats.mean,
      standardDeviationDb: stats.standardDeviation,
      rmseDb: stats.rmse,
      maxAbsErrorDb: stats.maxAbs,
      interval95: stats.interval95,
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export const CALIBRATION_EXPORT_KIND = 'acousticlab.calibration';
export const CALIBRATION_EXPORT_VERSION = 1;

export interface CalibrationExport {
  kind: typeof CALIBRATION_EXPORT_KIND;
  exportVersion: number;
  exportedAt: string;
  application: string;
  profiles: CalibrationProfile[];
}

export function buildCalibrationExport(profiles: readonly CalibrationProfile[]): CalibrationExport {
  return {
    kind: CALIBRATION_EXPORT_KIND,
    exportVersion: CALIBRATION_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    application: APP_NAME,
    profiles: profiles.map((p) => structuredCloneSafe(p)),
  };
}

export interface ImportResult {
  imported: CalibrationProfile[];
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Import profiles from an export file.
 *
 * Imported profiles always get a fresh id so an import can never silently
 * overwrite an existing calibration.
 */
export async function importCalibrationExport(data: unknown): Promise<ImportResult> {
  const result: ImportResult = { imported: [], skipped: [] };
  if (!data || typeof data !== 'object') {
    throw new Error('The file does not contain calibration data.');
  }
  const payload = data as Partial<CalibrationExport>;
  if (payload.kind !== CALIBRATION_EXPORT_KIND) {
    throw new Error('This file is not an Sonoscope calibration export.');
  }
  if (typeof payload.exportVersion !== 'number' || payload.exportVersion > CALIBRATION_EXPORT_VERSION) {
    throw new Error(
      `This file was written by a newer version of Sonoscope (format ${String(payload.exportVersion)}).`
    );
  }
  if (!Array.isArray(payload.profiles)) {
    throw new Error('The calibration export contains no profiles.');
  }

  for (const raw of payload.profiles) {
    const validated = validateImportedProfile(raw);
    if ('reason' in validated) {
      result.skipped.push({ name: describeUnknownProfile(raw), reason: validated.reason });
      continue;
    }
    const now = Date.now();
    const profile: CalibrationProfile = {
      ...validated.profile,
      id: createId('cal'),
      name: `${validated.profile.name} (imported)`,
      createdAt: validated.profile.createdAt || now,
      updatedAt: now,
    };
    await put(STORES.calibrationProfiles, profile);
    result.imported.push(profile);
  }

  if (result.imported.length === 0 && result.skipped.length === 0) {
    throw new Error('The calibration export contains no profiles.');
  }
  return result;
}

function describeUnknownProfile(raw: unknown): string {
  if (raw && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string') {
    return (raw as { name: string }).name;
  }
  return 'Unnamed profile';
}

function validateImportedProfile(
  raw: unknown
): { profile: CalibrationProfile } | { reason: string } {
  if (!raw || typeof raw !== 'object') return { reason: 'Not an object.' };
  const p = raw as Partial<CalibrationProfile>;
  if (typeof p.name !== 'string' || !p.name.trim()) return { reason: 'Missing a name.' };
  if (!p.device || typeof p.device !== 'object') return { reason: 'Missing device information.' };
  if (typeof p.sampleRate !== 'number' || !Number.isFinite(p.sampleRate)) {
    return { reason: 'Missing or invalid sample rate.' };
  }
  if (p.level) {
    const level = p.level;
    if (typeof level.slope !== 'number' || !Number.isFinite(level.slope) || level.slope === 0) {
      return { reason: 'The level calibration slope is invalid.' };
    }
    if (typeof level.intercept !== 'number' || !Number.isFinite(level.intercept)) {
      return { reason: 'The level calibration offset is invalid.' };
    }
    if (!Array.isArray(level.points)) return { reason: 'The level calibration has no points.' };
  }
  if (p.frequency) {
    if (!Array.isArray(p.frequency.points) || p.frequency.points.length === 0) {
      return { reason: 'The frequency calibration has no points.' };
    }
    for (const point of p.frequency.points) {
      if (typeof point.frequencyHz !== 'number' || !(point.frequencyHz > 0)) {
        return { reason: 'A frequency calibration point has an invalid frequency.' };
      }
      if (typeof point.correctionDb !== 'number' || !Number.isFinite(point.correctionDb)) {
        return { reason: 'A frequency calibration point has an invalid correction.' };
      }
    }
  }

  return {
    profile: {
      id: typeof p.id === 'string' ? p.id : createId('cal'),
      schemaVersion: typeof p.schemaVersion === 'number' ? p.schemaVersion : RECORD_SCHEMA_VERSION,
      name: p.name.trim(),
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      updatedAt: Date.now(),
      device: p.device,
      sampleRate: p.sampleRate,
      referenceInstrument:
        typeof p.referenceInstrument === 'string' ? p.referenceInstrument : DEFAULT_REFERENCE_INSTRUMENT,
      referenceSerial: typeof p.referenceSerial === 'string' ? p.referenceSerial : '',
      notes: typeof p.notes === 'string' ? p.notes : '',
      level: p.level ?? null,
      frequency: p.frequency ?? null,
      validation: p.validation ?? null,
    },
  };
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
