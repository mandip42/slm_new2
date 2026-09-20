'use client';

/**
 * Surfaces acquisition problems in plain language with a concrete next step.
 *
 * Every case in the list is one that genuinely happens on Android Chrome: a
 * suspended context after a screen lock, a revoked permission, a headset being
 * unplugged, or another app grabbing the microphone.
 */

import { Banner, Button } from '@/components/ui/primitives';
import { useEngineContext } from '@/state/EngineProvider';

export function EngineErrorBanner() {
  const { status, engine, start, starting } = useEngineContext();

  if (status.state === 'suspended' && status.contextState === 'suspended') {
    return (
      <div className="mb-3">
        <Banner
          tone="warn"
          title="Audio is suspended"
          action={
            <Button size="sm" variant="accent" onClick={() => void engine.resumeContext()}>
              Resume audio
            </Button>
          }
        >
          The browser suspended the audio engine, which happens after a screen lock or when the tab
          is backgrounded. No samples are being measured while it is suspended, so the elapsed
          measurement time has stopped rather than filling with silence.
        </Banner>
      </div>
    );
  }

  const error = status.error;
  if (!error) return null;

  const recoverable =
    error.code === 'device-in-use' || error.code === 'permission-denied' || !error.code;

  return (
    <div className="mb-3">
      <Banner
        tone="bad"
        title={titleFor(error.code)}
        action={
          recoverable ? (
            <Button size="sm" variant="accent" disabled={starting} onClick={() => void start()}>
              {starting ? 'Opening\u2026' : 'Try again'}
            </Button>
          ) : undefined
        }
      >
        {error.message}
        {error.code === 'permission-denied' ? (
          <span className="mt-1 block text-muted">
            In Chrome on Android: tap the padlock or the icon left of the address bar, choose
            Permissions, and allow Microphone. Then reload.
          </span>
        ) : null}
      </Banner>
    </div>
  );
}

function titleFor(code: string | undefined): string {
  switch (code) {
    case 'permission-denied':
      return 'Microphone permission required';
    case 'device-in-use':
      return 'Microphone unavailable';
    case 'no-device':
      return 'No audio input found';
    case 'insecure-context':
      return 'HTTPS required';
    case 'worklet-unsupported':
      return 'Browser not supported';
    case 'analysis':
    case 'analysis-worker':
      return 'Analysis stopped';
    case 'muted':
      return 'Microphone muted';
    default:
      return 'Measurement problem';
  }
}
