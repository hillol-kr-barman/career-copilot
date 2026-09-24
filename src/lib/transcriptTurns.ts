import type { Speaker, TranscriptSegment, TranscriptTurn } from "../types";

/**
 * Turn grouping and the D-50 boundary-move correction. Pure — touches no
 * browser global — so `scripts/check-tag-track.ts` can import and assert it
 * under Node, the same discipline `windowCutting.ts` follows.
 */

/**
 * The effective speaker for a segment: `resolvedSpeaker ?? speaker` (D-49).
 * Every consumer in this phase reads attribution through this one function;
 * none re-derives it from spans.
 */
export function effectiveSpeaker(segment: TranscriptSegment): Speaker {
  return segment.resolvedSpeaker ?? segment.speaker;
}

/**
 * D-48's display unit: sorts a shallow copy by `startMs` with `seq` as the
 * tiebreak, then groups maximal runs of consecutive segments sharing an
 * `effectiveSpeaker`. A turn's `startMs` is its first segment's, `endMs` its
 * last segment's, and `corrected` is true when any member segment carries a
 * `resolvedSpeaker`. Empty input returns an empty array. Storage stays at
 * sentence granularity — this function only changes how it is displayed.
 */
export function groupIntoTurns(segments: TranscriptSegment[]): TranscriptTurn[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);

  const turns: TranscriptTurn[] = [];
  for (const segment of sorted) {
    const speaker = effectiveSpeaker(segment);
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) {
      last.endMs = segment.endMs;
      last.segments.push(segment);
      if (segment.resolvedSpeaker !== undefined) last.corrected = true;
    } else {
      turns.push({
        speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
        segments: [segment],
        corrected: segment.resolvedSpeaker !== undefined,
      });
    }
  }
  return turns;
}

/**
 * D-50, expressed exactly: the operator clicks a line and says the speaker
 * changes *there*; the lines above it rejoin the previous turn. Works on a
 * copy sorted by `startMs`/`seq`; never mutates the input and never writes
 * to `speaker` — only `resolvedSpeaker` changes, preserving D-49's
 * immutable tag-track history.
 *
 * - Unknown `targetSeq`: no-op, returning a new array in the input's
 *   original order.
 * - The target is strictly after its run's first segment (`turnStart`): the
 *   boundary moves down to the target. Every segment from `turnStart` up to
 *   (not including) the target gets `resolvedSpeaker` set to the previous
 *   turn's speaker; the target and everything after it in the run are
 *   untouched. This is the mistimed-press case — the leading line or two of
 *   a turn belonged to the previous speaker.
 * - The target IS `turnStart`: the boundary is already there, so the
 *   gesture means there is no boundary here at all — every segment of the
 *   run gets `resolvedSpeaker` set to the previous turn's speaker. This is
 *   D-50's whole-turn flip.
 * - `turnStart === 0`: there is no previous turn, so "the previous speaker"
 *   is the other of the two speakers. Both branches above apply exactly the
 *   same way against that other speaker — this is the wrong-D-25-opening
 *   case.
 *
 * Returns a new array in the input's original order, with `resolvedSpeaker`
 * set only on the segments that changed.
 */
export function moveTurnBoundary(
  segments: TranscriptSegment[],
  targetSeq: number,
): TranscriptSegment[] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);

  const targetIndex = sorted.findIndex((segment) => segment.seq === targetSeq);
  if (targetIndex === -1) {
    return [...segments];
  }

  const targetSpeaker = effectiveSpeaker(sorted[targetIndex]);

  let turnStart = targetIndex;
  while (turnStart > 0 && effectiveSpeaker(sorted[turnStart - 1]) === targetSpeaker) {
    turnStart--;
  }
  let turnEnd = targetIndex;
  while (turnEnd < sorted.length - 1 && effectiveSpeaker(sorted[turnEnd + 1]) === targetSpeaker) {
    turnEnd++;
  }

  const otherSpeaker: Speaker = targetSpeaker === "candidate" ? "interviewer" : "candidate";
  const previousSpeaker: Speaker =
    turnStart > 0 ? effectiveSpeaker(sorted[turnStart - 1]) : otherSpeaker;

  const result = sorted.map((segment) => ({ ...segment }));

  if (targetIndex > turnStart) {
    // Mistimed press: only the leading segments before the target moved.
    for (let i = turnStart; i < targetIndex; i++) {
      result[i].resolvedSpeaker = previousSpeaker;
    }
  } else {
    // targetIndex === turnStart: no boundary here at all — the whole run
    // merges into the previous turn.
    for (let i = turnStart; i <= turnEnd; i++) {
      result[i].resolvedSpeaker = previousSpeaker;
    }
  }

  const bySeq = new Map(result.map((segment) => [segment.seq, segment]));
  return segments.map((segment) => bySeq.get(segment.seq) ?? segment);
}
