'use client';

/**
 * Poll the statistical level distribution from the worklet.
 *
 * The histogram lives next to the detector that fills it, so this is a request
 * rather than a parallel computation: the displayed distribution and the
 * displayed percentiles come from the same 2000-bin histogram and cannot
 * disagree.
 *
 * Only polled while a screen that shows it is mounted, at 1 Hz.
 */

import { useEffect, useState } from 'react';
import type { HistogramSnapshot } from '@/audio/messages';
import { useEngineContext } from './EngineProvider';

export function useLevelDistribution(pollMs = 1000): HistogramSnapshot | null {
  const { engine, status } = useEngineContext();
  const [histogram, setHistogram] = useState<HistogramSnapshot | null>(() => engine.latestHistogram);

  useEffect(() => {
    if (status.state !== 'running' && status.state !== 'suspended') return;
    let cancelled = false;

    const poll = async () => {
      const next = await engine.requestHistogram();
      if (!cancelled && next) setHistogram(next);
    };

    void poll();
    const timer = setInterval(() => void poll(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [engine, pollMs, status.state]);

  return histogram;
}

export interface DistributionBins {
  /** Bin centre in the display unit. */
  centres: number[];
  counts: number[];
  total: number;
  /** Fraction of the total in each bin. */
  fractions: number[];
  /** Cumulative fraction from the low end. */
  cumulative: number[];
  binWidth: number;
}

/**
 * Re-bin a raw histogram for display and convert to the display unit.
 *
 * The stored histogram uses 0.1 dB bins, which is far finer than any useful
 * display; re-binning to 1 dB keeps the shape readable without discarding the
 * precision that the percentile calculation needs.
 */
export function rebinDistribution(
  histogram: HistogramSnapshot | null,
  toDisplay: (db: number) => number,
  targetBinWidth = 1
): DistributionBins | null {
  if (!histogram || histogram.counts.length === 0) return null;
  const ratio = Math.max(1, Math.round(targetBinWidth / histogram.binWidth));
  const centres: number[] = [];
  const counts: number[] = [];
  let total = 0;

  for (let offset = 0; offset < histogram.counts.length; offset += ratio) {
    let sum = 0;
    for (let k = 0; k < ratio && offset + k < histogram.counts.length; k++) {
      sum += histogram.counts[offset + k];
    }
    const rawLower = histogram.minDb + (histogram.first + offset) * histogram.binWidth;
    const rawCentre = rawLower + (ratio * histogram.binWidth) / 2;
    centres.push(toDisplay(rawCentre));
    counts.push(sum);
    total += sum;
  }

  if (total === 0) return null;

  const fractions = counts.map((c) => c / total);
  const cumulative: number[] = [];
  let running = 0;
  for (const fraction of fractions) {
    running += fraction;
    cumulative.push(running);
  }

  return {
    centres,
    counts,
    total,
    fractions,
    cumulative,
    binWidth: ratio * histogram.binWidth,
  };
}
