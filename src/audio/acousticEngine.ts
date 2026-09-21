/**
 * AcousticEngine — the main-thread orchestrator.
 *
 *   AudioInputSource -> AudioNode -> AudioWorkletNode(meter) -> silent sink
 *                                            |
 *                                            +--(MessagePort)--> analysis Worker
 *
 * The engine owns the AudioContext, the worklet, the analysis worker and the
 * recorder, and exposes a small observable surface to React. It contains no DSP
 * of its own: every number it publishes was computed in src/dsp.
 *
 * Notable details:
 *  - The worklet output is routed through a zero-gain node into the destination.
 *    Without a path to the destination some browsers stop pulling the graph;
 *    with zero gain nothing is ever played back, so there is no feedback risk.
 *  - PCM goes worklet -> worker directly over a transferred MessagePort. The main
 *    thread only sees low-rate metric objects.
 *  - AudioContext suspension (screen lock, tab backgrounding) is detected and
 *    surfaced, because a suspended context silently stops the measurement.
 */

import type { MeterSnapshot } from '@/dsp/engine';
import type { ClipEvent } from '@/dsp/clipping';
import type { WeightingId } from '@/dsp/weighting/reference';
import type { WindowId } from '@/dsp/window';
import {
  ANALYSIS_UPDATE_HZ,
  METER_PROCESSOR_NAME,
  METER_WORKLET_URL,
  type AnalysisFrameMessage,
  type BandLayoutEntry,
  type FromAnalysisMessage,
  type FromMeterMessage,
  type HistogramSnapshot,
  type ToAnalysisMessage,
  type ToMeterMessage,
} from './messages';
import { AudioInputError, DeviceInput, type AudioInputSource } from './input';
import type { InputDiagnostics } from './diagnostics';
import { WavRecorder } from './wavRecorder';

export type EngineState = 'idle' | 'starting' | 'running' | 'suspended' | 'error' | 'closed';

export interface BandLayout {
  thirdOctave: BandLayoutEntry[];
  octave: BandLayoutEntry[];
  octaveContributions: number[];
  unstableBands: number[];
}

export interface AnalysisFrame {
  sequence: number;
  spectrum: Float32Array;
  spectrumPeak: Float32Array | null;
  fftSize: number;
  binWidth: number;
  window: WindowId;
  peak: { frequency: number; levelDb: number };
  thirdCurrent: Float32Array;
  thirdLeq: Float32Array;
  thirdMax: Float32Array;
  octaveCurrent: Float32Array;
  octaveLeq: Float32Array;
  octaveMax: Float32Array;
  bankWeighting: WeightingId;
  bandSamples: number;
  processingLoad: number;
  droppedSamples: number;
}

export interface PerformanceStats {
  /** DSP time / real time in the audio worklet (0..1). */
  meterLoad: number | null;
  /** DSP time / real time in the analysis worker (0..1). */
  analysisLoad: number;
  /** Render quanta that arrived with no input since the last update. */
  silentBlocks: number;
  /** Samples the analysis worker had to drop to keep up. */
  droppedSamples: number;
  /** Metric messages received per second. */
  metricRate: number;
  /** Analysis frames received per second. */
  analysisRate: number;
  baseLatencySeconds: number | null;
  outputLatencySeconds: number | null;
}

export interface EngineStatus {
  state: EngineState;
  sampleRate: number | null;
  contextState: AudioContextState | null;
  diagnostics: InputDiagnostics | null;
  bandLayout: BandLayout | null;
  error: { message: string; code?: string } | null;
  /** Upper frequency limit of the validated weighting design. */
  weightingAccurateUpToHz: number | null;
  aWeightingHfPoleHz: number | null;
  aWeightingMaxFitErrorDb: number | null;
  /** True while a measurement is integrating (as opposed to just monitoring). */
  measuring: boolean;
  paused: boolean;
  recording: boolean;
  recordingSeconds: number;
}

export interface AnalysisSettings {
  fftSize: number;
  window: WindowId;
  bankWeighting: WeightingId;
  smoothing: number;
  peakHold: boolean;
}

export interface AcousticEngineOptions {
  /** Preferred sample rate. Ignored by the browser if unsupported. */
  sampleRate?: number;
  dcBlock?: boolean;
  statisticsWeighting?: WeightingId;
  analysis?: Partial<AnalysisSettings>;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  fftSize: 8192,
  window: 'hann',
  bankWeighting: 'Z',
  smoothing: 0.5,
  peakHold: false,
};

type Listener<T> = (value: T) => void;

export class AcousticEngine {
  private context: AudioContext | null = null;
  private source: AudioInputSource | null = null;
  private sourceNode: AudioNode | null = null;
  private meterNode: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private worker: Worker | null = null;
  private recorder: WavRecorder | null = null;

  private status: EngineStatus = {
    state: 'idle',
    sampleRate: null,
    contextState: null,
    diagnostics: null,
    bandLayout: null,
    error: null,
    weightingAccurateUpToHz: null,
    aWeightingHfPoleHz: null,
    aWeightingMaxFitErrorDb: null,
    measuring: false,
    paused: false,
    recording: false,
    recordingSeconds: 0,
  };

  private analysisSettings: AnalysisSettings;
  private latestSnapshot: MeterSnapshot | null = null;
  private latestFrame: AnalysisFrame | null = null;
  private clipEvents: ClipEvent[] = [];
  private histogram: HistogramSnapshot | null = null;
  private histogramRequestId = 0;
  private readonly pendingHistograms = new Map<
    number,
    (histogram: HistogramSnapshot | null) => void
  >();

  private metricListeners = new Set<Listener<MeterSnapshot>>();
  private analysisListeners = new Set<Listener<AnalysisFrame>>();
  private statusListeners = new Set<Listener<EngineStatus>>();
  private performanceListeners = new Set<Listener<PerformanceStats>>();

  private perf: PerformanceStats = {
    meterLoad: null,
    analysisLoad: 0,
    silentBlocks: 0,
    droppedSamples: 0,
    metricRate: 0,
    analysisRate: 0,
    baseLatencySeconds: null,
    outputLatencySeconds: null,
  };
  private metricCount = 0;
  private analysisCount = 0;
  private rateTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private trackEndedHandler: (() => void) | null = null;

  constructor(private readonly options: AcousticEngineOptions = {}) {
    this.analysisSettings = { ...DEFAULT_ANALYSIS_SETTINGS, ...options.analysis };
  }

  // -------------------------------------------------------------------------
  // Subscriptions
  // -------------------------------------------------------------------------

  onMetrics(listener: Listener<MeterSnapshot>): () => void {
    this.metricListeners.add(listener);
    if (this.latestSnapshot) listener(this.latestSnapshot);
    return () => this.metricListeners.delete(listener);
  }

  onAnalysis(listener: Listener<AnalysisFrame>): () => void {
    this.analysisListeners.add(listener);
    if (this.latestFrame) listener(this.latestFrame);
    return () => this.analysisListeners.delete(listener);
  }

  onStatus(listener: Listener<EngineStatus>): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  onPerformance(listener: Listener<PerformanceStats>): () => void {
    this.performanceListeners.add(listener);
    listener(this.perf);
    return () => this.performanceListeners.delete(listener);
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getSnapshot(): MeterSnapshot | null {
    return this.latestSnapshot;
  }

  getAnalysisFrame(): AnalysisFrame | null {
    return this.latestFrame;
  }

  getAnalysisSettings(): AnalysisSettings {
    return this.analysisSettings;
  }

  getClipEvents(): readonly ClipEvent[] {
    return this.clipEvents;
  }

  private patchStatus(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.statusListeners) listener(this.status);
  }

  private patchPerformance(patch: Partial<PerformanceStats>): void {
    this.perf = { ...this.perf, ...patch };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Open the input and start monitoring. Levels start updating immediately; a
   * measurement session is separate and begins with {@link startMeasurement}.
   */
  async start(source: AudioInputSource = new DeviceInput()): Promise<void> {
    if (this.status.state === 'running' || this.status.state === 'starting') return;
    this.patchStatus({ state: 'starting', error: null });

    try {
      if (typeof AudioContext === 'undefined') {
        throw new AudioInputError('This browser has no Web Audio support.', 'unsupported');
      }

      const context = new AudioContext({
        sampleRate: this.options.sampleRate ?? 48000,
        latencyHint: 'interactive',
      });
      this.context = context;

      if (!context.audioWorklet) {
        throw new AudioInputError(
          'This browser does not support AudioWorklet, which Sonoscope needs for real-time measurement. Chrome or Edge on Android is recommended.',
          'worklet-unsupported'
        );
      }

      // Autoplay policy: the context may start suspended until a user gesture.
      if (context.state === 'suspended') {
        await context.resume().catch(() => undefined);
      }

      await context.audioWorklet.addModule(METER_WORKLET_URL);

      this.source = source;
      this.sourceNode = await source.connect(context);

      const meterNode = new AudioWorkletNode(context, METER_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      this.meterNode = meterNode;
      meterNode.port.onmessage = (event: MessageEvent<FromMeterMessage>) =>
        this.handleMeterMessage(event.data);
      meterNode.onprocessorerror = () => {
        this.fail('The audio processing node stopped unexpectedly. Restart the measurement.');
      };

      // Silent sink: keeps the graph pulling without any audible output.
      const sink = context.createGain();
      sink.gain.value = 0;
      this.sink = sink;

      this.sourceNode.connect(meterNode);
      meterNode.connect(sink);
      sink.connect(context.destination);

      this.startAnalysisWorker(context.sampleRate, meterNode);

      this.send({
        type: 'configure',
        dcBlock: this.options.dcBlock ?? true,
        statisticsWeighting: this.options.statisticsWeighting ?? 'A',
      });

      this.attachEnvironmentWatchers();
      this.startRateTimer();

      this.patchStatus({
        state: context.state === 'running' ? 'running' : 'suspended',
        sampleRate: context.sampleRate,
        contextState: context.state,
        diagnostics: source.diagnostics(context.sampleRate),
      });
      this.patchPerformance({
        baseLatencySeconds: context.baseLatency ?? null,
        outputLatencySeconds: context.outputLatency ?? null,
      });
    } catch (error) {
      await this.teardown();
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof AudioInputError ? error.code : undefined;
      this.patchStatus({ state: 'error', error: { message, code } });
      throw error;
    }
  }

  private startAnalysisWorker(sampleRate: number, meterNode: AudioWorkletNode): void {
    const worker = new Worker(new URL('./workers/analysisWorker.ts', import.meta.url), {
      type: 'module',
      name: 'acousticlab-analysis',
    });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<FromAnalysisMessage>) =>
      this.handleAnalysisMessage(event.data);
    worker.onerror = (event) => {
      this.patchStatus({
        error: {
          message: `Analysis worker failed: ${event.message || 'unknown error'}`,
          code: 'analysis-worker',
        },
      });
    };

    // Direct worklet -> worker channel, so PCM never crosses the main thread.
    const channel = new MessageChannel();
    const initMessage: ToAnalysisMessage = {
      type: 'init',
      sampleRate,
      port: channel.port1,
      fftSize: this.analysisSettings.fftSize,
      window: this.analysisSettings.window,
      bankWeighting: this.analysisSettings.bankWeighting,
      smoothing: this.analysisSettings.smoothing,
      peakHold: this.analysisSettings.peakHold,
    };
    worker.postMessage(initMessage, [channel.port1]);
    const portMessage: ToMeterMessage = { type: 'setAnalysisPort', port: channel.port2 };
    meterNode.port.postMessage(portMessage, [channel.port2]);
  }

  private attachEnvironmentWatchers(): void {
    const context = this.context;
    if (!context) return;

    context.onstatechange = () => {
      const state = context.state;
      this.patchStatus({
        contextState: state,
        state: state === 'running' ? 'running' : state === 'closed' ? 'closed' : 'suspended',
      });
    };

    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        // Chrome on Android suspends the context when the screen locks. Resuming
        // on visibility change restores the measurement as soon as possible;
        // the gap is visible in the session because no samples were integrated.
        if (document.visibilityState === 'visible' && this.context?.state === 'suspended') {
          void this.context.resume().catch(() => undefined);
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    const track = this.source instanceof DeviceInput ? this.source.mediaStreamTrack : null;
    if (track) {
      this.trackEndedHandler = () => {
        this.fail(
          'The audio input was disconnected. This happens when a headset or USB microphone is unplugged, or when another app takes the microphone.'
        );
      };
      track.addEventListener('ended', this.trackEndedHandler);
      track.addEventListener('mute', () => {
        this.patchStatus({
          error: { message: 'The microphone was muted by the system.', code: 'muted' },
        });
      });
      track.addEventListener('unmute', () => {
        if (this.status.error?.code === 'muted') this.patchStatus({ error: null });
      });
    }
  }

  private startRateTimer(): void {
    this.stopRateTimer();
    this.rateTimer = setInterval(() => {
      this.patchPerformance({
        metricRate: this.metricCount,
        analysisRate: this.analysisCount,
      });
      this.metricCount = 0;
      this.analysisCount = 0;
      if (this.recorder?.isRecording) {
        this.patchStatus({ recordingSeconds: this.recorder.durationSeconds });
      }
      for (const listener of this.performanceListeners) listener(this.perf);
    }, 1000);
  }

  private stopRateTimer(): void {
    if (this.rateTimer !== null) {
      clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
  }

  private fail(message: string): void {
    this.patchStatus({ state: 'error', error: { message } });
  }

  /** Resume a context suspended by the browser (needs a user gesture). */
  async resumeContext(): Promise<void> {
    if (!this.context) return;
    await this.context.resume();
    this.patchStatus({ contextState: this.context.state, state: 'running' });
  }

  async stop(): Promise<void> {
    await this.teardown();
    this.patchStatus({
      state: 'idle',
      contextState: null,
      measuring: false,
      paused: false,
      recording: false,
      recordingSeconds: 0,
    });
  }

  private async teardown(): Promise<void> {
    this.stopRateTimer();

    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    const track = this.source instanceof DeviceInput ? this.source.mediaStreamTrack : null;
    if (track && this.trackEndedHandler) {
      track.removeEventListener('ended', this.trackEndedHandler);
      this.trackEndedHandler = null;
    }

    if (this.worker) {
      const dispose: ToAnalysisMessage = { type: 'dispose' };
      this.worker.postMessage(dispose);
      this.worker.terminate();
      this.worker = null;
    }

    if (this.meterNode) {
      this.meterNode.port.onmessage = null;
      this.meterNode.disconnect();
      this.meterNode = null;
    }
    this.sink?.disconnect();
    this.sink = null;
    this.sourceNode?.disconnect();
    this.sourceNode = null;

    await this.source?.close().catch(() => undefined);
    this.source = null;

    if (this.context && this.context.state !== 'closed') {
      await this.context.close().catch(() => undefined);
    }
    this.context = null;
    this.latestSnapshot = null;
    this.latestFrame = null;
  }

  // -------------------------------------------------------------------------
  // Measurement control
  // -------------------------------------------------------------------------

  /** Begin a measurement session: zero all integrated statistics. */
  startMeasurement(): void {
    this.clipEvents = [];
    this.send({ type: 'resetStatistics' });
    this.send({ type: 'setActive', active: true });
    this.sendAnalysis({ type: 'resetBands' });
    this.sendAnalysis({ type: 'configure', paused: false });
    this.patchStatus({ measuring: true, paused: false });
  }

  pauseMeasurement(): void {
    if (!this.status.measuring) return;
    this.send({ type: 'setActive', active: false });
    this.sendAnalysis({ type: 'configure', paused: true });
    this.patchStatus({ paused: true });
  }

  resumeMeasurement(): void {
    if (!this.status.measuring) return;
    this.send({ type: 'setActive', active: true });
    this.sendAnalysis({ type: 'configure', paused: false });
    this.patchStatus({ paused: false });
  }

  /**
   * End the measurement session. Monitoring continues so the meter stays live.
   * Integrated results remain in the last snapshot for the caller to persist.
   */
  stopMeasurement(): void {
    this.send({ type: 'setActive', active: true });
    this.send({ type: 'requestClipEvents' });
    this.patchStatus({ measuring: false, paused: false });
  }

  /** Reset the whole engine state including filter and detector state. */
  resetAll(): void {
    this.send({ type: 'reset' });
    this.sendAnalysis({ type: 'resetBands' });
    this.clipEvents = [];
  }

  updateAnalysisSettings(patch: Partial<AnalysisSettings>): void {
    this.analysisSettings = { ...this.analysisSettings, ...patch };
    this.sendAnalysis({ type: 'configure', ...patch });
  }

  clearPeakHold(): void {
    this.sendAnalysis({ type: 'clearPeakHold' });
  }

  setDcBlock(enabled: boolean): void {
    this.send({ type: 'configure', dcBlock: enabled });
  }

  setStatisticsWeighting(weighting: WeightingId): void {
    this.send({ type: 'configure', statisticsWeighting: weighting });
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  startRecording(maxSeconds?: number): void {
    const sampleRate = this.context?.sampleRate;
    if (!sampleRate) throw new Error('Cannot record before the input is started.');
    this.recorder = new WavRecorder({
      sampleRate,
      maxSeconds,
      onLimitReached: () => {
        this.send({ type: 'configure', recordPcm: false });
        this.patchStatus({ recording: false });
      },
    });
    this.recorder.start();
    this.send({ type: 'configure', recordPcm: true });
    this.patchStatus({ recording: true, recordingSeconds: 0 });
  }

  stopRecording(): Blob | null {
    this.send({ type: 'configure', recordPcm: false });
    const recorder = this.recorder;
    recorder?.stop();
    this.patchStatus({
      recording: false,
      recordingSeconds: recorder?.durationSeconds ?? 0,
    });
    return recorder?.toBlob() ?? null;
  }

  discardRecording(): void {
    this.send({ type: 'configure', recordPcm: false });
    this.recorder?.discard();
    this.recorder = null;
    this.patchStatus({ recording: false, recordingSeconds: 0 });
  }

  get recordingDurationSeconds(): number {
    return this.recorder?.durationSeconds ?? 0;
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  private send(message: ToMeterMessage): void {
    this.meterNode?.port.postMessage(message);
  }

  /**
   * Fetch the statistical level distribution from the worklet.
   *
   * Resolves null when the input is not running or the worklet does not answer
   * within the timeout, so a caller never blocks on a dead node.
   */
  requestHistogram(timeoutMs = 1500): Promise<HistogramSnapshot | null> {
    if (!this.meterNode) return Promise.resolve(null);
    const requestId = ++this.histogramRequestId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingHistograms.delete(requestId);
        resolve(null);
      }, timeoutMs);
      this.pendingHistograms.set(requestId, (histogram) => {
        clearTimeout(timer);
        resolve(histogram);
      });
      this.send({ type: 'requestHistogram', requestId });
    });
  }

  /** The most recently fetched distribution. */
  get latestHistogram(): HistogramSnapshot | null {
    return this.histogram;
  }

  private sendAnalysis(message: ToAnalysisMessage): void {
    this.worker?.postMessage(message);
  }

  private handleMeterMessage(message: FromMeterMessage): void {
    switch (message.type) {
      case 'ready':
        this.patchStatus({
          sampleRate: message.sampleRate,
          weightingAccurateUpToHz: message.weightingAccurateUpToHz,
          aWeightingHfPoleHz: message.aWeightingHfPoleHz,
          aWeightingMaxFitErrorDb: message.aWeightingMaxFitErrorDb,
        });
        break;
      case 'metrics': {
        this.latestSnapshot = message.snapshot;
        this.metricCount++;
        this.patchPerformance({
          meterLoad: message.snapshot.processingLoad,
          silentBlocks: message.silentBlocks,
        });
        for (const listener of this.metricListeners) listener(message.snapshot);
        break;
      }
      case 'pcm':
        this.recorder?.append(message.samples);
        break;
      case 'clipEvents':
        this.clipEvents = message.events;
        break;
      case 'histogram': {
        this.histogram = message.histogram;
        const resolve = this.pendingHistograms.get(message.requestId);
        if (resolve) {
          this.pendingHistograms.delete(message.requestId);
          resolve(message.histogram);
        }
        break;
      }
      case 'error':
        this.fail(message.message);
        break;
    }
  }

  private handleAnalysisMessage(message: FromAnalysisMessage): void {
    switch (message.type) {
      case 'ready':
        this.patchStatus({
          bandLayout: {
            thirdOctave: message.thirdOctaveBands,
            octave: message.octaveBands,
            octaveContributions: message.octaveContributions,
            unstableBands: message.unstableBands,
          },
        });
        // Band statistics start accumulating as soon as the bank exists; the
        // measurement START resets them.
        this.sendAnalysis({ type: 'enableStatistics' });
        break;
      case 'frame': {
        this.latestFrame = toAnalysisFrame(message);
        this.analysisCount++;
        this.patchPerformance({
          analysisLoad: message.processingLoad,
          droppedSamples: message.droppedSamples,
        });
        for (const listener of this.analysisListeners) listener(this.latestFrame);
        break;
      }
      case 'error':
        this.patchStatus({ error: { message: message.message, code: 'analysis' } });
        break;
    }
  }
}

function toAnalysisFrame(message: AnalysisFrameMessage): AnalysisFrame {
  return {
    sequence: message.sequence,
    spectrum: message.spectrum,
    spectrumPeak: message.spectrumPeak,
    fftSize: message.fftSize,
    binWidth: message.binWidth,
    window: message.window,
    peak: message.peak,
    thirdCurrent: message.thirdCurrent,
    thirdLeq: message.thirdLeq,
    thirdMax: message.thirdMax,
    octaveCurrent: message.octaveCurrent,
    octaveLeq: message.octaveLeq,
    octaveMax: message.octaveMax,
    bankWeighting: message.bankWeighting,
    bandSamples: message.bandSamples,
    processingLoad: message.processingLoad,
    droppedSamples: message.droppedSamples,
  };
}

export { ANALYSIS_UPDATE_HZ };
