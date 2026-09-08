import React from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import type { RecordingSummary } from "../types";
import { TIMESLICE_MS } from "../lib/recorder";

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
 * Pairs a take's two filenames by a shared, sortable basename derived from
 * when it started — the sidecar is always `.json` regardless of the audio
 * container.
 */
export const basenameForSession = (startedAt: number): string => {
  const iso = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  return `interview-${iso}`;
};

/**
 * None of the session's stored chunks could be read back — storage
 * corruption or eviction. There is no file to download for this take.
 */
const UNREADABLE_COPY =
  "None of this recording's stored audio could be read back — this browser's storage may have evicted or corrupted it. There's no file to download for this take.";

export interface RecordingDownloadsProps {
  summary: RecordingSummary;
  unreadableCount: number;
  /** In-flight flag keyed by `${sessionId}:audio` or `${sessionId}:sidecar` — an audio download and a sidecar download of the same take never block each other. */
  downloading: Record<string, boolean>;
  sessionId: string;
  startedAt: number;
  /** The session's negotiated MIME type — the derived audio filename's extension follows this container, not a static assumption (WR-03). */
  mimeType: string;
  onDownloadAudio: (sessionId: string, filename: string) => void;
  onDownloadSidecar: (sessionId: string, filename: string) => void;
}

/**
 * Renders only once a Stopped session with chunks exists (LIVE-08). One
 * take's artifact pair: an audio button and a sidecar button. If every
 * stored chunk turned out to be unreadable, both fall through to the same
 * explanatory line instead.
 */
export const RecordingDownloads: React.FC<RecordingDownloadsProps> = ({
  summary,
  unreadableCount,
  downloading,
  sessionId,
  startedAt,
  mimeType,
  onDownloadAudio,
  onDownloadSidecar,
}) => {
  const basename = basenameForSession(startedAt);
  const audioFilename = `${basename}.${extensionForMimeType(mimeType)}`;
  const sidecarFilename = `${basename}.json`;

  if (summary.readableCount === 0) {
    return (
      <div className="flex flex-col gap-4 border-t border-[rgba(255,255,255,0.07)] pt-5">
        <div className="flex items-center px-4 py-3.5 rounded-[6px] border border-[rgba(255,255,255,0.07)] bg-[#1c2128] text-xs text-[#9aa3b0] leading-relaxed">
          {UNREADABLE_COPY}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t border-[rgba(255,255,255,0.07)] pt-5">
      <div>
        <h3 className="text-sm font-semibold text-[#eef0f3]">Download this take</h3>
        <p className="text-xs text-[#6b7685] mt-1">
          Two files — the audio, and a JSON tag track of who was speaking when. Nothing was
          uploaded; these come straight from this browser's storage.
        </p>
      </div>

      {unreadableCount > 0 && (
        <div className="flex items-start gap-2.5 bg-[#1c2128] border border-amber-500/20 rounded-[8px] p-4">
          <div className="p-1.5 rounded-[6px] shrink-0 border bg-amber-500/10 border-amber-500/20 text-amber-400">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <p className="text-xs text-[#9aa3b0] leading-relaxed">
            Part of this recording could not be recovered — about {unreadableCount} chunk
            {unreadableCount === 1 ? "" : "s"} (~{Math.round((unreadableCount * TIMESLICE_MS) / 1000)}
            s) could not be read back. The rest of the recording downloaded normally.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DownloadButton
          label="Audio"
          sourceLabel={`${formatElapsed(summary.durationMs)} · ~${formatSizeMb(summary.totalBytes)} MB`}
          isDownloading={Boolean(downloading[`${sessionId}:audio`])}
          onClick={() => onDownloadAudio(sessionId, audioFilename)}
        />
        <DownloadButton
          label="Tag track (JSON)"
          sourceLabel="Speaker spans, timed to the audio"
          isDownloading={Boolean(downloading[`${sessionId}:sidecar`])}
          onClick={() => onDownloadSidecar(sessionId, sidecarFilename)}
        />
      </div>

      <p className="text-xs text-[#6b7685]">
        This phase keeps the audio because it's the only artefact so far. From the transcription
        phase onward, keeping audio becomes optional.
      </p>
    </div>
  );
};

interface DownloadButtonProps {
  label: string;
  sourceLabel: string;
  isDownloading: boolean;
  onClick: () => void;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ label, sourceLabel, isDownloading, onClick }) => {
  return (
    <button
      onClick={onClick}
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
        <span className="block text-[11px] text-[#6b7685]">{sourceLabel}</span>
      </span>
    </button>
  );
};
