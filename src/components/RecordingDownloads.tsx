import React, { useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import type { RecordingSession } from "../types";
import { extensionForMimeType } from "../lib/recorder";
import { formatElapsed, formatRelativeTime } from "../lib/formatTime";

const formatSizeMb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/** A local date and time, e.g. "Sep 8, 2026, 4:12 PM" — the take's label. */
const formatStartedAt = (startedAt: number): string =>
  new Date(startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Pairs a take's files by a shared, sortable basename derived from when it
 * started (D-30) — the sidecar is always `.json` and the transcript is
 * always `.txt` regardless of the audio container, so a take's files stay
 * unambiguous on disk even with several takes downloaded.
 */
export const basenameForSession = (startedAt: number): string => {
  const iso = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  return `interview-${iso}`;
};

/**
 * The four states this phase's retention rules and transcription pipeline
 * can put a stopped take in, each rendered with its own honest explanation
 * rather than a silently missing control (05-05 Task 4):
 * - `"kept"` — audio survives (opted in, or the retention gate hasn't run
 *   against it yet), and a transcript exists.
 * - `"audioDeleted"` — the D-52/D-53 retention gate already removed the
 *   audio; the transcript and tag track are unaffected.
 * - `"incomplete"` — the transcript never reached `"complete"` (still
 *   running, or drained with an error/backlog); the retention gate can
 *   never fire for this take, so its audio is guaranteed to still be there.
 * - `"noTranscript"` — a take recorded before this phase existed
 *   (`transcriptStatus` absent/`"none"` and no segments were ever
 *   written); it cannot be transcribed now (D-40).
 */
type TakeDownloadState = "kept" | "audioDeleted" | "incomplete" | "noTranscript";

const classifyTake = (take: RecordingSession, transcriptCount: number): TakeDownloadState => {
  if (take.audioDeleted === true) return "audioDeleted";
  const transcriptStatus = take.transcriptStatus ?? "none";
  if (transcriptStatus === "none" && transcriptCount === 0) return "noTranscript";
  if (transcriptStatus === "complete") return "kept";
  // "running" (the worker hadn't finished draining the instant this list was
  // last refetched) and "incomplete" (an errored window, a dropped backlog,
  // or a crash-recovered take — see `closeRecoveredSession`) both mean the
  // transcript is not provably done, so both read the same to the operator:
  // the audio is guaranteed still there, and the transcript may be partial.
  return "incomplete";
};

export interface RecordingDownloadsProps {
  /** Every stopped take, newest-first — already sorted by `listStoppedSessions`. */
  takes: RecordingSession[];
  /** One segment count per take, keyed by sessionId — distinguishes "no transcript" from "a transcript exists". */
  transcriptCounts: Record<string, number>;
  /** In-flight flag keyed by `${sessionId}:audio`, `${sessionId}:sidecar`, or `${sessionId}:transcript` — none of a take's three downloads ever blocks another, and none blocks another take's downloads. */
  downloading: Record<string, boolean>;
  /** In-flight delete flag keyed by sessionId — guards a second concurrent press on the same take. */
  deletingIds: Record<string, boolean>;
  /** True while a take is being recorded — suppresses the empty-state copy so "No recordings yet" doesn't show while one is already under way. */
  hasActiveTake: boolean;
  onDownloadAudio: (sessionId: string, filename: string) => void;
  onDownloadSidecar: (sessionId: string, filename: string) => void;
  onDownloadTranscript: (sessionId: string, filename: string) => void;
  onDeleteTake: (sessionId: string) => void;
}

/**
 * The download surface (LIVE-08, LIVE-14, D-31, D-32, D-52): every finished
 * take, newest first, each rendered honestly for whichever of the four
 * `TakeDownloadState`s it is actually in. No cap, no oldest-take badge, no
 * storage-pressure warning, and no automatic removal of anything — nothing
 * stored here is ever deleted except by that take's own delete control, the
 * D-52/D-53 retention gate acting on audio alone, or the app-wide "Clear
 * stored data".
 */
export const RecordingDownloads: React.FC<RecordingDownloadsProps> = ({
  takes,
  transcriptCounts,
  downloading,
  deletingIds,
  hasActiveTake,
  onDownloadAudio,
  onDownloadSidecar,
  onDownloadTranscript,
  onDeleteTake,
}) => {
  if (takes.length === 0) {
    if (hasActiveTake) return null;
    return (
      <div className="flex flex-col gap-2 border-t border-[rgba(255,255,255,0.07)] pt-5">
        <h3 className="text-sm font-semibold text-[#eef0f3]">No recordings yet</h3>
        <p className="text-xs text-[#9aa3b0] leading-relaxed">
          Finished takes will appear here, newest first, each with its own downloads.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t border-[rgba(255,255,255,0.07)] pt-5">
      <div>
        <h3 className="text-sm font-semibold text-[#eef0f3]">
          {takes.length === 1 ? "1 recorded take" : `${takes.length} recorded takes`}
        </h3>
        <p className="text-xs text-[#6b7685] mt-1">
          Up to three files per take — the audio, a JSON tag track of who was speaking when, and a
          plain-text transcript. Nothing was uploaded; these come straight from this browser's
          storage.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {takes.map((take) => (
          <TakeRow
            key={take.sessionId}
            take={take}
            transcriptCount={transcriptCounts[take.sessionId] ?? 0}
            isDownloadingAudio={Boolean(downloading[`${take.sessionId}:audio`])}
            isDownloadingSidecar={Boolean(downloading[`${take.sessionId}:sidecar`])}
            isDownloadingTranscript={Boolean(downloading[`${take.sessionId}:transcript`])}
            isDeleting={Boolean(deletingIds[take.sessionId])}
            onDownloadAudio={onDownloadAudio}
            onDownloadSidecar={onDownloadSidecar}
            onDownloadTranscript={onDownloadTranscript}
            onDeleteTake={onDeleteTake}
          />
        ))}
      </div>

      <p className="text-xs text-[#6b7685]">
        A take's audio is deleted once its transcript is complete, unless keep-audio was ticked
        before that take started. The transcript and the tag track are always kept. Nothing here
        is ever removed except by a take's own delete control, or by "Clear stored data".
      </p>
    </div>
  );
};

interface TakeRowProps {
  take: RecordingSession;
  transcriptCount: number;
  isDownloadingAudio: boolean;
  isDownloadingSidecar: boolean;
  isDownloadingTranscript: boolean;
  isDeleting: boolean;
  onDownloadAudio: (sessionId: string, filename: string) => void;
  onDownloadSidecar: (sessionId: string, filename: string) => void;
  onDownloadTranscript: (sessionId: string, filename: string) => void;
  onDeleteTake: (sessionId: string) => void;
}

/**
 * One stopped take's row: its start time and relative age, its duration and
 * size, a state-specific explanatory line when the take isn't in the plain
 * "audio kept, transcript present" state, and its controls — audio, tag
 * track, transcript, and delete, each rendered as a real download or as a
 * same-slot, same-size explanation of why it isn't offered. Every row gets
 * the same treatment regardless of position (D-31) — no "newest" badge, no
 * special styling for the top row.
 *
 * The delete control uses an inline two-step confirm — a first press swaps
 * the row's controls for a confirm-and-cancel pair naming the take it will
 * remove, and only the confirm calls back — reusing `CrashRecoveryPrompt`'s
 * existing confirm interaction rather than a browser dialog (T-04-13-02), so
 * a mis-tap in a list of several takes is recoverable by reading before
 * pressing.
 */
const TakeRow: React.FC<TakeRowProps> = ({
  take,
  transcriptCount,
  isDownloadingAudio,
  isDownloadingSidecar,
  isDownloadingTranscript,
  isDeleting,
  onDownloadAudio,
  onDownloadSidecar,
  onDownloadTranscript,
  onDeleteTake,
}) => {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const basename = basenameForSession(take.startedAt);
  const audioFilename = `${basename}.${extensionForMimeType(take.mimeType)}`;
  const sidecarFilename = `${basename}.json`;
  const transcriptFilename = `${basename}.txt`;
  const takeLabel = `${formatStartedAt(take.startedAt)} (${formatRelativeTime(take.startedAt)})`;
  const state = classifyTake(take, transcriptCount);

  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-[rgba(255,255,255,0.07)] bg-[#1c2128] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-[#eef0f3]">{takeLabel}</span>
        <span className="text-xs text-[#6b7685]">
          {formatElapsed(take.durationMs)} · ~{formatSizeMb(take.sizeBytes ?? 0)} MB
        </span>
      </div>

      {state === "audioDeleted" && (
        <p className="text-xs text-[#9aa3b0] leading-relaxed">
          This take's audio was deleted once its transcript was safely written, because keep-audio
          was left unticked at the consent step. The transcript and tag track are unaffected.
        </p>
      )}
      {state === "incomplete" && (
        <p className="text-xs text-[#9aa3b0] leading-relaxed">
          This take's transcript is partial — the audio was kept because of it, regardless of the
          keep-audio choice.
        </p>
      )}
      {state === "noTranscript" && (
        <p className="text-xs text-[#9aa3b0] leading-relaxed">
          This take was recorded before transcription existed in this tool. Its audio and tag
          track are intact; it cannot be transcribed now.
        </p>
      )}

      {isConfirmingDelete ? (
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <span className="text-xs text-[#9aa3b0]">Delete the {takeLabel} take? This can't be undone.</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDeleteTake(take.sessionId)}
              disabled={isDeleting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[5px] bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isDeleting ? "Deleting…" : "Yes, delete this take"}
            </button>
            <button
              type="button"
              onClick={() => setIsConfirmingDelete(false)}
              disabled={isDeleting}
              className="px-3 py-2 rounded-[5px] border border-[rgba(255,255,255,0.07)] text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#161a1e] text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          {state === "audioDeleted" ? (
            <UnavailableSlot label="Audio" reason="Deleted after transcription" />
          ) : (
            <DownloadButton
              label="Audio"
              isDownloading={isDownloadingAudio}
              onClick={() => onDownloadAudio(take.sessionId, audioFilename)}
            />
          )}
          <DownloadButton
            label="Tag track (JSON)"
            isDownloading={isDownloadingSidecar}
            onClick={() => onDownloadSidecar(take.sessionId, sidecarFilename)}
          />
          {state === "noTranscript" ? (
            <UnavailableSlot label="Transcript" reason="Recorded before transcription existed" />
          ) : (
            <DownloadButton
              label="Transcript"
              isDownloading={isDownloadingTranscript}
              onClick={() => onDownloadTranscript(take.sessionId, transcriptFilename)}
            />
          )}
          <button
            type="button"
            onClick={() => setIsConfirmingDelete(true)}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-[6px] border border-[rgba(255,255,255,0.07)] text-[#9aa3b0] hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 text-xs font-semibold uppercase tracking-widest transition-all active:scale-[0.98]"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete this take
          </button>
        </div>
      )}
    </div>
  );
};

interface DownloadButtonProps {
  label: string;
  isDownloading: boolean;
  onClick: () => void;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ label, isDownloading, onClick }) => {
  return (
    <button
      onClick={onClick}
      disabled={isDownloading}
      className="flex items-center justify-center gap-2 px-4 py-3 rounded-[6px] bg-[rgba(0,212,220,0.08)] hover:bg-[rgba(0,212,220,0.14)] border border-[rgba(0,212,220,0.25)] text-[#00d4dc] transition-all active:scale-[0.98] disabled:opacity-50 text-xs font-semibold uppercase tracking-widest"
    >
      {isDownloading ? (
        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
      ) : (
        <Download className="w-4 h-4 shrink-0" />
      )}
      <span>{isDownloading ? "Preparing…" : label}</span>
    </button>
  );
};

interface UnavailableSlotProps {
  label: string;
  reason: string;
}

/**
 * The same-slot, same-size stand-in for a control this take's state doesn't
 * offer — an audio download replaced once the D-52/D-53 retention gate has
 * deleted it, or a transcript download for a take that predates
 * transcription entirely (D-40, D-43). Never a click target: the operator
 * must see that a control used to be here and why, not find a
 * shorter row and wonder what happened to it.
 */
const UnavailableSlot: React.FC<UnavailableSlotProps> = ({ label, reason }) => {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 px-4 py-3 rounded-[6px] border border-dashed border-[rgba(255,255,255,0.1)] text-center">
      <span className="text-xs font-semibold uppercase tracking-widest text-[#6b7685]">{label}</span>
      <span className="text-[10px] text-[#6b7685] leading-tight">{reason}</span>
    </div>
  );
};
