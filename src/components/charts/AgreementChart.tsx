'use client';

/**
 * Agreement plots for calibration and validation.
 *
 * `AgreementChart` plots the Sonoscope estimate against the reference reading
 * together with the ideal y = x line, which is the plot that shows at a glance
 * whether a device is linear or merely offset.
 *
 * `ResidualChart` plots the signed error against level, which is where
 * non-linearity and range-dependent behaviour actually show up.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { formatLevel } from '@/lib/format';
import { type CanvasSize, plotArea, readChartTheme, useCanvas } from './canvas';

export interface AgreementPoint {
  referenceDb: number;
  estimateDb: number;
  label?: string;
}

export function AgreementChart({
  points,
  height = 240,
  unitLabel = 'dB',
}: {
  points: readonly AgreementPoint[];
  height?: number;
  unitLabel?: string;
}) {
  const padding = useMemo(() => ({ left: 40, right: 12, top: 12, bottom: 30 }), []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: CanvasSize) => {
      const theme = readChartTheme();
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, size.width, size.height);
      const area = plotArea(size, padding);

      const usable = points.filter(
        (p) => Number.isFinite(p.referenceDb) && Number.isFinite(p.estimateDb)
      );
      if (usable.length === 0) {
        ctx.fillStyle = theme.faint;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No paired measurements yet', area.left + area.width / 2, area.top + area.height / 2);
        return;
      }

      // Square axes over a shared range so the y = x line is a true diagonal.
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of usable) {
        lo = Math.min(lo, p.referenceDb, p.estimateDb);
        hi = Math.max(hi, p.referenceDb, p.estimateDb);
      }
      const pad = Math.max(3, (hi - lo) * 0.12);
      const min = Math.floor((lo - pad) / 5) * 5;
      const max = Math.ceil((hi + pad) / 5) * 5;
      const span = Math.max(5, max - min);

      const xFor = (db: number) => area.left + ((db - min) / span) * area.width;
      const yFor = (db: number) => area.bottom - ((db - min) / span) * area.height;

      // Grid
      ctx.font = '9px system-ui, sans-serif';
      const step = span <= 20 ? 5 : span <= 50 ? 10 : 20;
      for (let value = Math.ceil(min / step) * step; value <= max; value += step) {
        const x = Math.round(xFor(value)) + 0.5;
        const y = Math.round(yFor(value)) + 0.5;
        ctx.strokeStyle = theme.grid;
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.bottom);
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.right, y);
        ctx.stroke();
        ctx.fillStyle = theme.faint;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(value), area.left - 4, y);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(String(value), x, area.bottom + 3);
      }

      ctx.strokeStyle = theme.gridStrong;
      ctx.strokeRect(area.left + 0.5, area.top + 0.5, area.width - 1, area.height - 1);

      // Ideal y = x
      ctx.strokeStyle = theme.muted;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xFor(min), yFor(min));
      ctx.lineTo(xFor(max), yFor(max));
      ctx.stroke();
      ctx.setLineDash([]);

      // +/- 1 dB band around the ideal line, as a reference for "close enough".
      ctx.fillStyle = 'rgba(52, 211, 153, 0.10)';
      ctx.beginPath();
      ctx.moveTo(xFor(min), yFor(min + 1));
      ctx.lineTo(xFor(max), yFor(max + 1));
      ctx.lineTo(xFor(max), yFor(max - 1));
      ctx.lineTo(xFor(min), yFor(min - 1));
      ctx.closePath();
      ctx.fill();

      // Points
      for (const point of usable) {
        const x = xFor(point.referenceDb);
        const y = yFor(point.estimateDb);
        const error = Math.abs(point.estimateDb - point.referenceDb);
        ctx.fillStyle = error <= 1 ? theme.ok : error <= 2 ? theme.warn : theme.bad;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = theme.background;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Axis titles
      ctx.fillStyle = theme.faint;
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`Reference (${unitLabel})`, area.left + area.width / 2, size.height - 1);
      ctx.save();
      ctx.translate(9, area.top + area.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'top';
      ctx.fillText(`Sonoscope (${unitLabel})`, 0, 0);
      ctx.restore();
    },
    [points, padding, unitLabel]
  );

  const { canvasRef, containerRef, size, invalidate } = useCanvas(draw);
  useEffect(() => invalidate(), [invalidate, points]);

  return (
    <div>
      <div ref={containerRef} className="w-full" style={{ height }}>
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          role="img"
          aria-label="Sonoscope against reference instrument"
        />
      </div>
      <p className="mt-1 px-1 text-[10px] text-faint">
        Dashed line is perfect agreement; the shaded band is &plusmn;1 dB. Green points are within
        1 dB, amber within 2 dB, red beyond.
      </p>
    </div>
  );
}

export interface ResidualPoint {
  /** Independent variable: level or frequency. */
  x: number;
  /** Signed error, Sonoscope minus reference. */
  errorDb: number;
}

export function ResidualChart({
  points,
  height = 170,
  xLabel = 'Reference level (dB)',
  logX = false,
}: {
  points: readonly ResidualPoint[];
  height?: number;
  xLabel?: string;
  logX?: boolean;
}) {
  const padding = useMemo(() => ({ left: 40, right: 12, top: 10, bottom: 28 }), []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: CanvasSize) => {
      const theme = readChartTheme();
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, size.width, size.height);
      const area = plotArea(size, padding);

      const usable = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.errorDb));
      if (usable.length === 0) {
        ctx.fillStyle = theme.faint;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No residuals to show', area.left + area.width / 2, area.top + area.height / 2);
        return;
      }

      let xLo = Infinity;
      let xHi = -Infinity;
      let eMax = 0;
      for (const p of usable) {
        xLo = Math.min(xLo, p.x);
        xHi = Math.max(xHi, p.x);
        eMax = Math.max(eMax, Math.abs(p.errorDb));
      }
      if (xHi === xLo) {
        xLo -= 1;
        xHi += 1;
      }
      const xPad = (xHi - xLo) * 0.08;
      const xMin = xLo - xPad;
      const xMax = xHi + xPad;
      const eLimit = Math.max(1.5, Math.ceil(eMax * 1.25));

      const xFor = (value: number) => {
        if (logX) {
          const t =
            (Math.log10(Math.max(1, value)) - Math.log10(Math.max(1, xMin))) /
            (Math.log10(Math.max(1.001, xMax)) - Math.log10(Math.max(1, xMin)));
          return area.left + Math.max(0, Math.min(1, t)) * area.width;
        }
        return area.left + ((value - xMin) / (xMax - xMin)) * area.width;
      };
      const yFor = (error: number) =>
        area.top + area.height / 2 - (error / eLimit) * (area.height / 2);

      // +/- 1 dB band
      ctx.fillStyle = 'rgba(52, 211, 153, 0.10)';
      ctx.fillRect(area.left, yFor(1), area.width, yFor(-1) - yFor(1));

      // Grid
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const step = eLimit <= 2 ? 0.5 : eLimit <= 6 ? 1 : 2;
      for (let error = -eLimit; error <= eLimit + 1e-9; error += step) {
        const y = Math.round(yFor(error)) + 0.5;
        ctx.strokeStyle = Math.abs(error) < 1e-9 ? theme.gridStrong : theme.grid;
        ctx.beginPath();
        ctx.moveTo(area.left, y);
        ctx.lineTo(area.right, y);
        ctx.stroke();
        ctx.fillStyle = theme.faint;
        ctx.fillText(error.toFixed(step < 1 ? 1 : 0), area.left - 4, y);
      }

      ctx.strokeStyle = theme.gridStrong;
      ctx.strokeRect(area.left + 0.5, area.top + 0.5, area.width - 1, area.height - 1);

      // Points, connected in x order so a trend is visible
      const sorted = [...usable].sort((a, b) => a.x - b.x);
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      sorted.forEach((point, index) => {
        const x = xFor(point.x);
        const y = yFor(point.errorDb);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;

      for (const point of sorted) {
        const x = xFor(point.x);
        const y = Math.max(area.top, Math.min(area.bottom, yFor(point.errorDb)));
        const abs = Math.abs(point.errorDb);
        ctx.fillStyle = abs <= 1 ? theme.ok : abs <= 2 ? theme.warn : theme.bad;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // X labels
      ctx.fillStyle = theme.faint;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let i = 0; i <= 4; i++) {
        const value = logX
          ? Math.pow(10, Math.log10(Math.max(1, xMin)) + (i / 4) * (Math.log10(Math.max(1.001, xMax)) - Math.log10(Math.max(1, xMin))))
          : xMin + ((xMax - xMin) / 4) * i;
        ctx.fillText(formatLevel(value, value >= 1000 ? 0 : value < 10 ? 1 : 0), xFor(value), area.bottom + 3);
      }
      ctx.textBaseline = 'bottom';
      ctx.fillText(xLabel, area.left + area.width / 2, size.height - 1);
    },
    [points, padding, xLabel, logX]
  );

  const { canvasRef, containerRef, size, invalidate } = useCanvas(draw);
  useEffect(() => invalidate(), [invalidate, points]);

  return (
    <div>
      <div ref={containerRef} className="w-full" style={{ height }}>
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          role="img"
          aria-label="Residual error"
        />
      </div>
      <p className="mt-1 px-1 text-[10px] text-faint">
        Signed error: Sonoscope minus reference. A sloping trend means the response is not linear
        and a constant offset will be wrong away from the calibration level.
      </p>
    </div>
  );
}
