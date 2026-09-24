import React, { useState } from "react";
import { Download, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import type { RecordingSession } from "../types";
import { extensionForMimeType } from "../lib/recorder";
import { formatElapsed, formatRelativeTime } from "../lib/formatTime";

const formatSizeMb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/**
 * A local date and time, e.g. "Sep 8, 2026, 4:12 PM" — the take's label.
 * Exported so `LiveInterview.tsx` can name which take is on screen (D-71)
 * with the exact same label this file's own rows use.
 */
export const formatStartedAt = (startedAt: number): string =>
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
  /** In-flight flag keyed by `${sessionId}:audio`, `${sessionId}:sidecar`, `${sessionId}:transcript`, or `${sessionId}:analyse` — none of a take's four actions ever blocks another, and none blocks another take's actions. */
  downloading: Record<string, boolean>;
  /** In-flight delete flag keyed by sessionId — guards a second concurrent press on the same take. */
  deletingIds: Record<string, boolean>;
  /** True while a take is being recorded — suppresses the empty-state copy so "No recordings yet" doesn't show while one is already under way. */
  hasActiveTake: boolean;
  /** D-71: every take with at least one stored transcript segment can be analysed — the Analyse control loads that take's segments into `TranscriptView` and points the feedback surface at it. */
  onAnalyseTake: (sessionId: string) => void;
  /** D-71: the take, if any, currently loaded into `TranscriptView`/the feedback surface — marked in its row with a text marker, never colour alone. */
  loadedSessionId: string | null;
  /** D-72: every take with a stored feedback document — its row's Analyse control is relabelled and carries a note that opening it costs nothing further. */
  analysedSessionIds: string[];
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
 *
 * D-71/D-72: also the entry point for analysing any past take, not only the
 * one just recorded. Every take whose `TakeDownloadState` is not
 * `"noTranscript"` gets an Analyse control — relabelled "Analyse again" and
 * annotated once a feedback document is already stored for it (D-72, no
 * further call needed to open it) — and the take currently loaded into
 * `TranscriptView`/the feedback surface is marked with a text badge, never
 * colour alone, matching `TranscriptView`'s own "Corrected" marker.
 */
export const RecordingDownloads: React.FC<RecordingDownloadsProps> = ({
  takes,
  transcriptCounts,
  downloading,
  deletingIds,
  hasActiveTake,
  onAnalyseTake,
  loadedSessionId,
  analysedSessionIds,
  onDownloadAudio,
  onDownloadSidecar,
  onDownloadTranscript,
  onDeleteTake,
}) => {
  if (takes.length === 0) {
    if (hasActiveTake) return null;
    return (
      <div className="flex flex-col gap-2 border-t border-rule pt-5">
        <h3 className="text-[15px] font-semibold text-ink">No recordings yet</h3>
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          Finished takes will appear here, newest first, each with its own downloads.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t border-rule pt-5">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">
          {takes.length === 1 ? "1 recorded take" : `${takes.length} recorded takes`}
        </h3>
        <p className="text-[15px] text-ink-muted mt-1">
          Audio, a tag track of who spoke when, and a transcript — straight from this browser, never
          uploaded.
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
            isAnalysing={Boolean(downloading[`${take.sessionId}:analyse`])}
            isDeleting={Boolean(deletingIds[take.sessionId])}
            isLoaded={take.sessionId === loadedSessionId}
            isAnalysed={analysedSessionIds.includes(take.sessionId)}
            onAnalyseTake={onAnalyseTake}
            onDownloadAudio={onDownloadAudio}
            onDownloadSidecar={onDownloadSidecar}
            onDownloadTranscript={onDownloadTranscript}
            onDeleteTake={onDeleteTake}
          />
        ))}
      </div>

      <p className="text-[15px] text-ink-muted">
        Audio is deleted once its transcript is written, unless keep-audio was ticked; transcripts
        and tag tracks are kept. Only a take's delete control or "Clear stored data" removes them.
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
  isAnalysing: boolean;
  isDeleting: boolean;
  /** D-71: true when this take's id is `loadedSessionId` — the one currently on screen. */
  isLoaded: boolean;
  /** D-72: true when this take already has a stored feedback document. */
  isAnalysed: boolean;
  onAnalyseTake: (sessionId: string) => void;
  onDownloadAudio: (sessionId: string, filename: string) => void;
  onDownloadSidecar: (sessionId: string, filename: string) => void;
  onDownloadTranscript: (sessionId: string, filename: string) => void;
  onDeleteTake: (sessionId: string) => void;
}

/**
 * One stopped take's row: its start time and relative age (plus an "On
 * screen" text marker when this take is the one currently loaded, D-71), its
 * duration and size, a state-specific explanatory line when the take isn't
 * in the plain "audio kept, transcript present" state, and its controls —
 * audio, tag track, transcript, Analyse, and delete, each rendered as a real
 * control or as a same-slot, same-size explanation of why it isn't offered.
 * Every row gets the same treatment regardless of position (D-31) — no
 * "newest" badge, no special styling for the top row.
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
  isAnalysing,
  isDeleting,
  isLoaded,
  isAnalysed,
  onAnalyseTake,
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
    <div className="flex flex-col gap-3 border-t border-rule py-4 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold text-ink">{takeLabel}</span>
          {isLoaded && (
            <span
              className="text-xs font-semibold tracking-wide text-accent"
              title="This take's transcript and feedback surface are currently on screen"
            >
              On screen
            </span>
          )}
        </span>
        <span className="text-[15px] text-ink-muted">
          {formatElapsed(take.durationMs)} · ~{formatSizeMb(take.sizeBytes ?? 0)} MB
        </span>
      </div>

      {state === "audioDeleted" && (
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          Audio deleted once the transcript was written — keep-audio was unticked.
        </p>
      )}
      {state === "incomplete" && (
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          Transcript is partial, so the audio was kept regardless of the keep-audio choice.
        </p>
      )}
      {state === "noTranscript" && (
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          Recorded before this tool could transcribe. Audio and tag track are intact; it cannot be
          transcribed now.
        </p>
      )}
      {isAnalysed && (
        <p className="text-[15px] text-ink-soft leading-relaxed measure">
          A feedback document is already stored for this take — opening it will not cost another
          call.
        </p>
      )}

      {isConfirmingDelete ? (
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <span className="text-[15px] text-ink-soft">
            Delete the {takeLabel} take? This can't be undone.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDeleteTake(take.sessionId)}
              disabled={isDeleting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-control bg-mark/10 hover:bg-mark/20 border border-mark/30 text-mark text-[15px] font-semibold transition-all disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isDeleting ? "Deleting…" : "Yes, delete this take"}
            </button>
            <button
              type="button"
              onClick={() => setIsConfirmingDelete(false)}
              disabled={isDeleting}
              className="px-3 py-2 rounded-control border border-rule text-ink-soft hover:text-ink hover:bg-surface text-[15px] font-semibold transition-all disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
          {state === "noTranscript" ? (
            <UnavailableSlot
              label="Analyse"
              reason="No transcript to analyse — cannot be transcribed now"
            />
          ) : (
            <AnalyseButton
              label={isAnalysed ? "Analyse again" : "Analyse"}
              isAnalysing={isAnalysing}
              onClick={() => onAnalyseTake(take.sessionId)}
            />
          )}
          <button
            type="button"
            onClick={() => setIsConfirmingDelete(true)}
            className="ml-auto inline-flex items-center gap-1.5 text-[15px] text-ink-muted transition-colors hover:text-mark"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
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
      className="inline-flex items-center gap-1.5 text-[15px] text-accent transition-opacity hover:underline underline-offset-4 disabled:opacity-50 disabled:no-underline"
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

interface AnalyseButtonProps {
  label: string;
  isAnalysing: boolean;
  onClick: () => void;
}

/**
 * D-71's per-take entry point into the feedback surface — loads this take's
 * stored segments into `TranscriptView` and points the feedback surface at
 * it. Visually paired with `DownloadButton` (same control language, same
 * disabled-while-in-flight behaviour) but its own icon and busy copy, since
 * "Preparing…" describes a download, not the read this control triggers.
 */
const AnalyseButton: React.FC<AnalyseButtonProps> = ({ label, isAnalysing, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isAnalysing}
      className="inline-flex items-center gap-1.5 text-[15px] text-accent transition-opacity hover:underline underline-offset-4 disabled:opacity-50 disabled:no-underline"
    >
      {isAnalysing ? (
        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
      ) : (
        <Sparkles className="w-4 h-4 shrink-0" />
      )}
      <span>{isAnalysing ? "Loading…" : label}</span>
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
    <span className="inline-flex items-baseline gap-1.5 text-[15px] text-ink-muted" title={reason}>
      <span className="line-through">{label}</span>
      <span className="text-sm">({reason})</span>
    </span>
  );
};
