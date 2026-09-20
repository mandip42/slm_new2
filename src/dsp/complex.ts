/**
 * Minimal complex-number helpers used by the filter design code.
 *
 * Kept as plain objects (not classes) so that the design routines stay easy to
 * unit test and produce no surprises when bundled into an AudioWorklet.
 */

export interface Complex {
  re: number;
  im: number;
}

export const complex = (re: number, im = 0): Complex => ({ re, im });

export const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });

export const cSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });

export const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const cScale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });

export function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / d,
    im: (a.im * b.re - a.re * b.im) / d,
  };
}

export const cAbs = (a: Complex): number => Math.hypot(a.re, a.im);

export const cConj = (a: Complex): Complex => ({ re: a.re, im: -a.im });

/** Principal square root of a complex number. */
export function cSqrt(a: Complex): Complex {
  if (a.im === 0) {
    if (a.re >= 0) return { re: Math.sqrt(a.re), im: 0 };
    return { re: 0, im: Math.sqrt(-a.re) };
  }
  const r = cAbs(a);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sign(a.im) * Math.sqrt((r - a.re) / 2);
  return { re, im };
}

/** e^(i*theta) */
export const cExpI = (theta: number): Complex => ({ re: Math.cos(theta), im: Math.sin(theta) });
