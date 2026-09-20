/**
 * Analysis windows for the FFT analyser.
 *
 * Each window is supplied with the two correction factors that matter for
 * quantitative spectrum analysis:
 *
 *  - coherentGain     = mean(w)            -> corrects the amplitude of a tone
 *  - noisePowerBandwidth (NPB, in bins)
 *                     = N*sum(w^2)/sum(w)^2 -> corrects broadband/noise density
 *
 * Using the wrong factor is a classic source of several-dB spectrum errors, so
 * both are computed from the actual window samples rather than tabulated.
 */

export type WindowId =
  | 'rectangular'
  | 'hann'
  | 'hamming'
  | 'blackman'
  | 'blackman-harris'
  | 'flat-top';

export const WINDOW_IDS: readonly WindowId[] = [
  'hann',
  'hamming',
  'blackman',
  'blackman-harris',
  'flat-top',
  'rectangular',
] as const;

export const WINDOW_LABELS: Record<WindowId, string> = {
  rectangular: 'Rectangular',
  hann: 'Hann',
  hamming: 'Hamming',
  blackman: 'Blackman',
  'blackman-harris': 'Blackman-Harris',
  'flat-top': 'Flat-top',
};

export interface AnalysisWindow {
  id: WindowId;
  size: number;
  samples: Float64Array;
  /** mean(w) — amplitude correction for coherent (tonal) signals. */
  coherentGain: number;
  /** Equivalent noise bandwidth in FFT bins. */
  noisePowerBandwidth: number;
}

function cosineSum(size: number, coefficients: readonly number[]): Float64Array {
  const w = new Float64Array(size);
  const denom = size - 1;
  for (let n = 0; n < size; n++) {
    let v = 0;
    for (let k = 0; k < coefficients.length; k++) {
      v += (k % 2 === 0 ? 1 : -1) * coefficients[k] * Math.cos((2 * Math.PI * k * n) / denom);
    }
    w[n] = v;
  }
  return w;
}

function rawWindow(id: WindowId, size: number): Float64Array {
  switch (id) {
    case 'rectangular': {
      const w = new Float64Array(size);
      w.fill(1);
      return w;
    }
    case 'hann':
      return cosineSum(size, [0.5, 0.5]);
    case 'hamming':
      return cosineSum(size, [0.54, 0.46]);
    case 'blackman':
      return cosineSum(size, [0.42, 0.5, 0.08]);
    case 'blackman-harris':
      return cosineSum(size, [0.35875, 0.48829, 0.14128, 0.01168]);
    case 'flat-top':
      return cosineSum(size, [0.21557895, 0.41663158, 0.277263158, 0.083578947, 0.006947368]);
  }
}

const cache = new Map<string, AnalysisWindow>();

export function createWindow(id: WindowId, size: number): AnalysisWindow {
  const key = `${id}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const samples = rawWindow(id, size);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < size; i++) {
    sum += samples[i];
    sumSq += samples[i] * samples[i];
  }
  const win: AnalysisWindow = {
    id,
    size,
    samples,
    coherentGain: sum / size,
    noisePowerBandwidth: (size * sumSq) / (sum * sum),
  };
  cache.set(key, win);
  return win;
}
