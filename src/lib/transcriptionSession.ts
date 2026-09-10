import type { Speaker, TagPress, TranscriptSegment } from "../types";
import { openRecordingDB, deriveSpans, updateSessionTranscriptState } from "./recordingStore";
import { appendSegment, nextSegmentSeq } from "./transcriptStore";
import { planWindows, SPAN_FLOOR_MS, MAX_WINDOW_MS, WINDOW_OVERLAP_MS } from "./windowCutting";
import { sliceByTime, TARGET_SAMPLE_RATE } from "./audioResample";
import { createAudioTap } from "./audioTap";
import type { WhisperRequest, WhisperResponse } from "../workers/whisper.worker";

/**
 * The main-thread transcription orchestrator (D-39's live tap through D-41's
 * per-segment persistence) — the only impure part of this phase's pipeline.
 * Everything it calls (`deriveSpans`, `planWindows`, `sliceByTime`,
 * `appendSegment`) is pure or already-disciplined storage code; this module
 * is what sequences them against a live clock.
 */

/**
 * How much 16 kHz PCM (~32 KB/s) is buffered while the worker is still
 * loading before new audio is dropped (D-44). 180 s ≈ 11.5 MB — comfortably
 * larger than any observed model load, while still bounded.
 */
export const PCM_BACKLOG_CAP_MS = 180000;

/** How long with a window outstanding and no result before the transcript reports "stalled" rather than merely lagging (D-57). */
export const STALL_WARN_MS = 90000;

const TICK_MS = 1000;
/** Bounded wait for outstanding results once `finish()` is called. */
const DRAIN_TIMEOUT_MS = 20000;
const DRAIN_POLL_MS = 200;

export interface TranscriptionStatus {
  phase: "loading" | "live" | "stalled" | "draining" | "done" | "failed";
  /** How far behind the transcript is, in ms — `clock() - newestSegmentEndMs`. */
  lagMs: number;
  /** Total ms of audio that could not be buffered while the model was loading (D-44). */
  backlogDroppedMs: number;
  device?: "webgpu" | "wasm";
  message?: string;
}

export interface TranscriptionSessionHandle {
  /** Records a spacebar flip for the window planner. Never writes to storage — `LiveInterview` already does that via `appendTagPress`. */
  notePress(tsMs: number, speaker: Speaker): void;
  /** Closes the tap, dispatches every remaining window against `finalMs`, waits (bounded) for outstanding results, and writes the take's `transcriptStatus`. */
  finish(finalMs: number): Promise<void>;
  /** Tears everything down without writing `"complete"` — for an unmount or a cancelled take. */
  abort(): void;
}

export interface TranscriptionSessionOptions {
  sessionId: string;
  stream: MediaStream;
  /** The section's own `clock()` closure (`audioElapsedMs` in `src/lib/recorder.ts`) — never a second clock (D-48). */
  clock: () => number;
  /** A resumed take can never be marked `"complete"` (D-40): the pre-crash audio was never tapped and is not recoverable. */
  isResumedTake: boolean;
  onSegment: (segment: TranscriptSegment) => void;
  onStatus: (status: TranscriptionStatus) => void;
}

function createWorker(): Worker {
  return new Worker(new URL("../workers/whisper.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Starts the live transcription pipeline for one take: opens its own
 * short-lived IndexedDB connection (never `LiveInterview`'s `dbRef` —
 * `teardownCapture` closes that handle at Stop while this writer may still
 * be appending the last windows' segments), taps the stream, loads the
 * Whisper worker, and begins a one-second scheduling tick.
 *
 * Every failure path — `createAudioTap` returning `null`, the worker failing
 * to load, a per-window `error`, an `onerror`/`onmessageerror` on the worker
 * — reports `phase: "failed"` with a human-readable message and stops the
 * pipeline. None of them throws out of this function, and none of them
 * touches the `MediaRecorder`, the chunk writer, the tag track, or the
 * session record (D-39's explicit isolation guarantee).
 */
export async function startTranscriptionSession(
  options: TranscriptionSessionOptions
): Promise<TranscriptionSessionHandle | null> {
  const { sessionId, stream, clock, isResumedTake, onSegment, onStatus } = options;

  let db: IDBDatabase | null;
  try {
    db = await openRecordingDB();
  } catch {
    onStatus({
      phase: "failed",
      lagMs: 0,
      backlogDroppedMs: 0,
      message: "Could not open storage for the transcript. The recording itself is unaffected.",
    });
    return null;
  }

  // Session state — a growing 16 kHz PCM buffer (stored as a chunk list so
  // every tap callback is an O(1) push; materialised into one contiguous
  // Float32Array only when a window actually needs slicing) with an
  // absolute `bufferStartMs` anchor.
  let pcmChunks: Float32Array[] = [];
  let bufferStartMs = 0;
  let bufferSampleCount = 0;

  const presses: TagPress[] = [];
  const dispatchedWindowStarts = new Set<number>();
  const pendingWindowIds = new Set<string>();

  let nextSeq = await nextSegmentSeq(sessionId);
  let dispatchedThroughMs = 0;
  let newestSegmentEndMs = 0;
  let backlogDroppedMs = 0;
  let anyWindowErrored = false;
  let workerReady = false;
  let workerDead = false;
  let modelDevice: "webgpu" | "wasm" | undefined;
  let phase: TranscriptionStatus["phase"] = "loading";
  let lastActivityAt = clock();
  let finished = false;
  let aborted = false;
  let tickHandle: ReturnType<typeof setInterval> | null = null;

  function emitStatus(message?: string) {
    onStatus({
      phase,
      lagMs: Math.max(0, clock() - newestSegmentEndMs),
      backlogDroppedMs,
      device: modelDevice,
      message,
    });
  }

  function materializeBuffer(): Float32Array {
    if (pcmChunks.length <= 1) return pcmChunks[0] ?? new Float32Array(0);
    const combined = new Float32Array(bufferSampleCount);
    let offset = 0;
    for (const chunk of pcmChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    pcmChunks = [combined];
    return combined;
  }

  function compactBufferTo(newStartMs: number) {
    if (newStartMs <= bufferStartMs) return;
    const buffer = materializeBuffer();
    const dropSamples = Math.min(
      buffer.length,
      Math.round(((newStartMs - bufferStartMs) / 1000) * TARGET_SAMPLE_RATE)
    );
    if (dropSamples <= 0) return;
    const trimmed = buffer.slice(dropSamples);
    pcmChunks = [trimmed];
    bufferSampleCount = trimmed.length;
    bufferStartMs += (dropSamples / TARGET_SAMPLE_RATE) * 1000;
  }

  const tap = await createAudioTap(stream, (pcm16k) => {
    if (workerDead || pcm16k.length === 0) return;

    if (!workerReady) {
      // D-44: buffered until the worker is live; capped so the head — where
      // the interviewer's opening question lives — survives rather than the
      // tail.
      const capSamples = (PCM_BACKLOG_CAP_MS / 1000) * TARGET_SAMPLE_RATE;
      if (bufferSampleCount >= capSamples) {
        backlogDroppedMs += (pcm16k.length / TARGET_SAMPLE_RATE) * 1000;
        emitStatus("Some audio could not be buffered while the transcriber was loading.");
        return;
      }
      const capacityLeft = capSamples - bufferSampleCount;
      if (pcm16k.length > capacityLeft) {
        const kept = pcm16k.subarray(0, capacityLeft);
        pcmChunks.push(kept);
        bufferSampleCount += kept.length;
        backlogDroppedMs += ((pcm16k.length - capacityLeft) / TARGET_SAMPLE_RATE) * 1000;
        emitStatus("Some audio could not be buffered while the transcriber was loading.");
        return;
      }
    }

    pcmChunks.push(pcm16k);
    bufferSampleCount += pcm16k.length;
  });

  if (!tap) {
    onStatus({
      phase: "failed",
      lagMs: 0,
      backlogDroppedMs: 0,
      message: "The microphone tap for transcription could not be created. The recording itself is unaffected.",
    });
    db.close();
    return null;
  }

  const worker = createWorker();

  function dispatchWindowsUpTo(settledMs: number) {
    const spans = deriveSpans(presses, settledMs);
    const windows = planWindows(spans, SPAN_FLOOR_MS, MAX_WINDOW_MS, WINDOW_OVERLAP_MS);
    const bufferEndMs = bufferStartMs + (bufferSampleCount / TARGET_SAMPLE_RATE) * 1000;

    for (const window of windows) {
      if (window.endMs > settledMs) continue;
      if (dispatchedWindowStarts.has(window.startMs)) continue;
      if (window.endMs > bufferEndMs) continue; // not yet fully buffered

      dispatchedWindowStarts.add(window.startMs);
      dispatchedThroughMs = Math.max(dispatchedThroughMs, window.endMs);

      const buffer = materializeBuffer();
      const pcm = sliceByTime(buffer, bufferStartMs, window.startMs, window.endMs, TARGET_SAMPLE_RATE);
      if (pcm.length === 0) continue; // nothing usable — e.g. this range has already been dropped

      const id = crypto.randomUUID();
      pendingWindowIds.add(id);
      const request: WhisperRequest = {
        type: "transcribe",
        id,
        pcm,
        windowStartMs: window.startMs,
        speaker: window.speaker,
      };
      worker.postMessage(request, [pcm.buffer]);
    }

    compactBufferTo(Math.max(bufferStartMs, dispatchedThroughMs - WINDOW_OVERLAP_MS));
  }

  async function handleResult(message: Extract<WhisperResponse, { type: "result" }>) {
    pendingWindowIds.delete(message.id);
    for (const chunk of message.chunks) {
      const segment: TranscriptSegment = {
        sessionId,
        seq: nextSeq++,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        speaker: message.speaker,
        text: chunk.text,
        windowStartMs: message.windowStartMs,
      };
      try {
        if (db) await appendSegment(db, segment);
        if (segment.endMs > newestSegmentEndMs) newestSegmentEndMs = segment.endMs;
        onSegment(segment);
      } catch {
        anyWindowErrored = true;
      }
    }
    lastActivityAt = clock();
    if (!finished && !aborted) {
      phase = "live";
      emitStatus();
    }
  }

  worker.onmessage = (event: MessageEvent<WhisperResponse>) => {
    const message = event.data;
    if (message.type === "progress") {
      if (!finished && !aborted) emitStatus();
      return;
    }
    if (message.type === "ready") {
      modelDevice = message.device;
      workerReady = true;
      lastActivityAt = clock();
      if (!finished && !aborted) {
        phase = "live";
        emitStatus();
      }
      return;
    }
    if (message.type === "result") {
      void handleResult(message);
      return;
    }
    if (message.type === "error") {
      anyWindowErrored = true;
      if (message.id) {
        pendingWindowIds.delete(message.id);
        if (!finished && !aborted) emitStatus(message.message);
      } else {
        // Fatal — the model failed to load. Stops the pipeline; the
        // recording itself is untouched.
        workerDead = true;
        phase = "failed";
        if (tickHandle !== null) {
          clearInterval(tickHandle);
          tickHandle = null;
        }
        emitStatus(message.message);
      }
      return;
    }
  };

  worker.onerror = () => {
    anyWindowErrored = true;
    workerDead = true;
    phase = "failed";
    if (tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
    emitStatus("The transcription worker failed unexpectedly. The recording itself is unaffected.");
  };

  worker.onmessageerror = () => {
    anyWindowErrored = true;
    workerDead = true;
    phase = "failed";
    if (tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
    emitStatus("The transcription worker sent an unreadable message. The recording itself is unaffected.");
  };

  worker.postMessage({ type: "load" } satisfies WhisperRequest);

  function tick() {
    if (aborted || finished) return;
    if (workerReady && !workerDead) {
      const nowMs = clock();
      const settledMs = Math.max(0, nowMs - SPAN_FLOOR_MS);
      dispatchWindowsUpTo(settledMs);
      if (phase === "live" && pendingWindowIds.size > 0 && nowMs - lastActivityAt > STALL_WARN_MS) {
        phase = "stalled";
      }
    }
    emitStatus();
  }
  tickHandle = setInterval(tick, TICK_MS);
  emitStatus();

  async function finish(finalMs: number): Promise<void> {
    if (finished || aborted) return;
    finished = true;
    if (tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
    tap.close();

    if (workerReady && !workerDead) {
      // The real boundary — no settle subtraction, because no further press
      // can arrive.
      dispatchWindowsUpTo(finalMs);
    }
    phase = "draining";
    emitStatus();

    const drainStart = Date.now();
    while (pendingWindowIds.size > 0 && Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
    if (pendingWindowIds.size > 0) anyWindowErrored = true;

    const isComplete = !anyWindowErrored && pendingWindowIds.size === 0 && backlogDroppedMs === 0 && !isResumedTake;

    try {
      if (db) {
        await updateSessionTranscriptState(db, sessionId, {
          transcriptStatus: isComplete ? "complete" : "incomplete",
        });
      }
    } catch {
      // Best-effort — a failed status write doesn't change the audio's
      // fate; D-53's "failure means keep" is enforced by plan 05-05's
      // retention pass reading this same field, not by this write succeeding.
    }

    worker.terminate();
    db?.close();
    db = null;
    phase = "done";
    emitStatus();
  }

  function abort(): void {
    if (finished || aborted) return;
    aborted = true;
    if (tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
    tap.close();
    worker.terminate();
    db?.close();
    db = null;
  }

  function notePress(tsMs: number, speaker: Speaker): void {
    presses.push({ sessionId, tsMs, speaker });
  }

  return { notePress, finish, abort };
}
