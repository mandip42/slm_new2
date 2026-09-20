'use client';

/**
 * Level distribution histogram with the cumulative (exceedance) curve.
 *
 * Two things are plotted from the same data:
 *   bars   fraction of time spent in each 1 dB bin
 *   curve  the exceedance function, so L10/L50/L90 can be read off directly
 *
 * The percentile markers come from the engine's own percentile calculation, not
 * from the re-binned bars, so what is drawn agrees with what is reported.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { PercentileSet } from '@/dsp/statistics';
import { formatLevel } from '@/lib/format';
import type { DistributionBins } from '@/state/useLevelDistribution';
import { type CanvasSize, plotArea, readChartTheme, useCanvas } from './canvas';

export function DistributionChart({
  bins,
  percentiles,
  unit,
  height = 220,
}: {
  bins: DistributionBins | null;
  percentiles: PercentileSet | null;
  unit: string;
  height?: number;
}) {
  const padding = useMemo(() => ({ left: 36, right: 34, top: 10, bottom: 24 }), []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: CanvasSize) => {
      const theme = readChartTheme();
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, size.width, size.height);
      const area = plotArea(size, padding);

      if (!bins || bins.centres.length === 0) {
        ctx.fillStyle = theme.faint;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          'No distribution yet — measure for at least a second',
          area.left + area.width / 2,
          area.top + area.height / 2
        );
        return;
      }

      const xMin = bins.centres[0] - bins.binWidth / 2;
      const xMax = bins.centres[bins.centres.length - 1] + bins.binWidth / 2;
      const xSpan = Math.max(1, xMax - xMin);
      const maxFraction = Math.max(...bins.fractions);
      const yTop = Math.max(0.01, maxFraction * 1.15);

      const xFor = (db: number) => area.left + ((db - xMin) / xSpan) * area.width;
      const yFor = (fraction: number) => area.bottom - (fraction / yTop) * area.height;
      const yForCumulative = (fraction: number) => area.bottom - fraction * area.height;

      // Grid
      ctx.font = '9px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= 4; i++) {
        const fraction = (yTop / 4) * i;
        const y = yFor(fraction);
        ctx.strokeStyle = theme.grid;
        ctx.beginPath();
        ctx.moveTo(area.left, Math.round(y) + 0.5);
        ctx.lineTo(area.right, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.fillStyle = theme.faint;
        ctx.textAlign = 'right';
        ctx.fillText(`${(fraction * 100).toFixed(1)}%`, area.left - 4, y);
      }
      // Right axis for the cumulative curve
      for (const percent of [0, 25, 50, 75, 100]) {
        const y = yForCumulative(percent / 100);
        ctx.fillStyle = theme.violet;
        ctx.textAlign = 'left';
        ctx.fillText(`${percent}`, area.right + 4, y);
      }

      ctx.strokeStyle = theme.gridStrong;
      ctx.strokeRect(area.left + 0.5, area.top + 0.5, area.width - 1, area.height - 1);

      // Bars
      const barWidth = Math.max(1, (area.width / bins.centres.length) * 0.9);
      for (let i = 0; i < bins.centres.length; i++) {
        const fraction = bins.fractions[i];
        if (fraction <= 0) continue;
        const x = xFor(bins.centres[i]);
        const y = yFor(fraction);
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = 0.75;
        ctx.fillRect(x - barWidth / 2, y, barWidth, area.bottom - y);
        ctx.globalAlpha = 1;
      }

      // Cumulative curve
      ctx.strokeStyle = theme.violet;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < bins.centres.length; i++) {
        const x = xFor(bins.centres[i] + bins.binWidth / 2);
        const y = yForCumulative(bins.cumulative[i]);
        if (i === 0) ctx.moveTo(xFor(bins.centres[0] - bins.binWidth / 2), area.bottom);
        ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Percentile markers
      if (percentiles) {
        const marks: Array<[keyof PercentileSet, string]> = [
          ['L90', theme.ok],
          ['L50', theme.text],
          ['L10', theme.warn],
        ];
        ctx.font = '9px system-ui, sans-serif';
        ctx.textBaseline = 'top';
        for (const [key, colour] of marks) {
          const value = percentiles[key];
          if (!Number.isFinite(value)) continue;
          const x = xFor(value);
          if (x < area.left || x > area.right) continue;
          ctx.strokeStyle = colour;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, area.top);
          ctx.lineTo(Math.round(x) + 0.5, area.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = colour;
          ctx.textAlign = x > area.right - 30 ? 'right' : 'left';
          ctx.fillText(key, x + (x > area.right - 30 ? -3 : 3), area.top + 2);
        }
      }

      // Level axis labels
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = theme.faint;
      for (let i = 0; i <= 4; i++) {
        const value = xMin + (xSpan / 4) * i;
        ctx.fillText(formatLevel(value, 0), xFor(value), area.bottom + 3);
      }
      ctx.fillText(unit, area.left + area.width / 2, area.bottom + 13);
    },
    [bins, percentiles, unit, padding]
  );

  const { canvasRef, containerRef, size, invalidate } = useCanvas(draw);

  useEffect(() => {
    invalidate();
  }, [invalidate, bins, percentiles]);

  return (
    <div>
      <div ref={containerRef} className="w-full" style={{ height }}>
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          role="img"
          aria-label="Level distribution histogram"
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[10px] text-faint">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-accent" /> time in each 1 dB bin (left axis)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-3 bg-violet" /> cumulative %, low to high (right axis)
        </span>
      </div>
    </div>
  );
}
