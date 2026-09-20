'use client';

/**
 * Microphone start gate.
 *
 * getUserMedia needs a user gesture and an explanation. This screen states what
 * will be requested, what happens to the audio, and what the browser is allowed
 * to do to it, before anything is opened.
 */

import { useEffect } from 'react';
import { Banner, Button, Panel, Spinner } from '@/components/ui/primitives';
import { useEngineContext } from '@/state/EngineProvider';

export function InputGate() {
  const { status, start, starting, permission, devices, refreshDevices } = useEngineContext();

  useEffect(() => {
    if (status.state === 'running') void refreshDevices();
  }, [status.state, refreshDevices]);

  if (status.state === 'running' || status.state === 'suspended') return null;

  return (
    <Panel className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Open the microphone to measure</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          AcousticLab requests a measurement-oriented audio stream with echo cancellation, noise
          suppression and automatic gain control switched off, mono, at 48 kHz. Browsers are free to
          ignore any of that, so what was actually granted is reported on the diagnostics screen and
          in the status bar.
        </p>
      </div>

      <Banner tone="info" title="Microphone audio is processed locally on this device">
        Audio never leaves your phone. All filtering, spectrum analysis and statistics run in your
        browser, and nothing is uploaded. Audio is only written to storage if you explicitly enable
        recording.
      </Banner>

      {permission === 'denied' ? (
        <Banner tone="bad" title="Microphone blocked">
          This site is currently blocked from using the microphone. In Chrome on Android, tap the
          icon to the left of the address bar, open Permissions and allow Microphone, then reload.
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="lg" disabled={starting} onClick={() => void start()}>
          {starting ? <Spinner label="Opening microphone" /> : 'Open microphone'}
        </Button>
        {devices.length > 1 ? (
          <span className="text-[11px] text-faint">
            {devices.length} inputs available &mdash; choose one on the diagnostics screen
          </span>
        ) : null}
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        A smartphone microphone does not inherently measure calibrated dB SPL. Until you calibrate
        against a reference instrument, AcousticLab shows digital full-scale levels (dBFS) and says
        so on every screen.
      </p>
    </Panel>
  );
}
