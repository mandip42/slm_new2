import { describe, expect, it } from 'vitest';
import {
  LevelHistogram,
  PERCENTILE_LEVELS,
  describeErrors,
  exactExceedanceLevel,
  exactPercentile,
} from '../statistics';
import { createRng } from '../signals';

describe('exact percentile helper', () => {
  it('returns the bounds at 0 and 100', () => {
    const v = [10, 20, 30, 40, 50];
    expect(exactPercentile(v, 0)).toBe(10);
    expect(exactPercentile(v, 100)).toBe(50);
  });

  it('interpolates the median', () => {
    expect(exactPercentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 9);
    expect(exactPercentile([1, 2, 3], 50)).toBeCloseTo(2, 9);
  });

  it('defines Ln as the level exceeded n percent of the time', () => {
    // 100 values 1..100. L10 is exceeded 10 % of the time -> ~90.1
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(exactExceedanceLevel(v, 10)).toBeCloseTo(90.1, 1);
    expect(exactExceedanceLevel(v, 50)).toBeCloseTo(50.5, 1);
    expect(exactExceedanceLevel(v, 90)).toBeCloseTo(10.9, 1);
    // L90 (background) must be below L10 (peaks).
    expect(exactExceedanceLevel(v, 90)).toBeLessThan(exactExceedanceLevel(v, 10));
  });
});

describe('LevelHistogram', () => {
  it('counts samples and reports the observed range', () => {
    const h = new LevelHistogram();
    for (const v of [-40, -30, -20]) h.add(v);
    expect(h.sampleCount).toBe(3);
    expect(h.observedRange).toEqual({ min: -40, max: -20 });
  });

  it('ignores non-finite values', () => {
    const h = new LevelHistogram();
    h.add(NaN);
    h.add(Infinity);
    h.add(-Infinity);
    expect(h.sampleCount).toBe(0);
  });

  it('matches the exact percentile within one bin width', () => {
    const rng = createRng(4242);
    const values: number[] = [];
    const h = new LevelHistogram({ binWidth: 0.1 });
    for (let i = 0; i < 20000; i++) {
      // A bimodal distribution, which is where naive percentile code breaks.
      const v = rng() < 0.7 ? -60 + rng() * 8 : -35 + rng() * 5;
      values.push(v);
      h.add(v);
    }
    for (const n of PERCENTILE_LEVELS) {
      const fromHistogram = h.exceedanceLevel(n);
      const exact = exactExceedanceLevel(values, n);
      expect(Math.abs(fromHistogram - exact)).toBeLessThan(0.15);
    }
  });

  it('is exact for a uniform distribution', () => {
    const h = new LevelHistogram({ binWidth: 0.1 });
    // 1001 values from 0 to 100 in steps of 0.1
    for (let i = 0; i <= 1000; i++) h.add(i / 10);
    expect(h.percentile(50)).toBeCloseTo(50, 0);
    expect(h.exceedanceLevel(10)).toBeCloseTo(90, 0);
    expect(h.exceedanceLevel(90)).toBeCloseTo(10, 0);
  });

  it('orders the standard exceedance set correctly', () => {
    const rng = createRng(77);
    const h = new LevelHistogram();
    for (let i = 0; i < 5000; i++) h.add(-50 + rng() * 30);
    const p = h.percentiles();
    expect(p.L1).toBeGreaterThan(p.L5);
    expect(p.L5).toBeGreaterThan(p.L10);
    expect(p.L10).toBeGreaterThan(p.L50);
    expect(p.L50).toBeGreaterThan(p.L90);
    expect(p.L90).toBeGreaterThan(p.L95);
    expect(p.L95).toBeGreaterThan(p.L99);
  });

  it('returns NaN percentiles when empty', () => {
    const h = new LevelHistogram();
    expect(Number.isNaN(h.percentile(50))).toBe(true);
    expect(h.observedRange).toBeNull();
  });

  it('shifts every percentile by a constant calibration offset', () => {
    // This is the property that lets the histogram live in the dBFS domain.
    const rng = createRng(31);
    const raw = new LevelHistogram();
    const shifted = new LevelHistogram();
    const offset = 94.3;
    for (let i = 0; i < 4000; i++) {
      const v = -70 + rng() * 40;
      raw.add(v);
      shifted.add(v + offset);
    }
    for (const n of PERCENTILE_LEVELS) {
      expect(shifted.exceedanceLevel(n) - raw.exceedanceLevel(n)).toBeCloseTo(offset, 1);
    }
  });

  it('produces a display distribution over the occupied range only', () => {
    const h = new LevelHistogram();
    for (let i = 0; i < 100; i++) h.add(-40 + (i % 10) * 0.5);
    const d = h.displayDistribution(1);
    expect(d.total).toBe(100);
    expect(d.counts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(d.centres.length).toBeGreaterThan(1);
    expect(d.centres.length).toBeLessThan(20);
  });

  it('applies an offset to the display distribution centres', () => {
    const h = new LevelHistogram();
    for (let i = 0; i < 50; i++) h.add(-40);
    const plain = h.displayDistribution(1, 0);
    const offset = h.displayDistribution(1, 94);
    expect(offset.centres[0] - plain.centres[0]).toBeCloseTo(94, 6);
  });

  it('round-trips through JSON preserving percentiles', () => {
    const rng = createRng(9);
    const h = new LevelHistogram();
    for (let i = 0; i < 3000; i++) h.add(-55 + rng() * 20);
    const restored = LevelHistogram.fromJSON(h.toJSON());
    expect(restored.sampleCount).toBe(h.sampleCount);
    for (const n of PERCENTILE_LEVELS) {
      expect(restored.exceedanceLevel(n)).toBeCloseTo(h.exceedanceLevel(n), 6);
    }
  });

  it('serialises an empty histogram safely', () => {
    const h = new LevelHistogram();
    const restored = LevelHistogram.fromJSON(h.toJSON());
    expect(restored.sampleCount).toBe(0);
  });

  it('clamps out-of-range values into the end bins', () => {
    const h = new LevelHistogram({ minDb: -100, maxDb: 100, binWidth: 1 });
    h.add(-500);
    h.add(500);
    expect(h.sampleCount).toBe(2);
    expect(h.percentile(50)).toBeGreaterThan(-101);
  });
});

describe('describeErrors', () => {
  it('computes mean, sd, RMSE and max absolute error', () => {
    const errors = [1, -1, 2, -2];
    const s = describeErrors(errors);
    expect(s.n).toBe(4);
    expect(s.mean).toBeCloseTo(0, 12);
    expect(s.rmse).toBeCloseTo(Math.sqrt((1 + 1 + 4 + 4) / 4), 9);
    expect(s.maxAbs).toBe(2);
    expect(s.min).toBe(-2);
    expect(s.max).toBe(2);
    // Sample standard deviation with n-1
    expect(s.standardDeviation).toBeCloseTo(Math.sqrt(10 / 3), 9);
  });

  it('separates bias from scatter', () => {
    const s = describeErrors([5, 5, 5, 5]);
    expect(s.mean).toBeCloseTo(5, 9);
    expect(s.standardDeviation).toBeCloseTo(0, 9);
    expect(s.rmse).toBeCloseTo(5, 9);
  });

  it('withholds the 95 percent interval below three observations', () => {
    expect(describeErrors([1]).interval95).toBeNull();
    expect(describeErrors([1, 2]).interval95).toBeNull();
    expect(describeErrors([1, 2, 3]).interval95).not.toBeNull();
  });

  it('handles an empty set without throwing', () => {
    const s = describeErrors([]);
    expect(s.n).toBe(0);
    expect(Number.isNaN(s.mean)).toBe(true);
    expect(s.interval95).toBeNull();
  });
});
