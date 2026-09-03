import React, { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import type { RecordingSession, StreamRole } from "../types";

export interface CrashRecoveryPromptProps {
  session: RecordingSession;
  /** The highest chunk timestamp observed for the recovered session, in ms. */
  capturedDurationMs: number;
  /** Per-stream chunk counts — not shown directly, kept for future context. */
  chunkCounts: Partial<Record<StreamRole, number>>;
  onResume: () => void;
  onDiscard: () => void;
}

const formatCapturedDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

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
 * Offered when `findResumableSession` finds a session still marked
 * `"recording"` on mount — a crash or a reload left it unfinished. Can
 * appear with no user action at all, on a page load, so its mount is
 * announced through an `aria-live="polite"` region.
 */
export const CrashRecoveryPrompt: React.FC<CrashRecoveryPromptProps> = ({
  session,
  capturedDurationMs,
  onResume,
  onDiscard,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);

  const relativeTime = formatRelativeTime(session.startedAt);
  const duration = formatCapturedDuration(capturedDurationMs);

  return (
    <div aria-live="polite">
      <div className="w-full rounded-[8px] border border-[rgba(255,255,255,0.07)] bg-[#1c2128] p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-[6px] shrink-0 border bg-amber-500/10 border-amber-500/20 text-amber-400">
            <RotateCcw className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#eef0f3]">Recover your last recording?</h3>
            <p className="text-sm text-[#9aa3b0] leading-relaxed mt-1">
              Your last recording session ({relativeTime}, {duration} captured) didn't finish
              cleanly — the tab may have crashed or closed. You can pick up where you left off, or
              discard it and start fresh. You may lose the last few seconds of audio from before
              the interruption.
            </p>
          </div>
        </div>

        {isConfirming ? (
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={onDiscard}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[5px] bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-all active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Yes, discard
            </button>
            <button
              type="button"
              onClick={() => setIsConfirming(false)}
              className="px-3 py-2 rounded-[5px] border border-[rgba(255,255,255,0.07)] text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#161a1e] text-xs font-semibold transition-all active:scale-95"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setIsConfirming(true)}
              className="px-4 py-2.5 rounded-[6px] border border-[rgba(255,255,255,0.07)] text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#161a1e] text-xs font-semibold transition-all active:scale-95"
            >
              Discard and start new
            </button>
            <button
              type="button"
              onClick={onResume}
              className="px-4 py-2.5 rounded-[6px] bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-xs uppercase tracking-widest transition-all active:scale-[0.98]"
            >
              Resume this session
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
