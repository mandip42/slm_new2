/**
 * One-third-octave analysis entry point.
 *
 * Thin, explicit surface over the shared fractional-octave machinery in
 * ./octave.ts so that call sites read clearly.
 */

import {
  type BandDefinition,
  type BankBand,
  DEFAULT_BANK_ORDER,
  FractionalOctaveBank,
  octaveBandDefinitions,
  octaveGroups,
  resolveBankBands,
  thirdOctaveBandDefinitions,
} from './octave';

export { thirdOctaveBandDefinitions, octaveBandDefinitions };

/** Create a one-third-octave filter bank for a sample rate. */
export function createThirdOctaveBank(
  sampleRate: number,
  order: number = DEFAULT_BANK_ORDER
): FractionalOctaveBank {
  return new FractionalOctaveBank(thirdOctaveBandDefinitions(), sampleRate, 3, order);
}

export interface OctaveBandPlan {
  thirdBands: BankBand[];
  octaveBands: BankBand[];
  /** For each octave band, the indices of its constituent 1/3-octave bands. */
  groups: number[][];
}

/**
 * Pre-computed band layout for a sample rate: the 1/3-octave bands actually
 * measured, the octave bands derived from them, and the grouping between them.
 */
export function createBandPlan(sampleRate: number): OctaveBandPlan {
  const thirdDefs: BandDefinition[] = thirdOctaveBandDefinitions();
  const octaveDefs: BandDefinition[] = octaveBandDefinitions();
  const thirdBands = resolveBankBands(thirdDefs, sampleRate);
  const groups = octaveGroups(thirdDefs, octaveDefs);
  // An octave band is available when at least one third contributes; the UI
  // flags partial octaves using `contributingBands` from the summation.
  const octaveBands = octaveDefs.map((d, i) => {
    const members = groups[i];
    const availableMembers = members.filter((pos) => thirdBands[pos].available).length;
    if (availableMembers === 0) {
      return {
        ...d,
        available: false,
        unavailableReason: `No usable 1/3-octave bands at ${sampleRate} Hz sample rate`,
      } satisfies BankBand;
    }
    if (availableMembers < members.length) {
      return {
        ...d,
        available: true,
        unavailableReason: `Partial octave: only ${availableMembers} of ${members.length} 1/3-octave bands are measurable at ${sampleRate} Hz`,
      } satisfies BankBand;
    }
    return { ...d, available: true } satisfies BankBand;
  });

  return { thirdBands, octaveBands, groups };
}
