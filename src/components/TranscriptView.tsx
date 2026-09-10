import React, { useEffect, useRef } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { TranscriptTurn } from "../types";
import type { TranscriptionStatus } from "../lib/transcriptionSession";
import { formatElapsed } from "../lib/formatTime";
import { SPEAKER_LABEL } from "./SpeakerBanner";

/** Rounds a lag reading down to the nearest whole second for display. */
const formatLagSeconds = (lagMs: number): string => `${Math.max(0, Math.floor(lagMs / 1000))}s`;

/** Rounds a stall duration down to the nearest whole second for display. */
const formatStallSeconds = (lagMs: number): string => `${Math.max(0, Math.floor(lagMs / 1000))} seconds`;

export interface TranscriptViewProps {
  /** Segments grouped into speaker turns (`groupIntoTurns`, D-48's display unit). */
  turns: TranscriptTurn[];
  /** Null before a session has ever started for this take. */
  status: TranscriptionStatus | null;
  /** True while the take is actively recording — the only state that auto-scrolls. */
  isRecording: boolean;
  /** How many stored transcript records failed validation on read (T-05-03) — a shorter transcript must never pass for a complete one. */
  skippedCount: number;
}

/**
 * D-56's second zone: the transcript builds beneath `SpeakerBanner`, in
 * normal reading type, never competing with the banner's across-the-table
 * legibility. Follows `RecordingDownloads.tsx`'s file shape exactly — a list
 * component plus a per-item subcomponent (`TranscriptTurnRow`) — and its card
 * language.
 */
export const TranscriptView: React.FC<TranscriptViewProps> = ({ turns, status, isRecording, skippedCount }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // D-56: auto-scroll to the newest line only while recording — an operator
  // reading back after Stop must never be fought for scroll position.
  useEffect(() => {
    if (!isRecording) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns.length, isRecording]);

  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-[rgba(255,255,255,0.07)] bg-[#1c2128] p-4">
      <StatusLine status={status} />

      {skippedCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            {skippedCount === 1
              ? "1 stored line could not be read."
              : `${skippedCount} stored lines could not be read.`}
          </span>
        </div>
      )}

      {turns.length === 0 ? (
        <p className="text-xs text-[#9aa3b0] leading-relaxed">
          {isRecording
            ? "Lines appear here as each speaker finishes a turn."
            : "This take has no transcript."}
        </p>
      ) : (
        <div ref={scrollRef} className="flex flex-col gap-2.5 max-h-80 overflow-y-auto">
          {turns.map((turn, index) => (
            <TranscriptTurnRow key={`${turn.startMs}-${index}`} turn={turn} />
          ))}
        </div>
      )}
    </div>
  );
};

interface StatusLineProps {
  status: TranscriptionStatus | null;
}

/** The D-57 header line — worded per-phase so a stall can never read as "merely slow". */
const StatusLine: React.FC<StatusLineProps> = ({ status }) => {
  if (!status) return null;

  let text: string;
  switch (status.phase) {
    case "loading":
      text = "Loading the transcription model — audio is being held and will be transcribed once it's ready.";
      break;
    case "live":
      text = `Transcript is ~${formatLagSeconds(status.lagMs)} behind.`;
      break;
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
        className={`flex items-center gap-2 text-xs font-semibold ${
          isFailed ? "text-red-400" : isStalled ? "text-amber-400" : "text-[#9aa3b0]"
        }`}
      >
        {status.phase === "loading" && <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />}
        {(isFailed || isStalled) && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
        <span>{text}</span>
      </div>
      {status.backlogDroppedMs > 0 && (
        <span className="text-[11px] text-amber-400">
          {Math.round(status.backlogDroppedMs / 1000)}s of audio could not be held while the model loaded.
        </span>
      )}
    </div>
  );
};

interface TranscriptTurnRowProps {
  turn: TranscriptTurn;
}

/** One speaker turn: its start time, the speaker's name, and the joined text of every segment in the run. */
const TranscriptTurnRow: React.FC<TranscriptTurnRowProps> = ({ turn }) => {
  const text = turn.segments.map((segment) => segment.text.trim()).join(" ");

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-mono text-[#6b7685] shrink-0">{formatElapsed(turn.startMs)}</span>
        <span className="text-xs font-semibold text-[#eef0f3]">{SPEAKER_LABEL[turn.speaker]}</span>
      </div>
      <p className="text-sm text-[#c7ccd4] leading-relaxed pl-[3.25rem]">{text}</p>
    </div>
  );
};
