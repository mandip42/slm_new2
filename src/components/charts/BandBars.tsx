'use client';

/**
 * Fractional-octave band bar chart.
 *
 * Draws current level, band Leq and band maximum from the analysis frame.
 * Unavailable bands (upper edge too close to Nyquist) are drawn as hatched grey
 * columns and labelled, rather than being silently omitted or shown as zero.
 *
 * The frequency-response correction, when a calibration provides one, is applied
 * per band here and bands outside the calibrated frequency range are marked.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import type { BandLayoutEntry } from '@/audio/messages';
import type { ActiveCalibration } from '@/calibration/activeCalibration';
import { formatFrequency, formatLevel, NO_VALUE } from '@/lib/format';
import { type CanvasSize, drawValueGrid, plotArea, readChartTheme, useCanvas } from './canvas';

export type BandDisplayMode = 'current' | 'leq' | 'max';

export interface BandBarsProps {
  bands: readonly BandLayoutEntry[];
  current: Float32Array | null;
  leq: Float32Array | null;
  max: Float32Array | null;
  calibration: ActiveCalibration;
  /** Which value the bars represent. */
  mode: BandDisplayMode;
  /** Overlay Leq and max as markers on top of the bars. */
  showOverlays?: boolean;
  height?: number;
  compact?: boolean;
  /** Fixed vertical range; auto-scaled when omitted. */
  range?: { min: number; max: number } | null;
  onSelectBand?: (index: number | null) => void;
  selectedIndex?: number | null;
}

export function BandBars({
  bands,
  current,
  leq,
  max,
  calibration,
  mode,
  showOverlays = true,
  height = 200,
  compact = false,
  range = null,
  onSelectBand,
  selectedIndex = null,
}: BandBarsProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // The highlighted band is a plain dependency of the draw callback, so no ref
  // mirroring is needed.
  const active = selectedIndex ?? hoverIndex;

  const corrections = useMemo(() => {
    const frequencies = bands.map((b) => b.exact);
    return calibration.bandCorrections(frequencies);
  }, [bands, calibration]);

  const values = useMemo(() => {
    const pick = mode === 'leq' ? leq : mode === 'max' ? max : current;
    if (!pick || pick.length !== bands.length) return null;
    const out = new Float32Array(bands.length);
    for (let i = 0; i < bands.length; i++) {
      const raw = pick[i];
      out[i] =
        Number.isFinite(raw) && raw > LEVEL_FLOOR_DB
          ? calibration.toDisplay(raw) + corrections.corrections[i]
          : NaN;
    }
    return out;
  }, [bands.length, mode, leq, max, current, calibration, corrections]);

  const overlays = useMemo(() => {
    if (!showOverlays) return null;
    const convert = (source: Float32Array | null) => {
      if (!source || source.length !== bands.length) return null;
      const out = new Float32Array(bands.length);
      for (let i = 0; i < bands.length; i++) {
        const raw = source[i];
        out[i] =
          Number.isFinite(raw) && raw > LEVEL_FLOOR_DB
            ? calibration.toDisplay(raw) + corrections.corrections[i]
            : NaN;
      }
      return out;
    };
    return { leq: convert(leq), max: convert(max) };
  }, [showOverlays, bands.length, leq, max, calibration, corrections]);

  const padding = useMemo(
    () =>
      compact
        ? { left: 28, right: 4, top: 6, bottom: 16 }
        : { left: 34, right: 8, top: 10, bottom: 26 },
    [compact]
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: CanvasSize) => {
      const theme = readChartTheme();
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, size.width, size.height);
      const area = plotArea(size, padding);

      if (bands.length === 0) {
        ctx.fillStyle = theme.faint;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Waiting for the analyser', area.left + area.width / 2, area.top + area.height / 2);
        return;
      }

      // Vertical range
      let yMin: number;
      let yMax: number;
      if (range) {
        yMin = range.min;
        yMax = range.max;
      } else {
        let lo = Infinity;
        let hi = -Infinity;
        const consider = (value: number) => {
          if (!Number.isFinite(value)) return;
          if (value < lo) lo = value;
          if (value > hi) hi = value;
        };
        if (values) for (let i = 0; i < values.length; i++) if (bands[i].available) consider(values[i]);
        if (overlays?.max) {
          for (let i = 0; i < overlays.max.length; i++) if (bands[i].available) consider(overlays.max[i]);
        }
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
          lo = calibration.isCalibrated ? 20 : -100;
          hi = calibration.isCalibrated ? 90 : -10;
        }
        const pad = Math.max(6, (hi - lo) * 0.15);
        yMin = Math.floor((lo - pad) / 5) * 5;
        yMax = Math.ceil((hi + pad) / 5) * 5;
        if (yMax - yMin < 25) yMax = yMin + 25;
      }

      drawValueGrid(ctx, area, theme, yMin, yMax, { targetLines: compact ? 3 : 5 });

      const slot = area.width / bands.length;
      const barWidth = Math.max(1.5, slot * 0.74);
      const yFor = (db: number) =>
        area.bottom - ((db - yMin) / (yMax - yMin)) * area.height;

      for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        const cx = area.left + slot * (i + 0.5);
        const x0 = cx - barWidth / 2;

        if (!band.available) {
          // Hatched column: measurable range ends here at this sample rate.
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, area.top, barWidth, area.height);
          ctx.clip();
          ctx.strokeStyle = theme.grid;
          ctx.lineWidth = 1;
          for (let d = -area.height; d < barWidth + area.height; d += 5) {
            ctx.beginPath();
            ctx.moveTo(x0 + d, area.bottom);
            ctx.lineTo(x0 + d + area.height, area.top);
            ctx.stroke();
          }
          ctx.restore();
          continue;
        }

        const value = values ? values[i] : NaN;
        if (Number.isFinite(value)) {
          const y = Math.min(area.bottom, Math.max(area.top, yFor(value)));
          const barHeight = area.bottom - y;
          const outsideCalibration = calibration.frequencyCorrectionEnabled && !corrections.calibrated[i];
          ctx.fillStyle =
            i === active
              ? theme.text
              : outsideCalibration
                ? theme.violet
                : theme.accent;
          ctx.globalAlpha = i === active ? 1 : outsideCalibration ? 0.75 : 0.9;
          ctx.fillRect(x0, y, barWidth, Math.max(1, barHeight));
          ctx.globalAlpha = 1;
        }

        // Leq and max markers
        if (overlays?.leq && Number.isFinite(overlays.leq[i]) && mode !== 'leq') {
          const y = yFor(overlays.leq[i]);
          if (y >= area.top && y <= area.bottom) {
            ctx.strokeStyle = theme.warn;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(x0, Math.round(y) + 0.5);
            ctx.lineTo(x0 + barWidth, Math.round(y) + 0.5);
            ctx.stroke();
          }
        }
        if (overlays?.max && Number.isFinite(overlays.max[i]) && mode !== 'max') {
          const y = yFor(overlays.max[i]);
          if (y >= area.top && y <= area.bottom) {
            ctx.strokeStyle = theme.bad;
            ctx.lineWidth = 1.2;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(x0, Math.round(y) + 0.5);
            ctx.lineTo(x0 + barWidth, Math.round(y) + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      // Labels: every band for octaves, every third for third-octaves.
      ctx.font = compact ? '8px system-ui, sans-serif' : '9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelEvery = bands.length > 15 ? 3 : 1;
      for (let i = 0; i < bands.length; i++) {
        if (i % labelEvery !== 0 && i !== active) continue;
        const cx = area.left + slot * (i + 0.5);
        ctx.fillStyle = i === active ? theme.text : theme.faint;
        ctx.fillText(bands[i].label, cx, area.bottom + 3);
      }

      if (active !== null && active >= 0 && active < bands.length) {
        const cx = area.left + slot * (active + 0.5);
        ctx.strokeStyle = theme.text;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(Math.round(cx) + 0.5, area.top);
        ctx.lineTo(Math.round(cx) + 0.5, area.bottom);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },
    [bands, values, overlays, padding, calibration, corrections, mode, range, compact, active]
  );

  const { canvasRef, containerRef, size, invalidate } = useCanvas(draw);

  useEffect(() => {
    invalidate();
  }, [invalidate, values, overlays, active, range, mode]);

  const pick = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const area = plotArea({ width: rect.width, height: rect.height, dpr: 1 }, padding);
      const x = event.clientX - rect.left;
      if (x < area.left || x > area.right || bands.length === 0) return;
      const index = Math.max(
        0,
        Math.min(bands.length - 1, Math.floor(((x - area.left) / area.width) * bands.length))
      );
      setHoverIndex(index);
      onSelectBand?.(index);
    },
    [bands.length, padding, onSelectBand]
  );

  const activeIndex = active;
  const activeBand = activeIndex !== null ? bands[activeIndex] : null;

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
          aria-label="Octave band levels"
        />
      </div>

      {activeBand ? (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1 text-[11px]">
          <span className="font-semibold text-ink">
            {activeBand.label} Hz
          </span>
          <span className="tnum text-faint">
            {formatFrequency(activeBand.lower)}&ndash;{formatFrequency(activeBand.upper)}
          </span>
          <span className="tnum">
            <span className="text-faint">now </span>
            <span className="text-accent">
              {values && Number.isFinite(values[activeIndex!])
                ? formatLevel(values[activeIndex!])
                : NO_VALUE}
            </span>
          </span>
          <span className="tnum">
            <span className="text-faint">Leq </span>
            <span className="text-warn">
              {overlays?.leq && Number.isFinite(overlays.leq[activeIndex!])
                ? formatLevel(overlays.leq[activeIndex!])
                : NO_VALUE}
            </span>
          </span>
          <span className="tnum">
            <span className="text-faint">max </span>
            <span className="text-bad">
              {overlays?.max && Number.isFinite(overlays.max[activeIndex!])
                ? formatLevel(overlays.max[activeIndex!])
                : NO_VALUE}
            </span>
          </span>
          {!activeBand.available && activeBand.unavailableReason ? (
            <span className="w-full text-warn">{activeBand.unavailableReason}</span>
          ) : null}
          {calibration.frequencyCorrectionEnabled && !corrections.calibrated[activeIndex!] ? (
            <span className="w-full text-violet">
              Outside the calibrated frequency range: the correction here is held flat at the nearest
              measured value.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
