/**
 * Display formatting.
 *
 * One rule throughout: a value that does not exist is shown as an em dash, never
 * as 0, never as -Infinity, and never as a plausible-looking placeholder.
 */

import { LEVEL_FLOOR_DB } from '@/dsp/levels';

export const NO_VALUE = '\u2014';

export function isMeasurable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > LEVEL_FLOOR_DB;
}

/** Level with a fixed number of decimals, or an em dash. */
export function formatLevel(value: number | null | undefined, decimals = 1): string {
  if (!isMeasurable(value)) return NO_VALUE;
  return value.toFixed(decimals);
}

/** Signed value, useful for offsets and errors. */
export function formatSigned(value: number | null | undefined, decimals = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE;
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE;
  return value.toFixed(decimals);
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE;
  return `${value.toFixed(decimals)} %`;
}

/** Frequency with an appropriate unit and precision. */
export function formatFrequency(hz: number | null | undefined): string {
  if (typeof hz !== 'number' || !Number.isFinite(hz)) return NO_VALUE;
  if (hz >= 10000) return `${(hz / 1000).toFixed(1)} kHz`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  if (hz >= 100) return `${hz.toFixed(0)} Hz`;
  return `${hz.toFixed(1)} Hz`;
}

/** Duration as H:MM:SS or M:SS. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return NO_VALUE;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Duration in words, e.g. "2 h 14 min" or "45 s". */
export function formatDurationWords(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return NO_VALUE;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${Math.round(seconds % 60)} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** Absolute date and time in the user's locale. */
export function formatDateTime(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return NO_VALUE;
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return NO_VALUE;
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

/** Relative age, e.g. "12 days ago". */
export function formatAge(timestamp: number | null | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return NO_VALUE;
  const seconds = (Date.now() - timestamp) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) === 1 ? '' : 's'} ago`;
}

/** Bytes with a binary unit. */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return NO_VALUE;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[index]}`;
}

/** ISO 8601 timestamp for exports. */
export function isoTimestamp(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString();
}

/** Filename-safe slug. */
export function slugify(text: string, fallback = 'sonoscope'): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

/** Compact timestamp suitable for filenames: 20260915-153412 */
export function filenameTimestamp(timestamp = Date.now()): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
