/// <reference lib="webworker" />
/**
 * Analysis Worker: 1/3-octave filter bank + FFT spectrum.
 *
 * Runs off both the audio rendering thread and the UI thread. PCM arrives
 * directly from the AudioWorklet over a transferred MessagePort, so a slow UI
 * frame cannot stall analysis and a slow analysis batch cannot cause an audio
 * dropout.
 *
 * The filter bank processes **every** sample — the batching is only about which
 * thread does the work, not about throwing samples away. Filter state persists
 * across blocks so the filtering is continuous.
 *
 * The spectrum is computed at a fixed display rate from a ring buffer of the
 * most recent `fftSize` samples, which decouples the FFT rate from the block
 * rate and from the FFT size.
 */

import { SpectrumAnalyzer } from '@/dsp/fft';
import { BiquadCascade } from '@/dsp/biquad';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import { FractionalOctaveBank, sumThirdOctavesToOctaves } from '@/dsp/octave';
import { createBandPlan } from '@/dsp/thirdOctave';
import { designWeighting } from '@/dsp/weighting/design';
import type { WeightingId } from '@/dsp/weighting/reference';
import type { WindowId } from '@/dsp/window';
import {
  ANALYSIS_UPDATE_HZ,
  type BandLayoutEntry,
  type FromAnalysisMessage,
  type ToAnalysisMessage,
} from '../messages';

/**
 * Hard cap on how much backlog the worker will chew through in one batch.
 * If the device cannot keep up, samples are dropped and reported rather than
 * letting the queue grow without bound.
 */
const MAX_BACKLOG_SAMPLES = 48000 * 2;

interface State {
  sampleRate: number;
  bank: FractionalOctaveBank;
  preWeighting: BiquadCascade | null;
  bankWeighting: WeightingId;
  plan: ReturnType<typeof createBandPlan>;
  availability: boolean[];
  analyzer: SpectrumAnalyzer;
  ring: Float32Array;
  ringWrite: number;
  ringFilled: number;
  frame: Float64Array;
  smoothed: Float64Array | null;
  peakHoldLevels: Float32Array | null;
  smoothing: number;
  peakHold: boolean;
  paused: boolean;
  weightedScratch: Float64Array;
  sequence: number;
  samplesSinceFrame: number;
  frameInterval: number;
  droppedSamples: number;
  pending: Float32Array[];
  pendingSamples: number;
}

let state: State | null = null;

function post(message: FromAnalysisMessage, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    (self as unknown as Worker).postMessage(message, transfer);
  } else {
    (self as unknown as Worker).postMessage(message);
  }
}

function toLayout(
  bands: ReturnType<typeof createBandPlan>['thirdBands']
): BandLayoutEntry[] {
  return bands.map((b) => ({
    index: b.index,
    nominal: b.nominal,
    exact: b.exact,
    lower: b.lower,
    upper: b.upper,
    label: b.label,
    available: b.available,
    unavailableReason: b.unavailableReason,
  }));
}

function buildPreWeighting(weighting: WeightingId, sampleRate: number): BiquadCascade | null {
  const sections = designWeighting(weighting, sampleRate);
  return sections.length > 0 ? new BiquadCascade(sections) : null;
}

function init(message: Extract<ToAnalysisMessage, { type: 'init' }>): void {
  const { sampleRate, fftSize, window: windowId, bankWeighting, smoothing, peakHold } = message;
  const plan = createBandPlan(sampleRate);
  const bank = new FractionalOctaveBank(plan.thirdBands, sampleRate, 3);
  const analyzer = new SpectrumAnalyzer(fftSize, sampleRate, windowId);

  state = {
    sampleRate,
    bank,
    preWeighting: buildPreWeighting(bankWeighting, sampleRate),
    bankWeighting,
    plan,
    availability: plan.thirdBands.map((b) => b.available),
    analyzer,
    ring: new Float32Array(Math.max(fftSize, 16384) * 2),
    ringWrite: 0,
    ringFilled: 0,
    frame: new Float64Array(fftSize),
    smoothed: null,
    peakHoldLevels: null,
    smoothing,
    peakHold,
    paused: false,
    weightedScratch: new Float64Array(4096),
    sequence: 0,
    samplesSinceFrame: 0,
    frameInterval: Math.max(1, Math.round(sampleRate / ANALYSIS_UPDATE_HZ)),
    droppedSamples: 0,
    pending: [],
    pendingSamples: 0,
  };

  const { levelsDb: _unused, contributingBands } = sumThirdOctavesToOctaves(
    new Float32Array(plan.thirdBands.length).fill(LEVEL_FLOOR_DB),
    plan.groups,
    state.availability
  );
  void _unused;

  message.port.onmessage = (event: MessageEvent<Float32Array>) => {
    onPcm(event.data);
  };
  message.port.start?.();

  post({
    type: 'ready',
    sampleRate,
    thirdOctaveBands: toLayout(plan.thirdBands),
    octaveBands: toLayout(plan.octaveBands),
    octaveContributions: Array.from(contributingBands),
    unstableBands: bank.unstableBands,
  });
}

function onPcm(block: Float32Array): void {
  const s = state;
  if (!s || s.paused) return;

  s.pending.push(block);
  s.pendingSamples += block.length;

  // Drop the oldest backlog if the device cannot keep up, and say so.
  while (s.pendingSamples > MAX_BACKLOG_SAMPLES && s.pending.length > 1) {
    const dropped = s.pending.shift()!;
    s.pendingSamples -= dropped.length;
    s.droppedSamples += dropped.length;
  }

  const started = performance.now();
  let processed = 0;
  while (s.pending.length > 0) {
    const next = s.pending.shift()!;
    s.pendingSamples -= next.length;
    processBlock(s, next);
    processed += next.length;
  }

  if (s.samplesSinceFrame >= s.frameInterval) {
    s.samplesSinceFrame = 0;
    const elapsed = performance.now() - started;
    const realTime = (processed / s.sampleRate) * 1000;
    emitFrame(s, realTime > 0 ? elapsed / realTime : 0);
  }
}

function processBlock(s: State, block: Float32Array): void {
  const n = block.length;

  // Filter bank input: optionally pre-weighted so that A-weighted band levels
  // come from a real A-weighting filter rather than a per-band dB offset.
  let bankInput: Float32Array | Float64Array = block;
  if (s.preWeighting) {
    if (s.weightedScratch.length < n) s.weightedScratch = new Float64Array(nextPow2(n));
    const scratch = s.weightedScratch.subarray(0, n);
    s.preWeighting.processBlock(block, scratch);
    bankInput = scratch;
  }
  s.bank.processBlock(bankInput);

  // Ring buffer for the FFT always holds the unweighted signal: the spectrum is
  // a Z-weighted view and the weighting is applied for display if requested.
  const ring = s.ring;
  const cap = ring.length;
  let write = s.ringWrite;
  for (let i = 0; i < n; i++) {
    ring[write] = block[i];
    write = write + 1 === cap ? 0 : write + 1;
  }
  s.ringWrite = write;
  s.ringFilled = Math.min(cap, s.ringFilled + n);
  s.samplesSinceFrame += n;
}

function emitFrame(s: State, processingLoad: number): void {
  const size = s.analyzer.fftSize;
  if (s.ringFilled < size) return;

  // Copy the most recent `size` samples out of the ring buffer.
  const ring = s.ring;
  const cap = ring.length;
  let read = s.ringWrite - size;
  if (read < 0) read += cap;
  const frame = s.frame;
  for (let i = 0; i < size; i++) {
    frame[i] = ring[read];
    read = read + 1 === cap ? 0 : read + 1;
  }

  const result = s.analyzer.analyse(frame);

  // Exponential smoothing in the power domain, which is the only way that keeps
  // the average of a fluctuating spectrum energy-correct.
  let display: Float32Array;
  if (s.smoothing > 0) {
    if (!s.smoothed || s.smoothed.length !== result.binCount) {
      s.smoothed = new Float64Array(result.binCount);
      for (let k = 0; k < result.binCount; k++) {
        s.smoothed[k] = Math.pow(10, result.levelsDb[k] / 10);
      }
    } else {
      const a = s.smoothing;
      for (let k = 0; k < result.binCount; k++) {
        const power = Math.pow(10, result.levelsDb[k] / 10);
        s.smoothed[k] = a * s.smoothed[k] + (1 - a) * power;
      }
    }
    display = new Float32Array(result.binCount);
    for (let k = 0; k < result.binCount; k++) {
      display[k] = s.smoothed[k] > 0 ? 10 * Math.log10(s.smoothed[k]) : LEVEL_FLOOR_DB;
    }
  } else {
    display = new Float32Array(result.levelsDb);
  }

  let peakCopy: Float32Array | null = null;
  if (s.peakHold) {
    if (!s.peakHoldLevels || s.peakHoldLevels.length !== result.binCount) {
      s.peakHoldLevels = new Float32Array(result.binCount).fill(LEVEL_FLOOR_DB);
    }
    const hold = s.peakHoldLevels;
    for (let k = 0; k < result.binCount; k++) {
      if (display[k] > hold[k]) hold[k] = display[k];
    }
    peakCopy = new Float32Array(hold);
  } else {
    s.peakHoldLevels = null;
  }

  const peak = s.analyzer.findPeak(display);

  const bands = s.bank.results();
  const thirdCurrent = new Float32Array(bands.current);
  const thirdLeq = new Float32Array(bands.leq);
  const thirdMax = new Float32Array(bands.max);

  const octaveCurrent = sumThirdOctavesToOctaves(thirdCurrent, s.plan.groups, s.availability).levelsDb;
  const octaveLeq = sumThirdOctavesToOctaves(thirdLeq, s.plan.groups, s.availability).levelsDb;
  const octaveMax = sumThirdOctavesToOctaves(thirdMax, s.plan.groups, s.availability).levelsDb;

  const dropped = s.droppedSamples;
  s.droppedSamples = 0;

  const transfer: Transferable[] = [
    display.buffer,
    thirdCurrent.buffer,
    thirdLeq.buffer,
    thirdMax.buffer,
    octaveCurrent.buffer,
    octaveLeq.buffer,
    octaveMax.buffer,
  ];
  if (peakCopy) transfer.push(peakCopy.buffer);

  post(
    {
      type: 'frame',
      sequence: ++s.sequence,
      spectrum: display,
      spectrumPeak: peakCopy,
      fftSize: size,
      binWidth: result.binWidth,
      window: result.window,
      peak,
      thirdCurrent,
      thirdLeq,
      thirdMax,
      octaveCurrent,
      octaveLeq,
      octaveMax,
      bankWeighting: s.bankWeighting,
      bandSamples: bands.samples,
      processingLoad,
      droppedSamples: dropped,
    },
    transfer
  );
}

function configure(message: Extract<ToAnalysisMessage, { type: 'configure' }>): void {
  const s = state;
  if (!s) return;

  if (message.paused !== undefined) s.paused = message.paused;
  if (message.smoothing !== undefined) {
    s.smoothing = Math.min(0.95, Math.max(0, message.smoothing));
    s.smoothed = null;
  }
  if (message.peakHold !== undefined) {
    s.peakHold = message.peakHold;
    if (!message.peakHold) s.peakHoldLevels = null;
  }
  if (message.window !== undefined) {
    s.analyzer.setWindow(message.window as WindowId);
    s.smoothed = null;
    s.peakHoldLevels = null;
  }
  if (message.fftSize !== undefined && message.fftSize !== s.analyzer.fftSize) {
    s.analyzer = new SpectrumAnalyzer(message.fftSize, s.sampleRate, s.analyzer.windowId);
    s.frame = new Float64Array(message.fftSize);
    const needed = Math.max(message.fftSize, 16384) * 2;
    if (s.ring.length !== needed) {
      s.ring = new Float32Array(needed);
      s.ringWrite = 0;
      s.ringFilled = 0;
    }
    s.smoothed = null;
    s.peakHoldLevels = null;
  }
  if (message.bankWeighting !== undefined && message.bankWeighting !== s.bankWeighting) {
    // Changing the pre-weighting invalidates every accumulated band statistic,
    // so they are reset rather than silently mixing two weightings.
    s.bankWeighting = message.bankWeighting;
    s.preWeighting = buildPreWeighting(message.bankWeighting, s.sampleRate);
    s.bank.reset();
    s.bank.enableStatistics();
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

self.onmessage = (event: MessageEvent<ToAnalysisMessage>) => {
  try {
    const message = event.data;
    switch (message.type) {
      case 'init':
        init(message);
        break;
      case 'configure':
        configure(message);
        break;
      case 'resetBands':
        state?.bank.reset();
        state?.bank.enableStatistics();
        break;
      case 'enableStatistics':
        state?.bank.enableStatistics();
        break;
      case 'clearPeakHold':
        if (state) state.peakHoldLevels = null;
        break;
      case 'dispose':
        state = null;
        self.close();
        break;
    }
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
