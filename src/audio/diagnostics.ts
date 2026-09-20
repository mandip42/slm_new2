/**
 * Honest reporting of what the browser actually gave us.
 *
 * AcousticLab *requests* a measurement-grade stream (no echo cancellation, no
 * noise suppression, no automatic gain control, mono, 48 kHz). Browsers and
 * Android audio HALs are free to ignore any of that. This module inspects the
 * MediaStreamTrack after the fact and reports the real settings, so the UI can
 * warn the user instead of pretending the stream is clean.
 */

export interface ProcessingFlagState {
  /** What we asked for. */
  requested: boolean;
  /** What the track reports, or null when the browser does not expose it. */
  actual: boolean | null;
  /** True when the browser exposes the constraint as controllable at all. */
  supported: boolean;
}

export interface InputDiagnostics {
  /** Human readable device label, when permission allows it. */
  deviceLabel: string;
  deviceId: string | null;
  groupId: string | null;
  /** Sample rate reported by the track, or null when unavailable. */
  trackSampleRate: number | null;
  /** Sample rate the AudioContext actually runs at — this is what the DSP uses. */
  contextSampleRate: number;
  channelCount: number | null;
  latencySeconds: number | null;
  autoGainControl: ProcessingFlagState;
  echoCancellation: ProcessingFlagState;
  noiseSuppression: ProcessingFlagState;
  /** Track readyState / muted / enabled. */
  trackState: { readyState: string; muted: boolean; enabled: boolean } | null;
  userAgent: string;
  platform: string;
  /** Whether the page is running in a secure context (required for getUserMedia). */
  secureContext: boolean;
  audioWorkletSupported: boolean;
  /** True when any requested processing flag could not be turned off. */
  processingSuspected: boolean;
  /** Short list of concrete concerns, ready to show to the user. */
  warnings: string[];
  /** Source kind, for the future external-microphone path. */
  sourceKind: 'device' | 'synthetic';
}

const REQUESTED_FLAGS = {
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
} as const;

function flagState(
  name: keyof typeof REQUESTED_FLAGS,
  settings: MediaTrackSettings | null,
  supportedConstraints: MediaTrackSupportedConstraints | null
): ProcessingFlagState {
  const raw = settings ? (settings as Record<string, unknown>)[name] : undefined;
  return {
    requested: REQUESTED_FLAGS[name],
    actual: typeof raw === 'boolean' ? raw : null,
    supported: Boolean(supportedConstraints?.[name]),
  };
}

/**
 * Read a numeric MediaTrackSettings field that is not in the TypeScript DOM
 * types but is reported by some browsers (for example `latency`).
 */
function readOptionalNumber(settings: MediaTrackSettings | null, key: string): number | null {
  const value = settings ? (settings as Record<string, unknown>)[key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface BuildDiagnosticsInput {
  track: MediaStreamTrack | null;
  contextSampleRate: number;
  sourceKind: 'device' | 'synthetic';
  deviceLabelFallback?: string;
}

export function buildDiagnostics({
  track,
  contextSampleRate,
  sourceKind,
  deviceLabelFallback,
}: BuildDiagnosticsInput): InputDiagnostics {
  const settings = track?.getSettings?.() ?? null;
  const supportedConstraints =
    typeof navigator !== 'undefined' && navigator.mediaDevices?.getSupportedConstraints
      ? navigator.mediaDevices.getSupportedConstraints()
      : null;

  const autoGainControl = flagState('autoGainControl', settings, supportedConstraints);
  const echoCancellation = flagState('echoCancellation', settings, supportedConstraints);
  const noiseSuppression = flagState('noiseSuppression', settings, supportedConstraints);

  const warnings: string[] = [];
  const flags: Array<[string, ProcessingFlagState]> = [
    ['Automatic gain control', autoGainControl],
    ['Echo cancellation', echoCancellation],
    ['Noise suppression', noiseSuppression],
  ];

  let processingSuspected = false;
  for (const [label, flag] of flags) {
    if (flag.actual === true) {
      processingSuspected = true;
      warnings.push(`${label} is still active. Measurement accuracy may be affected by device audio processing.`);
    } else if (flag.actual === null && sourceKind === 'device') {
      warnings.push(`${label} state is not reported by this browser, so it cannot be confirmed as disabled.`);
    }
  }

  const channelCount = typeof settings?.channelCount === 'number' ? settings.channelCount : null;
  if (channelCount !== null && channelCount > 1) {
    warnings.push(
      `The input delivers ${channelCount} channels; they are averaged to mono, which is not the same as a single measurement channel.`
    );
  }

  const trackSampleRate = typeof settings?.sampleRate === 'number' ? settings.sampleRate : null;
  if (trackSampleRate !== null && Math.abs(trackSampleRate - contextSampleRate) > 1) {
    warnings.push(
      `The device runs at ${trackSampleRate} Hz but the audio graph runs at ${contextSampleRate} Hz, so the browser is resampling.`
    );
  }
  if (contextSampleRate < 44100) {
    warnings.push(
      `The audio graph runs at only ${contextSampleRate} Hz, which limits the measurable frequency range.`
    );
  }

  if (track && track.muted) {
    warnings.push('The input track is muted by the system.');
  }

  return {
    deviceLabel: track?.label || deviceLabelFallback || 'Unknown input',
    deviceId: settings?.deviceId ?? null,
    groupId: settings?.groupId ?? null,
    trackSampleRate,
    contextSampleRate,
    channelCount,
    latencySeconds: readOptionalNumber(settings, 'latency'),
    autoGainControl,
    echoCancellation,
    noiseSuppression,
    trackState: track
      ? { readyState: track.readyState, muted: track.muted, enabled: track.enabled }
      : null,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    platform:
      typeof navigator !== 'undefined'
        ? ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
            ?.platform ?? navigator.platform ?? 'unknown')
        : 'unknown',
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
    audioWorkletSupported:
      typeof window !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      'audioWorklet' in AudioContext.prototype,
    processingSuspected,
    warnings,
    sourceKind,
  };
}

/** Short one-line summary for the status bar tooltip. */
export function diagnosticsSummary(d: InputDiagnostics): string {
  const parts = [d.deviceLabel, `${d.contextSampleRate} Hz`];
  if (d.channelCount) parts.push(`${d.channelCount} ch`);
  if (d.processingSuspected) parts.push('device processing active');
  return parts.join(' - ');
}
