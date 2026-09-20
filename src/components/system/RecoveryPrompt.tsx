'use client';

/**
 * Offers recovery of a measurement that was interrupted.
 *
 * The session is already saved: autosave wrote it every five seconds while it
 * was running. This prompt exists so the user knows it survived and can decide
 * whether to keep it, rather than discovering an orphaned record later.
 */

import Link from 'next/link';
import { formatDateTime, formatDurationWords, formatLevel } from '@/lib/format';
import { Banner, Button } from '@/components/ui/primitives';
import { useMeasurement } from '@/state/MeasurementProvider';

export function RecoveryPrompt() {
  const { recoverable, dismissRecovery, state } = useMeasurement();

  // Never interrupt a running measurement with a prompt about an old one.
  if (state === 'measuring' || state === 'paused') return null;
  if (recoverable.length === 0) return null;

  const session = recoverable[0];
  const unit = session.summary.calibrated ? 'dB' : 'dBFS';

  return (
    <div className="mb-3">
      <Banner
        tone="info"
        title="Interrupted measurement recovered"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={`/sessions?id=${encodeURIComponent(session.id)}`}>
              <Button size="sm" variant="accent">
                Open it
              </Button>
            </Link>
            <Button size="sm" variant="ghost" onClick={() => void dismissRecovery(session.id)}>
              Keep and dismiss
            </Button>
            {recoverable.length > 1 ? (
              <Link href="/sessions">
                <Button size="sm" variant="ghost">
                  {recoverable.length - 1} more
                </Button>
              </Link>
            ) : null}
          </div>
        }
      >
        <span className="text-ink">{session.name}</span> was still running when AcousticLab last
        closed. It was autosaved with {formatDurationWords(session.durationSeconds)} of data
        (LAeq {formatLevel(session.summary.LAeq)} {unit}), started{' '}
        {formatDateTime(session.startedAt)}. It is marked as incomplete everywhere it appears,
        because the moments right before the interruption may be missing.
      </Banner>
    </div>
  );
}
