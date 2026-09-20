/**
 * Analytic (analog) reference responses for the IEC 61672-1 frequency
 * weightings.
 *
 * These closed-form expressions are the ground truth the digital filters are
 * validated against in `weighting.test.ts`. They are also used to build the
 * frequency-domain correction applied to spectrum displays.
 */

/** Pole frequencies of the A/C weighting networks (IEC 61672-1, Hz). */
export const WEIGHTING_POLES = {
  f1: 20.598997,
  f2: 107.65265,
  f3: 737.86223,
  f4: 12194.217,
} as const;

const { f1, f2, f3, f4 } = WEIGHTING_POLES;

/** Un-normalised magnitude of the A weighting network. */
function rawA(f: number): number {
  const f2sq = f * f;
  return (
    (f4 * f4 * f2sq * f2sq) /
    ((f2sq + f1 * f1) *
      Math.sqrt(f2sq + f2 * f2) *
      Math.sqrt(f2sq + f3 * f3) *
      (f2sq + f4 * f4))
  );
}

/** Un-normalised magnitude of the C weighting network. */
function rawC(f: number): number {
  const f2sq = f * f;
  return (f4 * f4 * f2sq) / ((f2sq + f1 * f1) * (f2sq + f4 * f4));
}

const RAW_A_1K = rawA(1000);
const RAW_C_1K = rawC(1000);

/** Normalisation gains (dB) that make each weighting 0 dB at 1 kHz. */
export const A_NORMALISATION_DB = -20 * Math.log10(RAW_A_1K);
export const C_NORMALISATION_DB = -20 * Math.log10(RAW_C_1K);

/** Exact analog A weighting in dB (0 dB at 1 kHz). */
export function aWeightingDb(frequency: number): number {
  if (frequency <= 0) return -Infinity;
  return 20 * Math.log10(rawA(frequency) / RAW_A_1K);
}

/** Exact analog C weighting in dB (0 dB at 1 kHz). */
export function cWeightingDb(frequency: number): number {
  if (frequency <= 0) return -Infinity;
  return 20 * Math.log10(rawC(frequency) / RAW_C_1K);
}

/** Z (zero) weighting: flat by definition over the 10 Hz .. 20 kHz band. */
export function zWeightingDb(_frequency: number): number {
  return 0;
}

export type WeightingId = 'A' | 'C' | 'Z';

export const WEIGHTING_IDS: readonly WeightingId[] = ['A', 'C', 'Z'] as const;

export const WEIGHTING_LABELS: Record<WeightingId, string> = {
  A: 'A',
  C: 'C',
  Z: 'Z',
};

export const WEIGHTING_UNITS: Record<WeightingId, string> = {
  A: 'dBA',
  C: 'dBC',
  Z: 'dBZ',
};

/** Analytic weighting value in dB for any weighting id. */
export function weightingDb(weighting: WeightingId, frequency: number): number {
  switch (weighting) {
    case 'A':
      return aWeightingDb(frequency);
    case 'C':
      return cWeightingDb(frequency);
    case 'Z':
      return zWeightingDb(frequency);
  }
}

/**
 * Nominal weighting values from IEC 61672-1 Table 3, used for documentation and
 * for the DSP validation report. Values are the published nominal figures.
 */
export const NOMINAL_WEIGHTINGS: ReadonlyArray<{
  frequency: number;
  a: number;
  c: number;
}> = [
  { frequency: 31.5, a: -39.4, c: -3.0 },
  { frequency: 63, a: -26.2, c: -0.8 },
  { frequency: 125, a: -16.1, c: -0.2 },
  { frequency: 250, a: -8.6, c: 0.0 },
  { frequency: 500, a: -3.2, c: 0.0 },
  { frequency: 1000, a: 0.0, c: 0.0 },
  { frequency: 2000, a: 1.2, c: -0.2 },
  { frequency: 4000, a: 1.0, c: -0.8 },
  { frequency: 8000, a: -1.1, c: -3.0 },
  { frequency: 16000, a: -6.6, c: -8.5 },
];
