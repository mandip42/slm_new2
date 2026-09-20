import { describe, expect, it } from 'vitest';
import { LeqIntegrator, MovingLeq, combineLeqSegments } from '../leq';
import { blockLevelDb, dbToAmplitude, dbToMeanSquare } from '../levels';
import { sine } from '../signals';

const FS = 48000;

describe('LeqIntegrator', () => {
  it('matches a direct RMS level', () => {
    const x = sine(1000, dbToAmplitude(-20), 3, FS);
    const integrator = new LeqIntegrator(FS);
    for (let i = 0; i < x.length; i++) integrator.addSquared(x[i] * x[i]);
    expect(integrator.leq).toBeCloseTo(blockLevelDb(x), 6);
    expect(integrator.durationSeconds).toBeCloseTo(3, 6);
  });

  it('gives the same answer for per-sample and per-block feeding', () => {
    const x = sine(440, dbToAmplitude(-25), 2, FS);
    const perSample = new LeqIntegrator(FS);
    const perBlock = new LeqIntegrator(FS);
    for (let i = 0; i < x.length; i++) perSample.addSquared(x[i] * x[i]);
    const blockSize = 512;
    for (let i = 0; i < x.length; i += blockSize) {
      let sum = 0;
      const end = Math.min(i + blockSize, x.length);
      for (let j = i; j < end; j++) sum += x[j] * x[j];
      perBlock.addBlock(sum, end - i);
    }
    expect(perBlock.leq).toBeCloseTo(perSample.leq, 9);
  });

  it('energy averages two different levels', () => {
    const integrator = new LeqIntegrator(FS);
    integrator.addBlock(dbToMeanSquare(-20) * FS, FS);
    integrator.addBlock(dbToMeanSquare(-40) * FS, FS);
    expect(integrator.leq).toBeCloseTo(10 * Math.log10((1e-2 + 1e-4) / 2), 9);
  });

  it('produces one short-Leq segment per second', () => {
    const x = sine(1000, dbToAmplitude(-20), 5, FS);
    const integrator = new LeqIntegrator(FS, 1);
    for (let i = 0; i < x.length; i++) integrator.addSquared(x[i] * x[i]);
    expect(integrator.shortLeqSegments).toHaveLength(5);
    for (const seg of integrator.shortLeqSegments) expect(seg).toBeCloseTo(-20, 2);
  });

  it('produces short-Leq segments when fed in blocks that straddle boundaries', () => {
    const integrator = new LeqIntegrator(FS, 1);
    // Blocks of 30000 samples do not divide evenly into 48000.
    const total = FS * 4;
    const ms = dbToMeanSquare(-30);
    let fed = 0;
    while (fed < total) {
      const n = Math.min(30000, total - fed);
      integrator.addBlock(ms * n, n);
      fed += n;
    }
    expect(integrator.shortLeqSegments).toHaveLength(4);
    for (const seg of integrator.shortLeqSegments) expect(seg).toBeCloseTo(-30, 6);
  });

  it('computes SEL from Leq and duration', () => {
    const integrator = new LeqIntegrator(FS);
    integrator.addBlock(dbToMeanSquare(-20) * FS * 10, FS * 10);
    expect(integrator.durationSeconds).toBeCloseTo(10, 6);
    expect(integrator.sel).toBeCloseTo(-20 + 10 * Math.log10(10), 6);
  });

  it('returns the level floor before any data', () => {
    const integrator = new LeqIntegrator(FS);
    expect(integrator.leq).toBeLessThan(-100);
    expect(integrator.sel).toBeLessThan(-100);
    expect(integrator.durationSeconds).toBe(0);
  });

  it('resets completely', () => {
    const integrator = new LeqIntegrator(FS);
    integrator.addBlock(dbToMeanSquare(-20) * FS * 3, FS * 3);
    integrator.reset();
    expect(integrator.samples).toBe(0);
    expect(integrator.shortLeqSegments).toHaveLength(0);
    expect(integrator.totalEnergy).toBe(0);
  });
});

describe('MovingLeq', () => {
  it('averages only the most recent window', () => {
    const moving = new MovingLeq(4);
    for (let i = 0; i < 4; i++) moving.push(dbToMeanSquare(-40));
    expect(moving.levelDb).toBeCloseTo(-40, 9);
    expect(moving.isFull).toBe(true);
    // Push four louder values; the quiet ones should be pushed out entirely.
    for (let i = 0; i < 4; i++) moving.push(dbToMeanSquare(-20));
    expect(moving.levelDb).toBeCloseTo(-20, 9);
  });

  it('partially fills before the window is complete', () => {
    const moving = new MovingLeq(10);
    moving.push(dbToMeanSquare(-30));
    expect(moving.isFull).toBe(false);
    expect(moving.levelDb).toBeCloseTo(-30, 9);
  });

  it('is at the floor when empty', () => {
    expect(new MovingLeq(5).levelDb).toBeLessThan(-100);
  });

  it('resets', () => {
    const moving = new MovingLeq(3);
    moving.push(1);
    moving.reset();
    expect(moving.levelDb).toBeLessThan(-100);
    expect(moving.isFull).toBe(false);
  });
});

describe('combineLeqSegments', () => {
  it('combines paused/resumed segments by energy and duration', () => {
    const result = combineLeqSegments([
      { leq: 80, durationSeconds: 3600 },
      { leq: 60, durationSeconds: 7 * 3600 },
    ]);
    expect(result.durationSeconds).toBe(8 * 3600);
    expect(result.leq).toBeCloseTo(10 * Math.log10((1e8 + 7 * 1e6) / 8), 6);
  });

  it('ignores zero-length segments', () => {
    const result = combineLeqSegments([
      { leq: 90, durationSeconds: 0 },
      { leq: 70, durationSeconds: 10 },
    ]);
    expect(result.leq).toBeCloseTo(70, 9);
    expect(result.durationSeconds).toBe(10);
  });

  it('returns the floor for an empty list', () => {
    const result = combineLeqSegments([]);
    expect(result.leq).toBeLessThan(-100);
    expect(result.durationSeconds).toBe(0);
  });
});
