import type { TagSpan, TranscriptWindow } from "../types";

/**
 * D-46/D-47 window-cutting algebra. Pure — touches no browser global — so
 * `scripts/check-tag-track.ts` can import and assert it under Node, exactly
 * like `deriveSpans` in `src/lib/recordingStore.ts`.
 *
 * This module consumes `deriveSpans`' output; it never recomputes spans.
 * Two definitions of "where a speaker changes" is exactly the bug class D-46
 * exists to prevent, so `windowCutting.ts` only imports the `TagSpan` type —
 * the caller passes the spans in.
 */

/**
 * D-47's floor. Under two seconds is a backchannel, not a turn; the value is
 * a starting point in the same spirit as `PREFLIGHT_FLOOR_RMS`
 * (`levelMeter.ts`), kept in one place so it can be revised against real
 * takes.
 */
export const SPAN_FLOOR_MS = 1800;

/**
 * The latency knob, and the only one that matters.
 *
 * Must stay under Whisper's native 30s window with room for
 * `WINDOW_OVERLAP_MS`, so the pipeline's own internal chunking never engages —
 * that would change the timestamp-relative-to-buffer semantics
 * `05-RESEARCH.md` Pattern 3 depends on. Both 25s and 8s satisfy that; the
 * choice between them is latency against context.
 *
 * A window is only dispatched once it closes (`eligibleWindows`), so in an
 * uninterrupted turn this value IS the dominant term in how long a line takes
 * to appear:
 *
 *   first line ≈ MAX_WINDOW_MS + SPAN_FLOOR_MS + inference
 *
 * Inference is flat at ~3-5s per call no matter how long the window is,
 * because Whisper pads every window to 30s internally (measured: 2.66s of
 * audio takes ~3.1-4.4s, 18.9s takes ~4.6s). So shrinking the window buys
 * latency almost for free — it does NOT cost proportionally more compute — but
 * it does raise the duty cycle, since each shorter window still costs a full
 * call:
 *
 *   25s -> first line ~32s, ~20% duty      8s -> first line ~15s, ~63% duty
 *   12s -> first line ~19s, ~42% duty      6s -> first line ~13s, ~83% duty
 *
 * 8s is the chosen balance. Going much below it stops keeping up with live
 * speech, and every reduction gives the model less context to disambiguate
 * with, so accuracy softens as this shrinks.
 *
 * Lowering this was only safe once 05-04's energy gate existed: shorter
 * windows contain proportionally more near-silence, and near-silence is
 * exactly what makes Whisper invent text. Do not reduce this further without
 * that gate in place and a real-microphone check of the result.
 */
export const MAX_WINDOW_MS = 8000;

/** Enough context that a word straddling a sub-window seam is transcribed whole in at least one of them. */
export const WINDOW_OVERLAP_MS = 2000;

/** The energy gate's frame size. */
export const SILENCE_FRAME_MS = 100;

/**
 * The energy gate's floor. Sits below `PREFLIGHT_FLOOR_RMS` (0.03) because
 * pre-flight asks "is this loud enough to transcribe well" while this asks
 * the much weaker "is there anything here at all".
 */
export const SILENCE_FLOOR_RMS = 0.012;

/**
 * D-47: a span shorter than `floorMs` is not a boundary at all. It is folded
 * into a neighbour instead of becoming a cut point:
 * - A sub-floor span with a preceding kept span folds backward — that kept
 *   span's `endMs` extends forward to absorb it, and the preceding speaker
 *   keeps the audio.
 * - A leading sub-floor span (no predecessor yet) folds forward instead —
 *   the first kept span's `startMs` moves back to absorb it, keeping the
 *   following speaker.
 * - Consecutive sub-floor spans all fold into the same neighbour (each one
 *   simply extends the fold further).
 * - When every span in the input is sub-floor, there is no boundary
 *   anywhere: the whole return value is one span covering the input's full
 *   range, carrying the first span's speaker.
 *
 * Finishes with the same adjacent-same-speaker merge `deriveSpans` already
 * does, so the output is always a strictly increasing contiguous partition
 * of exactly the input's range.
 */
export function mergeSubFloorSpans(spans: TagSpan[], floorMs: number): TagSpan[] {
  if (spans.length === 0) return [];

  const isSubFloor = (span: TagSpan) => span.endMs - span.startMs < floorMs;

  if (spans.every(isSubFloor)) {
    return [
      {
        startMs: spans[0].startMs,
        endMs: spans[spans.length - 1].endMs,
        speaker: spans[0].speaker,
      },
    ];
  }

  const merged: TagSpan[] = [];
  // The earliest startMs among leading sub-floor spans seen before the first
  // kept span appears — folded forward into that first kept span.
  let pendingLeadStartMs: number | null = null;

  for (const span of spans) {
    if (isSubFloor(span)) {
      if (merged.length === 0) {
        if (pendingLeadStartMs === null) pendingLeadStartMs = span.startMs;
      } else {
        merged[merged.length - 1].endMs = span.endMs;
      }
      continue;
    }

    if (pendingLeadStartMs !== null) {
      merged.push({ startMs: pendingLeadStartMs, endMs: span.endMs, speaker: span.speaker });
      pendingLeadStartMs = null;
    } else {
      merged.push({ ...span });
    }
  }

  const result: TagSpan[] = [];
  for (const span of merged) {
    const last = result[result.length - 1];
    if (last && last.speaker === span.speaker && last.endMs === span.startMs) {
      last.endMs = span.endMs;
    } else {
      result.push({ ...span });
    }
  }
  return result;
}

/**
 * A span at or under `maxWindowMs` yields one window. Longer, it yields
 * windows of `maxWindowMs` advancing by `maxWindowMs - overlapMs`, the last
 * clamped to `span.endMs`; a trailing remainder shorter than `overlapMs` is
 * absorbed by extending the previous window rather than emitted as its own
 * tiny window. Every window carries the parent span's speaker.
 */
export function subdivideSpan(
  span: TagSpan,
  maxWindowMs: number,
  overlapMs: number,
): TranscriptWindow[] {
  const totalMs = span.endMs - span.startMs;
  if (totalMs <= maxWindowMs) {
    return [{ startMs: span.startMs, endMs: span.endMs, speaker: span.speaker }];
  }

  const stepMs = maxWindowMs - overlapMs;
  const windows: TranscriptWindow[] = [];
  let windowStartMs = span.startMs;

  while (windowStartMs < span.endMs) {
    const windowEndMs = Math.min(windowStartMs + maxWindowMs, span.endMs);
    const remainderMs = span.endMs - windowEndMs;

    if (remainderMs > 0 && remainderMs < overlapMs) {
      windows.push({ startMs: windowStartMs, endMs: span.endMs, speaker: span.speaker });
      break;
    }

    windows.push({ startMs: windowStartMs, endMs: windowEndMs, speaker: span.speaker });

    if (windowEndMs >= span.endMs) break;
    windowStartMs += stepMs;
  }

  return windows;
}

/**
 * D-46: the cut points are the tag track's own boundaries, never a fixed
 * grid. `mergeSubFloorSpans` folds sub-floor spans out first, then each
 * remaining span is subdivided in order.
 */
export function planWindows(
  spans: TagSpan[],
  floorMs: number,
  maxWindowMs: number,
  overlapMs: number,
): TranscriptWindow[] {
  const merged = mergeSubFloorSpans(spans, floorMs);
  const windows: TranscriptWindow[] = [];
  for (const span of merged) {
    windows.push(...subdivideSpan(span, maxWindowMs, overlapMs));
  }
  return windows;
}

/**
 * The subset of `planWindows`' output that is safe to dispatch right now —
 * regression fix for a live-tick dispatch bug (see `transcriptionSession.ts`
 * `dispatchWindowsUpTo`). While `boundaryMs` is a live settling cursor (not
 * the take's true end), `deriveSpans` always ends its last span exactly at
 * `boundaryMs`, so the *last* window `planWindows` returns is tied to that
 * still-growing span and can change identity on a later call — `subdivideSpan`
 * can re-fold or re-split it as the span keeps growing. Dispatching it early
 * (the original bug: deduping on `startMs` alone) both under-transcribes the
 * eventual window and permanently blocks the correctly-sized window that
 * later shares its `startMs`.
 *
 * Every window BEFORE that trailing one is immutable the instant it is
 * returned: its boundaries come from either an already-closed span (fixed
 * forever — a press timestamp never changes) or an interior `maxWindowMs`
 * cut inside the still-open span, and once `subdivideSpan` decides not to
 * fold a boundary back (`remainderMs >= overlapMs`), further growth of the
 * open span only grows `remainderMs` further — it never un-decides that cut.
 * So excluding just the trailing window guarantees no window is ever
 * surfaced before its `endMs` is final, without ever re-deriving spans
 * differently from `deriveSpans`/`mergeSubFloorSpans`.
 *
 * Pass `final: true` only when `boundaryMs` is the take's true end (nothing
 * can grow further, e.g. `finish()`'s call) — then every window, including
 * the last, is eligible.
 */
export function eligibleWindows(
  spans: TagSpan[],
  floorMs: number,
  maxWindowMs: number,
  overlapMs: number,
  final: boolean,
): TranscriptWindow[] {
  const windows = planWindows(spans, floorMs, maxWindowMs, overlapMs);
  return final ? windows : windows.slice(0, Math.max(0, windows.length - 1));
}

/**
 * The overlap de-duplication rule, expressed on midpoints: keep an item when
 * `(startMs + endMs) / 2 >= previousEndMs`. Midpoint rather than `startMs`
 * because a sentence that begins inside the overlap but mostly lives after
 * it belongs to the new window.
 */
export function dropSeamDuplicates<T extends { startMs: number; endMs: number }>(
  incoming: T[],
  previousEndMs: number,
): T[] {
  return incoming.filter((item) => (item.startMs + item.endMs) / 2 >= previousEndMs);
}
