'use client';

/**
 * Engine context.
 *
 * Owns the single AcousticEngine instance and bridges its push-based streams
 * into React without re-rendering the whole tree 20 times a second.
 *
 * Three access patterns are offered, in order of preference:
 *   useMetricsSubscription(cb)  imperative, zero re-renders — for canvases
 *   useMetrics()                state at the metric rate — for small leaf
 *                               components that display one or two numbers
 *   useEngineStatus()           low-frequency status — safe anywhere
 *
 * The rule that keeps this fast: only leaf components subscribe to live data.
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
import {
  AcousticEngine,
  type AnalysisFrame,
  type AnalysisSettings,
  type EngineStatus,
  type PerformanceStats,
} from '@/audio/acousticEngine';
import { AudioInputError, DeviceInput, listAudioInputs, type AudioInputDeviceInfo } from '@/audio/input';
import { useSettings } from './SettingsProvider';

export type MicPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied';

interface EngineContextValue {
  engine: AcousticEngine;
  status: EngineStatus;
  performance: PerformanceStats;
  permission: MicPermissionState;
  devices: AudioInputDeviceInfo[];
  starting: boolean;
  /** Latest error surfaced from starting the input. */
  startError: { message: string; code?: string } | null;
  start: (deviceId?: string) => Promise<void>;
  stop: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  subscribeMetrics: (listener: (snapshot: MeterSnapshot) => void) => () => void;
  subscribeAnalysis: (listener: (frame: AnalysisFrame) => void) => () => void;
  getSnapshot: () => MeterSnapshot | null;
  getAnalysisFrame: () => AnalysisFrame | null;
  analysisSettings: AnalysisSettings;
}

const EngineContext = createContext<EngineContextValue | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();

  /**
   * The engine is a long-lived mutable object, held in state with a lazy
   * initialiser so it is constructed exactly once and its identity never changes.
   * A ref would work too, but reading `ref.current` during render is not safe
   * under concurrent rendering; a state value with a stable identity is.
   */
  const [engine] = useState(
    () =>
      new AcousticEngine({
        sampleRate: 48000,
        dcBlock: settings.dcBlock,
        statisticsWeighting: settings.statisticsWeighting,
        analysis: {
          fftSize: settings.fftSize,
          window: settings.fftWindow,
          bankWeighting: settings.bankWeighting,
          smoothing: settings.spectrumSmoothing,
          peakHold: settings.spectrumPeakHold,
        },
      })
  );

  const [status, setStatus] = useState<EngineStatus>(() => engine.getStatus());
  const [performance, setPerformance] = useState<PerformanceStats>(() => ({
    meterLoad: null,
    analysisLoad: 0,
    silentBlocks: 0,
    droppedSamples: 0,
    metricRate: 0,
    analysisRate: 0,
    baseLatencySeconds: null,
    outputLatencySeconds: null,
  }));
  const [permission, setPermission] = useState<MicPermissionState>('unknown');
  const [devices, setDevices] = useState<AudioInputDeviceInfo[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<{ message: string; code?: string } | null>(null);

  useEffect(() => engine.onStatus(setStatus), [engine]);
  useEffect(() => engine.onPerformance(setPerformance), [engine]);

  // Query the permission state up front so the start screen can explain what to
  // expect instead of showing a bare button.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((result) => {
        if (cancelled) return;
        const map = (state: PermissionState): MicPermissionState =>
          state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt';
        setPermission(map(result.state));
        result.onchange = () => setPermission(map(result.state));
      })
      .catch(() => {
        // Firefox and some Android builds do not expose the microphone
        // permission; leaving it "unknown" is the honest outcome.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshDevices = useCallback(async () => {
    const list = await listAudioInputs().catch(() => []);
    setDevices(list);
  }, []);

  const start = useCallback(
    async (deviceId?: string) => {
      setStarting(true);
      setStartError(null);
      try {
        const label =
          devices.find((d) => d.deviceId === deviceId)?.label ?? 'Microphone';
        await engine.start(new DeviceInput(deviceId ?? 'default', label));
        setPermission('granted');
        await refreshDevices();
      } catch (error) {
        const code = error instanceof AudioInputError ? error.code : undefined;
        if (code === 'permission-denied') setPermission('denied');
        setStartError({
          message: error instanceof Error ? error.message : String(error),
          code,
        });
      } finally {
        setStarting(false);
      }
    },
    [engine, devices, refreshDevices]
  );

  const stop = useCallback(async () => {
    await engine.stop();
  }, [engine]);

  // Push settings changes into the running engine.
  useEffect(() => {
    engine.setDcBlock(settings.dcBlock);
  }, [engine, settings.dcBlock]);

  useEffect(() => {
    engine.setStatisticsWeighting(settings.statisticsWeighting);
  }, [engine, settings.statisticsWeighting]);

  useEffect(() => {
    engine.updateAnalysisSettings({
      fftSize: settings.fftSize,
      window: settings.fftWindow,
      bankWeighting: settings.bankWeighting,
      smoothing: settings.spectrumSmoothing,
      peakHold: settings.spectrumPeakHold,
    });
  }, [
    engine,
    settings.fftSize,
    settings.fftWindow,
    settings.bankWeighting,
    settings.spectrumSmoothing,
    settings.spectrumPeakHold,
  ]);

  /**
   * Keep the screen awake while the input is live.
   *
   * A locked screen suspends the AudioContext on Android, which silently stops
   * the measurement. The wake lock is re-acquired on visibility change because
   * the browser releases it when the page is hidden.
   */
  useEffect(() => {
    if (!settings.keepScreenAwake) return;
    if (status.state !== 'running') return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    type WakeLockSentinel = { release: () => Promise<void>; released: boolean };
    type WakeLock = { request: (type: 'screen') => Promise<WakeLockSentinel> };
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        sentinel = await wakeLock.request('screen');
      } catch {
        // Denied or unsupported: the app still works, the screen may just sleep.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [settings.keepScreenAwake, status.state]);

  // Release the audio device when the provider unmounts.
  useEffect(() => {
    return () => {
      void engine.stop().catch(() => undefined);
    };
  }, [engine]);

  const subscribeMetrics = useCallback(
    (listener: (snapshot: MeterSnapshot) => void) => engine.onMetrics(listener),
    [engine]
  );
  const subscribeAnalysis = useCallback(
    (listener: (frame: AnalysisFrame) => void) => engine.onAnalysis(listener),
    [engine]
  );
  const getSnapshot = useCallback(() => engine.getSnapshot(), [engine]);
  const getAnalysisFrame = useCallback(() => engine.getAnalysisFrame(), [engine]);

  const analysisSettings = useMemo<AnalysisSettings>(
    () => ({
      fftSize: settings.fftSize,
      window: settings.fftWindow,
      bankWeighting: settings.bankWeighting,
      smoothing: settings.spectrumSmoothing,
      peakHold: settings.spectrumPeakHold,
    }),
    [
      settings.fftSize,
      settings.fftWindow,
      settings.bankWeighting,
      settings.spectrumSmoothing,
      settings.spectrumPeakHold,
    ]
  );

  const value = useMemo<EngineContextValue>(
    () => ({
      engine,
      status,
      performance,
      permission,
      devices,
      starting,
      startError,
      start,
      stop,
      refreshDevices,
      subscribeMetrics,
      subscribeAnalysis,
      getSnapshot,
      getAnalysisFrame,
      analysisSettings,
    }),
    [
      engine,
      status,
      performance,
      permission,
      devices,
      starting,
      startError,
      start,
      stop,
      refreshDevices,
      subscribeMetrics,
      subscribeAnalysis,
      getSnapshot,
      getAnalysisFrame,
      analysisSettings,
    ]
  );

  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngineContext(): EngineContextValue {
  const context = useContext(EngineContext);
  if (!context) throw new Error('useEngineContext must be used inside EngineProvider');
  return context;
}

export function useEngineStatus(): EngineStatus {
  return useEngineContext().status;
}

/**
 * Keep a ref pointing at the latest value of something, updated from an effect.
 *
 * Used so a long-lived subscription can call the newest callback without being
 * torn down and re-established on every render. The assignment happens in an
 * effect rather than during render because writing refs while rendering is not
 * safe under concurrent rendering.
 */
function useLatest<T>(value: T): React.RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/** Imperative metric subscription: no re-renders. Use for canvas rendering. */
export function useMetricsSubscription(listener: (snapshot: MeterSnapshot) => void): void {
  const { subscribeMetrics } = useEngineContext();
  const ref = useLatest(listener);
  useEffect(() => subscribeMetrics((snapshot) => ref.current(snapshot)), [subscribeMetrics, ref]);
}

/** Imperative analysis subscription: no re-renders. */
export function useAnalysisSubscription(listener: (frame: AnalysisFrame) => void): void {
  const { subscribeAnalysis } = useEngineContext();
  const ref = useLatest(listener);
  useEffect(() => subscribeAnalysis((frame) => ref.current(frame)), [subscribeAnalysis, ref]);
}

/**
 * Live metric snapshot as React state.
 *
 * @param intervalMs minimum interval between re-renders. The default of 100 ms
 *   (10 Hz) is faster than the eye can read a changing number and halves the
 *   render work compared with the 20 Hz metric rate.
 */
export function useMetrics(intervalMs = 100): MeterSnapshot | null {
  const { subscribeMetrics, getSnapshot } = useEngineContext();
  const [snapshot, setSnapshot] = useState<MeterSnapshot | null>(() => getSnapshot());
  const lastRef = useRef(0);

  useEffect(() => {
    return subscribeMetrics((next) => {
      const now = Date.now();
      if (now - lastRef.current < intervalMs) return;
      lastRef.current = now;
      setSnapshot(next);
    });
  }, [subscribeMetrics, intervalMs]);

  return snapshot;
}

/** Live analysis frame as React state. */
export function useAnalysis(intervalMs = 100): AnalysisFrame | null {
  const { subscribeAnalysis, getAnalysisFrame } = useEngineContext();
  const [frame, setFrame] = useState<AnalysisFrame | null>(() => getAnalysisFrame());
  const lastRef = useRef(0);

  useEffect(() => {
    return subscribeAnalysis((next) => {
      const now = Date.now();
      if (now - lastRef.current < intervalMs) return;
      lastRef.current = now;
      setFrame(next);
    });
  }, [subscribeAnalysis, intervalMs]);

  return frame;
}
