/**
 * A weighting (IEC 61672-1).
 *
 * Public surface for the A weighting: analytic reference, digital design and a
 * ready-to-use stateful filter.
 */

import { BiquadCascade, cascadeMagnitudeDb } from '../biquad';
import { designAWeighting } from './design';
import { aWeightingDb } from './reference';

export { aWeightingDb, designAWeighting };

/** Stateful A weighting filter for the given sample rate. */
export function createAWeightingFilter(sampleRate: number): BiquadCascade {
  return new BiquadCascade(designAWeighting(sampleRate));
}

/** Realised digital A weighting magnitude in dB. */
export function aWeightingDigitalDb(frequency: number, sampleRate: number): number {
  return cascadeMagnitudeDb(designAWeighting(sampleRate), frequency, sampleRate);
}
