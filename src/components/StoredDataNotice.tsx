import React, { useState } from "react";
import { HardDrive, Trash2, Check, AlertTriangle } from "lucide-react";

/** The two outcomes a clear attempt can end in — the visitor is told which
 * actually happened rather than always being told "Cleared" (LIVE-09). */
export type ClearOutcome = "cleared" | "incomplete";

interface StoredDataNoticeProps {
  hasResume: boolean;
  hasJobDescription: boolean;
  hasApiKey: boolean;
  hasRecordings: boolean;
  onClear: () => Promise<ClearOutcome>;
}

/**
 * Says what this browser is holding, and offers a way to remove it.
 *
 * The session is deliberately persisted to localStorage so a refresh doesn't
 * cost the candidate their resume. That is the right default, but it leaves a
 * resume and an API key sitting in the browser indefinitely — on a shared or
 * lab machine, the next person inherits both. Until now the only way out was
 * clearing site data through browser settings.
 */
export const StoredDataNotice: React.FC<StoredDataNoticeProps> = ({
  hasResume,
  hasJobDescription,
  hasApiKey,
  hasRecordings,
  onClear,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [justCleared, setJustCleared] = useState(false);
  const [clearIncomplete, setClearIncomplete] = useState(false);

  const stored = [
    hasResume && "your resume",
    hasJobDescription && "the job description",
    hasApiKey && "your API key",
    hasRecordings && "your recordings",
  ].filter(Boolean) as string[];

  const summary =
    stored.length === 0
      ? null
      : stored.length === 1
        ? stored[0]
        : `${stored.slice(0, -1).join(", ")} and ${stored[stored.length - 1]}`;

  const handleClear = async () => {
    const outcome = await onClear();
    setIsConfirming(false);
    if (outcome === "cleared") {
      setJustCleared(true);
      window.setTimeout(() => setJustCleared(false), 4000);
    } else {
      setClearIncomplete(true);
    }
  };

  return (
    // A footnote to the sheet, not another card: this is housekeeping about
    // the page rather than part of the work on it.
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-start gap-2.5">
        <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <p className="measure text-sm leading-relaxed text-ink-muted">
          {summary
            ? `Held in this browser so a refresh doesn't lose your work: ${summary}.`
            : "Nothing stored right now. Anything you add stays in this browser."}
        </p>
      </div>

      <div className="shrink-0 sm:text-right">
        {clearIncomplete ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-warn"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Some of it is still here — close any other tabs running this app, then try again.
          </span>
        ) : justCleared ? (
          <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-good">
            <Check className="w-3.5 h-3.5" />
            Cleared
          </span>
        ) : isConfirming ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-control bg-mark/10 hover:bg-mark/20 border border-mark/30 text-mark text-[15px] font-semibold transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Yes, clear everything
            </button>
            <button
              onClick={() => setIsConfirming(false)}
              className="px-3 py-2 rounded-control border border-rule text-ink-soft hover:text-ink hover:bg-sunken text-[15px] font-semibold transition-all"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setClearIncomplete(false);
              setIsConfirming(true);
            }}
            disabled={stored.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-control border border-rule text-ink-soft hover:text-ink hover:bg-sunken text-[15px] font-semibold transition-all disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear stored data
          </button>
        )}
      </div>
    </section>
  );
};
