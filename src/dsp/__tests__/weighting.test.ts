import { describe, expect, it } from 'vitest';
import { BiquadCascade } from '../biquad';
import { blockLevelDb } from '../levels';
import { sine } from '../signals';
import {
  aWeightingDesign,
  cWeightingDesign,
  designAWeighting,
  designCWeighting,
  designWeighting,
  weightingAccurateUpToHz,
  weightingResponseDb,
} from '../weighting/design';
import {
  A_NORMALISATION_DB,
  C_NORMALISATION_DB,
  NOMINAL_WEIGHTINGS,
  aWeightingDb,
  cWeightingDb,
  zWeightingDb,
} from '../weighting/reference';

const SAMPLE_RATES = [44100, 48000] as const;

/** The frequencies the masterplan requires to be validated. */
const VALIDATION_FREQUENCIES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

/**
 * Tolerances for the realised digital filter against the exact analog prototype.
 *
 * These are the numbers the implementation actually achieves, not aspirational
 * values. The 16 kHz entry is deliberately loose: it lies above the fit range
 * (see weightingAccurateUpToHz) where the bilinear transform cannot follow the
 * analog prototype at a 44.1/48 kHz sample rate. The application flags that
 * region as reduced accuracy rather than claiming it is exact.
 */
const DIGITAL_VS_ANALOG_TOLERANCE_DB: Record<number, number> = {
  31.5: 0.05,
  63: 0.05,
  125: 0.05,
  250: 0.05,
  500: 0.05,
  1000: 0.001,
  2000: 0.1,
  4000: 0.35,
  8000: 0.7,
  16000: 5.0,
};

/** Worst-case fit error the minimax design actually achieves, per sample rate. */
const MAX_FIT_ERROR_DB = 0.7;

describe('analytic weighting reference', () => {
  it('normalises A and C to 0 dB at 1 kHz', () => {
    expect(aWeightingDb(1000)).toBeCloseTo(0, 12);
    expect(cWeightingDb(1000)).toBeCloseTo(0, 12);
    expect(zWeightingDb(1000)).toBe(0);
  });

  it('reproduces the published 1 kHz normalisation gains', () => {
    // IEC 61672-1 gives A1000 ~ 2.0 dB and C1000 ~ 0.06 dB.
    expect(A_NORMALISATION_DB).toBeCloseTo(2.0, 1);
    expect(C_NORMALISATION_DB).toBeCloseTo(0.06, 2);
  });

  it('matches the nominal IEC 61672-1 table within rounding', () => {
    for (const { frequency, a, c } of NOMINAL_WEIGHTINGS) {
      expect(aWeightingDb(frequency)).toBeCloseTo(a, 0);
      expect(Math.abs(aWeightingDb(frequency) - a)).toBeLessThan(0.15);
      expect(Math.abs(cWeightingDb(frequency) - c)).toBeLessThan(0.15);
    }
  });

  it('is monotonic where the weighting curves are monotonic', () => {
    // A weighting rises from 10 Hz to its ~2.5 kHz peak.
    let prev = -Infinity;
    for (let f = 10; f <= 2000; f *= 1.1) {
      const v = aWeightingDb(f);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('A weighting is flat-referenced against C at 1 kHz and lower below it', () => {
    for (const f of [31.5, 63, 125, 250, 500]) {
      expect(aWeightingDb(f)).toBeLessThan(cWeightingDb(f));
    }
  });
});

describe.each(SAMPLE_RATES)('digital weighting design at %i Hz', (fs) => {
  it('produces the expected section counts', () => {
    expect(designAWeighting(fs)).toHaveLength(3);
    expect(designCWeighting(fs)).toHaveLength(2);
    expect(designWeighting('Z', fs)).toHaveLength(0);
  });

  it('is exactly 0 dB at 1 kHz', () => {
    expect(weightingResponseDb('A', 1000, fs)).toBeCloseTo(0, 9);
    expect(weightingResponseDb('C', 1000, fs)).toBeCloseTo(0, 9);
    expect(weightingResponseDb('Z', 1000, fs)).toBe(0);
  });

  it('Z weighting is flat at every frequency', () => {
    for (const f of [10, 100, 1000, 10000, 20000]) {
      if (f >= fs / 2) continue;
      expect(weightingResponseDb('Z', f, fs)).toBe(0);
    }
  });

  it.each(VALIDATION_FREQUENCIES)(
    'A weighting at %p Hz matches the analog prototype',
    (frequency) => {
      if (frequency >= fs / 2) return;
      const digital = weightingResponseDb('A', frequency, fs);
      const analog = aWeightingDb(frequency);
      expect(Math.abs(digital - analog)).toBeLessThanOrEqual(
        DIGITAL_VS_ANALOG_TOLERANCE_DB[frequency]
      );
    }
  );

  it.each(VALIDATION_FREQUENCIES)(
    'C weighting at %p Hz matches the analog prototype',
    (frequency) => {
      if (frequency >= fs / 2) return;
      const digital = weightingResponseDb('C', frequency, fs);
      const analog = cWeightingDb(frequency);
      expect(Math.abs(digital - analog)).toBeLessThanOrEqual(
        DIGITAL_VS_ANALOG_TOLERANCE_DB[frequency]
      );
    }
  );

  it('keeps the worst-case fit error inside the fit range small', () => {
    const a = aWeightingDesign(fs);
    const c = cWeightingDesign(fs);
    expect(a.maxFitErrorDb).toBeLessThan(MAX_FIT_ERROR_DB);
    expect(c.maxFitErrorDb).toBeLessThan(MAX_FIT_ERROR_DB);
    // The fit must genuinely cover the 12.5 kHz band, whose exact centre is
    // 12589 Hz, so the reported accurate range is not an overstatement.
    expect(a.fitRange.highHz).toBeGreaterThanOrEqual(12589);
    expect(weightingAccurateUpToHz(fs)).toBe(a.fitRange.highHz);
  });

  it('beats the plain bilinear transform at high frequency', () => {
    const optimised = aWeightingDesign(fs, 'minimax');
    const plain = aWeightingDesign(fs, 'none');
    expect(optimised.maxFitErrorDb).toBeLessThan(plain.maxFitErrorDb);
    // The improvement should be substantial, not marginal.
    expect(plain.maxFitErrorDb / optimised.maxFitErrorDb).toBeGreaterThan(3);
  });

  it('places the HF pole above the analog pole frequency', () => {
    const a = aWeightingDesign(fs);
    expect(a.hfPoleHz).toBeGreaterThan(12194);
    expect(a.hfPoleHz).toBeLessThan(fs / 2);
  });
});

/**
 * The response tests above verify the coefficients. These tests verify that
 * filtering an actual signal produces the expected level change, i.e. that the
 * weighting really operates on the sample stream.
 */
describe.each(SAMPLE_RATES)('weighting applied to real signals at %i Hz', (fs) => {
  const runFilter = (signal: Float32Array, sections: ReturnType<typeof designAWeighting>) => {
    const cascade = new BiquadCascade(sections);
    const out = new Float64Array(signal.length);
    cascade.processBlock(signal, out);
    // Discard the first 0.5 s so the filter start-up transient is excluded.
    const skip = Math.round(fs * 0.5);
    return blockLevelDb(out.subarray(skip));
  };

  it('leaves a 1 kHz sine unchanged under A weighting (0 dB correction)', () => {
    const x = sine(1000, 0.1, 3, fs);
    const before = blockLevelDb(x);
    const after = runFilter(x, designAWeighting(fs));
    expect(after - before).toBeCloseTo(0, 2);
  });

  it('attenuates a 100 Hz sine by the expected A weighting', () => {
    const x = sine(100, 0.1, 4, fs);
    const before = blockLevelDb(x);
    const after = runFilter(x, designAWeighting(fs));
    expect(after - before).toBeCloseTo(aWeightingDb(100), 1);
  });

  it('attenuates a 31.5 Hz sine by the expected A weighting', () => {
    const x = sine(31.5, 0.2, 8, fs);
    const before = blockLevelDb(x);
    const after = runFilter(x, designAWeighting(fs));
    expect(Math.abs(after - before - aWeightingDb(31.5))).toBeLessThan(0.2);
  });

  it.each([63, 125, 250, 500, 2000, 4000, 8000])(
    'A weighting of a %p Hz sine matches the analytic value',
    (frequency) => {
      const x = sine(frequency, 0.05, 3, fs);
      const before = blockLevelDb(x);
      const after = runFilter(x, designAWeighting(fs));
      const expected = aWeightingDb(frequency);
      expect(Math.abs(after - before - expected)).toBeLessThan(MAX_FIT_ERROR_DB + 0.05);
    }
  );

  it.each([63, 250, 1000, 4000, 8000])(
    'C weighting of a %p Hz sine matches the analytic value',
    (frequency) => {
      const x = sine(frequency, 0.05, 3, fs);
      const before = blockLevelDb(x);
      const after = runFilter(x, designCWeighting(fs));
      const expected = cWeightingDb(frequency);
      expect(Math.abs(after - before - expected)).toBeLessThan(MAX_FIT_ERROR_DB + 0.05);
    }
  );

  it('is a real filter, not a display offset: A and C differ on the same signal', () => {
    const x = sine(63, 0.1, 4, fs);
    const a = runFilter(x, designAWeighting(fs));
    const c = runFilter(x, designCWeighting(fs));
    // At 63 Hz A is ~26 dB down and C only ~0.8 dB down.
    expect(c - a).toBeCloseTo(cWeightingDb(63) - aWeightingDb(63), 0);
    expect(c - a).toBeGreaterThan(20);
  });

  it('is stable: no growth over a long run', () => {
    const x = sine(50, 0.3, 20, fs);
    const cascade = new BiquadCascade(designAWeighting(fs));
    let peak = 0;
    for (let i = 0; i < x.length; i++) {
      const y = cascade.process(x[i]);
      if (!Number.isFinite(y)) throw new Error('filter produced a non-finite sample');
      const a = Math.abs(y);
      if (a > peak) peak = a;
    }
    expect(peak).toBeLessThan(1);
  });
});
