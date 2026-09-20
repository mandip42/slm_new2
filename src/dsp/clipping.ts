/**
 * Digital clipping and probable microphone/preamp saturation detection.
 *
 * Two independent indicators are produced because they mean different things:
 *
 *  - **Digital clipping**: samples at or beyond full scale. Detected as a run of
 *    at least `MIN_CLIP_RUN` consecutive samples whose magnitude is >=
 *    `CLIP_THRESHOLD`. A single sample at full scale is not enough — that
 *    happens naturally on loud but unclipped material.
 *
 *  - **Near-overload**: the peak has entered the top `NEAR_OVERLOAD_DB` of the
 *    digital range. On phones the analog front end usually compresses before
 *    the converter clips, so a sustained near-overload is a warning that the
 *    reading may already be low even though no hard clipping is visible.
 *
 * Detected events are timestamped so they can be recorded in the session and
 * flagged in exports.
 */

export const CLIP_THRESHOLD = 0.99;
export const MIN_CLIP_RUN = 3;
export const NEAR_OVERLOAD_DB = -1.0;

export interface ClipEvent {
  /** Elapsed seconds from the start of the measurement. */
  atSeconds: number;
  /** Duration of the clipped run in samples. */
  samples: number;
  /** Peak magnitude observed during the run. */
  peak: number;
}

export interface ClipStatus {
  /** True while a clipped run is currently active or was seen very recently. */
  active: boolean;
  /** Total number of discrete clipping events. */
  events: number;
  /** Total number of clipped samples. */
  clippedSamples: number;
  /** Fraction of all processed samples that were clipped. */
  clippedFraction: number;
  /** Peak level over the whole measurement, in dBFS. */
  peakDb: number;
  /** True when the peak has entered the near-overload region. */
  nearOverload: boolean;
  /** Elapsed seconds of the most recent event, or null. */
  lastEventAtSeconds: number | null;
}

/**
 * Streaming clipping detector. Allocation free in the processing path; events
 * are collected in a bounded list.
 */
export class ClipDetector {
  private run = 0;
  private runPeak = 0;
  private inEvent = false;
  private clippedSamples = 0;
  private totalSamples = 0;
  private eventCount = 0;
  private peak = 0;
  private lastEventSample: number | null = null;
  private readonly events: ClipEvent[] = [];
  private readonly maxEvents: number;
  private readonly holdSamples: number;

  constructor(
    readonly sampleRate: number,
    options: { maxEvents?: number; holdSeconds?: number } = {}
  ) {
    this.maxEvents = options.maxEvents ?? 500;
    this.holdSamples = Math.round(sampleRate * (options.holdSeconds ?? 1));
  }

  /** Process one block. */
  processBlock(input: Float32Array | Float64Array): void {
    const n = input.length;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(input[i]);
      if (a > this.peak) this.peak = a;
      if (a >= CLIP_THRESHOLD) {
        this.run++;
        if (a > this.runPeak) this.runPeak = a;
        this.clippedSamples++;
        if (!this.inEvent && this.run >= MIN_CLIP_RUN) {
          this.inEvent = true;
          this.eventCount++;
          this.lastEventSample = this.totalSamples + i;
          if (this.events.length < this.maxEvents) {
            this.events.push({
              atSeconds: (this.totalSamples + i) / this.sampleRate,
              samples: this.run,
              peak: this.runPeak,
            });
          }
        } else if (this.inEvent && this.events.length > 0) {
          const last = this.events[this.events.length - 1];
          last.samples = this.run;
          last.peak = Math.max(last.peak, this.runPeak);
        }
      } else {
        if (this.run > 0 && this.run < MIN_CLIP_RUN) {
          // Isolated full-scale samples are not counted as clipping.
          this.clippedSamples -= this.run;
        }
        this.run = 0;
        this.runPeak = 0;
        this.inEvent = false;
      }
    }
    this.totalSamples += n;
  }

  reset(): void {
    this.run = 0;
    this.runPeak = 0;
    this.inEvent = false;
    this.clippedSamples = 0;
    this.totalSamples = 0;
    this.eventCount = 0;
    this.peak = 0;
    this.lastEventSample = null;
    this.events.length = 0;
  }

  status(): ClipStatus {
    const peakDb = this.peak > 0 ? 20 * Math.log10(this.peak) : -200;
    const recentlyClipped =
      this.lastEventSample !== null && this.totalSamples - this.lastEventSample <= this.holdSamples;
    return {
      active: this.inEvent || recentlyClipped,
      events: this.eventCount,
      clippedSamples: this.clippedSamples,
      clippedFraction: this.totalSamples > 0 ? this.clippedSamples / this.totalSamples : 0,
      peakDb,
      nearOverload: peakDb >= NEAR_OVERLOAD_DB,
      lastEventAtSeconds:
        this.lastEventSample !== null ? this.lastEventSample / this.sampleRate : null,
    };
  }

  /** Recorded events (bounded list). */
  eventList(): readonly ClipEvent[] {
    return this.events;
  }
}
