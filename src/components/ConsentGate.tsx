import React, { useState } from "react";
import { ShieldAlert } from "lucide-react";

interface ConsentGateProps {
  onAccept: () => void;
}

/**
 * Blocking inline panel — not a modal, per RESEARCH.md's explicit
 * recommendation. The app has never shipped a modal; this reuses the same
 * card-panel language `ToolSection`'s `lockedReason` branch already uses
 * ("you can't proceed yet, here's why, here's what to do"). It cannot live
 * inside `lockedReason` itself: that branch renders no children, which would
 * make the checkbox unreachable.
 *
 * The checkbox starts unchecked and is never pre-ticked (D-09) — consent is
 * an affirmative act the visitor takes, never a default the interface
 * supplies.
 */
export const ConsentGate: React.FC<ConsentGateProps> = ({ onAccept }) => {
  const [checked, setChecked] = useState(false);

  return (
    <div className="bg-[#1c2128] border border-[rgba(255,255,255,0.07)] rounded-[8px] p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-[8px] shrink-0 border bg-amber-500/10 border-amber-500/20 text-amber-400">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold text-[#eef0f3]">Before you record</h3>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-[#9aa3b0] leading-relaxed">
          Recording someone without telling them can be illegal. Tell every person on the call —
          including each interviewer on a panel — that you're recording, before you start.
          Recording-consent laws differ by country and state; some places require everyone's
          agreement, not just yours. If you're not sure what applies to you, check before you
          record.
        </p>
        <p className="text-sm text-[#9aa3b0] leading-relaxed">
          Audio never leaves this browser. Nothing is uploaded, and nothing touches our servers.
        </p>
      </div>

      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          id="consent-checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 shrink-0 w-4 h-4 accent-[#00d4dc] focus:outline-none focus:ring-1 focus:ring-[#00d4dc]"
        />
        <label htmlFor="consent-checkbox" className="text-sm text-[#9aa3b0] leading-relaxed">
          I've told everyone on this call they're being recorded, and I've checked that this is
          legal where I am.
        </label>
      </div>

      <button
        type="button"
        onClick={onAccept}
        disabled={!checked}
        className="w-full inline-flex items-center justify-center gap-2.5 bg-[#00d4dc] hover:opacity-90 text-[#0a0c0d] font-semibold text-sm uppercase tracking-widest py-4 px-4 rounded-[6px] active:scale-[0.99] transition-all disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-[#00d4dc]"
      >
        <span>Continue to recording setup</span>
      </button>
    </div>
  );
};
