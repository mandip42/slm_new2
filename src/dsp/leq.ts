/**
 * Equivalent continuous sound level (Leq) integration.
 *
 * Leq is an energy average. Every accumulation here happens in the mean-square
 * domain and is only converted to decibels on read-out:
 *
 *     Leq,T = 10 * log10( (1/N) * sum( x_w[n]^2 ) )
 *
 * Arithmetic averaging of decibel values is never used.
 */

import { EnergyAccumulator, LEVEL_FLOOR_DB, meanSquareToDb, soundExposureLevel } from './levels';

/**
 * Integrates Leq over a whole measurement while simultaneously producing a
 * series of short-Leq values (default 1 s) for reporting and graphing.
 */
export class LeqIntegrator {
  private readonly total = new EnergyAccumulator();
  private segmentSum = 0;
  private segmentSamples = 0;
  private readonly segmentLength: number;
  private readonly segments: number[] = [];

  readonly sampleRate: number;
  readonly segmentSeconds: number;

  constructor(sampleRate: number, segmentSeconds = 1) {
    this.sampleRate = sampleRate;
    this.segmentSeconds = segmentSeconds;
    this.segmentLength = Math.max(1, Math.round(sampleRate * segmentSeconds));
  }

  /** Add one squared (already frequency-weighted) sample. */
  addSquared(squared: number): void {
    this.total.addSquared(squared);
    this.segmentSum += squared;
    if (++this.segmentSamples >= this.segmentLength) {
      this.segments.push(meanSquareToDb(this.segmentSum / this.segmentSamples));
      this.segmentSum = 0;
      this.segmentSamples = 0;
    }
  }

  /** Add a pre-computed block energy (sum of squares) and its sample count. */
  addBlock(sumOfSquares: number, sampleCount: number): void {
    this.total.addBlockEnergy(sumOfSquares, sampleCount);
    this.segmentSum += sumOfSquares;
    this.segmentSamples += sampleCount;
    while (this.segmentSamples >= this.segmentLength) {
      // Attribute a proportional share of the energy to the completed segment.
      const share = (this.segmentSum * this.segmentLength) / this.segmentSamples;
      this.segments.push(meanSquareToDb(share / this.segmentLength));
      this.segmentSum -= share;
      this.segmentSamples -= this.segmentLength;
    }
  }

  reset(): void {
    this.total.reset();
    this.segmentSum = 0;
    this.segmentSamples = 0;
    this.segments.length = 0;
  }

  get leq(): number {
    return this.total.levelDb;
  }

  get samples(): number {
    return this.total.samples;
  }

  get durationSeconds(): number {
    return this.total.samples / this.sampleRate;
  }

  /** Sound exposure level (SEL) of the integrated period. */
  get sel(): number {
    const d = this.durationSeconds;
    if (d <= 0) return LEVEL_FLOOR_DB;
    return soundExposureLevel(this.leq, d);
  }

  /** Completed short-Leq segments, in dB. */
  get shortLeqSegments(): readonly number[] {
    return this.segments;
  }

  get totalEnergy(): number {
    return this.total.totalEnergy;
  }
}

/**
 * Sliding-window Leq over the most recent `windowSeconds`, fed at a fixed update
 * rate (used for the "moving Leq" read-out).
 *
 * A ring buffer of mean-square values keeps memory bounded.
 */
export class MovingLeq {
  private readonly buffer: Float64Array;
  private index = 0;
  private filled = 0;
  private sum = 0;

  constructor(readonly capacity: number) {
    this.buffer = new Float64Array(Math.max(1, capacity));
  }

  push(meanSquare: number): void {
    const cap = this.buffer.length;
    if (this.filled === cap) {
      this.sum -= this.buffer[this.index];
    } else {
      this.filled++;
    }
    this.buffer[this.index] = meanSquare;
    this.sum += meanSquare;
    this.index = (this.index + 1) % cap;
  }

  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.filled = 0;
    this.sum = 0;
  }

  get levelDb(): number {
    if (this.filled === 0) return LEVEL_FLOOR_DB;
    return meanSquareToDb(this.sum / this.filled);
  }

  get isFull(): boolean {
    return this.filled === this.buffer.length;
  }
}

/**
 * Combine independently measured Leq segments into an overall Leq.
 * Used when merging a paused/resumed measurement session.
 */
export function combineLeqSegments(
  segments: ReadonlyArray<{ leq: number; durationSeconds: number }>
): { leq: number; durationSeconds: number } {
  let energy = 0;
  let duration = 0;
  for (const s of segments) {
    if (!(s.durationSeconds > 0)) continue;
    energy += Math.pow(10, s.leq / 10) * s.durationSeconds;
    duration += s.durationSeconds;
  }
  if (duration <= 0) return { leq: LEVEL_FLOOR_DB, durationSeconds: 0 };
  return { leq: meanSquareToDb(energy / duration), durationSeconds: duration };
}
