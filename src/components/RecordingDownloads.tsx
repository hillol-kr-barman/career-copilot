import React, { useState } from "react";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import type { RecordingSession } from "../types";

const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatSizeMb = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);

/** A local date and time, e.g. "Sep 8, 2026, 4:12 PM" — the take's label. */
const formatStartedAt = (startedAt: number): string =>
  new Date(startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Matches `CrashRecoveryPrompt`'s relative-age idiom, reused here for the same reason: a human reads "12 minutes ago" faster than a timestamp. */
const formatRelativeTime = (startedAt: number): string => {
  const diffMinutes = Math.round((Date.now() - startedAt) / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes === 1) return "1 minute ago";
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.round(diffHours / 24);
  return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
};

/**
 * Extension the container the file actually holds — `pickSupportedMimeType`
 * can negotiate the Ogg fallback, so a filename that always says `.webm`
 * mislabels an Ogg file whenever that path is exercised (WR-03).
 */
const extensionForMimeType = (mimeType: string): string => (mimeType.includes("ogg") ? "ogg" : "webm");

/**
 * Pairs a take's two filenames by a shared, sortable basename derived from
 * when it started (D-30) — the sidecar is always `.json` regardless of the
 * audio container, so a pair stays unambiguous on disk even with several
 * takes downloaded.
 */
export const basenameForSession = (startedAt: number): string => {
  const iso = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  return `interview-${iso}`;
};

export interface RecordingDownloadsProps {
  /** Every stopped take, newest-first — already sorted by `listStoppedSessions`. */
  takes: RecordingSession[];
  /** In-flight flag keyed by `${sessionId}:audio` or `${sessionId}:sidecar` — an audio download and a sidecar download of the same take never block each other, and neither blocks another take's downloads. */
  downloading: Record<string, boolean>;
  /** In-flight delete flag keyed by sessionId — guards a second concurrent press on the same take. */
  deletingIds: Record<string, boolean>;
  /** True while a take is being recorded — suppresses the empty-state copy so "No recordings yet" doesn't show while one is already under way. */
  hasActiveTake: boolean;
  onDownloadAudio: (sessionId: string, filename: string) => void;
  onDownloadSidecar: (sessionId: string, filename: string) => void;
  onDeleteTake: (sessionId: string) => void;
}

/**
 * The download surface (LIVE-08, D-31, D-32): every finished take, newest
 * first, each with its own audio download, its own tag-track sidecar
 * download, and its own delete control. No cap, no oldest-take badge, no
 * storage-pressure warning, and no automatic removal of anything — nothing
 * stored here is ever deleted except by that take's own delete control, or
 * by the app-wide "Clear stored data".
 */
export const RecordingDownloads: React.FC<RecordingDownloadsProps> = ({
  takes,
  downloading,
  deletingIds,
  hasActiveTake,
  onDownloadAudio,
  onDownloadSidecar,
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
          Two files per take — the audio, and a JSON tag track of who was speaking when. Nothing
          was uploaded; these come straight from this browser's storage.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {takes.map((take) => (
          <TakeRow
            key={take.sessionId}
            take={take}
            isDownloadingAudio={Boolean(downloading[`${take.sessionId}:audio`])}
            isDownloadingSidecar={Boolean(downloading[`${take.sessionId}:sidecar`])}
            isDeleting={Boolean(deletingIds[take.sessionId])}
            onDownloadAudio={onDownloadAudio}
            onDownloadSidecar={onDownloadSidecar}
            onDeleteTake={onDeleteTake}
          />
        ))}
      </div>

      <p className="text-xs text-[#6b7685]">
        This phase keeps the audio because it's the only artefact so far. From the transcription
        phase onward, keeping audio becomes optional.
      </p>
    </div>
  );
};

interface TakeRowProps {
  take: RecordingSession;
  isDownloadingAudio: boolean;
  isDownloadingSidecar: boolean;
  isDeleting: boolean;
  onDownloadAudio: (sessionId: string, filename: string) => void;
  onDownloadSidecar: (sessionId: string, filename: string) => void;
  onDeleteTake: (sessionId: string) => void;
}

/**
 * One stopped take's row: its start time and relative age, its duration and
 * size, and its three controls — download audio, download the tag-track
 * sidecar, and delete this take. Every row gets the same treatment
 * regardless of position (D-31) — no "newest" badge, no special styling for
 * the top row.
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
  isDownloadingAudio,
  isDownloadingSidecar,
  isDeleting,
  onDownloadAudio,
  onDownloadSidecar,
  onDeleteTake,
}) => {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const basename = basenameForSession(take.startedAt);
  const audioFilename = `${basename}.${extensionForMimeType(take.mimeType)}`;
  const sidecarFilename = `${basename}.json`;
  const takeLabel = `${formatStartedAt(take.startedAt)} (${formatRelativeTime(take.startedAt)})`;

  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-[rgba(255,255,255,0.07)] bg-[#1c2128] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-[#eef0f3]">{takeLabel}</span>
        <span className="text-xs text-[#6b7685]">
          {formatElapsed(take.durationMs)} · ~{formatSizeMb(take.sizeBytes ?? 0)} MB
        </span>
      </div>

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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <DownloadButton
            label="Audio"
            isDownloading={isDownloadingAudio}
            onClick={() => onDownloadAudio(take.sessionId, audioFilename)}
          />
          <DownloadButton
            label="Tag track (JSON)"
            isDownloading={isDownloadingSidecar}
            onClick={() => onDownloadSidecar(take.sessionId, sidecarFilename)}
          />
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
