/**
 * The D-39 live-tap processor, registered as `"pcm-tap"`.
 *
 * Runs in the browser's `AudioWorkletGlobalScope`, which shares no lib with
 * this project's main-thread TypeScript config — `tsconfig.json` only loads
 * `"DOM"`, and no bundled TS lib ships `AudioWorkletProcessor`,
 * `registerProcessor`, or the global `sampleRate`. They are declared locally
 * below rather than pulled from a lib, matching what the browser actually
 * provides at runtime inside this scope.
 *
 * `process()` reads channel 0 of input 0, accumulates the 128-sample render
 * quanta into 4096-frame blocks, and posts each full block to the port with
 * the buffer in the transfer list (05-RESEARCH.md Pitfall 4) — no
 * resampling happens here. The downsample to 16 kHz runs on the main thread
 * in `src/lib/audioResample.ts`'s already-pure, already-asserted
 * `downsampleTo16k`.
 */

declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

/** The block size posted to the main thread on every full accumulation. */
const BLOCK_SIZE = 4096;

class PcmTapProcessor extends AudioWorkletProcessor {
  private accumulator = new Float32Array(BLOCK_SIZE);
  private writeIndex = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    let readIndex = 0;
    while (readIndex < input.length) {
      const spaceLeft = BLOCK_SIZE - this.writeIndex;
      const toCopy = Math.min(spaceLeft, input.length - readIndex);
      this.accumulator.set(input.subarray(readIndex, readIndex + toCopy), this.writeIndex);
      this.writeIndex += toCopy;
      readIndex += toCopy;

      if (this.writeIndex === BLOCK_SIZE) {
        const block = this.accumulator;
        this.port.postMessage(block, [block.buffer]);
        this.accumulator = new Float32Array(BLOCK_SIZE);
        this.writeIndex = 0;
      }
    }

    // Keep the node alive for the lifetime of the take — a worklet that
    // returns false is not guaranteed to be called again, and this tap must
    // survive for as long as the microphone stream it is attached to.
    return true;
  }
}

// `sampleRate` is read here only to keep it from being reported unused by a
// future strict-mode pass; the actual downsample ratio is computed on the
// main thread from `AudioContext.sampleRate`, the same native rate this
// global mirrors.
void sampleRate;

registerProcessor("pcm-tap", PcmTapProcessor);
