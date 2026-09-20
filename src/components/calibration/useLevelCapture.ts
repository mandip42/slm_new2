'use client';

/**
 * Capture a stable phone level for calibration.
 *
 * A single instantaneous reading is the wrong thing to calibrate against: even a
 * steady source fluctuates by a decibel or more, and the reference instrument is
 * reporting its own average over some window. So a capture here is an
 * **energy average over a fixed window**, computed the same way Leq is, and it
 * reports how much the level moved during that window so an unstable capture can
 * be rejected rather than silently accepted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LEVEL_FLOOR_DB, dbToMeanSquare, meanSquareToDb } from '@/dsp/levels';
import type { MeterSnapshot } from '@/dsp/engine';
import type { TimeWeightingId } from '@/dsp/timeWeighting';
import type { WeightingId } from '@/dsp/weighting/reference';
import { useMetricsSubscription } from '@/state/EngineProvider';
import { selectLevel } from '@/components/meter/BigLevel';

export const CAPTURE_WINDOWS = [3, 5, 10, 30] as const;
export type CaptureWindow = (typeof CAPTURE_WINDOWS)[number];

/** A capture is flagged unstable when the level range exceeds this. */
export const CAPTURE_STABILITY_LIMIT_DB = 2.0;

export interface CaptureResult {
  /** Energy average of the captured window, dBFS. */
  levelDbfs: number;
  /** Range (max - min) of the instantaneous level during the window, dB. */
  rangeDb: number;
  min: number;
  max: number;
  samples: number;
  windowSeconds: number;
  weighting: WeightingId;
  timeWeighting: TimeWeightingId;
  stable: boolean;
  at: number;
}

export interface LevelCaptureState {
  /** Live instantaneous level, dBFS. */
  live: number;
  /** Seconds remaining in an active capture, or null when idle. */
  remaining: number | null;
  capturing: boolean;
  result: CaptureResult | null;
  start: (windowSeconds: number) => void;
  cancel: () => void;
  clear: () => void;
}

export function useLevelCapture(
  weighting: WeightingId,
  timeWeighting: TimeWeightingId
): LevelCaptureState {
  const [live, setLive] = useState(NaN);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [result, setResult] = useState<CaptureResult | null>(null);

  const capturingRef = useRef(false);
  const windowRef = useRef(0);
  const startedAtRef = useRef(0);
  const energyRef = useRef(0);
  const countRef = useRef(0);
  const minRef = useRef(Infinity);
  const maxRef = useRef(-Infinity);

  // The metric subscription is long-lived, so the selected weighting is mirrored
  // into refs from an effect rather than during render.
  const weightingRef = useRef(weighting);
  const timeWeightingRef = useRef(timeWeighting);
  useEffect(() => {
    weightingRef.current = weighting;
  }, [weighting]);
  useEffect(() => {
    timeWeightingRef.current = timeWeighting;
  }, [timeWeighting]);

  const finish = useCallback(() => {
    capturingRef.current = false;
    setRemaining(null);
    const count = countRef.current;
    if (count === 0) {
      setResult(null);
      return;
    }
    const levelDbfs = meanSquareToDb(energyRef.current / count);
    const range = maxRef.current - minRef.current;
    setResult({
      levelDbfs,
      rangeDb: range,
      min: minRef.current,
      max: maxRef.current,
      samples: count,
      windowSeconds: windowRef.current,
      weighting: weightingRef.current,
      timeWeighting: timeWeightingRef.current,
      stable: range <= CAPTURE_STABILITY_LIMIT_DB,
      at: Date.now(),
    });
  }, []);

  const handleSnapshot = useCallback(
    (snapshot: MeterSnapshot) => {
      const value = selectLevel(snapshot, weightingRef.current, timeWeightingRef.current);
      setLive(value);

      if (!capturingRef.current) return;
      if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) return;

      energyRef.current += dbToMeanSquare(value);
      countRef.current += 1;
      if (value < minRef.current) minRef.current = value;
      if (value > maxRef.current) maxRef.current = value;

      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const left = windowRef.current - elapsed;
      setRemaining(Math.max(0, left));
      if (left <= 0) finish();
    },
    [finish]
  );

  useMetricsSubscription(handleSnapshot);

  const start = useCallback((windowSeconds: number) => {
    energyRef.current = 0;
    countRef.current = 0;
    minRef.current = Infinity;
    maxRef.current = -Infinity;
    windowRef.current = windowSeconds;
    startedAtRef.current = Date.now();
    capturingRef.current = true;
    setResult(null);
    setRemaining(windowSeconds);
  }, []);

  const cancel = useCallback(() => {
    capturingRef.current = false;
    setRemaining(null);
  }, []);

  const clear = useCallback(() => {
    setResult(null);
  }, []);

  // Safety net: if metric messages stop arriving mid-capture (input lost), do
  // not leave the UI stuck in a capturing state forever.
  useEffect(() => {
    if (remaining === null) return;
    const timer = setTimeout(() => {
      if (capturingRef.current && Date.now() - startedAtRef.current > windowRef.current * 1000 + 2000) {
        finish();
      }
    }, windowRef.current * 1000 + 2500);
    return () => clearTimeout(timer);
  }, [remaining, finish]);

  return {
    live,
    remaining,
    // `remaining` is non-null exactly while a capture is running, so the flag is
    // derived from it rather than read out of a ref during render.
    capturing: remaining !== null,
    result,
    start,
    cancel,
    clear,
  };
}
