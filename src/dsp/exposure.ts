/**
 * Occupational noise exposure indicators.
 *
 * These are educational/informational calculations. Sonoscope is not a
 * certified dosimeter and nothing here is medical or regulatory advice.
 *
 * All assumptions of each scheme are declared in the exported metadata so the
 * UI can show them next to the numbers.
 *
 * Allowed exposure time for a given level:
 *
 *     T(L) = criterionHours * 2 ^ ((criterionLevel - L) / exchangeRate)
 *
 * Dose as a percentage of the daily allowance:
 *
 *     D = 100 * t / T(L)
 *
 * Time-weighted average over the criterion duration:
 *
 *     TWA = criterionLevel + (exchangeRate / log10(2)) * log10(D / 100)
 *
 * Only sound above the threshold level contributes for schemes that define a
 * threshold (OSHA). Because Sonoscope integrates a single LAeq rather than a
 * per-instant dose, the threshold is applied by ignoring the measurement when
 * the running LAeq is below it; this is stated in `thresholdNote`.
 */

export type ExposureSchemeId = 'niosh' | 'osha';

export interface ExposureScheme {
  id: ExposureSchemeId;
  name: string;
  description: string;
  /** Criterion (100 % dose) level in dBA. */
  criterionLevelDb: number;
  /** Exchange rate in dB per doubling/halving of allowed time. */
  exchangeRateDb: number;
  /** Criterion duration in hours. */
  criterionHours: number;
  /** Threshold level in dBA below which sound is disregarded, or null. */
  thresholdDb: number | null;
  thresholdNote: string;
  reference: string;
}

export const EXPOSURE_SCHEMES: Record<ExposureSchemeId, ExposureScheme> = {
  niosh: {
    id: 'niosh',
    name: 'NIOSH-style',
    description:
      'Recommended exposure limit style calculation: 85 dBA criterion with a 3 dB exchange rate over 8 hours.',
    criterionLevelDb: 85,
    exchangeRateDb: 3,
    criterionHours: 8,
    thresholdDb: null,
    thresholdNote: 'No threshold is applied; all measured sound energy contributes to the dose.',
    reference: 'NIOSH Criteria for a Recommended Standard: Occupational Noise Exposure (1998)',
  },
  osha: {
    id: 'osha',
    name: 'OSHA-style',
    description:
      'Permissible exposure limit style calculation: 90 dBA criterion with a 5 dB exchange rate over 8 hours and an 80 dBA threshold.',
    criterionLevelDb: 90,
    exchangeRateDb: 5,
    criterionHours: 8,
    thresholdDb: 80,
    thresholdNote:
      'Sound below the 80 dBA threshold is excluded. Sonoscope applies the threshold to the running LAeq, not instant by instant.',
    reference: 'OSHA 29 CFR 1910.95 occupational noise exposure',
  },
};

/** Allowed exposure time in hours for a continuous level. */
export function allowedExposureHours(scheme: ExposureScheme, levelDb: number): number {
  return (
    scheme.criterionHours *
    Math.pow(2, (scheme.criterionLevelDb - levelDb) / scheme.exchangeRateDb)
  );
}

export interface ExposureResult {
  scheme: ExposureScheme;
  /** Running A-weighted equivalent level used for the calculation (dBA SPL). */
  leqDb: number;
  /** Elapsed measurement time in seconds. */
  elapsedSeconds: number;
  /** Dose as a percentage of the daily allowance. */
  dosePercent: number;
  /** Time-weighted average over the criterion duration, in dBA. */
  twaDb: number;
  /** Projected dose if the current level continued for the criterion duration. */
  projectedDosePercent: number;
  /** Projected level over the criterion duration (LEX,8h style), in dBA. */
  projected8hDb: number;
  /** Allowed exposure time for the current level, in seconds. */
  allowedSeconds: number;
  /** Remaining allowed time at the current level, in seconds (0 when exceeded). */
  remainingSeconds: number;
  /** True when the measured level is below the scheme threshold. */
  belowThreshold: boolean;
}

/**
 * Compute exposure indicators from a running LAeq and elapsed time.
 *
 * @param leqDb           running LAeq in dBA (calibrated SPL)
 * @param elapsedSeconds  measurement duration in seconds
 */
export function computeExposure(
  scheme: ExposureScheme,
  leqDb: number,
  elapsedSeconds: number
): ExposureResult {
  const belowThreshold = scheme.thresholdDb !== null && leqDb < scheme.thresholdDb;
  const effectiveLeq = belowThreshold ? Number.NEGATIVE_INFINITY : leqDb;

  const allowedHours = Number.isFinite(effectiveLeq)
    ? allowedExposureHours(scheme, effectiveLeq)
    : Number.POSITIVE_INFINITY;
  const allowedSeconds = allowedHours * 3600;
  const elapsedHours = elapsedSeconds / 3600;

  const dosePercent =
    Number.isFinite(allowedHours) && allowedHours > 0 ? (100 * elapsedHours) / allowedHours : 0;

  const twaDb =
    dosePercent > 0
      ? scheme.criterionLevelDb +
        (scheme.exchangeRateDb / Math.log10(2)) * Math.log10(dosePercent / 100)
      : Number.NEGATIVE_INFINITY;

  const projectedDosePercent =
    Number.isFinite(allowedHours) && allowedHours > 0
      ? (100 * scheme.criterionHours) / allowedHours
      : 0;

  const projected8hDb = Number.isFinite(effectiveLeq)
    ? effectiveLeq + 10 * Math.log10(Math.max(elapsedSeconds, 0) / (scheme.criterionHours * 3600))
    : Number.NEGATIVE_INFINITY;

  return {
    scheme,
    leqDb,
    elapsedSeconds,
    dosePercent,
    twaDb,
    projectedDosePercent,
    projected8hDb,
    allowedSeconds,
    remainingSeconds: Math.max(0, allowedSeconds - elapsedSeconds),
    belowThreshold,
  };
}

/**
 * Normalised exposure level LEX,8h — the level that over 8 hours carries the
 * same energy as `leqDb` over `durationSeconds`.
 */
export function lex8h(leqDb: number, durationSeconds: number): number {
  if (!(durationSeconds > 0)) return Number.NEGATIVE_INFINITY;
  return leqDb + 10 * Math.log10(durationSeconds / (8 * 3600));
}
