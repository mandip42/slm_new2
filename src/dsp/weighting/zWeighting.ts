/**
 * Z ("zero") weighting.
 *
 * Z weighting is defined as a flat response across the 10 Hz .. 20 kHz band. It
 * is implemented as a true pass-through (empty filter cascade) so that no
 * numerical error is introduced on the unweighted measurement path. The optional
 * 10 Hz DC/infrasound blocker on the acquisition path is a separate, explicitly
 * reported stage — see `designHighPass` in ./design.
 */

import { BiquadCascade } from '../biquad';
import { designZWeighting } from './design';
import { zWeightingDb } from './reference';

export { zWeightingDb, designZWeighting };

/** Nominal flat band limits of Z weighting. */
export const Z_WEIGHTING_BAND_HZ = { low: 10, high: 20000 } as const;

/** Stateful (pass-through) Z weighting filter. */
export function createZWeightingFilter(sampleRate: number): BiquadCascade {
  return new BiquadCascade(designZWeighting(sampleRate));
}
