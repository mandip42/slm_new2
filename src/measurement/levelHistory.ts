/**
 * Level history buffer.
 *
 * Fixed memory, unlimited duration. Samples arrive at a base interval (default
 * 250 ms). When the buffer fills, adjacent pairs are merged and the interval
 * doubles, so a measurement can run for hours without the array growing.
 *
 * Merging is done correctly per trace rather than by throwing away every other
 * sample:
 *   - instantaneous traces are **energy averaged**, so the merged value still
 *     represents the energy of that interval
 *   - the running Leq keeps the later (cumulative) value
 *   - the max/min envelope keeps the extremes, so a peak is never lost to
 *     decimation
 *
 * Everything is stored in the dBFS domain. Calibration is applied at display
 * time, which means changing the calibration re-renders correctly without
 * re-measuring.
 */

import { LEVEL_FLOOR_DB, dbToMeanSquare, meanSquareToDb } from '@/dsp/levels';

export const HISTORY_BASE_INTERVAL_MS = 250;
export const HISTORY_CAPACITY = 16384;

export interface HistorySample {
  LAF: number;
  LAS: number;
  LCF: number;
  LZF: number;
  LAeq: number;
}

export type HistoryTraceId = 'LAeq' | 'LAF' | 'LAS' | 'LCF' | 'LZF';

export const HISTORY_TRACES: ReadonlyArray<{
  id: HistoryTraceId;
  label: string;
  description: string;
  colour: string;
}> = [
  { id: 'LAeq', label: 'LAeq', description: 'Running A-weighted equivalent level', colour: '#f59e0b' },
  { id: 'LAF', label: 'LAF', description: 'A-weighted, Fast time weighting', colour: '#22d3ee' },
  { id: 'LAS', label: 'LAS', description: 'A-weighted, Slow time weighting', colour: '#60a5fa' },
  { id: 'LCF', label: 'LCF', description: 'C-weighted, Fast time weighting', colour: '#a78bfa' },
  { id: 'LZF', label: 'LZF', description: 'Z-weighted (unweighted), Fast time weighting', colour: '#94a3b8' },
];

export const HISTORY_WINDOWS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 10, label: '10 s' },
  { seconds: 30, label: '30 s' },
  { seconds: 60, label: '1 min' },
  { seconds: 300, label: '5 min' },
  { seconds: 900, label: '15 min' },
  { seconds: 3600, label: '1 h' },
  { seconds: Number.POSITIVE_INFINITY, label: 'Full' },
];

function energyMerge(a: number, b: number): number {
  const aOk = Number.isFinite(a) && a > LEVEL_FLOOR_DB;
  const bOk = Number.isFinite(b) && b > LEVEL_FLOOR_DB;
  if (!aOk && !bOk) return LEVEL_FLOOR_DB;
  if (!aOk) return b;
  if (!bOk) return a;
  return meanSquareToDb((dbToMeanSquare(a) + dbToMeanSquare(b)) / 2);
}

export class LevelHistory {
  readonly capacity: number;
  private readonly baseIntervalMs: number;

  private readonly elapsedArr: Float32Array;
  private readonly lafArr: Float32Array;
  private readonly lasArr: Float32Array;
  private readonly lcfArr: Float32Array;
  private readonly lzfArr: Float32Array;
  private readonly laeqArr: Float32Array;
  private readonly lafMaxArr: Float32Array;
  private readonly lafMinArr: Float32Array;

  private size = 0;
  private intervalMsValue: number;
  private nextSampleAtMs = 0;

  /** Accumulators for the current (possibly decimated) slot. */
  private pendingCount = 0;
  private pendingEnergy = { LAF: 0, LAS: 0, LCF: 0, LZF: 0 };
  private pendingLaeq = LEVEL_FLOOR_DB;
  private pendingMax = -Infinity;
  private pendingMin = Infinity;
  private pendingElapsed = 0;

  constructor(capacity = HISTORY_CAPACITY, baseIntervalMs = HISTORY_BASE_INTERVAL_MS) {
    this.capacity = capacity;
    this.baseIntervalMs = baseIntervalMs;
    this.intervalMsValue = baseIntervalMs;
    this.elapsedArr = new Float32Array(capacity);
    this.lafArr = new Float32Array(capacity);
    this.lasArr = new Float32Array(capacity);
    this.lcfArr = new Float32Array(capacity);
    this.lzfArr = new Float32Array(capacity);
    this.laeqArr = new Float32Array(capacity);
    this.lafMaxArr = new Float32Array(capacity);
    this.lafMinArr = new Float32Array(capacity);
  }

  get length(): number {
    return this.size;
  }

  get intervalMs(): number {
    return this.intervalMsValue;
  }

  get durationSeconds(): number {
    return this.size > 0 ? this.elapsedArr[this.size - 1] : 0;
  }

  /** Whether the buffer has had to reduce its time resolution. */
  get decimated(): boolean {
    return this.intervalMsValue > this.baseIntervalMs;
  }

  reset(): void {
    this.size = 0;
    this.intervalMsValue = this.baseIntervalMs;
    this.nextSampleAtMs = 0;
    this.clearPending();
  }

  private clearPending(): void {
    this.pendingCount = 0;
    this.pendingEnergy = { LAF: 0, LAS: 0, LCF: 0, LZF: 0 };
    this.pendingLaeq = LEVEL_FLOOR_DB;
    this.pendingMax = -Infinity;
    this.pendingMin = Infinity;
    this.pendingElapsed = 0;
  }

  /**
   * Feed one metric update.
   *
   * @param elapsedSeconds measurement time of the sample
   */
  push(elapsedSeconds: number, sample: HistorySample): void {
    const elapsedMs = elapsedSeconds * 1000;

    this.pendingCount++;
    this.pendingElapsed = elapsedSeconds;
    for (const key of ['LAF', 'LAS', 'LCF', 'LZF'] as const) {
      const value = sample[key];
      if (Number.isFinite(value) && value > LEVEL_FLOOR_DB) {
        this.pendingEnergy[key] += dbToMeanSquare(value);
      }
    }
    if (Number.isFinite(sample.LAeq)) this.pendingLaeq = sample.LAeq;
    if (Number.isFinite(sample.LAF)) {
      if (sample.LAF > this.pendingMax) this.pendingMax = sample.LAF;
      if (sample.LAF < this.pendingMin) this.pendingMin = sample.LAF;
    }

    if (elapsedMs + 1e-6 < this.nextSampleAtMs) return;
    this.commitPending();
    this.nextSampleAtMs = elapsedMs + this.intervalMsValue;
  }

  private commitPending(): void {
    if (this.pendingCount === 0) return;
    if (this.size >= this.capacity) this.decimate();

    const i = this.size++;
    const n = this.pendingCount;
    this.elapsedArr[i] = this.pendingElapsed;
    this.lafArr[i] = this.pendingEnergy.LAF > 0 ? meanSquareToDb(this.pendingEnergy.LAF / n) : LEVEL_FLOOR_DB;
    this.lasArr[i] = this.pendingEnergy.LAS > 0 ? meanSquareToDb(this.pendingEnergy.LAS / n) : LEVEL_FLOOR_DB;
    this.lcfArr[i] = this.pendingEnergy.LCF > 0 ? meanSquareToDb(this.pendingEnergy.LCF / n) : LEVEL_FLOOR_DB;
    this.lzfArr[i] = this.pendingEnergy.LZF > 0 ? meanSquareToDb(this.pendingEnergy.LZF / n) : LEVEL_FLOOR_DB;
    this.laeqArr[i] = this.pendingLaeq;
    this.lafMaxArr[i] = Number.isFinite(this.pendingMax) ? this.pendingMax : LEVEL_FLOOR_DB;
    this.lafMinArr[i] = Number.isFinite(this.pendingMin) ? this.pendingMin : LEVEL_FLOOR_DB;

    this.clearPending();
  }

  /** Halve the resolution in place, merging adjacent pairs. */
  private decimate(): void {
    const half = this.size >> 1;
    for (let i = 0; i < half; i++) {
      const a = i * 2;
      const b = a + 1;
      this.elapsedArr[i] = this.elapsedArr[b];
      this.lafArr[i] = energyMerge(this.lafArr[a], this.lafArr[b]);
      this.lasArr[i] = energyMerge(this.lasArr[a], this.lasArr[b]);
      this.lcfArr[i] = energyMerge(this.lcfArr[a], this.lcfArr[b]);
      this.lzfArr[i] = energyMerge(this.lzfArr[a], this.lzfArr[b]);
      // The running Leq is cumulative, so the later value is the correct one.
      this.laeqArr[i] = this.laeqArr[b];
      this.lafMaxArr[i] = Math.max(this.lafMaxArr[a], this.lafMaxArr[b]);
      this.lafMinArr[i] = Math.min(this.lafMinArr[a], this.lafMinArr[b]);
    }
    this.size = half;
    this.intervalMsValue *= 2;
    this.nextSampleAtMs = this.durationSeconds * 1000 + this.intervalMsValue;
  }

  /** Read-only view of one trace, valid until the next push. */
  trace(id: HistoryTraceId): Float32Array {
    switch (id) {
      case 'LAeq':
        return this.laeqArr.subarray(0, this.size);
      case 'LAF':
        return this.lafArr.subarray(0, this.size);
      case 'LAS':
        return this.lasArr.subarray(0, this.size);
      case 'LCF':
        return this.lcfArr.subarray(0, this.size);
      case 'LZF':
        return this.lzfArr.subarray(0, this.size);
    }
  }

  get elapsed(): Float32Array {
    return this.elapsedArr.subarray(0, this.size);
  }

  get lafEnvelope(): { max: Float32Array; min: Float32Array } {
    return {
      max: this.lafMaxArr.subarray(0, this.size),
      min: this.lafMinArr.subarray(0, this.size),
    };
  }

  /** First index inside the trailing window of `seconds`. */
  windowStartIndex(seconds: number): number {
    if (!Number.isFinite(seconds) || this.size === 0) return 0;
    const cutoff = this.durationSeconds - seconds;
    if (cutoff <= 0) return 0;
    let lo = 0;
    let hi = this.size - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.elapsedArr[mid] < cutoff) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Copy the traces out for persistence. */
  snapshotSeries(): {
    intervalMs: number;
    elapsed: Float32Array;
    LAF: Float32Array;
    LAS: Float32Array;
    LCF: Float32Array;
    LZF: Float32Array;
    LAeq: Float32Array;
  } {
    return {
      intervalMs: this.intervalMsValue,
      elapsed: Float32Array.from(this.elapsed),
      LAF: Float32Array.from(this.trace('LAF')),
      LAS: Float32Array.from(this.trace('LAS')),
      LCF: Float32Array.from(this.trace('LCF')),
      LZF: Float32Array.from(this.trace('LZF')),
      LAeq: Float32Array.from(this.trace('LAeq')),
    };
  }

  /** Extremes of a trace over a window, ignoring unmeasurable samples. */
  extremes(id: HistoryTraceId, fromIndex = 0): { min: number; max: number } | null {
    const data = this.trace(id);
    let min = Infinity;
    let max = -Infinity;
    for (let i = fromIndex; i < data.length; i++) {
      const v = data[i];
      if (!Number.isFinite(v) || v <= LEVEL_FLOOR_DB) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min)) return null;
    return { min, max };
  }
}
