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
import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import { TIME_WEIGHTING_LABELS } from '@/dsp/timeWeighting';
import { formatDateTime, formatDuration, formatLevel, isMeasurable, NO_VALUE } from '@/lib/format';
import type { MeasurementStamp } from '@/lib/imageStamp';
import { captureVideoFrame, useCamera } from '@/lib/useCamera';
import { savePhoto, deletePhoto } from '@/storage/photoStore';
import type { PhotoRecord } from '@/storage/types';
import { useCalibration } from '@/state/CalibrationProvider';
import { useMetrics } from '@/state/EngineProvider';
import { useMeasurement } from '@/state/MeasurementProvider';
import { useSettings } from '@/state/SettingsProvider';
import {
  Badge,
  Banner,
  Button,
  Panel,
  PanelHeader,
  Spinner,
  Toggle,
  cx,
} from '@/components/ui/primitives';
import { selectLevel } from './BigLevel';

interface Capture {
  record: PhotoRecord;
  /** Object URL for the thumbnail, revoked when the capture goes away. */
  url: string;
}

export function CameraPanel() {
  const { state: measurementState, elapsedSeconds, sessionName, activeSessionId } = useMeasurement();
  const { state: cameraState, error: cameraError, facing, stream, start, stop, switchCamera, fail } =
    useCamera();
  const { settings } = useSettings();
  const { calibration } = useCalibration();
  // Same rate as the main read-out: fast enough to feel live, slow enough to read.
  const snapshot = useMetrics(100);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [open, setOpen] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [busy, setBusy] = useState(false);
  const [stampPhotos, setStampPhotos] = useState(true);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  /**
   * The overlaid read-out is derived with the same helpers as the big level, not
   * recomputed. Two code paths producing "the level" would eventually disagree, and
   * a number burned into a photograph has to be the number the meter was showing.
   */
  const rawLevel = selectLevel(snapshot, settings.weighting, settings.timeWeighting);
  const measurable = Number.isFinite(rawLevel) && rawLevel > LEVEL_FLOOR_DB;
  const displayLevel = measurable ? calibration.toDisplay(rawLevel) : NaN;
  const unit = calibration.levelUnit(settings.weighting);
  const detector = `${settings.weighting} \u00b7 ${TIME_WEIGHTING_LABELS[settings.timeWeighting]}`;
  const levelText = measurable ? displayLevel.toFixed(settings.levelDecimals) : NO_VALUE;

  /**
   * Leq and the maximum are only shown once something has actually been integrated,
   * matching the metrics beside the main read-out. During the warm-up the engine
   * reports a floor value, and a floor value printed onto a photograph would be read
   * later as a measurement of a very quiet room.
   */
  const integrating =
    measurementState === 'measuring' ||
    measurementState === 'paused' ||
    measurementState === 'stopped';
  const hasIntegrated = integrating && (snapshot?.integratedSamples ?? 0) > 0;
  const leq = hasIntegrated && snapshot ? calibration.toDisplay(snapshot.LAeq) : NaN;
  const maxLevel = hasIntegrated && snapshot ? calibration.toDisplay(snapshot.LAFmax) : NaN;

  /** What gets burned into the file, when stamping is on. */
  const buildStamp = useCallback(
    (): MeasurementStamp => ({
      primary: `${levelText} ${unit}`,
      secondary: [
        detector,
        isMeasurable(leq) ? `LAeq ${formatLevel(leq)} ${unit}` : '',
        isMeasurable(maxLevel) ? `max ${formatLevel(maxLevel)} ${unit}` : '',
        // The elapsed time travels with Leq: an energy average over two seconds and
        // one over ten minutes are not the same claim, and the photograph is the only
        // place this stamp will be read.
        integrating ? `t ${formatDuration(elapsedSeconds)}` : '',
        formatDateTime(Date.now()),
        sessionName,
      ],
      warning: calibration.isCalibrated
        ? null
        : 'UNCALIBRATED \u2014 digital full scale, not sound pressure level',
    }),
    [
      levelText,
      unit,
      detector,
      leq,
      maxLevel,
      integrating,
      elapsedSeconds,
      sessionName,
      calibration.isCalibrated,
    ]
  );

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
      const shot = await captureVideoFrame(video, stampPhotos ? buildStamp() : null);
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
  }, [
    activeSessionId,
    buildStamp,
    captures.length,
    elapsedSeconds,
    facing,
    measurementState,
    sessionName,
    stampPhotos,
  ]);

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
        hint="The live level over the picture, so the reading and what is making it are in one view"
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
              <>
                <span className="absolute top-2 left-2">
                  <Badge tone="info">
                    {facing === 'user'
                      ? 'front camera'
                      : facing === 'environment'
                        ? 'rear camera'
                        : 'camera live'}
                  </Badge>
                </span>

                {/*
                  The read-out sits over the picture, which is the whole point of a
                  viewfinder: the level and the thing making it are in one view. The
                  scrim behind it is what keeps the digits legible against a bright
                  factory ceiling or a dark machine cavity.
                */}
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/55 to-transparent px-3 pt-8 pb-3.5"
                  aria-hidden="true"
                >
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold tracking-wider text-white/70 uppercase">
                        {detector}
                      </div>
                      <div className="flex items-end gap-1.5">
                        <span
                          className={cx(
                            'readout text-[13vw] leading-none font-semibold tabular-nums sm:text-[64px]',
                            calibration.isCalibrated ? 'text-white' : 'text-warn'
                          )}
                        >
                          {levelText}
                        </span>
                        <span className="pb-1 text-sm font-medium text-white/80">{unit}</span>
                      </div>
                    </div>
                    <div className="shrink-0 space-y-0.5 text-right text-[10px] tabular-nums text-white/75">
                      {isMeasurable(leq) ? <div>LAeq {formatLevel(leq)}</div> : null}
                      {isMeasurable(maxLevel) ? <div>max {formatLevel(maxLevel)}</div> : null}
                      {measurementState === 'measuring' || measurementState === 'paused' ? (
                        <div>{formatDuration(elapsedSeconds)}</div>
                      ) : null}
                    </div>
                  </div>
                  {!calibration.isCalibrated ? (
                    <div className="mt-1 text-[10px] leading-snug font-semibold text-warn">
                      UNCALIBRATED &mdash; digital full scale, not sound pressure level
                    </div>
                  ) : null}
                </div>
              </>
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

          <Toggle
            label="Print the reading onto the photo"
            description="Burns the level, detector, Leq, max, time and the uncalibrated warning into the image itself, so the file still means something on its own."
            checked={stampPhotos}
            onChange={setStampPhotos}
          />

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
            The overlaid figures are the same ones the meter is showing, read from the
            same snapshot, and the stamp records the unit and the calibration state with
            them. The camera is a separate video-only stream; the microphone is never
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
