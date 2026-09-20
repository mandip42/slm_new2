/**
 * Radix-2 in-place complex FFT plus a real-signal spectrum helper.
 *
 * The FFT is written as a reusable, pre-planned object: twiddle factors and the
 * bit-reversal permutation are computed once per size and the transform itself
 * allocates nothing. That matters because the spectrum is recomputed many times
 * per second inside a Web Worker.
 *
 * IMPORTANT CONCEPTUAL NOTE
 * -------------------------
 * The values produced here are FFT *spectral amplitudes* of the windowed frame.
 * They are NOT octave-band sound pressure levels. Band levels come exclusively
 * from the filter bank in ./octave.ts. The two are kept in separate modules on
 * purpose.
 */

import { amplitudeToDb } from './levels';
import { type AnalysisWindow, type WindowId, createWindow } from './window';

export const FFT_SIZES = [2048, 4096, 8192, 16384] as const;
export type FftSize = (typeof FFT_SIZES)[number];

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export class Fft {
  readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (!isPowerOfTwo(size)) throw new RangeError(`FFT size must be a power of two: ${size}`);
    this.size = size;

    const half = size >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / size);
    }

    const levels = Math.round(Math.log2(size));
    this.reverse = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < levels; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.reverse[i] = r;
    }
  }

  /**
   * In-place forward transform. `re` and `im` must both have length `size`.
   */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    if (re.length !== n || im.length !== n) {
      throw new RangeError('FFT input length mismatch');
    }

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }

    // Cooley-Tukey butterflies
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const cos = this.cosTable[k];
          const sin = this.sinTable[k];
          const a = i + j;
          const b = a + half;
          const tre = re[b] * cos + im[b] * sin;
          const tim = im[b] * cos - re[b] * sin;
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }
  }
}

const fftCache = new Map<number, Fft>();

export function getFft(size: number): Fft {
  let f = fftCache.get(size);
  if (!f) {
    f = new Fft(size);
    fftCache.set(size, f);
  }
  return f;
}

export interface SpectrumResult {
  /** Number of usable bins (0 .. size/2 inclusive). */
  binCount: number;
  /** Level of each bin in dBFS, using the same RMS reference as the meter. */
  levelsDb: Float32Array;
  /** Frequency of each bin in Hz. */
  frequencies: Float32Array;
  /** Hz per bin. */
  binWidth: number;
  sampleRate: number;
  fftSize: number;
  window: WindowId;
}

/**
 * Reusable real-signal spectrum analyser.
 *
 * Amplitude scaling: for a windowed frame the amplitude of a tone landing on
 * bin k is  A = 2 * |X_k| / (N * coherentGain). The reported level is the RMS
 * level of that tone, i.e. 20*log10(A / sqrt(2)), so that a full-scale sine
 * reads the same -3.01 dBFS as on the sound level meter.
 */
export class SpectrumAnalyzer {
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly levels: Float32Array;
  private readonly frequencies: Float32Array;
  private readonly fft: Fft;
  private win: AnalysisWindow;

  readonly fftSize: number;
  readonly sampleRate: number;
  readonly binCount: number;

  constructor(fftSize: number, sampleRate: number, windowId: WindowId = 'hann') {
    this.fftSize = fftSize;
    this.sampleRate = sampleRate;
    this.fft = getFft(fftSize);
    this.win = createWindow(windowId, fftSize);
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
    this.binCount = fftSize / 2 + 1;
    this.levels = new Float32Array(this.binCount);
    this.frequencies = new Float32Array(this.binCount);
    for (let i = 0; i < this.binCount; i++) {
      this.frequencies[i] = (i * sampleRate) / fftSize;
    }
  }

  setWindow(windowId: WindowId): void {
    this.win = createWindow(windowId, this.fftSize);
  }

  get windowId(): WindowId {
    return this.win.id;
  }

  get binWidth(): number {
    return this.sampleRate / this.fftSize;
  }

  /**
   * Analyse one frame. `frame` must contain exactly `fftSize` samples.
   * The returned arrays are owned by the analyser and are overwritten on the
   * next call — copy them if they need to outlive it.
   */
  analyse(frame: Float32Array | Float64Array): SpectrumResult {
    const n = this.fftSize;
    if (frame.length !== n) throw new RangeError('Frame length must equal fftSize');
    const w = this.win.samples;
    for (let i = 0; i < n; i++) {
      this.re[i] = frame[i] * w[i];
      this.im[i] = 0;
    }
    this.fft.transform(this.re, this.im);

    const scale = 2 / (n * this.win.coherentGain);
    const rmsScale = scale / Math.SQRT2;
    for (let k = 0; k < this.binCount; k++) {
      // DC and Nyquist are not duplicated in the two-sided spectrum.
      const single = k === 0 || k === n / 2 ? 0.5 : 1;
      const mag = Math.hypot(this.re[k], this.im[k]) * rmsScale * single;
      this.levels[k] = amplitudeToDb(mag);
    }

    return {
      binCount: this.binCount,
      levelsDb: this.levels,
      frequencies: this.frequencies,
      binWidth: this.binWidth,
      sampleRate: this.sampleRate,
      fftSize: n,
      window: this.win.id,
    };
  }

  /** Index of the highest bin, with parabolic interpolation of the peak frequency. */
  findPeak(levelsDb: Float32Array = this.levels): { frequency: number; levelDb: number } {
    let best = 1;
    for (let k = 1; k < this.binCount - 1; k++) {
      if (levelsDb[k] > levelsDb[best]) best = k;
    }
    const yl = levelsDb[best - 1];
    const y0 = levelsDb[best];
    const yr = levelsDb[best + 1] ?? y0;
    const denom = yl - 2 * y0 + yr;
    const delta = denom !== 0 ? (0.5 * (yl - yr)) / denom : 0;
    const clamped = Math.max(-0.5, Math.min(0.5, delta));
    return {
      frequency: ((best + clamped) * this.sampleRate) / this.fftSize,
      levelDb: y0 - 0.25 * (yl - yr) * clamped,
    };
  }
}

/**
 * One-shot spectrum of a signal (used by tests and the developer lab).
 * Averages successive frames in the power domain (Welch style) when the signal
 * is longer than one frame.
 */
export function spectrumOf(
  signal: Float32Array | Float64Array,
  sampleRate: number,
  fftSize = 8192,
  windowId: WindowId = 'hann',
  overlap = 0.5
): { frequencies: Float32Array; levelsDb: Float32Array; frames: number } {
  const size = Math.min(fftSize, prevPowerOfTwo(signal.length));
  const analyzer = new SpectrumAnalyzer(size, sampleRate, windowId);
  const hop = Math.max(1, Math.round(size * (1 - overlap)));
  const power = new Float64Array(analyzer.binCount);
  let frames = 0;
  const frame = new Float64Array(size);
  for (let start = 0; start + size <= signal.length; start += hop) {
    for (let i = 0; i < size; i++) frame[i] = signal[start + i];
    const res = analyzer.analyse(frame);
    for (let k = 0; k < res.binCount; k++) {
      power[k] += Math.pow(10, res.levelsDb[k] / 10);
    }
    frames++;
  }
  const levelsDb = new Float32Array(analyzer.binCount);
  const frequencies = new Float32Array(analyzer.binCount);
  for (let k = 0; k < analyzer.binCount; k++) {
    levelsDb[k] = frames > 0 ? 10 * Math.log10(power[k] / frames) : -Infinity;
    frequencies[k] = (k * sampleRate) / size;
  }
  return { frequencies, levelsDb, frames };
}

function prevPowerOfTwo(n: number): number {
  if (n < 1) return 1;
  return Math.pow(2, Math.floor(Math.log2(n)));
}

/** Peak frequency of a signal, from its averaged spectrum. */
export function dominantFrequency(
  signal: Float32Array | Float64Array,
  sampleRate: number,
  fftSize = 8192
): number {
  const { frequencies, levelsDb } = spectrumOf(signal, sampleRate, fftSize, 'hann');
  let best = 1;
  for (let k = 1; k < levelsDb.length - 1; k++) {
    if (levelsDb[k] > levelsDb[best]) best = k;
  }
  const yl = levelsDb[best - 1];
  const y0 = levelsDb[best];
  const yr = levelsDb[best + 1] ?? y0;
  const denom = yl - 2 * y0 + yr;
  const delta = denom !== 0 ? (0.5 * (yl - yr)) / denom : 0;
  const binWidth = frequencies[1] - frequencies[0];
  return frequencies[best] + Math.max(-0.5, Math.min(0.5, delta)) * binWidth;
}
