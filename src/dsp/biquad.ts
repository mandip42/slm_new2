/**
 * Biquad (second order IIR) primitives.
 *
 * All coefficients are stored with a0 normalised to 1 and the recursion is
 * evaluated in Direct Form I:
 *
 *   y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
 *
 * Direct Form I is used because it keeps the (potentially very large) internal
 * states of the low-frequency weighting sections in separate x/y histories,
 * which behaves better in double precision than the transposed form for the
 * highly resonant sections used by the 1/3-octave filter bank.
 */

import { type Complex, cAbs, cAdd, cDiv, cExpI, cMul, cScale, complex } from './complex';

export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** Identity section: y[n] = x[n]. */
export const IDENTITY_BIQUAD: BiquadCoefficients = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

/**
 * Bilinear transform of one analog second-order section.
 *
 * Analog section (in `s`):   (bs2*s^2 + bs1*s + bs0) / (as2*s^2 + as1*s + as0)
 * Substituting s = K*(1 - z^-1)/(1 + z^-1) with K = 2*fs yields the digital
 * coefficients below.
 *
 * No frequency pre-warping is applied here; callers that need a specific
 * critical frequency to land exactly (the octave filter bank) pre-warp their
 * edge frequencies before calling.
 */
export function bilinearSection(
  analogNum: readonly [number, number, number],
  analogDen: readonly [number, number, number],
  sampleRate: number
): BiquadCoefficients {
  const K = 2 * sampleRate;
  const K2 = K * K;
  const [bs2, bs1, bs0] = analogNum;
  const [as2, as1, as0] = analogDen;

  const B0 = bs2 * K2 + bs1 * K + bs0;
  const B1 = 2 * bs0 - 2 * bs2 * K2;
  const B2 = bs2 * K2 - bs1 * K + bs0;

  const A0 = as2 * K2 + as1 * K + as0;
  const A1 = 2 * as0 - 2 * as2 * K2;
  const A2 = as2 * K2 - as1 * K + as0;

  return {
    b0: B0 / A0,
    b1: B1 / A0,
    b2: B2 / A0,
    a1: A1 / A0,
    a2: A2 / A0,
  };
}

/**
 * Build a biquad from a conjugate pair of z-plane poles and a conjugate pair of
 * z-plane zeros. Used by the Butterworth band-pass designer.
 */
export function biquadFromPoleZeroPair(zero: Complex, pole: Complex, gain = 1): BiquadCoefficients {
  // (1 - z0 z^-1)(1 - conj(z0) z^-1) = 1 - 2 Re(z0) z^-1 + |z0|^2 z^-2
  const b1 = -2 * zero.re;
  const b2 = zero.re * zero.re + zero.im * zero.im;
  const a1 = -2 * pole.re;
  const a2 = pole.re * pole.re + pole.im * pole.im;
  return { b0: gain, b1: gain * b1, b2: gain * b2, a1, a2 };
}

/** Complex frequency response of a single section at normalised angular freq w. */
export function sectionResponse(c: BiquadCoefficients, w: number): Complex {
  const z1 = cExpI(-w);
  const z2 = cExpI(-2 * w);
  const num = cAdd(cAdd(complex(c.b0), cScale(z1, c.b1)), cScale(z2, c.b2));
  const den = cAdd(cAdd(complex(1), cScale(z1, c.a1)), cScale(z2, c.a2));
  return cDiv(num, den);
}

/** Complex frequency response of a cascade at frequency `freq` Hz. */
export function cascadeResponse(
  sections: readonly BiquadCoefficients[],
  freq: number,
  sampleRate: number
): Complex {
  const w = (2 * Math.PI * freq) / sampleRate;
  let h = complex(1);
  for (const s of sections) h = cMul(h, sectionResponse(s, w));
  return h;
}

/** Magnitude response in dB of a cascade at frequency `freq` Hz. */
export function cascadeMagnitudeDb(
  sections: readonly BiquadCoefficients[],
  freq: number,
  sampleRate: number
): number {
  const mag = cAbs(cascadeResponse(sections, freq, sampleRate));
  return 20 * Math.log10(Math.max(mag, Number.MIN_VALUE));
}

/** Return a copy of `sections` scaled so |H(freq)| == 1 exactly. */
export function normaliseCascadeAt(
  sections: readonly BiquadCoefficients[],
  freq: number,
  sampleRate: number
): BiquadCoefficients[] {
  const mag = cAbs(cascadeResponse(sections, freq, sampleRate));
  if (!Number.isFinite(mag) || mag === 0) return sections.map((s) => ({ ...s }));
  const k = 1 / mag;
  return sections.map((s, i) =>
    i === 0 ? { ...s, b0: s.b0 * k, b1: s.b1 * k, b2: s.b2 * k } : { ...s }
  );
}

/**
 * A cascade of biquad sections with persistent state.
 *
 * `process` is allocation-free and is safe to call from the audio thread.
 */
export class BiquadCascade {
  private readonly b0: Float64Array;
  private readonly b1: Float64Array;
  private readonly b2: Float64Array;
  private readonly a1: Float64Array;
  private readonly a2: Float64Array;
  private readonly x1: Float64Array;
  private readonly x2: Float64Array;
  private readonly y1: Float64Array;
  private readonly y2: Float64Array;
  readonly length: number;

  constructor(sections: readonly BiquadCoefficients[]) {
    const n = sections.length;
    this.length = n;
    this.b0 = new Float64Array(n);
    this.b1 = new Float64Array(n);
    this.b2 = new Float64Array(n);
    this.a1 = new Float64Array(n);
    this.a2 = new Float64Array(n);
    this.x1 = new Float64Array(n);
    this.x2 = new Float64Array(n);
    this.y1 = new Float64Array(n);
    this.y2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = sections[i];
      this.b0[i] = s.b0;
      this.b1[i] = s.b1;
      this.b2[i] = s.b2;
      this.a1[i] = s.a1;
      this.a2[i] = s.a2;
    }
  }

  reset(): void {
    this.x1.fill(0);
    this.x2.fill(0);
    this.y1.fill(0);
    this.y2.fill(0);
  }

  /** Process a single sample through the whole cascade. */
  process(sample: number): number {
    let v = sample;
    for (let i = 0; i < this.length; i++) {
      const x = v;
      const y =
        this.b0[i] * x +
        this.b1[i] * this.x1[i] +
        this.b2[i] * this.x2[i] -
        this.a1[i] * this.y1[i] -
        this.a2[i] * this.y2[i];
      this.x2[i] = this.x1[i];
      this.x1[i] = x;
      this.y2[i] = this.y1[i];
      this.y1[i] = y;
      v = y;
    }
    return v;
  }

  /**
   * Filter `input` into `output` (may be the same array). Returns `output`.
   */
  processBlock(
    input: Float32Array | Float64Array,
    output: Float32Array | Float64Array = input
  ): Float32Array | Float64Array {
    const n = input.length;
    for (let i = 0; i < n; i++) output[i] = this.process(input[i]);
    return output;
  }

  /**
   * Filter `input` and return the sum of squares of the filtered signal without
   * writing an output array. Used by the filter bank where only band energy is
   * needed.
   */
  processBlockEnergy(input: Float32Array | Float64Array): number {
    let sum = 0;
    const n = input.length;
    for (let i = 0; i < n; i++) {
      const y = this.process(input[i]);
      sum += y * y;
    }
    return sum;
  }
}
