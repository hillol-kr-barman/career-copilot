import type { AudioChunkMeta } from "../types";

/**
 * Records the one in-room microphone stream (D-21, D-22): a single
 * `MediaRecorder`, timestamped from a `performance.now()` origin captured
 * once at start. `dataavailable` fires per timeslice, on `stop()` and on
 * `requestData()`, but never on `pause()` — timeslice boundaries must never
 * be used as a clock; every chunk's offset comes from the injected `clock`
 * closure instead.
 */

/** Bounds crash loss to 5s of audio; ~540 chunks over a 45-minute interview. */
export const TIMESLICE_MS = 5000;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

/** First MIME type this browser's `MediaRecorder` actually supports. */
export function pickSupportedMimeType(): string {
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  throw new Error("No supported audio recording format in this browser.");
}

/**
 * Whether this browser can record audio at all — the real remaining
 * constraint after the in-room pivot dropped the Chromium-only tab-audio
 * gate. True only when `MediaRecorder` exists, `getUserMedia` exists, and at
 * least one candidate MIME type is supported. Browser-family-agnostic: it
 * works out whatever Firefox and Safari actually support rather than
 * assuming a Chromium user agent.
 */
export function isRecordingFormatSupported(): boolean {
  if (typeof MediaRecorder === "undefined") return false;
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") return false;
  return MIME_CANDIDATES.some((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * The one pause-excluded clock both the audio chunks and the tag presses
 * read from (D-22, D-26, D-29). A paused `MediaRecorder` emits no chunks for
 * the paused span, so the assembled file's play head only advances across
 * recorded time — a timestamp that does not subtract paused time cannot
 * address a position inside that file.
 */
export function audioElapsedMs(clockOrigin: number, pausedMs: number, offsetMs = 0): number {
  return performance.now() - clockOrigin - pausedMs + offsetMs;
}

/** Chunk metadata for one delivered chunk, minus the session it belongs to. */
export type RecorderChunkMeta = Omit<AudioChunkMeta, "sessionId">;

/**
 * Handle returned by `startRecorder`. The caller owns the clock origin — it
 * must create it before it can build the injected `clock` closure — so this
 * handle carries no `clockOrigin` of its own.
 */
export interface RecorderHandle {
  /** Resolves once the recorder has flushed its final chunk. */
  stopAll: () => Promise<void>;
  pause: () => void;
  resume: () => void;
}

/**
 * Starts one `MediaRecorder` on `stream`. `clock` is injected rather than
 * computed here because the paused total lives in the caller (the section
 * component) — injecting it is what guarantees the chunk path and the
 * tag-press path read the same number.
 */
export function startRecorder(
  stream: MediaStream,
  mimeType: string,
  clock: () => number,
  onChunk: (meta: RecorderChunkMeta, blob: Blob) => void
): RecorderHandle {
  let seq = 0;
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      onChunk(
        {
          seq: seq++,
          tsMs: clock(),
          size: e.data.size,
          mimeType,
        },
        e.data
      );
    }
  };

  recorder.start(TIMESLICE_MS);

  // A clean stop must not lose the tail: wait for the recorder's own "stop"
  // event, which fires only after its final dataavailable has dispatched.
  const waitForStop = (r: MediaRecorder) =>
    new Promise<void>((resolve) => {
      if (r.state === "inactive") {
        resolve();
        return;
      }
      r.addEventListener("stop", () => resolve(), { once: true });
    });

  return {
    stopAll: async () => {
      const done = waitForStop(recorder);
      if (recorder.state !== "inactive") recorder.stop();
      await done;
    },
    pause: () => {
      if (recorder.state === "recording") recorder.pause();
    },
    resume: () => {
      if (recorder.state === "paused") recorder.resume();
    },
  };
}
