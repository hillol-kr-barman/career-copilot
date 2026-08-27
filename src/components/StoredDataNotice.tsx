import React, { useState } from "react";
import { HardDrive, Trash2, Check } from "lucide-react";

interface StoredDataNoticeProps {
  hasResume: boolean;
  hasJobDescription: boolean;
  hasApiKey: boolean;
  onClear: () => void;
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
  onClear,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [justCleared, setJustCleared] = useState(false);

  const stored = [
    hasResume && "your resume",
    hasJobDescription && "the job description",
    hasApiKey && "your API key",
  ].filter(Boolean) as string[];

  const summary =
    stored.length === 0
      ? null
      : stored.length === 1
        ? stored[0]
        : `${stored.slice(0, -1).join(", ")} and ${stored[stored.length - 1]}`;

  const handleClear = () => {
    onClear();
    setIsConfirming(false);
    setJustCleared(true);
    window.setTimeout(() => setJustCleared(false), 4000);
  };

  return (
    <section className="w-full rounded-[10px] border border-[rgba(255,255,255,0.07)] bg-[#161a1e] px-5 py-4 md:px-7 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <span className="p-2 rounded-[6px] bg-[#1c2128] border border-[rgba(255,255,255,0.07)] text-[#6b7685] shrink-0">
          <HardDrive className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-xs font-semibold text-[#eef0f3]">Stored on this device</h2>
          <p className="text-[11px] text-[#6b7685] leading-relaxed mt-0.5">
            {summary
              ? `This browser is holding ${summary} so a refresh doesn't lose your work. Nothing is sent to or kept on the server.`
              : "Nothing is stored right now. Anything you add is kept in this browser only — never on the server."}
          </p>
        </div>
      </div>

      <div className="shrink-0 sm:text-right">
        {justCleared ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
            <Check className="w-3.5 h-3.5" />
            Cleared
          </span>
        ) : isConfirming ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[5px] bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-semibold transition-all active:scale-95"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Yes, clear everything
            </button>
            <button
              onClick={() => setIsConfirming(false)}
              className="px-3 py-2 rounded-[5px] border border-[rgba(255,255,255,0.07)] text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128] text-xs font-semibold transition-all active:scale-95"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsConfirming(true)}
            disabled={stored.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[5px] border border-[rgba(255,255,255,0.07)] text-[#9aa3b0] hover:text-[#eef0f3] hover:bg-[#1c2128] text-xs font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear stored data
          </button>
        )}
      </div>
    </section>
  );
};
