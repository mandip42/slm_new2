import { describe, expect, it } from 'vitest';
import {
  EXPOSURE_SCHEMES,
  allowedExposureHours,
  computeExposure,
  lex8h,
} from '../exposure';

const niosh = EXPOSURE_SCHEMES.niosh;
const osha = EXPOSURE_SCHEMES.osha;

describe('exposure scheme metadata', () => {
  it('declares every assumption', () => {
    expect(niosh.criterionLevelDb).toBe(85);
    expect(niosh.exchangeRateDb).toBe(3);
    expect(niosh.criterionHours).toBe(8);
    expect(niosh.thresholdDb).toBeNull();
    expect(niosh.reference).toContain('NIOSH');

    expect(osha.criterionLevelDb).toBe(90);
    expect(osha.exchangeRateDb).toBe(5);
    expect(osha.thresholdDb).toBe(80);
    expect(osha.reference).toContain('1910.95');
  });
});

describe('allowed exposure time', () => {
  it('gives the criterion duration at the criterion level', () => {
    expect(allowedExposureHours(niosh, 85)).toBeCloseTo(8, 9);
    expect(allowedExposureHours(osha, 90)).toBeCloseTo(8, 9);
  });

  it('halves per exchange rate step', () => {
    expect(allowedExposureHours(niosh, 88)).toBeCloseTo(4, 9);
    expect(allowedExposureHours(niosh, 91)).toBeCloseTo(2, 9);
    expect(allowedExposureHours(niosh, 94)).toBeCloseTo(1, 9);
    expect(allowedExposureHours(osha, 95)).toBeCloseTo(4, 9);
    expect(allowedExposureHours(osha, 100)).toBeCloseTo(2, 9);
    expect(allowedExposureHours(osha, 105)).toBeCloseTo(1, 9);
  });

  it('doubles below the criterion level', () => {
    expect(allowedExposureHours(niosh, 82)).toBeCloseTo(16, 9);
    expect(allowedExposureHours(osha, 85)).toBeCloseTo(16, 9);
  });
});

describe('computeExposure', () => {
  it('gives 100 percent dose at the criterion level for the criterion duration', () => {
    const r = computeExposure(niosh, 85, 8 * 3600);
    expect(r.dosePercent).toBeCloseTo(100, 6);
    expect(r.twaDb).toBeCloseTo(85, 6);
    expect(r.remainingSeconds).toBeCloseTo(0, 6);
  });

  it('gives 50 percent dose after half the allowed time', () => {
    const r = computeExposure(niosh, 85, 4 * 3600);
    expect(r.dosePercent).toBeCloseTo(50, 6);
    expect(r.remainingSeconds).toBeCloseTo(4 * 3600, 6);
    // TWA over 8 h of 4 h at 85 dB is 82 dB with a 3 dB exchange rate.
    expect(r.twaDb).toBeCloseTo(82, 1);
  });

  it('doubles the dose for +3 dB with the NIOSH exchange rate', () => {
    const a = computeExposure(niosh, 85, 3600);
    const b = computeExposure(niosh, 88, 3600);
    expect(b.dosePercent / a.dosePercent).toBeCloseTo(2, 6);
  });

  it('doubles the dose for +5 dB with the OSHA exchange rate', () => {
    const a = computeExposure(osha, 90, 3600);
    const b = computeExposure(osha, 95, 3600);
    expect(b.dosePercent / a.dosePercent).toBeCloseTo(2, 6);
  });

  it('excludes sound below the OSHA threshold', () => {
    const r = computeExposure(osha, 75, 3600);
    expect(r.belowThreshold).toBe(true);
    expect(r.dosePercent).toBe(0);
    expect(r.allowedSeconds).toBe(Infinity);
  });

  it('does not apply a threshold to the NIOSH scheme', () => {
    const r = computeExposure(niosh, 75, 3600);
    expect(r.belowThreshold).toBe(false);
    expect(r.dosePercent).toBeGreaterThan(0);
  });

  it('projects the full-shift dose from the current level', () => {
    const r = computeExposure(niosh, 91, 600);
    // Allowed time at 91 dBA is 2 h, so a full 8 h shift would be 400 %.
    expect(r.projectedDosePercent).toBeCloseTo(400, 4);
  });

  it('reports remaining allowable time and clamps it at zero', () => {
    const r1 = computeExposure(niosh, 94, 1800); // allowed 1 h
    expect(r1.remainingSeconds).toBeCloseTo(1800, 3);
    const r2 = computeExposure(niosh, 94, 7200);
    expect(r2.remainingSeconds).toBe(0);
    expect(r2.dosePercent).toBeCloseTo(200, 4);
  });

  it('computes an 8 hour projected level consistent with LEX,8h', () => {
    const r = computeExposure(niosh, 90, 3600);
    expect(r.projected8hDb).toBeCloseTo(lex8h(90, 3600), 9);
    expect(r.projected8hDb).toBeCloseTo(90 - 10 * Math.log10(8), 6);
  });

  it('handles zero elapsed time without producing NaN', () => {
    const r = computeExposure(niosh, 85, 0);
    expect(r.dosePercent).toBe(0);
    expect(Number.isFinite(r.allowedSeconds)).toBe(true);
  });
});

describe('lex8h', () => {
  it('is the level itself for a full 8 hour measurement', () => {
    expect(lex8h(85, 8 * 3600)).toBeCloseTo(85, 9);
  });

  it('falls 3 dB per halving of duration', () => {
    expect(lex8h(85, 4 * 3600)).toBeCloseTo(85 - 3.0103, 3);
    expect(lex8h(85, 2 * 3600)).toBeCloseTo(85 - 6.0206, 3);
  });

  it('returns -Infinity for a zero duration', () => {
    expect(lex8h(85, 0)).toBe(Number.NEGATIVE_INFINITY);
  });
});
