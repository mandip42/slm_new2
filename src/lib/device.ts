/**
 * Device identification for calibration profiles and session metadata.
 *
 * A calibration is only valid for the device and browser it was made on, so this
 * information is recorded with every profile and every session. Detection is
 * best-effort: the strings are for the user's benefit, not for logic.
 */

import type { DeviceInfo } from '@/storage/types';
import type { InputDiagnostics } from '@/audio/diagnostics';

interface NavigatorUAData {
  platform?: string;
  brands?: Array<{ brand: string; version: string }>;
  model?: string;
  mobile?: boolean;
}

function uaData(): NavigatorUAData | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
}

/** Best-effort device model, e.g. "Pixel 7" or "SM-S911B". */
export function detectDeviceModel(userAgent = safeUserAgent()): string {
  const data = uaData();
  if (data?.model) return data.model;

  // Android user agents carry the model between the API level and "Build/".
  const android = /Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|\))/i.exec(userAgent);
  if (android?.[1]) {
    const model = android[1].trim();
    if (model && !/^wv$/i.test(model)) return model;
  }
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Macintosh/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Linux/i.test(userAgent)) return 'Linux device';
  return 'Unknown device';
}

/** Browser name and major version. */
export function detectBrowser(userAgent = safeUserAgent()): string {
  const data = uaData();
  if (data?.brands?.length) {
    const meaningful = data.brands.find(
      (b) => !/not.a.brand/i.test(b.brand) && !/chromium/i.test(b.brand)
    );
    const chosen = meaningful ?? data.brands.find((b) => !/not.a.brand/i.test(b.brand));
    if (chosen) return `${chosen.brand} ${chosen.version}`;
  }

  const patterns: Array<[RegExp, string]> = [
    [/Edg\/(\d+)/, 'Edge'],
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+).*Safari/, 'Safari'],
  ];
  for (const [pattern, name] of patterns) {
    const match = pattern.exec(userAgent);
    if (match) return `${name} ${match[1]}`;
  }
  return 'Unknown browser';
}

export function detectPlatform(): string {
  const data = uaData();
  if (data?.platform) return data.platform;
  if (typeof navigator === 'undefined') return 'unknown';
  return navigator.platform || 'unknown';
}

function safeUserAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

function screenDescription(): string {
  if (typeof window === 'undefined' || !window.screen) return 'unknown';
  const dpr = window.devicePixelRatio || 1;
  return `${window.screen.width}x${window.screen.height} @${dpr.toFixed(2)}x`;
}

/** Build the DeviceInfo recorded with profiles and sessions. */
export function buildDeviceInfo(
  sampleRate: number,
  diagnostics: InputDiagnostics | null
): DeviceInfo {
  const userAgent = safeUserAgent();
  return {
    userAgent,
    platform: detectPlatform(),
    model: detectDeviceModel(userAgent),
    browser: detectBrowser(userAgent),
    screen: screenDescription(),
    deviceLabel: diagnostics?.deviceLabel ?? 'Unknown input',
    sampleRate,
    processingSuspected: diagnostics?.processingSuspected ?? true,
  };
}

/** A short human label, e.g. "Pixel 7 / Chrome 130 / 48000 Hz". */
export function describeDevice(device: DeviceInfo): string {
  return `${device.model} / ${device.browser} / ${device.sampleRate} Hz`;
}

/**
 * Whether a stored profile plausibly belongs to the current device and audio
 * configuration. A mismatch does not block use but is prominently flagged,
 * because a calibration from another phone is meaningless.
 */
export function profileMatchesDevice(
  device: DeviceInfo,
  currentSampleRate: number | null
): { matches: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const currentModel = detectDeviceModel();
  const currentBrowser = detectBrowser();

  if (device.model !== currentModel) {
    reasons.push(`Profile was created on ${device.model}, this device reports ${currentModel}.`);
  }
  if (device.browser !== currentBrowser) {
    reasons.push(`Profile was created in ${device.browser}, this browser is ${currentBrowser}.`);
  }
  if (currentSampleRate !== null && device.sampleRate !== currentSampleRate) {
    reasons.push(
      `Profile was created at ${device.sampleRate} Hz, the audio graph is now running at ${currentSampleRate} Hz.`
    );
  }
  return { matches: reasons.length === 0, reasons };
}
