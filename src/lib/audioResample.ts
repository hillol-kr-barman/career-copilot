import { computeRmsLevel } from "./levelMeter";

/**
 * Pure PCM helpers for the D-39 live transcription tap. None of these touch
 * a browser global — importable and callable under Node, the same
 * discipline `computeRmsLevel` and `deriveSpans` already follow, so
 * `scripts/check-tag-track.ts` can assert them directly.
 */

/** Whisper's expected input rate. Every window handed to the worker is resampled to this. */
export const TARGET_SAMPLE_RATE = 16000;

/**
 * Linear-interpolation decimation from `inputSampleRate` down to
 * `TARGET_SAMPLE_RATE`. Returns `input` unchanged when the rate is already
 * 16000, and an empty `Float32Array` for an empty input.
 *
 * This exists instead of constructing a mismatched-rate `AudioContext` and
 * letting the browser resample: `new AudioContext({ sampleRate: 16000 })`
 * fed a native-rate `MediaStreamSource` auto-resamples in Chromium but
 * throws `DOMException` in Firefox ("different sample-rate... not
 * supported"), and this project supports Firefox deliberately
 * (`isRecordingFormatSupported` in `src/lib/recorder.ts` is
 * browser-family-agnostic on purpose). Doing the decimation in JS avoids the
 * mismatch entirely.
 */
export function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (input.length === 0) return new Float32Array(0);
  if (inputSampleRate === TARGET_SAMPLE_RATE) return input;

  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIndex - i0;
    output[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return output;
}

/**
 * The maximum `computeRmsLevel` over consecutive `frameMs` frames of
 * `samples`, 0 for an empty input. The maximum, not the mean: a single
 * sentence inside thirty seconds of room tone must read as speech, and
 * averaging would erase it. This is the measurement the D-46/D-47 energy
 * gate uses to decide whether a near-silent window is worth transcribing at
 * all (Whisper's well-documented habit of hallucinating text into silence).
 */
export function peakFrameRms(samples: Float32Array, sampleRate: number, frameMs: number): number {
  if (samples.length === 0) return 0;

  const frameSize = Math.max(1, Math.round((frameMs / 1000) * sampleRate));
  let peak = 0;
  for (let start = 0; start < samples.length; start += frameSize) {
    const frame = samples.subarray(start, Math.min(start + frameSize, samples.length));
    const level = computeRmsLevel(frame);
    if (level > peak) peak = level;
  }
  return peak;
}

/**
 * A copy of the samples in `pcm` covering the absolute time range
 * `[fromMs, toMs)`, given that `pcm`'s own first sample sits at absolute time
 * `pcmStartMs`. Indices are clamped to the buffer; a range entirely outside
 * it returns an empty `Float32Array` rather than throwing or wrapping.
 */
export function sliceByTime(
  pcm: Float32Array,
  pcmStartMs: number,
  fromMs: number,
  toMs: number,
  sampleRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  const pcmEndMs = pcmStartMs + (pcm.length / sampleRate) * 1000;
  if (pcm.length === 0 || toMs <= pcmStartMs || fromMs >= pcmEndMs || toMs <= fromMs) {
    return new Float32Array(0);
  }

  const clampedFromMs = Math.max(fromMs, pcmStartMs);
  const clampedToMs = Math.min(toMs, pcmEndMs);
  const startIndex = Math.max(0, Math.round(((clampedFromMs - pcmStartMs) / 1000) * sampleRate));
  const endIndex = Math.min(
    pcm.length,
    Math.round(((clampedToMs - pcmStartMs) / 1000) * sampleRate),
  );
  if (endIndex <= startIndex) return new Float32Array(0);
  return pcm.slice(startIndex, endIndex);
}
