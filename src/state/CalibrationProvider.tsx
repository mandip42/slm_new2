'use client';

/**
 * Calibration context.
 *
 * Holds every stored profile, the validation experiments and the derived
 * `ActiveCalibration` that the whole UI uses to turn dBFS into SPL. Keeping the
 * derivation in one place means a profile edit immediately and consistently
 * changes every displayed level.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ActiveCalibration } from '@/calibration/activeCalibration';
import { buildQualityReport, type CalibrationQualityReport } from '@/calibration/quality';
import {
  applyValidationSummary,
  deleteProfile as deleteProfileRecord,
  listProfiles,
  saveProfile,
} from '@/storage/calibrationStore';
import { listExperiments, saveExperiment, deleteExperiment } from '@/storage/validationStore';
import type { CalibrationProfile, ValidationExperiment } from '@/storage/types';
import { useSettings } from './SettingsProvider';

interface CalibrationContextValue {
  profiles: CalibrationProfile[];
  experiments: ValidationExperiment[];
  activeProfile: CalibrationProfile | null;
  calibration: ActiveCalibration;
  quality: CalibrationQualityReport;
  ready: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  upsertProfile: (profile: CalibrationProfile) => Promise<CalibrationProfile>;
  removeProfile: (id: string) => Promise<void>;
  setActiveProfile: (id: string | null) => void;
  upsertExperiment: (experiment: ValidationExperiment) => Promise<ValidationExperiment>;
  removeExperiment: (id: string) => Promise<void>;
}

const CalibrationContext = createContext<CalibrationContextValue | null>(null);

export function CalibrationProvider({ children }: { children: ReactNode }) {
  const { settings, update, ready: settingsReady } = useSettings();
  const [profiles, setProfiles] = useState<CalibrationProfile[]>([]);
  const [experiments, setExperiments] = useState<ValidationExperiment[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextProfiles, nextExperiments] = await Promise.all([
        listProfiles(),
        listExperiments(),
      ]);
      setProfiles(nextProfiles);
      setExperiments(nextExperiments);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Calibration profiles could not be read from local storage.'
      );
    } finally {
      setReady(true);
    }
  }, []);

  // Initial load. The reads are awaited before any state is set, so nothing is
  // written synchronously while the effect runs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextProfiles, nextExperiments] = await Promise.all([
          listProfiles(),
          listExperiments(),
        ]);
        if (cancelled) return;
        setProfiles(nextProfiles);
        setExperiments(nextExperiments);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'Calibration profiles could not be read from local storage.'
        );
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const upsertProfile = useCallback(
    async (profile: CalibrationProfile) => {
      const saved = await saveProfile(profile);
      setProfiles((current) => {
        const index = current.findIndex((p) => p.id === saved.id);
        if (index === -1) return [saved, ...current];
        const next = [...current];
        next[index] = saved;
        return next;
      });
      return saved;
    },
    []
  );

  const removeProfile = useCallback(
    async (id: string) => {
      await deleteProfileRecord(id);
      setProfiles((current) => current.filter((p) => p.id !== id));
      if (settings.activeProfileId === id) update({ activeProfileId: null });
    },
    [settings.activeProfileId, update]
  );

  const setActiveProfile = useCallback(
    (id: string | null) => {
      update({ activeProfileId: id });
    },
    [update]
  );

  const upsertExperiment = useCallback(
    async (experiment: ValidationExperiment) => {
      const saved = await saveExperiment(experiment);
      setExperiments((current) => {
        const index = current.findIndex((e) => e.id === saved.id);
        if (index === -1) return [saved, ...current];
        const next = [...current];
        next[index] = saved;
        return next;
      });
      return saved;
    },
    []
  );

  const removeExperiment = useCallback(async (id: string) => {
    await deleteExperiment(id);
    setExperiments((current) => current.filter((e) => e.id !== id));
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === settings.activeProfileId) ?? null,
    [profiles, settings.activeProfileId]
  );

  /**
   * Keep each profile's validation summary in step with its experiments.
   *
   * The summary is derived data, so it is recomputed rather than trusted, and
   * only written back when it actually changed.
   */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      for (const profile of profiles) {
        const updated = applyValidationSummary(profile, experiments);
        const before = profile.validation;
        const after = updated.validation;
        const changed =
          (before === null) !== (after === null) ||
          (before && after && (before.n !== after.n || before.meanErrorDb !== after.meanErrorDb));
        if (!changed || cancelled) continue;
        const saved = await saveProfile(updated).catch(() => null);
        if (saved && !cancelled) {
          setProfiles((current) => current.map((p) => (p.id === saved.id ? saved : p)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally keyed on the experiment set: profile edits already write
    // their own summary through upsertProfile.
  }, [experiments, ready, profiles]);

  const calibration = useMemo(
    () =>
      ActiveCalibration.from(activeProfile, {
        frequencyCorrection: settings.frequencyCorrectionEnabled,
      }),
    [activeProfile, settings.frequencyCorrectionEnabled]
  );

  const quality = useMemo(() => buildQualityReport(activeProfile), [activeProfile]);

  const value = useMemo<CalibrationContextValue>(
    () => ({
      profiles,
      experiments,
      activeProfile,
      calibration,
      quality,
      ready: ready && settingsReady,
      error,
      refresh,
      upsertProfile,
      removeProfile,
      setActiveProfile,
      upsertExperiment,
      removeExperiment,
    }),
    [
      profiles,
      experiments,
      activeProfile,
      calibration,
      quality,
      ready,
      settingsReady,
      error,
      refresh,
      upsertProfile,
      removeProfile,
      setActiveProfile,
      upsertExperiment,
      removeExperiment,
    ]
  );

  return <CalibrationContext.Provider value={value}>{children}</CalibrationContext.Provider>;
}

export function useCalibration(): CalibrationContextValue {
  const context = useContext(CalibrationContext);
  if (!context) throw new Error('useCalibration must be used inside CalibrationProvider');
  return context;
}
