/**
 * Optional WAV recording.
 *
 * Recording is never implicit: it only happens when the user explicitly enables
 * it, and the UI shows an unmistakable indicator while it runs. Starting an SPL
 * measurement does not start a recording.
 *
 * Audio is written as 24-bit PCM. 16-bit would throw away roughly 20 dB of the
 * usable dynamic range at the low end, which defeats the point of recording a
 * measurement; 32-bit float would double the size for no audible benefit.
 */

export const WAV_BIT_DEPTH = 24;

/** Hard ceiling so a forgotten recording cannot fill the device storage. */
export const DEFAULT_MAX_RECORDING_SECONDS = 30 * 60;

export interface WavRecorderOptions {
  sampleRate: number;
  maxSeconds?: number;
  /** Called when the limit is reached and recording stops itself. */
  onLimitReached?: (seconds: number) => void;
}

export class WavRecorder {
  private chunks: Float32Array[] = [];
  private sampleCount = 0;
  private recording = false;
  private readonly maxSamples: number;

  readonly sampleRate: number;
  startedAt: number | null = null;

  constructor(private readonly options: WavRecorderOptions) {
    this.sampleRate = options.sampleRate;
    this.maxSamples = Math.round((options.maxSeconds ?? DEFAULT_MAX_RECORDING_SECONDS) * this.sampleRate);
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get durationSeconds(): number {
    return this.sampleCount / this.sampleRate;
  }

  get sizeBytes(): number {
    return 44 + this.sampleCount * 3;
  }

  start(): void {
    this.chunks = [];
    this.sampleCount = 0;
    this.recording = true;
    this.startedAt = Date.now();
  }

  /** Append one PCM block. Ignored when not recording. */
  append(samples: Float32Array): void {
    if (!this.recording) return;
    const remaining = this.maxSamples - this.sampleCount;
    if (remaining <= 0) {
      this.recording = false;
      this.options.onLimitReached?.(this.durationSeconds);
      return;
    }
    const block = samples.length > remaining ? samples.subarray(0, remaining) : samples;
    // Copy: the incoming buffer was transferred and may be reused by the caller.
    this.chunks.push(Float32Array.from(block));
    this.sampleCount += block.length;
    if (this.sampleCount >= this.maxSamples) {
      this.recording = false;
      this.options.onLimitReached?.(this.durationSeconds);
    }
  }

  stop(): void {
    this.recording = false;
  }

  discard(): void {
    this.recording = false;
    this.chunks = [];
    this.sampleCount = 0;
    this.startedAt = null;
  }

  /** Produce a finished WAV file. Returns null when nothing was recorded. */
  toBlob(): Blob | null {
    if (this.sampleCount === 0) return null;
    return new Blob([encodeWav(this.chunks, this.sampleCount, this.sampleRate)], {
      type: 'audio/wav',
    });
  }
}

/**
 * Encode mono float samples as a 24-bit PCM RIFF/WAVE file.
 */
export function encodeWav(
  chunks: readonly Float32Array[],
  sampleCount: number,
  sampleRate: number
): ArrayBuffer {
  const bytesPerSample = 3;
  const dataBytes = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 24, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  const maxValue = 0x7fffff;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      // Clamp then scale. Clamping at exactly +/-1 keeps a full-scale input from
      // wrapping to the opposite polarity.
      const clamped = Math.max(-1, Math.min(1, chunk[i]));
      const value = Math.round(clamped * maxValue);
      view.setUint8(offset, value & 0xff);
      view.setUint8(offset + 1, (value >> 8) & 0xff);
      view.setUint8(offset + 2, (value >> 16) & 0xff);
      offset += 3;
    }
  }

  return buffer;
}

/** Decode a 24-bit mono WAV produced by {@link encodeWav}. Used by tests. */
export function decodeWav(buffer: ArrayBuffer): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Float32Array;
} {
  const view = new DataView(buffer);
  const readAscii = (offset: number, length: number) => {
    let out = '';
    for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
    return out;
  };
  if (readAscii(0, 4) !== 'RIFF' || readAscii(8, 4) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE file');
  }
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataBytes = view.getUint32(40, true);
  const bytesPerSample = bitsPerSample / 8;
  const count = dataBytes / bytesPerSample;
  const samples = new Float32Array(count);
  const maxValue = Math.pow(2, bitsPerSample - 1) - 1;
  for (let i = 0; i < count; i++) {
    const offset = 44 + i * bytesPerSample;
    let value: number;
    if (bitsPerSample === 24) {
      const b0 = view.getUint8(offset);
      const b1 = view.getUint8(offset + 1);
      const b2 = view.getUint8(offset + 2);
      value = (b2 << 24) | (b1 << 16) | (b0 << 8);
      value >>= 8; // sign-extend from 24 to 32 bits
    } else if (bitsPerSample === 16) {
      value = view.getInt16(offset, true);
    } else {
      throw new Error(`Unsupported bit depth ${bitsPerSample}`);
    }
    samples[i] = value / maxValue;
  }
  return { sampleRate, channels, bitsPerSample, samples };
}
