import { describe, expect, it } from 'vitest';
import { FFT_SIZES, Fft, SpectrumAnalyzer, dominantFrequency, spectrumOf } from '../fft';
import { dbToAmplitude } from '../levels';
import { multitone, pinkNoise, sine, whiteNoise } from '../signals';
import { WINDOW_IDS, createWindow } from '../window';

const FS = 48000;

describe('Fft', () => {
  it('rejects non power-of-two sizes', () => {
    expect(() => new Fft(1000)).toThrow();
  });

  it('transforms a DC signal into bin 0 only', () => {
    const n = 64;
    const fft = new Fft(n);
    const re = new Float64Array(n).fill(1);
    const im = new Float64Array(n);
    fft.transform(re, im);
    expect(re[0]).toBeCloseTo(n, 9);
    for (let k = 1; k < n; k++) {
      expect(Math.hypot(re[k], im[k])).toBeLessThan(1e-9);
    }
  });

  it('places a bin-centred cosine in exactly that bin', () => {
    const n = 256;
    const k0 = 7;
    const fft = new Fft(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * k0 * i) / n);
    fft.transform(re, im);
    expect(Math.hypot(re[k0], im[k0])).toBeCloseTo(n / 2, 6);
    for (let k = 1; k < n / 2; k++) {
      if (k === k0) continue;
      expect(Math.hypot(re[k], im[k])).toBeLessThan(1e-9);
    }
  });

  it('matches a naive DFT', () => {
    const n = 64;
    const fft = new Fft(n);
    const input = new Float64Array(n);
    for (let i = 0; i < n; i++) input[i] = Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1);
    const re = Float64Array.from(input);
    const im = new Float64Array(n);
    fft.transform(re, im);
    for (const k of [0, 1, 5, 17, 32]) {
      let dr = 0;
      let di = 0;
      for (let i = 0; i < n; i++) {
        const a = (-2 * Math.PI * k * i) / n;
        dr += input[i] * Math.cos(a);
        di += input[i] * Math.sin(a);
      }
      expect(re[k]).toBeCloseTo(dr, 8);
      expect(im[k]).toBeCloseTo(di, 8);
    }
  });
});

describe('analysis windows', () => {
  it.each(WINDOW_IDS)('%s reports plausible correction factors', (id) => {
    const w = createWindow(id, 4096);
    expect(w.coherentGain).toBeGreaterThan(0);
    expect(w.coherentGain).toBeLessThanOrEqual(1.0001);
    expect(w.noisePowerBandwidth).toBeGreaterThanOrEqual(0.999);
  });

  it('gives the known Hann factors', () => {
    const w = createWindow('hann', 8192);
    expect(w.coherentGain).toBeCloseTo(0.5, 3);
    expect(w.noisePowerBandwidth).toBeCloseTo(1.5, 2);
  });

  it('rectangular window is unity gain with 1 bin noise bandwidth', () => {
    const w = createWindow('rectangular', 1024);
    expect(w.coherentGain).toBeCloseTo(1, 12);
    expect(w.noisePowerBandwidth).toBeCloseTo(1, 12);
  });
});

describe('SpectrumAnalyzer', () => {
  it.each(FFT_SIZES)('identifies a 1 kHz tone at fftSize %i', (size) => {
    const analyzer = new SpectrumAnalyzer(size, FS, 'hann');
    const x = sine(1000, 0.1, (size * 2) / FS, FS);
    analyzer.analyse(x.subarray(0, size));
    const peak = analyzer.findPeak();
    // Accuracy limit is roughly one bin.
    expect(Math.abs(peak.frequency - 1000)).toBeLessThan((2 * FS) / size);
  });

  it('reports the correct RMS level for a tone', () => {
    const analyzer = new SpectrumAnalyzer(8192, FS, 'hann');
    for (const targetDb of [-6, -20, -40, -60]) {
      // Choose a bin-centred frequency so no scalloping loss applies.
      const binWidth = FS / 8192;
      const frequency = Math.round(1000 / binWidth) * binWidth;
      const x = sine(frequency, dbToAmplitude(targetDb), 8192 / FS, FS);
      const res = analyzer.analyse(x.subarray(0, 8192));
      let best = 0;
      for (let k = 1; k < res.binCount; k++) if (res.levelsDb[k] > res.levelsDb[best]) best = k;
      expect(res.levelsDb[best]).toBeCloseTo(targetDb, 1);
    }
  });

  it('uses the same full-scale reference as the sound level meter', () => {
    // A full-scale sine has an RMS level of -3.01 dBFS.
    const analyzer = new SpectrumAnalyzer(8192, FS, 'hann');
    const binWidth = FS / 8192;
    const frequency = Math.round(1000 / binWidth) * binWidth;
    const x = sine(frequency, 1 / Math.SQRT2, 8192 / FS, FS);
    const res = analyzer.analyse(x.subarray(0, 8192));
    let best = 0;
    for (let k = 1; k < res.binCount; k++) if (res.levelsDb[k] > res.levelsDb[best]) best = k;
    expect(res.levelsDb[best]).toBeCloseTo(-3.0103, 1);
  });

  it('separates the components of a multi-tone signal', () => {
    const frequencies = [125, 500, 1000, 4000];
    const x = multitone(frequencies, 0.2, 1, FS);
    const { frequencies: axis, levelsDb } = spectrumOf(x, FS, 16384, 'hann');
    for (const target of frequencies) {
      // Find the local peak nearest the expected frequency.
      let best = 1;
      let bestVal = -Infinity;
      for (let k = 1; k < levelsDb.length - 1; k++) {
        if (Math.abs(axis[k] - target) > 20) continue;
        if (levelsDb[k] > bestVal) {
          bestVal = levelsDb[k];
          best = k;
        }
      }
      expect(Math.abs(axis[best] - target)).toBeLessThan(10);
      // Each of 4 equal-power tones carries a quarter of the total power.
      const expected = 20 * Math.log10(0.2) - 10 * Math.log10(4);
      expect(Math.abs(bestVal - expected)).toBeLessThan(1.5);
    }
  });

  it('reports the frequency axis correctly', () => {
    const analyzer = new SpectrumAnalyzer(4096, FS);
    const res = analyzer.analyse(new Float32Array(4096));
    expect(res.binWidth).toBeCloseTo(FS / 4096, 9);
    expect(res.frequencies[0]).toBe(0);
    expect(res.frequencies[res.binCount - 1]).toBeCloseTo(FS / 2, 6);
    expect(res.binCount).toBe(4096 / 2 + 1);
  });

  it('changes window without changing the tone level materially', () => {
    const analyzer = new SpectrumAnalyzer(8192, FS, 'hann');
    const binWidth = FS / 8192;
    const frequency = Math.round(2000 / binWidth) * binWidth;
    const x = sine(frequency, 0.1, 8192 / FS, FS);
    const peaks: number[] = [];
    for (const id of ['hann', 'hamming', 'blackman', 'flat-top'] as const) {
      analyzer.setWindow(id);
      const res = analyzer.analyse(x.subarray(0, 8192));
      let best = 0;
      for (let k = 1; k < res.binCount; k++) if (res.levelsDb[k] > res.levelsDb[best]) best = k;
      peaks.push(res.levelsDb[best]);
    }
    for (const p of peaks) expect(p).toBeCloseTo(20 * Math.log10(0.1), 0);
  });

  it('rejects frames of the wrong length', () => {
    const analyzer = new SpectrumAnalyzer(2048, FS);
    expect(() => analyzer.analyse(new Float32Array(1024))).toThrow();
  });
});

describe('dominantFrequency', () => {
  it.each([100, 315, 1000, 3150, 8000])('finds a %p Hz tone', (frequency) => {
    const x = sine(frequency, 0.2, 1, FS);
    const found = dominantFrequency(x, FS, 16384);
    expect(Math.abs(found - frequency)).toBeLessThan(Math.max(5, frequency * 0.01));
  });

  it('finds a tone buried in noise', () => {
    const tone = sine(1000, 0.2, 2, FS);
    const noise = whiteNoise(0.02, 2, FS, 99);
    const mixed = new Float32Array(tone.length);
    for (let i = 0; i < mixed.length; i++) mixed[i] = tone[i] + noise[i];
    expect(Math.abs(dominantFrequency(mixed, FS, 16384) - 1000)).toBeLessThan(10);
  });
});

describe('spectrumOf', () => {
  it('shows a roughly flat spectrum for white noise', () => {
    const x = whiteNoise(0.1, 2, FS, 7);
    const { frequencies, levelsDb } = spectrumOf(x, FS, 4096, 'hann');
    const inBand: number[] = [];
    for (let k = 0; k < levelsDb.length; k++) {
      if (frequencies[k] >= 200 && frequencies[k] <= 10000) inBand.push(levelsDb[k]);
    }
    const mean = inBand.reduce((a, b) => a + b, 0) / inBand.length;
    // Compare the average of the lower and upper halves of the band.
    const half = Math.floor(inBand.length / 2);
    const lower = inBand.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const upper = inBand.slice(half).reduce((a, b) => a + b, 0) / (inBand.length - half);
    expect(Math.abs(upper - lower)).toBeLessThan(1);
    expect(Number.isFinite(mean)).toBe(true);
  });

  it('shows a falling spectrum for pink noise', () => {
    const x = pinkNoise(0.1, 2, FS, 11);
    const { frequencies, levelsDb } = spectrumOf(x, FS, 4096, 'hann');
    const bandMean = (lo: number, hi: number) => {
      let acc = 0;
      let n = 0;
      for (let k = 0; k < levelsDb.length; k++) {
        if (frequencies[k] >= lo && frequencies[k] <= hi) {
          acc += levelsDb[k];
          n++;
        }
      }
      return acc / n;
    };
    // Pink noise falls 3 dB per octave, so three octaves apart is about 9 dB.
    const low = bandMean(200, 300);
    const high = bandMean(1600, 2400);
    expect(low - high).toBeGreaterThan(6);
    expect(low - high).toBeLessThan(13);
  });
});
