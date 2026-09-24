import React, { useEffect, useRef } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { Speaker, TranscriptTurn } from "../types";
import type { TranscriptionStatus } from "../lib/transcriptionSession";
import { formatElapsed } from "../lib/formatTime";
import { MAX_WINDOW_MS } from "../lib/windowCutting";
import { SPEAKER_LABEL } from "./SpeakerBanner";

/** Rounds a lag reading down to the nearest whole second for display. */
const formatLagSeconds = (lagMs: number): string => `${Math.max(0, Math.floor(lagMs / 1000))}s`;

/** Rounds a stall duration down to the nearest whole second for display. */
const formatStallSeconds = (lagMs: number): string =>
  `${Math.max(0, Math.floor(lagMs / 1000))} seconds`;

export interface TranscriptViewProps {
  /** Segments grouped into speaker turns (`groupIntoTurns`, D-48's display unit). */
  turns: TranscriptTurn[];
  /** Null before a session has ever started for this take. */
  status: TranscriptionStatus | null;
  /** True while the take is actively recording — the only state that auto-scrolls. */
  isRecording: boolean;
  /** How many stored transcript records failed validation on read (T-05-03) — a shorter transcript must never pass for a complete one. */
  skippedCount: number;
  /** D-51: true only once a take is stopped and has segments — the D-50 boundary-move gesture is unavailable while recording. */
  canCorrect: boolean;
  /** Reports the clicked segment's `seq`. The correction rule itself (`moveTurnBoundary`) lives in the section — this component only ever reports what was clicked. */
  onMoveBoundary: (seq: number) => void;
  /** Task 2's pre-flight benchmark factor, threaded through only to distinguish "running behind as expected" from "falling further behind" in the live lag readout below. */
  realtimeFactor?: number;
  /**
   * D-60: the segment a feedback-document evidence quote points at, set by
   * `LiveInterview.tsx` and cleared by it — this component only ever reacts
   * to it and scrolls/highlights the matching line; the jump rule itself
   * (which quote maps to which segment, when it is cleared) lives in the
   * section, exactly as `onMoveBoundary`'s D-50 rule does. `null`/`undefined`
   * means no highlight is active.
   */
  highlightSeq?: number | null;
}

/**
 * D-56's second zone: the transcript builds beneath `SpeakerBanner`, in
 * normal reading type, never competing with the banner's across-the-table
 * legibility. Follows `RecordingDownloads.tsx`'s file shape exactly — a list
 * component plus a per-item subcomponent (`TranscriptTurnRow`) — and its card
 * language.
 *
 * An operator reading back after Stop must never be fought for scroll
 * position (D-56) — `highlightSeq` (D-60) is the one exception, and it only
 * exists once a take is stopped: the effect below is a no-op while
 * `isRecording` is true.
 */
export const TranscriptView: React.FC<TranscriptViewProps> = ({
  turns,
  status,
  isRecording,
  skippedCount,
  canCorrect,
  onMoveBoundary,
  realtimeFactor,
  highlightSeq,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // D-56: auto-scroll to the newest line only while recording — an operator
  // reading back after Stop must never be fought for scroll position.
  useEffect(() => {
    if (!isRecording) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns.length, isRecording]);

  // D-60: the one exception to "never fight the operator for scroll
  // position" above, and it only exists once a take is stopped — this
  // effect does nothing while `isRecording` is true, so the two scroll
  // behaviours can never run in the same tick. Scrolls the inner container
  // only (never the page) by computing the target segment's offset within
  // it directly, rather than `scrollIntoView`, which can also nudge an
  // outer scrollable ancestor.
  useEffect(() => {
    if (isRecording) return;
    if (highlightSeq === null || highlightSeq === undefined) return;
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-segment-seq="${highlightSeq}"]`);
    if (!target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetTopWithinContainer = targetRect.top - containerRect.top + container.scrollTop;
    container.scrollTop =
      targetTopWithinContainer - container.clientHeight / 2 + target.clientHeight / 2;
  }, [highlightSeq, isRecording]);

  return (
    <div className="flex flex-col gap-3 rounded-control border border-rule bg-sunken p-4">
      <StatusLine status={status} realtimeFactor={realtimeFactor} />

      {skippedCount > 0 && (
        <div className="flex items-center gap-2 text-[15px] text-warn">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            {skippedCount === 1
              ? "1 stored line could not be read."
              : `${skippedCount} stored lines could not be read.`}
          </span>
        </div>
      )}

      {/* D-50: the gesture's whole meaning, stated once here rather than
          left to be inferred from a per-line control alone — canCorrect is
          only ever true once the take is stopped (D-51), so this can never
          appear next to a live, still-appending transcript. */}
      {canCorrect && turns.length > 0 && (
        <p className="text-[13px] text-ink-muted leading-relaxed measure">
          Click a line to move the speaker change there. Click a turn's first line to undo it.
        </p>
      )}

      {turns.length === 0 ? (
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          {isRecording
            ? "Lines appear here as each speaker finishes a turn."
            : "This take has no transcript."}
        </p>
      ) : (
        <div ref={scrollRef} className="flex flex-col gap-2.5 max-h-80 overflow-y-auto">
          {turns.map((turn, index) => {
            // D-50: the speaker a boundary-move click on this turn would
            // assign to the lines above it — the previous turn's speaker,
            // or (no previous turn) the other of the two speakers. Exactly
            // the rule `moveTurnBoundary` itself applies, computed here only
            // to word the per-line control honestly.
            const previousSpeaker: Speaker =
              index > 0
                ? turns[index - 1].speaker
                : turn.speaker === "candidate"
                  ? "interviewer"
                  : "candidate";
            return (
              <TranscriptTurnRow
                key={`${turn.startMs}-${index}`}
                turn={turn}
                previousSpeaker={previousSpeaker}
                canCorrect={canCorrect}
                onMoveBoundary={onMoveBoundary}
                highlightSeq={highlightSeq}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

interface StatusLineProps {
  status: TranscriptionStatus | null;
  realtimeFactor?: number;
}

/**
 * Task 2: distinguishes "running behind as expected" from "falling further
 * behind" for the live lag readout, using the pre-flight's own measured
 * `realtimeFactor` as the yardstick. A window's own processing time is
 * roughly `MAX_WINDOW_MS * realtimeFactor` on this machine — the same
 * arithmetic `MicSetup`'s pre-flight sentence uses — so an actual live lag
 * more than double that expected value means the transcript is falling
 * further behind than the measurement predicted, not merely oscillating
 * around it. Returns null when there is no measurement to compare against
 * (benchmark failed or not yet run) or the machine is expected to keep up in
 * real time, in which case the bare lag figure already says enough.
 */
function describeLiveLagExpectation(
  lagMs: number,
  realtimeFactor: number | undefined,
): string | null {
  if (realtimeFactor === undefined || realtimeFactor <= 1) return null;
  const expectedLagMs = MAX_WINDOW_MS * realtimeFactor;
  return lagMs > expectedLagMs * 2
    ? "This is falling further behind than this machine measured."
    : "This is running behind as expected on this machine.";
}

/** The D-57 header line — worded per-phase so a stall can never read as "merely slow". */
const StatusLine: React.FC<StatusLineProps> = ({ status, realtimeFactor }) => {
  if (!status) return null;

  let text: string;
  switch (status.phase) {
    case "loading":
      text =
        "Loading the transcription model — audio is being held and will be transcribed once it's ready.";
      break;
    case "live": {
      text = `Transcript is ~${formatLagSeconds(status.lagMs)} behind.`;
      const expectation = describeLiveLagExpectation(status.lagMs, realtimeFactor);
      if (expectation) text = `${text} ${expectation}`;
      break;
    }
    case "stalled":
      text = `The transcriber has stopped responding — no line in the last ${formatStallSeconds(status.lagMs)}. The recording is unaffected.`;
      break;
    case "draining":
      text = "Finishing the last few lines…";
      break;
    case "failed":
      text = `Transcription failed${status.message ? `: ${status.message}` : "."} The recording itself is unaffected.`;
      break;
    case "done":
      text = "Transcription finished for this take.";
      break;
    default:
      text = "";
  }

  const isFailed = status.phase === "failed";
  const isStalled = status.phase === "stalled";

  return (
    <div className="flex flex-col gap-1">
      <div
        className={`flex items-center gap-2 text-[15px] font-semibold ${
          isFailed ? "text-mark" : isStalled ? "text-warn" : "text-ink-soft"
        }`}
      >
        {status.phase === "loading" && <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />}
        {(isFailed || isStalled) && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
        <span>{text}</span>
      </div>
      {status.backlogDroppedMs > 0 && (
        <span className="text-[13px] text-warn">
          {Math.round(status.backlogDroppedMs / 1000)}s of audio could not be held while the model
          loaded.
        </span>
      )}
    </div>
  );
};

interface TranscriptTurnRowProps {
  turn: TranscriptTurn;
  /** The speaker a boundary-move click on this turn would assign to the lines above the click (D-50). */
  previousSpeaker: Speaker;
  /** D-51: only true once the take is stopped and has segments — gates whether this turn's lines render as buttons at all. */
  canCorrect: boolean;
  onMoveBoundary: (seq: number) => void;
  /** D-60: the segment a feedback-document evidence quote points at. Reachable states for a highlight and `canCorrect`-true are identical (both gate on the take being stopped with segments), so only the per-segment button path below needs to render it. */
  highlightSeq?: number | null;
}

/**
 * One speaker turn: its start time, the speaker's name, a persistent marker
 * when the turn's label was corrected (D-49 — the correction never hides
 * once made, since the downloaded sidecar goes on describing the room as it
 * was pressed), and the turn's text.
 *
 * While `canCorrect` is true (D-51), each segment renders as its own real
 * `<button type="button">` — keyboard-reachable, and the same Space/Enter
 * activation the Phase 4 spacebar handler already steps aside for on a
 * focused button — so a click on any line reports that line's `seq` upward;
 * the boundary-move rule itself lives in `LiveInterview.tsx`, never here.
 * While recording (`canCorrect` false), the turn renders as plain,
 * non-interactive text — an unusable control on every line during a live
 * take is noise, not an affordance (D-51).
 */
const TranscriptTurnRow: React.FC<TranscriptTurnRowProps> = ({
  turn,
  previousSpeaker,
  canCorrect,
  onMoveBoundary,
  highlightSeq,
}) => {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-mono text-ink-muted shrink-0">
          {formatElapsed(turn.startMs)}
        </span>
        <span className="text-[15px] font-semibold text-ink">{SPEAKER_LABEL[turn.speaker]}</span>
        {turn.corrected && (
          <span
            className="text-xs font-semibold tracking-wide text-warn"
            title="This turn's speaker label was corrected after the take — the recorded tag track and its downloaded sidecar are unchanged"
          >
            Corrected
          </span>
        )}
      </div>

      {canCorrect ? (
        <div className="flex flex-col gap-0.5 pl-[3.25rem]">
          {turn.segments.map((segment) => {
            // D-60: a left border rule plus a background tint — a shape
            // addition, not a colour swap alone, so it stays legible in a
            // greyscale screenshot. Baseline carries a transparent border of
            // the same width so the highlighted state never shifts layout.
            const isHighlighted = segment.seq === highlightSeq;
            return (
              <button
                key={segment.seq}
                type="button"
                data-segment-seq={segment.seq}
                onClick={() => onMoveBoundary(segment.seq)}
                title={`Speaker changes here — the lines above become ${SPEAKER_LABEL[previousSpeaker]}`}
                className={`text-left text-[15px] text-ink-soft leading-relaxed rounded-[3px] -mx-1 px-1 border-l-2 transition-colors hover:bg-accent/10 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  isHighlighted ? "border-l-accent bg-accent/15 text-ink" : "border-l-transparent"
                }`}
              >
                {segment.text.trim()}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-[15px] text-ink-soft leading-relaxed pl-[3.25rem] measure">
          {turn.segments.map((segment) => segment.text.trim()).join(" ")}
        </p>
      )}
    </div>
  );
};
