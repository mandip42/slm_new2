/**
 * C weighting (IEC 61672-1).
 */

import { BiquadCascade, cascadeMagnitudeDb } from '../biquad';
import { designCWeighting } from './design';
import { cWeightingDb } from './reference';

export { cWeightingDb, designCWeighting };

/** Stateful C weighting filter for the given sample rate. */
export function createCWeightingFilter(sampleRate: number): BiquadCascade {
  return new BiquadCascade(designCWeighting(sampleRate));
}

/** Realised digital C weighting magnitude in dB. */
export function cWeightingDigitalDb(frequency: number, sampleRate: number): number {
  return cascadeMagnitudeDb(designCWeighting(sampleRate), frequency, sampleRate);
}
