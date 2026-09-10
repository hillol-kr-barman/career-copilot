import { env, pipeline } from "@huggingface/transformers";
import type { Speaker } from "../types";

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
export const MODEL_DTYPE = "q4f16";

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
  | { type: "transcribe"; id: string; pcm: Float32Array; windowStartMs: number; speaker: Speaker };

/** Messages this worker posts. */
export type WhisperResponse =
  | { type: "progress"; file: string; loadedBytes: number; totalBytes: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "result"; id: string; windowStartMs: number; speaker: Speaker; chunks: WhisperResultChunk[] }
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
 * Feature-detects WebGPU rather than hardcoding it or relying on an
 * undocumented "auto" capability probe — support is uneven even where
 * `navigator.gpu` exists (`TOOL-4-LIVE-INTERVIEW.md` §3, 05-RESEARCH.md
 * Anti-Patterns). Falls back to `"wasm"` on any absence or failure,
 * including a rejected `requestAdapter()`.
 */
async function pickAsrDevice(): Promise<"webgpu" | "wasm"> {
  if (!("gpu" in navigator)) return "wasm";
  try {
    const gpu = (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu;
    const adapter = await gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
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
 * carrying every chunk. A failure here posts an `error` scoped to this
 * window's `id` — never a fatal error — so one bad window cannot end the
 * session.
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

  try {
    const output = await transcriber(request.pcm, { return_timestamps: true });
    const chunks: WhisperResultChunk[] = (output.chunks ?? []).map((chunk) => ({
      text: chunk.text,
      startMs: request.windowStartMs + chunk.timestamp[0] * 1000,
      endMs: request.windowStartMs + chunk.timestamp[1] * 1000,
    }));
    workerScope.postMessage({
      type: "result",
      id: request.id,
      windowStartMs: request.windowStartMs,
      speaker: request.speaker,
      chunks,
    });
  } catch (err) {
    workerScope.postMessage({
      type: "error",
      id: request.id,
      message: err instanceof Error ? err.message : "Transcription failed for this window.",
    });
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "load") {
    void loadModel();
  } else if (request.type === "transcribe") {
    void transcribeWindow(request);
  }
};
