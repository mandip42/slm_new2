/**
 * Deterministic synthetic signal generators.
 *
 * These drive both the automated DSP test suite and the developer DSP lab, so
 * the exact same processing chain that handles microphone audio can be validated
 * against signals with known properties. Every random generator is seeded so
 * tests are reproducible.
 */

export type SignalType =
  | 'sine'
  | 'multitone'
  | 'white-noise'
  | 'pink-noise'
  | 'impulse'
  | 'sweep'
  | 'square'
  | 'silence'
  | 'burst';

export const SIGNAL_TYPES: readonly SignalType[] = [
  'sine',
  'multitone',
  'white-noise',
  'pink-noise',
  'impulse',
  'sweep',
  'square',
  'burst',
  'silence',
] as const;

export const SIGNAL_LABELS: Record<SignalType, string> = {
  sine: 'Sine',
  multitone: 'Multi-tone',
  'white-noise': 'White noise',
  'pink-noise': 'Pink noise',
  impulse: 'Impulse',
  sweep: 'Log sweep',
  square: 'Square',
  burst: 'Gated burst',
  silence: 'Silence',
};

/** Small, fast, seeded PRNG (mulberry32) so noise signals are reproducible. */
export function createRng(seed = 0x9e3779b9): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sine wave with a given RMS amplitude.
 *
 * Specifying RMS rather than peak makes the expected level unambiguous:
 * level = 20*log10(rmsAmplitude) dBFS.
 */
export function sine(
  frequency: number,
  rmsAmplitude: number,
  durationSeconds: number,
  sampleRate: number,
  phase = 0
): Float32Array {
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float32Array(n);
  const peak = rmsAmplitude * Math.SQRT2;
  const w = (2 * Math.PI * frequency) / sampleRate;
  for (let i = 0; i < n; i++) out[i] = peak * Math.sin(w * i + phase);
  return out;
}

/** Sum of equal-RMS tones; total RMS equals `totalRmsAmplitude`. */
export function multitone(
  frequencies: readonly number[],
  totalRmsAmplitude: number,
  durationSeconds: number,
  sampleRate: number
): Float32Array {
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float32Array(n);
  if (frequencies.length === 0) return out;
  // Incoherent tones add in power, so each tone gets total/sqrt(count).
  const perTone = (totalRmsAmplitude / Math.sqrt(frequencies.length)) * Math.SQRT2;
  for (let k = 0; k < frequencies.length; k++) {
    const w = (2 * Math.PI * frequencies[k]) / sampleRate;
    // Distinct phases avoid an artificially high crest factor.
    const phase = (Math.PI * 2 * k) / frequencies.length;
    for (let i = 0; i < n; i++) out[i] += perTone * Math.sin(w * i + phase);
  }
  return out;
}

/** Gaussian white noise with the requested RMS amplitude. */
export function whiteNoise(
  rmsAmplitude: number,
  durationSeconds: number,
  sampleRate: number,
  seed = 12345
): Float32Array {
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float32Array(n);
  const rng = createRng(seed);
  for (let i = 0; i < n; i += 2) {
    // Box-Muller
    const u1 = Math.max(rng(), Number.MIN_VALUE);
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    out[i] = r * Math.cos(theta) * rmsAmplitude;
    if (i + 1 < n) out[i + 1] = r * Math.sin(theta) * rmsAmplitude;
  }
  return normaliseRms(out, rmsAmplitude);
}

/**
 * Pink noise (-3 dB/octave) using the Paul Kellett filter, then RMS-normalised.
 */
export function pinkNoise(
  rmsAmplitude: number,
  durationSeconds: number,
  sampleRate: number,
  seed = 6789
): Float32Array {
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float32Array(n);
  const rng = createRng(seed);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < n; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
  }
  return normaliseRms(out, rmsAmplitude);
}

/** Single-sample impulse at `atSeconds`. */
export function impulse(
  peakAmplitude: number,
  durationSeconds: number,
  sampleRate: number,
  atSeconds = 0.1
): Float32Array {
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float32Array(n);
  const idx = Math.min(n - 1, Math.max(0, Math.round(atSeconds * sampleRate)));
  out[idx] = peakAmplitude;
  return out;
}

/** Logarithmic sine sweep. */
export function logSweep(
  startHz: number,
  endHz: number,
  rmsAmplitude: number,
  durationSeconds: number,
  sampleRate: number
): Float32Array {
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float32Array(n);
  const peak = rmsAmplitude * Math.SQRT2;
  const k = Math.log(endHz / startHz);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const phase = ((2 * Math.PI * startHz * durationSeconds) / k) * (Math.exp((k * t) / durationSeconds) - 1);
    out[i] = peak * Math.sin(phase);
  }
  return out;
}

/** Square wave with the requested RMS amplitude (RMS == peak for a square). */
export function square(
  frequency: number,
  rmsAmplitude: number,
  durationSeconds: number,
  sampleRate: number
): Float32Array {
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float32Array(n);
  const period = sampleRate / frequency;
  for (let i = 0; i < n; i++) {
    out[i] = i % period < period / 2 ? rmsAmplitude : -rmsAmplitude;
  }
  return out;
}

/** Silence. */
export function silence(durationSeconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.round(durationSeconds * sampleRate));
}

/**
 * Gated tone burst: `onSeconds` of tone followed by `offSeconds` of silence,
 * repeated. Used to exercise the Fast/Slow/Impulse detectors.
 */
export function burst(
  frequency: number,
  rmsAmplitude: number,
  onSeconds: number,
  offSeconds: number,
  durationSeconds: number,
  sampleRate: number
): Float32Array {
  const n = Math.round(durationSeconds * sampleRate);
  const out = new Float32Array(n);
  const peak = rmsAmplitude * Math.SQRT2;
  const w = (2 * Math.PI * frequency) / sampleRate;
  const onSamples = Math.round(onSeconds * sampleRate);
  const cycleSamples = Math.max(1, Math.round((onSeconds + offSeconds) * sampleRate));
  for (let i = 0; i < n; i++) {
    if (i % cycleSamples < onSamples) out[i] = peak * Math.sin(w * i);
  }
  return out;
}

/** Scale a signal so its RMS equals `target` exactly. */
export function normaliseRms(signal: Float32Array, target: number): Float32Array {
  let acc = 0;
  for (let i = 0; i < signal.length; i++) acc += signal[i] * signal[i];
  const current = Math.sqrt(acc / signal.length);
  if (current === 0 || target === 0) return signal;
  const k = target / current;
  for (let i = 0; i < signal.length; i++) signal[i] *= k;
  return signal;
}

export interface SignalSpec {
  type: SignalType;
  frequency: number;
  /** RMS amplitude for continuous signals, peak amplitude for impulses. */
  amplitude: number;
  durationSeconds: number;
  sampleRate: number;
  /** Extra tones for the multi-tone generator. */
  frequencies?: number[];
  sweepEndHz?: number;
  seed?: number;
  burstOnSeconds?: number;
  burstOffSeconds?: number;
}

/** Generate a signal from a declarative spec (used by the developer lab). */
export function generateSignal(spec: SignalSpec): Float32Array {
  const { type, frequency, amplitude, durationSeconds, sampleRate } = spec;
  switch (type) {
    case 'sine':
      return sine(frequency, amplitude, durationSeconds, sampleRate);
    case 'multitone':
      return multitone(
        spec.frequencies ?? [125, 500, 1000, 4000],
        amplitude,
        durationSeconds,
        sampleRate
      );
    case 'white-noise':
      return whiteNoise(amplitude, durationSeconds, sampleRate, spec.seed);
    case 'pink-noise':
      return pinkNoise(amplitude, durationSeconds, sampleRate, spec.seed);
    case 'impulse':
      return impulse(amplitude, durationSeconds, sampleRate);
    case 'sweep':
      return logSweep(
        Math.max(10, frequency),
        Math.min(spec.sweepEndHz ?? 20000, sampleRate / 2 - 1),
        amplitude,
        durationSeconds,
        sampleRate
      );
    case 'square':
      return square(frequency, amplitude, durationSeconds, sampleRate);
    case 'burst':
      return burst(
        frequency,
        amplitude,
        spec.burstOnSeconds ?? 0.2,
        spec.burstOffSeconds ?? 0.8,
        durationSeconds,
        sampleRate
      );
    case 'silence':
      return silence(durationSeconds, sampleRate);
  }
}
