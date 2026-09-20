import { describe, expect, it } from 'vitest';
import { cascadeMagnitudeDb } from '../biquad';
import { designButterworthBandpass } from '../butterworth';
import { blockLevelDb, dbToAmplitude, sumLevelsDb } from '../levels';
import {
  BAND_USABLE_NYQUIST_FRACTION,
  FractionalOctaveBank,
  G,
  bandDefinition,
  broadbandFromBands,
  midbandFrequency,
  octaveBandDefinitions,
  octaveGroups,
  sumThirdOctavesToOctaves,
  thirdOctaveBandDefinitions,
} from '../octave';
import { multitone, pinkNoise, sine, whiteNoise } from '../signals';
import { createBandPlan, createThirdOctaveBank } from '../thirdOctave';

const FS = 48000;

describe('band definitions', () => {
  it('uses the base-ten octave ratio', () => {
    expect(G).toBeCloseTo(Math.pow(10, 0.3), 12);
    expect(G).toBeCloseTo(1.9953, 4);
  });

  it('places the 1 kHz band exactly at 1000 Hz', () => {
    expect(midbandFrequency(0, 3)).toBeCloseTo(1000, 9);
    expect(midbandFrequency(0, 1)).toBeCloseTo(1000, 9);
  });

  it('spaces one-third-octave bands by G^(1/3)', () => {
    const a = midbandFrequency(0, 3);
    const b = midbandFrequency(1, 3);
    expect(b / a).toBeCloseTo(Math.pow(G, 1 / 3), 12);
  });

  it('produces the ISO 266 preferred labels', () => {
    const bands = thirdOctaveBandDefinitions();
    const nominals = bands.map((b) => b.nominal);
    expect(nominals[0]).toBe(20);
    expect(nominals[nominals.length - 1]).toBe(20000);
    expect(nominals).toContain(31.5);
    expect(nominals).toContain(63);
    expect(nominals).toContain(125);
    expect(nominals).toContain(1000);
    expect(nominals).toContain(12500);
    expect(bands).toHaveLength(31);
  });

  it('produces 10 octave bands from 31.5 Hz to 16 kHz', () => {
    const bands = octaveBandDefinitions();
    expect(bands).toHaveLength(10);
    expect(bands.map((b) => b.nominal)).toEqual([
      31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
    ]);
  });

  it('sets band edges at f_m * G^(-+1/(2b))', () => {
    const third = bandDefinition(0, 3);
    expect(third.lower).toBeCloseTo(1000 / Math.pow(G, 1 / 6), 9);
    expect(third.upper).toBeCloseTo(1000 * Math.pow(G, 1 / 6), 9);
    // Relative bandwidth of a base-ten one-third octave band:
    // G^(1/6) - G^(-1/6) = 0.23077 (the base-two system gives 0.23156).
    expect((third.upper - third.lower) / third.exact).toBeCloseTo(
      Math.pow(G, 1 / 6) - Math.pow(G, -1 / 6),
      9
    );
    expect((third.upper - third.lower) / third.exact).toBeCloseTo(0.2308, 3);

    const octave = bandDefinition(0, 1);
    // G^(1/2) - G^(-1/2) = 0.70459
    expect((octave.upper - octave.lower) / octave.exact).toBeCloseTo(0.7046, 3);
  });

  it('formats labels for display', () => {
    expect(bandDefinition(-15, 3).label).toBe('31.5');
    expect(bandDefinition(0, 3).label).toBe('1k');
    expect(bandDefinition(11, 3).label).toBe('12.5k');
  });
});

describe('Butterworth band-pass design', () => {
  const bands = thirdOctaveBandDefinitions().filter(
    (b) => b.upper <= FS * BAND_USABLE_NYQUIST_FRACTION
  );

  it('produces order/2 stable sections for every measurable band', () => {
    for (const b of bands) {
      const d = designButterworthBandpass(6, b.lower, b.upper, FS);
      expect(d.sections).toHaveLength(3);
      expect(d.stable).toBe(true);
      expect(d.maxPoleRadius).toBeLessThan(1);
      for (const s of d.sections) {
        expect(Number.isFinite(s.b0)).toBe(true);
        expect(Number.isFinite(s.a1)).toBe(true);
        expect(Number.isFinite(s.a2)).toBe(true);
      }
    }
  });

  it('is exactly 0 dB at the band centre', () => {
    for (const b of bands) {
      const d = designButterworthBandpass(6, b.lower, b.upper, FS);
      expect(cascadeMagnitudeDb(d.sections, b.exact, FS)).toBeCloseTo(0, 6);
    }
  });

  it('is exactly -3.01 dB at both band edges', () => {
    for (const b of bands) {
      const d = designButterworthBandpass(6, b.lower, b.upper, FS);
      expect(cascadeMagnitudeDb(d.sections, b.lower, FS)).toBeCloseTo(-3.0103, 2);
      expect(cascadeMagnitudeDb(d.sections, b.upper, FS)).toBeCloseTo(-3.0103, 2);
    }
  });

  it('rejects strongly one octave away from the centre', () => {
    for (const b of bands) {
      const d = designButterworthBandpass(6, b.lower, b.upper, FS);
      const below = cascadeMagnitudeDb(d.sections, b.exact / 2, FS);
      expect(below).toBeLessThan(-40);
      const above = b.exact * 2;
      if (above < FS * 0.45) {
        expect(cascadeMagnitudeDb(d.sections, above, FS)).toBeLessThan(-40);
      }
    }
  });

  it('rejects odd orders and out-of-range edges', () => {
    expect(() => designButterworthBandpass(3, 100, 200, FS)).toThrow();
    expect(() => designButterworthBandpass(6, 200, 100, FS)).toThrow();
    expect(() => designButterworthBandpass(6, 100, FS / 2, FS)).toThrow();
  });

  it('works at 44.1 kHz too', () => {
    const fs = 44100;
    for (const b of thirdOctaveBandDefinitions()) {
      if (b.upper > fs * BAND_USABLE_NYQUIST_FRACTION) continue;
      const d = designButterworthBandpass(6, b.lower, b.upper, fs);
      expect(d.stable).toBe(true);
      expect(cascadeMagnitudeDb(d.sections, b.exact, fs)).toBeCloseTo(0, 6);
    }
  });
});

describe('band availability', () => {
  it('marks bands above the usable limit unavailable, with a reason', () => {
    const plan = createBandPlan(FS);
    const twentyK = plan.thirdBands.find((b) => b.nominal === 20000)!;
    expect(twentyK.available).toBe(false);
    expect(twentyK.unavailableReason).toContain('exceeds');
    const oneK = plan.thirdBands.find((b) => b.nominal === 1000)!;
    expect(oneK.available).toBe(true);
  });

  it('flags the 16 kHz octave as partial at 48 kHz', () => {
    const plan = createBandPlan(FS);
    const octave16k = plan.octaveBands.find((b) => b.nominal === 16000)!;
    expect(octave16k.available).toBe(true);
    expect(octave16k.unavailableReason).toContain('Partial octave');
  });

  it('groups each octave from three one-third-octave bands', () => {
    const groups = octaveGroups(thirdOctaveBandDefinitions(), octaveBandDefinitions());
    expect(groups).toHaveLength(10);
    for (const g of groups) expect(g).toHaveLength(3);
    const thirds = thirdOctaveBandDefinitions();
    const oneKGroup = groups[5]; // 1 kHz octave
    expect(oneKGroup.map((i) => thirds[i].nominal)).toEqual([800, 1000, 1250]);
  });
});

describe('FractionalOctaveBank', () => {
  const bandIndex = (bank: FractionalOctaveBank, nominal: number) =>
    bank.bands.findIndex((b) => b.nominal === nominal);

  const runBank = (bank: FractionalOctaveBank, signal: Float32Array, blockSize = 1024) => {
    // Warm the filters up first, exactly as the engine does.
    const warm = Math.min(signal.length, Math.round(FS * 0.5));
    for (let i = 0; i < warm; i += blockSize) {
      bank.processBlock(signal.subarray(i, Math.min(i + blockSize, warm)));
    }
    bank.enableStatistics();
    for (let i = warm; i < signal.length; i += blockSize) {
      bank.processBlock(signal.subarray(i, Math.min(i + blockSize, signal.length)));
    }
    return bank.results();
  };

  it('designs a stable bank with no unstable bands', () => {
    const bank = createThirdOctaveBank(FS);
    expect(bank.unstableBands).toEqual([]);
    expect(bank.bandCount).toBe(31);
  });

  it('puts a 1 kHz tone in the 1 kHz band', () => {
    const bank = createThirdOctaveBank(FS);
    const x = sine(1000, dbToAmplitude(-20), 2, FS);
    const r = runBank(bank, x);
    const idx = bandIndex(bank, 1000);
    let best = 0;
    for (let i = 0; i < r.leq.length; i++) if (r.leq[i] > r.leq[best]) best = i;
    expect(best).toBe(idx);
    // Essentially all the energy lands in that band.
    expect(r.leq[idx]).toBeCloseTo(-20, 1);
  });

  it.each([31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000])(
    'allocates a %p Hz tone to the matching band',
    (nominal) => {
      const bank = createThirdOctaveBank(FS);
      const band = bank.bands.find((b) => b.nominal === nominal)!;
      const x = sine(band.exact, dbToAmplitude(-20), 3, FS);
      const r = runBank(bank, x);
      const idx = bandIndex(bank, nominal);
      let best = 0;
      for (let i = 0; i < r.leq.length; i++) if (r.leq[i] > r.leq[best]) best = i;
      expect(best).toBe(idx);
      expect(r.leq[idx]).toBeCloseTo(-20, 0);
      // Neighbouring bands must be well below the signal band.
      if (idx > 0) expect(r.leq[idx - 1]).toBeLessThan(r.leq[idx] - 15);
      if (idx < r.leq.length - 1 && bank.bands[idx + 1].available) {
        expect(r.leq[idx + 1]).toBeLessThan(r.leq[idx] - 15);
      }
    }
  );

  it('does not simply read one FFT bin: a tone between two band centres splits', () => {
    const bank = createThirdOctaveBank(FS);
    const lower = bank.bands.find((b) => b.nominal === 1000)!;
    const upper = bank.bands.find((b) => b.nominal === 1250)!;
    const between = Math.sqrt(lower.exact * upper.exact); // the shared band edge
    const x = sine(between, dbToAmplitude(-20), 3, FS);
    const r = runBank(bank, x);
    const li = bandIndex(bank, 1000);
    const ui = bandIndex(bank, 1250);
    // At the shared -3 dB edge both bands see about half the power.
    expect(r.leq[li]).toBeCloseTo(-23, 0);
    expect(r.leq[ui]).toBeCloseTo(-23, 0);
  });

  it('conserves broadband energy when summing bands (white noise)', () => {
    const bank = createThirdOctaveBank(FS);
    const x = whiteNoise(dbToAmplitude(-20), 4, FS, 4242);
    const r = runBank(bank, x);
    const availability = bank.bands.map((b) => b.available);
    const summed = broadbandFromBands(r.leq, availability);
    const direct = blockLevelDb(x.subarray(Math.round(FS * 0.5)));
    // The measurable bands cover 20 Hz .. 16 kHz, so a little energy above
    // 17.8 kHz is legitimately missing. The sum must not exceed the total and
    // must account for most of it.
    expect(summed).toBeLessThan(direct + 0.3);
    expect(summed).toBeGreaterThan(direct - 1.5);
  });

  it('conserves broadband energy when summing bands (pink noise)', () => {
    const bank = createThirdOctaveBank(FS);
    const x = pinkNoise(dbToAmplitude(-20), 4, FS, 777);
    const r = runBank(bank, x);
    const availability = bank.bands.map((b) => b.available);
    const summed = broadbandFromBands(r.leq, availability);
    const direct = blockLevelDb(x.subarray(Math.round(FS * 0.5)));
    // Pink noise carries significant energy below the 17.8 Hz lower edge of the
    // 20 Hz band, which the bank legitimately does not measure, so the band sum
    // is expected to fall slightly short of the raw broadband level. It must
    // never exceed it.
    expect(summed).toBeLessThan(direct + 0.2);
    expect(summed).toBeGreaterThan(direct - 1.5);
  });

  it('conserves energy exactly for tones inside the measured range', () => {
    // A signal entirely inside 20 Hz .. 16 kHz must be fully accounted for by
    // the band sum. This is the strict energy-conservation check.
    const bank = createThirdOctaveBank(FS);
    const centres = [125, 500, 1000, 4000].map(
      (nominal) => bank.bands.find((b) => b.nominal === nominal)!.exact
    );
    const x = multitone(centres, dbToAmplitude(-20), 4, FS);
    const r = runBank(bank, x);
    const summed = broadbandFromBands(
      r.leq,
      bank.bands.map((b) => b.available)
    );
    const direct = blockLevelDb(x.subarray(Math.round(FS * 0.5)));
    // Adjacent bands overlap at their shared -3 dB edges, so summing every band
    // double-counts a little skirt energy: about +0.13 dB for tones sitting on
    // band centres. This is inherent to any real fractional-octave filter bank.
    expect(Math.abs(summed - direct)).toBeLessThan(0.3);
    expect(summed).toBeGreaterThan(direct - 0.1);
  });

  it('gives an approximately flat 1/3-octave spectrum for pink noise', () => {
    const bank = createThirdOctaveBank(FS);
    const x = pinkNoise(dbToAmplitude(-20), 4, FS, 31337);
    const r = runBank(bank, x);
    const levels: number[] = [];
    for (let i = 0; i < bank.bands.length; i++) {
      const b = bank.bands[i];
      if (!b.available || b.nominal < 100 || b.nominal > 8000) continue;
      levels.push(r.leq[i]);
    }
    const mean = levels.reduce((a, b) => a + b, 0) / levels.length;
    for (const l of levels) expect(Math.abs(l - mean)).toBeLessThan(2);
  });

  it('rises by 1 dB per band for white noise (constant bandwidth per octave)', () => {
    const bank = createThirdOctaveBank(FS);
    const x = whiteNoise(dbToAmplitude(-20), 4, FS, 5150);
    const r = runBank(bank, x);
    const pick = (nominal: number) => r.leq[bandIndex(bank, nominal)];
    // White noise has constant power per Hz, so each 1/3-octave band (23 % wide)
    // gains 10*log10(G^(1/3)) = 1.0 dB over the one below it.
    expect(pick(1000) - pick(500)).toBeCloseTo(3.01, 0);
    expect(pick(4000) - pick(1000)).toBeCloseTo(6.02, 0);
  });

  it('tracks band maxima and current levels', () => {
    const bank = createThirdOctaveBank(FS);
    const x = sine(1000, dbToAmplitude(-20), 3, FS);
    const r = runBank(bank, x);
    const idx = bandIndex(bank, 1000);
    expect(r.current[idx]).toBeCloseTo(-20, 0);
    expect(r.max[idx]).toBeGreaterThanOrEqual(r.current[idx] - 0.5);
    expect(r.samples).toBeGreaterThan(0);
  });

  it('resets cleanly', () => {
    const bank = createThirdOctaveBank(FS);
    runBank(bank, sine(1000, 0.1, 1, FS));
    bank.reset();
    const r = bank.results();
    expect(r.samples).toBe(0);
    expect(bank.isAccumulating).toBe(false);
  });

  it('does not accumulate before statistics are enabled', () => {
    const bank = createThirdOctaveBank(FS);
    bank.processBlock(sine(1000, 0.1, 0.5, FS));
    expect(bank.results().samples).toBe(0);
    bank.enableStatistics();
    bank.processBlock(sine(1000, 0.1, 0.5, FS));
    expect(bank.results().samples).toBeGreaterThan(0);
  });

  it('gives block-size independent results', () => {
    const x = pinkNoise(dbToAmplitude(-25), 3, FS, 8080);
    const results: number[][] = [];
    for (const blockSize of [128, 1024, 4096]) {
      const bank = createThirdOctaveBank(FS);
      const r = runBank(bank, x, blockSize);
      results.push(Array.from(r.leq));
    }
    for (let i = 0; i < results[0].length; i++) {
      expect(Math.abs(results[0][i] - results[1][i])).toBeLessThan(0.05);
      expect(Math.abs(results[0][i] - results[2][i])).toBeLessThan(0.05);
    }
  });
});

describe('octave derivation from one-third-octave bands', () => {
  it('energy-sums three thirds into one octave', () => {
    const plan = createBandPlan(FS);
    const levels = new Float32Array(plan.thirdBands.length).fill(-200);
    const groups = plan.groups;
    // Put 60 dB into each of the three thirds of the 1 kHz octave.
    for (const pos of groups[5]) levels[pos] = 60;
    const { levelsDb, contributingBands } = sumThirdOctavesToOctaves(
      levels,
      groups,
      plan.thirdBands.map((b) => b.available)
    );
    expect(levelsDb[5]).toBeCloseTo(sumLevelsDb([60, 60, 60]), 3);
    expect(levelsDb[5]).toBeCloseTo(64.771, 2);
    expect(contributingBands[5]).toBe(3);
  });

  it('reports a partial octave when a third is unavailable', () => {
    const plan = createBandPlan(FS);
    const levels = new Float32Array(plan.thirdBands.length).fill(50);
    const { contributingBands } = sumThirdOctavesToOctaves(
      levels,
      plan.groups,
      plan.thirdBands.map((b) => b.available)
    );
    // The 16 kHz octave loses its 20 kHz third at 48 kHz.
    expect(contributingBands[9]).toBe(2);
  });

  it('matches a directly measured octave level for a real signal', () => {
    const bank = createThirdOctaveBank(FS);
    const plan = createBandPlan(FS);
    const x = pinkNoise(dbToAmplitude(-20), 4, FS, 2468);
    const warm = Math.round(FS * 0.5);
    bank.processBlock(x.subarray(0, warm));
    bank.enableStatistics();
    bank.processBlock(x.subarray(warm));
    const r = bank.results();
    const { levelsDb } = sumThirdOctavesToOctaves(
      r.leq,
      plan.groups,
      plan.thirdBands.map((b) => b.available)
    );
    // Cross-check the 1 kHz octave against an independent single band-pass.
    const octave = plan.octaveBands[5];
    const design = designButterworthBandpass(6, octave.lower, octave.upper, FS);
    const bank2 = new FractionalOctaveBank([octave], FS, 1, 6);
    bank2.processBlock(x.subarray(0, warm));
    bank2.enableStatistics();
    bank2.processBlock(x.subarray(warm));
    expect(design.stable).toBe(true);
    // The energy sum of the three thirds and the direct octave filter should
    // agree closely; small differences come from the filter skirts.
    expect(Math.abs(levelsDb[5] - bank2.results().leq[0])).toBeLessThan(0.6);
  });
});
