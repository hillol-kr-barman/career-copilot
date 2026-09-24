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
      <div className="w-full rounded-control border border-rule bg-sunken p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-control shrink-0 border bg-warn/10 border-warn/20 text-warn">
            <RotateCcw className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ink">Recover your last recording?</h3>
            <p className="text-[15px] text-ink-soft leading-relaxed mt-1 measure">
              Your last recording session ({relativeTime}) didn't finish cleanly — the tab may have
              crashed or closed. {duration} of audio was recovered, and {marksLine} You can pick up
              where you left off, keep what was captured without continuing it, or discard it and
              start fresh. You may lose the last few seconds from before the interruption.
            </p>
          </div>
        </div>

        {isConfirming ? (
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={onDiscard}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-control bg-mark/10 hover:bg-mark/20 border border-mark/30 text-mark text-[15px] font-semibold transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Yes, discard
            </button>
            <button
              type="button"
              onClick={() => setIsConfirming(false)}
              className="px-3 py-2 rounded-control border border-rule text-ink-soft hover:text-ink hover:bg-surface text-[15px] font-semibold transition-all"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setIsConfirming(true)}
              className="px-4 py-2.5 rounded-control border border-rule text-ink-soft hover:text-ink hover:bg-surface text-[15px] font-semibold transition-all"
            >
              Discard and start new
            </button>
            <button
              type="button"
              onClick={onSaveAsIs}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-control border border-rule text-ink hover:bg-surface text-[15px] font-semibold transition-all"
            >
              <Save className="w-3.5 h-3.5" />
              Keep as-is
            </button>
            <button
              type="button"
              onClick={onResume}
              className="rounded-control bg-solid px-4 py-2.5 text-[15px] font-medium text-solid-ink transition-opacity hover:opacity-90"
            >
              Resume this session
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
