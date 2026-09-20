/**
 * Application settings.
 *
 * Settings live in IndexedDB alongside the measurement data so that everything
 * the app knows about the user is in one place and one "delete all data" action
 * clears it. A synchronous in-memory cache is kept so the UI can render
 * immediately after the first load.
 */

import type { ExposureSchemeId } from '@/dsp/exposure';
import type { TimeWeightingId } from '@/dsp/timeWeighting';
import type { WeightingId } from '@/dsp/weighting/reference';
import type { WindowId } from '@/dsp/window';
import { STORES, get, getAll, put, remove } from './db';
import type { SettingsRecord } from './types';

export interface AppSettings {
  // Meter
  weighting: WeightingId;
  timeWeighting: TimeWeightingId;
  dcBlock: boolean;
  statisticsWeighting: WeightingId;
  /** Decimals shown on the main level read-out. */
  levelDecimals: 0 | 1 | 2;

  // Analysis
  fftSize: number;
  fftWindow: WindowId;
  spectrumSmoothing: number;
  spectrumPeakHold: boolean;
  bankWeighting: WeightingId;
  octaveFraction: 1 | 3;

  // Display
  theme: 'dark' | 'light';
  /** High-contrast, high-brightness variant for outdoor use. */
  outdoorMode: boolean;
  keepScreenAwake: boolean;
  historyWindowSeconds: number;
  spectrogramDynamicRangeDb: number;
  spectrogramSpanSeconds: number;

  // Calibration
  activeProfileId: string | null;
  frequencyCorrectionEnabled: boolean;

  // Exposure
  exposureScheme: ExposureSchemeId;

  // Recording
  recordingEnabled: boolean;
  maxRecordingMinutes: number;

  // Onboarding
  privacyAcknowledged: boolean;
  limitationsAcknowledged: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  weighting: 'A',
  timeWeighting: 'F',
  dcBlock: true,
  statisticsWeighting: 'A',
  levelDecimals: 1,

  fftSize: 8192,
  fftWindow: 'hann',
  spectrumSmoothing: 0.5,
  spectrumPeakHold: false,
  bankWeighting: 'Z',
  octaveFraction: 3,

  theme: 'dark',
  outdoorMode: false,
  keepScreenAwake: true,
  historyWindowSeconds: 60,
  spectrogramDynamicRangeDb: 60,
  spectrogramSpanSeconds: 30,

  activeProfileId: null,
  frequencyCorrectionEnabled: true,

  exposureScheme: 'niosh',

  recordingEnabled: false,
  maxRecordingMinutes: 10,

  privacyAcknowledged: false,
  limitationsAcknowledged: false,
};

const SETTINGS_KEY_PREFIX = 'setting:';

let cache: AppSettings | null = null;

/** Load all settings, merging over the defaults. */
export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  const records = await getAll<SettingsRecord>(STORES.settings).catch(() => []);
  const merged: AppSettings = { ...DEFAULT_SETTINGS };
  for (const record of records) {
    if (!record.key.startsWith(SETTINGS_KEY_PREFIX)) continue;
    const key = record.key.slice(SETTINGS_KEY_PREFIX.length) as keyof AppSettings;
    if (!(key in DEFAULT_SETTINGS)) continue;
    const value = record.value;
    if (isValidSettingValue(key, value)) {
      (merged as unknown as Record<string, unknown>)[key] = value;
    }
  }
  cache = merged;
  return merged;
}

/** Settings loaded so far, without waiting. */
export function cachedSettings(): AppSettings {
  return cache ?? DEFAULT_SETTINGS;
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  cache = { ...(cache ?? DEFAULT_SETTINGS), [key]: value };
  await put<SettingsRecord>(STORES.settings, {
    key: `${SETTINGS_KEY_PREFIX}${key}`,
    value,
    updatedAt: Date.now(),
  });
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  cache = { ...(cache ?? DEFAULT_SETTINGS), ...patch };
  for (const [key, value] of Object.entries(patch)) {
    await put<SettingsRecord>(STORES.settings, {
      key: `${SETTINGS_KEY_PREFIX}${key}`,
      value,
      updatedAt: Date.now(),
    });
  }
  return cache;
}

export async function resetSettings(): Promise<AppSettings> {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    await remove(STORES.settings, `${SETTINGS_KEY_PREFIX}${key}`).catch(() => undefined);
  }
  cache = { ...DEFAULT_SETTINGS };
  return cache;
}

/** Discard the in-memory cache (used after deleting all data). */
export function invalidateSettingsCache(): void {
  cache = null;
}

/**
 * Type-guard stored values so a corrupted record cannot put the UI into an
 * impossible state.
 */
function isValidSettingValue(key: keyof AppSettings, value: unknown): boolean {
  const expected = DEFAULT_SETTINGS[key];
  if (value === null) return key === 'activeProfileId';
  if (typeof expected === 'boolean') return typeof value === 'boolean';
  if (typeof expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (typeof expected === 'string') return typeof value === 'string';
  return typeof value === typeof expected;
}

// ---------------------------------------------------------------------------
// Crash-recovery marker for an in-progress measurement
// ---------------------------------------------------------------------------

export const ACTIVE_SESSION_KEY = 'active-session';

export interface ActiveSessionMarker {
  sessionId: string;
  startedAt: number;
  updatedAt: number;
  name: string;
}

export async function setActiveSessionMarker(marker: ActiveSessionMarker | null): Promise<void> {
  if (marker === null) {
    await remove(STORES.settings, ACTIVE_SESSION_KEY).catch(() => undefined);
    return;
  }
  await put<SettingsRecord<ActiveSessionMarker>>(STORES.settings, {
    key: ACTIVE_SESSION_KEY,
    value: marker,
    updatedAt: Date.now(),
  });
}

export async function getActiveSessionMarker(): Promise<ActiveSessionMarker | null> {
  const record = await get<SettingsRecord<ActiveSessionMarker>>(
    STORES.settings,
    ACTIVE_SESSION_KEY
  ).catch(() => undefined);
  return record?.value ?? null;
}
