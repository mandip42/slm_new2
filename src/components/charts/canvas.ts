'use client';

/**
 * Canvas plumbing shared by every visualisation.
 *
 * The three things that go wrong with canvas on phones, handled once here:
 *   1. device pixel ratio — a canvas sized in CSS pixels is blurry on a 3x
 *      screen, so the backing store is scaled and the context pre-transformed
 *   2. resize — ResizeObserver rather than window resize, so rotation, the
 *      Android keyboard and layout changes are all covered
 *   3. render scheduling — one requestAnimationFrame loop per canvas, driven by
 *      a "dirty" flag set from the data subscription, so incoming frames at
 *      15-20 Hz never queue up more work than the display can show
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface CanvasSize {
  /** CSS pixels. */
  width: number;
  height: number;
  /** Backing store scale actually applied. */
  dpr: number;
}

export interface CanvasHandle {
  canvasRef: (node: HTMLCanvasElement | null) => void;
  containerRef: (node: HTMLDivElement | null) => void;
  size: CanvasSize;
  /** Request a redraw on the next animation frame. */
  invalidate: () => void;
}

/**
 * Manage a canvas that is redrawn imperatively.
 *
 * @param draw Called with a context already scaled to CSS pixels.
 */
export function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, size: CanvasSize) => void,
  options: { maxDpr?: number } = {}
): CanvasHandle {
  const maxDpr = options.maxDpr ?? 2.5;
  const canvasNode = useRef<HTMLCanvasElement | null>(null);
  const containerNode = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const frame = useRef(0);

  // The draw callback and the current size are read inside a requestAnimationFrame
  // callback, so they are mirrored into refs from an effect rather than during
  // render: writing a ref while rendering is not safe under concurrent rendering.
  const drawRef = useRef(draw);
  const sizeRef = useRef(size);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const render = useCallback(() => {
    frame.current = 0;
    const canvas = canvasNode.current;
    const current = sizeRef.current;
    if (!canvas || current.width === 0 || current.height === 0) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.setTransform(current.dpr, 0, 0, current.dpr, 0, 0);
    drawRef.current(ctx, current);
  }, []);

  const invalidate = useCallback(() => {
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(() => {
      render();
    });
  }, [render]);

  // Observe the container rather than the canvas: the canvas is sized from the
  // observation, so observing it would feed back on itself.
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerNode.current = node;
  }, []);

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasNode.current = node;
  }, []);

  useEffect(() => {
    const container = containerNode.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const apply = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(maxDpr, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const canvas = canvasNode.current;
      if (canvas) {
        const backingWidth = Math.round(width * dpr);
        const backingHeight = Math.round(height * dpr);
        if (canvas.width !== backingWidth) canvas.width = backingWidth;
        if (canvas.height !== backingHeight) canvas.height = backingHeight;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      setSize((previous) =>
        previous.width === width && previous.height === height && previous.dpr === dpr
          ? previous
          : { width, height, dpr }
      );
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(container);
    return () => observer.disconnect();
  }, [maxDpr]);

  // Redraw whenever the size or the draw callback changes.
  useEffect(() => {
    invalidate();
  }, [size, draw, invalidate]);

  useEffect(() => {
    return () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
    };
  }, []);

  return { canvasRef, containerRef, size, invalidate };
}

/** Read a CSS custom property from the document root. */
export function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Theme colours resolved once per draw.
 *
 * Reading CSS variables is a layout-adjacent operation, so it is done once at
 * the top of a draw rather than per drawing primitive.
 */
export interface ChartTheme {
  background: string;
  panel: string;
  grid: string;
  gridStrong: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  warn: string;
  bad: string;
  ok: string;
  violet: string;
}

export function readChartTheme(): ChartTheme {
  return {
    background: cssVar('--color-panel-sunken', '#080d12'),
    panel: cssVar('--color-panel', '#0c1218'),
    grid: cssVar('--color-line', '#1c2732'),
    gridStrong: cssVar('--color-line-strong', '#2b3c4c'),
    text: cssVar('--color-ink', '#e9f1f8'),
    muted: cssVar('--color-muted', '#93a7ba'),
    faint: cssVar('--color-faint', '#61758a'),
    accent: cssVar('--color-accent', '#22d3ee'),
    warn: cssVar('--color-warn', '#fbbf24'),
    bad: cssVar('--color-bad', '#f87171'),
    ok: cssVar('--color-ok', '#34d399'),
    violet: cssVar('--color-violet', '#a78bfa'),
  };
}

export interface PlotArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function plotArea(
  size: CanvasSize,
  padding: { left: number; right: number; top: number; bottom: number }
): PlotArea {
  const left = padding.left;
  const top = padding.top;
  const right = Math.max(left + 1, size.width - padding.right);
  const bottom = Math.max(top + 1, size.height - padding.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Choose a "nice" grid step for a value range. */
export function niceStep(range: number, targetLines: number): number {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, targetLines);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Draw the plot frame and horizontal grid with labels. */
export function drawValueGrid(
  ctx: CanvasRenderingContext2D,
  area: PlotArea,
  theme: ChartTheme,
  min: number,
  max: number,
  options: { targetLines?: number; unit?: string; labelDecimals?: number } = {}
): void {
  const step = niceStep(max - min, options.targetLines ?? 5);
  const first = Math.ceil(min / step) * step;
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let value = first; value <= max + 1e-9; value += step) {
    const y = area.bottom - ((value - min) / (max - min)) * area.height;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(area.left, Math.round(y) + 0.5);
    ctx.lineTo(area.right, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillStyle = theme.faint;
    ctx.fillText(value.toFixed(options.labelDecimals ?? 0), area.left - 5, y);
  }

  ctx.strokeStyle = theme.gridStrong;
  ctx.lineWidth = 1;
  ctx.strokeRect(area.left + 0.5, area.top + 0.5, area.width - 1, area.height - 1);
}

/** Logarithmic frequency axis helpers. */
export function logFrequencyToX(frequency: number, area: PlotArea, minHz: number, maxHz: number): number {
  const clamped = Math.max(minHz, Math.min(maxHz, frequency));
  const t = (Math.log10(clamped) - Math.log10(minHz)) / (Math.log10(maxHz) - Math.log10(minHz));
  return area.left + t * area.width;
}

export function xToLogFrequency(x: number, area: PlotArea, minHz: number, maxHz: number): number {
  const t = Math.max(0, Math.min(1, (x - area.left) / area.width));
  return Math.pow(10, Math.log10(minHz) + t * (Math.log10(maxHz) - Math.log10(minHz)));
}

export const LOG_AXIS_TICKS = [
  20, 31.5, 50, 100, 200, 315, 500, 1000, 2000, 3150, 5000, 10000, 20000,
] as const;

export function formatAxisFrequency(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(k < 10 ? 1 : 0)}k`;
  }
  return Number.isInteger(hz) ? String(hz) : hz.toFixed(1);
}

/** Draw a log-frequency grid with labels along the bottom. */
export function drawLogFrequencyGrid(
  ctx: CanvasRenderingContext2D,
  area: PlotArea,
  theme: ChartTheme,
  minHz: number,
  maxHz: number
): void {
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of LOG_AXIS_TICKS) {
    if (tick < minHz || tick > maxHz) continue;
    const x = Math.round(logFrequencyToX(tick, area, minHz, maxHz)) + 0.5;
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();
    ctx.fillStyle = theme.faint;
    ctx.fillText(formatAxisFrequency(tick), x, area.bottom + 4);
  }
}

/**
 * Perceptual colormap for the spectrogram.
 *
 * An approximation of the "inferno" ramp: monotonically increasing in perceived
 * lightness, which is what makes a spectrogram readable. A rainbow ramp is not
 * monotonic in lightness and invents structure that is not in the data.
 */
const INFERNO_STOPS: ReadonlyArray<[number, number, number]> = [
  [0, 0, 4],
  [22, 11, 57],
  [66, 10, 104],
  [106, 23, 110],
  [147, 38, 103],
  [188, 55, 84],
  [221, 81, 58],
  [243, 120, 25],
  [252, 165, 10],
  [246, 215, 70],
  [252, 255, 164],
];

/** Build a 256-entry RGBA lookup table for the spectrogram. */
export function buildInfernoLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const segments = INFERNO_STOPS.length - 1;
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * segments;
    const index = Math.min(segments - 1, Math.floor(t));
    const frac = t - index;
    const a = INFERNO_STOPS[index];
    const b = INFERNO_STOPS[index + 1];
    lut[i * 4] = a[0] + (b[0] - a[0]) * frac;
    lut[i * 4 + 1] = a[1] + (b[1] - a[1]) * frac;
    lut[i * 4 + 2] = a[2] + (b[2] - a[2]) * frac;
    lut[i * 4 + 3] = 255;
  }
  return lut;
}
