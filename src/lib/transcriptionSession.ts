import type { Speaker, TagPress, TranscriptSegment } from "../types";
import { openRecordingDB, deriveSpans, updateSessionTranscriptState } from "./recordingStore";
import { appendSegment, nextSegmentSeq } from "./transcriptStore";
import { eligibleWindows, dropSeamDuplicates, SPAN_FLOOR_MS, MAX_WINDOW_MS, WINDOW_OVERLAP_MS } from "./windowCutting";
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
  /** T-05-12: total windows the whole-window pre-gate skipped as silent, across the take so far. */
  gatedWindows: number;
  /** T-05-12: total chunks the per-chunk post-gate dropped as silent, across the take so far. */
  silentChunksDropped: number;
  // 05-07 engine-fix: single-valued now that the worker's pickAsrDevice()
  // never selects WebGPU (see src/workers/whisper.worker.ts) — a
  // "webgpu" | "wasm" union here would be a lie a caller could branch on.
  device?: "wasm";
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

/** The D-44 pre-flight warm-up's outcome. Never a rejection — see `warmUpWhisper`. */
export interface WarmupResult {
  ok: boolean;
  // 05-07 engine-fix: single-valued for the same reason `TranscriptionStatus.device`
  // is — `pickAsrDevice()` never selects WebGPU.
  device?: "wasm";
  message?: string;
}

/**
 * D-44's other half: warms the model during the D-37 pre-flight, before a
 * take begins. Constructs a worker exactly the way `startTranscriptionSession`
 * does, from the same `MODEL_ID`/`MODEL_DTYPE` module constants — so this
 * load and the take's own worker load are requesting the identical files and
 * the take's load hits the browser's HTTP cache instead of re-downloading. A
 * divergence between the two would silently make this warm-up pointless.
 *
 * Never throws: a failure resolves `{ ok: false, message }` rather than
 * rejecting, because a missing model is a fact the pre-flight panel reports,
 * not an exception a caller must catch. Always terminates its own worker
 * before resolving, on both the success and failure path — the model's bytes
 * now live in the browser's HTTP cache, which is what makes the take's own
 * worker load fast; keeping this worker alive for the rest of the interview
 * would only hold memory for no benefit.
 */
export function warmUpWhisper(onProgress: (loadedBytes: number, totalBytes: number) => void): Promise<WarmupResult> {
  return new Promise((resolve) => {
    const worker = createWorker();
    let settled = false;

    const finish = (result: WarmupResult) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(result);
    };

    worker.onmessage = (event: MessageEvent<WhisperResponse>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress(message.loadedBytes, message.totalBytes);
        return;
      }
      if (message.type === "ready") {
        finish({ ok: true, device: message.device });
        return;
      }
      if (message.type === "error") {
        finish({ ok: false, message: message.message });
        return;
      }
    };
    worker.onerror = () => {
      finish({ ok: false, message: "The transcription model failed to load." });
    };
    worker.onmessageerror = () => {
      finish({ ok: false, message: "The transcription model sent an unreadable message while loading." });
    };

    worker.postMessage({ type: "load" } satisfies WhisperRequest);
  });
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
      gatedWindows: 0,
      silentChunksDropped: 0,
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
  // Keyed by `${startMs}:${endMs}`, never `startMs` alone (the regression
  // this fixes) — `eligibleWindows` only ever surfaces a window once its
  // boundaries are immutable, so a window's key never repeats once
  // dispatched, and a still-open window never enters this set at all.
  const dispatchedWindowKeys = new Set<string>();
  const pendingWindowIds = new Set<string>();
  // T-05-13: per-dispatched-window metadata (its own endMs and which span it
  // belongs to), keyed by request id — populated in `dispatchWindowsUpTo`,
  // read back in `handleResult`. Results can arrive out of order (a gated
  // window returns near-instantly while a 25s window is still inferring),
  // so this is the only reliable way to know a result's span once it lands.
  const pendingWindowMeta = new Map<string, { endMs: number; spanStartMs: number }>();
  // T-05-13: the highest chunk `endMs` already accepted (post-dedup) per
  // span, keyed by that span's own `startMs`. A brand-new span key starts
  // absent from this map — reads as 0 below — which is the "reset at a span
  // boundary" D-46/D-47 requires: the first line of a new speaker's turn
  // must never be mistaken for a seam duplicate of the previous speaker.
  const spanWrittenEndMs = new Map<number, number>();

  let nextSeq = await nextSegmentSeq(sessionId);
  let dispatchedThroughMs = 0;
  // T-05-13: the highest point in the take's timeline the transcript is
  // provably caught up through — not just the highest WRITTEN segment end.
  // Advanced by every processed result, gated or not, to the window's own
  // endMs (see `handleResult`), so a long silent stretch (all gated
  // windows, no segments at all) still reads as "caught up", not as a
  // stalled transcriber (D-57).
  let newestSegmentEndMs = 0;
  let backlogDroppedMs = 0;
  // T-05-12/T-05-13: folded from each result's own `gated`/`silentChunks`
  // fields into the session status (Task 1's gate surfaced, not swallowed).
  let gatedWindows = 0;
  let silentChunksDropped = 0;
  let anyWindowErrored = false;
  let workerReady = false;
  let workerDead = false;
  let modelDevice: "wasm" | undefined;
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
      gatedWindows,
      silentChunksDropped,
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
      gatedWindows: 0,
      silentChunksDropped: 0,
      message: "The microphone tap for transcription could not be created. The recording itself is unaffected.",
    });
    db.close();
    return null;
  }

  const worker = createWorker();

  /**
   * Dispatches every FINAL window up to `boundaryMs` — see `eligibleWindows`
   * in `windowCutting.ts` for why only a window that cannot change identity
   * on a later call is ever surfaced here. `final: false` (the live tick)
   * withholds the still-growing trailing window; `final: true` (`finish()`,
   * where `boundaryMs` is the take's true end and nothing can grow further)
   * dispatches everything, including that last window.
   */
  function dispatchWindowsUpTo(boundaryMs: number, options: { final: boolean }) {
    const spans = deriveSpans(presses, boundaryMs);
    const windows = eligibleWindows(spans, SPAN_FLOOR_MS, MAX_WINDOW_MS, WINDOW_OVERLAP_MS, options.final);
    const bufferEndMs = bufferStartMs + (bufferSampleCount / TARGET_SAMPLE_RATE) * 1000;

    // T-05-13: which span each window belongs to, walked fresh from this
    // call's own windows array. `eligibleWindows` guarantees every window
    // before the trailing one is immutable once returned, so this prefix is
    // stable call over call — consecutive sub-windows of one span overlap
    // by `WINDOW_OVERLAP_MS`, so a window whose `startMs` lands at or past
    // the previous window's `endMs` is always the first sub-window of the
    // NEXT merged span, never a continuation of the current one.
    let spanStartMs = windows.length > 0 ? windows[0].startMs : 0;

    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];
      if (i > 0 && window.startMs >= windows[i - 1].endMs) {
        spanStartMs = window.startMs;
      }

      const key = `${window.startMs}:${window.endMs}`;
      if (dispatchedWindowKeys.has(key)) continue;
      if (window.endMs > bufferEndMs) continue; // not yet fully buffered — retried on a later tick

      dispatchedWindowKeys.add(key);
      dispatchedThroughMs = Math.max(dispatchedThroughMs, window.endMs);

      const buffer = materializeBuffer();
      const pcm = sliceByTime(buffer, bufferStartMs, window.startMs, window.endMs, TARGET_SAMPLE_RATE);
      if (pcm.length === 0) continue; // nothing usable — e.g. this range has already been dropped

      const id = crypto.randomUUID();
      pendingWindowIds.add(id);
      pendingWindowMeta.set(id, { endMs: window.endMs, spanStartMs });
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
    const meta = pendingWindowMeta.get(message.id);
    pendingWindowMeta.delete(message.id);

    if (message.gated) gatedWindows++;
    silentChunksDropped += message.silentChunks;

    if (meta) {
      // T-05-13: dedupe against the highest end actually WRITTEN so far for
      // this span — not against "the previous dispatch". Results can arrive
      // out of order (a gated window returns near-instantly while a 25s
      // window ahead of it is still inferring), so dispatch order is not a
      // safe ordering cue; a result for a window this session has no
      // metadata for (already superseded, or a stray duplicate message) is
      // ignored below rather than guessed at.
      const previousWrittenEndMs = spanWrittenEndMs.get(meta.spanStartMs) ?? 0;
      const dedupedChunks = dropSeamDuplicates(message.chunks, previousWrittenEndMs);

      for (const chunk of dedupedChunks) {
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
          onSegment(segment);
        } catch {
          anyWindowErrored = true;
        }
      }

      // The window's own endMs proves coverage through that point even when
      // it produced no (or no surviving) chunks — a gated or all-silent
      // window still means "the transcript is caught up to here", which is
      // exactly what the NEXT sub-window's seam rule needs and what keeps a
      // long quiet stretch from reading as a stalled transcriber (D-57).
      const coveredThroughMs = dedupedChunks.reduce((max, chunk) => Math.max(max, chunk.endMs), meta.endMs);
      spanWrittenEndMs.set(meta.spanStartMs, Math.max(previousWrittenEndMs, coveredThroughMs));
      if (coveredThroughMs > newestSegmentEndMs) newestSegmentEndMs = coveredThroughMs;
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
      dispatchWindowsUpTo(settledMs, { final: false });
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
      // can arrive. `final: true` also dispatches the trailing window that
      // every live tick withholds, since nothing can grow it further now.
      dispatchWindowsUpTo(finalMs, { final: true });
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
