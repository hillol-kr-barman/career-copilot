import { downsampleTo16k } from "./audioResample";
import builtWorkletUrl from "./pcmTap.worklet.ts?worker&url";

/**
 * The URL handed to `audioWorklet.addModule()`, which differs between dev and
 * a production build and cannot be a single specifier.
 *
 * `?worker&url` is the only query that gets the worklet transpiled AND emitted
 * as a standalone chunk by `vite build` — the production chunk is a
 * self-contained IIFE with no imports, exactly what `AudioWorkletGlobalScope`
 * requires. But in dev that same query resolves to
 * `/src/lib/pcmTap.worklet.ts?worker_file&type=module`, and Vite prepends its
 * worker env preamble (`import "/@vite/env"`) to anything served under
 * `worker_file`. `AudioWorkletGlobalScope` cannot resolve a static import, so
 * `addModule()` rejects and the tap never starts — silently, because D-39
 * isolates a tap failure from the recording.
 *
 * Stripping the query in dev yields `/src/lib/pcmTap.worklet.ts`, which Vite
 * serves as transpiled JS with no preamble. Both environments therefore get a
 * module the worklet scope can actually evaluate.
 *
 * Verified in both: the production chunk begins `(function(){"use strict";
 * class i extends AudioWorkletProcessor`, and the dev module begins
 * `const BLOCK_SIZE = 4096;` with no import statement.
 */
const workletUrl = import.meta.env.DEV ? builtWorkletUrl.split("?")[0] : builtWorkletUrl;

/**
 * D-39's second consumer on an already-acquired `MediaStream` — a live
 * 16 kHz mono PCM tap, independent of both `MediaRecorder` (writing to
 * IndexedDB) and the D-37 level meter (`src/lib/levelMeter.ts`, observability
 * only). Shaped like `createLevelMeter`'s handle deliberately: a tap failure
 * must never interrupt a recording in progress.
 */
export interface AudioTapHandle {
  /** The tap's own `AudioContext`'s native sample rate — informational; every block handed to `onPcm16k` is already downsampled. */
  sampleRate: number;
  close(): void;
}

/**
 * Wires an `AudioWorkletNode` running the `"pcm-tap"` processor onto
 * `stream`, downsamples every posted block to 16 kHz on the main thread
 * (05-RESEARCH.md Pattern 2 / Pitfall 2), and hands each result to
 * `onPcm16k`.
 *
 * Constructs the `AudioContext` with no options object — never a
 * `sampleRate` override — at the browser's own native rate. A mismatched-rate
 * context auto-resamples in Chromium but throws `DOMException` in Firefox,
 * which this project supports deliberately (`isRecordingFormatSupported` in
 * `src/lib/recorder.ts` is browser-family-agnostic on purpose), so the
 * decimation happens in JS instead (`downsampleTo16k`).
 *
 * Does not reuse the level meter's `AudioContext`: the meter lives from
 * `armed` to teardown and is observability only, this tap lives for exactly
 * one take, and coupling the two would make a meter failure a transcription
 * failure — the opposite of D-39's isolation.
 *
 * Does not use the non-realtime offline audio-rendering context: it renders
 * a fixed-length buffer and cannot process a continuously arriving stream.
 * That is the right tool for a stopped, assembled blob (a future file-decode
 * path), not this live tap.
 *
 * The worklet node is connected through a zero-gain `GainNode` to
 * `ctx.destination` — a worklet node not connected toward the destination is
 * not guaranteed to be pulled by the audio graph, and the zero gain is what
 * keeps the room from hearing itself.
 *
 * Returns `null` — never throws — on any construction failure, mirroring
 * `createLevelMeter`'s discipline exactly.
 */
export async function createAudioTap(
  stream: MediaStream,
  onPcm16k: (pcm: Float32Array) => void,
): Promise<AudioTapHandle | null> {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;

    const ctx = new AudioContextCtor();

    try {
      await ctx.audioWorklet.addModule(workletUrl);
    } catch (err) {
      void ctx.close().catch(() => {});
      throw err;
    }

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-tap");
    const gain = ctx.createGain();
    gain.gain.value = 0;

    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const pcm16k = downsampleTo16k(event.data, ctx.sampleRate);
      onPcm16k(pcm16k);
    };

    source.connect(node);
    node.connect(gain);
    gain.connect(ctx.destination);

    return {
      sampleRate: ctx.sampleRate,
      close: () => {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        gain.disconnect();
        void ctx.close().catch(() => {
          // Already closed or closing — nothing further to clean up.
        });
      },
    };
  } catch {
    return null;
  }
}
