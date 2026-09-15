import { env, pipeline } from "@huggingface/transformers";
import type { Speaker } from "../types";
import { peakFrameRms, sliceByTime, TARGET_SAMPLE_RATE } from "../lib/audioResample";
import { SILENCE_FLOOR_RMS, SILENCE_FRAME_MS } from "../lib/windowCutting";

/**
 * The self-hosted Whisper transcription worker (LIVE-10, D-39). Configured
 * before any `pipeline()` call, at module scope, so this worker never
 * attempts a network fetch to Hugging Face: both paths below are exactly
 * what plan 05-01's `fetch-model.mjs` mirrored under `public/` (served at
 * this app's own origin in both dev and production). The ONNX runtime's own
 * default resolves its WASM artifacts from a package CDN, which would make a
 * cross-origin request on first inference while the screen claims nothing
 * leaves the browser — this is what the two `env.backends.onnx.wasm` lines
 * close off.
 */
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = "/models/";
env.backends.onnx.wasm.wasmPaths = "/ort/";

export const MODEL_ID = "onnx-community/whisper-base-ONNX";
/**
 * 05-07 engine-fix: was `"q4f16"`. Real-browser testing against a known-good
 * speech sample found q4f16 (on WebGPU) returned `" I"` — garbage — with
 * BOTH the nightly onnxruntime-web that `@huggingface/transformers@4.2.0`
 * pins as a direct dependency AND the stable `onnxruntime-web@1.24.3`
 * (pinned in package.json's `overrides`, since the nested-install location
 * `fetch-model.mjs` copies WASM artifacts from must match what this worker
 * actually loads). `"q8"` + `device: "wasm"` on stable `1.24.3` is the one
 * configuration this session verified produces correct output — see
 * `pickAsrDevice()`'s comment below and 05-07-ENGINE-FIX-SUMMARY.md for the
 * full evidence table. `fetch-model.mjs` downloads the matching
 * `*_quantized.onnx` file pair; `npm run check` asserts the two stay in
 * sync (a mismatch is a hard 404 at runtime with `allowRemoteModels: false`).
 */
export const MODEL_DTYPE = "q8";

/**
 * Whisper's own hard ceiling. The window planner (`src/lib/windowCutting.ts`,
 * `MAX_WINDOW_MS = 25000`) guarantees every window handed to this worker is
 * under 30 s, so the pipeline's internal chunking never engages and the
 * returned timestamps stay relative to the buffer passed in — the semantics
 * 05-RESEARCH.md Pattern 3's conversion depends on. This is a defensive
 * backstop for a window that somehow arrives longer than that guarantee, not
 * the normal path.
 */
const HARD_MAX_SAMPLES = 30 * 16000;

/** One transcribed chunk within a window's result, in absolute milliseconds. */
export interface WhisperResultChunk {
  text: string;
  startMs: number;
  endMs: number;
}

/** Messages this worker accepts. */
export type WhisperRequest =
  | { type: "load" }
  | { type: "transcribe"; id: string; pcm: Float32Array; windowStartMs: number; speaker: Speaker }
  /** 05-06: one-off pre-flight speed measurement (D-57's other half) — see `runBenchmark`. */
  | { type: "benchmark" };

/** Messages this worker posts. */
export type WhisperResponse =
  | { type: "progress"; file: string; loadedBytes: number; totalBytes: number }
  // 05-07 engine-fix: `device` is single-valued now that WebGPU is never
  // selected (see `pickAsrDevice()` below) — a `"webgpu" | "wasm"` union
  // here would be a lie the caller could branch on.
  | { type: "ready"; device: "wasm" }
  | {
      type: "result";
      id: string;
      windowStartMs: number;
      speaker: Speaker;
      chunks: WhisperResultChunk[];
      /** T-05-12: true when the whole-window pre-gate skipped inference entirely — an ungated window and a gated one are both "this window is finished", only one has text. */
      gated: boolean;
      /** T-05-12: how many chunks the pipeline returned that the per-chunk post-gate then dropped as silent — reported so a quiet stretch is surfaced, not swallowed. */
      silentChunks: number;
    }
  /** 05-06: `runBenchmark`'s result — wall-clock elapsed time for one inference over `audioMs` of synthetic audio. The measurement is the latency, not the (discarded) transcribed text. */
  | { type: "benchmarkResult"; elapsedMs: number; audioMs: number }
  | { type: "error"; id?: string; message: string };

/**
 * The dedicated-worker global scope, typed locally. `tsconfig.json` loads
 * only `"DOM"` (no `"WebWorker"` lib), under which the bare `self` resolves
 * to `Window & typeof globalThis` — a shape whose `postMessage` requires a
 * `targetOrigin` string, not a transfer list. This cast describes the real
 * `DedicatedWorkerGlobalScope` contract this file actually runs under,
 * without redeclaring (and thereby colliding with) the ambient `self`/
 * `postMessage` globals the DOM lib already declares.
 */
const workerScope = self as unknown as {
  postMessage: (message: WhisperResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<WhisperRequest>) => void) | null;
};

/**
 * 05-07 engine-fix: ALWAYS returns `"wasm"`. This used to feature-detect
 * `navigator.gpu` and select `"webgpu"` whenever an adapter existed — that
 * is exactly the broken path. Real-browser testing against a known-good
 * speech sample ("The quick brown fox jumps over the lazy dog. This is a
 * test of the transcription engine.", 4.78s, 16kHz, RMS 0.097) measured
 * WebGPU returning garbage output on BOTH the nightly onnxruntime-web that
 * `@huggingface/transformers@4.2.0` pins directly (q4f16 → `" I"`, fp16 →
 * `" I I I And"`) and the stable `onnxruntime-web@1.24.3` this project now
 * pins via `overrides` (q4f16 → `" I"`, fp16 → `" I I I And"`, q8 → hard
 * `OrtRun` failure: `webgpu/program.cc:249 TensorShape ...`). The only
 * configuration that produced the correct verbatim transcript was stable
 * 1.24.3 + `dtype: "q8"` + `device: "wasm"`. DO NOT "restore" WebGPU here as
 * a performance optimisation without re-measuring against a real sample in
 * a real browser first — see 05-07-ENGINE-FIX-SUMMARY.md for the full
 * evidence table. `navigator.gpu` is intentionally never consulted.
 */
async function pickAsrDevice(): Promise<"wasm"> {
  return "wasm";
}

let transcriber: Awaited<ReturnType<typeof pipeline<"automatic-speech-recognition">>> | null = null;

/**
 * Loads the pipeline once. `dtype` is passed explicitly and always — the
 * library's default differs per device and neither default matches a
 * snapshot that ships only one quantization; with `allowRemoteModels` false,
 * a mismatch is a hard 404 rather than a silent CDN fallback
 * (05-RESEARCH.md Pitfall 1). Posts `ready` with the chosen device on
 * success, or a fatal (no `id`) `error` on failure — never throws out of
 * this module.
 */
async function loadModel(): Promise<void> {
  try {
    const device = await pickAsrDevice();
    transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
      dtype: MODEL_DTYPE,
      device,
      progress_callback: (info) => {
        if (info.status === "progress") {
          workerScope.postMessage({
            type: "progress",
            file: info.file,
            loadedBytes: info.loaded,
            totalBytes: info.total,
          });
        }
      },
    });
    workerScope.postMessage({ type: "ready", device });
  } catch (err) {
    workerScope.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : "Failed to load the transcription model.",
    });
  }
}

/**
 * Transcribes one D-46 window. `return_timestamps: true` with
 * `chunk_length_s`/`stride_length_s` left unset (see the module doc comment
 * on `HARD_MAX_SAMPLES`). Converts each returned chunk's relative seconds to
 * absolute milliseconds by adding `windowStartMs`, and posts one `result`
 * carrying every surviving chunk. A failure here posts an `error` scoped to
 * this window's `id` — never a fatal error — so one bad window cannot end
 * the session.
 *
 * T-05-12, gated on both sides of the model:
 * - **Pre-gate.** A window whose loudest `SILENCE_FRAME_MS` frame never
 *   clears `SILENCE_FLOOR_RMS` is treated as silence and the pipeline is not
 *   invoked at all — Whisper's well-documented habit of inventing fluent
 *   text for near-silent audio makes this load-bearing, not an optimisation
 *   (05-RESEARCH.md Pitfall 3). This also removes the largest single WASM
 *   cost on the most common window content in a real interview: a pause.
 * - **Post-gate.** A window can clear the whole-window floor on one loud
 *   sentence and still end in room tone — exactly where the model appends a
 *   fluent, invented sentence. Each returned chunk's own time range is
 *   sliced back out of the window PCM and gated independently.
 *
 * Both floors come from `windowCutting.ts`'s own constants — this worker
 * never declares a second threshold. Either gate leaves the session's
 * dispatch bookkeeping unaffected: a gated window is a completed window, it
 * simply carries no text.
 */
async function transcribeWindow(request: {
  id: string;
  pcm: Float32Array;
  windowStartMs: number;
  speaker: Speaker;
}): Promise<void> {
  if (!transcriber) {
    workerScope.postMessage({
      type: "error",
      id: request.id,
      message: "The transcription model is not loaded yet.",
    });
    return;
  }

  if (request.pcm.length > HARD_MAX_SAMPLES) {
    workerScope.postMessage({
      type: "error",
      id: request.id,
      message: "A transcription window exceeded Whisper's 30-second limit and was skipped.",
    });
    return;
  }

  const windowPeakRms = peakFrameRms(request.pcm, TARGET_SAMPLE_RATE, SILENCE_FRAME_MS);
  if (windowPeakRms < SILENCE_FLOOR_RMS) {
    workerScope.postMessage({
      type: "result",
      id: request.id,
      windowStartMs: request.windowStartMs,
      speaker: request.speaker,
      chunks: [],
      gated: true,
      silentChunks: 0,
    });
    return;
  }

  try {
    // 05-07 engine-fix: `language`/`task` passed explicitly. This did not
    // fix the garbage-output bug (the runtime/dtype/device combination did)
    // — but the model is multilingual and leaving language detection
    // implicit was a latent bug now that output is real and gets shown to a
    // user.
    const output = await transcriber(request.pcm, {
      return_timestamps: true,
      language: "en",
      task: "transcribe",
    });
    const rawChunks = output.chunks ?? [];
    const chunks: WhisperResultChunk[] = [];
    let silentChunks = 0;
    for (const chunk of rawChunks) {
      const startMs = request.windowStartMs + chunk.timestamp[0] * 1000;
      const endMs = request.windowStartMs + chunk.timestamp[1] * 1000;
      const chunkPcm = sliceByTime(request.pcm, request.windowStartMs, startMs, endMs, TARGET_SAMPLE_RATE);
      const chunkPeakRms = peakFrameRms(chunkPcm, TARGET_SAMPLE_RATE, SILENCE_FRAME_MS);
      if (chunkPeakRms < SILENCE_FLOOR_RMS) {
        silentChunks++;
        continue;
      }
      chunks.push({ text: chunk.text, startMs, endMs });
    }
    workerScope.postMessage({
      type: "result",
      id: request.id,
      windowStartMs: request.windowStartMs,
      speaker: request.speaker,
      chunks,
      gated: false,
      silentChunks,
    });
  } catch (err) {
    workerScope.postMessage({
      type: "error",
      id: request.id,
      message: err instanceof Error ? err.message : "Transcription failed for this window.",
    });
  }
}

/** The synthetic benchmark buffer's duration — a few seconds, matched against `MAX_WINDOW_MS` on the reading side (`MicSetup.tsx`/`TranscriptView.tsx`), not against this constant. */
const BENCHMARK_AUDIO_MS = 3000;
const BENCHMARK_SAMPLE_COUNT = Math.round((BENCHMARK_AUDIO_MS / 1000) * TARGET_SAMPLE_RATE);

/**
 * Deterministic low-amplitude band-limited noise, synthesized fresh on every
 * call — never a shipped audio asset, never a microphone read. A fixed-seed
 * linear congruential generator (never `Math.random()`, which is not
 * reproducible run to run and would make this measurement's own variance
 * partly about the buffer rather than the machine) produces white noise; a
 * short moving-average low-pass then band-limits it into something with
 * speech-like energy without being intelligible speech.
 */
function synthesizeBenchmarkPcm(): Float32Array {
  let seed = 42;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };

  const raw = new Float32Array(BENCHMARK_SAMPLE_COUNT);
  for (let i = 0; i < BENCHMARK_SAMPLE_COUNT; i++) raw[i] = nextRandom();

  const windowSize = 8;
  const amplitude = 0.05;
  const smoothed = new Float32Array(BENCHMARK_SAMPLE_COUNT);
  let windowSum = 0;
  for (let i = 0; i < BENCHMARK_SAMPLE_COUNT; i++) {
    windowSum += raw[i];
    if (i >= windowSize) windowSum -= raw[i - windowSize];
    smoothed[i] = (windowSum / Math.min(i + 1, windowSize)) * amplitude;
  }
  return smoothed;
}

/**
 * D-57's pre-flight half: runs exactly one inference over a synthetic buffer
 * and reports how long it took, discarding whatever text comes back — the
 * measurement is the latency, not the output. Deliberately calls the
 * `transcriber` directly rather than going through `transcribeWindow`: that
 * function's energy gate would (correctly) refuse this buffer as near-silent,
 * which is exactly why this is its own message type instead of a
 * `transcribe` request with a bypass flag. A failure here posts a
 * non-fatal-shaped `error` (no `id`, matching a load failure's shape) —
 * `warmUpWhisper` on the caller side treats a benchmark failure as "no
 * measurement", not as a failed warm-up.
 */
async function runBenchmark(): Promise<void> {
  if (!transcriber) {
    workerScope.postMessage({ type: "error", message: "The transcription model is not loaded yet." });
    return;
  }
  try {
    const pcm = synthesizeBenchmarkPcm();
    const startedAt = Date.now();
    await transcriber(pcm, { return_timestamps: true, language: "en", task: "transcribe" });
    const elapsedMs = Date.now() - startedAt;
    workerScope.postMessage({ type: "benchmarkResult", elapsedMs, audioMs: BENCHMARK_AUDIO_MS });
  } catch (err) {
    workerScope.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : "The speed measurement failed.",
    });
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "load") {
    void loadModel();
  } else if (request.type === "transcribe") {
    void transcribeWindow(request);
  } else if (request.type === "benchmark") {
    void runBenchmark();
  }
};
