/**
 * XL2 validation experiment persistence.
 *
 * Validation experiments are what turn "calibrated until the numbers matched"
 * into a characterised instrument, so they are stored as first-class records with
 * their full experimental setup, not just the resulting error figures.
 */

import { createId } from '@/lib/id';
import { STORES, get, getAll, put, remove } from './db';
import { DEFAULT_REFERENCE_INSTRUMENT } from './calibrationStore';
import {
  RECORD_SCHEMA_VERSION,
  type ValidationExperiment,
  type ValidationExperimentKind,
  type ValidationPoint,
  type ValidationSetup,
} from './types';

export const EXPERIMENT_KINDS: ReadonlyArray<{
  id: ValidationExperimentKind;
  label: string;
  purpose: string;
  /** Whether a frequency is expected for each point. */
  frequencyRelevant: boolean;
}> = [
  {
    id: 'broadband-level',
    label: 'Experiment 1 - Broadband level agreement',
    purpose:
      'Compare AcousticLab and the reference across the level range, ideally near 45, 55, 65, 75, 85 and 95 dBA.',
    frequencyRelevant: false,
  },
  {
    id: 'frequency-response',
    label: 'Experiment 2 - Frequency response',
    purpose:
      'Compare band or tone levels at 63, 125, 250, 500, 1k, 2k, 4k and 8k Hz using a stable source.',
    frequencyRelevant: true,
  },
  {
    id: 'a-weighting',
    label: 'Experiment 3 - A weighting',
    purpose: 'Compare LAeq on identical signals.',
    frequencyRelevant: false,
  },
  {
    id: 'c-weighting',
    label: 'Experiment 4 - C weighting',
    purpose: 'Compare LCeq on identical signals.',
    frequencyRelevant: false,
  },
  {
    id: 'time-response',
    label: 'Experiment 5 - Time response',
    purpose:
      'Use intermittent or rapidly changing noise and compare Fast and Slow behaviour against the reference.',
    frequencyRelevant: false,
  },
  {
    id: 'octave-bands',
    label: 'Experiment 6 - Octave bands',
    purpose:
      'Compare octave band levels where the reference instrument configuration supports band analysis.',
    frequencyRelevant: true,
  },
  {
    id: 'custom',
    label: 'Custom experiment',
    purpose: 'Any other comparison you want to record and characterise.',
    frequencyRelevant: true,
  },
];

export function emptySetup(): ValidationSetup {
  return {
    source: '',
    distanceMetres: null,
    phoneOrientation: '',
    referenceOrientation: '',
    environment: '',
    notes: '',
  };
}

export function createExperiment(input: {
  name: string;
  kind: ValidationExperimentKind;
  profileId: string | null;
  referenceInstrument?: string;
  setup?: Partial<ValidationSetup>;
}): ValidationExperiment {
  const now = Date.now();
  return {
    id: createId('val'),
    schemaVersion: RECORD_SCHEMA_VERSION,
    name: input.name.trim() || 'Untitled experiment',
    kind: input.kind,
    createdAt: now,
    updatedAt: now,
    profileId: input.profileId,
    referenceInstrument: input.referenceInstrument?.trim() || DEFAULT_REFERENCE_INSTRUMENT,
    setup: { ...emptySetup(), ...input.setup },
    points: [],
  };
}

export async function saveExperiment(
  experiment: ValidationExperiment
): Promise<ValidationExperiment> {
  const next = { ...experiment, updatedAt: Date.now() };
  await put(STORES.validationExperiments, next);
  return next;
}

export function loadExperiment(id: string): Promise<ValidationExperiment | undefined> {
  return get<ValidationExperiment>(STORES.validationExperiments, id);
}

export async function listExperiments(): Promise<ValidationExperiment[]> {
  const experiments = await getAll<ValidationExperiment>(STORES.validationExperiments);
  return experiments.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteExperiment(id: string): Promise<void> {
  await remove(STORES.validationExperiments, id);
}

export function createPoint(input: Omit<ValidationPoint, 'id' | 'at'> & { at?: number }): ValidationPoint {
  return {
    id: createId('pt'),
    at: input.at ?? Date.now(),
    description: input.description,
    referenceDb: input.referenceDb,
    measuredDb: input.measuredDb,
    weighting: input.weighting,
    timeWeighting: input.timeWeighting,
    frequencyHz: input.frequencyHz,
    durationSeconds: input.durationSeconds,
    notes: input.notes,
  };
}

export function addPoint(
  experiment: ValidationExperiment,
  point: ValidationPoint
): ValidationExperiment {
  return { ...experiment, points: [...experiment.points, point], updatedAt: Date.now() };
}

export function removePoint(experiment: ValidationExperiment, pointId: string): ValidationExperiment {
  return {
    ...experiment,
    points: experiment.points.filter((p) => p.id !== pointId),
    updatedAt: Date.now(),
  };
}

/** Signed errors (AcousticLab minus reference) for one experiment. */
export function experimentErrors(experiment: ValidationExperiment): number[] {
  return experiment.points
    .filter((p) => Number.isFinite(p.referenceDb) && Number.isFinite(p.measuredDb))
    .map((p) => p.measuredDb - p.referenceDb);
}
