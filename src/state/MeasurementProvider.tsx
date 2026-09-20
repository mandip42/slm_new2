'use client';

/**
 * Measurement session lifecycle.
 *
 * Responsibilities:
 *   - START / PAUSE / RESUME / STOP with correct time and energy accounting
 *   - the level history buffer that feeds every history and statistics display
 *   - autosave, so an interrupted measurement can be recovered instead of lost
 *   - optional WAV recording, which is never started implicitly
 *
 * Losing a measurement is treated as the worst failure mode. Every 5 seconds an
 * in-progress session is written to IndexedDB and flagged `incomplete`; on the
 * next launch the app offers to recover it. Stopping normally clears the flag.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MeterSnapshot } from '@/dsp/engine';
import type { HistogramSnapshot } from '@/audio/messages';
import { LevelHistory } from '@/measurement/levelHistory';
import {
  buildSessionRecord,
  buildSessionSeries,
  defaultSessionName,
} from '@/measurement/sessionBuilder';
import { createId } from '@/lib/id';
import { saveRecording } from '@/storage/recordingStore';
import {
  finaliseRecoveredSession,
  listIncompleteSessions,
  saveSession,
  saveSessionSeries,
} from '@/storage/sessionStore';
import { getActiveSessionMarker, setActiveSessionMarker } from '@/storage/settingsStore';
import type { MeasurementSettingsSnapshot, SessionRecord } from '@/storage/types';
import { useCalibration } from './CalibrationProvider';
import { useEngineContext } from './EngineProvider';
import { useSettings } from './SettingsProvider';

const AUTOSAVE_INTERVAL_MS = 5000;

export type MeasurementState = 'idle' | 'measuring' | 'paused' | 'stopped';

interface MeasurementContextValue {
  state: MeasurementState;
  /** Integrated measurement duration in seconds. */
  elapsedSeconds: number;
  sessionName: string;
  setSessionName: (name: string) => void;
  history: LevelHistory;
  /** Incremented whenever the history buffer gains a sample. */
  historyVersion: number;
  /** The snapshot captured at STOP, kept for the summary screen. */
  lastResult: { snapshot: MeterSnapshot; sessionId: string } | null;
  /** Saved session record after STOP, once persistence completed. */
  savedSession: SessionRecord | null;
  saveError: string | null;
  recording: boolean;
  recordingSeconds: number;

  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<SessionRecord | null>;
  discardResult: () => void;

  startRecording: () => void;
  stopRecording: () => void;

  /** Sessions found unfinished from a previous run. */
  recoverable: SessionRecord[];
  dismissRecovery: (id: string) => Promise<void>;
  reloadRecoverable: () => Promise<void>;
}

const MeasurementContext = createContext<MeasurementContextValue | null>(null);

export function MeasurementProvider({ children }: { children: ReactNode }) {
  const { engine, status } = useEngineContext();
  const { settings } = useSettings();
  const { calibration } = useCalibration();

  /**
   * The history buffer is a long-lived mutable object. It lives in state with a
   * lazy initialiser so its identity is stable and it can be read during render
   * without touching a ref mid-render.
   */
  const [history] = useState(() => new LevelHistory());
  const [historyVersion, setHistoryVersion] = useState(0);
  const [state, setState] = useState<MeasurementState>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sessionName, setSessionName] = useState(() => defaultSessionName());
  const [lastResult, setLastResult] = useState<{ snapshot: MeterSnapshot; sessionId: string } | null>(
    null
  );
  const [savedSession, setSavedSession] = useState<SessionRecord | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState<SessionRecord[]>([]);

  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(0);
  const latestSnapshotRef = useRef<MeterSnapshot | null>(null);
  const pausesRef = useRef<Array<{ atSeconds: number; durationSeconds: number }>>([]);
  const pauseStartedRef = useRef<{ atSeconds: number; wallClock: number } | null>(null);

  /**
   * Recording state is owned by the engine, so it is read from the engine status
   * rather than mirrored into local state. Mirroring would mean two sources of
   * truth for whether the microphone is being written to disk, which is exactly
   * the thing that must never be ambiguous.
   */
  const recording = status.recording;
  const recordingSeconds = status.recordingSeconds;

  // Settings snapshot embedded into the saved session.
  const settingsSnapshot = useMemo<MeasurementSettingsSnapshot>(
    () => ({
      weighting: settings.weighting,
      timeWeighting: settings.timeWeighting,
      bankWeighting: settings.bankWeighting,
      dcBlock: settings.dcBlock,
      fftSize: settings.fftSize,
      fftWindow: settings.fftWindow,
      statisticsWeighting: settings.statisticsWeighting,
      exposureScheme: settings.exposureScheme,
      frequencyCorrectionEnabled: settings.frequencyCorrectionEnabled,
    }),
    [settings]
  );

  // Latest-value refs, written from effects so nothing mutates during render.
  const settingsSnapshotRef = useRef(settingsSnapshot);
  const calibrationRef = useRef(calibration);
  const sessionNameRef = useRef(sessionName);
  const stateRef = useRef<MeasurementState>('idle');

  useEffect(() => {
    settingsSnapshotRef.current = settingsSnapshot;
  }, [settingsSnapshot]);
  useEffect(() => {
    calibrationRef.current = calibration;
  }, [calibration]);
  useEffect(() => {
    sessionNameRef.current = sessionName;
  }, [sessionName]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * Assemble a session record from the current engine state.
   * `incomplete` marks an autosave; a normal STOP clears it.
   */
  const composeSession = useCallback(
    (
      snapshot: MeterSnapshot,
      incomplete: boolean,
      endedAt: number | null,
      histogram: HistogramSnapshot | null
    ): SessionRecord => {
      return buildSessionRecord({
        id: sessionIdRef.current ?? createId('ses'),
        name: sessionNameRef.current,
        startedAt: startedAtRef.current,
        endedAt,
        snapshot,
        calibration: calibrationRef.current,
        diagnostics: status.diagnostics,
        bandLayout: status.bandLayout,
        analysis: engine.getAnalysisFrame(),
        settings: settingsSnapshotRef.current,
        exposureScheme: settingsSnapshotRef.current.exposureScheme,
        clipEvents: engine.getClipEvents(),
        histogram: histogram
          ? {
              minDb: histogram.minDb,
              binWidth: histogram.binWidth,
              first: histogram.first,
              counts: histogram.counts,
            }
          : null,
        pauses: pausesRef.current,
        incomplete,
      });
    },
    [engine, status.bandLayout, status.diagnostics]
  );

  // Feed the history buffer and track elapsed time.
  useEffect(() => {
    return engine.onMetrics((snapshot) => {
      latestSnapshotRef.current = snapshot;
      if (stateRef.current !== 'measuring') return;
      history.push(snapshot.durationSeconds, {
        LAF: snapshot.LAF,
        LAS: snapshot.LAS,
        LCF: snapshot.LCF,
        LZF: snapshot.LZF,
        LAeq: snapshot.LAeq,
      });
      setElapsedSeconds(snapshot.durationSeconds);
    });
  }, [engine, history]);

  // Bump the history version at a modest rate so charts redraw without the
  // provider re-rendering on every metric message.
  useEffect(() => {
    if (state !== 'measuring') return;
    const timer = setInterval(() => setHistoryVersion((v) => v + 1), 250);
    return () => clearInterval(timer);
  }, [state]);

  const start = useCallback(() => {
    history.reset();
    pausesRef.current = [];
    pauseStartedRef.current = null;
    sessionIdRef.current = createId('ses');
    startedAtRef.current = Date.now();
    setSessionName(defaultSessionName(startedAtRef.current));
    setLastResult(null);
    setSavedSession(null);
    setSaveError(null);
    setElapsedSeconds(0);
    setHistoryVersion((v) => v + 1);
    engine.startMeasurement();
    setState('measuring');
    void setActiveSessionMarker({
      sessionId: sessionIdRef.current,
      startedAt: startedAtRef.current,
      updatedAt: Date.now(),
      name: defaultSessionName(startedAtRef.current),
    });
  }, [engine, history]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'measuring') return;
    engine.pauseMeasurement();
    pauseStartedRef.current = {
      atSeconds: latestSnapshotRef.current?.durationSeconds ?? 0,
      wallClock: Date.now(),
    };
    setState('paused');
  }, [engine]);

  const resume = useCallback(() => {
    if (stateRef.current !== 'paused') return;
    const pauseInfo = pauseStartedRef.current;
    if (pauseInfo) {
      pausesRef.current = [
        ...pausesRef.current,
        {
          atSeconds: pauseInfo.atSeconds,
          durationSeconds: (Date.now() - pauseInfo.wallClock) / 1000,
        },
      ];
      pauseStartedRef.current = null;
    }
    engine.resumeMeasurement();
    setState('measuring');
  }, [engine]);

  const stop = useCallback(async (): Promise<SessionRecord | null> => {
    if (stateRef.current === 'idle' || stateRef.current === 'stopped') return null;
    engine.stopMeasurement();
    setState('stopped');

    const snapshot = latestSnapshotRef.current;
    if (!snapshot || snapshot.integratedSamples === 0) {
      setSaveError('No measurement data was collected, so nothing was saved.');
      await setActiveSessionMarker(null);
      return null;
    }

    // Collect the level distribution and let the clipping event list requested
    // by stopMeasurement arrive before the record is composed.
    const histogram = await engine.requestHistogram();
    await new Promise((resolve) => setTimeout(resolve, 120));

    const record = composeSession(snapshot, false, Date.now(), histogram);
    setLastResult({ snapshot, sessionId: record.id });

    try {
      let recordingId: string | null = null;
      if (recording) {
        // stopRecording updates the engine status, which is the single source of
        // truth for whether recording is active.
        const blob = engine.stopRecording();
        if (blob) {
          const saved = await saveRecording({
            blob,
            sessionId: record.id,
            durationSeconds: engine.recordingDurationSeconds,
            sampleRate: snapshot.sampleRate,
            name: `${record.name}.wav`,
          });
          recordingId = saved.id;
        }
      }

      const finalRecord: SessionRecord = { ...record, recordingId };
      await saveSession(finalRecord);
      await saveSessionSeries(
        buildSessionSeries(finalRecord.id, history, calibrationRef.current)
      );
      await setActiveSessionMarker(null);
      setSavedSession(finalRecord);
      setSaveError(null);
      return finalRecord;
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? `The measurement could not be saved: ${error.message}`
          : 'The measurement could not be saved to local storage.'
      );
      return null;
    }
  }, [composeSession, engine, recording, history]);

  // Autosave while measuring.
  useEffect(() => {
    if (state !== 'measuring' && state !== 'paused') return;
    const timer = setInterval(() => {
      const snapshot = latestSnapshotRef.current;
      if (!snapshot || snapshot.integratedSamples === 0) return;
      // The autosave deliberately skips the histogram request: it would add a
      // round trip every 5 seconds for data that is only needed once, at STOP.
      const record = composeSession(snapshot, true, null, engine.latestHistogram);
      void saveSession(record).catch(() => undefined);
      void saveSessionSeries(
        buildSessionSeries(record.id, history, calibrationRef.current)
      ).catch(() => undefined);
      void setActiveSessionMarker({
        sessionId: record.id,
        startedAt: record.startedAt,
        updatedAt: Date.now(),
        name: record.name,
      }).catch(() => undefined);
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state, composeSession, engine, history]);

  // Warn before leaving the page mid-measurement.
  useEffect(() => {
    if (state !== 'measuring' && state !== 'paused') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state]);

  const reloadRecoverable = useCallback(async () => {
    const [incomplete, marker] = await Promise.all([
      listIncompleteSessions().catch(() => []),
      getActiveSessionMarker().catch(() => null),
    ]);
    // Only offer recovery for sessions that were genuinely in progress, not for
    // one that is running right now in this tab.
    const active = sessionIdRef.current;
    const candidates = incomplete.filter(
      (session) => session.id !== active && (marker === null || marker.sessionId !== active)
    );
    setRecoverable(candidates);
  }, []);

  useEffect(() => {
    void reloadRecoverable();
  }, [reloadRecoverable]);

  const dismissRecovery = useCallback(
    async (id: string) => {
      await finaliseRecoveredSession(id).catch(() => undefined);
      await setActiveSessionMarker(null).catch(() => undefined);
      setRecoverable((current) => current.filter((session) => session.id !== id));
    },
    []
  );

  const startRecording = useCallback(() => {
    try {
      engine.startRecording(settings.maxRecordingMinutes * 60);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Recording could not be started.'
      );
    }
  }, [engine, settings.maxRecordingMinutes]);

  const stopRecordingOnly = useCallback(() => {
    const blob = engine.stopRecording();
    if (!blob) return;
    void saveRecording({
      blob,
      sessionId: sessionIdRef.current,
      durationSeconds: engine.recordingDurationSeconds,
      sampleRate: status.sampleRate ?? 48000,
      name: `${sessionNameRef.current}.wav`,
    }).catch(() => {
      setSaveError('The recording could not be saved to local storage.');
    });
  }, [engine, status.sampleRate]);

  /**
   * If the input dies mid-measurement (device unplugged, permission revoked,
   * another app took the microphone) the session is shown as paused rather than
   * as still measuring. This is derived rather than pushed into state: the engine
   * is already stopped, so there is nothing to pause, and the only thing that
   * needs to change is what the user is told.
   */
  const effectiveState: MeasurementState =
    status.state === 'error' && state === 'measuring' ? 'paused' : state;

  const discardResult = useCallback(() => {
    setLastResult(null);
    setSavedSession(null);
    setSaveError(null);
    setState('idle');
    history.reset();
    setElapsedSeconds(0);
    setHistoryVersion((v) => v + 1);
  }, [history]);

  const value = useMemo<MeasurementContextValue>(
    () => ({
      state: effectiveState,
      elapsedSeconds,
      sessionName,
      setSessionName,
      history,
      historyVersion,
      lastResult,
      savedSession,
      saveError,
      recording,
      recordingSeconds,
      start,
      pause,
      resume,
      stop,
      discardResult,
      startRecording,
      stopRecording: stopRecordingOnly,
      recoverable,
      dismissRecovery,
      reloadRecoverable,
    }),
    [
      effectiveState,
      elapsedSeconds,
      sessionName,
      history,
      historyVersion,
      lastResult,
      savedSession,
      saveError,
      recording,
      recordingSeconds,
      start,
      pause,
      resume,
      stop,
      discardResult,
      startRecording,
      stopRecordingOnly,
      recoverable,
      dismissRecovery,
      reloadRecoverable,
    ]
  );

  return <MeasurementContext.Provider value={value}>{children}</MeasurementContext.Provider>;
}

export function useMeasurement(): MeasurementContextValue {
  const context = useContext(MeasurementContext);
  if (!context) throw new Error('useMeasurement must be used inside MeasurementProvider');
  return context;
}
