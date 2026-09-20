'use client';

/**
 * Scrolling spectrogram.
 *
 * Performance approach, which is what makes this usable on a phone:
 *   - the image lives in a single offscreen canvas the width of the plot
 *   - each new frame is drawn as one column, and the existing image is shifted
 *     one pixel left with a self-blit; no per-pixel copy of the history and no
 *     array of retained frames
 *   - the column is built in an ImageData of height H and pushed with putImageData
 *   - React never re-renders during scrolling: the analysis subscription writes
 *     straight into the canvas
 *
 * Frequency mapping is logarithmic by default with each output row taking the
 * maximum of the bins that fall into it, so a narrow tone stays visible instead
 * of being averaged away.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import type { AnalysisFrame } from '@/audio/acousticEngine';
import type { ActiveCalibration } from '@/calibration/activeCalibration';
import { formatFrequency, formatLevel, NO_VALUE } from '@/lib/format';
import { useAnalysisSubscription } from '@/state/EngineProvider';
import { buildInfernoLut, formatAxisFrequency, LOG_AXIS_TICKS, readChartTheme } from './canvas';

export interface SpectrogramProps {
  calibration: ActiveCalibration;
  /** Level at the bottom of the colour scale, relative to the top. */
  dynamicRangeDb: number;
  /** Top of the colour scale. Auto-tracked when null. */
  topDb: number | null;
  minHz: number;
  maxHz: number;
  axis: 'log' | 'linear';
  height?: number;
  paused: boolean;
  /** Incremented by the parent to clear the image. */
  clearToken: number;
}

const AXIS_WIDTH = 34;
const TIME_AXIS_HEIGHT = 14;

export function Spectrogram({
  calibration,
  dynamicRangeDb,
  topDb,
  minHz,
  maxHz,
  axis,
  height = 300,
  paused,
  clearToken,
}: SpectrogramProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const columnRef = useRef<ImageData | null>(null);
  const lut = useMemo(() => buildInfernoLut(), []);
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [autoTop, setAutoTop] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ frequency: number; levelDb: number } | null>(null);
  const latestFrameRef = useRef<AnalysisFrame | null>(null);
  const columnsWritten = useRef(0);
  const [elapsedColumns, setElapsedColumns] = useState(0);

  const plotWidth = Math.max(1, size.width - AXIS_WIDTH);
  const plotHeight = Math.max(1, size.height - TIME_AXIS_HEIGHT);

  // Track container size.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      setSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        dpr,
      });
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // (Re)allocate the offscreen image when the plot geometry changes.
  useEffect(() => {
    if (plotWidth < 2 || plotHeight < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = plotWidth;
    canvas.height = plotHeight;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!ctx) return;
    ctx.fillStyle = '#000004';
    ctx.fillRect(0, 0, plotWidth, plotHeight);
    imageCanvasRef.current = canvas;
    imageCtxRef.current = ctx;
    columnRef.current = ctx.createImageData(1, plotHeight);
    columnsWritten.current = 0;
  }, [plotWidth, plotHeight, clearToken]);

  /**
   * Publish the drawn-length read-out at 2 Hz from the column counter.
   *
   * The counter itself is a ref incremented inside the animation frame; polling it
   * on a timer keeps the label current without turning every drawn column into a
   * React render.
   */
  useEffect(() => {
    const timer = setInterval(() => setElapsedColumns(columnsWritten.current), 500);
    return () => clearInterval(timer);
  }, []);

  /** Row -> frequency mapping for the active axis. */
  const rowFrequencies = useMemo(() => {
    const rows = plotHeight;
    const out = new Float32Array(rows + 1);
    for (let r = 0; r <= rows; r++) {
      // Row 0 is the top of the plot, which is the highest frequency.
      const t = 1 - r / rows;
      out[r] =
        axis === 'log'
          ? Math.pow(10, Math.log10(minHz) + t * (Math.log10(maxHz) - Math.log10(minHz)))
          : minHz + t * (maxHz - minHz);
    }
    return out;
  }, [plotHeight, minHz, maxHz, axis]);

  /** Draw one analysis frame as a new right-hand column. */
  const pushColumn = useCallback(
    (frame: AnalysisFrame) => {
      const ctx = imageCtxRef.current;
      const column = columnRef.current;
      const canvas = imageCanvasRef.current;
      if (!ctx || !column || !canvas) return;

      const top = topDb ?? autoTop ?? (calibration.isCalibrated ? 90 : -10);
      const bottom = top - dynamicRangeDb;
      const span = Math.max(1, top - bottom);
      const bins = frame.spectrum.length;
      const binWidth = frame.binWidth;
      const data = column.data;

      for (let row = 0; row < plotHeight; row++) {
        // Each row covers the band between two adjacent row frequencies. The
        // maximum over that band keeps narrow tones visible.
        const fHigh = rowFrequencies[row];
        const fLow = rowFrequencies[row + 1];
        let binLow = Math.floor(fLow / binWidth);
        let binHigh = Math.ceil(fHigh / binWidth);
        if (binLow < 1) binLow = 1;
        if (binHigh > bins - 1) binHigh = bins - 1;
        if (binHigh < binLow) binHigh = binLow;

        let peak = -Infinity;
        for (let b = binLow; b <= binHigh; b++) {
          const value = frame.spectrum[b];
          if (value > peak) peak = value;
        }

        let intensity = 0;
        if (Number.isFinite(peak) && peak > LEVEL_FLOOR_DB) {
          const display = calibration.toDisplay(peak);
          intensity = Math.max(0, Math.min(1, (display - bottom) / span));
        }
        const index = Math.round(intensity * 255) * 4;
        const offset = row * 4;
        data[offset] = lut[index];
        data[offset + 1] = lut[index + 1];
        data[offset + 2] = lut[index + 2];
        data[offset + 3] = 255;
      }

      // Shift left by one pixel, then write the new column at the right edge.
      ctx.drawImage(canvas, -1, 0);
      ctx.putImageData(column, plotWidth - 1, 0);
      columnsWritten.current++;
    },
    [
      calibration,
      dynamicRangeDb,
      topDb,
      autoTop,
      plotHeight,
      plotWidth,
      rowFrequencies,
      lut,
    ]
  );

  /** Blit the offscreen image plus axes onto the visible canvas. */
  const present = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageCanvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const theme = readChartTheme();

    canvas.width = Math.round(size.width * size.dpr);
    canvas.height = Math.round(size.height * size.dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);

    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, AXIS_WIDTH, 0, plotWidth, plotHeight);

    // Frequency axis
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const tick of LOG_AXIS_TICKS) {
      if (tick < minHz || tick > maxHz) continue;
      const t =
        axis === 'log'
          ? (Math.log10(tick) - Math.log10(minHz)) / (Math.log10(maxHz) - Math.log10(minHz))
          : (tick - minHz) / (maxHz - minHz);
      const y = plotHeight - t * plotHeight;
      ctx.fillStyle = theme.faint;
      ctx.fillText(formatAxisFrequency(tick), AXIS_WIDTH - 4, y);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.moveTo(AXIS_WIDTH, Math.round(y) + 0.5);
      ctx.lineTo(AXIS_WIDTH + 4, Math.round(y) + 0.5);
      ctx.stroke();
    }

    // Time axis: labels relative to now, on the right.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.faint;
    const columnsPerSecond = 15; // analysis frame rate
    const totalSeconds = plotWidth / columnsPerSecond;
    for (let i = 0; i <= 4; i++) {
      const fraction = i / 4;
      const x = AXIS_WIDTH + plotWidth * fraction;
      const secondsAgo = totalSeconds * (1 - fraction);
      ctx.fillText(secondsAgo === 0 ? 'now' : `-${secondsAgo.toFixed(0)}s`, x, plotHeight + 2);
    }

    ctx.strokeStyle = theme.gridStrong;
    ctx.strokeRect(AXIS_WIDTH + 0.5, 0.5, plotWidth - 1, plotHeight - 1);
  }, [size, plotWidth, plotHeight, minHz, maxHz, axis]);

  // One rAF loop: push a column when a new frame arrived, then present.
  const pendingFrame = useRef<AnalysisFrame | null>(null);
  const rafRef = useRef(0);

  useAnalysisSubscription((frame) => {
    latestFrameRef.current = frame;
    if (paused) return;
    pendingFrame.current = frame;
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const next = pendingFrame.current;
      pendingFrame.current = null;
      if (next) pushColumn(next);
      present();
    });
  });

  // Auto-track the top of the colour scale from the observed peaks, in 5 dB
  // steps so the image does not shimmer.
  useAnalysisSubscription((frame) => {
    if (topDb !== null) return;
    const peak = frame.peak.levelDb;
    if (!Number.isFinite(peak)) return;
    const display = calibration.toDisplay(peak);
    const target = Math.ceil((display + 6) / 5) * 5;
    setAutoTop((current) => {
      if (current === null) return target;
      if (target > current) return target;
      if (target < current - 15) return current - 5;
      return current;
    });
  });

  // Redraw when geometry or theme-affecting props change.
  useEffect(() => {
    present();
  }, [present, clearToken]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const pick = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const frame = latestFrameRef.current;
      if (!frame) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      if (y < 0 || y > plotHeight) return;
      const t = 1 - y / plotHeight;
      const frequency =
        axis === 'log'
          ? Math.pow(10, Math.log10(minHz) + t * (Math.log10(maxHz) - Math.log10(minHz)))
          : minHz + t * (maxHz - minHz);
      const bin = Math.max(1, Math.min(frame.spectrum.length - 1, Math.round(frequency / frame.binWidth)));
      const raw = frame.spectrum[bin];
      setCursor({
        frequency: bin * frame.binWidth,
        levelDb:
          Number.isFinite(raw) && raw > LEVEL_FLOOR_DB ? calibration.toDisplay(raw) : NaN,
      });
    },
    [plotHeight, axis, minHz, maxHz, calibration]
  );

  const top = topDb ?? autoTop;
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
        <canvas ref={canvasRef} role="img" aria-label="Spectrogram" />
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px]">
        <span className="tnum text-faint">
          scale {top !== null ? `${formatLevel(top - dynamicRangeDb, 0)} to ${formatLevel(top, 0)}` : NO_VALUE}{' '}
          {unit}
        </span>
        {cursor ? (
          <span className="tnum">
            <span className="text-faint">at </span>
            <span className="text-ink">{formatFrequency(cursor.frequency)}</span>
            <span className="text-faint"> level </span>
            <span className="text-accent">{formatLevel(cursor.levelDb)}</span>
            <span className="text-faint"> {unit}</span>
          </span>
        ) : (
          <span className="text-faint">tap for a frequency read-out</span>
        )}
        <span className="tnum ml-auto text-faint">
          {paused ? 'paused' : `${(elapsedColumns / 15).toFixed(0)} s drawn`}
        </span>
      </div>

      {/* Colour scale legend */}
      <div className="mt-1.5 flex items-center gap-2 px-1">
        <span className="text-[10px] text-faint">
          {top !== null ? formatLevel(top - dynamicRangeDb, 0) : ''}
        </span>
        <div
          className="h-2 flex-1 rounded"
          style={{
            background:
              'linear-gradient(to right, rgb(0,0,4), rgb(66,10,104), rgb(147,38,103), rgb(221,81,58), rgb(252,165,10), rgb(252,255,164))',
          }}
        />
        <span className="text-[10px] text-faint">{top !== null ? formatLevel(top, 0) : ''}</span>
      </div>
    </div>
  );
}
