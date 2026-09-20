import { describe, expect, it } from 'vitest';
import {
  EnergyAccumulator,
  amplitudeToDb,
  blockLevelDb,
  blockPeakDb,
  dbToAmplitude,
  energyAverageDb,
  energyAverageDbWeighted,
  meanSquareToDb,
  normalisedExposureLevel8h,
  rms,
  soundExposureLevel,
  sumLevelsDb,
} from '../levels';
import { sine, square } from '../signals';

const FS = 48000;

describe('RMS and dB conversion', () => {
  it('computes the RMS of a sine as amplitude / sqrt(2)', () => {
    const peak = 0.5;
    const x = new Float32Array(FS);
    for (let i = 0; i < x.length; i++) x[i] = peak * Math.sin((2 * Math.PI * 1000 * i) / FS);
    expect(rms(x)).toBeCloseTo(peak / Math.SQRT2, 5);
  });

  it('reports a full-scale sine as -3.01 dBFS', () => {
    const x = sine(1000, 1 / Math.SQRT2, 1, FS); // rms = 1/sqrt2 -> peak 1.0
    expect(blockLevelDb(x)).toBeCloseTo(-3.0103, 3);
    expect(blockPeakDb(x)).toBeCloseTo(0, 3);
  });

  it('reports a full-scale square wave as 0 dBFS', () => {
    const x = square(1000, 1, 1, FS);
    expect(blockLevelDb(x)).toBeCloseTo(0, 6);
  });

  it('generates sines with the requested RMS level', () => {
    for (const target of [-60, -40, -20, -6]) {
      const x = sine(1000, dbToAmplitude(target), 1, FS);
      expect(blockLevelDb(x)).toBeCloseTo(target, 3);
    }
  });

  it('round-trips amplitude and dB', () => {
    for (const db of [-120, -60, -20, -3, 0]) {
      expect(amplitudeToDb(dbToAmplitude(db))).toBeCloseTo(db, 9);
    }
  });

  it('converts mean square to dB consistently with amplitude', () => {
    expect(meanSquareToDb(0.25)).toBeCloseTo(amplitudeToDb(0.5), 9);
  });

  it('floors zero and negative arguments instead of returning -Infinity', () => {
    expect(Number.isFinite(amplitudeToDb(0))).toBe(true);
    expect(Number.isFinite(meanSquareToDb(0))).toBe(true);
  });
});

describe('energy-domain level arithmetic', () => {
  it('doubling the energy adds 3.01 dB', () => {
    expect(sumLevelsDb([70, 70])).toBeCloseTo(73.0103, 4);
  });

  it('summing ten equal levels adds 10 dB', () => {
    expect(sumLevelsDb(Array(10).fill(60))).toBeCloseTo(70, 6);
  });

  it('energy averages, not arithmetic averages, decibels', () => {
    // Arithmetic mean would be 70 dB; the correct energy average is higher.
    const result = energyAverageDb([60, 80]);
    expect(result).toBeGreaterThan(70);
    // 10*log10((1e6 + 1e8) / 2) = 77.0329 dB
    expect(result).toBeCloseTo(10 * Math.log10((1e6 + 1e8) / 2), 9);
    expect(result).toBeCloseTo(77.0329, 3);
  });

  it('energy average of identical levels is that level', () => {
    expect(energyAverageDb([65, 65, 65, 65])).toBeCloseTo(65, 9);
  });

  it('weights partial durations correctly', () => {
    // 1 hour at 80 dB and 7 hours at 60 dB.
    const leq = energyAverageDbWeighted([80, 60], [3600, 7 * 3600]);
    const expected = 10 * Math.log10((1 * 1e8 + 7 * 1e6) / 8);
    expect(leq).toBeCloseTo(expected, 6);
  });

  it('computes SEL as Leq + 10log10(T)', () => {
    expect(soundExposureLevel(70, 100)).toBeCloseTo(90, 9);
    expect(soundExposureLevel(70, 1)).toBeCloseTo(70, 9);
  });

  it('normalises to an 8 hour exposure', () => {
    // 8 hours at 85 dB -> LEX,8h = 85 dB
    expect(normalisedExposureLevel8h(85, 8 * 3600)).toBeCloseTo(85, 9);
    // 4 hours at 85 dB -> 82 dB
    expect(normalisedExposureLevel8h(85, 4 * 3600)).toBeCloseTo(85 - 3.0103, 3);
  });
});

describe('EnergyAccumulator', () => {
  it('matches the direct RMS level of a block', () => {
    const x = sine(1000, dbToAmplitude(-20), 2, FS);
    const acc = new EnergyAccumulator();
    for (let i = 0; i < x.length; i++) acc.addSquared(x[i] * x[i]);
    expect(acc.levelDb).toBeCloseTo(blockLevelDb(x), 6);
    expect(acc.samples).toBe(x.length);
  });

  it('gives the same result for per-sample and per-block accumulation', () => {
    const x = sine(440, 0.1, 1, FS);
    const a = new EnergyAccumulator();
    const b = new EnergyAccumulator();
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
      a.addSquared(x[i] * x[i]);
      sum += x[i] * x[i];
    }
    b.addBlockEnergy(sum, x.length);
    expect(a.levelDb).toBeCloseTo(b.levelDb, 9);
  });
});
