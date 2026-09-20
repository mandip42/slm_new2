/**
 * Message protocol between the three execution contexts.
 *
 *   main thread  <--(worklet.port)-->  AudioWorklet  --(MessageChannel)-->  analysis Worker
 *        ^                                                                        |
 *        +-------------------------(worker.postMessage)---------------------------+
 *
 * PCM travels directly from the AudioWorklet to the analysis Worker over a
 * transferred MessagePort, so the main thread is never in the audio data path
 * and UI work cannot stall the analysis. Buffers are transferred, not copied.
 */

import type { MeterSnapshot } from '@/dsp/engine';
import type { ClipEvent } from '@/dsp/clipping';
import type { WindowId } from '@/dsp/window';
import type { WeightingId } from '@/dsp/weighting/reference';

/** Number of samples the worklet buffers before forwarding a PCM block. */
export const PCM_FORWARD_BLOCK = 2048;

/** Metric snapshots per second delivered to the UI. */
export const METRIC_UPDATE_HZ = 20;

/** Spectrum/band updates per second delivered to the UI. */
export const ANALYSIS_UPDATE_HZ = 15;

/** Name the meter processor registers under. */
export const METER_PROCESSOR_NAME = 'acousticlab-meter';

/** URL the compiled worklet is served from. */
export const METER_WORKLET_URL = '/worklets/meter-processor.js';

// ---------------------------------------------------------------------------
// main thread -> AudioWorklet
// ---------------------------------------------------------------------------

export interface MeterConfigureMessage {
  type: 'configure';
  dcBlock?: boolean;
  statisticsWeighting?: WeightingId;
  /** Forward PCM to the main thread for WAV recording. */
  recordPcm?: boolean;
}

export interface MeterResetMessage {
  type: 'reset';
}

export interface MeterResetStatisticsMessage {
  type: 'resetStatistics';
}

export interface MeterSetAnalysisPortMessage {
  type: 'setAnalysisPort';
  port: MessagePort;
}

export interface MeterSetActiveMessage {
  type: 'setActive';
  /** When false the processor keeps running but drops all input (pause). */
  active: boolean;
}

export interface MeterRequestClipEventsMessage {
  type: 'requestClipEvents';
}

/**
 * Ask for the statistical level distribution.
 *
 * The histogram lives inside the worklet next to the detector that fills it, so
 * there is only one distribution and the displayed percentiles and the exported
 * distribution can never disagree. It is 2000 bins wide but only the occupied
 * range is transferred, so a reply is typically a few hundred numbers — cheap
 * enough to poll once a second while the statistics screen is open, and far
 * cheaper than shipping it with every metric frame.
 */
export interface MeterRequestHistogramMessage {
  type: 'requestHistogram';
  requestId: number;
}

export type ToMeterMessage =
  | MeterConfigureMessage
  | MeterResetMessage
  | MeterResetStatisticsMessage
  | MeterSetAnalysisPortMessage
  | MeterSetActiveMessage
  | MeterRequestClipEventsMessage
  | MeterRequestHistogramMessage;

// ---------------------------------------------------------------------------
// AudioWorklet -> main thread
// ---------------------------------------------------------------------------

export interface MeterReadyMessage {
  type: 'ready';
  sampleRate: number;
  /** Frequency above which the weighting design is no longer within tolerance. */
  weightingAccurateUpToHz: number;
  aWeightingHfPoleHz: number;
  aWeightingMaxFitErrorDb: number;
}

export interface MeterMetricsMessage {
  type: 'metrics';
  snapshot: MeterSnapshot;
  /** Number of process() calls that received no input since the last message. */
  silentBlocks: number;
  /** AudioContext time of the snapshot, in seconds. */
  contextTime: number;
}

export interface MeterPcmMessage {
  type: 'pcm';
  /** Mono float samples, transferred. */
  samples: Float32Array;
  /** Sample index of the first sample, from the start of the worklet. */
  startSample: number;
}

export interface MeterClipEventsMessage {
  type: 'clipEvents';
  events: ClipEvent[];
}

/** Serialised level distribution, in the dBFS domain. */
export interface HistogramSnapshot {
  minDb: number;
  binWidth: number;
  /** Index of the first transferred bin within the full histogram. */
  first: number;
  counts: number[];
  /** Total number of statistical samples taken. */
  sampleCount: number;
  /** Weighting and time weighting the distribution was sampled from. */
  weighting: WeightingId;
  timeWeighting: 'F' | 'S';
  sampleRateHz: number;
}

export interface MeterHistogramMessage {
  type: 'histogram';
  requestId: number;
  histogram: HistogramSnapshot;
}

export interface MeterErrorMessage {
  type: 'error';
  message: string;
}

export type FromMeterMessage =
  | MeterReadyMessage
  | MeterMetricsMessage
  | MeterPcmMessage
  | MeterClipEventsMessage
  | MeterHistogramMessage
  | MeterErrorMessage;

// ---------------------------------------------------------------------------
// main thread -> analysis Worker
// ---------------------------------------------------------------------------

export interface AnalysisInitMessage {
  type: 'init';
  sampleRate: number;
  port: MessagePort;
  fftSize: number;
  window: WindowId;
  /** Pre-weighting applied before the filter bank ('Z' = none). */
  bankWeighting: WeightingId;
  /** Exponential spectrum smoothing, 0 (none) .. 0.95. */
  smoothing: number;
  peakHold: boolean;
}

export interface AnalysisConfigureMessage {
  type: 'configure';
  fftSize?: number;
  window?: WindowId;
  bankWeighting?: WeightingId;
  smoothing?: number;
  peakHold?: boolean;
  /** Emit spectrogram columns in addition to the spectrum. */
  spectrogram?: boolean;
  paused?: boolean;
}

export interface AnalysisControlMessage {
  type: 'resetBands' | 'enableStatistics' | 'clearPeakHold' | 'dispose';
}

export type ToAnalysisMessage =
  | AnalysisInitMessage
  | AnalysisConfigureMessage
  | AnalysisControlMessage;

// ---------------------------------------------------------------------------
// analysis Worker -> main thread
// ---------------------------------------------------------------------------

export interface BandLayoutEntry {
  index: number;
  nominal: number;
  exact: number;
  lower: number;
  upper: number;
  label: string;
  available: boolean;
  unavailableReason?: string;
}

export interface AnalysisReadyMessage {
  type: 'ready';
  sampleRate: number;
  thirdOctaveBands: BandLayoutEntry[];
  octaveBands: BandLayoutEntry[];
  /** For each octave band, how many 1/3-octave bands contribute. */
  octaveContributions: number[];
  unstableBands: number[];
}

export interface AnalysisFrameMessage {
  type: 'frame';
  sequence: number;
  /** Bin levels in dBFS, transferred. */
  spectrum: Float32Array;
  /** Peak-hold bin levels in dBFS, transferred. Null when peak hold is off. */
  spectrumPeak: Float32Array | null;
  fftSize: number;
  binWidth: number;
  window: WindowId;
  /** Dominant spectral peak. */
  peak: { frequency: number; levelDb: number };

  /** 1/3-octave current / Leq / max levels in dBFS, transferred. */
  thirdCurrent: Float32Array;
  thirdLeq: Float32Array;
  thirdMax: Float32Array;
  /** Octave levels derived by energy summation, transferred. */
  octaveCurrent: Float32Array;
  octaveLeq: Float32Array;
  octaveMax: Float32Array;

  bankWeighting: WeightingId;
  bandSamples: number;
  /** Fraction of real time spent in the worker on the last batch. */
  processingLoad: number;
  /** Samples dropped because the worker could not keep up. */
  droppedSamples: number;
}

export interface AnalysisErrorMessage {
  type: 'error';
  message: string;
}

export type FromAnalysisMessage =
  | AnalysisReadyMessage
  | AnalysisFrameMessage
  | AnalysisErrorMessage;
