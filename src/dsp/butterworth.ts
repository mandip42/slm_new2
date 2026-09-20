/**
 * Butterworth band-pass designer used by the fractional-octave filter bank.
 *
 * Design path (the classical analog-prototype route, done exactly rather than
 * approximated):
 *
 *  1. Pre-warp the band edge frequencies so that after the bilinear transform
 *     they land exactly where they were asked for:
 *        w = 2*fs*tan(pi*f/fs)
 *  2. Take the analog Butterworth low-pass prototype poles of order n
 *     (n = bandpass order / 2), unit cut-off:
 *        p_k = exp(i*pi*(2k + n - 1) / (2n)),  k = 1..n
 *  3. Apply the low-pass -> band-pass frequency transformation
 *        s -> (s^2 + w0^2) / (B*s),   w0^2 = wl*wu,  B = wu - wl
 *     Each prototype pole yields two band-pass poles:
 *        s = B*p/2 +- sqrt((B*p/2)^2 - w0^2)
 *  4. Map every pole to the z-plane with the bilinear transform
 *        z = (2*fs + s) / (2*fs - s)
 *     The n zeros at s = 0 map to z = +1 and the n zeros at infinity map to
 *     z = -1, so each second-order section gets the numerator (1 - z^-2).
 *  5. Group the z-plane poles into conjugate pairs, build one biquad per pair
 *     and normalise the cascade to unity gain at the geometric band centre.
 *
 * The result is a genuine order-`order` Butterworth band-pass, which is the
 * filter shape the fractional-octave band definitions in IEC 61260 are based on.
 */

import {
  type BiquadCoefficients,
  biquadFromPoleZeroPair,
  normaliseCascadeAt,
} from './biquad';
import {
  type Complex,
  cAbs,
  cAdd,
  cDiv,
  cExpI,
  cMul,
  cScale,
  cSqrt,
  cSub,
  complex,
} from './complex';

const REAL_EPS = 1e-9;

/** Analog Butterworth low-pass prototype poles (unit cut-off). */
export function butterworthPrototypePoles(order: number): Complex[] {
  const poles: Complex[] = [];
  for (let k = 1; k <= order; k++) {
    poles.push(cExpI((Math.PI * (2 * k + order - 1)) / (2 * order)));
  }
  return poles;
}

/** Bilinear map of a single s-plane pole to the z-plane. */
function bilinearPole(s: Complex, sampleRate: number): Complex {
  const k = 2 * sampleRate;
  return cDiv(cAdd(complex(k), s), cSub(complex(k), s));
}

export interface BandpassDesign {
  sections: BiquadCoefficients[];
  /** Geometric centre frequency the cascade is normalised at. */
  centreHz: number;
  /** True when every pole is strictly inside the unit circle. */
  stable: boolean;
  /** Largest pole radius (diagnostic). */
  maxPoleRadius: number;
}

/**
 * Design a Butterworth band-pass of the given (even) order.
 *
 * @param order      band-pass order; must be even. 6 is used for the 1/3-octave
 *                   bank, which is the order recommended for class-1-shaped
 *                   fractional-octave filters.
 * @param lowHz      lower -3 dB edge
 * @param highHz     upper -3 dB edge
 * @param sampleRate sample rate in Hz
 */
export function designButterworthBandpass(
  order: number,
  lowHz: number,
  highHz: number,
  sampleRate: number
): BandpassDesign {
  if (order % 2 !== 0 || order < 2) {
    throw new RangeError(`Band-pass order must be a positive even number, got ${order}`);
  }
  const nyquist = sampleRate / 2;
  if (!(lowHz > 0) || !(highHz > lowHz)) {
    throw new RangeError(`Invalid band edges: ${lowHz}..${highHz}`);
  }
  if (highHz >= nyquist) {
    throw new RangeError(
      `Upper band edge ${highHz} Hz is at or above Nyquist (${nyquist} Hz) for fs=${sampleRate}`
    );
  }

  const n = order / 2;
  const fs = sampleRate;
  // Pre-warp so the bilinear transform lands the edges exactly.
  const wl = 2 * fs * Math.tan((Math.PI * lowHz) / fs);
  const wu = 2 * fs * Math.tan((Math.PI * highHz) / fs);
  const w0Sq = wl * wu;
  const B = wu - wl;

  const analogPoles: Complex[] = [];
  for (const p of butterworthPrototypePoles(n)) {
    const c = cScale(p, B / 2);
    const disc = cSub(cMul(c, c), complex(w0Sq));
    const r = cSqrt(disc);
    analogPoles.push(cAdd(c, r));
    analogPoles.push(cSub(c, r));
  }

  const digitalPoles = analogPoles.map((s) => bilinearPole(s, fs));

  // Group into conjugate pairs: one section per pole with positive imaginary
  // part, plus pairs of real poles if the band is extremely wide.
  const positive = digitalPoles.filter((p) => p.im > REAL_EPS);
  const real = digitalPoles.filter((p) => Math.abs(p.im) <= REAL_EPS);

  const sections: BiquadCoefficients[] = [];
  for (const pole of positive) {
    // Numerator zeros at z = +1 and z = -1 -> (1 - z^-2).
    sections.push({ b0: 1, b1: 0, b2: -1, a1: -2 * pole.re, a2: pole.re * pole.re + pole.im * pole.im });
  }
  for (let i = 0; i + 1 < real.length; i += 2) {
    const p1 = real[i].re;
    const p2 = real[i + 1].re;
    sections.push({ b0: 1, b1: 0, b2: -1, a1: -(p1 + p2), a2: p1 * p2 });
  }
  if (real.length % 2 === 1) {
    const p = real[real.length - 1].re;
    sections.push({ b0: 1, b1: 0, b2: -1, a1: -p, a2: 0 });
  }

  if (sections.length !== n) {
    throw new Error(
      `Band-pass design produced ${sections.length} sections, expected ${n} (band ${lowHz}..${highHz} Hz at ${sampleRate} Hz)`
    );
  }

  const centreHz = Math.sqrt(lowHz * highHz);
  const normalised = normaliseCascadeAt(sections, centreHz, sampleRate);

  let maxPoleRadius = 0;
  for (const p of digitalPoles) maxPoleRadius = Math.max(maxPoleRadius, cAbs(p));

  return {
    sections: normalised,
    centreHz,
    stable: maxPoleRadius < 1 - 1e-12,
    maxPoleRadius,
  };
}

// Re-exported for the design unit tests.
export { biquadFromPoleZeroPair };
