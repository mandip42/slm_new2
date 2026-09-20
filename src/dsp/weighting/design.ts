/**
 * Digital design of the IEC 61672-1 A, C and Z frequency weightings.
 *
 * The weightings are real IIR filters that operate on the sample stream — they
 * are NOT cosmetic offsets applied to a displayed number. Each analog
 * pole/zero group is bilinear-transformed into its own biquad section and the
 * complete cascade is then numerically normalised so that the digital response
 * is exactly 0 dB at 1 kHz for the active sample rate.
 *
 * Analog prototypes (w_n = 2*pi*f_n):
 *
 *   A:  s^4 / [ (s+w1)^2 (s+w2)(s+w3) (s+w4)^2 ]      -> 3 biquad sections
 *   C:  s^2 / [ (s+w1)^2 (s+w4)^2 ]                    -> 2 biquad sections
 *   Z:  1                                              -> no sections
 *
 *
 * HIGH-FREQUENCY ACCURACY
 * -----------------------
 * The bilinear transform compresses the frequency axis towards Nyquist. Because
 * the A/C networks have a double pole at f4 = 12.194 kHz — which at a 48 kHz
 * sample rate sits at a quarter of the sample rate — a naive bilinear transform
 * places that pole far too low and the digital response sags badly at high
 * frequency. Measured against the exact analog prototype at 48 kHz:
 *
 *     4 kHz  -0.04 dB      10 kHz  -1.22 dB
 *     8 kHz  -0.54 dB      12.5 kHz -2.67 dB      16 kHz  -6.43 dB
 *
 * That is not good enough to call the filter a correct A weighting. AcousticLab
 * therefore places the f4 double pole at the frequency that minimises the worst
 * deviation from the exact analog response over 20 Hz .. min(12.5 kHz, 0.28*fs),
 * solved numerically at design time for the active sample rate. The residual
 * error at 48 kHz becomes:
 *
 *     up to 12.5 kHz  <= 0.36 dB       16 kHz  -4.2 dB
 *
 * The optimisation is a property of the *design*, not a correction applied to a
 * measured number: the filter that runs on the audio is exactly the filter whose
 * response is reported. The residual deviation is measured by the automated DSP
 * test suite and tabulated in DSP_VALIDATION.md, and levels above 12.5 kHz are
 * flagged as reduced accuracy in the application rather than presented as exact.
 */

import {
  type BiquadCoefficients,
  BiquadCascade,
  bilinearSection,
  cascadeMagnitudeDb,
  normaliseCascadeAt,
} from '../biquad';
import { WEIGHTING_POLES, aWeightingDb, cWeightingDb, type WeightingId } from './reference';

const TWO_PI = 2 * Math.PI;

const w1 = TWO_PI * WEIGHTING_POLES.f1;
const w2 = TWO_PI * WEIGHTING_POLES.f2;
const w3 = TWO_PI * WEIGHTING_POLES.f3;

/** Reference frequency at which every weighting is forced to 0 dB. */
export const WEIGHTING_REFERENCE_FREQUENCY = 1000;

/**
 * Upper edge of the range the HF pole optimisation is fitted over.
 *
 * 12.6 kHz rather than the nominal 12.5 kHz because the fit grid uses *exact*
 * midband frequencies, and the exact centre of the band labelled 12.5 kHz is
 * 12589 Hz. A limit of 12500 would have excluded that band from the fit while the
 * application still claimed accuracy up to 12.5 kHz — an overstatement of about
 * 0.6 dB at exactly the frequency being claimed.
 *
 * The Nyquist fraction keeps the fit clear of the region where bilinear warping is
 * unrecoverable, while still admitting the 12.5 kHz band at 44.1 kHz
 * (12589 / 44100 = 0.286).
 */
export const WEIGHTING_FIT_UPPER_HZ = 12600;
export const WEIGHTING_FIT_NYQUIST_FRACTION = 0.29;

/** Lower edge of the fit range (the Z-weighting lower band limit). */
export const WEIGHTING_FIT_LOWER_HZ = 20;

/**
 * How the f4 double pole is placed.
 *  - 'minimax': numerically optimised (default, best accuracy)
 *  - 'prewarp': pole pre-warped with 2*fs*tan(pi*f/fs)
 *  - 'none'   : plain bilinear transform of the analog pole
 */
export type HfPolePlacement = 'minimax' | 'prewarp' | 'none';

export const DEFAULT_HF_POLE_PLACEMENT: HfPolePlacement = 'minimax';

export interface WeightingDesign {
  sections: BiquadCoefficients[];
  /** Frequency (Hz) the f4 double pole was placed at. */
  hfPoleHz: number;
  placement: HfPolePlacement;
  /** Worst absolute deviation from the analog prototype over the fit range. */
  maxFitErrorDb: number;
  fitRange: { lowHz: number; highHz: number };
  sampleRate: number;
}

function assertSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 768000) {
    throw new RangeError(`Unsupported sample rate for weighting design: ${sampleRate}`);
  }
}

function fitUpper(sampleRate: number): number {
  return Math.min(WEIGHTING_FIT_UPPER_HZ, WEIGHTING_FIT_NYQUIST_FRACTION * sampleRate);
}

/** Evaluation grid: 1/3-octave centres plus half-steps across the fit range. */
function fitGrid(sampleRate: number): number[] {
  const high = fitUpper(sampleRate);
  const out: number[] = [];
  for (let n = -17; n <= 13; n++) {
    for (const sub of [-0.5, 0, 0.5]) {
      const f = 1000 * Math.pow(10, (3 * (n + sub)) / 30);
      if (f >= WEIGHTING_FIT_LOWER_HZ && f <= high) out.push(f);
    }
  }
  return out;
}

/**
 * Highest frequency the fit actually covers.
 *
 * This is the largest grid point, not the nominal limit, so the accuracy claim
 * made by the application matches the frequencies the optimisation was evaluated
 * at. Reporting the nominal limit instead would overstate the validated range
 * whenever the limit falls between two grid points.
 */
function fitUpperAchieved(sampleRate: number): number {
  const grid = fitGrid(sampleRate);
  return grid.length > 0 ? grid[grid.length - 1] : WEIGHTING_FIT_LOWER_HZ;
}

type SectionBuilder = (hfPoleRadPerSec: number, sampleRate: number) => BiquadCoefficients[];

const buildASections: SectionBuilder = (W4, fs) =>
  normaliseCascadeAt(
    [
      // s^2 / (s + w1)^2  — double real pole at 20.6 Hz (high-pass pair)
      bilinearSection([1, 0, 0], [1, 2 * w1, w1 * w1], fs),
      // s^2 / (s + W4)^2  — double real pole near 12.2 kHz (high-pass pair)
      bilinearSection([1, 0, 0], [1, 2 * W4, W4 * W4], fs),
      // 1 / [(s + w2)(s + w3)] — the two single poles (low-pass pair)
      bilinearSection([0, 0, 1], [1, w2 + w3, w2 * w3], fs),
    ],
    WEIGHTING_REFERENCE_FREQUENCY,
    fs
  );

const buildCSections: SectionBuilder = (W4, fs) =>
  normaliseCascadeAt(
    [
      bilinearSection([1, 0, 0], [1, 2 * w1, w1 * w1], fs),
      bilinearSection([0, 0, 1], [1, 2 * W4, W4 * W4], fs),
    ],
    WEIGHTING_REFERENCE_FREQUENCY,
    fs
  );

function worstError(
  sections: BiquadCoefficients[],
  sampleRate: number,
  grid: readonly number[],
  reference: (f: number) => number
): number {
  let worst = 0;
  for (const f of grid) {
    const e = Math.abs(cascadeMagnitudeDb(sections, f, sampleRate) - reference(f));
    if (e > worst) worst = e;
  }
  return worst;
}

/**
 * Minimise the worst-case deviation by moving the f4 double pole.
 *
 * A coarse scan brackets the minimum and a golden-section search refines it.
 * Total cost is a few thousand complex evaluations (about a millisecond), and
 * the result is cached per sample rate, so this is safe to run in an
 * AudioWorklet constructor.
 */
function optimiseHfPole(
  build: SectionBuilder,
  sampleRate: number,
  reference: (f: number) => number
): { hfPoleHz: number; error: number } {
  const grid = fitGrid(sampleRate);
  const objective = (hz: number) => worstError(build(TWO_PI * hz, sampleRate), sampleRate, grid, reference);

  const nyquist = sampleRate / 2;
  const lo = WEIGHTING_POLES.f4 * 0.9;
  const hi = Math.min(WEIGHTING_POLES.f4 * 2.2, nyquist * 0.999);
  if (!(hi > lo)) {
    return { hfPoleHz: WEIGHTING_POLES.f4, error: objective(WEIGHTING_POLES.f4) };
  }

  // Coarse scan
  const steps = 24;
  let bestHz = lo;
  let bestErr = Infinity;
  for (let i = 0; i <= steps; i++) {
    const hz = lo + ((hi - lo) * i) / steps;
    const e = objective(hz);
    if (e < bestErr) {
      bestErr = e;
      bestHz = hz;
    }
  }

  // Golden-section refinement inside the bracketing interval
  const span = (hi - lo) / steps;
  let a = Math.max(lo, bestHz - span);
  let b = Math.min(hi, bestHz + span);
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = objective(c);
  let fd = objective(d);
  for (let i = 0; i < 40 && b - a > 0.05; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = objective(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = objective(d);
    }
  }
  const refined = fc < fd ? c : d;
  const refinedErr = Math.min(fc, fd);
  if (refinedErr < bestErr) {
    bestErr = refinedErr;
    bestHz = refined;
  }
  return { hfPoleHz: bestHz, error: bestErr };
}

function hfPoleFrequency(
  placement: HfPolePlacement,
  build: SectionBuilder,
  sampleRate: number,
  reference: (f: number) => number
): { hfPoleHz: number; error: number } {
  switch (placement) {
    case 'none': {
      const hz = WEIGHTING_POLES.f4;
      return {
        hfPoleHz: hz,
        error: worstError(build(TWO_PI * hz, sampleRate), sampleRate, fitGrid(sampleRate), reference),
      };
    }
    case 'prewarp': {
      const hz = (2 * sampleRate * Math.tan((Math.PI * WEIGHTING_POLES.f4) / sampleRate)) / TWO_PI;
      return {
        hfPoleHz: hz,
        error: worstError(build(TWO_PI * hz, sampleRate), sampleRate, fitGrid(sampleRate), reference),
      };
    }
    case 'minimax':
      return optimiseHfPole(build, sampleRate, reference);
  }
}

const designCache = new Map<string, WeightingDesign>();

function buildDesign(
  weighting: 'A' | 'C',
  sampleRate: number,
  placement: HfPolePlacement
): WeightingDesign {
  const key = `${weighting}:${sampleRate}:${placement}`;
  const hit = designCache.get(key);
  if (hit) return hit;

  const build = weighting === 'A' ? buildASections : buildCSections;
  const reference = weighting === 'A' ? aWeightingDb : cWeightingDb;
  const { hfPoleHz, error } = hfPoleFrequency(placement, build, sampleRate, reference);
  const design: WeightingDesign = {
    sections: build(TWO_PI * hfPoleHz, sampleRate),
    hfPoleHz,
    placement,
    maxFitErrorDb: error,
    fitRange: { lowHz: WEIGHTING_FIT_LOWER_HZ, highHz: fitUpperAchieved(sampleRate) },
    sampleRate,
  };
  designCache.set(key, design);
  return design;
}

/** Full A-weighting design record (sections plus fit diagnostics). */
export function aWeightingDesign(
  sampleRate: number,
  placement: HfPolePlacement = DEFAULT_HF_POLE_PLACEMENT
): WeightingDesign {
  assertSampleRate(sampleRate);
  return buildDesign('A', sampleRate, placement);
}

/** Full C-weighting design record. */
export function cWeightingDesign(
  sampleRate: number,
  placement: HfPolePlacement = DEFAULT_HF_POLE_PLACEMENT
): WeightingDesign {
  assertSampleRate(sampleRate);
  return buildDesign('C', sampleRate, placement);
}

/** A-weighting sections for the given sample rate. */
export function designAWeighting(
  sampleRate: number,
  placement: HfPolePlacement = DEFAULT_HF_POLE_PLACEMENT
): BiquadCoefficients[] {
  return aWeightingDesign(sampleRate, placement).sections;
}

/** C-weighting sections for the given sample rate. */
export function designCWeighting(
  sampleRate: number,
  placement: HfPolePlacement = DEFAULT_HF_POLE_PLACEMENT
): BiquadCoefficients[] {
  return cWeightingDesign(sampleRate, placement).sections;
}

/**
 * Z-weighting: flat. Returned as an empty cascade so no filtering work and no
 * numerical error is introduced on the Z path.
 */
export function designZWeighting(_sampleRate: number): BiquadCoefficients[] {
  return [];
}

export function designWeighting(
  weighting: WeightingId,
  sampleRate: number,
  placement: HfPolePlacement = DEFAULT_HF_POLE_PLACEMENT
): BiquadCoefficients[] {
  switch (weighting) {
    case 'A':
      return designAWeighting(sampleRate, placement);
    case 'C':
      return designCWeighting(sampleRate, placement);
    case 'Z':
      return designZWeighting(sampleRate);
  }
}

/** Convenience: a ready-to-run stateful cascade for a weighting. */
export function createWeightingFilter(
  weighting: WeightingId,
  sampleRate: number
): BiquadCascade {
  return new BiquadCascade(designWeighting(weighting, sampleRate));
}

/** Realised digital magnitude response of a weighting, in dB. */
export function weightingResponseDb(
  weighting: WeightingId,
  frequency: number,
  sampleRate: number,
  placement: HfPolePlacement = DEFAULT_HF_POLE_PLACEMENT
): number {
  const sections = designWeighting(weighting, sampleRate, placement);
  if (sections.length === 0) return 0;
  return cascadeMagnitudeDb(sections, frequency, sampleRate);
}

/**
 * Second-order Butterworth high-pass, used as an optional DC / infrasound
 * blocker on the acquisition path.
 *
 * Phone microphones frequently exhibit a DC offset and large sub-audio content
 * from handling and wind. Removing it below the 10 Hz lower limit of the Z
 * weighting band improves the stability of every downstream metric. The filter
 * is user-switchable and its state is reported on the diagnostics screen.
 */
export function designHighPass(
  cutoffHz: number,
  sampleRate: number,
  q = Math.SQRT1_2
): BiquadCoefficients {
  const w0 = (TWO_PI * cutoffHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosW0) / 2 / a0,
    b1: -(1 + cosW0) / a0,
    b2: (1 + cosW0) / 2 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  };
}

export const DEFAULT_DC_BLOCK_HZ = 10;

/**
 * Frequency above which the digital weighting deviates from the analog prototype
 * by more than the fit tolerance. Displayed levels dominated by content above
 * this frequency are flagged as reduced accuracy.
 */
export function weightingAccurateUpToHz(sampleRate: number): number {
  return fitUpperAchieved(sampleRate);
}
