'use client';

/**
 * Frequency-response correction curve.
 *
 * Shows the measured correction points, the interpolated curve between them
 * (linear in log-frequency), and the regions outside the measured range where the
 * correction is held flat. Those regions are drawn hatched and labelled
 * "uncalibrated", because a held-flat correction is an assumption, not a
 * measurement.
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { CorrectionCurve } from '@/calibration/frequencyCorrection';
import { sampleCorrection } from '@/calibration/frequencyCorrection';
import {
  type CanvasSize,
  drawLogFrequencyGrid,
  logFrequencyToX,
  plotArea,
  readChartTheme,
  useCanvas,
} from './canvas';

export function CorrectionCurveChart({
  curve,
  height = 220,
  minHz = 20,
  maxHz = 20000,
}: {
  curve: CorrectionCurve | null;
  height?: number;
  minHz?: number;
  maxHz?: number;
}) {
  const padding = useMemo(() => ({ left: 38, right: 10, top: 12, bottom: 26 }), []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: CanvasSize) => {
      const theme = readChartTheme();
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, size.width, size.height);
      const area = plotArea(size, padding);

      if (!curve || curve.frequencies.length === 0) {
        ctx.fillStyle = theme.faint;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          'No frequency calibration points yet',
          area.left + area.width / 2,
          area.top + area.height / 2
        );
        return;
      }

      let limit = 3;
      for (const value of curve.corrections) limit = Math.max(limit, Math.abs(value));
      limit = Math.ceil((limit * 1.2) / 2) * 2;

      const xFor = (hz: number) => logFrequencyToX(hz, area, minHz, maxHz);
      const yFor = (db: number) =>
        area.top + area.height / 2 - (db / limit) * (area.height / 2);

      // Uncalibrated regions
      ctx.save();
      ctx.beginPath();
      const leftEdge = xFor(curve.lowHz);
      const rightEdge = xFor(curve.highHz);
      ctx.rect(area.left, area.top, Math.max(0, leftEdge - area.left), area.height);
      ctx.rect(rightEdge, area.top, Math.max(0, area.right - rightEdge), area.height);
      ctx.clip();
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      for (let d = -area.height; d < area.width + area.height; d += 6) {
        ctx.beginPath();
        ctx.moveTo(area.left + d, area.bottom);
        ctx.lineTo(area.left + d + area.height, area.top);
        ctx.stroke();
      }
      ctx.restore();

      // Grid
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const step = limit <= 4 ? 1 : limit <= 10 ? 2 : 5;
      for (let value = -limit; value <= limit + 1e-9; value += step) {
        const y = Math.round(yFor(value)) + 0.5;
        ctx.strokeStyle = Math.abs(value) < 1e-9 ? theme.gridStrong : theme.grid;
        ctx.beginPath();
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.right, y);
        ctx.stroke();
        ctx.fillStyle = theme.faint;
        ctx.fillText(`${value > 0 ? '+' : ''}${value}`, area.left - 4, y);
      }
      drawLogFrequencyGrid(ctx, area, theme, minHz, maxHz);
      ctx.strokeStyle = theme.gridStrong;
      ctx.strokeRect(area.left + 0.5, area.top + 0.5, area.width - 1, area.height - 1);

      // Interpolated curve across the full axis
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      const columns = Math.max(2, Math.round(area.width));
      for (let c = 0; c <= columns; c++) {
        const t = c / columns;
        const hz = Math.pow(10, Math.log10(minHz) + t * (Math.log10(maxHz) - Math.log10(minHz)));
        const value = sampleCorrection(curve, hz).correctionDb;
        const x = area.left + t * area.width;
        const y = Math.max(area.top, Math.min(area.bottom, yFor(value)));
        if (c === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Measured points
      for (let i = 0; i < curve.frequencies.length; i++) {
        const x = xFor(curve.frequencies[i]);
        const y = Math.max(area.top, Math.min(area.bottom, yFor(curve.corrections[i])));
        ctx.fillStyle = theme.warn;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = theme.background;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Axis title
      ctx.fillStyle = theme.faint;
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('correction dB', area.left + 3, area.top + 3);
    },
    [curve, padding, minHz, maxHz]
  );

  const { canvasRef, containerRef, size, invalidate } = useCanvas(draw);
  useEffect(() => invalidate(), [invalidate, curve]);

  return (
    <div>
      <div ref={containerRef} className="w-full" style={{ height }}>
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          role="img"
          aria-label="Frequency response correction curve"
        />
      </div>
      <p className="mt-1 px-1 text-[10px] leading-snug text-faint">
        Amber points are measured; the line is interpolated linearly in log-frequency. Hatched
        regions are outside the measured range, where the correction is held flat at the nearest
        measured value rather than extrapolated.
      </p>
    </div>
  );
}
