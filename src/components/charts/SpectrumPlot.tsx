'use client';

/**
 * FFT spectrum plot.
 *
 * IMPORTANT: these are FFT spectral levels of a windowed frame, not octave-band
 * sound pressure levels. The value at a bin is the RMS level of a tone landing
 * on that bin, using the same full-scale reference as the meter. Broadband noise
 * spread across many bins reads lower per bin than its total level, which is
 * exactly right for a spectrum and exactly wrong for a band level — that is why
 * band levels come from the filter bank instead.
 *
 * Log and linear frequency axes, peak hold, a draggable cursor with parabolic
 * peak interpolation, and an optional weighting overlay applied for display.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import { weightingDb, type WeightingId } from '@/dsp/weighting/reference';
import type { AnalysisFrame } from '@/audio/acousticEngine';
import type { ActiveCalibration } from '@/calibration/activeCalibration';
import { formatFrequency, formatLevel, NO_VALUE } from '@/lib/format';
import {
  type CanvasSize,
  type PlotArea,
  drawLogFrequencyGrid,
  drawValueGrid,
  logFrequencyToX,
  plotArea,
  readChartTheme,
  useCanvas,
  xToLogFrequency,
} from './canvas';

export interface SpectrumPlotProps {
  frame: AnalysisFrame | null;
  calibration: ActiveCalibration;
  axis: 'log' | 'linear';
  /** Weighting applied to the displayed spectrum ('Z' shows it unweighted). */
  weighting: WeightingId;
  height?: number;
  minHz?: number;
  maxHz?: number;
  /** Vertical span in dB below the top of the range. */
  dynamicRangeDb?: number;
}

export function SpectrumPlot({
  frame,
  calibration,
  axis,
  weighting,
  height = 260,
  minHz = 20,
  maxHz = 20000,
  dynamicRangeDb = 90,
}: SpectrumPlotProps) {
  const [cursorX, setCursorX] = useState<number | null>(null);
  // The auto-ranging state genuinely belongs in a ref: it is written from inside
  // the draw callback and must not trigger a re-render.
  const rangeRef = useRef<{ min: number; max: number } | null>(null);

  const padding = useMemo(() => ({ left: 36, right: 8, top: 10, bottom: 22 }), []);

  const upperHz = useMemo(() => {
    if (!frame) return maxHz;
    return Math.min(maxHz, (frame.binWidth * (frame.spectrum.length - 1)) || maxHz);
  }, [frame, maxHz]);

  /** Convert a frequency to an x coordinate for the active axis. */
  const xForFrequency = useCallback(
    (frequency: number, area: PlotArea): number => {
      if (axis === 'log') return logFrequencyToX(frequency, area, minHz, upperHz);
      const t = (frequency - 0) / upperHz;
      return area.left + Math.max(0, Math.min(1, t)) * area.width;
    },
    [axis, minHz, upperHz]
  );

  const frequencyForX = useCallback(
    (x: number, area: PlotArea): number => {
      if (axis === 'log') return xToLogFrequency(x, area, minHz, upperHz);
      const t = Math.max(0, Math.min(1, (x - area.left) / area.width));
      return t * upperHz;
    },
    [axis, minHz, upperHz]
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: CanvasSize) => {
      const theme = readChartTheme();
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, size.width, size.height);
      const area = plotArea(size, padding);

      if (!frame || frame.spectrum.length === 0) {
        ctx.fillStyle = theme.faint;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Waiting for the analyser', area.left + area.width / 2, area.top + area.height / 2);
        return;
      }

      const bins = frame.spectrum.length;
      const binWidth = frame.binWidth;

      // Apply calibration and the display weighting, then find the top of the
      // range. The range follows the peak but only upward in steps of 5 dB, so
      // the axis does not jitter on every frame.
      const valueAt = (index: number, source: Float32Array): number => {
        const raw = source[index];
        if (!Number.isFinite(raw) || raw <= LEVEL_FLOOR_DB) return NaN;
        const frequency = index * binWidth;
        const w = weighting === 'Z' ? 0 : weightingDb(weighting, Math.max(1, frequency));
        return calibration.toDisplay(raw) + w;
      };

      let peak = -Infinity;
      for (let i = 1; i < bins; i++) {
        const value = valueAt(i, frame.spectrum);
        if (Number.isFinite(value) && value > peak) peak = value;
      }
      if (!Number.isFinite(peak)) peak = calibration.isCalibrated ? 80 : -20;
      const top = Math.ceil((peak + 6) / 5) * 5;
      const previous = rangeRef.current;
      const smoothedTop =
        previous && top < previous.max && top > previous.max - 15 ? previous.max : top;
      const range = { max: smoothedTop, min: smoothedTop - dynamicRangeDb };
      rangeRef.current = range;

      drawValueGrid(ctx, area, theme, range.min, range.max, { targetLines: 6 });

      if (axis === 'log') {
        drawLogFrequencyGrid(ctx, area, theme, minHz, upperHz);
      } else {
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const step = upperHz / 8;
        for (let i = 0; i <= 8; i++) {
          const frequency = step * i;
          const x = Math.round(xForFrequency(frequency, area)) + 0.5;
          ctx.strokeStyle = theme.grid;
          ctx.beginPath();
          ctx.moveTo(x, area.top);
          ctx.lineTo(x, area.bottom);
          ctx.stroke();
          ctx.fillStyle = theme.faint;
          ctx.fillText(
            frequency >= 1000 ? `${(frequency / 1000).toFixed(0)}k` : frequency.toFixed(0),
            x,
            area.bottom + 3
          );
        }
      }

      const yFor = (db: number) =>
        area.bottom - ((db - range.min) / (range.max - range.min)) * area.height;

      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();

      /**
       * Draw a trace. On a log axis many bins collapse into one pixel column, so
       * the maximum within each column is drawn: taking the first or last bin
       * would make narrow peaks flicker in and out as the spectrum moves.
       */
      const drawTrace = (source: Float32Array, colour: string, lineWidth: number, fill: boolean) => {
        const columns = Math.max(2, Math.round(area.width));
        const columnMax = new Float32Array(columns).fill(NaN);
        const firstBin = Math.max(1, Math.floor(minHz / binWidth));
        for (let i = firstBin; i < bins; i++) {
          const frequency = i * binWidth;
          if (frequency > upperHz) break;
          const x = xForFrequency(frequency, area);
          const column = Math.max(0, Math.min(columns - 1, Math.round(x - area.left)));
          const value = valueAt(i, source);
          if (!Number.isFinite(value)) continue;
          if (Number.isNaN(columnMax[column]) || value > columnMax[column]) {
            columnMax[column] = value;
          }
        }

        ctx.beginPath();
        let open = false;
        let firstX = 0;
        let lastX = 0;
        for (let c = 0; c < columns; c++) {
          const value = columnMax[c];
          if (Number.isNaN(value)) continue;
          const x = area.left + c;
          const y = Math.max(area.top - 2, Math.min(area.bottom + 2, yFor(value)));
          if (!open) {
            ctx.moveTo(x, y);
            firstX = x;
            open = true;
          } else ctx.lineTo(x, y);
          lastX = x;
        }
        if (!open) return;

        if (fill) {
          ctx.save();
          ctx.lineTo(lastX, area.bottom);
          ctx.lineTo(firstX, area.bottom);
          ctx.closePath();
          const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
          gradient.addColorStop(0, 'rgba(34, 211, 238, 0.30)');
          gradient.addColorStop(1, 'rgba(34, 211, 238, 0.02)');
          ctx.fillStyle = gradient;
          ctx.fill();
          ctx.restore();
          // Re-stroke the outline without the closing segments.
          ctx.beginPath();
          open = false;
          for (let c = 0; c < columns; c++) {
            const value = columnMax[c];
            if (Number.isNaN(value)) continue;
            const x = area.left + c;
            const y = Math.max(area.top - 2, Math.min(area.bottom + 2, yFor(value)));
            if (!open) {
              ctx.moveTo(x, y);
              open = true;
            } else ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = colour;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      };

      if (frame.spectrumPeak) drawTrace(frame.spectrumPeak, theme.warn, 1, false);
      drawTrace(frame.spectrum, theme.accent, 1.4, true);

      ctx.restore();

      // Cursor
      const x = cursorX;
      if (x !== null && x >= area.left && x <= area.right) {
        const frequency = frequencyForX(x, area);
        const bin = Math.max(1, Math.min(bins - 1, Math.round(frequency / binWidth)));
        const value = valueAt(bin, frame.spectrum);
        ctx.strokeStyle = theme.text;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, area.top);
        ctx.lineTo(Math.round(x) + 0.5, area.bottom);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (Number.isFinite(value)) {
          ctx.fillStyle = theme.text;
          ctx.beginPath();
          ctx.arc(x, yFor(value), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    [
      frame,
      calibration,
      weighting,
      axis,
      minHz,
      upperHz,
      dynamicRangeDb,
      padding,
      xForFrequency,
      frequencyForX,
      cursorX,
    ]
  );

  const { canvasRef, containerRef, size, invalidate } = useCanvas(draw);

  useEffect(() => {
    invalidate();
  }, [invalidate, frame, axis, weighting, dynamicRangeDb, cursorX]);

  const readout = useMemo(() => {
    if (!frame) return null;
    if (cursorX === null) {
      return {
        label: 'Peak',
        frequency: frame.peak.frequency,
        level: Number.isFinite(frame.peak.levelDb)
          ? calibration.toDisplay(frame.peak.levelDb) +
            (weighting === 'Z' ? 0 : weightingDb(weighting, Math.max(1, frame.peak.frequency)))
          : NaN,
      };
    }
    return null;
  }, [frame, cursorX, calibration, weighting]);

  // Cursor read-out is captured at pick time rather than derived, so it does not
  // change under the finger as new frames arrive.
  const [cursorInfo, setCursorInfo] = useState<{ frequency: number; level: number } | null>(null);

  const pick = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!frame) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const area = plotArea({ width: rect.width, height: rect.height, dpr: 1 }, padding);
      const x = event.clientX - rect.left;
      if (x < area.left || x > area.right) return;
      setCursorX(x);
      const frequency = frequencyForX(x, area);
      const bin = Math.max(1, Math.min(frame.spectrum.length - 1, Math.round(frequency / frame.binWidth)));
      const raw = frame.spectrum[bin];
      const level =
        Number.isFinite(raw) && raw > LEVEL_FLOOR_DB
          ? calibration.toDisplay(raw) +
            (weighting === 'Z' ? 0 : weightingDb(weighting, Math.max(1, bin * frame.binWidth)))
          : NaN;
      setCursorInfo({ frequency: bin * frame.binWidth, level });
    },
    [frame, padding, frequencyForX, calibration, weighting]
  );

  const unit = calibration.isCalibrated ? 'dB' : 'dBFS';

  return (
    <div>
      <div
        ref={containerRef}
        className="relative w-full touch-none"
        style={{ height }}
        onPointerDown={pick}
        onPointerMove={(event) => {
          if (event.buttons > 0) pick(event);
        }}
      >
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          role="img"
          aria-label="FFT spectrum"
        />
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1 text-[11px]">
        {cursorInfo ? (
          <>
            <span className="tnum">
              <span className="text-faint">cursor </span>
              <span className="text-ink">{formatFrequency(cursorInfo.frequency)}</span>
            </span>
            <span className="tnum">
              <span className="text-accent">{formatLevel(cursorInfo.level)}</span>{' '}
              <span className="text-faint">{unit}</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setCursorX(null);
                setCursorInfo(null);
              }}
              className="text-faint underline"
            >
              clear
            </button>
          </>
        ) : readout ? (
          <>
            <span className="tnum">
              <span className="text-faint">peak </span>
              <span className="text-ink">{formatFrequency(readout.frequency)}</span>
            </span>
            <span className="tnum">
              <span className="text-accent">
                {Number.isFinite(readout.level) ? formatLevel(readout.level) : NO_VALUE}
              </span>{' '}
              <span className="text-faint">{unit}</span>
            </span>
            <span className="text-faint">tap the plot for a cursor</span>
          </>
        ) : null}
        {frame ? (
          <span className="tnum ml-auto text-faint">
            {frame.fftSize} pt &middot; {frame.binWidth.toFixed(1)} Hz/bin &middot; {frame.window}
          </span>
        ) : null}
      </div>
    </div>
  );
}
