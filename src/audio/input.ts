/**
 * Audio input abstraction.
 *
 *     AudioInputSource  ->  DeviceInput     (getUserMedia: built-in or USB mic)
 *                       ->  SyntheticInput  (generated signal, for the DSP lab
 *                                            and for automated tests)
 *
 * The DSP pipeline only ever sees an AudioNode from this layer, so adding
 * support for a USB-C measurement microphone or an audio interface is a matter
 * of selecting a different deviceId — no DSP change and no new code path.
 */

import { generateSignal, type SignalSpec } from '@/dsp/signals';
import { buildDiagnostics, type InputDiagnostics } from './diagnostics';

export class AudioInputError extends Error {
  constructor(
    message: string,
    readonly code: AudioInputErrorCode,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AudioInputError';
  }
}

export type AudioInputErrorCode =
  | 'permission-denied'
  | 'no-device'
  | 'device-in-use'
  | 'insecure-context'
  | 'unsupported'
  | 'worklet-unsupported'
  | 'unknown';

/** Translate a getUserMedia rejection into something a human can act on. */
export function classifyMediaError(error: unknown): AudioInputError {
  const name = (error as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new AudioInputError(
        'Microphone permission was denied. AcousticLab cannot measure without microphone access. Grant permission in the browser site settings and try again.',
        'permission-denied',
        error
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new AudioInputError(
        'No usable audio input device was found.',
        'no-device',
        error
      );
    case 'NotReadableError':
    case 'AbortError':
      return new AudioInputError(
        'The microphone could not be opened. Another application may be using it. Close other apps that use the microphone and try again.',
        'device-in-use',
        error
      );
    default:
      return new AudioInputError(
        `Could not open the microphone: ${(error as Error)?.message ?? String(error)}`,
        'unknown',
        error
      );
  }
}

export interface AudioInputDeviceInfo {
  deviceId: string;
  label: string;
  groupId: string;
  /** Best-effort classification for the UI. */
  kind: 'builtin' | 'external' | 'unknown';
  isDefault: boolean;
}

const EXTERNAL_HINTS = ['usb', 'headset', 'interface', 'external', 'bluetooth', 'dock', 'type-c', 'type c'];

function classifyDevice(label: string): AudioInputDeviceInfo['kind'] {
  const lower = label.toLowerCase();
  if (EXTERNAL_HINTS.some((hint) => lower.includes(hint))) return 'external';
  if (lower.includes('built-in') || lower.includes('internal') || lower.includes('default')) {
    return 'builtin';
  }
  return 'unknown';
}

/**
 * Enumerate audio inputs.
 *
 * Labels are only populated once microphone permission has been granted, so this
 * is normally called after the first successful open.
 */
export async function listAudioInputs(): Promise<AudioInputDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || (index === 0 ? 'Default microphone' : `Audio input ${index + 1}`),
      groupId: d.groupId,
      kind: classifyDevice(d.label),
      isDefault: d.deviceId === 'default' || d.deviceId === '',
    }));
}

export interface AudioInputSource {
  readonly id: string;
  readonly label: string;
  readonly kind: 'device' | 'synthetic';
  /** Create the node that feeds the DSP graph. */
  connect(context: AudioContext): Promise<AudioNode>;
  /** Release hardware and stop tracks. */
  close(): Promise<void>;
  /** What the browser actually delivered. */
  diagnostics(contextSampleRate: number): InputDiagnostics;
}

/** Constraints requested for a measurement-oriented stream. */
export function measurementConstraints(deviceId?: string): MediaStreamConstraints {
  const audio: MediaTrackConstraints = {
    // Every one of these is a *request*. The diagnostics screen reports what was
    // actually honoured.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 48000,
  };
  if (deviceId && deviceId !== 'default') {
    audio.deviceId = { exact: deviceId };
  }
  return { audio, video: false };
}

/** A real microphone (built-in, USB or any other enumerated audio input). */
export class DeviceInput implements AudioInputSource {
  readonly kind = 'device' as const;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private node: MediaStreamAudioSourceNode | null = null;

  constructor(
    readonly id: string = 'default',
    readonly label: string = 'Microphone'
  ) {}

  async connect(context: AudioContext): Promise<AudioNode> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new AudioInputError(
        'This browser does not support microphone capture (navigator.mediaDevices.getUserMedia is unavailable).',
        'unsupported'
      );
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new AudioInputError(
        'Microphone access requires a secure context. Open AcousticLab over HTTPS (or on localhost).',
        'insecure-context'
      );
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(measurementConstraints(this.id));
    } catch (error) {
      // A device-specific request can fail on Android even for a valid id.
      // Fall back to the default device rather than failing outright.
      if (this.id && this.id !== 'default') {
        try {
          stream = await navigator.mediaDevices.getUserMedia(measurementConstraints());
        } catch (fallbackError) {
          throw classifyMediaError(fallbackError);
        }
      } else {
        throw classifyMediaError(error);
      }
    }

    this.stream = stream;
    this.track = stream.getAudioTracks()[0] ?? null;

    // Best effort: some browsers honour applyConstraints even when the initial
    // request was ignored.
    if (this.track?.applyConstraints) {
      try {
        await this.track.applyConstraints({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        });
      } catch {
        // Non-fatal: reported through diagnostics instead.
      }
    }

    this.node = context.createMediaStreamSource(stream);
    return this.node;
  }

  async close(): Promise<void> {
    this.node?.disconnect();
    this.node = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.track = null;
  }

  /** The live track, so callers can watch for `ended` / `mute` events. */
  get mediaStreamTrack(): MediaStreamTrack | null {
    return this.track;
  }

  diagnostics(contextSampleRate: number): InputDiagnostics {
    return buildDiagnostics({
      track: this.track,
      contextSampleRate,
      sourceKind: 'device',
      deviceLabelFallback: this.label,
    });
  }
}

/**
 * A generated signal used as an input.
 *
 * This is what makes the developer DSP lab meaningful: the synthetic signal goes
 * through the identical AudioWorklet, filter bank and FFT that microphone audio
 * goes through, so a level measured here validates the real pipeline.
 */
export class SyntheticInput implements AudioInputSource {
  readonly kind = 'synthetic' as const;
  readonly id = 'synthetic';
  private source: AudioBufferSourceNode | null = null;

  constructor(
    private spec: Omit<SignalSpec, 'sampleRate'>,
    readonly label = 'Synthetic signal'
  ) {}

  setSpec(spec: Omit<SignalSpec, 'sampleRate'>): void {
    this.spec = spec;
  }

  async connect(context: AudioContext): Promise<AudioNode> {
    const sampleRate = context.sampleRate;
    const samples = generateSignal({ ...this.spec, sampleRate });
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    this.source = source;
    return source;
  }

  async close(): Promise<void> {
    try {
      this.source?.stop();
    } catch {
      // Already stopped.
    }
    this.source?.disconnect();
    this.source = null;
  }

  diagnostics(contextSampleRate: number): InputDiagnostics {
    const d = buildDiagnostics({
      track: null,
      contextSampleRate,
      sourceKind: 'synthetic',
      deviceLabelFallback: this.label,
    });
    d.warnings = [
      'Synthetic signal source: these readings validate the DSP chain and are not acoustic measurements.',
    ];
    return d;
  }
}
