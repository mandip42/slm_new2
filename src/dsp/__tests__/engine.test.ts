import { describe, expect, it } from 'vitest';
import { MeterEngine, WARM_UP_SECONDS } from '../engine';
import { blockLevelDb, dbToAmplitude } from '../levels';
import { burst, multitone, pinkNoise, sine, silence, square, whiteNoise } from '../signals';
import { aWeightingDb, cWeightingDb } from '../weighting/reference';

const FS = 48000;

/** Feed a signal to the engine in realistic 128-sample render quanta. */
function feed(engine: MeterEngine, signal: Float32Array, blockSize = 128): void {
  for (let i = 0; i < signal.length; i += blockSize) {
    engine.process(signal.subarray(i, Math.min(i + blockSize, signal.length)));
  }
}

/**
 * Extra signal duration to cover the acquisition warm-up.
 *
 * Test signals are generated `WARM` seconds longer than the measurement rather
 * than having a warm-up section spliced onto the front: splicing two separately
 * generated buffers introduces a waveform discontinuity, and a discontinuity is
 * a real broadband impulse that the engine correctly records as a peak.
 */
const WARM = WARM_UP_SECONDS + 0.1;

describe('MeterEngine construction', () => {
  it('rejects an invalid sample rate', () => {
    expect(() => new MeterEngine({ sampleRate: 0 })).toThrow();
    expect(() => new MeterEngine({ sampleRate: 100 })).toThrow();
  });

  it('starts in the warm-up state and leaves it after the warm-up period', () => {
    const engine = new MeterEngine({ sampleRate: FS });
    expect(engine.isWarmingUp).toBe(true);
    feed(engine, sine(1000, 0.1, WARM_UP_SECONDS + 0.05, FS));
    expect(engine.isWarmingUp).toBe(false);
  });

  it('does not integrate anything during warm-up', () => {
    const engine = new MeterEngine({ sampleRate: FS });
    feed(engine, sine(1000, 0.1, WARM_UP_SECONDS * 0.5, FS));
    const s = engine.snapshot();
    expect(s.warmingUp).toBe(true);
    expect(s.integratedSamples).toBe(0);
    expect(s.durationSeconds).toBe(0);
  });
});

describe('MeterEngine broadband levels', () => {
  it('measures the Z-weighted level of a 1 kHz sine correctly', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    const target = -20;
    feed(engine, sine(1000, dbToAmplitude(target), 2 + WARM, FS));
    const s = engine.snapshot();
    expect(s.LZeq).toBeCloseTo(target, 2);
    expect(s.LZF).toBeCloseTo(target, 1);
    expect(s.LZS).toBeCloseTo(target, 1);
  });

  it('applies A weighting to Leq, not just to the displayed number', () => {
    for (const frequency of [63, 125, 250, 500, 1000, 2000, 4000]) {
      const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
      feed(engine, sine(frequency, dbToAmplitude(-20), 2 + WARM, FS));
      const s = engine.snapshot();
      expect(s.LAeq - s.LZeq).toBeCloseTo(aWeightingDb(frequency), 0);
      expect(Math.abs(s.LAeq - s.LZeq - aWeightingDb(frequency))).toBeLessThan(0.5);
    }
  });

  it('applies C weighting correctly', () => {
    for (const frequency of [31.5, 63, 250, 1000, 4000, 8000]) {
      const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
      feed(engine, sine(frequency, dbToAmplitude(-20), 2 + WARM, FS));
      const s = engine.snapshot();
      expect(Math.abs(s.LCeq - s.LZeq - cWeightingDb(frequency))).toBeLessThan(0.6);
    }
  });

  it('gives LAeq == LCeq == LZeq at 1 kHz', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-25), 2 + WARM, FS));
    const s = engine.snapshot();
    expect(s.LAeq).toBeCloseTo(s.LZeq, 1);
    expect(s.LCeq).toBeCloseTo(s.LZeq, 1);
  });

  it('measures the level of broadband noise', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    const x = whiteNoise(dbToAmplitude(-30), 3 + WARM, FS, 1234);
    feed(engine, x);
    const s = engine.snapshot();
    expect(s.LZeq).toBeCloseTo(-30, 1);
  });

  it('is independent of the block size the host delivers', () => {
    const x = pinkNoise(dbToAmplitude(-25), 2 + WARM, FS, 606);
    const results: number[] = [];
    for (const blockSize of [128, 256, 1024, 4096]) {
      const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
      feed(engine, x, blockSize);
      results.push(engine.snapshot().LAeq);
    }
    // The warm-up boundary lands on a block edge, so the integrated sample count
    // varies by at most one block between runs. That is worth a few thousandths
    // of a dB, nothing more.
    for (const r of results) expect(Math.abs(r - results[0])).toBeLessThan(0.02);
  });

  it('works at 44.1 kHz as well as 48 kHz', () => {
    for (const fs of [44100, 48000]) {
      const engine = new MeterEngine({ sampleRate: fs, dcBlock: false });
      feed(engine, sine(1000, dbToAmplitude(-18), 2 + WARM, fs));
      expect(engine.snapshot().LAeq).toBeCloseTo(-18, 1);
    }
  });
});

describe('MeterEngine energy integration', () => {
  it('computes Leq as an energy average, not a decibel average', () => {
    // 1 s at -20 dB then 1 s at -40 dB.
    // Energy average: 10*log10((1e-2 + 1e-4)/2) = -22.6 dB
    // Decibel average would be -30 dB.
    const loud = sine(1000, dbToAmplitude(-20), 1, FS);
    const quiet = sine(1000, dbToAmplitude(-40), 1, FS);
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-20), WARM_UP_SECONDS + 0.1, FS));
    engine.resetStatistics();
    feed(engine, loud);
    feed(engine, quiet);
    const expected = 10 * Math.log10((1e-2 + 1e-4) / 2);
    expect(engine.snapshot().LZeq).toBeCloseTo(expected, 1);
    expect(engine.snapshot().LZeq).toBeGreaterThan(-25);
  });

  it('computes SEL as LAeq + 10log10(duration)', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-20), 4 + WARM, FS));
    const s = engine.snapshot();
    expect(s.LAE).toBeCloseTo(s.LAeq + 10 * Math.log10(s.durationSeconds), 3);
  });

  it('reports duration from the integrated sample count', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, 0.1, WARM_UP_SECONDS, FS));
    engine.resetStatistics();
    feed(engine, sine(1000, 0.1, 3, FS));
    expect(engine.snapshot().durationSeconds).toBeCloseTo(3, 2);
  });

  it('produces 1 s short-Leq segments', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-20), 5 + WARM, FS));
    const segments = engine.shortLeqSegments('Z');
    expect(segments.length).toBeGreaterThanOrEqual(5);
    for (const seg of segments) expect(seg).toBeCloseTo(-20, 0);
  });
});

describe('MeterEngine maxima, minima and peaks', () => {
  it('records the peak of a full-scale square wave at 0 dBFS', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, square(1000, 1, 1 + WARM, FS));
    const s = engine.snapshot();
    expect(s.LZpeak).toBeCloseTo(0, 2);
    expect(s.peakDb).toBeCloseTo(0, 2);
  });

  it('reports a peak above the RMS level for a sine', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-20), 2 + WARM, FS));
    const s = engine.snapshot();
    expect(s.LZpeak - s.LZeq).toBeCloseTo(3.0103, 1);
  });

  it('tracks LAFmax above LAFmin for a modulated signal', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, burst(1000, dbToAmplitude(-15), 0.5, 0.5, 6 + WARM, FS));
    const s = engine.snapshot();
    expect(s.LAFmax).toBeGreaterThan(s.LAFmin + 10);
    expect(s.LAFmax).toBeGreaterThanOrEqual(s.LAeq - 0.5);
  });

  it('gives a wider Fast range than Slow range for a modulated signal', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, burst(1000, dbToAmplitude(-15), 0.25, 0.25, 8 + WARM, FS));
    const s = engine.snapshot();
    const fastRange = s.LAFmax - s.LAFmin;
    const slowRange = s.LASmax - s.LASmin;
    expect(fastRange).toBeGreaterThan(slowRange);
  });

  it('does not report a bogus minimum from the detector ramp', () => {
    // A steady tone must produce LAFmin close to LAFmax.
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-20), 4 + WARM, FS));
    const s = engine.snapshot();
    expect(s.LAFmax - s.LAFmin).toBeLessThan(1.5);
    expect(s.LASmax - s.LASmin).toBeLessThan(1.5);
  });

  it('reports LCpeak at or above LApeak for low frequency content', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(63, dbToAmplitude(-15), 3 + WARM, FS));
    const s = engine.snapshot();
    expect(s.LCpeak).toBeGreaterThan(s.LApeak + 20);
    expect(s.LZpeak).toBeGreaterThanOrEqual(s.LCpeak - 1);
  });

  it('returns NaN extremes before any data is integrated', () => {
    const engine = new MeterEngine({ sampleRate: FS });
    const s = engine.snapshot();
    expect(Number.isNaN(s.LAFmax)).toBe(true);
    expect(Number.isNaN(s.LAFmin)).toBe(true);
    expect(Number.isNaN(s.LZpeak)).toBe(true);
  });

  it('tracks the impulse maximum above the Fast maximum for short events', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, burst(1000, dbToAmplitude(-10), 0.01, 0.5, 4 + WARM, FS));
    const s = engine.snapshot();
    expect(Number.isFinite(s.LAImax)).toBe(true);
    expect(s.LAI).toBeGreaterThan(s.LAF);
  });
});

describe('MeterEngine statistics', () => {
  it('withholds percentiles until at least one second of data exists', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, 0.1, WARM_UP_SECONDS + 0.1, FS));
    expect(engine.snapshot().percentiles).toBeNull();
    feed(engine, sine(1000, 0.1, 2, FS));
    expect(engine.snapshot().percentiles).not.toBeNull();
  });

  it('gives L10 > L50 > L90 for a varying signal', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, burst(1000, dbToAmplitude(-20), 0.4, 0.4, 20 + WARM, FS));
    const p = engine.snapshot().percentiles!;
    expect(p.L10).toBeGreaterThan(p.L50);
    expect(p.L50).toBeGreaterThan(p.L90);
  });

  it('collapses the percentile spread for a steady signal', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-20), 15 + WARM, FS));
    const p = engine.snapshot().percentiles!;
    expect(p.L10 - p.L90).toBeLessThan(1);
    expect(p.L50).toBeCloseTo(-20, 0);
  });

  it('samples statistics at 20 Hz', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, 0.1, WARM_UP_SECONDS + 0.05, FS));
    engine.resetStatistics();
    feed(engine, sine(1000, 0.1, 10, FS));
    const s = engine.snapshot();
    expect(s.statisticsSamples).toBeGreaterThanOrEqual(195);
    expect(s.statisticsSamples).toBeLessThanOrEqual(205);
  });
});

describe('MeterEngine input health', () => {
  it('detects clipping on a full-scale square wave', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, square(500, 1, 2 + WARM, FS));
    const c = engine.snapshot().clipping;
    expect(c.events).toBeGreaterThan(0);
    expect(c.active).toBe(true);
    expect(c.peakDb).toBeCloseTo(0, 2);
    expect(engine.clipEvents.length).toBeGreaterThan(0);
  });

  it('does not report clipping on a signal 6 dB below full scale', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-9), 2 + WARM, FS));
    const c = engine.snapshot().clipping;
    expect(c.events).toBe(0);
    expect(c.active).toBe(false);
    expect(c.nearOverload).toBe(false);
  });

  it('flags near-overload without hard clipping', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    // Peak 0.995 -> -0.04 dBFS, above the -1 dB near-overload threshold but
    // below the 0.99 clip threshold for a sustained run.
    feed(engine, sine(1000, 0.995 / Math.SQRT2, 2 + WARM, FS));
    const c = engine.snapshot().clipping;
    expect(c.nearOverload).toBe(true);
  });

  it('removes a DC offset when the blocker is enabled', () => {
    const tone = sine(1000, dbToAmplitude(-30), 3 + WARM, FS);
    const withDc = new Float32Array(tone.length);
    for (let i = 0; i < withDc.length; i++) withDc[i] = tone[i] + 0.2;

    const blocked = new MeterEngine({ sampleRate: FS, dcBlock: true });
    feed(blocked, withDc);
    const unblocked = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(unblocked, withDc);

    // With DC present the unweighted level is dominated by the offset.
    expect(unblocked.snapshot().LZeq).toBeGreaterThan(-15);
    // With the blocker the level reflects the tone alone.
    expect(blocked.snapshot().LZeq).toBeCloseTo(-30, 1);
    expect(Math.abs(blocked.snapshot().dcOffset)).toBeLessThan(0.01);
  });

  it('reports the DC offset as a diagnostic', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    const x = new Float32Array(Math.round(FS * (2 + WARM))).fill(0.1);
    feed(engine, x);
    expect(engine.snapshot().dcOffset).toBeCloseTo(0.1, 3);
  });

  it('handles silence without producing NaN or Infinity', () => {
    const engine = new MeterEngine({ sampleRate: FS });
    feed(engine, silence(2, FS));
    const s = engine.snapshot();
    expect(Number.isFinite(s.LAeq)).toBe(true);
    expect(Number.isFinite(s.LAF)).toBe(true);
    expect(s.LAeq).toBeLessThan(-100);
  });
});

describe('MeterEngine control', () => {
  it('resetStatistics clears integration but keeps levels live', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-20), 2 + WARM, FS));
    const before = engine.snapshot();
    expect(before.durationSeconds).toBeGreaterThan(1);

    engine.resetStatistics();
    const after = engine.snapshot();
    expect(after.durationSeconds).toBe(0);
    // The instantaneous level is unaffected because detector state is preserved.
    expect(after.LAF).toBeCloseTo(before.LAF, 6);
    expect(Number.isNaN(after.LAFmax)).toBe(true);
  });

  it('reset returns the engine to the warm-up state', () => {
    const engine = new MeterEngine({ sampleRate: FS });
    feed(engine, sine(1000, 0.1, 1 + WARM, FS));
    engine.reset();
    expect(engine.isWarmingUp).toBe(true);
    const s = engine.snapshot();
    expect(s.integratedSamples).toBe(0);
    expect(s.LAF).toBeLessThan(-100);
  });

  it('increments the snapshot sequence number', () => {
    const engine = new MeterEngine({ sampleRate: FS });
    expect(engine.snapshot().sequence).toBe(1);
    expect(engine.snapshot().sequence).toBe(2);
  });

  it('exposes per-weighting level accessors', () => {
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    feed(engine, sine(1000, dbToAmplitude(-20), 2 + WARM, FS));
    expect(engine.level('Z', 'F')).toBeCloseTo(-20, 1);
    expect(engine.level('Z', 'S')).toBeCloseTo(-20, 1);
    expect(engine.leq('Z')).toBeCloseTo(-20, 1);
    expect(Number.isFinite(engine.level('A', 'I'))).toBe(true);
    expect(Number.isNaN(engine.level('Z', 'I'))).toBe(true);
  });

  it('supports selecting the statistics source weighting', () => {
    const x = sine(63, dbToAmplitude(-20), 6 + WARM, FS);
    const aEngine = new MeterEngine({
      sampleRate: FS,
      dcBlock: false,
      statisticsWeighting: 'A',
    });
    const zEngine = new MeterEngine({
      sampleRate: FS,
      dcBlock: false,
      statisticsWeighting: 'Z',
    });
    feed(aEngine, x);
    feed(zEngine, x);
    const a = aEngine.snapshot().percentiles!;
    const z = zEngine.snapshot().percentiles!;
    // At 63 Hz A weighting is about 26 dB down, so the A-based statistics sit
    // far below the Z-based ones.
    expect(z.L50 - a.L50).toBeCloseTo(-aWeightingDb(63), 0);
  });
});

describe('MeterEngine against an independent reference', () => {
  it('LZeq matches a direct RMS computation of the same samples', () => {
    const x = multitone([125, 500, 2000], dbToAmplitude(-22), 3, FS);
    const engine = new MeterEngine({ sampleRate: FS, dcBlock: false });
    // Feed only the measured section after a separate warm-up pass.
    feed(engine, sine(1000, dbToAmplitude(-22), WARM_UP_SECONDS + 0.1, FS));
    engine.resetStatistics();
    feed(engine, x);
    expect(engine.snapshot().LZeq).toBeCloseTo(blockLevelDb(x), 2);
  });
});
