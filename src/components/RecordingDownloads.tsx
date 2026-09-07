import React from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import type { StreamRole, StreamSummary } from "../types";
import { TIMESLICE_MS } from "../lib/recorderPair";

const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatSizeMb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/**
 * Extension the container the file actually holds — `pickSupportedMimeType`
 * can negotiate the Ogg fallback, so a filename that always says `.webm`
 * mislabels an Ogg file whenever that path is exercised (WR-03).
 */
const extensionForMimeType = (mimeType: string): string =>
  mimeType.includes("ogg") ? "ogg" : "webm";

/**
 * The filename still follows the stream's role, not the visitor's own
 * (D-19) — and now the extension follows the session's negotiated
 * container rather than a static assumption.
 */
const filenameForRole = (role: StreamRole, mimeType: string): string =>
  `${role}-audio.${extensionForMimeType(mimeType)}`;

/**
 * No interviewer bytes were ever captured — the tab share almost certainly
 * had "Share tab audio" unticked (Copywriting Contract). Only the
 * interviewer slot can hit this: the candidate's own microphone is verified
 * live before recording starts, so this reason is scoped to the interviewer
 * track only.
 */
const NO_CAPTURE_COPY =
  "No interviewer audio was captured — you likely shared without ticking 'Share tab audio'. Next time, make sure that checkbox is ticked before you confirm sharing.";

/**
 * None of a stream's stored chunks could be read back — storage corruption
 * or eviction, which is agnostic to which physical source recorded the
 * chunk, so either slot can hit this.
 */
const UNREADABLE_COPY =
  "None of this track's stored audio could be read back — this browser's storage may have evicted or corrupted it. There's no file to download for this track.";

type SlotState =
  | { kind: "button"; nearSilent: boolean }
  | { kind: "empty"; reason: "no-capture" | "unreadable" };

/**
 * A stream falls through to the no-button explanatory line when it captured
 * nothing at recording time (interviewer only — `checkNoCapture`) or when
 * none of its stored chunks could be read back (either stream — storage
 * corruption doesn't care which source recorded a chunk). Otherwise it
 * always renders a button; only the interviewer near-silent flag can swap
 * its subtext for the amber badge.
 */
const deriveSlotState = (
  summary: StreamSummary,
  nearSilent: boolean,
  checkNoCapture: boolean
): SlotState => {
  if (checkNoCapture && summary.chunkCount === 0) return { kind: "empty", reason: "no-capture" };
  if (summary.readableCount === 0) return { kind: "empty", reason: "unreadable" };
  return { kind: "button", nearSilent };
};

export interface RecordingDownloadsProps {
  candidateSummary: StreamSummary;
  interviewerSummary: StreamSummary;
  /** True only when the interviewer stream produced bytes but never rose above the near-silence threshold for the whole session. */
  interviewerNearSilent: boolean;
  candidateUnreadableCount: number;
  interviewerUnreadableCount: number;
  /** Per-stream in-flight flag — a pressed button is disabled and spinning while its own assembly runs; the other stream's button is unaffected. */
  downloadingRoles: Partial<Record<StreamRole, boolean>>;
  /** The session's negotiated MIME type — the derived filename's extension follows this container, not a static assumption (WR-03). */
  mimeType: string;
  /** Filename follows the stream's role, not the visitor's own (D-19) — derived from the session's mimeType, e.g. `candidate-audio.webm` or `candidate-audio.ogg`. */
  onDownload: (role: StreamRole, filename: string) => void;
}

/**
 * Renders only once a Stopped session with chunks exists (LIVE-08). Two
 * slots, never padded to three — there are exactly two files. The candidate
 * slot always renders a button unless every one of its stored chunks turned
 * out to be unreadable; the interviewer slot is additionally content-
 * conditional on whether any bytes were captured at all, and carries the
 * mostly-silent badge instead of its normal subtext when applicable.
 */
export const RecordingDownloads: React.FC<RecordingDownloadsProps> = ({
  candidateSummary,
  interviewerSummary,
  interviewerNearSilent,
  candidateUnreadableCount,
  interviewerUnreadableCount,
  downloadingRoles,
  mimeType,
  onDownload,
}) => {
  const candidateState = deriveSlotState(candidateSummary, false, false);
  const interviewerState = deriveSlotState(interviewerSummary, interviewerNearSilent, true);

  const shortfalls: { role: StreamRole; count: number }[] = [];
  if (candidateUnreadableCount > 0) {
    shortfalls.push({ role: "candidate", count: candidateUnreadableCount });
  }
  if (interviewerUnreadableCount > 0) {
    shortfalls.push({ role: "interviewer", count: interviewerUnreadableCount });
  }

  return (
    <div className="flex flex-col gap-4 border-t border-[rgba(255,255,255,0.07)] pt-5">
      <div>
        <h3 className="text-sm font-semibold text-[#eef0f3]">Download your recording</h3>
        <p className="text-xs text-[#6b7685] mt-1">
          Two separate audio files — one per speaker. Nothing was uploaded; these come straight
          from this browser's storage.
        </p>
      </div>

      {shortfalls.map((s) => (
        <div
          key={s.role}
          className="flex items-start gap-2.5 bg-[#1c2128] border border-amber-500/20 rounded-[8px] p-4"
        >
          <div className="p-1.5 rounded-[6px] shrink-0 border bg-amber-500/10 border-amber-500/20 text-amber-400">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <p className="text-xs text-[#9aa3b0] leading-relaxed">
            Part of the {s.role} recording could not be recovered — about {s.count} chunk
            {s.count === 1 ? "" : "s"} (~{Math.round((s.count * TIMESLICE_MS) / 1000)}s) could not
            be read back. The rest of the recording downloaded normally.
          </p>
        </div>
      ))}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DownloadSlot
          role="candidate"
          label="Candidate audio"
          sourceLabel="Your microphone"
          summary={candidateSummary}
          state={candidateState}
          isDownloading={Boolean(downloadingRoles.candidate)}
          filename={filenameForRole("candidate", mimeType)}
          onDownload={onDownload}
        />
        <DownloadSlot
          role="interviewer"
          label="Interviewer audio"
          sourceLabel="Tab audio"
          summary={interviewerSummary}
          state={interviewerState}
          isDownloading={Boolean(downloadingRoles.interviewer)}
          filename={filenameForRole("interviewer", mimeType)}
          onDownload={onDownload}
        />
      </div>

      <p className="text-xs text-[#6b7685]">
        This phase keeps the audio because it's the only artefact so far. From the transcription
        phase onward, keeping audio becomes optional.
      </p>
    </div>
  );
};

interface DownloadSlotProps {
  role: StreamRole;
  label: string;
  sourceLabel: string;
  summary: StreamSummary;
  state: SlotState;
  isDownloading: boolean;
  filename: string;
  onDownload: (role: StreamRole, filename: string) => void;
}

const DownloadSlot: React.FC<DownloadSlotProps> = ({
  role,
  label,
  sourceLabel,
  summary,
  state,
  isDownloading,
  filename,
  onDownload,
}) => {
  if (state.kind === "empty") {
    return (
      <div className="flex items-center px-4 py-3.5 rounded-[6px] border border-[rgba(255,255,255,0.07)] bg-[#1c2128] text-xs text-[#9aa3b0] leading-relaxed">
        {state.reason === "no-capture" ? NO_CAPTURE_COPY : UNREADABLE_COPY}
      </div>
    );
  }

  return (
    <button
      onClick={() => onDownload(role, filename)}
      disabled={isDownloading}
      className="flex items-center gap-3 px-4 py-3.5 rounded-[6px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] transition-all active:scale-[0.98] disabled:opacity-50 text-left"
    >
      {isDownloading ? (
        <RefreshCw className="w-5 h-5 animate-spin shrink-0" />
      ) : (
        <Download className="w-5 h-5 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{isDownloading ? "Preparing…" : label}</span>
        {state.nearSilent ? (
          <span className="block text-[11px] text-amber-400 font-semibold">
            Mostly silent — check before relying on this file
          </span>
        ) : (
          <span className="block text-[11px] text-[#6b7685]">
            {sourceLabel} · {formatElapsed(summary.durationMs)} · ~{formatSizeMb(summary.totalBytes)}{" "}
            MB
          </span>
        )}
      </span>
    </button>
  );
};
