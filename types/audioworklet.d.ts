/**
 * Minimal AudioWorkletGlobalScope declarations.
 *
 * TypeScript's DOM library does not describe the inside of an AudioWorklet, so
 * the few globals the meter processor uses are declared here. The worklet is
 * compiled separately by scripts/build-worklet.mjs but is still type-checked as
 * part of the main project.
 */

interface AudioWorkletProcessorImpl {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessorImpl;
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessorImpl;
};

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessorImpl
): void;

/** Sample rate of the AudioContext that owns the worklet. */
declare const sampleRate: number;

/** Current time of the owning AudioContext, in seconds. */
declare const currentTime: number;

/** Frame counter of the owning AudioContext. */
declare const currentFrame: number;
