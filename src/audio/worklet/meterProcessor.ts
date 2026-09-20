/**
 * AudioWorklet processor: the real-time end of the measurement chain.
 *
 * Responsibilities (all of it time critical, none of it optional):
 *   * down-mix the input to mono
 *   * run the MeterEngine (A/C/Z weighting, Fast/Slow/Impulse detectors, Leq,
 *     peaks, extremes, statistics, clipping) at the full sample rate
 *   * emit a metric snapshot 20 times per second to the main thread
 *   * forward raw PCM blocks straight to the analysis Worker over a transferred
 *     MessagePort, so the main thread never touches audio data
 *
 * Deliberately NOT done here: FFT and the 1/3-octave filter bank. Those are
 * batched in a Worker. Keeping them off the audio rendering thread is what stops
 * a heavy analysis frame from causing a dropout.
 *
 * This file is compiled to public/worklets/meter-processor.js by
 * scripts/build-worklet.mjs. It shares the DSP implementation with the tests and
 * the developer lab, so there is exactly one meter to be correct about.
 */

import { MeterEngine } from '../../dsp/engine';
import { STATISTICS_SAMPLE_RATE_HZ } from '../../dsp/statistics';
import { aWeightingDesign, weightingAccurateUpToHz } from '../../dsp/weighting/design';
import type { WeightingId } from '../../dsp/weighting/reference';
import {
  METER_PROCESSOR_NAME,
  METRIC_UPDATE_HZ,
  PCM_FORWARD_BLOCK,
  type FromMeterMessage,
  type ToMeterMessage,
} from '../messages';

/** Web Audio render quantum. */
const RENDER_QUANTUM = 128;

class MeterProcessor extends AudioWorkletProcessor {
  private engine: MeterEngine;
  private analysisPort: MessagePort | null = null;

  private mono: Float32Array;
  private forwardBuffer: Float32Array;
  private forwardFill = 0;

  private recordBuffer: Float32Array | null = null;
  private recordFill = 0;
  private recordPcm = false;

  private metricInterval: number;
  private sinceMetrics = 0;
  private silentBlocks = 0;
  private active = true;
  private totalSamples = 0;
  private failed = false;

  constructor() {
    super();
    this.engine = new MeterEngine({ sampleRate, dcBlock: true, statisticsWeighting: 'A' });
    this.mono = new Float32Array(128);
    this.forwardBuffer = new Float32Array(PCM_FORWARD_BLOCK);
    this.metricInterval = Math.max(1, Math.round(sampleRate / METRIC_UPDATE_HZ));

    this.port.onmessage = (event: MessageEvent<ToMeterMessage>) => {
      try {
        this.handleMessage(event.data);
      } catch (error) {
        this.post({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const design = aWeightingDesign(sampleRate);
    this.post({
      type: 'ready',
      sampleRate,
      weightingAccurateUpToHz: weightingAccurateUpToHz(sampleRate),
      aWeightingHfPoleHz: design.hfPoleHz,
      aWeightingMaxFitErrorDb: design.maxFitErrorDb,
    });
  }

  private post(message: FromMeterMessage, transfer?: Transferable[]): void {
    if (transfer && transfer.length > 0) {
      this.port.postMessage(message, transfer);
    } else {
      this.port.postMessage(message);
    }
  }

  private handleMessage(message: ToMeterMessage): void {
    switch (message.type) {
      case 'configure': {
        if (message.recordPcm !== undefined) {
          this.recordPcm = message.recordPcm;
          if (this.recordPcm) {
            this.recordBuffer = new Float32Array(PCM_FORWARD_BLOCK);
            this.recordFill = 0;
          } else {
            this.recordBuffer = null;
            this.recordFill = 0;
          }
        }
        const needsRebuild =
          message.dcBlock !== undefined || message.statisticsWeighting !== undefined;
        if (needsRebuild) {
          const dcBlock = message.dcBlock ?? this.engine.options.dcBlock;
          const statisticsWeighting: WeightingId =
            message.statisticsWeighting ?? this.engine.options.statisticsWeighting;
          this.engine = new MeterEngine({ sampleRate, dcBlock, statisticsWeighting });
        }
        break;
      }
      case 'reset':
        this.engine.reset();
        this.totalSamples = 0;
        break;
      case 'resetStatistics':
        this.engine.resetStatistics();
        break;
      case 'setAnalysisPort':
        this.analysisPort = message.port;
        break;
      case 'setActive':
        this.active = message.active;
        break;
      case 'requestClipEvents':
        this.post({ type: 'clipEvents', events: this.engine.clipEvents.map((e) => ({ ...e })) });
        break;
      case 'requestHistogram': {
        const histogram = this.engine.levelHistogram;
        const json = histogram.toJSON();
        this.post({
          type: 'histogram',
          requestId: message.requestId,
          histogram: {
            ...json,
            sampleCount: histogram.sampleCount,
            weighting: this.engine.options.statisticsWeighting,
            timeWeighting: this.engine.options.statisticsTimeWeighting,
            sampleRateHz: STATISTICS_SAMPLE_RATE_HZ,
          },
        });
        break;
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.failed) return true;
    try {
      this.render(inputs);
    } catch (error) {
      // A throwing process() silently kills the node in some browsers, so the
      // failure is reported and the processor becomes a no-op instead.
      this.failed = true;
      this.post({
        type: 'error',
        message: `Meter processing failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return true;
  }

  private render(inputs: Float32Array[][]): void {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0] || input[0].length === 0) {
      // No connected input this quantum. Counted as a diagnostic rather than
      // feeding zeros into the meter, which would corrupt the measurement.
      // Metrics still flow so the UI can show that input has been lost.
      this.silentBlocks++;
      this.sinceMetrics += RENDER_QUANTUM;
      this.emitMetricsIfDue();
      return;
    }

    const frames = input[0].length;
    if (this.mono.length !== frames) this.mono = new Float32Array(frames);
    const mono = this.mono;

    if (input.length === 1) {
      mono.set(input[0]);
    } else {
      const channels = input.length;
      const scale = 1 / channels;
      for (let i = 0; i < frames; i++) {
        let acc = 0;
        for (let c = 0; c < channels; c++) acc += input[c][i];
        mono[i] = acc * scale;
      }
    }

    this.sinceMetrics += frames;

    if (!this.active) {
      // Paused: the engine is not fed, so no time and no energy accumulate, but
      // the UI keeps receiving the (frozen) snapshot.
      this.emitMetricsIfDue();
      return;
    }

    this.engine.process(mono);
    this.totalSamples += frames;

    this.forward(mono, frames);
    if (this.recordPcm) this.collectForRecording(mono, frames);

    this.emitMetricsIfDue();
  }

  /** Accumulate PCM and ship whole blocks to the analysis worker. */
  private forward(mono: Float32Array, frames: number): void {
    const port = this.analysisPort;
    if (!port) return;
    let offset = 0;
    while (offset < frames) {
      const space = PCM_FORWARD_BLOCK - this.forwardFill;
      const take = Math.min(space, frames - offset);
      this.forwardBuffer.set(mono.subarray(offset, offset + take), this.forwardFill);
      this.forwardFill += take;
      offset += take;
      if (this.forwardFill === PCM_FORWARD_BLOCK) {
        const block = this.forwardBuffer;
        this.forwardBuffer = new Float32Array(PCM_FORWARD_BLOCK);
        this.forwardFill = 0;
        port.postMessage(block, [block.buffer]);
      }
    }
  }

  /** Accumulate PCM for WAV recording and ship blocks to the main thread. */
  private collectForRecording(mono: Float32Array, frames: number): void {
    let buffer = this.recordBuffer;
    if (!buffer) return;
    let offset = 0;
    while (offset < frames) {
      const space = PCM_FORWARD_BLOCK - this.recordFill;
      const take = Math.min(space, frames - offset);
      buffer.set(mono.subarray(offset, offset + take), this.recordFill);
      this.recordFill += take;
      offset += take;
      if (this.recordFill === PCM_FORWARD_BLOCK) {
        const block = buffer;
        buffer = new Float32Array(PCM_FORWARD_BLOCK);
        this.recordBuffer = buffer;
        this.recordFill = 0;
        this.post(
          {
            type: 'pcm',
            samples: block,
            startSample: this.totalSamples - PCM_FORWARD_BLOCK,
          },
          [block.buffer]
        );
      }
    }
  }

  private emitMetricsIfDue(): void {
    if (this.sinceMetrics < this.metricInterval) return;
    this.sinceMetrics = 0;
    const silentBlocks = this.silentBlocks;
    this.silentBlocks = 0;
    this.post({
      type: 'metrics',
      snapshot: this.engine.snapshot(),
      silentBlocks,
      contextTime: currentTime,
    });
  }
}

registerProcessor(METER_PROCESSOR_NAME, MeterProcessor);
