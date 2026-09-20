/**
 * Exponential time weighting (IEC 61672-1 detectors).
 *
 * The detector runs on the **squared** weighted signal and applies a first order
 * exponential average with time constant tau:
 *
 *     y[n] = a * y[n-1] + (1 - a) * x[n]^2 ,   a = exp(-1 / (tau * fs))
 *     L[n] = 10 * log10( y[n] )
 *
 * This is a true mean-square exponential average at the sample rate. It is not
 * a moving average of displayed decibel values, which would give a different
 * (and wrong) result for time-varying signals.
 */

import { LEVEL_FLOOR_DB, meanSquareToDb } from './levels';

export type TimeWeightingId = 'F' | 'S' | 'I';

export const TIME_WEIGHTING_IDS: readonly TimeWeightingId[] = ['F', 'S', 'I'] as const;

export const TIME_WEIGHTING_LABELS: Record<TimeWeightingId, string> = {
  F: 'FAST',
  S: 'SLOW',
  I: 'IMPULSE',
};

/** Nominal time constants in seconds. */
export const TIME_CONSTANTS = {
  /** Fast: tau = 125 ms */
  F: 0.125,
  /** Slow: tau = 1 s */
  S: 1.0,
  /** Impulse: 35 ms rise */
  I: 0.035,
} as const;

/**
 * Impulse detector decay rate in dB per second (IEC 61672-1 specifies a decay
 * of 2.9 dB/s +- 0.5 dB/s for the I time weighting).
 */
export const IMPULSE_DECAY_DB_PER_SECOND = 2.9;

/** Smoothing coefficient for a given time constant and sample rate. */
export function exponentialCoefficient(tauSeconds: number, sampleRate: number): number {
  return Math.exp(-1 / (tauSeconds * sampleRate));
}

/**
 * First order exponential mean-square detector.
 *
 * Allocation free; safe to run on the audio thread.
 */
export class ExponentialDetector {
  private y = 0;
  private readonly a: number;
  private readonly oneMinusA: number;
  readonly tau: number;
  readonly sampleRate: number;

  constructor(tauSeconds: number, sampleRate: number) {
    this.tau = tauSeconds;
    this.sampleRate = sampleRate;
    this.a = exponentialCoefficient(tauSeconds, sampleRate);
    this.oneMinusA = 1 - this.a;
  }

  /** Push one squared sample; returns the current mean square. */
  push(squared: number): number {
    this.y = this.a * this.y + this.oneMinusA * squared;
    return this.y;
  }

  /** Push one raw sample (squared internally). */
  pushSample(sample: number): number {
    return this.push(sample * sample);
  }

  get meanSquare(): number {
    return this.y;
  }

  get levelDb(): number {
    return meanSquareToDb(this.y);
  }

  reset(initialMeanSquare = 0): void {
    this.y = initialMeanSquare;
  }

  /**
   * Number of samples required for the detector to settle to within `toleranceDb`
   * of a steady state. Used to suppress bogus minima during start-up.
   */
  settlingSamples(toleranceDb = 0.1): number {
    // (1 - a^n) >= 10^(-tol/10)
    const target = Math.pow(10, -toleranceDb / 10);
    return Math.ceil(Math.log(1 - target) / Math.log(this.a));
  }
}

/**
 * Impulse detector: 35 ms exponential rise with a level decay limited to
 * 2.9 dB/s.
 *
 * Implementation notes (documented because I weighting is often implemented
 * inconsistently): the rising edge uses a standard exponential mean-square
 * average with tau = 35 ms. On a falling signal the output is not allowed to
 * fall faster than 2.9 dB/s, which in the mean-square domain is a per-sample
 * multiplication by 10^(-2.9 / (10 * fs)). If the exponentially averaged value
 * is above the decay-limited value the larger one is kept, so short impulses are
 * held and then released slowly, matching the intent of the I time weighting.
 *
 * This is a faithful implementation of the described behaviour but has not been
 * verified against a certified impulse reference; treat I readings as indicative.
 */
export class ImpulseDetector {
  private fast = 0;
  private held = 0;
  private readonly aRise: number;
  private readonly oneMinusARise: number;
  private readonly decayFactor: number;
  readonly sampleRate: number;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.aRise = exponentialCoefficient(TIME_CONSTANTS.I, sampleRate);
    this.oneMinusARise = 1 - this.aRise;
    this.decayFactor = Math.pow(10, -IMPULSE_DECAY_DB_PER_SECOND / (10 * sampleRate));
  }

  push(squared: number): number {
    this.fast = this.aRise * this.fast + this.oneMinusARise * squared;
    const decayed = this.held * this.decayFactor;
    this.held = this.fast > decayed ? this.fast : decayed;
    return this.held;
  }

  pushSample(sample: number): number {
    return this.push(sample * sample);
  }

  get meanSquare(): number {
    return this.held;
  }

  get levelDb(): number {
    return meanSquareToDb(this.held);
  }

  reset(): void {
    this.fast = 0;
    this.held = 0;
  }
}

export interface TimeWeightedDetector {
  push(squared: number): number;
  readonly meanSquare: number;
  readonly levelDb: number;
  reset(initial?: number): void;
}

export function createTimeWeightingDetector(
  id: TimeWeightingId,
  sampleRate: number
): TimeWeightedDetector {
  if (id === 'I') return new ImpulseDetector(sampleRate);
  return new ExponentialDetector(TIME_CONSTANTS[id], sampleRate);
}

/**
 * Offline helper used by the DSP test-suite and the developer lab: run a signal
 * through a detector and return the level trace at `decimation` intervals.
 */
export function detectorTrace(
  signal: Float32Array | Float64Array,
  detector: TimeWeightedDetector,
  decimation = 1
): Float64Array {
  const out = new Float64Array(Math.ceil(signal.length / decimation));
  let j = 0;
  for (let i = 0; i < signal.length; i++) {
    const s = signal[i];
    detector.push(s * s);
    if (i % decimation === 0) out[j++] = detector.levelDb;
  }
  return out.subarray(0, j) as Float64Array;
}

export { LEVEL_FLOOR_DB };
