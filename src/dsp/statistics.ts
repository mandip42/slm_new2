/**
 * Statistical acoustics: exceedance (percentile) levels and the level
 * distribution.
 *
 * METHODOLOGY (stated explicitly because "L90" is ambiguous otherwise)
 * -------------------------------------------------------------------
 *  - The statistical sample is the **Fast time-weighted, frequency-weighted
 *    level** (LAF by default), sampled at a fixed rate of
 *    `STATISTICS_SAMPLE_RATE_HZ` samples per second, independent of the display
 *    refresh rate.
 *  - Samples are accumulated into a fixed-width histogram (default 0.1 dB bins)
 *    so memory stays bounded for arbitrarily long measurements.
 *  - `Ln` is the level **exceeded n % of the measurement time**, i.e. the
 *    (100 - n)th percentile of the sampled distribution. L90 is therefore a low
 *    level (background) and L10 a high level, matching normal acoustic practice.
 *  - Percentiles are linearly interpolated inside the containing bin, which
 *    removes the quantisation step that a bin-edge read-out would introduce.
 *
 * Because the histogram is built in the dBFS domain and the calibration
 * transform is a constant offset, applying calibration after the fact shifts
 * every percentile by exactly that offset. No information is lost.
 */

export const STATISTICS_SAMPLE_RATE_HZ = 20;

/** Standard exceedance levels reported by Sonoscope. */
export const PERCENTILE_LEVELS = [1, 5, 10, 50, 90, 95, 99] as const;
export type PercentileKey = `L${(typeof PERCENTILE_LEVELS)[number]}`;

export type PercentileSet = Record<PercentileKey, number>;

export interface HistogramData {
  /** Left edge of each bin, in dB. */
  edges: Float32Array;
  /** Sample count per bin. */
  counts: Uint32Array;
  binWidth: number;
  total: number;
  /** Index range that actually contains data (inclusive), or null when empty. */
  occupied: { first: number; last: number } | null;
}

export interface LevelHistogramOptions {
  minDb?: number;
  maxDb?: number;
  binWidth?: number;
}

/**
 * Fixed-width level histogram with interpolated percentile read-out.
 */
export class LevelHistogram {
  readonly minDb: number;
  readonly maxDb: number;
  readonly binWidth: number;
  private readonly counts: Uint32Array;
  private total = 0;
  private minObserved = Infinity;
  private maxObserved = -Infinity;
  private firstOccupied = -1;
  private lastOccupied = -1;

  constructor(options: LevelHistogramOptions = {}) {
    // Range chosen to cover the dBFS domain (-160 .. 0) with headroom for
    // calibrated SPL values (up to ~160 dB) so the same class can be reused for
    // post-calibration statistics.
    this.minDb = options.minDb ?? -160;
    this.maxDb = options.maxDb ?? 200;
    this.binWidth = options.binWidth ?? 0.1;
    const bins = Math.ceil((this.maxDb - this.minDb) / this.binWidth);
    this.counts = new Uint32Array(bins);
  }

  get binCount(): number {
    return this.counts.length;
  }

  get sampleCount(): number {
    return this.total;
  }

  get observedRange(): { min: number; max: number } | null {
    if (this.total === 0) return null;
    return { min: this.minObserved, max: this.maxObserved };
  }

  add(levelDb: number): void {
    if (!Number.isFinite(levelDb)) return;
    let bin = Math.floor((levelDb - this.minDb) / this.binWidth);
    if (bin < 0) bin = 0;
    else if (bin >= this.counts.length) bin = this.counts.length - 1;
    this.counts[bin]++;
    this.total++;
    if (levelDb < this.minObserved) this.minObserved = levelDb;
    if (levelDb > this.maxObserved) this.maxObserved = levelDb;
    if (this.firstOccupied < 0 || bin < this.firstOccupied) this.firstOccupied = bin;
    if (bin > this.lastOccupied) this.lastOccupied = bin;
  }

  reset(): void {
    this.counts.fill(0);
    this.total = 0;
    this.minObserved = Infinity;
    this.maxObserved = -Infinity;
    this.firstOccupied = -1;
    this.lastOccupied = -1;
  }

  /**
   * The p-th percentile: the level below which p % of samples fall.
   * Linear interpolation is applied inside the containing bin.
   */
  percentile(p: number): number {
    if (this.total === 0) return NaN;
    const clamped = Math.min(100, Math.max(0, p));
    const target = (clamped / 100) * this.total;
    let cumulative = 0;
    for (let bin = 0; bin < this.counts.length; bin++) {
      const c = this.counts[bin];
      if (c === 0) continue;
      if (cumulative + c >= target) {
        const withinBin = c > 0 ? (target - cumulative) / c : 0;
        return this.minDb + (bin + Math.min(1, Math.max(0, withinBin))) * this.binWidth;
      }
      cumulative += c;
    }
    return this.minDb + this.counts.length * this.binWidth;
  }

  /** Ln — the level exceeded n % of the time. */
  exceedanceLevel(n: number): number {
    return this.percentile(100 - n);
  }

  /** The standard exceedance set L1/L5/L10/L50/L90/L95/L99. */
  percentiles(): PercentileSet {
    const out = {} as PercentileSet;
    for (const n of PERCENTILE_LEVELS) {
      out[`L${n}` as PercentileKey] = this.exceedanceLevel(n);
    }
    return out;
  }

  /** Histogram data for plotting, trimmed to the occupied range by the caller. */
  distribution(): HistogramData {
    const edges = new Float32Array(this.counts.length);
    for (let i = 0; i < edges.length; i++) edges[i] = this.minDb + i * this.binWidth;
    return {
      edges,
      counts: this.counts,
      binWidth: this.binWidth,
      total: this.total,
      occupied:
        this.firstOccupied >= 0 ? { first: this.firstOccupied, last: this.lastOccupied } : null,
    };
  }

  /**
   * Coarser distribution for display: re-bins into `targetBinWidth` (default
   * 1 dB) over the occupied range only.
   */
  displayDistribution(
    targetBinWidth = 1,
    offsetDb = 0
  ): { centres: number[]; counts: number[]; total: number } {
    if (this.total === 0 || this.firstOccupied < 0) return { centres: [], counts: [], total: 0 };
    const ratio = Math.max(1, Math.round(targetBinWidth / this.binWidth));
    const start = Math.floor(this.firstOccupied / ratio) * ratio;
    const end = this.lastOccupied;
    const centres: number[] = [];
    const counts: number[] = [];
    for (let bin = start; bin <= end; bin += ratio) {
      let c = 0;
      for (let k = 0; k < ratio && bin + k < this.counts.length; k++) c += this.counts[bin + k];
      const lo = this.minDb + bin * this.binWidth;
      centres.push(lo + (ratio * this.binWidth) / 2 + offsetDb);
      counts.push(c);
    }
    return { centres, counts, total: this.total };
  }

  /** Serialisable snapshot for session persistence. */
  toJSON(): { minDb: number; binWidth: number; first: number; counts: number[] } {
    if (this.firstOccupied < 0) return { minDb: this.minDb, binWidth: this.binWidth, first: 0, counts: [] };
    return {
      minDb: this.minDb,
      binWidth: this.binWidth,
      first: this.firstOccupied,
      counts: Array.from(this.counts.subarray(this.firstOccupied, this.lastOccupied + 1)),
    };
  }

  static fromJSON(data: {
    minDb: number;
    binWidth: number;
    first: number;
    counts: number[];
  }): LevelHistogram {
    const h = new LevelHistogram({ minDb: data.minDb, binWidth: data.binWidth });
    for (let i = 0; i < data.counts.length; i++) {
      const c = data.counts[i];
      if (c <= 0) continue;
      const bin = data.first + i;
      h.counts[bin] = c;
      h.total += c;
      if (h.firstOccupied < 0 || bin < h.firstOccupied) h.firstOccupied = bin;
      if (bin > h.lastOccupied) h.lastOccupied = bin;
    }
    if (h.total > 0) {
      h.minObserved = h.minDb + h.firstOccupied * h.binWidth;
      h.maxObserved = h.minDb + (h.lastOccupied + 1) * h.binWidth;
    }
    return h;
  }
}

/**
 * Exact percentile of an array of levels (used by the DSP tests to verify the
 * histogram implementation against a direct sort).
 */
export function exactPercentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Exact Ln from an array of levels. */
export function exactExceedanceLevel(values: readonly number[], n: number): number {
  return exactPercentile(values, 100 - n);
}

/** Basic descriptive statistics used throughout the validation screens. */
export interface DescriptiveStats {
  n: number;
  mean: number;
  standardDeviation: number;
  rmse: number;
  maxAbs: number;
  min: number;
  max: number;
  /** 95 % interval of the errors, mean +- 1.96 * sd. Null when n < 3. */
  interval95: { low: number; high: number } | null;
}

/**
 * Descriptive statistics of a set of (signed) errors.
 * The sample standard deviation (n-1) is used. The 95 % interval is only
 * reported once there are at least 3 observations, since it is meaningless for
 * fewer.
 */
export function describeErrors(errors: readonly number[]): DescriptiveStats {
  const n = errors.length;
  if (n === 0) {
    return {
      n: 0,
      mean: NaN,
      standardDeviation: NaN,
      rmse: NaN,
      maxAbs: NaN,
      min: NaN,
      max: NaN,
      interval95: null,
    };
  }
  let sum = 0;
  let sumSq = 0;
  let maxAbs = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const e of errors) {
    sum += e;
    sumSq += e * e;
    const a = Math.abs(e);
    if (a > maxAbs) maxAbs = a;
    if (e < min) min = e;
    if (e > max) max = e;
  }
  const mean = sum / n;
  const variance = n > 1 ? (sumSq - n * mean * mean) / (n - 1) : 0;
  const sd = Math.sqrt(Math.max(0, variance));
  return {
    n,
    mean,
    standardDeviation: sd,
    rmse: Math.sqrt(sumSq / n),
    maxAbs,
    min,
    max,
    interval95: n >= 3 ? { low: mean - 1.96 * sd, high: mean + 1.96 * sd } : null,
  };
}
