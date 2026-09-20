/**
 * Fractional-octave band definitions and the real-time filter bank.
 *
 * BAND DEFINITIONS follow the base-ten system of IEC 61260:
 *
 *     G      = 10^(3/10)                        (octave ratio)
 *     f_m    = 1000 * G^(x/b)                   (exact midband frequency)
 *     f_1,2  = f_m * G^(-+ 1/(2b))              (band edges)
 *
 * with b = 1 for octave bands and b = 3 for one-third-octave bands. Nominal
 * (preferred) frequencies from ISO 266 are used for labelling only; all filter
 * maths uses the exact midband frequencies.
 *
 * BAND LEVELS are produced by a bank of order-6 Butterworth band-pass filters
 * running at the full sample rate. The level of a band is the mean square of the
 * band-pass filtered signal, integrated over the whole bandwidth. No band level
 * is ever taken from a single FFT bin.
 *
 * OCTAVE BANDS are derived by energy summation of the three constituent
 * one-third-octave bands, which is exact and avoids running a second bank.
 */

import { BiquadCascade } from './biquad';
import { designButterworthBandpass } from './butterworth';
import { LEVEL_FLOOR_DB, meanSquareToDb } from './levels';
import { ExponentialDetector, TIME_CONSTANTS } from './timeWeighting';

/** Octave frequency ratio of the base-ten system. */
export const G = Math.pow(10, 3 / 10);

/** Default band-pass order of the filter bank. */
export const DEFAULT_BANK_ORDER = 6;

/**
 * A band is only measured when its upper edge stays clear of Nyquist. 0.45*fs
 * keeps the band-pass transition region away from the point where the bilinear
 * transform distorts the shape.
 */
export const BAND_USABLE_NYQUIST_FRACTION = 0.45;

export type BandFraction = 1 | 3;

export interface BandDefinition {
  /** IEC band index x (f_m = 1000 * G^(x/b)). */
  index: number;
  /** Nominal / preferred labelling frequency (Hz). */
  nominal: number;
  /** Exact midband frequency (Hz). */
  exact: number;
  /** Lower band edge (Hz). */
  lower: number;
  /** Upper band edge (Hz). */
  upper: number;
  /** Short display label, e.g. "31.5", "1k", "12.5k". */
  label: string;
}

export interface BankBand extends BandDefinition {
  /** False when the band cannot be measured at the active sample rate. */
  available: boolean;
  /** Reason a band is unavailable, for honest UI messaging. */
  unavailableReason?: string;
}

/** ISO 266 preferred one-third-octave frequencies, index -20 .. 13. */
const THIRD_OCTAVE_NOMINAL: Record<number, number> = {
  [-20]: 10,
  [-19]: 12.5,
  [-18]: 16,
  [-17]: 20,
  [-16]: 25,
  [-15]: 31.5,
  [-14]: 40,
  [-13]: 50,
  [-12]: 63,
  [-11]: 80,
  [-10]: 100,
  [-9]: 125,
  [-8]: 160,
  [-7]: 200,
  [-6]: 250,
  [-5]: 315,
  [-4]: 400,
  [-3]: 500,
  [-2]: 630,
  [-1]: 800,
  0: 1000,
  1: 1250,
  2: 1600,
  3: 2000,
  4: 2500,
  5: 3150,
  6: 4000,
  7: 5000,
  8: 6300,
  9: 8000,
  10: 10000,
  11: 12500,
  12: 16000,
  13: 20000,
};

/** Default measured one-third-octave range: 20 Hz .. 20 kHz (31 bands). */
export const THIRD_OCTAVE_INDEX_RANGE = { first: -17, last: 13 } as const;

/** Default measured octave range: 31.5 Hz .. 16 kHz (10 bands). */
export const OCTAVE_INDEX_RANGE = { first: -5, last: 4 } as const;

export function formatBandLabel(nominal: number): string {
  if (nominal >= 1000) {
    const k = nominal / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return Number.isInteger(nominal) ? String(nominal) : nominal.toFixed(1);
}

/** Exact midband frequency for a band index and fraction. */
export function midbandFrequency(index: number, fraction: BandFraction): number {
  return 1000 * Math.pow(G, index / fraction);
}

/** Band definition for one index. */
export function bandDefinition(index: number, fraction: BandFraction): BandDefinition {
  const exact = midbandFrequency(index, fraction);
  const halfStep = Math.pow(G, 1 / (2 * fraction));
  const nominal =
    fraction === 3
      ? THIRD_OCTAVE_NOMINAL[index] ?? Number(exact.toPrecision(3))
      : THIRD_OCTAVE_NOMINAL[index * 3] ?? Number(exact.toPrecision(3));
  return {
    index,
    nominal,
    exact,
    lower: exact / halfStep,
    upper: exact * halfStep,
    label: formatBandLabel(nominal),
  };
}

/** All one-third-octave band definitions in the default range. */
export function thirdOctaveBandDefinitions(): BandDefinition[] {
  const out: BandDefinition[] = [];
  for (let i = THIRD_OCTAVE_INDEX_RANGE.first; i <= THIRD_OCTAVE_INDEX_RANGE.last; i++) {
    out.push(bandDefinition(i, 3));
  }
  return out;
}

/** All octave band definitions in the default range. */
export function octaveBandDefinitions(): BandDefinition[] {
  const out: BandDefinition[] = [];
  for (let i = OCTAVE_INDEX_RANGE.first; i <= OCTAVE_INDEX_RANGE.last; i++) {
    out.push(bandDefinition(i, 1));
  }
  return out;
}

/** Mark bands measurable at a given sample rate. */
export function resolveBankBands(
  definitions: readonly BandDefinition[],
  sampleRate: number
): BankBand[] {
  const limit = sampleRate * BAND_USABLE_NYQUIST_FRACTION;
  return definitions.map((d) => {
    if (d.upper > limit) {
      return {
        ...d,
        available: false,
        unavailableReason: `Upper band edge ${Math.round(d.upper)} Hz exceeds the usable limit (${Math.round(limit)} Hz) at ${sampleRate} Hz sample rate`,
      };
    }
    return { ...d, available: true };
  });
}

export interface BandResults {
  /** Current time-weighted band level in dB (Fast, tau = 125 ms). */
  current: Float32Array;
  /** Band Leq over the integration period, in dB. */
  leq: Float32Array;
  /** Maximum time-weighted band level observed, in dB. */
  max: Float32Array;
  /** Number of samples integrated. */
  samples: number;
}

/**
 * Real-time fractional-octave filter bank.
 *
 * Runs one order-`order` Butterworth band-pass per band at the full sample rate.
 * Intended to be executed inside a Web Worker on buffered blocks: filter state
 * persists across blocks so the filtering is continuous, but the work is kept
 * off the audio rendering thread.
 */
export class FractionalOctaveBank {
  readonly bands: BankBand[];
  readonly sampleRate: number;
  readonly order: number;
  readonly fraction: BandFraction;

  private readonly filters: Array<BiquadCascade | null>;
  private readonly detectors: Array<ExponentialDetector | null>;
  private readonly energy: Float64Array;
  private readonly maxMeanSquare: Float64Array;
  private readonly currentOut: Float32Array;
  private readonly leqOut: Float32Array;
  private readonly maxOut: Float32Array;
  private sampleCount = 0;
  private statisticsEnabled = false;
  /** Set when any designed section turned out to be numerically unstable. */
  readonly unstableBands: number[] = [];

  constructor(
    definitions: readonly BandDefinition[],
    sampleRate: number,
    fraction: BandFraction,
    order: number = DEFAULT_BANK_ORDER
  ) {
    this.sampleRate = sampleRate;
    this.order = order;
    this.fraction = fraction;
    this.bands = resolveBankBands(definitions, sampleRate);

    this.filters = this.bands.map((band) => {
      if (!band.available) return null;
      try {
        const design = designButterworthBandpass(order, band.lower, band.upper, sampleRate);
        if (!design.stable) {
          this.unstableBands.push(band.index);
          return null;
        }
        return new BiquadCascade(design.sections);
      } catch {
        this.unstableBands.push(band.index);
        return null;
      }
    });

    this.detectors = this.bands.map((band) =>
      band.available ? new ExponentialDetector(TIME_CONSTANTS.F, sampleRate) : null
    );

    const n = this.bands.length;
    this.energy = new Float64Array(n);
    this.maxMeanSquare = new Float64Array(n);
    this.currentOut = new Float32Array(n);
    this.leqOut = new Float32Array(n);
    this.maxOut = new Float32Array(n);
  }

  /**
   * Start accumulating band Leq and band maxima.
   *
   * Called by the engine once the acquisition warm-up has elapsed, so that the
   * band-pass ring-up transient (up to ~70 ms in the 20 Hz band) and the
   * detector ramp are never counted as real measurement data.
   */
  enableStatistics(): void {
    this.statisticsEnabled = true;
    this.energy.fill(0);
    this.maxMeanSquare.fill(0);
    this.sampleCount = 0;
  }

  get isAccumulating(): boolean {
    return this.statisticsEnabled;
  }

  get bandCount(): number {
    return this.bands.length;
  }

  /** Reset filter state and all accumulated statistics. */
  reset(): void {
    for (const f of this.filters) f?.reset();
    for (const d of this.detectors) d?.reset();
    this.energy.fill(0);
    this.maxMeanSquare.fill(0);
    this.sampleCount = 0;
    this.statisticsEnabled = false;
  }

  /** Reset only the accumulated statistics, keeping filter state continuous. */
  resetStatistics(): void {
    this.energy.fill(0);
    this.maxMeanSquare.fill(0);
    this.sampleCount = 0;
  }

  /**
   * Filter one block through every band and accumulate energy.
   * Allocation free.
   */
  processBlock(input: Float32Array | Float64Array): void {
    const n = input.length;
    if (n === 0) return;
    const accumulate = this.statisticsEnabled;

    for (let b = 0; b < this.filters.length; b++) {
      const filter = this.filters[b];
      const detector = this.detectors[b];
      if (!filter || !detector) continue;
      let sum = 0;
      let localMax = this.maxMeanSquare[b];
      for (let i = 0; i < n; i++) {
        const y = filter.process(input[i]);
        const sq = y * y;
        sum += sq;
        const ms = detector.push(sq);
        if (accumulate && ms > localMax) localMax = ms;
      }
      if (accumulate) {
        this.energy[b] += sum;
        this.maxMeanSquare[b] = localMax;
      }
    }

    if (accumulate) this.sampleCount += n;
  }

  /**
   * Snapshot of the current band results. The returned arrays are reused between
   * calls; copy them if they must outlive the next snapshot.
   */
  results(): BandResults {
    for (let b = 0; b < this.bands.length; b++) {
      const detector = this.detectors[b];
      if (!detector) {
        this.currentOut[b] = LEVEL_FLOOR_DB;
        this.leqOut[b] = LEVEL_FLOOR_DB;
        this.maxOut[b] = LEVEL_FLOOR_DB;
        continue;
      }
      this.currentOut[b] = detector.levelDb;
      this.leqOut[b] =
        this.sampleCount > 0 ? meanSquareToDb(this.energy[b] / this.sampleCount) : LEVEL_FLOOR_DB;
      this.maxOut[b] =
        this.maxMeanSquare[b] > 0 ? meanSquareToDb(this.maxMeanSquare[b]) : LEVEL_FLOOR_DB;
    }
    return {
      current: this.currentOut,
      leq: this.leqOut,
      max: this.maxOut,
      samples: this.sampleCount,
    };
  }

  /** Band Leq values as a plain array (used by tests and exports). */
  leqArray(): number[] {
    const r = this.results();
    return Array.from(r.leq);
  }
}

/**
 * Group one-third-octave band indices into octave bands.
 * Octave index n covers third-octave indices 3n-1, 3n, 3n+1.
 */
export function octaveGroups(
  thirdBands: readonly BandDefinition[],
  octaveBands: readonly BandDefinition[]
): number[][] {
  const indexOf = new Map<number, number>();
  thirdBands.forEach((b, i) => indexOf.set(b.index, i));
  return octaveBands.map((ob) => {
    const members: number[] = [];
    for (const idx of [3 * ob.index - 1, 3 * ob.index, 3 * ob.index + 1]) {
      const pos = indexOf.get(idx);
      if (pos !== undefined) members.push(pos);
    }
    return members;
  });
}

/**
 * Energy-sum one-third-octave levels into octave levels.
 * Returns LEVEL_FLOOR_DB for octaves with no usable constituent bands, and
 * reports how many of the three thirds contributed so the UI can flag partial
 * octaves instead of showing a silently low value.
 */
export function sumThirdOctavesToOctaves(
  thirdLevelsDb: Float32Array | readonly number[],
  groups: readonly number[][],
  availability: readonly boolean[]
): { levelsDb: Float32Array; contributingBands: Uint8Array } {
  const out = new Float32Array(groups.length);
  const contributing = new Uint8Array(groups.length);
  for (let g = 0; g < groups.length; g++) {
    let acc = 0;
    let count = 0;
    for (const pos of groups[g]) {
      if (!availability[pos]) continue;
      const l = thirdLevelsDb[pos];
      if (l <= LEVEL_FLOOR_DB) {
        count++;
        continue;
      }
      acc += Math.pow(10, l / 10);
      count++;
    }
    contributing[g] = count;
    out[g] = count > 0 && acc > 0 ? meanSquareToDb(acc) : LEVEL_FLOOR_DB;
  }
  return { levelsDb: out, contributingBands: contributing };
}

/**
 * Broadband level reconstructed from band levels by energy summation.
 * Used by the frequency-response correction path: applying a per-band
 * correction and then re-summing is the defensible way to produce a
 * frequency-corrected broadband level.
 */
export function broadbandFromBands(
  levelsDb: Float32Array | readonly number[],
  availability: readonly boolean[],
  correctionsDb?: readonly number[]
): number {
  let acc = 0;
  for (let i = 0; i < levelsDb.length; i++) {
    if (!availability[i]) continue;
    const l = levelsDb[i];
    if (l <= LEVEL_FLOOR_DB) continue;
    const corr = correctionsDb ? correctionsDb[i] ?? 0 : 0;
    acc += Math.pow(10, (l + corr) / 10);
  }
  return acc > 0 ? meanSquareToDb(acc) : LEVEL_FLOOR_DB;
}
