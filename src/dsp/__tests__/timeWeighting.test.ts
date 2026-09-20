import { describe, expect, it } from 'vitest';
import { dbToAmplitude, meanSquareToDb } from '../levels';
import { burst, sine, silence } from '../signals';
import {
  ExponentialDetector,
  IMPULSE_DECAY_DB_PER_SECOND,
  ImpulseDetector,
  TIME_CONSTANTS,
  createTimeWeightingDetector,
  exponentialCoefficient,
} from '../timeWeighting';

const FS = 48000;

describe('exponential coefficient', () => {
  it('is exp(-1/(tau*fs))', () => {
    expect(exponentialCoefficient(0.125, FS)).toBeCloseTo(Math.exp(-1 / (0.125 * FS)), 12);
  });

  it('is closer to 1 for the slower time constant', () => {
    expect(exponentialCoefficient(TIME_CONSTANTS.S, FS)).toBeGreaterThan(
      exponentialCoefficient(TIME_CONSTANTS.F, FS)
    );
  });
});

describe('ExponentialDetector step response', () => {
  /**
   * A first order mean-square average reaches (1 - e^-1) = 63.2 % of the final
   * mean square after exactly one time constant, which is -1.98 dB relative to
   * the steady state.
   */
  it.each([
    ['Fast', TIME_CONSTANTS.F],
    ['Slow', TIME_CONSTANTS.S],
  ])('%s detector is 1.98 dB below steady state after one tau', (_name, tau) => {
    const detector = new ExponentialDetector(tau, FS);
    const target = 0.01; // mean square
    const n = Math.round(tau * FS);
    for (let i = 0; i < n; i++) detector.push(target);
    const expected = meanSquareToDb(target * (1 - Math.exp(-1)));
    expect(detector.levelDb).toBeCloseTo(expected, 3);
    // -10*log10(1 - 1/e) = 1.9920 dB
    expect(meanSquareToDb(target) - detector.levelDb).toBeCloseTo(
      -10 * Math.log10(1 - Math.exp(-1)),
      2
    );
    expect(meanSquareToDb(target) - detector.levelDb).toBeCloseTo(1.992, 2);
  });

  it('converges to the exact steady-state level', () => {
    const detector = new ExponentialDetector(TIME_CONSTANTS.F, FS);
    const target = 0.25;
    for (let i = 0; i < FS * 5; i++) detector.push(target);
    expect(detector.levelDb).toBeCloseTo(meanSquareToDb(target), 6);
  });

  it('tracks the RMS level of a sine, not its instantaneous amplitude', () => {
    const rmsAmplitude = dbToAmplitude(-30);
    const x = sine(1000, rmsAmplitude, 3, FS);
    const detector = new ExponentialDetector(TIME_CONSTANTS.F, FS);
    for (let i = 0; i < x.length; i++) detector.pushSample(x[i]);
    expect(detector.levelDb).toBeCloseTo(-30, 1);
  });

  it('Slow responds more slowly than Fast to a level step', () => {
    const fast = new ExponentialDetector(TIME_CONSTANTS.F, FS);
    const slow = new ExponentialDetector(TIME_CONSTANTS.S, FS);
    const n = Math.round(FS * 0.25);
    for (let i = 0; i < n; i++) {
      fast.push(1);
      slow.push(1);
    }
    expect(fast.levelDb).toBeGreaterThan(slow.levelDb);
  });

  it('decays at the rate set by the time constant', () => {
    const detector = new ExponentialDetector(TIME_CONSTANTS.F, FS);
    for (let i = 0; i < FS; i++) detector.push(1);
    const start = detector.levelDb;
    const n = Math.round(TIME_CONSTANTS.F * FS);
    for (let i = 0; i < n; i++) detector.push(0);
    // After one tau the mean square has fallen by a factor e -> 4.34 dB.
    expect(start - detector.levelDb).toBeCloseTo(10 * Math.log10(Math.E), 2);
  });

  it('is not a moving average of decibel values', () => {
    // Half a second at -20 dB then half a second of silence. A dB-domain moving
    // average would give roughly -110 dB (the floor dominates); the correct
    // mean-square detector decays smoothly from -20 dB.
    const loud = sine(1000, dbToAmplitude(-20), 2, FS);
    const quiet = silence(0.05, FS);
    const detector = new ExponentialDetector(TIME_CONSTANTS.F, FS);
    for (let i = 0; i < loud.length; i++) detector.pushSample(loud[i]);
    const beforeSilence = detector.levelDb;
    expect(beforeSilence).toBeCloseTo(-20, 1);
    for (let i = 0; i < quiet.length; i++) detector.pushSample(quiet[i]);
    // 50 ms of decay with tau = 125 ms -> 10*log10(e^0.4) = 1.737 dB of drop.
    // A decibel-domain moving average would instead collapse toward the floor.
    expect(beforeSilence - detector.levelDb).toBeCloseTo(10 * Math.log10(Math.E) * 0.4, 1);
    expect(detector.levelDb).toBeGreaterThan(-30);
  });

  it('reports the settling length for a given tolerance', () => {
    const detector = new ExponentialDetector(TIME_CONSTANTS.F, FS);
    const n = detector.settlingSamples(0.1);
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) detector.push(1);
    expect(Math.abs(detector.levelDb)).toBeLessThanOrEqual(0.1);
  });
});

describe('ImpulseDetector', () => {
  it('rises quickly and decays at the documented rate', () => {
    const detector = new ImpulseDetector(FS);
    // 250 ms of full level is about 7 rise time constants, so the detector has
    // reached its steady state to within 0.01 dB.
    for (let i = 0; i < Math.round(FS * 0.25); i++) detector.push(1);
    const peak = detector.levelDb;
    expect(peak).toBeGreaterThan(-0.05);

    // One second of silence should fall by the documented decay rate.
    for (let i = 0; i < FS; i++) detector.push(0);
    const drop = peak - detector.levelDb;
    expect(drop).toBeCloseTo(IMPULSE_DECAY_DB_PER_SECOND, 1);
  });

  it('holds a short impulse for longer than the Fast detector', () => {
    const impulseDetector = new ImpulseDetector(FS);
    const fast = new ExponentialDetector(TIME_CONSTANTS.F, FS);
    const x = burst(1000, 0.5, 0.02, 1.0, 1.5, FS);
    for (let i = 0; i < x.length; i++) {
      impulseDetector.pushSample(x[i]);
      fast.pushSample(x[i]);
    }
    expect(impulseDetector.levelDb).toBeGreaterThan(fast.levelDb + 10);
  });

  it('rises faster than the Fast detector', () => {
    const impulseDetector = new ImpulseDetector(FS);
    const fast = new ExponentialDetector(TIME_CONSTANTS.F, FS);
    for (let i = 0; i < Math.round(FS * 0.035); i++) {
      impulseDetector.push(1);
      fast.push(1);
    }
    expect(impulseDetector.levelDb).toBeGreaterThan(fast.levelDb);
  });
});

describe('createTimeWeightingDetector', () => {
  it('returns the right detector type and time constant', () => {
    const f = createTimeWeightingDetector('F', FS);
    const s = createTimeWeightingDetector('S', FS);
    const i = createTimeWeightingDetector('I', FS);
    expect(f).toBeInstanceOf(ExponentialDetector);
    expect(s).toBeInstanceOf(ExponentialDetector);
    expect(i).toBeInstanceOf(ImpulseDetector);
    expect((f as ExponentialDetector).tau).toBe(0.125);
    expect((s as ExponentialDetector).tau).toBe(1);
  });
});
