import React, { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { Speaker } from "../types";

interface ConsentGateProps {
  onAccept: () => void;
  /** The operator's declared side (D-24) — lets the notice name both people
   * in the room concretely rather than describing a call. */
  declaredSpeaker: Speaker;
}

/** The other person in the room, from the operator's own declared side. */
const OTHER_SIDE: Record<Speaker, string> = {
  candidate: "the interviewer",
  interviewer: "the candidate",
};

/**
 * The operator's own side, named by role only. The tool serves candidates and
 * interviewers alike, so the notice names both people by what they are rather
 * than marking one of them as "you".
 */
const SELF_SIDE: Record<Speaker, string> = {
  candidate: "the candidate",
  interviewer: "the interviewer",
};

/**
 * Blocking inline panel — not a modal, per RESEARCH.md's explicit
 * recommendation. The app has never shipped a modal; this reuses the same
 * card-panel language `ToolSection`'s `lockedReason` branch already uses
 * ("you can't proceed yet, here's why, here's what to do"). It cannot live
 * inside `lockedReason` itself: that branch renders no children, which would
 * make the checkbox unreachable.
 *
 * The checkbox starts unchecked and is never pre-ticked, and Continue stays
 * disabled until it is ticked — consent is an affirmative act the operator
 * takes, never a default the interface supplies. Per D-34 this gate is
 * mounted fresh for every take (the section unmounts it rather than hiding
 * it), so its checked state can never carry from one take to the next; there
 * is no reset effect here because there is nothing to reset.
 */
export const ConsentGate: React.FC<ConsentGateProps> = ({ onAccept, declaredSpeaker }) => {
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
          This tool records both people in this room — {SELF_SIDE[declaredSpeaker]} and{" "}
          {OTHER_SIDE[declaredSpeaker]} — through the one microphone on the table. Every person
          present must be told they're being recorded before you start, every time you start a
          new take.
        </p>
        <p className="text-sm text-[#9aa3b0] leading-relaxed">
          Recording-consent law differs by country and state; some places require everyone's
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
          I've told everyone in this room they're being recorded, and I've checked that this is
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
