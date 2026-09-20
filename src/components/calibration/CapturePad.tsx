'use client';

/**
 * Shared capture control used by all three calibration wizards.
 *
 * Shows the live phone level, runs a timed energy-averaged capture, and reports
 * the stability of the window so an unusable capture can be rejected rather than
 * quietly turned into a calibration point.
 */

import { formatLevel, NO_VALUE } from '@/lib/format';
import { TIME_WEIGHTING_LABELS, type TimeWeightingId } from '@/dsp/timeWeighting';
import type { WeightingId } from '@/dsp/weighting/reference';
import {
  CAPTURE_STABILITY_LIMIT_DB,
  CAPTURE_WINDOWS,
  type LevelCaptureState,
} from './useLevelCapture';
import { Badge, Button, ControlRow, cx } from '@/components/ui/primitives';

export function CapturePad({
  capture,
  weighting,
  timeWeighting,
  windowSeconds,
  onWindowChange,
  disabled,
}: {
  capture: LevelCaptureState;
  weighting: WeightingId;
  timeWeighting: TimeWeightingId;
  windowSeconds: number;
  onWindowChange: (seconds: number) => void;
  disabled?: boolean;
}) {
  const { live, remaining, result, start, cancel } = capture;
  const active = remaining !== null;
  const progress =
    active && windowSeconds > 0 ? 1 - Math.max(0, remaining!) / windowSeconds : 0;

  return (
    <div className="panel-sunken p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label label-strong">
            Phone level &middot; {weighting} {TIME_WEIGHTING_LABELS[timeWeighting]}
          </div>
          <div className="readout mt-0.5 text-3xl font-semibold text-ink">
            {Number.isFinite(live) ? formatLevel(live, 2) : NO_VALUE}
            <span className="ml-1 text-xs font-normal text-faint">dBFS</span>
          </div>
        </div>
        {result ? (
          <div className="text-right">
            <div className="label label-strong">Captured</div>
            <div className="readout mt-0.5 text-2xl font-semibold text-accent">
              {formatLevel(result.levelDbfs, 2)}
              <span className="ml-1 text-xs font-normal text-faint">dBFS</span>
            </div>
            <Badge tone={result.stable ? 'good' : 'warn'} className="mt-1">
              {result.stable ? 'stable' : `range ${result.rangeDb.toFixed(1)} dB`}
            </Badge>
          </div>
        ) : null}
      </div>

      {active ? (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-panel">
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px]">
            <span className="tnum text-accent">
              Averaging&hellip; {remaining!.toFixed(1)} s left
            </span>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <ControlRow>
            {CAPTURE_WINDOWS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                onClick={() => onWindowChange(seconds)}
                aria-pressed={windowSeconds === seconds}
                className={cx(
                  'touch shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold',
                  windowSeconds === seconds
                    ? 'border-accent/60 bg-accent/20 text-accent'
                    : 'border-line bg-panel text-muted'
                )}
              >
                {seconds} s
              </button>
            ))}
          </ControlRow>
          <Button
            variant="accent"
            size="md"
            className="w-full"
            disabled={disabled || !Number.isFinite(live)}
            onClick={() => start(windowSeconds)}
          >
            Capture {windowSeconds} s average
          </Button>
        </div>
      )}

      {result && !result.stable ? (
        <p className="mt-2 text-[11px] leading-relaxed text-warn">
          The level moved {result.rangeDb.toFixed(1)} dB during the capture, more than the{' '}
          {CAPTURE_STABILITY_LIMIT_DB.toFixed(1)} dB stability limit. A calibration built on an
          unstable capture will carry that uncertainty. Use a steadier source, hold the geometry
          fixed, or capture over a longer window.
        </p>
      ) : null}

      {result ? (
        <p className="mt-1.5 text-[11px] text-faint">
          Energy average of {result.samples} samples over {result.windowSeconds} s, range{' '}
          {formatLevel(result.min, 1)} to {formatLevel(result.max, 1)} dBFS.
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Start the reference instrument measuring at the same moment, then capture. The value used
          is the energy average over the window, computed the same way as Leq &mdash; not a single
          instantaneous reading.
        </p>
      )}
    </div>
  );
}
