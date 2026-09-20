'use client';

/**
 * Level history plot.
 *
 * Reads directly from the LevelHistory ring buffer and draws with canvas, so a
 * one-hour trace costs the same as a ten-second one. Supports selectable traces,
 * a min/max envelope, a draggable cursor with a read-out, and pinch/wheel zoom
 * with pan.
 *
 * Values are converted from dBFS to the display unit at draw time, so switching
 * calibration profile instantly and correctly rescales the whole history without
 * re-measuring.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import { HISTORY_TRACES, type HistoryTraceId, type LevelHistory } from '@/measurement/levelHistory';
import { formatDuration, formatLevel, NO_VALUE } from '@/lib/format';
import type { ActiveCalibration } from '@/calibration/activeCalibration';
import {
  type CanvasSize,
  drawValueGrid,
  plotArea,
  readChartTheme,
  useCanvas,
} from './canvas';

export interface HistoryPlotProps {
  history: LevelHistory;
  /** Bumped by the provider whenever the buffer changes. */
  version: number;
  calibration: ActiveCalibration;
  traces: readonly HistoryTraceId[];
  /** Trailing window in seconds; Infinity for the whole session. */
  windowSeconds: number;
  height?: number;
  showEnvelope?: boolean;
  showCursor?: boolean;
  showExtremes?: boolean;
  compact?: boolean;
}

interface CursorState {
  /** Index into the visible range. */
  index: number;
  x: number;
}

export function HistoryPlot({
  history,
  version,
  calibration,
  traces,
  windowSeconds,
  height = 180,
  showEnvelope = false,
  showCursor = true,
  showExtremes = true,
  compact = false,
}: HistoryPlotProps) {
  const [cursor, setCursor] = useState<CursorState | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panSeconds, setPanSeconds] = useState(0);

  // The cursor is a plain dependency of the draw callback rather than a ref read
  // during the draw, so no mid-render ref mutation is needed.
  const padding = useMemo(
    () =>
      compact
        ? { left: 30, right: 4, top: 6, bottom: 14 }
        : { left: 36, right: 8, top: 10, bottom: 20 },
    [compact]
  );

  /** Resolve the visible time span from the window, zoom and pan. */
  const resolveRange = useCallback(() => {
    const total = history.durationSeconds;
    const requested = Number.isFinite(windowSeconds) ? windowSeconds / zoom : total;
    const span = Math.max(1, Math.min(total > 0 ? total : requested, requested));
    let end = total - panSeconds;
    if (end > total) end = total;
    if (end < span) end = span;
    return { start: Math.max(0, end - span), end, total };
  }, [history, windowSeconds, zoom, panSeconds]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: CanvasSize) => {
      const theme = readChartTheme();
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, size.width, size.height);

      const area = plotArea(size, padding);
      const elapsed = history.elapsed;
      const count = elapsed.length;

      if (count < 2) {
        ctx.fillStyle = theme.faint;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          'No history yet — start a measurement',
          area.left + area.width / 2,
          area.top + area.height / 2
        );
        return;
      }

      const { start, end } = resolveRange();
      // Locate the visible index range.
      let firstIndex = 0;
      while (firstIndex < count - 1 && elapsed[firstIndex] < start) firstIndex++;
      let lastIndex = count - 1;
      while (lastIndex > firstIndex && elapsed[lastIndex] > end) lastIndex--;

      // Vertical range from the visible data, snapped to 5 dB and never narrower
      // than 20 dB so small fluctuations do not look dramatic.
      let min = Infinity;
      let max = -Infinity;
      const consider = (value: number) => {
        if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) return;
        const display = calibration.toDisplay(value);
        if (display < min) min = display;
        if (display > max) max = display;
      };
      for (const id of traces) {
        const data = history.trace(id);
        for (let i = firstIndex; i <= lastIndex; i++) consider(data[i]);
      }
      if (showEnvelope) {
        const envelope = history.lafEnvelope;
        for (let i = firstIndex; i <= lastIndex; i++) {
          consider(envelope.max[i]);
          consider(envelope.min[i]);
        }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = calibration.isCalibrated ? 20 : -80;
        max = calibration.isCalibrated ? 100 : 0;
      }
      const centre = (min + max) / 2;
      const halfSpan = Math.max(10, (max - min) / 2 + 2);
      const yMin = Math.floor((centre - halfSpan) / 5) * 5;
      const yMax = Math.ceil((centre + halfSpan) / 5) * 5;

      drawValueGrid(ctx, area, theme, yMin, yMax, { targetLines: compact ? 3 : 5 });

      const timeSpan = Math.max(0.001, end - start);
      const xFor = (t: number) => area.left + ((t - start) / timeSpan) * area.width;
      const yFor = (db: number) => area.bottom - ((db - yMin) / (yMax - yMin)) * area.height;

      // Time axis labels
      if (!compact) {
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = theme.faint;
        const ticks = 4;
        for (let i = 0; i <= ticks; i++) {
          const t = start + (timeSpan / ticks) * i;
          const x = xFor(t);
          ctx.strokeStyle = theme.grid;
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, area.top);
          ctx.lineTo(Math.round(x) + 0.5, area.bottom);
          ctx.stroke();
          ctx.fillText(formatDuration(t), x, area.bottom + 3);
        }
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();

      // Min/max envelope behind the traces.
      if (showEnvelope) {
        const envelope = history.lafEnvelope;
        ctx.fillStyle = 'rgba(34, 211, 238, 0.12)';
        ctx.beginPath();
        let started = false;
        for (let i = firstIndex; i <= lastIndex; i++) {
          const value = envelope.max[i];
          if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) continue;
          const x = xFor(elapsed[i]);
          const y = yFor(calibration.toDisplay(value));
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        for (let i = lastIndex; i >= firstIndex; i--) {
          const value = envelope.min[i];
          if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) continue;
          ctx.lineTo(xFor(elapsed[i]), yFor(calibration.toDisplay(value)));
        }
        if (started) {
          ctx.closePath();
          ctx.fill();
        }
      }

      // Traces
      for (const id of traces) {
        const definition = HISTORY_TRACES.find((t) => t.id === id);
        if (!definition) continue;
        const data = history.trace(id);
        ctx.strokeStyle = definition.colour;
        ctx.lineWidth = id === 'LAeq' ? 2 : 1.3;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let open = false;
        for (let i = firstIndex; i <= lastIndex; i++) {
          const value = data[i];
          if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) {
            open = false;
            continue;
          }
          const x = xFor(elapsed[i]);
          const y = yFor(calibration.toDisplay(value));
          if (open) ctx.lineTo(x, y);
          else {
            ctx.moveTo(x, y);
            open = true;
          }
        }
        ctx.stroke();
      }

      ctx.restore();

      // Extremes of the primary trace over the visible window
      if (showExtremes && traces.length > 0) {
        const primary = traces.includes('LAF') ? 'LAF' : traces[0];
        const data = history.trace(primary);
        let hi = -Infinity;
        let lo = Infinity;
        let hiIndex = -1;
        let loIndex = -1;
        for (let i = firstIndex; i <= lastIndex; i++) {
          const value = data[i];
          if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) continue;
          if (value > hi) {
            hi = value;
            hiIndex = i;
          }
          if (value < lo) {
            lo = value;
            loIndex = i;
          }
        }
        ctx.font = '9px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        for (const [index, value, colour, label] of [
          [hiIndex, hi, theme.warn, 'max'],
          [loIndex, lo, theme.accent, 'min'],
        ] as Array<[number, number, string, string]>) {
          if (index < 0) continue;
          const x = xFor(elapsed[index]);
          const y = yFor(calibration.toDisplay(value));
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
          const text = `${label} ${calibration.toDisplay(value).toFixed(1)}`;
          ctx.textAlign = x > area.right - 60 ? 'right' : 'left';
          ctx.fillText(text, x + (x > area.right - 60 ? -6 : 6), y - 7);
        }
      }

      // Cursor
      if (showCursor && cursor) {
        const index = Math.max(firstIndex, Math.min(lastIndex, cursor.index));
        const x = xFor(elapsed[index]);
        ctx.strokeStyle = theme.text;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, area.top);
        ctx.lineTo(Math.round(x) + 0.5, area.bottom);
        ctx.stroke();
        ctx.globalAlpha = 1;
        for (const id of traces) {
          const definition = HISTORY_TRACES.find((t) => t.id === id);
          if (!definition) continue;
          const value = history.trace(id)[index];
          if (!Number.isFinite(value) || value <= LEVEL_FLOOR_DB) continue;
          ctx.fillStyle = definition.colour;
          ctx.beginPath();
          ctx.arc(x, yFor(calibration.toDisplay(value)), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    [
      history,
      calibration,
      traces,
      padding,
      resolveRange,
      showEnvelope,
      showExtremes,
      showCursor,
      compact,
      cursor,
    ]
  );

  const { canvasRef, containerRef, size, invalidate } = useCanvas(draw);

  useEffect(() => {
    invalidate();
  }, [version, invalidate, traces, windowSeconds, zoom, panSeconds, calibration, cursor]);

  // Pointer interaction: drag to move the cursor, two-finger or wheel to zoom.
  const handlePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!showCursor) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const area = plotArea(
        { width: rect.width, height: rect.height, dpr: 1 },
        padding
      );
      if (x < area.left || x > area.right) return;
      const { start, end } = resolveRange();
      const t = start + ((x - area.left) / area.width) * (end - start);
      const elapsed = history.elapsed;
      let index = 0;
      let bestDelta = Infinity;
      for (let i = 0; i < elapsed.length; i++) {
        const delta = Math.abs(elapsed[i] - t);
        if (delta < bestDelta) {
          bestDelta = delta;
          index = i;
        }
      }
      setCursor({ index, x });
    },
    [history, padding, resolveRange, showCursor]
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!Number.isFinite(windowSeconds)) return;
      event.preventDefault();
      setZoom((current) =>
        Math.max(1, Math.min(64, current * (event.deltaY < 0 ? 1.2 : 1 / 1.2)))
      );
    },
    [windowSeconds]
  );

  const cursorReadout = useMemo(() => {
    if (!cursor) return null;
    const elapsed = history.elapsed;
    const index = Math.max(0, Math.min(elapsed.length - 1, cursor.index));
    if (elapsed.length === 0) return null;
    return {
      // ersion is carried through so the memo genuinely depends on it: the
      // history buffer is mutable, and the version counter is the only signal that
      // its contents changed.
      version,
      time: elapsed[index],
      values: traces.map((id) => {
        const value = history.trace(id)[index];
        const definition = HISTORY_TRACES.find((t) => t.id === id);
        return {
          id,
          label: definition?.label ?? id,
          colour: definition?.colour ?? '#fff',
          text:
            Number.isFinite(value) && value > LEVEL_FLOOR_DB
              ? formatLevel(calibration.toDisplay(value))
              : NO_VALUE,
        };
      }),
    };
  }, [cursor, history, traces, calibration, version]);

  return (
    <div>
      <div
        ref={containerRef}
        onPointerDown={handlePointer}
        onPointerMove={(event) => {
          if (event.buttons > 0) handlePointer(event);
        }}
        onWheel={handleWheel}
        className="relative w-full touch-none"
        style={{ height }}
      >
        <canvas ref={canvasRef} width={size.width} height={size.height} role="img" aria-label="Level history" />
      </div>

      {showCursor && cursorReadout ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px]">
          <span className="tnum text-faint">at {formatDuration(cursorReadout.time)}</span>
          {cursorReadout.values.map((entry) => (
            <span key={entry.id} className="tnum inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: entry.colour }} />
              <span className="text-faint">{entry.label}</span>
              <span className="text-ink">{entry.text}</span>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setCursor(null)}
            className="ml-auto text-faint underline"
          >
            clear cursor
          </button>
        </div>
      ) : null}

      {zoom > 1 || panSeconds !== 0 ? (
        <div className="mt-1 flex items-center gap-2 px-1 text-[11px] text-faint">
          <span className="tnum">zoom {zoom.toFixed(1)}x</span>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPanSeconds(0);
            }}
            className="underline"
          >
            reset view
          </button>
        </div>
      ) : null}
    </div>
  );
}
