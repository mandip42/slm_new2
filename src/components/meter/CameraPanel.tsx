'use client';

/**
 * Camera panel on the meter screen.
 *
 * Answers the question a level on its own cannot: where was the phone, and
 * pointing at what. The preview is the aiming aid; the captured stills are what
 * survive, attached to the measurement and reproduced in its report.
 *
 * The camera is off until asked for. Nothing here opens a capture device by
 * itself, and the panel states what it is doing at every step.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDuration } from '@/lib/format';
import { captureVideoFrame, useCamera } from '@/lib/useCamera';
import { savePhoto, deletePhoto } from '@/storage/photoStore';
import type { PhotoRecord } from '@/storage/types';
import { useMeasurement } from '@/state/MeasurementProvider';
import { Badge, Banner, Button, Panel, PanelHeader, Spinner } from '@/components/ui/primitives';

interface Capture {
  record: PhotoRecord;
  /** Object URL for the thumbnail, revoked when the capture goes away. */
  url: string;
}

export function CameraPanel() {
  const { state: measurementState, elapsedSeconds, sessionName, activeSessionId } = useMeasurement();
  const { state: cameraState, error: cameraError, facing, stream, start, stop, switchCamera, fail } =
    useCamera();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [open, setOpen] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  /**
   * Object URLs are revoked explicitly. A blob URL keeps its blob alive for as long
   * as the document lives, so leaving them behind would pin every photo taken in
   * this session in memory.
   */
  const urlsRef = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    },
    []
  );

  // Attach the stream to the element. Done in an effect because it mutates the DOM.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (!stream) return;

    // Autoplay is permitted for a muted stream opened by a user gesture. A
    // rejection is surfaced rather than swallowed: a black rectangle with no
    // explanation is worse than an error message.
    video.play().catch((caught: unknown) => {
      fail(
        caught instanceof Error
          ? `The preview could not start: ${caught.message}`
          : 'The preview could not start.'
      );
    });

    const [track] = stream.getVideoTracks();
    const onEnded = () => fail('The camera stopped. Another app may have taken it.');
    track?.addEventListener('ended', onEnded);
    return () => track?.removeEventListener('ended', onEnded);
  }, [stream, fail]);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    setMessage(null);
    try {
      const shot = await captureVideoFrame(video);
      if (!shot) {
        setMessage({ tone: 'bad', text: 'No frame was available yet. Give the preview a moment.' });
        return;
      }
      const record = await savePhoto({
        blob: shot.blob,
        sessionId: activeSessionId,
        atSeconds: measurementState === 'measuring' ? elapsedSeconds : null,
        name: `${sessionName} photo ${captures.length + 1}`,
        width: shot.width,
        height: shot.height,
        facing: facing === 'unknown' ? 'unknown' : facing,
      });
      const url = URL.createObjectURL(shot.blob);
      urlsRef.current = [...urlsRef.current, url];
      setCaptures((current) => [...current, { record, url }]);
      setMessage({
        tone: 'good',
        text: activeSessionId
          ? `Saved ${record.name}, attached to this measurement.`
          : `Saved ${record.name}. No measurement has been started, so it is not attached to one.`,
      });
    } catch (error) {
      setMessage({
        tone: 'bad',
        text:
          error instanceof Error
            ? `The photo could not be saved: ${error.message}`
            : 'The photo could not be saved to local storage.',
      });
    } finally {
      setBusy(false);
    }
  }, [activeSessionId, captures.length, elapsedSeconds, facing, measurementState, sessionName]);

  const handleDelete = useCallback(async (capture: Capture) => {
    await deletePhoto(capture.record.id).catch(() => undefined);
    URL.revokeObjectURL(capture.url);
    urlsRef.current = urlsRef.current.filter((url) => url !== capture.url);
    setCaptures((current) => current.filter((item) => item.record.id !== capture.record.id));
  }, []);

  const live = cameraState === 'live';
  const measuring = measurementState === 'measuring' || measurementState === 'paused';

  return (
    <Panel>
      <PanelHeader
        title="Camera"
        hint="Show where the measurement is being taken, and keep the picture with it"
        action={
          <Button
            size="sm"
            variant={open ? 'default' : 'ghost'}
            onClick={() => {
              if (open) stop();
              setOpen(!open);
            }}
          >
            {open ? 'Hide' : 'Show camera'}
          </Button>
        }
      />

      {open ? (
        <div className="space-y-2.5">
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-panel-sunken">
            {/*
              Muted and inline: a muted inline stream is allowed to autoplay, and
              without playsInline Android and iOS take the preview fullscreen.
            */}
            <video
              ref={videoRef}
              aria-label="Camera preview"
              muted
              playsInline
              autoPlay
              className="h-full w-full object-cover"
            />
            {!live ? (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
                {cameraState === 'starting' ? (
                  <Spinner label="Opening the camera" />
                ) : (
                  <p className="text-xs leading-relaxed text-faint">
                    The camera is off. Nothing is captured until you start it.
                  </p>
                )}
              </div>
            ) : (
              <span className="absolute top-2 left-2">
                <Badge tone="info">
                  {facing === 'user'
                    ? 'front camera'
                    : facing === 'environment'
                      ? 'rear camera'
                      : 'camera live'}
                </Badge>
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {live ? (
              <>
                <Button
                  size="sm"
                  variant="accent"
                  disabled={busy}
                  onClick={() => void handleCapture()}
                >
                  {busy ? 'Saving\u2026' : 'Capture photo'}
                </Button>
                <Button size="sm" onClick={() => void switchCamera()}>
                  Switch camera
                </Button>
                <Button size="sm" variant="ghost" onClick={stop}>
                  Stop camera
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={cameraState === 'starting'}
                onClick={() => void start()}
              >
                Start camera
              </Button>
            )}
          </div>

          {cameraError ? <Banner tone="bad">{cameraError}</Banner> : null}
          {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

          {captures.length > 0 ? (
            <div>
              <p className="label label-strong mb-1.5">Captured in this session</p>
              <ul className="grid grid-cols-3 gap-2">
                {captures.map((capture) => (
                  <li key={capture.record.id} className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL for a photo held in IndexedDB; next/image cannot process an object URL */}
                    <img
                      src={capture.url}
                      alt={`Measurement position: ${capture.record.name}`}
                      className="aspect-square w-full rounded border border-line object-cover"
                    />
                    <p className="truncate text-[10px] text-faint" title={capture.record.name}>
                      {capture.record.atSeconds !== null
                        ? `at ${formatDuration(capture.record.atSeconds)}`
                        : 'no measurement'}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      ariaLabel={`Delete ${capture.record.name}`}
                      onClick={() => void handleDelete(capture)}
                    >
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-faint">
            The camera is a separate video-only stream; the microphone is never
            re-requested, so opening it cannot change the audio processing the
            measurement depends on. Photos are named after the measurement and can be
            renamed and downloaded from the session screen. They stay on this device.
            {measuring
              ? ' If DROP appears in the status bar while the camera is running, stop the camera: the measurement matters more than the picture.'
              : ''}
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
