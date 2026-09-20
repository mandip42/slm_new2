/**
 * MeterEngine — the sound level meter core.
 *
 * The engine is deliberately free of any browser or React dependency: it takes
 * blocks of float samples and produces low-rate metric snapshots. The exact same
 * object runs
 *
 *   * inside the AudioWorklet on live microphone audio,
 *   * inside the developer DSP lab on synthetic signals,
 *   * inside the Vitest suite on signals with analytically known levels.
 *
 * That is what makes the automated DSP validation meaningful: there is only one
 * implementation to be right about.
 *
 * All three frequency weightings and both primary time weightings run
 * simultaneously, so the user can switch A/C/Z and Fast/Slow with no loss of
 * measurement continuity.
 *
 * Levels are dBFS (see ./levels.ts). Conversion to SPL happens in the
 * calibration layer.
 */

import { BiquadCascade } from './biquad';
import { ClipDetector, type ClipStatus } from './clipping';
import { LeqIntegrator, MovingLeq } from './leq';
import { LEVEL_FLOOR_DB, amplitudeToDb, meanSquareToDb, soundExposureLevel } from './levels';
import {
  LevelHistogram,
  type PercentileSet,
  STATISTICS_SAMPLE_RATE_HZ,
} from './statistics';
import {
  ExponentialDetector,
  ImpulseDetector,
  TIME_CONSTANTS,
  type TimeWeightingId,
} from './timeWeighting';
import { DEFAULT_DC_BLOCK_HZ, designHighPass, designWeighting } from './weighting/design';
import type { WeightingId } from './weighting/reference';

/**
 * Acquisition warm-up in seconds.
 *
 * During warm-up the filters and detectors run so their internal states settle,
 * but no Leq energy, maximum, minimum or statistical sample is recorded. Without
 * this, the ring-up of the 20 Hz band-pass sections and the exponential
 * detectors would be recorded as genuine (low) measurement data.
 */
export const WARM_UP_SECONDS = 0.5;

export interface MeterEngineOptions {
  sampleRate: number;
  /** Apply the 10 Hz DC / infrasound blocker to the input. Default true. */
  dcBlock?: boolean;
  dcBlockHz?: number;
  /** Frequency weighting used for the statistical distribution. Default 'A'. */
  statisticsWeighting?: WeightingId;
  /** Time weighting used for the statistical distribution. Default 'F'. */
  statisticsTimeWeighting?: Exclude<TimeWeightingId, 'I'>;
  /** Short-Leq segment length in seconds. Default 1. */
  shortLeqSeconds?: number;
  /** Warm-up length in seconds. Default WARM_UP_SECONDS. */
  warmUpSeconds?: number;
  /** Monotonic clock in milliseconds, for the processing-load estimate. */
  now?: () => number;
}

export interface MeterSnapshot {
  sequence: number;
  sampleRate: number;
  /** Samples seen since the engine was created, including warm-up. */
  totalSamples: number;
  /** Samples included in the integrated statistics. */
  integratedSamples: number;
  /** Integrated measurement duration in seconds. */
  durationSeconds: number;
  warmingUp: boolean;

  // Instantaneous time-weighted levels (dBFS)
  LAF: number;
  LAS: number;
  LAI: number;
  LCF: number;
  LCS: number;
  LZF: number;
  LZS: number;

  // Energy-averaged levels (dBFS)
  LAeq: number;
  LCeq: number;
  LZeq: number;
  /** Moving 1 s LAeq. */
  LAeq1s: number;
  /** Sound exposure level derived from LAeq and the integrated duration. */
  LAE: number;

  // Extremes of the time-weighted levels (dBFS)
  LAFmax: number;
  LAFmin: number;
  LASmax: number;
  LASmin: number;
  LAImax: number;
  LCFmax: number;
  LCFmin: number;
  LCSmax: number;
  LCSmin: number;
  LZFmax: number;
  LZFmin: number;
  LZSmax: number;
  LZSmin: number;

  // Peak levels (dBFS, true sample peak of the weighted signal)
  LApeak: number;
  LCpeak: number;
  LZpeak: number;

  /** Statistical exceedance levels, or null before enough samples exist. */
  percentiles: PercentileSet | null;
  statisticsSamples: number;

  /** Unweighted sample peak of the acquisition signal, dBFS. */
  peakDb: number;
  clipping: ClipStatus;
  /** Mean value of the raw input over the measurement (DC offset diagnostic). */
  dcOffset: number;

  /**
   * Fraction of real time consumed by DSP in the last block (0..1), or null when
   * no monotonic clock is available in the host scope.
   */
  processingLoad: number | null;
}

interface WeightingPath {
  readonly id: WeightingId;
  readonly filter: BiquadCascade | null;
  readonly fast: ExponentialDetector;
  readonly slow: ExponentialDetector;
  readonly impulse: ImpulseDetector | null;
  readonly leq: LeqIntegrator;
  peak: number;
  fastMax: number;
  fastMin: number;
  slowMax: number;
  slowMin: number;
  impulseMax: number;
}

const defaultNow = (): number | null => {
  // `performance` is available on the main thread and in workers, but is not
  // guaranteed inside AudioWorkletGlobalScope.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return null;
};

export class MeterEngine {
  readonly sampleRate: number;
  readonly options: Required<Omit<MeterEngineOptions, 'now'>>;

  private readonly paths: Record<WeightingId, WeightingPath>;
  private readonly dcFilter: BiquadCascade | null;
  private readonly clipDetector: ClipDetector;
  private readonly histogram = new LevelHistogram();
  private readonly movingLeq1s: MovingLeq;
  private scratch: Float64Array;

  private sequence = 0;
  private totalSamples = 0;
  private integratedSamples = 0;
  private warmUpRemaining: number;
  private statisticsInterval: number;
  private statisticsCountdown: number;
  private statisticsSamples = 0;
  private dcSum = 0;
  private rawPeak = 0;
  private processingLoad: number | null = null;
  private readonly nowFn: () => number | null;

  constructor(options: MeterEngineOptions) {
    const sampleRate = options.sampleRate;
    if (!Number.isFinite(sampleRate) || sampleRate < 8000) {
      throw new RangeError(`MeterEngine requires a valid sample rate, got ${sampleRate}`);
    }
    this.sampleRate = sampleRate;
    this.options = {
      sampleRate,
      dcBlock: options.dcBlock ?? true,
      dcBlockHz: options.dcBlockHz ?? DEFAULT_DC_BLOCK_HZ,
      statisticsWeighting: options.statisticsWeighting ?? 'A',
      statisticsTimeWeighting: options.statisticsTimeWeighting ?? 'F',
      shortLeqSeconds: options.shortLeqSeconds ?? 1,
      warmUpSeconds: options.warmUpSeconds ?? WARM_UP_SECONDS,
    };
    this.nowFn = options.now ? () => options.now!() : defaultNow;

    this.dcFilter = this.options.dcBlock
      ? new BiquadCascade([designHighPass(this.options.dcBlockHz, sampleRate)])
      : null;

    this.paths = {
      A: this.createPath('A', true),
      C: this.createPath('C', false),
      Z: this.createPath('Z', false),
    };

    this.clipDetector = new ClipDetector(sampleRate);
    this.movingLeq1s = new MovingLeq(STATISTICS_SAMPLE_RATE_HZ);
    this.scratch = new Float64Array(4096);

    this.warmUpRemaining = Math.round(this.options.warmUpSeconds * sampleRate);
    this.statisticsInterval = Math.max(1, Math.round(sampleRate / STATISTICS_SAMPLE_RATE_HZ));
    this.statisticsCountdown = this.statisticsInterval;
  }

  private createPath(id: WeightingId, withImpulse: boolean): WeightingPath {
    const sections = designWeighting(id, this.sampleRate);
    return {
      id,
      filter: sections.length > 0 ? new BiquadCascade(sections) : null,
      fast: new ExponentialDetector(TIME_CONSTANTS.F, this.sampleRate),
      slow: new ExponentialDetector(TIME_CONSTANTS.S, this.sampleRate),
      impulse: withImpulse ? new ImpulseDetector(this.sampleRate) : null,
      leq: new LeqIntegrator(this.sampleRate, this.options.shortLeqSeconds),
      peak: 0,
      fastMax: 0,
      fastMin: Infinity,
      slowMax: 0,
      slowMin: Infinity,
      impulseMax: 0,
    };
  }

  /** True while the acquisition warm-up is still running. */
  get isWarmingUp(): boolean {
    return this.warmUpRemaining > 0;
  }

  /** Full reset: filter state, detectors and all statistics. */
  reset(): void {
    this.dcFilter?.reset();
    for (const id of ['A', 'C', 'Z'] as const) {
      const p = this.paths[id];
      p.filter?.reset();
      p.fast.reset();
      p.slow.reset();
      p.impulse?.reset();
      p.leq.reset();
      p.peak = 0;
      p.fastMax = 0;
      p.fastMin = Infinity;
      p.slowMax = 0;
      p.slowMin = Infinity;
      p.impulseMax = 0;
    }
    this.clipDetector.reset();
    this.histogram.reset();
    this.movingLeq1s.reset();
    this.sequence = 0;
    this.totalSamples = 0;
    this.integratedSamples = 0;
    this.statisticsSamples = 0;
    this.statisticsCountdown = this.statisticsInterval;
    this.dcSum = 0;
    this.rawPeak = 0;
    this.warmUpRemaining = Math.round(this.options.warmUpSeconds * this.sampleRate);
  }

  /**
   * Restart the integrated statistics (Leq, max/min, peak, percentiles) without
   * disturbing filter or detector state.
   *
   * This is what START does when the microphone is already running: the
   * displayed instantaneous levels stay live and correct while the measurement
   * session begins from zero.
   */
  resetStatistics(): void {
    for (const id of ['A', 'C', 'Z'] as const) {
      const p = this.paths[id];
      p.leq.reset();
      p.peak = 0;
      p.fastMax = 0;
      p.fastMin = Infinity;
      p.slowMax = 0;
      p.slowMin = Infinity;
      p.impulseMax = 0;
    }
    this.clipDetector.reset();
    this.histogram.reset();
    this.integratedSamples = 0;
    this.statisticsSamples = 0;
    this.statisticsCountdown = this.statisticsInterval;
    this.dcSum = 0;
    this.rawPeak = 0;
  }

  /**
   * Process one block of input samples.
   *
   * Allocation free apart from growing the internal scratch buffer when the host
   * delivers a larger block than before.
   */
  process(input: Float32Array | Float64Array): void {
    const n = input.length;
    if (n === 0) return;

    const t0 = this.nowFn();

    // DC blocking is applied to a scratch copy so the caller's buffer (which the
    // worklet forwards to the analysis worker) is untouched.
    let signal: Float32Array | Float64Array = input;
    if (this.dcFilter) {
      const buf = this.ensureScratch(n);
      this.dcFilter.processBlock(input, buf);
      signal = buf.subarray(0, n);
    }

    this.clipDetector.processBlock(signal);

    const integrating = this.warmUpRemaining <= 0;
    const A = this.paths.A;
    const C = this.paths.C;
    const Z = this.paths.Z;

    let dcAcc = 0;
    let rawPeak = this.rawPeak;
    let sumA = 0;
    let sumC = 0;
    let sumZ = 0;

    for (let i = 0; i < n; i++) {
      const x = signal[i];
      dcAcc += x;
      const ax = x < 0 ? -x : x;
      if (ax > rawPeak) rawPeak = ax;

      const a = A.filter ? A.filter.process(x) : x;
      const c = C.filter ? C.filter.process(x) : x;
      const z = Z.filter ? Z.filter.process(x) : x;

      const a2 = a * a;
      const c2 = c * c;
      const z2 = z * z;

      const aFast = A.fast.push(a2);
      const aSlow = A.slow.push(a2);
      const aImp = A.impulse ? A.impulse.push(a2) : 0;
      const cFast = C.fast.push(c2);
      const cSlow = C.slow.push(c2);
      const zFast = Z.fast.push(z2);
      const zSlow = Z.slow.push(z2);

      if (integrating) {
        sumA += a2;
        sumC += c2;
        sumZ += z2;

        const aAbs = a < 0 ? -a : a;
        const cAbs = c < 0 ? -c : c;
        const zAbs = z < 0 ? -z : z;
        if (aAbs > A.peak) A.peak = aAbs;
        if (cAbs > C.peak) C.peak = cAbs;
        if (zAbs > Z.peak) Z.peak = zAbs;

        if (aFast > A.fastMax) A.fastMax = aFast;
        if (aFast < A.fastMin) A.fastMin = aFast;
        if (aSlow > A.slowMax) A.slowMax = aSlow;
        if (aSlow < A.slowMin) A.slowMin = aSlow;
        if (aImp > A.impulseMax) A.impulseMax = aImp;
        if (cFast > C.fastMax) C.fastMax = cFast;
        if (cFast < C.fastMin) C.fastMin = cFast;
        if (cSlow > C.slowMax) C.slowMax = cSlow;
        if (cSlow < C.slowMin) C.slowMin = cSlow;
        if (zFast > Z.fastMax) Z.fastMax = zFast;
        if (zFast < Z.fastMin) Z.fastMin = zFast;
        if (zSlow > Z.slowMax) Z.slowMax = zSlow;
        if (zSlow < Z.slowMin) Z.slowMin = zSlow;

        if (--this.statisticsCountdown <= 0) {
          this.statisticsCountdown = this.statisticsInterval;
          const statPath = this.paths[this.options.statisticsWeighting];
          const detector =
            this.options.statisticsTimeWeighting === 'S' ? statPath.slow : statPath.fast;
          this.histogram.add(detector.levelDb);
          this.movingLeq1s.push(detector.meanSquare);
          this.statisticsSamples++;
        }
      }
    }

    this.rawPeak = rawPeak;
    this.totalSamples += n;

    if (integrating) {
      this.dcSum += dcAcc;
      this.integratedSamples += n;
      A.leq.addBlock(sumA, n);
      C.leq.addBlock(sumC, n);
      Z.leq.addBlock(sumZ, n);
    } else {
      this.warmUpRemaining -= n;
      if (this.warmUpRemaining <= 0) {
        this.onWarmUpComplete();
      }
    }

    if (t0 !== null) {
      const t1 = this.nowFn();
      if (t1 !== null) {
        const realTimeMs = (n / this.sampleRate) * 1000;
        this.processingLoad = realTimeMs > 0 ? (t1 - t0) / realTimeMs : null;
      }
    }
  }

  /**
   * Once warm-up finishes, prime the slow and impulse detectors from the (already
   * settled) fast detectors so they start at approximately the right level
   * instead of ramping from silence for several seconds.
   */
  private onWarmUpComplete(): void {
    this.warmUpRemaining = 0;
    for (const id of ['A', 'C', 'Z'] as const) {
      const p = this.paths[id];
      const ms = p.fast.meanSquare;
      p.slow.reset(ms);
      p.impulse?.reset();
      if (p.impulse) p.impulse.push(ms);
    }
    this.clipDetector.reset();
  }

  private ensureScratch(n: number): Float64Array {
    if (n <= this.scratch.length) return this.scratch;
    // Grows at most a handful of times; never in the steady state.
    this.scratch = new Float64Array(nextPowerOfTwo(n));
    return this.scratch;
  }

  /** Levels for one weighting/time-weighting combination. */
  level(weighting: WeightingId, timeWeighting: TimeWeightingId): number {
    const p = this.paths[weighting];
    if (timeWeighting === 'I') return p.impulse ? p.impulse.levelDb : NaN;
    return timeWeighting === 'S' ? p.slow.levelDb : p.fast.levelDb;
  }

  /** Equivalent continuous level for one weighting. */
  leq(weighting: WeightingId): number {
    return this.paths[weighting].leq.leq;
  }

  /** Completed short-Leq segments for one weighting. */
  shortLeqSegments(weighting: WeightingId): readonly number[] {
    return this.paths[weighting].leq.shortLeqSegments;
  }

  /** The statistical histogram (dBFS domain). */
  get levelHistogram(): LevelHistogram {
    return this.histogram;
  }

  get clipEvents() {
    return this.clipDetector.eventList();
  }

  /** Low-rate metric snapshot. */
  snapshot(): MeterSnapshot {
    const A = this.paths.A;
    const C = this.paths.C;
    const Z = this.paths.Z;
    const duration = this.integratedSamples / this.sampleRate;
    const laeq = A.leq.leq;
    const hasStats = this.statisticsSamples >= STATISTICS_SAMPLE_RATE_HZ; // >= 1 s of data

    return {
      sequence: ++this.sequence,
      sampleRate: this.sampleRate,
      totalSamples: this.totalSamples,
      integratedSamples: this.integratedSamples,
      durationSeconds: duration,
      warmingUp: this.warmUpRemaining > 0,

      LAF: A.fast.levelDb,
      LAS: A.slow.levelDb,
      LAI: A.impulse ? A.impulse.levelDb : NaN,
      LCF: C.fast.levelDb,
      LCS: C.slow.levelDb,
      LZF: Z.fast.levelDb,
      LZS: Z.slow.levelDb,

      LAeq: laeq,
      LCeq: C.leq.leq,
      LZeq: Z.leq.leq,
      LAeq1s: this.movingLeq1s.levelDb,
      LAE: duration > 0 ? soundExposureLevel(laeq, duration) : NaN,

      LAFmax: msToDbOrNaN(A.fastMax),
      LAFmin: msToDbOrNaN(A.fastMin),
      LASmax: msToDbOrNaN(A.slowMax),
      LASmin: msToDbOrNaN(A.slowMin),
      LAImax: msToDbOrNaN(A.impulseMax),
      LCFmax: msToDbOrNaN(C.fastMax),
      LCFmin: msToDbOrNaN(C.fastMin),
      LCSmax: msToDbOrNaN(C.slowMax),
      LCSmin: msToDbOrNaN(C.slowMin),
      LZFmax: msToDbOrNaN(Z.fastMax),
      LZFmin: msToDbOrNaN(Z.fastMin),
      LZSmax: msToDbOrNaN(Z.slowMax),
      LZSmin: msToDbOrNaN(Z.slowMin),

      LApeak: ampToDbOrNaN(A.peak),
      LCpeak: ampToDbOrNaN(C.peak),
      LZpeak: ampToDbOrNaN(Z.peak),

      percentiles: hasStats ? this.histogram.percentiles() : null,
      statisticsSamples: this.statisticsSamples,

      peakDb: ampToDbOrNaN(this.rawPeak),
      clipping: this.clipDetector.status(),
      dcOffset: this.integratedSamples > 0 ? this.dcSum / this.integratedSamples : 0,

      processingLoad: this.processingLoad,
    };
  }
}

function msToDbOrNaN(meanSquare: number): number {
  if (!Number.isFinite(meanSquare) || meanSquare <= 0) return NaN;
  return meanSquareToDb(meanSquare);
}

function ampToDbOrNaN(amplitude: number): number {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return NaN;
  return amplitudeToDb(amplitude);
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export { LEVEL_FLOOR_DB };
