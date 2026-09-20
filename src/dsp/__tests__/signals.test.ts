import { describe, expect, it } from 'vitest';
import { dominantFrequency } from '../fft';
import { blockLevelDb, blockPeakDb, dbToAmplitude, peakAbs, rms } from '../levels';
import {
  SIGNAL_TYPES,
  burst,
  createRng,
  generateSignal,
  impulse,
  logSweep,
  multitone,
  normaliseRms,
  pinkNoise,
  sine,
  silence,
  square,
  whiteNoise,
} from '../signals';

const FS = 48000;

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('produces different streams for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a() === b()) same++;
    expect(same).toBeLessThan(5);
  });

  it('stays inside [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 10000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('has a mean near 0.5', () => {
    const rng = createRng(99);
    let sum = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) sum += rng();
    expect(sum / n).toBeCloseTo(0.5, 2);
  });
});

describe('sine', () => {
  it('has the requested RMS amplitude', () => {
    for (const target of [1, 0.5, 0.01, 0.0001]) {
      expect(rms(sine(1000, target, 1, FS))).toBeCloseTo(target, 6);
    }
  });

  it('has a peak sqrt(2) above its RMS', () => {
    const x = sine(1000, 0.25, 1, FS);
    expect(peakAbs(x)).toBeCloseTo(0.25 * Math.SQRT2, 3);
    expect(blockPeakDb(x) - blockLevelDb(x)).toBeCloseTo(3.0103, 2);
  });

  it('has the requested frequency', () => {
    for (const f of [100, 1000, 5000]) {
      expect(Math.abs(dominantFrequency(sine(f, 0.2, 1, FS), FS) - f)).toBeLessThan(5);
    }
  });

  it('respects the length requested', () => {
    expect(sine(1000, 0.1, 0.5, FS)).toHaveLength(FS / 2);
  });
});

describe('square', () => {
  it('has RMS equal to its peak', () => {
    const x = square(1000, 0.5, 1, FS);
    expect(rms(x)).toBeCloseTo(0.5, 6);
    expect(peakAbs(x)).toBeCloseTo(0.5, 6);
    expect(blockPeakDb(x) - blockLevelDb(x)).toBeCloseTo(0, 3);
  });
});

describe('noise generators', () => {
  it('white noise has the requested RMS', () => {
    for (const target of [0.5, 0.1, 0.001]) {
      expect(rms(whiteNoise(target, 1, FS, 5))).toBeCloseTo(target, 9);
    }
  });

  it('pink noise has the requested RMS', () => {
    expect(rms(pinkNoise(0.2, 1, FS, 5))).toBeCloseTo(0.2, 9);
  });

  it('is reproducible for a fixed seed', () => {
    const a = whiteNoise(0.1, 0.1, FS, 1234);
    const b = whiteNoise(0.1, 0.1, FS, 1234);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
  });

  it('white noise has a near-zero mean', () => {
    const x = whiteNoise(0.1, 2, FS, 8);
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i];
    expect(Math.abs(sum / x.length)).toBeLessThan(0.002);
  });

  it('pink noise has more low frequency energy than white noise', () => {
    const pink = pinkNoise(0.1, 2, FS, 3);
    const white = whiteNoise(0.1, 2, FS, 3);
    // Compare energy below 200 Hz by simple first-order integration.
    const lowEnergy = (x: Float32Array) => {
      let y = 0;
      let acc = 0;
      const a = Math.exp((-2 * Math.PI * 200) / FS);
      for (let i = 0; i < x.length; i++) {
        y = a * y + (1 - a) * x[i];
        acc += y * y;
      }
      return acc / x.length;
    };
    expect(lowEnergy(pink)).toBeGreaterThan(lowEnergy(white) * 2);
  });
});

describe('multitone', () => {
  it('has the requested total RMS', () => {
    const x = multitone([125, 500, 1000, 4000], 0.2, 1, FS);
    expect(rms(x)).toBeCloseTo(0.2, 2);
  });

  it('returns silence for an empty frequency list', () => {
    expect(peakAbs(multitone([], 0.2, 0.1, FS))).toBe(0);
  });
});

describe('impulse', () => {
  it('places a single non-zero sample at the requested time', () => {
    const x = impulse(0.8, 1, FS, 0.25);
    expect(x[Math.round(0.25 * FS)]).toBeCloseTo(0.8, 6);
    let nonZero = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== 0) nonZero++;
    expect(nonZero).toBe(1);
  });

  it('clamps a position beyond the end of the buffer', () => {
    const x = impulse(1, 0.1, FS, 10);
    expect(x[x.length - 1]).toBe(1);
  });
});

describe('logSweep', () => {
  it('starts near the start frequency and ends near the end frequency', () => {
    const x = logSweep(100, 8000, 0.2, 4, FS);
    const head = x.subarray(0, 16384);
    const tail = x.subarray(x.length - 16384);
    expect(dominantFrequency(head, FS, 8192)).toBeLessThan(400);
    expect(dominantFrequency(tail, FS, 8192)).toBeGreaterThan(5000);
  });
});

describe('burst', () => {
  it('alternates between signal and silence', () => {
    const x = burst(1000, 0.5, 0.1, 0.1, 1, FS);
    const onSegment = x.subarray(0, Math.round(0.09 * FS));
    const offSegment = x.subarray(Math.round(0.11 * FS), Math.round(0.19 * FS));
    expect(rms(onSegment)).toBeGreaterThan(0.4);
    expect(rms(offSegment)).toBe(0);
  });
});

describe('silence', () => {
  it('is all zeros', () => {
    const x = silence(0.1, FS);
    expect(peakAbs(x)).toBe(0);
    expect(x).toHaveLength(Math.round(0.1 * FS));
  });
});

describe('normaliseRms', () => {
  it('scales a signal to the target RMS', () => {
    const x = sine(1000, 0.9, 0.1, FS);
    normaliseRms(x, 0.05);
    // Float32 storage limits the achievable precision to about 1e-9 here.
    expect(rms(x)).toBeCloseTo(0.05, 8);
  });

  it('leaves an all-zero signal untouched', () => {
    const x = new Float32Array(100);
    normaliseRms(x, 0.5);
    expect(peakAbs(x)).toBe(0);
  });
});

describe('generateSignal', () => {
  it.each(SIGNAL_TYPES)('produces a finite buffer for %s', (type) => {
    const x = generateSignal({
      type,
      frequency: 1000,
      amplitude: dbToAmplitude(-20),
      durationSeconds: 0.5,
      sampleRate: FS,
    });
    expect(x.length).toBe(Math.round(0.5 * FS));
    for (let i = 0; i < x.length; i += 97) {
      expect(Number.isFinite(x[i])).toBe(true);
    }
  });

  it('honours the requested amplitude for continuous types', () => {
    for (const type of ['sine', 'white-noise', 'pink-noise', 'square'] as const) {
      const x = generateSignal({
        type,
        frequency: 1000,
        amplitude: dbToAmplitude(-20),
        durationSeconds: 1,
        sampleRate: FS,
      });
      expect(blockLevelDb(x)).toBeCloseTo(-20, 1);
    }
  });

  it('clamps the sweep end frequency below Nyquist', () => {
    const x = generateSignal({
      type: 'sweep',
      frequency: 100,
      amplitude: 0.2,
      durationSeconds: 1,
      sampleRate: FS,
      sweepEndHz: 100000,
    });
    expect(Number.isFinite(peakAbs(x))).toBe(true);
    expect(peakAbs(x)).toBeLessThanOrEqual(0.2 * Math.SQRT2 + 1e-6);
  });
});
