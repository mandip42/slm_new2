'use client';

/**
 * START / PAUSE / STOP and the weighting selectors.
 *
 * Measurement control is separate from microphone control on purpose: the meter
 * shows a live level as soon as the microphone is open, and START begins an
 * *integrating session* (Leq, max, min, percentiles, exposure). Conflating the
 * two is what makes most phone meters impossible to use for a real measurement.
 */

import { useState } from 'react';
import { TIME_WEIGHTING_IDS, TIME_WEIGHTING_LABELS } from '@/dsp/timeWeighting';
import { WEIGHTING_IDS } from '@/dsp/weighting/reference';
import { formatDuration } from '@/lib/format';
import { useEngineContext } from '@/state/EngineProvider';
import { useMeasurement } from '@/state/MeasurementProvider';
import { useSettings } from '@/state/SettingsProvider';
import {
  Banner,
  Button,
  ControlRow,
  SegmentedControl,
  cx,
} from '@/components/ui/primitives';

export function MeasurementControls() {
  const { settings, update } = useSettings();
  const { status } = useEngineContext();
  const {
    state,
    elapsedSeconds,
    start,
    pause,
    resume,
    stop,
    recording,
    startRecording,
    stopRecording,
    saveError,
  } = useMeasurement();
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);

  const inputReady = status.state === 'running' || status.state === 'suspended';
  const measuring = state === 'measuring';
  const paused = state === 'paused';

  const handleStop = async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      // Requiring a second tap makes an accidental stop unlikely; it clears
      // itself so the button never gets stuck in a confirming state.
      setTimeout(() => setConfirmStop(false), 4000);
      return;
    }
    setConfirmStop(false);
    setBusy(true);
    try {
      await stop();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <ControlRow>
        <SegmentedControl
          label="Frequency weighting"
          options={WEIGHTING_IDS.map((id) => ({
            value: id,
            label: id,
            title:
              id === 'A'
                ? 'A weighting: approximates human hearing sensitivity'
                : id === 'C'
                  ? 'C weighting: nearly flat, used for peak and low-frequency content'
                  : 'Z weighting: unweighted, flat 10 Hz to 20 kHz',
          }))}
          value={settings.weighting}
          onChange={(weighting) => update({ weighting })}
        />
        <SegmentedControl
          label="Time weighting"
          options={TIME_WEIGHTING_IDS.map((id) => ({
            value: id,
            label: TIME_WEIGHTING_LABELS[id],
            disabled: id === 'I' && settings.weighting !== 'A',
            title:
              id === 'F'
                ? 'Fast: 125 ms time constant'
                : id === 'S'
                  ? 'Slow: 1 s time constant'
                  : 'Impulse: 35 ms rise, 2.9 dB/s decay (A weighting only)',
          }))}
          value={settings.timeWeighting}
          onChange={(timeWeighting) => update({ timeWeighting })}
        />
      </ControlRow>

      <div className="flex items-stretch gap-2">
        {!measuring && !paused ? (
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!inputReady}
            onClick={start}
          >
            START MEASUREMENT
          </Button>
        ) : (
          <>
            <Button
              variant={paused ? 'primary' : 'default'}
              size="lg"
              className="flex-1"
              onClick={paused ? resume : pause}
            >
              {paused ? 'RESUME' : 'PAUSE'}
            </Button>
            <Button
              variant="danger"
              size="lg"
              className="flex-1"
              disabled={busy}
              onClick={() => void handleStop()}
            >
              {busy ? 'SAVING\u2026' : confirmStop ? 'TAP TO CONFIRM' : 'STOP'}
            </Button>
          </>
        )}
      </div>

      {measuring || paused ? (
        <div className="flex items-center justify-between px-1 text-[11px]">
          <span className={cx('tnum font-semibold', paused ? 'text-warn' : 'text-ok')}>
            {paused ? 'PAUSED' : 'MEASURING'} &middot; {formatDuration(elapsedSeconds)}
          </span>
          {settings.recordingEnabled ? (
            <Button
              size="sm"
              variant={recording ? 'danger' : 'ghost'}
              onClick={recording ? stopRecording : startRecording}
            >
              {recording ? 'Stop audio recording' : 'Record audio'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {paused ? (
        <Banner tone="warn">
          Paused. No time and no sound energy accumulate while paused, so Leq and the elapsed
          duration are unaffected by the gap.
        </Banner>
      ) : null}

      {!inputReady ? (
        <Banner tone="info">
          Open the microphone before starting a measurement. Levels appear as soon as the input is
          live.
        </Banner>
      ) : null}

      {saveError ? <Banner tone="bad">{saveError}</Banner> : null}
    </div>
  );
}
