import React, { useState } from "react";
import { RotateCcw, Save, Trash2 } from "lucide-react";
import type { RecordingSession } from "../types";
import { formatRelativeTime } from "../lib/formatTime";

export interface CrashRecoveryPromptProps {
  session: RecordingSession;
  /** The highest chunk timestamp observed for the recovered session, in ms. */
  capturedDurationMs: number;
  /** How many speaker marks were recovered for this session (04-15). */
  pressCount: number;
  onResume: () => void;
  /** D-29's third door: closes the take at its last durable chunk without resuming it. */
  onSaveAsIs: () => void;
  onDiscard: () => void;
}

const formatCapturedDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
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
  pressCount,
  onResume,
  onSaveAsIs,
  onDiscard,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);

  const relativeTime = formatRelativeTime(session.startedAt);
  const duration = formatCapturedDuration(capturedDurationMs);
  // One stream, one press log — this used to describe a recovery in terms
  // that assumed two never-mixed streams. When the press count is zero the
  // copy says so directly rather than staying silent about the tag track:
  // a take with no crash at all also has "0 marks so far" in the common
  // case of an interview that opened with the interviewer talking, and the
  // operator needs to be able to tell that apart from a corrupt or missing
  // log rather than assuming a complete tag track either way.
  const marksLine =
    pressCount === 0
      ? "No speaker marks were recovered — right now the whole span is attributed to the interviewer, the default opening speaker."
      : `${pressCount} speaker ${pressCount === 1 ? "mark" : "marks"} recovered.`;

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
              Your last recording session ({relativeTime}) didn't finish cleanly — the tab may
              have crashed or closed. {duration} of audio was recovered, and {marksLine} You can
              pick up where you left off, keep what was captured without continuing it, or discard
              it and start fresh. You may lose the last few seconds from before the interruption.
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
              onClick={onSaveAsIs}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-[6px] border border-[rgba(255,255,255,0.07)] text-[#eef0f3] hover:bg-[#161a1e] text-xs font-semibold transition-all active:scale-95"
            >
              <Save className="w-3.5 h-3.5" />
              Keep as-is
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
