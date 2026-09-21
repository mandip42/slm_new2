'use client';

/**
 * Camera stream lifecycle.
 *
 * The stream is requested with `audio: false`, always. Asking for audio and video
 * together would make the browser renegotiate the capture session, and on Android
 * that can silently re-enable automatic gain control or change the input route on
 * the microphone that is in the middle of a measurement. The camera is allowed to
 * fail; the measurement is not allowed to be disturbed by it.
 *
 * The preview resolution is requested modestly for the same reason: the frames are
 * there to show where the phone is pointed, and every pixel decoded competes with
 * the thread that draws the meter.
 *
 * This hook owns the stream and nothing else. The `<video>` element, and therefore
 * frame capture, belongs to the component that renders the preview: a hook that
 * held the element ref would hand a ref-bearing object back to its caller, and
 * every read of that object during render is then indistinguishable from reading a
 * ref mid-render.
 */

import { useCallback, useEffect, useState } from 'react';
import { drawMeasurementStamp, type MeasurementStamp } from './imageStamp';

export type CameraFacing = 'environment' | 'user';

export type CameraState = 'off' | 'starting' | 'live' | 'error';

/** Requested preview size. The browser is free to give something else. */
const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 720;

/**
 * JPEG quality for captures.
 *
 * 0.85 is visually indistinguishable from maximum for a photograph of a machine or
 * a room while being roughly a third of the size, and these files share a storage
 * quota with the measurement data.
 */
const JPEG_QUALITY = 0.85;

export interface CapturedFrame {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Encode the current video frame as a JPEG, optionally with the read-out burned in.
 *
 * Returns null when no frame has arrived yet, which is the normal state for the
 * first moment after the camera opens.
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  stamp?: MeasurementStamp | null
): Promise<CapturedFrame | null> {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  if (stamp) {
    drawMeasurementStamp(context, { width: canvas.width, height: canvas.height }, stamp);
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/jpeg', JPEG_QUALITY);
  });
  if (!blob) return null;
  return { blob, width: canvas.width, height: canvas.height };
}

function describeCameraError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Allow camera access for this site in the browser settings, then try again. The measurement is unaffected.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No usable camera was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera could not be opened. Another app may be using it. Close that app and try again.';
    default:
      return `The camera could not be started: ${(error as Error)?.message ?? String(error)}`;
  }
}

export interface UseCameraResult {
  state: CameraState;
  error: string | null;
  /** Which camera the browser actually gave, once known. */
  facing: CameraFacing | 'unknown';
  /** The live stream, to be attached to a `<video>` by the caller. */
  stream: MediaStream | null;
  start: (facing?: CameraFacing) => Promise<void>;
  stop: () => void;
  switchCamera: () => Promise<void>;
  /** Report a failure noticed while previewing, e.g. the track ending. */
  fail: (message: string) => void;
}

export function useCamera(): UseCameraResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('off');
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<CameraFacing | 'unknown'>('unknown');

  /**
   * Release the camera when the stream is replaced and when the component goes
   * away. React runs this cleanup before the effect for the next stream, so
   * switching cameras cannot leave the previous one running, and the camera
   * indicator in the status bar goes out as soon as the preview is closed.
   */
  useEffect(() => {
    if (!stream) return;
    return () => {
      for (const track of stream.getTracks()) track.stop();
    };
  }, [stream]);

  const start = useCallback(async (requested: CameraFacing = 'environment'): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setError('This browser does not support camera capture.');
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setState('error');
      setError('Camera access requires a secure context. Open Sonoscope over HTTPS or on localhost.');
      return;
    }

    setState('starting');
    setError(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        video: {
          // `ideal` rather than `exact`: a device with only a front camera should
          // still give a preview instead of failing outright.
          facingMode: { ideal: requested },
          width: { ideal: PREVIEW_WIDTH },
          height: { ideal: PREVIEW_HEIGHT },
        },
        audio: false,
      });
      const actual = next.getVideoTracks()[0]?.getSettings().facingMode;
      setFacing(actual === 'environment' || actual === 'user' ? actual : 'unknown');
      setStream(next);
      setState('live');
    } catch (caught) {
      setState('error');
      setError(describeCameraError(caught));
    }
  }, []);

  const stop = useCallback(() => {
    // The tracks are stopped by the cleanup above when the stream clears.
    setStream(null);
    setState('off');
    setError(null);
  }, []);

  const switchCamera = useCallback(async (): Promise<void> => {
    await start(facing === 'environment' ? 'user' : 'environment');
  }, [facing, start]);

  const fail = useCallback((message: string) => {
    setState('error');
    setError(message);
  }, []);

  return { state, error, facing, stream, start, stop, switchCamera, fail };
}
