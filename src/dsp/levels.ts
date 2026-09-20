/**
 * Level arithmetic.
 *
 * REFERENCE CONVENTION
 * --------------------
 * Every level produced by the DSP layer is expressed in **dBFS**:
 *
 *     L_dBFS = 20 * log10( rms(x) )
 *
 * where `x` is the normalised float sample stream (nominal range -1 .. +1).
 * With this definition a square wave at digital full scale reads 0 dBFS and a
 * full-scale sine reads -3.01 dBFS. The convention is stated explicitly because
 * the calibration offset that converts dBFS to dB SPL is only meaningful
 * together with it.
 *
 * Conversion to SPL happens exactly once, in the calibration layer:
 *
 *     L_SPL = slope * L_dBFS + intercept        (slope == 1 for a pure offset)
 *
 * Because that transform is affine with slope 1 in the normal case, it may be
 * applied after energy averaging without error. For slope != 1 the calibration
 * layer documents the (small) approximation involved.
 */

/** Levels below this are reported as this value instead of -Infinity. */
export const LEVEL_FLOOR_DB = -200;

/** Convert a mean-square value to a level in dB. */
export function meanSquareToDb(meanSquare: number): number {
  if (!(meanSquare > 0)) return LEVEL_FLOOR_DB;
  const db = 10 * Math.log10(meanSquare);
  return db < LEVEL_FLOOR_DB ? LEVEL_FLOOR_DB : db;
}

/** Convert an amplitude / RMS ratio to a level in dB. */
export function amplitudeToDb(amplitude: number): number {
  const a = Math.abs(amplitude);
  if (!(a > 0)) return LEVEL_FLOOR_DB;
  const db = 20 * Math.log10(a);
  return db < LEVEL_FLOOR_DB ? LEVEL_FLOOR_DB : db;
}

/** Inverse of {@link amplitudeToDb}. */
export const dbToAmplitude = (db: number): number => Math.pow(10, db / 20);

/** Inverse of {@link meanSquareToDb}. */
export const dbToMeanSquare = (db: number): number => Math.pow(10, db / 10);

/**
 * Energy (power) summation of levels — the only correct way to combine dB
 * values. Used for octave -> broadband summation and for combining partial Leq
 * segments.
 */
export function sumLevelsDb(levels: readonly number[]): number {
  let acc = 0;
  for (const l of levels) {
    if (l <= LEVEL_FLOOR_DB) continue;
    acc += dbToMeanSquare(l);
  }
  return meanSquareToDb(acc);
}

/**
 * Energy average (Leq) of a set of equally weighted levels.
 *
 * This is deliberately NOT an arithmetic mean of decibels.
 */
export function energyAverageDb(levels: readonly number[]): number {
  if (levels.length === 0) return LEVEL_FLOOR_DB;
  let acc = 0;
  let n = 0;
  for (const l of levels) {
    acc += dbToMeanSquare(l);
    n++;
  }
  return meanSquareToDb(acc / n);
}

/**
 * Energy average of levels with individual durations (seconds).
 */
export function energyAverageDbWeighted(
  levels: readonly number[],
  durations: readonly number[]
): number {
  let acc = 0;
  let total = 0;
  for (let i = 0; i < levels.length; i++) {
    const d = durations[i] ?? 0;
    if (d <= 0) continue;
    acc += dbToMeanSquare(levels[i]) * d;
    total += d;
  }
  if (total <= 0) return LEVEL_FLOOR_DB;
  return meanSquareToDb(acc / total);
}

/**
 * Sound exposure level (SEL / LAE): the level that, applied for one second,
 * carries the same energy as `leq` applied for `durationSeconds`.
 */
export function soundExposureLevel(leq: number, durationSeconds: number): number {
  if (!(durationSeconds > 0)) return LEVEL_FLOOR_DB;
  return leq + 10 * Math.log10(durationSeconds);
}

/**
 * Normalised 8-hour exposure level LEX,8h from a partial measurement.
 */
export function normalisedExposureLevel8h(leq: number, durationSeconds: number): number {
  if (!(durationSeconds > 0)) return LEVEL_FLOOR_DB;
  return leq + 10 * Math.log10(durationSeconds / (8 * 3600));
}

/** Root mean square of a block. */
export function rms(block: Float32Array | Float64Array | readonly number[]): number {
  const n = block.length;
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const v = block[i];
    acc += v * v;
  }
  return Math.sqrt(acc / n);
}

/** Level of a block in dBFS. */
export function blockLevelDb(block: Float32Array | Float64Array | readonly number[]): number {
  return amplitudeToDb(rms(block));
}

/** Peak absolute amplitude of a block. */
export function peakAbs(block: Float32Array | Float64Array | readonly number[]): number {
  let peak = 0;
  for (let i = 0; i < block.length; i++) {
    const a = Math.abs(block[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Peak level of a block in dBFS. */
export function blockPeakDb(block: Float32Array | Float64Array | readonly number[]): number {
  return amplitudeToDb(peakAbs(block));
}

/**
 * Running energy accumulator used for Leq.
 *
 * Accumulates the mean square of the (weighted) signal over an arbitrary number
 * of samples with no unbounded memory growth.
 */
export class EnergyAccumulator {
  private sum = 0;
  private count = 0;

  addSquared(squared: number): void {
    this.sum += squared;
    this.count++;
  }

  addBlockEnergy(sumOfSquares: number, sampleCount: number): void {
    this.sum += sumOfSquares;
    this.count += sampleCount;
  }

  reset(): void {
    this.sum = 0;
    this.count = 0;
  }

  get samples(): number {
    return this.count;
  }

  get meanSquare(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  /** Equivalent continuous level in dB. */
  get levelDb(): number {
    return this.count > 0 ? meanSquareToDb(this.sum / this.count) : LEVEL_FLOOR_DB;
  }

  /** Total energy (sum of squares) — useful for SEL and for merging segments. */
  get totalEnergy(): number {
    return this.sum;
  }
}
