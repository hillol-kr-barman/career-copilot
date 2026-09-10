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
 * Whisper's native window is 30s; 25s leaves room for `WINDOW_OVERLAP_MS`
 * without engaging the pipeline's own internal chunking, which would change
 * the timestamp-relative-to-buffer semantics `05-RESEARCH.md` Pattern 3
 * depends on.
 */
export const MAX_WINDOW_MS = 25000;

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
    return [{ startMs: spans[0].startMs, endMs: spans[spans.length - 1].endMs, speaker: spans[0].speaker }];
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
export function subdivideSpan(span: TagSpan, maxWindowMs: number, overlapMs: number): TranscriptWindow[] {
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
  overlapMs: number
): TranscriptWindow[] {
  const merged = mergeSubFloorSpans(spans, floorMs);
  const windows: TranscriptWindow[] = [];
  for (const span of merged) {
    windows.push(...subdivideSpan(span, maxWindowMs, overlapMs));
  }
  return windows;
}

/**
 * The overlap de-duplication rule, expressed on midpoints: keep an item when
 * `(startMs + endMs) / 2 >= previousEndMs`. Midpoint rather than `startMs`
 * because a sentence that begins inside the overlap but mostly lives after
 * it belongs to the new window.
 */
export function dropSeamDuplicates<T extends { startMs: number; endMs: number }>(
  incoming: T[],
  previousEndMs: number
): T[] {
  return incoming.filter((item) => (item.startMs + item.endMs) / 2 >= previousEndMs);
}
